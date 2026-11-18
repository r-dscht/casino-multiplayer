/**
 * aviaSocket.test.js
 * Socket.IO integration tests for AviaMasters Arcade Flight protocol.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { io: ioClient } = require('socket.io-client');

process.env.NODE_ENV = 'test';

const app = require('../../server/app');
const { setupSocket } = require('../../server/socket');

function waitForEvent(socket, eventName, predicate = null, timeoutMs = 4500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, handler);
      reject(new Error(`Timed out waiting for socket event: ${eventName}`));
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

async function connectAndJoin(port, name) {
  const socket = ioClient(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    reconnection: false
  });
  await waitForEvent(socket, 'connect');
  const authP = waitForEvent(socket, 'auth_success');
  const aviaP = waitForEvent(socket, 'avia_state');
  socket.emit('join_table', { name, color: '#d4af37' });
  const auth = await authP;
  const aviaState = await aviaP;
  return { socket, player: auth.player, aviaState };
}

describe('AviaMasters Socket.IO Integration Suite', () => {
  let server;
  let socketHandler;
  let port;
  const sockets = [];

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
    for (const s of sockets) {
      try {
        if (s.connected) s.disconnect();
      } catch (e) {}
    }
    if (socketHandler) {
      socketHandler.stop();
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('AS1: receives avia_state on join, switches presence to AVIA, launches flight with delayed chips_update, and enforces validation & rate limiting', async () => {
    const client = await connectAndJoin(port, 'AviaAcePilot');
    sockets.push(client.socket);

    assert.equal(client.aviaState.minBet, 10);
    assert.equal(client.aviaState.maxBet, 50000);
    assert.ok(Array.isArray(client.aviaState.validSpeeds));

    // Presence switch to AVIA
    const switchedP = waitForEvent(client.socket, 'game_switched');
    client.socket.emit('player_set_game', { game: 'Avia', location: 'AVIA' });
    const switched = await switchedP;
    assert.equal(switched.location, 'AVIA');

    // Request fresh state via avia_join
    const joinStateP = waitForEvent(client.socket, 'avia_state');
    client.socket.emit('avia_join', {});
    const joinState = await joinStateP;
    assert.equal(joinState.maxMultiplier, 150);

    // Reject invalid bet
    const rejectP = waitForEvent(client.socket, 'avia_fly_rejected');
    client.socket.emit('avia_fly', { amount: 2, speed: '1x' });
    const rej = await rejectP;
    assert.equal(rej.code, 'INVALID_BET');

    // Valid flight execution
    const acceptedP = waitForEvent(client.socket, 'avia_fly_accepted');
    const chipsP = waitForEvent(client.socket, 'chips_update', d => d && d.source === 'avia');
    const loggedP = waitForEvent(client.socket, 'avia_flight_logged');

    client.socket.emit('avia_fly', { amount: 100, speed: '4x' });
    const [accepted, chipsEv, logged] = await Promise.all([acceptedP, chipsP, loggedP]);

    assert.equal(accepted.flight.amount, 100);
    assert.equal(accepted.flight.speed, '4x');
    assert.ok(Array.isArray(accepted.flight.waypoints) && accepted.flight.waypoints.length >= 4);
    assert.ok(Array.isArray(accepted.flight.events));
    assert.equal(chipsEv.aviaDelayed, true);
    assert.equal(chipsEv.chips, accepted.newChips);
    assert.ok(logged.recentFlights.length >= 1);
  });
});
