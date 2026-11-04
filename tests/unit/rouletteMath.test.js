const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  WHEEL_NUMBERS,
  RED_NUMBERS,
  BLACK_NUMBERS,
  GREEN_NUMBERS,
  getColor,
  BET_TYPES,
  PAYOUT_RATIOS
} = require('../../server/game/rouletteConstants');

const {
  validateBet,
  evaluateBet,
  isValidSplit,
  isValidStreet,
  isValidCorner,
  isValidSixLine,
  getAllValidSplits,
  getAllValidStreets,
  getAllValidCorners,
  getAllValidSixLines
} = require('../../server/game/rouletteMath');

describe('European Roulette Constants & Wheel Layout', () => {
  it('should have exactly 37 pockets from 0 to 36', () => {
    assert.equal(WHEEL_NUMBERS.length, 37);
    const set = new Set(WHEEL_NUMBERS);
    assert.equal(set.size, 37);
    for (let i = 0; i <= 36; i++) {
      assert.ok(set.has(i), `Missing number ${i} on wheel`);
    }
  });

  it('should match the authentic European single-zero clockwise sequence', () => {
    const expectedSequence = [
      0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
      5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
    ];
    assert.deepEqual(WHEEL_NUMBERS, expectedSequence);
  });

  it('should have 18 red, 18 black, and 1 green pocket', () => {
    assert.equal(RED_NUMBERS.size, 18);
    assert.equal(BLACK_NUMBERS.size, 18);
    assert.equal(GREEN_NUMBERS.size, 1);
    assert.ok(GREEN_NUMBERS.has(0));
  });

  it('should alternate colors strictly between 32 and 26 on the wheel', () => {
    // Index 1 (32) to 36 (26)
    for (let i = 1; i < WHEEL_NUMBERS.length - 1; i++) {
      const c1 = getColor(WHEEL_NUMBERS[i]);
      const c2 = getColor(WHEEL_NUMBERS[i + 1]);
      assert.notEqual(c1, c2, `Pockets ${WHEEL_NUMBERS[i]} and ${WHEEL_NUMBERS[i+1]} have the same color`);
    }
    // 0 is green, flanked by 26 (black) and 32 (red)
    assert.equal(getColor(0), 'green');
    assert.equal(getColor(26), 'black');
    assert.equal(getColor(32), 'red');
  });
});

describe('Adjacency & Permutation Validators', () => {
  it('should validate all 60 physical splits on the betting grid', () => {
    const splits = getAllValidSplits();
    assert.equal(splits.length, 60);
    for (const pair of splits) {
      assert.ok(isValidSplit(pair), `Split [${pair}] should be valid`);
    }
  });

  it('should reject invalid split combinations', () => {
    assert.equal(isValidSplit([14, 29]), false); // Far apart
    assert.equal(isValidSplit([3, 4]), false);   // Wrap across rows
    assert.equal(isValidSplit([0, 4]), false);   // 0 only touches 1, 2, 3
    assert.equal(isValidSplit([5, 5]), false);   // Duplicate
    assert.equal(isValidSplit([35, 38]), false); // Out of bounds
    assert.equal(isValidSplit(null), false);
    assert.equal(isValidSplit([1]), false);
  });

  it('should validate all 14 physical streets (12 rows + 2 trios with 0)', () => {
    const streets = getAllValidStreets();
    assert.equal(streets.length, 14);
    for (const trio of streets) {
      assert.ok(isValidStreet(trio), `Street [${trio}] should be valid`);
    }
  });

  it('should reject invalid street combinations', () => {
    assert.equal(isValidStreet([1, 2, 4]), false);
    assert.equal(isValidStreet([0, 1, 3]), false);
    assert.equal(isValidStreet([2, 3, 4]), false); // Crosses rows
    assert.equal(isValidStreet([34, 35, 37]), false);
    assert.equal(isValidStreet([1, 1, 2]), false);
  });

  it('should validate all 23 corners (22 2x2 squares + 1 first four basket)', () => {
    const corners = getAllValidCorners();
    assert.equal(corners.length, 23);
    for (const quad of corners) {
      assert.ok(isValidCorner(quad), `Corner [${quad}] should be valid`);
    }
  });

  it('should reject invalid corner combinations', () => {
    assert.equal(isValidCorner([3, 4, 6, 7]), false); // Cannot cross col 3 to col 1
    assert.equal(isValidCorner([1, 2, 3, 4]), false); // Not a 2x2 square
    assert.equal(isValidCorner([0, 1, 2, 4]), false);
    assert.equal(isValidCorner([33, 34, 36, 37]), false);
  });

  it('should validate all 11 six-lines (double streets)', () => {
    const lines = getAllValidSixLines();
    assert.equal(lines.length, 11);
    for (const line of lines) {
      assert.ok(isValidSixLine(line), `Six line [${line}] should be valid`);
    }
  });

  it('should reject invalid six-line combinations', () => {
    assert.equal(isValidSixLine([2, 3, 4, 5, 6, 7]), false); // Not starting on col 1
    assert.equal(isValidSixLine([1, 2, 3, 4, 5, 7]), false);
    assert.equal(isValidSixLine([31, 32, 33, 34, 35, 37]), false);
  });
});

