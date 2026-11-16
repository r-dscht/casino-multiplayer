const { describe, it, beforeEach, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { io: Client } = require('socket.io-client');

const app = require('../../server/app');
const { setupSocket } = require('../../server/socket');
const PlayerManager = require('../../server/game/playerManager');
const BankManager = require('../../server/game/bankManager');
const SlotsEngine = require('../../server/game/slotsEngine');
const {
  SYMBOLS,
  PAYLINES,
  PAYTABLE,
  REEL_STRIPS,
  GOLDEN_FEVER_REEL_STRIPS,
  SCATTER_REWARDS,
  VALID_BETS,
  BONUS_BUY_MULTIPLIER,
  FREE_SPINS_MULTIPLIER,
  GOLDEN_FEVER_MULTIPLIER,
  JACKPOT_SEED,
  JACKPOT_CONTRIBUTION_RATE,
  NUM_MACHINES,
  evaluatePayline,
  classifyWinTier,
} = require('../../server/game/slotsConstants');

function waitForEvent(socket, eventName, predicate = null, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, handler);
      reject(new Error(`Timed out waiting for socket event "${eventName}"`));
    }, timeoutMs);

    function handler(data) {
      if (!predicate || predicate(data)) {
        clearTimeout(timer);
        socket.off(eventName, handler);
        resolve(data);
      }
    }

    socket.on(eventName, handler);
  });
}

describe('slotsConstants & Payline Math unit tests', () => {
  it('defines 20 distinct paylines, 32-stop strips, and Golden Fever wild-enriched strips', () => {
    assert.equal(PAYLINES.length, 20);
    assert.equal(REEL_STRIPS.length, 5);
    assert.equal(GOLDEN_FEVER_REEL_STRIPS.length, 5);

    let totalBaseWilds = 0;
    let totalFeverWilds = 0;
    REEL_STRIPS.forEach((strip, col) => {
      assert.equal(strip.length, 32);
      const baseWilds = strip.filter((s) => s === 'WILD').length;
      const feverWilds = GOLDEN_FEVER_REEL_STRIPS[col].filter((s) => s === 'WILD').length;
      totalBaseWilds += baseWilds;
      totalFeverWilds += feverWilds;
      if (col === 2 || col === 3) {
        assert.ok(feverWilds > baseWilds, `Expected Golden Fever center strip col ${col} to have extra Wilds`);
      } else {
        assert.equal(feverWilds, baseWilds);
      }
    });
    assert.ok(totalFeverWilds > totalBaseWilds);

    assert.equal(NUM_MACHINES, 8);
    assert.equal(BONUS_BUY_MULTIPLIER, 30);
    assert.equal(FREE_SPINS_MULTIPLIER, 2);
    assert.equal(GOLDEN_FEVER_MULTIPLIER, 1.25);
    assert.equal(JACKPOT_SEED, 10000);
    assert.equal(JACKPOT_CONTRIBUTION_RATE, 0.01);
  });

  it('evaluates Wild substitution, pure Wild, 2x Crest, and rejects Wild+Scatter line substitution', () => {
    // 4x DIAMOND with leading Wilds
    const wildDiamond = evaluatePayline(['WILD', 'WILD', 'DIAMOND', 'DIAMOND', '10'], PAYTABLE);
    assert.equal(wildDiamond.symbol, 'DIAMOND');
    assert.equal(wildDiamond.count, 4);
    assert.equal(wildDiamond.payout, PAYTABLE.DIAMOND[4]);

    // 5x WILD jackpot chain check
    const fiveWilds = evaluatePayline(['WILD', 'WILD', 'WILD', 'WILD', 'WILD'], PAYTABLE);
    assert.equal(fiveWilds.symbol, 'WILD');
    assert.equal(fiveWilds.count, 5);
    assert.equal(fiveWilds.payout, PAYTABLE.WILD[5]);

    // 2x CREST exception
    const twoCrest = evaluatePayline(['CREST', 'CREST', '10', 'J', 'Q'], PAYTABLE);
    assert.equal(twoCrest.symbol, 'CREST');
    assert.equal(twoCrest.count, 2);
    assert.equal(twoCrest.payout, PAYTABLE.CREST[2]);

    // Wild followed by Scatters must NOT substitute as Scatters or match later low card across gap
    const wildThenScatters = evaluatePayline(['WILD', 'SCATTER', 'SCATTER', '10', '10'], PAYTABLE);
    assert.equal(wildThenScatters.symbol, null);
    assert.equal(wildThenScatters.payout, 0);
  });

  it('classifies win tiers accurately (WIN, NICE_WIN, BIG_WIN, MEGA_WIN, JACKPOT)', () => {
    assert.equal(classifyWinTier(0, 100, false), 'NO_WIN');
    assert.equal(classifyWinTier(500, 100, false), 'WIN');
    assert.equal(classifyWinTier(1000, 100, false), 'NICE_WIN');
    assert.equal(classifyWinTier(2000, 100, false), 'BIG_WIN');
    assert.equal(classifyWinTier(5000, 100, false), 'MEGA_WIN');
    assert.equal(classifyWinTier(5000, 100, true), 'JACKPOT');
  });
});

