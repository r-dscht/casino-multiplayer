/**
 * pokerEngine.js
 * Authoritative 6-Seat No-Limit Texas Hold'em State Machine.
 * Monte Carlo Luxury Casino: Full NL Hold'em rules, Dealer Button rotation,
 * Heads-Up rules, Delta-Raise enforcement, 15s Turn Timers with Anti-Stall,
 * Hole Card Security Masking, Side Pot Integration, and Navigation Bet Lock.
 */

const EventEmitter = require('events');
const crypto = require('crypto');
const PokerDeck = require('./pokerDeck');
const {
  NUM_SEATS,
  MAX_SEATS,
  DEFAULT_STAKES,
  TABLE_PRESETS,
  PHASES,
  PHASE_DURATIONS,
  ACTIONS,
  SEAT_STATUS
} = require('./pokerConstants');
const { evaluate7CardHand, compareHands } = require('./pokerRules');
const { PokerPotManager } = require('./pokerPotManager');

class PokerEngine extends EventEmitter {
  /**
   * @param {Object} [playerManager] Persistent player account manager.
   * @param {Object} [options]
   * @param {string} [options.tableId='poker_1']
   * @param {string} [options.tableName='Monte Carlo Grand Poker 1']
   * @param {number} [options.maxSeats=6]
   * @param {number} [options.smallBlind=50]
   * @param {number} [options.bigBlind=100]
   * @param {number} [options.minBuyIn=2000]
   * @param {number} [options.maxBuyIn=10000]
   * @param {Object} [options.bankManager]
   */
  constructor(playerManager = null, options = {}) {
    super();
    this.playerManager = playerManager;
    this.bankManager = options.bankManager || null;
    this.tableId = options.tableId || 'poker_1';
    this.tableName = options.tableName || 'Monte Carlo Grand Poker 1';
    this.maxSeats = options.maxSeats || MAX_SEATS || NUM_SEATS || 6;

    // Stakes
    this.smallBlindAmount = options.smallBlind || DEFAULT_STAKES.SMALL_BLIND;
    this.bigBlindAmount = options.bigBlind || DEFAULT_STAKES.BIG_BLIND;
    this.minBuyIn = options.minBuyIn || this.bigBlindAmount * 20;
    this.maxBuyIn = options.maxBuyIn || this.bigBlindAmount * 100;
    this.defaultBuyIn = options.defaultBuyIn || DEFAULT_STAKES.DEFAULT_BUY_IN || this.minBuyIn;

    // Game components
    this.deck = new PokerDeck();
    this.potManager = new PokerPotManager(this.maxSeats);

    // State machine properties
    this.currentPhase = PHASES.WAITING_FOR_PLAYERS;
    this.autoStart = options.autoStart === true;
    this.nextHandTimeout = null;
    this.handId = 0;
    this.dealerButtonSeat = -1;
    this.smallBlindSeat = -1;
    this.bigBlindSeat = -1;

    // Round betting properties
    this.currentBet = 0;
    this.lastRaiseDelta = this.bigBlindAmount;
    this.minRaise = this.bigBlindAmount;
    this.lastBettorSeat = -1;

    /** @type {Array<Object>} Community cards on board (max 5) */
    this.communityCards = [];

    /** @type {Array<Object>} 6 Physical seats */
    this.seats = [];
    this.initSeats();

    /** @type {{ seatIndex: number, playerId: string }|null} Active turn */
    this.activeTurn = null;
    this.turnTimeLeft = PHASE_DURATIONS.TURN_TIMEOUT;
    this.timerInterval = null;
    this.isRunning = false;

    /** @type {boolean} Flags if hand has transitioned to all-in runout */
    this.isAllInRunout = false;
    this.allInInterval = typeof options.allInInterval === 'number' ? options.allInInterval : 1000;
    this.allInTimeout = null;
  }

  /**
   * Initializes 6 physical seat structures.
   */
  initSeats() {
    this.seats = [];
    for (let i = 0; i < this.maxSeats; i++) {
      this.seats.push({
        seatIndex: i,
        player: null,
        stack: 0,
        currentHandBet: 0,
        totalCommittedThisHand: 0,
        pendingRebuy: 0,
        status: SEAT_STATUS.EMPTY,
        cards: [],
        folded: false,
        isAllIn: false,
        hasActedThisRound: false,
        showdownRevealed: false
      });
    }
  }

