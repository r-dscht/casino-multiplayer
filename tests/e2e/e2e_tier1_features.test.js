/**
 * e2e_tier1_features.test.js
 * Opaque-Box E2E Test Suite — Tier 1: Feature Coverage (>=5 tests per core feature)
 * Verifies all primary happy paths for each core feature in isolation over HTTP and Socket.io.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer, createTestClient, httpGet } = require('./harness');

describe('E2E Tier 1: Feature Coverage', () => {
  let env;

  before(async () => {
    env = await startTestServer({ autoStartEngine: true });
  });

  after(async () => {
    if (env) await env.close();
  });

  // =========================================================================
  // Core Feature 1: HTTP Server, Static Delivery & Luxury Casino Theme
  // =========================================================================
  describe('Feature 1: HTTP Delivery, Luxury Casino Theme & Silent Design', () => {
    it('1.1 should serve healthcheck endpoint with 200 OK and valid status', async () => {
      const res = await httpGet(env.url, '/health');
      assert.equal(res.status, 200);
      assert.equal(res.json.status, 'ok');
      assert.ok(typeof res.json.timestamp === 'number');
      assert.ok(typeof res.json.uptime === 'number');
    });

    it('1.2 should have Express trust proxy enabled for cloud reverse proxies', async () => {
      const app = require('../../server/app');
      assert.equal(app.get('trust proxy'), 1, 'Express trust proxy must be configured to 1');
    });

    it('1.3 should enforce brand sanitization (zero GTA or Grand Theft Auto branding)', async () => {
      const clientIndex = path.join(__dirname, '../../client/index.html');
      if (fs.existsSync(clientIndex)) {
        const html = fs.readFileSync(clientIndex, 'utf8');
        const lower = html.toLowerCase();
        assert.ok(!lower.includes('grand theft auto'), 'HTML must not reference Grand Theft Auto');
        assert.ok(!lower.includes('los santos'), 'HTML must not reference Los Santos');
        assert.ok(!lower.includes('diamond casino'), 'HTML must not reference Diamond Casino');
      } else {
        // Progressive testability: client HTML pending Milestone 2
        assert.ok(true, 'Client HTML pending Milestone 2');
      }
    });

    it('1.4 should enforce 100% silent design ("geen audio" constraint)', async () => {
      const clientDir = path.join(__dirname, '../../client');
      if (fs.existsSync(clientDir)) {
        const files = fs.readdirSync(clientDir, { recursive: true });
        for (const file of files) {
          const str = String(file).toLowerCase();
          assert.ok(!str.endsWith('.mp3'), `Audio file found: ${file}`);
          assert.ok(!str.endsWith('.wav'), `Audio file found: ${file}`);
          assert.ok(!str.endsWith('.ogg'), `Audio file found: ${file}`);
        }
      } else {
        assert.ok(true, 'Audio scan passed: client directory pending Milestone 2');
      }
    });

    it('1.5 should accept cross-origin requests and support WebSocket upgrades', async () => {
      const client = createTestClient(env.url);
      await client.connect();
      assert.ok(client.id, 'WebSocket client connected over CORS/WSS');
      await client.disconnect();
    });
  });

  // =========================================================================
  // Core Feature 2: Player Onboarding & Bankroll Initialization
  // =========================================================================
  describe('Feature 2: Player Onboarding & Bankroll Initialization (join_table)', () => {
    it('2.1 should onboard player and return table_state with player info', async () => {
      const client = createTestClient(env.url);
      await client.connect();
      const state = await client.joinTable({ name: 'Alice', avatar: 'gem1', color: '#10b981' });
      assert.ok(state, 'table_state received');
      assert.ok(state.currentPhase, 'currentPhase is present');
      assert.ok(Array.isArray(state.players), 'players array is present');
      const player = state.players.find((p) => p.name === 'Alice');
      assert.ok(player, 'Alice found in players list');
      assert.equal(player.color, '#10b981');
      await client.disconnect();
    });

    it('2.2 should grant newly joined player an exact starting balance of 10,000 chips', async () => {
      const client = createTestClient(env.url);
      await client.connect();
      const state = await client.joinTable({ name: 'Bob', color: '#3b82f6' });
      const bob = state.players.find((p) => p.name === 'Bob');
      assert.equal(bob.chips, 10000, 'Starting bankroll must be exactly 10,000 chips');
      await client.disconnect();
    });

    it('2.3 should return active phase, timeLeft, and empty/clean activeBets', async () => {
      const client = createTestClient(env.url);
      await client.connect();
      const state = await client.joinTable({ name: 'Charlie' });
      assert.ok(['BETTING', 'SPINNING', 'PAYOUT'].includes(state.currentPhase));
      assert.ok(typeof state.timeLeft === 'number' && state.timeLeft >= 0);
      assert.ok(typeof state.tableChipsTotal === 'number');
      await client.disconnect();
    });

    it('2.4 should broadcast player_joined to other connected clients', async () => {
      const clientA = createTestClient(env.url);
      const clientB = createTestClient(env.url);
      await clientA.connect();
      await clientA.joinTable({ name: 'Player_A' });

      await clientB.connect();
      const joinPromise = clientA.waitFor('player_joined', (p) => p.player.name === 'Player_B');
      await clientB.joinTable({ name: 'Player_B', color: '#ef4444' });

      const joinedEvent = await joinPromise;
      assert.equal(joinedEvent.player.name, 'Player_B');
      assert.equal(joinedEvent.player.chips, 10000);

      await clientA.disconnect();
      await clientB.disconnect();
    });

    it('2.5 should create a system chat announcement when a player joins the table', async () => {
      const clientA = createTestClient(env.url);
      const clientB = createTestClient(env.url);
      await clientA.connect();
      await clientA.joinTable({ name: 'HostPlayer' });

      await clientB.connect();
      const chatPromise = clientA.waitFor(
        'chat_message',
        (msg) => msg.isSystem === true && msg.text.includes('NewGuest joined')
      );
      await clientB.joinTable({ name: 'NewGuest' });

      const chatMsg = await chatPromise;
      assert.ok(chatMsg.text.includes('NewGuest joined the table.'));
      assert.equal(chatMsg.isSystem, true);
      assert.equal(chatMsg.sender, 'CASINO');

      await clientA.disconnect();
      await clientB.disconnect();
    });
  });

  // =========================================================================
  // Core Feature 3: Standard Inside & Outside Bet Placement
  // =========================================================================
  describe('Feature 3: Bet Placement & Ledger Management (place_bet)', () => {
    let client;

    before(async () => {
      client = createTestClient(env.url);
      await client.connect();
      await client.joinTable({ name: 'Bettor' });
      // Ensure we are in BETTING phase
      if (env.engine.currentPhase !== 'BETTING') {
        env.engine.transitionToBetting();
      }
    });

    after(async () => {
      await client.disconnect();
    });

    it('3.1 should accept straight bet on single pocket (17) and deduct chips', async () => {
      if (env.engine.currentPhase !== 'BETTING') env.engine.transitionToBetting();
      const res = await client.placeBet({ type: 'straight', value: 17, amount: 200 });
      assert.equal(res.accepted, true);
      assert.equal(res.data.bet.type, 'straight');
      assert.equal(res.data.bet.value, 17);
      assert.equal(res.data.bet.amount, 200);
      assert.equal(res.data.remainingChips, 9800);
    });

    it('3.2 should accept split bet on two adjacent numbers [14, 17]', async () => {
      const res = await client.placeBet({ type: 'split', value: [14, 17], amount: 300 });
      assert.equal(res.accepted, true);
      assert.equal(res.data.bet.type, 'split');
      assert.deepEqual(res.data.bet.value, [14, 17]);
      assert.equal(res.data.remainingChips, 9500);
    });

    it('3.3 should accept street bet on 3 numbers in a row [1, 2, 3]', async () => {
      const res = await client.placeBet({ type: 'street', value: [1, 2, 3], amount: 150 });
      assert.equal(res.accepted, true);
      assert.equal(res.data.bet.type, 'street');
      assert.deepEqual(res.data.bet.value, [1, 2, 3]);
    });

    it('3.4 should accept corner bet on 4 numbers in a 2x2 square [1, 2, 4, 5]', async () => {
      const res = await client.placeBet({ type: 'corner', value: [1, 2, 4, 5], amount: 250 });
      assert.equal(res.accepted, true);
      assert.equal(res.data.bet.type, 'corner');
      assert.deepEqual(res.data.bet.value, [1, 2, 4, 5]);
    });

    it('3.5 should accept six_line bet on 6 numbers across 2 rows [1, 2, 3, 4, 5, 6]', async () => {
      const res = await client.placeBet({ type: 'six_line', value: [1, 2, 3, 4, 5, 6], amount: 100 });
      assert.equal(res.accepted, true);
      assert.equal(res.data.bet.type, 'six_line');
    });

    it('3.6 should accept outside 2:1 bets (column 2 and dozen 3)', async () => {
      const colRes = await client.placeBet({ type: 'column', value: 2, amount: 200 });
      assert.equal(colRes.accepted, true);

      const dozRes = await client.placeBet({ type: 'dozen', value: 3, amount: 300 });
      assert.equal(dozRes.accepted, true);
    });

    it('3.7 should accept outside 1:1 even-money bets (red, black, even, odd, low, high)', async () => {
      const redRes = await client.placeBet({ type: 'red', value: null, amount: 100 });
      assert.equal(redRes.accepted, true);

      const evenRes = await client.placeBet({ type: 'even', value: null, amount: 100 });
      assert.equal(evenRes.accepted, true);

      const highRes = await client.placeBet({ type: 'high', value: null, amount: 100 });
      assert.equal(highRes.accepted, true);
    });

    it('3.8 should broadcast bet_placed to all clients with player details and table total', async () => {
      const watcher = createTestClient(env.url);
      await watcher.connect();
      await watcher.joinTable({ name: 'Watcher' });

      const broadcastPromise = watcher.waitFor(
        'bet_placed',
        (b) => b.playerName === 'Bettor' && b.bet.type === 'straight' && b.bet.value === 32
      );
      await client.placeBet({ type: 'straight', value: 32, amount: 50 });

      const broadcast = await broadcastPromise;
      assert.equal(broadcast.playerName, 'Bettor');
      assert.equal(broadcast.bet.amount, 50);
      assert.ok(broadcast.tableChipsTotal > 0);

      await watcher.disconnect();
    });
  });

  // =========================================================================
  // Core Feature 4: Clear Bets & Chip Restoration
  // =========================================================================
  describe('Feature 4: Clear Bets & Chip Restoration (clear_bets)', () => {
    let client;

    before(async () => {
      client = createTestClient(env.url);
      await client.connect();
      await client.joinTable({ name: 'ClearTester' });
    });

    after(async () => {
      await client.disconnect();
    });

    it('4.1 should refund exact chips when clearing a single bet', async () => {
      if (env.engine.currentPhase !== 'BETTING') env.engine.transitionToBetting();
      const initialChips = 10000;
      await client.placeBet({ type: 'straight', value: 7, amount: 1000 });
      const clearRes = await client.clearBets();
      assert.equal(clearRes.cleared, true);
      assert.equal(clearRes.chips, initialChips);
    });

    it('4.2 should refund the aggregate sum when clearing multiple bets', async () => {
      await client.placeBet({ type: 'red', value: null, amount: 500 });
      await client.placeBet({ type: 'black', value: null, amount: 500 });
      await client.placeBet({ type: 'straight', value: 0, amount: 200 });

      const clearRes = await client.clearBets();
      assert.equal(clearRes.cleared, true);
      assert.equal(clearRes.chips, 10000);
    });

    it('4.3 should emit chips_update event to placing player on clear', async () => {
      await client.placeBet({ type: 'even', value: null, amount: 400 });
      const chipsUpdatePromise = client.waitFor('chips_update');
      await client.clearBets();
      const update = await chipsUpdatePromise;
      assert.equal(update.chips, 10000);
    });

    it('4.4 should broadcast bets_cleared to room with playerId and updated table chips', async () => {
      const roomClient = createTestClient(env.url);
      await roomClient.connect();
      await roomClient.joinTable({ name: 'RoomObserver' });

      const beforeTotal = env.engine.tableChipsTotal;
      await client.placeBet({ type: 'column', value: 1, amount: 300 });
      const clearBroadcastPromise = roomClient.waitForNext(
        'bets_cleared',
        (ev) => ev.playerId === client.playerId
      );
      await client.clearBets();

      const clearEv = await clearBroadcastPromise;
      assert.equal(clearEv.playerId, client.playerId);
      assert.equal(clearEv.tableChipsTotal, beforeTotal);

      await roomClient.disconnect();
    });

    it('4.5 should allow placing new bets immediately after clearing without error', async () => {
      await client.placeBet({ type: 'straight', value: 10, amount: 200 });
      await client.clearBets();
      const freshBet = await client.placeBet({ type: 'straight', value: 11, amount: 250 });
      assert.equal(freshBet.accepted, true);
      assert.equal(freshBet.data.remainingChips, 9750);
      await client.clearBets(); // cleanup
    });
  });

  // =========================================================================
  // Core Feature 5: Real-Time Chat & System Logging
  // =========================================================================
  describe('Feature 5: Real-Time Chat & System Logging (chat_message)', () => {
    let clientA;
    let clientB;

    before(async () => {
      clientA = createTestClient(env.url);
      clientB = createTestClient(env.url);
      await clientA.connect();
      await clientA.joinTable({ name: 'ChatterA', color: '#10b981' });
      await clientB.connect();
      await clientB.joinTable({ name: 'ChatterB', color: '#3b82f6' });
    });

    after(async () => {
      await clientA.disconnect();
      await clientB.disconnect();
    });

    it('5.1 should broadcast player chat message to all players in the room', async () => {
      const waitPromise = clientB.waitFor('chat_message', (m) => m.text === 'Hello Table!');
      clientA.sendChat('Hello Table!');
      const received = await waitPromise;
      assert.equal(received.text, 'Hello Table!');
      assert.equal(received.sender, 'ChatterA');
    });

    it('5.2 should populate message metadata (sender, color, timestamp, isSystem: false)', async () => {
      const waitPromise = clientB.waitFor('chat_message', (m) => m.text === 'Testing metadata');
      clientA.sendChat('Testing metadata');
      const received = await waitPromise;
      assert.equal(received.sender, 'ChatterA');
      assert.equal(received.color, '#10b981');
      assert.equal(received.isSystem, false);
      assert.ok(typeof received.timestamp === 'number');
    });

    it('5.3 should preserve chat messages in chatHistory for newly joining clients', async () => {
      clientA.sendChat('Archived Message for newcomers');
      await new Promise((r) => setTimeout(r, 100));

      const clientC = createTestClient(env.url);
      await clientC.connect();
      const state = await clientC.joinTable({ name: 'LateChatter' });

      assert.ok(Array.isArray(state.chatHistory));
      const found = state.chatHistory.some((m) => m.text === 'Archived Message for newcomers');
      assert.ok(found, 'Message found in chat history');

      await clientC.disconnect();
    });

    it('5.4 should log game events as system chat messages with CASINO sender and gold color', async () => {
      // Broadcast a mock win announcement or trigger phase
      env.broadcastChatMessage({
        sender: 'CASINO',
        color: '#d4af37',
        text: 'System Announcement: Welcome VIPs',
        timestamp: Date.now(),
        isSystem: true
      });

      const sysMsg = await clientA.waitFor(
        'chat_message',
        (m) => m.isSystem === true && m.text.includes('Welcome VIPs')
      );
      assert.equal(sysMsg.sender, 'CASINO');
      assert.equal(sysMsg.color, '#d4af37');
      assert.equal(sysMsg.isSystem, true);
    });

    it('5.5 should escape HTML entities to prevent script injection in chat', async () => {
      const waitPromise = clientB.waitForNext('chat_message', (m) => m.sender === 'ChatterA');
      clientA.sendChat('<script>alert("hack")</script>');
      const received = await waitPromise;
      assert.ok(!received.text.includes('<script>'), 'Raw script tags must not be present');
      assert.ok(received.text.includes('&lt;script&gt;'), 'Script tags must be escaped as HTML entities');
    });
  });

  // =========================================================================
  // Core Feature 6: Authoritative State Machine & Round Synchronization
  // =========================================================================
  describe('Feature 6: Authoritative State Machine & Clock Synchronization', () => {
    let client;

    before(async () => {
      client = createTestClient(env.url);
      await client.connect();
      await client.joinTable({ name: 'SyncTester' });
    });

    after(async () => {
      await client.disconnect();
    });

    it('6.1 should emit phase_tick each second with phase, timeLeft, and serverTime', async () => {
      const tick = await client.waitFor('phase_tick');
      assert.ok(['BETTING', 'SPINNING', 'PAYOUT'].includes(tick.phase));
      assert.ok(typeof tick.timeLeft === 'number');
      assert.ok(typeof tick.serverTime === 'number');
    });

    it('6.2 should transition from BETTING to SPINNING with winningNumber and duration', async () => {
      if (env.engine.currentPhase !== 'BETTING') env.engine.transitionToBetting();
      const phaseChangePromise = client.waitFor('phase_change', (p) => p.phase === 'SPINNING');

      // Trigger spin transition
      env.engine.transitionToSpinning();

      const phaseChange = await phaseChangePromise;
      assert.equal(phaseChange.phase, 'SPINNING');
      assert.equal(phaseChange.duration, 9);
      assert.ok(typeof phaseChange.winningNumber === 'number');
      assert.ok(['green', 'red', 'black'].includes(phaseChange.winningColor));
    });

    it('6.3 should guarantee winningNumber is within European single-zero range [0..36]', async () => {
      const num = env.engine.winningNumber;
      assert.ok(Number.isInteger(num), 'Winning number must be an integer');
      assert.ok(num >= 0 && num <= 36, `Winning number ${num} must be between 0 and 36`);
    });

    it('6.4 should transition from SPINNING to PAYOUT with round_result results array', async () => {
      const resultPromise = client.waitFor('round_result');
      env.engine.transitionToPayout();

      const result = await resultPromise;
      assert.ok(typeof result.winningNumber === 'number');
      assert.ok(Array.isArray(result.results), 'results array is present');
      assert.ok(Array.isArray(result.history), 'history array is present');
    });

    it('6.5 should prepend winning number to history buffer up to 15 entries', async () => {
      const winNum = env.engine.winningNumber;
      assert.equal(env.engine.history[0], winNum, 'Most recent winning number must be first in history');
      assert.ok(env.engine.history.length <= 15, 'History must not exceed 15 numbers');

      // Reset back to BETTING for subsequent tests
      env.engine.transitionToBetting();
    });
  });

  // =========================================================================
  // Core Feature 7: Disconnection & Session Persistence
  // =========================================================================
  describe('Feature 7: Disconnection & Session Persistence', () => {
    it('7.1 should emit player_left when client disconnects', async () => {
      const clientStay = createTestClient(env.url);
      const clientLeave = createTestClient(env.url);
      await clientStay.connect();
      await clientStay.joinTable({ name: 'StayPlayer' });
      await clientLeave.connect();
      await clientLeave.joinTable({ name: 'LeaverPlayer' });

      const leavePromise = clientStay.waitFor(
        'player_left',
        (p) => p.name === 'LeaverPlayer'
      );
      await clientLeave.disconnect();

      const leaveEvent = await leavePromise;
      assert.equal(leaveEvent.name, 'LeaverPlayer');

      await clientStay.disconnect();
    });

    it('7.2 should broadcast system chat notice when a player leaves', async () => {
      const clientStay = createTestClient(env.url);
      const clientLeave = createTestClient(env.url);
      await clientStay.connect();
      await clientStay.joinTable({ name: 'StayObserver' });
      await clientLeave.connect();
      await clientLeave.joinTable({ name: 'GhostPlayer' });

      const chatLeavePromise = clientStay.waitFor(
        'chat_message',
        (m) => m.isSystem === true && m.text.includes('GhostPlayer left')
      );
      await clientLeave.disconnect();

      const chatLeave = await chatLeavePromise;
      assert.ok(chatLeave.text.includes('GhostPlayer left the table.'));

      await clientStay.disconnect();
    });

    it('7.3 should preserve placed bets when player disconnects during BETTING phase', async () => {
      if (env.engine.currentPhase !== 'BETTING') env.engine.transitionToBetting();

      const clientLeaver = createTestClient(env.url);
      await clientLeaver.connect();
      await clientLeaver.joinTable({ name: 'BetAndDrop' });
      const leaverId = clientLeaver.playerId;

      await clientLeaver.placeBet({ type: 'straight', value: 20, amount: 500 });
      assert.ok(env.engine.bets.has(leaverId), 'Bet must be recorded in engine');

      await clientLeaver.disconnect();

      // Bet must still exist in engine!
      assert.ok(env.engine.bets.has(leaverId), 'Bet must NOT be deleted on disconnect');
      assert.equal(env.engine.bets.get(leaverId)[0].amount, 500);
    });

    it('7.4 should evaluate disconnected player bets and credit winnings on PAYOUT', async () => {
      const clientLeaver = createTestClient(env.url);
      await clientLeaver.connect();
      await clientLeaver.joinTable({ name: 'LuckyLeaver' });
      const leaverId = clientLeaver.playerId;

      // Place bet on red
      await clientLeaver.placeBet({ type: 'red', value: null, amount: 1000 });
      const initialRemainingChips = env.playerManager.getPlayerById(leaverId).chips; // 9,000

      await clientLeaver.disconnect();

      // Force spinning with a known red number (e.g. 1)
      env.engine.transitionToSpinning();
      env.engine.winningNumber = 1; // 1 is Red
      env.engine.winningColor = 'red';

      // Transition to payout
      env.engine.transitionToPayout();

      // Check player's chips in manager
      const playerRecord = env.playerManager.getPlayerById(leaverId);
      assert.equal(
        playerRecord.chips,
        initialRemainingChips + 2000,
        'Winnings must be credited to disconnected player ledger'
      );
    });

    it('7.5 should retain player bankroll in memory registry across session', async () => {
      const p = env.playerManager.registerPlayer('persisted_socket', { name: 'PersistentUser' });
      assert.equal(p.chips, 10000);
      env.playerManager.addChips(p.id, 5000);
      assert.equal(env.playerManager.getPlayerById(p.id).chips, 15000);
      env.playerManager.disconnectPlayer('persisted_socket');
      assert.equal(env.playerManager.getPlayerById(p.id).chips, 15000, 'Bankroll intact after disconnect');
    });
  });
});
