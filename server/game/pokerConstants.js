/**
 * pokerConstants.js
 * Authoritative constants, phase definitions, hand rankings, and stakes for 6-Seat No-Limit Texas Hold'em.
 * Monte Carlo Luxury Royale: 6 Physical Seats, 15s Turn Timer, Authoritative NL Rules.
 */

const NUM_SEATS = 6;
const MAX_SEATS = 6;

const DEFAULT_STAKES = Object.freeze({
  SMALL_BLIND: 50,
  BIG_BLIND: 100,
  MIN_BUY_IN: 2000, // 20 * BB
  DEFAULT_BUY_IN: 2000, // 2k entry (20 * BB standard entry)
  MAX_BUY_IN: 10000 // 100 * BB
});

const TABLE_PRESETS = Object.freeze({
  LOW: { name: 'Low Stakes', smallBlind: 10, bigBlind: 20, minBuyIn: 400, defaultBuyIn: 1000, maxBuyIn: 2000 },
  STANDARD: { name: 'Standard Stakes', smallBlind: 25, bigBlind: 50, minBuyIn: 1000, defaultBuyIn: 2500, maxBuyIn: 5000 },
  DEFAULT: { name: 'Monte Carlo Grand', smallBlind: 50, bigBlind: 100, minBuyIn: 2000, defaultBuyIn: 2000, maxBuyIn: 10000 },
  HIGH: { name: 'High Roller', smallBlind: 100, bigBlind: 200, minBuyIn: 4000, defaultBuyIn: 4000, maxBuyIn: 20000 },
  VIP: { name: 'VIP Salon', smallBlind: 500, bigBlind: 1000, minBuyIn: 20000, defaultBuyIn: 20000, maxBuyIn: 100000 }
});

const PHASES = Object.freeze({
  WAITING_FOR_PLAYERS: 'WAITING_FOR_PLAYERS',
  WAITING: 'WAITING_FOR_PLAYERS',
  DEALING: 'DEALING',
  PRE_FLOP: 'PRE_FLOP',
  PREFLOP: 'PRE_FLOP',
  FLOP_DEAL: 'FLOP_DEAL',
  FLOP: 'FLOP',
  TURN_DEAL: 'TURN_DEAL',
  TURN: 'TURN',
  RIVER_DEAL: 'RIVER_DEAL',
  RIVER: 'RIVER',
  SHOWDOWN: 'SHOWDOWN',
  SETTLEMENT: 'SETTLEMENT',
  HAND_END: 'HAND_END',
  BETWEEN_HANDS: 'HAND_END'
});

const PHASE_DURATIONS = Object.freeze({
  [PHASES.WAITING_FOR_PLAYERS]: 0,
  [PHASES.DEALING]: 2,
  [PHASES.PRE_FLOP]: 15,
  [PHASES.FLOP_DEAL]: 1.5,
  [PHASES.FLOP]: 15,
  [PHASES.TURN_DEAL]: 1.5,
  [PHASES.TURN]: 15,
  [PHASES.RIVER_DEAL]: 1.5,
  [PHASES.RIVER]: 15,
  [PHASES.SHOWDOWN]: 3,
  [PHASES.SETTLEMENT]: 2,
  [PHASES.HAND_END]: 3,
  TURN_TIMEOUT: 15,
  SHOWDOWN_DISPLAY: 3,
  BETWEEN_HANDS: 3
});

const ACTIONS = Object.freeze({
  FOLD: 'fold',
  CHECK: 'check',
  CALL: 'call',
  BET: 'bet',
  RAISE: 'raise',
  ALL_IN: 'allin',
  ALLIN: 'allin'
});

const HAND_RANKS = Object.freeze({
  HIGH_CARD: 0,
  ONE_PAIR: 1,
  TWO_PAIR: 2,
  THREE_OF_A_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_OF_A_KIND: 7,
  STRAIGHT_FLUSH: 8,
  ROYAL_FLUSH: 9
});

const HAND_RANK_NAMES = Object.freeze([
  'High Card',
  'One Pair',
  'Two Pair',
  'Three of a Kind',
  'Straight',
  'Flush',
  'Full House',
  'Four of a Kind',
  'Straight Flush',
  'Royal Flush'
]);

const SEAT_STATUS = Object.freeze({
  EMPTY: 'empty',
  SEATED: 'seated',
  PLAYING: 'playing',
  ALL_IN: 'all_in',
  FOLDED: 'folded',
  SITTING_OUT: 'sitting_out'
});

const SUITS = Object.freeze(['hearts', 'diamonds', 'clubs', 'spades']);
const SUIT_CODES = Object.freeze({
  h: 'hearts',
  d: 'diamonds',
  c: 'clubs',
  s: 'spades'
});

const RANKS = Object.freeze(['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']);

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
  J: 11,
  Q: 12,
  K: 13,
  A: 14
});

function getCardColor(suit) {
  return suit === 'hearts' || suit === 'diamonds' ? 'red' : 'black';
}

function getRankValue(rank) {
  if (typeof rank === 'number') return rank;
  return RANK_VALUES[rank] || 0;
}

module.exports = {
  NUM_SEATS,
  MAX_SEATS,
  DEFAULT_STAKES,
  TABLE_PRESETS,
  PHASES,
  PHASE_DURATIONS,
  ACTIONS,
  HAND_RANKS,
  HAND_RANK_NAMES,
  SEAT_STATUS,
  SUITS,
  SUIT_CODES,
  RANKS,
  RANK_VALUES,
  getCardColor,
  getRankValue
};
