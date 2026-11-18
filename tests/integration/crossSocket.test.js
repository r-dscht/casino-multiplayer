/**
 * crossSocket.test.js
 * Socket.IO integration tests for Monte Carlo Boulevard Cross:
 * - join_table cross_state sync
 * - player_set_game CROSS & live salon broadcast
 * - cross_start -> navigation_blocked guard -> cross_step -> cross_cashout
 * - crash settlement and disconnect salon cleanup
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { io: ioClient } = require('socket.io-client');

process.env.NODE_ENV = 'test';

const app = require('../../server/app');
const { setupSocket } = require('../../server/socket');

function waitForEvent(socket, eventName, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for socket event: ${eventName}`));
    }, timeoutMs);
    socket.once(eventName, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

async function connectAndJoin(port, name) {
  const socket = ioClient(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    reconnection: false
  });
  await waitForEvent(socket, 'connect');
  const authPromise = waitForEvent(socket, 'auth_success');
  const crossPromise = waitForEvent(socket, 'cross_state');
  socket.emit('join_table', { name, color: '#d4af37' });
  const authData = await authPromise;
  const crossState = await crossPromise;
  return { socket, player: authData.player, crossState };
}

describe('Monte Carlo Boulevard Cross Socket.IO Integration Suite', () => {
  let server;
  let socketHandler;
  let port;
  const socketsToClose = [];

  before(async () => {
    server = http.createServer(app);
    socketHandler = setupSocket(server);
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    for (const s of socketsToClose) {
      try {
        if (s.connected) s.disconnect();
      } catch (e) {}
    }
    if (socketHandler) {
      socketHandler.stop();
      if (socketHandler.io) socketHandler.io.close();
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('plays Boulevard Cross over WebSockets with nav lock, steps, cashout, and crash settlement', async () => {
    const c1 = await connectAndJoin(port, 'RenzoCrossWS');
    const c2 = await connectAndJoin(port, 'ViktorCrossWS');
    socketsToClose.push(c1.socket, c2.socket);

    assert.equal(c1.crossState.targetRtp, 0.98);
    assert.equal(c1.crossState.hitProbability, 0.2);

    // Switch presence to CROSS
    const sw1 = waitForEvent(c1.socket, 'game_switched');
    c1.socket.emit('player_set_game', { game: 'CROSS', location: 'CROSS' });
    const switched1 = await sw1;
    assert.equal(switched1.location, 'CROSS');

    const sw2 = waitForEvent(c2.socket, 'game_switched');
    const salonForC1 = waitForEvent(c1.socket, 'cross_salon_update');
    c2.socket.emit('player_set_game', { game: 'CROSS', location: 'CROSS' });
    await sw2;
    const salonPub = await salonForC1;
    assert.ok(salonPub.salonPlayers.some((p) => p.name === 'ViktorCrossWS'));

    // Start run
    const startedP = waitForEvent(c1.socket, 'cross_started');
    const chipsStartP = waitForEvent(c1.socket, 'chips_update');
    c1.socket.emit('cross_start', { betAmount: 500 });
    const started = await startedP;
    const chipsStart = await chipsStartP;
    assert.equal(started.ok, true);
    assert.equal(started.run.betAmount, 500);
    assert.equal(chipsStart.chips, 9500);

    // Cannot navigate away while active run exists
    const navBlockP = waitForEvent(c1.socket, 'navigation_blocked');
    c1.socket.emit('player_set_game', { game: 'ROULETTE', location: 'ROULETTE' });
    const navBlocked = await navBlockP;
    assert.equal(navBlocked.code, 'CANNOT_LEAVE_ACTIVE_BETS');
    assert.equal(navBlocked.game, 'Cross');

    // Cannot cash out at lane 0
    const rejP = waitForEvent(c1.socket, 'cross_rejected');
    c1.socket.emit('cross_cashout');
    const rej = await rejP;
    assert.equal(rej.code, 'CANNOT_CASHOUT_AT_START');

    // Deterministic survive rolls for 2 steps
    const origRng = socketHandler.crossEngine.rngInt;
    socketHandler.crossEngine.rngInt = (min, max) => (max === 5 ? 2 : 0);

    const step1P = waitForEvent(c1.socket, 'cross_step_result');
    c1.socket.emit('cross_step');
    const step1 = await step1P;
    assert.equal(step1.ok, true);
    assert.equal(step1.survived, true);
    assert.equal(step1.lane, 1);
    assert.equal(step1.run.currentMultiplier, 1.22);

    const step2P = waitForEvent(c1.socket, 'cross_step_result');
    c1.socket.emit('cross_step');
    const step2 = await step2P;
    assert.equal(step2.lane, 2);
    assert.equal(step2.run.currentMultiplier, 1.53);

    // Cashout works & unlocks navigation
    const cashP = waitForEvent(c1.socket, 'cross_cashout_result');
    const cashChipsP = waitForEvent(c1.socket, 'chips_update');
    c1.socket.emit('cross_cashout');
    const cashRes = await cashP;
    const cashChips = await cashChipsP;
    assert.equal(cashRes.ok, true);
    assert.equal(cashRes.payout, 765);
    assert.equal(cashChips.chips, 10265);

    // Start second run and force hit (roll 0)
    const start2P = waitForEvent(c1.socket, 'cross_started');
    c1.socket.emit('cross_start', { betAmount: 265 });
    await start2P;

    socketHandler.crossEngine.rngInt = () => 0;
    const hitP = waitForEvent(c1.socket, 'cross_step_result');
    const hitChipsP = waitForEvent(c1.socket, 'chips_update');
    c1.socket.emit('cross_step');
    const hitRes = await hitP;
    const hitChips = await hitChipsP;
    assert.equal(hitRes.hit, true);
    assert.equal(hitChips.chips, 10000);

    socketHandler.crossEngine.rngInt = origRng;

    // Navigation now succeeds
    const backP = waitForEvent(c1.socket, 'game_switched');
    c1.socket.emit('player_set_game', { game: 'ROULETTE', location: 'ROULETTE' });
    const back = await backP;
    assert.equal(back.location, 'ROULETTE');
  });
});
