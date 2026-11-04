/**
 * e2e_tier4_scenarios.test.js
 * Opaque-Box E2E Test Suite — Tier 4: Real-World Application Scenarios (>=5 realistic scenarios)
 * End-to-end full player journeys: onboarding, complex multi-bet combinations,
 * multi-round progressions, zero-pocket recovery, late-join spectating, and disconnect resilience.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, createTestClient } = require('./harness');

describe('E2E Tier 4: Real-World Application Scenarios', () => {
  let env;

  before(async () => {
    env = await startTestServer({ autoStartEngine: true });
  });

  after(async () => {
    if (env) await env.close();
  });

  // =========================================================================
  // Scenario 1: Complete High-Roller Journey
  // =========================================================================
  it('Scenario 1: Complete High-Roller Journey (onboarding -> 8-bet layout -> countdown -> win -> chat -> reset)', async () => {
    if (env.engine.currentPhase !== 'BETTING') env.engine.transitionToBetting();

    const client = createTestClient(env.url);
    await client.connect();

    // 1. Onboarding
    const state = await client.joinTable({ name: 'HighRoller', avatar: 'vip_gold', color: '#d4af37' });
    assert.equal(state.players.find((p) => p.id === client.playerId).chips, 10000);

    // 2. Placing 8 distinct bets covering inside & outside options
    const bets = [
      { type: 'straight', value: 23, amount: 1000 },
      { type: 'split', value: [23, 24], amount: 500 },
      { type: 'street', value: [22, 23, 24], amount: 500 },
      { type: 'corner', value: [19, 20, 22, 23], amount: 500 },
      { type: 'red', value: null, amount: 1000 },
      { type: 'odd', value: null, amount: 1000 },
      { type: 'column', value: 2, amount: 500 },
      { type: 'dozen', value: 2, amount: 500 }
    ];

    let totalStaked = 0;
    for (const b of bets) {
      totalStaked += b.amount;
      const res = await client.placeBet(b);
      assert.equal(res.accepted, true);
    }
    assert.equal(totalStaked, 5500);

    // Balance after betting
    const playerBeforeWin = env.playerManager.getPlayerById(client.playerId);
    assert.equal(playerBeforeWin.chips, 4500);

    // 3. Countdown & Spin
    env.engine.transitionToSpinning();
    env.engine.winningNumber = 23; // 23 is Red, Odd, Column 2, Dozen 2
    env.engine.winningColor = 'red';

    // 4. Payout evaluation
    const resultPromise = client.waitForNext('round_result');
    const winChatPromise = client.waitForNext(
      'chat_message',
      (m) => m.isSystem === true && m.text.includes('HighRoller won')
    );
    env.engine.transitionToPayout();

    const result = await resultPromise;
    const playerResult = result.results.find((r) => r.playerId === client.playerId);

    // All 8 bets won!
    // Straight 23: 1,000 * 36 = 36,000
    // Split [23, 24]: 500 * 18 = 9,000
    // Street [22, 23, 24]: 500 * 12 = 6,000
    // Corner [19, 20, 22, 23]: 500 * 9 = 4,500
    // Red: 1,000 * 2 = 2,000
    // Odd: 1,000 * 2 = 2,000
    // Column 2: 500 * 3 = 1,500
    // Dozen 2: 500 * 3 = 1,500
    // Total gross won = 62,500 chips!
    assert.equal(playerResult.winningBets.length, 8);
    assert.equal(playerResult.totalWon, 62500);
    assert.equal(playerResult.net, 62500 - 5500);
    assert.equal(playerResult.chips, 4500 + 62500);

    // 5. System chat victory announcement
    const winChat = await winChatPromise;
    assert.ok(winChat.text.includes('Round result: 23 Red'));
    assert.ok(winChat.text.includes('HighRoller won') && winChat.text.includes((62500).toLocaleString()));

    // 6. Player celebration chat
    const playerChatPromise = client.waitForNext('chat_message', (m) => m.text.includes('Drinks on me!'));
    client.sendChat('Drinks on me! Monte Carlo magic!');
    const playerChat = await playerChatPromise;
    assert.equal(playerChat.sender, 'HighRoller');

    // 7. Transition back to BETTING
    env.engine.transitionToBetting();
    assert.equal(env.engine.currentPhase, 'BETTING');
    assert.equal(env.engine.tableChipsTotal, 0);

    await client.disconnect();
  });

  // =========================================================================
  // Scenario 2: Multi-Player Competitive Session Across 3 Full Rounds
  // =========================================================================
  it('Scenario 2: Multi-Player Competitive Session Across 3 Full Consecutive Rounds', async () => {
    if (env.engine.currentPhase !== 'BETTING') env.engine.transitionToBetting();

    const alice = createTestClient(env.url);
    const bob = createTestClient(env.url);
    const charlie = createTestClient(env.url);

    await Promise.all([
      alice.connect().then(() => alice.joinTable({ name: 'Alice_S2', color: '#10b981' })),
      bob.connect().then(() => bob.joinTable({ name: 'Bob_S2', color: '#3b82f6' })),
      charlie.connect().then(() => charlie.joinTable({ name: 'Charlie_S2', color: '#ec4899' }))
    ]);

    // --- ROUND 1 ---
    await Promise.all([
      alice.placeBet({ type: 'red', value: null, amount: 1000 }),
      bob.placeBet({ type: 'black', value: null, amount: 1000 }),
      charlie.placeBet({ type: 'low', value: null, amount: 500 })
    ]);

    env.engine.transitionToSpinning();
    env.engine.winningNumber = 7; // 7 is Red, Low
    env.engine.winningColor = 'red';

    const [r1Alice, r1Bob, r1Charlie] = await Promise.all([
      alice.waitForNext('round_result'),
      bob.waitForNext('round_result'),
      charlie.waitForNext('round_result'),
      env.engine.transitionToPayout()
    ]);

    assert.equal(r1Alice.results.find((r) => r.playerId === alice.playerId).totalWon, 2000);
    assert.equal(r1Bob.results.find((r) => r.playerId === bob.playerId).totalWon, 0);
    assert.equal(r1Charlie.results.find((r) => r.playerId === charlie.playerId).totalWon, 1000);

    // --- ROUND 2 ---
    env.engine.transitionToBetting();

    await Promise.all([
      alice.placeBet({ type: 'dozen', value: 1, amount: 1000 }),
      bob.placeBet({ type: 'column', value: 1, amount: 500 }),
      bob.placeBet({ type: 'column', value: 2, amount: 500 }),
      charlie.placeBet({ type: 'straight', value: 0, amount: 1000 })
    ]);

    env.engine.transitionToSpinning();
    env.engine.winningNumber = 12; // 12 is Red, Dozen 1, Column 3
    env.engine.winningColor = 'red';

    const [r2Alice, r2Bob, r2Charlie] = await Promise.all([
      alice.waitForNext('round_result'),
      bob.waitForNext('round_result'),
      charlie.waitForNext('round_result'),
      env.engine.transitionToPayout()
    ]);

    assert.equal(r2Alice.results.find((r) => r.playerId === alice.playerId).totalWon, 3000);
    assert.equal(r2Bob.results.find((r) => r.playerId === bob.playerId).totalWon, 0);
    assert.equal(r2Charlie.results.find((r) => r.playerId === charlie.playerId).totalWon, 0);

    // --- ROUND 3 ---
    env.engine.transitionToBetting();

    // Bob places a bet, changes his mind, clears bets, and wagers on 32
    await bob.placeBet({ type: 'black', value: null, amount: 1000 });
    await bob.clearBets();
    await bob.placeBet({ type: 'straight', value: 32, amount: 500 });

    await alice.placeBet({ type: 'even', value: null, amount: 1000 });
    await charlie.placeBet({ type: 'high', value: null, amount: 1000 });

    env.engine.transitionToSpinning();
    env.engine.winningNumber = 32; // 32 is Red, Even, High
    env.engine.winningColor = 'red';

    const [r3Alice, r3Bob, r3Charlie] = await Promise.all([
      alice.waitForNext('round_result'),
      bob.waitForNext('round_result'),
      charlie.waitForNext('round_result'),
      env.engine.transitionToPayout()
    ]);

    assert.equal(r3Bob.results.find((r) => r.playerId === bob.playerId).totalWon, 500 * 36);
    assert.equal(r3Alice.results.find((r) => r.playerId === alice.playerId).totalWon, 2000);
    assert.equal(r3Charlie.results.find((r) => r.playerId === charlie.playerId).totalWon, 2000);

    // Verify history FIFO contains the 3 consecutive rounds
    assert.equal(r3Alice.history[0], 32);
    assert.equal(r3Alice.history[1], 12);
    assert.equal(r3Alice.history[2], 7);

    await Promise.all([alice.disconnect(), bob.disconnect(), charlie.disconnect()]);
    env.engine.transitionToBetting();
  });

  // =========================================================================
  // Scenario 3: Zero-Pocket House Sweep & Bankroll Recovery
  // =========================================================================
  it('Scenario 3: Zero-Pocket House Sweep, Admin Replenish, and Complete Inside 0 Recovery', async () => {
    if (env.engine.currentPhase !== 'BETTING') env.engine.transitionToBetting();

    const client = createTestClient(env.url);
    await client.connect();
    await client.joinTable({ name: 'UnluckyGamer' });

    // 1. Player places diverse outside bets
    await client.placeBet({ type: 'red', value: null, amount: 1000 });
    await client.placeBet({ type: 'black', value: null, amount: 1000 });
    await client.placeBet({ type: 'even', value: null, amount: 1000 });
    await client.placeBet({ type: 'odd', value: null, amount: 1000 });
    await client.placeBet({ type: 'low', value: null, amount: 1000 });
    await client.placeBet({ type: 'high', value: null, amount: 1000 });
    await client.placeBet({ type: 'dozen', value: 1, amount: 1000 });
    await client.placeBet({ type: 'column', value: 1, amount: 1000 });
    // Total spent: 8,000 chips. Remaining: 2,000.

    // 2. Wheel hits pocket 0 (Green)
    env.engine.transitionToSpinning();
    env.engine.winningNumber = 0;
    env.engine.winningColor = 'green';

    const r1Promise = client.waitForNext('round_result');
    env.engine.transitionToPayout();
    const r1 = await r1Promise;

    const pRes = r1.results.find((r) => r.playerId === client.playerId);
    assert.equal(pRes.totalWon, 0, 'Zero sweeps all outside bets');
    assert.equal(pRes.chips, 2000);

    // 3. Player requests replenishment via admin command /chips 8000
    const updatePromise = client.waitForNext('chips_update');
    client.sendChat('/chips 8000');
    const update = await updatePromise;
    assert.equal(update.chips, 10000);

    // 4. Next Round: Player targets inside bets covering 0
    env.engine.transitionToBetting();

    await client.placeBet({ type: 'straight', value: 0, amount: 1000 });
    await client.placeBet({ type: 'split', value: [0, 1], amount: 500 });
    await client.placeBet({ type: 'street', value: [0, 1, 2], amount: 500 });
    await client.placeBet({ type: 'corner', value: [0, 1, 2, 3], amount: 500 });
    // Total spent: 2,500. Balance remaining: 7,500.

    // 5. Wheel hits 0 again!
    env.engine.transitionToSpinning();
    env.engine.winningNumber = 0;
    env.engine.winningColor = 'green';

    const r2Promise = client.waitForNext('round_result');
    env.engine.transitionToPayout();
    const r2 = await r2Promise;

    const pRes2 = r2.results.find((r) => r.playerId === client.playerId);
    // Straight 0: 1,000 * 36 = 36,000
    // Split [0, 1]: 500 * 18 = 9,000
    // Street [0, 1, 2]: 500 * 12 = 6,000
    // Corner [0, 1, 2, 3]: 500 * 9 = 4,500
    // Total gross = 55,500
    assert.equal(pRes2.winningBets.length, 4);
    assert.equal(pRes2.totalWon, 55500);
    assert.equal(pRes2.chips, 7500 + 55500);

    await client.disconnect();
    env.engine.transitionToBetting();
  });

  // =========================================================================
  // Scenario 4: Mid-Spin Spectator Onboarding & Next-Round Transition
  // =========================================================================
  it('Scenario 4: Mid-Spin Spectator Onboarding & Next-Round Seamless Transition', async () => {
    if (env.engine.currentPhase !== 'BETTING') env.engine.transitionToBetting();

    const activePlayer = createTestClient(env.url);
    await activePlayer.connect();
    await activePlayer.joinTable({ name: 'ActiveP1' });
    await activePlayer.placeBet({ type: 'straight', value: 17, amount: 500 });

    // Transition to SPINNING
    env.engine.transitionToSpinning();

    // Late joining spectator arrives during SPINNING
    const spectator = createTestClient(env.url);
    await spectator.connect();
    const spectatorState = await spectator.joinTable({ name: 'SpectatorLate' });

    assert.equal(spectatorState.currentPhase, 'SPINNING');
    assert.ok(spectatorState.activeBets[activePlayer.playerId].length > 0);

    // Spectator attempts to bet mid-spin -> rejected
    const blockedBet = await spectator.placeBet({ type: 'red', value: null, amount: 200 });
    assert.equal(blockedBet.accepted, false);
    assert.equal(blockedBet.error.code, 'BETS_CLOSED');

    // Spectator chats while spectating
    const specChatPromise = activePlayer.waitForNext('chat_message', (m) => m.text.includes('Rooting for 17'));
    spectator.sendChat('Rooting for 17!');
    const specChat = await specChatPromise;
    assert.equal(specChat.sender, 'SpectatorLate');

    // Spin concludes
    env.engine.winningNumber = 17;
    env.engine.winningColor = 'black';

    await Promise.all([
      activePlayer.waitForNext('round_result'),
      spectator.waitForNext('round_result'),
      env.engine.transitionToPayout()
    ]);

    // Next round begins: BETTING phase opens
    const bettingPhasePromise = spectator.waitForNext('phase_change', (p) => p.phase === 'BETTING');
    env.engine.transitionToBetting();
    await bettingPhasePromise;

    // Spectator can now place bets without issues!
    const validBet = await spectator.placeBet({ type: 'straight', value: 17, amount: 300 });
    assert.equal(validBet.accepted, true);
    assert.equal(validBet.data.remainingChips, 9700);

    await Promise.all([activePlayer.disconnect(), spectator.disconnect()]);
    env.engine.transitionToBetting();
  });

  // =========================================================================
  // Scenario 5: Disconnect Resilience & Balance Synchronization Under Table Load
  // =========================================================================
  it('Scenario 5: Disconnect Resilience & Balance Synchronization Under Table Load', async () => {
    if (env.engine.currentPhase !== 'BETTING') env.engine.transitionToBetting();

    const p1 = createTestClient(env.url);
    const p2 = createTestClient(env.url);
    const p3 = createTestClient(env.url);

    await Promise.all([
      p1.connect().then(() => p1.joinTable({ name: 'StableP1' })),
      p2.connect().then(() => p2.joinTable({ name: 'DroppingP2' })),
      p3.connect().then(() => p3.joinTable({ name: 'StableP3' }))
    ]);

    const p2Id = p2.playerId;

    // All place bets
    await Promise.all([
      p1.placeBet({ type: 'red', value: null, amount: 500 }),
      p2.placeBet({ type: 'straight', value: 14, amount: 1000 }),
      p3.placeBet({ type: 'black', value: null, amount: 500 })
    ]);

    // Transition to SPINNING
    env.engine.transitionToSpinning();

    // P2 disconnects mid-spin
    const p1SawLeft = p1.waitForNext('player_left', (ev) => ev.name === 'DroppingP2');
    await p2.disconnect();
    await p1SawLeft;

    // Wheel lands on 14 (Red) -> P2's straight 14 wins!
    env.engine.winningNumber = 14;
    env.engine.winningColor = 'red';

    const [rP1, rP3] = await Promise.all([
      p1.waitForNext('round_result'),
      p3.waitForNext('round_result'),
      env.engine.transitionToPayout()
    ]);

    // P1 won 1,000 chips (500 * 2), P3 lost
    assert.equal(rP1.results.find((r) => r.playerId === p1.playerId).totalWon, 1000);
    assert.equal(rP3.results.find((r) => r.playerId === p3.playerId).totalWon, 0);

    // P2 won 36,000 chips (1,000 * 36)
    const p2Result = rP1.results.find((r) => r.playerId === p2Id);
    assert.ok(p2Result, 'P2 included in results despite disconnect');
    assert.equal(p2Result.totalWon, 36000);

    // Transition to new round
    env.engine.transitionToBetting();

    // P2 reconnects with their persistent playerId
    const p2Reconnect = createTestClient(env.url);
    await p2Reconnect.connect();
    const reconnectState = await p2Reconnect.joinTable({ id: p2Id, name: 'DroppingP2' });

    assert.equal(p2Reconnect.playerId, p2Id);
    // P2 had 10,000 - 1,000 + 36,000 = 45,000 chips
    const p2Self = reconnectState.players.find((p) => p.id === p2Id);
    assert.equal(p2Self.chips, 45000, 'Reconnected player receives exact credited balance');

    // P2 can participate in the new round
    const freshBet = await p2Reconnect.placeBet({ type: 'black', value: null, amount: 2000 });
    assert.equal(freshBet.accepted, true);
    assert.equal(freshBet.data.remainingChips, 43000);

    await Promise.all([p1.disconnect(), p3.disconnect(), p2Reconnect.disconnect()]);
    env.engine.transitionToBetting();
  });
});