describe('SlotsEngine unit tests', () => {
  let playerManager;
  let bankManager;
  let engine;
  let player1;
  let player2;

  beforeEach(() => {
    playerManager = new PlayerManager({ storagePath: null });
    bankManager = new BankManager(playerManager);
    engine = new SlotsEngine({ playerManager, bankManager });
    player1 = playerManager.registerPlayer('sock_slot_1', { name: 'Renzo', color: '#D4AF37' });
    player2 = playerManager.registerPlayer('sock_slot_2', { name: 'Elena', color: '#10B981' });
  });

  after(() => {
    if (engine) engine.stop();
  });

  it('manages 8 floor cabinets: ensureMachine, switch, occupied guard, and leaveMachine', () => {
    const s1 = engine.ensureMachine(player1.id);
    assert.equal(s1.ok, true);
    assert.equal(s1.machineId, 1);

    const s2 = engine.ensureMachine(player2.id);
    assert.equal(s2.ok, true);
    assert.equal(s2.machineId, 2);

    // Switching to occupied machine #1 fails cleanly
    const steal = engine.selectMachine(player2.id, 1);
    assert.equal(steal.ok, false);
    assert.equal(steal.code, 'MACHINE_OCCUPIED');

    // Switching to open machine #5 vacates #2 cleanly
    const move = engine.selectMachine(player2.id, 5);
    assert.equal(move.ok, true);
    assert.equal(move.machineId, 5);
    assert.equal(engine.machines[1].occupiedBy, null);
    assert.equal(engine.machines[4].occupiedBy.playerId, player2.id);

    // Leaving vacates #5
    assert.equal(engine.leaveMachine(player2.id), true);
    assert.equal(engine.machines[4].occupiedBy, null);
    assert.equal(engine.leaveMachine(player2.id), false);
  });

  it('rejects invalid payloads, unknown players, invalid bets, and insufficient chips', () => {
    assert.equal(engine.spin(player1.id, null).code, 'INVALID_PAYLOAD');
    assert.equal(engine.spin('missing_id', { bet: 100 }).code, 'PLAYER_NOT_FOUND');
    assert.equal(engine.spin(player1.id, { bet: 33 }).code, 'INVALID_BET');

    // Insufficient chips for high bet and Bonus Buy
    playerManager.deductChips(player1.id, player1.chips - 500);
    assert.equal(engine.spin(player1.id, { bet: 1000 }).code, 'INSUFFICIENT_FUNDS');
    // Bonus Buy 20 * 75 = 1500 fails when balance is 500
    assert.equal(engine.spin(player1.id, { bet: 20, isBonusBuy: true }).code, 'INSUFFICIENT_FUNDS');
  });

  it('executes paid spin, contributes 1% to progressive jackpot, updates career stats, and calls bank repayments', () => {
    const repaymentCalls = [];
    const stubBank = {
      processWinRepayment(pid, netProfit) {
        repaymentCalls.push({ pid, netProfit });
        return [{ lenderId: 'lender_1', lenderName: 'Banker', amount: 25, isFullyRepaid: true }];
      },
    };
    const engWithBank = new SlotsEngine({ playerManager, bankManager: stubBank });

    // Force deterministic winning grid on line 1 (5x DIAMOND = PAYTABLE.DIAMOND[5] * lineBet)
    engWithBank._generateRandomSpin = () => ({
      stops: [0, 0, 0, 0, 0],
      grid: [
        ['10', 'DIAMOND', 'K'],
        ['Q', 'DIAMOND', 'J'],
        ['J', 'DIAMOND', 'A'],
        ['A', 'DIAMOND', '10'],
        ['Q', 'DIAMOND', 'K'],
      ],
    });

    const bet = 100; // lineBet = 5 -> 5x DIAMOND = 1200 * 5 = 6000
    const expectedPayout = PAYTABLE.DIAMOND[5] * 5;
    const expectedNet = expectedPayout - bet;
    const startChips = player1.chips;
    const res = engWithBank.spin(player1.id, { bet });

    assert.equal(res.ok, true);
    assert.equal(res.wager, 100);
    assert.equal(res.jackpotPool, JACKPOT_SEED + bet * JACKPOT_CONTRIBUTION_RATE);
    assert.equal(res.totalPayout, expectedPayout);
    assert.equal(res.netProfit, expectedNet);
    assert.equal(res.newChips, startChips - bet + expectedPayout);
    assert.equal(res.stats.roundsPlayed, 1);
    assert.equal(res.stats.totalWon, expectedNet);
    assert.equal(res.stats.biggestWin, expectedNet);
    assert.equal(repaymentCalls.length, 1);
    assert.equal(res.repayments.length, 1);

    engWithBank.stop();
  });

  it('awards Progressive Grand Jackpot on Payline 1 with 5x CREST/WILD and resets pool to 10,000', () => {
    playerManager.addChips(player1.id, 10000);
    engine.jackpotPool = 25000;

    engine._generateRandomSpin = () => ({
      stops: [19, 19, 19, 19, 19],
      grid: [
        ['10', 'CREST', 'J'],
        ['Q', 'WILD', '10'],
        ['J', 'CREST', 'K'],
        ['A', 'WILD', '10'],
        ['10', 'CREST', 'Q'],
      ],
    });

    const res = engine.spin(player1.id, { bet: 100 });
    assert.equal(res.ok, true);
    assert.equal(res.jackpotWon, 25001); // 25000 + 1% of 100 wager contributed before draw
    assert.equal(res.winTier, 'JACKPOT');
    assert.equal(res.jackpotPool, JACKPOT_SEED);
    assert.ok(res.totalPayout > 25000);
  });

  it('triggers 3x Free Spins via Bonus Buy, locks Sticky Wilds without overwriting Scatters, blocks double Bonus Buy, and completes cleanly', () => {
    playerManager.addChips(player1.id, 20000);

    engine._generateBonusBuySpin = () => ({
      stops: [0, 0, 0, 0, 0],
      grid: [
        ['SCATTER', '10', 'J'],
        ['Q', '10', 'SCATTER'],
        ['SCATTER', 'K', '10'],
        ['10', 'J', 'Q'],
        ['K', 'A', '10'],
      ],
    });

    let fsSpinStep = 0;
    engine._generateRandomSpin = () => {
      fsSpinStep += 1;
      if (fsSpinStep === 1) {
        // First Free Spin lands 2 WILDs at [1,1] and [4,1]
        return {
          stops: [1, 1, 1, 1, 1],
          grid: [
            ['10', '10', 'Q'],
            ['J', 'WILD', 'K'],
            ['Q', 'A', 'J'],
            ['K', '10', 'Q'],
            ['A', 'WILD', 'J'],
          ],
        };
      }
      if (fsSpinStep === 2) {
        // Second Free Spin rolls 10 at [1,1] (must stay sticky WILD!) and SCATTER at [4,1] (must NOT be overwritten by sticky WILD!)
        return {
          stops: [2, 2, 2, 2, 2],
          grid: [
            ['10', 'J', 'Q'],
            ['K', '10', '10'],
            ['10', 'J', 'Q'],
            ['K', 'A', '10'],
            ['Q', 'SCATTER', '10'],
          ],
        };
      }
      return {
        stops: [3, 3, 3, 3, 3],
        grid: [
          ['10', 'J', 'Q'],
          ['K', '10', '10'],
          ['10', 'J', 'Q'],
          ['K', 'A', '10'],
          ['Q', 'J', '10'],
        ],
      };
    };

    const bet = 100;
    const buyCost = bet * BONUS_BUY_MULTIPLIER; // 3000
    const beforeChips = player1.chips;

    const triggerRes = engine.spin(player1.id, { bet, isBonusBuy: true });
    assert.equal(triggerRes.ok, true);
    assert.equal(triggerRes.wager, buyCost);
    assert.equal(triggerRes.scatterCount, 3);
    assert.equal(triggerRes.freeSpinsAwarded, SCATTER_REWARDS[3].freeSpins); // 10
    assert.equal(triggerRes.freeSpinsRemaining, 10);
    assert.equal(triggerRes.scatterPayout, bet * SCATTER_REWARDS[3].multiplier); // 500
    assert.equal(triggerRes.stickyWilds.length, 0);

    // Attempting Bonus Buy during active Free Spins is blocked
    const blockedBuy = engine.spin(player1.id, { bet, isBonusBuy: true });
    assert.equal(blockedBuy.ok, false);
    assert.equal(blockedBuy.code, 'BONUS_ACTIVE');

    // Free Spin 1: lands 2 Wilds at [1,1] and [4,1] without locking sticky tiles
    const fs1 = engine.spin(player1.id, { bet });
    assert.equal(fs1.ok, true);
    assert.equal(fs1.wasFreeSpin, true);
    assert.equal(fs1.wager, 0);
    assert.equal(fs1.multiplier, FREE_SPINS_MULTIPLIER);
    assert.equal(fs1.newlyLockedWilds.length, 0);
    assert.equal(fs1.stickyWilds.length, 0);
    assert.equal(fs1.freeSpinsRemaining, 9);

    // Free Spin 2: reels land fresh with zero stuck tiles from spin 1
    const fs2 = engine.spin(player1.id, { bet });
    assert.equal(fs2.ok, true);
    assert.equal(fs2.grid[1][1], '10', 'Reels must spin cleanly without sticky wild locks');
    assert.equal(fs2.grid[4][1], 'SCATTER');
    assert.equal(fs2.freeSpinsRemaining, 8);

    // Exhaust remaining Free Spins and verify clean summary & bonus completion
    let lastFs = fs2;
    while (lastFs.freeSpinsRemaining > 0) {
      lastFs = engine.spin(player1.id, { bet });
      assert.equal(lastFs.ok, true);
    }
    assert.equal(lastFs.freeSpinsEnded, true);
    assert.ok(lastFs.finalBonusSummary);
    assert.equal(lastFs.finalBonusSummary.lockedWildsCount, 0);
    assert.equal(engine.getPlayerBonusState(player1.id).freeSpinsRemaining, 0);
    assert.ok(player1.chips >= beforeChips - buyCost + triggerRes.scatterPayout);
  });

  it('caps Free Spins retrigger to at most once (+3 extra spins) and avoids stuck loops', () => {
    engine.ensureMachine(player1.id, 1);
    engine._generateRandomSpin = () => ({
      stops: [0, 0, 0, 0, 0],
      grid: [
        ['SCATTER', '10', 'J'],
        ['Q', 'SCATTER', 'K'],
        ['A', '10', 'SCATTER'],
        ['J', 'Q', 'K'],
        ['10', 'A', 'Q'],
      ],
    });
    engine.playerFreeSpins.set(player1.id, {
      remaining: 2,
      bet: 100,
      totalBonusWin: 0,
      hasRetriggered: false,
    });

    const firstRetrigger = engine.spin(player1.id, { bet: 100 });
    assert.equal(firstRetrigger.ok, true);
    assert.equal(firstRetrigger.freeSpinsRemaining, 4); // 2 - 1 + 3

    const secondTry = engine.spin(player1.id, { bet: 100 });
    assert.equal(secondTry.ok, true);
    assert.equal(secondTry.freeSpinsRemaining, 3); // no infinite retrigger!
  });

  it('charges Golden Fever via cheers (with cooldown), activates 1.25x multiplier at 100%, and stacks to 2.5x in Free Spins', () => {
    engine.ensureMachine(player1.id, 1);
    engine.ensureMachine(player2.id, 2);

    const c1 = engine.cheerMachine(player2.id, 1);
    assert.equal(c1.ok, true);
    assert.equal(c1.cheersReceived, 1);
    assert.equal(engine.goldenFeverProgress, 2.5);

    // Immediate second cheer from player2 blocked by cooldown
    const c2 = engine.cheerMachine(player2.id, 1);
    assert.equal(c2.ok, false);
    assert.equal(c2.code, 'CHEER_COOLDOWN');

    // Push Golden Fever meter to 98% then cheer once to trigger floor event
    engine.goldenFeverProgress = 98;
    const events = [];
    engine.on('golden_fever_started', (p) => events.push(p));

    const triggerCheer = engine.cheerMachine(player1.id, 2);
    assert.equal(triggerCheer.ok, true);
    assert.equal(triggerCheer.feverTriggered, true);
    assert.equal(events.length, 1);
    assert.equal(engine.getGoldenFeverState().active, true);
    assert.equal(engine.getGoldenFeverState().multiplier, GOLDEN_FEVER_MULTIPLIER);

    // Put player1 in Free Spins and verify 2x * 1.25x = 2.5x line multiplier!
    engine.playerFreeSpins.set(player1.id, {
      remaining: 2,
      bet: 100,
      totalBonusWin: 0,
      hasRetriggered: false,
    });
    engine._generateRandomSpin = () => ({
      stops: [0, 0, 0, 0, 0],
      grid: [
        ['10', 'EMERALD', 'Q'],
        ['J', 'EMERALD', 'K'],
        ['Q', 'EMERALD', '10'],
        ['K', 'A', 'J'],
        ['A', 'Q', 'K'],
      ],
    });
    const res = engine.spin(player1.id, { bet: 100 });
    assert.equal(res.ok, true);
    assert.equal(res.multiplier, FREE_SPINS_MULTIPLIER * GOLDEN_FEVER_MULTIPLIER);
    assert.equal(res.lineWins[0].amount, Math.round(PAYTABLE.EMERALD[3] * 5 * 2.5));
    assert.equal(res.lineWins[0].payout, Math.round(PAYTABLE.EMERALD[3] * 5 * 2.5));

    engine.stop();
  });
});

