const { describe, it, beforeEach, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { io: Client } = require('socket.io-client');

const app = require('../../server/app');
const { setupSocket, canPlayerNavigate } = require('../../server/socket');
const PlayerManager = require('../../server/game/playerManager');
const BankManager = require('../../server/game/bankManager');
const RacingEngine = require('../../server/game/racingEngine');
const CasinoRacing = require('../../client/js/racing');
const {
  PHASES,
  VALID_BET_TYPES,
  MIN_BET,
  MAX_BET,
  MAX_TICKETS_PER_PLAYER,
  BASE_WIN_ODDS,
  WINNER_POT_LOSER_SHARE,
  WINNER_POT_ROLLOVER_CAP_MULT,
  FIXED_WIN_ODDS,
  PHOTO_FINISH_MARGIN_MS,
  TRACK_CONDITIONS,
  HORSE_ROSTER,
  generateRaceCard,
  simulateFairRaceTimeline,
} = require('../../server/game/racingConstants');

function waitForEvent(socket, eventName, predicate = null, timeoutMs = 5000) {
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

describe('racingConstants & Pure Random Simulation unit tests', () => {
  it('defines 4 track conditions, 12 stat-free thoroughbreds, single WIN ticket limit, and 3.0x base + 50% Winnaarspot rules', () => {
    assert.equal(TRACK_CONDITIONS.length, 4);
    assert.equal(HORSE_ROSTER.length, 12);
    assert.deepEqual(VALID_BET_TYPES, ['WIN']);
    assert.equal(MIN_BET, 10);
    assert.equal(MAX_BET, 50000);
    assert.equal(MAX_TICKETS_PER_PLAYER, 1);
    assert.equal(BASE_WIN_ODDS, 3.0);
    assert.equal(WINNER_POT_LOSER_SHARE, 0.50);
    assert.equal(WINNER_POT_ROLLOVER_CAP_MULT, 2.5);
    assert.equal(FIXED_WIN_ODDS, 3.0);
    assert.equal(PHOTO_FINISH_MARGIN_MS, 180);

    HORSE_ROSTER.forEach((h) => {
      assert.equal(h.speed, undefined);
      assert.equal(h.stamina, undefined);
      assert.equal(h.sprint, undefined);
      assert.equal(h.baseSpeed, undefined);
      assert.equal(h.preferredSurface, undefined);
    });
  });

  it('generates a 6-horse race card with equal 1/6 probability, 3.0x base odds, zero stats, and 2 sprint zones', () => {
    const card = generateRaceCard();
    assert.ok(card.track && card.track.id);
    assert.equal(card.horses.length, 6);
    assert.equal(card.turboZones.length, 2);

    const seenNames = new Set();
    card.horses.forEach((h, idx) => {
      assert.equal(h.horseId, idx + 1);
      assert.ok(!seenNames.has(h.name));
      seenNames.add(h.name);
      assert.equal(h.winOdds, FIXED_WIN_ODDS);
      assert.ok(Math.abs(h.winProb - 1 / 6) < 0.002);
      assert.equal(h.placeOdds, undefined);
      assert.equal(h.speed, undefined);
      assert.equal(h.form, undefined);
      assert.equal(h.surfaceMatch, undefined);
    });
  });

  it('simulates a fair uniform 1/6 random race timeline with monotonic horse progress', () => {
    const card = generateRaceCard();
    const sim = simulateFairRaceTimeline(card.horses);

    assert.equal(sim.finishingOrder.length, 6);
    assert.deepEqual([...sim.finishingOrder].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
    assert.ok(sim.frames.length >= 10);
    assert.ok(sim.marginMs > 0);

    const prev = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    sim.frames.forEach((f) => {
      card.horses.forEach((h) => {
        assert.ok(f.positions[h.horseId] >= prev[h.horseId] - 0.01);
        prev[h.horseId] = f.positions[h.horseId];
      });
    });

    const winnerId = sim.finishingOrder[0];
    const lastFrame = sim.frames[sim.frames.length - 1];
    assert.ok(lastFrame.positions[winnerId] >= 100);

    // Check fair 1/6 winner distribution over 600 runs
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    for (let i = 0; i < 600; i += 1) {
      const s = simulateFairRaceTimeline(card.horses);
      counts[s.finishingOrder[0]] += 1;
    }
    Object.values(counts).forEach((c) => {
      assert.ok(c >= 60 && c <= 145, `Expected uniform ~100 wins per horse, got ${c}`);
    });
  });
});

describe('RacingEngine Smart Timer, 1-Ticket Limit, House Edge & Bank/Stats unit tests', () => {
  let pm;
  let bm;
  let engine;
  let player1;
  let player2;

  beforeEach(() => {
    pm = new PlayerManager({ storagePath: null });
    bm = new BankManager(pm);
    engine = new RacingEngine({
      playerManager: pm,
      bankManager: bm,
      bettingDuration: 18,
      startingDurationMs: 50,
      raceDurationMs: 120,
      finishedDuration: 2,
      tickIntervalMs: 25,
    });
    player1 = pm.registerPlayer('s_r1', { name: 'TurfBaron', color: '#d4af37' });
    player2 = pm.registerPlayer('s_r2', { name: 'JockeyAce', color: '#38bdf8' });
  });

  afterEach(() => {
    if (engine) engine.stop();
  });

  it('uses Smart Multiplayer Timer, enforces 1-ticket limit & WIN-only bets, and reverts if cancelled', () => {
    assert.equal(engine.currentPhase, PHASES.WAITING_FOR_BETS);
    assert.equal(engine.phaseTimer, null);

    // Invalid bets rejected cleanly
    assert.equal(engine.placeBet(player1.id, { horseId: 99, betType: 'WIN', amount: 100 }).code, 'INVALID_HORSE');
    assert.equal(engine.placeBet(player1.id, { horseId: 1, betType: 'PLACE', amount: 100 }).code, 'INVALID_BET_TYPE');
    assert.equal(engine.placeBet(player1.id, { horseId: 1, betType: 'EXACTA', amount: 100 }).code, 'INVALID_BET_TYPE');
    assert.equal(engine.placeBet(player1.id, { horseId: 1, betType: 'WIN', amount: 5 }).code, 'INVALID_BET');

    pm.deductChips(player2.id, player2.chips);
    assert.equal(engine.placeBet(player2.id, { horseId: 1, betType: 'WIN', amount: 100 }).code, 'INSUFFICIENT_FUNDS');

    // 1st valid bet transitions WAITING_FOR_BETS -> BETTING automatically
    const startChips = player1.chips;
    const bet1 = engine.placeBet(player1.id, { horseId: 1, betType: 'WIN', amount: 1000 });
    assert.equal(bet1.ok, true);
    assert.equal(bet1.startedCountdown, true);
    assert.equal(bet1.ticket.lockedOdds, 3.0);
    assert.equal(bet1.ticket.potentialPayout, 3000);
    assert.equal(engine.currentPhase, PHASES.BETTING);
    assert.equal(player1.chips, startChips - 1000);
    assert.equal(engine.hasActiveBets(player1.id), true);

    // 2nd ticket on same race is blocked cleanly (max 1 ticket)
    const bet2 = engine.placeBet(player1.id, { horseId: 2, betType: 'WIN', amount: 200 });
    assert.equal(bet2.ok, false);
    assert.equal(bet2.code, 'TICKET_LIMIT_REACHED');

    // Cancel sole ticket reverts engine back to WAITING_FOR_BETS & refunds chips
    const cancelRes = engine.cancelBet(player1.id, bet1.ticket.ticketId);
    assert.equal(cancelRes.ok, true);
    assert.equal(player1.chips, startChips);
    assert.equal(engine.currentPhase, PHASES.WAITING_FOR_BETS);
    assert.equal(engine.phaseTimer, null);
    assert.equal(engine.hasActiveBets(player1.id), false);
  });

  it('enforces cosmetic-only cheering cooldown (1500ms) with zero P2W speed boost', () => {
    const ch1 = engine.cheerHorse(player1.id, 3);
    assert.equal(ch1.ok, true);
    assert.equal(ch1.cheers, 1);

    const chTooFast = engine.cheerHorse(player1.id, 3);
    assert.equal(chTooFast.ok, false);
    assert.equal(chTooFast.code, 'CHEER_COOLDOWN');

    const chPeer = engine.cheerHorse(player2.id, 3);
    assert.equal(chPeer.ok, true);
    assert.equal(chPeer.cheers, 2);

    assert.equal(typeof engine.boostHorse, 'undefined');
    assert.equal(typeof engine.cashoutTicket, 'undefined');
  });

  it('settles 3.0x base + 50% Verliezers Winnaarspot (50% casino cut), splits across multiple winners, handles rollover & bank repayment', () => {
    // Maak een echte actieve P2P lening van player2 naar player1 om winst-inhouding te testen
    const propRes = bm.createLoanProposal({
      fromId: player1.id,
      toId: player2.id,
      type: 'borrow',
      amount: 1000,
      interestPct: 10,
      winDeductionPct: 25,
    });
    assert.equal(propRes.success, true);
    const accRes = bm.acceptProposal(propRes.proposal.id, player2.id);
    assert.equal(accRes.success, true);
    assert.equal(accRes.loan.amountRepaid, 0);

    const b1 = engine.placeBet(player1.id, { horseId: 1, betType: 'WIN', amount: 600 });
    const b2 = engine.placeBet(player2.id, { horseId: 2, betType: 'WIN', amount: 200 });
    assert.equal(b1.ok && b2.ok, true);

    engine._enterStartingPhase();
    engine.simulation.finishingOrder = [1, 2, 3, 4, 5, 6];
    engine.simulation.isPhotoFinish = true;
    engine.simulation.marginMs = 88;
    engine._enterRacingPhase();

    engine._finishRace();

    assert.equal(engine.currentPhase, PHASES.FINISHED);
    assert.equal(engine.hasActiveBets(player1.id), false);

    const s1 = engine.lastResult.settlements.find((s) => s.playerId === player1.id);
    const s2 = engine.lastResult.settlements.find((s) => s.playerId === player2.id);

    // Player1 staked 600 WIN -> 600 * 3.0 = 1800 basis + 50% of loser (200 * 0.5 = 100) = 1900 gross (netProfit 1300)
    assert.equal(s1.baseReturnTotal, 1800);
    assert.equal(s1.potBonusTotal, 100);
    assert.equal(s1.totalReturned, 1900);
    assert.equal(s1.netProfit, 1300);
    assert.equal(s2.totalReturned, 0);
    assert.equal(engine.lastResult.casinoCut, 100);
    assert.equal(engine.lastResult.potDistributed, 100);

    assert.ok(Array.isArray(s1.repayments) && s1.repayments.length >= 1);
    assert.equal(accRes.loan.amountRepaid, 325);

    assert.ok(player1.stats.roundsPlayed >= 1);
    assert.ok(player1.stats.totalWon > 0);
  });

  it('splits 50% losers Winnaarspot proportionally across co-winners & rolls 0-winner races over with 2.5x cap', () => {
    const p3 = pm.registerPlayer('s_r3', { name: 'MultiWinB', color: '#10b981' });
    const p4 = pm.registerPlayer('s_r4', { name: 'LoserBetA', color: '#ef4444' });

    // Multi-winner split: p1 bets 600 on #1, p3 bets 300 on #1 (2:1 winning ratio), p2 bets 400 on #2, p4 bets 200 on #3 (600 losing -> 300 pot, 300 casino)
    assert.equal(engine.placeBet(player1.id, { horseId: 1, betType: 'WIN', amount: 600 }).ok, true);
    assert.equal(engine.placeBet(p3.id, { horseId: 1, betType: 'WIN', amount: 300 }).ok, true);
    assert.equal(engine.placeBet(player2.id, { horseId: 2, betType: 'WIN', amount: 400 }).ok, true);
    assert.equal(engine.placeBet(p4.id, { horseId: 3, betType: 'WIN', amount: 200 }).ok, true);

    engine._enterStartingPhase();
    engine.simulation.finishingOrder = [1, 2, 3, 4, 5, 6];
    engine._enterRacingPhase();
    engine._finishRace();

    const s1 = engine.lastResult.settlements.find((s) => s.playerId === player1.id);
    const s3 = engine.lastResult.settlements.find((s) => s.playerId === p3.id);
    assert.equal(engine.lastResult.casinoCut, 300);
    assert.equal(engine.lastResult.potDistributed, 300);
    assert.equal(s1.baseReturnTotal, 1800);
    assert.equal(s1.potBonusTotal, 200);
    assert.equal(s1.totalReturned, 2000);
    assert.equal(s3.baseReturnTotal, 900);
    assert.equal(s3.potBonusTotal, 100);
    assert.equal(s3.totalReturned, 1000);

    // Next race: 0 winners -> 50% rolls over into winnerPot, 50% to Casino!
    engine._prepareNextRace(false);
    assert.equal(engine.placeBet(player1.id, { horseId: 4, betType: 'WIN', amount: 1000 }).ok, true);
    engine._enterStartingPhase();
    engine.simulation.finishingOrder = [2, 1, 3, 4, 5, 6];
    engine._enterRacingPhase();
    engine._finishRace();

    assert.equal(engine.lastResult.winnerCount, 0);
    assert.equal(engine.lastResult.casinoCut, 500);
    assert.equal(engine.lastResult.inRacePotAddition, 500);
    assert.equal(engine.winnerPot, 500);

    // Race after rollover: solo 100 chip winner claims min(500, 100 * 2.5) = 250 rollover -> 300 + 250 = 550, 250 remains in pot
    engine._prepareNextRace(false);
    assert.equal(engine.placeBet(p3.id, { horseId: 1, betType: 'WIN', amount: 100 }).ok, true);
    engine._enterStartingPhase();
    engine.simulation.finishingOrder = [1, 2, 3, 4, 5, 6];
    engine._enterRacingPhase();
    engine._finishRace();

    const s3Next = engine.lastResult.settlements.find((s) => s.playerId === p3.id);
    assert.equal(s3Next.baseReturnTotal, 300);
    assert.equal(s3Next.potBonusTotal, 250);
    assert.equal(s3Next.totalReturned, 550);
    assert.equal(engine.winnerPot, 250);
  });

  it('maintains casino house edge (~85-91.67% RTP) across 1200 simulated multiplayer races with Winnaarspot', () => {
    const p3 = pm.registerPlayer('s_rtp3', { name: 'RtpP3', color: '#f59e0b' });
    let totalWagered = 0;
    let totalReturned = 0;

    for (let i = 0; i < 1200; i += 1) {
      if (player1.chips < 1000) pm.addChips(player1.id, 10000);
      if (player2.chips < 1000) pm.addChips(player2.id, 10000);
      if (p3.chips < 1000) pm.addChips(p3.id, 10000);

      const b1 = engine.placeBet(player1.id, { horseId: (i % 6) + 1, betType: 'WIN', amount: 100 });
      const b2 = engine.placeBet(player2.id, { horseId: ((i + 1) % 6) + 1, betType: 'WIN', amount: 200 });
      const b3 = engine.placeBet(p3.id, { horseId: ((i + 2) % 6) + 1, betType: 'WIN', amount: 150 });
      assert.equal(b1.ok && b2.ok && b3.ok, true);
      totalWagered += 450;
      engine._enterStartingPhase();
      engine._enterRacingPhase();
      engine._finishRace();
      engine.lastResult.settlements.forEach((s) => {
        totalReturned += s.totalReturned || 0;
      });
      engine._prepareNextRace(false);
    }

    const rtp = (totalReturned / totalWagered) * 100;
    assert.ok(rtp > 72 && rtp < 96.5, `Expected ~85-91.67% house-edge RTP over 1200 multiplayer races, got ${rtp.toFixed(2)}%`);
  });
});

describe('Horse Racing Socket.IO Integration & Navigation Lock tests', () => {
  let httpServer;
  let socketHandles;
  let baseUrl;
  const openClients = [];

  before(async () => {
    httpServer = http.createServer(app);
    socketHandles = setupSocket(httpServer);
    await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const addr = httpServer.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    openClients.forEach((c) => {
      try { c.disconnect(); } catch (e) {}
    });
    if (socketHandles && typeof socketHandles.stop === 'function') {
      socketHandles.stop();
    }
    await new Promise((resolve) => httpServer.close(resolve));
  });

  function connectClient(name) {
    return new Promise((resolve, reject) => {
      const client = Client(baseUrl, { transports: ['websocket'], forceNew: true });
      openClients.push(client);
      client.on('connect', () => {
        client.once('auth_success', (authData) => resolve({ client, authData }));
        client.emit('join_table', { name, color: '#d4af37' });
      });
      client.on('connect_error', reject);
    });
  }

  it('syncs racing_state, enforces navigation lock with active ticket, unlocks after cancel, and completes a live multiplayer race', async () => {
    const { client: c1, authData: a1 } = await connectClient('MonacoPunters1');
    const { client: c2 } = await connectClient('MonacoPunters2');

    const joinPromise = waitForEvent(c1, 'racing_state');
    c1.emit('racing_join');
    const joinState = await joinPromise;
    assert.equal(joinState.phase, PHASES.WAITING_FOR_BETS);
    assert.equal(joinState.horses.length, 6);
    assert.equal(joinState.baseWinOdds, 3.0);
    assert.equal(joinState.fixedWinOdds, 3.0);
    assert.equal(joinState.winnerPot, 0);

    const acceptP = waitForEvent(c1, 'racing_bet_accepted');
    const peerPlacedP = waitForEvent(c2, 'racing_bet_placed');
    c1.emit('racing_place_bet', { horseId: 1, betType: 'WIN', amount: 250 });
    const [acceptRes, peerPlaced] = await Promise.all([acceptP, peerPlacedP]);
    assert.equal(acceptRes.ticket.amount, 250);
    assert.equal(acceptRes.ticket.lockedOdds, 3.0);
    assert.equal(peerPlaced.startedCountdown, true);
    assert.equal(peerPlaced.totalRacePool, 250);
    assert.equal(peerPlaced.ticket.horseId, 1);

    const navRes = canPlayerNavigate(a1.player.id, null, null, null, null, socketHandles.racingEngine);
    assert.equal(navRes.allowed, false);
    assert.equal(navRes.game, 'Racing');

    const blockedP = waitForEvent(c1, 'navigation_blocked');
    c1.emit('player_set_game', { game: 'Roulette' });
    const blockedEvt = await blockedP;
    assert.equal(blockedEvt.game, 'Racing');

    const cancelSelfP = waitForEvent(c1, 'racing_bet_cancelled_self');
    c1.emit('racing_cancel_bet', { ticketId: acceptRes.ticket.ticketId });
    const cancelledRes = await cancelSelfP;
    assert.equal(cancelledRes.phase, PHASES.WAITING_FOR_BETS);

    const switchOkP = waitForEvent(c1, 'game_switched');
    c1.emit('player_set_game', { game: 'Roulette' });
    const switchEvt = await switchOkP;
    assert.equal(switchEvt.location, 'ROULETTE');

    const switchBackP = waitForEvent(c1, 'game_switched');
    c1.emit('player_set_game', { game: 'RACING' });
    const backEvt = await switchBackP;
    assert.equal(backEvt.location, 'RACING');

    const rEng = socketHandles.racingEngine;
    rEng.bettingDuration = 1;
    rEng.startingDurationMs = 50;
    rEng.raceDurationMs = 180;
    rEng.finishedDuration = 2;
    rEng.tickIntervalMs = 30;

    const cheeredP = waitForEvent(c2, 'racing_cheered');
    c1.emit('racing_cheer', { horseId: 1 });
    const cheerEvt = await cheeredP;
    assert.equal(cheerEvt.horseId, 1);
    assert.equal(cheerEvt.cheers, 1);

    const tickP = waitForEvent(c1, 'racing_tick');
    const finishedP = waitForEvent(c1, 'racing_finished');
    const settlementP = waitForEvent(c1, 'racing_settlement');

    c1.emit('racing_place_bet', { horseId: 1, betType: 'WIN', amount: 200 });

    const [tickEvt, finishedEvt, settlementEvt] = await Promise.all([
      tickP,
      finishedP,
      settlementP,
    ]);

    assert.ok(tickEvt.positions && typeof tickEvt.positions[1] === 'number');
    assert.equal(finishedEvt.finishingOrder.length, 6);
    assert.equal(settlementEvt.totalStaked, 200);
    assert.equal(rEng.hasActiveBets(a1.player.id), false);
  });
});

describe('Racing Guardrails (Zero Audio, Zero Emoji) & Client Controller Export', () => {
  it('contains zero audio APIs/files and zero unicode emojis in Racing modules', () => {
    const audioRegex = /AudioContext|webkitAudioContext|<audio|new Audio\(|\.(mp3|wav|ogg)\b/i;
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}]/u;

    const files = [
      path.join(__dirname, '../../server/game/racingConstants.js'),
      path.join(__dirname, '../../server/game/racingEngine.js'),
      path.join(__dirname, '../../client/js/racing.js'),
    ];

    files.forEach((f) => {
      const content = fs.readFileSync(f, 'utf8');
      assert.equal(audioRegex.test(content), false, `Found prohibited audio reference in ${path.basename(f)}`);
      assert.equal(emojiRegex.test(content), false, `Found prohibited unicode emoji in ${path.basename(f)}`);
    });

    const indexHtml = fs.readFileSync(path.join(__dirname, '../../client/index.html'), 'utf8');
    const racingSection = indexHtml.slice(indexHtml.indexOf('id="racing-view"'), indexHtml.indexOf('id="racing-view"') + 6500);
    assert.equal(emojiRegex.test(racingSection), false, 'Found prohibited unicode emoji in #racing-view HTML');
    assert.equal(audioRegex.test(racingSection), false, 'Found prohibited audio in #racing-view HTML');
  });

  it('exports CasinoRacing cleanly and tracks client active bet navigation lock', () => {
    assert.equal(typeof CasinoRacing, 'function');
    const emitted = [];
    const ctrl = new CasinoRacing({
      network: { on: () => {}, racingPlaceBet: (p) => emitted.push(p) },
      ui: null,
    });

    assert.equal(ctrl.hasActiveBets(), false);
    ctrl.applyState({
      raceId: 2,
      phase: 'BETTING',
      timeLeft: 12,
      myTickets: [{ ticketId: 't_1', horseId: 3, betType: 'WIN', amount: 150, potentialPayout: 825 }],
      tickets: [],
      horses: [],
    });
    assert.equal(ctrl.hasActiveBets(), true);

    ctrl.applyState({
      raceId: 2,
      phase: 'FINISHED',
      timeLeft: 4,
      myTickets: [{ ticketId: 't_1', horseId: 3, betType: 'WIN', amount: 150, potentialPayout: 825 }],
      result: { raceId: 2, finishingOrder: [3, 1, 2, 4, 5, 6], podium: [] },
    });
    assert.equal(ctrl.hasActiveBets(), false);
  });
});
