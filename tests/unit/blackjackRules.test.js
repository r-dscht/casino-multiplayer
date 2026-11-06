const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateHandValue,
  canHit,
  canStand,
  canDouble,
  canSplit,
  shouldDealerHit,
  evaluateHandResult
} = require('../../server/game/blackjackRules');

describe('BlackjackRules Unit Tests', () => {
  describe('Dynamic Ace Valuation & Hand Scoring', () => {
    it('should score an empty hand as 0', () => {
      const res = calculateHandValue([]);
      assert.equal(res.value, 0);
      assert.equal(res.isSoft, false);
      assert.equal(res.isBust, false);
      assert.equal(res.isBlackjack, false);
    });

    it('should score hard hands correctly', () => {
      const hand = [{ rank: '10' }, { rank: '7' }];
      const res = calculateHandValue(hand);
      assert.equal(res.value, 17);
      assert.equal(res.isSoft, false);
      assert.equal(res.isBust, false);
      assert.equal(res.isBlackjack, false);
    });

    it('should score natural Blackjack (Ace + 10-value card)', () => {
      const hand = [{ rank: 'A' }, { rank: 'K' }];
      const res = calculateHandValue(hand);
      assert.equal(res.value, 21);
      assert.equal(res.isSoft, true);
      assert.equal(res.isBlackjack, true);
      assert.equal(res.isBust, false);
    });

    it('should score 3-card 21 as non-natural blackjack', () => {
      const hand = [{ rank: '7' }, { rank: '7' }, { rank: '7' }];
      const res = calculateHandValue(hand);
      assert.equal(res.value, 21);
      assert.equal(res.isBlackjack, false);
      assert.equal(res.isBust, false);
    });

    it('should dynamically convert Ace from 11 to 1 when exceeding 21 (Edge Case 1)', () => {
      // [A, 5] -> 16 (soft)
      const hand = [{ rank: 'A' }, { rank: '5' }];
      let res = calculateHandValue(hand);
      assert.equal(res.value, 16);
      assert.equal(res.isSoft, true);

      // Hit '9' -> total 25 without reduction, converted to 15 (hard)
      hand.push({ rank: '9' });
      res = calculateHandValue(hand);
      assert.equal(res.value, 15);
      assert.equal(res.isSoft, false);
      assert.equal(res.isBust, false);

      // Hit '6' -> 21 (hard 21)
      hand.push({ rank: '6' });
      res = calculateHandValue(hand);
      assert.equal(res.value, 21);
      assert.equal(res.isSoft, false);
      assert.equal(res.isBust, false);
    });

    it('should handle pairs of Aces correctly (Edge Case 2)', () => {
      // [A, A] -> 12 (soft: 11 + 1)
      const hand = [{ rank: 'A' }, { rank: 'A' }];
      let res = calculateHandValue(hand);
      assert.equal(res.value, 12);
      assert.equal(res.isSoft, true);

      // Hit '9' -> 21 (soft 21: 11 + 1 + 9)
      hand.push({ rank: '9' });
      res = calculateHandValue(hand);
      assert.equal(res.value, 21);
      assert.equal(res.isSoft, true);
    });

    it('should handle quadruple Aces and reduction (Edge Case 3)', () => {
      // [A, A, A, A] -> 14 (soft: 11 + 1 + 1 + 1)
      const hand = [{ rank: 'A' }, { rank: 'A' }, { rank: 'A' }, { rank: 'A' }];
      let res = calculateHandValue(hand);
      assert.equal(res.value, 14);
      assert.equal(res.isSoft, true);

      // Hit '8' -> 22 -> first Ace converts to 1 -> 12 (hard: 1 + 1 + 1 + 1 + 8)
      hand.push({ rank: '8' });
      res = calculateHandValue(hand);
      assert.equal(res.value, 12);
      assert.equal(res.isSoft, false);
      assert.equal(res.isBust, false);
    });

    it('should detect busts correctly when total exceeds 21', () => {
      const hand = [{ rank: '10' }, { rank: '7' }, { rank: '5' }];
      const res = calculateHandValue(hand);
      assert.equal(res.value, 22);
      assert.equal(res.isBust, true);
    });
  });

  describe('Action Eligibility (Hit, Stand, Double, Split)', () => {
    it('canHit should allow hitting active hands under 21', () => {
      assert.equal(canHit({ cards: [{ rank: '10' }, { rank: '6' }] }), true);
      assert.equal(canHit({ cards: [{ rank: '10' }, { rank: 'A' }] }), false); // 21
      assert.equal(canHit({ cards: [{ rank: '10' }, { rank: '6' }, { rank: '7' }] }), false); // 23 bust
      assert.equal(canHit({ cards: [{ rank: '8' }], status: 'stood' }), false);
      assert.equal(canHit({ cards: [{ rank: 'A' }, { rank: '9' }], isSplitAces: true }), false);
    });

    it('canStand should allow standing on non-busted active hands', () => {
      assert.equal(canStand({ cards: [{ rank: '10' }, { rank: '6' }] }), true);
      assert.equal(canStand({ cards: [{ rank: '10' }, { rank: '6' }, { rank: '7' }] }), false); // bust
      assert.equal(canStand({ cards: [{ rank: '10' }], status: 'stood' }), false);
    });

    it('canDouble should only allow on 2 cards with sufficient balance', () => {
      const hand = { cards: [{ rank: '5' }, { rank: '6' }], bet: 100 };
      assert.equal(canDouble(hand, 500), true);
      assert.equal(canDouble(hand, 50), false, 'Insufficient chips');

      // 3 cards not allowed
      const hand3Cards = { cards: [{ rank: '5' }, { rank: '4' }, { rank: '2' }], bet: 100 };
      assert.equal(canDouble(hand3Cards, 500), false);

      // Already doubled not allowed
      const handDoubled = { cards: [{ rank: '5' }, { rank: '6' }], bet: 200, doubled: true };
      assert.equal(canDouble(handDoubled, 500), false);
    });

    it('canSplit should allow matching ranks or matching 10-value cards', () => {
      // Matching rank [8, 8]
      assert.equal(canSplit({ cards: [{ rank: '8' }, { rank: '8' }], bet: 100 }, 200), true);
      // Different 10-value ranks [10, K]
      assert.equal(canSplit({ cards: [{ rank: '10' }, { rank: 'K' }], bet: 100 }, 200), true);
      // Mismatched cards [10, 9]
      assert.equal(canSplit({ cards: [{ rank: '10' }, { rank: '9' }], bet: 100 }, 200), false);
      // Insufficient chips
      assert.equal(canSplit({ cards: [{ rank: '8' }, { rank: '8' }], bet: 100 }, 50), false);
      // Max 1 split (already 2 hands)
      assert.equal(canSplit({ cards: [{ rank: '8' }, { rank: '8' }], bet: 100 }, 200, 2), false);
    });
  });

  describe('Dealer S17 Rules', () => {
    it('should require dealer to hit on soft 16 or lower', () => {
      // Hard 16
      assert.equal(shouldDealerHit([{ rank: '10' }, { rank: '6' }]), true);
      // Soft 16 [A, 5]
      assert.equal(shouldDealerHit([{ rank: 'A' }, { rank: '5' }]), true);
      // 15
      assert.equal(shouldDealerHit([{ rank: '9' }, { rank: '6' }]), true);
    });

    it('should require dealer to STAND on Soft 17 and Hard 17 under S17 rule', () => {
      // Soft 17 [A, 6]
      assert.equal(shouldDealerHit([{ rank: 'A' }, { rank: '6' }]), false);
      // Multi-Ace Soft 17 [A, A, 5]
      assert.equal(shouldDealerHit([{ rank: 'A' }, { rank: 'A' }, { rank: '5' }]), false);
      // Hard 17 [10, 7]
      assert.equal(shouldDealerHit([{ rank: '10' }, { rank: '7' }]), false);
      // 18
      assert.equal(shouldDealerHit([{ rank: '10' }, { rank: '8' }]), false);
    });
  });

  describe('Authoritative Payout Resolutions', () => {
    it('should pay 3:2 (+1.5x profit, 2.5x gross) for Natural Blackjack against non-BJ', () => {
      const pHand = [{ rank: 'A' }, { rank: 'K' }];
      const dHand = [{ rank: '10' }, { rank: '7' }, { rank: '4' }]; // dealer 21 with 3 cards
      const res = evaluateHandResult(pHand, dHand, 100);
      assert.equal(res.outcome, 'BLACKJACK');
      assert.equal(res.multiplier, 2.5);
      assert.equal(res.gross, 250);
      assert.equal(res.profit, 150);
    });

    it('should resolve Natural Blackjack vs Natural Blackjack to PUSH', () => {
      const pHand = [{ rank: 'A' }, { rank: 'K' }];
      const dHand = [{ rank: 'A' }, { rank: 'Q' }];
      const res = evaluateHandResult(pHand, dHand, 100);
      assert.equal(res.outcome, 'PUSH');
      assert.equal(res.multiplier, 1.0);
      assert.equal(res.gross, 100);
      assert.equal(res.profit, 0);
    });

    it('should pay 1:1 on 3-card 21 or split 21, NOT 3:2', () => {
      // Split 21
      const pHand = { cards: [{ rank: 'A' }, { rank: 'K' }], isSplitHand: true, bet: 100 };
      const dHand = [{ rank: '10' }, { rank: '9' }]; // dealer 19
      const res = evaluateHandResult(pHand, dHand, 100);
      assert.equal(res.outcome, 'WIN');
      assert.equal(res.multiplier, 2.0);
      assert.equal(res.gross, 200);
      assert.equal(res.profit, 100);
    });

    it('should pay 1:1 if dealer busts and player does not bust', () => {
      const pHand = [{ rank: '10' }, { rank: '3' }]; // 13
      const dHand = [{ rank: '10' }, { rank: '6' }, { rank: '8' }]; // 24 bust
      const res = evaluateHandResult(pHand, dHand, 100);
      assert.equal(res.outcome, 'WIN');
      assert.equal(res.gross, 200);
      assert.equal(res.profit, 100);
    });

    it('should forfeit bet (gross: 0, profit: -bet) if player busts', () => {
      const pHand = [{ rank: '10' }, { rank: '6' }, { rank: '7' }]; // 23 bust
      const dHand = [{ rank: '10' }, { rank: '7' }];
      const res = evaluateHandResult(pHand, dHand, 100);
      assert.equal(res.outcome, 'LOSE');
      assert.equal(res.gross, 0);
      assert.equal(res.profit, -100);
    });

    it('should resolve equal hand totals to PUSH (1.0x gross)', () => {
      const pHand = [{ rank: '10' }, { rank: '8' }]; // 18
      const dHand = [{ rank: '9' }, { rank: '9' }];   // 18
      const res = evaluateHandResult(pHand, dHand, 100);
      assert.equal(res.outcome, 'PUSH');
      assert.equal(res.gross, 100);
      assert.equal(res.profit, 0);
    });
  });
});
