/**
 * @fileoverview Royal Mines Vault constants, multiplier table builder & fair board generator.
 * Enforces strict 4% casino house edge (0.96 TARGET_RTP) with hard EV < 1.00 cap across all
 * supported grid sizes (4x4, 5x5, 6x6, 7x7) and mine counts (1..gridSize-1).
 */

const VALID_GRID_SIDES = Object.freeze([4, 5, 6, 7]);

const GRID_CONFIGS = Object.freeze({
  4: Object.freeze({ side: 4, totalTiles: 16, label: '4x4 Kort', defaultMines: 3 }),
  5: Object.freeze({ side: 5, totalTiles: 25, label: '5x5 Klassiek', defaultMines: 5 }),
  6: Object.freeze({ side: 6, totalTiles: 36, label: '6x6 Tactisch', defaultMines: 6 }),
  7: Object.freeze({ side: 7, totalTiles: 49, label: '7x7 Groot', defaultMines: 8 }),
});

/** Preset bomb counts selectable for Multiplayer Shared Vault voting. */
const SHARED_BOMB_PRESETS = Object.freeze([3, 5, 8, 12]);

/** Strict 4% casino house edge (96% RTP). */
const TARGET_RTP = 0.96;

/** Hard cap on effective EV per pick step so no ultra-low-risk configuration ever exceeds 0.99 EV (< 1.00). */
const MAX_EV_CAP = 0.99;

const MIN_BET = 10;
const MAX_BET = 50000;
const MAX_PAYOUT = 5000000;

const CHEER_COOLDOWN_MS = 1500;
const HISTORY_LIMIT = 25;
const RECENT_WINS_LIMIT = 15;
const BIG_WIN_MIN_NET_PROFIT = 200;
const BIG_WIN_MIN_MULT = 2.0;

const SHARED_PHASES = Object.freeze({
  WAITING_FOR_PLAYERS: 'WAITING_FOR_PLAYERS',
  BETTING: 'BETTING',
  PLAYING: 'PLAYING',
  REVEALED: 'REVEALED',
});

const SHARED_DURATIONS = Object.freeze({
  ENTRY_SEC: 8,
  TURN_SEC: 10,
  REVEAL_MS: 4000,
});

/**
 * Generates exact fair cumulative multipliers and house-edge adjusted multipliers (EV <= 0.99)
 * for every safe pick index 1..(totalTiles - mineCount).
 * Index 0 holds 1.00.
 *
 * @param {number} totalTiles
 * @param {number} mineCount
 * @param {number} [targetRtp=TARGET_RTP]
 * @returns {number[]}
 */
function buildMultiplierTable(totalTiles, mineCount, targetRtp = TARGET_RTP) {
  const N = Math.floor(Number(totalTiles) || 0);
  const M = Math.floor(Number(mineCount) || 0);
  if (!Number.isInteger(N) || N < 4 || !Number.isInteger(M) || M < 1 || M >= N) {
    return [1.0];
  }

  const safeTiles = N - M;
  const table = [1.0];
  let fairMult = 1.0;

  for (let d = 1; d <= safeTiles; d += 1) {
    const i = d - 1;
    fairMult *= (N - i) / (N - M - i);

    const prevMult = table[d - 1];
    const baseHouse = Math.floor(fairMult * targetRtp * 100) / 100;
    const evCap = Math.floor(fairMult * MAX_EV_CAP * 100) / 100;

    let stepMult = Math.min(baseHouse, evCap);
    if (stepMult < Math.max(1.01, prevMult + 0.01)) {
      const bumped = Math.round(Math.max(1.01, prevMult + 0.01) * 100) / 100;
      if (bumped <= evCap) {
        stepMult = bumped;
      }
    }

    if (stepMult < 1.01 && evCap >= 1.01) {
      stepMult = 1.01;
    }

    table.push(Math.min(stepMult, evCap));
  }

  return table;
}

/**
 * Computes the multiplier at step `diamondsFound` for a given board configuration.
 * @param {number} totalTiles
 * @param {number} mineCount
 * @param {number} diamondsFound
 * @param {number} [targetRtp=TARGET_RTP]
 * @returns {number|null}
 */
