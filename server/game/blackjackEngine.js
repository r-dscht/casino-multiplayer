/**
 * blackjackEngine.js
 * Production-grade Authoritative Multiplayer Blackjack Engine.
 * 6 Seats per table (0 through 5), 6-Deck Cryptographic Shoe,
 * S17 Dealer AI, 15s Turn Timers with Anti-Stall Auto-Stand,
 * Hole Card Security Masking, Atomic Bankroll & P2P Loan Integration,
 * and Multi-Table Support (tableId).
 */

const EventEmitter = require('events');
const BlackjackDeck = require('./blackjackDeck');
const {
  NUM_SEATS,
  MAX_SEATS,
  MIN_BET,
  MAX_BET,
  PHASES,
  PHASE_DURATIONS,
  HAND_STATUS,
  SEAT_STATUS,
  ACTIONS
} = require('./blackjackConstants');
const {
  calculateHandValue,
  canHit,
  canStand,
  canDouble,
  canSplit,
  shouldDealerHit,
  evaluateHandResult
} = require('./blackjackRules');

class BlackjackEngine extends EventEmitter {
  /**
   * @param {import('./playerManager')} playerManager 
   * @param {Object} [options]
   * @param {string} [options.tableId='table_1']
   * @param {string} [options.tableName='Monte Carlo Royale 1']
   * @param {number} [options.maxSeats=6]
   * @param {import('./bankManager')} [options.bankManager]
   */
  constructor(playerManager, options = {}) {
    super();
    this.playerManager = playerManager;
    this.bankManager = options.bankManager || null;
    this.tableId = options.tableId || 'table_1';
    this.tableName = options.tableName || 'Monte Carlo Royale 1';
    this.maxSeats = options.maxSeats || MAX_SEATS || NUM_SEATS || 6;

    this.deck = new BlackjackDeck(6);
    this.currentPhase = PHASES.WAITING_FOR_PLAYERS;
    this.timeLeft = 0;
    this.turnTimeLeft = PHASE_DURATIONS.TURN_TIMEOUT;

    /** @type {Array<Object>} Dealer cards */
    this.dealerCards = [];
    this.dealerHoleCardHidden = true;

    /** @type {Array<Object>} 6 Physical Seats (0..5) */
    this.seats = [];
    this.initSeats();

    /** @type {{ seatIndex: number, handIndex: number }|null} Active turn */
    this.activeTurn = null;

    this.timerInterval = null;
    this.isRunning = false;
  }

  /**
   * Initializes the seats array with 6 empty seat slots.
   */
  initSeats() {
    this.seats = [];
    for (let i = 0; i < this.maxSeats; i++) {
      this.seats.push({
        seatIndex: i,
        player: null,
        bet: 0,
        hands: [
          {
            id: `h_${i}_0`,
            cards: [],
            bet: 0,
            status: HAND_STATUS.EMPTY,
            value: 0,
            isSoft: false,
            isSplitHand: false,
            isSplitAces: false,
            doubled: false
          }
        ],
        status: SEAT_STATUS.EMPTY
      });
    }
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
   * Stops the state machine loop cleanly.
   */
  stop() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.isRunning = false;
  }

