const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluate5CardHand,
  evaluate7CardHand,
  compareHands,
  compareVectors,
  determineWinners,
  getStraightHighRank,
  normalizeCard,
  HAND_RANKS
} = require('../../server/game/pokerRules');

describe('PokerRules Unit Tests (7-Card Hand Evaluator & Tie-Breakers)', () => {
  describe('Card Normalization & String Notation', () => {
    it('should parse string notations like "As", "10h", "Kd", "2c"', () => {
      const c1 = normalizeCard('As');
      assert.equal(c1.rank, 'A');
      assert.equal(c1.suit, 'spades');
      assert.equal(c1.value, 14);

      const c2 = normalizeCard('10h');
      assert.equal(c2.rank, '10');
      assert.equal(c2.suit, 'hearts');
      assert.equal(c2.value, 10);

      const c3 = normalizeCard('Kd');
      assert.equal(c3.rank, 'K');
      assert.equal(c3.suit, 'diamonds');
      assert.equal(c3.value, 13);
    });

    it('should normalize card objects', () => {
      const c = normalizeCard({ suit: 'clubs', rank: 'J' });
      assert.equal(c.value, 11);
      assert.equal(c.suitCode, 'c');
    });
  });

  describe('All 10 Hand Categories (0..9)', () => {
    it('should evaluate Category 9: Royal Flush', () => {
      const hand = ['As', 'Ks', 'Qs', 'Js', '10s'];
      const res = evaluate5CardHand(hand);
      assert.equal(res.category, HAND_RANKS.ROYAL_FLUSH);
      assert.equal(res.category, 9);
      assert.equal(res.rankName, 'ROYAL_FLUSH');
      assert.deepEqual(res.scoreVector, [9, 14, 0, 0, 0, 0]);
    });

    it('should evaluate Category 8: Straight Flush (King High and Wheel Steel)', () => {
      // King-high Straight Flush
      const kHigh = ['Kh', 'Qh', 'Jh', '10h', '9h'];
      const resK = evaluate5CardHand(kHigh);
      assert.equal(resK.category, HAND_RANKS.STRAIGHT_FLUSH);
      assert.equal(resK.category, 8);
      assert.deepEqual(resK.scoreVector, [8, 13, 0, 0, 0, 0]);

      // Ace-low 5-high Steel Wheel Straight Flush (Ac-2c-3c-4c-5c)
      const wheelSf = ['5c', '4c', '3c', '2c', 'Ac'];
      const resWheel = evaluate5CardHand(wheelSf);
      assert.equal(resWheel.category, HAND_RANKS.STRAIGHT_FLUSH);
      assert.deepEqual(resWheel.scoreVector, [8, 5, 0, 0, 0, 0]);
    });

    it('should evaluate Category 7: Four of a Kind', () => {
      const quads = ['8s', '8h', '8d', '8c', 'Ah'];
      const res = evaluate5CardHand(quads);
      assert.equal(res.category, HAND_RANKS.FOUR_OF_A_KIND);
      assert.equal(res.category, 7);
      assert.deepEqual(res.scoreVector, [7, 8, 14, 0, 0, 0]);
    });

    it('should evaluate Category 6: Full House', () => {
      const fullHouse = ['10s', '10h', '10d', '4c', '4d'];
      const res = evaluate5CardHand(fullHouse);
      assert.equal(res.category, HAND_RANKS.FULL_HOUSE);
      assert.equal(res.category, 6);
      assert.deepEqual(res.scoreVector, [6, 10, 4, 0, 0, 0]);
    });

    it('should evaluate Category 5: Flush', () => {
      const flush = ['Kd', 'Jd', '9d', '6d', '2d'];
      const res = evaluate5CardHand(flush);
      assert.equal(res.category, HAND_RANKS.FLUSH);
      assert.equal(res.category, 5);
      assert.deepEqual(res.scoreVector, [5, 13, 11, 9, 6, 2]);
    });

    it('should evaluate Category 4: Straight', () => {
      const straight = ['9s', '8h', '7d', '6c', '5s'];
      const res = evaluate5CardHand(straight);
      assert.equal(res.category, HAND_RANKS.STRAIGHT);
      assert.equal(res.category, 4);
      assert.deepEqual(res.scoreVector, [4, 9, 0, 0, 0, 0]);
    });

    it('should evaluate Category 3: Three of a Kind', () => {
      const trips = ['Qh', 'Qd', 'Qs', 'Ac', '8s'];
      const res = evaluate5CardHand(trips);
      assert.equal(res.category, HAND_RANKS.THREE_OF_A_KIND);
      assert.equal(res.category, 3);
      assert.deepEqual(res.scoreVector, [3, 12, 14, 8, 0, 0]);
    });

    it('should evaluate Category 2: Two Pair', () => {
      const twoPair = ['Ah', 'As', '4c', '4d', 'Jc'];
      const res = evaluate5CardHand(twoPair);
      assert.equal(res.category, HAND_RANKS.TWO_PAIR);
      assert.equal(res.category, 2);
      assert.deepEqual(res.scoreVector, [2, 14, 4, 11, 0, 0]);
    });

    it('should evaluate Category 1: One Pair', () => {
      const onePair = ['8s', '8h', 'Ad', 'Kc', '2s'];
      const res = evaluate5CardHand(onePair);
      assert.equal(res.category, HAND_RANKS.ONE_PAIR);
      assert.equal(res.category, 1);
      assert.deepEqual(res.scoreVector, [1, 8, 14, 13, 2, 0]);
    });

    it('should evaluate Category 0: High Card', () => {
      const highCard = ['Ah', 'Kd', '9s', '5c', '3h'];
      const res = evaluate5CardHand(highCard);
      assert.equal(res.category, HAND_RANKS.HIGH_CARD);
      assert.equal(res.category, 0);
      assert.deepEqual(res.scoreVector, [0, 14, 13, 9, 5, 3]);
    });
  });

  describe('Straight Rules, Wheel Straights & Wraparound Rejection', () => {
    it('should evaluate Broadway straight (10-J-Q-K-A) as 14-high', () => {
      const broadway = ['10s', 'Jh', 'Qd', 'Kc', 'Ah'];
      const res = evaluate5CardHand(broadway);
      assert.equal(res.category, HAND_RANKS.STRAIGHT);
      assert.deepEqual(res.scoreVector, [4, 14, 0, 0, 0, 0]);
    });

    it('should evaluate Wheel straight (A-2-3-4-5) as 5-high', () => {
      const wheel = ['5s', '4h', '3d', '2c', 'Ah'];
      const res = evaluate5CardHand(wheel);
      assert.equal(res.category, HAND_RANKS.STRAIGHT);
      assert.deepEqual(res.scoreVector, [4, 5, 0, 0, 0, 0]);
    });

    it('should confirm higher straight beats wheel straight (6-high beats 5-high wheel)', () => {
      const sixHigh = ['6s', '5h', '4d', '3c', '2h'];
      const wheel = ['5s', '4h', '3d', '2c', 'Ah'];
      assert.ok(compareHands(sixHigh, wheel) > 0, '6-high straight must beat 5-high wheel straight');
    });

    it('should reject invalid wraparound sequences like Q-K-A-2-3 and K-A-2-3-4', () => {
      const wrap1 = ['Qh', 'Kd', 'As', '2c', '3h'];
      const res1 = evaluate5CardHand(wrap1);
      assert.notEqual(res1.category, HAND_RANKS.STRAIGHT);
      assert.equal(res1.category, HAND_RANKS.HIGH_CARD);

      const wrap2 = ['Kh', 'As', '2c', '3d', '4h'];
      const res2 = evaluate5CardHand(wrap2);
      assert.notEqual(res2.category, HAND_RANKS.STRAIGHT);
      assert.equal(res2.category, HAND_RANKS.HIGH_CARD);
    });
  });

  describe('Rank Hierarchy Comparisons', () => {
    it('Flush strictly beats Straight', () => {
      const flush = ['2h', '5h', '7h', '9h', 'Kh'];
      const straight = ['10s', 'Jh', 'Qd', 'Kc', 'Ah'];
      assert.ok(compareHands(flush, straight) > 0);
      assert.ok(compareHands(straight, flush) < 0);
    });

    it('Full House strictly beats Flush', () => {
      const fullHouse = ['2s', '2h', '2d', '3c', '3d'];
      const flush = ['Ah', 'Kh', 'Qh', 'Jh', '9h'];
      assert.ok(compareHands(fullHouse, flush) > 0);
    });

    it('Four of a Kind strictly beats Full House', () => {
      const quads = ['2s', '2h', '2d', '2c', '3h'];
      const fullHouse = ['As', 'Ah', 'Ad', 'Kc', 'Kd'];
      assert.ok(compareHands(quads, fullHouse) > 0);
    });
  });

  describe('Kicker Comparisons & Tie-Breakers', () => {
    it('Full House: higher trips wins regardless of pair', () => {
      const aTrips = ['As', 'Ah', 'Ad', '2c', '2d']; // AAA-22
      const kTrips = ['Ks', 'Kh', 'Kd', 'Ac', 'Ad']; // KKK-AA
      assert.ok(compareHands(aTrips, kTrips) > 0, 'Aces full of Deuces beats Kings full of Aces');
    });

    it('Full House: same trips, higher pair wins', () => {
      const pairKings = ['As', 'Ah', 'Ad', 'Kc', 'Kd']; // AAA-KK
      const pairQueens = ['As', 'Ah', 'Ad', 'Qc', 'Qd']; // AAA-QQ
      assert.ok(compareHands(pairKings, pairQueens) > 0, 'AAA-KK beats AAA-QQ');
    });

    it('Two Pair: compares high pair, then low pair, then kicker', () => {
      const hand1 = ['Ah', 'As', 'Kh', 'Ks', 'Qd']; // AA-KK with Q
      const hand2 = ['Ah', 'As', 'Kh', 'Ks', 'Jd']; // AA-KK with J
      assert.ok(compareHands(hand1, hand2) > 0, 'Higher kicker wins when pairs are equal');

      const hand3 = ['Ah', 'As', 'Qh', 'Qs', 'Kd']; // AA-QQ with K
      assert.ok(compareHands(hand1, hand3) > 0, 'Higher second pair wins');
    });

    it('One Pair: compares pair, then 3 descending kickers', () => {
      const h1 = ['10s', '10h', 'As', 'Kd', '8c'];
      const h2 = ['10s', '10h', 'As', 'Kd', '7c'];
      assert.ok(compareHands(h1, h2) > 0, '3rd kicker breaks tie');
    });

    it('High Card: compares all 5 cards in descending order', () => {
      const h1 = ['As', 'Kd', 'Jc', '8h', '4s'];
      const h2 = ['As', 'Kd', 'Jc', '8h', '3s'];
      assert.ok(compareHands(h1, h2) > 0, '5th card kicker breaks tie');
    });

    it('Identical hands result in exact tie (0)', () => {
      const h1 = ['As', 'Kd', 'Jc', '8h', '4s'];
      const h2 = ['Ah', 'Kc', 'Jd', '8s', '4d'];
      assert.equal(compareHands(h1, h2), 0);
    });
  });

  describe('Authoritative 7-Card Hand Evaluation (C(7,5)=21)', () => {
    it('should select the best 5 cards out of 7 total cards', () => {
      const holeCards = ['Ah', 'Kd'];
      const communityCards = ['10h', 'Jh', 'Qh', '2c', '3d'];
      // Best 5 cards: Broadway Straight (10h-Jh-Qh-Kd-Ah)
      const res = evaluate7CardHand(holeCards, communityCards);
      assert.equal(res.category, HAND_RANKS.STRAIGHT);
      assert.deepEqual(res.scoreVector, [4, 14, 0, 0, 0, 0]);
      assert.equal(res.best5Cards.length, 5);
    });

    it('should detect a full house from 7 cards when trips and 2 pairs are present', () => {
      const holeCards = ['As', 'Ah'];
      const community = ['Ac', 'Kh', 'Kd', 'Qc', 'Qd'];
      // Can make AAA-KK or AAA-QQ. Best is AAA-KK.
      const res = evaluate7CardHand(holeCards, community);
      assert.equal(res.category, HAND_RANKS.FULL_HOUSE);
      assert.deepEqual(res.scoreVector, [6, 14, 13, 0, 0, 0]);
    });

    it('should play the board if the 5 community cards form the best hand', () => {
      const holeCards = ['2s', '3s'];
      const community = ['Ah', 'Kh', 'Qh', 'Jh', '10h']; // Royal Flush on board
      const res = evaluate7CardHand(holeCards, community);
      assert.equal(res.category, HAND_RANKS.ROYAL_FLUSH);
      assert.deepEqual(res.scoreVector, [9, 14, 0, 0, 0, 0]);
    });
  });

  describe('determineWinners()', () => {
    it('should determine single winner in multi-player showdown', () => {
      const community = ['10h', 'Jh', 'Qh', '2c', '3d'];
      const players = [
        { playerId: 'p1', seatIndex: 0, holeCards: ['Ah', 'Kd'] }, // Straight
        { playerId: 'p2', seatIndex: 1, holeCards: ['Kh', '2h'] }, // Flush (Jh, Qh, 10h, Kh, 2h)
        { playerId: 'p3', seatIndex: 2, holeCards: ['2d', '3c'] }  // Two Pair
      ];

      const res = determineWinners(players, community);
      assert.equal(res.winners.length, 1);
      assert.equal(res.winners[0].playerId, 'p2');
      assert.equal(res.winners[0].hand.category, HAND_RANKS.FLUSH);
    });

    it('should detect split pot when two players tie for the best hand', () => {
      const community = ['As', 'Ks', 'Qd', 'Jc', '10h']; // Broadway straight on board
      const players = [
        { playerId: 'p1', seatIndex: 0, holeCards: ['2c', '3c'] },
        { playerId: 'p2', seatIndex: 1, holeCards: ['4d', '5d'] }
      ];

      const res = determineWinners(players, community);
      assert.equal(res.winners.length, 2);
      assert.equal(res.winners[0].hand.category, HAND_RANKS.STRAIGHT);
      assert.equal(res.winners[1].hand.category, HAND_RANKS.STRAIGHT);
    });
  });
});
