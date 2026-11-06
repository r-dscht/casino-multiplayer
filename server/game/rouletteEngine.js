/**
 * rouletteEngine.js
 * Authoritative European Roulette state machine and round manager.
 * Lifecycle: BETTING (20s) -> SPINNING (9s) -> PAYOUT (6s).
 * Uses Node's cryptographic RNG for pocket selection.
 */

const crypto = require('crypto');
const EventEmitter = require('events');
const {
  PHASES,
  PHASE_DURATIONS,
  MAX_HISTORY,
  getColor
} = require('./rouletteConstants');
const { validateBet, evaluateBet } = require('./rouletteMath');

class RouletteEngine extends EventEmitter {
  /**
   * @param {import('./playerManager')} playerManager 
   * @param {Object} [options]
   * @param {import('./bankManager')} [options.bankManager]
   */
  constructor(playerManager, options = {}) {
    super();
    this.playerManager = playerManager;
    this.bankManager = (options && options.bankManager) ? options.bankManager : null;

    this.currentPhase = PHASES.BETTING;
    this.phaseDuration = PHASE_DURATIONS[PHASES.BETTING];
    this.timeLeft = this.phaseDuration;

    this.winningNumber = null;
    this.winningColor = null;

    /** @type {Map<string, Array<Object>>} playerId -> Array of bets */
    this.bets = new Map();
    this.tableChipsTotal = 0;

    /** @type {number[]} Recent winning numbers (max 15) */
    this.history = [];

    this.timerInterval = null;
    this.isRunning = false;
  }

