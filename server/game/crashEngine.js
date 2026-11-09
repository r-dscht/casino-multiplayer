/**
 * crashEngine.js
 * Server-authoritative Multiplayer Crash Game Engine.
 *
 * Features:
 * - Cryptographically fair crash point generation (crypto.randomInt) with 3% house edge (1.00x to 1000.00x).
 * - Synchronized real-time exponential flight trajectory: M(t) = exp(0.065 * t^1.18).
 * - Continuous 3-phase state machine: BETTING (8s) -> RUNNING (dynamic) -> CRASHED (4s).
 * - Live manual 1-click Cash Out + authoritative server-side Auto-Cashout.
 * - Full integration with PlayerManager (chips, stats) and BankManager (loan win-deduction repayments).
 * - Strict anti-cheat: crashPoint is never exposed in public state until CRASHED phase.
 * - Zero audio and zero unicode emojis.
 */

const EventEmitter = require('events');
const crypto = require('crypto');

const PHASES = {
  BETTING: 'BETTING',
  RUNNING: 'RUNNING',
  CRASHED: 'CRASHED'
};

const MIN_BET = 10;
const MAX_BET = 50000;
const MIN_AUTO_CASHOUT = 1.10;
const MAX_MULTIPLIER = 1000.00;
const GROWTH_K = 0.065;
const GROWTH_EXP = 1.18;

class CrashEngine extends EventEmitter {
  /**
   * @param {import('./playerManager')} playerManager
   * @param {Object} [options={}]
   * @param {import('./bankManager')} [options.bankManager=null]
   * @param {number} [options.bettingDuration=8]
   * @param {number} [options.crashedDuration=4]
   * @param {number} [options.tickIntervalMs=80]
   */
  constructor(playerManager, options = {}) {
    super();
    this.playerManager = playerManager;
    this.bankManager = options.bankManager || null;

    this.bettingDuration = options.bettingDuration || 8;
    this.crashedDuration = options.crashedDuration || 4;
    this.tickIntervalMs = options.tickIntervalMs || 80;

    this.currentPhase = PHASES.BETTING;
    this.timeLeft = this.bettingDuration;
    this.roundId = 1;

    // Flight state
    this.crashPoint = 1.00;
    this.crashElapsedMs = 0;
    this.currentMultiplier = 1.00;
    this.elapsedMs = 0;
    this.flightStartTime = 0;

    /**
     * Map<playerId, {
     *   playerId: string,
     *   playerName: string,
     *   playerColor: string,
     *   avatar: string,
     *   amount: number,
     *   autoCashout: number|null,
     *   cashedOut: boolean,
     *   cashoutMultiplier: number|null,
     *   cashoutElapsedMs: number|null,
     *   payout: number,
     *   profit: number,
     *   isAuto: boolean
     * }>
     */
    this.activeBets = new Map();

    // Seed initial history so the top strip looks rich on server boot
    this.history = [
      { roundId: 0, crashPoint: 2.14, timestamp: Date.now() - 180000 },
      { roundId: 0, crashPoint: 1.32, timestamp: Date.now() - 150000 },
      { roundId: 0, crashPoint: 5.80, timestamp: Date.now() - 120000 },
      { roundId: 0, crashPoint: 1.08, timestamp: Date.now() - 95000 },
      { roundId: 0, crashPoint: 14.65, timestamp: Date.now() - 70000 },
      { roundId: 0, crashPoint: 1.85, timestamp: Date.now() - 45000 },
      { roundId: 0, crashPoint: 3.42, timestamp: Date.now() - 25000 },
      { roundId: 0, crashPoint: 1.56, timestamp: Date.now() - 10000 }
    ];

    this.phaseTimer = null;
    this.flightTimer = null;
    this.isRunning = false;
  }

  /**
   * Computes the multiplier at a given elapsed flight time (ms).
   * Formula: M(t) = floor(exp(0.065 * (t/1000)^1.18) * 100) / 100
   * @param {number} elapsedMs
   * @returns {number}
   */
  static computeMultiplierAtElapsedMs(elapsedMs) {
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 1.00;
    const tSec = elapsedMs / 1000;
    const raw = Math.exp(GROWTH_K * Math.pow(tSec, GROWTH_EXP));
    const clamped = Math.min(MAX_MULTIPLIER, Math.max(1.00, raw));
    return Math.floor(clamped * 100) / 100;
  }

