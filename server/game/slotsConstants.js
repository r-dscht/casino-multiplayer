/**
 * slotsConstants.js
 * Authoritative configuration, 20 fixed paylines, paytable, 32-stop reel strips,
 * Golden Fever strips, and Wild-aware payline evaluation for Monte Carlo Grand Sovereign Slots.
 */

const SYMBOLS = Object.freeze({
  TEN: '10',
  JACK: 'J',
  QUEEN: 'Q',
  KING: 'K',
  ACE: 'A',
  EMERALD: 'EMERALD',
  GOLD_BARS: 'GOLD_BARS',
  DIAMOND: 'DIAMOND',
  CREST: 'CREST',
  WILD: 'WILD',
  SCATTER: 'SCATTER',
});

// 20 Fixed Paylines across 5 columns (0..4) x 3 rows (0 = top, 1 = center, 2 = bottom)
const PAYLINES = Object.freeze([
  [1, 1, 1, 1, 1], // Payline 1: Center horizontal (Grand Jackpot line)
  [0, 0, 0, 0, 0], // Payline 2: Top horizontal
  [2, 2, 2, 2, 2], // Payline 3: Bottom horizontal
  [0, 1, 2, 1, 0], // Payline 4: V-shape
  [2, 1, 0, 1, 2], // Payline 5: Inverted V
  [0, 0, 1, 2, 2], // Payline 6: Top-left stairs down
  [2, 2, 1, 0, 0], // Payline 7: Bottom-left stairs up
  [1, 2, 2, 2, 1], // Payline 8: Shallow valley
  [1, 0, 0, 0, 1], // Payline 9: Shallow arch
  [1, 0, 1, 2, 1], // Payline 10: Wave up-down
  [1, 2, 1, 0, 1], // Payline 11: Wave down-up
  [0, 1, 0, 1, 0], // Payline 12: Upper zigzag
  [2, 1, 2, 1, 2], // Payline 13: Lower zigzag
  [0, 1, 1, 1, 0], // Payline 14: Upper bowl
  [2, 1, 1, 1, 2], // Payline 15: Lower bowl
  [0, 0, 2, 0, 0], // Payline 16: Top center dip
  [2, 2, 0, 2, 2], // Payline 17: Bottom center peak
  [0, 2, 2, 2, 0], // Payline 18: Deep valley
  [2, 0, 0, 0, 2], // Payline 19: High arch
  [1, 1, 0, 1, 1], // Payline 20: Center peak at reel 2
]);

// Multipliers expressed as multiples of lineBet (= totalBet / 20), calibrated for ~98% RTP (2% house edge)
const PAYTABLE = Object.freeze({
  '10':        { 3: 4,   4: 17,  5: 59 },
  'J':         { 3: 5,   4: 20,  5: 72 },
  'Q':         { 3: 7,   4: 25,  5: 93 },
  'K':         { 3: 9,   4: 32,  5: 132 },
  'A':         { 3: 13,  4: 47,  5: 170 },
  'EMERALD':   { 3: 20,  4: 78,  5: 268 },
  'GOLD_BARS': { 3: 27,  4: 134, 5: 472 },
  'DIAMOND':   { 3: 40,  4: 232, 5: 916 },
  'CREST':     { 2: 4,   3: 92,  4: 465, 5: 1830 },
  'WILD':      { 3: 92,  4: 465, 5: 1830 },
});

// Balanced 32-stop reel strips
const REEL_STRIPS = Object.freeze([
  ['10', 'J', 'Q', '10', 'K', 'A', '10', 'EMERALD', 'J', 'Q', '10', 'GOLD_BARS', 'K', 'A', 'J', 'DIAMOND', '10', 'Q', 'K', 'CREST', 'J', '10', 'WILD', 'Q', 'A', '10', 'SCATTER', 'J', 'K', 'EMERALD', '10', 'Q'],
  ['10', 'J', 'Q', 'K', '10', 'A', 'J', 'EMERALD', 'Q', '10', 'K', 'GOLD_BARS', 'A', 'J', '10', 'DIAMOND', 'Q', 'K', '10', 'CREST', 'J', 'A', 'WILD', '10', 'Q', 'K', 'SCATTER', 'J', '10', 'EMERALD', 'Q', 'A'],
  ['10', 'J', 'Q', '10', 'K', 'A', 'J', 'EMERALD', '10', 'Q', 'K', 'GOLD_BARS', 'J', 'A', '10', 'DIAMOND', 'Q', '10', 'K', 'CREST', 'J', '10', 'WILD', 'Q', 'A', 'K', 'SCATTER', '10', 'J', 'EMERALD', 'Q', '10'],
  ['10', 'J', 'Q', 'K', '10', 'A', 'J', 'EMERALD', 'Q', '10', 'K', 'GOLD_BARS', 'A', '10', 'J', 'DIAMOND', 'K', 'Q', '10', 'CREST', 'A', 'J', 'WILD', '10', 'K', 'Q', 'SCATTER', '10', 'J', 'EMERALD', 'A', '10'],
  ['10', 'J', 'Q', '10', 'K', 'A', 'J', 'EMERALD', '10', 'Q', 'K', 'GOLD_BARS', 'J', 'A', '10', 'DIAMOND', 'Q', 'K', '10', 'CREST', 'J', 'A', 'WILD', '10', 'Q', 'K', 'SCATTER', '10', 'J', 'EMERALD', 'Q', 'A'],
]);

