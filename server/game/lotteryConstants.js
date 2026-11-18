/**
 * lotteryConstants.js
 * Shared configuration, progressive-pot math (100% ticket revenue + 1% casino net loss into pot),
 * and 3x3 Match-3 scratch card grid builders for Monte Carlo Gouden Krasloten.
 *
 * Strict Guardrails: Zero audio, zero Unicode emojis, zero banned brand terms.
 */

const TICKET_PRICE = 1000;
const INITIAL_POT = 10000;
const RESET_FLOOR_POT = 5000;
const MIN_POT_AFTER_PARTIAL = 1000;
const LOSS_CONTRIBUTION_RATE = 0.01;
const HOUSE_FEE_RATE = 0; // 100% of every 1.000 F ticket goes directly into the shared pot
const MIN_PURCHASE_COUNT = 1;
const MAX_PURCHASE_PER_REQUEST = 25;
const HISTORY_LIMIT = 20;
const PERSONAL_HISTORY_LIMIT = 25;

// Legacy timing exports retained for backwards compatibility with existing timer contracts
const ROUND_DURATION_MS = 10 * 60 * 1000;
const DRAW_REVEAL_MS = 12000;

const PHASES = Object.freeze({
  OPEN: 'OPEN',
  DRAWING: 'DRAWING',
  READY: 'READY'
});

/**
 * Calibrated Krasloten prize table (totalWeight = 10,000 => 32.00% overall hit rate):
 * - JACKPOT_100:     15 / 10000 (0.15%) -> 100% of pot (pot resets to RESET_FLOOR_POT = 5.000 F)
 * - POT_25:          85 / 10000 (0.85%) ->  25% of pot (min 1.000 F, clamped to pot)
 * - POT_10:         300 / 10000 (3.00%) ->  10% of pot (min 1.000 F, clamped to pot)
 * - POT_4:          800 / 10000 (8.00%) ->   4% of pot (min   500 F, clamped to pot)
 * - CONSOLATION_500: 2000 / 10000 (20.00%) -> Fixed 500 F (clamped to pot)
 * - MISS:           6800 / 10000 (68.00%) -> 0 F (100% ticket stays in pot)
 */
const SCRATCH_PRIZE_TIERS = Object.freeze([
  Object.freeze({
    id: 'JACKPOT_100',
    label: '100% JACKPOT',
    shortLabel: '100% POT',
    badge: 'KROON',
    symbolName: 'DIAMANT KROON',
    color: '#fde047',
    weight: 15,
    potShare: 1.0,
    fixedAmount: 0,
    minPayout: RESET_FLOOR_POT,
    resetsPot: true
  }),
  Object.freeze({
    id: 'POT_25',
    label: '25% VAN DE POT',
    shortLabel: '25% POT',
    badge: 'GOUD',
    symbolName: 'GOUDEN STAAF',
    color: '#f59e0b',
    weight: 85,
    potShare: 0.25,
    fixedAmount: 0,
    minPayout: 1000,
    resetsPot: false
  }),
  Object.freeze({
    id: 'POT_10',
    label: '10% VAN DE POT',
    shortLabel: '10% POT',
    badge: 'KLAVER',
    symbolName: 'SMARAGD KLAVER',
    color: '#34d399',
    weight: 300,
    potShare: 0.10,
    fixedAmount: 0,
    minPayout: 1000,
    resetsPot: false
  }),
  Object.freeze({
    id: 'POT_4',
    label: '4% VAN DE POT',
    shortLabel: '4% POT',
    badge: 'ROBIJN',
    symbolName: 'ROBIJN STER',
    color: '#f43f5e',
    weight: 800,
    potShare: 0.04,
    fixedAmount: 0,
    minPayout: 500,
    resetsPot: false
  }),
  Object.freeze({
    id: 'CONSOLATION_500',
    label: '500 F TROOSTPRIJS',
    shortLabel: '500 F',
    badge: 'MUNT',
    symbolName: 'ZILVEREN MUNT',
    color: '#93c5fd',
    weight: 2000,
    potShare: 0,
    fixedAmount: 500,
    minPayout: 500,
    resetsPot: false
  }),
  Object.freeze({
    id: 'MISS',
    label: 'NIETS GEWONNEN',
    shortLabel: '0 F',
    badge: 'LEEG',
    symbolName: 'GEEN 3 DEZELFDE',
    color: '#94a3b8',
    weight: 6800,
    potShare: 0,
    fixedAmount: 0,
    minPayout: 0,
    resetsPot: false
  })
]);

const TOTAL_TIER_WEIGHT = SCRATCH_PRIZE_TIERS.reduce((sum, t) => sum + t.weight, 0);
const WINNING_SYMBOL_TIERS = SCRATCH_PRIZE_TIERS.filter((t) => t.id !== 'MISS');

/**
 * Extracts crisp 1-2 character uppercase monogram for player badges.
 * @param {string} name
 * @returns {string}
 */
