const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const BlackjackEngine = require('../../server/game/blackjackEngine');
const PlayerManager = require('../../server/game/playerManager');
const { PHASES, MAX_SEATS } = require('../../server/game/blackjackConstants');

describe('BlackjackEngine Unit Tests (6-Seat Lifecycle & State Machine)', () => {
  let playerManager;
  let engine;

  beforeEach(() => {
    playerManager = new PlayerManager({ storagePath: false });
    engine = new BlackjackEngine(playerManager, { tableId: 'table_test_1', maxSeats: 6 });
  });

  afterEach(() => {
    if (engine) engine.stop();
  });

  it('should initialize with 6 seats (0 through 5) in WAITING_FOR_PLAYERS phase', () => {
    assert.equal(engine.seats.length, 6);
    assert.equal(engine.maxSeats, 6);
    assert.equal(engine.currentPhase, PHASES.WAITING_FOR_PLAYERS);
    for (let i = 0; i < 6; i++) {
      assert.equal(engine.seats[i].seatIndex, i);
      assert.equal(engine.seats[i].player, null);
      assert.equal(engine.seats[i].status, 'empty');
    }
  });

  it('should claim an open seat and reject claiming an occupied seat', () => {
    const p1 = playerManager.registerPlayer('sock_1', { name: 'Player1' });
    const p2 = playerManager.registerPlayer('sock_2', { name: 'Player2' });

    // Seat 0 claimed by p1
    const res1 = engine.takeSeat(0, p1.id);
    assert.equal(res1.success, true);
    assert.equal(engine.seats[0].player.id, p1.id);
    assert.equal(engine.currentPhase, PHASES.BETTING);

    // Seat 0 claimed by p2 -> rejected (SEAT_OCCUPIED)
    const res2 = engine.takeSeat(0, p2.id);
    assert.equal(res2.success, false);
    assert.equal(res2.code, 'SEAT_OCCUPIED');

    // Seat 5 claimed by p2 -> accepted
    const res3 = engine.takeSeat(5, p2.id);
    assert.equal(res3.success, true);
    assert.equal(engine.seats[5].player.id, p2.id);
  });

  it('should reject a player taking a second seat at the same table', () => {
    const p = playerManager.registerPlayer('sock_1', { name: 'GreedyPlayer' });
    const res1 = engine.takeSeat(1, p.id);
    assert.equal(res1.success, true);

    const res2 = engine.takeSeat(2, p.id);
    assert.equal(res2.success, false);
    assert.equal(res2.code, 'ALREADY_SEATED');
  });

  it('should deduct chips on placeBet and refund on clearBet', () => {
    const p = playerManager.registerPlayer('sock_1', { name: 'Bettor' });
    engine.takeSeat(2, p.id);
    assert.equal(p.chips, 10000);

    const betRes = engine.placeBet(2, p.id, 500);
    assert.equal(betRes.success, true);
    assert.equal(p.chips, 9500);
    assert.equal(engine.seats[2].bet, 500);

    const clearRes = engine.clearBet(2, p.id);
    assert.equal(clearRes.success, true);
    assert.equal(clearRes.refundedAmount, 500);
    assert.equal(p.chips, 10000);
    assert.equal(engine.seats[2].bet, 0);
  });

  it('should mask dealer hole card in getTableState during DEALING and PLAYER_TURNS', () => {
    const p = playerManager.registerPlayer('sock_1', { name: 'Player' });
    engine.takeSeat(0, p.id);
    engine.placeBet(0, p.id, 100);

    engine.transitionToDealing();
    assert.equal(engine.currentPhase, PHASES.DEALING);
    assert.equal(engine.dealerCards.length, 2);

    const state = engine.getTableState(p.id);
    assert.equal(state.dealerHand.length, 2);
    assert.equal(state.dealerHand[0].suit, engine.dealerCards[0].suit);
    assert.equal(state.dealerHand[1].hidden, true);
    assert.equal(state.dealerHand[1].rank, undefined, 'Hole card rank must be hidden');
  });

  it('should reveal dealer hole card in DEALER_TURN and PAYOUT phases', () => {
    const p = playerManager.registerPlayer('sock_1', { name: 'Player' });
    engine.takeSeat(0, p.id);
    engine.placeBet(0, p.id, 100);

    engine.transitionToDealing();
    engine.transitionToDealerTurn();

    assert.equal(engine.currentPhase, PHASES.DEALER_TURN);
    const state = engine.getTableState(p.id);
    assert.equal(state.dealerHand[1].hidden, undefined);
    assert.equal(state.dealerHand[1].rank, engine.dealerCards[1].rank);
  });

  it('should enforce 15s turn timeout auto-stand anti-stall', () => {
    const p1 = playerManager.registerPlayer('sock_1', { name: 'SlowPlayer' });
    engine.takeSeat(0, p1.id);
    engine.placeBet(0, p1.id, 100);

    engine.transitionToDealing();
    // Force player cards to 16 and dealer cards to 15 (no natural BJ)
    engine.seats[0].hands[0].cards = [{ rank: '10' }, { rank: '6' }];
    engine.seats[0].hands[0].status = 'active';
    engine.dealerCards = [{ rank: '7' }, { rank: '8' }];

    engine.transitionToPlayerTurns();
    assert.ok(engine.activeTurn);
    assert.equal(engine.activeTurn.seatIndex, 0);

    // Call autoStand
    engine.autoStand(0, 0);
    assert.equal(engine.seats[0].hands[0].status, 'stood');
    // Advances to dealer turn since no other players
    assert.equal(engine.currentPhase, PHASES.DEALER_TURN);
  });

  it('should skip dealer drawing when all player hands have busted', () => {
    const p = playerManager.registerPlayer('sock_1', { name: 'BustedPlayer' });
    engine.takeSeat(1, p.id);
    engine.placeBet(1, p.id, 100);

    engine.transitionToDealing();
    // Force player hand to 25 (busted)
    engine.seats[1].hands[0].cards = [{ rank: '10' }, { rank: '6' }, { rank: '9' }];
    engine.seats[1].hands[0].status = 'busted';

    // Dealer has 14 (would normally hit under S17)
    engine.dealerCards = [{ rank: '10' }, { rank: '4' }];

    engine.transitionToDealerTurn();
    // Since all players busted, dealer should NOT draw
    assert.equal(engine.dealerCards.length, 2, 'Dealer should skip drawing when all players bust');
  });

  it('should track hasActiveBets and getActiveBetTotal accurately for bet lock', () => {
    const p = playerManager.registerPlayer('sock_1', { name: 'LockedPlayer' });
    engine.takeSeat(3, p.id);

    assert.equal(engine.hasActiveBets(p.id), false);
    assert.equal(engine.getActiveBetTotal(p.id), 0);

    engine.placeBet(3, p.id, 750);
    assert.equal(engine.hasActiveBets(p.id), true);
    assert.equal(engine.getActiveBetTotal(p.id), 750);

    // Clear bet unlocks
    engine.clearBet(3, p.id);
    assert.equal(engine.hasActiveBets(p.id), false);
    assert.equal(engine.getActiveBetTotal(p.id), 0);
  });
});