  /**
   * 1-second clock tick processing countdowns and auto-stand.
   */
  tick() {
    if (this.currentPhase === PHASES.BETTING) {
      this.timeLeft--;
      this.emit('phase_tick', {
        tableId: this.tableId,
        phase: this.currentPhase,
        timeLeft: Math.max(0, this.timeLeft),
        serverTime: Date.now()
      });
      if (this.timeLeft <= 0) {
        const activeBetCount = this.seats.filter(s => s.player && s.bet >= MIN_BET).length;
        if (activeBetCount > 0) {
          this.transitionToDealing();
        } else {
          const seatedCount = this.seats.filter(s => s.player !== null).length;
          if (seatedCount > 0) {
            this.transitionToBetting();
          } else {
            this.transitionToWaiting();
          }
        }
      }
    } else if (this.currentPhase === PHASES.DEALING) {
      this.timeLeft--;
      if (this.timeLeft <= 0) {
        this.transitionToPlayerTurns();
      }
    } else if (this.currentPhase === PHASES.PLAYER_TURNS) {
      if (this.activeTurn) {
        this.turnTimeLeft--;
        this.emit('turn_tick', {
          tableId: this.tableId,
          seatIndex: this.activeTurn.seatIndex,
          handIndex: this.activeTurn.handIndex,
          turnTimeLeft: Math.max(0, this.turnTimeLeft),
          serverTime: Date.now()
        });
        if (this.turnTimeLeft <= 0) {
          // Anti-Stall: Player timed out -> auto-stand
          this.autoStand(this.activeTurn.seatIndex, this.activeTurn.handIndex);
        }
      } else {
        // No active turns remaining -> advance to dealer
        this.transitionToDealerTurn();
      }
    } else if (this.currentPhase === PHASES.DEALER_TURN) {
      this.timeLeft--;
      if (this.timeLeft <= 0) {
        this.transitionToPayout();
      }
    } else if (this.currentPhase === PHASES.PAYOUT) {
      this.timeLeft--;
      if (this.timeLeft <= 0) {
        this.transitionToRoundOver();
      }
    } else if (this.currentPhase === PHASES.ROUND_OVER) {
      this.timeLeft--;
      if (this.timeLeft <= 0) {
        this.prepareNextRound();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Table & Seat Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Assigns an empty seat to a player.
   * @param {number} seatIndex (0..5)
   * @param {string} playerId 
   * @returns {{ success: boolean, code?: string, reason?: string, seat?: Object }}
   */
  takeSeat(seatIndex, playerId) {
    if (typeof seatIndex !== 'number' || seatIndex < 0 || seatIndex >= this.maxSeats) {
      return { success: false, code: 'INVALID_SEAT', reason: 'Invalid seat index' };
    }

    const player = this.playerManager.getPlayerById(playerId);
    if (!player) {
      return { success: false, code: 'PLAYER_NOT_FOUND', reason: 'Player profile not found' };
    }

    // Check if player is already seated at this table
    const alreadySeated = this.seats.find(s => s.player && s.player.id === playerId);
    if (alreadySeated) {
      return {
        success: false,
        code: 'ALREADY_SEATED',
        reason: `Already seated at seat ${alreadySeated.seatIndex}`
      };
    }

    // Check if seat is already occupied
    const targetSeat = this.seats[seatIndex];
    if (targetSeat.player !== null) {
      return { success: false, code: 'SEAT_OCCUPIED', reason: 'Seat is already occupied' };
    }

    if (player.chips < MIN_BET) {
      return { success: false, code: 'INSUFFICIENT_FUNDS', reason: 'Insufficient chips to take a seat' };
    }

    targetSeat.player = {
      id: player.id,
      name: player.name,
      avatar: player.avatar,
      color: player.color,
      chips: player.chips,
      socketId: player.socketId
    };
    targetSeat.status = SEAT_STATUS.SEATED;
    targetSeat.bet = 0;
    targetSeat.hands = [
      {
        id: `h_${seatIndex}_0`,
        cards: [],
        bet: 0,
        status: HAND_STATUS.BETTING,
        value: 0,
        isSoft: false,
        isSplitHand: false,
        isSplitAces: false,
        doubled: false
      }
    ];

    // Update player presence location
    this.playerManager.setPlayerPresence(playerId, 'BLACKJACK', seatIndex);

    this.emit('seat_taken', {
      tableId: this.tableId,
      seatIndex,
      player: targetSeat.player
    });

    // If table was waiting for players, transition to BETTING
    if (this.currentPhase === PHASES.WAITING_FOR_PLAYERS) {
      this.transitionToBetting();
    }

    return { success: true, seat: targetSeat };
  }

  /**
   * Vacates a seat occupied by a player, subject to navigation bet lock.
   * @param {number} seatIndex 
   * @param {string} playerId 
   * @returns {{ success: boolean, code?: string, reason?: string }}
   */
  leaveSeat(seatIndex, playerId) {
    if (typeof seatIndex !== 'number' || seatIndex < 0 || seatIndex >= this.maxSeats) {
      return { success: false, code: 'INVALID_SEAT', reason: 'Invalid seat index' };
    }

    const seat = this.seats[seatIndex];
    if (!seat.player || seat.player.id !== playerId) {
      return { success: false, code: 'NOT_SEAT_OWNER', reason: 'You do not occupy this seat' };
    }

    // If player is in BETTING phase and has placed a bet, auto-refund so they are not trapped
    if (this.currentPhase === PHASES.BETTING && seat.bet > 0) {
      this.clearBet(seatIndex, playerId);
    }

    // Navigation Lock Check: Cannot leave while having active, unresolved bets
    if (this.hasActiveBets(playerId)) {
      return {
        success: false,
        code: 'CANNOT_LEAVE_ACTIVE_BETS',
        reason: 'Cannot vacate seat while having active bets on the table'
      };
    }

    seat.player = null;
    seat.status = SEAT_STATUS.EMPTY;
    seat.bet = 0;
    seat.hands = [
      {
        id: `h_${seatIndex}_0`,
        cards: [],
        bet: 0,
        status: HAND_STATUS.EMPTY,
        value: 0,
        isSoft: false,
        isSplitHand: false,
        isSplitAces: false,
        doubled: false
      }
    ];

    this.playerManager.setPlayerPresence(playerId, 'LOBBY', null);

    this.emit('seat_left', {
      tableId: this.tableId,
      seatIndex,
      playerId
    });

    // If no seated players remain, transition to WAITING_FOR_PLAYERS
    const seatedCount = this.seats.filter(s => s.player !== null).length;
    if (seatedCount === 0 && this.currentPhase === PHASES.BETTING) {
      this.transitionToWaiting();
    }

    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // Betting Phase Handlers
  // ---------------------------------------------------------------------------

  /**
   * Places a bet on a seat during the BETTING phase.
   * @param {number} seatIndex 
   * @param {string} playerId 
   * @param {number} amount 
   * @returns {{ success: boolean, code?: string, reason?: string, seat?: Object, chips?: number }}
   */
  placeBet(seatIndex, playerId, amount) {
    if (this.currentPhase === PHASES.WAITING_FOR_PLAYERS) {
      this.transitionToBetting();
    } else if (this.currentPhase !== PHASES.BETTING) {
      return { success: false, code: 'BETS_CLOSED', reason: 'Betting is closed for this round' };
    }

    if (typeof seatIndex !== 'number' || seatIndex < 0 || seatIndex >= this.maxSeats) {
      return { success: false, code: 'INVALID_SEAT', reason: 'Invalid seat index' };
    }

    const seat = this.seats[seatIndex];
    if (!seat.player || seat.player.id !== playerId) {
      return { success: false, code: 'NOT_SEAT_OWNER', reason: 'You do not occupy this seat' };
    }

    const betAmount = parseInt(amount, 10);
    if (!Number.isInteger(betAmount) || betAmount < MIN_BET || betAmount > MAX_BET) {
      return {
        success: false,
        code: 'INVALID_AMOUNT',
        reason: `Bet must be between ${MIN_BET} and ${MAX_BET} chips`
      };
    }

    const player = this.playerManager.getPlayerById(playerId);
    if (!player || player.chips < betAmount) {
      return { success: false, code: 'INSUFFICIENT_FUNDS', reason: 'Insufficient chip balance' };
    }

    // Atomically deduct chips
    const deductRes = this.playerManager.deductChips(playerId, betAmount);
    if (!deductRes.success) {
      return { success: false, code: 'INSUFFICIENT_FUNDS', reason: deductRes.reason };
    }

    seat.bet += betAmount;
    seat.hands[0].bet = seat.bet;
    seat.hands[0].status = HAND_STATUS.BETTING;
    seat.status = SEAT_STATUS.BETTING;
    seat.player.chips = deductRes.chips;

    this.emit('bet_placed', {
      tableId: this.tableId,
      seatIndex,
      playerId,
      amount: betAmount,
      totalBet: seat.bet,
      remainingChips: deductRes.chips
    });

    return {
      success: true,
      seat,
      totalBet: seat.bet,
      chips: deductRes.chips
    };
  }

  /**
   * Clears a player's placed bet during the BETTING phase and refunds chips.
   * @param {number} seatIndex 
   * @param {string} playerId 
   * @returns {{ success: boolean, code?: string, reason?: string, refundedAmount?: number, chips?: number }}
   */
  clearBet(seatIndex, playerId) {
    if (this.currentPhase !== PHASES.BETTING) {
      return { success: false, code: 'BETS_CLOSED', reason: 'Cannot clear bets once round has started' };
    }

    if (typeof seatIndex !== 'number' || seatIndex < 0 || seatIndex >= this.maxSeats) {
      return { success: false, code: 'INVALID_SEAT', reason: 'Invalid seat index' };
    }

    const seat = this.seats[seatIndex];
    if (!seat.player || seat.player.id !== playerId) {
      return { success: false, code: 'NOT_SEAT_OWNER', reason: 'You do not occupy this seat' };
    }

    const refundedAmount = seat.bet;
    if (refundedAmount > 0) {
      this.playerManager.addChips(playerId, refundedAmount);
      seat.bet = 0;
      seat.hands[0].bet = 0;
      seat.hands[0].status = HAND_STATUS.BETTING;
      seat.status = SEAT_STATUS.SEATED;
    }

    const player = this.playerManager.getPlayerById(playerId);
    const currentChips = player ? player.chips : 0;
    if (seat.player) {
      seat.player.chips = currentChips;
    }

    this.emit('bet_cleared', {
      tableId: this.tableId,
      seatIndex,
      playerId,
      refundedAmount,
      chips: currentChips
    });

    return {
      success: true,
      refundedAmount,
      chips: currentChips
    };
  }

  // ---------------------------------------------------------------------------
  // Player Actions (Hit, Stand, Double, Split)
  // ---------------------------------------------------------------------------

  /**
   * Executes a player decision action.
   * @param {number} seatIndex 
   * @param {number} handIndex 
   * @param {string} playerId 
   * @param {'hit'|'stand'|'double'|'split'} action 
   * @returns {{ success: boolean, code?: string, reason?: string, hand?: Object }}
   */
  handleAction(seatIndex, handIndex, playerId, action) {
    if (this.currentPhase !== PHASES.PLAYER_TURNS) {
      return { success: false, code: 'INVALID_PHASE', reason: 'Not in player turns phase' };
    }

    if (!this.activeTurn || this.activeTurn.seatIndex !== seatIndex || this.activeTurn.handIndex !== handIndex) {
      return { success: false, code: 'NOT_YOUR_TURN', reason: 'It is not your turn' };
    }

    const seat = this.seats[seatIndex];
    if (!seat || !seat.player || seat.player.id !== playerId) {
      return { success: false, code: 'NOT_SEAT_OWNER', reason: 'You do not own this hand' };
    }

    const hand = seat.hands[handIndex];
    if (!hand) {
      return { success: false, code: 'INVALID_HAND', reason: 'Hand not found' };
    }

    const player = this.playerManager.getPlayerById(playerId);
    const playerChips = player ? player.chips : 0;

    switch (action) {
      case ACTIONS.HIT: {
        if (!canHit(hand)) {
          return { success: false, code: 'HIT_NOT_ALLOWED', reason: 'Cannot hit on this hand' };
        }
        const card = this.deck.draw();
        hand.cards.push(card);
        const score = calculateHandValue(hand.cards);
        hand.value = score.value;
        hand.isSoft = score.isSoft;

        if (score.isBust) {
          hand.status = HAND_STATUS.BUSTED;
        } else if (score.value === 21) {
          hand.status = HAND_STATUS.STOOD; // 21 auto-stands
        }

        this.emit('action_applied', {
          tableId: this.tableId,
          seatIndex,
          handIndex,
          action: 'hit',
          card,
          hand,
          isBust: score.isBust,
          is21: score.value === 21
        });

        // If busted or reached 21, advance turn immediately
        if (score.isBust || score.value === 21) {
          this.advanceTurn();
        } else {
          // Reset 15s turn timer for next hit/stand decision
          this.turnTimeLeft = PHASE_DURATIONS.TURN_TIMEOUT;
        }

        return { success: true, hand, card };
      }

      case ACTIONS.STAND: {
        if (!canStand(hand)) {
          return { success: false, code: 'STAND_NOT_ALLOWED', reason: 'Cannot stand on this hand' };
        }
        hand.status = HAND_STATUS.STOOD;

        this.emit('action_applied', {
          tableId: this.tableId,
          seatIndex,
          handIndex,
          action: 'stand',
          hand
        });

        this.advanceTurn();
        return { success: true, hand };
      }

      case ACTIONS.DOUBLE: {
        if (!canDouble(hand, playerChips)) {
          return {
            success: false,
            code: 'DOUBLE_NOT_ALLOWED',
            reason: 'Double down not eligible or insufficient chips'
          };
        }

        const additionalBet = hand.bet;
        const deductRes = this.playerManager.deductChips(playerId, additionalBet);
        if (!deductRes.success) {
          return { success: false, code: 'INSUFFICIENT_FUNDS', reason: deductRes.reason };
        }

        hand.bet += additionalBet;
        hand.doubled = true;
        seat.bet += additionalBet;
        if (seat.player) seat.player.chips = deductRes.chips;

        // Double down deals exactly 1 card then auto-stands
        const card = this.deck.draw();
        hand.cards.push(card);
        const score = calculateHandValue(hand.cards);
        hand.value = score.value;
        hand.isSoft = score.isSoft;

        if (score.isBust) {
          hand.status = HAND_STATUS.BUSTED;
        } else {
          hand.status = HAND_STATUS.STOOD;
        }

        this.emit('action_applied', {
          tableId: this.tableId,
          seatIndex,
          handIndex,
          action: 'double',
          card,
          hand,
          totalBet: hand.bet,
          remainingChips: deductRes.chips,
          isBust: score.isBust
        });

        this.advanceTurn();
        return { success: true, hand, card };
      }

      case ACTIONS.SPLIT: {
        if (!canSplit(hand, playerChips, seat.hands.length)) {
          return {
            success: false,
            code: 'SPLIT_NOT_ALLOWED',
            reason: 'Split not eligible or insufficient chips'
          };
        }

        const additionalBet = hand.bet;
        const deductRes = this.playerManager.deductChips(playerId, additionalBet);
        if (!deductRes.success) {
          return { success: false, code: 'INSUFFICIENT_FUNDS', reason: deductRes.reason };
        }

        const secondCard = hand.cards.pop();
        const isSplitAces = (hand.cards[0].rank === 'A');

        hand.isSplitHand = true;
        hand.isSplitAces = isSplitAces;

        const hand1 = {
          id: `h_${seatIndex}_1`,
          cards: [secondCard],
          bet: additionalBet,
          status: HAND_STATUS.ACTIVE,
          value: 0,
          isSoft: false,
          isSplitHand: true,
          isSplitAces,
          doubled: false
        };

        seat.hands.push(hand1);
        seat.bet += additionalBet;
        if (seat.player) seat.player.chips = deductRes.chips;

        // Deal 1 card to each split hand
        const card0 = this.deck.draw();
        const card1 = this.deck.draw();
        hand.cards.push(card0);
        hand1.cards.push(card1);

        const score0 = calculateHandValue(hand.cards);
        hand.value = score0.value;
        hand.isSoft = score0.isSoft;

        const score1 = calculateHandValue(hand1.cards);
        hand1.value = score1.value;
        hand1.isSoft = score1.isSoft;

        // Restriction on Split Aces: receive 1 card each and automatically stand
        if (isSplitAces) {
          hand.status = HAND_STATUS.STOOD;
          hand1.status = HAND_STATUS.STOOD;
        }

        this.emit('action_applied', {
          tableId: this.tableId,
          seatIndex,
          handIndex,
          action: 'split',
          hands: seat.hands,
          remainingChips: deductRes.chips
        });

        if (isSplitAces) {
          this.advanceTurn();
        } else {
          // If first hand is 21, auto-stand it
          if (hand.value === 21) {
            hand.status = HAND_STATUS.STOOD;
            this.advanceTurn();
          } else {
            this.turnTimeLeft = PHASE_DURATIONS.TURN_TIMEOUT;
            this.emitTurnChange();
          }
        }

        return { success: true, hands: seat.hands };
      }

      default:
        return { success: false, code: 'UNKNOWN_ACTION', reason: `Unknown action: ${action}` };
    }
  }

  /**
   * Automatically stands the active hand when the 15-second turn timer expires.
   * @param {number} seatIndex 
   * @param {number} handIndex 
   */
  autoStand(seatIndex, handIndex) {
    const seat = this.seats[seatIndex];
    if (!seat) return;
    const hand = seat.hands[handIndex];
    if (!hand || hand.status !== HAND_STATUS.ACTIVE) return;

    hand.status = HAND_STATUS.STOOD;

    this.emit('action_applied', {
      tableId: this.tableId,
      seatIndex,
      handIndex,
      action: 'stand',
      hand,
      auto: true
    });

    this.advanceTurn();
  }

  /**
   * Advances the turn clockwise to the next active hand or seat.
   */
  advanceTurn() {
    if (this.currentPhase !== PHASES.PLAYER_TURNS) return;

    const startSeat = this.activeTurn ? this.activeTurn.seatIndex : 0;
    const startHand = this.activeTurn ? this.activeTurn.handIndex : 0;

    // Check if the current seat has another active hand (e.g. split hand 1)
    const currentSeat = this.seats[startSeat];
    if (currentSeat && currentSeat.hands) {
      for (let h = startHand + 1; h < currentSeat.hands.length; h++) {
        if (currentSeat.hands[h].status === HAND_STATUS.ACTIVE) {
          this.activeTurn = { seatIndex: startSeat, handIndex: h };
          this.turnTimeLeft = PHASE_DURATIONS.TURN_TIMEOUT;
          this.emitTurnChange();
          return;
        }
      }
    }

    // Otherwise, loop clockwise through remaining seats
    for (let offset = 1; offset <= this.maxSeats; offset++) {
      const seatIdx = (startSeat + offset) % this.maxSeats;
      const s = this.seats[seatIdx];
      if (s.player && s.bet > 0 && s.hands) {
        for (let h = 0; h < s.hands.length; h++) {
          if (s.hands[h].status === HAND_STATUS.ACTIVE) {
            this.activeTurn = { seatIndex: seatIdx, handIndex: h };
            this.turnTimeLeft = PHASE_DURATIONS.TURN_TIMEOUT;
            this.emitTurnChange();
            return;
          }
        }
      }
    }

    // No active hands found anywhere -> all player turns are finished!
    this.activeTurn = null;
    this.transitionToDealerTurn();
  }

  /**
   * Emits turn_change event for the current activeTurn.
   */
  emitTurnChange() {
    if (!this.activeTurn) return;
    const seat = this.seats[this.activeTurn.seatIndex];
    const hand = seat.hands[this.activeTurn.handIndex];
    const player = this.playerManager.getPlayerById(seat.player.id);
    const playerChips = player ? player.chips : 0;

    const actions = {
      canHit: canHit(hand),
      canStand: canStand(hand),
      canDouble: canDouble(hand, playerChips),
      canSplit: canSplit(hand, playerChips, seat.hands.length)
    };

    this.emit('turn_change', {
      tableId: this.tableId,
      seatIndex: this.activeTurn.seatIndex,
      handIndex: this.activeTurn.handIndex,
      playerId: seat.player.id,
      actions,
      turnTimeLeft: this.turnTimeLeft,
      serverTime: Date.now()
    });
  }

  // ---------------------------------------------------------------------------
  // State Machine Phase Transitions
  // ---------------------------------------------------------------------------

  transitionToWaiting() {
    this.currentPhase = PHASES.WAITING_FOR_PLAYERS;
    this.timeLeft = 0;
    this.activeTurn = null;
    this.emitPhaseChange();
  }

  transitionToBetting() {
    this.currentPhase = PHASES.BETTING;
    this.timeLeft = PHASE_DURATIONS[PHASES.BETTING] || 15;
    this.activeTurn = null;

    // Reset bets on seated players
    for (const seat of this.seats) {
      if (seat.player) {
        seat.status = SEAT_STATUS.SEATED;
        seat.bet = 0;
        seat.hands = [
          {
            id: `h_${seat.seatIndex}_0`,
            cards: [],
            bet: 0,
            status: HAND_STATUS.BETTING,
            value: 0,
            isSoft: false,
            isSplitHand: false,
            isSplitAces: false,
            doubled: false
          }
        ];
      }
    }

    this.dealerCards = [];
    this.dealerHoleCardHidden = true;
    this.emitPhaseChange();
  }

  transitionToDealing() {
    this.currentPhase = PHASES.DEALING;
    this.timeLeft = PHASE_DURATIONS[PHASES.DEALING] || 2;
    this.activeTurn = null;
    this.dealerHoleCardHidden = true;

    // Reshuffle check prior to dealing
    if (this.deck.needsReshuffle()) {
      this.deck.initShoe();
      this.deck.shuffle();
      this.emit('shoe_reshuffle', {
        tableId: this.tableId,
        message: 'Shoe penetration reached 75%. Reshuffling 312 cards.',
        remainingCards: this.deck.cardsRemaining()
      });
    }

    // Deal 2 cards to each seated player with a bet
    for (const seat of this.seats) {
      if (seat.player && seat.bet >= MIN_BET) {
        seat.status = SEAT_STATUS.PLAYING;
        const hand = seat.hands[0];
        hand.cards = [this.deck.draw(), this.deck.draw()];
        const score = calculateHandValue(hand.cards);
        hand.value = score.value;
        hand.isSoft = score.isSoft;

        if (score.isBlackjack) {
          hand.status = HAND_STATUS.BLACKJACK;
        } else {
          hand.status = HAND_STATUS.ACTIVE;
        }
      }
    }

    // Deal 2 cards to dealer: 1 upcard, 1 hole card
    this.dealerCards = [this.deck.draw(), this.deck.draw()];

    this.emitPhaseChange();
  }

  transitionToPlayerTurns() {
    this.currentPhase = PHASES.PLAYER_TURNS;
    this.activeTurn = null;

    // Check dealer immediate blackjack
    const dealerScore = calculateHandValue(this.dealerCards);
    if (dealerScore.isBlackjack) {
      // Dealer has natural blackjack! Skip player turns and go straight to dealer/payout
      this.transitionToDealerTurn();
      return;
    }

    // Find first active player hand clockwise starting from seat 0
    let foundActive = false;
    for (let s = 0; s < this.maxSeats; s++) {
      const seat = this.seats[s];
      if (seat.player && seat.bet > 0 && seat.hands) {
        for (let h = 0; h < seat.hands.length; h++) {
          if (seat.hands[h].status === HAND_STATUS.ACTIVE) {
            this.activeTurn = { seatIndex: s, handIndex: h };
            this.turnTimeLeft = PHASE_DURATIONS.TURN_TIMEOUT;
            foundActive = true;
            break;
          }
        }
      }
      if (foundActive) break;
    }

    if (foundActive) {
      this.emitPhaseChange();
      this.emitTurnChange();
    } else {
      // All players have blackjacks or no active hands
      this.transitionToDealerTurn();
    }
  }

  transitionToDealerTurn() {
    this.currentPhase = PHASES.DEALER_TURN;
    this.timeLeft = PHASE_DURATIONS[PHASES.DEALER_TURN] || 2;
    this.dealerHoleCardHidden = false; // Reveal hole card

    this.emit('dealer_reveal', {
      tableId: this.tableId,
      dealerHand: this.dealerCards,
      score: calculateHandValue(this.dealerCards)
    });

    this.dealerPlay();
    this.emitPhaseChange();
  }

  /**
   * Executes authoritative dealer card draws under S17 rules.
   * If all player hands are busted, dealer skips drawing cards.
   */
  dealerPlay() {
    // Check if ALL seated player hands are busted
    let allPlayersBusted = true;
    for (const seat of this.seats) {
      if (seat.player && seat.bet > 0) {
        for (const hand of seat.hands) {
          const score = calculateHandValue(hand.cards);
          if (!score.isBust) {
            allPlayersBusted = false;
            break;
          }
        }
      }
      if (!allPlayersBusted) break;
    }

    // If all player hands busted, dealer stands without drawing
    if (allPlayersBusted) {
      return;
    }

    // S17 draw loop: dealer hits on 16 or less, stands on ALL 17s (including soft 17)
    while (shouldDealerHit(this.dealerCards)) {
      const card = this.deck.draw();
      this.dealerCards.push(card);
      this.emit('dealer_draw', {
        tableId: this.tableId,
        card,
        dealerHand: this.dealerCards,
        score: calculateHandValue(this.dealerCards)
      });
    }
  }

  transitionToPayout() {
    this.currentPhase = PHASES.PAYOUT;
    this.timeLeft = PHASE_DURATIONS[PHASES.PAYOUT] || 4;

    const dealerScore = calculateHandValue(this.dealerCards);
    const results = [];

    // Evaluate each seat and hand against dealer hand
    for (const seat of this.seats) {
      if (!seat.player || seat.bet <= 0) continue;

      const player = this.playerManager.getPlayerById(seat.player.id);
      const handResults = [];
      let totalWon = 0;
      let totalBet = 0;

      for (const hand of seat.hands) {
        totalBet += hand.bet;
        const evaluation = evaluateHandResult(hand, this.dealerCards, hand.bet, hand.isSplitHand);
        handResults.push({
          handId: hand.id,
          bet: hand.bet,
          cards: hand.cards,
          score: evaluation.playerScore,
          outcome: evaluation.outcome,
          result: evaluation.result,
          gross: evaluation.gross,
          profit: evaluation.profit
        });

        if (evaluation.gross > 0) {
          totalWon += evaluation.gross;
          this.playerManager.addChips(seat.player.id, evaluation.gross);
        }
      }

      const netProfit = totalWon - totalBet;

      // Deduct loan repayments from net profit if player owes active debts
      let repayments = [];
      if (netProfit > 0 && this.bankManager && typeof this.bankManager.processWinRepayment === 'function') {
        repayments = this.bankManager.processWinRepayment(seat.player.id, netProfit);
      }

      // Update statistics
      if (typeof this.playerManager.updatePlayerStats === 'function') {
        this.playerManager.updatePlayerStats(seat.player.id, { wonAmount: totalWon });
      }

      const updatedPlayer = this.playerManager.getPlayerById(seat.player.id);
      const currentChips = updatedPlayer ? updatedPlayer.chips : 0;
      seat.player.chips = currentChips;

      results.push({
        seatIndex: seat.seatIndex,
        playerId: seat.player.id,
        playerName: seat.player.name,
        hands: handResults,
        totalBet,
        totalWon,
        net: netProfit,
        chips: currentChips,
        repayments
      });
    }

    const payload = {
      tableId: this.tableId,
      dealerHand: this.dealerCards,
      dealerScore,
      results,
      seatResults: results, // alias for client compatibility
      serverTime: Date.now()
    };

    this.emit('round_result', payload);
    this.emitPhaseChange();
  }

  transitionToRoundOver() {
    this.currentPhase = PHASES.ROUND_OVER;
    this.timeLeft = PHASE_DURATIONS[PHASES.ROUND_OVER] || 2;
    this.emitPhaseChange();
  }

  prepareNextRound() {
    // Check if shoe penetration threshold was reached
    if (this.deck.needsReshuffle()) {
      this.deck.initShoe();
      this.deck.shuffle();
      this.emit('shoe_reshuffle', {
        tableId: this.tableId,
        message: 'Shoe penetration reached 75%. Reshuffled 312 cards.',
        remainingCards: this.deck.cardsRemaining()
      });
    }

    // Check if seated players remain
    const seatedCount = this.seats.filter(s => s.player !== null).length;
    if (seatedCount > 0) {
      this.transitionToBetting();
    } else {
      this.transitionToWaiting();
    }
  }

  emitPhaseChange() {
    this.emit('phase_change', {
      tableId: this.tableId,
      phase: this.currentPhase,
      timeLeft: this.timeLeft,
      serverTime: Date.now()
    });
  }

  // ---------------------------------------------------------------------------
  // Navigation Bet Lock Queries
  // ---------------------------------------------------------------------------

  /**
   * Returns true if player has active, unresolved bets placed on this Blackjack table.
   * Lock holds from bet placement through DEALER_TURN / PAYOUT until round is settled.
   * @param {string} playerId 
   * @returns {boolean}
   */
  hasActiveBets(playerId) {
    if (!playerId) return false;
    for (const seat of this.seats) {
      if (seat.player && seat.player.id === playerId) {
        if (seat.bet > 0) {
          // If in BETTING, dealing, player turns, dealer turn, or payout with unresolved bets
          if (this.currentPhase === PHASES.BETTING ||
              this.currentPhase === PHASES.DEALING ||
              this.currentPhase === PHASES.PLAYER_TURNS ||
              this.currentPhase === PHASES.DEALER_TURN) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Returns the total amount of active bets placed by this player on this table.
   * @param {string} playerId 
   * @returns {number}
   */
  getActiveBetTotal(playerId) {
    if (!playerId) return 0;
    let total = 0;
    for (const seat of this.seats) {
      if (seat.player && seat.player.id === playerId) {
        if (this.hasActiveBets(playerId)) {
          total += seat.bet;
        }
      }
    }
    return total;
  }

  // ---------------------------------------------------------------------------
  // State Snapshot Serialization
  // ---------------------------------------------------------------------------

  /**
   * Serializes current table state.
   * Securely masks dealer's hole card if round is in DEALING or PLAYER_TURNS.
   * @param {string} [forPlayerId] 
   * @returns {Object}
   */
  getTableState(forPlayerId) {
    let publicDealerHand = [];
    if (this.dealerCards.length > 0) {
      if (this.dealerHoleCardHidden && this.dealerCards.length >= 2) {
        publicDealerHand = [
          this.dealerCards[0],
          { hidden: true }
        ];
      } else {
        publicDealerHand = [...this.dealerCards];
      }
    }

    const publicSeats = this.seats.map(s => ({
      seatIndex: s.seatIndex,
      player: s.player ? { ...s.player } : null,
      bet: s.bet,
      status: s.status,
      hands: s.hands.map(h => ({
        id: h.id,
        cards: [...h.cards],
        bet: h.bet,
        status: h.status,
        value: h.value,
        isSoft: h.isSoft,
        isSplitHand: h.isSplitHand,
        doubled: h.doubled
      }))
    }));

    return {
      tableId: this.tableId,
      tableName: this.tableName,
      maxSeats: this.maxSeats,
      currentPhase: this.currentPhase,
      phase: this.currentPhase, // alias for consistency
      timeLeft: Math.max(0, this.timeLeft),
      turnTimeLeft: this.activeTurn ? Math.max(0, this.turnTimeLeft) : 0,
      activeTurn: this.activeTurn,
      activeSeatIndex: this.activeTurn ? this.activeTurn.seatIndex : -1,
      dealerHand: publicDealerHand,
      dealerCards: publicDealerHand, // alias
      dealerScore: this.dealerCards.length > 0 ? (this.dealerHoleCardHidden ? (this.dealerCards[0] ? this.dealerCards[0].value : 0) : calculateHandValue(this.dealerCards).value) : 0,
      seats: publicSeats,
      shoePenetration: this.deck.getPenetration(),
      shoeCardsLeft: this.deck.cardsRemaining(),
      serverTime: Date.now()
    };
  }
}

module.exports = BlackjackEngine;