  /**
   * Starts the 1-second ticker loop.
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.timerInterval = setInterval(() => this.tick(), 1000);
  }

  /**
   * Stops the 1-second ticker loop.
   */
  stop() {
    this.isRunning = false;
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.nextHandTimeout) {
      clearTimeout(this.nextHandTimeout);
      this.nextHandTimeout = null;
    }
    if (this.allInTimeout) {
      clearTimeout(this.allInTimeout);
      this.allInTimeout = null;
    }
  }

  /**
   * Main 1-second clock tick for active turn countdowns and phase delays.
   */
  tick() {
    if (this.activeTurn !== null && this.currentPhase !== PHASES.WAITING_FOR_PLAYERS && this.currentPhase !== PHASES.HAND_END) {
      this.turnTimeLeft--;
      this.emit('phase_tick', {
        tableId: this.tableId,
        phase: this.currentPhase,
        activeSeatIndex: this.activeTurn.seatIndex,
        turnTimeLeft: Math.max(0, this.turnTimeLeft)
      });

      if (this.turnTimeLeft <= 0) {
        this.autoAction(this.activeTurn.seatIndex);
      }
    }
  }

  /**
   * Anti-stall auto-action on turn timer expiration:
   * Auto-Checks if free (`toCall === 0`), else Auto-Folds.
   * @param {number} seatIndex
   */
  autoAction(seatIndex) {
    const seat = this.seats[seatIndex];
    if (!seat || !seat.player || !this.activeTurn || this.activeTurn.seatIndex !== seatIndex) {
      return;
    }

    const toCall = this.currentBet - seat.currentHandBet;
    if (toCall <= 0) {
      this.handleAction(seatIndex, seat.player.id, ACTIONS.CHECK, { auto: true });
    } else {
      this.handleAction(seatIndex, seat.player.id, ACTIONS.FOLD, { auto: true });
    }
  }

  // ==========================================
  // SEAT & CHIP MANAGEMENT
  // ==========================================

  /**
   * Takes an empty seat with a validated buy-in amount.
   * Deducts from playerManager bankroll atomically if available.
   * @param {number} seatIndex (0..5)
   * @param {string} playerId
   * @param {number} [buyInAmount] Defaults to table default buy-in (50 BB)
   * @param {Object} [playerInfo]
   * @returns {{ success: boolean, code?: string, reason?: string, stack?: number }}
   */
  takeSeat(seatIndex, playerId, buyInAmount = this.defaultBuyIn, playerInfo = {}) {
    if (seatIndex < 0 || seatIndex >= this.maxSeats) {
      return { success: false, code: 'INVALID_SEAT', reason: 'Seat index out of bounds' };
    }

    const seat = this.seats[seatIndex];
    if (seat.player !== null) {
      return { success: false, code: 'SEAT_OCCUPIED', reason: 'Seat is already occupied' };
    }

    // Check if player already seated elsewhere at this table
    const existing = this.seats.find(s => s.player && s.player.id === playerId);
    if (existing) {
      return { success: false, code: 'ALREADY_SEATED', reason: 'Player already has a seat at this table' };
    }

    // Validate buy-in amount bounds
    const buyIn = parseInt(buyInAmount, 10);
    if (isNaN(buyIn) || buyIn < this.minBuyIn || buyIn > this.maxBuyIn) {
      return {
        success: false,
        code: 'INVALID_BUY_IN',
        reason: `Buy-in must be between ${this.minBuyIn} and ${this.maxBuyIn} chips`
      };
    }

    // If playerManager is attached, verify and deduct bankroll
    if (this.playerManager) {
      const deductRes = this.playerManager.deductChips(playerId, buyIn);
      if (!deductRes.success) {
        return { success: false, code: 'INSUFFICIENT_FUNDS', reason: deductRes.reason || 'Insufficient casino balance' };
      }
    }

    // Assign seat
    seat.player = {
      id: playerId,
      name: playerInfo.name || `Player_${playerId.slice(0, 4)}`,
      avatar: playerInfo.avatar || 'av_1',
      color: playerInfo.color || '#10b981',
      socketId: playerInfo.socketId || null,
      connected: true
    };
    seat.stack = buyIn;
    seat.status = SEAT_STATUS.SEATED;
    seat.pendingRebuy = 0;
    seat.currentHandBet = 0;
    seat.totalCommittedThisHand = 0;
    seat.folded = false;
    seat.isAllIn = false;
    seat.hasActedThisRound = false;
    seat.cards = [];

    this.emit('seat_taken', {
      tableId: this.tableId,
      seatIndex,
      player: seat.player,
      stack: buyIn
    });

    // Check if we should start a hand
    if (this.autoStart && this.currentPhase === PHASES.WAITING_FOR_PLAYERS && this.getActiveSeatedCount() >= 2) {
      this.startNewHand();
    }

    return { success: true, seatIndex, stack: buyIn };
  }

  /**
   * Leaves seat and cashes out remaining table stack to persistent bankroll.
   * @param {number} seatIndex
   * @param {string} playerId
   * @returns {{ success: boolean, code?: string, reason?: string, cashoutAmount?: number }}
   */
  leaveSeat(seatIndex, playerId) {
    if (seatIndex < 0 || seatIndex >= this.maxSeats) {
      return { success: false, code: 'INVALID_SEAT', reason: 'Seat index out of range' };
    }

    const seat = this.seats[seatIndex];
    if (!seat.player || seat.player.id !== playerId) {
      return { success: false, code: 'NOT_SEAT_OWNER', reason: 'You do not own this seat' };
    }

    // Check Navigation Bet Lock
    if (this.hasActiveBets(playerId)) {
      // If player is in active hand, auto-fold their hand first; committed chips stay in pot
      if (!seat.folded && (this.currentPhase === PHASES.PRE_FLOP || this.currentPhase === PHASES.FLOP || this.currentPhase === PHASES.TURN || this.currentPhase === PHASES.RIVER)) {
        this.handleAction(seatIndex, playerId, ACTIONS.FOLD, { auto: true });
      }
    }

    const cashoutAmount = seat.stack + (seat.pendingRebuy || 0);
    seat.stack = 0;
    seat.pendingRebuy = 0;

    if (this.playerManager && cashoutAmount > 0) {
      this.playerManager.addChips(playerId, cashoutAmount);
    }

    seat.player = null;
    seat.status = SEAT_STATUS.EMPTY;
    seat.cards = [];
    seat.folded = false;
    seat.isAllIn = false;

    this.emit('seat_vacated', {
      tableId: this.tableId,
      seatIndex,
      playerId,
      cashoutAmount
    });

    // If fewer than 2 players remain, revert to WAITING_FOR_PLAYERS
    if (this.getActiveSeatedCount() < 2 && (this.currentPhase === PHASES.HAND_END || this.currentPhase === PHASES.WAITING_FOR_PLAYERS)) {
      this.currentPhase = PHASES.WAITING_FOR_PLAYERS;
      this.emit('phase_changed', { tableId: this.tableId, phase: this.currentPhase });
    }

    return { success: true, cashoutAmount };
  }

  /**
   * Rebuys or tops up chips up to maxBuyIn.
   * @param {number} seatIndex
   * @param {string} playerId
   * @param {number} amount
   * @returns {{ success: boolean, code?: string, reason?: string, stack?: number, pending?: boolean }}
   */
  rebuy(seatIndex, playerId, amount) {
    const seat = this.seats[seatIndex];
    if (!seat || !seat.player || seat.player.id !== playerId) {
      return { success: false, code: 'NOT_SEAT_OWNER', reason: 'Not seat owner' };
    }

    const rebuyAmount = parseInt(amount, 10);
    if (isNaN(rebuyAmount) || rebuyAmount <= 0) {
      return { success: false, code: 'INVALID_AMOUNT', reason: 'Rebuy amount must be positive' };
    }

    if (seat.stack + seat.pendingRebuy + rebuyAmount > this.maxBuyIn) {
      return {
        success: false,
        code: 'MAX_STACK_EXCEEDED',
        reason: `Total stack cannot exceed ${this.maxBuyIn} chips`
      };
    }

    if (this.playerManager) {
      const deductRes = this.playerManager.deductChips(playerId, rebuyAmount);
      if (!deductRes.success) {
        return { success: false, code: 'INSUFFICIENT_FUNDS', reason: deductRes.reason };
      }
    }

    if (this.currentPhase === PHASES.WAITING_FOR_PLAYERS || this.currentPhase === PHASES.HAND_END) {
      seat.stack += rebuyAmount;
      return { success: true, stack: seat.stack, pending: false };
    } else {
      seat.pendingRebuy += rebuyAmount;
      return { success: true, stack: seat.stack, pendingRebuy: seat.pendingRebuy, pending: true };
    }
  }

  /**
   * Synchronously cashes out all seated players back to persistent bankroll on server shutdown.
   */
  cashoutAllPlayersSync() {
    for (const seat of this.seats) {
      if (seat.player) {
        const cashout = seat.stack + (seat.pendingRebuy || 0);
        seat.stack = 0;
        seat.pendingRebuy = 0;
        if (this.playerManager && cashout > 0) {
          this.playerManager.addChips(seat.player.id, cashout);
        }
      }
    }
  }

  // ==========================================
  // NAVIGATION BET LOCK & PRESENCE
  // ==========================================

  /**
   * Returns true if the player is currently locked in an active poker hand.
   * @param {string} playerId
   * @returns {boolean}
   */
  hasActiveBets(playerId) {
    if (this.currentPhase === PHASES.WAITING_FOR_PLAYERS || this.currentPhase === PHASES.HAND_END) {
      return false;
    }
    const seat = this.seats.find(s => s.player && s.player.id === playerId);
    if (!seat) return false;

    // Locked if active in hand (not folded) or committed chips in current hand
    return (!seat.folded && seat.cards.length > 0) || seat.totalCommittedThisHand > 0;
  }

  /**
   * Total chips currently committed by player in this hand.
   * @param {string} playerId
   * @returns {number}
   */
  getActiveBetTotal(playerId) {
    const seat = this.seats.find(s => s.player && s.player.id === playerId);
    return seat ? seat.totalCommittedThisHand : 0;
  }

  // ==========================================
  // HAND LIFECYCLE & BLINDS
  // ==========================================

  /**
   * Count of seated players with chips >= BB (or chips > 0).
   * @returns {number}
   */
  getActiveSeatedCount() {
    return this.seats.filter(s => s.player !== null && s.stack > 0).length;
  }

  /**
   * Advances Dealer Button clockwise to next valid seated player.
   */
  advanceDealerButton() {
    const activeSeats = this.seats.filter(s => s.player !== null && s.stack > 0);
    if (activeSeats.length < 2) return;

    if (this.dealerButtonSeat === -1) {
      // First hand: pick first active seat or random
      this.dealerButtonSeat = activeSeats[0].seatIndex;
    } else {
      // Find next active seat clockwise
      let nextSeat = (this.dealerButtonSeat + 1) % this.maxSeats;
      while (true) {
        if (this.seats[nextSeat].player !== null && this.seats[nextSeat].stack > 0) {
          this.dealerButtonSeat = nextSeat;
          break;
        }
        nextSeat = (nextSeat + 1) % this.maxSeats;
      }
    }
  }

  /**
   * Starts a brand new No-Limit Hold'em hand.
   */
  startNewHand() {
    const activeSeats = this.seats.filter(s => s.player !== null && s.stack > 0);
    if (activeSeats.length < 2) {
      this.currentPhase = PHASES.WAITING_FOR_PLAYERS;
      this.activeTurn = null;
      this.emit('phase_changed', { tableId: this.tableId, phase: this.currentPhase });
      return;
    }

    this.handId++;
    this.currentPhase = PHASES.DEALING;
    this.deck.reset();
    this.potManager.reset();
    this.communityCards = [];
    this.isAllInRunout = false;
    if (this.allInTimeout) {
      clearTimeout(this.allInTimeout);
      this.allInTimeout = null;
    }

    // Reset hand state on all seats
    for (const seat of this.seats) {
      seat.currentHandBet = 0;
      seat.totalCommittedThisHand = 0;
      seat.folded = false;
      seat.isAllIn = false;
      seat.hasActedThisRound = false;
      seat.showdownRevealed = false;
      seat.cards = [];

      if (seat.player && seat.stack > 0) {
        seat.status = SEAT_STATUS.PLAYING;
        this.potManager.registerPlayer(seat.player.id, seat.seatIndex);
      } else if (seat.player) {
        seat.status = SEAT_STATUS.SITTING_OUT;
      } else {
        seat.status = SEAT_STATUS.EMPTY;
      }
    }

    this.advanceDealerButton();
    this.assignBlinds();
    this.postBlinds();
    this.dealHoleCards();

    this.currentPhase = PHASES.PRE_FLOP;
    this.setPreflopFirstTurn();

    this.emit('hand_started', {
      tableId: this.tableId,
      handId: this.handId,
      dealerSeat: this.dealerButtonSeat,
      sbSeat: this.smallBlindSeat,
      bbSeat: this.bigBlindSeat,
      blinds: { sb: this.smallBlindAmount, bb: this.bigBlindAmount }
    });

    this.emit('phase_changed', {
      tableId: this.tableId,
      phase: this.currentPhase,
      communityCards: this.communityCards,
      pot: this.potManager.getTotalPot()
    });

    this.emitTurnChanged();
  }

  /**
   * Determines SB and BB seats (handling Heads-Up vs Multi-Player rules).
   */
  assignBlinds() {
    const activeSeats = this.seats.filter(s => s.status === SEAT_STATUS.PLAYING);
    if (activeSeats.length === 2) {
      // HEADS-UP RULES:
      // Dealer Button posts Small Blind and acts first pre-flop, last post-flop.
      // Non-Dealer posts Big Blind.
      this.smallBlindSeat = this.dealerButtonSeat;
      const nonDealer = activeSeats.find(s => s.seatIndex !== this.dealerButtonSeat);
      this.bigBlindSeat = nonDealer ? nonDealer.seatIndex : (this.dealerButtonSeat + 1) % this.maxSeats;
    } else {
      // MULTI-PLAYER (3+ players):
      // SB = 1st active player clockwise from Button
      this.smallBlindSeat = this.findNextActiveSeat(this.dealerButtonSeat);
      // BB = 1st active player clockwise from SB
      this.bigBlindSeat = this.findNextActiveSeat(this.smallBlindSeat);
    }
  }

  /**
   * Posts SB and BB chip wagers to the pot.
   */
  postBlinds() {
    const sbSeat = this.seats[this.smallBlindSeat];
    const bbSeat = this.seats[this.bigBlindSeat];

    // Post SB
    const sbAmount = Math.min(sbSeat.stack, this.smallBlindAmount);
    sbSeat.stack -= sbAmount;
    sbSeat.currentHandBet = sbAmount;
    sbSeat.totalCommittedThisHand = sbAmount;
    this.potManager.recordContribution(sbSeat.player.id, sbAmount, sbSeat.seatIndex);
    if (sbSeat.stack === 0) {
      sbSeat.isAllIn = true;
      sbSeat.status = SEAT_STATUS.ALL_IN;
      this.potManager.setPlayerAllIn(sbSeat.player.id, true);
    }

    // Post BB
    const bbAmount = Math.min(bbSeat.stack, this.bigBlindAmount);
    bbSeat.stack -= bbAmount;
    bbSeat.currentHandBet = bbAmount;
    bbSeat.totalCommittedThisHand = bbAmount;
    this.potManager.recordContribution(bbSeat.player.id, bbAmount, bbSeat.seatIndex);
    if (bbSeat.stack === 0) {
      bbSeat.isAllIn = true;
      bbSeat.status = SEAT_STATUS.ALL_IN;
      this.potManager.setPlayerAllIn(bbSeat.player.id, true);
    }

    this.currentBet = Math.max(sbAmount, bbAmount);
    this.lastRaiseDelta = this.bigBlindAmount;
    this.minRaise = this.currentBet + this.lastRaiseDelta;
    this.lastBettorSeat = this.bigBlindSeat;
  }

  /**
   * Deals 2 private hole cards to each active player.
   */
  dealHoleCards() {
    const activeSeats = this.seats.filter(s => s.status === SEAT_STATUS.PLAYING || s.status === SEAT_STATUS.ALL_IN);
    for (const seat of activeSeats) {
      seat.cards = [this.deck.draw(), this.deck.draw()];
    }
  }

  /**
   * Assigns first turn pre-flop (UTG in multi-player, SB in heads-up).
   */
  setPreflopFirstTurn() {
    const activeSeats = this.seats.filter(s => s.status === SEAT_STATUS.PLAYING);
    if (activeSeats.length === 2) {
      // In Heads-up, Button (SB) acts first pre-flop
      const firstSeat = this.smallBlindSeat;
      if (this.seats[firstSeat].status === SEAT_STATUS.PLAYING && !this.seats[firstSeat].isAllIn) {
        this.activeTurn = { seatIndex: firstSeat, playerId: this.seats[firstSeat].player.id };
      } else {
        this.advanceTurn();
      }
    } else {
      // In 3+ players, UTG (clockwise from BB) acts first
      const utgSeat = this.findNextActiveSeat(this.bigBlindSeat);
      this.activeTurn = { seatIndex: utgSeat, playerId: this.seats[utgSeat].player.id };
    }
    this.turnTimeLeft = PHASE_DURATIONS.TURN_TIMEOUT;
  }

  /**
   * Finds the next active (unfolded, not all-in) seat clockwise from a given seat.
   * @param {number} fromSeat
   * @returns {number}
   */
  findNextActiveSeat(fromSeat) {
    let next = (fromSeat + 1) % this.maxSeats;
    for (let i = 0; i < this.maxSeats; i++) {
      const s = this.seats[next];
      if (s.player !== null && !s.folded && s.status === SEAT_STATUS.PLAYING) {
        return next;
      }
      next = (next + 1) % this.maxSeats;
    }
    return fromSeat;
  }

  /**
   * Emits turn_changed event to table and subscribers.
   */
  emitTurnChanged() {
    if (!this.activeTurn) return;
    const seat = this.seats[this.activeTurn.seatIndex];
    const toCall = this.currentBet - seat.currentHandBet;

    this.emit('turn_changed', {
      tableId: this.tableId,
      activeSeatIndex: this.activeTurn.seatIndex,
      playerId: this.activeTurn.playerId,
      canCheck: toCall === 0,
      callAmount: Math.max(0, toCall),
      minRaise: this.minRaise,
      turnTimeLeft: this.turnTimeLeft
    });
  }

  // ==========================================
  // ACTION VALIDATION & BETTING LOOP
  // ==========================================

  /**
   * Handles player action (fold, check, call, bet, raise, allin).
   * @param {number} seatIndex
   * @param {string} playerId
   * @param {string} action
   * @param {Object} [options]
   * @param {number} [options.amount]
   * @param {boolean} [options.auto=false]
   * @returns {{ success: boolean, code?: string, reason?: string }}
   */
  handleAction(seatIndex, playerId, action, options = {}) {
    if (this.currentPhase !== PHASES.PRE_FLOP && this.currentPhase !== PHASES.FLOP && this.currentPhase !== PHASES.TURN && this.currentPhase !== PHASES.RIVER) {
      return { success: false, code: 'NOT_IN_BETTING_PHASE', reason: 'Betting is closed in current phase' };
    }

    if (!this.activeTurn || this.activeTurn.seatIndex !== seatIndex) {
      return { success: false, code: 'OUT_OF_TURN', reason: 'Not your turn' };
    }

    const seat = this.seats[seatIndex];
    if (!seat || !seat.player || seat.player.id !== playerId) {
      return { success: false, code: 'INVALID_PLAYER', reason: 'Seat ownership mismatch' };
    }

    const act = (action || '').toLowerCase();
    const toCall = this.currentBet - seat.currentHandBet;

    switch (act) {
      case ACTIONS.FOLD: {
        seat.folded = true;
        seat.status = SEAT_STATUS.FOLDED;
        this.potManager.setPlayerFolded(playerId, true);

        this.emit('player_acted', {
          tableId: this.tableId,
          seatIndex,
          playerId,
          action: ACTIONS.FOLD,
          amount: 0,
          stack: seat.stack,
          currentBet: this.currentBet,
          auto: !!options.auto
        });

        // Check if only 1 active player remains
        if (this.checkImmediateWinOnFold()) {
          return { success: true };
        }
        break;
      }

      case ACTIONS.CHECK: {
        if (toCall > 0) {
          return { success: false, code: 'CANNOT_CHECK', reason: `Cannot check facing a bet of ${toCall}` };
        }
        seat.hasActedThisRound = true;

        this.emit('player_acted', {
          tableId: this.tableId,
          seatIndex,
          playerId,
          action: ACTIONS.CHECK,
          amount: 0,
          stack: seat.stack,
          currentBet: this.currentBet,
          auto: !!options.auto
        });
        break;
      }

      case ACTIONS.CALL: {
        const callAmount = Math.min(seat.stack, toCall);
        seat.stack -= callAmount;
        seat.currentHandBet += callAmount;
        seat.totalCommittedThisHand += callAmount;
        this.potManager.recordContribution(playerId, callAmount, seatIndex);

        if (seat.stack === 0) {
          seat.isAllIn = true;
          seat.status = SEAT_STATUS.ALL_IN;
          this.potManager.setPlayerAllIn(playerId, true);
        }
        seat.hasActedThisRound = true;

        this.emit('player_acted', {
          tableId: this.tableId,
          seatIndex,
          playerId,
          action: ACTIONS.CALL,
          amount: callAmount,
          stack: seat.stack,
          currentBet: this.currentBet,
          isAllIn: seat.isAllIn
        });
        break;
      }

      case ACTIONS.BET: {
        if (this.currentBet > 0) {
          return { success: false, code: 'CANNOT_BET', reason: 'Bet already made in this round. Use raise or call.' };
        }

        const betAmount = parseInt(options.amount, 10);
        if (isNaN(betAmount) || betAmount <= 0) {
          return { success: false, code: 'INVALID_AMOUNT', reason: 'Bet amount must be positive' };
        }

        // Min bet is BB, unless player stack < BB (in which case all-in)
        if (betAmount < this.bigBlindAmount && betAmount < seat.stack) {
          return {
            success: false,
            code: 'BET_TOO_SMALL',
            reason: `Minimum bet is ${this.bigBlindAmount}`
          };
        }

        if (betAmount > seat.stack) {
          return { success: false, code: 'INSUFFICIENT_STACK', reason: 'Cannot bet more than stack' };
        }

        seat.stack -= betAmount;
        seat.currentHandBet = betAmount;
        seat.totalCommittedThisHand += betAmount;
        this.potManager.recordContribution(playerId, betAmount, seatIndex);

        this.currentBet = betAmount;
        this.lastRaiseDelta = Math.max(this.bigBlindAmount, betAmount);
        this.minRaise = this.currentBet + this.lastRaiseDelta;
        this.lastBettorSeat = seatIndex;

        if (seat.stack === 0) {
          seat.isAllIn = true;
          seat.status = SEAT_STATUS.ALL_IN;
          this.potManager.setPlayerAllIn(playerId, true);
        }

        this.resetActedFlagsExcept(seatIndex);
        seat.hasActedThisRound = true;

        this.emit('player_acted', {
          tableId: this.tableId,
          seatIndex,
          playerId,
          action: ACTIONS.BET,
          amount: betAmount,
          stack: seat.stack,
          currentBet: this.currentBet,
          isAllIn: seat.isAllIn
        });
        break;
      }

      case ACTIONS.RAISE: {
        if (this.currentBet === 0) {
          // If no bet made yet, treat as bet
          return this.handleAction(seatIndex, playerId, ACTIONS.BET, options);
        }

        // Under-Raise Reopening Rule (TDA Rule 45 / WSOP Rule 94):
        // An under-raise does not reopen betting for players who already acted facing the prior bet/raise
        if (seat.hasActedThisRound === true) {
          return {
            success: false,
            code: 'CANNOT_RAISE',
            reason: 'Betting has not been reopened by a full raise'
          };
        }

        let targetRoundBet = parseInt(options.amount, 10);
        if (isNaN(targetRoundBet)) {
          return { success: false, code: 'INVALID_AMOUNT', reason: 'Raise amount must be specified' };
        }

        // Support both incremental raise amount and total round bet:
        // If amount <= currentBet and seat.currentHandBet + amount > currentBet, treat as increment
        if (targetRoundBet <= this.currentBet && seat.currentHandBet + targetRoundBet > this.currentBet) {
          targetRoundBet = seat.currentHandBet + targetRoundBet;
        }

        const maxPossibleBet = seat.currentHandBet + seat.stack;
        if (targetRoundBet > maxPossibleBet) {
          return { success: false, code: 'INSUFFICIENT_STACK', reason: 'Cannot raise above table stack' };
        }

        // Validate Full Minimum Raise Rule
        if (targetRoundBet < this.minRaise && targetRoundBet < maxPossibleBet) {
          return {
            success: false,
            code: 'RAISE_TOO_SMALL',
            reason: `Minimum raise is to ${this.minRaise} chips`
          };
        }

        const raiseDelta = targetRoundBet - this.currentBet;
        const chipsToAdd = targetRoundBet - seat.currentHandBet;

        seat.stack -= chipsToAdd;
        seat.currentHandBet = targetRoundBet;
        seat.totalCommittedThisHand += chipsToAdd;
        this.potManager.recordContribution(playerId, chipsToAdd, seatIndex);

        if (raiseDelta >= this.lastRaiseDelta) {
          // Full legal raise: reopens betting
          this.lastRaiseDelta = raiseDelta;
          this.lastBettorSeat = seatIndex;
          this.resetActedFlagsExcept(seatIndex);
        }

        this.minRaise = targetRoundBet + Math.max(this.bigBlindAmount, this.lastRaiseDelta);
        this.currentBet = targetRoundBet;

        if (seat.stack === 0) {
          seat.isAllIn = true;
          seat.status = SEAT_STATUS.ALL_IN;
          this.potManager.setPlayerAllIn(playerId, true);
        }
        seat.hasActedThisRound = true;

        this.emit('player_acted', {
          tableId: this.tableId,
          seatIndex,
          playerId,
          action: ACTIONS.RAISE,
          amount: targetRoundBet,
          stack: seat.stack,
          currentBet: this.currentBet,
          isAllIn: seat.isAllIn
        });
        break;
      }

      case ACTIONS.ALL_IN:
      case 'allin': {
        const allInChips = seat.stack;
        const targetBet = seat.currentHandBet + allInChips;

        seat.stack = 0;
        seat.currentHandBet = targetBet;
        seat.totalCommittedThisHand += allInChips;
        this.potManager.recordContribution(playerId, allInChips, seatIndex);

        seat.isAllIn = true;
        seat.status = SEAT_STATUS.ALL_IN;
        this.potManager.setPlayerAllIn(playerId, true);

        if (targetBet > this.currentBet) {
          const raiseDelta = targetBet - this.currentBet;
          if (raiseDelta >= this.lastRaiseDelta) {
            // Full raise
            this.lastRaiseDelta = raiseDelta;
            this.lastBettorSeat = seatIndex;
            this.resetActedFlagsExcept(seatIndex);
          }
          this.minRaise = targetBet + Math.max(this.bigBlindAmount, this.lastRaiseDelta);
          this.currentBet = targetBet;
        }

        seat.hasActedThisRound = true;

        this.emit('player_acted', {
          tableId: this.tableId,
          seatIndex,
          playerId,
          action: ACTIONS.ALL_IN,
          amount: targetBet,
          stack: 0,
          currentBet: this.currentBet,
          isAllIn: true
        });
        break;
      }

      default:
        return { success: false, code: 'UNKNOWN_ACTION', reason: `Unknown action "${action}"` };
    }

    this.advanceTurn();
    return { success: true };
  }

  /**
   * Resets hasActedThisRound flag for all other active (unfolded, not all-in) seats.
   * @param {number} exceptSeatIndex
   */
  resetActedFlagsExcept(exceptSeatIndex) {
    for (const seat of this.seats) {
      if (seat.seatIndex !== exceptSeatIndex && !seat.folded && !seat.isAllIn && seat.status === SEAT_STATUS.PLAYING) {
        seat.hasActedThisRound = false;
      }
    }
  }

  /**
   * Checks if all players except one have folded.
   * If true, awards entire pot immediately to survivor without showdown.
   * @returns {boolean}
   */
  checkImmediateWinOnFold() {
    const activeSeats = this.seats.filter(s => s.player !== null && !s.folded && (s.status === SEAT_STATUS.PLAYING || s.status === SEAT_STATUS.ALL_IN));
    if (activeSeats.length === 1) {
      const winner = activeSeats[0];
      this.currentPhase = PHASES.SETTLEMENT;
      this.activeTurn = null;

      const settlement = this.potManager.settleUncontested(winner.player.id);
      winner.stack += settlement.totalAwarded;

      this.emit('hand_ended', {
        tableId: this.tableId,
        handId: this.handId,
        uncontested: true,
        winners: [{ playerId: winner.player.id, seatIndex: winner.seatIndex, amount: settlement.totalAwarded }],
        pots: settlement.potSummaries,
        showdownHands: []
      });

      this.endHand();
      return true;
    }
    return false;
  }

  /**
   * Checks if the current betting round has finished.
   * @returns {boolean}
   */
  isRoundComplete() {
    const contenders = this.seats.filter(s => s.player !== null && !s.folded && (s.status === SEAT_STATUS.PLAYING || s.status === SEAT_STATUS.ALL_IN));
    if (contenders.length <= 1) return true;

    // Check non-allin contenders
    const activeContenders = contenders.filter(s => !s.isAllIn);
    if (activeContenders.length === 0) {
      // Everyone is all-in
      return true;
    }

    if (activeContenders.length === 1 && contenders.length > 1) {
      // 1 player with chips, everyone else all-in
      // If that 1 player has matched or exceeded currentBet, round is complete
      if (activeContenders[0].hasActedThisRound && activeContenders[0].currentHandBet >= this.currentBet) {
        return true;
      }
    }

    // Every active contender must have acted and matched currentBet
    return activeContenders.every(s => s.hasActedThisRound && s.currentHandBet === this.currentBet);
  }

  /**
   * Advances turn clockwise or concludes the betting round.
   */
  advanceTurn() {
    if (this.checkImmediateWinOnFold()) return;

    if (this.isRoundComplete()) {
      this.transitionToNextPhase();
      return;
    }

    // Find next seat clockwise that can act (unfolded and NOT all-in)
    const currentSeat = this.activeTurn ? this.activeTurn.seatIndex : this.dealerButtonSeat;
    let next = (currentSeat + 1) % this.maxSeats;
    let found = -1;

    for (let i = 0; i < this.maxSeats; i++) {
      const s = this.seats[next];
      if (s.player !== null && !s.folded && !s.isAllIn && s.status === SEAT_STATUS.PLAYING) {
        found = next;
        break;
      }
      next = (next + 1) % this.maxSeats;
    }

    if (found !== -1) {
      this.activeTurn = { seatIndex: found, playerId: this.seats[found].player.id };
      this.turnTimeLeft = PHASE_DURATIONS.TURN_TIMEOUT;
      this.emitTurnChanged();
    } else {
      // No more active players with chips -> round complete
      this.transitionToNextPhase();
    }
  }

  /**
   * Moves game from one street to the next (Flop, Turn, River, Showdown).
   */
  transitionToNextPhase() {
    this.activeTurn = null;

    // Reset round bets
    for (const seat of this.seats) {
      seat.currentHandBet = 0;
      seat.hasActedThisRound = false;
    }
    this.currentBet = 0;
    this.minRaise = this.bigBlindAmount;
    this.lastRaiseDelta = this.bigBlindAmount;
    this.lastBettorSeat = -1;

    // Check if everyone (or all but 1) is all-in -> runout remaining community cards
    const contenders = this.seats.filter(s => s.player !== null && !s.folded);
    const playersWithChips = contenders.filter(s => !s.isAllIn);
    const isAllInRunout = playersWithChips.length <= 1 && contenders.length >= 2;

    switch (this.currentPhase) {
      case PHASES.PRE_FLOP: {
        // Burn 1, Deal 3 Flop cards
        this.deck.burnCard();
        this.communityCards = this.deck.dealCommunityCards(3);
        this.currentPhase = PHASES.FLOP;
        break;
      }

      case PHASES.FLOP: {
        // Burn 1, Deal 1 Turn card
        this.deck.burnCard();
        this.communityCards.push(...this.deck.dealCommunityCards(1));
        this.currentPhase = PHASES.TURN;
        break;
      }

      case PHASES.TURN: {
        // Burn 1, Deal 1 River card
        this.deck.burnCard();
        this.communityCards.push(...this.deck.dealCommunityCards(1));
        this.currentPhase = PHASES.RIVER;
        break;
      }

      case PHASES.RIVER: {
        this.currentPhase = PHASES.SHOWDOWN;
        this.resolveShowdown();
        return;
      }

      default:
        return;
    }

    this.emit('phase_changed', {
      tableId: this.tableId,
      phase: this.currentPhase,
      communityCards: [...this.communityCards],
      pot: this.potManager.getTotalPot()
    });

    if (isAllInRunout) {
      // Pace all-in runout transitions so community cards deal with realistic street intervals
      if (this.allInTimeout) {
        clearTimeout(this.allInTimeout);
        this.allInTimeout = null;
      }
      if (this.allInInterval > 0) {
        this.allInTimeout = setTimeout(() => {
          this.transitionToNextPhase();
        }, this.allInInterval);
      } else {
        this.transitionToNextPhase();
      }
    } else {
      // Start betting round at first active player left of Dealer Button
      const firstSeat = this.findNextActiveSeat(this.dealerButtonSeat);
      const s = this.seats[firstSeat];
      if (s && !s.folded && !s.isAllIn && s.status === SEAT_STATUS.PLAYING) {
        this.activeTurn = { seatIndex: firstSeat, playerId: s.player.id };
        this.turnTimeLeft = PHASE_DURATIONS.TURN_TIMEOUT;
        this.emitTurnChanged();
      } else {
        this.transitionToNextPhase();
      }
    }
  }

  /**
   * Evaluates hands at Showdown, settles pots, and awards chip payouts.
   */
  resolveShowdown() {
    this.currentPhase = PHASES.SHOWDOWN;
    const contenders = this.seats.filter(s => s.player !== null && !s.folded);

    // Evaluate 7-card hands for all active showdown contenders
    const playerHands = contenders.map(seat => {
      seat.showdownRevealed = true;
      const hand = evaluate7CardHand(seat.cards, this.communityCards);
      return {
        playerId: seat.player.id,
        seatIndex: seat.seatIndex,
        hand
      };
    });

    // Settle with pot manager
    const settlement = this.potManager.settle(playerHands, this.dealerButtonSeat);

    // Credit payouts to seat stacks
    for (const payout of settlement.payouts) {
      const seat = this.seats[payout.seatIndex];
      if (seat) {
        seat.stack += payout.amount;
      }
    }

    // Credit refunds (uncalled bets) to seat stacks
    for (const refund of settlement.refunds) {
      const seat = this.seats[refund.seatIndex];
      if (seat) {
        seat.stack += refund.amount;
      }
    }

    const showdownHands = playerHands.map(ph => ({
      playerId: ph.playerId,
      seatIndex: ph.seatIndex,
      cards: this.seats[ph.seatIndex].cards,
      hand: ph.hand
    }));

    this.emit('hand_ended', {
      tableId: this.tableId,
      handId: this.handId,
      uncontested: false,
      winners: settlement.payouts,
      pots: settlement.potSummaries,
      showdownHands
    });

    this.endHand();
  }

  /**
   * Finalizes the hand: applies pending rebuys, handles offline seats, resets table.
   */
  endHand() {
    this.currentPhase = PHASES.HAND_END;
    this.activeTurn = null;

    // Apply any pending rebuys
    for (const seat of this.seats) {
      if (seat.pendingRebuy > 0) {
        seat.stack += seat.pendingRebuy;
        seat.pendingRebuy = 0;
      }
    }

    // Auto-cashout players who disconnected
    for (const seat of this.seats) {
      if (seat.player && !seat.player.connected) {
        const cashout = seat.stack;
        seat.stack = 0;
        if (this.playerManager && cashout > 0) {
          this.playerManager.addChips(seat.player.id, cashout);
        }
        seat.player = null;
        seat.status = SEAT_STATUS.EMPTY;
        seat.cards = [];
        this.emit('seat_vacated', { tableId: this.tableId, seatIndex: seat.seatIndex });
      }
    }

    // If fewer than 2 players remain, transition to WAITING_FOR_PLAYERS
    if (this.getActiveSeatedCount() < 2) {
      this.currentPhase = PHASES.WAITING_FOR_PLAYERS;
      this.emit('phase_changed', { tableId: this.tableId, phase: this.currentPhase });
    } else if (this.autoStart) {
      this.nextHandTimeout = setTimeout(() => {
        if (this.isRunning && this.getActiveSeatedCount() >= 2) {
          this.startNewHand();
        } else {
          this.currentPhase = PHASES.WAITING_FOR_PLAYERS;
          this.emit('phase_changed', { tableId: this.tableId, phase: this.currentPhase });
        }
      }, 3000);
    }
  }

  // ==========================================
  // SECURITY & CARD MASKING
  // ==========================================

  /**
   * Generates sanitized public table state with authoritative hole card masking.
   * Opponent cards are masked with [{ hidden: true }, { hidden: true }].
   * Private cards are revealed ONLY to the requesting seat owner (or at showdown).
   * @param {string|null} [forPlayerId=null] Requesting player's ID.
   * @returns {Object}
   */
  getTableState(forPlayerId = null) {
    const publicSeats = this.seats.map(seat => {
      let cards = [];
      if (seat.cards && seat.cards.length > 0) {
        if (this.currentPhase === PHASES.SHOWDOWN && seat.showdownRevealed) {
          // Revealed at showdown
          cards = seat.cards.map(c => ({ suit: c.suit, rank: c.rank, value: c.value, id: c.id }));
        } else if (forPlayerId && seat.player && seat.player.id === forPlayerId) {
          // Requesting player's own private hole cards
          cards = seat.cards.map(c => ({ suit: c.suit, rank: c.rank, value: c.value, id: c.id }));
        } else {
          // Strictly masked for all opponents and observers
          cards = seat.cards.map(() => ({ hidden: true }));
        }
      }

      return {
        seatIndex: seat.seatIndex,
        player: seat.player ? { ...seat.player } : null,
        stack: seat.stack,
        currentBet: seat.currentHandBet,
        status: seat.status,
        folded: seat.folded,
        isAllIn: seat.isAllIn,
        hasCards: seat.cards.length > 0,
        cards
      };
    });

    return {
      tableId: this.tableId,
      tableName: this.tableName,
      maxSeats: this.maxSeats,
      currentPhase: this.currentPhase,
      handId: this.handId,
      dealerButtonSeat: this.dealerButtonSeat,
      smallBlindSeat: this.smallBlindSeat,
      bigBlindSeat: this.bigBlindSeat,
      smallBlindAmount: this.smallBlindAmount,
      bigBlindAmount: this.bigBlindAmount,
      minBuyIn: this.minBuyIn,
      maxBuyIn: this.maxBuyIn,
      defaultBuyIn: this.defaultBuyIn,
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      pot: this.potManager.getTotalPot(),
      mainPot: this.potManager.getMainPot(),
      sidePots: this.potManager.getSidePots(),
      communityCards: [...this.communityCards],
      activeTurn: this.activeTurn ? { ...this.activeTurn } : null,
      turnTimeLeft: Math.max(0, this.turnTimeLeft),
      seats: publicSeats,
      serverTime: Date.now()
    };
  }

  /**
   * Retrieves private hole cards for a specific player ID.
   * @param {string} playerId
   * @returns {Array<Object>|null}
   */
  getHoleCards(playerId) {
    const seat = this.seats.find(s => s.player && s.player.id === playerId);
    return seat && seat.cards.length > 0 ? seat.cards : null;
  }
}

module.exports = PokerEngine;
