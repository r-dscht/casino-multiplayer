/**
 * @fileoverview Monte Carlo Hi-Lo Prive constants & house-edge rules.
 * Enforces strict 2% house edge (0.98 TARGET_RTP) on Solo Ladder
 * with zero +EV states and zero auto-bet.
 */

const RANKS = Object.freeze([
  '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'
]);

const RANK_VALUES = Object.freeze({
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  'J': 11,
  'Q': 12,
  'K': 13,
  'A': 14
});

const SUITS = Object.freeze(['spades', 'hearts', 'diamonds', 'clubs']);

const SUIT_SHORT = Object.freeze({
  spades: 'S',
  hearts: 'H',
  diamonds: 'D',
  clubs: 'C'
});

const SUIT_RED = Object.freeze({
  spades: false,
  clubs: false,
  hearts: true,
  diamonds: true
});

/** Strict 2% casino house edge (98% RTP). */
const TARGET_RTP = 0.98;

/** Hard cap on effective EV on extreme near-reshuffle deck states (< 1.00 preserves casino house edge while keeping 2->HIGHER and A->LOWER playable). */
const MAX_EV_CAP = 0.99;

const MIN_BET = 10;
const MAX_BET = 50000;
const MAX_LADDER_POT = 5000000;

/** Solo Ladder skip and half-cashout parameters. */
const MAX_SKIPS_PER_LADDER = 2;
const HALF_CASHOUT_MIN_STREAK = 2;
const HALF_CASHOUT_MIN_POT = 20;

/** Reshuffle deck shoe whenever remaining cards fall below this count. */
const MIN_SHOE_CARDS = 13;

const CARD_TRAIL_LIMIT = 7;
const SLOW_MO_STREAK_THRESHOLD = 4;
const HISTORY_LIMIT = 25;
const RECENT_WINS_LIMIT = 15;
const BIG_WIN_MIN_NET_PROFIT = 200;
const BIG_WIN_MIN_STREAK = 2;

const PREDICTIONS = Object.freeze({
  HIGHER: 'HIGHER',
  EQUAL: 'EQUAL',
  LOWER: 'LOWER'
});

const STREAK_TIERS = Object.freeze([
  Object.freeze({ key: 'START', label: 'START', minStreak: 0, tierIndex: 0 }),
  Object.freeze({ key: 'WARM', label: 'WARM', minStreak: 1, tierIndex: 1 }),
  Object.freeze({ key: 'ON_FIRE', label: 'ON FIRE', minStreak: 3, tierIndex: 2 }),
  Object.freeze({ key: 'ROYALE', label: 'ROYALE', minStreak: 5, tierIndex: 3 })
]);

/**
 * Resolves visual & status streak tier metadata for a given streak count.
 * @param {number} streak
 * @returns {{ key: string, label: string, minStreak: number, tierIndex: number }}
 */
function getStreakTier(streak) {
  const s = Math.max(0, Number(streak) || 0);
  let matched = STREAK_TIERS[0];
  for (const tier of STREAK_TIERS) {
    if (s >= tier.minStreak) {
      matched = tier;
    }
  }
  return matched;
}

module.exports = {
  RANKS,
  RANK_VALUES,
  SUITS,
  SUIT_SHORT,
  SUIT_RED,
  TARGET_RTP,
  MAX_EV_CAP,
  MIN_BET,
  MAX_BET,
  MAX_LADDER_POT,
  MAX_SKIPS_PER_LADDER,
  HALF_CASHOUT_MIN_STREAK,
  HALF_CASHOUT_MIN_POT,
  MIN_SHOE_CARDS,
  CARD_TRAIL_LIMIT,
  SLOW_MO_STREAK_THRESHOLD,
  HISTORY_LIMIT,
  RECENT_WINS_LIMIT,
  BIG_WIN_MIN_NET_PROFIT,
  BIG_WIN_MIN_STREAK,
  PREDICTIONS,
  STREAK_TIERS,
  getStreakTier
};