  /**
   * Inverse of computeMultiplierAtElapsedMs: returns exact ms when curve reaches targetMultiplier.
   * @param {number} targetMultiplier
   * @returns {number}
   */
  static computeElapsedMsForMultiplier(targetMultiplier) {
    if (!Number.isFinite(targetMultiplier) || targetMultiplier <= 1.00) return 0;
    const clamped = Math.min(MAX_MULTIPLIER, Math.max(1.00, targetMultiplier));
    const tSec = Math.pow(Math.log(clamped) / GROWTH_K, 1 / GROWTH_EXP);
    return Math.max(0, Math.round(tSec * 1000));
  }

  /**
   * Generates a cryptographically fair crash multiplier with a 3% house edge (0.97 RTP).
   * - 3% chance of instant crash at 1.00x
   * - Otherwise M = floor((0.97 / (1 - u)) * 100) / 100, capped at 1000.00x
   * @returns {number}
   */
  generateCrashPoint() {
    const randInt = crypto.randomInt(0, 1000000);
    const u = randInt / 1000000;
    if (u < 0.03) {
      return 1.00;
    }
    const raw = 0.97 / (1 - u);
    const mult = Math.floor(raw * 100) / 100;
    return Math.min(MAX_MULTIPLIER, Math.max(1.01, mult));
  }

  /**
   * Starts the continuous Crash game loop.
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.startBettingPhase();
  }

  /**
   * Stops all active timers.
   */
  stop() {
    this.isRunning = false;
    if (this.phaseTimer) {
      clearInterval(this.phaseTimer);
      this.phaseTimer = null;
    }
    if (this.flightTimer) {
      clearInterval(this.flightTimer);
      this.flightTimer = null;
    }
  }

  /**
   * Transitions to BETTING phase.
   */
  startBettingPhase() {
    if (this.phaseTimer) clearInterval(this.phaseTimer);
    if (this.flightTimer) clearInterval(this.flightTimer);

    this.roundId += 1;
    this.currentPhase = PHASES.BETTING;
    this.timeLeft = this.bettingDuration;
    this.currentMultiplier = 1.00;
    this.elapsedMs = 0;
    this.activeBets.clear();

    this.emit('phase_change', {
      phase: PHASES.BETTING,
      roundId: this.roundId,
      duration: this.bettingDuration,
      timeLeft: this.timeLeft,
      currentMultiplier: 1.00,
      history: this.history,
      bets: []
    });

    if (!this.isRunning) return;

    this.phaseTimer = setInterval(() => {
      this.timeLeft = Math.max(0, this.timeLeft - 1);
      this.emit('phase_tick', {
        phase: PHASES.BETTING,
        roundId: this.roundId,
        timeLeft: this.timeLeft
      });

      if (this.timeLeft <= 0) {
        clearInterval(this.phaseTimer);
        this.phaseTimer = null;
        this.startRunningPhase();
      }
    }, 1000);
  }

  /**
   * Transitions to RUNNING (in-flight) phase.
   * @param {number} [forcedCrashPoint] Optional override for unit testing
   */
  startRunningPhase(forcedCrashPoint = null) {
    if (this.phaseTimer) {
      clearInterval(this.phaseTimer);
      this.phaseTimer = null;
    }
    if (this.flightTimer) {
      clearInterval(this.flightTimer);
      this.flightTimer = null;
    }

    this.currentPhase = PHASES.RUNNING;
    this.crashPoint = (typeof forcedCrashPoint === 'number' && forcedCrashPoint >= 1.00)
      ? Math.min(MAX_MULTIPLIER, Math.floor(forcedCrashPoint * 100) / 100)
      : this.generateCrashPoint();
    this.crashElapsedMs = CrashEngine.computeElapsedMsForMultiplier(this.crashPoint);
    this.currentMultiplier = 1.00;
    this.elapsedMs = 0;
    this.flightStartTime = Date.now();

    this.emit('phase_change', {
      phase: PHASES.RUNNING,
      roundId: this.roundId,
      currentMultiplier: 1.00,
      elapsedMs: 0,
      bets: this.getPublicBetsList()
    });

    // Instant crash at 1.00x
    if (this.crashPoint <= 1.00) {
      this.triggerCrash();
      return;
    }

    if (!this.isRunning) return;

    this.flightTimer = setInterval(() => {
      this.stepFlight(Date.now() - this.flightStartTime);
    }, this.tickIntervalMs);
  }

