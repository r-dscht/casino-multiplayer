const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  PokerPotManager,
  calculateSidePots,
  splitPot,
  getClockwisePriority
} = require('../../server/game/pokerPotManager');
const { evaluate5CardHand } = require('../../server/game/pokerRules');

describe('PokerPotManager Unit Tests (Side Pots, Dead Money & Odd Chips)', () => {
  describe('calculateSidePots()', () => {
    it('Trace 1: 3-way unequal all-ins should partition into Main Pot and Side Pot', () => {
      // Player A: 200 (all-in)
      // Player B: 500 (all-in)
      // Player C: 500 (active)
      const players = [
        { id: 'pA', seatIndex: 0, totalCommitted: 200, isFolded: false, isAllIn: true },
        { id: 'pB', seatIndex: 1, totalCommitted: 500, isFolded: false, isAllIn: true },
        { id: 'pC', seatIndex: 2, totalCommitted: 500, isFolded: false, isAllIn: false }
      ];

      const pots = calculateSidePots(players);
      assert.equal(pots.length, 2);

      // Main Pot: 200 * 3 = 600, eligible: [pA, pB, pC]
      assert.equal(pots[0].potId, 0);
      assert.equal(pots[0].amount, 600);
      assert.deepEqual(pots[0].eligiblePlayerIds.sort(), ['pA', 'pB', 'pC'].sort());
      assert.equal(pots[0].isRefund, false);

      // Side Pot 1: 300 * 2 = 600, eligible: [pB, pC]
      assert.equal(pots[1].potId, 1);
      assert.equal(pots[1].amount, 600);
      assert.deepEqual(pots[1].eligiblePlayerIds.sort(), ['pB', 'pC'].sort());
      assert.equal(pots[1].isRefund, false);
    });

    it('Trace 2: Multi-round all-in with folded dead money retains dead chips while excluding folded player', () => {
      // A (100, all-in), B (300, all-in), C (300, active), D (100, folded)
      const players = [
        { id: 'pA', seatIndex: 0, totalCommitted: 100, isFolded: false, isAllIn: true },
        { id: 'pB', seatIndex: 1, totalCommitted: 300, isFolded: false, isAllIn: true },
        { id: 'pC', seatIndex: 2, totalCommitted: 300, isFolded: false, isAllIn: false },
        { id: 'pD', seatIndex: 3, totalCommitted: 100, isFolded: true, isAllIn: false }
      ];

      const pots = calculateSidePots(players);
      assert.equal(pots.length, 2);

      // Main Pot: 100 * 4 = 400. D's 100 dead chips are retained, but D is excluded from eligibility!
      assert.equal(pots[0].amount, 400);
      assert.deepEqual(pots[0].eligiblePlayerIds.sort(), ['pA', 'pB', 'pC'].sort());
      assert.equal(pots[0].eligiblePlayerIds.includes('pD'), false);

      // Side Pot 1: (300 - 100) * 2 = 400. Eligible: [pB, pC]
      assert.equal(pots[1].amount, 400);
      assert.deepEqual(pots[1].eligiblePlayerIds.sort(), ['pB', 'pC'].sort());
    });

    it('should identify uncalled excess bet as a refund', () => {
      // Player A goes all-in for 200
      // Player B bets 500
      // 300 of Player B's bet is uncalled and should be refunded
      const players = [
        { id: 'pA', seatIndex: 0, totalCommitted: 200, isFolded: false, isAllIn: true },
        { id: 'pB', seatIndex: 1, totalCommitted: 500, isFolded: false, isAllIn: false }
      ];

      const pots = calculateSidePots(players);
      assert.equal(pots.length, 2);

      // Main Pot: 200 + 200 = 400. Eligible: [pA, pB]
      assert.equal(pots[0].amount, 400);
      assert.equal(pots[0].isRefund, false);

      // Uncalled Refund: 300. Eligible: [pB]
      assert.equal(pots[1].amount, 300);
      assert.equal(pots[1].isRefund, true);
      assert.deepEqual(pots[1].eligiblePlayerIds, ['pB']);
    });

    it('should handle single main pot when no players are all-in', () => {
      const players = [
        { id: 'p1', seatIndex: 0, totalCommitted: 200, isFolded: false, isAllIn: false },
        { id: 'p2', seatIndex: 1, totalCommitted: 200, isFolded: false, isAllIn: false },
        { id: 'p3', seatIndex: 2, totalCommitted: 200, isFolded: false, isAllIn: false }
      ];

      const pots = calculateSidePots(players);
      assert.equal(pots.length, 1);
      assert.equal(pots[0].amount, 600);
      assert.deepEqual(pots[0].eligiblePlayerIds.sort(), ['p1', 'p2', 'p3'].sort());
    });
  });

  describe('Odd-Chip Allocation & splitPot()', () => {
    it('Trace 3: Split pot of 75 chips between Seat 1 and Seat 4 with Button at Seat 0 awards odd chip to Seat 1', () => {
      const playerSeats = { pA: 1, pB: 4 };
      const buttonSeat = 0;
      const payouts = splitPot(75, ['pA', 'pB'], buttonSeat, playerSeats);

      // Base: 75 / 2 = 37. 1 odd chip to pA (Seat 1 is closest clockwise from Button Seat 0).
      assert.equal(payouts.get('pA'), 38);
      assert.equal(payouts.get('pB'), 37);
    });

    it('should award odd chip to Seat 4 when Button is at Seat 2', () => {
      const playerSeats = { pA: 1, pB: 4 };
      const buttonSeat = 2; // Seat 4 is distance 1 from button+1=3, Seat 1 is distance 4
      const payouts = splitPot(75, ['pA', 'pB'], buttonSeat, playerSeats);

      assert.equal(payouts.get('pA'), 37);
      assert.equal(payouts.get('pB'), 38);
    });

    it('should distribute multiple odd chips 1-by-1 in clockwise order', () => {
      // 101 chips among 3 winners: 33 base each, 2 odd chips
      // Button at Seat 0. Seats: pA: 1, pB: 3, pC: 5
      const playerSeats = { pA: 1, pB: 3, pC: 5 };
      const payouts = splitPot(101, ['pA', 'pB', 'pC'], 0, playerSeats);

      assert.equal(payouts.get('pA'), 34); // 1st odd chip
      assert.equal(payouts.get('pB'), 34); // 2nd odd chip
      assert.equal(payouts.get('pC'), 33); // No odd chip
    });

    it('getClockwisePriority should prioritize left of button as 0 and button as last', () => {
      const button = 3;
      assert.equal(getClockwisePriority(4, button, 6), 0); // 1st
      assert.equal(getClockwisePriority(5, button, 6), 1); // 2nd
      assert.equal(getClockwisePriority(0, button, 6), 2); // 3rd
      assert.equal(getClockwisePriority(1, button, 6), 3); // 4th
      assert.equal(getClockwisePriority(2, button, 6), 4); // 5th
      assert.equal(getClockwisePriority(3, button, 6), 5); // 6th (last)
    });
  });

  describe('PokerPotManager Class Lifecycle', () => {
    it('should record contributions and compute main and side pots', () => {
      const pm = new PokerPotManager(6);
      pm.recordContribution('p1', 100, 0);
      pm.recordContribution('p2', 300, 1);
      pm.recordContribution('p3', 300, 2);
      pm.setPlayerAllIn('p1', true);
      pm.setPlayerAllIn('p2', true);

      assert.equal(pm.getTotalPot(), 700);
      assert.equal(pm.getMainPot(), 300);
      assert.equal(pm.getSidePots().length, 1);
      assert.equal(pm.getSidePots()[0].amount, 400);
    });

    it('settle(): should correctly distribute multi-way pots with hand comparison', () => {
      const pm = new PokerPotManager(6);
      // pA: 200 (All-in, Seat 0)
      // pB: 500 (All-in, Seat 1)
      // pC: 500 (Seat 2)
      pm.recordContribution('pA', 200, 0);
      pm.recordContribution('pB', 500, 1);
      pm.recordContribution('pC', 500, 2);
      pm.setPlayerAllIn('pA', true);
      pm.setPlayerAllIn('pB', true);

      // Hands:
      // pA has Royal Flush
      // pB has Three of a Kind
      // pC has Two Pair
      const hands = [
        { playerId: 'pA', seatIndex: 0, hand: evaluate5CardHand(['As', 'Ks', 'Qs', 'Js', '10s']) },
        { playerId: 'pB', seatIndex: 1, hand: evaluate5CardHand(['8s', '8h', '8d', 'Kc', '2c']) },
        { playerId: 'pC', seatIndex: 2, hand: evaluate5CardHand(['7s', '7h', '4d', '4c', 'Ac']) }
      ];

      // Settlement:
      // Main Pot (600) -> won by pA (Royal Flush)
      // Side Pot (600) -> won by pB (Three of a Kind beats Two Pair, pA is ineligible)
      const res = pm.settle(hands, 0);
      assert.equal(res.totalAwarded, 1200);

      const pAWon = res.payouts.filter(p => p.playerId === 'pA').reduce((s, p) => s + p.amount, 0);
      const pBWon = res.payouts.filter(p => p.playerId === 'pB').reduce((s, p) => s + p.amount, 0);
      const pCWon = res.payouts.filter(p => p.playerId === 'pC').reduce((s, p) => s + p.amount, 0);

      assert.equal(pAWon, 600);
      assert.equal(pBWon, 600);
      assert.equal(pCWon, 0);
    });

    it('settle(): player B wins both pots when having the highest hand overall', () => {
      const pm = new PokerPotManager(6);
      pm.recordContribution('pA', 200, 0);
      pm.recordContribution('pB', 500, 1);
      pm.recordContribution('pC', 500, 2);
      pm.setPlayerAllIn('pA', true);
      pm.setPlayerAllIn('pB', true);

      // pB has Full House (beats pA Flush and pC High Card)
      const hands = [
        { playerId: 'pA', seatIndex: 0, hand: evaluate5CardHand(['2h', '5h', '7h', '9h', 'Kh']) }, // Flush
        { playerId: 'pB', seatIndex: 1, hand: evaluate5CardHand(['10s', '10h', '10d', '4c', '4d']) }, // Full House
        { playerId: 'pC', seatIndex: 2, hand: evaluate5CardHand(['As', 'Kd', '9s', '5c', '3h']) } // High Card
      ];

      const res = pm.settle(hands, 0);
      assert.equal(res.totalAwarded, 1200);

      const pBWon = res.payouts.filter(p => p.playerId === 'pB').reduce((s, p) => s + p.amount, 0);
      assert.equal(pBWon, 1200, 'pB must win all 1200 chips across both pots');
    });

    it('settleUncontested(): should award entire pot to single survivor on fold', () => {
      const pm = new PokerPotManager(6);
      pm.recordContribution('p1', 100, 0);
      pm.recordContribution('p2', 100, 1);
      pm.recordContribution('p3', 100, 2);
      pm.setPlayerFolded('p2', true);
      pm.setPlayerFolded('p3', true);

      const res = pm.settleUncontested('p1');
      assert.equal(res.totalAwarded, 300);
      assert.equal(res.payouts[0].playerId, 'p1');
      assert.equal(res.payouts[0].amount, 300);
    });

    it('settle(): should distribute orphaned side pot chips to remaining active showdown contenders when higher-tier bettor folds', () => {
      const pm = new PokerPotManager(6);
      pm.recordContribution('p0', 100, 0);
      pm.setPlayerAllIn('p0', true);

      pm.recordContribution('p1', 500, 1);
      pm.setPlayerFolded('p1', true); // Folded higher-tier bettor

      pm.recordContribution('p2', 100, 2); // Active caller

      const totalCommitted = 700;
      const hands = [
        { playerId: 'p0', seatIndex: 0, hand: evaluate5CardHand(['As', 'Ah', 'Kd', 'Qc', 'Jd']) }, // Pair of Aces
        { playerId: 'p2', seatIndex: 2, hand: evaluate5CardHand(['Ks', 'Kh', 'Qd', 'Jc', '10d']) }  // Pair of Kings
      ];

      const res = pm.settle(hands, 0);

      // Verify 100% chip conservation
      assert.equal(res.totalAwarded, totalCommitted);
      const p0Won = res.payouts.filter(p => p.playerId === 'p0').reduce((s, p) => s + p.amount, 0);
      const p2Won = res.payouts.filter(p => p.playerId === 'p2').reduce((s, p) => s + p.amount, 0);

      // Main pot (300) won by p0 (Pair of Aces)
      // Side pot (400) split evenly between p0 (200) and p2 (200)
      assert.equal(p0Won, 500);
      assert.equal(p2Won, 200);
      assert.equal(p0Won + p2Won, totalCommitted);
    });
  });
});
