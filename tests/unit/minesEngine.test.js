const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';

const PlayerManager = require('../../server/game/playerManager');
const BankManager = require('../../server/game/bankManager');
const MinesEngine = require('../../server/game/minesEngine');
const {
  VALID_GRID_SIDES,
  GRID_CONFIGS,
  SHARED_BOMB_PRESETS,
  TARGET_RTP,
  MAX_EV_CAP,
  MIN_BET,
  MAX_BET,
  SHARED_PHASES,
  buildMultiplierTable,
  computeNextPickMeta,
  generateMinePositions,
  normalizeBoardSettings,
} = require('../../server/game/minesConstants');
const CasinoMines = require('../../client/js/mines');

describe('Royal Mines Vault Engine, 96% RTP & Multiplayer Shared Vault Unit Suite', () => {
  it('enforces EV <= 0.99 (< 1.00 casino advantage) across every step of 4x4, 5x5, 6x6 & 7x7 boards', () => {
    assert.deepEqual(VALID_GRID_SIDES, [4, 5, 6, 7]);
    assert.deepEqual(SHARED_BOMB_PRESETS, [3, 5, 8, 12]);
    assert.equal(TARGET_RTP, 0.96);
    assert.equal(MAX_EV_CAP, 0.99);

    for (const side of VALID_GRID_SIDES) {
      const N = GRID_CONFIGS[side].totalTiles;
      const sampleMines = [1, 2, 3, 5, 8, 12, N - 2, N - 1];
      for (const m of sampleMines) {
        const table = buildMultiplierTable(N, m, TARGET_RTP);
        assert.equal(table.length, (N - m) + 1);
        assert.equal(table[0], 1.0);

        let cumulativeFairProb = 1.0;
        for (let d = 1; d < table.length; d += 1) {
          cumulativeFairProb *= (N - m - (d - 1)) / (N - (d - 1));
          const ev = cumulativeFairProb * table[d];
          assert.ok(table[d] >= 1.01, `Step ${d} (${side}x${side}, ${m} mines) mult must be >= 1.01, got ${table[d]}`);
          assert.ok(
            ev <= MAX_EV_CAP + 1e-9,
            `Step ${d} (${side}x${side}, ${m} mines) EV must be <= ${MAX_EV_CAP}, got ${ev.toFixed(5)}`
          );
          assert.ok(table[d] >= table[d - 1], `Multiplier must never decrease at step ${d}`);
        }
      }
    }

    const badSide = normalizeBoardSettings(8, 5);
    assert.equal(badSide.ok, false);
    const badMines = normalizeBoardSettings(4, 16);
    assert.equal(badMines.ok, false);
  });

  it('maintains ~96% casino RTP across 1200 simulated Solo Mines rounds', () => {
    const pm = new PlayerManager({ storagePath: false });
    const player = pm.registerPlayer('m_rtp', { name: 'RtpTester', color: '#10b981' });
    const engine = new MinesEngine({ playerManager: pm });

    let totalWagered = 0;
    let totalReturned = 0;

    for (let i = 0; i < 1200; i += 1) {
      if (player.chips < 1000) pm.addChips(player.id, 10000);
      const bet = 100;
      const start = engine.startSolo(player.id, { betAmount: bet, gridSide: 5, mineCount: 5 });
      assert.equal(start.ok, true);
      totalWagered += bet;

      // Pick 2 tiles each round, then cashout if survived
      let busted = false;
      for (let pick = 0; pick < 2; pick += 1) {
        const res = engine.clickSoloTile(player.id, pick);
        assert.equal(res.ok, true);
        if (res.outcome === 'MINE') {
          busted = true;
          break;
        }
      }
      if (!busted) {
        const cash = engine.cashoutSolo(player.id);
        assert.equal(cash.ok, true);
        totalReturned += cash.payout;
      }
    }

    engine.stop();
    const empiricalRtp = (totalReturned / totalWagered) * 100;
    assert.ok(
      empiricalRtp > 80 && empiricalRtp < 100,
      `Expected casino advantage (~96% theoretical RTP) over 1200 rounds, got ${empiricalRtp.toFixed(2)}%`
    );
  });

  it('runs Solo Vault lifecycle across custom 4x4/7x7 sizes, blocks 0-click cashout, handles Grand Clear & bank repayment', () => {
    const pm = new PlayerManager({ storagePath: false });
    const bm = new BankManager(pm, { storagePath: false });
    const lender = pm.registerPlayer('m_lender', { name: 'Lender', color: '#3b82f6' });
    const player = pm.registerPlayer('m_solo', { name: 'SoloMiner', color: '#d4af37' });
    const engine = new MinesEngine({ playerManager: pm, bankManager: bm });

    // Setup bank loan with 25% profit repayment
    const prop = bm.createLoanProposal({
      fromId: player.id,
      toId: lender.id,
      type: 'borrow',
      amount: 1000,
      interestPct: 10,
      winDeductionPct: 25,
    });
    assert.equal(prop.success, true);
    const loan = bm.acceptProposal(prop.proposal.id, lender.id);
    assert.equal(loan.success, true);

    // 4x4 with 14 bombs -> 2 safe diamonds -> deterministic mines via custom rng
    let seq = 0;
    const detEngine = new MinesEngine({
      playerManager: pm,
      bankManager: bm,
      rng: () => {
        seq = (seq + 1) % 97;
        return 0.01; // Deterministic shuffle picks last/top elements consistently
      },
    });

    const startRes = detEngine.startSolo(player.id, { betAmount: 1000, gridSide: 4, mineCount: 14 });
    assert.equal(startRes.ok, true);
    assert.equal(startRes.solo.gridSide, 4);
    assert.equal(startRes.solo.totalTiles, 16);
    assert.equal(startRes.solo.mineCount, 14);
    assert.equal(detEngine.hasActiveBets(player.id), true);

    // Block cashout before 1 diamond
    const earlyCash = detEngine.cashoutSolo(player.id);
    assert.equal(earlyCash.ok, false);
    assert.equal(earlyCash.code, 'MIN_ONE_CLICK_REQUIRED');

    // Privacy guard: getPublicState does not expose minesSet while active
    const pubState = detEngine.getPublicState(player.id);
    assert.equal(pubState.solo.minesSet, undefined);
    assert.equal(pubState.solo.allMines, undefined);

    // Find the 2 safe tiles on this internal board and clear them -> Grand Clear!
    const internalGame = detEngine.soloGames.get(player.id);
    const safeIndices = [];
    for (let idx = 0; idx < 16; idx += 1) {
      if (!internalGame.minesSet.has(idx)) safeIndices.push(idx);
    }
    assert.equal(safeIndices.length, 2);

    const pick1 = detEngine.clickSoloTile(player.id, safeIndices[0]);
    assert.equal(pick1.ok, true);
    assert.equal(pick1.outcome, 'DIAMOND');
    assert.equal(pick1.solo.canCashout, true);

    const pick2 = detEngine.clickSoloTile(player.id, safeIndices[1]);
    assert.equal(pick2.ok, true);
    assert.equal(pick2.outcome, 'GRAND_CLEAR');
    assert.ok(pick2.payout > 1000);
    assert.equal(detEngine.hasActiveBets(player.id), false);
    assert.ok(loan.loan.amountRepaid > 0, 'Bank loan repayment must trigger on Mines profit');
    assert.ok(player.stats.roundsPlayed >= 1);

    // 7x7 board start + bomb bust test
    const bigStart = detEngine.startSolo(player.id, { betAmount: 200, gridSide: 7, mineCount: 10 });
    assert.equal(bigStart.ok, true);
    assert.equal(bigStart.solo.totalTiles, 49);
    const bigInternal = detEngine.soloGames.get(player.id);
    const bombTile = Array.from(bigInternal.minesSet)[0];
    const bust = detEngine.clickSoloTile(player.id, bombTile);
    assert.equal(bust.ok, true);
    assert.equal(bust.outcome, 'MINE');
    assert.equal(bust.allMines.length, 10);
    assert.equal(detEngine.hasActiveBets(player.id), false);

    engine.stop();
    detEngine.stop();
  });

  it('runs Multiplayer Shared Vault with Smart Timer, voting, turn-based clicks, auto-click timeout & anti-passive cashout', () => {
    const pm = new PlayerManager({ storagePath: false });
    const p1 = pm.registerPlayer('m_s1', { name: 'Alice', color: '#10b981' });
    const p2 = pm.registerPlayer('m_s2', { name: 'Bob', color: '#3b82f6' });
    const engine = new MinesEngine({
      playerManager: pm,
      entrySec: 8,
      turnSec: 10,
      revealMs: 50,
    });

    engine.joinSalon(p1.id);
    engine.joinSalon(p2.id);

    // Initially WAITING_FOR_PLAYERS (Smart Timer does not run without bets)
    assert.equal(engine.shared.phase, SHARED_PHASES.WAITING_FOR_PLAYERS);
    assert.equal(engine.shared.timerSeconds, 0);

    // P1 places first bet -> enters BETTING with 8s countdown
    const j1 = engine.joinShared(p1.id, { betAmount: 500, gridSide: 6, mineCount: 8 });
    assert.equal(j1.ok, true);
    assert.equal(j1.startedCountdown, true);
    assert.equal(engine.shared.phase, SHARED_PHASES.BETTING);
    assert.equal(engine.shared.gridSide, 6);
    assert.equal(engine.shared.mineCount, 8);

    // Cancel and verify Smart Timer reverts to WAITING_FOR_PLAYERS with full refund
    const cancelRes = engine.cancelSharedBet(p1.id);
    assert.equal(cancelRes.ok, true);
    assert.equal(engine.shared.phase, SHARED_PHASES.WAITING_FOR_PLAYERS);
    assert.equal(p1.chips, 10000);

    // Re-join both players with board vote 5x5 & 5 bombs
    assert.equal(engine.joinShared(p1.id, { betAmount: 500, gridSide: 5, mineCount: 5 }).ok, true);
    assert.equal(engine.joinShared(p2.id, { betAmount: 400, gridSide: 5, mineCount: 5 }).ok, true);

    engine._beginSharedPlay();
    assert.equal(engine.shared.phase, SHARED_PHASES.PLAYING);
    assert.equal(engine.shared.turnPlayerId, p1.id);

    // Bob cannot click out of turn
    const outOfTurn = engine.clickSharedTile(p2.id, 0);
    assert.equal(outOfTurn.ok, false);
    assert.equal(outOfTurn.code, 'NOT_YOUR_TURN');

    // Bob CANNOT cash out passively before opening >= 1 own tile
    const passiveCash = engine.cashoutShared(p2.id);
    assert.equal(passiveCash.ok, false);
    assert.equal(passiveCash.code, 'MIN_ONE_CLICK_REQUIRED');

    // Pick 2 guaranteed safe tiles on the Shared board so turn rotates p1 -> p2 -> p1
    const safeTiles = [];
    for (let i = 0; i < engine.shared.totalTiles; i += 1) {
      if (!engine.shared.minesSet.has(i)) safeTiles.push(i);
    }
    const bombTile = Array.from(engine.shared.minesSet)[0];

    const c1 = engine.clickSharedTile(p1.id, safeTiles[0]);
    assert.equal(c1.ok, true);
    assert.equal(c1.outcome, 'DIAMOND');
    assert.equal(c1.tileInfo.initials, 'AL');
    assert.equal(engine.shared.turnPlayerId, p2.id);

    // Alice ALREADY opened >= 1 tile -> can cash out safely now even during Bob's turn!
    const aliceCash = engine.cashoutShared(p1.id);
    assert.equal(aliceCash.ok, true);
    assert.ok(aliceCash.settlement.payout > 500);
    const aliceSavedChips = p1.chips;

    // Bob clicks a BOMB -> detonates shared board, Bob busts, Alice keeps her cashed winnings!
    const bobBoom = engine.clickSharedTile(p2.id, bombTile);
    assert.equal(bobBoom.ok, true);
    assert.equal(bobBoom.outcome, 'MINE');
    assert.equal(engine.shared.phase, SHARED_PHASES.REVEALED);
    assert.equal(p1.chips, aliceSavedChips);
    const bobEntry = engine.shared.participants.get(p2.id);
    assert.equal(bobEntry.status, 'BUSTED');
    assert.equal(bobEntry.payout, 0);

    // Reset and test Turn Timeout auto-random click (zero passive hiding)
    engine._clearSharedTimers();
    engine.shared = engine._createFreshSharedState(1);
    assert.equal(engine.joinShared(p1.id, { betAmount: 100, gridSide: 4, mineCount: 3 }).ok, true);
    engine._beginSharedPlay();
    assert.equal(engine.shared.turnPlayerId, p1.id);
    assert.equal(engine.shared.participants.get(p1.id).clicksMade, 0);
    engine._handleTurnTimeout();
    assert.equal(engine.shared.participants.get(p1.id).clicksMade, 1);

    // Cheer cooldown test (1500ms)
    const ch1 = engine.cheerPlayer(p1.id, p2.id);
    assert.equal(ch1.ok, true);
    const ch2 = engine.cheerPlayer(p1.id, p2.id);
    assert.equal(ch2.ok, false);
    assert.equal(ch2.code, 'CHEER_COOLDOWN');

    engine.stop();
  });

  it('meets guardrails: zero emojis, zero audio APIs, zero banned word, valid client controller export', () => {
    const filesToCheck = [
      path.join(__dirname, '..', '..', 'server', 'game', 'minesConstants.js'),
      path.join(__dirname, '..', '..', 'server', 'game', 'minesEngine.js'),
      path.join(__dirname, '..', '..', 'client', 'js', 'mines.js'),
    ];
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/u;
    const audioRegex = /AudioContext|webkitAudioContext|<audio|\.mp3|\.wav|\.ogg|createOscillator/i;
    const bannedWord = ['d', 'o', 'p', 'a', 'm', 'i', 'n', 'e'].join('');
    const bannedRegex = new RegExp(bannedWord, 'i');

    for (const file of filesToCheck) {
      const content = fs.readFileSync(file, 'utf8');
      assert.equal(emojiRegex.test(content), false, `${path.basename(file)} must not contain emojis`);
      assert.equal(audioRegex.test(content), false, `${path.basename(file)} must not contain audio references`);
      assert.equal(bannedRegex.test(content), false, `${path.basename(file)} must not contain banned text`);
    }

    const mockCtrl = new CasinoMines({ network: null, ui: null });
    assert.equal(mockCtrl.hasActiveBets(), false);
    mockCtrl.soloGame = { status: 'ACTIVE', gridSide: 5, mineCount: 5, betAmount: 100 };
    assert.equal(mockCtrl.hasActiveBets(), true);
  });
});
