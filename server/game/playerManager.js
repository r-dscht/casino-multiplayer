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
    /** @type {Map<string, Set<string>>} playerId -> active socketIds (multi-tab safe) */
    this.playerSockets = new Map();
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
    const cleanNormKey = cleanName.toLowerCase();
    const rawUsernameKey = (val.usernameKey && typeof val.usernameKey === 'string') ? val.usernameKey.toLowerCase() : null;
    const normKey = cleanNormKey || rawUsernameKey;
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
    const activeDebts = Array.isArray(val.activeDebts) ? [...val.activeDebts] : [];
    const activeLoansGiven = Array.isArray(val.activeLoansGiven) ? [...val.activeLoansGiven] : [];
    const repaidLoanIds = Array.isArray(val.repaidLoanIds) ? [...val.repaidLoanIds] : [];
    const lastWheelSpin = (typeof val.lastWheelSpin === 'number' && Number.isFinite(val.lastWheelSpin) && val.lastWheelSpin > 0)
      ? Math.min(Date.now(), val.lastWheelSpin)
      : 0;

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
      activeDebts,
      activeLoansGiven,
      repaidLoanIds,
      lastWheelSpin,
      connected: false,
      isHost: false,
      createdAt: val.createdAt || Date.now(),
      lastSeen: val.lastSeen || val.lastLogin || Date.now()
    };

    this.players.set(id, record);
    this.tokenToPlayerId.set(sessionToken, id);
    this.accounts.set(normKey, record);
    if (rawUsernameKey && rawUsernameKey !== normKey) {
      this.accounts.set(rawUsernameKey, record);
    }
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

    // Merge both this.accounts and this.players so no persistent account is ever dropped from disk!
    const allRecords = new Map();
    for (const acc of this.accounts.values()) {
      if (acc && acc.id) {
        allRecords.set(acc.id, acc);
      } else if (acc && acc.usernameKey) {
        allRecords.set(acc.usernameKey, acc);
      }
    }
    for (const player of this.players.values()) {
      if (player && player.id) {
        allRecords.set(player.id, player);
      }
    }

    for (const player of allRecords.values()) {
      const cleanName = sanitizeName(player.name) || player.id || 'Player';
      const normKey = (player.usernameKey || cleanName).toLowerCase();
      const record = {
        id: player.id,
        sessionToken: player.sessionToken,
        usernameKey: normKey,
        name: cleanName,
        passwordHash: player.passwordHash || (normKey && this.accounts.has(normKey) ? this.accounts.get(normKey).passwordHash : '') || '',
        avatar: player.avatar || 'avatar_1',
        color: player.color || DEFAULT_COLORS[0],
        chips: typeof player.chips === 'number' ? player.chips : STARTING_CHIPS,
        stats: player.stats || { roundsPlayed: 0, totalWon: 0, biggestWin: 0 },
        currentGame: player.currentGame || 'Roulette',
        location: player.location || 'ROULETTE',
        seatIndex: player.seatIndex !== undefined ? player.seatIndex : null,
        activeDebts: Array.isArray(player.activeDebts) ? [...player.activeDebts] : [],
        activeLoansGiven: Array.isArray(player.activeLoansGiven) ? [...player.activeLoansGiven] : [],
        repaidLoanIds: Array.isArray(player.repaidLoanIds) ? [...player.repaidLoanIds] : [],
        lastWheelSpin: typeof player.lastWheelSpin === 'number' ? player.lastWheelSpin : 0,
        createdAt: player.createdAt || Date.now(),
        lastSeen: player.lastSeen || Date.now()
      };

      if (isAccountsFormat) {
        data[normKey] = record;
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
   * Monotonically merges stats objects so counts/winnings never regress.
   * @private
   */
  _mergeStats(targetStats, sourceStats) {
    const a = (targetStats && typeof targetStats === 'object') ? targetStats : {};
    const b = (sourceStats && typeof sourceStats === 'object') ? sourceStats : {};
    return {
      roundsPlayed: Math.max(Number(a.roundsPlayed) || 0, Number(b.roundsPlayed) || 0),
      totalWon: Math.max(Number(a.totalWon) || 0, Number(b.totalWon) || 0),
      biggestWin: Math.max(Number(a.biggestWin) || 0, Number(b.biggestWin) || 0)
    };
  }

  /**
   * Reconciles backed-up client stats/chips (when matching the same username)
   * without overwriting fresh server state.
   * @private
   */
  _applySameUserBackup(record, backup, normKey) {
    if (!record || !backup || typeof backup !== 'object') return false;
    const bName = typeof backup.name === 'string' ? backup.name.trim().toLowerCase() : '';
    const rKey = (normKey || record.usernameKey || (record.name ? record.name.toLowerCase() : '')).trim();
    if (bName && rKey && bName !== rKey) return false;

    let changed = false;
    if (backup.stats && typeof backup.stats === 'object') {
      const merged = this._mergeStats(record.stats, backup.stats);
      const prev = record.stats || {};
      if (merged.roundsPlayed !== (prev.roundsPlayed || 0) ||
          merged.totalWon !== (prev.totalWon || 0) ||
          merged.biggestWin !== (prev.biggestWin || 0)) {
        record.stats = merged;
        changed = true;
      } else if (!record.stats) {
        record.stats = merged;
      }
    }

    const prevRounds = (record.stats && Number(record.stats.roundsPlayed)) || 0;
    const prevChips = typeof record.chips === 'number' ? record.chips : STARTING_CHIPS;
    if (prevRounds === 0 &&
        prevChips === STARTING_CHIPS &&
        Number.isInteger(backup.chips) &&
        backup.chips >= 0 &&
        backup.chips <= 1000000000 &&
        backup.chips !== STARTING_CHIPS) {
      record.chips = backup.chips;
      changed = true;
    }

    if (rKey && this.accounts.has(rKey)) {
      const acc = this.accounts.get(rKey);
      if (acc !== record) {
        acc.stats = this._mergeStats(acc.stats, record.stats);
        if (changed) acc.chips = record.chips;
      }
    }
    return changed;
  }

  /**
   * Finds a player record in `this.players`, or restores an offline account from `this.accounts` into `this.players`
   * so offline updates (Lottery/Racing/Bank) always synchronize both maps.
   * @private
   */
  _resolveOrActivateRecord(playerId) {
    if (!playerId) return null;
    const existing = this.players.get(playerId);
    if (existing) return existing;

    for (const acc of this.accounts.values()) {
      if (!acc) continue;
      if (acc.id === playerId || (acc.usernameKey && acc.usernameKey === String(playerId).toLowerCase())) {
        if (!acc.id) acc.id = playerId;
        if (acc.connected === undefined) acc.connected = false;
        this.players.set(acc.id, acc);
        return acc;
      }
    }
    return null;
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
    const backup = (opts.clientBackup && typeof opts.clientBackup === 'object') ? opts.clientBackup : null;
    const backupWheelSpin = (backup && typeof backup.lastWheelSpin === 'number' && Number.isFinite(backup.lastWheelSpin) && backup.lastWheelSpin > 0)
      ? Math.min(Date.now(), backup.lastWheelSpin)
      : 0;

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
        // If an explicit account name was provided (e.g. via login modal) that differs
        // from the token's account AND matches an existing account, skip the stale token
        // so the user logs into the account they explicitly typed!
        const explicitCleanName = sanitizeName(opts.name);
        const explicitNormKey = explicitCleanName ? explicitCleanName.toLowerCase() : '';
        const shouldSwitchAccount = explicitNormKey &&
          player.usernameKey &&
          explicitNormKey !== player.usernameKey &&
          this.accounts.has(explicitNormKey);

        if (!shouldSwitchAccount) {
          if (socketId) {
            this._bindSocket(socketId, player);
          } else {
            player.connected = true;
          }
          player.lastSeen = Date.now();
          player.lastWheelSpin = Math.max(player.lastWheelSpin || 0, backupWheelSpin);
          // Retain server-saved color: only use opts.color if player currently has no color
          if (!player.color && opts.color && typeof opts.color === 'string' && opts.color.startsWith('#')) {
            player.color = opts.color;
          }
          if (!player.avatar && opts.avatar && typeof opts.avatar === 'string') {
            player.avatar = opts.avatar;
          }
          const currentNormKey = (player.usernameKey || player.name || '').toLowerCase();
          if (backup) {
            this._applySameUserBackup(player, backup, currentNormKey);
          }
          if (currentNormKey && this.accounts.has(currentNormKey)) {
            const acc = this.accounts.get(currentNormKey);
            acc.color = player.color;
            acc.avatar = player.avatar;
            acc.stats = this._mergeStats(acc.stats, player.stats);
            player.stats = { ...acc.stats };
            acc.chips = player.chips;
            acc.lastWheelSpin = Math.max(acc.lastWheelSpin || 0, player.lastWheelSpin || 0);
            acc.lastSeen = Date.now();
          }

          this.scheduleSave();
          return {
            player,
            sessionToken: player.sessionToken,
            isNew: false
          };
        }
      }
    }

    // 2. Fallback to password-protected username login if specified
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const cleanName = sanitizeName(opts.name) || `Player_${randomSuffix}`;
    const normKey = cleanName.toLowerCase();
    const providedPassword = typeof opts.password === 'string' ? opts.password.trim() : '';

    let existingAccount = this.accounts.get(normKey);
    if (!existingAccount) {
      for (const p of this.players.values()) {
        if ((p.usernameKey && p.usernameKey.toLowerCase() === normKey) ||
            (p.name && p.name.toLowerCase() === normKey)) {
          existingAccount = p;
          this.accounts.set(normKey, p);
          break;
        }
      }
    }

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
          if (p.usernameKey === normKey || (p.name && p.name.toLowerCase() === normKey)) {
            player = p;
            break;
          }
        }
      }

      if (!player) {
        // Reconstruct active player session from saved account, preserving exact chips and color
        player = {
          id: existingAccount.id,
          sessionToken: existingAccount.sessionToken || `cst_${crypto.randomBytes(16).toString('hex')}`,
          socketId: socketId || null,
          usernameKey: normKey,
          name: existingAccount.name || cleanName,
          passwordHash: existingAccount.passwordHash || '',
          avatar: existingAccount.avatar || opts.avatar || 'avatar_1',
          color: existingAccount.color || opts.color || DEFAULT_COLORS[0],
          chips: (typeof existingAccount.chips === 'number') ? existingAccount.chips : STARTING_CHIPS,
          stats: existingAccount.stats ? { ...existingAccount.stats } : { roundsPlayed: 0, totalWon: 0, biggestWin: 0 },
          currentGame: existingAccount.currentGame || 'Roulette',
          location: existingAccount.location || 'ROULETTE',
          seatIndex: null, // Require manual seat selection; prevent auto-seat assignment on reconnect
          activeDebts: Array.isArray(existingAccount.activeDebts) ? [...existingAccount.activeDebts] : [],
          activeLoansGiven: Array.isArray(existingAccount.activeLoansGiven) ? [...existingAccount.activeLoansGiven] : [],
          repaidLoanIds: Array.isArray(existingAccount.repaidLoanIds) ? [...existingAccount.repaidLoanIds] : [],
          lastWheelSpin: Math.max(existingAccount.lastWheelSpin || 0, backupWheelSpin),
          connected: true,
          isHost: false,
          createdAt: existingAccount.createdAt || Date.now(),
          lastSeen: Date.now()
        };
        if (backup) {
          this._applySameUserBackup(player, backup, normKey);
        }
        this.players.set(player.id, player);
        this.tokenToPlayerId.set(player.sessionToken, player.id);
        this.accounts.set(normKey, player);
      } else {
        if (socketId) {
          this._bindSocket(socketId, player);
        } else {
          player.connected = true;
        }
        player.lastSeen = Date.now();
        player.lastWheelSpin = Math.max(player.lastWheelSpin || 0, existingAccount.lastWheelSpin || 0, backupWheelSpin);
        player.stats = this._mergeStats(player.stats, existingAccount.stats);
        if (backup) {
          this._applySameUserBackup(player, backup, normKey);
        }
        // Preserve player's existing server color
        if (!player.color) {
          player.color = existingAccount.color || opts.color || DEFAULT_COLORS[0];
        }
        if (!player.avatar) {
          player.avatar = existingAccount.avatar || opts.avatar || 'avatar_1';
        }
        if (player.usernameKey && this.accounts.has(player.usernameKey)) {
          const acc = this.accounts.get(player.usernameKey);
          acc.color = player.color;
          acc.avatar = player.avatar;
          acc.stats = { ...player.stats };
          acc.chips = player.chips;
          acc.lastWheelSpin = Math.max(acc.lastWheelSpin || 0, player.lastWheelSpin || 0);
          acc.lastSeen = Date.now();
        }
      }

      this.scheduleSave();
      return {
        player,
        sessionToken: player.sessionToken,
        isNew: false
      };
    }

    // 3. New player registration (or restoration from clientBackup if cloud container restarted)
    const restoredId = (backup && typeof backup.id === 'string' && backup.id.startsWith('ply_')) ? backup.id : null;
    const restoredToken = (backup && typeof backup.sessionToken === 'string' && backup.sessionToken.startsWith('cst_'))
      ? backup.sessionToken
      : null;
    const restoredChips = (backup && Number.isInteger(backup.chips) && backup.chips >= 0 && backup.chips <= 1000000000)
      ? backup.chips
      : STARTING_CHIPS;
    const restoredStats = (backup && backup.stats && typeof backup.stats === 'object')
      ? {
          roundsPlayed: Number(backup.stats.roundsPlayed) || 0,
          totalWon: Number(backup.stats.totalWon) || 0,
          biggestWin: Number(backup.stats.biggestWin) || 0
        }
      : {
          roundsPlayed: 0,
          totalWon: 0,
          biggestWin: 0
        };
    const restoredName = (!opts.name && backup && typeof backup.name === 'string')
      ? sanitizeName(backup.name)
      : '';
    const finalName = restoredName || cleanName;
    const finalNormKey = finalName.toLowerCase();

    const id = restoredId || `ply_${crypto.randomBytes(8).toString('hex')}`;
    const sessionToken = restoredToken || `cst_${crypto.randomBytes(16).toString('hex')}`;
    const colorIndex = this.players.size % DEFAULT_COLORS.length;
    const backupColor = (backup && typeof backup.color === 'string' && backup.color.startsWith('#')) ? backup.color : null;
    const chosenColor = (typeof opts.color === 'string' && opts.color.startsWith('#'))
      ? opts.color
      : (backupColor || DEFAULT_COLORS[colorIndex]);
    const chosenAvatar = opts.avatar || (backup && typeof backup.avatar === 'string' ? backup.avatar : 'avatar_1');

    const newPlayer = {
      id,
      sessionToken,
      socketId: socketId || null,
      usernameKey: finalNormKey,
      name: finalName,
      passwordHash: providedPassword ? this.hashPassword(providedPassword) : '',
      avatar: chosenAvatar,
      color: chosenColor,
      chips: restoredChips,
      stats: restoredStats,
      currentGame: 'Roulette',
      location: 'ROULETTE',
      seatIndex: null,
      activeDebts: (backup && Array.isArray(backup.activeDebts)) ? [...backup.activeDebts] : [],
      activeLoansGiven: (backup && Array.isArray(backup.activeLoansGiven)) ? [...backup.activeLoansGiven] : [],
      repaidLoanIds: (backup && Array.isArray(backup.repaidLoanIds)) ? [...backup.repaidLoanIds] : [],
      lastWheelSpin: backupWheelSpin,
      connected: true,
      isHost: this.players.size === 0,
      createdAt: (backup && Number.isInteger(backup.createdAt)) ? backup.createdAt : Date.now(),
      lastSeen: Date.now()
    };

    this.players.set(id, newPlayer);
    this.tokenToPlayerId.set(sessionToken, id);
    this.accounts.set(finalNormKey, newPlayer);
    if (socketId) {
      this._bindSocket(socketId, newPlayer);
    }

    this.scheduleSave();

    return {
      player: newPlayer,
      sessionToken,
      isNew: !backup
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
    const backup = (opts.clientBackup && typeof opts.clientBackup === 'object') ? opts.clientBackup : null;
    const backupWheelSpin = (backup && typeof backup.lastWheelSpin === 'number' && Number.isFinite(backup.lastWheelSpin) && backup.lastWheelSpin > 0)
      ? Math.min(Date.now(), backup.lastWheelSpin)
      : 0;

    // 1. Session token resumption
    if (opts.sessionToken && typeof opts.sessionToken === 'string') {
      const res = this.authSession(socketId, opts);
      if (res.error) return res;
      return res.player;
    }

    // 2. Reconnection by existing player ID
    if (opts.id && this.players.has(opts.id)) {
      const existingPlayer = this.players.get(opts.id);
      if (socketId) {
        this._bindSocket(socketId, existingPlayer);
      } else {
        existingPlayer.connected = true;
      }
      existingPlayer.lastSeen = Date.now();
      existingPlayer.lastWheelSpin = Math.max(existingPlayer.lastWheelSpin || 0, backupWheelSpin);
      if (opts.name) {
        const cleanName = sanitizeName(opts.name);
        if (cleanName) {
          const oldNormKey = existingPlayer.usernameKey;
          existingPlayer.name = cleanName;
          existingPlayer.usernameKey = cleanName.toLowerCase();
          this.accounts.set(existingPlayer.usernameKey, existingPlayer);
          if (oldNormKey && oldNormKey !== existingPlayer.usernameKey) {
            this.accounts.set(oldNormKey, existingPlayer);
          }
        }
      }
      if (!existingPlayer.color && opts.color) existingPlayer.color = opts.color;
      if (opts.avatar) existingPlayer.avatar = opts.avatar;
      if (existingPlayer.usernameKey && this.accounts.has(existingPlayer.usernameKey)) {
        const acc = this.accounts.get(existingPlayer.usernameKey);
        acc.color = existingPlayer.color;
        acc.avatar = existingPlayer.avatar;
        acc.lastWheelSpin = Math.max(acc.lastWheelSpin || 0, existingPlayer.lastWheelSpin || 0);
        acc.lastSeen = Date.now();
      }

      this.scheduleSave();
      return existingPlayer;
    }

    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const cleanName = sanitizeName(opts.name) || `Player_${randomSuffix}`;
    const normKey = cleanName.toLowerCase();
    const providedPassword = typeof opts.password === 'string' ? opts.password.trim() : '';

    // Check account in persistent storage
    let savedAccount = this.accounts.get(normKey);
    if (!savedAccount) {
      for (const p of this.players.values()) {
        if ((p.usernameKey && p.usernameKey.toLowerCase() === normKey) ||
            (p.name && p.name.toLowerCase() === normKey)) {
          savedAccount = p;
          this.accounts.set(normKey, p);
          break;
        }
      }
    }

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
      savedAccount.lastWheelSpin = Math.max(savedAccount.lastWheelSpin || 0, backupWheelSpin);
      if (!savedAccount.color && opts.color) savedAccount.color = opts.color;
      this.scheduleSave();
    } else {
      const colorIndex = this.players.size % DEFAULT_COLORS.length;
      const backupColor = (backup && typeof backup.color === 'string' && backup.color.startsWith('#')) ? backup.color : null;
      const chosenColor = (typeof opts.color === 'string' && opts.color.startsWith('#'))
        ? opts.color
        : (backupColor || DEFAULT_COLORS[colorIndex]);

      const generatedId = opts.id || (backup && typeof backup.id === 'string' && backup.id.startsWith('ply_') ? backup.id : `ply_${crypto.randomBytes(8).toString('hex')}`);
      const generatedToken = (backup && typeof backup.sessionToken === 'string' && backup.sessionToken.startsWith('cst_'))
        ? backup.sessionToken
        : `cst_${crypto.randomBytes(16).toString('hex')}`;
      const restoredChips = (backup && Number.isInteger(backup.chips) && backup.chips >= 0 && backup.chips <= 1000000000)
        ? backup.chips
        : STARTING_CHIPS;
      const restoredStats = (backup && backup.stats && typeof backup.stats === 'object')
        ? {
            roundsPlayed: Number(backup.stats.roundsPlayed) || 0,
            totalWon: Number(backup.stats.totalWon) || 0,
            biggestWin: Number(backup.stats.biggestWin) || 0
          }
        : {
            roundsPlayed: 0,
            totalWon: 0,
            biggestWin: 0
          };

      savedAccount = {
        id: generatedId,
        sessionToken: generatedToken,
        usernameKey: normKey,
        name: cleanName,
        passwordHash: providedPassword ? this.hashPassword(providedPassword) : '',
        chips: restoredChips,
        color: chosenColor,
        avatar: opts.avatar || (backup && typeof backup.avatar === 'string' ? backup.avatar : 'avatar_1'),
        stats: restoredStats,
        currentGame: 'Roulette',
        location: 'ROULETTE',
        seatIndex: null,
        activeDebts: (backup && Array.isArray(backup.activeDebts)) ? [...backup.activeDebts] : [],
        activeLoansGiven: (backup && Array.isArray(backup.activeLoansGiven)) ? [...backup.activeLoansGiven] : [],
        repaidLoanIds: (backup && Array.isArray(backup.repaidLoanIds)) ? [...backup.repaidLoanIds] : [],
        lastWheelSpin: backupWheelSpin,
        createdAt: (backup && Number.isInteger(backup.createdAt)) ? backup.createdAt : Date.now(),
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
    savedAccount.seatIndex = null;

    // Check if player object is already in active memory
    let existingPlayer = this.players.get(savedAccount.id);
    if (!existingPlayer) {
      for (const p of this.players.values()) {
        if (p.usernameKey === normKey || (p.name && p.name.toLowerCase() === normKey)) {
          existingPlayer = p;
          break;
        }
      }
    }

    if (existingPlayer) {
      if (socketId) {
        this._bindSocket(socketId, existingPlayer);
      } else {
        existingPlayer.connected = true;
      }
      existingPlayer.name = savedAccount.name || cleanName;
      existingPlayer.passwordHash = savedAccount.passwordHash || '';
      existingPlayer.chips = savedAccount.chips;
      existingPlayer.stats = this._mergeStats(existingPlayer.stats, savedAccount.stats);
      if (backup) {
        this._applySameUserBackup(existingPlayer, backup, normKey);
      }
      existingPlayer.currentGame = savedAccount.currentGame || 'Roulette';
      existingPlayer.location = savedAccount.location || 'ROULETTE';
      existingPlayer.seatIndex = savedAccount.seatIndex;
      existingPlayer.lastSeen = Date.now();
      existingPlayer.lastWheelSpin = Math.max(existingPlayer.lastWheelSpin || 0, savedAccount.lastWheelSpin || 0, backupWheelSpin);
      if (!existingPlayer.color) existingPlayer.color = savedAccount.color || opts.color;
      if (opts.avatar) existingPlayer.avatar = opts.avatar;
      this.accounts.set(normKey, existingPlayer);

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
      color: savedAccount.color || opts.color || DEFAULT_COLORS[0],
      chips: savedAccount.chips,
      stats: savedAccount.stats ? { ...savedAccount.stats } : { roundsPlayed: 0, totalWon: 0, biggestWin: 0 },
      currentGame: savedAccount.currentGame || 'Roulette',
      location: savedAccount.location || 'ROULETTE',
      seatIndex: savedAccount.seatIndex !== undefined ? savedAccount.seatIndex : null,
      activeDebts: (backup && Array.isArray(backup.activeDebts)) ? [...backup.activeDebts] : (Array.isArray(savedAccount.activeDebts) ? [...savedAccount.activeDebts] : []),
      activeLoansGiven: Array.isArray(savedAccount.activeLoansGiven) ? [...savedAccount.activeLoansGiven] : [],
      repaidLoanIds: Array.isArray(savedAccount.repaidLoanIds) ? [...savedAccount.repaidLoanIds] : [],
      lastWheelSpin: Math.max(savedAccount.lastWheelSpin || 0, backupWheelSpin),
      connected: true,
      isHost: this.players.size === 0,
      createdAt: savedAccount.createdAt || Date.now(),
      lastSeen: Date.now()
    };
    if (backup) {
      this._applySameUserBackup(newPlayer, backup, normKey);
    }

    this.players.set(id, newPlayer);
    this.tokenToPlayerId.set(savedAccount.sessionToken, id);
    this.accounts.set(normKey, newPlayer);
    if (socketId) {
      this._bindSocket(socketId, newPlayer);
    }
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
   * Retrieves player or account by username / usernameKey.
   * @param {string} username 
   * @returns {Object|null}
   */
  getPlayerByUsername(username) {
    if (!username || typeof username !== 'string') return null;
    const normKey = username.trim().toLowerCase();
    if (this.accounts.has(normKey)) {
      const acc = this.accounts.get(normKey);
      if (this.players.has(acc.id)) {
        return this.players.get(acc.id);
      }
      return acc;
    }
    for (const player of this.players.values()) {
      if ((player.usernameKey && player.usernameKey.toLowerCase() === normKey) ||
          (player.name && player.name.toLowerCase() === normKey)) {
        return player;
      }
    }
    return null;
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
   * Binds a socketId to a player while preserving other active sockets (multi-tab safe).
   * Cleanly detaches socketId from any previous player if switching accounts on the same socket.
   * @private
   * @param {string} socketId
   * @param {Object} player
   */
  _bindSocket(socketId, player) {
    if (!socketId || !player || !player.id) return;

    const prevPlayerId = this.socketToPlayer.get(socketId);
    if (prevPlayerId && prevPlayerId !== player.id) {
      const prevSet = this.playerSockets.get(prevPlayerId);
      if (prevSet) {
        prevSet.delete(socketId);
        if (prevSet.size === 0) {
          this.playerSockets.delete(prevPlayerId);
          const prevPlayer = this.players.get(prevPlayerId);
          if (prevPlayer) {
            prevPlayer.connected = false;
            prevPlayer.socketId = null;
          }
        } else {
          const prevPlayer = this.players.get(prevPlayerId);
          if (prevPlayer && prevPlayer.socketId === socketId) {
            prevPlayer.socketId = Array.from(prevSet)[prevSet.size - 1];
          }
        }
      }
    }

    let set = this.playerSockets.get(player.id);
    if (!set) {
      set = new Set();
      this.playerSockets.set(player.id, set);
    }
    set.add(socketId);
    this.socketToPlayer.set(socketId, player.id);
    player.socketId = socketId;
    player.connected = true;
  }

  /**
   * Returns all active socketIds mapped to a player.
   * @param {string} playerId
   * @returns {string[]}
   */
  getSocketsForPlayer(playerId) {
    if (!playerId) return [];
    const set = this.playerSockets.get(playerId);
    if (set && set.size > 0) {
      return Array.from(set);
    }
    const p = this.players.get(playerId);
    return (p && p.socketId) ? [p.socketId] : [];
  }

  /**
   * Handles player disconnection while preserving chips, bets and other open tabs.
   * @param {string} socketId 
   * @returns {Object|null} The disconnected player if no sockets remain active, otherwise null
   */
  disconnectPlayer(socketId) {
    const playerId = this.socketToPlayer.get(socketId);
    if (!playerId) return null;

    this.socketToPlayer.delete(socketId);
    const set = this.playerSockets.get(playerId);
    if (set) {
      set.delete(socketId);
    }

    const player = this.players.get(playerId);
    if (set && set.size > 0) {
      const fallbackSid = Array.from(set)[set.size - 1];
      if (player) {
        player.connected = true;
        player.socketId = fallbackSid;
        player.lastSeen = Date.now();
      }
      this.scheduleSave();
      return null;
    }

    if (set) {
      this.playerSockets.delete(playerId);
    }
    if (player) {
      player.connected = false;
      player.socketId = null;
      player.lastSeen = Date.now();
    }
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
    const player = this._resolveOrActivateRecord(playerId);
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
    const player = this._resolveOrActivateRecord(playerId);
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
    const player = this._resolveOrActivateRecord(playerId);
    if (!player) return null;
    player.chips = amount;
    if (player.usernameKey && this.accounts.has(player.usernameKey)) {
      this.accounts.get(player.usernameKey).chips = player.chips;
    }
    this.scheduleSave();
    return player.chips;
  }

  /**
   * Updates player gameplay statistics (rounds played, total won, biggest win)
   * and notifies `onHouseNetLoss(lostAmount, playerId)` when a net loss is recorded.
   * @param {string} playerId
   * @param {{ wonAmount?: number, lostAmount?: number }} params
   * @returns {Object|null} Updated stats
   */
  updatePlayerStats(playerId, { wonAmount = 0, lostAmount = 0 } = {}) {
    const player = this._resolveOrActivateRecord(playerId);
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
    if (typeof lostAmount === 'number' && Number.isFinite(lostAmount) && lostAmount > 0 && typeof this.onHouseNetLoss === 'function') {
      try {
        this.onHouseNetLoss(lostAmount, playerId);
      } catch (err) {}
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
      if (['LOBBY', 'ROULETTE', 'BLACKJACK', 'POKER', 'CRASH', 'PLINKO', 'SLOTS', 'RACING', 'HILO', 'MINES', 'AVIA', 'CROSS'].includes(upper)) {
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
    player.location = ['LOBBY', 'ROULETTE', 'BLACKJACK', 'POKER', 'CRASH', 'PLINKO', 'SLOTS', 'RACING', 'HILO', 'MINES', 'AVIA', 'CROSS'].includes(upper) ? upper : 'ROULETTE';

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
    if (typeof color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(color.trim())) {
      player.color = color.trim();
    }
    if (typeof avatar === 'string' && avatar.trim()) {
      player.avatar = avatar.trim().slice(0, 24);
    }
    const normKey = (player.usernameKey || player.name || '').toLowerCase();
    if (normKey) {
      if (this.accounts.has(normKey)) {
        const acc = this.accounts.get(normKey);
        if (player.color) acc.color = player.color;
        if (player.avatar) acc.avatar = player.avatar;
        acc.lastSeen = Date.now();
      } else {
        this.accounts.set(normKey, player);
      }
    }
    this.scheduleSave();
    return player;
  }

  /**
   * Updates or sets account password for an authenticated player.
   * If an existing passwordHash is set, oldPassword must be supplied and match.
   * @param {string} playerId
   * @param {{ oldPassword?: string, newPassword: string }} params
   * @returns {{ success: boolean, reason?: string }}
   */
  updatePlayerPassword(playerId, { oldPassword = '', newPassword = '' } = {}) {
    const player = this.players.get(playerId);
    if (!player) return { success: false, reason: 'Speler niet gevonden' };

    const normKey = (player.usernameKey || player.name || '').toLowerCase();
    const account = normKey && this.accounts.has(normKey) ? this.accounts.get(normKey) : null;
    const currentHash = (account && account.passwordHash) || player.passwordHash || '';

    if (currentHash) {
      if (!oldPassword || this.hashPassword(oldPassword) !== currentHash) {
        return { success: false, reason: 'Huidig wachtwoord is onjuist' };
      }
    }

    if (!newPassword || typeof newPassword !== 'string' || newPassword.trim().length < 3) {
      return { success: false, reason: 'Nieuw wachtwoord moet minimaal 3 tekens bevatten' };
    }

    const newHash = this.hashPassword(newPassword.trim());
    player.passwordHash = newHash;
    if (account) {
      account.passwordHash = newHash;
      account.lastSeen = Date.now();
    }
    this.scheduleSave();
    return { success: true };
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
        if (acc.id === playerId || (acc.name && acc.name.toLowerCase() === String(playerId).toLowerCase())) {
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
            createdAt: acc.createdAt || Date.now(),
            lastSeen: acc.lastSeen || acc.createdAt || Date.now()
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
      createdAt: (savedAccount && savedAccount.createdAt) ? savedAccount.createdAt : player.createdAt,
      lastSeen: player.lastSeen || (savedAccount && savedAccount.lastSeen) || player.createdAt || Date.now()
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
   * Returns the global all-time leaderboard across persisted & connected players
   * who have actively played rounds at the casino.
   * Sensitive fields (passwordHash, sessionToken, debts) are strictly omitted.
   * @param {Object} [options]
   * @param {boolean} [options.playedOnly=true] - Only include accounts that have played >= 1 round / recorded a win
   * @param {'all'|'online'|'offline'} [options.status='all'] - Optional connection status filter
   * @param {'chips'|'totalWon'|'roundsPlayed'|'biggestWin'} [options.sortBy='chips'] - Primary sort metric
   * @param {number} [options.limit=100] - Maximum entries returned
   * @returns {Array<Object>}
   */
  getGlobalLeaderboard(options = {}) {
    const opts = (options && typeof options === 'object') ? options : {};
    const playedOnly = opts.playedOnly !== false;
    const status = (opts.status === 'online' || opts.status === 'offline') ? opts.status : 'all';
    const validSorts = ['chips', 'totalWon', 'roundsPlayed', 'biggestWin'];
    const sortBy = validSorts.includes(opts.sortBy) ? opts.sortBy : 'chips';
    const rawLimit = Number(opts.limit);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(500, rawLimit) : 100;

    // Merge this.players and this.accounts cleanly without duplicating the same account
    const uniqueByKey = new Map();
    const ingest = (rec) => {
      if (!rec || typeof rec !== 'object' || !rec.name) return;
      const normKey = (rec.usernameKey || rec.name || rec.id || '').trim().toLowerCase();
      if (!normKey) return;
      const prev = uniqueByKey.get(normKey);
      if (!prev) {
        uniqueByKey.set(normKey, {
          ...rec,
          stats: this._mergeStats(rec.stats, null)
        });
        return;
      }
      const mergedStats = this._mergeStats(prev.stats, rec.stats);
      const prevRounds = (prev.stats && prev.stats.roundsPlayed) || 0;
      const recRounds = (rec.stats && rec.stats.roundsPlayed) || 0;
      const shouldReplace =
        (!prev.connected && !!rec.connected) ||
        (!!prev.connected === !!rec.connected &&
          (recRounds > prevRounds || (recRounds === prevRounds && (rec.lastSeen || 0) > (prev.lastSeen || 0))));
      const chosen = shouldReplace ? rec : prev;
      uniqueByKey.set(normKey, {
        ...chosen,
        stats: mergedStats
      });
    };

    for (const acc of this.accounts.values()) ingest(acc);
    for (const player of this.players.values()) ingest(player);

    const list = [];
    for (const rec of uniqueByKey.values()) {
      const stats = rec.stats || {};
      const roundsPlayed = Number(stats.roundsPlayed) || 0;
      const totalWon = Number(stats.totalWon) || 0;
      const biggestWin = Number(stats.biggestWin) || 0;
      const chips = typeof rec.chips === 'number' ? rec.chips : STARTING_CHIPS;
      const hasBankOrWheelActivity =
        (Number(rec.lastWheelSpin) || 0) > 0 ||
        (Array.isArray(rec.activeDebts) && rec.activeDebts.length > 0) ||
        (Array.isArray(rec.activeLoansGiven) && rec.activeLoansGiven.length > 0) ||
        (Array.isArray(rec.repaidLoanIds) && rec.repaidLoanIds.length > 0);
      const hasChipActivity = chips !== STARTING_CHIPS;
      const hasPlayed =
        roundsPlayed > 0 ||
        totalWon > 0 ||
        biggestWin > 0 ||
        hasChipActivity ||
        hasBankOrWheelActivity;

      if (playedOnly && !hasPlayed) continue;

      const isConnected = !!rec.connected;
      if (status === 'online' && !isConnected) continue;
      if (status === 'offline' && isConnected) continue;

      const lastGame = rec.currentGame || 'Roulette';
      list.push({
        id: rec.id,
        name: rec.name,
        monogram: getMonogram(rec.name),
        avatar: rec.avatar || 'avatar_1',
        color: rec.color || DEFAULT_COLORS[0],
        chips,
        connected: isConnected,
        currentGame: isConnected ? lastGame : 'Offline',
        lastGame,
        location: isConnected ? (rec.location || lastGame.toUpperCase()) : 'OFFLINE',
        stats: {
          roundsPlayed,
          totalWon,
          biggestWin
        },
        createdAt: rec.createdAt || Date.now(),
        lastSeen: rec.lastSeen || rec.createdAt || Date.now()
      });
    }

    const metric = (entry) => {
      switch (sortBy) {
        case 'totalWon':
          return entry.stats.totalWon;
        case 'roundsPlayed':
          return entry.stats.roundsPlayed;
        case 'biggestWin':
          return entry.stats.biggestWin;
        case 'chips':
        default:
          return entry.chips;
      }
    };

    list.sort((a, b) => {
      const diff = metric(b) - metric(a);
      if (diff !== 0) return diff;
      if (b.chips !== a.chips) return b.chips - a.chips;
      if (b.stats.totalWon !== a.stats.totalWon) return b.stats.totalWon - a.stats.totalWon;
      if (b.stats.roundsPlayed !== a.stats.roundsPlayed) return b.stats.roundsPlayed - a.stats.roundsPlayed;
      return (b.lastSeen || 0) - (a.lastSeen || 0);
    });

    return list.slice(0, limit);
  }

  /**
   * Restores previously cached All-Time / Offline leaderboard entries sent by
   * reconnecting clients after an ephemeral cloud restart.
   * Never downgrades live connected players or higher stats.
   * @param {Array<Object>} entries
   * @returns {boolean} True if at least one record was added or updated
   */
  restoreLeaderboardBackup(entries = []) {
    if (!Array.isArray(entries) || entries.length === 0) return false;
    let changed = false;
    const cap = Math.min(200, entries.length);

    for (let i = 0; i < cap; i += 1) {
      const entry = entries[i];
      if (!entry || typeof entry !== 'object') continue;
      if (typeof entry.id !== 'string' || !entry.id.startsWith('ply_')) continue;
      const cleanName = sanitizeName(entry.name);
      if (!cleanName) continue;
      const normKey = cleanName.toLowerCase();
      if (!Number.isInteger(entry.chips) || entry.chips < 0 || entry.chips > 1000000000) continue;

      const backupStats = this._mergeStats(entry.stats, null);
      const hasBackupActivity =
        backupStats.roundsPlayed > 0 ||
        backupStats.totalWon > 0 ||
        backupStats.biggestWin > 0 ||
        entry.chips !== STARTING_CHIPS;
      if (!hasBackupActivity) continue;

      const existing = this.accounts.get(normKey) || this.players.get(entry.id) || null;
      if (existing) {
        const mergedStats = this._mergeStats(existing.stats, backupStats);
        const prev = existing.stats || {};
        if (mergedStats.roundsPlayed !== (prev.roundsPlayed || 0) ||
            mergedStats.totalWon !== (prev.totalWon || 0) ||
            mergedStats.biggestWin !== (prev.biggestWin || 0)) {
          existing.stats = mergedStats;
          changed = true;
        }
        const existingIdleAtStart =
          !existing.connected &&
          (Number(prev.roundsPlayed) || 0) === 0 &&
          (Number(prev.totalWon) || 0) === 0 &&
          existing.chips === STARTING_CHIPS;
        if (existingIdleAtStart && (backupStats.roundsPlayed > 0 || entry.chips !== STARTING_CHIPS)) {
          existing.chips = entry.chips;
          if (typeof entry.color === 'string' && entry.color.startsWith('#')) {
            existing.color = entry.color;
          }
          if (typeof entry.avatar === 'string' && entry.avatar.trim()) {
            existing.avatar = entry.avatar.trim().slice(0, 24);
          }
          if (typeof entry.lastSeen === 'number' && Number.isFinite(entry.lastSeen)) {
            existing.lastSeen = Math.max(existing.lastSeen || 0, Math.min(Date.now(), entry.lastSeen));
          }
          changed = true;
        }
        if (!this.players.has(existing.id)) {
          this.players.set(existing.id, existing);
        }
        if (!this.accounts.has(normKey)) {
          this.accounts.set(normKey, existing);
        }
        continue;
      }

      const rawGame = (typeof entry.lastGame === 'string' && entry.lastGame.trim())
        ? entry.lastGame.trim().slice(0, 24)
        : ((typeof entry.currentGame === 'string' && entry.currentGame.trim() && entry.currentGame !== 'Offline')
          ? entry.currentGame.trim().slice(0, 24)
          : 'Roulette');
      const upperLoc = rawGame.toUpperCase();
      const allowedLocs = ['LOBBY', 'ROULETTE', 'BLACKJACK', 'POKER', 'CRASH', 'PLINKO', 'SLOTS', 'RACING', 'HILO', 'MINES', 'AVIA', 'CROSS'];
      const cleanLoc = allowedLocs.includes(upperLoc) ? upperLoc : 'ROULETTE';
      const now = Date.now();
      const record = {
        id: entry.id,
        sessionToken: `cst_${crypto.randomBytes(16).toString('hex')}`,
        socketId: null,
        usernameKey: normKey,
        name: cleanName,
        passwordHash: '',
        avatar: (typeof entry.avatar === 'string' && entry.avatar.trim()) ? entry.avatar.trim().slice(0, 24) : 'avatar_1',
        color: (typeof entry.color === 'string' && entry.color.startsWith('#')) ? entry.color : DEFAULT_COLORS[0],
        chips: entry.chips,
        stats: backupStats,
        currentGame: rawGame,
        location: cleanLoc,
        seatIndex: null,
        activeDebts: [],
        activeLoansGiven: [],
        repaidLoanIds: [],
        lastWheelSpin: 0,
        connected: false,
        isHost: false,
        createdAt: Number.isInteger(entry.createdAt) ? Math.min(now, entry.createdAt) : now,
        lastSeen: (typeof entry.lastSeen === 'number' && Number.isFinite(entry.lastSeen)) ? Math.min(now, entry.lastSeen) : now
      };
      this.players.set(record.id, record);
      this.accounts.set(normKey, record);
      changed = true;
    }

    if (changed) {
      this.scheduleSave();
    }
    return changed;
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