describe('Bet Payload Validation (validateBet)', () => {
  const defaultChips = 10000;

  it('should accept valid straight bet', () => {
    const res = validateBet(BET_TYPES.STRAIGHT, 17, 100, defaultChips);
    assert.equal(res.valid, true);
    assert.equal(res.normalizedValue, 17);
  });

  it('should accept straight bet on 0', () => {
    const res = validateBet(BET_TYPES.STRAIGHT, 0, 50, defaultChips);
    assert.equal(res.valid, true);
    assert.equal(res.normalizedValue, 0);
  });

  it('should reject straight bet out of range', () => {
    const r1 = validateBet(BET_TYPES.STRAIGHT, -1, 100, defaultChips);
    assert.equal(r1.valid, false);
    assert.equal(r1.code, 'OUT_OF_RANGE');

    const r2 = validateBet(BET_TYPES.STRAIGHT, 37, 100, defaultChips);
    assert.equal(r2.valid, false);
    assert.equal(r2.code, 'OUT_OF_RANGE');
  });

  it('should reject non-integer or non-positive chip amount', () => {
    const r1 = validateBet(BET_TYPES.RED, null, 0, defaultChips);
    assert.equal(r1.valid, false);
    assert.equal(r1.code, 'INVALID_AMOUNT');

    const r2 = validateBet(BET_TYPES.RED, null, -50, defaultChips);
    assert.equal(r2.valid, false);
    assert.equal(r2.code, 'INVALID_AMOUNT');

    const r3 = validateBet(BET_TYPES.RED, null, 12.5, defaultChips);
    assert.equal(r3.valid, false);
    assert.equal(r3.code, 'INVALID_AMOUNT');

    const r4 = validateBet(BET_TYPES.RED, null, 'one hundred', defaultChips);
    assert.equal(r4.valid, false);
    assert.equal(r4.code, 'INVALID_AMOUNT');
  });

  it('should reject bet exceeding player chip balance', () => {
    const res = validateBet(BET_TYPES.BLACK, null, 15000, 10000);
    assert.equal(res.valid, false);
    assert.equal(res.code, 'INSUFFICIENT_FUNDS');
  });

  it('should reject unknown bet type', () => {
    const res = validateBet('roulette_jackpot', null, 100, defaultChips);
    assert.equal(res.valid, false);
    assert.equal(res.code, 'INVALID_TYPE');
  });

  it('should validate column and dozen values (must be 1, 2, or 3)', () => {
    assert.equal(validateBet(BET_TYPES.COLUMN, 2, 100, defaultChips).valid, true);
    assert.equal(validateBet(BET_TYPES.COLUMN, 4, 100, defaultChips).valid, false);
    assert.equal(validateBet(BET_TYPES.DOZEN, 3, 100, defaultChips).valid, true);
    assert.equal(validateBet(BET_TYPES.DOZEN, 0, 100, defaultChips).valid, false);
  });
});

