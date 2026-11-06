/**
 * tests/integration/blackjackEngineLoop.test.js
 * Verification of Blackjack engine loop, auto-refund on leave in BETTING,
 * session chip persistence restoration, and high-roller betting limits.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const Client = require('socket.io-client');
const app = require('../../server/app');
const { setupSocket } = require('../../server/socket');
const PlayerManager = require('../../server/game/playerManager');

describe('Blackjack Engine Loop, Persistence & High Bets Verification', () => {
  let server;
  let socketHandler;
  let serverPort;
  let client1;
  let client2;

  before(async () => {
    server = http.createServer(app);
    // Boot with autoStartBlackjack: true
    socketHandler = setupSocket(server, { autoStartBlackjack: true });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port;
        resolve();
      });
    });

    client1 = Client(`http://127.0.0.1:${serverPort}`, {
      transports: ['websocket'],
      forceNew: true
    });
    client2 = Client(`http://127.0.0.1:${serverPort}`, {
      transports: ['websocket'],
      forceNew: true
    });

    await Promise.all([
      new Promise(resolve => client1.on('connect', resolve)),
      new Promise(resolve => client2.on('connect', resolve))
    ]);

    // Authenticate both clients
    const a1 = new Promise(resolve => client1.once('auth_success', resolve));
    client1.emit('auth_session', { name: 'VIPPlayer1', color: '#10b981' });
    await a1;

    const a2 = new Promise(resolve => client2.once('auth_success', resolve));
    client2.emit('auth_session', { name: 'VIPPlayer2', color: '#3b82f6' });
    await a2;
  });

  after(async () => {
    if (client1 && client1.connected) client1.disconnect();
    if (client2 && client2.connected) client2.disconnect();
    if (socketHandler && typeof socketHandler.stop === 'function') {
      socketHandler.stop();
    }
    if (socketHandler && socketHandler.io) {
      await new Promise(resolve => socketHandler.io.close(resolve));
    }
    await new Promise(resolve => server.close(resolve));
  });

  it('1. Blackjack engine loops tick automatically when players are seated', async () => {
    const table1 = socketHandler.blackjackTables.get('table_1');
    assert.strictEqual(table1.isRunning, true, 'table_1 should be running');

    // Seat player 1 at seat 0 to start BETTING phase
    const seatTakenPromise = new Promise(resolve => client1.once('bj_seat_accepted', resolve));
    client1.emit('bj_take_seat', { seatIndex: 0, tableId: 'table_1' });
    await seatTakenPromise;

    // Listen for bj_phase_tick
    const tickData = await new Promise((resolve) => {
      const handler = (data) => {
        if (data.tableId === 'table_1') {
          client1.off('bj_phase_tick', handler);
          resolve(data);
        }
      };
      client1.on('bj_phase_tick', handler);
    });

    assert.ok(tickData, 'Should receive bj_phase_tick event');
    assert.strictEqual(tickData.tableId, 'table_1');
  });

  it('2. Player can leave seat in BETTING phase with auto-refund of active bet', async () => {
    const table1 = socketHandler.blackjackTables.get('table_1');
    const player1 = socketHandler.playerManager.getPlayerBySocket(client1.id);
    assert.ok(player1, 'Player 1 should be registered');
    
    const initialChips = player1.chips;

    // Place bet of 500
    client1.emit('bj_place_bet', { seatIndex: 0, amount: 500, tableId: 'table_1' });
    await new Promise(r => setTimeout(r, 80));

    assert.strictEqual(player1.chips, initialChips - 500, 'Chips should be deducted after placing bet');
    assert.strictEqual(table1.seats[0].bet, 500);

    // In client UI, clicking leave in BETTING phase emits bj_clear_bet then bj_leave_seat
    client1.emit('bj_clear_bet', { seatIndex: 0, tableId: 'table_1' });
    await new Promise(r => setTimeout(r, 80));
    assert.strictEqual(player1.chips, initialChips, 'Chips should be fully refunded on clear bet');

    client1.emit('bj_leave_seat', { seatIndex: 0, tableId: 'table_1' });
    await new Promise(r => setTimeout(r, 80));

    assert.strictEqual(table1.seats[0].player, null, 'Seat should be vacated');
    assert.strictEqual(table1.seats[0].bet, 0, 'Seat bet should be reset to 0');
  });

  it('3. High bets (5,000, 10,000, 25,000) are accepted up to 100,000 chips', async () => {
    const table1 = socketHandler.blackjackTables.get('table_1');
    const player1 = socketHandler.playerManager.getPlayerBySocket(client1.id);

    // Give player high chip balance for testing
    player1.chips = 100000;

    // Claim seat 0
    client1.emit('bj_take_seat', { seatIndex: 0, tableId: 'table_1' });
    await new Promise(r => setTimeout(r, 50));

    // Place 25,000 chip bet
    client1.emit('bj_place_bet', { seatIndex: 0, amount: 25000, tableId: 'table_1' });
    await new Promise(r => setTimeout(r, 50));

    assert.strictEqual(table1.seats[0].bet, 25000, 'Seat bet should be 25,000');
    assert.strictEqual(player1.chips, 75000, 'Chips should be 75,000');

    // Place another 25,000 chip bet
    client1.emit('bj_place_bet', { seatIndex: 0, amount: 25000, tableId: 'table_1' });
    await new Promise(r => setTimeout(r, 50));

    assert.strictEqual(table1.seats[0].bet, 50000, 'Seat bet should be 50,000');
    assert.strictEqual(player1.chips, 50000, 'Chips should be 50,000');

    // Clean up
    client1.emit('bj_leave_seat', { seatIndex: 0, tableId: 'table_1' });
    await new Promise(r => setTimeout(r, 50));
  });

  it('4. Reconnection with existing sessionToken or username preserves exact chips and never resets to 10,000', async () => {
    const pm = new PlayerManager({ storagePath: false, debounceMs: 0 });

    // Register a VIP player
    const regRes = pm.registerPlayer('sock_1', { name: 'HighRoller_VIP', password: 'secret123' });
    assert.strictEqual(regRes.chips, 10000);
    const token = regRes.sessionToken;
    const playerId = regRes.id;

    // Player wins a huge pot -> chips become 85,000
    pm.addChips(playerId, 75000);
    assert.strictEqual(regRes.chips, 85000);

    // Player disconnects
    pm.disconnectPlayer('sock_1');

    // Reconnecting via auth_session using sessionToken
    const authRes = pm.authSession('sock_2', { sessionToken: token });
    assert.ok(authRes.player, 'Player should be restored');
    assert.strictEqual(authRes.player.chips, 85000, 'Chips must remain 85,000 and NOT reset to 10,000');

    // Disconnect again
    pm.disconnectPlayer('sock_2');

    // Reconnecting via auth_session using username and password
    const authRes2 = pm.authSession('sock_3', { name: 'HighRoller_VIP', password: 'secret123' });
    assert.ok(authRes2.player, 'Player should be authenticated by name');
    assert.strictEqual(authRes2.player.chips, 85000, 'Chips must remain 85,000 after username login');

    // Reconnecting via registerPlayer with sessionToken
    const regRes2 = pm.registerPlayer('sock_4', { sessionToken: token });
    assert.strictEqual(regRes2.chips, 85000, 'registerPlayer must preserve 85,000 chips');
  });
});
