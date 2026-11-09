/**
 * crashEngine.test.js
 * Unit and integration tests for Multiplayer Velocity Crash Engine & UI Controller.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PlayerManager = require('../server/game/playerManager');
const BankManager = require('../server/game/bankManager');
const CrashEngine = require('../server/game/crashEngine');

describe('CrashEngine — Multiplayer Velocity Crash Suite', () => {
  let playerManager;
  let bankManager;
  let crashEngine;
  let p1;
  let p2;

  beforeEach(() => {
    playerManager = new PlayerManager({ storagePath: null });
    bankManager = new BankManager(playerManager);
    crashEngine = new CrashEngine(playerManager, { bankManager });

    p1 = playerManager.registerPlayer('sock_1', { name: 'Renzo', color: '#D4AF37' });
    p2 = playerManager.registerPlayer('sock_2', { name: 'Brent', color: '#10b981' });
  });

  afterEach(() => {
    crashEngine.stop();
  });

  it('C1: Mathematical curve & inverse functions are monotonic and accurate', () => {
    assert.equal(CrashEngine.computeMultiplierAtElapsedMs(0), 1.00);

    const t2x = CrashEngine.computeElapsedMsForMultiplier(2.00);
    assert.ok(t2x > 7000 && t2x < 8000, `Expected ~7.43s for 2.00x, got ${t2x}ms`);

    const mAtT2x = CrashEngine.computeMultiplierAtElapsedMs(t2x + 20);
    assert.ok(mAtT2x >= 2.00 && mAtT2x <= 2.05);

    for (let i = 0; i < 200; i++) {
      const cp = crashEngine.generateCrashPoint();
      assert.ok(cp >= 1.00 && cp <= 1000.00, `Crash point out of bounds: ${cp}`);
    }
  });

  it('C2: Places, stacks, and cancels bets during BETTING phase with exact chip accounting', () => {
    const res1 = crashEngine.placeBet(p1.id, { amount: 500, autoCashout: 2.50 });
    assert.equal(res1.success, true);
    assert.equal(res1.bet.amount, 500);
    assert.equal(res1.bet.autoCashout, 2.50);
    assert.equal(p1.chips, 9500);
    assert.equal(crashEngine.hasActiveBets(p1.id), true);

    // Stack additional bet in same BETTING phase
    const res2 = crashEngine.placeBet(p1.id, { amount: 500 });
    assert.equal(res2.success, true);
    assert.equal(res2.bet.amount, 1000);
    assert.equal(res2.bet.autoCashout, 2.50);
    assert.equal(p1.chips, 9000);

    // Cancel bet returns full 1000 chips
    const cancelRes = crashEngine.cancelBet(p1.id);
    assert.equal(cancelRes.success, true);
    assert.equal(cancelRes.refunded, 1000);
    assert.equal(p1.chips, 10000);
    assert.equal(crashEngine.hasActiveBets(p1.id), false);
  });

  it('C3: Hides crashPoint during BETTING and RUNNING, reveals only on CRASHED', () => {
    crashEngine.placeBet(p1.id, { amount: 200 });
    assert.equal(crashEngine.getTableState().crashPoint, null);

    crashEngine.startRunningPhase(4.50);
    assert.equal(crashEngine.currentPhase, 'RUNNING');
    assert.equal(crashEngine.getTableState().crashPoint, null);

    crashEngine.triggerCrash();
    assert.equal(crashEngine.currentPhase, 'CRASHED');
    assert.equal(crashEngine.getTableState().crashPoint, 4.50);
  });

  it('C4: Manual Cash Out credits exact floor(amount * mult) and unlocks navigation immediately', () => {
    crashEngine.placeBet(p1.id, { amount: 1000 });
    crashEngine.placeBet(p2.id, { amount: 1000 });

    crashEngine.startRunningPhase(5.00);
    const elapsedFor2_5x = CrashEngine.computeElapsedMsForMultiplier(2.50) + 15;
    crashEngine.flightStartTime = Date.now() - elapsedFor2_5x;
    crashEngine.stepFlight(elapsedFor2_5x);

    // p1 cashes out manually at ~2.50x
    const cashRes = crashEngine.cashOut(p1.id);
    assert.equal(cashRes.success, true);
    assert.ok(cashRes.cashoutMultiplier >= 2.50);
    assert.equal(cashRes.payout, Math.floor(1000 * cashRes.cashoutMultiplier));
    assert.equal(p1.chips, 9000 + cashRes.payout);

    // Navigation unlocked for p1 immediately after cashout, still locked for p2
    assert.equal(crashEngine.hasActiveBets(p1.id), false);
    assert.equal(crashEngine.hasActiveBets(p2.id), true);

    // Now round crashes at 5.00x; p2 loses bet
    crashEngine.triggerCrash();
    assert.equal(p2.chips, 9000);
    assert.equal(crashEngine.hasActiveBets(p2.id), false);
  });

  it('C5: Server-authoritative Auto-Cashout executes at exact target multiplier even across large tick steps', () => {
    crashEngine.placeBet(p1.id, { amount: 1000, autoCashout: 2.00 });
    crashEngine.startRunningPhase(2.10);

    // Jump straight to crashElapsedMs (2.10x) -> p1 must still auto-cashout at exact 2.00x!
    crashEngine.stepFlight(crashEngine.crashElapsedMs);

    assert.equal(crashEngine.currentPhase, 'CRASHED');
    assert.equal(p1.chips, 11000); // 9000 + 2000 payout
  });

  it('C6: Zero-Audio & Zero-Emoji Guardrails on Crash files', () => {
    const engineCode = fs.readFileSync(path.join(__dirname, '../server/game/crashEngine.js'), 'utf8');
    const clientCode = fs.readFileSync(path.join(__dirname, '../client/js/crash.js'), 'utf8');
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;

    assert.equal(emojiRegex.test(engineCode), false, 'crashEngine.js must not contain unicode emojis');
    assert.equal(emojiRegex.test(clientCode), false, 'crash.js must not contain unicode emojis');
    assert.equal(/AudioContext|new Audio/i.test(clientCode), false, 'crash.js must not contain audio code');
  });
});
