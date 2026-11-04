const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const PlayerManager = require('../../server/game/playerManager');
const RouletteEngine = require('../../server/game/rouletteEngine');
const { PHASES, BET_TYPES } = require('../../server/game/rouletteConstants');

describe('RouletteEngine State Machine & Round Lifecycle', () => {
  let pm;
  let engine;

  beforeEach(() => {
    pm = new PlayerManager();
    engine = new RouletteEngine(pm);
  });

  afterEach(() => {
    engine.stop();
  });

  it('should initialize in BETTING phase with 20s countdown', () => {
    assert.equal(engine.currentPhase, PHASES.BETTING);
    assert.equal(engine.timeLeft, 20);
    assert.equal(engine.phaseDuration, 20);
    assert.equal(engine.winningNumber, null);
  });

  it('should allow placing valid bets during BETTING phase and deduct chips', () => {
    const player = pm.registerPlayer('s1', { name: 'Alice' });
    const res = engine.placeBet(player.id, {
      type: BET_TYPES.STRAIGHT,
      value: 17,
      amount: 500
    });

    assert.equal(res.success, true);
    assert.equal(res.remainingChips, 9500);
    assert.equal(res.tableChipsTotal, 500);
    assert.equal(player.chips, 9500);
  });

  it('should allow clearing bets and refunding chips in BETTING phase', () => {
    const player = pm.registerPlayer('s1', { name: 'Alice' });
    engine.placeBet(player.id, { type: BET_TYPES.RED, value: null, amount: 1000 });
    engine.placeBet(player.id, { type: BET_TYPES.STRAIGHT, value: 7, amount: 500 });
    assert.equal(player.chips, 8500);
    assert.equal(engine.tableChipsTotal, 1500);

    const cleared = engine.clearBets(player.id);
    assert.equal(cleared.success, true);
    assert.equal(cleared.refundedAmount, 1500);
    assert.equal(cleared.chips, 10000);
    assert.equal(cleared.tableChipsTotal, 0);
    assert.equal(player.chips, 10000);
  });

  it('should reject placing bets once transitioned to SPINNING phase', () => {
    const player = pm.registerPlayer('s1', { name: 'Alice' });
    engine.transitionToSpinning();

    assert.equal(engine.currentPhase, PHASES.SPINNING);
    assert.notEqual(engine.winningNumber, null);
    assert.ok(engine.winningNumber >= 0 && engine.winningNumber <= 36);

    const res = engine.placeBet(player.id, {
      type: BET_TYPES.BLACK,
      value: null,
      amount: 100
    });

    assert.equal(res.success, false);
    assert.equal(res.code, 'BETS_CLOSED');
    assert.equal(player.chips, 10000);
  });

  it('should resolve payouts, credit winnings, and log history in PAYOUT phase', () => {
    const p1 = pm.registerPlayer('s1', { name: 'Winner' });
    const p2 = pm.registerPlayer('s2', { name: 'Loser' });

    // Force deterministic winning number for testing by manipulating after transition
    engine.placeBet(p1.id, { type: BET_TYPES.STRAIGHT, value: 17, amount: 100 });
    engine.placeBet(p2.id, { type: BET_TYPES.STRAIGHT, value: 8, amount: 100 });

    engine.transitionToSpinning();
    engine.winningNumber = 17;
    engine.winningColor = 'black';

    let roundResultReceived = null;
    engine.once('round_result', (data) => {
      roundResultReceived = data;
    });

    engine.transitionToPayout();

    assert.equal(engine.currentPhase, PHASES.PAYOUT);
    assert.ok(roundResultReceived);
    assert.equal(roundResultReceived.winningNumber, 17);
    assert.equal(roundResultReceived.history[0], 17);

    // P1 won 3600 (original stake was 100, remaining after bet was 9900 -> now 9900 + 3600 = 13500)
    assert.equal(p1.chips, 13500);
    // P2 lost 100 (remaining 9900)
    assert.equal(p2.chips, 9900);
  });

  it('should reset table and bets when transitioning back to BETTING', () => {
    const p1 = pm.registerPlayer('s1', { name: 'Alice' });
    engine.placeBet(p1.id, { type: BET_TYPES.RED, value: null, amount: 200 });

    engine.transitionToSpinning();
    engine.transitionToPayout();
    engine.transitionToBetting();

    assert.equal(engine.currentPhase, PHASES.BETTING);
    assert.equal(engine.tableChipsTotal, 0);
    assert.equal(engine.bets.size, 0);
    assert.equal(engine.winningNumber, null);
  });

  it('forceSpin should trigger transition from BETTING to SPINNING', () => {
    assert.equal(engine.currentPhase, PHASES.BETTING);
    const triggered = engine.forceSpin();
    assert.equal(triggered, true);
    assert.equal(engine.currentPhase, PHASES.SPINNING);
  });
});
