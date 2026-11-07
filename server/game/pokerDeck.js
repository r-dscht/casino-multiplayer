/**
 * pokerDeck.js
 * Cryptographically secure standard 52-card poker deck with Fisher-Yates shuffle,
 * official Texas Hold'em burn-card mechanics, and hole/community dealing.
 */

const crypto = require('crypto');
const { SUITS, RANKS, RANK_VALUES } = require('./pokerConstants');

const SUIT_TO_CODE = Object.freeze({
  hearts: 'h',
  diamonds: 'd',
  clubs: 'c',
  spades: 's'
});

class PokerDeck {
  constructor() {
    /** @type {Array<{ id: string, suit: string, suitCode: string, rank: string, value: number }>} */
    this.cards = [];
    /** @type {Array<Object>} */
    this.burnedCards = [];

    this.reset();
  }

  /**
   * Initializes the standard 52-card deck and performs a cryptographic shuffle.
   */
  reset() {
    this.cards = [];
    this.burnedCards = [];

    for (const suit of SUITS) {
      const suitCode = SUIT_TO_CODE[suit];
      for (const rank of RANKS) {
        const value = RANK_VALUES[rank];
        this.cards.push({
          id: `${suitCode}_${value}`,
          suit,
          suitCode,
          rank,
          value
        });
      }
    }

    this.shuffle();
    return this;
  }

  /**
   * Cryptographically secure Fisher-Yates shuffle using Node.js crypto.randomInt.
   */
  shuffle() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      const temp = this.cards[i];
      this.cards[i] = this.cards[j];
      this.cards[j] = temp;
    }
    return this;
  }

  /**
   * Draws a single card from the top of the deck.
   * @returns {{ id: string, suit: string, suitCode: string, rank: string, value: number }}
   */
  draw() {
    if (this.cards.length === 0) {
      throw new Error('Deck is depleted');
    }
    return this.cards.pop();
  }

  /**
   * Burns (discards) 1 card face down prior to dealing community streets.
   * @returns {Object} The burned card.
   */
  burnCard() {
    const burned = this.draw();
    this.burnedCards.push(burned);
    return burned;
  }

  /**
   * Deals 2 private hole cards.
   * If count is provided and > 1, deals 2 cards each for `count` players.
   * Otherwise deals 2 cards for a single player.
   * @param {number} [count=1] Number of player hands to deal.
   * @returns {Array<Object>|Array<Array<Object>>}
   */
  dealHoleCards(count = 1) {
    if (count > 1) {
      // Deal in clockwise rotation standard poker dealing (1 card to each, then 2nd card to each)
      const hands = Array.from({ length: count }, () => []);
      for (let round = 0; round < 2; round++) {
        for (let i = 0; i < count; i++) {
          hands[i].push(this.draw());
        }
      }
      return hands;
    }
    return [this.draw(), this.draw()];
  }

  /**
   * Deals `count` community cards face up.
   * @param {number} count Number of community cards to deal.
   * @returns {Array<Object>}
   */
  dealCommunityCards(count) {
    const cards = [];
    for (let i = 0; i < count; i++) {
      cards.push(this.draw());
    }
    return cards;
  }

  /**
   * Number of cards remaining in the deck.
   * @returns {number}
   */
  remainingCardsCount() {
    return this.cards.length;
  }

  /**
   * Alias for remainingCardsCount.
   * @returns {number}
   */
  cardsRemaining() {
    return this.cards.length;
  }

  /**
   * Alias for remainingCardsCount.
   * @returns {number}
   */
  getRemainingCards() {
    return this.cards.length;
  }
}

module.exports = PokerDeck;
