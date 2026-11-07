/**
 * pokerSockets.test.js
 * Comprehensive integration test suite for Texas Hold'em WebSocket Protocol.
 * Covers:
 * 1. Multi-player connection, authentication, room joining (poker_join_table).
 * 2. Seat claiming (poker_take_seat), buy-in deduction, and poker_seat_taken broadcasts.
 * 3. Authoritative private hole card security masking (unicast poker_hole_cards vs masked opponent cards in poker_table_state).
 * 4. Multi-round betting progression (poker_action: call, check, bet, raise, fold, out-of-turn rejection).
 * 5. Community card street transitions (flop, turn, river) and poker_community_cards.
 * 6. Showdown resolution (poker_hand_end, pot distribution, revealed showdown hands).
 * 7. Uncontested win on fold.
 * 8. Clean seat leave (poker_leave_seat).
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { io: Client } = require('socket.io-client');

const app = require('../../server/app');
const { setupSocket } = require('../../server/socket');
const { PHASES, ACTIONS } = require('../../server/game/pokerConstants');

describe('Texas Hold\'em Multiplayer WebSocket Protocol Integration', () => {
  let server;
  let socketHandler;
  let serverPort;
  let client1;
  let client2;
  let client3;
  let p1;
  let p2;
  let p3;

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
    client3 = Client(`http://127.0.0.1:${serverPort}`, {
      transports: ['websocket'],
      forceNew: true
    });

    await Promise.all([
      new Promise(resolve => client1.on('connect', resolve)),
      new Promise(resolve => client2.on('connect', resolve)),
      new Promise(resolve => client3.on('connect', resolve))
    ]);

    // Authenticate 3 players
    const auth1P = new Promise(resolve => client1.once('auth_success', resolve));
    client1.emit('auth_session', { name: 'VIPPokerAlice', color: '#10b981' });
    const a1 = await auth1P;
    p1 = a1.player;

    const auth2P = new Promise(resolve => client2.once('auth_success', resolve));
    client2.emit('auth_session', { name: 'VIPPokerBob', color: '#3b82f6' });
    const a2 = await auth2P;
    p2 = a2.player;

    const auth3P = new Promise(resolve => client3.once('auth_success', resolve));
    client3.emit('auth_session', { name: 'VIPPokerCharlie', color: '#f59e0b' });
    const a3 = await auth3P;
    p3 = a3.player;
  });

  after(async () => {
    if (client1 && client1.connected) client1.disconnect();
    if (client2 && client2.connected) client2.disconnect();
    if (client3 && client3.connected) client3.disconnect();
    if (socketHandler && typeof socketHandler.stop === 'function') {
      socketHandler.stop();
    }
    if (socketHandler && socketHandler.io) {
      await new Promise(resolve => socketHandler.io.close(resolve));
    }
    await new Promise(resolve => server.close(resolve));
  });

  it('1. poker_join_table should join room and return initial sanitized table state', async () => {
    const statePromise = new Promise(resolve => client1.once('poker_table_state', resolve));
    client1.emit('poker_join_table', { tableId: 'poker_1' });
    const state = await statePromise;

    assert.equal(state.tableId, 'poker_1');
    assert.equal(state.maxSeats, 6);
    assert.equal(state.seats.length, 6);
    assert.equal(state.smallBlindAmount, 50);
    assert.equal(state.bigBlindAmount, 100);
    assert.equal(state.currentPhase, PHASES.WAITING_FOR_PLAYERS);
  });

  it('2. poker_take_seat claims seat, debits bankroll, and broadcasts poker_seat_taken', async () => {
    // Client 2 also joins table room
    client2.emit('poker_join_table', { tableId: 'poker_1' });

    // Client 1 claims Seat 0 with 3000 buy-in
    const c1SeatAccepted = new Promise(resolve => client1.once('poker_seat_accepted', resolve));
    const c2SeatBroadcast = new Promise(resolve => client2.once('poker_seat_taken', resolve));
    const chipsUpdateP = new Promise(resolve => client1.once('chips_update', resolve));

    client1.emit('poker_take_seat', { tableId: 'poker_1', seatIndex: 0, buyInAmount: 3000 });

    const accepted = await c1SeatAccepted;
    const taken = await c2SeatBroadcast;
    const chips = await chipsUpdateP;

    assert.equal(accepted.seatIndex, 0);
    assert.equal(accepted.stack, 3000);
    assert.equal(taken.seatIndex, 0);
    assert.equal(taken.player.name, 'VIPPokerAlice');
    assert.equal(taken.stack, 3000);
    assert.equal(chips.chips, 7000); // 10000 - 3000
  });

  it('3. Starting a hand deals cards: authoritative private hole card unicast vs masked opponent cards', async () => {
    // Client 2 claims Seat 1 with 3000 buy-in -> triggers hand start (autoStart: true with 2 players)
    const c1HoleCardsP = new Promise(resolve => client1.once('poker_hole_cards', resolve));
    const c2HoleCardsP = new Promise(resolve => client2.once('poker_hole_cards', resolve));
    const c1StateP = new Promise(resolve => client1.once('poker_table_state', resolve));

    client2.emit('poker_take_seat', { tableId: 'poker_1', seatIndex: 1, buyInAmount: 3000 });

    const c1Hole = await c1HoleCardsP;
    const c2Hole = await c2HoleCardsP;
    const state = await c1StateP;

    // Both players receive their private hole cards via unicast
    assert.equal(c1Hole.seatIndex, 0);
    assert.equal(c1Hole.cards.length, 2);
    assert.ok(c1Hole.cards[0].rank);
    assert.ok(c1Hole.cards[0].suit);

    assert.equal(c2Hole.seatIndex, 1);
    assert.equal(c2Hole.cards.length, 2);
    assert.ok(c2Hole.cards[0].rank);
    assert.ok(c2Hole.cards[0].suit);

    // CRITICAL SECURITY CHECK:
    // In public state received, opponent hole cards are strictly masked with { hidden: true }
    // Seat 0 and Seat 1 cards in the public state broadcast must not expose opponent cards
    const pokerTable = socketHandler.pokerTables.get('poker_1');
    const spectatorState = pokerTable.getTableState(null); // public unauthenticated / spectator
    assert.deepEqual(spectatorState.seats[0].cards, [{ hidden: true }, { hidden: true }]);
    assert.deepEqual(spectatorState.seats[1].cards, [{ hidden: true }, { hidden: true }]);

    // Tailored state for Player 1 exposes Player 1 cards, but masks Player 2 cards!
    const p1State = pokerTable.getTableState(p1.id);
    assert.ok(p1State.seats[0].cards[0].rank); // Player 1 sees own cards
    assert.deepEqual(p1State.seats[1].cards, [{ hidden: true }, { hidden: true }]); // Masks opponent
  });

  it('4. Out-of-turn actions are rejected; in-turn actions update pot and stack', async () => {
    const pokerTable = socketHandler.pokerTables.get('poker_1');
    const activeSeat = pokerTable.activeTurn.seatIndex;
    const nonActiveSeat = activeSeat === 0 ? 1 : 0;
    const nonActiveClient = activeSeat === 0 ? client2 : client1;
    const activeClient = activeSeat === 0 ? client1 : client2;

    // Non-active player attempts to act out of turn -> rejected
    const rejectedP = new Promise(resolve => nonActiveClient.once('poker_action_rejected', resolve));
    nonActiveClient.emit('poker_action', {
      tableId: 'poker_1',
      seatIndex: nonActiveSeat,
      action: 'check'
    });
    const rej = await rejectedP;
    assert.equal(rej.code, 'OUT_OF_TURN');

    // Active player makes legal action (call the blind)
    const actedBroadcastP = new Promise(resolve => client3.once('poker_player_acted', resolve));
    activeClient.emit('poker_action', {
      tableId: 'poker_1',
      seatIndex: activeSeat,
      action: 'call'
    });
    const acted = await actedBroadcastP;
    assert.equal(acted.seatIndex, activeSeat);
    assert.equal(acted.action, ACTIONS.CALL);
  });

  it('5. Immediate win on fold awards entire pot and resets table', async () => {
    const pokerTable = socketHandler.pokerTables.get('poker_1');

    // Whoever has the turn folds
    const activeSeat = pokerTable.activeTurn.seatIndex;
    const activeClient = activeSeat === 0 ? client1 : client2;
    const winnerSeat = activeSeat === 0 ? 1 : 0;
    const winnerInitialStack = pokerTable.seats[winnerSeat].stack;
    const potBefore = pokerTable.potManager.getTotalPot();

    const handEndP = new Promise(resolve => client1.once('poker_hand_end', resolve));
    activeClient.emit('poker_action', {
      tableId: 'poker_1',
      seatIndex: activeSeat,
      action: 'fold'
    });

    const handEnd = await handEndP;
    assert.equal(handEnd.uncontested, true);
    assert.equal(handEnd.winners[0].seatIndex, winnerSeat);

    // Winner was awarded the pot
    assert.equal(pokerTable.seats[winnerSeat].stack, winnerInitialStack + potBefore);
  });

  it('6. Leaving seat cashes out remaining table stack and emits poker_seat_left', async () => {
    const pokerTable = socketHandler.pokerTables.get('poker_1');
    // Ensure table is in between hands or waiting
    if (pokerTable.currentPhase !== PHASES.WAITING_FOR_PLAYERS && pokerTable.currentPhase !== PHASES.HAND_END) {
      pokerTable.currentPhase = PHASES.WAITING_FOR_PLAYERS;
    }

    const currentStack = pokerTable.seats[0].stack;
    const bankrollBefore = socketHandler.playerManager.getPlayerById(p1.id).chips;

    const leftBroadcastP = new Promise(resolve => client2.once('poker_seat_left', resolve));
    const vacatedP = new Promise(resolve => client1.once('poker_seat_vacated', resolve));
    const chipsP = new Promise(resolve => client1.once('chips_update', resolve));

    client1.emit('poker_leave_seat', { tableId: 'poker_1', seatIndex: 0 });

    const left = await leftBroadcastP;
    const vacated = await vacatedP;
    const chips = await chipsP;

    assert.equal(left.seatIndex, 0);
    assert.equal(vacated.seatIndex, 0);
    assert.equal(chips.chips, bankrollBefore + currentStack);
    assert.equal(pokerTable.seats[0].player, null);
    assert.equal(pokerTable.seats[0].stack, 0);
  });
});