// Charged Golden Fever reel strips: adds Golden Wild stops during active floor events
const GOLDEN_FEVER_REEL_STRIPS = Object.freeze(
  REEL_STRIPS.map((strip, col) => {
    if (col !== 2 && col !== 3) return strip;
    let added = false;
    return strip.map((sym) => {
      if (!added && ['10', 'J', 'Q', 'K'].includes(sym)) {
        added = true;
        return 'WILD';
      }
      return sym;
    });
  })
);

const SCATTER_REWARDS = Object.freeze({
  3: { freeSpins: 10, multiplier: 5 },
  4: { freeSpins: 15, multiplier: 11 },
  5: { freeSpins: 20, multiplier: 21 },
});

const VALID_BETS = Object.freeze([20, 40, 100, 200, 500, 1000, 2500, 5000, 10000]);
const MIN_BET = 20;
const MAX_BET = 10000;
const BONUS_BUY_MULTIPLIER = 30;
const FREE_SPINS_MULTIPLIER = 2;
const GOLDEN_FEVER_MULTIPLIER = 1.25;
const GOLDEN_FEVER_DURATION_MS = 30000;
const JACKPOT_SEED = 10000;
const JACKPOT_CONTRIBUTION_RATE = 0.01;
const NUM_MACHINES = 8;

const MACHINE_NAMES = Object.freeze([
  'Sovereign 01',
  'Imperial 02',
  'Monte Carlo 03',
  'Salle Blanche 04',
  'Riviera 05',
  'Or Noir 06',
  'Diamant 07',
  'Royale 08',
]);

/**
 * Evaluates 5 symbols left-to-right on a payline with Wild substitution.
 * Wild substitutes for any paying symbol except SCATTER.
 * @param {string[]} symbols - 5 symbols from reel 0 to reel 4
 * @param {Object} [paytable=PAYTABLE]
 * @returns {{ symbol: string|null, count: number, payout: number }}
 */
function evaluatePayline(symbols, paytable = PAYTABLE) {
  if (!Array.isArray(symbols) || symbols.length !== 5) {
    return { symbol: null, count: 0, payout: 0 };
  }

  const nonWilds = symbols.filter((s) => s !== 'WILD' && s !== 'SCATTER');
  const candidates = nonWilds.length > 0 ? Array.from(new Set(nonWilds)) : ['WILD'];

  let bestWin = { symbol: null, count: 0, payout: 0 };

  for (const targetSymbol of candidates) {
    let count = 0;
    for (let i = 0; i < 5; i++) {
      const sym = symbols[i];
      if (sym === targetSymbol || sym === 'WILD') {
        count += 1;
      } else {
        break;
      }
    }
    const table = paytable[targetSymbol];
    if (table && table[count]) {
      const payout = table[count];
      if (payout > bestWin.payout) {
        bestWin = { symbol: targetSymbol, count, payout };
      }
    }
  }

  // Also check pure leading WILDs (e.g. WILD, WILD, WILD, 10, 10 pays better as 3x WILD than 4x 10)
  let leadingWilds = 0;
  for (let i = 0; i < 5; i++) {
    if (symbols[i] === 'WILD') leadingWilds += 1;
    else break;
  }
  if (paytable.WILD && paytable.WILD[leadingWilds] && paytable.WILD[leadingWilds] > bestWin.payout) {
    bestWin = { symbol: 'WILD', count: leadingWilds, payout: paytable.WILD[leadingWilds] };
  }

  return bestWin;
}

/**
 * Classifies total spin payout relative to total bet.
 * @param {number} totalWon
 * @param {number} totalBet
 * @param {boolean} [jackpotWon=false]
 * @returns {'JACKPOT'|'MEGA_WIN'|'BIG_WIN'|'NICE_WIN'|'WIN'|'NO_WIN'}
 */
function classifyWinTier(totalWon, totalBet, jackpotWon = false) {
  if (jackpotWon) return 'JACKPOT';
  if (!totalWon || totalWon <= 0) return 'NO_WIN';
  const denom = totalBet > 0 ? totalBet : 1;
  const ratio = totalWon / denom;
  if (ratio >= 50) return 'MEGA_WIN';
  if (ratio >= 20) return 'BIG_WIN';
  if (ratio >= 10) return 'NICE_WIN';
  return 'WIN';
}

module.exports = {
  SYMBOLS,
  PAYLINES,
  PAYTABLE,
  REEL_STRIPS,
  GOLDEN_FEVER_REEL_STRIPS,
  SCATTER_REWARDS,
  VALID_BETS,
  MIN_BET,
  MAX_BET,
  BONUS_BUY_MULTIPLIER,
  FREE_SPINS_MULTIPLIER,
  GOLDEN_FEVER_MULTIPLIER,
  GOLDEN_FEVER_DURATION_MS,
  JACKPOT_SEED,
  JACKPOT_CONTRIBUTION_RATE,
  NUM_MACHINES,
  MACHINE_NAMES,
  evaluatePayline,
  classifyWinTier,
};
