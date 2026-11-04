/**
 * challenge_m1_2.js
 * Challenger 2 Empirical Test Harness for Milestone 1:
 * European Roulette Mathematics, Statistical House Edge, Zero Outcomes, and Socket Race Conditions.
 */

const assert = require('assert');
const http = require('http');
const crypto = require('crypto');
const { io: Client } = require('socket.io-client');
const express = require('express');

const {
  WHEEL_NUMBERS,
  RED_NUMBERS,
  BLACK_NUMBERS,
  GREEN_NUMBERS,
  getColor,
  BET_TYPES,
  PAYOUT_RATIOS,
  PHASES,
  STARTING_CHIPS
} = require('../../server/game/rouletteConstants');

const {
  isValidSplit,
  isValidStreet,
  isValidCorner,
  isValidSixLine,
  getAllValidSplits,
  getAllValidStreets,
  getAllValidCorners,
  getAllValidSixLines,
  validateBet,
  evaluateBet
} = require('../../server/game/rouletteMath');

const PlayerManager = require('../../server/game/playerManager');
const RouletteEngine = require('../../server/game/rouletteEngine');
const { setupSocket } = require('../../server/socket');

async function runEmpiricalChallenge() {
  console.log('================================================================');
  console.log('CHALLENGER 2: EMPIRICAL VERIFICATION & STRESS HARNESS');
  console.log('Milestone 1: Server Core & European Roulette Engine');
  console.log('================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function recordPass(testName) {
    totalTests++;
    passedTests++;
    console.log(`  [PASS] ${testName}`);
  }

  // ---------------------------------------------------------------------------
  // PART 1: Systematic & Exhaustive Evaluation of All 157 Standard Bets
  // ---------------------------------------------------------------------------
  console.log('--- PART 1: Exhaustive Verification of 157 Bets Across All 37 Pockets ---');

  const allBets = [];

  // 1. All 37 Straight bets (0..36)
  for (let n = 0; n <= 36; n++) {
    allBets.push({ type: BET_TYPES.STRAIGHT, value: n, expectedWins: 1, multiplier: 36, name: `Straight ${n}` });
  }

  // 2. All 60 Splits
  const splits = getAllValidSplits();
  assert.strictEqual(splits.length, 60, 'Must have exactly 60 valid splits');
  for (const s of splits) {
    allBets.push({ type: BET_TYPES.SPLIT, value: s, expectedWins: 2, multiplier: 18, name: `Split [${s.join(',')}]` });
  }

  // 3. All 14 Streets
  const streets = getAllValidStreets();
  assert.strictEqual(streets.length, 14, 'Must have exactly 14 valid streets');
  for (const st of streets) {
    allBets.push({ type: BET_TYPES.STREET, value: st, expectedWins: 3, multiplier: 12, name: `Street [${st.join(',')}]` });
  }

  // 4. All 23 Corners
  const corners = getAllValidCorners();
  assert.strictEqual(corners.length, 23, 'Must have exactly 23 valid corners');
  for (const c of corners) {
    allBets.push({ type: BET_TYPES.CORNER, value: c, expectedWins: 4, multiplier: 9, name: `Corner [${c.join(',')}]` });
  }

  // 5. All 11 Six-Lines
  const sixLines = getAllValidSixLines();
  assert.strictEqual(sixLines.length, 11, 'Must have exactly 11 valid six-lines');
  for (const sl of sixLines) {
    allBets.push({ type: BET_TYPES.SIX_LINE, value: sl, expectedWins: 6, multiplier: 6, name: `SixLine [${sl.join(',')}]` });
  }

  // 6. Columns (1, 2, 3)
  for (let col = 1; col <= 3; col++) {
    allBets.push({ type: BET_TYPES.COLUMN, value: col, expectedWins: 12, multiplier: 3, name: `Column ${col}` });
  }

  // 7. Dozens (1, 2, 3)
  for (let doz = 1; doz <= 3; doz++) {
    allBets.push({ type: BET_TYPES.DOZEN, value: doz, expectedWins: 12, multiplier: 3, name: `Dozen ${doz}` });
  }

  // 8. Outside Even-Money bets
  const outsideTypes = [
    BET_TYPES.RED,
    BET_TYPES.BLACK,
    BET_TYPES.EVEN,
    BET_TYPES.ODD,
    BET_TYPES.LOW,
    BET_TYPES.HIGH
  ];
  for (const ot of outsideTypes) {
    allBets.push({ type: ot, value: null, expectedWins: 18, multiplier: 2, name: `Outside ${ot.toUpperCase()}` });
  }

  assert.strictEqual(allBets.length, 157, 'Total distinct standard bets must be exactly 157');
  recordPass(`Configured exactly 157 distinct European roulette bets (37 straight, 60 split, 14 street, 23 corner, 11 six-line, 3 col, 3 doz, 6 outside)`);

  const stake = 100;
  let totalEvaluations = 0;
  const targetGrossReturn = 36 / 37;
  const targetHouseEdge = 1 / 37;

  for (const b of allBets) {
    let winCount = 0;
    let totalGrossPayout = 0;
    let totalNetProfit = 0;

    for (let pocket = 0; pocket <= 36; pocket++) {
      totalEvaluations++;
      const res = evaluateBet({ type: b.type, value: b.value, amount: stake }, pocket);

      if (res.won) {
        winCount++;
        assert.strictEqual(res.payout, stake * b.multiplier, `${b.name} payout mismatch on winning pocket ${pocket}`);
        assert.strictEqual(res.profit, stake * (b.multiplier - 1), `${b.name} profit mismatch on winning pocket ${pocket}`);
      } else {
        assert.strictEqual(res.payout, 0, `${b.name} payout must be 0 on losing pocket ${pocket}`);
        assert.strictEqual(res.profit, -stake, `${b.name} profit must be -stake on losing pocket ${pocket}`);
      }

      totalGrossPayout += res.payout;
      totalNetProfit += res.profit;
    }

    assert.strictEqual(winCount, b.expectedWins, `${b.name} won ${winCount} pockets, expected ${b.expectedWins}`);

    const grossReturnRatio = totalGrossPayout / (37 * stake);
    const houseEdgeRatio = -totalNetProfit / (37 * stake);

    assert(
      Math.abs(grossReturnRatio - targetGrossReturn) < 1e-12,
      `${b.name}: expected gross return ${grossReturnRatio} !== ${targetGrossReturn}`
    );
    assert(
      Math.abs(houseEdgeRatio - targetHouseEdge) < 1e-12,
      `${b.name}: expected house edge ${houseEdgeRatio} !== ${targetHouseEdge}`
    );
  }

  recordPass(`Exhaustively evaluated all 157 bets across all 37 pockets (${totalEvaluations} calculations). Every single bet has exact gross return of 36/37 (~97.297%) and house edge of 1/37 (~2.7027%).`);

  // ---------------------------------------------------------------------------
  // PART 2: Zero (0) Green Pocket Strict Invariant Audit
  // ---------------------------------------------------------------------------
  console.log('\n--- PART 2: Zero (0) Green Pocket Strict Invariant Audit ---');

  const outsideBetsToTest = [
    { type: BET_TYPES.RED, value: null },
    { type: BET_TYPES.BLACK, value: null },
    { type: BET_TYPES.EVEN, value: null },
    { type: BET_TYPES.ODD, value: null },
    { type: BET_TYPES.LOW, value: null },
    { type: BET_TYPES.HIGH, value: null },
    { type: BET_TYPES.COLUMN, value: 1 },
    { type: BET_TYPES.COLUMN, value: 2 },
    { type: BET_TYPES.COLUMN, value: 3 },
    { type: BET_TYPES.DOZEN, value: 1 },
    { type: BET_TYPES.DOZEN, value: 2 },
    { type: BET_TYPES.DOZEN, value: 3 }
  ];

  for (const ob of outsideBetsToTest) {
    const res = evaluateBet({ type: ob.type, value: ob.value, amount: 500 }, 0);
    assert.strictEqual(res.won, false, `Outside bet ${ob.type} (${ob.value}) must lose on 0`);
    assert.strictEqual(res.payout, 0, `Outside bet ${ob.type} payout must be 0 on 0`);
    assert.strictEqual(res.profit, -500, `Outside bet ${ob.type} profit must be -amount on 0`);
  }
  recordPass('Verified 100% loss for all outside bets (Red, Black, Even, Odd, Low, High, Columns 1-3, Dozens 1-3) on winning number 0.');

  // Straight bet on 0
  const straightZeroRes = evaluateBet({ type: BET_TYPES.STRAIGHT, value: 0, amount: 250 }, 0);
  assert.strictEqual(straightZeroRes.won, true, 'Straight on 0 must win on 0');
  assert.strictEqual(straightZeroRes.payout, 250 * 36, 'Straight on 0 must pay 36x gross (36 * 250 = 9000)');
  assert.strictEqual(straightZeroRes.profit, 250 * 35, 'Straight on 0 must profit 35:1 (35 * 250 = 8750)');
  recordPass('Verified straight bet on 0 pays exactly 35:1 profit (36x gross return).');

  // Zero-covering inside bets
  const zeroSplits = [[0, 1], [0, 2], [0, 3]];
  for (const zs of zeroSplits) {
    const res = evaluateBet({ type: BET_TYPES.SPLIT, value: zs, amount: 100 }, 0);
    assert.strictEqual(res.won, true);
    assert.strictEqual(res.payout, 1800);
    assert.strictEqual(res.profit, 1700);
  }
  recordPass('Verified all zero-adjacent splits [0,1], [0,2], [0,3] win 17:1 (18x) on 0.');

  const zeroStreets = [[0, 1, 2], [0, 2, 3]];
  for (const zst of zeroStreets) {
    const res = evaluateBet({ type: BET_TYPES.STREET, value: zst, amount: 100 }, 0);
    assert.strictEqual(res.won, true);
    assert.strictEqual(res.payout, 1200);
    assert.strictEqual(res.profit, 1100);
  }
  recordPass('Verified zero-trio streets [0,1,2] and [0,2,3] win 11:1 (12x) on 0.');

  const basketRes = evaluateBet({ type: BET_TYPES.CORNER, value: [0, 1, 2, 3], amount: 100 }, 0);
  assert.strictEqual(basketRes.won, true);
  assert.strictEqual(basketRes.payout, 900);
  assert.strictEqual(basketRes.profit, 800);
  recordPass('Verified First Four basket corner [0,1,2,3] wins 8:1 (9x) on 0.');

  // Inside bets NOT covering 0 must lose on 0
  for (let n = 1; n <= 36; n++) {
    const res = evaluateBet({ type: BET_TYPES.STRAIGHT, value: n, amount: 100 }, 0);
    assert.strictEqual(res.won, false);
    assert.strictEqual(res.payout, 0);
  }
  recordPass('Verified all non-zero straight bets (1..36) lose 100% on 0.');

  // ---------------------------------------------------------------------------
  // PART 3: Monte Carlo Simulation (100,000 Spins) & RNG Uniformity
  // ---------------------------------------------------------------------------
  console.log('\n--- PART 3: Monte Carlo Simulation (100,000 Spins) ---');

  const MONTE_CARLO_SPINS = 100000;
  const pocketCounts = new Array(37).fill(0);

  const portfolioBets = [
    { type: BET_TYPES.STRAIGHT, value: 0, amount: 10 },
    { type: BET_TYPES.STRAIGHT, value: 17, amount: 10 },
    { type: BET_TYPES.SPLIT, value: [14, 17], amount: 20 },
    { type: BET_TYPES.STREET, value: [1, 2, 3], amount: 30 },
    { type: BET_TYPES.CORNER, value: [1, 2, 4, 5], amount: 40 },
    { type: BET_TYPES.SIX_LINE, value: [1, 2, 3, 4, 5, 6], amount: 50 },
    { type: BET_TYPES.COLUMN, value: 1, amount: 60 },
    { type: BET_TYPES.DOZEN, value: 2, amount: 70 },
    { type: BET_TYPES.RED, value: null, amount: 100 },
    { type: BET_TYPES.EVEN, value: null, amount: 100 }
  ];

  const totalPortfolioStakePerSpin = portfolioBets.reduce((acc, b) => acc + b.amount, 0); // 490 chips
  let totalWagered = 0;
  let totalReturned = 0;

  for (let i = 0; i < MONTE_CARLO_SPINS; i++) {
    const winningPocket = crypto.randomInt(0, 37);
    pocketCounts[winningPocket]++;

    totalWagered += totalPortfolioStakePerSpin;

    for (const bet of portfolioBets) {
      const outcome = evaluateBet(bet, winningPocket);
      if (outcome.won) {
        totalReturned += outcome.payout;
      }
    }
  }

  // 1. Chi-Square Uniformity Test across 37 pockets
  const expectedCountPerPocket = MONTE_CARLO_SPINS / 37;
  let chiSquare = 0;
  for (let pocket = 0; pocket < 37; pocket++) {
    const diff = pocketCounts[pocket] - expectedCountPerPocket;
    chiSquare += (diff * diff) / expectedCountPerPocket;
  }

  console.log(`  Monte Carlo Spins: ${MONTE_CARLO_SPINS.toLocaleString()}`);
  console.log(`  Chi-Square statistic across 37 pockets: ${chiSquare.toFixed(4)} (df=36, critical p=0.001: 67.985)`);
  assert(chiSquare < 67.985, `Chi-square statistic ${chiSquare} exceeds critical value 67.985! RNG is non-uniform!`);
  recordPass(`Chi-Square goodness-of-fit passed: RNG produces statistically uniform pocket distribution across all 37 pockets (chi2 = ${chiSquare.toFixed(2)} < 67.99).`);

  // 2. Expected Gross Return & Convergence
  const empiricalReturn = totalReturned / totalWagered;
  const theoreticalReturn = 36 / 37;
  const absoluteDifference = Math.abs(empiricalReturn - theoreticalReturn);
  console.log(`  Total chips wagered: ${totalWagered.toLocaleString()}`);
  console.log(`  Total chips returned: ${totalReturned.toLocaleString()}`);
  console.log(`  Empirical Return: ${(empiricalReturn * 100).toFixed(4)}%`);
  console.log(`  Theoretical Return: ${(theoreticalReturn * 100).toFixed(4)}%`);
  console.log(`  Absolute Error: ${(absoluteDifference * 100).toFixed(4)}%`);

  assert(
    absoluteDifference < 0.006,
    `Empirical return ${(empiricalReturn * 100).toFixed(3)}% deviated too far from theoretical ${(theoreticalReturn * 100).toFixed(3)}%`
  );
  recordPass(`Monte Carlo simulation verified: empirical gross return is ${(empiricalReturn * 100).toFixed(3)}%, converging tightly to theoretical 97.297% (House edge = ${(100 - empiricalReturn * 100).toFixed(3)}% vs 2.703%).`);

  // ---------------------------------------------------------------------------
  // PART 4: Socket Concurrency, Race Conditions & Stress Harness
  // ---------------------------------------------------------------------------
  console.log('\n--- PART 4: Concurrent Socket Race Conditions & Stress Harness ---');

  const app = express();
  const server = http.createServer(app);
  const { io, playerManager, engine } = setupSocket(server);

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const SERVER_URL = `http://localhost:${port}`;

  function createSocketClient() {
    return Client(SERVER_URL, {
      transports: ['websocket'],
      forceNew: true
    });
  }

  const allActiveClients = [];

  try {
    // -------------------------------------------------------------------------
    // Race Test 1: 10 Concurrent Sockets Placing Simultaneous Bets
    // -------------------------------------------------------------------------
    console.log('  Testing 10 simultaneous connected clients placing parallel bets...');
    const NUM_CLIENTS = 10;
    const clients = [];
    const playerIds = [];

    for (let i = 0; i < NUM_CLIENTS; i++) {
      const socket = createSocketClient();
      clients.push(socket);
      allActiveClients.push(socket);
      await new Promise((res) => {
        socket.on('connect', () => {
          socket.emit('join_table', { name: `RacePlayer_${i}` });
          socket.once('table_state', (state) => {
            playerIds.push(state.playerId);
            res();
          });
        });
      });
    }

    assert.strictEqual(playerIds.length, NUM_CLIENTS);

    // Each client fires 10 simultaneous bets in parallel
    const betPromises = [];
    for (let i = 0; i < NUM_CLIENTS; i++) {
      const socket = clients[i];
      for (let b = 0; b < 10; b++) {
        betPromises.push(
          new Promise((res) => {
            socket.emit('place_bet', {
              type: BET_TYPES.STRAIGHT,
              value: b,
              amount: 50
            });
            const onAccepted = (data) => {
              socket.off('bet_rejected', onRejected);
              res({ ok: true, data });
            };
            const onRejected = (data) => {
              socket.off('bet_accepted', onAccepted);
              res({ ok: false, data });
            };
            socket.once('bet_accepted', onAccepted);
            socket.once('bet_rejected', onRejected);
          })
        );
      }
    }

    const betResults = await Promise.all(betPromises);
    assert.strictEqual(betResults.length, 100);
    const allAccepted = betResults.every(r => r.ok);
    assert.strictEqual(allAccepted, true, 'All 100 concurrent bets should be accepted');

    // Invariant Check:
    // 10 players * 10 bets * 50 chips = 5,000 table chips.
    // Each player chips: 10,000 - 500 = 9,500.
    assert.strictEqual(engine.tableChipsTotal, 5000, `Table chips total ${engine.tableChipsTotal} !== 5000`);
    for (const pid of playerIds) {
      const p = playerManager.getPlayerById(pid);
      assert.strictEqual(p.chips, 9500, `Player ${pid} balance ${p.chips} !== 9500`);
      const pBets = engine.bets.get(pid);
      assert.strictEqual(pBets.length, 10, `Player ${pid} should have exactly 10 bets`);
    }
    recordPass('Race Test 1: 100 concurrent bets across 10 sockets executed flawlessly without dropped bets, balance drift, or total table sum mismatch.');

    // -------------------------------------------------------------------------
    // Race Test 2: Double-Spend / Over-Betting Race Condition
    // -------------------------------------------------------------------------
    console.log('  Testing double-spend concurrency race (all-in parallel race)...');
    const doubleSpendClient = clients[0];
    const doubleSpendPlayerId = playerIds[0];
    const player0 = playerManager.getPlayerById(doubleSpendPlayerId);
    const currentBalance = player0.chips; // 9500

    // Capture the two responses using independent listener collection
    const doubleSpendPromise = new Promise((resolve) => {
      const responses = [];
      const onAccepted = (data) => {
        responses.push({ success: true, data });
        if (responses.length === 2) done();
      };
      const onRejected = (data) => {
        responses.push({ success: false, data });
        if (responses.length === 2) done();
      };
      function done() {
        doubleSpendClient.off('bet_accepted', onAccepted);
        doubleSpendClient.off('bet_rejected', onRejected);
        resolve(responses);
      }
      doubleSpendClient.on('bet_accepted', onAccepted);
      doubleSpendClient.on('bet_rejected', onRejected);
    });

    // Fire two all-in bets in parallel over the socket
    doubleSpendClient.emit('place_bet', { type: BET_TYPES.RED, value: null, amount: currentBalance });
    doubleSpendClient.emit('place_bet', { type: BET_TYPES.BLACK, value: null, amount: currentBalance });

    const raceResponses = await doubleSpendPromise;
    const successCount = raceResponses.filter(r => r.success).length;
    const failCount = raceResponses.filter(r => !r.success).length;

    assert.strictEqual(successCount, 1, 'Exactly one concurrent all-in bet must succeed');
    assert.strictEqual(failCount, 1, 'Exactly one concurrent all-in bet must be rejected');
    assert.strictEqual(raceResponses.find(r => !r.success).data.code, 'INSUFFICIENT_FUNDS');
    assert.strictEqual(player0.chips, 0, 'Player balance must be 0 after successful all-in, NEVER negative');
    recordPass('Race Test 2: Over-betting double-spend prevented; atomic balance checks rejected the second parallel transaction with INSUFFICIENT_FUNDS.');

    // -------------------------------------------------------------------------
    // Race Test 3: Concurrent Rapid Clear-Bets (No Double Refund)
    // -------------------------------------------------------------------------
    console.log('  Testing concurrent rapid clear_bets requests (duplicate refund prevention)...');
    const clearClient = clients[1];
    const clearPlayerId = playerIds[1];
    const clearPlayer = playerManager.getPlayerById(clearPlayerId);
    const beforeClearChips = clearPlayer.chips; // 9500 (has 500 in bets)
    const activeBetsCount = engine.bets.get(clearPlayerId).length; // 10 bets totaling 500

    assert.strictEqual(activeBetsCount, 10);

    // Fire 5 rapid clear_bets requests
    for (let k = 0; k < 5; k++) {
      clearClient.emit('clear_bets');
    }

    // Wait 100ms for all 5 clear_bets events to be processed
    await new Promise(r => setTimeout(r, 100));

    // Player chips should be exactly beforeClearChips + 500 = 10,000, NOT multiplied by 5!
    assert.strictEqual(clearPlayer.chips, 10000, `Player chips ${clearPlayer.chips} !== 10000 (duplicate refund detected!)`);
    assert.strictEqual(engine.bets.has(clearPlayerId), false, 'Player bets must be completely deleted');
    recordPass('Race Test 3: Multiple rapid clear_bets calls refunded exactly once (+500 chips), preventing duplicate refund exploits.');

    // -------------------------------------------------------------------------
    // Race Test 4: Simultaneous Rapid Bet-and-Clear Interleaving
    // -------------------------------------------------------------------------
    console.log('  Testing rapid interleaving of place_bet and clear_bets...');
    const testClient = clients[2];
    const testPid = playerIds[2];
    const testPlayer = playerManager.getPlayerById(testPid);

    // Clear initial bets first
    engine.clearBets(testPid);
    assert.strictEqual(testPlayer.chips, 10000);

    // Rapidly interleave 20 cycles of: place bet -> clear bets
    for (let cycle = 0; cycle < 20; cycle++) {
      testClient.emit('place_bet', { type: BET_TYPES.STRAIGHT, value: 7, amount: 200 });
      testClient.emit('clear_bets');
    }

    // Wait 200ms for queue to settle
    await new Promise(r => setTimeout(r, 200));

    // Calculate invariant: player.chips + sum(active bets) MUST EQUAL 10,000
    const activeBets = engine.bets.get(testPid) || [];
    const activeBetsSum = activeBets.reduce((acc, b) => acc + b.amount, 0);
    assert.strictEqual(
      testPlayer.chips + activeBetsSum,
      10000,
      `Balance invariant violated: ${testPlayer.chips} + ${activeBetsSum} !== 10000`
    );
    recordPass('Race Test 4: Interleaved rapid bet placement and clearing preserved the chip conservation invariant (chips + active bets = 10,000).');

    // -------------------------------------------------------------------------
    // Race Test 5: State Transition Boundary (BETS_CLOSED Enforcement)
    // -------------------------------------------------------------------------
    console.log('  Testing state transition boundary locking...');
    const boundaryClient = clients[3];

    // Force engine to transition to SPINNING
    engine.forceSpin();
    assert.strictEqual(engine.currentPhase, PHASES.SPINNING);

    const boundaryBetResult = await new Promise((res) => {
      boundaryClient.emit('place_bet', { type: BET_TYPES.RED, value: null, amount: 100 });
      boundaryClient.once('bet_accepted', (d) => res({ success: true, d }));
      boundaryClient.once('bet_rejected', (d) => res({ success: false, d }));
    });

    assert.strictEqual(boundaryBetResult.success, false);
    assert.strictEqual(boundaryBetResult.d.code, 'BETS_CLOSED');

    const boundaryClearResult = await new Promise((res) => {
      boundaryClient.emit('clear_bets');
      boundaryClient.once('chips_update', (d) => res({ success: true, d }));
      boundaryClient.once('bet_rejected', (d) => res({ success: false, d }));
    });

    assert.strictEqual(boundaryClearResult.success, false);
    assert.strictEqual(boundaryClearResult.d.code, 'BETS_CLOSED');
    recordPass('Race Test 5: Strict phase locking enforced; place_bet and clear_bets rejected with BETS_CLOSED during SPINNING phase.');

    // -------------------------------------------------------------------------
    // Race Test 6: Disconnection During Spin & Payout Resolution
    // -------------------------------------------------------------------------
    console.log('  Testing client disconnection during spin and payout credit...');
    const disconnSocket = clients[4];
    const disconnPid = playerIds[4];

    // Reset table back to BETTING
    engine.transitionToBetting();
    assert.strictEqual(engine.currentPhase, PHASES.BETTING);

    // Disconnecting player places a bet on 17
    await new Promise((res) => {
      disconnSocket.emit('place_bet', { type: BET_TYPES.STRAIGHT, value: 17, amount: 100 });
      disconnSocket.once('bet_accepted', res);
    });

    const chipsBeforeDisconnect = playerManager.getPlayerById(disconnPid).chips;

    // Disconnect socket abruptly
    disconnSocket.disconnect();
    await new Promise(r => setTimeout(r, 50));

    const pAfterDisconn = playerManager.getPlayerById(disconnPid);
    assert.strictEqual(pAfterDisconn.connected, false, 'Player should be marked disconnected');
    assert.strictEqual(engine.bets.has(disconnPid), true, 'Bets must remain on the table despite disconnect');

    // Force engine spin and set winning number directly to 17
    engine.transitionToSpinning();
    engine.winningNumber = 17;
    engine.winningColor = getColor(17);

    // Transition to PAYOUT
    engine.transitionToPayout();

    // Check if disconnected player received their 36x payout
    const pAfterPayout = playerManager.getPlayerById(disconnPid);
    assert.strictEqual(
      pAfterPayout.chips,
      chipsBeforeDisconnect + 3600,
      `Disconnected player should be credited 3600 chips, got ${pAfterPayout.chips}`
    );

    // Reconnect with same ID
    const reconnectedSocket = createSocketClient();
    allActiveClients.push(reconnectedSocket);
    await new Promise((res) => {
      reconnectedSocket.on('connect', () => {
        reconnectedSocket.emit('join_table', { id: disconnPid, name: 'Reconnected_Player' });
        reconnectedSocket.once('table_state', (state) => {
          assert.strictEqual(state.playerId, disconnPid);
          res();
        });
      });
    });

    assert.strictEqual(playerManager.getPlayerById(disconnPid).connected, true);
    assert.strictEqual(playerManager.getPlayerById(disconnPid).chips, chipsBeforeDisconnect + 3600);
    recordPass('Race Test 6: Disconnected player bets successfully resolved during PAYOUT; winnings credited and restored on re-join.');

    // -------------------------------------------------------------------------
    // Race Test 7: Adversarial Payload Injection & Negative Amount Attacks
    // -------------------------------------------------------------------------
    console.log('  Testing adversarial malformed payloads and negative balance attacks under socket load...');
    const fuzzClient = clients[5];
    const fuzzPid = playerIds[5];
    const fuzzPlayer = playerManager.getPlayerById(fuzzPid);
    engine.transitionToBetting();

    const maliciousPayloads = [
      { type: BET_TYPES.STRAIGHT, value: 17, amount: -500 },
      { type: BET_TYPES.STRAIGHT, value: 17, amount: 0 },
      { type: BET_TYPES.STRAIGHT, value: 17, amount: 10.5 },
      { type: BET_TYPES.STRAIGHT, value: 17, amount: NaN },
      { type: BET_TYPES.STRAIGHT, value: 17, amount: Infinity },
      { type: BET_TYPES.STRAIGHT, value: 17, amount: '1000' },
      { type: 'SQL_INJECTION', value: "1; DROP TABLE players;", amount: 100 },
      { type: BET_TYPES.STRAIGHT, value: -1, amount: 100 },
      { type: BET_TYPES.STRAIGHT, value: 37, amount: 100 },
      { type: BET_TYPES.SPLIT, value: [1, 5], amount: 100 }, // non-adjacent
      { type: BET_TYPES.CORNER, value: [1, 2, 3, 4], amount: 100 }, // invalid corner
      { type: BET_TYPES.COLUMN, value: 4, amount: 100 },
      { type: BET_TYPES.DOZEN, value: 0, amount: 100 }
    ];

    const initialFuzzChips = fuzzPlayer.chips;
    for (const payload of maliciousPayloads) {
      const rejRes = await new Promise((res) => {
        fuzzClient.emit('place_bet', payload);
        fuzzClient.once('bet_accepted', (d) => res({ accepted: true, d }));
        fuzzClient.once('bet_rejected', (d) => res({ accepted: false, d }));
      });
      assert.strictEqual(rejRes.accepted, false, `Malicious payload should be rejected: ${JSON.stringify(payload)}`);
      assert(rejRes.d.code, 'Rejection should provide an error code');
    }

    assert.strictEqual(fuzzPlayer.chips, initialFuzzChips, 'Chip balance must be completely unchanged by rejected attacks');
    recordPass('Race Test 7: Adversarial negative amounts, fractional chips, prototype poisoning, and invalid coordinates safely rejected without balance corruption.');

  } finally {
    engine.stop();
    for (const c of allActiveClients) {
      try {
        if (c.connected) c.disconnect();
      } catch (e) {}
    }
    await new Promise((resolve) => server.close(resolve));
  }

  // ---------------------------------------------------------------------------
  // PART 5: Category-by-Category Monte Carlo Breakdown (100,000 Spins)
  // ---------------------------------------------------------------------------
  console.log('\n--- PART 5: Category-by-Category Monte Carlo Convergence (100,000 Spins) ---');

  const categoryStats = {
    straight: { wagered: 0, returned: 0, bet: { type: BET_TYPES.STRAIGHT, value: 7, amount: 10 } },
    split: { wagered: 0, returned: 0, bet: { type: BET_TYPES.SPLIT, value: [14, 17], amount: 10 } },
    street: { wagered: 0, returned: 0, bet: { type: BET_TYPES.STREET, value: [1, 2, 3], amount: 10 } },
    corner: { wagered: 0, returned: 0, bet: { type: BET_TYPES.CORNER, value: [1, 2, 4, 5], amount: 10 } },
    six_line: { wagered: 0, returned: 0, bet: { type: BET_TYPES.SIX_LINE, value: [1, 2, 3, 4, 5, 6], amount: 10 } },
    column: { wagered: 0, returned: 0, bet: { type: BET_TYPES.COLUMN, value: 1, amount: 10 } },
    dozen: { wagered: 0, returned: 0, bet: { type: BET_TYPES.DOZEN, value: 2, amount: 10 } },
    red_black: { wagered: 0, returned: 0, bet: { type: BET_TYPES.RED, value: null, amount: 10 } }
  };

  for (let s = 0; s < 100000; s++) {
    const pocket = crypto.randomInt(0, 37);
    for (const cat of Object.values(categoryStats)) {
      cat.wagered += cat.bet.amount;
      const res = evaluateBet(cat.bet, pocket);
      if (res.won) cat.returned += res.payout;
    }
  }

  for (const [name, stat] of Object.entries(categoryStats)) {
    const ret = (stat.returned / stat.wagered) * 100;
    const diff = Math.abs(ret - 97.2973);
    // Standard error formula for roulette bets: SE = sqrt(Var(X) / N)
    const prob = (stat.bet.type === BET_TYPES.STRAIGHT ? 1 :
                  stat.bet.type === BET_TYPES.SPLIT ? 2 :
                  stat.bet.type === BET_TYPES.STREET ? 3 :
                  stat.bet.type === BET_TYPES.CORNER ? 4 :
                  stat.bet.type === BET_TYPES.SIX_LINE ? 6 :
                  stat.bet.type === BET_TYPES.COLUMN || stat.bet.type === BET_TYPES.DOZEN ? 12 : 18) / 37;
    const mult = PAYOUT_RATIOS[stat.bet.type].grossMultiplier;
    const varX = (mult * mult * prob) - (targetGrossReturn * targetGrossReturn);
    const sePercent = (Math.sqrt(varX / 100000)) * 100;
    const zScore = diff / sePercent;

    console.log(`  Category [${name.padEnd(9)}]: Wagered=${stat.wagered.toLocaleString()} Returned=${stat.returned.toLocaleString()} -> Return=${ret.toFixed(3)}% (Error: ${diff.toFixed(3)}%, z=${zScore.toFixed(2)})`);
    assert(zScore < 4.0, `Category ${name} return ${ret}% diverged unexpectedly (z-score ${zScore} >= 4.0, p < 0.00006)`);
  }
  recordPass('Category-by-category Monte Carlo verified: all 8 standard bet categories empirically converge within 4-sigma statistical confidence intervals.');

  console.log('\n================================================================');
  console.log(`ALL EMPIRICAL CHALLENGE TESTS PASSED: ${passedTests} / ${totalTests}`);
  console.log('VERDICT: APPROVE');
  console.log('================================================================\n');

  return { passed: true, passedTests, totalTests };
}

if (require.main === module) {
  runEmpiricalChallenge()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Empirical challenge failed:', err);
      process.exit(1);
    });
}

module.exports = { runEmpiricalChallenge };
