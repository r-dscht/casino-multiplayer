/**
 * vaultsEngine.test.js
 * Unit & Socket.IO Integration suite for Monte Carlo Kluizenroof (Vault Elimination) & Guardrails.
 */

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { io: Client } = require('socket.io-client');

process.env.NODE_ENV = 'test';

const PlayerManager = require('../../server/game/playerManager');
const LotteryEngine = require('../../server/game/lotteryEngine');
const VaultsEngine = require('../../server/game/vaultsEngine');
const {
  DEFAULT_STAKE,
  MIN_PLAYERS,
  HOUSE_RAKE_RATE,
  INITIAL_DOOR_COUNT,
  MIN_DOOR_COUNT,
  PHASES
} = require('../../server/game/vaultsConstants');
const app = require('../../server/app');
const { setupSocket } = require('../../server/socket');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function waitForEvent(socket, eventName, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout waiting for "${eventName}"`)), timeoutMs);
    socket.once(eventName, (data) => {
      clearTimeout(t);
      resolve(data);
    });
  });
}

describe('VaultsEngine — Monte Carlo Kluizenroof Multiplayer Suite', () => {
  const cleanups = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      try { await fn(); } catch (e) {}
    }
  });

  it('V1: enforces minimum 2 players, uniform equal stake, 100% refund when waiting alone, and exact 2% rake (98% pot)', () => {
    const pm = new PlayerManager({ storagePath: false });
    const lottery = new LotteryEngine(pm, { storagePath: false });
    cleanups.push(() => lottery.stop());

    let trapPick = 0; // Always pick activeDoors[0]
    const ve = new VaultsEngine({
      playerManager: pm,
      rng: () => trapPick,
      disableTimers: true
    });
    cleanups.push(() => ve.stop());

    assert.equal(DEFAULT_STAKE, 1000);
    assert.equal(MIN_PLAYERS, 2);
    assert.equal(HOUSE_RAKE_RATE, 0.02);

    const p1 = pm.registerPlayer('s1', { name: 'KluiskrakerA', color: '#fde047' });
    const p2 = pm.registerPlayer('s2', { name: 'KluiskrakerB', color: '#34d399' });

    // Player 1 sets stake 2.500 F, joins pot, leaves for 100% refund, then joins again
    const sRes = ve.setStake(p1.id, 2500);
    assert.equal(sRes.ok, true);
    const j1 = ve.joinMatch(p1.id, 2500);
    assert.equal(j1.ok, true);
    assert.equal(p1.chips, 7500);
    assert.equal(ve.phase, PHASES.WAITING);

    const leaveRes = ve.leaveMatch(p1.id);
    assert.equal(leaveRes.ok, true);
    assert.equal(leaveRes.refunded, 2500);
    assert.equal(p1.chips, 10000);

    // Both players join with equal 1.000 F stake -> transitions to LOBBY_COUNTDOWN
    assert.equal(ve.joinMatch(p1.id, 1000).ok, true);
    assert.equal(ve.joinMatch(p2.id, 5000).ok, true); // 2nd player forced into existing 1.000 F pot
    assert.equal(p1.chips, 9000);
    assert.equal(p2.chips, 9000);
    assert.equal(ve.phase, PHASES.LOBBY_COUNTDOWN);
    assert.equal(ve.stakeAmount, 1000);

    // 2nd player cannot change stake once countdown started
    assert.equal(ve.setStake(p1.id, 5000).ok, false);

    // Ready up -> immediate start with 5 doors and maxPerDoor = 1 in 2-player duel
    ve.markReady(p1.id);
    ve.markReady(p2.id);
    assert.equal(ve.phase, PHASES.CHOOSING);
    assert.equal(ve.activeDoors.length, INITIAL_DOOR_COUNT);
    assert.equal(ve.getMaxPerDoor(2), 1);

    // P1 picks Door 0 -> P2 blocked from also picking Door 0 (prevents double wipeout)
    assert.equal(ve.pickDoor(p1.id, 0).ok, true);
    const dupRes = ve.pickDoor(p2.id, 0);
    assert.equal(dupRes.ok, false);
    assert.equal(dupRes.code, 'DOOR_FULL');

    // P2 picks Door 1 -> both picked -> resolves immediately -> Door 0 is trapped -> P1 eliminated, P2 wins!
    trapPick = 0; // activeDoors[0] === 0
    ve.pickDoor(p2.id, 1);
    assert.equal(ve.phase, PHASES.REVEALING);
    assert.equal(p1.status !== 'ALIVE', true);
    assert.equal(ve.participants.get(p1.id).status, 'ELIMINATED');

    // Advance after reveal -> settles winner P2: 2 * 1.000 = 2.000 gross, 2% = 40 F rake -> 1.960 F net prize
    ve._advanceAfterReveal();
    assert.equal(ve.phase, PHASES.COMPLETE);
    assert.equal(p2.chips, 9000 + 1960);
    assert.equal(ve.lastWinner.grossPot, 2000);
    assert.equal(ve.lastWinner.houseRake, 40);
    assert.equal(ve.lastWinner.netPrize, 1960);

    // Eliminated P1 fed 1% of 1.000 F loss (= 10 F) into Krasloten pot
    assert.equal(lottery.pot, 10010);
  });

  it('V2: drops 1 door permanently each round (5 -> 4 -> 3 -> 2) across a 4-player match', () => {
    const pm = new PlayerManager({ storagePath: false });
    const ve = new VaultsEngine({
      playerManager: pm,
      rng: () => 0, // Trapped door is always activeDoors[0]
      disableTimers: true
    });
    cleanups.push(() => ve.stop());

    const players = ['A', 'B', 'C', 'D'].map((tag, i) => pm.registerPlayer(`s${i}`, { name: `Heist${tag}`, color: '#fde047' }));
    players.forEach((p) => assert.equal(ve.joinMatch(p.id, 1000).ok, true));
    players.forEach((p) => ve.markReady(p.id));

    // Round 1: 5 doors, maxPerDoor = 3 -> A gets trapped in Door 0; B,C,D survive on safe doors
    assert.equal(ve.activeDoors.length, 5);
    ve.pickDoor(players[0].id, 0);
    ve.pickDoor(players[1].id, 1);
    ve.pickDoor(players[2].id, 2);
    ve.pickDoor(players[3].id, 3);
    assert.equal(ve.phase, PHASES.REVEALING);
    ve._advanceAfterReveal();

    // Round 2: Door 0 is sealed forever -> 4 doors remain ([1, 2, 3, 4])
    assert.equal(ve.phase, PHASES.CHOOSING);
    assert.equal(ve.activeDoors.length, 4);
    assert.deepEqual(ve.activeDoors, [1, 2, 3, 4]);
    assert.equal(ve.pickDoor(players[1].id, 0).ok, false); // Cannot pick dropped Door 0

    // Round 2: B gets trapped in activeDoors[0] (= Door 1); C,D survive
    ve.pickDoor(players[1].id, 1);
    ve.pickDoor(players[2].id, 2);
    ve.pickDoor(players[3].id, 3);
    ve._advanceAfterReveal();

    // Round 3: Door 1 sealed -> 3 doors remain ([2, 3, 4]) -> C gets trapped in Door 2; D wins 98% of 4.000 = 3.920 F!
    assert.equal(ve.activeDoors.length, 3);
    assert.deepEqual(ve.activeDoors, [2, 3, 4]);
    ve.pickDoor(players[2].id, 2);
    ve.pickDoor(players[3].id, 3);
    ve._advanceAfterReveal();

    assert.equal(ve.phase, PHASES.COMPLETE);
    assert.equal(players[3].chips, 9000 + 3920);
    assert.equal(ve.sealedDoors.length >= MIN_DOOR_COUNT, true);
  });

  it('V3: plays end-to-end 2-player Kluizenroof match over Socket.IO with nav lock & winner payout', async () => {
    const server = http.createServer(app);
    const socketHandler = setupSocket(server, { lotteryOptions: { storagePath: false } });
    cleanups.push(async () => {
      socketHandler.stop();
      if (socketHandler.io) await new Promise((r) => socketHandler.io.close(r));
      await new Promise((r) => server.close(r));
    });

    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;

    // Speed up reveal/complete timers slightly for snappy integration test & force deterministic trap on activeDoors[0]
    socketHandler.vaultsEngine.rng = () => 0;
    socketHandler.vaultsEngine.revealDurationMs = 80;
    socketHandler.vaultsEngine.completeHoldMs = 100;

    async function connectPlayer(name) {
      const sock = Client(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });
      cleanups.push(() => { if (sock.connected) sock.disconnect(); });
      await new Promise((r) => sock.on('connect', r));
      const authP = waitForEvent(sock, 'auth_success');
      sock.emit('auth_session', { name, color: '#D4AF37' });
      const auth = await authP;
      return { sock, player: auth.player };
    }

    const c1 = await connectPlayer('VaultAlice');
    const c2 = await connectPlayer('VaultBob');

    const j1P = waitForEvent(c1.sock, 'vaults_joined');
    c1.sock.emit('vaults_join_pot', { stake: 2500 });
    await j1P;

    const j2P = waitForEvent(c2.sock, 'vaults_joined');
    c2.sock.emit('vaults_join_pot', { stake: 2500 });
    await j2P;

    // Alive players in countdown/active match cannot switch games freely
    const navRes = socketHandler.canPlayerNavigate(c1.player.id);
    assert.equal(navRes.allowed, false);
    assert.equal(navRes.game, 'Vaults');

    const startChoosingP = waitForEvent(c1.sock, 'vaults_state');
    c1.sock.emit('vaults_ready');
    c2.sock.emit('vaults_ready');
    await startChoosingP;

    const wonP = waitForEvent(c2.sock, 'vaults_match_won');
    c1.sock.emit('vaults_pick_door', { doorIndex: 0 });
    c2.sock.emit('vaults_pick_door', { doorIndex: 1 });
    const winData = await wonP;

    // 2 * 2.500 = 5.000 gross pot; 2% = 100 rake -> 4.900 net prize!
    assert.equal(winData.playerName, 'VaultBob');
    assert.equal(winData.grossPot, 5000);
    assert.equal(winData.houseRake, 100);
    assert.equal(winData.netPrize, 4900);
    assert.equal(winData.remainingChips, 7500 + 4900);
  });

  it('V4: enforces zero audio APIs, zero Unicode emojis, and zero banned terms on Vaults files', () => {
    const files = [
      'server/game/vaultsConstants.js',
      'server/game/vaultsEngine.js',
      'client/js/vaults.js'
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
});
