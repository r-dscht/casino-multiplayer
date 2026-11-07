/**
 * adversarialPokerMath.test.js
 * Adversarial Empirical Stress & Mathematical Verification Suite for Texas Hold'em Poker Engine.
 * Milestone PK-M4 Gate Verification.
 *
 * Exhaustively stress-tests:
 * 1. 7-Card Hand Evaluator:
 *    - 5,000 randomized Monte Carlo hands verifying mathematical soundness: f5(best5) === f7(cards7)
 *    - Exhaustive search oracle: no 5-card combination among all C(7,5)=21 strictly beats best5
 *    - Coverage across all 10 poker hand categories (0..9: High Card to Royal Flush)
 *    - Boundary straights: Broadway (14-high) vs Wheel (5-high A-2-3-4-5) vs 6-high
 *    - Steel Wheel Straight Flush (5-high) vs Royal Flush vs 6-high Straight Flush
 *    - Rejection of invalid wraparounds (Q-K-A-2-3, K-A-2-3-4, J-Q-K-A-2) as High Card
 *    - Multi-kicker comparisons across all ranks (5th kicker, two pair kicker, trips kicker, quads kicker, full house trips precedence)
 * 2. Side Pot Partitioning & Chip Conservation:
 *    - 3-way, 4-way, and 6-way unequal all-in scenarios with active callers
 *    - Folded dead money retention without eligibility leaks
 *    - Odd-chip clockwise priority distribution from dealer button
 *    - Monte Carlo randomized stack simulations verifying exact zero-sum chip conservation
 *    - Adversarial Challenge: Orphaned side pot chip destruction when higher-tier contenders fold
 * 3. Delta-Raise & Betting Round Boundaries:
 *    - Opening bet < Big Blind rejected
 *    - Full minimum raise enforcement and cumulative delta tracking
 *    - Short-stack all-in less than minimum raise accepted
 *    - Adversarial Challenge: Under-raise reopening rule violation in handleAction
 *    - Adversarial Challenge: Stale minRaise allowing 1-chip sub-minimum raise exploit
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const PokerDeck = require('../../server/game/pokerDeck');
const {
  evaluate5CardHand,
  evaluate7CardHand,
  compareHands,
  combinations7choose5,
  normalizeCard,
  getStraightHighRank,
  HAND_RANKS,
  HAND_RANK_NAMES
} = require('../../server/game/pokerRules');

const {
  PokerPotManager,
  calculateSidePots,
  splitPot,
  getClockwisePriority
} = require('../../server/game/pokerPotManager');

const PokerEngine = require('../../server/game/pokerEngine');
const PlayerManager = require('../../server/game/playerManager');
const { PHASES, ACTIONS, SEAT_STATUS } = require('../../server/game/pokerConstants');

describe('Adversarial Texas Hold\'em Poker Engine Stress Suite (PK-M4 Gate)', () => {

  // =========================================================================
  // SECTION 1: 7-CARD HAND EVALUATOR MATHEMATICAL SOUNDNESS & ORACLE HARNESS
  // =========================================================================
  describe('Dimension 1: 7-Card Hand Evaluator Stress & Soundness Oracles', () => {

    it('1.1 Monte Carlo 5,000 random hands: mathematical soundness and 21-combination exhaustiveness', () => {
      const deck = new PokerDeck();
      const rankDistribution = {};

      for (let i = 0; i < 5000; i++) {
        deck.reset();
        const cards7 = [];
        for (let j = 0; j < 7; j++) cards7.push(deck.draw());

        const res7 = evaluate7CardHand(cards7);
        assert.ok(res7, 'Evaluated result must not be null');
        assert.ok(res7.category >= 0 && res7.category <= 9, 'Category must be in 0..9');
        assert.equal(Array.isArray(res7.scoreVector), true, 'scoreVector must be array');
        assert.equal(res7.scoreVector.length, 6, 'scoreVector must have length 6');
        assert.equal(res7.scoreVector[0], res7.category, 'scoreVector[0] must equal category');

        rankDistribution[res7.rankName] = (rankDistribution[res7.rankName] || 0) + 1;

        // Oracle 1: best5 must be exactly 5 cards and a strict subset of the 7 cards
        assert.equal(res7.best5.length, 5, 'best5 must contain exactly 5 cards');
        const cardIds7 = new Set(cards7.map(c => c.id));
        for (const c of res7.best5) {
          assert.equal(cardIds7.has(c.id), true, 'best5 card must be in dealt 7 cards');
        }

        // Oracle 2: Evaluating the returned best5 directly must match 7-card category & scoreVector
        const eval5 = evaluate5CardHand(res7.best5);
        assert.equal(eval5.category, res7.category, '5-card eval category must match 7-card category');
        assert.deepEqual(eval5.scoreVector, res7.scoreVector, '5-card scoreVector must match 7-card scoreVector');

        // Oracle 3: Exhaustive verification — no other subset of 5 cards from C(7,5)=21 strictly beats best5
        const allCombos = combinations7choose5(cards7);
        assert.equal(allCombos.length, 21, 'Must have exactly 21 combinations');
        for (const combo of allCombos) {
          const comboEval = evaluate5CardHand(combo);
          const cmp = compareHands(comboEval, eval5);
          assert.ok(cmp <= 0, 'No combo among 21 can beat the evaluator best5 hand');
        }
      }

      // Assert that common categories appeared in 5,000 deals
      assert.ok(rankDistribution['HIGH_CARD'] > 500, 'HIGH_CARD must appear');
      assert.ok(rankDistribution['ONE_PAIR'] > 1500, 'ONE_PAIR must appear');
      assert.ok(rankDistribution['TWO_PAIR'] > 800, 'TWO_PAIR must appear');
      assert.ok(rankDistribution['THREE_OF_A_KIND'] > 100, 'THREE_OF_A_KIND must appear');
      assert.ok(rankDistribution['STRAIGHT'] > 50, 'STRAIGHT must appear');
      assert.ok(rankDistribution['FLUSH'] > 50, 'FLUSH must appear');
      assert.ok(rankDistribution['FULL_HOUSE'] > 50, 'FULL_HOUSE must appear');
    });

    it('1.2 Boundary Straight Testing: Wheel (A-2-3-4-5) vs Broadway (10-J-Q-K-A) vs 6-high', () => {
      // Wheel Straight: 5-high (tieBreaker 5)
      const wheelCards = ['As', '2h', '3d', '4c', '5s'];
      const wheelEval = evaluate5CardHand(wheelCards);
      assert.equal(wheelEval.category, HAND_RANKS.STRAIGHT);
      assert.equal(wheelEval.scoreVector[1], 5, 'Wheel straight high card must be 5');

      // Broadway Straight: 14-high (tieBreaker 14)
      const broadwayCards = ['10s', 'Jh', 'Qd', 'Kc', 'Ah'];
      const broadwayEval = evaluate5CardHand(broadwayCards);
      assert.equal(broadwayEval.category, HAND_RANKS.STRAIGHT);
      assert.equal(broadwayEval.scoreVector[1], 14, 'Broadway high card must be 14 (Ace)');

      // 6-high Straight: 6-5-4-3-2 (tieBreaker 6)
      const sixHighCards = ['2h', '3d', '4c', '5s', '6d'];
      const sixHighEval = evaluate5CardHand(sixHighCards);
      assert.equal(sixHighEval.category, HAND_RANKS.STRAIGHT);
      assert.equal(sixHighEval.scoreVector[1], 6, '6-high straight high card must be 6');

      // Broadway strictly beats 6-high and Wheel
      assert.ok(compareHands(broadwayEval, sixHighEval) > 0, 'Broadway must beat 6-high');
      assert.ok(compareHands(broadwayEval, wheelEval) > 0, 'Broadway must beat Wheel');

      // 6-high strictly beats Wheel (5-high)
      assert.ok(compareHands(sixHighEval, wheelEval) > 0, '6-high must beat Wheel (5-high)');

      // 7-card hand containing both Ace, 2, 3, 4, 5 and 6 makes 6-high straight, NOT 5-high
      const hand7 = ['As', '2c', '3d', '4h', '5s', '6c', 'Kd'];
      const res7 = evaluate7CardHand(hand7);
      assert.equal(res7.category, HAND_RANKS.STRAIGHT);
      assert.equal(res7.scoreVector[1], 6, 'Should select 6-high straight over Wheel');
    });

    it('1.3 Rejection of invalid wraparounds: Q-K-A-2-3, K-A-2-3-4, J-Q-K-A-2 must NEVER be straights', () => {
      const wrap1 = ['Qh', 'Kd', 'As', '2c', '3d'];
      const wrap2 = ['Kh', 'As', '2c', '3d', '4s'];
      const wrap3 = ['Jh', 'Qd', 'Ks', 'Ac', '2d'];

      const eval1 = evaluate5CardHand(wrap1);
      const eval2 = evaluate5CardHand(wrap2);
      const eval3 = evaluate5CardHand(wrap3);

      assert.equal(eval1.category, HAND_RANKS.HIGH_CARD, 'Q-K-A-2-3 must be High Card');
      assert.equal(eval2.category, HAND_RANKS.HIGH_CARD, 'K-A-2-3-4 must be High Card');
      assert.equal(eval3.category, HAND_RANKS.HIGH_CARD, 'J-Q-K-A-2 must be High Card');
    });

    it('1.4 Steel Wheel Straight Flush vs Royal Flush vs 6-high Straight Flush', () => {
      // Steel Wheel (5-high straight flush): Ac-2c-3c-4c-5c
      const steelWheel = ['Ac', '2c', '3c', '4c', '5c'];
      const evalSteel = evaluate5CardHand(steelWheel);
      assert.equal(evalSteel.category, HAND_RANKS.STRAIGHT_FLUSH);
      assert.equal(evalSteel.scoreVector[1], 5);

      // Royal Flush: As-Ks-Qs-Js-10s
      const royal = ['As', 'Ks', 'Qs', 'Js', '10s'];
      const evalRoyal = evaluate5CardHand(royal);
      assert.equal(evalRoyal.category, HAND_RANKS.ROYAL_FLUSH);

      // 6-high Straight Flush: 2c-3c-4c-5c-6c
      const sf6 = ['2c', '3c', '4c', '5c', '6c'];
      const evalSf6 = evaluate5CardHand(sf6);
      assert.equal(evalSf6.category, HAND_RANKS.STRAIGHT_FLUSH);
      assert.equal(evalSf6.scoreVector[1], 6);

      assert.ok(compareHands(evalRoyal, evalSteel) > 0, 'Royal Flush must beat Steel Wheel');
      assert.ok(compareHands(evalSf6, evalSteel) > 0, '6-high Straight Flush must beat Steel Wheel');
    });

    it('1.5 Multi-kicker comparisons across all hand categories', () => {
      // High card: 5th kicker comparison
      const hcA = ['As', 'Kd', 'Qc', 'Jh', '9d'];
      const hcB = ['As', 'Kd', 'Qc', 'Jh', '8d'];
      assert.ok(compareHands(hcA, hcB) > 0, 'A-K-Q-J-9 beats A-K-Q-J-8');

      // High card: 4th kicker comparison
      const hcC = ['As', 'Kd', 'Qc', '9h', '7d'];
      const hcD = ['As', 'Kd', 'Qc', '8h', '7d'];
      assert.ok(compareHands(hcC, hcD) > 0, 'A-K-Q-9-7 beats A-K-Q-8-7');

      // One Pair: 3rd kicker comparison
      const opA = ['10s', '10h', 'As', 'Kd', '8c'];
      const opB = ['10s', '10h', 'As', 'Kd', '7c'];
      assert.ok(compareHands(opA, opB) > 0, 'Pair 10s A-K-8 beats Pair 10s A-K-7');

      // Two Pair: kicker comparison
      const tpA = ['As', 'Ah', 'Ks', 'Kh', 'Qd'];
      const tpB = ['As', 'Ah', 'Ks', 'Kh', 'Jd'];
      assert.ok(compareHands(tpA, tpB) > 0, 'Aces and Kings with Queen kicker beats Jack kicker');

      // Two Pair: higher 2nd pair beats higher kicker
      const tpC = ['As', 'Ah', 'Qs', 'Qh', 'Kd'];
      const tpD = ['As', 'Ah', 'Js', 'Jh', 'Kd'];
      assert.ok(compareHands(tpC, tpD) > 0, 'Aces and Queens beats Aces and Jacks');

      // Three of a Kind: 2nd kicker comparison
      const tripsA = ['8s', '8h', '8d', 'Ah', 'Kd'];
      const tripsB = ['8s', '8h', '8d', 'Ah', 'Qd'];
      assert.ok(compareHands(tripsA, tripsB) > 0, 'Trips 8s A-K beats Trips 8s A-Q');

      // Four of a Kind: kicker comparison
      const quadsA = ['9s', '9h', '9d', '9c', 'Ah'];
      const quadsB = ['9s', '9h', '9d', '9c', 'Kh'];
      assert.ok(compareHands(quadsA, quadsB) > 0, 'Quads 9s Ace kicker beats King kicker');

      // Full House: Trips rank strictly takes precedence over Pair rank
      const fh3s = ['3s', '3h', '3d', '2s', '2h']; // 3s full of 2s
      const fh2s = ['2c', '2d', '2s', 'As', 'Ah']; // 2s full of Aces
      assert.ok(compareHands(fh3s, fh2s) > 0, '3s full of 2s must beat 2s full of Aces');

      // Full House: Same trips, higher pair
      const fhA = ['8s', '8h', '8d', '4s', '4h'];
      const fhB = ['8s', '8h', '8d', '3s', '3h'];
      assert.ok(compareHands(fhA, fhB) > 0, '8s full of 4s beats 8s full of 3s');

      // Flush: 5th card comparison
      const flA = ['Kh', 'Jh', '9h', '7h', '4h'];
      const flB = ['Kh', 'Jh', '9h', '7h', '3h'];
      assert.ok(compareHands(flA, flB) > 0, 'K-J-9-7-4 flush beats K-J-9-7-3 flush');
    });
  });

  // =========================================================================
  // SECTION 2: SIDE POT PARTITIONING, DEAD MONEY & CHIP CONSERVATION
  // =========================================================================
  describe('Dimension 2: Side Pot Partitioning & Chip Conservation Stress', () => {

    it('2.1 3-way unequal all-ins with active callers partitions correctly into Main & Side pots', () => {
      // p0: 200 (all-in)
      // p1: 500 (all-in)
      // p2: 500 (active caller)
      const players = [
        { id: 'p0', seatIndex: 0, totalCommitted: 200, isFolded: false, isAllIn: true },
        { id: 'p1', seatIndex: 1, totalCommitted: 500, isFolded: false, isAllIn: true },
        { id: 'p2', seatIndex: 2, totalCommitted: 500, isFolded: false, isAllIn: false }
      ];

      const pots = calculateSidePots(players);
      assert.equal(pots.length, 2);

      // Main pot: 200 * 3 = 600, all 3 eligible
      assert.equal(pots[0].amount, 600);
      assert.deepEqual(pots[0].eligiblePlayerIds.sort(), ['p0', 'p1', 'p2'].sort());
      assert.equal(pots[0].isRefund, false);

      // Side pot: (500 - 200) * 2 = 600, p1 and p2 eligible
      assert.equal(pots[1].amount, 600);
      assert.deepEqual(pots[1].eligiblePlayerIds.sort(), ['p1', 'p2'].sort());
      assert.equal(pots[1].isRefund, false);

      const totalPot = pots.reduce((sum, p) => sum + p.amount, 0);
      assert.equal(totalPot, 200 + 500 + 500, 'Exact chip conservation in 3-way pot');
    });

    it('2.2 4-way unequal all-ins partitions into Main Pot and 2 Side Pots with exact conservation', () => {
      // p0: 100, p1: 300, p2: 600, p3: 600
      const players = [
        { id: 'p0', seatIndex: 0, totalCommitted: 100, isFolded: false, isAllIn: true },
        { id: 'p1', seatIndex: 1, totalCommitted: 300, isFolded: false, isAllIn: true },
        { id: 'p2', seatIndex: 2, totalCommitted: 600, isFolded: false, isAllIn: true },
        { id: 'p3', seatIndex: 3, totalCommitted: 600, isFolded: false, isAllIn: false }
      ];

      const pots = calculateSidePots(players);
      assert.equal(pots.length, 3);

      // Tier 1: 100 * 4 = 400 (p0, p1, p2, p3)
      assert.equal(pots[0].amount, 400);
      assert.deepEqual(pots[0].eligiblePlayerIds.sort(), ['p0', 'p1', 'p2', 'p3'].sort());

      // Tier 2: (300 - 100) * 3 = 600 (p1, p2, p3)
      assert.equal(pots[1].amount, 600);
      assert.deepEqual(pots[1].eligiblePlayerIds.sort(), ['p1', 'p2', 'p3'].sort());

      // Tier 3: (600 - 300) * 2 = 600 (p2, p3)
      assert.equal(pots[2].amount, 600);
      assert.deepEqual(pots[2].eligiblePlayerIds.sort(), ['p2', 'p3'].sort());

      const total = pots.reduce((sum, p) => sum + p.amount, 0);
      assert.equal(total, 100 + 300 + 600 + 600);
    });

    it('2.3 6-way unequal all-ins: all 6 seats all-in creates 5 active pots and 1 refund with zero loss', () => {
      const pm = new PokerPotManager(6);
      pm.recordContribution('p0', 50, 0);
      pm.setPlayerAllIn('p0', true);
      pm.recordContribution('p1', 100, 1);
      pm.setPlayerAllIn('p1', true);
      pm.recordContribution('p2', 200, 2);
      pm.setPlayerAllIn('p2', true);
      pm.recordContribution('p3', 400, 3);
      pm.setPlayerAllIn('p3', true);
      pm.recordContribution('p4', 800, 4);
      pm.setPlayerAllIn('p4', true);
      pm.recordContribution('p5', 1500, 5); // Uncalled 700 above 800
      pm.setPlayerAllIn('p5', true);

      const pots = pm.getPots();
      assert.equal(pots.length, 6);

      // Main pot: 50 * 6 = 300
      assert.equal(pots[0].amount, 300);
      assert.equal(pots[0].eligiblePlayerIds.length, 6);

      // Side pot 1: 50 * 5 = 250
      assert.equal(pots[1].amount, 250);
      assert.equal(pots[1].eligiblePlayerIds.length, 5);

      // Side pot 2: 100 * 4 = 400
      assert.equal(pots[2].amount, 400);
      assert.equal(pots[2].eligiblePlayerIds.length, 4);

      // Side pot 3: 200 * 3 = 600
      assert.equal(pots[3].amount, 600);
      assert.equal(pots[3].eligiblePlayerIds.length, 3);

      // Side pot 4: 400 * 2 = 800
      assert.equal(pots[4].amount, 800);
      assert.equal(pots[4].eligiblePlayerIds.length, 2);

      // Refund pot: 700 uncalled bet returned to p5
      assert.equal(pots[5].amount, 700);
      assert.equal(pots[5].isRefund, true);
      assert.deepEqual(pots[5].eligiblePlayerIds, ['p5']);

      const totalExpected = 50 + 100 + 200 + 400 + 800 + 1500;
      const hands = [
        { playerId: 'p0', seatIndex: 0, hand: { scoreVector: [8, 14, 0, 0, 0, 0] } },
        { playerId: 'p1', seatIndex: 1, hand: { scoreVector: [7, 10, 0, 0, 0, 0] } },
        { playerId: 'p2', seatIndex: 2, hand: { scoreVector: [6, 12, 0, 0, 0, 0] } },
        { playerId: 'p3', seatIndex: 3, hand: { scoreVector: [5, 14, 0, 0, 0, 0] } },
        { playerId: 'p4', seatIndex: 4, hand: { scoreVector: [4, 10, 0, 0, 0, 0] } },
        { playerId: 'p5', seatIndex: 5, hand: { scoreVector: [1, 5, 0, 0, 0, 0] } }
      ];

      const settlement = pm.settle(hands, 0);
      assert.equal(settlement.totalAwarded, totalExpected, 'All 3050 chips must be accounted for');
      assert.equal(settlement.refunds.length, 1);
      assert.equal(settlement.refunds[0].playerId, 'p5');
      assert.equal(settlement.refunds[0].amount, 700);
    });

    it('2.4 Dead money retention: folded player chips remain in pot while excluding player from winning', () => {
      // p0: 100 (all-in), p1: 300 (all-in), p2: 300 (active), p3: 100 (folded)
      const players = [
        { id: 'p0', seatIndex: 0, totalCommitted: 100, isFolded: false, isAllIn: true },
        { id: 'p1', seatIndex: 1, totalCommitted: 300, isFolded: false, isAllIn: true },
        { id: 'p2', seatIndex: 2, totalCommitted: 300, isFolded: false, isAllIn: false },
        { id: 'p3', seatIndex: 3, totalCommitted: 100, isFolded: true, isAllIn: false }
      ];

      const pots = calculateSidePots(players);
      assert.equal(pots.length, 2);

      // Main pot: 100 * 4 = 400. Includes p3's dead chips, but p3 is excluded!
      assert.equal(pots[0].amount, 400);
      assert.deepEqual(pots[0].eligiblePlayerIds.sort(), ['p0', 'p1', 'p2'].sort());
      assert.equal(pots[0].eligiblePlayerIds.includes('p3'), false, 'Folded player must not be eligible');

      // Side pot: (300 - 100) * 2 = 400. Eligible: [p1, p2]
      assert.equal(pots[1].amount, 400);
      assert.deepEqual(pots[1].eligiblePlayerIds.sort(), ['p1', 'p2'].sort());
    });

    it('2.5 Odd chip allocation: distributes 1-by-1 strictly clockwise from dealer button', () => {
      // 6 seats (0..5). Dealer button at seat 2.
      // Clockwise distance from button 2: seat 3 (0), seat 4 (1), seat 5 (2), seat 0 (3), seat 1 (4), seat 2 (5).
      assert.equal(getClockwisePriority(3, 2, 6), 0);
      assert.equal(getClockwisePriority(4, 2, 6), 1);
      assert.equal(getClockwisePriority(5, 2, 6), 2);
      assert.equal(getClockwisePriority(0, 2, 6), 3);
      assert.equal(getClockwisePriority(1, 2, 6), 4);
      assert.equal(getClockwisePriority(2, 2, 6), 5);

      const seatMap = new Map([['p1', 1], ['p3', 3], ['p5', 5]]);

      // Pot of 100 split 3 ways: 33 each, 1 odd chip. Priority: seat 3 is first clockwise from button 2!
      const split1 = splitPot(100, ['p1', 'p3', 'p5'], 2, seatMap, 6);
      assert.equal(split1.get('p3'), 34, 'Seat 3 must receive the single odd chip');
      assert.equal(split1.get('p5'), 33);
      assert.equal(split1.get('p1'), 33);

      // Pot of 101 split 3 ways: 33 each, 2 odd chips. Priority: seat 3 and seat 5!
      const split2 = splitPot(101, ['p1', 'p3', 'p5'], 2, seatMap, 6);
      assert.equal(split2.get('p3'), 34, 'Seat 3 receives 1st odd chip');
      assert.equal(split2.get('p5'), 34, 'Seat 5 receives 2nd odd chip');
      assert.equal(split2.get('p1'), 33, 'Seat 1 receives no odd chip');
    });

    it('2.6 Monte Carlo 1,000 runs on pot manager: zero-sum chip conservation when active contenders exist', () => {
      for (let sim = 0; sim < 1000; sim++) {
        const pm = new PokerPotManager(6);
        const numPlayers = 3 + Math.floor(Math.random() * 4); // 3..6
        let total = 0;
        const pList = [];

        // In this standard scenario, players commit chips and the highest commitment is backed by an active player
        for (let i = 0; i < numPlayers; i++) {
          const commit = 100 + Math.floor(Math.random() * 2000);
          pm.registerPlayer(`p_${i}`, i);
          pm.recordContribution(`p_${i}`, commit, i);
          total += commit;
          pList.push({ id: `p_${i}`, seatIndex: i, commit, isFolded: false, isAllIn: Math.random() < 0.5 });
        }

        // Active showdown hands
        const hands = pList.map(p => ({
          playerId: p.id,
          seatIndex: p.seatIndex,
          hand: {
            scoreVector: [
              Math.floor(Math.random() * 10),
              Math.floor(Math.random() * 14) + 1,
              0, 0, 0, 0
            ]
          }
        }));

        const settlement = pm.settle(hands, 0);
        let awarded = 0;
        for (const p of settlement.payouts) awarded += p.amount;
        for (const r of settlement.refunds) awarded += r.amount;

        assert.equal(awarded, total, `Chip conservation failed in sim ${sim}: ${awarded} !== ${total}`);
      }
    });

    it('2.7 ADVERSARIAL CHALLENGE: Orphaned side pot chip leak when higher-tier contenders fold', () => {
      // Scenario: Player 0 is all-in for 100.
      // Player 1 committed 500 and then folded.
      // Player 2 committed 100 and is active.
      // Total chips in hand: 100 + 500 + 100 = 700 chips.
      const pm = new PokerPotManager(6);
      pm.recordContribution('p0', 100, 0);
      pm.setPlayerAllIn('p0', true);

      pm.recordContribution('p1', 500, 1);
      pm.setPlayerFolded('p1', true); // Folded!

      pm.recordContribution('p2', 100, 2); // Active!

      const totalCommitted = 700;
      const pots = pm.getPots();
      assert.equal(pots.length, 2);

      // Main pot: 300 chips (p0, p2)
      assert.equal(pots[0].amount, 300);
      assert.deepEqual(pots[0].eligiblePlayerIds.sort(), ['p0', 'p2'].sort());

      // Pot 1: 400 chips. Because p1 folded and p0/p2 only committed 100:
      // eligiblePlayerIds is empty []!
      assert.equal(pots[1].amount, 400);
      assert.equal(pots[1].eligiblePlayerIds.length, 0, 'Pot 1 has 0 eligible players');
      assert.equal(pots[1].isRefund, false, 'Pot 1 was not marked as refund');

      const hands = [
        { playerId: 'p0', seatIndex: 0, hand: { scoreVector: [2, 14, 0, 0, 0, 0] } },
        { playerId: 'p2', seatIndex: 2, hand: { scoreVector: [1, 14, 0, 0, 0, 0] } }
      ];

      const settlement = pm.settle(hands, 0);

      // VERIFICATION: 100% Chip Conservation
      // All 400 chips from orphaned Pot 1 are awarded to active showdown contenders (p0 and p2)
      // Total awarded must strictly equal total committed: 700 === 700
      const leakedChips = totalCommitted - settlement.totalAwarded;
      assert.equal(leakedChips, 0, 'Zero chips leaked from casino');
      assert.equal(settlement.totalAwarded, 700);
      assert.equal(settlement.potSummaries[1].winners.length, 2, 'Pot 1 distributed to active contenders');
    });
  });

  // =========================================================================
  // SECTION 3: DELTA-RAISE BOUNDARIES & BETTING ROUND STRESS
  // =========================================================================
  describe('Dimension 3: Delta-Raise & Betting Round Boundaries Stress', () => {

    it('3.1 Minimum opening bet: bet < BB is strictly rejected with BET_TOO_SMALL', () => {
      const pm = new PlayerManager({ storagePath: false });
      const engine = new PokerEngine(pm, { smallBlind: 50, bigBlind: 100, minBuyIn: 1000, maxBuyIn: 10000 });

      const p1 = pm.registerPlayer('s1', { name: 'P1' });
      const p2 = pm.registerPlayer('s2', { name: 'P2' });

      engine.takeSeat(0, p1.id, 2000);
      engine.takeSeat(1, p2.id, 2000);
      engine.startNewHand();

      // Post-flop (or pre-flop facing bet): if bet is made < BB (100)
      engine.currentBet = 0;
      const resSmall = engine.handleAction(0, p1.id, ACTIONS.BET, { amount: 50 });
      assert.equal(resSmall.success, false);
      assert.equal(resSmall.code, 'BET_TOO_SMALL');

      const resValid = engine.handleAction(0, p1.id, ACTIONS.BET, { amount: 100 });
      assert.equal(resValid.success, true);
      assert.equal(engine.currentBet, 100);
      assert.equal(engine.minRaise, 200);
    });

    it('3.2 Minimum raise enforcement: raise < currentBet + lastRaiseDelta is rejected', () => {
      const pm = new PlayerManager({ storagePath: false });
      const engine = new PokerEngine(pm, { smallBlind: 50, bigBlind: 100, minBuyIn: 1000, maxBuyIn: 10000 });

      const p1 = pm.registerPlayer('s1', { name: 'P1' });
      const p2 = pm.registerPlayer('s2', { name: 'P2' });

      engine.takeSeat(0, p1.id, 2000);
      engine.takeSeat(1, p2.id, 2000);
      engine.startNewHand();

      // Pre-flop: currentBet = 100, minRaise = 200
      // Attempt raise to 150 (less than minRaise 200)
      const resSmall = engine.handleAction(0, p1.id, ACTIONS.RAISE, { amount: 150 });
      assert.equal(resSmall.success, false);
      assert.equal(resSmall.code, 'RAISE_TOO_SMALL');

      // Valid raise to 250 (delta = 150 >= 100)
      const resValid = engine.handleAction(0, p1.id, ACTIONS.RAISE, { amount: 250 });
      assert.equal(resValid.success, true);
      assert.equal(engine.currentBet, 250);
      assert.equal(engine.lastRaiseDelta, 150);
      assert.equal(engine.minRaise, 400); // 250 + 150 = 400
    });

    it('3.3 Short-stack all-in less than minimum raise is accepted as an all-in exception', () => {
      const pm = new PlayerManager({ storagePath: false });
      const engine = new PokerEngine(pm, { smallBlind: 50, bigBlind: 100, minBuyIn: 100, maxBuyIn: 10000 });

      const p1 = pm.registerPlayer('s1', { name: 'P1' });
      const p2 = pm.registerPlayer('s2', { name: 'P2' });

      engine.takeSeat(0, p1.id, 2000);
      engine.takeSeat(1, p2.id, 150); // short stack: posts BB 100, only 50 left
      engine.startNewHand();

      // Seat 0 raises to 200
      engine.handleAction(0, p1.id, ACTIONS.RAISE, { amount: 200 });

      // Seat 1 goes all-in for 150 total (50 remaining). Facing 200, this is an under-all-in
      const resAllIn = engine.handleAction(1, p2.id, ACTIONS.ALL_IN);
      assert.equal(resAllIn.success, true);
      assert.equal(engine.seats[1].isAllIn, true);
      assert.equal(engine.seats[1].totalCommittedThisHand, 150);
    });

    it('3.4 ADVERSARIAL CHALLENGE: Under-raise reopening rule violation in handleAction', () => {
      // Rule (TDA Rule 45): An all-in of less than a full raise DOES NOT reopen betting
      // to a player who has already acted.
      const pm = new PlayerManager({ storagePath: false });
      const engine = new PokerEngine(pm, { smallBlind: 50, bigBlind: 100, minBuyIn: 100, maxBuyIn: 10000 });

      const p0 = pm.registerPlayer('s0', { name: 'P0' });
      const p1 = pm.registerPlayer('s1', { name: 'P1' });
      const p2 = pm.registerPlayer('s2', { name: 'P2' });

      engine.takeSeat(0, p0.id, 5000);
      engine.takeSeat(1, p1.id, 5000);
      engine.takeSeat(2, p2.id, 250); // short stack: posts BB 100, has 150 left

      engine.startNewHand();

      // Step 1: Seat 0 (Button/UTG) raises to 200 (delta = 100)
      const r1 = engine.handleAction(0, p0.id, ACTIONS.RAISE, { amount: 200 });
      assert.equal(r1.success, true);

      // Step 2: Seat 1 (SB) calls 200
      const r2 = engine.handleAction(1, p1.id, ACTIONS.CALL);
      assert.equal(r2.success, true);

      // Step 3: Seat 2 (BB) goes all-in for 250 (delta = 50, which is < lastRaiseDelta 100!)
      const r3 = engine.handleAction(2, p2.id, ACTIONS.ALL_IN);
      assert.equal(r3.success, true);
      assert.equal(engine.currentBet, 250);

      // Verify that Seat 0 already acted and hasActedThisRound remained true:
      assert.equal(engine.seats[0].hasActedThisRound, true, 'hasActedThisRound remained true because under-raise did not reopen');

      // Under-Raise Rule: Seat 0 should NOT be permitted to re-raise! Seat 0 may only call 250 or fold.
      const r4 = engine.handleAction(0, p0.id, ACTIONS.RAISE, { amount: 400 });
      assert.equal(r4.success, false, 'Illegal re-raise after under-raise must be rejected');
      assert.equal(r4.code, 'CANNOT_RAISE');
      assert.equal(engine.currentBet, 250);
    });

    it('3.5 ADVERSARIAL CHALLENGE: Stale minRaise allows sub-minimum and 1-chip raises', () => {
      // Demonstrates that when an under-raise all-in occurs, minRaise is updated to targetBet + max(BB, lastRaiseDelta)
      // preventing sub-minimum and 1-chip raises.
      const pm = new PlayerManager({ storagePath: false });
      const engine = new PokerEngine(pm, { smallBlind: 50, bigBlind: 100, minBuyIn: 100, maxBuyIn: 10000 });

      const p0 = pm.registerPlayer('s0', { name: 'P0' });
      const p1 = pm.registerPlayer('s1', { name: 'P1' });
      const p2 = pm.registerPlayer('s2', { name: 'P2' });
      const p3 = pm.registerPlayer('s3', { name: 'P3' });

      engine.takeSeat(0, p0.id, 5000); // BTN
      engine.takeSeat(1, p1.id, 5000); // SB
      engine.takeSeat(2, p2.id, 5000); // BB
      engine.takeSeat(3, p3.id, 120);  // UTG with 120 chips

      engine.startNewHand();

      // UTG goes all-in for 120 (an under-raise of +20 over BB 100)
      const r1 = engine.handleAction(3, p3.id, ACTIONS.ALL_IN);
      assert.equal(r1.success, true);
      assert.equal(engine.currentBet, 120);

      // VERIFICATION PART 1:
      // minRaise is updated to targetBet + Math.max(BB, lastRaiseDelta) = 120 + 100 = 220
      assert.equal(engine.minRaise, 220, 'minRaise updated to 220');

      // BTN attempts sub-minimum raise to 200 (increment of 80 < BB 100). Must be rejected!
      const r2 = engine.handleAction(0, p0.id, ACTIONS.RAISE, { amount: 200 });
      assert.equal(r2.success, false, 'Sub-minimum raise is rejected');
      assert.ok(r2.code === 'RAISE_TOO_SMALL' || r2.code === 'MIN_RAISE_REQUIRED');

      // BTN raises legally to minRaise 220
      const r2Valid = engine.handleAction(0, p0.id, ACTIONS.RAISE, { amount: 220 });
      assert.equal(r2Valid.success, true);
      assert.equal(engine.currentBet, 220);
      assert.equal(engine.minRaise, 320, 'minRaise updated to 320 after full raise');

      // VERIFICATION PART 2:
      // Seat 1 (SB) attempts a 1-chip sub-minimum raise to 221. Must be rejected!
      const r3 = engine.handleAction(1, p1.id, ACTIONS.RAISE, { amount: 221 });
      assert.equal(r3.success, false, '1-chip raise must be rejected');
      assert.ok(r3.code === 'RAISE_TOO_SMALL' || r3.code === 'MIN_RAISE_REQUIRED');
      assert.equal(engine.currentBet, 220);
      assert.equal(engine.minRaise, 320);
    });
  });
});