describe('Slots Socket.IO integration tests', () => {
  let server;
  let socketHandler;
  let baseUrl;
  let client1;
  let client2;

  before(async () => {
    server = http.createServer(app);
    socketHandler = setupSocket(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;

    client1 = Client(baseUrl, { transports: ['websocket'], forceNew: true });
    client2 = Client(baseUrl, { transports: ['websocket'], forceNew: true });

    await Promise.all([
      waitForEvent(client1, 'connect'),
      waitForEvent(client2, 'connect'),
    ]);

    const p1Join = waitForEvent(client1, 'slots_state');
    const p2Join = waitForEvent(client2, 'slots_state');
    client1.emit('join_table', { name: 'SlotAlice', color: '#D4AF37' });
    client2.emit('join_table', { name: 'SlotBob', color: '#38BDF8' });
    await Promise.all([p1Join, p2Join]);
  });

  after(async () => {
    if (client1 && client1.connected) client1.disconnect();
    if (client2 && client2.connected) client2.disconnect();
    if (socketHandler && typeof socketHandler.stop === 'function') {
      socketHandler.stop();
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('seats players on slots_join, allows machine switch, executes slots_spin, broadcasts slots_cheer, and frees cabinet on disconnect', async () => {
    const j1P = waitForEvent(client1, 'slots_state', (s) => s.myMachineId === 1);
    client1.emit('slots_join', {});
    const s1 = await j1P;
    assert.equal(s1.myMachineId, 1);
    assert.equal(s1.machines.length, 8);
    assert.equal(s1.jackpotPool >= JACKPOT_SEED, true);

    const floorSwitchP = waitForEvent(client2, 'slots_floor_update', (f) =>
      f.machines.some((m) => m.machineId === 4 && m.occupiedBy && m.occupiedBy.playerName === 'SlotAlice')
    );
    client1.emit('slots_select_machine', { machineId: 4 });
    await floorSwitchP;

    const spinResP = waitForEvent(client1, 'slots_spin_result');
    const chipsP = waitForEvent(client1, 'chips_update', (c) => c.source === 'slots');
    client1.emit('slots_spin', { bet: 100 });
    const [spinRes, chipsData] = await Promise.all([spinResP, chipsP]);
    assert.equal(spinRes.ok, true);
    assert.equal(spinRes.machineId, 4);
    assert.equal(chipsData.chips, spinRes.newChips);

    // client2 cheers Alice on machine #4
    const cheerEvtP = waitForEvent(client1, 'slots_cheer_event', (e) => e.machineId === 4);
    client2.emit('slots_cheer', { machineId: 4 });
    const cheerEvt = await cheerEvtP;
    assert.equal(cheerEvt.fromPlayerName, 'SlotBob');
    assert.equal(cheerEvt.targetPlayerName, 'SlotAlice');
    assert.ok(cheerEvt.goldenFever.progress >= 2.5);

    // Rejected oversized Bonus Buy
    const rejP = waitForEvent(client2, 'slots_spin_rejected');
    client2.emit('slots_spin', { bet: 1000, isBonusBuy: true });
    const rej = await rejP;
    assert.equal(rej.code, 'INSUFFICIENT_FUNDS');

    // Disconnecting Alice frees machine #4 for everyone on floor
    const vacateP = waitForEvent(client2, 'slots_floor_update', (f) =>
      f.machines[3].occupiedBy === null
    );
    client1.disconnect();
    await vacateP;
  });
});

describe('Slots Zero-Audio & Zero-Emoji Guardrails + Client Export', () => {
  it('contains zero audio APIs and zero Unicode emojis in Slots server & client files', () => {
    const projectRoot = path.resolve(__dirname, '../..');
    const filesToCheck = [
      'server/game/slotsConstants.js',
      'server/game/slotsEngine.js',
      'client/js/slots.js',
      'client/index.html',
      'client/css/shell.css',
    ];
    const audioRegex = /AudioContext|webkitAudioContext|createOscillator|createGain|<audio|new Audio\(/;
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;

    for (const relPath of filesToCheck) {
      const content = fs.readFileSync(path.join(projectRoot, relPath), 'utf8');
      assert.ok(!audioRegex.test(content), `Forbidden audio reference in ${relPath}`);
      assert.ok(!emojiRegex.test(content), `Forbidden Unicode emoji in ${relPath}`);
    }

    const CasinoSlots = require('../../client/js/slots');
    assert.equal(typeof CasinoSlots, 'function');
  });

  it('records personal per-roll win/loss history cleanly without duplicates in CasinoSlots and contains Slots roll history DOM ids', () => {
    const projectRoot = path.resolve(__dirname, '../..');
    const indexHtml = fs.readFileSync(path.join(projectRoot, 'client/index.html'), 'utf8');
    assert.ok(indexHtml.includes('id="slots-roll-history-list"'));
    assert.ok(indexHtml.includes('id="slots-roll-summary"'));
    assert.ok(indexHtml.includes('id="btn-slots-tab-rolls"'));
    assert.ok(indexHtml.includes('id="btn-slots-tab-floor"'));

    const CasinoSlots = require('../../client/js/slots');
    const ctrl = new CasinoSlots({ network: { on: () => {} }, ui: null });

    ctrl._recordRollHistory({ spinId: 's_1', bet: 500, wager: 500, totalPayout: 1250, payoutMultiplier: 2.5 });
    ctrl._recordRollHistory({ spinId: 's_1', bet: 500, wager: 500, totalPayout: 1250, payoutMultiplier: 2.5 }); // duplicate ignored
    ctrl._recordRollHistory({ spinId: 's_2', bet: 500, wager: 500, totalPayout: 0, payoutMultiplier: 0 });
    ctrl._recordRollHistory({ spinId: 's_3', bet: 500, wager: 0, totalPayout: 800, payoutMultiplier: 1.6, wasFreeSpin: true });

    assert.equal(ctrl.myRollHistory.length, 3);
    assert.equal(ctrl.myRollHistory[0].spinId, 's_3');
    assert.equal(ctrl.myRollHistory[0].net, 800);
    assert.equal(ctrl.myRollHistory[0].typeTag, 'FREE');
    assert.equal(ctrl.myRollHistory[1].net, -500);
    assert.equal(ctrl.myRollHistory[2].net, 750);
  });
});
