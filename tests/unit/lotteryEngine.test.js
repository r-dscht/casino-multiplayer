/**
 * lotteryEngine.test.js
 * Unit tests for Monte Carlo Gouden Krasloten (1.000 F ticket, 100% ticket + 1% casino net loss into pot,
 * calibrated Match-3 tiers, jackpot pot reset, bank loan repayments, and persistence).
 */

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.NODE_ENV = 'test';

const PlayerManager = require('../../server/game/playerManager');
const BankManager = require('../../server/game/bankManager');
const LotteryEngine = require('../../server/game/lotteryEngine');
const PlinkoEngine = require('../../server/game/plinkoEngine');
const {
  TICKET_PRICE,
  INITIAL_POT,
  RESET_FLOOR_POT,
  MIN_POT_AFTER_PARTIAL,
  LOSS_CONTRIBUTION_RATE,
  ROUND_DURATION_MS,
  SCRATCH_PRIZE_TIERS,
  TOTAL_TIER_WEIGHT,
  pickScratchTier,
  calculateTierPayout,
  buildScratchGrid
} = require('../../server/game/lotteryConstants');
const CasinoLottery = require('../../client/js/lottery');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

describe('LotteryEngine — Monte Carlo Gouden Krasloten Unit Suite', () => {
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

  it('K1: enforces 1.000 F price, 10.000 F initial pot, 1% loss contribution, and calibrated tier weights', () => {
    assert.equal(TICKET_PRICE, 1000);
    assert.equal(INITIAL_POT, 10000);
    assert.equal(RESET_FLOOR_POT, 5000);
    assert.equal(LOSS_CONTRIBUTION_RATE, 0.01);
    assert.equal(ROUND_DURATION_MS, 10 * 60 * 1000);
    assert.equal(TOTAL_TIER_WEIGHT, 10000);

    // Deterministic RNG boundary checks across tiers
    assert.equal(pickScratchTier(() => 0.0).id, 'JACKPOT_100');
    assert.equal(pickScratchTier(() => 0.002).id, 'POT_25');
    assert.equal(pickScratchTier(() => 0.015).id, 'POT_10');
    assert.equal(pickScratchTier(() => 0.05).id, 'POT_4');
    assert.equal(pickScratchTier(() => 0.15).id, 'CONSOLATION_500');
    assert.equal(pickScratchTier(() => 0.90).id, 'MISS');

    const jackpotTier = SCRATCH_PRIZE_TIERS.find((t) => t.id === 'JACKPOT_100');
    const pot25Tier = SCRATCH_PRIZE_TIERS.find((t) => t.id === 'POT_25');
    assert.equal(calculateTierPayout(jackpotTier, 40000), 40000);
    assert.equal(calculateTierPayout(pot25Tier, 40000), 10000);
  });

  it('K2: generates valid 3x3 Match-3 grids for every winning tier and strict non-match grids for MISS', () => {
    for (const tier of SCRATCH_PRIZE_TIERS) {
      const grid = buildScratchGrid(tier.id, 20000, 5000);
      assert.equal(grid.length, 9);

      const counts = new Map();
      let winCells = 0;
      for (const cell of grid) {
        counts.set(cell.symbolId, (counts.get(cell.symbolId) || 0) + 1);
        if (cell.isWinningCell) winCells += 1;
      }

      if (tier.id === 'MISS') {
        assert.equal(winCells, 0);
        for (const [sym, cnt] of counts.entries()) {
          assert.ok(cnt <= 2, `MISS grid had ${cnt} copies of ${sym}`);
        }
      } else {
        assert.equal(winCells, 3);
        assert.equal(counts.get(tier.id), 3, `Winning grid must have exactly 3 ${tier.id} cells`);
        for (const [sym, cnt] of counts.entries()) {
          if (sym !== tier.id) {
            assert.ok(cnt <= 2, `Decoy symbol ${sym} repeated ${cnt} times`);
          }
        }
      }
    }
  });

  it('K3: feeds 100% of ticket price into pot, pays jackpot & resets pot to floor, and handles partial pot wins + bank loan repayments', () => {
    const pm = new PlayerManager({ storagePath: false });
    const bm = new BankManager(pm, { storagePath: false });
    const alice = pm.registerPlayer('sa', { name: 'ScratchAlice' });
    const lender = pm.registerPlayer('sl', { name: 'ScratchLender' });
    pm.resetBankroll(alice.id, 30000);
    pm.resetBankroll(lender.id, 20000);

    const prop = bm.createLoanProposal({
      fromId: alice.id,
      toId: lender.id,
      type: 'borrow',
      amount: 5000,
      interestPct: 10,
      winDeductionPct: 20
    });
    assert.equal(prop.success, true);
    const acc = bm.acceptProposal(prop.proposal.id, lender.id);
    assert.equal(acc.success, true);

    let forceRoll = 0.90; // MISS first
    activeEngine = new LotteryEngine(pm, {
      bankManager: bm,
      storagePath: false,
      rng: () => forceRoll
    });
    assert.equal(activeEngine.pot, 10000);

    // 1. MISS adds full 1.000 F into pot without deducting payout
    const missRes = activeEngine.buyTickets(alice.id, 1);
    assert.equal(missRes.ok, true);
    assert.equal(missRes.totalCost, 1000);
    assert.equal(missRes.totalPayout, 0);
    assert.equal(missRes.pot, 11000);

    // 2. POT_25 adds +1.000 -> 12.000 F pot, pays 25% = 3.000 F -> pot drops to 9.000 F
    forceRoll = 0.002;
    const p25Res = activeEngine.buyTickets(alice.id, 1);
    assert.equal(p25Res.ok, true);
    assert.equal(p25Res.totalPayout, 3000);
    assert.equal(p25Res.pot, 9000);
    assert.ok(p25Res.repayments.length === 1);
    assert.ok(lender.chips > 15000);

    // 3. JACKPOT_100 adds +1.000 -> 10.000 F pot, pays all 10.000 F, resets pot to RESET_FLOOR_POT (5.000 F)
    forceRoll = 0.0;
    const jackEvents = [];
    activeEngine.on('draw_result', (ev) => jackEvents.push(ev));
    const jackRes = activeEngine.buyTickets(alice.id, 1);
    assert.equal(jackRes.ok, true);
    assert.equal(jackRes.totalPayout, 10000);
    assert.equal(jackRes.pot, RESET_FLOOR_POT);
    assert.equal(jackEvents.length, 1);
    assert.equal(jackEvents[0].tierId, 'JACKPOT_100');
    assert.equal(jackEvents[0].potWon, 10000);
  });

  it('K4: feeds 1% of player net losses from casino games (via PlayerManager.onHouseNetLoss) into Krasloten pot', () => {
    const pm = new PlayerManager({ storagePath: false });
    const player = pm.registerPlayer('s_p', { name: 'PlinkoPlayer' });
    pm.resetBankroll(player.id, 50000);

    activeEngine = new LotteryEngine(pm, { storagePath: false });
    const startPot = activeEngine.pot;

    // Direct net loss feed
    const added = activeEngine.addLossContribution(5000);
    assert.equal(added, 50);
    assert.equal(activeEngine.pot, startPot + 50);
    assert.equal(activeEngine.totalLossContributions, 50);

    // Trigger via PlinkoEngine where payout < amount (guaranteed loss by forcing edge/center slot via rng)
    const plinko = new PlinkoEngine({ playerManager: pm });
    plinko.generatePath = () => new Array(8).fill(0).map((_, i) => (i < 4 ? 1 : 0)); // center slot (0.5x) -> net loss 500 on 1000 bet
    const beforePot = activeEngine.pot;
    const dropRes = plinko.dropBalls(player.id, { amount: 1000, rows: 8, risk: 'high', count: 1 });
    assert.equal(dropRes.ok, true);
    const lost = Math.max(0, 1000 - dropRes.drops[0].payout);
    assert.ok(lost > 0);
    assert.equal(activeEngine.pot, beforePot + Math.max(1, Math.round(lost * LOSS_CONTRIBUTION_RATE)));
  });

  it('K5: persists pot, ticket counts, and history cleanly across restarts via lottery.json', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'casino-kras-'));
    const jsonPath = path.join(tmpDir, 'lottery.json');
    tempFiles.push(jsonPath);

    const pm1 = new PlayerManager({ storagePath: false });
    const p1 = pm1.registerPlayer('s1', { name: 'PersistKras' });
    pm1.resetBankroll(p1.id, 10000);

    activeEngine = new LotteryEngine(pm1, {
      storagePath: jsonPath,
      debounceMs: 0,
      rng: () => 0.90 // MISS
    });
    activeEngine.buyTickets(p1.id, 2);
    assert.equal(activeEngine.pot, 12000);
    activeEngine.stop();
    activeEngine = null;

    const pm2 = new PlayerManager({ storagePath: false });
    const reloaded = new LotteryEngine(pm2, { storagePath: jsonPath, debounceMs: 0 });
    assert.equal(reloaded.loadedFromDisk, true);
    assert.equal(reloaded.pot, 12000);
    assert.equal(reloaded.totalTickets, 2);
    reloaded.stop();

    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  });

  it('K6: enforces client controller guardrails (zero audio APIs, zero emojis, zero banned terms)', () => {
    const ctrl = new CasinoLottery({ network: { on: () => {} }, ui: { myPlayer: { chips: 10000 } } });
    assert.equal(ctrl.state.mode, 'KRASLOTEN');
    assert.equal(ctrl.state.ticketPrice, 1000);
    assert.equal(ctrl.state.pot, 10000);

    const files = [
      'server/game/lotteryConstants.js',
      'server/game/lotteryEngine.js',
      'client/js/lottery.js'
    ];
    const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    const audioRe = /\b(AudioContext|webkitAudioContext|HTMLAudioElement|new Audio)\b/;
    const bannedRe = /\b(grand theft auto|los santos|gta|rockstar)\b/i;

    for (const rel of files) {
      const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      assert.equal(emojiRe.test(src), false, `Unicode emoji found in ${rel}`);
      assert.equal(audioRe.test(src), false, `Audio API found in ${rel}`);
      assert.equal(bannedRe.test(src), false, `Banned brand term found in ${rel}`);
    }
  });

  it('K7: supports smooth partial cell scratching, single-cell reveals, and deferred suspense payouts', () => {
    const handlers = {};
    const mockNetwork = {
      isConnected: true,
      isAuthenticated: true,
      on: (evt, fn) => { handlers[evt] = fn; },
      buyLotteryTickets: () => {},
      requestLotteryState: () => {}
    };
    let hudUpdates = 0;
    const toasts = [];
    const mockUi = {
      myPlayer: { id: 'p1', chips: 10000 },
      updatePlayerHUD: () => { hudUpdates += 1; },
      showToast: (msg, type) => { toasts.push({ msg, type }); }
    };

    const ctrl = new CasinoLottery({ network: mockNetwork, ui: mockUi });
    const sampleGrid = Array.from({ length: 9 }, (_, i) => ({
      index: i,
      badge: i < 3 ? 'GOUD' : 'STER',
      label: i < 3 ? '25%' : 'X',
      symbolName: i < 3 ? '3x GOUD' : 'Ster',
      color: '#f59e0b',
      isWinningCell: i < 3
    }));

    handlers.lottery_buy_ack({
      ok: true,
      count: 1,
      totalCost: 1000,
      totalPayout: 2750,
      remainingChips: 11750,
      mySummary: { tickets: 1, totalSpent: 1000, totalWon: 2750 },
      ticket: {
        ticketNumber: 42,
        won: true,
        payout: 2750,
        tierId: 'POT_25',
        tierLabel: '25% POT',
        grid: sampleGrid
      }
    });

    // While foil is unrevealed, payout is held back so HUD doesn't spoil win
    assert.equal(ctrl.isScratchRevealed, false);
    assert.equal(mockUi.myPlayer.chips, 9000);
    assert.equal(ctrl._pendingFinalChips, 11750);
    assert.equal(ctrl.state.mySummary.totalWon, 0);

    // Incoming lottery_state with history is queued until card is scratched open
    handlers.lottery_state({
      mode: 'KRASLOTEN',
      pot: 8250,
      totalTickets: 1,
      mySummary: { tickets: 1, totalSpent: 1000, totalWon: 2750 },
      myHistory: [{ ticketNumber: 42, won: true, payout: 2750 }],
      history: [{ playerName: 'Tester', payout: 2750 }]
    });
    assert.equal(ctrl.state.myHistory.length, 0);
    assert.ok(ctrl._deferredState);

    // Scratching 3 sub-points within cell 0 reveals cell 0 without revealing full ticket
    ctrl._eraseFoilBrush(20, 20, 360, 270, null);
    ctrl._eraseFoilBrush(55, 25, 360, 270, { x: 20, y: 20 });
    ctrl._eraseFoilBrush(85, 55, 360, 270, { x: 55, y: 25 });
    assert.equal(ctrl._revealedCells.has(0), true);
    assert.equal(ctrl.isScratchRevealed, false);
    assert.equal(mockUi.myPlayer.chips, 9000);

    // Revealing cells 1..5 keeps suspense intact; cell 6 (7th overall) auto-reveals card
    for (let idx = 1; idx <= 5; idx += 1) {
      ctrl._revealSingleCell(idx, 360, 270);
      assert.equal(ctrl.isScratchRevealed, false);
    }
    ctrl._revealSingleCell(6, 360, 270);

    assert.equal(ctrl.isScratchRevealed, true);
    assert.equal(mockUi.myPlayer.chips, 11750);
    assert.equal(ctrl._pendingFinalChips, null);
    assert.equal(ctrl._deferredState, null);
    assert.equal(ctrl.state.pot, 8250);
    assert.equal(ctrl.state.myHistory.length, 1);
    assert.ok(hudUpdates >= 2);
    assert.equal(toasts.length, 1);
  });
});
