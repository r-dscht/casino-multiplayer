/**
 * adversarialChallenge.test.js
 * Comprehensive Final Adversarial Stress & Empirical Challenge Suite.
 *
 * Stress-tests the Monte Carlo Casino implementation across 6 critical dimensions:
 * 1. Concurrency & Seating: 6 concurrent players taking seats 0-5 on Table 1, 7th player rejection, duplicate seat races.
 * 2. Turn Timers & Auto-Stand: Disconnect and frozen player simulations, 15-second timer auto-stand, stall & deadlock prevention.
 * 3. S17 Dealer Boundary Stress: Soft 16, hard 16, soft 17 (must stand), hard 17, soft 18, multi-Ace boundaries, and bust payout invariants.
 * 4. Hole Card Security: Public socket payloads during DEALING and PLAYER_TURNS strictly masking hole card rank, suit, value, and id.
 * 5. Navigation Bet Lock Stress: Active bet lock rejection (CANNOT_LEAVE_ACTIVE_BETS) across room changes, game switches, and table leaves.
 * 6. Session Reload Stress: Rapid 50x sequential and concurrent re-authentications asserting zero chip loss and zero 10k resets.
 */

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { io: Client } = require('socket.io-client');

const app = require('../../server/app');
const { setupSocket, canPlayerNavigate } = require('../../server/socket');
const BlackjackEngine = require('../../server/game/blackjackEngine');
const PlayerManager = require('../../server/game/playerManager');
const {
  shouldDealerHit,
  calculateHandValue,
  evaluateHandResult,
  canHit,
  canStand,
  canDouble,
  canSplit
} = require('../../server/game/blackjackRules');
const {
  PHASES,
  ACTIONS,
  HAND_STATUS,
  MAX_SEATS,
  MIN_BET,
  PAYOUT_RATIOS
} = require('../../server/game/blackjackConstants');

// Helper to create connected socket client
function createClient(serverPort) {
  return Client(`http://127.0.0.1:${serverPort}`, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false
  });
}

