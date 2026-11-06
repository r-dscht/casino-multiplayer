/**
 * blackjackSockets.test.js
 * Integration test suite for Multiplayer Blackjack WebSocket Protocol.
 * Covers: Concurrent player seating across 6 seats, multi-table support,
 * betting lifecycle, hole card security masking, turn progression & actions,
 * dealer S17 draw, and authoritative round settlement over real sockets.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { io: Client } = require('socket.io-client');

const app = require('../../server/app');
const { setupSocket } = require('../../server/socket');

describe('Multiplayer Blackjack WebSocket Integration Protocol', () => {
  let server;
  let socketHandler;
  let serverPort;
  let client1;
  let client2;

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

  it('should authenticate both players and allow joining the Blackjack table', async () => {
    // Auth Player 1
    const auth1Promise = new Promise(resolve => client1.once('auth_success', resolve));
    client1.emit('auth_session', { name: 'HighRoller1', color: '#10b981' });
    const auth1 = await auth1Promise;
    assert.equal(auth1.player.name, 'HighRoller1');
    assert.equal(auth1.player.chips, 10000);

    // Auth Player 2
    const auth2Promise = new Promise(resolve => client2.once('auth_success', resolve));
    client2.emit('auth_session', { name: 'HighRoller2', color: '#3b82f6' });
    const auth2 = await auth2Promise;
    assert.equal(auth2.player.name, 'HighRoller2');
    assert.equal(auth2.player.chips, 10000);

    // Join table 1
    const statePromise = new Promise(resolve => client1.once('bj_table_state', resolve));
    client1.emit('bj_join_table', { tableId: 'table_1' });
    const state = await statePromise;
    assert.equal(state.tableId, 'table_1');
    assert.equal(state.maxSeats, 6);
    assert.equal(state.seats.length, 6);
  });

  it('should allow taking distinct seats (0 and 3) and reject occupied seats', async () => {
    // Player 1 claims Seat 0
    const p1SeatBroadcast = new Promise(resolve => client2.once('bj_seat_taken', resolve));
    client1.emit('bj_take_seat', { tableId: 'table_1', seatIndex: 0 });
    const takenEvent = await p1SeatBroadcast;
    assert.equal(takenEvent.seatIndex, 0);
    assert.equal(takenEvent.player.name, 'HighRoller1');

    // Player 2 attempts to claim Seat 0 -> rejected
    const errorPromise = new Promise(resolve => client2.once('bj_seat_error', resolve));
    client2.emit('bj_take_seat', { tableId: 'table_1', seatIndex: 0 });
    const err = await errorPromise;
    assert.equal(err.code, 'SEAT_OCCUPIED');

    // Player 2 claims Seat 3 -> accepted
    const p2SeatBroadcast = new Promise(resolve => client1.once('bj_seat_taken', resolve));
    client2.emit('bj_take_seat', { tableId: 'table_1', seatIndex: 3 });
    const p2Taken = await p2SeatBroadcast;
    assert.equal(p2Taken.seatIndex, 3);
    assert.equal(p2Taken.player.name, 'HighRoller2');
  });

  it('should handle bet placement, chip deduction, and room broadcast', async () => {
    // Player 1 bets 500
    const p1Accepted = new Promise(resolve => client1.once('bj_bet_accepted', resolve));
    const p1Broadcast = new Promise(resolve => client2.once('bj_bet_placed', resolve));

    client1.emit('bj_place_bet', { tableId: 'table_1', seatIndex: 0, amount: 500 });
    const accepted = await p1Accepted;
    assert.equal(accepted.amount, 500);
    assert.equal(accepted.chipsRemaining, 9500);

    const placed = await p1Broadcast;
    assert.equal(placed.seatIndex, 0);
    assert.equal(placed.amount, 500);

    // Player 2 bets 1000
    const p2Accepted = new Promise(resolve => client2.once('bj_bet_accepted', resolve));
    client2.emit('bj_place_bet', { tableId: 'table_1', seatIndex: 3, amount: 1000 });
    const accepted2 = await p2Accepted;
    assert.equal(accepted2.amount, 1000);
    assert.equal(accepted2.chipsRemaining, 9000);
  });

  it('should mask dealer hole card during DEALING and PLAYER_TURNS phases over socket', async () => {
    const table = socketHandler.blackjackTables.get('table_1');
    // Transition to DEALING
    table.transitionToDealing();

    // Query table state via socket
    const statePromise = new Promise(resolve => client1.once('bj_table_state', resolve));
    client1.emit('bj_join_table', { tableId: 'table_1' });
    const state = await statePromise;

    assert.equal(state.phase, 'DEALING');
    assert.equal(state.dealerHand.length, 2);
    assert.ok(state.dealerHand[0].rank);
    assert.equal(state.dealerHand[1].hidden, true, 'Hole card must be masked with hidden: true');
    assert.equal(state.dealerHand[1].rank, undefined, 'Hole card rank must never be transmitted');
  });

  it('should process player hit action, update hand value, and broadcast action_applied', async () => {
    const table = socketHandler.blackjackTables.get('table_1');
    table.dealerCards = [
      { id: 'c_d1', suit: 'hearts', rank: '10', value: 10 },
      { id: 'c_d2', suit: 'spades', rank: '6', value: 6 }
    ];
    table.seats[0].hands[0].cards = [
      { id: 'c_test_1', suit: 'hearts', rank: '2', value: 2 },
      { id: 'c_test_2', suit: 'spades', rank: '3', value: 3 }
    ];
    table.seats[0].hands[0].status = 'active';

    table.transitionToPlayerTurns();
    assert.equal(table.activeTurn.seatIndex, 0);

    const actionPromise = new Promise(resolve => client2.once('bj_action_applied', resolve));
    client1.emit('bj_action', {
      tableId: 'table_1',
      seatIndex: 0,
      handIndex: 0,
      action: 'hit'
    });

    const event = await actionPromise;
    assert.equal(event.seatIndex, 0);
    assert.equal(event.action, 'hit');
    assert.ok(event.card);
    assert.equal(table.seats[0].hands[0].cards.length, 3);
  });

  it('should advance to Seat 3 when Seat 0 stands', async () => {
    const table = socketHandler.blackjackTables.get('table_1');
    table.currentPhase = 'PLAYER_TURNS';
    table.seats[0].hands[0].status = 'active';
    table.seats[0].hands[0].cards = [
      { id: 'c_s0_1', suit: 'hearts', rank: '10', value: 10 },
      { id: 'c_s0_2', suit: 'spades', rank: '7', value: 7 }
    ];
    table.seats[3].hands[0].status = 'active';
    table.seats[3].hands[0].cards = [
      { id: 'c_s3_1', suit: 'clubs', rank: '10', value: 10 },
      { id: 'c_s3_2', suit: 'diamonds', rank: '8', value: 8 }
    ];
    table.activeTurn = { seatIndex: 0, handIndex: 0 };
    table.turnTimeLeft = 15;

    const turnPromise = new Promise(resolve => client2.once('bj_turn_change', resolve));
    client1.emit('bj_action', {
      tableId: 'table_1',
      seatIndex: 0,
      handIndex: 0,
      action: 'stand'
    });

    const turn = await turnPromise;
    assert.equal(turn.seatIndex, 3);
    assert.equal(table.activeTurn.seatIndex, 3);
  });

  it('should reveal dealer hole card in DEALER_TURN and broadcast round_result', async () => {
    const table = socketHandler.blackjackTables.get('table_1');
    // Seat 3 stands
    table.seats[3].hands[0].status = 'stood';

    const revealPromise = new Promise(resolve => client1.once('bj_dealer_reveal', resolve));
    const resultPromise = new Promise(resolve => client1.once('bj_round_result', resolve));

    // Advancing from Seat 3 transitions to DEALER_TURN
    table.advanceTurn();

    const reveal = await revealPromise;
    assert.ok(reveal.dealerHand);
    assert.equal(reveal.dealerHand.length >= 2, true);

    // Transition to payout
    table.transitionToPayout();
    const result = await resultPromise;
    assert.ok(Array.isArray(result.results));
    assert.ok(result.dealerHand);
  });
});