describe('Payout Calculations for Every Bet Type', () => {
  const STAKE = 100;

  it('Straight bet: 35:1 profit, 36x gross return', () => {
    const bet = { type: BET_TYPES.STRAIGHT, value: 17, amount: STAKE };
    const win = evaluateBet(bet, 17);
    assert.equal(win.won, true);
    assert.equal(win.payout, 3600);
    assert.equal(win.profit, 3500);
    assert.equal(win.multiplier, 36);

    const lose = evaluateBet(bet, 18);
    assert.equal(lose.won, false);
    assert.equal(lose.payout, 0);
    assert.equal(lose.profit, -100);
  });

  it('Split bet: 17:1 profit, 18x gross return', () => {
    const bet = { type: BET_TYPES.SPLIT, value: [14, 17], amount: STAKE };
    const win14 = evaluateBet(bet, 14);
    assert.equal(win14.won, true);
    assert.equal(win14.payout, 1800);
    assert.equal(win14.profit, 1700);

    const win17 = evaluateBet(bet, 17);
    assert.equal(win17.won, true);
    assert.equal(win17.payout, 1800);

    const lose = evaluateBet(bet, 15);
    assert.equal(lose.won, false);
    assert.equal(lose.payout, 0);
    assert.equal(lose.profit, -100);
  });

  it('Street bet: 11:1 profit, 12x gross return', () => {
    const bet = { type: BET_TYPES.STREET, value: [1, 2, 3], amount: STAKE };
    const win = evaluateBet(bet, 2);
    assert.equal(win.won, true);
    assert.equal(win.payout, 1200);
    assert.equal(win.profit, 1100);

    const lose = evaluateBet(bet, 4);
    assert.equal(lose.won, false);
    assert.equal(lose.payout, 0);
  });

  it('Corner bet: 8:1 profit, 9x gross return', () => {
    const bet = { type: BET_TYPES.CORNER, value: [4, 5, 7, 8], amount: STAKE };
    const win = evaluateBet(bet, 7);
    assert.equal(win.won, true);
    assert.equal(win.payout, 900);
    assert.equal(win.profit, 800);

    const lose = evaluateBet(bet, 6);
    assert.equal(lose.won, false);
    assert.equal(lose.payout, 0);
  });

  it('Six Line bet: 5:1 profit, 6x gross return', () => {
    const bet = { type: BET_TYPES.SIX_LINE, value: [1, 2, 3, 4, 5, 6], amount: STAKE };
    const win = evaluateBet(bet, 6);
    assert.equal(win.won, true);
    assert.equal(win.payout, 600);
    assert.equal(win.profit, 500);

    const lose = evaluateBet(bet, 7);
    assert.equal(lose.won, false);
    assert.equal(lose.payout, 0);
  });

  it('Column bet: 2:1 profit, 3x gross return', () => {
    // Col 1 has numbers 1, 4, 7, ..., 34
    const betCol1 = { type: BET_TYPES.COLUMN, value: 1, amount: STAKE };
    assert.equal(evaluateBet(betCol1, 1).payout, 300);
    assert.equal(evaluateBet(betCol1, 34).payout, 300);
    assert.equal(evaluateBet(betCol1, 2).payout, 0);

    // Col 2 has 2, 5, 8, ..., 35
    const betCol2 = { type: BET_TYPES.COLUMN, value: 2, amount: STAKE };
    assert.equal(evaluateBet(betCol2, 20).payout, 300);
    assert.equal(evaluateBet(betCol2, 21).payout, 0);

    // Col 3 has 3, 6, 9, ..., 36
    const betCol3 = { type: BET_TYPES.COLUMN, value: 3, amount: STAKE };
    assert.equal(evaluateBet(betCol3, 36).payout, 300);
    assert.equal(evaluateBet(betCol3, 35).payout, 0);
  });

  it('Dozen bet: 2:1 profit, 3x gross return', () => {
    const d1 = { type: BET_TYPES.DOZEN, value: 1, amount: STAKE };
    assert.equal(evaluateBet(d1, 12).payout, 300);
    assert.equal(evaluateBet(d1, 13).payout, 0);

    const d2 = { type: BET_TYPES.DOZEN, value: 2, amount: STAKE };
    assert.equal(evaluateBet(d2, 13).payout, 300);
    assert.equal(evaluateBet(d2, 24).payout, 300);
    assert.equal(evaluateBet(d2, 25).payout, 0);

    const d3 = { type: BET_TYPES.DOZEN, value: 3, amount: STAKE };
    assert.equal(evaluateBet(d3, 36).payout, 300);
    assert.equal(evaluateBet(d3, 24).payout, 0);
  });

  it('Red / Black outside bets: 1:1 profit, 2x gross return', () => {
    const betRed = { type: BET_TYPES.RED, value: null, amount: STAKE };
    const betBlack = { type: BET_TYPES.BLACK, value: null, amount: STAKE };

    assert.equal(evaluateBet(betRed, 1).payout, 200);   // 1 is Red
    assert.equal(evaluateBet(betRed, 2).payout, 0);     // 2 is Black
    assert.equal(evaluateBet(betBlack, 2).payout, 200); // 2 is Black
    assert.equal(evaluateBet(betBlack, 1).payout, 0);   // 1 is Red
  });

  it('Even / Odd outside bets: 1:1 profit, 2x gross return', () => {
    const betEven = { type: BET_TYPES.EVEN, value: null, amount: STAKE };
    const betOdd = { type: BET_TYPES.ODD, value: null, amount: STAKE };

    assert.equal(evaluateBet(betEven, 18).payout, 200);
    assert.equal(evaluateBet(betEven, 19).payout, 0);
    assert.equal(evaluateBet(betOdd, 19).payout, 200);
    assert.equal(evaluateBet(betOdd, 18).payout, 0);
  });

  it('Low (1-18) / High (19-36) outside bets: 1:1 profit, 2x gross return', () => {
    const betLow = { type: BET_TYPES.LOW, value: null, amount: STAKE };
    const betHigh = { type: BET_TYPES.HIGH, value: null, amount: STAKE };

    assert.equal(evaluateBet(betLow, 1).payout, 200);
    assert.equal(evaluateBet(betLow, 18).payout, 200);
    assert.equal(evaluateBet(betLow, 19).payout, 0);

    assert.equal(evaluateBet(betHigh, 19).payout, 200);
    assert.equal(evaluateBet(betHigh, 36).payout, 200);
    assert.equal(evaluateBet(betHigh, 18).payout, 0);
  });
});

