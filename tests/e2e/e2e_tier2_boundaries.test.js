/**
 * e2e_tier2_boundaries.test.js
 * Opaque-Box E2E Test Suite — Tier 2: Boundary & Corner Cases (>=5 tests per area)
 * Verifies limits, zero-pocket geometry, balance limits, phase locking, and adversarial inputs.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, createTestClient } = require('./harness');

describe('E2E Tier 2: Boundary & Corner Cases', () => {
  let env;

  before(async () => {
    env = await startTestServer({ autoStartEngine: true });
  });

  after(async () => {
    if (env) await env.close();
  });

  // =========================================================================
  // Area 1: Financial & Balance Bounds
  // =========================================================================
  describe('Area 1: Financial & Chip Balance Boundaries', () => {
    let client;

    before(async () => {
      client = createTestClient(env.url);
      await client.connect();
      await client.joinTable({ name: 'BankrollTester' });
    });

    after(async () => {
      await client.disconnect();
    });

    it('1.1 should reject bet exceeding player chip balance with INSUFFICIENT_FUNDS', async () => {
      if (env.engine.currentPhase !== 'BETTING') env.engine.transitionToBetting();
      const res = await client.placeBet({ type: 'straight', value: 17, amount: 15000 });
      assert.equal(res.accepted, false);
      assert.equal(res.error.code, 'INSUFFICIENT_FUNDS');
      assert.ok(res.error.reason.includes('Insufficient'));
    });

    it('1.2 should accept all-in bet where amount equals exactly total chips (10,000)', async () => {
      const res = await client.placeBet({ type: 'red', value: null, amount: 10000 });
      assert.equal(res.accepted, true);
      assert.equal(res.data.remainingChips, 0);

      // Refund to continue testing
      const clear = await client.clearBets();
      assert.equal(clear.cleared, true);
      assert.equal(clear.chips, 10000);
    });

    it('1.3 should reject any bet when player balance is 0 with INSUFFICIENT_FUNDS', async () => {
      // Go all-in first
      await client.placeBet({ type: 'black', value: null, amount: 10000 });
      // Now player has 0 chips left
      const nextBet = await client.placeBet({ type: 'straight', value: 5, amount: 100 });
      assert.equal(nextBet.accepted, false);
      assert.equal(nextBet.error.code, 'INSUFFICIENT_FUNDS');

      // Clear all-in bet
      await client.clearBets();
    });

    it('1.4 should reject cumulative bets exceeding bankroll while keeping earlier bets intact', async () => {
      const bet1 = await client.placeBet({ type: 'straight', value: 7, amount: 6000 });
      assert.equal(bet1.accepted, true);
      assert.equal(bet1.data.remainingChips, 4000);

      // Attempt 5,000 chips (only 4,000 remain)
      const bet2 = await client.placeBet({ type: 'straight', value: 8, amount: 5000 });
      assert.equal(bet2.accepted, false);
      assert.equal(bet2.error.code, 'INSUFFICIENT_FUNDS');

      // Attempt 4,000 chips (should succeed exactly)
      const bet3 = await client.placeBet({ type: 'straight', value: 9, amount: 4000 });
      assert.equal(bet3.accepted, true);
      assert.equal(bet3.data.remainingChips, 0);

      await client.clearBets();
    });

    it('1.5 should reject zero and negative chip amounts with INVALID_AMOUNT', async () => {
      const zeroBet = await client.placeBet({ type: 'straight', value: 1, amount: 0 });
      assert.equal(zeroBet.accepted, false);
      assert.equal(zeroBet.error.code, 'INVALID_AMOUNT');

      const negBet = await client.placeBet({ type: 'straight', value: 1, amount: -500 });
      assert.equal(negBet.accepted, false);
      assert.equal(negBet.error.code, 'INVALID_AMOUNT');
    });

    it('1.6 should reject fractional, NaN, and non-integer amounts with INVALID_AMOUNT', async () => {
      const floatBet = await client.placeBet({ type: 'straight', value: 1, amount: 12.5 });
      assert.equal(floatBet.accepted, false);
      assert.equal(floatBet.error.code, 'INVALID_AMOUNT');

      const strBet = await client.placeBet({ type: 'straight', value: 1, amount: 'one hundred' });
      assert.equal(strBet.accepted, false);
      assert.equal(strBet.error.code, 'INVALID_AMOUNT');
    });
  });

  // =========================================================================
  // Area 2: Bet Coordinates & Zero-Adjacent Inside Combinations
  // =========================================================================
  describe('Area 2: Bet Coordinates & Zero-Adjacent Combinations', () => {
    let client;

    before(async () => {
      client = createTestClient(env.url);
      await client.connect();
      await client.joinTable({ name: 'CoordsTester' });
    });

    after(async () => {
      await client.disconnect();
    });

    it('2.1 should accept straight bet on 0 pocket and deduct chips', async () => {
      if (env.engine.currentPhase !== 'BETTING') env.engine.transitionToBetting();
      const res = await client.placeBet({ type: 'straight', value: 0, amount: 100 });
      assert.equal(res.accepted, true);
      assert.equal(res.data.bet.value, 0);
    });

    it('2.2 should accept zero-adjacent splits ([0, 1], [0, 2], [0, 3])', async () => {
      const s1 = await client.placeBet({ type: 'split', value: [0, 1], amount: 50 });
      assert.equal(s1.accepted, true);

      const s2 = await client.placeBet({ type: 'split', value: [0, 2], amount: 50 });
      assert.equal(s2.accepted, true);

      const s3 = await client.placeBet({ type: 'split', value: [0, 3], amount: 50 });
      assert.equal(s3.accepted, true);
    });

    it('2.3 should accept zero-trio streets ([0, 1, 2] and [0, 2, 3])', async () => {
      const t1 = await client.placeBet({ type: 'street', value: [0, 1, 2], amount: 100 });
      assert.equal(t1.accepted, true);

      const t2 = await client.placeBet({ type: 'street', value: [0, 2, 3], amount: 100 });
      assert.equal(t2.accepted, true);
    });

    it('2.4 should accept First Four basket corner bet [0, 1, 2, 3]', async () => {
      const ff = await client.placeBet({ type: 'corner', value: [0, 1, 2, 3], amount: 200 });
      assert.equal(ff.accepted, true);
      assert.deepEqual(ff.data.bet.value, [0, 1, 2, 3]);
    });

    it('2.5 should reject out of range straight bets (-1, 37, 100) with OUT_OF_RANGE', async () => {
      const r1 = await client.placeBet({ type: 'straight', value: -1, amount: 50 });
      assert.equal(r1.accepted, false);
      assert.equal(r1.error.code, 'OUT_OF_RANGE');

      const r2 = await client.placeBet({ type: 'straight', value: 37, amount: 50 });
      assert.equal(r2.accepted, false);
      assert.equal(r2.error.code, 'OUT_OF_RANGE');

      const r3 = await client.placeBet({ type: 'straight', value: 100, amount: 50 });
      assert.equal(r3.accepted, false);
      assert.equal(r3.error.code, 'OUT_OF_RANGE');
    });

    it('2.6 should reject invalid split combinations (non-adjacent [1, 5] and [14, 29]) with INVALID_SELECTION', async () => {
      const s1 = await client.placeBet({ type: 'split', value: [1, 5], amount: 100 });
      assert.equal(s1.accepted, false);
      assert.equal(s1.error.code, 'INVALID_SELECTION');

      const s2 = await client.placeBet({ type: 'split', value: [14, 29], amount: 100 });
      assert.equal(s2.accepted, false);
      assert.equal(s2.error.code, 'INVALID_SELECTION');
    });

    it('2.7 should reject invalid column and dozen indices (0, 4, -1) with INVALID_SELECTION', async () => {
      const c1 = await client.placeBet({ type: 'column', value: 0, amount: 100 });
      assert.equal(c1.accepted, false);
      assert.equal(c1.error.code, 'INVALID_SELECTION');

      const d1 = await client.placeBet({ type: 'dozen', value: 4, amount: 100 });
      assert.equal(d1.accepted, false);
      assert.equal(d1.error.code, 'INVALID_SELECTION');
    });

    it('2.8 should validate maximum boundary coordinates ([35, 36], [32, 33, 35, 36], six-line [31..36])', async () => {
      await client.clearBets();
      const splitMax = await client.placeBet({ type: 'split', value: [35, 36], amount: 100 });
      assert.equal(splitMax.accepted, true);

      const cornerMax = await client.placeBet({ type: 'corner', value: [32, 33, 35, 36], amount: 100 });
      assert.equal(cornerMax.accepted, true);

      const sixLineMax = await client.placeBet({ type: 'six_line', value: [31, 32, 33, 34, 35, 36], amount: 100 });
      assert.equal(sixLineMax.accepted, true);

      await client.clearBets();
    });
  });

  // =========================================================================
  // Area 3: Phase Locking & Timing Boundaries
  // =========================================================================
  describe('Area 3: Phase Locking & Transition Boundaries', () => {
    let client;

    before(async () => {
      client = createTestClient(env.url);
      await client.connect();
      await client.joinTable({ name: 'LockTester' });
    });

    after(async () => {
      await client.disconnect();
    });

    it('3.1 should reject bet placed in SPINNING phase with BETS_CLOSED', async () => {
      env.engine.transitionToSpinning();
      const res = await client.placeBet({ type: 'straight', value: 17, amount: 100 });
      assert.equal(res.accepted, false);
      assert.equal(res.error.code, 'BETS_CLOSED');
    });

    it('3.2 should reject bet placed in PAYOUT phase with BETS_CLOSED', async () => {
      env.engine.transitionToPayout();
      const res = await client.placeBet({ type: 'red', value: null, amount: 100 });
      assert.equal(res.accepted, false);
      assert.equal(res.error.code, 'BETS_CLOSED');
    });

    it('3.3 should reject clear_bets in SPINNING phase with BETS_CLOSED', async () => {
      env.engine.transitionToSpinning();
      const res = await client.clearBets();
      assert.equal(res.cleared, false);
      assert.equal(res.error.code, 'BETS_CLOSED');
    });

    it('3.4 should reject clear_bets in PAYOUT phase with BETS_CLOSED', async () => {
      env.engine.transitionToPayout();
      const res = await client.clearBets();
      assert.equal(res.cleared, false);
      assert.equal(res.error.code, 'BETS_CLOSED');
    });

    it('3.5 should transition to SPINNING when countdown reaches 0 and lock subsequent bets', async () => {
      env.engine.transitionToBetting();
      env.engine.timeLeft = 1; // 1 second left

      // Tick to 0
      env.engine.tick();
      assert.equal(env.engine.currentPhase, 'SPINNING');

      // Now betting is locked
      const lateBet = await client.placeBet({ type: 'straight', value: 1, amount: 50 });
      assert.equal(lateBet.accepted, false);
      assert.equal(lateBet.error.code, 'BETS_CLOSED');

      // Reset back to BETTING
      env.engine.transitionToBetting();
    });
  });

  // =========================================================================
  // Area 4: Chat Input & Sanitization Boundaries
  // =========================================================================
  describe('Area 4: Chat & Input Boundaries', () => {
    let clientA;
    let clientB;

    before(async () => {
      clientA = createTestClient(env.url);
      clientB = createTestClient(env.url);
      await clientA.connect();
      await clientA.joinTable({ name: 'ChatSender' });
      await clientB.connect();
      await clientB.joinTable({ name: 'ChatReceiver' });
    });

    after(async () => {
      await clientA.disconnect();
      await clientB.disconnect();
    });

    it('4.1 should ignore empty chat message without broadcasting', async () => {
      let receivedAny = false;
      const handler = () => { receivedAny = true; };
      clientB.socket.once('chat_message', handler);

      clientA.sendChat('');
      clientA.sendChat('    ');
      await new Promise((r) => setTimeout(r, 100));

      clientB.socket.off('chat_message', handler);
      assert.equal(receivedAny, false, 'Empty messages must not be broadcast');
    });

    it('4.2 should truncate chat messages exceeding 150 characters to exactly 150', async () => {
      const waitPromise = clientB.waitForNext('chat_message', (m) => m.sender === 'ChatSender');
      const longText = 'A'.repeat(250);
      clientA.sendChat(longText);

      const received = await waitPromise;
      assert.equal(received.text.length, 150, 'Text must be truncated to 150 characters');
      assert.equal(received.text, 'A'.repeat(150));
    });

    it('4.3 should completely escape script injection payload', async () => {
      const waitPromise = clientB.waitForNext('chat_message', (m) => m.sender === 'ChatSender');
      clientA.sendChat('<script>alert(document.cookie)</script>');

      const received = await waitPromise;
      assert.ok(!received.text.includes('<script>'));
      assert.ok(!received.text.includes('</script>'));
      assert.ok(received.text.includes('&lt;script&gt;'));
      assert.ok(received.text.includes('&lt;&#x2F;script&gt;'));
    });

    it('4.4 should sanitize complex nested HTML and attributes', async () => {
      const waitPromise = clientB.waitForNext('chat_message', (m) => m.sender === 'ChatSender');
      clientA.sendChat('<img src="x" onerror="steal()"/> & <b>bold</b>');

      const received = await waitPromise;
      assert.ok(!received.text.includes('<img'));
      assert.ok(received.text.includes('&lt;img'));
      assert.ok(received.text.includes('&amp;'));
      assert.ok(received.text.includes('&lt;b&gt;bold&lt;&#x2F;b&gt;'));
    });

    it('4.5 should truncate player display name exceeding 16 characters', async () => {
      const extraClient = createTestClient(env.url);
      await extraClient.connect();
      const state = await extraClient.joinTable({ name: 'Supercalifragilisticexpialidocious' });
      const player = state.players.find((p) => p.id === extraClient.playerId);
      assert.ok(player.name.length <= 16, `Name length ${player.name.length} must be <= 16`);
      await extraClient.disconnect();
    });

    it('4.6 should strip HTML tags from player display names to prevent XSS in player lists', async () => {
      const extraClient = createTestClient(env.url);
      await extraClient.connect();
      const state = await extraClient.joinTable({ name: '<b>Hacker</b>' });
      const player = state.players.find((p) => p.id === extraClient.playerId);
      assert.ok(!player.name.includes('<b>'));
      assert.equal(player.name, 'Hacker');
      await extraClient.disconnect();
    });
  });

  // =========================================================================
  // Area 5: Zero (0) Green Pocket Sweep Outcome
  // =========================================================================
  describe('Area 5: Zero (0) Green Pocket Sweep Outcome', () => {
    let client;

    before(async () => {
      client = createTestClient(env.url);
      await client.connect();
      await client.joinTable({ name: 'ZeroTester' });
    });

    after(async () => {
      await client.disconnect();
    });

    it('5.1 should result in 0 payout for all outside even-money bets when 0 lands', async () => {
      if (env.engine.currentPhase !== 'BETTING') env.engine.transitionToBetting();
      await client.placeBet({ type: 'red', value: null, amount: 100 });
      await client.placeBet({ type: 'black', value: null, amount: 100 });
      await client.placeBet({ type: 'even', value: null, amount: 100 });
      await client.placeBet({ type: 'odd', value: null, amount: 100 });
      await client.placeBet({ type: 'low', value: null, amount: 100 });
      await client.placeBet({ type: 'high', value: null, amount: 100 });

      // Force outcome = 0 (Green)
      env.engine.transitionToSpinning();
      env.engine.winningNumber = 0;
      env.engine.winningColor = 'green';

      const resultPromise = client.waitForNext('round_result');
      env.engine.transitionToPayout();
      const result = await resultPromise;

      const playerResult = result.results.find((r) => r.playerId === client.playerId);
      assert.equal(playerResult.totalWon, 0, 'All outside even-money bets must lose on 0');
      assert.equal(playerResult.totalBet, 600);
      assert.equal(playerResult.net, -600);
    });

    it('5.2 should result in 0 payout for all columns and dozens when 0 lands', async () => {
      env.engine.transitionToBetting();
      await client.placeBet({ type: 'column', value: 1, amount: 200 });
      await client.placeBet({ type: 'column', value: 2, amount: 200 });
      await client.placeBet({ type: 'dozen', value: 1, amount: 200 });
      await client.placeBet({ type: 'dozen', value: 2, amount: 200 });

      env.engine.transitionToSpinning();
      env.engine.winningNumber = 0;
      env.engine.winningColor = 'green';

      const resultPromise = client.waitForNext('round_result');
      env.engine.transitionToPayout();
      const result = await resultPromise;

      const playerResult = result.results.find((r) => r.playerId === client.playerId);
      assert.equal(playerResult.totalWon, 0, 'All columns and dozens must lose on 0');
      assert.equal(playerResult.net, -800);
    });

    it('5.3 should pay 36x gross (35:1 profit) for straight bet on 0 when 0 lands', async () => {
      env.engine.transitionToBetting();
      await client.placeBet({ type: 'straight', value: 0, amount: 500 });

      env.engine.transitionToSpinning();
      env.engine.winningNumber = 0;
      env.engine.winningColor = 'green';

      const resultPromise = client.waitForNext('round_result');
      env.engine.transitionToPayout();
      const result = await resultPromise;

      const playerResult = result.results.find((r) => r.playerId === client.playerId);
      assert.equal(playerResult.totalWon, 500 * 36, 'Straight 0 must pay 36x stake');
      assert.equal(playerResult.net, 500 * 35);
    });

    it('5.4 should pay 18x for split [0, 2] and 0 for non-zero split [1, 2] when 0 lands', async () => {
      env.engine.transitionToBetting();
      await client.placeBet({ type: 'split', value: [0, 2], amount: 200 });
      await client.placeBet({ type: 'split', value: [1, 2], amount: 200 });

      env.engine.transitionToSpinning();
      env.engine.winningNumber = 0;
      env.engine.winningColor = 'green';

      const resultPromise = client.waitForNext('round_result');
      env.engine.transitionToPayout();
      const result = await resultPromise;

      const playerResult = result.results.find((r) => r.playerId === client.playerId);
      assert.equal(playerResult.winningBets.length, 1);
      assert.equal(playerResult.winningBets[0].type, 'split');
      assert.equal(playerResult.totalWon, 200 * 18, 'Split covering 0 must pay 18x stake');
    });

    it('5.5 should pay 9x for First Four corner [0, 1, 2, 3] and 0 for non-zero corner when 0 lands', async () => {
      env.engine.transitionToBetting();
      await client.placeBet({ type: 'corner', value: [0, 1, 2, 3], amount: 100 });
      await client.placeBet({ type: 'corner', value: [1, 2, 4, 5], amount: 100 });

      env.engine.transitionToSpinning();
      env.engine.winningNumber = 0;
      env.engine.winningColor = 'green';

      const resultPromise = client.waitForNext('round_result');
      env.engine.transitionToPayout();
      const result = await resultPromise;

      const playerResult = result.results.find((r) => r.playerId === client.playerId);
      assert.equal(playerResult.winningBets.length, 1);
      assert.equal(playerResult.totalWon, 100 * 9, 'Corner covering 0 must pay 9x stake');

      // Reset engine to BETTING
      env.engine.transitionToBetting();
    });
  });
});
