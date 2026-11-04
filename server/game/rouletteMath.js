/**
 * rouletteMath.js
 * Pure mathematical evaluation and validation engine for European Roulette.
 * Zero external dependencies.
 */

const {
  RED_NUMBERS,
  BLACK_NUMBERS,
  BET_TYPES,
  PAYOUT_RATIOS,
  MIN_BET_AMOUNT
} = require('./rouletteConstants');

/**
 * Validates a split bet selection [a, b].
 * Allowed:
 * 1. Zero-adjacent: [0, 1], [0, 2], [0, 3]
 * 2. Horizontal: same row, adjacent column (b - a === 1 && ceil(a/3) === ceil(b/3))
 * 3. Vertical: same column, adjacent row (b - a === 3 && b <= 36)
 */
function isValidSplit(numbers) {
  if (!Array.isArray(numbers) || numbers.length !== 2) return false;
  const [a, b] = numbers.map(Number);
  if (!Number.isInteger(a) || !Number.isInteger(b)) return false;
  if (a < 0 || a > 36 || b < 0 || b > 36 || a === b) return false;

  const low = Math.min(a, b);
  const high = Math.max(a, b);

  // Zero-adjacent
  if (low === 0) {
    return high === 1 || high === 2 || high === 3;
  }

  // Horizontal adjacency on 3x12 grid
  if (high - low === 1 && Math.ceil(low / 3) === Math.ceil(high / 3)) {
    return true;
  }

  // Vertical adjacency on 3x12 grid
  if (high - low === 3 && high <= 36) {
    return true;
  }

  return false;
}

/**
 * Validates a street bet selection [a, b, c].
 * Allowed:
 * 1. Zero trios: [0, 1, 2] or [0, 2, 3]
 * 2. Standard row: [3k-2, 3k-1, 3k] for k in 1..12
 */
function isValidStreet(numbers) {
  if (!Array.isArray(numbers) || numbers.length !== 3) return false;
  const sorted = numbers.map(Number).sort((x, y) => x - y);
  if (sorted.some(n => !Number.isInteger(n) || n < 0 || n > 36)) return false;

  // Check unique
  if (new Set(sorted).size !== 3) return false;

  // Trios with zero
  if (sorted[0] === 0) {
    return (sorted[1] === 1 && sorted[2] === 2) || (sorted[1] === 2 && sorted[2] === 3);
  }

  // Standard row street
  const first = sorted[0];
  if (first % 3 !== 1 || first > 34) return false;
  return sorted[1] === first + 1 && sorted[2] === first + 2;
}

/**
 * Validates a corner bet selection [a, b, c, d].
 * Allowed:
 * 1. First Four basket: [0, 1, 2, 3]
 * 2. 2x2 grid square: [n, n+1, n+3, n+4] where n in col 1 or 2, n+4 <= 36
 */
function isValidCorner(numbers) {
  if (!Array.isArray(numbers) || numbers.length !== 4) return false;
  const sorted = numbers.map(Number).sort((x, y) => x - y);
  if (sorted.some(n => !Number.isInteger(n) || n < 0 || n > 36)) return false;

  if (new Set(sorted).size !== 4) return false;

  // First Four basket [0, 1, 2, 3]
  if (sorted[0] === 0 && sorted[1] === 1 && sorted[2] === 2 && sorted[3] === 3) {
    return true;
  }

  const [n, n1, n2, n3] = sorted;
  // n cannot be 0, must be in col 1 or col 2 (so n % 3 !== 0)
  if (n < 1 || n % 3 === 0) return false;
  return n1 === n + 1 && n2 === n + 3 && n3 === n + 4 && n3 <= 36;
}

/**
 * Validates a six-line bet selection (double street: 6 numbers across 2 consecutive rows).
 * Allowed: [3k-2 .. 3k+3] for k in 1..11
 */
function isValidSixLine(numbers) {
  if (!Array.isArray(numbers) || numbers.length !== 6) return false;
  const sorted = numbers.map(Number).sort((x, y) => x - y);
  if (sorted.some(n => !Number.isInteger(n) || n < 1 || n > 36)) return false;

  if (new Set(sorted).size !== 6) return false;

  const first = sorted[0];
  if (first % 3 !== 1 || first > 31) return false;

  for (let i = 0; i < 6; i++) {
    if (sorted[i] !== first + i) return false;
  }
  return true;
}