describe('Zero (0) Outcome Payout & Loss Rules', () => {
  const STAKE = 100;

  it('Zero outcome must cause ALL outside bets to lose', () => {
    const outsideBets = [
      { type: BET_TYPES.RED, value: null, amount: STAKE },
      { type: BET_TYPES.BLACK, value: null, amount: STAKE },
      { type: BET_TYPES.EVEN, value: null, amount: STAKE },
      { type: BET_TYPES.ODD, value: null, amount: STAKE },
      { type: BET_TYPES.LOW, value: null, amount: STAKE },
      { type: BET_TYPES.HIGH, value: null, amount: STAKE },
      { type: BET_TYPES.COLUMN, value: 1, amount: STAKE },
      { type: BET_TYPES.COLUMN, value: 2, amount: STAKE },
      { type: BET_TYPES.COLUMN, value: 3, amount: STAKE },
      { type: BET_TYPES.DOZEN, value: 1, amount: STAKE },
      { type: BET_TYPES.DOZEN, value: 2, amount: STAKE },
      { type: BET_TYPES.DOZEN, value: 3, amount: STAKE }
    ];

    for (const b of outsideBets) {
      const res = evaluateBet(b, 0);
      assert.equal(res.won, false, `Bet ${b.type} should lose on 0`);
      assert.equal(res.payout, 0, `Bet ${b.type} should have 0 payout on 0`);
      assert.equal(res.profit, -STAKE);
    }
  });

  it('Zero outcome must reward inside bets covering 0', () => {
    // Straight 0
    const straight0 = evaluateBet({ type: BET_TYPES.STRAIGHT, value: 0, amount: STAKE }, 0);
    assert.equal(straight0.won, true);
    assert.equal(straight0.payout, 3600);

    // Split [0, 1]
    const split01 = evaluateBet({ type: BET_TYPES.SPLIT, value: [0, 1], amount: STAKE }, 0);
    assert.equal(split01.won, true);
    assert.equal(split01.payout, 1800);

    // Street [0, 1, 2]
    const street012 = evaluateBet({ type: BET_TYPES.STREET, value: [0, 1, 2], amount: STAKE }, 0);
    assert.equal(street012.won, true);
    assert.equal(street012.payout, 1200);

    // Corner First Four [0, 1, 2, 3]
    const corner0123 = evaluateBet({ type: BET_TYPES.CORNER, value: [0, 1, 2, 3], amount: STAKE }, 0);
    assert.equal(corner0123.won, true);
    assert.equal(corner0123.payout, 900);
  });

  it('Zero outcome must lose for inside bets not covering 0', () => {
    assert.equal(evaluateBet({ type: BET_TYPES.STRAIGHT, value: 17, amount: STAKE }, 0).payout, 0);
    assert.equal(evaluateBet({ type: BET_TYPES.SPLIT, value: [14, 17], amount: STAKE }, 0).payout, 0);
    assert.equal(evaluateBet({ type: BET_TYPES.STREET, value: [4, 5, 6], amount: STAKE }, 0).payout, 0);
    assert.equal(evaluateBet({ type: BET_TYPES.CORNER, value: [7, 8, 10, 11], amount: STAKE }, 0).payout, 0);
    assert.equal(evaluateBet({ type: BET_TYPES.SIX_LINE, value: [1, 2, 3, 4, 5, 6], amount: STAKE }, 0).payout, 0);
  });
});

