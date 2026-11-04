/**
 * playerManager.js
 * In-memory player registry and atomic chip balance manager.
 * Supports session persistence across disconnects and zero GTA branding.
 */

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
  constructor() {
    /** @type {Map<string, Object>} playerId -> player object */
    this.players = new Map();
    /** @type {Map<string, string>} socketId -> playerId */
    this.socketToPlayer = new Map();
  }

  /**
   * Registers or reconnects a player.
   * @param {string} socketId 
   * @param {{ id?: string, name?: string, avatar?: string, color?: string }} options 
   * @returns {Object} The player profile
   */
  registerPlayer(socketId, options = {}) {
    const opts = (options && typeof options === 'object') ? options : {};
    let playerId = opts.id;
    let existingPlayer = playerId ? this.players.get(playerId) : null;

    if (existingPlayer) {
      // Reconnection: update socket association
      // Remove old socket mapping if any
      if (existingPlayer.socketId && this.socketToPlayer.get(existingPlayer.socketId) === playerId) {
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

    // New player creation: use explicit id if given, otherwise default to socketId
    const id = opts.id || socketId;
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const cleanName = sanitizeName(opts.name) || `Player_${randomSuffix}`;
    const colorIndex = this.players.size % DEFAULT_COLORS.length;
    const color = (typeof opts.color === 'string' && opts.color.startsWith('#'))
      ? opts.color
      : DEFAULT_COLORS[colorIndex];
    const avatar = opts.avatar || 'avatar_1';

    const newPlayer = {
      id,
      socketId,
      name: cleanName,
      avatar,
      color,
      chips: STARTING_CHIPS,
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
