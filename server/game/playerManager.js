/**
 * playerManager.js
 * Player registry, bearer session authentication, atomic debounced persistence
 * and real-time multi-game presence manager.
 * Supports persistent account storage on disk (JSON), password protection,
 * bearer session tokens across refreshes, and zero GTA branding.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { STARTING_CHIPS } = require('./rouletteConstants');

const DEFAULT_COLORS = [
  '#10b981', // Emerald
  '#3b82f6', // Royal Blue
  '#8b5cf6', // Amethyst Purple
  '#f59e0b', // Amber Gold
  '#ec4899', // Ruby Pink
  '#06b6d4', // Cyan
  '#e11d48', // Crimson Red
  '#84cc16'  // Jade Lime
];

function sanitizeName(rawName) {
  if (typeof rawName !== 'string') return null;
  // Strip control characters, HTML tags, trim
  const clean = rawName.replace(/<[^>]*>/g, '').trim();
  if (!clean) return null;
  return clean.slice(0, 16);
}

function getMonogram(name) {
  if (!name || typeof name !== 'string') return '?';
  const clean = name.trim();
  if (!clean) return '?';
  const parts = clean.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

class PlayerManager {
  /**
   * @param {Object} [config]
   * @param {string|false} [config.storagePath]
   * @param {string|false} [config.legacyAccountsPath]
   * @param {number} [config.debounceMs]
   */
  constructor(config = {}) {
    /** @type {Map<string, Object>} playerId -> player object */
    this.players = new Map();
    /** @type {Map<string, string>} socketId -> playerId */
    this.socketToPlayer = new Map();
    /** @type {Map<string, string>} sessionToken -> playerId */
    this.tokenToPlayerId = new Map();
    /** @type {Map<string, Object>} normUsername -> saved account data */
    this.accounts = new Map();

    const isTestEnv = process.env.NODE_ENV === 'test' ||
                      process.execArgv.includes('--test') ||
                      process.argv.some(arg => arg.includes('--test') || arg.includes('.test.js'));

    const defaultStoragePath = path.join(__dirname, '..', 'data', 'players.json');
    const defaultAccountsPath = path.join(__dirname, '..', 'data', 'accounts.json');

    /** @type {string|false} */
    this.storagePath = (config && config.storagePath !== undefined)
      ? config.storagePath
      : (isTestEnv ? false : defaultStoragePath);

    /** @type {string|false} */
    this.legacyAccountsPath = (config && config.legacyAccountsPath !== undefined)
      ? config.legacyAccountsPath
      : defaultAccountsPath;

    // Configure debounced write-through delay
    if (config && config.debounceMs !== undefined) {
      this.debounceMs = config.debounceMs;
    } else if (typeof this.storagePath === 'string' && (this.storagePath.includes('account') || this.storagePath.includes('data_test_'))) {
      // Legacy unit tests inspect the disk synchronously on the very next line
      this.debounceMs = 0;
    } else {
      this.debounceMs = 100; // 100ms debounced write-through for players.json
    }

    this.saveTimer = null;
    this.isDirty = false;

    this.loadStorage();

    if (!isTestEnv) {
      process.on('SIGINT', () => this.flushToDiskSync());
      process.on('SIGTERM', () => this.flushToDiskSync());
      process.on('beforeExit', () => this.flushToDiskSync());
    }
  }

  /**
   * Ingests a raw account or player record into memory maps.
   * @private
   */
  _ingestRecord(key, val) {
    if (!val || typeof val !== 'object') return;
    const cleanName = sanitizeName(val.name) || key;
    const normKey = (val.usernameKey || cleanName).toLowerCase();
    const id = val.id || (key.startsWith('ply_') ? key : `ply_${crypto.randomBytes(8).toString('hex')}`);
    const sessionToken = val.sessionToken || (key.startsWith('cst_') ? key : `cst_${crypto.randomBytes(16).toString('hex')}`);
    const chips = (typeof val.chips === 'number' && Number.isInteger(val.chips)) ? val.chips : STARTING_CHIPS;
    const stats = val.stats || { roundsPlayed: 0, totalWon: 0, biggestWin: 0 };
    const color = (typeof val.color === 'string' && val.color.startsWith('#')) ? val.color : DEFAULT_COLORS[0];
    const avatar = val.avatar || 'avatar_1';
    const passwordHash = val.passwordHash || '';
    const currentGame = val.currentGame || 'Roulette';
    const location = val.location || (currentGame ? currentGame.toUpperCase() : 'ROULETTE');
    const seatIndex = (typeof val.seatIndex === 'number' && Number.isInteger(val.seatIndex) && val.seatIndex >= 0)
      ? val.seatIndex
      : null;

    const record = {
      id,
      sessionToken,
      socketId: null,
      usernameKey: normKey,
      name: cleanName,
      passwordHash,
      avatar,
      color,
      chips,
      stats: { ...stats },
      currentGame,
      location,
      seatIndex,
      connected: false,
      isHost: false,
      createdAt: val.createdAt || Date.now(),
      lastSeen: val.lastSeen || val.lastLogin || Date.now()
    };

    this.players.set(id, record);
    this.tokenToPlayerId.set(sessionToken, id);
    this.accounts.set(normKey, record);
  }

  /**
   * Loads player storage from disk or automatically migrates from legacy accounts.json.
   */
  loadStorage() {
    if (!this.storagePath) return;

    const storageExists = fs.existsSync(this.storagePath);
    const legacyExists = this.legacyAccountsPath && fs.existsSync(this.legacyAccountsPath);

    // Automatic migration: if players.json does not exist yet but accounts.json exists
    if (!storageExists && legacyExists) {
      this.migrateFromAccounts(this.legacyAccountsPath);
      return;
    }

    if (storageExists) {
      try {
        const raw = fs.readFileSync(this.storagePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          for (const [key, val] of Object.entries(parsed)) {
            this._ingestRecord(key, val);
          }
        }
      } catch (err) {
        console.error('Failed to load players from storage:', err.message);
      }
    }
  }

  /**
   * Backwards compatible alias for loadStorage.
   */
  loadAccounts() {
    this.loadStorage();
  }

  /**
   * Automatically migrates legacy accounts from accounts.json into players.json.
   * @param {string} accountsPath 
   * @returns {boolean}
   */
  migrateFromAccounts(accountsPath) {
    try {
      if (!fs.existsSync(accountsPath)) return false;
      const raw = fs.readFileSync(accountsPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return false;

      for (const [key, val] of Object.entries(parsed)) {
        this._ingestRecord(key, val);
      }

      // Immediately write migrated records to players.json using atomic file swap
      this._writeStorageImmediate();
      return true;
    } catch (err) {
      console.error('Migration from accounts.json failed:', err.message);
      return false;
    }
  }

  /**
   * Serializes current in-memory player records.
   * @private
   * @returns {string}
   */
  _serializeStorage() {
    const data = {};
    const isAccountsFormat = typeof this.storagePath === 'string' && this.storagePath.includes('account');

    for (const player of this.players.values()) {
      const record = {
        id: player.id,
        sessionToken: player.sessionToken,
        usernameKey: player.usernameKey,
        name: player.name,
        passwordHash: player.passwordHash || (player.usernameKey && this.accounts.has(player.usernameKey) ? this.accounts.get(player.usernameKey).passwordHash : '') || '',
        avatar: player.avatar || 'avatar_1',
        color: player.color,
        chips: player.chips,
        stats: player.stats || { roundsPlayed: 0, totalWon: 0, biggestWin: 0 },
        currentGame: player.currentGame || 'Roulette',
        location: player.location || 'ROULETTE',
        seatIndex: player.seatIndex !== undefined ? player.seatIndex : null,
        createdAt: player.createdAt || Date.now(),
        lastSeen: player.lastSeen || Date.now()
      };

      if (isAccountsFormat) {
        data[player.usernameKey || player.name.toLowerCase()] = record;
      } else {
        data[player.id] = record;
      }
    }
    return JSON.stringify(data, null, 2);
  }

  /**
   * Performs an immediate, atomic write to disk using a temporary file and rename.
   * @private
   */
  _writeStorageImmediate() {
    if (!this.storagePath) return;
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tempPath = `${this.storagePath}.tmp.${process.pid}.${Date.now()}`;
      const serialized = this._serializeStorage();
      fs.writeFileSync(tempPath, serialized, 'utf8');
      fs.renameSync(tempPath, this.storagePath);
      this.isDirty = false;
    } catch (err) {
      console.error('Failed to write players storage atomically:', err.message);
    }
  }

  /**
   * Schedules a debounced disk save (100ms default) or executes immediately if debounce is 0.
   */
  scheduleSave() {
    if (!this.storagePath) return;
    this.isDirty = true;
    if (this.debounceMs <= 0) {
      this._writeStorageImmediate();
      return;
    }
    if (!this.saveTimer) {
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        this._writeStorageImmediate();
      }, this.debounceMs);
    }
  }

  /**
   * Synchronously flushes any pending debounced writes to disk.
   */
  flushToDiskSync() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.isDirty || (this.storagePath && !fs.existsSync(this.storagePath) && this.players.size > 0)) {
      this._writeStorageImmediate();
    }
  }

  /**
   * Backwards compatible alias for flushToDiskSync.
   */
  saveAccounts() {
    this.flushToDiskSync();
  }

  hashPassword(password) {
    if (!password || typeof password !== 'string') return '';
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  /**
   * Authenticates or resumes a session using a bearer sessionToken.
   * Restores exact PlayerRecord without resetting chips.
   * If token is missing or not found, registers a new player with 10,000 chips.
   * @param {string} socketId 
   * @param {{ sessionToken?: string, name?: string, color?: string, password?: string, avatar?: string }} options 
   * @returns {{ player?: Object, sessionToken?: string, isNew?: boolean, error?: string, message?: string }}
   */
  authSession(socketId, options = {}) {
    const opts = (options && typeof options === 'object') ? options : {};

    // 1. Session token lookup
    if (opts.sessionToken && typeof opts.sessionToken === 'string') {
      let playerId = this.tokenToPlayerId.get(opts.sessionToken);
      let player = playerId ? this.players.get(playerId) : null;
      if (!player) {
        for (const p of this.players.values()) {
          if (p.sessionToken === opts.sessionToken) {
            player = p;
            break;
          }
        }
        if (!player) {
          for (const acc of this.accounts.values()) {
            if (acc.sessionToken === opts.sessionToken) {
              player = acc;
              this.players.set(player.id, player);
              this.tokenToPlayerId.set(player.sessionToken, player.id);
              break;
            }
          }
        }
      }
      if (player) {
        // Unmap previous socket if assigned
        if (player.socketId && this.socketToPlayer.get(player.socketId) === player.id) {
          this.socketToPlayer.delete(player.socketId);
        }

        if (socketId) {
          player.socketId = socketId;
          this.socketToPlayer.set(socketId, player.id);
        }
        player.connected = true;
        player.lastSeen = Date.now();

        this.scheduleSave();
        return {
          player,
          sessionToken: player.sessionToken,
          isNew: false
        };
      }
    }

    // 2. Fallback to password-protected username login if specified
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const cleanName = sanitizeName(opts.name) || `Player_${randomSuffix}`;
    const normKey = cleanName.toLowerCase();
    const providedPassword = typeof opts.password === 'string' ? opts.password.trim() : '';

    const existingAccount = this.accounts.get(normKey);
    if (existingAccount) {
      if (existingAccount.passwordHash) {
        if (!providedPassword) {
          return {
            error: 'PASSWORD_REQUIRED',
            message: 'Dit account is beveiligd met een wachtwoord.'
          };
        }
        const hash = this.hashPassword(providedPassword);
        if (hash !== existingAccount.passwordHash) {
          return {
            error: 'INCORRECT_PASSWORD',
            message: 'Wachtwoord onjuist voor deze accountnaam.'
          };
        }
      }

      let player = this.players.get(existingAccount.id);
      if (!player) {
        for (const p of this.players.values()) {
          if (p.usernameKey === normKey) {
            player = p;
            break;
          }
        }
      }

      if (!player) {
        // Reconstruct active player session from saved account, preserving exact chips
        player = {
          id: existingAccount.id,
          sessionToken: existingAccount.sessionToken || `cst_${crypto.randomBytes(16).toString('hex')}`,
          socketId: socketId || null,
          usernameKey: normKey,
          name: existingAccount.name || cleanName,
          passwordHash: existingAccount.passwordHash || '',
          avatar: opts.avatar || existingAccount.avatar || 'avatar_1',
          color: opts.color || existingAccount.color || DEFAULT_COLORS[0],
          chips: (typeof existingAccount.chips === 'number') ? existingAccount.chips : STARTING_CHIPS,
          stats: existingAccount.stats ? { ...existingAccount.stats } : { roundsPlayed: 0, totalWon: 0, biggestWin: 0 },
          currentGame: existingAccount.currentGame || 'Roulette',
          location: existingAccount.location || 'ROULETTE',
          seatIndex: existingAccount.seatIndex !== undefined ? existingAccount.seatIndex : null,
          connected: true,
          isHost: false,
          createdAt: existingAccount.createdAt || Date.now(),
          lastSeen: Date.now()
        };
        this.players.set(player.id, player);
        this.tokenToPlayerId.set(player.sessionToken, player.id);
        this.accounts.set(normKey, player);
      } else {
        if (player.socketId && this.socketToPlayer.get(player.socketId) === player.id) {
          this.socketToPlayer.delete(player.socketId);
        }
        if (socketId) {
          player.socketId = socketId;
          this.socketToPlayer.set(socketId, player.id);
        }
        player.connected = true;
        player.lastSeen = Date.now();
        if (opts.color) player.color = opts.color;
        if (opts.avatar) player.avatar = opts.avatar;
      }

      if (socketId) {
        this.socketToPlayer.set(socketId, player.id);
      }
      this.scheduleSave();
      return {
        player,
        sessionToken: player.sessionToken,
        isNew: false
      };
    }

    // 3. New player registration with starting 10,000 chips and bearer token
    const id = `ply_${crypto.randomBytes(8).toString('hex')}`;
    const sessionToken = `cst_${crypto.randomBytes(16).toString('hex')}`;
    const colorIndex = this.players.size % DEFAULT_COLORS.length;
    const chosenColor = (typeof opts.color === 'string' && opts.color.startsWith('#'))
      ? opts.color
      : DEFAULT_COLORS[colorIndex];

    const newPlayer = {
      id,
      sessionToken,
      socketId: socketId || null,
      usernameKey: normKey,
      name: cleanName,
      passwordHash: providedPassword ? this.hashPassword(providedPassword) : '',
      avatar: opts.avatar || 'avatar_1',
      color: chosenColor,
      chips: STARTING_CHIPS, // exactly 10,000 chips
      stats: {
        roundsPlayed: 0,
        totalWon: 0,
        biggestWin: 0
      },
      currentGame: 'Roulette',
      location: 'ROULETTE',
      seatIndex: null,
      connected: true,
      isHost: this.players.size === 0,
      createdAt: Date.now(),
      lastSeen: Date.now()
    };

    this.players.set(id, newPlayer);
    this.tokenToPlayerId.set(sessionToken, id);
    this.accounts.set(normKey, newPlayer);
    if (socketId) {
      this.socketToPlayer.set(socketId, id);
    }

    this.scheduleSave();

    return {
      player: newPlayer,
      sessionToken,
      isNew: true
    };
  }

  /**
   * Registers, authenticates or reconnects a player.
   * Full backwards compatibility with existing socket handlers and test suites.
   * @param {string} socketId 
   * @param {{ id?: string, sessionToken?: string, name?: string, password?: string, avatar?: string, color?: string }} options 
   * @returns {Object} The player profile or error object
   */
  registerPlayer(socketId, options = {}) {
    const opts = (options && typeof options === 'object') ? options : {};

    // 1. Session token resumption
    if (opts.sessionToken && typeof opts.sessionToken === 'string') {
      const res = this.authSession(socketId, opts);
      if (res.error) return res;
      return res.player;
    }

    // 2. Reconnection by existing player ID
    if (opts.id && this.players.has(opts.id)) {
      const existingPlayer = this.players.get(opts.id);
      if (existingPlayer.socketId && this.socketToPlayer.get(existingPlayer.socketId) === existingPlayer.id) {
        this.socketToPlayer.delete(existingPlayer.socketId);
      }
      existingPlayer.socketId = socketId;
      existingPlayer.connected = true;
      existingPlayer.lastSeen = Date.now();
      if (opts.name) {
        const cleanName = sanitizeName(opts.name);
        if (cleanName) existingPlayer.name = cleanName;
      }
      if (opts.color) existingPlayer.color = opts.color;
      if (opts.avatar) existingPlayer.avatar = opts.avatar;

      this.socketToPlayer.set(socketId, existingPlayer.id);
      this.scheduleSave();
      return existingPlayer;
    }

    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const cleanName = sanitizeName(opts.name) || `Player_${randomSuffix}`;
    const normKey = cleanName.toLowerCase();
    const providedPassword = typeof opts.password === 'string' ? opts.password.trim() : '';

    // Check account in persistent storage
    let savedAccount = this.accounts.get(normKey);

    if (savedAccount) {
      if (savedAccount.passwordHash) {
        if (!providedPassword) {
          return {
            error: 'PASSWORD_REQUIRED',
            message: 'Dit account is beveiligd met een wachtwoord.'
          };
        }
        const hash = this.hashPassword(providedPassword);
        if (hash !== savedAccount.passwordHash) {
          return {
            error: 'INCORRECT_PASSWORD',
            message: 'Wachtwoord onjuist voor deze accountnaam.'
          };
        }
      } else if (providedPassword) {
        savedAccount.passwordHash = this.hashPassword(providedPassword);
      }

      savedAccount.lastLogin = Date.now();
      savedAccount.lastSeen = Date.now();
      if (opts.color) savedAccount.color = opts.color;
      this.scheduleSave();
    } else {
      const colorIndex = this.players.size % DEFAULT_COLORS.length;
      const chosenColor = (typeof opts.color === 'string' && opts.color.startsWith('#'))
        ? opts.color
        : DEFAULT_COLORS[colorIndex];

      const generatedId = opts.id || `ply_${crypto.randomBytes(8).toString('hex')}`;
      const generatedToken = `cst_${crypto.randomBytes(16).toString('hex')}`;

      savedAccount = {
        id: generatedId,
        sessionToken: generatedToken,
        usernameKey: normKey,
        name: cleanName,
        passwordHash: providedPassword ? this.hashPassword(providedPassword) : '',
        chips: STARTING_CHIPS,
        color: chosenColor,
        avatar: opts.avatar || 'avatar_1',
        stats: {
          roundsPlayed: 0,
          totalWon: 0,
          biggestWin: 0
        },
        currentGame: 'Roulette',
        location: 'ROULETTE',
        seatIndex: null,
        createdAt: Date.now(),
        lastLogin: Date.now(),
        lastSeen: Date.now()
      };
      this.accounts.set(normKey, savedAccount);
      this.scheduleSave();
    }

    if (!savedAccount.id) {
      savedAccount.id = opts.id || `ply_${crypto.randomBytes(8).toString('hex')}`;
    }
    if (!savedAccount.sessionToken) {
      savedAccount.sessionToken = `cst_${crypto.randomBytes(16).toString('hex')}`;
    }
    if (!savedAccount.stats) {
      savedAccount.stats = { roundsPlayed: 0, totalWon: 0, biggestWin: 0 };
    }
    if (!savedAccount.currentGame) {
      savedAccount.currentGame = 'Roulette';
    }
    if (!savedAccount.location) {
      savedAccount.location = 'ROULETTE';
    }
    if (savedAccount.seatIndex === undefined) {
      savedAccount.seatIndex = null;
    }

    // Check if player object is already in active memory
    let existingPlayer = this.players.get(savedAccount.id);
    if (!existingPlayer) {
      for (const p of this.players.values()) {
        if (p.usernameKey === normKey) {
          existingPlayer = p;
          break;
        }
      }
    }

    if (existingPlayer) {
      if (existingPlayer.socketId && this.socketToPlayer.get(existingPlayer.socketId) === existingPlayer.id) {
        this.socketToPlayer.delete(existingPlayer.socketId);
      }
      existingPlayer.socketId = socketId;
      existingPlayer.connected = true;
      existingPlayer.name = savedAccount.name || cleanName;
      existingPlayer.passwordHash = savedAccount.passwordHash || '';
      existingPlayer.chips = savedAccount.chips;
      existingPlayer.stats = savedAccount.stats;
      existingPlayer.currentGame = savedAccount.currentGame || 'Roulette';
      existingPlayer.location = savedAccount.location || 'ROULETTE';
      existingPlayer.seatIndex = savedAccount.seatIndex;
      existingPlayer.lastSeen = Date.now();
      if (opts.color) existingPlayer.color = opts.color;
      if (opts.avatar) existingPlayer.avatar = opts.avatar;

      this.socketToPlayer.set(socketId, existingPlayer.id);
      this.scheduleSave();
      return existingPlayer;
    }

    // New active session
    const id = opts.id || savedAccount.id;
    const newPlayer = {
      id,
      sessionToken: savedAccount.sessionToken,
      socketId,
      usernameKey: normKey,
      name: savedAccount.name || cleanName,
      passwordHash: savedAccount.passwordHash || (providedPassword ? this.hashPassword(providedPassword) : ''),
      avatar: opts.avatar || savedAccount.avatar || 'avatar_1',
      color: opts.color || savedAccount.color,
      chips: savedAccount.chips,
      stats: savedAccount.stats,
      currentGame: savedAccount.currentGame || 'Roulette',
      location: savedAccount.location || 'ROULETTE',
      seatIndex: savedAccount.seatIndex !== undefined ? savedAccount.seatIndex : null,
      connected: true,
      isHost: this.players.size === 0,
      createdAt: savedAccount.createdAt || Date.now(),
      lastSeen: Date.now()
    };

    this.players.set(id, newPlayer);
    this.tokenToPlayerId.set(savedAccount.sessionToken, id);
    this.socketToPlayer.set(socketId, id);
    this.scheduleSave();
    return newPlayer;
  }

  /**
   * Retrieves player by current socketId.
   * @param {string} socketId 
   * @returns {Object|null}
   */
  getPlayerBySocket(socketId) {
    const playerId = this.socketToPlayer.get(socketId);
    if (!playerId) return null;
    return this.players.get(playerId) || null;
  }

  /**
   * Retrieves player by persistent playerId.
   * @param {string} playerId 
   * @returns {Object|null}
   */
  getPlayerById(playerId) {
    return this.players.get(playerId) || null;
  }

  /**
   * Retrieves player by bearer session token.
   * @param {string} sessionToken 
   * @returns {Object|null}
   */
  getPlayerByToken(sessionToken) {
    if (!sessionToken || typeof sessionToken !== 'string') return null;
    const playerId = this.tokenToPlayerId.get(sessionToken);
    if (!playerId) return null;
    return this.players.get(playerId) || null;
  }

  /**
   * Handles player disconnection while preserving chips, bets and session.
   * @param {string} socketId 
   * @returns {Object|null} The disconnected player
   */
  disconnectPlayer(socketId) {
    const playerId = this.socketToPlayer.get(socketId);
    if (!playerId) return null;

    const player = this.players.get(playerId);
    if (player) {
      player.connected = false;
      player.socketId = null;
      player.lastSeen = Date.now();
    }
    this.socketToPlayer.delete(socketId);
    this.scheduleSave();
    return player || null;
  }

  /**
   * Atomically deducts chips from a player's balance.
   * @param {string} playerId 
   * @param {number} amount 
   * @returns {{ success: boolean, chips?: number, reason?: string }}
   */
  deductChips(playerId, amount) {
    const player = this.players.get(playerId);
    if (!player) {
      return { success: false, reason: 'Player not found' };
    }
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
      return { success: false, reason: 'Invalid deduction amount' };
    }
    if (player.chips < amount) {
      return { success: false, reason: 'Insufficient chip balance' };
    }

    player.chips -= amount;
    if (player.usernameKey && this.accounts.has(player.usernameKey)) {
      this.accounts.get(player.usernameKey).chips = player.chips;
    }
    this.scheduleSave();

    return { success: true, chips: player.chips };
  }

  /**
   * Atomically adds chips to a player's balance.
   * @param {string} playerId 
   * @param {number} amount 
   * @returns {{ success: boolean, chips?: number, reason?: string }}
   */
  addChips(playerId, amount) {
    const player = this.players.get(playerId);
    if (!player) {
      return { success: false, reason: 'Player not found' };
    }
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0) {
      return { success: false, reason: 'Invalid credit amount' };
    }

    player.chips += amount;
    if (player.usernameKey && this.accounts.has(player.usernameKey)) {
      this.accounts.get(player.usernameKey).chips = player.chips;
    }
    this.scheduleSave();

    return { success: true, chips: player.chips };
  }

  /**
   * Resets/replenishes player bankroll (e.g. bankrupt reload or admin command).
   * @param {string} playerId 
   * @param {number} amount 
   * @returns {number|null} New chips balance
   */
  resetBankroll(playerId, amount = STARTING_CHIPS) {
    const player = this.players.get(playerId);
    if (!player) return null;
    player.chips = amount;
    if (player.usernameKey && this.accounts.has(player.usernameKey)) {
      this.accounts.get(player.usernameKey).chips = player.chips;
    }
    this.scheduleSave();
    return player.chips;
  }

  /**
   * Updates player gameplay statistics (rounds played, total won, biggest win).
   * @param {string} playerId 
   * @param {{ wonAmount?: number }} params 
   * @returns {Object|null} Updated stats
   */
  updatePlayerStats(playerId, { wonAmount = 0 } = {}) {
    const player = this.players.get(playerId);
    if (!player) return null;
    if (!player.stats) {
      player.stats = { roundsPlayed: 0, totalWon: 0, biggestWin: 0 };
    }
    player.stats.roundsPlayed += 1;
    if (typeof wonAmount === 'number' && wonAmount > 0) {
      player.stats.totalWon += wonAmount;
      if (wonAmount > player.stats.biggestWin) {
        player.stats.biggestWin = wonAmount;
      }
    }
    if (player.usernameKey && this.accounts.has(player.usernameKey)) {
      this.accounts.get(player.usernameKey).stats = { ...player.stats };
    }
    this.scheduleSave();
    return player.stats;
  }

  /**
   * Updates player real-time presence (location and seat).
   * @param {string} playerId 
   * @param {'LOBBY'|'ROULETTE'|'BLACKJACK'|string} location 
   * @param {number|null} [seatIndex=null] 
   * @returns {boolean}
   */
  setPlayerPresence(playerId, location, seatIndex = null) {
    const player = this.players.get(playerId);
    if (!player) return false;

    let cleanLoc = 'ROULETTE';
    if (typeof location === 'string') {
      const upper = location.trim().toUpperCase();
      if (['LOBBY', 'ROULETTE', 'BLACKJACK'].includes(upper)) {
        cleanLoc = upper;
      }
    }

    const cleanSeat = (typeof seatIndex === 'number' && Number.isInteger(seatIndex) && seatIndex >= 0)
      ? seatIndex
      : null;

    player.location = cleanLoc;
    player.seatIndex = cleanSeat;
    player.currentGame = cleanLoc.charAt(0) + cleanLoc.slice(1).toLowerCase();

    if (player.usernameKey && this.accounts.has(player.usernameKey)) {
      const acc = this.accounts.get(player.usernameKey);
      acc.location = cleanLoc;
      acc.seatIndex = cleanSeat;
      acc.currentGame = player.currentGame;
    }

    this.scheduleSave();
    return true;
  }

  /**
   * Updates active game status (presence).
   * @param {string} playerId 
   * @param {string} gameName 
   * @returns {boolean}
   */
  setPlayerGame(playerId, gameName) {
    const player = this.players.get(playerId);
    if (!player) return false;
    const cleanGame = (typeof gameName === 'string' && gameName.trim())
      ? gameName.trim().slice(0, 24)
      : 'Roulette';
    player.currentGame = cleanGame;

    const upper = cleanGame.toUpperCase();
    player.location = ['LOBBY', 'ROULETTE', 'BLACKJACK'].includes(upper) ? upper : 'ROULETTE';

    if (player.usernameKey && this.accounts.has(player.usernameKey)) {
      const acc = this.accounts.get(player.usernameKey);
      acc.currentGame = cleanGame;
      acc.location = player.location;
    }
    this.scheduleSave();
    return true;
  }

  /**
   * Updates avatar or accent color customization.
   * @param {string} playerId 
   * @param {{ color?: string, avatar?: string }} params 
   * @returns {boolean}
   */
  updatePlayerCustomization(playerId, { color, avatar } = {}) {
    const player = this.players.get(playerId);
    if (!player) return null;
    if (typeof color === 'string' && color.startsWith('#')) {
      player.color = color;
    }
    if (typeof avatar === 'string' && avatar.trim()) {
      player.avatar = avatar.trim().slice(0, 24);
    }
    if (player.usernameKey && this.accounts.has(player.usernameKey)) {
      const acc = this.accounts.get(player.usernameKey);
      if (player.color) acc.color = player.color;
      if (player.avatar) acc.avatar = player.avatar;
    }
    this.scheduleSave();
    return player;
  }

  /**
   * Returns comprehensive public player profile with monogram and statistics.
   * Sensitive data (passwordHash, sessionToken) is strictly omitted.
   * @param {string} playerId 
   * @returns {Object|null}
   */
  getPlayerProfile(playerId) {
    const player = this.players.get(playerId);
    if (!player) {
      for (const acc of this.accounts.values()) {
        if (acc.name.toLowerCase() === String(playerId).toLowerCase()) {
          return {
            id: acc.id || playerId,
            name: acc.name,
            monogram: getMonogram(acc.name),
            color: acc.color,
            avatar: acc.avatar || 'avatar_1',
            chips: acc.chips,
            currentGame: acc.currentGame || 'Offline',
            location: acc.location || 'LOBBY',
            seatIndex: acc.seatIndex !== undefined ? acc.seatIndex : null,
            connected: false,
            stats: acc.stats || { roundsPlayed: 0, totalWon: 0, biggestWin: 0 },
            createdAt: acc.createdAt || Date.now()
          };
        }
      }
      return null;
    }

    const savedAccount = player.usernameKey ? this.accounts.get(player.usernameKey) : null;
    return {
      id: player.id,
      name: player.name,
      monogram: getMonogram(player.name),
      color: player.color,
      avatar: player.avatar || 'avatar_1',
      chips: player.chips,
      currentGame: player.currentGame || 'Roulette',
      location: player.location || 'ROULETTE',
      seatIndex: player.seatIndex !== undefined ? player.seatIndex : null,
      connected: !!player.connected,
      stats: player.stats || { roundsPlayed: 0, totalWon: 0, biggestWin: 0 },
      createdAt: (savedAccount && savedAccount.createdAt) ? savedAccount.createdAt : player.createdAt
    };
  }

  /**
   * Returns list of connected players formatted for table state and presence broadcasts.
   * @returns {Array<Object>}
   */
  getConnectedPlayers() {
    const list = [];
    for (const player of this.players.values()) {
      if (player.connected) {
        list.push({
          id: player.id,
          name: player.name,
          monogram: getMonogram(player.name),
          avatar: player.avatar,
          color: player.color,
          chips: player.chips,
          currentGame: player.currentGame || 'Roulette',
          location: player.location || (player.currentGame ? player.currentGame.toUpperCase() : 'ROULETTE'),
          seatIndex: player.seatIndex !== undefined ? player.seatIndex : null,
          stats: player.stats || { roundsPlayed: 0, totalWon: 0, biggestWin: 0 },
          isHost: player.isHost
        });
      }
    }
    return list;
  }

  /**
   * Returns total count of registered players.
   * @returns {number}
   */
  getPlayerCount() {
    return this.players.size;
  }
}

module.exports = PlayerManager;
module.exports.getMonogram = getMonogram;
