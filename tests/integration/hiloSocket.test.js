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
  const hiloPromise = waitForEvent(socket, 'hilo_state');
  socket.emit('join_table', { name, color: '#d4af37' });
  const authData = await authPromise;
  const hiloState = await hiloPromise;
  return { socket, player: authData.player, hiloState };
}

describe('Hi-Lo Privé Socket.IO Integration Suite', () => {
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

  it('plays Solo Ladder over WebSockets, locks navigation while active, supports Skip/Cashout/Cheers & Blitz join/cancel', async () => {
    const c1 = await connectAndJoin(port, 'RenzoHL');
    const c2 = await connectAndJoin(port, 'ViktorHL');
    socketsToClose.push(c1.socket, c2.socket);

    assert.equal(c1.hiloState.targetRtp, 0.94);

    // Switch presence to HILO
    const swPromise = waitForEvent(c1.socket, 'game_switched');
    c1.socket.emit('player_set_game', { game: 'HILO', location: 'HILO' });
    const sw = await swPromise;
    assert.equal(sw.location, 'HILO');

    const sw2Promise = waitForEvent(c2.socket, 'game_switched');
    c2.socket.emit('player_set_game', { game: 'HILO', location: 'HILO' });
    await sw2Promise;

    // 1. Start Solo Ladder via socket
    const startedPromise = waitForEvent(c1.socket, 'hilo_started');
    c1.socket.emit('hilo_start', { betAmount: 300 });
    const started = await startedPromise;
    assert.equal(started.ok, true);
    assert.equal(started.ladder.pot, 300);
    assert.equal(started.newChips, 9700);

    // 2. Navigation MUST be blocked while Solo Ladder active
    const navBlockedPromise = waitForEvent(c1.socket, 'navigation_blocked');
    c1.socket.emit('player_set_game', { game: 'ROULETTE', location: 'ROULETTE' });
    const blocked = await navBlockedPromise;
    assert.equal(blocked.code, 'CANNOT_LEAVE_ACTIVE_BETS');
    assert.equal(blocked.game, 'HiLo');

    // 3. Skip Card works & preserves streak + pot
    const skipPromise = waitForEvent(c1.socket, 'hilo_skipped');
    c1.socket.emit('hilo_skip', {});
    const skipped = await skipPromise;
    assert.equal(skipped.ok, true);
    assert.equal(skipped.skipsRemaining, 1);
    assert.equal(skipped.ladder.pot, 300);

    // 4. Invalid prediction rejected safely
    const rejPromise = waitForEvent(c1.socket, 'hilo_rejected');
    c1.socket.emit('hilo_guess', { prediction: 'BOGUS' });
    const rej = await rejPromise;
    assert.equal(rej.code, 'INVALID_PREDICTION');

    // 5. Cashout at Streak 0 refunds exact bet & unlocks navigation
    const cashPromise = waitForEvent(c1.socket, 'hilo_cashout_result');
    c1.socket.emit('hilo_cashout', {});
    const cashed = await cashPromise;
    assert.equal(cashed.ok, true);
    assert.equal(cashed.newChips, 10000);

    // 6. Cheer from Viktor -> Renzo broadcasts & cooldown enforces
    const cheerPromise = waitForEvent(c1.socket, 'hilo_cheered');
    c2.socket.emit('hilo_cheer', { targetPlayerId: c1.player.id });
    const cheerEvt = await cheerPromise;
    assert.equal(cheerEvt.targetId, c1.player.id);
    assert.equal(cheerEvt.targetCheers, 1);

    const cheerCooldownPromise = waitForEvent(c2.socket, 'hilo_cheer_rejected');
    c2.socket.emit('hilo_cheer', { targetPlayerId: c1.player.id });
    const cheerCooldown = await cheerCooldownPromise;
    assert.equal(cheerCooldown.code, 'CHEER_COOLDOWN');

    // 7. Blitz Join locks nav -> Blitz Cancel refunds & resets to WAITING_FOR_PLAYERS
    const blitzJoinedPromise = waitForEvent(c1.socket, 'hilo_blitz_joined');
    c1.socket.emit('hilo_blitz_join', { betAmount: 500 });
    const bzJoin = await blitzJoinedPromise;
    assert.equal(bzJoin.ok, true);
    assert.equal(bzJoin.blitz.phase, 'BETTING');
    assert.equal(bzJoin.newChips, 9500);

    const navBlockedBlitzPromise = waitForEvent(c1.socket, 'navigation_blocked');
    c1.socket.emit('player_set_game', { game: 'ROULETTE', location: 'ROULETTE' });
    const bzBlocked = await navBlockedBlitzPromise;
    assert.equal(bzBlocked.code, 'CANNOT_LEAVE_ACTIVE_BETS');

    const blitzCancelPromise = waitForEvent(c1.socket, 'hilo_blitz_cancelled');
    c1.socket.emit('hilo_blitz_cancel', {});
    const bzCancel = await blitzCancelPromise;
    assert.equal(bzCancel.ok, true);
    assert.equal(bzCancel.newChips, 10000);
    assert.equal(bzCancel.blitz.phase, 'WAITING_FOR_PLAYERS');

    // Navigation now succeeds cleanly!
    const unlockedSwPromise = waitForEvent(c1.socket, 'game_switched');
    c1.socket.emit('player_set_game', { game: 'ROULETTE', location: 'ROULETTE' });
    const unlockedSw = await unlockedSwPromise;
    assert.equal(unlockedSw.location, 'ROULETTE');
  });
});
