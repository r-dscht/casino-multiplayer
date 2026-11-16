/**
 * @fileoverview Cryptographic 52-card shoe & dynamic 94%-RTP Hi-Lo odds engine.
 * Guarantees EV <= MAX_EV_CAP across every shoe state so neither card-counting
 * nor extreme shoe tails ever produce a +EV bet against the house.
 */

const crypto = require('crypto');
const {
  RANKS,
  RANK_VALUES,
  SUITS,
  SUIT_SHORT,
  SUIT_RED,
  TARGET_RTP,
  MAX_EV_CAP,
  PREDICTIONS
} = require('./hiloConstants');

/**
 * Builds a single ordered 52-card deck.
 * @returns {Array<{rank: string, suit: string, value: number, code: string, isRed: boolean}>}
 */
function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        rank,
        suit,
        value: RANK_VALUES[rank],
        code: `${rank}${SUIT_SHORT[suit]}`,
        isRed: Boolean(SUIT_RED[suit])
      });
    }
  }
  return deck;
}

/**
 * Shuffles an array in-place using Node crypto.randomInt (Fisher-Yates).
 * @template T
 * @param {T[]} items
 * @returns {T[]}
 */
function shuffleInPlace(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
  return items;
}

/**
 * Creates a freshly shuffled 52-card shoe.
 * @param {{excludeCode?: string}|null} [excludeCard=null]
 * @returns {Array<{rank: string, suit: string, value: number, code: string, isRed: boolean}>}
 */
function createShuffledDeck(excludeCard = null) {
  let deck = createDeck();
  if (excludeCard && excludeCard.code) {
    deck = deck.filter((c) => c.code !== excludeCard.code);
  }
  return shuffleInPlace(deck);
}

/**
 * Draws the next card from the shoe (returns null if empty).
 * @param {Array} deck
 * @returns {Object|null}
 */
function drawCard(deck) {
  if (!Array.isArray(deck) || deck.length === 0) return null;
  return deck.pop();
}

/**
 * Computes floored multiplier + strict EV guard for a single prediction direction.
 * @param {number} count
 * @param {number} total
 * @param {number} rtp
 * @returns {{available: boolean, count: number, probability: number, pct: number, multiplier: number}}
 */
function buildDirectionOdds(count, total, rtp) {
  if (!total || count <= 0) {
    return {
      available: false,
      count: 0,
      probability: 0,
      pct: 0,
      multiplier: 0
    };
  }

  const probability = count / total;
  const pct = Math.round(probability * 1000) / 10;
  let multiplier = Math.floor((rtp / probability) * 100) / 100;

  // Floor prevents paying > rtp. If < 1.01 (e.g. 2 -> HIGHER has 48/51 = 0.9412),
  // allow 1.01 ONLY if exact EV remains strictly within MAX_EV_CAP (<= 0.96).
  if (multiplier < 1.01) {
    if (probability * 1.01 <= MAX_EV_CAP) {
      multiplier = 1.01;
    } else {
      return {
        available: false,
        count,
        probability,
        pct,
        multiplier: 0
      };
    }
  }

  return {
    available: true,
    count,
    probability,
    pct,
    multiplier
  };
}

/**
 * Calculates exact conditional Hi-Lo multipliers given currentCard and remainingCards.
 * Strict rules:
 *  - HIGHER wins strictly when next.value > current.value
 *  - EQUAL wins strictly when next.value === current.value
 *  - LOWER wins strictly when next.value < current.value
 * @param {{value: number}} currentCard
 * @param {Array<{value: number}>} remainingCards
 * @param {number} [rtp=TARGET_RTP]
 * @returns {{total: number, higher: Object, equal: Object, lower: Object}}
 */
function calculateHiloOdds(currentCard, remainingCards, rtp = TARGET_RTP) {
  if (!currentCard || typeof currentCard.value !== 'number' || !Array.isArray(remainingCards)) {
    const empty = { available: false, count: 0, probability: 0, pct: 0, multiplier: 0 };
    return { total: 0, higher: { ...empty }, equal: { ...empty }, lower: { ...empty } };
  }

  let higherCount = 0;
  let equalCount = 0;
  let lowerCount = 0;

  for (const card of remainingCards) {
    if (card.value > currentCard.value) higherCount++;
    else if (card.value === currentCard.value) equalCount++;
    else lowerCount++;
  }

  const total = remainingCards.length;
  return {
    total,
    higher: buildDirectionOdds(higherCount, total, rtp),
    equal: buildDirectionOdds(equalCount, total, rtp),
    lower: buildDirectionOdds(lowerCount, total, rtp)
  };
}

/**
 * Normalizes UI/socket prediction aliases to canonical keys.
 * @param {string} raw
 * @returns {'HIGHER'|'EQUAL'|'LOWER'|null}
 */
function normalizePrediction(raw) {
  if (typeof raw !== 'string') return null;
  const upper = raw.trim().toUpperCase();
  if (upper === 'HIGHER' || upper === 'HOGER' || upper === 'HIGH' || upper === 'UP') {
    return PREDICTIONS.HIGHER;
  }
  if (upper === 'EQUAL' || upper === 'GELIJK' || upper === 'TIE' || upper === 'SAME') {
    return PREDICTIONS.EQUAL;
  }
  if (upper === 'LOWER' || upper === 'LAGER' || upper === 'LOW' || upper === 'DOWN') {
    return PREDICTIONS.LOWER;
  }
  return null;
}

/**
 * Evaluates a strict Hi-Lo prediction between two cards.
 * Same rank always loses HIGHER and LOWER bets.
 * @param {{value: number}} currentCard
 * @param {{value: number}} nextCard
 * @param {'HIGHER'|'EQUAL'|'LOWER'} prediction
 * @returns {boolean}
 */
function evaluateGuess(currentCard, nextCard, prediction) {
  if (!currentCard || !nextCard) return false;
  if (prediction === PREDICTIONS.HIGHER) return nextCard.value > currentCard.value;
  if (prediction === PREDICTIONS.EQUAL) return nextCard.value === currentCard.value;
  if (prediction === PREDICTIONS.LOWER) return nextCard.value < currentCard.value;
  return false;
}

module.exports = {
  createDeck,
  createShuffledDeck,
  drawCard,
  calculateHiloOdds,
  normalizePrediction,
  evaluateGuess
};