  /**
   * Advances flight to the specified elapsed milliseconds, processing auto-cashouts and crash check.
   * @param {number} nowElapsedMs
   */
  stepFlight(nowElapsedMs) {
    if (this.currentPhase !== PHASES.RUNNING) return;

    const cappedElapsed = Math.min(nowElapsedMs, this.crashElapsedMs);
    const liveMult = CrashEngine.computeMultiplierAtElapsedMs(cappedElapsed);

    // 1. Process any server-side auto-cashouts whose target multiplier was reached before or at crashPoint
    for (const [playerId, bet] of this.activeBets.entries()) {
      if (!bet.cashedOut && bet.autoCashout && bet.autoCashout <= this.crashPoint) {
        if (liveMult >= bet.autoCashout || nowElapsedMs >= this.crashElapsedMs) {
          this._executeCashOut(playerId, bet.autoCashout, true);
        }
      }
    }

    // 2. Check if flight has reached crashPoint
    if (nowElapsedMs >= this.crashElapsedMs || liveMult >= this.crashPoint) {
      this.currentMultiplier = this.crashPoint;
      this.elapsedMs = this.crashElapsedMs;
      this.triggerCrash();
      return;
    }

    this.elapsedMs = nowElapsedMs;
    this.currentMultiplier = liveMult;

    this.emit('tick', {
      roundId: this.roundId,
      phase: PHASES.RUNNING,
      currentMultiplier: this.currentMultiplier,
      elapsedMs: this.elapsedMs
    });
  }

  /**
   * Ends the flight at crashPoint, settles un-cashed bets as losses, and starts cooldown before next round.
   */
  triggerCrash() {
    if (this.flightTimer) {
      clearInterval(this.flightTimer);
      this.flightTimer = null;
    }
    if (this.phaseTimer) {
      clearInterval(this.phaseTimer);
      this.phaseTimer = null;
    }

    this.currentPhase = PHASES.CRASHED;
    this.currentMultiplier = this.crashPoint;
    this.elapsedMs = this.crashElapsedMs;
    this.timeLeft = this.crashedDuration;

    // Record losses for players who did not cash out
    for (const [playerId, bet] of this.activeBets.entries()) {
      if (!bet.cashedOut) {
        bet.payout = 0;
        bet.profit = -bet.amount;
        this.playerManager.updatePlayerStats(playerId, { wonAmount: 0 });
      }
    }

    // Push to history (max 15 entries, newest first)
    this.history.unshift({
      roundId: this.roundId,
      crashPoint: this.crashPoint,
      timestamp: Date.now()
    });
    if (this.history.length > 15) {
      this.history.pop();
    }

    const publicBets = this.getPublicBetsList();

    this.emit('round_crashed', {
      roundId: this.roundId,
      phase: PHASES.CRASHED,
      crashPoint: this.crashPoint,
      elapsedMs: this.crashElapsedMs,
      duration: this.crashedDuration,
      timeLeft: this.timeLeft,
      history: this.history,
      bets: publicBets
    });

    this.emit('phase_change', {
      phase: PHASES.CRASHED,
      roundId: this.roundId,
      crashPoint: this.crashPoint,
      elapsedMs: this.crashElapsedMs,
      duration: this.crashedDuration,
      timeLeft: this.timeLeft,
      history: this.history,
      bets: publicBets
    });

    if (!this.isRunning) return;

    this.phaseTimer = setInterval(() => {
      this.timeLeft = Math.max(0, this.timeLeft - 1);
      this.emit('phase_tick', {
        phase: PHASES.CRASHED,
        roundId: this.roundId,
        timeLeft: this.timeLeft,
        crashPoint: this.crashPoint
      });

      if (this.timeLeft <= 0) {
        clearInterval(this.phaseTimer);
        this.phaseTimer = null;
        this.startBettingPhase();
      }
    }, 1000);
  }

