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

  it('L1: enforces 2500 ticket price, 0% house edge, and exact 10-minute default round', () => {
    assert.equal(TICKET_PRICE, 2500);
    assert.equal(HOUSE_FEE_RATE, 0);
    assert.equal(ROUND_DURATION_MS, 10 * 60 * 1000);
    assert.equal(DRAW_REVEAL_MS, 12000);
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
    assert.equal(draws[0].reelEntries.length, 64);
    assert.equal(draws[0].winnerSlot, 52);
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
    // 20% of 7500 netProfit = 1500 auto-repaid directly to lender even while offline
    assert.equal(draws[0].repayments.length, 1);
    assert.equal(draws[0].repayments[0].amount, 1500);
    assert.equal(savedAcc.chips, aliceSnapshotChips + 10000 - 1500);
    assert.ok(savedAcc.stats && savedAcc.stats.totalWon >= 10000, 'Offline winner stats updated');
    assert.ok(bm.getPlayerNotifications(savedAcc).length >= 1, 'Offline winner receives inbox notification');

    // Verify unseenOfflineWins exposes myPendingOfflineWin on reconnect until acknowledged
    const pending = activeEngine.getPublicState(alice.id).myPendingOfflineWin;
    assert.ok(pending && pending.roundId === draws[0].roundId && pending.potWon === 10000);
    assert.equal(activeEngine.acknowledgeOfflineWin(alice.id, alice.name, draws[0].roundId), true);
    assert.equal(activeEngine.getPublicState(alice.id).myPendingOfflineWin, null);
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
    if (ctrl._localTickTimer) clearInterval(ctrl._localTickTimer);
  });

  it('L8: prevents double-draw when restarting during DRAWING phase and catches up overdue & multi-round downtime on wall-clock schedule', () => {
    const tmpLot = path.join(os.tmpdir(), `lottery-l8-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    const tmpPlayers = path.join(os.tmpdir(), `players-l8-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    tempFiles.push(tmpLot, tmpPlayers);

    const pm1 = new PlayerManager({ storagePath: tmpPlayers, debounceMs: 0 });
    const winner = pm1.registerPlayer('sw', { name: 'RenzoOffline' });
    const other = pm1.registerPlayer('so', { name: 'OpponentOffline' });
    pm1.resetBankroll(winner.id, 200000);
    pm1.resetBankroll(other.id, 200000);

    const e1 = new LotteryEngine(pm1, {
      storagePath: tmpLot,
      debounceMs: 0,
      roundDurationMs: 600000,
      drawRevealMs: 12000,
      rng: () => 0.1 // picks ticket inside winner's first range
    });
    e1.buyTickets(winner.id, 40); // 100,000 F -> 100,000 left
    e1.buyTickets(other.id, 40);  // 100,000 F -> 100,000 left
    e1.tick(e1.roundEndsAt + 1);  // draws while online -> DRAWING phase, winner gets 200,000 -> 300,000
    assert.equal(e1.phase, PHASES.DRAWING);
    assert.equal(winner.chips, 300000);
    const savedRoundId = e1.roundId;
    e1.stop();

    // Restart DURING active DRAWING reveal window: must NOT draw twice or double-pay
    const pm2 = new PlayerManager({ storagePath: tmpPlayers, debounceMs: 0 });
    const e2 = new LotteryEngine(pm2, {
      storagePath: tmpLot,
      debounceMs: 0,
      roundDurationMs: 600000,
      drawRevealMs: 12000
    });
    assert.equal(e2.phase, PHASES.DRAWING);
    assert.equal(e2.roundId, savedRoundId);
    e2.tick(Date.now());
    assert.equal(e2.history.filter((h) => h.roundId === savedRoundId).length, 1);
    const wAcc2 = pm2.accounts.get('renzooffline');
    assert.equal(wAcc2.chips, 300000);
    e2.stop();

    // Now test restarting AFTER overdue OPEN deadline (simulates 25m downtime past deadline)
    const raw = JSON.parse(fs.readFileSync(tmpLot, 'utf8'));
    raw.phase = PHASES.OPEN;
    raw.roundId = 10;
    raw.roundEndsAt = Date.now() - (25 * 60 * 1000); // ended 25 minutes ago (2.5 cycles)
    raw.drawEndsAt = 0;
    raw.settledRoundIds = [savedRoundId];
    raw.ranges = [
      { startTicket: 0, endTicket: 39, count: 40, playerId: winner.id, playerName: 'RenzoOffline', playerColor: '#D4AF37' },
      { startTicket: 40, endTicket: 79, count: 40, playerId: other.id, playerName: 'OpponentOffline', playerColor: '#3B82F6' }
    ];
    fs.writeFileSync(tmpLot, JSON.stringify(raw, null, 2), 'utf8');

    const pm3 = new PlayerManager({ storagePath: tmpPlayers, debounceMs: 0 });
    const e3 = new LotteryEngine(pm3, {
      storagePath: tmpLot,
      debounceMs: 0,
      roundDurationMs: 600000,
      drawRevealMs: 12000,
      rng: () => 0.1 // RenzoOffline wins +200,000
    });
    activeEngine = e3;
    const now = Date.now();
    e3.tick(now);

    assert.equal(e3.phase, PHASES.OPEN);
    assert.equal(e3.totalTickets, 0);
    // 25m elapsed = 2 missed cycles + 1 drawn = +3 roundIds -> roundId 13, 5m remaining
    assert.equal(e3.roundId, 13);
    assert.ok(e3.roundEndsAt > now && e3.roundEndsAt <= now + 600000);
    assert.equal(pm3.accounts.get('renzooffline').chips, 500000);
    assert.ok(e3.hasPendingOfflineWin(winner.id, 'RenzoOffline'));
    assert.ok(e3.hasPendingOfflineOutcome(other.id, 'OpponentOffline'));
  });

  it('L9: restores 100k unsettled stake from client backup after server wipe (active & lapsed) and blocks replay', () => {
    const pm = new PlayerManager({ storagePath: false });
    const player = pm.registerPlayer('sr', { name: 'BackupPlayer' });
    pm.resetBankroll(player.id, 500000); // already reflects post-purchase balance after wipe

    activeEngine = new LotteryEngine(pm, {
      storagePath: false,
      roundDurationMs: 600000,
      drawRevealMs: 12000,
      rng: () => 0.5
    });

    const futureEndsAt = Date.now() + 240000;
    const activeRes = activeEngine.restoreFromBackup(player, {
      roundId: 4,
      roundEndsAt: futureEndsAt,
      tickets: 40,
      totalSpent: 100000,
      playerId: player.id,
      playerName: 'BackupPlayer'
    });
    assert.equal(activeRes.restored, true);
    assert.equal(activeRes.drawExecuted, false);
    assert.equal(activeEngine.roundId, 4);
    assert.equal(activeEngine.pot, 100000);
    assert.equal(activeEngine.getPublicState(player.id).mySummary.tickets, 40);
    assert.equal(player.chips, 500000); // must not double-deduct chips

    // Replay with exact same backup must be ignored
    const dupRes = activeEngine.restoreFromBackup(player, {
      roundId: 4,
      roundEndsAt: futureEndsAt,
      tickets: 40,
      totalSpent: 100000,
      playerId: player.id,
      playerName: 'BackupPlayer'
    });
    assert.equal(dupRes.restored, false);

    // Fresh wiped engine with lapsed round (server asleep past deadline): draws and credits 100k pot immediately
    const lapsedEngine = new LotteryEngine(pm, {
      storagePath: false,
      roundDurationMs: 600000,
      drawRevealMs: 12000,
      rng: () => 0.25
    });
    const pastEndsAt = Date.now() - 120000; // 2 min overdue (> 12s reveal)
    const lapsedRes = lapsedEngine.restoreFromBackup(player, {
      roundId: 2,
      roundEndsAt: pastEndsAt,
      tickets: 40,
      totalSpent: 100000,
      playerId: player.id,
      playerName: 'BackupPlayer'
    });
    assert.equal(lapsedRes.restored, true);
    assert.equal(lapsedRes.drawExecuted, true);
    assert.equal(lapsedRes.resolvedRoundId, 2);
    assert.equal(player.chips, 600000); // +100k pot returned cleanly
    assert.equal(lapsedEngine.phase, PHASES.OPEN);
    assert.equal(lapsedEngine.roundId, 3);
    assert.ok(lapsedEngine.hasPendingOfflineWin(player.id, 'BackupPlayer'));
    lapsedEngine.stop();
  });

  it('L10: preserves activeStake in localStorage across lottery_tick and clears it once round settles', () => {
    const CasinoNetwork = require('../../client/js/network');
    const store = new Map();
    const prevLocalStorage = global.localStorage;
    global.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    };

    try {
      const net = new CasinoNetwork();
      const emits = [];
      const socketHandlers = new Map();
      net.socket = {
        on: (evt, cb) => socketHandlers.set(evt, cb),
        emit: (evt, payload) => emits.push({ evt, payload })
      };

      // Simulate minimal listener wiring from network.connect without requiring socket.io global
      const futureEndsAt = Date.now() + 300000;
      net.myPlayerId = 'ply_test100k';
      net.saveLotteryStakeBackup({
        roundId: 5,
        roundEndsAt: futureEndsAt,
        tickets: 40,
        totalSpent: 100000,
        playerId: 'ply_test100k',
        playerName: 'Renzo'
      });

      const backup = net.getLotteryBackup();
      assert.ok(backup && backup.tickets === 40 && backup.totalSpent === 100000 && backup.roundId === 5);

      net.authSession({ name: 'Renzo' });
      const authEmit = emits.find((e) => e.evt === 'auth_session');
      assert.ok(authEmit && authEmit.payload.lotteryBackup && authEmit.payload.lotteryBackup.totalSpent === 100000);

      // Simulate controller tick & fresh wiped server state before recovery: activeStake stays safe
      const ctrl = new CasinoLottery({
        network: net,
        ui: { myPlayer: { id: 'ply_test100k', name: 'Renzo', chips: 50000 }, updatePlayerHUD: () => {}, showToast: () => {} }
      });
      ctrl.applyState({ roundId: 1, phase: 'OPEN', secondsRemaining: 600, pot: 0, totalTickets: 0, history: [], settledRoundIds: [] });
      assert.ok(net.getLotteryBackup() && net.getLotteryBackup().roundId === 5, 'empty fresh server state must not wipe unsettled activeStake');

      // Once server confirms round 5 settled, backup clears cleanly
      ctrl.applyState({ roundId: 6, phase: 'OPEN', secondsRemaining: 600, pot: 0, totalTickets: 0, history: [{ roundId: 5 }], settledRoundIds: [5] });
      assert.equal(net.getLotteryBackup(), null);
      if (ctrl._localTickTimer) clearInterval(ctrl._localTickTimer);
    } finally {
      if (prevLocalStorage === undefined) {
        delete global.localStorage;
      } else {
        global.localStorage = prevLocalStorage;
      }
    }
  });
});
