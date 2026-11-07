/**
 * adversarialPokerSockets.test.js
 * Adversarial Network Stress, Socket Concurrency, Disconnect Resilience & Security Suite
 * for 6-Seat Texas Hold'em Poker (Milestone PK-M4 Gate).
 *
 * EMPIRICAL CHALLENGE VECTORS:
 * 1. Socket Concurrency: 6 concurrent players taking seats 0..5 simultaneously, seat race contention,
 *    7th spectator rejection, and out-of-turn action flood resistance.
 * 2. Turn Timeout Anti-Stall: 15s countdown timer expiration triggers auto-check when free (toCall === 0)
 *    and auto-fold when bet pending (toCall > 0) without stalling table progression.
 * 3. Mid-Hand Disconnect Resilience & Persistence: Disconnecting mid-hand preserves seat reservation;
 *    turns auto-act on timeout without stalling other players; post-hand remaining stack is cashed out
 *    to disk atomically.
 * 4. Hole Card Security Audit: Verifies public table state and broadcast events strictly mask opponent
 *    cards with [{ hidden: true }] for spectators and opponents across all phases.
 * 5. Navigation Bet Lock: Verifies canPlayerNavigate and socket events block room switching and seat
 *    leaving during active hands with CANNOT_LEAVE_ACTIVE_BETS, and allow navigation once folded or between hands.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { io: Client } = require('socket.io-client');

const app = require('../../server/app');
const { setupSocket, canPlayerNavigate } = require('../../server/socket');
const { PHASES, ACTIONS, SEAT_STATUS } = require('../../server/game/pokerConstants');

// Helper to create connected socket client
function createClient(serverPort) {
  return Client(`http://127.0.0.1:${serverPort}`, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false
  });
}

// Helper to await single socket event with timeout
function waitForEvent(socket, eventName, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event '${eventName}' after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.once(eventName, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

// Helper to await matching socket event with predicate and timeout
function waitForMatchingEvent(socket, eventName, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, handler);
      reject(new Error(`Timeout waiting for event '${eventName}' with matching predicate after ${timeoutMs}ms`));
    }, timeoutMs);

    function handler(payload) {
      if (predicate(payload)) {
        clearTimeout(timer);
        socket.off(eventName, handler);
        resolve(payload);
      }
    }

    socket.on(eventName, handler);
  });
}

describe('Texas Hold\'em Adversarial Network Stress & Disconnect Resilience Suite', () => {

  // ===========================================================================
  // Dimension 1: Socket Concurrency, Seat Races & 6-Seat Accommodations
  // ===========================================================================
  describe('Dimension 1: Socket Concurrency & Seat Contention Stress', () => {
    let server;
    let socketHandler;
    let port;
    const clients = [];

    before(async () => {
      server = http.createServer(app);
      socketHandler = setupSocket(server);
      await new Promise(res => server.listen(0, '127.0.0.1', res));
      port = server.address().port;
    });

    after(async () => {
      for (const c of clients) {
        if (c && c.connected) c.disconnect();
      }
      if (socketHandler && typeof socketHandler.stop === 'function') {
        socketHandler.stop();
      }
      if (socketHandler && socketHandler.io) {
        await new Promise(r => socketHandler.io.close(r));
      }
      await new Promise(r => server.close(r));
    });

    it('1.1 should concurrently seat 6 distinct players in seats 0 through 5 without corruption', async () => {
      // Connect and auth 6 clients
      for (let i = 0; i < 6; i++) {
        const client = createClient(port);
        clients.push(client);
        await new Promise(r => client.on('connect', r));

        const authP = waitForEvent(client, 'auth_success');
        client.emit('auth_session', { name: `VIPConcur_${i}`, color: '#10b981' });
        const auth = await authP;
        assert.equal(auth.player.chips, 10000);

        // Join poker_1 table room
        client.emit('poker_join_table', { tableId: 'poker_1' });
      }

      // Concurrently emit poker_take_seat for seats 0 through 5
      const seatPromises = clients.map((client, seatIndex) => {
        return new Promise(resolve => {
          const onAccepted = (data) => {
            client.off('poker_seat_error', onError);
            resolve({ success: true, seatIndex, data });
          };
          const onError = (err) => {
            client.off('poker_seat_accepted', onAccepted);
            resolve({ success: false, seatIndex, err });
          };
          client.once('poker_seat_accepted', onAccepted);
          client.once('poker_seat_error', onError);
          client.emit('poker_take_seat', { tableId: 'poker_1', seatIndex, buyInAmount: 2000 });
        });
      });

      const seatResults = await Promise.all(seatPromises);

      // Verify all 6 seats claimed successfully
      for (let i = 0; i < 6; i++) {
        assert.equal(seatResults[i].success, true, `Seat ${i} must succeed in concurrent seating`);
        assert.equal(seatResults[i].seatIndex, i);
      }

      const table = socketHandler.pokerTables.get('poker_1');
      assert.equal(table.seats.length, 6);

      // Invariant: Total chips across table seats + current pot must exactly equal 6 * 2000 = 12000
      const totalTableChips = table.seats.reduce((sum, s) => sum + s.stack, 0) + table.potManager.getTotalPot();
      assert.equal(totalTableChips, 12000, 'Sum of stacks and pot must equal total buy-ins (12,000)');

      for (let i = 0; i < 6; i++) {
        assert.ok(table.seats[i].player, `Seat ${i} must have an assigned player`);
        assert.equal(table.seats[i].player.name, `VIPConcur_${i}`);
      }
    });

    it('1.2 should strictly reject a 7th spectator attempting to claim any seat (0..5) or out-of-bounds seats', async () => {
      const client7 = createClient(port);
      clients.push(client7);
      await new Promise(r => client7.on('connect', r));

      const authP = waitForEvent(client7, 'auth_success');
      client7.emit('auth_session', { name: 'VIPSpectator_7', color: '#c5a059' });
      await authP;

      // Attempt every occupied seat 0 through 5
      for (let s = 0; s < 6; s++) {
        const errorPromise = waitForEvent(client7, 'poker_seat_error');
        client7.emit('poker_take_seat', { tableId: 'poker_1', seatIndex: s, buyInAmount: 2000 });
        const err = await errorPromise;
        assert.equal(err.code, 'SEAT_OCCUPIED', `Seat ${s} must return SEAT_OCCUPIED to 7th player`);
      }

      // Out of bounds seat index 6
      const err6P = waitForEvent(client7, 'poker_seat_error');
      client7.emit('poker_take_seat', { tableId: 'poker_1', seatIndex: 6, buyInAmount: 2000 });
      const err6 = await err6P;
      assert.equal(err6.code, 'INVALID_SEAT');

      // Out of bounds negative seat index -1
      const errNegP = waitForEvent(client7, 'poker_seat_error');
      client7.emit('poker_take_seat', { tableId: 'poker_1', seatIndex: -1, buyInAmount: 2000 });
      const errNeg = await errNegP;
      assert.equal(errNeg.code, 'INVALID_SEAT');
    });

    it('1.3 should resolve simultaneous race condition: two contestants attempting the same vacated seat', async () => {
      const table = socketHandler.pokerTables.get('poker_1');
      // Vacate Seat 4 manually for race test
      table.seats[4].player = null;
      table.seats[4].status = SEAT_STATUS.EMPTY;
      table.seats[4].stack = 0;

      const racerA = createClient(port);
      const racerB = createClient(port);
      clients.push(racerA, racerB);

      await Promise.all([
        new Promise(r => racerA.on('connect', r)),
        new Promise(r => racerB.on('connect', r))
      ]);

      await Promise.all([
        (async () => {
          const p = waitForEvent(racerA, 'auth_success');
          racerA.emit('auth_session', { name: 'Racer_Alice' });
          return p;
        })(),
        (async () => {
          const p = waitForEvent(racerB, 'auth_success');
          racerB.emit('auth_session', { name: 'Racer_Bob' });
          return p;
        })()
      ]);

      // Both race to claim seat 4 simultaneously
      const raceResults = await Promise.all([
        new Promise(resolve => {
          racerA.once('poker_seat_accepted', (d) => resolve({ racer: 'Alice', accepted: true, d }));
          racerA.once('poker_seat_error', (d) => resolve({ racer: 'Alice', accepted: false, d }));
          racerA.emit('poker_take_seat', { tableId: 'poker_1', seatIndex: 4, buyInAmount: 2000 });
        }),
        new Promise(resolve => {
          racerB.once('poker_seat_accepted', (d) => resolve({ racer: 'Bob', accepted: true, d }));
          racerB.once('poker_seat_error', (d) => resolve({ racer: 'Bob', accepted: false, d }));
          racerB.emit('poker_take_seat', { tableId: 'poker_1', seatIndex: 4, buyInAmount: 2000 });
        })
      ]);

      const wins = raceResults.filter(r => r.accepted);
      const losses = raceResults.filter(r => !r.accepted);

      assert.equal(wins.length, 1, 'Exactly one contestant must win the contested seat');
      assert.equal(losses.length, 1, 'Exactly one contestant must receive an error');
      assert.equal(losses[0].d.code, 'SEAT_OCCUPIED', 'Rejected contestant must receive SEAT_OCCUPIED');
    });

    it('1.4 should reject out-of-turn action floods while processing valid in-turn action', async () => {
      const table = socketHandler.pokerTables.get('poker_1');
      assert.ok(table.activeTurn, 'Table must have an active turn');
      const activeSeat = table.activeTurn.seatIndex;
      const inactiveSeat = (activeSeat + 1) % 6;

      const inactiveClient = clients[inactiveSeat];
      const activeClient = clients[activeSeat];

      // Flooding actions from inactive client
      const rejectPromises = [
        waitForEvent(inactiveClient, 'poker_action_rejected'),
        waitForEvent(inactiveClient, 'poker_action_rejected')
      ];

      inactiveClient.emit('poker_action', { tableId: 'poker_1', seatIndex: inactiveSeat, action: 'check' });
      inactiveClient.emit('poker_action', { tableId: 'poker_1', seatIndex: inactiveSeat, action: 'call' });

      const rejections = await Promise.all(rejectPromises);
      for (const rej of rejections) {
        assert.equal(rej.code, 'OUT_OF_TURN', 'Out-of-turn actions must be rejected with OUT_OF_TURN');
      }

      // Valid action by active player succeeds
      const actedP = waitForMatchingEvent(
        activeClient,
        'poker_player_acted',
        (p) => p.seatIndex === activeSeat
      );
      activeClient.emit('poker_action', { tableId: 'poker_1', seatIndex: activeSeat, action: 'fold' });
      const acted = await actedP;
      assert.equal(acted.seatIndex, activeSeat);
      assert.equal(acted.action, 'fold');
    });
  });

  // ===========================================================================
  // Dimension 2: Anti-Stall Turn Timers (15s Auto-Action Verification)
  // ===========================================================================
  describe('Dimension 2: Turn Timeout Anti-Stall Auto-Check & Auto-Fold Stress', () => {
    let server;
    let socketHandler;
    let port;
    let clientA;
    let clientB;
    let clientC;

    before(async () => {
      server = http.createServer(app);
      socketHandler = setupSocket(server);
      await new Promise(res => server.listen(0, '127.0.0.1', res));
      port = server.address().port;

      clientA = createClient(port);
      clientB = createClient(port);
      clientC = createClient(port);

      await Promise.all([
        new Promise(r => clientA.on('connect', r)),
        new Promise(r => clientB.on('connect', r)),
        new Promise(r => clientC.on('connect', r))
      ]);

      const authA = waitForEvent(clientA, 'auth_success');
      clientA.emit('auth_session', { name: 'TimerAlice', color: '#10b981' });
      await authA;

      const authB = waitForEvent(clientB, 'auth_success');
      clientB.emit('auth_session', { name: 'TimerBob', color: '#3b82f6' });
      await authB;

      const authC = waitForEvent(clientC, 'auth_success');
      clientC.emit('auth_session', { name: 'TimerCharlie', color: '#f59e0b' });
      await authC;

      // Join poker_2 table (clean table)
      clientA.emit('poker_join_table', { tableId: 'poker_2' });
      clientB.emit('poker_join_table', { tableId: 'poker_2' });
      clientC.emit('poker_join_table', { tableId: 'poker_2' });
    });

    after(async () => {
      if (clientA && clientA.connected) clientA.disconnect();
      if (clientB && clientB.connected) clientB.disconnect();
      if (clientC && clientC.connected) clientC.disconnect();
      if (socketHandler && typeof socketHandler.stop === 'function') {
        socketHandler.stop();
      }
      if (socketHandler && socketHandler.io) {
        await new Promise(r => socketHandler.io.close(r));
      }
      await new Promise(r => server.close(r));
    });

    it('2.1 should execute auto-check when timer expires and toCall === 0', async () => {
      const table = socketHandler.pokerTables.get('poker_2');

      // Seat Alice at 0, Bob at 1
      const seat0P = waitForEvent(clientA, 'poker_seat_accepted');
      clientA.emit('poker_take_seat', { tableId: 'poker_2', seatIndex: 0, buyInAmount: 4000 });
      await seat0P;

      const seat1P = waitForEvent(clientB, 'poker_seat_accepted');
      clientB.emit('poker_take_seat', { tableId: 'poker_2', seatIndex: 1, buyInAmount: 4000 });
      await seat1P;

      // In heads-up preflop: SB = dealer (seat 0 or 1), acts first.
      // Bring hand to FLOP so checking is legal (toCall === 0).
      const activeSeat = table.activeTurn.seatIndex;
      const activeClient = activeSeat === 0 ? clientA : clientB;
      const otherClient = activeSeat === 0 ? clientB : clientA;
      const otherSeat = activeSeat === 0 ? 1 : 0;

      // Active player calls BB
      activeClient.emit('poker_action', { tableId: 'poker_2', seatIndex: activeSeat, action: 'call' });
      await new Promise(r => setTimeout(r, 100));

      // Other player (BB) checks option
      otherClient.emit('poker_action', { tableId: 'poker_2', seatIndex: otherSeat, action: 'check' });
      await new Promise(r => setTimeout(r, 100));

      // Now phase should be FLOP!
      assert.equal(table.currentPhase, PHASES.FLOP);
      assert.equal(table.currentBet, 0); // No bets yet on flop, toCall is 0!

      const flopTurnSeat = table.activeTurn.seatIndex;
      const toCall = table.currentBet - table.seats[flopTurnSeat].currentHandBet;
      assert.equal(toCall, 0, 'Active player on flop faces zero toCall');

      // Verify that autoAction / timer expiration executes auto-check
      const actedP = waitForMatchingEvent(
        clientA,
        'poker_player_acted',
        (p) => p.seatIndex === flopTurnSeat && p.action === 'check'
      );

      // Trigger auto-action (simulating 15s expiration)
      table.turnTimeLeft = 0;
      table.autoAction(flopTurnSeat);

      const acted = await actedP;
      assert.equal(acted.seatIndex, flopTurnSeat);
      assert.equal(acted.action, ACTIONS.CHECK);
      assert.equal(table.seats[flopTurnSeat].folded, false, 'Player who auto-checks must NOT be folded');
    });

    it('2.2 should execute auto-fold when timer expires and toCall > 0', async () => {
      const table = socketHandler.pokerTables.get('poker_2');

      // Active player on flop places a bet
      const activeSeat = table.activeTurn.seatIndex;
      const activeClient = activeSeat === 0 ? clientA : clientB;
      const defenderSeat = activeSeat === 0 ? 1 : 0;

      // Active player bets 400
      activeClient.emit('poker_action', { tableId: 'poker_2', seatIndex: activeSeat, action: 'bet', amount: 400 });
      await new Promise(r => setTimeout(r, 100));

      // Now defender faces 400 bet (toCall === 400 > 0)
      assert.equal(table.activeTurn.seatIndex, defenderSeat);
      const toCall = table.currentBet - table.seats[defenderSeat].currentHandBet;
      assert.ok(toCall > 0, `Defender faces toCall of ${toCall} > 0`);

      // Verify that autoAction / timer expiration executes auto-fold
      const actedP = waitForMatchingEvent(
        clientA,
        'poker_player_acted',
        (p) => p.seatIndex === defenderSeat && p.action === 'fold'
      );

      // Trigger auto-action on defender facing bet
      table.turnTimeLeft = 0;
      table.autoAction(defenderSeat);

      const acted = await actedP;
      assert.equal(acted.seatIndex, defenderSeat);
      assert.equal(acted.action, ACTIONS.FOLD);
      assert.equal(table.seats[defenderSeat].folded, true, 'Player facing bet must be folded');
    });

    it('2.3 should cascade timeouts across multiple players resolving to uncontested win without deadlock', async () => {
      const table = socketHandler.pokerTables.get('poker_2');
      // Reset table between hands
      if (table.currentPhase !== PHASES.WAITING_FOR_PLAYERS && table.currentPhase !== PHASES.HAND_END) {
        table.currentPhase = PHASES.WAITING_FOR_PLAYERS;
      }

      // Seat Charlie at Seat 2
      const seat2P = waitForEvent(clientC, 'poker_seat_accepted');
      clientC.emit('poker_take_seat', { tableId: 'poker_2', seatIndex: 2, buyInAmount: 4000 });
      await seat2P;

      // Start a 3-player hand
      table.startNewHand();
      assert.equal(table.currentPhase, PHASES.PRE_FLOP);

      // 3 active players: seats 0, 1, 2
      const active1 = table.activeTurn.seatIndex;
      const handEndP = waitForEvent(clientA, 'poker_hand_end');

      // Timeout player 1 -> auto-folds facing blind
      table.autoAction(active1);
      await new Promise(r => setTimeout(r, 50));

      // Timeout player 2 -> auto-folds facing blind
      const active2 = table.activeTurn.seatIndex;
      assert.notEqual(active2, active1);
      table.autoAction(active2);

      // Hand must immediately end uncontested without stalling!
      const handEnd = await handEndP;
      assert.equal(handEnd.uncontested, true);
      assert.equal(handEnd.winners.length, 1);
      assert.ok(handEnd.winners[0].amount > 0, 'Uncontested winner must be awarded non-zero pot amount');
      assert.ok(
        table.currentPhase === PHASES.HAND_END || table.currentPhase === PHASES.WAITING_FOR_PLAYERS,
        'Table phase must advance without stalling'
      );
    });
  });

  // ===========================================================================
  // Dimension 3: Mid-Hand Disconnect Resilience & Clean Atomic Cashout
  // ===========================================================================
  describe('Dimension 3: Mid-Hand Disconnect Resilience & Disk Cashout Stress', () => {
    let server;
    let socketHandler;
    let port;
    let dcClient;
    let stayClient;
    let dcPlayerId;
    let tempStoragePath;

    before(async () => {
      server = http.createServer(app);
      socketHandler = setupSocket(server);

      // Configure temporary storage path for isolated disk persistence verification
      tempStoragePath = path.join(__dirname, `temp_players_stress_${Date.now()}.json`);
      socketHandler.playerManager.storagePath = tempStoragePath;
      socketHandler.playerManager.debounceMs = 0; // immediate write-through

      await new Promise(res => server.listen(0, '127.0.0.1', res));
      port = server.address().port;

      dcClient = createClient(port);
      stayClient = createClient(port);

      await Promise.all([
        new Promise(r => dcClient.on('connect', r)),
        new Promise(r => stayClient.on('connect', r))
      ]);

      const authDc = waitForEvent(dcClient, 'auth_success');
      dcClient.emit('auth_session', { name: 'DcPlayer_Test', color: '#ef4444' });
      const aDc = await authDc;
      dcPlayerId = aDc.player.id;

      const authStay = waitForEvent(stayClient, 'auth_success');
      stayClient.emit('auth_session', { name: 'StayPlayer_Test', color: '#10b981' });
      await authStay;

      dcClient.emit('poker_join_table', { tableId: 'poker_1' });
      stayClient.emit('poker_join_table', { tableId: 'poker_1' });
    });

    after(async () => {
      if (dcClient && dcClient.connected) dcClient.disconnect();
      if (stayClient && stayClient.connected) stayClient.disconnect();
      if (socketHandler && typeof socketHandler.stop === 'function') {
        socketHandler.stop();
      }
      if (socketHandler && socketHandler.io) {
        await new Promise(r => socketHandler.io.close(r));
      }
      await new Promise(r => server.close(r));

      // Clean up temp storage file if created
      if (fs.existsSync(tempStoragePath)) {
        try { fs.unlinkSync(tempStoragePath); } catch (e) {}
      }
    });

    it('3.1 mid-hand disconnect must preserve seat reservation and stack while marking connected=false', async () => {
      const table = socketHandler.pokerTables.get('poker_1');
      // Clean table state to WAITING
      for (const s of table.seats) {
        s.player = null;
        s.status = SEAT_STATUS.EMPTY;
        s.stack = 0;
      }
      table.currentPhase = PHASES.WAITING_FOR_PLAYERS;

      // Both take seats
      const s0P = waitForEvent(dcClient, 'poker_seat_accepted');
      dcClient.emit('poker_take_seat', { tableId: 'poker_1', seatIndex: 0, buyInAmount: 3000 });
      await s0P;

      const s1P = waitForEvent(stayClient, 'poker_seat_accepted');
      stayClient.emit('poker_take_seat', { tableId: 'poker_1', seatIndex: 1, buyInAmount: 3000 });
      await s1P;

      // Hand is now active in PRE_FLOP
      assert.equal(table.currentPhase, PHASES.PRE_FLOP);
      assert.equal(table.seats[0].cards.length, 2);
      assert.equal(table.seats[1].cards.length, 2);

      // Now abruptly disconnect dcClient mid-hand!
      dcClient.disconnect();
      await new Promise(r => setTimeout(r, 150));

      // CRITICAL CHECK:
      // Disconnected player seat is RESERVED, not vacated mid-hand!
      const seat0 = table.seats[0];
      assert.ok(seat0.player !== null, 'Disconnected player seat must NOT be vacated mid-hand');
      assert.equal(seat0.player.id, dcPlayerId);
      assert.equal(seat0.player.connected, false, 'Player connection flag must be marked false');
      assert.equal(seat0.cards.length, 2, 'Hole cards must be retained during active hand');
      assert.ok(seat0.stack > 0, 'Remaining stack must be intact');
    });

    it('3.2 turns for disconnected player must auto-act on timeout without stalling the remaining connected player', async () => {
      const table = socketHandler.pokerTables.get('poker_1');

      // If activeTurn is on seat 1, seat 1 acts to pass to seat 0
      if (table.activeTurn && table.activeTurn.seatIndex !== 0) {
        stayClient.emit('poker_action', { tableId: 'poker_1', seatIndex: 1, action: 'call' });
        await new Promise(r => setTimeout(r, 100));
      }

      assert.equal(table.activeTurn.seatIndex, 0, 'Turn must be on disconnected player Seat 0');

      // The disconnected player cannot act. Timer countdown expires -> autoAction executes!
      const handEndP = waitForEvent(stayClient, 'poker_hand_end');

      table.turnTimeLeft = 0;
      table.autoAction(0);

      // Heads-up fold immediately concludes hand uncontested!
      const handEnd = await handEndP;
      assert.equal(handEnd.uncontested, true);
      assert.equal(handEnd.winners[0].seatIndex, 1, 'Remaining connected player must win the pot');

      // Table advances smoothly without hanging
      assert.ok(
        table.currentPhase === PHASES.HAND_END || table.currentPhase === PHASES.WAITING_FOR_PLAYERS
      );
    });

    it('3.3 after hand completion, disconnected player stack must be cleanly cashed out to persistent disk storage', async () => {
      const table = socketHandler.pokerTables.get('poker_1');

      // Seat 0 must now be cleanly vacated because player was disconnected during hand end
      assert.equal(table.seats[0].player, null, 'Seat 0 must be vacated after hand completion');
      assert.equal(table.seats[0].status, SEAT_STATUS.EMPTY);
      assert.equal(table.seats[0].stack, 0);

      // Chips must be credited back to playerManager
      const pm = socketHandler.playerManager;
      const account = pm.getPlayerById(dcPlayerId);
      assert.ok(account, 'Account must exist in playerManager');

      // Initial was 10000, buy-in was 3000 (7000 in bankroll, stack ~2950 after small blind).
      // Remaining stack must be returned to bankroll (total chips >= 7000, ~9950).
      assert.ok(account.chips >= 7000, `Account chips (${account.chips}) must include cashed out stack`);

      // Flush to disk and verify atomic write to JSON file
      pm.flushToDiskSync();
      assert.ok(fs.existsSync(tempStoragePath), 'Storage file must exist on disk');

      const diskData = JSON.parse(fs.readFileSync(tempStoragePath, 'utf8'));
      const diskPlayer = Object.values(diskData).find(p => p.id === dcPlayerId || p.name === 'DcPlayer_Test');
      assert.ok(diskPlayer, 'Disconnected player must be persisted on disk');
      assert.equal(diskPlayer.chips, account.chips, 'Disk chips must exactly match in-memory balance');
    });
  });

  // ===========================================================================
  // Dimension 4: Hole Card Security Audit (Strict Opponent & Spectator Masking)
  // ===========================================================================
  describe('Dimension 4: Authoritative Hole Card Security Audit', () => {
    let server;
    let socketHandler;
    let port;
    let clientHero;
    let clientVillain;
    let clientSpectator;
    let villainId;

    before(async () => {
      server = http.createServer(app);
      socketHandler = setupSocket(server);
      await new Promise(res => server.listen(0, '127.0.0.1', res));
      port = server.address().port;

      clientHero = createClient(port);
      clientVillain = createClient(port);
      clientSpectator = createClient(port);

      await Promise.all([
        new Promise(r => clientHero.on('connect', r)),
        new Promise(r => clientVillain.on('connect', r)),
        new Promise(r => clientSpectator.on('connect', r))
      ]);

      const authH = waitForEvent(clientHero, 'auth_success');
      clientHero.emit('auth_session', { name: 'SecurityHero', color: '#10b981' });
      await authH;

      const authV = waitForEvent(clientVillain, 'auth_success');
      clientVillain.emit('auth_session', { name: 'SecurityVillain', color: '#ef4444' });
      const aV = await authV;
      villainId = aV.player.id;

      const authS = waitForEvent(clientSpectator, 'auth_success');
      clientSpectator.emit('auth_session', { name: 'SecuritySpectator', color: '#94a3b8' });
      await authS;

      clientHero.emit('poker_join_table', { tableId: 'poker_1' });
      clientVillain.emit('poker_join_table', { tableId: 'poker_1' });
      clientSpectator.emit('poker_join_table', { tableId: 'poker_1' });
    });

    after(async () => {
      if (clientHero && clientHero.connected) clientHero.disconnect();
      if (clientVillain && clientVillain.connected) clientVillain.disconnect();
      if (clientSpectator && clientSpectator.connected) clientSpectator.disconnect();
      if (socketHandler && typeof socketHandler.stop === 'function') {
        socketHandler.stop();
      }
      if (socketHandler && socketHandler.io) {
        await new Promise(r => socketHandler.io.close(r));
      }
      await new Promise(r => server.close(r));
    });

    it('4.1 public poker_table_state broadcasts must strictly mask all hole cards with [{ hidden: true }]', async () => {
      const table = socketHandler.pokerTables.get('poker_1');
      // Reset table
      for (const s of table.seats) {
        s.player = null;
        s.status = SEAT_STATUS.EMPTY;
        s.stack = 0;
      }
      table.currentPhase = PHASES.WAITING_FOR_PLAYERS;

      // Listen for unicast hole cards and spectator table state once hand starts
      const heroHoleP = waitForEvent(clientHero, 'poker_hole_cards');
      const villainHoleP = waitForEvent(clientVillain, 'poker_hole_cards');
      const spectatorStateP = waitForMatchingEvent(
        clientSpectator,
        'poker_table_state',
        (s) => s.currentPhase === PHASES.PRE_FLOP
      );

      clientHero.emit('poker_take_seat', { tableId: 'poker_1', seatIndex: 0, buyInAmount: 2000 });
      await new Promise(r => setTimeout(r, 50));
      clientVillain.emit('poker_take_seat', { tableId: 'poker_1', seatIndex: 1, buyInAmount: 2000 });

      const heroHole = await heroHoleP;
      const villainHole = await villainHoleP;
      const spectatorState = await spectatorStateP;

      // 1. Private hole cards received via unicast are authentic cards
      assert.equal(heroHole.cards.length, 2);
      assert.ok(heroHole.cards[0].rank && heroHole.cards[0].suit);
      assert.equal(villainHole.cards.length, 2);
      assert.ok(villainHole.cards[0].rank && villainHole.cards[0].suit);

      // 2. Spectator client broadcast payload contains ONLY { hidden: true }
      assert.equal(spectatorState.seats[0].cards.length, 2);
      assert.deepEqual(spectatorState.seats[0].cards, [{ hidden: true }, { hidden: true }]);
      assert.deepEqual(spectatorState.seats[1].cards, [{ hidden: true }, { hidden: true }]);

      // Verify zero leaks of rank/suit/id in spectator state
      for (const card of spectatorState.seats[0].cards) {
        assert.equal(card.rank, undefined, 'Spectator card must NOT have rank property');
        assert.equal(card.suit, undefined, 'Spectator card must NOT have suit property');
        assert.equal(card.id, undefined, 'Spectator card must NOT have id property');
      }
    });

    it('4.2 opponent client must never receive hero cards in tailored state or socket broadcasts', async () => {
      const table = socketHandler.pokerTables.get('poker_1');

      // Request tailored state for Villain
      const villainTailoredState = table.getTableState(villainId);

      // Villain sees own cards in seat 1
      assert.ok(villainTailoredState.seats[1].cards[0].rank);
      assert.ok(villainTailoredState.seats[1].cards[0].suit);

      // Villain strictly sees { hidden: true } for Hero in seat 0
      assert.deepEqual(villainTailoredState.seats[0].cards, [{ hidden: true }, { hidden: true }]);
      assert.equal(villainTailoredState.seats[0].cards[0].rank, undefined);
      assert.equal(villainTailoredState.seats[0].cards[0].suit, undefined);

      // Spectator socket receives zero poker_hole_cards events
      let spectatorReceivedHoleCards = false;
      clientSpectator.once('poker_hole_cards', () => { spectatorReceivedHoleCards = true; });

      // Trigger a phase tick and broadcast
      table.emitTurnChanged();
      await new Promise(r => setTimeout(r, 100));

      assert.equal(spectatorReceivedHoleCards, false, 'Spectator must never receive private hole cards');
    });

    it('4.3 public room broadcasts (turn_change, player_acted, phase_changed) must not leak cards', async () => {
      const table = socketHandler.pokerTables.get('poker_1');

      let leakedRankOrSuit = false;
      function cardLeakScanner(payload) {
        if (payload && payload.seats) {
          for (const s of payload.seats) {
            if (s.cards) {
              for (const c of s.cards) {
                if (c.rank !== undefined || c.suit !== undefined) {
                  leakedRankOrSuit = true;
                }
              }
            }
          }
        }
      }

      clientSpectator.on('poker_table_state', cardLeakScanner);
      clientSpectator.on('poker_turn_change', cardLeakScanner);
      clientSpectator.on('poker_player_acted', cardLeakScanner);
      clientSpectator.on('poker_phase_changed', cardLeakScanner);

      // Execute actions to cause multiple broadcasts
      const activeSeat = table.activeTurn.seatIndex;
      const activeClient = activeSeat === 0 ? clientHero : clientVillain;

      activeClient.emit('poker_action', { tableId: 'poker_1', seatIndex: activeSeat, action: 'call' });
      await new Promise(r => setTimeout(r, 150));

      clientSpectator.off('poker_table_state', cardLeakScanner);
      clientSpectator.off('poker_turn_change', cardLeakScanner);
      clientSpectator.off('poker_player_acted', cardLeakScanner);
      clientSpectator.off('poker_phase_changed', cardLeakScanner);

      assert.equal(leakedRankOrSuit, false, 'No public broadcast may leak private card ranks or suits');
    });
  });

  // ===========================================================================
  // Dimension 5: Navigation Bet Lock & Room Switching Guards
  // ===========================================================================
  describe('Dimension 5: Navigation Bet Lock & Room Switching Protection', () => {
    let server;
    let socketHandler;
    let port;
    let clientNavA;
    let clientNavB;
    let navPlayerA;
    let navPlayerB;

    before(async () => {
      server = http.createServer(app);
      socketHandler = setupSocket(server);
      await new Promise(res => server.listen(0, '127.0.0.1', res));
      port = server.address().port;

      clientNavA = createClient(port);
      clientNavB = createClient(port);

      await Promise.all([
        new Promise(r => clientNavA.on('connect', r)),
        new Promise(r => clientNavB.on('connect', r))
      ]);

      const authA = waitForEvent(clientNavA, 'auth_success');
      clientNavA.emit('auth_session', { name: 'NavLockAlice', color: '#10b981' });
      const aA = await authA;
      navPlayerA = aA.player;

      const authB = waitForEvent(clientNavB, 'auth_success');
      clientNavB.emit('auth_session', { name: 'NavLockBob', color: '#3b82f6' });
      const aB = await authB;
      navPlayerB = aB.player;

      clientNavA.emit('poker_join_table', { tableId: 'poker_1' });
      clientNavB.emit('poker_join_table', { tableId: 'poker_1' });
    });

    after(async () => {
      if (clientNavA && clientNavA.connected) clientNavA.disconnect();
      if (clientNavB && clientNavB.connected) clientNavB.disconnect();
      if (socketHandler && typeof socketHandler.stop === 'function') {
        socketHandler.stop();
      }
      if (socketHandler && socketHandler.io) {
        await new Promise(r => socketHandler.io.close(r));
      }
      await new Promise(r => server.close(r));
    });

    it('5.1 canPlayerNavigate contract must block active poker players with CANNOT_LEAVE_ACTIVE_BETS', async () => {
      const table = socketHandler.pokerTables.get('poker_1');
      for (const s of table.seats) {
        s.player = null;
        s.status = SEAT_STATUS.EMPTY;
        s.stack = 0;
      }
      table.currentPhase = PHASES.WAITING_FOR_PLAYERS;

      // Before taking seats: navigation is allowed
      const checkBefore = canPlayerNavigate(navPlayerA.id, null, null, table);
      assert.equal(checkBefore.allowed, true);

      // Both players take seats -> hand starts
      const s0P = waitForEvent(clientNavA, 'poker_seat_accepted');
      clientNavA.emit('poker_take_seat', { tableId: 'poker_1', seatIndex: 0, buyInAmount: 2000 });
      await s0P;

      const s1P = waitForEvent(clientNavB, 'poker_seat_accepted');
      clientNavB.emit('poker_take_seat', { tableId: 'poker_1', seatIndex: 1, buyInAmount: 2000 });
      await s1P;

      assert.equal(table.currentPhase, PHASES.PRE_FLOP);

      // Now both players have active cards and committed blinds: navigation must be BLOCKED!
      const checkA = canPlayerNavigate(navPlayerA.id, null, null, table);
      assert.equal(checkA.allowed, false);
      assert.equal(checkA.code, 'CANNOT_LEAVE_ACTIVE_BETS');
      assert.equal(checkA.game, 'Poker');
      assert.ok(checkA.reason);

      const checkB = canPlayerNavigate(navPlayerB.id, null, null, socketHandler.pokerTables);
      assert.equal(checkB.allowed, false);
      assert.equal(checkB.code, 'CANNOT_LEAVE_ACTIVE_BETS');
      assert.equal(checkB.game, 'Poker');
    });

    it('5.2 socket navigation events (player_set_game, player_set_location, leave_table, poker_leave_seat) must emit navigation_blocked', async () => {
      // 1. player_set_game
      const blocked1P = waitForEvent(clientNavA, 'navigation_blocked');
      clientNavA.emit('player_set_game', { game: 'Blackjack' });
      const blocked1 = await blocked1P;
      assert.equal(blocked1.code, 'CANNOT_LEAVE_ACTIVE_BETS');
      assert.equal(blocked1.game, 'Poker');

      // 2. player_set_location
      const blocked2P = waitForEvent(clientNavA, 'navigation_blocked');
      clientNavA.emit('player_set_location', { location: 'ROULETTE' });
      const blocked2 = await blocked2P;
      assert.equal(blocked2.code, 'CANNOT_LEAVE_ACTIVE_BETS');

      // 3. leave_table
      const blocked3P = waitForEvent(clientNavA, 'navigation_blocked');
      clientNavA.emit('leave_table');
      const blocked3 = await blocked3P;
      assert.equal(blocked3.code, 'CANNOT_LEAVE_ACTIVE_BETS');

      // 4. poker_leave_seat
      const blocked4P = waitForEvent(clientNavA, 'navigation_blocked');
      const seatErrP = waitForEvent(clientNavA, 'poker_seat_error');
      clientNavA.emit('poker_leave_seat', { tableId: 'poker_1', seatIndex: 0 });
      const blocked4 = await blocked4P;
      const seatErr = await seatErrP;
      assert.equal(blocked4.code, 'CANNOT_LEAVE_ACTIVE_BETS');
      assert.equal(seatErr.code, 'CANNOT_LEAVE_ACTIVE_BETS');
    });

    it('5.3 navigation lock must be released when hand ends or player leaves between hands', async () => {
      const table = socketHandler.pokerTables.get('poker_1');

      // Fold active hand to end heads-up hand immediately
      const activeSeat = table.activeTurn.seatIndex;
      const otherSeat = activeSeat === 0 ? 1 : 0;
      const foldingClient = activeSeat === 0 ? clientNavA : clientNavB;
      const foldingPlayer = activeSeat === 0 ? navPlayerA : navPlayerB;
      const otherClient = activeSeat === 0 ? clientNavB : clientNavA;
      const otherPlayer = activeSeat === 0 ? navPlayerB : navPlayerA;

      const actSuccessP = waitForEvent(foldingClient, 'poker_action_success');
      foldingClient.emit('poker_action', { tableId: 'poker_1', seatIndex: activeSeat, action: 'fold' });
      await actSuccessP;

      // Hand has transitioned to HAND_END or WAITING_FOR_PLAYERS
      assert.ok(
        table.currentPhase === PHASES.HAND_END || table.currentPhase === PHASES.WAITING_FOR_PLAYERS,
        'Hand must conclude after fold'
      );
      assert.equal(table.hasActiveBets(foldingPlayer.id), false, 'Folded player must have no active bets');

      // Now navigation check is ALLOWED
      const checkReleased = canPlayerNavigate(foldingPlayer.id, null, null, table);
      assert.equal(checkReleased.allowed, true);

      // Switching game succeeds now and automatically vacates folded player from table
      const gameSwitchedP = waitForEvent(foldingClient, 'game_switched');
      foldingClient.emit('player_set_game', { game: 'Roulette' });
      const switched = await gameSwitchedP;
      assert.equal(switched.game, 'Roulette');
      assert.equal(table.seats[activeSeat].player, null, 'Folded player auto-vacated upon switching game');

      // Other player (who won pot and stayed in seat) leaves seat explicitly via poker_leave_seat
      const bankBefore = socketHandler.playerManager.getPlayerById(otherPlayer.id).chips;
      const stackBefore = table.seats[otherSeat].stack;

      const vacatedP = waitForMatchingEvent(otherClient, 'poker_seat_vacated', (v) => v.seatIndex === otherSeat);
      const chipsUpdateP = waitForEvent(otherClient, 'chips_update');
      otherClient.emit('poker_leave_seat', { tableId: 'poker_1', seatIndex: otherSeat });

      const vacated = await vacatedP;
      const chipsUpdate = await chipsUpdateP;

      assert.equal(vacated.seatIndex, otherSeat);
      assert.equal(chipsUpdate.chips, bankBefore + stackBefore);
      assert.equal(table.seats[otherSeat].player, null);
    });
  });
});