  /**
   * Places or increases a player's bet during BETTING phase.
   * @param {string} playerId
   * @param {{ amount: number, autoCashout?: number|null }} payload
   * @returns {{ success: boolean, code?: string, reason?: string, bet?: Object, remainingChips?: number }}
   */
  placeBet(playerId, payload = {}) {
    if (this.currentPhase !== PHASES.BETTING) {
      return {
        success: false,
        code: 'BETTING_CLOSED',
        reason: 'Inzetten kan alleen tijdens de inzetfase voor de lancering.'
      };
    }

    const player = this.playerManager.getPlayerById(playerId);
    if (!player) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        reason: 'Speler niet gevonden.'
      };
    }

    const rawAmount = Number(payload.amount);
    if (!Number.isInteger(rawAmount) || rawAmount < MIN_BET) {
      return {
        success: false,
        code: 'MIN_BET',
        reason: `Minimale inzet is ${MIN_BET} fiches.`
      };
    }

    const existingBet = this.activeBets.get(playerId);
    const currentTotal = existingBet ? existingBet.amount : 0;
    if (currentTotal + rawAmount > MAX_BET) {
      return {
        success: false,
        code: 'MAX_BET',
        reason: `Maximale inzet per ronde is ${MAX_BET.toLocaleString()} fiches.`
      };
    }

    // Validate optional autoCashout
    let autoCashout = null;
    if (payload.autoCashout !== undefined && payload.autoCashout !== null && payload.autoCashout !== '' && payload.autoCashout !== false) {
      const parsedAuto = Number(payload.autoCashout);
      if (!Number.isFinite(parsedAuto) || parsedAuto < MIN_AUTO_CASHOUT || parsedAuto > MAX_MULTIPLIER) {
        return {
          success: false,
          code: 'INVALID_AUTO_CASHOUT',
          reason: `Auto-Cashout moet tussen ${MIN_AUTO_CASHOUT.toFixed(2)}x en ${MAX_MULTIPLIER.toFixed(0)}x liggen.`
        };
      }
      autoCashout = Math.floor(parsedAuto * 100) / 100;
    }

    const deductRes = this.playerManager.deductChips(playerId, rawAmount);
    if (!deductRes.success) {
      return {
        success: false,
        code: 'INSUFFICIENT_CHIPS',
        reason: 'Onvoldoende fiches voor deze inzet.'
      };
    }

    const updatedBet = {
      playerId: player.id,
      playerName: player.name,
      playerColor: player.color || '#D4AF37',
      avatar: player.avatar || 'avatar_1',
      amount: currentTotal + rawAmount,
      autoCashout: autoCashout !== null ? autoCashout : (existingBet ? existingBet.autoCashout : null),
      cashedOut: false,
      cashoutMultiplier: null,
      cashoutElapsedMs: null,
      payout: 0,
      profit: 0,
      isAuto: false
    };

    this.activeBets.set(playerId, updatedBet);

    this.emit('bet_placed', {
      roundId: this.roundId,
      bet: { ...updatedBet },
      remainingChips: deductRes.chips,
      bets: this.getPublicBetsList(),
      totalPot: this.getTotalPot()
    });

    return {
      success: true,
      bet: { ...updatedBet },
      remainingChips: deductRes.chips,
      totalPot: this.getTotalPot()
    };
  }

  /**
   * Cancels and refunds a player's bet during BETTING phase.
   * @param {string} playerId
   * @returns {{ success: boolean, code?: string, reason?: string, refunded?: number, remainingChips?: number }}
   */
  cancelBet(playerId) {
    if (this.currentPhase !== PHASES.BETTING) {
      return {
        success: false,
        code: 'CANNOT_CANCEL_IN_FLIGHT',
        reason: 'Inzet kan niet meer worden geannuleerd zodra de ronde is gestart.'
      };
    }

    const existingBet = this.activeBets.get(playerId);
    if (!existingBet) {
      return {
        success: false,
        code: 'NO_ACTIVE_BET',
        reason: 'Geen actieve inzet gevonden om te annuleren.'
      };
    }

    const refundAmount = existingBet.amount;
    this.activeBets.delete(playerId);
    const addRes = this.playerManager.addChips(playerId, refundAmount);

    this.emit('bet_cancelled', {
      roundId: this.roundId,
      playerId,
      refunded: refundAmount,
      remainingChips: addRes.chips,
      bets: this.getPublicBetsList(),
      totalPot: this.getTotalPot()
    });

    return {
      success: true,
      refunded: refundAmount,
      remainingChips: addRes.chips,
      totalPot: this.getTotalPot()
    };
  }

  /**
   * Manual player cashout during RUNNING phase.
   * @param {string} playerId
   * @param {{ multiplier?: number }} [payload={}]
   * @returns {{ success: boolean, code?: string, reason?: string, cashoutMultiplier?: number, payout?: number, profit?: number, remainingChips?: number }}
   */
  cashOut(playerId, payload = {}) {
    if (this.currentPhase !== PHASES.RUNNING) {
      return {
        success: false,
        code: 'NOT_RUNNING',
        reason: 'Je kunt alleen uitcashen terwijl de multiplier stijgt.'
      };
    }

    const bet = this.activeBets.get(playerId);
    if (!bet) {
      return {
        success: false,
        code: 'NO_ACTIVE_BET',
        reason: 'Je hebt geen inzet in deze ronde.'
      };
    }

    if (bet.cashedOut) {
      return {
        success: false,
        code: 'ALREADY_CASHED_OUT',
        reason: 'Je hebt deze ronde al uitgecasht.'
      };
    }

    if (this.crashPoint <= 1.00) {
      return {
        success: false,
        code: 'ALREADY_CRASHED',
        reason: 'Te laat! De multiplier is net gecrasht.'
      };
    }

    // Calculate exact authoritative multiplier at this millisecond
    const nowElapsed = Math.max(0, Date.now() - this.flightStartTime);
    const liveMult = Math.max(this.currentMultiplier, CrashEngine.computeMultiplierAtElapsedMs(nowElapsed));

    // If client provided the multiplier visible when they pressed the button, use it if valid
    const clientMult = (payload && typeof payload.multiplier === 'number' && Number.isFinite(payload.multiplier))
      ? payload.multiplier
      : null;

    if (liveMult >= this.crashPoint && nowElapsed > this.crashElapsedMs + 350 && (!clientMult || clientMult >= this.crashPoint)) {
      return {
        success: false,
        code: 'ALREADY_CRASHED',
        reason: 'Te laat! De multiplier is net gecrasht.'
      };
    }

    const targetMult = (clientMult && clientMult >= 1.00 && clientMult < liveMult)
      ? Math.max(this.currentMultiplier, clientMult)
      : liveMult;

    const safeMult = Math.min(
      this.crashPoint,
      Math.max(1.01, Math.floor(targetMult * 100) / 100)
    );

    return this._executeCashOut(playerId, safeMult, false);
  }

  /**
   * Internal execution of cashout (shared by manual cashout and server auto-cashout).
   * @param {string} playerId
   * @param {number} cashoutMultiplier
   * @param {boolean} isAuto
   */
  _executeCashOut(playerId, cashoutMultiplier, isAuto = false) {
    const bet = this.activeBets.get(playerId);
    if (!bet || bet.cashedOut) {
      return { success: false, code: 'ALREADY_CASHED_OUT', reason: 'Al uitgecasht.' };
    }

    const finalMult = Math.floor(cashoutMultiplier * 100) / 100;
    const payout = Math.floor(bet.amount * finalMult);
    const profit = Math.max(0, payout - bet.amount);
    const cashoutElapsedMs = CrashEngine.computeElapsedMsForMultiplier(finalMult);

    bet.cashedOut = true;
    bet.cashoutMultiplier = finalMult;
    bet.cashoutElapsedMs = cashoutElapsedMs;
    bet.payout = payout;
    bet.profit = profit;
    bet.isAuto = !!isAuto;

    // 1. Credit full payout to player balance
    this.playerManager.addChips(playerId, payout);

    // 2. Process automatic loan repayment on net profit
    let repayments = [];
    if (this.bankManager && profit > 0 && typeof this.bankManager.processWinRepayment === 'function') {
      repayments = this.bankManager.processWinRepayment(playerId, profit) || [];
    }

    // 3. Update player career stats
    const updatedStats = this.playerManager.updatePlayerStats(playerId, { wonAmount: profit });
    const player = this.playerManager.getPlayerById(playerId);
    const finalChips = player ? player.chips : 0;

    const eventPayload = {
      roundId: this.roundId,
      playerId,
      playerName: bet.playerName,
      playerColor: bet.playerColor,
      avatar: bet.avatar,
      amount: bet.amount,
      cashoutMultiplier: finalMult,
      cashoutElapsedMs,
      payout,
      profit,
      isAuto: !!isAuto,
      remainingChips: finalChips,
      stats: updatedStats,
      repayments,
      bets: this.getPublicBetsList()
    };

    this.emit('player_cashed_out', eventPayload);

    return {
      success: true,
      ...eventPayload
    };
  }

  /**
   * Returns true if player has an unsettled bet that locks table navigation.
   * Once cashed out, navigation is immediately unlocked even if the round is still flying.
   * @param {string} playerId
   * @returns {boolean}
   */
  hasActiveBets(playerId) {
    const bet = this.activeBets.get(playerId);
    if (!bet) return false;
    if (this.currentPhase === PHASES.BETTING) return true;
    if (this.currentPhase === PHASES.RUNNING && !bet.cashedOut) return true;
    return false;
  }

  /**
   * Returns total unsettled bet amount for a player.
   * @param {string} playerId
   * @returns {number}
   */
  getActiveBetTotal(playerId) {
    if (!this.hasActiveBets(playerId)) return 0;
    const bet = this.activeBets.get(playerId);
    return bet ? bet.amount : 0;
  }

  /**
   * Returns sum of all bets in the current round.
   * @returns {number}
   */
  getTotalPot() {
    let sum = 0;
    for (const bet of this.activeBets.values()) {
      sum += bet.amount;
    }
    return sum;
  }

  /**
   * Returns public list of all bets in the current round, sorted by amount descending.
   * @returns {Array<Object>}
   */
  getPublicBetsList() {
    return Array.from(this.activeBets.values())
      .map(b => ({
        playerId: b.playerId,
        playerName: b.playerName,
        playerColor: b.playerColor,
        avatar: b.avatar,
        amount: b.amount,
        autoCashout: b.autoCashout,
        cashedOut: b.cashedOut,
        cashoutMultiplier: b.cashoutMultiplier,
        cashoutElapsedMs: b.cashoutElapsedMs,
        payout: b.payout,
        profit: b.profit,
        isAuto: b.isAuto
      }))
      .sort((a, b) => b.amount - a.amount);
  }

  /**
   * Returns complete public table state snapshot for clients joining or reconnecting.
   * Strictly omits crashPoint unless currentPhase === 'CRASHED'.
   * @returns {Object}
   */
  getTableState() {
    const isRunning = this.currentPhase === PHASES.RUNNING;
    const liveElapsed = isRunning ? Math.max(0, Date.now() - this.flightStartTime) : this.elapsedMs;
    const liveMult = isRunning
      ? Math.min(this.crashPoint, CrashEngine.computeMultiplierAtElapsedMs(liveElapsed))
      : this.currentMultiplier;

    return {
      roundId: this.roundId,
      phase: this.currentPhase,
      timeLeft: this.timeLeft,
      duration: this.currentPhase === PHASES.BETTING ? this.bettingDuration : this.crashedDuration,
      currentMultiplier: liveMult,
      elapsedMs: liveElapsed,
      crashPoint: this.currentPhase === PHASES.CRASHED ? this.crashPoint : null,
      history: this.history,
      bets: this.getPublicBetsList(),
      totalPot: this.getTotalPot(),
      limits: {
        minBet: MIN_BET,
        maxBet: MAX_BET,
        minAutoCashout: MIN_AUTO_CASHOUT,
        maxMultiplier: MAX_MULTIPLIER
      }
    };
  }
}

module.exports = CrashEngine;
module.exports.PHASES = PHASES;
module.exports.MIN_BET = MIN_BET;
module.exports.MAX_BET = MAX_BET;
module.exports.MAX_MULTIPLIER = MAX_MULTIPLIER;