// Helper to await socket event with timeout
function waitForEvent(socket, eventName, timeoutMs = 4000) {
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

describe('Final Adversarial Challenge & Stress Suite', () => {

  // ===========================================================================
  // 1. Concurrency & 6-Seat Seating Stress
  // ===========================================================================
  describe('Dimension 1: Concurrency & Seating Stress (6 Seats & 7th Player Rejection)', () => {
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

    it('should concurrently seat 6 distinct players in seats 0 through 5 without conflict', async () => {
      // Connect and auth 6 players
      for (let i = 0; i < 6; i++) {
        const client = createClient(port);
        clients.push(client);
        await new Promise(r => client.on('connect', r));

        const authPromise = waitForEvent(client, 'auth_success');
        client.emit('auth_session', { name: `SeatedVIP_${i}`, color: '#10b981' });
        const auth = await authPromise;
        assert.equal(auth.player.chips, 10000);
      }

      // Concurrently take seats 0 through 5
      const seatPromises = clients.map((client, seatIndex) => {
        return new Promise(resolve => {
          const onAccepted = (data) => {
            client.off('bj_seat_error', onError);
            resolve({ success: true, seatIndex, data });
          };
          const onError = (err) => {
            client.off('bj_seat_accepted', onAccepted);
            resolve({ success: false, seatIndex, err });
          };
          client.once('bj_seat_accepted', onAccepted);
          client.once('bj_seat_error', onError);
          client.emit('bj_take_seat', { tableId: 'table_1', seatIndex });
        });
      });

      const seatResults = await Promise.all(seatPromises);
      for (let i = 0; i < 6; i++) {
        assert.equal(seatResults[i].success, true, `Seat ${i} must be claimed successfully`);
        assert.equal(seatResults[i].seatIndex, i);
      }

      // Assert Table 1 has exactly 6 occupied seats
      const table = socketHandler.blackjackTables.get('table_1');
      assert.equal(table.seats.length, 6);
      for (let i = 0; i < 6; i++) {
        assert.ok(table.seats[i].player, `Seat ${i} must have an assigned player`);
        assert.equal(table.seats[i].player.name, `SeatedVIP_${i}`);
      }
    });

    it('should cleanly reject a 7th player attempting to take any occupied seat (0..5)', async () => {
      const client7 = createClient(port);
      clients.push(client7);
      await new Promise(r => client7.on('connect', r));

      const auth7Promise = waitForEvent(client7, 'auth_success');
      client7.emit('auth_session', { name: 'Player_7th_Attempt', color: '#c5a059' });
      await auth7Promise;

      // Attempt each seat 0 through 5
      for (let s = 0; s < 6; s++) {
        const errorPromise = waitForEvent(client7, 'bj_seat_error');
        client7.emit('bj_take_seat', { tableId: 'table_1', seatIndex: s });
        const err = await errorPromise;
        assert.equal(err.code, 'SEAT_OCCUPIED', `Seat ${s} must return SEAT_OCCUPIED`);
      }
    });

    it('should reject out-of-bounds seat indices (seat 6, seat -1, non-numbers)', async () => {
      const client7 = clients[6];

      // Seat 6 (out of bounds for 6-seat table 0..5)
      const err6Promise = waitForEvent(client7, 'bj_seat_error');
      client7.emit('bj_take_seat', { tableId: 'table_1', seatIndex: 6 });
      const err6 = await err6Promise;
      assert.equal(err6.code, 'INVALID_SEAT');

      // Seat -1
      const errNegPromise = waitForEvent(client7, 'bj_seat_error');
      client7.emit('bj_take_seat', { tableId: 'table_1', seatIndex: -1 });
      const errNeg = await errNegPromise;
      assert.equal(errNeg.code, 'INVALID_SEAT');

      // Seat NaN / string
      const errStrPromise = waitForEvent(client7, 'bj_seat_error');
      client7.emit('bj_take_seat', { tableId: 'table_1', seatIndex: 'seat_two' });
      const errStr = await errStrPromise;
      assert.equal(errStr.code, 'INVALID_SEAT');
    });

    it('should handle simultaneous race condition when two players contest the same newly vacated seat', async () => {
      const table = socketHandler.blackjackTables.get('table_1');
      // Vacate Seat 2 directly on table
      table.seats[2].player = null;
      table.seats[2].status = 'empty';

      // Client 0 is already seated at seat 0. Let's create two new unseated players
      const contestantA = createClient(port);
      const contestantB = createClient(port);
      clients.push(contestantA, contestantB);

      await Promise.all([
        new Promise(r => contestantA.on('connect', r)),
        new Promise(r => contestantB.on('connect', r))
      ]);

      await Promise.all([
        (async () => {
          const p = waitForEvent(contestantA, 'auth_success');
          contestantA.emit('auth_session', { name: 'Contestant_A' });
          return p;
        })(),
        (async () => {
          const p = waitForEvent(contestantB, 'auth_success');
          contestantB.emit('auth_session', { name: 'Contestant_B' });
          return p;
        })()
      ]);

      // Both contestants attempt to claim seat 2 simultaneously
      const raceResults = await Promise.all([
        new Promise(resolve => {
          contestantA.once('bj_seat_accepted', (d) => resolve({ client: 'A', accepted: true, d }));
          contestantA.once('bj_seat_error', (d) => resolve({ client: 'A', accepted: false, d }));
          contestantA.emit('bj_take_seat', { tableId: 'table_1', seatIndex: 2 });
        }),
        new Promise(resolve => {
          contestantB.once('bj_seat_accepted', (d) => resolve({ client: 'B', accepted: true, d }));
          contestantB.once('bj_seat_error', (d) => resolve({ client: 'B', accepted: false, d }));
          contestantB.emit('bj_take_seat', { tableId: 'table_1', seatIndex: 2 });
        })
      ]);

      const wins = raceResults.filter(r => r.accepted);
      const losses = raceResults.filter(r => !r.accepted);

      assert.equal(wins.length, 1, 'Exactly one contestant must win the contested seat');
      assert.equal(losses.length, 1, 'Exactly one contestant must be rejected');
      assert.equal(losses[0].d.code, 'SEAT_OCCUPIED', 'Rejected contestant must receive SEAT_OCCUPIED');
    });
  });

  // ===========================================================================
  // 2. Turn Timers & Auto-Stand Stall / Deadlock Resilience
  // ===========================================================================
  describe('Dimension 2: Turn Timers & Auto-Stand Anti-Stall Stress', () => {
    let pm;
    let engine;

    beforeEach(() => {
      pm = new PlayerManager({ debounceMs: 0 });
      engine = new BlackjackEngine(pm, { tableId: 'table_test_timer', maxSeats: 6 });
    });

    afterEach(() => {
      if (engine) engine.stop();
    });

    it('should automatically stand active hand and advance clockwise when 15s turn timer expires', () => {
      // Register 2 players
      const a1 = pm.authSession('s1', { name: 'Player_Seat0' });
      const a2 = pm.authSession('s2', { name: 'Player_Seat3' });

      engine.takeSeat(0, a1.player.id);
      engine.takeSeat(3, a2.player.id);

      // Place bets
      engine.placeBet(0, a1.player.id, 500);
      engine.placeBet(3, a2.player.id, 500);

      // Transition to DEALING and mock cards
      engine.transitionToDealing();
      engine.seats[0].hands[0].cards = [
        { id: 'c1', rank: '10', suit: 'hearts', value: 10 },
        { id: 'c2', rank: '4', suit: 'clubs', value: 4 }
      ];
      engine.seats[0].hands[0].value = 14;
      engine.seats[0].hands[0].status = HAND_STATUS.ACTIVE;

      engine.seats[3].hands[0].cards = [
        { id: 'c3', rank: '9', suit: 'diamonds', value: 9 },
        { id: 'c4', rank: '8', suit: 'spades', value: 8 }
      ];
      engine.seats[3].hands[0].value = 17;
      engine.seats[3].hands[0].status = HAND_STATUS.ACTIVE;

      engine.dealerCards = [
        { id: 'd1', rank: '10', suit: 'spades', value: 10 },
        { id: 'd2', rank: '7', suit: 'hearts', value: 7 }
      ];

      // Start player turns
      engine.transitionToPlayerTurns();

      assert.equal(engine.activeTurn.seatIndex, 0);
      assert.equal(engine.activeTurn.handIndex, 0);
      assert.equal(engine.turnTimeLeft, 15);

      let autoStandEmitted = false;
      let turnChangeEmitted = false;

      engine.on('action_applied', (ev) => {
        if (ev.seatIndex === 0 && ev.action === 'stand' && ev.auto === true) {
          autoStandEmitted = true;
        }
      });

      engine.on('turn_change', (ev) => {
        if (ev.seatIndex === 3) {
          turnChangeEmitted = true;
        }
      });

      // Simulate 15 countdown ticks for frozen player at seat 0
      for (let t = 0; t < 15; t++) {
        engine.tick();
      }

      assert.equal(autoStandEmitted, true, 'action_applied with auto: true must be emitted on timeout');
      assert.equal(turnChangeEmitted, true, 'Turn must advance to Seat 3');
      assert.equal(engine.seats[0].hands[0].status, HAND_STATUS.STOOD);
      assert.equal(engine.activeTurn.seatIndex, 3);
      assert.equal(engine.turnTimeLeft, 15, 'Timer must reset to 15s for Seat 3');
    });

    it('should advance to DEALER_TURN without table deadlock when all seated players are frozen', () => {
      const a1 = pm.authSession('s1', { name: 'Player_0' });
      const a2 = pm.authSession('s2', { name: 'Player_1' });

      engine.takeSeat(0, a1.player.id);
      engine.takeSeat(1, a2.player.id);
      engine.placeBet(0, a1.player.id, 200);
      engine.placeBet(1, a2.player.id, 200);

      engine.transitionToDealing();
      engine.seats[0].hands[0].cards = [{ rank: '8' }, { rank: '8' }];
      engine.seats[0].hands[0].value = 16;
      engine.seats[0].hands[0].status = HAND_STATUS.ACTIVE;

      engine.seats[1].hands[0].cards = [{ rank: '9' }, { rank: '7' }];
      engine.seats[1].hands[0].value = 16;
      engine.seats[1].hands[0].status = HAND_STATUS.ACTIVE;

      engine.dealerCards = [{ rank: '10' }, { rank: '8' }];

      engine.transitionToPlayerTurns();
      assert.equal(engine.currentPhase, PHASES.PLAYER_TURNS);

      // Timeout seat 0 (15 ticks)
      for (let t = 0; t < 15; t++) engine.tick();
      assert.equal(engine.activeTurn.seatIndex, 1);

      // Timeout seat 1 (15 ticks)
      for (let t = 0; t < 15; t++) engine.tick();

      // All players stood -> engine must automatically advance to DEALER_TURN
      assert.equal(engine.currentPhase, PHASES.DEALER_TURN);
      assert.equal(engine.activeTurn, null);
      assert.equal(engine.seats[0].hands[0].status, HAND_STATUS.STOOD);
      assert.equal(engine.seats[1].hands[0].status, HAND_STATUS.STOOD);
    });
  });

  // ===========================================================================
  // 3. S17 Dealer Boundary Stress
  // ===========================================================================
  describe('Dimension 3: S17 Dealer AI Boundary & Hand Evaluation Stress', () => {
    it('should enforce S17 rule: Dealer MUST HIT on Soft 16 and Hard 16', () => {
      // Soft 16 [A, 5]
      const soft16 = [{ rank: 'A' }, { rank: '5' }];
      assert.equal(calculateHandValue(soft16).value, 16);
      assert.equal(calculateHandValue(soft16).isSoft, true);
      assert.equal(shouldDealerHit(soft16), true, 'Dealer must hit on Soft 16');

      // Multi-card Soft 16 [A, 2, 3]
      const soft16_multi = [{ rank: 'A' }, { rank: '2' }, { rank: '3' }];
      assert.equal(calculateHandValue(soft16_multi).value, 16);
      assert.equal(calculateHandValue(soft16_multi).isSoft, true);
      assert.equal(shouldDealerHit(soft16_multi), true, 'Dealer must hit on multi-card Soft 16');

      // Hard 16 [10, 6]
      const hard16_a = [{ rank: '10' }, { rank: '6' }];
      assert.equal(calculateHandValue(hard16_a).value, 16);
      assert.equal(calculateHandValue(hard16_a).isSoft, false);
      assert.equal(shouldDealerHit(hard16_a), true, 'Dealer must hit on Hard 16');

      // Hard 16 [9, 7]
      const hard16_b = [{ rank: '9' }, { rank: '7' }];
      assert.equal(calculateHandValue(hard16_b).value, 16);
      assert.equal(shouldDealerHit(hard16_b), true, 'Dealer must hit on Hard 16');

      // Hard 16 [4, 5, 7]
      const hard16_c = [{ rank: '4' }, { rank: '5' }, { rank: '7' }];
      assert.equal(calculateHandValue(hard16_c).value, 16);
      assert.equal(shouldDealerHit(hard16_c), true, 'Dealer must hit on 3-card Hard 16');
    });

    it('should enforce S17 rule: Dealer MUST STAND on Soft 17 and Hard 17', () => {
      // Soft 17 [A, 6]
      const soft17 = [{ rank: 'A' }, { rank: '6' }];
      const s17Score = calculateHandValue(soft17);
      assert.equal(s17Score.value, 17);
      assert.equal(s17Score.isSoft, true);
      assert.equal(shouldDealerHit(soft17), false, 'Dealer MUST STAND on Soft 17 under S17 rules');

      // Multi-card Soft 17 [A, 2, 4]
      const soft17_multi = [{ rank: 'A' }, { rank: '2' }, { rank: '4' }];
      assert.equal(calculateHandValue(soft17_multi).value, 17);
      assert.equal(calculateHandValue(soft17_multi).isSoft, true);
      assert.equal(shouldDealerHit(soft17_multi), false, 'Dealer MUST STAND on multi-card Soft 17');

      // Multi-Ace Soft 17 [A, A, 5] -> 11 + 1 + 5 = 17
      const soft17_multiAce = [{ rank: 'A' }, { rank: 'A' }, { rank: '5' }];
      assert.equal(calculateHandValue(soft17_multiAce).value, 17);
      assert.equal(calculateHandValue(soft17_multiAce).isSoft, true);
      assert.equal(shouldDealerHit(soft17_multiAce), false, 'Dealer MUST STAND on [A, A, 5]');

      // 4-Ace Soft 17 [A, A, A, 4] -> 11 + 1 + 1 + 4 = 17
      const soft17_fourAce = [{ rank: 'A' }, { rank: 'A' }, { rank: 'A' }, { rank: '4' }];
      assert.equal(calculateHandValue(soft17_fourAce).value, 17);
      assert.equal(calculateHandValue(soft17_fourAce).isSoft, true);
      assert.equal(shouldDealerHit(soft17_fourAce), false, 'Dealer MUST STAND on 4-Ace Soft 17');

      // Hard 17 [10, 7]
      const hard17_a = [{ rank: '10' }, { rank: '7' }];
      assert.equal(calculateHandValue(hard17_a).value, 17);
      assert.equal(calculateHandValue(hard17_a).isSoft, false);
      assert.equal(shouldDealerHit(hard17_a), false, 'Dealer MUST STAND on Hard 17');

      // Hard 17 [9, 8]
      const hard17_b = [{ rank: '9' }, { rank: '8' }];
      assert.equal(calculateHandValue(hard17_b).value, 17);
      assert.equal(shouldDealerHit(hard17_b), false, 'Dealer MUST STAND on [9, 8]');

      // Ace reduced to 1 Hard 17 [A, 8, 8] -> 1 + 8 + 8 = 17 (hard)
      const hard17_ace = [{ rank: 'A' }, { rank: '8' }, { rank: '8' }];
      const h17AceScore = calculateHandValue(hard17_ace);
      assert.equal(h17AceScore.value, 17);
      assert.equal(h17AceScore.isSoft, false);
      assert.equal(shouldDealerHit(hard17_ace), false, 'Dealer MUST STAND on [A, 8, 8]');
    });

    it('should enforce S17 rule: Dealer MUST STAND on Soft 18, Hard 18, 19, 20, 21', () => {
      // Soft 18 [A, 7]
      const soft18 = [{ rank: 'A' }, { rank: '7' }];
      assert.equal(calculateHandValue(soft18).value, 18);
      assert.equal(calculateHandValue(soft18).isSoft, true);
      assert.equal(shouldDealerHit(soft18), false, 'Dealer MUST STAND on Soft 18');

      // Hard 18 [10, 8]
      const hard18 = [{ rank: '10' }, { rank: '8' }];
      assert.equal(shouldDealerHit(hard18), false);

      // 19, 20, 21
      assert.equal(shouldDealerHit([{ rank: '10' }, { rank: '9' }]), false);
      assert.equal(shouldDealerHit([{ rank: '10' }, { rank: 'K' }]), false);
      assert.equal(shouldDealerHit([{ rank: 'A' }, { rank: 'K' }]), false);
    });

    it('should handle dealer bust condition and award all non-busted players 1:1 wins', () => {
      // Dealer bust hand: [10, 6, 8] = 24
      const dealerBustHand = [{ rank: '10' }, { rank: '6' }, { rank: '8' }];
      const dealerScore = calculateHandValue(dealerBustHand);
      assert.equal(dealerScore.value, 24);
      assert.equal(dealerScore.isBust, true);
      assert.equal(shouldDealerHit(dealerBustHand), false, 'Busted dealer must not draw cards');

      // Non-busted player hand: [10, 2] = 12
      const p12 = [{ rank: '10' }, { rank: '2' }];
      const res12 = evaluateHandResult(p12, dealerBustHand, 1000);
      assert.equal(res12.result, 'WIN');
      assert.equal(res12.gross, 2000, 'Dealer bust pays 1:1 (+1000 profit, 2000 gross)');
      assert.equal(res12.profit, 1000);

      // Non-busted player hand: [10, 7] = 17
      const p17 = [{ rank: '10' }, { rank: '7' }];
      const res17 = evaluateHandResult(p17, dealerBustHand, 500);
      assert.equal(res17.result, 'WIN');
      assert.equal(res17.gross, 1000);

      // Busted player hand: [10, 5, 7] = 22 (Player bust happens first -> LOSE)
      const pBust = [{ rank: '10' }, { rank: '5' }, { rank: '7' }];
      const resBust = evaluateHandResult(pBust, dealerBustHand, 1000);
      assert.equal(resBust.result, 'LOSE');
      assert.equal(resBust.gross, 0);
      assert.equal(resBust.profit, -1000);
    });
  });

  // ===========================================================================
  // 4. Hole Card Security Masking Stress
  // ===========================================================================
  describe('Dimension 4: Hole Card Security Masking & Zero-Leakage Audit', () => {
    let pm;
    let engine;

    beforeEach(() => {
      pm = new PlayerManager({ debounceMs: 0 });
      engine = new BlackjackEngine(pm, { tableId: 'table_sec' });
    });

    afterEach(() => {
      if (engine) engine.stop();
    });

    it('should strictly mask dealer hole card in DEALING and PLAYER_TURNS without leaking rank, suit, or value', () => {
      const auth = pm.authSession('sock_p1', { name: 'CardCounter' });
      engine.takeSeat(0, auth.player.id);
      engine.placeBet(0, auth.player.id, 500);

      engine.transitionToDealing();

      // Explicitly set dealer cards with identifiable secrets (non-blackjack total so it stays in PLAYER_TURNS)
      // Upcard: 10 of Spades, Hole Card: 6 of Hearts (secret total = 16)
      const secretUpcard = { id: 'c_up_secret', suit: 'spades', rank: '10', value: 10 };
      const secretHoleCard = { id: 'c_hole_secret', suit: 'hearts', rank: '6', value: 6 };
      engine.dealerCards = [secretUpcard, secretHoleCard];

      // Give player a non-blackjack hand so PLAYER_TURNS is entered
      engine.seats[0].hands[0].cards = [
        { id: 'c_p1', suit: 'diamonds', rank: '8', value: 8 },
        { id: 'c_p2', suit: 'clubs', rank: '7', value: 7 }
      ];
      engine.seats[0].hands[0].value = 15;
      engine.seats[0].hands[0].status = HAND_STATUS.ACTIVE;

      // Verify DEALING phase state serialization
      const dealingState = engine.getTableState(auth.player.id);
      assert.equal(dealingState.phase, PHASES.DEALING);
      assert.equal(dealingState.dealerHand.length, 2);

      // Upcard is visible
      assert.equal(dealingState.dealerHand[0].rank, '10');
      assert.equal(dealingState.dealerHand[0].suit, 'spades');

      // Hole card MUST be masked
      assert.equal(dealingState.dealerHand[1].hidden, true);
      assert.equal(dealingState.dealerHand[1].rank, undefined, 'Hole card rank must NEVER be present');
      assert.equal(dealingState.dealerHand[1].suit, undefined, 'Hole card suit must NEVER be present');
      assert.equal(dealingState.dealerHand[1].value, undefined, 'Hole card value must NEVER be present');
      assert.equal(dealingState.dealerHand[1].id, undefined, 'Hole card id must NEVER be present');

      // Full payload string search: 'c_hole_secret' or 'rank: 6' must not exist
      const serializedDealing = JSON.stringify(dealingState);
      assert.equal(serializedDealing.includes('c_hole_secret'), false, 'Hole card ID leaked in serialized payload!');
      assert.equal(serializedDealing.includes('"rank":"6"'), false, 'Hole card rank leaked in serialized payload!');

      // Transition to PLAYER_TURNS
      engine.transitionToPlayerTurns();
      assert.equal(engine.currentPhase, PHASES.PLAYER_TURNS);

      const playerTurnsState = engine.getTableState(auth.player.id);
      assert.equal(playerTurnsState.phase, PHASES.PLAYER_TURNS);
      assert.equal(playerTurnsState.dealerHand[1].hidden, true);
      assert.equal(playerTurnsState.dealerHand[1].rank, undefined);

      const serializedTurns = JSON.stringify(playerTurnsState);
      assert.equal(serializedTurns.includes('c_hole_secret'), false);
      assert.equal(serializedTurns.includes('"rank":"6"'), false);

      // Only in DEALER_TURN is the hole card revealed
      let revealEmitted = false;
      engine.on('dealer_reveal', (data) => {
        revealEmitted = true;
        assert.equal(data.dealerHand[1].rank, '6');
        assert.equal(data.dealerHand[1].suit, 'hearts');
      });

      engine.transitionToDealerTurn();
      assert.equal(revealEmitted, true);
      const revealedState = engine.getTableState(auth.player.id);
      assert.equal(revealedState.dealerHand[1].rank, '6');
      assert.equal(revealedState.dealerHand[1].hidden, undefined);
    });
  });

  // ===========================================================================
  // 5. Navigation Bet Lock Stress
  // ===========================================================================
  describe('Dimension 5: Navigation Bet Lock Stress (Roulette & Blackjack)', () => {
    let server;
    let socketHandler;
    let port;
    let client;
    let player;

    before(async () => {
      server = http.createServer(app);
      socketHandler = setupSocket(server);
      await new Promise(r => server.listen(0, '127.0.0.1', r));
      port = server.address().port;

      client = createClient(port);
      await new Promise(r => client.on('connect', r));

      const authP = waitForEvent(client, 'auth_success');
      client.emit('auth_session', { name: 'LockTester', color: '#10b981' });
      const auth = await authP;
      player = auth.player;
    });

    after(async () => {
      if (client && client.connected) client.disconnect();
      if (socketHandler && typeof socketHandler.stop === 'function') socketHandler.stop();
      if (socketHandler && socketHandler.io) await new Promise(r => socketHandler.io.close(r));
      await new Promise(r => server.close(r));
    });

    it('should block navigation when player has an active bet placed in Roulette', async () => {
      // Place bet on Roulette
      const betP = waitForEvent(client, 'bet_accepted');
      client.emit('place_bet', { type: 'red', amount: 500 });
      await betP;

      // 1. Attempt player_set_game to Blackjack
      const blocked1P = waitForEvent(client, 'navigation_blocked');
      client.emit('player_set_game', { game: 'Blackjack' });
      const b1 = await blocked1P;
      assert.equal(b1.code, 'CANNOT_LEAVE_ACTIVE_BETS');
      assert.equal(b1.game, 'Roulette');
      assert.equal(b1.amount, 500);

      // 2. Attempt player_set_location to LOBBY
      const blocked2P = waitForEvent(client, 'navigation_blocked');
      client.emit('player_set_location', { location: 'LOBBY' });
      const b2 = await blocked2P;
      assert.equal(b2.code, 'CANNOT_LEAVE_ACTIVE_BETS');

      // 3. Attempt leave_table
      const blocked3P = waitForEvent(client, 'navigation_blocked');
      client.emit('leave_table');
      const b3 = await blocked3P;
      assert.equal(b3.code, 'CANNOT_LEAVE_ACTIVE_BETS');

      // Clear bets in betting phase -> lock lifted
      const clearP = waitForEvent(client, 'chips_update');
      client.emit('clear_bets');
      await clearP;

      const switchP = waitForEvent(client, 'game_switched');
      client.emit('player_set_game', { game: 'Blackjack' });
      const sw = await switchP;
      assert.equal(sw.game, 'Blackjack');
    });

    it('should block navigation when player has an active bet placed in Blackjack', async () => {
      // Take Seat 0 on Table 1
      const seatP = waitForEvent(client, 'bj_seat_accepted');
      client.emit('bj_take_seat', { tableId: 'table_1', seatIndex: 0 });
      await seatP;

      // Place Blackjack bet
      const betP = waitForEvent(client, 'bj_bet_accepted');
      client.emit('bj_place_bet', { tableId: 'table_1', seatIndex: 0, amount: 600 });
      await betP;

      // 1. Attempt player_set_game to Roulette
      const blocked1P = waitForEvent(client, 'navigation_blocked');
      client.emit('player_set_game', { game: 'Roulette' });
      const b1 = await blocked1P;
      assert.equal(b1.code, 'CANNOT_LEAVE_ACTIVE_BETS');
      assert.equal(b1.game, 'Blackjack');
      assert.equal(b1.amount, 600);

      // 2. Attempt player_set_location to LOBBY
      const blocked2P = waitForEvent(client, 'navigation_blocked');
      client.emit('player_set_location', { location: 'LOBBY' });
      const b2 = await blocked2P;
      assert.equal(b2.code, 'CANNOT_LEAVE_ACTIVE_BETS');

      // 3. Attempt bj_leave_seat
      const blockedSeatP = waitForEvent(client, 'bj_seat_error');
      client.emit('bj_leave_seat', { tableId: 'table_1', seatIndex: 0 });
      const bSeat = await blockedSeatP;
      assert.equal(bSeat.code, 'CANNOT_LEAVE_ACTIVE_BETS');

      // Clear bet before round start -> lock lifted
      client.emit('bj_clear_bet', { tableId: 'table_1', seatIndex: 0 });
      await waitForEvent(client, 'chips_update');

      const vacatedP = waitForEvent(client, 'bj_seat_vacated');
      client.emit('bj_leave_seat', { tableId: 'table_1', seatIndex: 0 });
      const vac = await vacatedP;
      assert.equal(vac.seatIndex, 0);
    });
  });

  // ===========================================================================
  // 6. Session Reload & Rapid Reconnect Stress
  // ===========================================================================
  describe('Dimension 6: Session Reload & Rapid Reconnect Stress', () => {
    const testDir = path.join(__dirname, '..', 'temp_reload_stress');
    const storagePath = path.join(testDir, 'players.json');

    beforeEach(() => {
      if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
      fs.mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
      if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('should withstand 50 rapid sequential and concurrent re-authentications with zero chip loss and zero 10k resets', async () => {
      const pm = new PlayerManager({ storagePath, debounceMs: 0 });

      // Create initial player
      const initialAuth = pm.authSession('sock_init', { name: 'StressTestVIP', color: '#3b82f6' });
      assert.equal(initialAuth.isNew, true);
      assert.equal(initialAuth.player.chips, 10000);

      const token = initialAuth.sessionToken;
      const playerId = initialAuth.player.id;

      // Player wins 4,500 chips -> new balance 14,500
      pm.addChips(playerId, 4500);
      pm.updatePlayerStats(playerId, { wonAmount: 4500 });
      pm.flushToDiskSync();

      assert.equal(pm.getPlayerById(playerId).chips, 14500);

      // Perform 50 rapid reloads across changing socket IDs
      const RELOAD_COUNT = 50;
      const reloadPromises = [];

      for (let i = 0; i < RELOAD_COUNT; i++) {
        const sockId = `sock_reload_${i}`;
        reloadPromises.push(
          Promise.resolve().then(() => {
            const res = pm.authSession(sockId, { sessionToken: token });
            return res;
          })
        );
      }

      const results = await Promise.all(reloadPromises);
      assert.equal(results.length, RELOAD_COUNT);

      for (let i = 0; i < RELOAD_COUNT; i++) {
        const res = results[i];
        assert.equal(res.isNew, false, `Reload ${i} must have isNew: false`);
        assert.equal(res.sessionToken, token, `Reload ${i} token mismatch`);
        assert.equal(res.player.id, playerId, `Reload ${i} playerId mismatch`);
        assert.equal(res.player.chips, 14500, `Reload ${i} must preserve exactly 14,500 chips and NEVER reset to 10,000!`);
        assert.equal(res.player.stats.roundsPlayed, 1);
        assert.equal(res.player.stats.totalWon, 4500);
      }

      // Simulate full process restart: new PlayerManager instance from disk
      const newPm = new PlayerManager({ storagePath, debounceMs: 0 });
      const restored = newPm.authSession('sock_after_restart', { sessionToken: token });

      assert.equal(restored.isNew, false);
      assert.equal(restored.player.id, playerId);
      assert.equal(restored.player.chips, 14500, 'Disk reload after restart must preserve exact 14,500 chip balance');
      assert.equal(restored.player.name, 'StressTestVIP');
      assert.equal(restored.player.color, '#3b82f6');
    });
  });

});
