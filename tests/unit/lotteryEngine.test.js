/**
 * lotteryEngine.test.js
 * Unit tests for Casino Staatsloterij (100% pot payout, 0% house edge, 30-min rounds).
 */

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PlayerManager = require('../../server/game/playerManager');
const BankManager = require('../../server/game/bankManager');
const LotteryEngine = require('../../server/game/lotteryEngine');
const {
  TICKET_PRICE,
  HOUSE_FEE_RATE,
  ROUND_DURATION_MS,
  DRAW_REVEAL_MS,
  PHASES,
  computePlayerOdds
} = require('../../server/game/lotteryConstants');
const CasinoLottery = require('../../client/js/lottery');

describe('LotteryEngine — Casino Staatsloterij Unit Suite', () => {
  const tempFiles = [];
  let activeEngine = null;

  afterEach(() => {
    if (activeEngine) {
      activeEngine.stop();
      activeEngine = null;
    }
    while (tempFiles.length > 0) {
      const f = tempFiles.pop();
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch (e) {}
    }
  });

  it('L1: enforces 2500 ticket price, 0% house edge, and exact 30-minute default round', () => {
    assert.equal(TICKET_PRICE, 2500);
    assert.equal(HOUSE_FEE_RATE, 0);
    assert.equal(ROUND_DURATION_MS, 30 * 60 * 1000);
    assert.equal(DRAW_REVEAL_MS, 8000);
    assert.deepEqual(computePlayerOdds(250, 1000), { share: 0.25, sharePct: 25 });
  });

  it('L2: supports unlimited large bulk purchases across ranges and proportional weighted draws', () => {
    const pm = new PlayerManager({ storagePath: false });
    const alice = pm.registerPlayer('s1', { name: 'Alice' });
    const bob = pm.registerPlayer('s2', { name: 'Bob' });
    pm.resetBankroll(alice.id, 10000000); // 10M chips
    pm.resetBankroll(bob.id, 10000000);

    // Deterministic RNG pointing to late index (99%) -> lands inside Bob's range
    let rngCursor = 0;
    const rngValues = [0.99, 0.25];
    activeEngine = new LotteryEngine(pm, {
      storagePath: false,
      rng: () => {
        const val = rngValues[rngCursor % rngValues.length];
        rngCursor += 1;
        return val;
      }
    });

    // Alice buys 1000 tickets in one batch, then 500 more
    const b1 = activeEngine.buyTickets(alice.id, 1000);
    assert.equal(b1.ok, true);
    assert.equal(b1.startTicket, 1);
    assert.equal(b1.endTicket, 1000);

    const b2 = activeEngine.buyTickets(alice.id, 500);
    assert.equal(b2.ok, true);
    assert.equal(b2.startTicket, 1001);
    assert.equal(b2.endTicket, 1500);

    // Bob buys 500 tickets (#1501..#2000 -> 25% odds)
    const b3 = activeEngine.buyTickets(bob.id, 500);
    assert.equal(b3.ok, true);
    assert.equal(b3.startTicket, 1501);
    assert.equal(b3.endTicket, 2000);

    const state = activeEngine.getPublicState(alice.id);
    assert.equal(state.totalTickets, 2000);
    assert.equal(state.pot, 2000 * 2500); // 5,000,000 chips, 0% rake
    assert.equal(state.mySummary.tickets, 1500);
    assert.equal(state.mySummary.sharePct, 75);

    const draws = [];
    activeEngine.on('draw_result', (res) => draws.push(res));
    activeEngine.tick(activeEngine.roundEndsAt + 1);

    assert.equal(activeEngine.phase, PHASES.DRAWING);
    assert.equal(draws.length, 1);
    assert.equal(draws[0].winningTicketDisplay, 1981); // floor(0.99 * 2000) + 1
    assert.equal(draws[0].winnerId, bob.id);
    assert.equal(draws[0].potWon, 5000000);
    assert.equal(draws[0].reelEntries.length, 48);
    assert.equal(draws[0].reelEntries[draws[0].winnerSlot].isWinner, true);
    assert.equal(draws[0].reelEntries[draws[0].winnerSlot].playerId, bob.id);

    // Bob had 10M - 1.25M + 5M pot = 13.75M; Alice had 10M - 3.75M = 6.25M; Sum === 20M (zero rake)
    assert.equal(bob.chips + alice.chips, 20000000);
  });

  it('L3: empty round advances without payout and single-buyer round triggers zero netProfit loan deduction', () => {
    const pm = new PlayerManager({ storagePath: false });
    const bm = new BankManager(pm, { storagePath: false });
    const alice = pm.registerPlayer('sa', { name: 'Alice' });
    const lender = pm.registerPlayer('sl', { name: 'Lender' });
    pm.resetBankroll(alice.id, 20000);
    pm.resetBankroll(lender.id, 20000);

    const prop = bm.createLoanProposal({
      fromId: alice.id,
      toId: lender.id,
      type: 'borrow',
      amount: 5000,
      interestPct: 0,
      winDeductionPct: 50
    });
    bm.acceptProposal(prop.proposal.id, lender.id);

    let repayCalls = 0;
    const origRepay = bm.processWinRepayment.bind(bm);
    bm.processWinRepayment = (...args) => {
      repayCalls += 1;
      return origRepay(...args);
    };

    activeEngine = new LotteryEngine(pm, {
      bankManager: bm,
      storagePath: false,
      rng: () => 0.1
    });

    // Empty round 1 -> skips directly to round 2 without DRAWING phase or payout
    activeEngine.tick(activeEngine.roundEndsAt + 1);
    assert.equal(activeEngine.roundId, 2);
    assert.equal(activeEngine.phase, PHASES.OPEN);
    assert.equal(repayCalls, 0);

    // Single buyer in round 2 -> netProfit === 0 so no loan deduction triggers
    const aliceStart = alice.chips;
    activeEngine.buyTickets(alice.id, 2);
    activeEngine.tick(activeEngine.roundEndsAt + 1);
    assert.equal(activeEngine.phase, PHASES.DRAWING);
    assert.equal(alice.chips, aliceStart);
    assert.equal(repayCalls, 0);

    // Advance past reveal duration -> starts Round 3 clean
    activeEngine.tick(activeEngine.drawEndsAt + 1);
    assert.equal(activeEngine.roundId, 3);
    assert.equal(activeEngine.phase, PHASES.OPEN);
    assert.equal(activeEngine.totalTickets, 0);
    assert.equal(activeEngine.pot, 0);
  });

  it('L4: multi-player win repays debt on net profit and credits offline saved accounts cleanly', () => {
    const pm = new PlayerManager({ storagePath: false });
    const bm = new BankManager(pm, { storagePath: false });
    const alice = pm.registerPlayer('sa', { name: 'OfflineWinner' });
    const bob = pm.registerPlayer('sb', { name: 'Challenger' });
    pm.resetBankroll(alice.id, 10000);
    pm.resetBankroll(bob.id, 10000);

    const prop = bm.createLoanProposal({
      fromId: alice.id,
      toId: bob.id,
      type: 'borrow',
      amount: 2000,
      interestPct: 0,
      winDeductionPct: 20
    });
    bm.acceptProposal(prop.proposal.id, bob.id);

    activeEngine = new LotteryEngine(pm, {
      bankManager: bm,
      storagePath: false,
      rng: () => 0.05 // picks ticket #1 -> Alice
    });

    activeEngine.buyTickets(alice.id, 1); // spent 2500
    activeEngine.buyTickets(bob.id, 3);   // spent 7500 -> pot = 10000 -> Alice netProfit = 7500

    // Simulate Alice completely offline and absent from in-memory `players` Map (as after restart)
    const aliceSnapshotChips = alice.chips;
    const savedAcc = pm.accounts.get(alice.usernameKey);
    assert.ok(savedAcc, 'Alice must exist in accounts');
    pm.players.delete(alice.id);

    const draws = [];
    activeEngine.on('draw_result', (r) => draws.push(r));
    activeEngine.tick(activeEngine.roundEndsAt + 1);

    assert.equal(draws.length, 1);
    assert.equal(draws[0].winnerId, alice.id);
    assert.equal(draws[0].potWon, 10000);
    assert.equal(draws[0].netProfit, 7500);
    assert.equal(draws[0].winnerWasOffline, true);
    assert.equal(savedAcc.chips, aliceSnapshotChips + 10000);
    assert.ok(bm.getPlayerNotifications(savedAcc).length >= 1, 'Offline winner receives inbox notification');
  });

  it('L5: rejects invalid quantities, insufficient funds, and buys during DRAWING reveal', () => {
    const pm = new PlayerManager({ storagePath: false });
    const p = pm.registerPlayer('sp', { name: 'Tester' });
    pm.resetBankroll(p.id, 3000);

    activeEngine = new LotteryEngine(pm, { storagePath: false, rng: () => 0 });

    assert.equal(activeEngine.buyTickets(p.id, 0).ok, false);
    assert.equal(activeEngine.buyTickets(p.id, -2).ok, false);
    assert.equal(activeEngine.buyTickets(p.id, 1.5).ok, false);
    assert.equal(activeEngine.buyTickets(p.id, 2).code, 'INSUFFICIENT_FUNDS'); // 5000 > 3000

    assert.equal(activeEngine.buyTickets(p.id, 1).ok, true);
    activeEngine.tick(activeEngine.roundEndsAt + 1);
    assert.equal(activeEngine.phase, PHASES.DRAWING);

    const duringDraw = activeEngine.buyTickets(p.id, 1);
    assert.equal(duringDraw.ok, false);
    assert.equal(duringDraw.code, 'DRAW_IN_PROGRESS');
  });

  it('L6: persists active pot, ticket ranges, roundId, and history to lottery.json across restarts', () => {
    const tmpFile = path.join(os.tmpdir(), `lottery-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    tempFiles.push(tmpFile);

    const pm = new PlayerManager({ storagePath: false });
    const alice = pm.registerPlayer('sa', { name: 'PersistAlice' });
    pm.resetBankroll(alice.id, 50000);

    const e1 = new LotteryEngine(pm, { storagePath: tmpFile, debounceMs: 0 });
    e1.buyTickets(alice.id, 4);
    e1.saveStateSync();
    const expectedEndsAt = e1.roundEndsAt;
    e1.stop();

    const e2 = new LotteryEngine(pm, { storagePath: tmpFile, debounceMs: 0 });
    activeEngine = e2;
    const restored = e2.getPublicState(alice.id);
    assert.equal(restored.totalTickets, 4);
    assert.equal(restored.pot, 10000);
    assert.equal(restored.mySummary.tickets, 4);
    assert.equal(restored.mySummary.sharePct, 100);
    assert.equal(e2.roundEndsAt, expectedEndsAt);
  });

  it('L7: client CasinoLottery computes live buy preview accurately without DOM and enforces zero audio/emoji guardrails', () => {
    const ctrl = new CasinoLottery({
      network: { on: () => {}, buyLotteryTickets: () => {}, requestLotteryState: () => {} },
      ui: { myPlayer: { id: 'p1', chips: 25000 } }
    });

    ctrl.applyState({
      roundId: 3,
      phase: 'OPEN',
      secondsRemaining: 300,
      pot: 7500,
      totalTickets: 3,
      uniqueParticipants: 1,
      mySummary: { tickets: 1, totalSpent: 2500, sharePct: 33.33, ranges: [{ start: 1, end: 1, count: 1 }] }
    });

    const p2 = ctrl.computePreview(2);
    assert.equal(p2.count, 2);
    assert.equal(p2.totalCost, 5000);
    assert.equal(p2.canAfford, true);
    assert.equal(p2.newOwnTickets, 3);
    assert.equal(p2.newTotalTickets, 5);
    assert.equal(p2.estimatedPct, 60);

    const pTooHigh = ctrl.computePreview(11); // 27,500 > 25,000 chips
    assert.equal(pTooHigh.canAfford, false);

    // Zero audio & zero Unicode emojis across all 3 lottery source files
    const files = [
      path.join(__dirname, '../../server/game/lotteryConstants.js'),
      path.join(__dirname, '../../server/game/lotteryEngine.js'),
      path.join(__dirname, '../../client/js/lottery.js')
    ];
    const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    for (const f of files) {
      const code = fs.readFileSync(f, 'utf8');
      assert.equal(emojiRe.test(code), false, `${path.basename(f)} must contain zero Unicode emojis`);
      assert.equal(/AudioContext|<audio|new Audio\s*\(/i.test(code), false, `${path.basename(f)} must contain zero audio APIs`);
    }
  });
});