function computeStepMultiplier(totalTiles, mineCount, diamondsFound, targetRtp = TARGET_RTP) {
  const table = buildMultiplierTable(totalTiles, mineCount, targetRtp);
  const idx = Math.floor(Number(diamondsFound) || 0);
  if (idx < 0 || idx >= table.length) return null;
  return table[idx];
}

/**
 * Computes next-tile survival chance percentage and multiplier without mutating board state.
 * @param {number} totalTiles
 * @param {number} mineCount
 * @param {number} diamondsOpened
 * @param {number} [targetRtp=TARGET_RTP]
 */
function computeNextPickMeta(totalTiles, mineCount, diamondsOpened, targetRtp = TARGET_RTP) {
  const N = Math.floor(Number(totalTiles) || 25);
  const M = Math.floor(Number(mineCount) || 5);
  const d = Math.max(0, Math.floor(Number(diamondsOpened) || 0));
  const remainingTiles = Math.max(0, N - d);
  const remainingSafe = Math.max(0, (N - M) - d);

  if (remainingTiles <= 0 || remainingSafe <= 0) {
    return {
      remainingTiles: 0,
      remainingSafe: 0,
      nextMultiplier: computeStepMultiplier(N, M, d, targetRtp) || 1.0,
      safeChancePct: 0,
      mineRiskPct: 100,
    };
  }

  const nextMultiplier = computeStepMultiplier(N, M, d + 1, targetRtp) || 1.0;
  const safeChancePct = Math.round((remainingSafe / remainingTiles) * 1000) / 10;
  const mineRiskPct = Math.round((M / remainingTiles) * 1000) / 10;

  return {
    remainingTiles,
    remainingSafe,
    nextMultiplier,
    safeChancePct,
    mineRiskPct,
  };
}

/**
 * Uniform Fisher-Yates selection of `mineCount` distinct bomb indices in `[0 .. totalTiles - 1]`.
 * @param {number} totalTiles
 * @param {number} mineCount
 * @param {Function} [rng=Math.random]
 * @returns {Set<number>}
 */
function generateMinePositions(totalTiles, mineCount, rng = Math.random) {
  const N = Math.floor(Number(totalTiles) || 25);
  const M = Math.max(1, Math.min(N - 1, Math.floor(Number(mineCount) || 5)));
  const pool = Array.from({ length: N }, (_, idx) => idx);

  for (let i = pool.length - 1; i > 0; i -= 1) {
    const r = Math.min(0.999999999, Math.max(0, Number(rng())));
    const j = Math.floor(r * (i + 1));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }

  return new Set(pool.slice(0, M));
}

/**
 * Validates and normalizes gridSide (`4|5|6|7`) and mineCount.
 * @param {number} rawSide
 * @param {number} rawMines
 * @returns {{ ok: boolean, gridSide?: number, totalTiles?: number, mineCount?: number, message?: string }}
 */
function normalizeBoardSettings(rawSide, rawMines) {
  const side = Math.floor(Number(rawSide));
  if (!VALID_GRID_SIDES.includes(side)) {
    return {
      ok: false,
      message: 'Kies een geldige bordgrootte: 4x4, 5x5, 6x6 of 7x7.',
    };
  }
  const cfg = GRID_CONFIGS[side];
  const mines = Math.floor(Number(rawMines));
  if (!Number.isFinite(mines) || mines < 1 || mines >= cfg.totalTiles) {
    return {
      ok: false,
      message: `Aantal bommen voor ${cfg.label} moet tussen 1 en ${cfg.totalTiles - 1} liggen.`,
    };
  }
  return {
    ok: true,
    gridSide: side,
    totalTiles: cfg.totalTiles,
    mineCount: mines,
  };
}

module.exports = {
  VALID_GRID_SIDES,
  GRID_CONFIGS,
  SHARED_BOMB_PRESETS,
  TARGET_RTP,
  MAX_EV_CAP,
  MIN_BET,
  MAX_BET,
  MAX_PAYOUT,
  CHEER_COOLDOWN_MS,
  HISTORY_LIMIT,
  RECENT_WINS_LIMIT,
  BIG_WIN_MIN_NET_PROFIT,
  BIG_WIN_MIN_MULT,
  SHARED_PHASES,
  SHARED_DURATIONS,
  buildMultiplierTable,
  computeStepMultiplier,
  computeNextPickMeta,
  generateMinePositions,
  normalizeBoardSettings,
};
