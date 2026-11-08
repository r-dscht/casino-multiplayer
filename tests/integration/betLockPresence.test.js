/**
 * betLockPresence.test.js
 * Integration test suite for Requirement R2: Navigation Bet Lock & Multi-Game Presence.
 * Verifies that players cannot navigate away, switch games, or vacate table seats
 * while active, unresolved bets are committed to Roulette or Blackjack.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { io: Client } = require('socket.io-client');

const app = require('../../server/app');
const { setupSocket, canPlayerNavigate } = require('../../server/socket');

describe('Navigation Bet Lock & Presence Integration (Roulette & Blackjack)', () => {
  let server;
  let socketHandler;
  let serverPort;
  let clientSocket;
  let authenticatedPlayer;

  before(async () => {
    server = http.createServer(app);
    socketHandler = setupSocket(server);

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port;
        resolve();
      });
    });

    clientSocket = Client(`http://127.0.0.1:${serverPort}`, {
      transports: ['websocket'],
      forceNew: true
    });

    await new Promise(resolve => clientSocket.on('connect', resolve));

    const authPromise = new Promise(resolve => clientSocket.once('auth_success', resolve));
    clientSocket.emit('auth_session', { name: 'MonteCarloVIP', color: '#10b981' });
    const auth = await authPromise;
    authenticatedPlayer = auth.player;
  });

  after(async () => {
    if (clientSocket && clientSocket.connected) {
      clientSocket.disconnect();
    }
    if (socketHandler && typeof socketHandler.stop === 'function') {
      socketHandler.stop();
    }
    if (socketHandler && socketHandler.io) {
      await new Promise(resolve => socketHandler.io.close(resolve));
    }
    await new Promise(resolve => server.close(resolve));
  });

  it('canPlayerNavigate helper should directly identify active bets on Roulette and Blackjack', () => {
    const rMock = {
      hasActiveBets: (id) => id === 'ply_roulette',
      getActiveBetTotal: (id) => id === 'ply_roulette' ? 1200 : 0
    };
    const bjMock = {
      hasActiveBets: (id) => id === 'ply_bj',
      getActiveBetTotal: (id) => id === 'ply_bj' ? 800 : 0
    };

    const resRoulette = canPlayerNavigate('ply_roulette', rMock, bjMock);
    assert.equal(resRoulette.allowed, false);
    assert.equal(resRoulette.code, 'CANNOT_LEAVE_ACTIVE_BETS');
    assert.equal(resRoulette.game, 'Roulette');
    assert.equal(resRoulette.amount, 1200);

    const resBj = canPlayerNavigate('ply_bj', rMock, bjMock);
    assert.equal(resBj.allowed, false);
    assert.equal(resBj.code, 'CANNOT_LEAVE_ACTIVE_BETS');
    assert.equal(resBj.game, 'Blackjack');
    assert.equal(resBj.amount, 800);

    const resFree = canPlayerNavigate('ply_free', rMock, bjMock);
    assert.equal(resFree.allowed, true);
  });

  it('should block navigation when player has an active bet on Roulette', async () => {
    // 1. Place bet on Roulette
    const betAccepted = new Promise(resolve => clientSocket.once('bet_accepted', resolve));
    clientSocket.emit('place_bet', { type: 'red', amount: 500 });
    await betAccepted;

    assert.equal(socketHandler.engine.hasActiveBets(authenticatedPlayer.id), true);

    // 2. Attempt to switch to Blackjack via player_set_game
    const blockedPromise = new Promise(resolve => clientSocket.once('navigation_blocked', resolve));
    clientSocket.emit('player_set_game', { game: 'Blackjack' });
    const blocked = await blockedPromise;

    assert.equal(blocked.code, 'CANNOT_LEAVE_ACTIVE_BETS');
    assert.equal(blocked.game, 'Roulette');
    assert.equal(blocked.amount, 500);

    // 3. Attempt leave_table -> blocked
    const blockedLeavePromise = new Promise(resolve => clientSocket.once('navigation_blocked', resolve));
    clientSocket.emit('leave_table', {});
    const blockedLeave = await blockedLeavePromise;
    assert.equal(blockedLeave.code, 'CANNOT_LEAVE_ACTIVE_BETS');

    // 4. Clear bet -> lock lifted
    const clearPromise = new Promise(resolve => clientSocket.once('bets_cleared', resolve));
    clientSocket.emit('clear_bets', {});
    await clearPromise;

    assert.equal(socketHandler.engine.hasActiveBets(authenticatedPlayer.id), false);

    // 5. Switch to Blackjack now succeeds
    const switchPromise = new Promise(resolve => clientSocket.once('game_switched', resolve));
    clientSocket.emit('player_set_game', { game: 'Blackjack' });
    const switched = await switchPromise;
    assert.equal(switched.game, 'Blackjack');
  });

  it('should block navigation when player has an active bet on Blackjack', async () => {
    // 1. Take seat 1 at Blackjack table 1
    const seatAccepted = new Promise(resolve => clientSocket.once('bj_seat_accepted', resolve));
    clientSocket.emit('bj_take_seat', { tableId: 'table_1', seatIndex: 1 });
    await seatAccepted;

    // 2. Place bet of 750
    const betAccepted = new Promise(resolve => clientSocket.once('bj_bet_accepted', resolve));
    clientSocket.emit('bj_place_bet', { tableId: 'table_1', seatIndex: 1, amount: 750 });
    await betAccepted;

    const bjTable = socketHandler.blackjackTables.get('table_1');
    assert.equal(bjTable.hasActiveBets(authenticatedPlayer.id), true);
    assert.equal(bjTable.getActiveBetTotal(authenticatedPlayer.id), 750);

    // 3. Attempt to switch to Roulette via player_set_game -> blocked
    const blockedSwitch = new Promise(resolve => clientSocket.once('navigation_blocked', resolve));
    clientSocket.emit('player_set_game', { game: 'Roulette' });
    const blocked = await blockedSwitch;
    assert.equal(blocked.code, 'CANNOT_LEAVE_ACTIVE_BETS');
    assert.equal(blocked.game, 'Blackjack');
    assert.equal(blocked.amount, 750);

    // 4. Attempt to leave seat -> blocked
    const blockedLeaveSeat = new Promise(resolve => clientSocket.once('navigation_blocked', resolve));
    clientSocket.emit('bj_leave_seat', { tableId: 'table_1', seatIndex: 1 });
    const blockedSeat = await blockedLeaveSeat;
    assert.equal(blockedSeat.code, 'CANNOT_LEAVE_ACTIVE_BETS');

    // 5. Clear bet on Blackjack -> lock lifted
    const chipsPromise = new Promise(resolve => clientSocket.once('chips_update', resolve));
    clientSocket.emit('bj_clear_bet', { tableId: 'table_1', seatIndex: 1 });
    await chipsPromise;

    assert.equal(bjTable.hasActiveBets(authenticatedPlayer.id), false);

    // 6. Leaving seat now succeeds
    const vacatePromise = new Promise(resolve => clientSocket.once('bj_seat_vacated', resolve));
    clientSocket.emit('bj_leave_seat', { tableId: 'table_1', seatIndex: 1 });
    const vacated = await vacatePromise;
    assert.equal(vacated.seatIndex, 1);
  });

  it('should unlock navigation once Blackjack round completes and settles payouts', async () => {
    const bjTable = socketHandler.blackjackTables.get('table_1');

    // Sit at seat 2 and place bet
    const seatAccepted = new Promise(resolve => clientSocket.once('bj_seat_accepted', resolve));
    clientSocket.emit('bj_take_seat', { tableId: 'table_1', seatIndex: 2 });
    await seatAccepted;

    const betAccepted = new Promise(resolve => clientSocket.once('bj_bet_accepted', resolve));
    clientSocket.emit('bj_place_bet', { tableId: 'table_1', seatIndex: 2, amount: 200 });
    await betAccepted;

    assert.equal(bjTable.hasActiveBets(authenticatedPlayer.id), true);

    // Advance table through dealing and payout
    bjTable.transitionToDealing();
    bjTable.seats[2].hands[0].status = 'stood';
    bjTable.dealerCards = [{ rank: '10' }, { rank: '8' }];

    // During dealing/turns, bet is active
    assert.equal(bjTable.hasActiveBets(authenticatedPlayer.id), true);

    // Execute payout and round over
    bjTable.transitionToPayout();
    bjTable.transitionToRoundOver();

    // In ROUND_OVER, bets are settled
    assert.equal(bjTable.hasActiveBets(authenticatedPlayer.id), false);

    // Player can now leave table without restriction
    const switchPromise = new Promise(resolve => clientSocket.once('game_switched', resolve));
    clientSocket.emit('player_set_game', { game: 'Roulette' });
    const switched = await switchPromise;
    assert.equal(switched.game, 'Roulette');

    // Verify Blackjack seat is automatically vacated when switching away
    assert.equal(bjTable.seats[2].player, null);
  });
});
