const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const PokerEngine = require('../../server/game/pokerEngine');
const PlayerManager = require('../../server/game/playerManager');
const { PHASES, ACTIONS, SEAT_STATUS } = require('../../server/game/pokerConstants');

describe('PokerEngine Unit Tests (6-Seat Lifecycle, No-Limit Rules & Security)', () => {
  let playerManager;
  let engine;

  beforeEach(() => {
    playerManager = new PlayerManager({ storagePath: false });
    engine = new PokerEngine(playerManager, {
      tableId: 'poker_test_1',
      maxSeats: 6,
      smallBlind: 50,
      bigBlind: 100,
      minBuyIn: 2000,
      maxBuyIn: 10000
    });
  });

  afterEach(() => {
    if (engine) engine.stop();
  });

  describe('Seat Management & Buy-Ins', () => {
    it('should initialize 6 empty seats in WAITING_FOR_PLAYERS phase', () => {
      assert.equal(engine.seats.length, 6);
      assert.equal(engine.currentPhase, PHASES.WAITING_FOR_PLAYERS);
      for (let i = 0; i < 6; i++) {
        assert.equal(engine.seats[i].seatIndex, i);
        assert.equal(engine.seats[i].player, null);
        assert.equal(engine.seats[i].status, SEAT_STATUS.EMPTY);
      }
    });

    it('should claim open seat, deduct bankroll, and reject occupied seat', () => {
      const p1 = playerManager.registerPlayer('sock_1', { name: 'Player1' });
      const p2 = playerManager.registerPlayer('sock_2', { name: 'Player2' });

      const res1 = engine.takeSeat(0, p1.id, 2000);
      assert.equal(res1.success, true);
      assert.equal(engine.seats[0].player.id, p1.id);
      assert.equal(engine.seats[0].stack, 2000);
      assert.equal(playerManager.getPlayerById(p1.id).chips, 8000); // 10k - 2k

      // Attempt to claim same seat
      const res2 = engine.takeSeat(0, p2.id, 2000);
      assert.equal(res2.success, false);
      assert.equal(res2.code, 'SEAT_OCCUPIED');
    });

    it('should default to standard buy-in amount (50 BB) when buy-in amount is omitted', () => {
      const p = playerManager.registerPlayer('sock_default', { name: 'DefaultPlayer' });
      const res = engine.takeSeat(3, p.id); // no buy-in amount specified
      assert.equal(res.success, true);
      assert.equal(res.stack, 5000); // 50 * 100 BB = 5000 default
      assert.equal(engine.seats[3].stack, 5000);
      assert.equal(playerManager.getPlayerById(p.id).chips, 5000); // 10k - 5k = 5k
    });

    it('getTableState() should include minBuyIn, maxBuyIn, and defaultBuyIn', () => {
      const state = engine.getTableState();
      assert.equal(state.minBuyIn, 2000);
      assert.equal(state.maxBuyIn, 10000);
      assert.equal(state.defaultBuyIn, 5000);
    });

    it('should reject buy-ins outside [minBuyIn, maxBuyIn]', () => {
      const p = playerManager.registerPlayer('sock_1', { name: 'Player1' });
      const resLow = engine.takeSeat(0, p.id, 1000); // Min is 2000
      assert.equal(resLow.success, false);
      assert.equal(resLow.code, 'INVALID_BUY_IN');

      const resHigh = engine.takeSeat(0, p.id, 15000); // Max is 10000
      assert.equal(resHigh.success, false);
      assert.equal(resHigh.code, 'INVALID_BUY_IN');
    });

    it('should reject a player claiming two seats at the same table', () => {
      const p = playerManager.registerPlayer('sock_1', { name: 'Player1' });
      const res1 = engine.takeSeat(1, p.id, 2000);
      assert.equal(res1.success, true);

      const res2 = engine.takeSeat(2, p.id, 2000);
      assert.equal(res2.success, false);
      assert.equal(res2.code, 'ALREADY_SEATED');
    });

    it('leaveSeat() should return table stack back to persistent bankroll', () => {
      const p = playerManager.registerPlayer('sock_1', { name: 'Player1' });
      engine.takeSeat(0, p.id, 3000);
      assert.equal(playerManager.getPlayerById(p.id).chips, 7000);

      const leaveRes = engine.leaveSeat(0, p.id);
      assert.equal(leaveRes.success, true);
      assert.equal(leaveRes.cashoutAmount, 3000);
      assert.equal(playerManager.getPlayerById(p.id).chips, 10000);
      assert.equal(engine.seats[0].player, null);
    });

    it('rebuy() should top up table stack within max limits', () => {
      const p = playerManager.registerPlayer('sock_1', { name: 'Player1' });
      engine.takeSeat(0, p.id, 2000);

      // Rebuy 3000 -> total stack 5000 (within 10000 max)
      const rebuyRes = engine.rebuy(0, p.id, 3000);
      assert.equal(rebuyRes.success, true);
      assert.equal(engine.seats[0].stack, 5000);
      assert.equal(playerManager.getPlayerById(p.id).chips, 5000);

      // Attempt to rebuy 6000 -> 5000 + 6000 = 11000 > 10000 -> rejected
      const rebuyOver = engine.rebuy(0, p.id, 6000);
      assert.equal(rebuyOver.success, false);
      assert.equal(rebuyOver.code, 'MAX_STACK_EXCEEDED');
    });
  });

  describe('Blinds & Heads-Up (2 Players) vs Multi-Player Rules', () => {
    it('Heads-Up: Dealer Button posts SB and acts first pre-flop', () => {
      const p1 = playerManager.registerPlayer('s1', { name: 'Player1' });
      const p2 = playerManager.registerPlayer('s2', { name: 'Player2' });

      engine.takeSeat(0, p1.id, 2000);
      engine.takeSeat(1, p2.id, 2000);
      engine.startNewHand();
      assert.equal(engine.currentPhase, PHASES.PRE_FLOP);

      const dSeat = engine.dealerButtonSeat;
      const nonDSeat = dSeat === 0 ? 1 : 0;

      // In Heads-up: Dealer is SB, non-dealer is BB
      assert.equal(engine.smallBlindSeat, dSeat);
      assert.equal(engine.bigBlindSeat, nonDSeat);

      // Dealer posts 50 SB, Non-dealer posts 100 BB
      assert.equal(engine.seats[dSeat].stack, 1950);
      assert.equal(engine.seats[nonDSeat].stack, 1900);

      // Dealer (SB) acts FIRST pre-flop in Heads-up!
      assert.equal(engine.activeTurn.seatIndex, dSeat);
    });

    it('Multi-Player (3 players): SB is clockwise from Button, BB is clockwise from SB, UTG acts first', () => {
      const p1 = playerManager.registerPlayer('s1', { name: 'P1' });
      const p2 = playerManager.registerPlayer('s2', { name: 'P2' });
      const p3 = playerManager.registerPlayer('s3', { name: 'P3' });

      // Stop auto-start by setting maxSeats or starting manually
      engine.dealerButtonSeat = 0;
      engine.takeSeat(0, p1.id, 2000);
      engine.takeSeat(1, p2.id, 2000);
      engine.takeSeat(2, p3.id, 2000);

      engine.dealerButtonSeat = 0;
      engine.startNewHand();

      // Button is at Seat 0 -> SB is Seat 1, BB is Seat 2
      assert.equal(engine.dealerButtonSeat, 1); // Advanced from 0 to 1
      assert.equal(engine.smallBlindSeat, 2);
      assert.equal(engine.bigBlindSeat, 0);

      // UTG (clockwise from BB Seat 0) is Seat 1 (Button), acts first pre-flop!
      assert.equal(engine.activeTurn.seatIndex, 1);
    });
  });

  describe('Betting Actions & Delta-Raise Validation', () => {
    let p1, p2, p3;

    beforeEach(() => {
      p1 = playerManager.registerPlayer('s1', { name: 'P1' });
      p2 = playerManager.registerPlayer('s2', { name: 'P2' });
      p3 = playerManager.registerPlayer('s3', { name: 'P3' });

      engine.takeSeat(0, p1.id, 2000);
      engine.takeSeat(1, p2.id, 2000);
      engine.takeSeat(2, p3.id, 2000);

      // Manually control dealer button to have deterministic seating
      engine.dealerButtonSeat = 2;
      engine.startNewHand();
      // Button advanced to Seat 0. SB = Seat 1, BB = Seat 2. UTG = Seat 0 (P1).
    });

    it('should reject check when facing a bet', () => {
      assert.equal(engine.activeTurn.seatIndex, 0);
      // P1 faces BB of 100 -> checking is illegal
      const res = engine.handleAction(0, p1.id, ACTIONS.CHECK);
      assert.equal(res.success, false);
      assert.equal(res.code, 'CANNOT_CHECK');
    });

    it('should accept legal call matching current bet', () => {
      assert.equal(engine.activeTurn.seatIndex, 0);
      const res = engine.handleAction(0, p1.id, ACTIONS.CALL);
      assert.equal(res.success, true);
      assert.equal(engine.seats[0].stack, 1900); // 2000 - 100
      assert.equal(engine.seats[0].currentHandBet, 100);
      // Turn advances to Seat 1 (SB)
      assert.equal(engine.activeTurn.seatIndex, 1);
    });

    it('should enforce Delta-Raise: minimum raise is currentBet + max(BB, lastRaiseDelta)', () => {
      assert.equal(engine.activeTurn.seatIndex, 0);
      // Current bet is BB (100). Delta is 100. Min raise is 100 + 100 = 200.
      assert.equal(engine.minRaise, 200);

      // Attempt to raise to 150 (too small) -> rejected
      const resSmall = engine.handleAction(0, p1.id, ACTIONS.RAISE, { amount: 150 });
      assert.equal(resSmall.success, false);
      assert.equal(resSmall.code, 'RAISE_TOO_SMALL');

      // Raise to 300 (legal raise of +200 over 100)
      const resRaise = engine.handleAction(0, p1.id, ACTIONS.RAISE, { amount: 300 });
      assert.equal(resRaise.success, true);
      assert.equal(engine.currentBet, 300);
      assert.equal(engine.seats[0].stack, 1700);

      // New min raise: currentBet (300) + delta (200) = 500!
      assert.equal(engine.minRaise, 500);
    });

    it('should allow all-in even if less than the minimum raise', () => {
      // Create short-stacked player at seat 0
      engine.seats[0].stack = 180; // Facing 100, raise to 200 is min raise, but stack is only 180 total
      const res = engine.handleAction(0, p1.id, ACTIONS.ALL_IN);
      assert.equal(res.success, true);
      assert.equal(engine.seats[0].isAllIn, true);
      assert.equal(engine.seats[0].stack, 0);
      assert.equal(engine.seats[0].currentHandBet, 180);
    });

    it('Immediate Win on Fold: folding leaves 1 survivor who immediately wins entire pot', () => {
      // P1 folds, P2 folds -> P3 (BB) wins uncontested
      engine.handleAction(0, p1.id, ACTIONS.FOLD);
      engine.handleAction(1, p2.id, ACTIONS.FOLD);

      assert.equal(engine.currentPhase, PHASES.HAND_END);
      // P3 receives SB (50) + BB (100) = 150
      assert.equal(engine.seats[2].stack, 2050);
    });
  });

  describe('Full Hand Lifecycle & Community Street Dealing', () => {
    it('should advance Preflop -> Flop (3 cards) -> Turn (1 card) -> River (1 card) -> Showdown', () => {
      const p1 = playerManager.registerPlayer('s1', { name: 'P1' });
      const p2 = playerManager.registerPlayer('s2', { name: 'P2' });

      engine.takeSeat(0, p1.id, 2000);
      engine.takeSeat(1, p2.id, 2000);
      engine.startNewHand();

      // Pre-flop: Button (SB) calls 50 (total 100). BB checks.
      const sbSeat = engine.smallBlindSeat;
      const bbSeat = engine.bigBlindSeat;

      engine.handleAction(sbSeat, engine.seats[sbSeat].player.id, ACTIONS.CALL);
      engine.handleAction(bbSeat, engine.seats[bbSeat].player.id, ACTIONS.CHECK);

      // Flop dealt (3 community cards)
      assert.equal(engine.currentPhase, PHASES.FLOP);
      assert.equal(engine.communityCards.length, 3);

      // Flop: Both check
      const firstPostFlop = engine.activeTurn.seatIndex;
      const secondPostFlop = firstPostFlop === 0 ? 1 : 0;
      engine.handleAction(firstPostFlop, engine.seats[firstPostFlop].player.id, ACTIONS.CHECK);
      engine.handleAction(secondPostFlop, engine.seats[secondPostFlop].player.id, ACTIONS.CHECK);

      // Turn dealt (4th card)
      assert.equal(engine.currentPhase, PHASES.TURN);
      assert.equal(engine.communityCards.length, 4);

      // Turn: Both check
      engine.handleAction(firstPostFlop, engine.seats[firstPostFlop].player.id, ACTIONS.CHECK);
      engine.handleAction(secondPostFlop, engine.seats[secondPostFlop].player.id, ACTIONS.CHECK);

      // River dealt (5th card)
      assert.equal(engine.currentPhase, PHASES.RIVER);
      assert.equal(engine.communityCards.length, 5);

      // River: Both check -> Showdown!
      engine.handleAction(firstPostFlop, engine.seats[firstPostFlop].player.id, ACTIONS.CHECK);
      engine.handleAction(secondPostFlop, engine.seats[secondPostFlop].player.id, ACTIONS.CHECK);

      // Hand resolves to HAND_END
      assert.equal(engine.currentPhase, PHASES.HAND_END);
      // Total chips distributed = 200 (100 SB + 100 BB)
      const totalChips = engine.seats[0].stack + engine.seats[1].stack;
      assert.equal(totalChips, 4000);
    });
  });

  describe('Turn Timer & Anti-Stall Auto-Action', () => {
    it('autoAction should auto-check when toCall === 0', () => {
      const p1 = playerManager.registerPlayer('s1', { name: 'P1' });
      const p2 = playerManager.registerPlayer('s2', { name: 'P2' });
      engine.takeSeat(0, p1.id, 2000);
      engine.takeSeat(1, p2.id, 2000);
      engine.startNewHand();

      // P1 (SB) calls BB. Now it is P2 (BB)\'s turn with toCall === 0.
      const sb = engine.smallBlindSeat;
      const bb = engine.bigBlindSeat;
      engine.handleAction(sb, engine.seats[sb].player.id, ACTIONS.CALL);

      assert.equal(engine.activeTurn.seatIndex, bb);
      // Trigger auto-action (simulating timer timeout)
      engine.autoAction(bb);

      // P2 should have checked, advancing game to FLOP
      assert.equal(engine.currentPhase, PHASES.FLOP);
    });

    it('autoAction should auto-fold when toCall > 0', () => {
      const p1 = playerManager.registerPlayer('s1', { name: 'P1' });
      const p2 = playerManager.registerPlayer('s2', { name: 'P2' });
      engine.takeSeat(0, p1.id, 2000);
      engine.takeSeat(1, p2.id, 2000);
      engine.startNewHand();

      const sb = engine.smallBlindSeat;
      assert.equal(engine.activeTurn.seatIndex, sb);
      // P1 faces BB of 100 (toCall = 50) -> autoAction folds!
      engine.autoAction(sb);

      assert.equal(engine.seats[sb].folded, true);
      assert.equal(engine.currentPhase, PHASES.HAND_END);
    });
  });

  describe('Security & Authoritative Hole Card Masking', () => {
    it('getTableState(forPlayerId) should reveal own hole cards and mask opponents with { hidden: true }', () => {
      const p1 = playerManager.registerPlayer('s1', { name: 'P1' });
      const p2 = playerManager.registerPlayer('s2', { name: 'P2' });
      engine.takeSeat(0, p1.id, 2000);
      engine.takeSeat(1, p2.id, 2000);
      engine.startNewHand();

      // For spectator (null): both seats masked
      const spectatorState = engine.getTableState(null);
      assert.equal(spectatorState.seats[0].cards[0].hidden, true);
      assert.equal(spectatorState.seats[1].cards[0].hidden, true);

      // For Player 1: Seat 0 reveals real cards, Seat 1 is masked!
      const p1State = engine.getTableState(p1.id);
      assert.ok(p1State.seats[0].cards[0].suit);
      assert.ok(p1State.seats[0].cards[0].rank);
      assert.equal(p1State.seats[0].cards[0].hidden, undefined);
      assert.equal(p1State.seats[1].cards[0].hidden, true);

      // For Player 2: Seat 1 reveals real cards, Seat 0 is masked!
      const p2State = engine.getTableState(p2.id);
      assert.equal(p2State.seats[0].cards[0].hidden, true);
      assert.ok(p2State.seats[1].cards[0].suit);
      assert.ok(p2State.seats[1].cards[0].rank);
    });
  });

  describe('Navigation Bet Lock: hasActiveBets()', () => {
    it('should return true during active hand for active player', () => {
      const p1 = playerManager.registerPlayer('s1', { name: 'P1' });
      const p2 = playerManager.registerPlayer('s2', { name: 'P2' });
      engine.takeSeat(0, p1.id, 2000);
      engine.takeSeat(1, p2.id, 2000);
      engine.startNewHand();

      assert.equal(engine.hasActiveBets(p1.id), true);
      assert.equal(engine.hasActiveBets(p2.id), true);
      assert.equal(engine.hasActiveBets('unrelated_player'), false);
    });

    it('should return false once hand ends or player vacates', () => {
      const p1 = playerManager.registerPlayer('s1', { name: 'P1' });
      const p2 = playerManager.registerPlayer('s2', { name: 'P2' });
      engine.takeSeat(0, p1.id, 2000);
      engine.takeSeat(1, p2.id, 2000);
      engine.startNewHand();

      // P1 folds -> hand ends
      const sb = engine.smallBlindSeat;
      engine.handleAction(sb, engine.seats[sb].player.id, ACTIONS.FOLD);

      assert.equal(engine.currentPhase, PHASES.HAND_END);
      assert.equal(engine.hasActiveBets(p1.id), false);
      assert.equal(engine.hasActiveBets(p2.id), false);
    });
  });

  describe('Under-Raise Reopening & minRaise Enforcement (TDA Rule 45 / WSOP Rule 94)', () => {
    it('should reject re-raise when player has already acted facing an under-raise all-in', () => {
      const localEngine = new PokerEngine(playerManager, {
        tableId: 'poker_test_reopen',
        smallBlind: 50,
        bigBlind: 100,
        minBuyIn: 100,
        maxBuyIn: 10000
      });

      const p0 = playerManager.registerPlayer('s0_reopen', { name: 'P0' });
      const p1 = playerManager.registerPlayer('s1_reopen', { name: 'P1' });
      const p2 = playerManager.registerPlayer('s2_reopen', { name: 'P2' });

      // Seat 0: BTN (5000 chips)
      // Seat 1: SB (5000 chips)
      // Seat 2: BB (250 chips - short stack)
      localEngine.takeSeat(0, p0.id, 5000);
      localEngine.takeSeat(1, p1.id, 5000);
      localEngine.takeSeat(2, p2.id, 250);

      localEngine.startNewHand();

      // Seat 0 raises to 200 (delta = 100)
      const r1 = localEngine.handleAction(0, p0.id, ACTIONS.RAISE, { amount: 200 });
      assert.equal(r1.success, true);

      // Seat 1 calls 200
      const r2 = localEngine.handleAction(1, p1.id, ACTIONS.CALL);
      assert.equal(r2.success, true);

      // Seat 2 (BB) goes all-in for 250 total (delta = 50 < lastRaiseDelta 100 -> under-raise)
      const r3 = localEngine.handleAction(2, p2.id, ACTIONS.ALL_IN);
      assert.equal(r3.success, true);
      assert.equal(localEngine.currentBet, 250);

      // Seat 0 already acted facing the 200 bet -> re-raising must be rejected!
      const r4 = localEngine.handleAction(0, p0.id, ACTIONS.RAISE, { amount: 400 });
      assert.equal(r4.success, false);
      assert.equal(r4.code, 'CANNOT_RAISE');
      assert.equal(r4.reason, 'Betting has not been reopened by a full raise');

      // Calling 250 must succeed
      const r4Call = localEngine.handleAction(0, p0.id, ACTIONS.CALL);
      assert.equal(r4Call.success, true);

      localEngine.stop();
    });

    it('should update minRaise on under-raise all-in and reject sub-minimum raises', () => {
      const localEngine = new PokerEngine(playerManager, {
        tableId: 'poker_test_stale',
        smallBlind: 50,
        bigBlind: 100,
        minBuyIn: 100,
        maxBuyIn: 10000
      });

      const p0 = playerManager.registerPlayer('s0_stale', { name: 'P0' });
      const p1 = playerManager.registerPlayer('s1_stale', { name: 'P1' });
      const p2 = playerManager.registerPlayer('s2_stale', { name: 'P2' });
      const p3 = playerManager.registerPlayer('s3_stale', { name: 'P3' });

      localEngine.takeSeat(0, p0.id, 5000); // BTN
      localEngine.takeSeat(1, p1.id, 5000); // SB
      localEngine.takeSeat(2, p2.id, 5000); // BB
      localEngine.takeSeat(3, p3.id, 120);  // UTG (short stack)

      localEngine.startNewHand();

      // UTG goes all-in for 120 (under-raise +20 over BB 100)
      const r1 = localEngine.handleAction(3, p3.id, ACTIONS.ALL_IN);
      assert.equal(r1.success, true);
      assert.equal(localEngine.currentBet, 120);

      // minRaise must be updated to 120 + max(100, 100) = 220
      assert.equal(localEngine.minRaise, 220);

      // BTN attempts sub-minimum raise to 200 -> rejected
      const r2 = localEngine.handleAction(0, p0.id, ACTIONS.RAISE, { amount: 200 });
      assert.equal(r2.success, false);
      assert.equal(r2.code, 'RAISE_TOO_SMALL');

      // BTN raises legally to 220
      const r2Valid = localEngine.handleAction(0, p0.id, ACTIONS.RAISE, { amount: 220 });
      assert.equal(r2Valid.success, true);
      assert.equal(localEngine.currentBet, 220);
      assert.equal(localEngine.minRaise, 320);

      // SB attempts 1-chip sub-minimum raise to 221 -> rejected
      const r3 = localEngine.handleAction(1, p1.id, ACTIONS.RAISE, { amount: 221 });
      assert.equal(r3.success, false);
      assert.equal(r3.code, 'RAISE_TOO_SMALL');

      localEngine.stop();
    });
  });
});
