/**
 * plinkoEngine.js
 * Server-authoritative Multiplayer Royal Plinko Engine for Monte Carlo Casino.
 *
 * Features:
 * - Cryptographically unbiased 50/50 peg bounce paths via crypto.randomInt(0, 2).
 * - Configurable row counts (8, 10, 12, 14, 16) and risk profiles (low, medium, high).
 * - Multi-ball rapid drop bursts (1 to 10 balls per request) with atomic chip accounting.
 * - Full integration with PlayerManager (chips, career stats) and BankManager (loan repayments).
 * - Zero audio and zero unicode emojis.
 */

const crypto = require('crypto');

const VALID_ROWS = [8, 10, 12, 14, 16];
const VALID_RISKS = ['low', 'medium', 'high'];
const MIN_BET = 10;
const MAX_BET = 50000;
const MAX_BALLS_PER_BURST = 10;
const RECENT_HISTORY_LIMIT = 25;

const MULTIPLIER_TABLES = {
  8: {
    low:    [5.4, 2.0, 1.05, 0.95, 0.45, 0.95, 1.05, 2.0, 5.4],
    medium: [12.5, 2.9, 1.25, 0.65, 0.35, 0.65, 1.25, 2.9, 12.5],
    high:   [27, 3.8, 1.45, 0.25, 0.2, 0.25, 1.45, 3.8, 27]
  },
  10: {
    low:    [8.5, 2.9, 1.35, 1.05, 0.95, 0.5, 0.95, 1.05, 1.35, 2.9, 8.5],
    medium: [21, 4.8, 1.9, 1.35, 0.55, 0.35, 0.55, 1.35, 1.9, 4.8, 21],
    high:   [72, 9.5, 2.8, 0.85, 0.3, 0.2, 0.3, 0.85, 2.8, 9.5, 72]
  },
  12: {
    low:    [9.6, 2.9, 1.55, 1.35, 1.05, 0.95, 0.45, 0.95, 1.05, 1.35, 1.55, 2.9, 9.6],
    medium: [32, 10.5, 3.8, 1.9, 1.05, 0.55, 0.25, 0.55, 1.05, 1.9, 3.8, 10.5, 32],
    high:   [165, 23, 7.6, 1.9, 0.65, 0.2, 0.2, 0.2, 0.65, 1.9, 7.6, 23, 165]
  },
  14: {
    low:    [6.8, 3.8, 1.8, 1.35, 1.25, 1.05, 0.95, 0.45, 0.95, 1.05, 1.25, 1.35, 1.8, 3.8, 6.8],
    medium: [55, 14.5, 6.6, 3.8, 1.8, 0.95, 0.45, 0.2, 0.45, 0.95, 1.8, 3.8, 6.6, 14.5, 55],
    high:   [400, 54, 17, 4.8, 1.8, 0.25, 0.2, 0.2, 0.2, 0.25, 1.8, 4.8, 17, 54, 400]
  },
  16: {
    low:    [15, 8.5, 1.9, 1.35, 1.35, 1.15, 1.05, 0.95, 0.45, 0.95, 1.05, 1.15, 1.35, 1.35, 1.9, 8.5, 15],
    medium: [105, 39, 9.5, 4.8, 2.8, 1.45, 0.95, 0.45, 0.25, 0.45, 0.95, 1.45, 2.8, 4.8, 9.5, 39, 105],
    high:   [1000, 122, 25, 8.5, 3.8, 1.9, 0.2, 0.2, 0.15, 0.2, 0.2, 1.9, 3.8, 8.5, 25, 122, 1000]
  }
};

class PlinkoEngine {
  /**
   * @param {Object} params
   * @param {import('./playerManager')} params.playerManager
   * @param {import('./bankManager')} [params.bankManager=null]
   */
  constructor({ playerManager, bankManager = null } = {}) {
    this.playerManager = playerManager;
    this.bankManager = bankManager;
    this.recentDrops = [];
    this.dropCounter = 0;
  }

  /**
   * Normalizes risk profile string ('med' -> 'medium').
   * @param {string} risk
   * @returns {'low'|'medium'|'high'|null}
   */
  normalizeRisk(risk) {
    if (typeof risk !== 'string') return null;
    const clean = risk.trim().toLowerCase();
    if (clean === 'med' || clean === 'medium') return 'medium';
    if (clean === 'low') return 'low';
    if (clean === 'high') return 'high';
    return null;
  }

  /**
   * Generates a cryptographically unbiased sequence of binary peg decisions.
   * @param {number} rows
   * @returns {number[]} Array of 0 (left) or 1 (right)
   */
  generatePath(rows) {
    const path = new Array(rows);
    for (let i = 0; i < rows; i++) {
      path[i] = crypto.randomInt(0, 2);
    }
    return path;
  }

  /**
   * Executes one or more synchronized Plinko ball drops for a player.
   * @param {string} playerId
   * @param {Object} [options={}]
   * @param {number} options.amount Bet per ball
   * @param {number} [options.rows=12] Row count (8, 10, 12, 14, 16)
   * @param {string} [options.risk='medium'] Risk level
   * @param {number} [options.count=1] Number of balls in burst (1..10)
   * @returns {Object}
   */
  dropBalls(playerId, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      return { ok: false, code: 'INVALID_PAYLOAD', error: 'Ongeldige inzetgegevens.' };
    }

    const player = this.playerManager && typeof this.playerManager.getPlayerById === 'function'
      ? this.playerManager.getPlayerById(playerId)
      : null;
    if (!player) {
      return { ok: false, code: 'PLAYER_NOT_FOUND', error: 'Speler niet gevonden. Log eerst in.' };
    }

