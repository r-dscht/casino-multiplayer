/**
 * crossEngine.js
 * Server-authoritative engine for Monte Carlo Boulevard Cross ("Cross").
 * Features unlimited lanes, uniform 80% survival / 20% crash probability per lane,
 * exact >= 2% casino house edge (~98% RTP), atomic chip accounting,
 * salon live-runner feed, navigation lock helpers, and bank loan win repayment.
 * Zero audio, zero Unicode emojis, zero banned brand terms.
 */

const crypto = require('crypto');
const EventEmitter = require('events');
const {
  TARGET_RTP,
  HIT_NUMERATOR,
  HIT_DENOMINATOR,
  HIT_PROBABILITY,
  SURVIVAL_PROBABILITY,
  MIN_BET,
  MAX_BET,
  MAX_MULTIPLIER,
  MAX_PAYOUT,
  HISTORY_LIMIT,
  RECENT_WINS_LIMIT,
  BIG_WIN_MIN_PROFIT,
  BIG_WIN_MIN_LANE,
  VEHICLE_TYPES,
  calculateCrossMultiplier,
  calculateCrossPayout,
  getCrossLadderPreview
} = require('./crossConstants');

function defaultRngInt(min, maxExclusive) {
  return crypto.randomInt(min, maxExclusive);
}

class CrossEngine extends EventEmitter {
  /**
   * Accepts either ({ playerManager, bankManager, rngInt }) or (playerManager, options).
   * @param {Object} playerManagerOrOptions
   * @param {Object} [maybeOptions={}]
   */
  constructor(playerManagerOrOptions = {}, maybeOptions = {}) {
    super();
    let playerManager = playerManagerOrOptions;
    let options = maybeOptions || {};

    if (
      playerManagerOrOptions &&
      typeof playerManagerOrOptions === 'object' &&
      playerManagerOrOptions.playerManager &&
      typeof playerManagerOrOptions.getPlayerById !== 'function'
    ) {
      playerManager = playerManagerOrOptions.playerManager;
      options = { ...playerManagerOrOptions, ...maybeOptions };
    }

    this.playerManager = playerManager;
    this.bankManager = options.bankManager || null;
    this.rngInt = typeof options.rngInt === 'function' ? options.rngInt : defaultRngInt;

    /** @type {Map<string, Object>} Active Boulevard Cross runs by playerId */
    this.activeRuns = new Map();
    /** @type {Map<string, Object>} Players actively present in Cross Salon */
    this.salonPlayers = new Map();
    /** @type {Map<string, Array<Object>>} Personal completed run history */
    this.personalHistory = new Map();
    /** @type {Array<Object>} Global notable wins in Boulevard Cross */
    this.recentWins = [];

    this._runSeq = 0;
    this._stopped = false;
  }

  start() {
    this._stopped = false;
  }

  stop() {
    this._stopped = true;
  }

  /** @private */
  _ensurePlayer(playerId) {
    if (!this.playerManager || typeof this.playerManager.getPlayerById !== 'function') return null;
    return this.playerManager.getPlayerById(playerId) || null;
  }

  /**
   * Navigation Lock contract helper.
   * @param {string} playerId
   * @returns {boolean}
   */
  hasActiveBets(playerId) {
    return this.activeRuns.has(playerId);
  }

  /**
   * Navigation Lock active stake helper.
   * @param {string} playerId
   * @returns {number}
   */
  getActiveBetTotal(playerId) {
    const run = this.activeRuns.get(playerId);
    return run ? run.betAmount : 0;
  }

  joinSalon(playerId) {
    const player = this._ensurePlayer(playerId);
    if (!player) return false;

    const activeRun = this.activeRuns.get(playerId) || null;
    this.salonPlayers.set(playerId, {
      playerId: player.id,
      name: player.name,
      color: player.color || '#d4af37',
      inRun: Boolean(activeRun),
      lane: activeRun ? activeRun.currentLane : 0,
      multiplier: activeRun ? activeRun.currentMultiplier : 1.0,
      betAmount: activeRun ? activeRun.betAmount : 0,
      joinedAt: Date.now()
    });
    this._emitSalonUpdate();
    return true;
  }

  leaveSalon(playerId) {
    if (!this.salonPlayers.has(playerId)) return false;
    this.salonPlayers.delete(playerId);
    this._emitSalonUpdate();
    return true;
  }