function getLotteryMonogram(name) {
  const clean = String(name || '').trim();
  if (!clean) return '?';
  const parts = clean.split(/[\s_-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

/**
 * Legacy helper retained for odds ratio calculations.
 */
function computePlayerOdds(playerTickets, totalTickets) {
  const own = Math.max(0, Number(playerTickets) || 0);
  const total = Math.max(0, Number(totalTickets) || 0);
  if (total <= 0 || own <= 0) {
    return { share: 0, sharePct: 0 };
  }
  const share = own / total;
  const sharePct = Math.round(share * 10000) / 100;
  return { share, sharePct };
}

/**
 * Picks a calibrated prize tier using `rng() -> [0, 1)`.
 * @param {Function} [rng=Math.random]
 * @returns {Object}
 */
function pickScratchTier(rng = Math.random) {
  const rFloat = Math.min(0.999999999999, Math.max(0, Number(rng()) || 0));
  let roll = Math.floor(rFloat * TOTAL_TIER_WEIGHT);
  for (let i = 0; i < SCRATCH_PRIZE_TIERS.length; i += 1) {
    const tier = SCRATCH_PRIZE_TIERS[i];
    if (roll < tier.weight) return tier;
    roll -= tier.weight;
  }
  return SCRATCH_PRIZE_TIERS[SCRATCH_PRIZE_TIERS.length - 1];
}

/**
 * Computes exact integer payout for a given prize tier & current pot size.
 * @param {Object} tier
 * @param {number} currentPot
 * @returns {number}
 */
function calculateTierPayout(tier, currentPot) {
  const pot = Math.max(0, Math.floor(Number(currentPot) || 0));
  if (!tier || tier.id === 'MISS' || pot <= 0) return 0;
  if (tier.resetsPot || tier.potShare >= 1.0) {
    return pot;
  }
  if (tier.fixedAmount > 0) {
    return Math.min(pot, tier.fixedAmount);
  }
  const raw = Math.floor(pot * tier.potShare);
  return Math.min(pot, Math.max(tier.minPayout || 0, raw));
}

/**
 * Fisher-Yates shuffle helper driven by supplied RNG.
 */
function shuffleArray(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const r = Math.min(0.999999999999, Math.max(0, Number(rng()) || 0));
    const j = Math.floor(r * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Builds a valid 9-cell (3x3) Match-3 scratch card grid strictly consistent with `tierId`:
 * - Winning tier: exactly 3 matching cells for `tierId`, all other symbols appear <= 2 times.
 * - MISS tier: every symbol appears at most 2 times (zero 3-of-a-kind matches).
 * @param {string} tierId
 * @param {number} currentPot
 * @param {number} payout
 * @param {Function} [rng=Math.random]
 * @returns {Array<Object>}
 */
function buildScratchGrid(tierId, currentPot = INITIAL_POT, payout = 0, rng = Math.random) {
  const safeRng = typeof rng === 'function' ? rng : Math.random;
  const cells = [];

  if (tierId && tierId !== 'MISS') {
    const winTier = WINNING_SYMBOL_TIERS.find((t) => t.id === tierId) || WINNING_SYMBOL_TIERS[WINNING_SYMBOL_TIERS.length - 1];
    const others = WINNING_SYMBOL_TIERS.filter((t) => t.id !== winTier.id);
    shuffleArray(others, safeRng);

    for (let i = 0; i < 3; i += 1) {
      cells.push({
        symbolId: winTier.id,
        badge: winTier.badge,
        label: winTier.shortLabel,
        symbolName: winTier.symbolName,
        color: winTier.color,
        isWinningCell: true
      });
    }

    // Fill remaining 6 slots: max 2 per decoy symbol for near-miss tension
    const counts = new Map();
    const decoyPool = [];
    for (const o of others) {
      decoyPool.push(o, o);
    }
    shuffleArray(decoyPool, safeRng);
    let idx = 0;
    while (cells.length < 9 && idx < decoyPool.length) {
      const candidate = decoyPool[idx++];
      const cur = counts.get(candidate.id) || 0;
      if (cur >= 2) continue;
      counts.set(candidate.id, cur + 1);
      cells.push({
        symbolId: candidate.id,
        badge: candidate.badge,
        label: candidate.shortLabel,
        symbolName: candidate.symbolName,
        color: candidate.color,
        isWinningCell: false
      });
    }
  } else {
    // Losing card: 2+2+2+2+1 across all 5 prize symbols -> impossible to have 3 identical
    const deck = [...WINNING_SYMBOL_TIERS];
    shuffleArray(deck, safeRng);
    for (let i = 0; i < deck.length; i += 1) {
      const copies = i < 4 ? 2 : 1;
      for (let c = 0; c < copies; c += 1) {
        const s = deck[i];
        cells.push({
          symbolId: s.id,
          badge: s.badge,
          label: s.shortLabel,
          symbolName: s.symbolName,
          color: s.color,
          isWinningCell: false
        });
      }
    }
  }

  shuffleArray(cells, safeRng);
  return cells.map((cell, index) => ({ ...cell, index }));
}

module.exports = {
  TICKET_PRICE,
  INITIAL_POT,
  RESET_FLOOR_POT,
  MIN_POT_AFTER_PARTIAL,
  LOSS_CONTRIBUTION_RATE,
  HOUSE_FEE_RATE,
  MIN_PURCHASE_COUNT,
  MAX_PURCHASE_PER_REQUEST,
  ROUND_DURATION_MS,
  DRAW_REVEAL_MS,
  HISTORY_LIMIT,
  PERSONAL_HISTORY_LIMIT,
  PHASES,
  SCRATCH_PRIZE_TIERS,
  TOTAL_TIER_WEIGHT,
  WINNING_SYMBOL_TIERS,
  getLotteryMonogram,
  computePlayerOdds,
  pickScratchTier,
  calculateTierPayout,
  buildScratchGrid
};
