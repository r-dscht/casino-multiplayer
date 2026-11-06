/**
 * blackjackDeck.js
 * Cryptographically secure 6-deck shoe with Fisher-Yates shuffle
 * and cut-card penetration tracking (75% threshold).
 */

const crypto = require('crypto');
const {
  SUITS,
  RANKS,
  RANK_VALUES,
  DECK_COUNT,
  SHUFFLE_PENETRATION
} = require('./blackjackConstants');

class BlackjackDeck {
  /**
   * @param {number} [deckCount=6]
   * @param {number} [penetration=0.75]
   */
  constructor(deckCount = DECK_COUNT, penetration = SHUFFLE_PENETRATION) {
    this.deckCount = Math.max(1, parseInt(deckCount, 10) || DECK_COUNT);
    this.penetration = (typeof penetration === 'number' && penetration > 0 && penetration < 1)
      ? penetration
      : SHUFFLE_PENETRATION;

    this.totalCards = this.deckCount * 52;
    this.cutCardThreshold = Math.floor(this.totalCards * (1 - this.penetration));
    /** @type {Array<{ id: string, suit: string, rank: string, value: number }>} */
    this.cards = [];

    this.initShoe();
    this.shuffle();
  }

  /**
   * Builds the multi-deck shoe array of 312 cards.
   */
  initShoe() {
    this.cards = [];
    for (let d = 0; d < this.deckCount; d++) {
      for (const suit of SUITS) {
        for (const rank of RANKS) {
          this.cards.push({
            id: `c_${d}_${suit}_${rank}`,
            suit,
            rank,
            value: RANK_VALUES[rank] || 0
          });
        }
      }
    }
  }

  /**
   * Cryptographic Fisher-Yates shuffle using Node.js crypto.randomInt.
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
   * Draws and removes the top card from the shoe.
   * If shoe is somehow depleted, reinitializes and shuffles immediately.
   * @returns {{ id: string, suit: string, rank: string, value: number }}
   */
  draw() {
    if (this.cards.length === 0) {
      this.initShoe();
      this.shuffle();
    }
    return this.cards.pop();
  }

  /**
   * Number of cards remaining in the shoe.
   * @returns {number}
   */
  cardsRemaining() {
    return this.cards.length;
  }

  /**
   * Alias for cardsRemaining().
   * @returns {number}
   */
  getRemainingCards() {
    return this.cards.length;
  }

  /**
   * True if penetration threshold has been reached (<= 78 cards remaining in 6-deck shoe).
   * @returns {boolean}
   */
  needsReshuffle() {
    return this.cards.length <= this.cutCardThreshold;
  }

  /**
   * Depletion fraction in [0, 1].
   * @returns {number}
   */
  getPenetration() {
    if (this.totalCards === 0) return 1;
    return (this.totalCards - this.cards.length) / this.totalCards;
  }

  /**
   * Cut card threshold (number of cards remaining where reshuffle is triggered).
   * @returns {number}
   */
  getCutCardThreshold() {
    return this.cutCardThreshold;
  }
}

module.exports = BlackjackDeck;