  /** @private */
  _syncSalonEntry(playerId) {
    const player = this._ensurePlayer(playerId);
    if (!player) return;
    if (!this.salonPlayers.has(playerId) && !this.activeRuns.has(playerId)) return;

    const activeRun = this.activeRuns.get(playerId) || null;
    this.salonPlayers.set(playerId, {
      playerId: player.id,
      name: player.name,
      color: player.color || '#d4af37',
      inRun: Boolean(activeRun),
      lane: activeRun ? activeRun.currentLane : 0,
      multiplier: activeRun ? activeRun.currentMultiplier : 1.0,
      betAmount: activeRun ? activeRun.betAmount : 0,
      joinedAt: Date.now()
    });
  }

  /** @private */
  _emitSalonUpdate() {
    if (this._stopped) return;
    this.emit('salon_update', {
      salonPlayers: this._serializeSalonPlayers(),
      recentWins: this.recentWins.slice(0, RECENT_WINS_LIMIT)
    });
  }

  /** @private */
  _serializeSalonPlayers() {
    const list = [];
    for (const entry of this.salonPlayers.values()) {
      const activeRun = this.activeRuns.get(entry.playerId);
      list.push({
        playerId: entry.playerId,
        name: entry.name,
        color: entry.color,
        inRun: Boolean(activeRun),
        lane: activeRun ? activeRun.currentLane : 0,
        multiplier: activeRun ? activeRun.currentMultiplier : 1.0,
        betAmount: activeRun ? activeRun.betAmount : 0
      });
    }
    list.sort((a, b) => {
      if (a.inRun !== b.inRun) return a.inRun ? -1 : 1;
      if (a.lane !== b.lane) return b.lane - a.lane;
      return a.name.localeCompare(b.name);
    });
    return list;
  }

  /** @private */
  _serializeRun(run) {
    if (!run) return null;
    return {
      runId: run.runId,
      playerId: run.playerId,
      betAmount: run.betAmount,
      status: run.status,
      currentLane: run.currentLane,
      currentMultiplier: run.currentMultiplier,
      currentPayout: run.currentPayout,
      nextLane: run.currentLane + 1,
      nextMultiplier: run.nextMultiplier,
      nextPayout: run.nextPayout,
      canCashout: run.canCashout,
      ladderPreview: getCrossLadderPreview(run.betAmount, Math.max(1, run.currentLane + 1), 8),
      stepHistory: run.stepHistory.slice(-12),
      startedAt: run.startedAt
    };
  }

  /** @private */
  _recordPersonalHistory(playerId, entry) {
    if (!this.personalHistory.has(playerId)) {
      this.personalHistory.set(playerId, []);
    }
    const list = this.personalHistory.get(playerId);
    list.unshift(entry);
    if (list.length > HISTORY_LIMIT) {
      list.length = HISTORY_LIMIT;
    }
  }

  /** @private */
  _persistPlayer(player) {
    if (!player || !this.playerManager) return;
    if (typeof this.playerManager._persistPlayer === 'function') {
      this.playerManager._persistPlayer(player);
    } else if (typeof this.playerManager.scheduleSave === 'function') {
      this.playerManager.scheduleSave();
    }
  }

