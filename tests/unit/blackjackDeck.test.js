const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const BlackjackDeck = require('../../server/game/blackjackDeck');
const { TOTAL_CARDS, CUT_CARD_THRESHOLD, SUITS, RANKS } = require('../../server/game/blackjackConstants');

describe('BlackjackDeck (6-Deck Shoe & Cryptographic Shuffle)', () => {
  it('should initialize a standard 6-deck shoe with exactly 312 cards', () => {
    const deck = new BlackjackDeck(6);
    assert.equal(deck.cardsRemaining(), TOTAL_CARDS);
    assert.equal(deck.cardsRemaining(), 312);
  });

  it('should contain exactly 24 cards of each rank (4 suits x 6 decks)', () => {
    const deck = new BlackjackDeck(6);
    const counts = {};
    for (const card of deck.cards) {
      counts[card.rank] = (counts[card.rank] || 0) + 1;
    }
    for (const rank of RANKS) {
      assert.equal(counts[rank], 24, `Rank ${rank} count must be 24`);
    }
  });

  it('should contain exactly 78 cards of each suit (13 ranks x 6 decks)', () => {
    const deck = new BlackjackDeck(6);
    const suitCounts = {};
    for (const card of deck.cards) {
      suitCounts[card.suit] = (suitCounts[card.suit] || 0) + 1;
    }
    for (const suit of SUITS) {
      assert.equal(suitCounts[suit], 78, `Suit ${suit} count must be 78`);
    }
  });

  it('should shuffle cards in-place with cryptographic Fisher-Yates shuffle', () => {
    const deck1 = new BlackjackDeck(6);
    const deck2 = new BlackjackDeck(6);
    // Two independent shuffles should not have identical card order
    const ids1 = deck1.cards.map(c => c.id).join(',');
    const ids2 = deck2.cards.map(c => c.id).join(',');
    assert.notEqual(ids1, ids2, 'Cryptographic shuffle should produce distinct sequences');
  });

  it('should draw cards and decrease remaining count', () => {
    const deck = new BlackjackDeck(6);
    const card = deck.draw();
    assert.ok(card);
    assert.ok(card.rank);
    assert.ok(card.suit);
    assert.equal(deck.cardsRemaining(), 311);
  });

  it('should track penetration and report needsReshuffle when <= cutCardThreshold', () => {
    const deck = new BlackjackDeck(6, 0.75);
    assert.equal(deck.getCutCardThreshold(), CUT_CARD_THRESHOLD);
    assert.equal(deck.getCutCardThreshold(), 78);
    assert.equal(deck.needsReshuffle(), false);

    // Draw cards until 79 remain
    while (deck.cardsRemaining() > 79) {
      deck.draw();
    }
    assert.equal(deck.needsReshuffle(), false);

    // Draw 1 more -> 78 remain (threshold reached)
    deck.draw();
    assert.equal(deck.cardsRemaining(), 78);
    assert.equal(deck.needsReshuffle(), true);
    assert.ok(deck.getPenetration() >= 0.75);
  });
});