describe('Mathematical Expected Value (House Edge Verification)', () => {
  it('Every European bet type must yield exactly 2.7027% house edge (97.297% EV)', () => {
    const testCases = [
      { type: BET_TYPES.STRAIGHT, value: 17, expectedWins: 1, multiplier: 36 },
      { type: BET_TYPES.SPLIT, value: [14, 17], expectedWins: 2, multiplier: 18 },
      { type: BET_TYPES.STREET, value: [1, 2, 3], expectedWins: 3, multiplier: 12 },
      { type: BET_TYPES.CORNER, value: [4, 5, 7, 8], expectedWins: 4, multiplier: 9 },
      { type: BET_TYPES.SIX_LINE, value: [1, 2, 3, 4, 5, 6], expectedWins: 6, multiplier: 6 },
      { type: BET_TYPES.COLUMN, value: 1, expectedWins: 12, multiplier: 3 },
      { type: BET_TYPES.DOZEN, value: 1, expectedWins: 12, multiplier: 3 },
      { type: BET_TYPES.RED, value: null, expectedWins: 18, multiplier: 2 },
      { type: BET_TYPES.BLACK, value: null, expectedWins: 18, multiplier: 2 },
      { type: BET_TYPES.EVEN, value: null, expectedWins: 18, multiplier: 2 },
      { type: BET_TYPES.ODD, value: null, expectedWins: 18, multiplier: 2 },
      { type: BET_TYPES.LOW, value: null, expectedWins: 18, multiplier: 2 },
      { type: BET_TYPES.HIGH, value: null, expectedWins: 18, multiplier: 2 }
    ];

    const STAKE = 100;
    const TOTAL_POCKETS = 37;

    for (const tc of testCases) {
      let totalGross = 0;
      let actualWins = 0;

      for (let pocket = 0; pocket <= 36; pocket++) {
        const res = evaluateBet({ type: tc.type, value: tc.value, amount: STAKE }, pocket);
        totalGross += res.payout;
        if (res.won) actualWins++;
      }

      assert.equal(actualWins, tc.expectedWins, `Mismatch in winning count for ${tc.type}`);
      const ev = totalGross / TOTAL_POCKETS;
      const expectedEv = (tc.expectedWins / TOTAL_POCKETS) * tc.multiplier * STAKE;

      assert.ok(
        Math.abs(ev - expectedEv) < 0.00001,
        `EV discrepancy for ${tc.type}: got ${ev}, expected ${expectedEv}`
      );
      assert.ok(
        Math.abs(ev - 97.2972972972973) < 0.001,
        `House edge mismatch for ${tc.type}: EV was ${ev}`
      );
    }
  });
});
