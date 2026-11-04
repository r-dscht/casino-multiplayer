/**
 * e2e_tier3_combinations.test.js
 * Opaque-Box E2E Test Suite — Tier 3: Cross-Feature Combinations (Pairwise interactions)
 * Verifies multi-player concurrency, betting + chat interleaving, mid-round disconnects,
 * conflicting bets, clear-bets isolation, and rapid-fire atomic ledger operations.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, createTestClient } = require('./harness');

describe('E2E Tier 3: Cross-Feature Combinations', () => {
  let env;

  before(async () => {
    env = await startTestServer({ autoStartEngine: true });
  });

  after(async () => {
    if (env) await env.close();
  });

  // =========================================================================
  // Combination 1: Multi-Player Concurrent Bets on the Exact Same Cell
  // =========================================================================
  it('3.1 should handle multiple players betting simultaneously on the exact same spot and pay both on win', async () => {
    if (env.engine.currentPhase !== 'BETTING') env.engine.transitionToBetting();

    const clientAlice = createTestClient(env.url);
    const clientBob = createTestClient(env.url);
    await clientAlice.connect();
    await clientAlice.joinTable({ name: 'Alice_Combo', color: '#10b981' });
    await clientBob.connect();
    await clientBob.joinTable({ name: 'Bob_Combo', color: '#3b82f6' });

    // Both bet on straight 17 simultaneously
    const [resAlice, resBob] = await Promise.all([
      clientAlice.placeBet({ type: 'straight', value: 17, amount: 500 }),
      clientBob.placeBet({ type: 'straight', value: 17, amount: 1000 })
    ]);

    assert.equal(resAlice.accepted, true);
    assert.equal(resBob.accepted, true);
    assert.equal(resAlice.data.remainingChips, 9500);
    assert.equal(resBob.data.remainingChips, 9000);

    // Spin to 17
    env.engine.transitionToSpinning();
    env.engine.winningNumber = 17;
    env.engine.winningColor = 'black';

    const [resultAlice, resultBob] = await Promise.all([
      clientAlice.waitForNext('round_result'),
      clientBob.waitForNext('round_result'),
      env.engine.transitionToPayout()
    ]);

    const aliceRes = resultAlice.results.find((r) => r.playerId === clientAlice.playerId);
    const bobRes = resultBob.results.find((r) => r.playerId === clientBob.playerId);

    assert.equal(aliceRes.totalWon, 500 * 36, 'Alice won 36x 500');
    assert.equal(bobRes.totalWon, 1000 * 36, 'Bob won 36x 1000');
    assert.equal(aliceRes.chips, 9500 + 500 * 36);
    assert.equal(bobRes.chips, 9000 + 1000 * 36);

    await clientAlice.disconnect();
    await clientBob.disconnect();
    env.engine.transitionToBetting();
  });

  // =========================================================================
  // Combination 2: Interleaved Bet Placement and Live Chat during BETTING
  // =========================================================================
  it('3.2 should seamlessly interleave live chat and bet placement events between players', async () => {
    if (env.engine.currentPhase !== 'BETTING') env.engine.transitionToBetting();

    const clientA = createTestClient(env.url);
    const clientB = createTestClient(env.url);
    await clientA.connect();
    await clientA.joinTable({ name: 'InterleaverA' });
    await clientB.connect();
    await clientB.joinTable({ name: 'InterleaverB' });

    // Set up listeners
    const bReceivedChat = clientB.waitForNext('chat_message', (m) => m.text === 'Placing 300 on red');
    const aReceivedBet = clientA.waitForNext('bet_placed', (b) => b.playerName === 'InterleaverB');

    // Player A chats
    clientA.sendChat('Placing 300 on red');
    // Player B bets
    const betRes = await clientB.placeBet({ type: 'red', value: null, amount: 300 });
    assert.equal(betRes.accepted, true);

    const chatMsg = await bReceivedChat;
    assert.equal(chatMsg.text, 'Placing 300 on red');

    const betBroadcast = await aReceivedBet;
    assert.equal(betBroadcast.bet.amount, 300);

    await clientA.disconnect();
    await clientB.disconnect();
    await env.engine.transitionToBetting();
  });

  // =========================================================================
  // Combination 3: Chatting during SPINNING and PAYOUT Phases
  // =========================================================================
  it('3.3 should allow chatting during SPINNING and PAYOUT phases while bets are locked', async () => {
    const clientA = createTestClient(env.url);
    const clientB = createTestClient(env.url);
    await clientA.connect();
    await clientA.joinTable({ name: 'PhaseChatA' });
    await clientB.connect();
    await clientB.joinTable({ name: 'PhaseChatB' });

    // Transition to SPINNING
    env.engine.transitionToSpinning();

    // Verify betting is locked
    const lockedBet = await clientA.placeBet({ type: 'black', value: null, amount: 100 });
    assert.equal(lockedBet.accepted, false);
    assert.equal(lockedBet.error.code, 'BETS_CLOSED');

    // But chat is accepted!
    const spinChatPromise = clientB.waitForNext('chat_message', (m) => m.text === 'Come on lucky 7!');
    clientA.sendChat('Come on lucky 7!');
    const spinChat = await spinChatPromise;
    assert.equal(spinChat.text, 'Come on lucky 7!');

    // Transition to PAYOUT
    env.engine.transitionToPayout();

    const payoutChatPromise = clientB.waitForNext('chat_message', (m) => m.text === 'Good game all');
    clientA.sendChat('Good game all');
    const payoutChat = await payoutChatPromise;
    assert.equal(payoutChat.text, 'Good game all');

    await clientA.disconnect();
    await clientB.disconnect();
    env.engine.transitionToBetting();
  });

  // =========================================================================
  // Combination 4: Bet Placement, Disconnect during Spin, Payout, and Reconnect
  // =========================================================================
  it('3.4 should preserve bets and resolve payout for player who disconnects during spin and restore balance upon reconnect', async () => {
    if (env.engine.currentPhase !== 'BETTING') env.engine.transitionToBetting();

    const client = createTestClient(env.url);
    await client.connect();
    await client.joinTable({ name: 'Reconnector' });
    const playerId = client.playerId;

    // Place bet on Straight 25 and Black
    await client.placeBet({ type: 'straight', value: 25, amount: 400 });
    await client.placeBet({ type: 'black', value: null, amount: 600 });
    // Chips spent: 1000. Balance remaining: 9000.

    // Transition to SPINNING
    env.engine.transitionToSpinning();
    env.engine.winningNumber = 25; // 25 is Red
    env.engine.winningColor = 'red';

    // Player abruptly disconnects mid-spin
    await client.disconnect();

    // Transition to PAYOUT
    env.engine.transitionToPayout();

    // Straight 25 wins: 400 * 36 = 14,400. Black loses: 0.
    // Expected new balance: 9,000 + 14,400 = 23,400 chips.
    const playerRecord = env.playerManager.getPlayerById(playerId);
    assert.equal(playerRecord.chips, 23400);

    // Player reconnects using the same player ID in options
    const reconnectClient = createTestClient(env.url);
    await reconnectClient.connect();
    const state = await reconnectClient.joinTable({ id: playerId, name: 'Reconnector' });

    assert.equal(reconnectClient.playerId, playerId);
    const selfInState = state.players.find((p) => p.id === playerId);
    assert.equal(selfInState.chips, 23400, 'Reconnected player observes updated bankroll');

    await reconnectClient.disconnect();
    env.engine.transitionToBetting();
  });

  // =========================================================================
  // Combination 5: Multi-Player Conflicting Bets with Zero Sweep Resolution
  // =========================================================================
  it('3.5 should resolve multi-player conflicting bets in single atomic transaction when 0 lands', async () => {
    if (env.engine.currentPhase !== 'BETTING') env.engine.transitionToBetting();

    const pRed = createTestClient(env.url);
    const pBlack = createTestClient(env.url);
    const pGreen = createTestClient(env.url);
    const pEven = createTestClient(env.url);

    await Promise.all([
      pRed.connect().then(() => pRed.joinTable({ name: 'RedPlayer' })),
      pBlack.connect().then(() => pBlack.joinTable({ name: 'BlackPlayer' })),
      pGreen.connect().then(() => pGreen.joinTable({ name: 'GreenPlayer' })),
      pEven.connect().then(() => pEven.joinTable({ name: 'EvenPlayer' }))
    ]);

    await Promise.all([
      pRed.placeBet({ type: 'red', value: null, amount: 1000 }),
      pBlack.placeBet({ type: 'black', value: null, amount: 1000 }),
      pGreen.placeBet({ type: 'straight', value: 0, amount: 500 }),
      pEven.placeBet({ type: 'even', value: null, amount: 1000 })
    ]);

    // Outcome = 0
    env.engine.transitionToSpinning();
    env.engine.winningNumber = 0;
    env.engine.winningColor = 'green';

    const [resRed, resBlack, resGreen, resEven] = await Promise.all([
      pRed.waitForNext('round_result'),
      pBlack.waitForNext('round_result'),
      pGreen.waitForNext('round_result'),
      pEven.waitForNext('round_result'),
      env.engine.transitionToPayout()
    ]);

    const rRed = resRed.results.find((r) => r.playerId === pRed.playerId);
    const rBlack = resBlack.results.find((r) => r.playerId === pBlack.playerId);
    const rGreen = resGreen.results.find((r) => r.playerId === pGreen.playerId);
    const rEven = resEven.results.find((r) => r.playerId === pEven.playerId);

    assert.equal(rRed.totalWon, 0, 'Red loses on 0');
    assert.equal(rBlack.totalWon, 0, 'Black loses on 0');
    assert.equal(rEven.totalWon, 0, 'Even loses on 0');
    assert.equal(rGreen.totalWon, 500 * 36, 'Green Straight 0 wins 18,000 chips');

    await Promise.all([
      pRed.disconnect(),
      pBlack.disconnect(),
      pGreen.disconnect(),
      pEven.disconnect()
    ]);
    env.engine.transitionToBetting();
  });

  // =========================================================================
  // Combination 6: Clear Bets by One Player while Concurrent Player Keeps Bets
  // =========================================================================
  it('3.6 should allow one player to clear bets without affecting concurrent players on table', async () => {
    if (env.engine.currentPhase !== 'BETTING') env.engine.transitionToBetting();

    const client1 = createTestClient(env.url);
    const client2 = createTestClient(env.url);
    await client1.connect();
    await client1.joinTable({ name: 'Clearer' });
    await client2.connect();
    await client2.joinTable({ name: 'Keeper' });

    await client1.placeBet({ type: 'straight', value: 10, amount: 1000 });
    await client2.placeBet({ type: 'black', value: null, amount: 2000 });

    const totalBefore = env.engine.tableChipsTotal;
    assert.ok(totalBefore >= 3000);

    // Player 1 clears bets
    const clearRes = await client1.clearBets();
    assert.equal(clearRes.cleared, true);
    assert.equal(clearRes.chips, 10000);

    // Player 2's bets in engine must remain intact
    assert.equal(env.engine.bets.has(client1.playerId), false, 'Player 1 bets removed');
    assert.equal(env.engine.bets.has(client2.playerId), true, 'Player 2 bets preserved');
    assert.equal(env.engine.bets.get(client2.playerId)[0].amount, 2000);

    await client1.disconnect();
    await client2.disconnect();
    env.engine.transitionToBetting();
  });

  // =========================================================================
  // Combination 7: Admin /spin Command Interrupting BETTING Countdown
  // =========================================================================
  it('3.7 should immediately end BETTING countdown when /spin command is executed', async () => {
    if (env.engine.currentPhase !== 'BETTING') env.engine.transitionToBetting();

    const clientAdmin = createTestClient(env.url);
    const clientRegular = createTestClient(env.url);
    await clientAdmin.connect();
    await clientAdmin.joinTable({ name: 'AdminTester' });
    await clientRegular.connect();
    await clientRegular.joinTable({ name: 'RegularTester' });

    const phasePromise = clientRegular.waitForNext('phase_change', (p) => p.phase === 'SPINNING');

    // Admin sends /spin in chat
    clientAdmin.sendChat('/spin');

    const phase = await phasePromise;
    assert.equal(phase.phase, 'SPINNING');
    assert.equal(env.engine.currentPhase, 'SPINNING');

    // Subsequent bet by regular player is rejected
    const lateBet = await clientRegular.placeBet({ type: 'straight', value: 12, amount: 100 });
    assert.equal(lateBet.accepted, false);
    assert.equal(lateBet.error.code, 'BETS_CLOSED');

    await clientAdmin.disconnect();
    await clientRegular.disconnect();
    env.engine.transitionToBetting();
  });

  // =========================================================================
  // Combination 8: High Concurrency Rapid-Fire Bets from Single Client
  // =========================================================================
  it('3.8 should atomically process rapid-fire concurrent bets from single client without balance corruption', async () => {
    if (env.engine.currentPhase !== 'BETTING') env.engine.transitionToBetting();

    const client = createTestClient(env.url);
    await client.connect();
    await client.joinTable({ name: 'RapidShooter' });

    // Send 10 parallel bets of 300 chips each (total 3,000 chips)
    const bets = Array.from({ length: 10 }, (_, i) => ({
      type: 'straight',
      value: i + 1,
      amount: 300
    }));

    const results = await Promise.all(bets.map((b) => client.placeBet(b)));
    for (const r of results) {
      assert.equal(r.accepted, true, 'Each rapid-fire bet accepted');
    }

    const player = env.playerManager.getPlayerById(client.playerId);
    assert.equal(player.chips, 7000, 'Bankroll must be exactly 7,000 after 10x 300 chips');
    assert.equal(env.engine.bets.get(client.playerId).length, 10);

    await client.clearBets();
    assert.equal(env.playerManager.getPlayerById(client.playerId).chips, 10000);

    await client.disconnect();
  });

  // =========================================================================
  // Combination 9: Bankroll Replenishment via /chips Admin Command
  // =========================================================================
  it('3.9 should replenish player chips via /chips <amount> command and allow immediate wagering', async () => {
    const client = createTestClient(env.url);
    await client.connect();
    await client.joinTable({ name: 'ReloadUser' });

    const updatePromise = client.waitForNext('chips_update');
    client.sendChat('/chips 5000');
    const update = await updatePromise;

    assert.equal(update.chips, 15000, 'Chips updated to 15,000');
    const player = env.playerManager.getPlayerById(client.playerId);
    assert.equal(player.chips, 15000);

    // Can immediately wager with expanded balance
    const bigBet = await client.placeBet({ type: 'straight', value: 8, amount: 12000 });
    assert.equal(bigBet.accepted, true);
    assert.equal(bigBet.data.remainingChips, 3000);

    await client.clearBets();
    await client.disconnect();
  });
});
