const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const PokerDeck = require('../../server/game/pokerDeck');
const { SUITS, RANKS } = require('../../server/game/pokerConstants');

describe('PokerDeck Unit Tests (52-Card Deck & Cryptographic Dealing)', () => {
  it('should initialize a standard 52-card deck with exact card count', () => {
    const deck = new PokerDeck();
    assert.equal(deck.remainingCardsCount(), 52);
    assert.equal(deck.cardsRemaining(), 52);
    assert.equal(deck.getRemainingCards(), 52);
  });

  it('should contain exactly 13 cards of each suit and 4 cards of each rank', () => {
    const deck = new PokerDeck();
    const suitCounts = {};
    const rankCounts = {};

    for (const card of deck.cards) {
      suitCounts[card.suit] = (suitCounts[card.suit] || 0) + 1;
      rankCounts[card.rank] = (rankCounts[card.rank] || 0) + 1;
    }

    for (const suit of SUITS) {
      assert.equal(suitCounts[suit], 13, `Suit ${suit} must have 13 cards`);
    }

    for (const rank of RANKS) {
      assert.equal(rankCounts[rank], 4, `Rank ${rank} must have 4 cards`);
    }
  });

  it('should have 52 unique card identifiers', () => {
    const deck = new PokerDeck();
    const idSet = new Set(deck.cards.map(c => c.id));
    assert.equal(idSet.size, 52);
  });

  it('should shuffle cards with cryptographic Fisher-Yates shuffle producing distinct sequences', () => {
    const deck1 = new PokerDeck();
    const deck2 = new PokerDeck();
    const seq1 = deck1.cards.map(c => c.id).join(',');
    const seq2 = deck2.cards.map(c => c.id).join(',');
    assert.notEqual(seq1, seq2, 'Independent crypto shuffles should produce different orderings');
  });

  it('should draw cards and decrease remaining count', () => {
    const deck = new PokerDeck();
    const card = deck.draw();
    assert.ok(card.id);
    assert.ok(card.suit);
    assert.ok(card.rank);
    assert.ok(typeof card.value === 'number');
    assert.equal(deck.remainingCardsCount(), 51);
  });

  it('should deal hole cards for 1 player (2 cards) and multiple players', () => {
    const deck = new PokerDeck();
    const singleHand = deck.dealHoleCards();
    assert.equal(singleHand.length, 2);
    assert.equal(deck.remainingCardsCount(), 50);

    const multiHands = deck.dealHoleCards(4);
    assert.equal(multiHands.length, 4);
    for (const hand of multiHands) {
      assert.equal(hand.length, 2);
    }
    assert.equal(deck.remainingCardsCount(), 42); // 50 - 8 = 42
  });

  it('should burn cards and track burned cards array', () => {
    const deck = new PokerDeck();
    const burned = deck.burnCard();
    assert.ok(burned.id);
    assert.equal(deck.burnedCards.length, 1);
    assert.equal(deck.remainingCardsCount(), 51);
  });

  it('should deal community cards for Flop (3), Turn (1), and River (1) with burns', () => {
    const deck = new PokerDeck();
    // 6 players dealt
    const hands = deck.dealHoleCards(6);
    assert.equal(hands.length, 6);
    assert.equal(deck.remainingCardsCount(), 40); // 52 - 12 = 40

    // Burn 1, Deal Flop 3
    deck.burnCard();
    const flop = deck.dealCommunityCards(3);
    assert.equal(flop.length, 3);
    assert.equal(deck.remainingCardsCount(), 36);

    // Burn 1, Deal Turn 1
    deck.burnCard();
    const turn = deck.dealCommunityCards(1);
    assert.equal(turn.length, 1);
    assert.equal(deck.remainingCardsCount(), 34);

    // Burn 1, Deal River 1
    deck.burnCard();
    const river = deck.dealCommunityCards(1);
    assert.equal(river.length, 1);
    assert.equal(deck.remainingCardsCount(), 32);

    assert.equal(deck.burnedCards.length, 3);
  });

  it('should throw when drawing from a depleted deck', () => {
    const deck = new PokerDeck();
    for (let i = 0; i < 52; i++) {
      deck.draw();
    }
    assert.equal(deck.remainingCardsCount(), 0);
    assert.throws(() => deck.draw(), /depleted/);
  });

  it('should reset deck back to 52 cards', () => {
    const deck = new PokerDeck();
    deck.dealHoleCards(6);
    assert.equal(deck.remainingCardsCount(), 40);
    deck.reset();
    assert.equal(deck.remainingCardsCount(), 52);
    assert.equal(deck.burnedCards.length, 0);
  });
});
