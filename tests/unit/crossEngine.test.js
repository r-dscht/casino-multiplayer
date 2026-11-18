/**
 * crossEngine.test.js
 * Unit tests for Monte Carlo Boulevard Cross math invariants (>= 2% casino edge / ~98% RTP),
 * state lifecycle, BankManager win repayments, client-server parity, and project guardrails.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';

const PlayerManager = require('../../server/game/playerManager');
const BankManager = require('../../server/game/bankManager');
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
  VEHICLE_TYPES,
  calculateCrossMultiplier,
  calculateCrossPayout,
  getCrossLadderPreview
} = require('../../server/game/crossConstants');
const CrossEngine = require('../../server/game/crossEngine');
const { calcClientMultiplier } = require('../../client/js/cross');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function makePlayerSetup(chips = 10000) {
  const pm = new PlayerManager({ storagePath: false });
  const bm = new BankManager(pm, { storagePath: false });
  const res = pm.registerPlayer('sock-c1', { name: 'RenzoCross', color: '#d4af37' });
  const player = res;
  player.chips = chips;
  const engine = new CrossEngine({ playerManager: pm, bankManager: bm });
  engine.start();
  return { pm, bm, player, engine };
}

describe('Monte Carlo Boulevard Cross Math & Invariants', () => {
  it('enforces uniform 20% crash / 80% survival and <= 98% theoretical RTP on lanes 1..30', () => {
    assert.equal(TARGET_RTP, 0.98);
    assert.equal(HIT_NUMERATOR, 1);
    assert.equal(HIT_DENOMINATOR, 5);
    assert.equal(HIT_PROBABILITY, 0.2);
    assert.ok(Math.abs(SURVIVAL_PROBABILITY - 0.8) < 1e-12);
    assert.equal(VEHICLE_TYPES.length, 5);

    let prev = 1.0;
    for (let lane = 1; lane <= 30; lane += 1) {
      const mult = calculateCrossMultiplier(lane);
      const clientMult = calcClientMultiplier(lane);
      assert.equal(clientMult, mult, `Client multiplier mismatch at lane ${lane}`);
      assert.ok(mult >= prev, `Multiplier decreased at lane ${lane}`);
      prev = mult;

      const theoreticalRtp = mult * Math.pow(SURVIVAL_PROBABILITY, lane);
      assert.ok(
        theoreticalRtp <= TARGET_RTP + 1e-12,
        `House edge violated at lane ${lane}: RTP=${theoreticalRtp}`
      );
      if (mult < MAX_MULTIPLIER) {
        assert.ok(
          theoreticalRtp >= 0.94,
          `RTP fell unexpectedly low at lane ${lane}: RTP=${theoreticalRtp}`
        );
      }
    }

    assert.equal(calculateCrossMultiplier(0), 1.0);
    assert.equal(calculateCrossMultiplier(-2), 1.0);
    assert.equal(calculateCrossMultiplier(100), MAX_MULTIPLIER);
  });

  it('caps payout strictly at MAX_PAYOUT and floors integer chips', () => {
    assert.equal(calculateCrossPayout(100, 1), 122);
    assert.equal(calculateCrossPayout(50000, 30), MAX_PAYOUT);
    const ladder = getCrossLadderPreview(100, 1, 5);
    assert.equal(ladder.length, 5);
    assert.equal(ladder[0].lane, 1);
    assert.equal(ladder[0].multiplier, 1.22);
    assert.equal(ladder[0].payout, 122);
  });

  it('converges near ~98% RTP across 40,000 simulated single-lane and multi-lane strategies', () => {
    // Deterministic seeded PRNG (Mulberry32) for fast zero-flake statistical test
    let seed = 0x5eed1337;
    function nextRand() {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    const runs = 40000;
    const bet = 100;
    let totalWagered = 0;
    let totalReturned = 0;

    for (let i = 0; i < runs; i += 1) {
      const targetStop = (i % 5) + 1;
      totalWagered += bet;
      let alive = true;
      for (let lane = 1; lane <= targetStop; lane += 1) {
        if (Math.floor(nextRand() * HIT_DENOMINATOR) < HIT_NUMERATOR) {
          alive = false;
          break;
        }
      }
      if (alive) {
        totalReturned += calculateCrossPayout(bet, targetStop);
      }
    }

    const empiricalRtp = totalReturned / totalWagered;
    assert.ok(
      empiricalRtp > 0.94 && empiricalRtp < 1.01,
      `Expected empirical RTP near 0.98, got ${empiricalRtp.toFixed(4)}`
    );
  });
});

describe('CrossEngine Lifecycle, Repayments & Security', () => {
  it('validates bets, locks navigation during active run, handles safe steps and full cashout', () => {
    const { player, engine } = makePlayerSetup(10000);

    const badBet = engine.startRun(player.id, { betAmount: MIN_BET - 1 });
    assert.equal(badBet.ok, false);
    assert.equal(badBet.code, 'INVALID_BET');

    const overBet = engine.startRun(player.id, { betAmount: MAX_BET + 10 });
    assert.equal(overBet.ok, false);
    assert.equal(overBet.code, 'INVALID_BET');

    const started = engine.startRun(player.id, { betAmount: 1000 });
    assert.equal(started.ok, true);
    assert.equal(started.newChips, 9000);
    assert.equal(engine.hasActiveBets(player.id), true);
    assert.equal(engine.getActiveBetTotal(player.id), 1000);

    // Duplicate run rejected
    const dup = engine.startRun(player.id, { betAmount: 100 });
    assert.equal(dup.ok, false);
    assert.equal(dup.code, 'RUN_ALREADY_ACTIVE');

    // Cannot cash out at lane 0
    const earlyCashout = engine.cashout(player.id);
    assert.equal(earlyCashout.ok, false);
    assert.equal(earlyCashout.code, 'CANNOT_CASHOUT_AT_START');

    // Force safe step (roll = 1 >= 1)
    engine.rngInt = (min, max) => (max === HIT_DENOMINATOR ? 1 : 0);
    const step1 = engine.stepForward(player.id);
    assert.equal(step1.ok, true);
    assert.equal(step1.survived, true);
    assert.equal(step1.hit, false);
    assert.equal(step1.lane, 1);
    assert.equal(step1.run.currentMultiplier, 1.22);
    assert.equal(step1.run.currentPayout, 1220);

    const step2 = engine.stepForward(player.id);
    assert.equal(step2.ok, true);
    assert.equal(step2.lane, 2);
    assert.equal(step2.run.currentMultiplier, 1.53);
    assert.equal(step2.run.currentPayout, 1530);

    const cashed = engine.cashout(player.id);
    assert.equal(cashed.ok, true);
    assert.equal(cashed.cashedOut, true);
    assert.equal(cashed.payout, 1530);
    assert.equal(cashed.netProfit, 530);
    assert.equal(cashed.newChips, 10530);
    assert.equal(engine.hasActiveBets(player.id), false);
    assert.equal(engine.getActiveBetTotal(player.id), 0);

    const pub = engine.getPublicState(player.id);
    assert.equal(pub.activeRun, null);
    assert.equal(pub.myHistory.length, 1);
    assert.equal(pub.myHistory[0].outcome, 'CASHED_OUT');
    engine.stop();
  });

  it('settles crash immediately when hit roll triggers and records history', () => {
    const { player, engine } = makePlayerSetup(5000);
    let bigMomentFired = false;
    engine.on('big_moment', () => { bigMomentFired = true; });

    engine.startRun(player.id, { betAmount: 500 });
    engine.rngInt = () => 0; // roll 0 triggers HIT (< HIT_NUMERATOR)

    const hitRes = engine.stepForward(player.id);
    assert.equal(hitRes.ok, true);
    assert.equal(hitRes.hit, true);
    assert.equal(hitRes.survived, false);
    assert.equal(hitRes.lane, 1);
    assert.equal(hitRes.newChips, 4500);
    assert.equal(engine.hasActiveBets(player.id), false);
    assert.equal(bigMomentFired, false);

    const pub = engine.getPublicState(player.id);
    assert.equal(pub.myHistory.length, 1);
    assert.equal(pub.myHistory[0].outcome, 'HIT');
    assert.equal(pub.myHistory[0].netProfit, -500);
    engine.stop();
  });

  it('automatically repays active bank loans from Boulevard Cross profits', () => {
    const { pm, bm, player: borrower, engine } = makePlayerSetup(5000);
    const lender = pm.registerPlayer('sock-c2', { name: 'BankLender', color: '#ffffff' });
    lender.chips = 10000;

    // Issue a direct active loan through BankManager proposal workflow
    const loan = bm.createLoanProposal({
      fromId: borrower.id,
      toId: lender.id,
      type: 'borrow',
      amount: 1000,
      interestPct: 10,
      winDeductionPct: 20
    });
    assert.equal(loan.success, true);
    const accept = bm.acceptProposal(loan.proposal.id, lender.id);
    assert.equal(accept.success, true);

    engine.startRun(borrower.id, { betAmount: 2000 });
    engine.rngInt = (min, max) => (max === HIT_DENOMINATOR ? 3 : 0);
    engine.stepForward(borrower.id); // lane 1 (1.22x => 2440 payout => +440 profit)
    engine.stepForward(borrower.id); // lane 2 (1.53x => 3060 payout => +1060 profit)

    const lenderBefore = lender.chips;
    const cashRes = engine.cashout(borrower.id);
    assert.equal(cashRes.ok, true);
    assert.ok(Array.isArray(cashRes.repayments));
    assert.equal(cashRes.repayments.length, 1);
    assert.ok(cashRes.repayments[0].amount > 0);
    assert.ok(lender.chips > lenderBefore);
    engine.stop();
  });
});

describe('Boulevard Cross UI & Project Guardrails', () => {
  it('wires Cross view, pills, dock button, and enforces zero audio/emoji/GTA guardrails', () => {
    const html = fs.readFileSync(path.join(REPO_ROOT, 'client/index.html'), 'utf8');
    const requiredIds = [
      'id="pill-cross"',
      'data-game="cross"',
      'id="icon-cross"',
      'id="cross-view"',
      'id="cross-canvas"',
      'id="btn-cross-start"',
      'id="btn-cross-step"',
      'id="btn-cross-cashout"',
      'id="cross-salon-list"',
      'id="cross-history-list"'
    ];
    for (const marker of requiredIds) {
      assert.ok(html.includes(marker), `index.html missing ${marker}`);
    }

    // Ensure Avia remains paused while Cross is live
    assert.ok(html.includes('id="pill-avia"'), 'Avia pill should still exist in hidden WIP state');

    const files = [
      'server/game/crossConstants.js',
      'server/game/crossEngine.js',
      'client/js/cross.js'
    ];
    const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    const audioRe = /\b(AudioContext|webkitAudioContext|HTMLAudioElement|new Audio)\b/;
    const gtaRe = /\b(grand theft auto|los santos|gta|rockstar)\b/i;

    for (const rel of files) {
      const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      assert.equal(emojiRe.test(src), false, `Unicode emoji found in ${rel}`);
      assert.equal(audioRe.test(src), false, `Audio API reference found in ${rel}`);
      assert.equal(gtaRe.test(src), false, `Forbidden GTA reference found in ${rel}`);
    }
  });
});