  /**
   * Starts a new Monte Carlo Boulevard Cross run at lane 0 (safe start sidewalk).
   * @param {string} playerId
   * @param {{ betAmount?: number, amount?: number }} [payload={}]
   * @returns {Object}
   */
  startRun(playerId, payload = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, code: 'INVALID_PAYLOAD', message: 'Ongeldige inzetgegevens.' };
    }

    const player = this._ensurePlayer(playerId);
    if (!player) {
      return { ok: false, code: 'PLAYER_NOT_FOUND', message: 'Speler niet gevonden. Log eerst in.' };
    }

    if (this.activeRuns.has(playerId)) {
      return { ok: false, code: 'RUN_ALREADY_ACTIVE', message: 'Je hebt al een lopende oversteek.' };
    }

    const rawAmount = payload.betAmount !== undefined ? payload.betAmount : payload.amount;
    if (typeof rawAmount !== 'number' || !Number.isInteger(rawAmount) || rawAmount < MIN_BET || rawAmount > MAX_BET) {
      return {
        ok: false,
        code: 'INVALID_BET',
        message: `Inzet moet een geheel getal zijn tussen ${MIN_BET} en ${MAX_BET.toLocaleString()} fiches.`
      };
    }

    if (player.chips < rawAmount) {
      return {
        ok: false,
        code: 'INSUFFICIENT_FUNDS',
        message: `Onvoldoende fiches (nodig: ${rawAmount.toLocaleString()}, saldo: ${player.chips.toLocaleString()}).`
      };
    }

    const deductRes = this.playerManager.deductChips(playerId, rawAmount);
    if (!deductRes || !deductRes.success) {
      return {
        ok: false,
        code: 'DEDUCT_FAILED',
        message: (deductRes && deductRes.reason) || 'Kon inzet niet afschrijven.'
      };
    }

    this._runSeq += 1;
    const run = {
      runId: `crs_${this._runSeq}_${Date.now()}`,
      playerId: player.id,
      playerName: player.name,
      playerColor: player.color || '#d4af37',
      betAmount: rawAmount,
      status: 'ACTIVE',
      currentLane: 0,
      currentMultiplier: 1.0,
      currentPayout: rawAmount,
      nextMultiplier: calculateCrossMultiplier(1),
      nextPayout: calculateCrossPayout(rawAmount, 1),
      canCashout: false,
      stepHistory: [],
      startedAt: Date.now()
    };

    this.activeRuns.set(playerId, run);
    this._persistPlayer(player);
    this._syncSalonEntry(playerId);
    this._emitSalonUpdate();

    const updatedPlayer = this._ensurePlayer(playerId) || player;
    return {
      ok: true,
      run: this._serializeRun(run),
      newChips: updatedPlayer.chips,
      stats: updatedPlayer.stats ? { ...updatedPlayer.stats } : null,
      salon: this.getPublicState(playerId)
    };
  }

  /**
   * Attempts to step forward 1 lane (`currentLane + 1`) across the boulevard.
   * Each lane has an independent 20% crash chance / 80% survival chance.
   * @param {string} playerId
   * @returns {Object}
   */
  stepForward(playerId) {
    const player = this._ensurePlayer(playerId);
    if (!player) {
      return { ok: false, code: 'PLAYER_NOT_FOUND', message: 'Speler niet gevonden. Log eerst in.' };
    }

    const run = this.activeRuns.get(playerId);
    if (!run || run.status !== 'ACTIVE') {
      return { ok: false, code: 'NO_ACTIVE_RUN', message: 'Start eerst een nieuwe oversteek.' };
    }

    const targetLane = run.currentLane + 1;
    const hitRoll = this.rngInt(0, HIT_DENOMINATOR);
    const isHit = hitRoll < HIT_NUMERATOR;
    const carType = VEHICLE_TYPES[this.rngInt(0, VEHICLE_TYPES.length)];
    const carDirection = targetLane % 2 === 0 ? 1 : -1;

    if (isHit) {
      run.status = 'HIT';
      this.activeRuns.delete(playerId);

      if (typeof this.playerManager.updatePlayerStats === 'function') {
        this.playerManager.updatePlayerStats(playerId, { wonAmount: 0 });
      }
      this._persistPlayer(player);

      const completed = {
        runId: run.runId,
        playerId: run.playerId,
        playerName: player.name,
        playerColor: player.color || '#d4af37',
        betAmount: run.betAmount,
        outcome: 'HIT',
        finalLane: targetLane,
        safeLanes: run.currentLane,
        multiplier: 0,
        payout: 0,
        netProfit: -run.betAmount,
        carType,
        timestamp: Date.now()
      };
      this._recordPersonalHistory(playerId, completed);
      this._syncSalonEntry(playerId);
      this._emitSalonUpdate();

      const updated = this._ensurePlayer(playerId) || player;
      return {
        ok: true,
        survived: false,
        hit: true,
        lane: targetLane,
        carType,
        carDirection,
        completedRun: completed,
        run: null,
        newChips: updated.chips,
        stats: updated.stats ? { ...updated.stats } : null,
        salon: this.getPublicState(playerId)
      };
    }

    // Survived lane cleanly
    run.currentLane = targetLane;
    run.currentMultiplier = calculateCrossMultiplier(targetLane);
    run.currentPayout = calculateCrossPayout(run.betAmount, targetLane);
    run.canCashout = true;
    run.nextMultiplier = calculateCrossMultiplier(targetLane + 1);
    run.nextPayout = calculateCrossPayout(run.betAmount, targetLane + 1);
    run.stepHistory.push({
      lane: targetLane,
      multiplier: run.currentMultiplier,
      payout: run.currentPayout,
      carType,
      carDirection
    });

    // Enforce global max multiplier / payout cap automatically
    const hitsMaxCap = run.currentMultiplier >= MAX_MULTIPLIER
      || run.currentPayout >= MAX_PAYOUT
      || calculateCrossPayout(run.betAmount, targetLane + 1) <= run.currentPayout;

    if (hitsMaxCap) {
      const cashRes = this.cashout(playerId, { autoMaxCap: true });
      return {
        ...cashRes,
        survived: true,
        hit: false,
        autoCashedOut: true,
        lane: targetLane,
        carType,
        carDirection
      };
    }

    this._syncSalonEntry(playerId);
    this._emitSalonUpdate();

    const updated = this._ensurePlayer(playerId) || player;
    return {
      ok: true,
      survived: true,
      hit: false,
      autoCashedOut: false,
      lane: targetLane,
      carType,
      carDirection,
      run: this._serializeRun(run),
      newChips: updated.chips,
      stats: updated.stats ? { ...updated.stats } : null,
      salon: this.getPublicState(playerId)
    };
  }

  /**
   * Cashes out the player's active run after at least 1 safely crossed lane.
   * @param {string} playerId
   * @param {Object} [opts={}]
   * @returns {Object}
   */
  cashout(playerId, opts = {}) {
    const player = this._ensurePlayer(playerId);
    if (!player) {
      return { ok: false, code: 'PLAYER_NOT_FOUND', message: 'Speler niet gevonden. Log eerst in.' };
    }

    const run = this.activeRuns.get(playerId);
    if (!run || run.status !== 'ACTIVE') {
      return { ok: false, code: 'NO_ACTIVE_RUN', message: 'Geen actieve oversteek om uit te cashen.' };
    }

    if (run.currentLane < 1) {
      return {
        ok: false,
        code: 'CANNOT_CASHOUT_AT_START',
        message: 'Steek eerst minimaal 1 rijstrook over voordat je uitcasht.'
      };
    }

    run.status = 'CASHED_OUT';
    this.activeRuns.delete(playerId);

    const payout = run.currentPayout;
    const netProfit = Math.max(0, payout - run.betAmount);

    if (payout > 0) {
      this.playerManager.addChips(playerId, payout);
    }

    let repayments = [];
    if (netProfit > 0 && this.bankManager && typeof this.bankManager.processWinRepayment === 'function') {
      repayments = this.bankManager.processWinRepayment(playerId, netProfit) || [];
    }

    if (typeof this.playerManager.updatePlayerStats === 'function') {
      this.playerManager.updatePlayerStats(playerId, { wonAmount: netProfit });
    }
    this._persistPlayer(player);

    const completed = {
      runId: run.runId,
      playerId: run.playerId,
      playerName: player.name,
      playerColor: player.color || '#d4af37',
      betAmount: run.betAmount,
      outcome: opts.autoMaxCap ? 'MAX_CAP_CASHOUT' : 'CASHED_OUT',
      finalLane: run.currentLane,
      safeLanes: run.currentLane,
      multiplier: run.currentMultiplier,
      payout,
      netProfit,
      timestamp: Date.now()
    };

    this._recordPersonalHistory(playerId, completed);
    if (run.currentLane >= 2 || netProfit >= 250) {
      this.recentWins.unshift(completed);
      if (this.recentWins.length > RECENT_WINS_LIMIT) {
        this.recentWins.length = RECENT_WINS_LIMIT;
      }
    }

    if (!this._stopped && (netProfit >= BIG_WIN_MIN_PROFIT || run.currentLane >= BIG_WIN_MIN_LANE)) {
      this.emit('big_moment', {
        playerId: player.id,
        playerName: player.name,
        lane: run.currentLane,
        multiplier: run.currentMultiplier,
        payout,
        netProfit
      });
    }

    this._syncSalonEntry(playerId);
    this._emitSalonUpdate();

    const updated = this._ensurePlayer(playerId) || player;
    return {
      ok: true,
      cashedOut: true,
      autoMaxCap: Boolean(opts.autoMaxCap),
      lane: run.currentLane,
      multiplier: run.currentMultiplier,
      payout,
      netProfit,
      repayments,
      completedRun: completed,
      run: null,
      newChips: updated.chips,
      stats: updated.stats ? { ...updated.stats } : null,
      salon: this.getPublicState(playerId)
    };
  }

  /**
   * Returns complete synchronized public & personal state for Boulevard Cross.
   * @param {string|null} playerId
   * @returns {Object}
   */
  getPublicState(playerId = null) {
    const activeRun = playerId ? this._serializeRun(this.activeRuns.get(playerId) || null) : null;
    const myHistory = playerId && this.personalHistory.has(playerId)
      ? this.personalHistory.get(playerId).slice(0, HISTORY_LIMIT)
      : [];

    return {
      minBet: MIN_BET,
      maxBet: MAX_BET,
      targetRtp: TARGET_RTP,
      hitProbability: HIT_PROBABILITY,
      survivalProbability: SURVIVAL_PROBABILITY,
      defaultLadder: getCrossLadderPreview(100, 1, 8),
      activeRun,
      salonPlayers: this._serializeSalonPlayers(),
      recentWins: this.recentWins.slice(0, RECENT_WINS_LIMIT),
      myHistory
    };
  }
}

module.exports = CrossEngine;
module.exports.CrossEngine = CrossEngine;