    const amount = options.amount;
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < MIN_BET || amount > MAX_BET) {
      return {
        ok: false,
        code: 'INVALID_BET',
        error: `Inzet per bal moet een geheel getal zijn tussen ${MIN_BET} en ${MAX_BET.toLocaleString()} fiches.`
      };
    }

    const rows = options.rows === undefined ? 12 : options.rows;
    if (typeof rows !== 'number' || !Number.isInteger(rows) || !VALID_ROWS.includes(rows)) {
      return {
        ok: false,
        code: 'INVALID_ROWS',
        error: `Aantal rijen moet een van ${VALID_ROWS.join(', ')} zijn.`
      };
    }

    const rawRisk = options.risk === undefined ? 'medium' : options.risk;
    const normalizedRisk = this.normalizeRisk(rawRisk);
    if (!normalizedRisk) {
      return {
        ok: false,
        code: 'INVALID_RISK',
        error: 'Ongeldig risiconiveau (kies low, medium of high).'
      };
    }

    const count = options.count === undefined ? 1 : options.count;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_BALLS_PER_BURST) {
      return {
        ok: false,
        code: 'INVALID_COUNT',
        error: `Aantal ballen per worp moet tussen 1 en ${MAX_BALLS_PER_BURST} liggen.`
      };
    }

    const totalBet = amount * count;
    if (player.chips < totalBet) {
      return {
        ok: false,
        code: 'INSUFFICIENT_FUNDS',
        error: `Onvoldoende fiches (nodig: ${totalBet.toLocaleString()}, saldo: ${player.chips.toLocaleString()}).`
      };
    }

    const deductRes = this.playerManager.deductChips(playerId, totalBet);
    if (!deductRes || !deductRes.success) {
      return {
        ok: false,
        code: 'DEDUCT_FAILED',
        error: (deductRes && deductRes.reason) || 'Kon inzet niet afschrijven.'
      };
    }

    const table = MULTIPLIER_TABLES[rows][normalizedRisk];
    const drops = [];
    const allRepayments = [];
    let totalPayout = 0;

    for (let i = 0; i < count; i++) {
      const path = this.generatePath(rows);
      const slotIndex = path.reduce((sum, bit) => sum + bit, 0);
      const multiplier = table[slotIndex];
      const payout = Math.round(amount * multiplier);
      const profit = Math.max(0, payout - amount);

      if (payout > 0) {
        this.playerManager.addChips(playerId, payout);
      }
      totalPayout += payout;

      if (profit > 0 && this.bankManager && typeof this.bankManager.processWinRepayment === 'function') {
        const reps = this.bankManager.processWinRepayment(playerId, profit) || [];
        if (Array.isArray(reps) && reps.length > 0) {
          allRepayments.push(...reps);
        }
      }

      if (typeof this.playerManager.updatePlayerStats === 'function') {
        this.playerManager.updatePlayerStats(playerId, { wonAmount: profit });
      } else {
        if (!player.stats) {
          player.stats = { roundsPlayed: 0, totalWon: 0, biggestWin: 0 };
        }
        player.stats.roundsPlayed += 1;
        if (profit > 0) {
          player.stats.totalWon += profit;
          if (profit > (player.stats.biggestWin || 0)) {
            player.stats.biggestWin = profit;
          }
        }
      }

      this.dropCounter += 1;
      const drop = {
        id: `plk_${this.dropCounter}_${Date.now()}`,
        playerId: player.id,
        playerName: player.name,
        playerColor: player.color || '#D4AF37',
        amount,
        rows,
        risk: normalizedRisk,
        path,
        slotIndex,
        multiplier,
        payout,
        profit,
        timestamp: Date.now()
      };

      drops.push(drop);
      this.recentDrops.unshift(drop);
      if (this.recentDrops.length > RECENT_HISTORY_LIMIT) {
        this.recentDrops.length = RECENT_HISTORY_LIMIT;
      }
    }

    if (typeof this.playerManager._persistPlayer === 'function') {
      this.playerManager._persistPlayer(player);
    } else if (typeof this.playerManager.scheduleSave === 'function') {
      this.playerManager.scheduleSave();
    }

    const updatedPlayer = this.playerManager.getPlayerById(playerId) || player;

    return {
      ok: true,
      drops,
      totalBet,
      totalPayout,
      netProfit: totalPayout - totalBet,
      newChips: updatedPlayer.chips,
      stats: updatedPlayer.stats ? { ...updatedPlayer.stats } : null,
      repayments: allRepayments,
      recentDrops: this.getRecentDrops()
    };
  }

  /**
   * Returns a shallow copy of the most recent Plinko drops across all players.
   * @returns {Array<Object>}
   */
  getRecentDrops() {
    return this.recentDrops.slice(0, RECENT_HISTORY_LIMIT);
  }

  /**
   * Returns full static configuration and recent drop history for Plinko.
   * @returns {Object}
   */
  getState() {
    return {
      multiplierTables: MULTIPLIER_TABLES,
      validRows: [...VALID_ROWS],
      validRisks: [...VALID_RISKS],
      minBet: MIN_BET,
      maxBet: MAX_BET,
      maxBallsPerBurst: MAX_BALLS_PER_BURST,
      recentDrops: this.getRecentDrops()
    };
  }
}

module.exports = PlinkoEngine;
module.exports.PlinkoEngine = PlinkoEngine;
module.exports.MULTIPLIER_TABLES = MULTIPLIER_TABLES;
module.exports.VALID_ROWS = VALID_ROWS;
module.exports.VALID_RISKS = VALID_RISKS;
module.exports.MIN_BET = MIN_BET;
module.exports.MAX_BET = MAX_BET;
module.exports.MAX_BALLS_PER_BURST = MAX_BALLS_PER_BURST;