/**
 * Generates all 60 valid split combinations.
 */
function getAllValidSplits() {
  const splits = [];
  // Zero-adjacent (3)
  splits.push([0, 1], [0, 2], [0, 3]);

  // Horizontal (24)
  for (let row = 0; row < 12; row++) {
    const base = row * 3 + 1;
    splits.push([base, base + 1]);
    splits.push([base + 1, base + 2]);
  }

  // Vertical (33)
  for (let row = 0; row < 11; row++) {
    const base = row * 3 + 1;
    splits.push([base, base + 3]);
    splits.push([base + 1, base + 4]);
    splits.push([base + 2, base + 5]);
  }
  return splits;
}

/**
 * Generates all 14 valid street combinations.
 */
function getAllValidStreets() {
  const streets = [];
  streets.push([0, 1, 2], [0, 2, 3]);
  for (let row = 0; row < 12; row++) {
    const base = row * 3 + 1;
    streets.push([base, base + 1, base + 2]);
  }
  return streets;
}

/**
 * Generates all 23 valid corner combinations.
 */
function getAllValidCorners() {
  const corners = [];
  corners.push([0, 1, 2, 3]);
  for (let row = 0; row < 11; row++) {
    const base = row * 3 + 1;
    corners.push([base, base + 1, base + 3, base + 4]);
    corners.push([base + 1, base + 2, base + 4, base + 5]);
  }
  return corners;
}

/**
 * Generates all 11 valid six-line combinations.
 */
function getAllValidSixLines() {
  const lines = [];
  for (let row = 0; row < 11; row++) {
    const base = row * 3 + 1;
    lines.push([base, base + 1, base + 2, base + 3, base + 4, base + 5]);
  }
  return lines;
}

/**
 * Validates incoming bet payload before acceptance.
 * @param {string} type 
 * @param {any} value 
 * @param {number} amount 
 * @param {number} playerChips 
 * @returns {{ valid: boolean, code?: string, reason?: string, normalizedValue?: any }}
 */
function validateBet(type, value, amount, playerChips) {
  // 1. Amount validation
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < MIN_BET_AMOUNT) {
    return {
      valid: false,
      code: 'INVALID_AMOUNT',
      reason: 'Chip amount must be a positive integer'
    };
  }

  if (typeof playerChips === 'number' && amount > playerChips) {
    return {
      valid: false,
      code: 'INSUFFICIENT_FUNDS',
      reason: 'Insufficient chip balance'
    };
  }

  // 2. Type validation
  if (!Object.values(BET_TYPES).includes(type)) {
    return {
      valid: false,
      code: 'INVALID_TYPE',
      reason: `Unknown bet type: ${type}`
    };
  }

  // 3. Value validation by type
  switch (type) {
    case BET_TYPES.STRAIGHT: {
      const num = Number(value);
      if (!Number.isInteger(num) || num < 0 || num > 36) {
        return {
          valid: false,
          code: 'OUT_OF_RANGE',
          reason: 'Number must be between 0 and 36'
        };
      }
      return { valid: true, normalizedValue: num };
    }

    case BET_TYPES.SPLIT: {
      if (!isValidSplit(value)) {
        return {
          valid: false,
          code: 'INVALID_SELECTION',
          reason: 'Numbers are not adjacent on the betting grid'
        };
      }
      const sorted = value.map(Number).sort((x, y) => x - y);
      return { valid: true, normalizedValue: sorted };
    }

    case BET_TYPES.STREET: {
      if (!isValidStreet(value)) {
        return {
          valid: false,
          code: 'INVALID_SELECTION',
          reason: 'Numbers do not form a valid street or trio'
        };
      }
      const sorted = value.map(Number).sort((x, y) => x - y);
      return { valid: true, normalizedValue: sorted };
    }

    case BET_TYPES.CORNER: {
      if (!isValidCorner(value)) {
        return {
          valid: false,
          code: 'INVALID_SELECTION',
          reason: 'Numbers do not form a valid corner or first four'
        };
      }
      const sorted = value.map(Number).sort((x, y) => x - y);
      return { valid: true, normalizedValue: sorted };
    }

    case BET_TYPES.SIX_LINE: {
      if (!isValidSixLine(value)) {
        return {
          valid: false,
          code: 'INVALID_SELECTION',
          reason: 'Numbers do not form a valid six-line (double street)'
        };
      }
      const sorted = value.map(Number).sort((x, y) => x - y);
      return { valid: true, normalizedValue: sorted };
    }

    case BET_TYPES.COLUMN: {
      const col = Number(value);
      if (![1, 2, 3].includes(col)) {
        return {
          valid: false,
          code: 'INVALID_SELECTION',
          reason: 'Column must be 1, 2, or 3'
        };
      }
      return { valid: true, normalizedValue: col };
    }

    case BET_TYPES.DOZEN: {
      const doz = Number(value);
      if (![1, 2, 3].includes(doz)) {
        return {
          valid: false,
          code: 'INVALID_SELECTION',
          reason: 'Dozen must be 1, 2, or 3'
        };
      }
      return { valid: true, normalizedValue: doz };
    }

    case BET_TYPES.RED:
    case BET_TYPES.BLACK:
    case BET_TYPES.EVEN:
    case BET_TYPES.ODD:
    case BET_TYPES.LOW:
    case BET_TYPES.HIGH:
      return { valid: true, normalizedValue: null };

    default:
      return { valid: false, code: 'INVALID_TYPE', reason: 'Unrecognized bet type' };
  }
}

