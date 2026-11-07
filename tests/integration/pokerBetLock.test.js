/**
 * pokerBetLock.test.js
 * Integration test suite for Texas Hold'em Navigation Bet Lock.
 * Verifies that:
 * 1. canPlayerNavigate maintains exact 3-argument backward compatibility.
 * 2. canPlayerNavigate blocks room switching when player has active poker bets/hands.
 * 3. canPlayerNavigate allows navigation when player folded or between hands.
 * 4. Real Socket.IO event player_set_game / leave_table / poker_leave_seat emit navigation_blocked during active poker hands.
 * 5. Navigation lock is lifted once hand concludes or player folds.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { io: Client } = require('socket.io-client');

const app = require('../../server/app');
const { setupSocket, canPlayerNavigate } = require('../../server/socket');
const { PHASES } = require('../../server/game/pokerConstants');

describe('Texas Hold\'em Poker Navigation Bet Lock Integration', () => {
  let server;
  let socketHandler;
  let serverPort;
  let client1;
  let client2;
  let player1;
  let player2;

  before(async () => {
    server = http.createServer(app);
    socketHandler = setupSocket(server);

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

    // Authenticate players
    const auth1Promise = new Promise(resolve => client1.once('auth_success', resolve));
    client1.emit('auth_session', { name: 'PokerLockPlayer1', color: '#10b981' });
    const auth1 = await auth1Promise;
    player1 = auth1.player;

    const auth2Promise = new Promise(resolve => client2.once('auth_success', resolve));
    client2.emit('auth_session', { name: 'PokerLockPlayer2', color: '#3b82f6' });
    const auth2 = await auth2Promise;
    player2 = auth2.player;
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

  describe('canPlayerNavigate Contract & Backward Compatibility', () => {
    it('maintains exact 3-argument backward compatibility for Roulette and Blackjack', () => {
      const rMock = {
        hasActiveBets: (id) => id === 'ply_roulette',
        getActiveBetTotal: (id) => id === 'ply_roulette' ? 1200 : 0
      };
      const bjMock = {
        hasActiveBets: (id) => id === 'ply_bj',
        getActiveBetTotal: (id) => id === 'ply_bj' ? 800 : 0
      };

      // 3-argument call without 4th parameter
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

    it('identifies active poker bets when pokerEngine instance is passed as 4th parameter', () => {
      const rMock = { hasActiveBets: () => false };
      const bjMock = { hasActiveBets: () => false };
      const pokerMock = {
        hasActiveBets: (id) => id === 'ply_poker',
        getActiveBetTotal: (id) => id === 'ply_poker' ? 500 : 0
      };

      const resLocked = canPlayerNavigate('ply_poker', rMock, bjMock, pokerMock);
      assert.equal(resLocked.allowed, false);
      assert.equal(resLocked.code, 'CANNOT_LEAVE_ACTIVE_BETS');
      assert.equal(resLocked.game, 'Poker');
      assert.equal(resLocked.amount, 500);
      assert.ok(resLocked.reason);

      const resFree = canPlayerNavigate('ply_free', rMock, bjMock, pokerMock);
      assert.equal(resFree.allowed, true);
    });

    it('identifies active poker bets when pokerTables Map is passed as 4th parameter', () => {
      const rMock = { hasActiveBets: () => false };
      const bjMock = { hasActiveBets: () => false };
      const pokerTablesMap = new Map();
      pokerTablesMap.set('poker_1', {
        hasActiveBets: (id) => id === 'ply_tbl1',
        getActiveBetTotal: (id) => id === 'ply_tbl1' ? 300 : 0
      });
      pokerTablesMap.set('poker_2', {
        hasActiveBets: (id) => id === 'ply_tbl2',
        getActiveBetTotal: (id) => id === 'ply_tbl2' ? 700 : 0
      });

      const res1 = canPlayerNavigate('ply_tbl1', rMock, bjMock, pokerTablesMap);
      assert.equal(res1.allowed, false);
      assert.equal(res1.code, 'CANNOT_LEAVE_ACTIVE_BETS');
      assert.equal(res1.game, 'Poker');
      assert.equal(res1.amount, 300);

      const res2 = canPlayerNavigate('ply_tbl2', rMock, bjMock, pokerTablesMap);
      assert.equal(res2.allowed, false);
      assert.equal(res2.code, 'CANNOT_LEAVE_ACTIVE_BETS');
      assert.equal(res2.game, 'Poker');
      assert.equal(res2.amount, 700);

      const resFree = canPlayerNavigate('ply_free', rMock, bjMock, pokerTablesMap);
      assert.equal(resFree.allowed, true);
    });
  });

  describe('Real-Time Socket Navigation Interceptor on Active Poker Hands', () => {
    it('blocks game switching and seat leaving during an active poker hand', async () => {
      const pokerTable = socketHandler.pokerTables.get('poker_1');

      // 1. Both players take seats at poker_1
      const seat0Promise = new Promise(resolve => client1.once('poker_seat_accepted', resolve));
      client1.emit('poker_take_seat', { tableId: 'poker_1', seatIndex: 0, buyInAmount: 2000 });
      await seat0Promise;

      const seat1Promise = new Promise(resolve => client2.once('poker_seat_accepted', resolve));
      client2.emit('poker_take_seat', { tableId: 'poker_1', seatIndex: 1, buyInAmount: 2000 });
      await seat1Promise;

      // When 2 players are seated and autoStart is on, hand starts dealing / preflop
      assert.ok(pokerTable.currentPhase !== PHASES.WAITING_FOR_PLAYERS);
      assert.equal(pokerTable.hasActiveBets(player1.id), true);
      assert.equal(pokerTable.hasActiveBets(player2.id), true);

      // 2. Player 1 attempts to switch game to Blackjack via player_set_game
      const blockedPromise = new Promise(resolve => client1.once('navigation_blocked', resolve));
      client1.emit('player_set_game', { game: 'Blackjack' });
      const blocked = await blockedPromise;

      assert.equal(blocked.code, 'CANNOT_LEAVE_ACTIVE_BETS');
      assert.equal(blocked.game, 'Poker');
      assert.ok(blocked.reason);

      // 3. Player 1 attempts to leave table via leave_table
      const blockedLeavePromise = new Promise(resolve => client1.once('navigation_blocked', resolve));
      client1.emit('leave_table');
      const blockedLeave = await blockedLeavePromise;
      assert.equal(blockedLeave.code, 'CANNOT_LEAVE_ACTIVE_BETS');

      // 4. Player 1 attempts to vacate seat via poker_leave_seat while in active hand
      const seatErrorPromise = new Promise(resolve => client1.once('poker_seat_error', resolve));
      client1.emit('poker_leave_seat', { tableId: 'poker_1', seatIndex: 0 });
      const seatErr = await seatErrorPromise;
      assert.equal(seatErr.code, 'CANNOT_LEAVE_ACTIVE_BETS');
    });

    it('lifts navigation lock when player folds or hand completes', async () => {
      const pokerTable = socketHandler.pokerTables.get('poker_1');

      // Player 1 folds their hand
      const activeSeat = pokerTable.activeTurn.seatIndex;
      const foldingClient = activeSeat === 0 ? client1 : client2;
      const foldingPlayer = activeSeat === 0 ? player1 : player2;

      const actPromise = new Promise(resolve => foldingClient.once('poker_action_success', resolve));
      foldingClient.emit('poker_action', {
        tableId: 'poker_1',
        seatIndex: activeSeat,
        action: 'fold'
      });
      await actPromise;

      // Folding ends hand immediately in heads-up!
      // In heads-up with 2 players, 1 fold triggers immediate hand end and transition to HAND_END
      assert.equal(pokerTable.hasActiveBets(foldingPlayer.id), false);

      // Now navigation should be allowed!
      const gameSwitchedPromise = new Promise(resolve => foldingClient.once('game_switched', resolve));
      foldingClient.emit('player_set_game', { game: 'Roulette' });
      const switched = await gameSwitchedPromise;
      assert.equal(switched.game, 'Roulette');
    });
  });
});
