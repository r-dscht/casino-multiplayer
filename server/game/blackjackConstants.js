/**
 * blackjackConstants.js
 * Authoritative constants, phase definitions, and payout ratios for Multiplayer Blackjack.
 * Monte Carlo Luxury Royale: 6-Deck Shoe, S17 Dealer Rule, 3:2 Natural Blackjack, 5 Seats.
 */

const SUITS = Object.freeze(['hearts', 'diamonds', 'clubs', 'spades']);
const RANKS = Object.freeze(['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']);

const RANK_VALUES = Object.freeze({
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  'J': 10, 'Q': 10, 'K': 10, 'A': 11
});

const DECK_COUNT = 6;
const CARDS_PER_DECK = 52;
const TOTAL_CARDS = DECK_COUNT * CARDS_PER_DECK; // 312 cards
const SHUFFLE_PENETRATION = 0.75;
const CUT_CARD_THRESHOLD = Math.floor(TOTAL_CARDS * (1 - SHUFFLE_PENETRATION)); // 78 cards remaining

const NUM_SEATS = 6; // Seats 0 through 5
const MAX_SEATS = 6;
const MIN_BET = 10;
const MAX_BET = 100000;

const PHASES = Object.freeze({
  WAITING_FOR_PLAYERS: 'WAITING_FOR_PLAYERS',
  BETTING: 'BETTING',
  DEALING: 'DEALING',
  PLAYER_TURNS: 'PLAYER_TURNS',
  DEALER_TURN: 'DEALER_TURN',
  PAYOUT: 'PAYOUT',
  ROUND_OVER: 'ROUND_OVER'
});

const PHASE_DURATIONS = Object.freeze({
  [PHASES.WAITING_FOR_PLAYERS]: 0,
  [PHASES.BETTING]: 15,
  [PHASES.DEALING]: 2,
  [PHASES.PLAYER_TURNS]: 15,
  TURN_TIMEOUT: 15,
  [PHASES.DEALER_TURN]: 2,
  [PHASES.PAYOUT]: 4,
  [PHASES.ROUND_OVER]: 2
});

const DEALER_RULES = Object.freeze({
  STANDS_ON_SOFT_17: true,
  MIN_STAND_VALUE: 17
});

const PAYOUT_RATIOS = Object.freeze({
  NATURAL_BLACKJACK: 1.5, // 3:2 payout (+1.5x profit, 2.5x gross return)
  BLACKJACK: 1.5,
  WIN: 1.0,               // 1:1 payout (+1.0x profit, 2.0x gross return)
  PUSH: 0.0,              // 0 profit (1.0x gross stake returned)
  INSURANCE: 2.0          // 2:1 payout
});

const ACTIONS = Object.freeze({
  HIT: 'hit',
  STAND: 'stand',
  DOUBLE: 'double',
  SPLIT: 'split'
});

const HAND_STATUS = Object.freeze({
  EMPTY: 'empty',
  BETTING: 'betting',
  ACTIVE: 'active',
  STOOD: 'stood',
  BUSTED: 'busted',
  BLACKJACK: 'blackjack',
  SETTLED: 'settled'
});

const SEAT_STATUS = Object.freeze({
  EMPTY: 'empty',
  SEATED: 'seated',
  BETTING: 'betting',
  PLAYING: 'playing',
  DONE: 'done'
});

function getCardColor(suit) {
  return (suit === 'hearts' || suit === 'diamonds') ? 'red' : 'black';
}

function getRankValue(rank) {
  return RANK_VALUES[rank] || 0;
}

module.exports = {
  SUITS,
  RANKS,
  RANK_VALUES,
  DECK_COUNT,
  CARDS_PER_DECK,
  TOTAL_CARDS,
  SHUFFLE_PENETRATION,
  CUT_CARD_THRESHOLD,
  NUM_SEATS,
  MAX_SEATS,
  MIN_BET,
  MAX_BET,
  PHASES,
  PHASE_DURATIONS,
  DEALER_RULES,
  PAYOUT_RATIOS,
  ACTIONS,
  HAND_STATUS,
  SEAT_STATUS,
  getCardColor,
  getRankValue
};