/**
 * Pure evaluation of a placed bet against the winning number.
 * Returns gross payout and net profit.
 * @param {{ type: string, value: any, amount: number }} bet 
 * @param {number} winningNumber 
 * @returns {{ won: boolean, payout: number, profit: number, multiplier: number }}
 */
function evaluateBet(bet, winningNumber) {
  const { type, value, amount } = bet;
  const ratio = PAYOUT_RATIOS[type];
  if (!ratio) {
    return { won: false, payout: 0, profit: -amount, multiplier: 0 };
  }

  let won = false;

  // Zero outcome handling: outside bets lose on 0.
  // Only inside bets containing 0 win.
  if (winningNumber === 0) {
    if (type === BET_TYPES.STRAIGHT && Number(value) === 0) {
      won = true;
    } else if ([BET_TYPES.SPLIT, BET_TYPES.STREET, BET_TYPES.CORNER].includes(type)) {
      if (Array.isArray(value) && value.map(Number).includes(0)) {
        won = true;
      }
    }
  } else {
    // Non-zero winning number (1..36)
    switch (type) {
      case BET_TYPES.STRAIGHT:
        won = Number(value) === winningNumber;
        break;

      case BET_TYPES.SPLIT:
      case BET_TYPES.STREET:
      case BET_TYPES.CORNER:
      case BET_TYPES.SIX_LINE:
        won = Array.isArray(value) && value.map(Number).includes(winningNumber);
        break;

      case BET_TYPES.COLUMN: {
        const col = ((winningNumber - 1) % 3) + 1;
        won = Number(value) === col;
        break;
      }

      case BET_TYPES.DOZEN: {
        const doz = Math.ceil(winningNumber / 12);
        won = Number(value) === doz;
        break;
      }

      case BET_TYPES.RED:
        won = RED_NUMBERS.has(winningNumber);
        break;

      case BET_TYPES.BLACK:
        won = BLACK_NUMBERS.has(winningNumber);
        break;

      case BET_TYPES.EVEN:
        won = winningNumber % 2 === 0;
        break;

      case BET_TYPES.ODD:
        won = winningNumber % 2 === 1;
        break;

      case BET_TYPES.LOW:
        won = winningNumber >= 1 && winningNumber <= 18;
        break;

      case BET_TYPES.HIGH:
        won = winningNumber >= 19 && winningNumber <= 36;
        break;

      default:
        won = false;
    }
  }

  if (won) {
    const payout = amount * ratio.grossMultiplier;
    const profit = amount * ratio.profitRatio;
    return {
      won: true,
      payout,
      profit,
      multiplier: ratio.grossMultiplier
    };
  }

  return {
    won: false,
    payout: 0,
    profit: -amount,
    multiplier: 0
  };
}

module.exports = {
  isValidSplit,
  isValidStreet,
  isValidCorner,
  isValidSixLine,
  getAllValidSplits,
  getAllValidStreets,
  getAllValidCorners,
  getAllValidSixLines,
  validateBet,
  evaluateBet
};
