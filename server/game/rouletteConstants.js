/**
 * rouletteConstants.js
 * European Roulette constants, layout, payouts, and game phases.
 * Single-zero European wheel with 37 pockets (0-36).
 */

const WHEEL_NUMBERS = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];

const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36
]);

const BLACK_NUMBERS = new Set([
  2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35
]);

const GREEN_NUMBERS = new Set([0]);

/**
 * Returns color of pocket: 'green', 'red', 'black', or null if invalid.
 * @param {number} pocket 
 * @returns {'green' | 'red' | 'black' | null}
 */
function getColor(pocket) {
  if (pocket === 0) return 'green';
  if (RED_NUMBERS.has(pocket)) return 'red';
  if (BLACK_NUMBERS.has(pocket)) return 'black';
  return null;
}

const BET_TYPES = {
  STRAIGHT: 'straight',
  SPLIT: 'split',
  STREET: 'street',
  CORNER: 'corner',
  SIX_LINE: 'six_line',
  COLUMN: 'column',
  DOZEN: 'dozen',
  RED: 'red',
  BLACK: 'black',
  EVEN: 'even',
  ODD: 'odd',
  LOW: 'low',
  HIGH: 'high'
};

/**
 * Payout table defining profit odds (X:1) and gross multipliers (X + 1).
 * When player places bet of stake S, stake is deducted from bankroll.
 * On win: Gross return = S * grossMultiplier. Net profit = S * profitRatio.
 */
const PAYOUT_RATIOS = {
  [BET_TYPES.STRAIGHT]: { profitRatio: 35, grossMultiplier: 36 },
  [BET_TYPES.SPLIT]: { profitRatio: 17, grossMultiplier: 18 },
  [BET_TYPES.STREET]: { profitRatio: 11, grossMultiplier: 12 },
  [BET_TYPES.CORNER]: { profitRatio: 8, grossMultiplier: 9 },
  [BET_TYPES.SIX_LINE]: { profitRatio: 5, grossMultiplier: 6 },
  [BET_TYPES.COLUMN]: { profitRatio: 2, grossMultiplier: 3 },
  [BET_TYPES.DOZEN]: { profitRatio: 2, grossMultiplier: 3 },
  [BET_TYPES.RED]: { profitRatio: 1, grossMultiplier: 2 },
  [BET_TYPES.BLACK]: { profitRatio: 1, grossMultiplier: 2 },
  [BET_TYPES.EVEN]: { profitRatio: 1, grossMultiplier: 2 },
  [BET_TYPES.ODD]: { profitRatio: 1, grossMultiplier: 2 },
  [BET_TYPES.LOW]: { profitRatio: 1, grossMultiplier: 2 },
  [BET_TYPES.HIGH]: { profitRatio: 1, grossMultiplier: 2 }
};

const PHASES = {
  BETTING: 'BETTING',
  SPINNING: 'SPINNING',
  PAYOUT: 'PAYOUT'
};

const PHASE_DURATIONS = {
  [PHASES.BETTING]: 20,
  [PHASES.SPINNING]: 9,
  [PHASES.PAYOUT]: 6
};

const STARTING_CHIPS = 10000;
const MAX_HISTORY = 15;
const MIN_BET_AMOUNT = 1;

module.exports = {
  WHEEL_NUMBERS,
  RED_NUMBERS,
  BLACK_NUMBERS,
  GREEN_NUMBERS,
  getColor,
  BET_TYPES,
  PAYOUT_RATIOS,
  PHASES,
  PHASE_DURATIONS,
  STARTING_CHIPS,
  MAX_HISTORY,
  MIN_BET_AMOUNT
};
