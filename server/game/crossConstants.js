/**
 * crossConstants.js
 * Immutable math model, fixed-odds uniform survival rates (~98.0% RTP / >= 2% house edge),
 * and shared vehicle/bet configuration for Monte Carlo Boulevard Cross.
 * Zero audio, zero Unicode emojis, zero banned brand terms.
 */

const TARGET_RTP = 0.98;
const HIT_NUMERATOR = 1;
const HIT_DENOMINATOR = 5;
const HIT_PROBABILITY = HIT_NUMERATOR / HIT_DENOMINATOR; // 0.20 (20% crash chance per lane)
const SURVIVAL_PROBABILITY = 1 - HIT_PROBABILITY; // 0.80 (80% safe survival per lane)

const MIN_BET = 10;
const MAX_BET = 50000;
const MAX_MULTIPLIER = 10000;
const MAX_PAYOUT = 5000000;

const HISTORY_LIMIT = 20;
const RECENT_WINS_LIMIT = 15;
const BIG_WIN_MIN_PROFIT = 2500;
const BIG_WIN_MIN_LANE = 5;

const VEHICLE_TYPES = [
  'F1_GOLD',
  'GT_CRIMSON',
  'LIMO_OBSIDIAN',
  'SUPERCAR_EMERALD',
  'COUPE_SILVER'
];

/**
 * Computes deterministic cashout multiplier after safely crossing `lane` lanes,
 * strictly enforcing >= 2% casino house edge (expected return <= 0.98 on every lane).
 * @param {number} lane
 * @returns {number}
 */
function calculateCrossMultiplier(lane) {
  if (!Number.isInteger(lane) || lane <= 0) {
    return 1.0;
  }
  const survivalJoint = Math.pow(SURVIVAL_PROBABILITY, lane);
  if (survivalJoint <= 0) {
    return MAX_MULTIPLIER;
  }
  let rawMult = Math.floor((TARGET_RTP / survivalJoint) * 100) / 100;
  rawMult = Math.min(MAX_MULTIPLIER, Math.max(1.0, rawMult));

  while (rawMult > 1.0 && rawMult * survivalJoint > TARGET_RTP + 1e-12) {
    rawMult = Math.round((rawMult - 0.01) * 100) / 100;
  }
  return rawMult;
}

/**
 * Computes exact integer chip payout for `betAmount` at `lane`, capped at MAX_PAYOUT.
 * @param {number} betAmount
 * @param {number} lane
 * @returns {number}
 */
function calculateCrossPayout(betAmount, lane) {
  const mult = calculateCrossMultiplier(lane);
  const raw = Math.floor(betAmount * mult);
  return Math.min(MAX_PAYOUT, Math.max(0, raw));
}

/**
 * Builds upcoming multiplier ladder milestones starting at `fromLane`.
 * @param {number} betAmount
 * @param {number} [fromLane=1]
 * @param {number} [count=8]
 * @returns {Array<{ lane: number, multiplier: number, payout: number, survivalChance: number }>}
 */
function getCrossLadderPreview(betAmount, fromLane = 1, count = 8) {
  const safeFrom = Number.isInteger(fromLane) && fromLane >= 1 ? fromLane : 1;
  const safeBet = Number.isFinite(betAmount) && betAmount >= MIN_BET ? Math.floor(betAmount) : MIN_BET;
  const list = [];
  for (let i = 0; i < count; i += 1) {
    const lane = safeFrom + i;
    const multiplier = calculateCrossMultiplier(lane);
    list.push({
      lane,
      multiplier,
      payout: calculateCrossPayout(safeBet, lane),
      survivalChance: SURVIVAL_PROBABILITY
    });
  }
  return list;
}

module.exports = {
  TARGET_RTP,
  HIT_NUMERATOR,
  HIT_DENOMINATOR,
  HIT_PROBABILITY,
  SURVIVAL_PROBABILITY,
  MIN_BET,
  MAX_BET,
  MAX_MULTIPLIER,
  MAX_PAYOUT,
  HISTORY_LIMIT,
  RECENT_WINS_LIMIT,
  BIG_WIN_MIN_PROFIT,
  BIG_WIN_MIN_LANE,
  VEHICLE_TYPES,
  calculateCrossMultiplier,
  calculateCrossPayout,
  getCrossLadderPreview
};