  /**
   * Starts the 1-second state machine loop.
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.timerInterval = setInterval(() => this.tick(), 1000);
  }

  /**
   * Stops the state machine loop cleanly (used in tests and graceful shutdown).
   */
  stop() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.isRunning = false;
  }

  /**
   * Internal 1-second clock tick.
   */
  tick() {
    this.timeLeft--;

    this.emit('tick', {
      phase: this.currentPhase,
      timeLeft: Math.max(0, this.timeLeft),
      serverTime: Date.now()
    });

    if (this.timeLeft <= 0) {
      this.handlePhaseTransition();
    }
  }

  /**
   * Handles transition to the next phase in the cycle.
   */
  handlePhaseTransition() {
    switch (this.currentPhase) {
      case PHASES.BETTING:
        this.transitionToSpinning();
        break;
      case PHASES.SPINNING:
        this.transitionToPayout();
        break;
      case PHASES.PAYOUT:
        this.transitionToBetting();
        break;
      default:
        this.transitionToBetting();
    }
  }

  /**
   * Transitions from BETTING to SPINNING.
   * Cryptographically generates winning number in [0..36].
   */
  transitionToSpinning() {
    this.currentPhase = PHASES.SPINNING;
    this.phaseDuration = PHASE_DURATIONS[PHASES.SPINNING];
    this.timeLeft = this.phaseDuration;

    // Cryptographic RNG: randomInt(0, 37) yields an integer from 0 to 36 inclusive
    this.winningNumber = crypto.randomInt(0, 37);
    this.winningColor = getColor(this.winningNumber);

    this.emit('phase_change', {
      phase: this.currentPhase,
      duration: this.phaseDuration,
      timeLeft: this.timeLeft,
      winningNumber: this.winningNumber,
      winningColor: this.winningColor,
      serverTime: Date.now()
    });
  }

  /**
   * Transitions from SPINNING to PAYOUT.
   * Resolves all active bets and credits winnings atomically.
   */
  transitionToPayout() {
    this.currentPhase = PHASES.PAYOUT;
    this.phaseDuration = PHASE_DURATIONS[PHASES.PAYOUT];
    this.timeLeft = this.phaseDuration;

    const results = [];

    // Evaluate all bets across players (including players who may have disconnected)
    for (const [playerId, playerBets] of this.bets.entries()) {
      const player = this.playerManager.getPlayerById(playerId);
      const playerName = player ? player.name : `Player_${playerId.slice(0, 4)}`;

      let totalBet = 0;
      let totalWon = 0;
      const winningBets = [];

      for (const bet of playerBets) {
        totalBet += bet.amount;
        const evaluation = evaluateBet(bet, this.winningNumber);
        if (evaluation.won) {
          totalWon += evaluation.payout;
          winningBets.push({
            id: bet.id,
            type: bet.type,
            value: bet.value,
            amount: bet.amount,
            won: evaluation.payout,
            profit: evaluation.profit
          });
        }
      }

      const net = totalWon - totalBet;

      // Credit payout to player if they won anything
      if (totalWon > 0) {
        this.playerManager.addChips(playerId, totalWon);
      }

      // Deduct loan repayments from net profit if player has active debts
      let repayments = [];
      if (net > 0 && this.bankManager && typeof this.bankManager.processWinRepayment === 'function') {
        repayments = this.bankManager.processWinRepayment(playerId, net);
      }

      const currentChips = player ? player.chips : 0;

      results.push({
        playerId,
        playerName,
        totalBet,
        totalWon,
        net,
        chips: currentChips,
        winningBets,
        repayments
      });
    }

    // Prepend winning number to history
    this.history.unshift(this.winningNumber);
    if (this.history.length > MAX_HISTORY) {
      this.history.pop();
    }

    const payload = {
      winningNumber: this.winningNumber,
      winningColor: this.winningColor,
      results,
      history: [...this.history],
      serverTime: Date.now()
    };

    this.emit('phase_change', {
      phase: this.currentPhase,
      duration: this.phaseDuration,
      timeLeft: this.timeLeft,
      winningNumber: this.winningNumber,
      winningColor: this.winningColor,
      serverTime: Date.now()
    });

    this.emit('round_result', payload);
  }

  /**
   * Transitions from PAYOUT to BETTING.
   * Clears table bets and starts new countdown.
   */
  transitionToBetting() {
    this.currentPhase = PHASES.BETTING;
    this.phaseDuration = PHASE_DURATIONS[PHASES.BETTING];
    this.timeLeft = this.phaseDuration;

    this.bets.clear();
    this.tableChipsTotal = 0;
    this.winningNumber = null;
    this.winningColor = null;

    this.emit('phase_change', {
      phase: this.currentPhase,
      duration: this.phaseDuration,
      timeLeft: this.timeLeft,
      serverTime: Date.now()
    });
  }

  /**
   * Places a bet for a player during the BETTING phase.
   * @param {string} playerId 
   * @param {{ type: string, value: any, amount: number }} rawBet 
   * @returns {{ success: boolean, code?: string, reason?: string, bet?: Object, remainingChips?: number, tableChipsTotal?: number }}
   */
  placeBet(playerId, rawBet) {
    if (!rawBet || typeof rawBet !== 'object') {
      return {
        success: false,
        code: 'INVALID_PAYLOAD',
        reason: 'Invalid bet payload'
      };
    }

    if (this.currentPhase !== PHASES.BETTING) {
      return {
        success: false,
        code: 'BETS_CLOSED',
        reason: 'Betting is closed for this round'
      };
    }

    const player = this.playerManager.getPlayerById(playerId);
    if (!player) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        reason: 'Player profile not found'
      };
    }

    const { type, value, amount } = rawBet;
    const validation = validateBet(type, value, amount, player.chips);
    if (!validation.valid) {
      return {
        success: false,
        code: validation.code,
        reason: validation.reason
      };
    }

    // Atomically deduct chips
    const deduction = this.playerManager.deductChips(playerId, amount);
    if (!deduction.success) {
      return {
        success: false,
        code: 'INSUFFICIENT_FUNDS',
        reason: deduction.reason || 'Insufficient chip balance'
      };
    }

    const betId = `bet_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const bet = {
      id: betId,
      type,
      value: validation.normalizedValue !== undefined ? validation.normalizedValue : value,
      amount,
      timestamp: Date.now()
    };

    if (!this.bets.has(playerId)) {
      this.bets.set(playerId, []);
    }
    this.bets.get(playerId).push(bet);
    this.tableChipsTotal += amount;

    return {
      success: true,
      bet,
      remainingChips: deduction.chips,
      tableChipsTotal: this.tableChipsTotal
    };
  }

  /**
   * Clears all bets placed by a player in the current BETTING phase and refunds chips.
   * @param {string} playerId 
   * @returns {{ success: boolean, code?: string, reason?: string, refundedAmount?: number, chips?: number, tableChipsTotal?: number }}
   */
  clearBets(playerId) {
    if (this.currentPhase !== PHASES.BETTING) {
      return {
        success: false,
        code: 'BETS_CLOSED',
        reason: 'Cannot clear bets once wheel is spinning'
      };
    }

    const playerBets = this.bets.get(playerId) || [];
    let refundedAmount = 0;
    for (const b of playerBets) {
      refundedAmount += b.amount;
    }

    if (refundedAmount > 0) {
      this.playerManager.addChips(playerId, refundedAmount);
      this.tableChipsTotal -= refundedAmount;
    }
    this.bets.delete(playerId);

    const player = this.playerManager.getPlayerById(playerId);
    const chips = player ? player.chips : 0;

    return {
      success: true,
      refundedAmount,
      chips,
      tableChipsTotal: this.tableChipsTotal
    };
  }

  /**
   * Admin shortcut to immediately trigger spin.
   */
  forceSpin() {
    if (this.currentPhase === PHASES.BETTING) {
      this.transitionToSpinning();
      return true;
    }
    return false;
  }

  /**
   * Returns current full table state snapshot.
   * @param {string} [forPlayerId] 
   * @returns {Object}
   */
  getTableState(forPlayerId) {
    // Format bets map to object
    const activeBets = {};
    for (const [pid, playerBets] of this.bets.entries()) {
      activeBets[pid] = playerBets;
    }

    return {
      playerId: forPlayerId || null,
      players: this.playerManager.getConnectedPlayers(),
      currentPhase: this.currentPhase,
      timeLeft: Math.max(0, this.timeLeft),
      phaseDuration: this.phaseDuration,
      winningNumber: this.winningNumber,
      winningColor: this.winningColor,
      serverTime: Date.now(),
      recentHistory: [...this.history],
      activeBets,
      tableChipsTotal: this.tableChipsTotal
    };
  }
}

module.exports = RouletteEngine;
