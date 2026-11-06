/**
 * playerProfileSockets.test.js
 * Integration tests for Player Profile, Monograms, Game Presence, and Stats over WebSockets.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { io: Client } = require('socket.io-client');

const app = require('../../server/app');
const { setupSocket } = require('../../server/socket');

describe('Player Profile, Monograms & Presence Sockets Integration', () => {
  let server;
  let socketHandler;
  let serverPort;
  let client1;
  let client2;
  let p1Data;
  let p2Data;

  before(async () => {
    server = http.createServer(app);
    socketHandler = setupSocket(server);

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port;
        resolve();
      });
    });

    // Connect Client 1
    client1 = Client(`http://127.0.0.1:${serverPort}`, {
      transports: ['websocket'],
      forceNew: true
    });
    await new Promise(r => client1.on('connect', r));

    // Connect Client 2
    client2 = Client(`http://127.0.0.1:${serverPort}`, {
      transports: ['websocket'],
      forceNew: true
    });
    await new Promise(r => client2.on('connect', r));

    // Join table Client 1
    const p1Join = new Promise(resolve => client1.once('table_state', resolve));
    client1.emit('join_table', { name: 'Alpha Roller', color: '#10b981' });
    const s1 = await p1Join;
    p1Data = s1.players.find(p => p.name === 'Alpha Roller');

    // Join table Client 2
    const p2Join = new Promise(resolve => client2.once('table_state', resolve));
    client2.emit('join_table', { name: 'Beta VIP', color: '#3b82f6' });
    const s2 = await p2Join;
    p2Data = s2.players.find(p => p.name === 'Beta VIP');
  });

  after(async () => {
    if (client1 && client1.connected) client1.disconnect();
    if (client2 && client2.connected) client2.disconnect();

    if (socketHandler && socketHandler.engine) {
      socketHandler.engine.stop();
    }
    if (socketHandler && socketHandler.io) {
      await new Promise(resolve => socketHandler.io.close(resolve));
    }
    await new Promise(resolve => server.close(resolve));
  });

  it('should deliver monogram and initial stats in table_state', () => {
    assert.ok(p1Data);
    assert.equal(p1Data.monogram, 'AR');
    assert.equal(p1Data.currentGame, 'Roulette');
    assert.ok(p1Data.stats);
    assert.equal(p1Data.stats.roundsPlayed, 0);

    assert.ok(p2Data);
    assert.equal(p2Data.monogram, 'BV');
    assert.equal(p2Data.currentGame, 'Roulette');
  });

  it('should inspect another player profile via profile_get', async () => {
    const profilePromise = new Promise(resolve => {
      client1.once('profile_data', resolve);
    });

    client1.emit('profile_get', { playerId: p2Data.id });
    const profile = await profilePromise;

    assert.equal(profile.id, p2Data.id);
    assert.equal(profile.name, 'Beta VIP');
    assert.equal(profile.monogram, 'BV');
    assert.equal(profile.color, '#3b82f6');
    assert.equal(profile.currentGame, 'Roulette');
    assert.ok(profile.stats);
    assert.equal(profile.stats.roundsPlayed, 0);
  });

  it('should update player customization and emit profile_updated', async () => {
    const updatedPromise = new Promise(resolve => {
      client1.once('profile_updated', resolve);
    });
    const broadcastPromise = new Promise(resolve => {
      client2.once('players_update', resolve);
    });

    client1.emit('profile_update', {
      customization: { color: '#ec4899' }
    });

    const [updated, players] = await Promise.all([updatedPromise, broadcastPromise]);

    assert.equal(updated.id, p1Data.id);
    assert.equal(updated.color, '#ec4899');

    const updatedP1InList = players.find(p => p.id === p1Data.id);
    assert.ok(updatedP1InList);
    assert.equal(updatedP1InList.color, '#ec4899');
  });

  it('should update live game presence via player_set_game', async () => {
    const broadcastPromise = new Promise(resolve => {
      client2.once('players_update', resolve);
    });

    client1.emit('player_set_game', { game: 'Blackjack' });

    const players = await broadcastPromise;
    const p1 = players.find(p => p.id === p1Data.id);
    assert.ok(p1);
    assert.equal(p1.currentGame, 'Blackjack');
  });
});
