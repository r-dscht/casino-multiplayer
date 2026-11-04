/**
 * playerManager.js
 * Player registry, account persistence and atomic chip balance manager.
 * Supports persistent account storage on disk (JSON), password protection,
 * session persistence across disconnects, and zero GTA branding.
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

class PlayerManager {
  /**
   * @param {Object} [config]
   * @param {string|false} [config.storagePath]
   */
  constructor(config = {}) {
    /** @type {Map<string, Object>} playerId -> player object */
    this.players = new Map();
    /** @type {Map<string, string>} socketId -> playerId */
    this.socketToPlayer = new Map();

    const isTestEnv = process.env.NODE_ENV === 'test' ||
                      process.execArgv.includes('--test') ||
                      process.argv.some(arg => arg.includes('--test') || arg.includes('.test.js'));

    /** @type {string|false} */
    this.storagePath = (config && config.storagePath !== undefined)
      ? config.storagePath
      : (isTestEnv ? false : path.join(__dirname, '..', 'data', 'accounts.json'));

    /** @type {Map<string, Object>} normUsername -> saved account data */
    this.accounts = new Map();

    this.loadAccounts();
  }

  loadAccounts() {
    if (!this.storagePath) return;
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          for (const [key, val] of Object.entries(parsed)) {
            this.accounts.set(key, val);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load accounts from storage:', err.message);
    }
  }

  saveAccounts() {
    if (!this.storagePath) return;
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = {};
      for (const [key, val] of this.accounts.entries()) {
        data[key] = val;
      }
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to save accounts to storage:', err.message);
    }
  }

  hashPassword(password) {
    if (!password || typeof password !== 'string') return '';
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  /**
   * Registers, authenticates or reconnects a player.
   * @param {string} socketId 
   * @param {{ id?: string, name?: string, password?: string, avatar?: string, color?: string }} options 
   * @returns {Object} The player profile or error object
   */
  registerPlayer(socketId, options = {}) {
    const opts = (options && typeof options === 'object') ? options : {};

    // 1. Reconnection by existing player ID (session resumption)
    if (opts.id && this.players.has(opts.id)) {
      const existingPlayer = this.players.get(opts.id);
      if (existingPlayer.socketId && this.socketToPlayer.get(existingPlayer.socketId) === existingPlayer.id) {
        this.socketToPlayer.delete(existingPlayer.socketId);
      }
      existingPlayer.socketId = socketId;
      existingPlayer.connected = true;
      if (opts.name) {
        const cleanName = sanitizeName(opts.name);
        if (cleanName) existingPlayer.name = cleanName;
      }
      if (opts.color) existingPlayer.color = opts.color;
      if (opts.avatar) existingPlayer.avatar = opts.avatar;

      this.socketToPlayer.set(socketId, existingPlayer.id);
      return existingPlayer;
    }

    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const cleanName = sanitizeName(opts.name) || `Player_${randomSuffix}`;
    const normKey = cleanName.toLowerCase();
    const providedPassword = typeof opts.password === 'string' ? opts.password.trim() : '';

    // Check account in persistent storage
    let savedAccount = this.accounts.get(normKey);

    if (savedAccount) {
      // Account exists: verify password if password was configured
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
        // Set password for previously unpassworded account
        savedAccount.passwordHash = this.hashPassword(providedPassword);
        this.saveAccounts();
      }

      savedAccount.lastLogin = Date.now();
      if (opts.color) savedAccount.color = opts.color;
      this.saveAccounts();
    } else {
      // Create new persistent account
      const colorIndex = this.players.size % DEFAULT_COLORS.length;
      const chosenColor = (typeof opts.color === 'string' && opts.color.startsWith('#'))
        ? opts.color
        : DEFAULT_COLORS[colorIndex];

      savedAccount = {
        name: cleanName,
        passwordHash: providedPassword ? this.hashPassword(providedPassword) : '',
        chips: STARTING_CHIPS,
        color: chosenColor,
        createdAt: Date.now(),
        lastLogin: Date.now()
      };
      this.accounts.set(normKey, savedAccount);
      this.saveAccounts();
    }

    // Check if player object is already in active memory with this usernameKey
    let existingPlayer = null;
    for (const p of this.players.values()) {
      if (p.usernameKey === normKey) {
        existingPlayer = p;
        break;
      }
    }

    if (existingPlayer) {
      if (existingPlayer.socketId && this.socketToPlayer.get(existingPlayer.socketId) === existingPlayer.id) {
        this.socketToPlayer.delete(existingPlayer.socketId);
      }
      existingPlayer.socketId = socketId;
      existingPlayer.connected = true;
      existingPlayer.name = savedAccount.name || cleanName;
      existingPlayer.chips = savedAccount.chips;
      if (opts.color) existingPlayer.color = opts.color;
      if (opts.avatar) existingPlayer.avatar = opts.avatar;

      this.socketToPlayer.set(socketId, existingPlayer.id);
      return existingPlayer;
    }

    // New active session
    const id = opts.id || socketId;
    const newPlayer = {
      id,
      socketId,
      usernameKey: normKey,
      name: savedAccount.name || cleanName,
      avatar: opts.avatar || 'avatar_1',
      color: opts.color || savedAccount.color,
      chips: savedAccount.chips,
      connected: true,
      isHost: this.players.size === 0,
      createdAt: Date.now()
    };

    this.players.set(id, newPlayer);
    this.socketToPlayer.set(socketId, id);
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
   * Handles player disconnection while preserving chips and bets.
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
    }
    this.socketToPlayer.delete(socketId);
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
      this.saveAccounts();
    }

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
      this.saveAccounts();
    }

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
      this.saveAccounts();
    }
    return player.chips;
  }

  /**
   * Returns list of connected players formatted for table state broadcasts.
   * @returns {Array<Object>}
   */
  getConnectedPlayers() {
    const list = [];
    for (const player of this.players.values()) {
      if (player.connected) {
        list.push({
          id: player.id,
          name: player.name,
          avatar: player.avatar,
          color: player.color,
          chips: player.chips,
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
