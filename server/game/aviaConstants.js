/**
 * aviaConstants.js
 * Calibrated constants, pickup arithmetic rules, and exact ~98.0% RTP
 * probability distribution for AviaMasters (Obsidian Royale Air Wing).
 * Zero audio, zero Unicode emojis, zero GTA branding.
 */

const MIN_BET = 10;
const MAX_BET = 50000;
const VALID_SPEEDS = ['1x', '2x', '4x'];
const RECENT_HISTORY_LIMIT = 25;
const TOTAL_WEIGHT = 100000;

const CARRIER_NAMES = [
  'USS RIVIERA',
  'PORT HERCULE',
  'MONTE CARLO BAY',
  'GRAND HORIZON',
  'SOVEREIGN ISLE'
];

const PICKUP_ADD_TOKENS = {
  '+1': { kind: 'add', value: 1, label: '+1' },
  '+2': { kind: 'add', value: 2, label: '+2' },
  '+5': { kind: 'add', value: 5, label: '+5' },
  '+10': { kind: 'add', value: 10, label: '+10' }
};

const PICKUP_MULT_TOKENS = {
  x2: { kind: 'mult', value: 2, label: 'x2' },
  x3: { kind: 'mult', value: 3, label: 'x3' },
  x4: { kind: 'mult', value: 4, label: 'x4' },
  x5: { kind: 'mult', value: 5, label: 'x5' }
};

const ROCKET_TOKEN = { kind: 'rocket', value: 0.5, label: '-50%' };

function tok(key) {
  if (key === 'rocket') return { ...ROCKET_TOKEN };
  if (PICKUP_ADD_TOKENS[key]) return { ...PICKUP_ADD_TOKENS[key] };
  if (PICKUP_MULT_TOKENS[key]) return { ...PICKUP_MULT_TOKENS[key] };
  throw new Error(`Unknown AviaMasters token: ${key}`);
}

/**
 * Evaluates a sequence of sky pickup tokens starting at 1.00x.
 * @param {Array<{ kind: 'add'|'mult'|'rocket', value: number }>} sequence
 * @returns {number}
 */
function evaluateSequenceMultiplier(sequence) {
  let mult = 1.0;
  for (let i = 0; i < sequence.length; i += 1) {
    const step = sequence[i];
    if (step.kind === 'add') {
      mult = Math.round((mult + step.value) * 100) / 100;
    } else if (step.kind === 'mult') {
      mult = Math.round((mult * step.value) * 100) / 100;
    } else if (step.kind === 'rocket') {
      mult = Math.round((mult * 0.5) * 100) / 100;
    }
  }
  return mult;
}

/**
 * Calibrated discrete outcome tiers summing to TOTAL_WEIGHT = 100,000
 * with exact weighted expected return sum = 98,000 (98.000% RTP / 2.000% house edge).
 */
const AVIA_OUTCOME_TIERS = [
  {
    id: 'splash',
    label: 'ZEE PLONS',
    badgeClass: 'tier-splash',
    finalMultiplier: 0,
    landed: false,
    weight: 48000,
    variants: [
      ['+1', 'rocket'],
      ['rocket', '+1', 'rocket'],
      ['+2', 'x2', 'rocket', 'rocket'],
      ['+5', 'x3', 'rocket', 'rocket', 'rocket'],
      ['+2', 'rocket', 'rocket']
    ]
  },
  {
    id: 'scrape_05',
    label: 'RAKET SCHAMP',
    badgeClass: 'tier-low',
    finalMultiplier: 0.5,
    landed: true,
    weight: 13400,
    variants: [
      ['rocket'],
      ['+1', 'rocket', 'rocket']
    ]
  },
  {
    id: 'touchdown_1',
    label: 'VEILIGE LANDING',
    badgeClass: 'tier-even',
    finalMultiplier: 1.0,
    landed: true,
    weight: 13600,
    variants: [
      ['+1', 'rocket'],
      ['rocket', 'x2'],
      ['x2', 'rocket']
    ]
  },
  {
    id: 'glide_15',
    label: 'GLIJVLUCHT',
    badgeClass: 'tier-win',
    finalMultiplier: 1.5,
    landed: true,
    weight: 9000,
    variants: [
      ['rocket', '+1'],
      ['+2', 'rocket'],
      ['rocket', 'x3']
    ]
  },
  {
    id: 'cruise_2',
    label: 'DUBBEL DEK',
    badgeClass: 'tier-win',
    finalMultiplier: 2.0,
    landed: true,
    weight: 6500,
    variants: [
      ['+1'],
      ['x2'],
      ['+1', '+2', 'rocket']
    ]
  },
  {
    id: 'rally_25',
    label: 'RUGWIND RALLY',
    badgeClass: 'tier-win',
    finalMultiplier: 2.5,
    landed: true,
    weight: 2400,
    variants: [
      ['+2', 'rocket', '+1'],
      ['rocket', '+2']
    ]
  },
  {
    id: 'climb_3',
    label: 'STEILE KLIM',
    badgeClass: 'tier-good',
    finalMultiplier: 3.0,
    landed: true,
    weight: 2600,
    variants: [
      ['+2', 'x2', 'rocket'],
      ['+2'],
      ['x3']
    ]
  },
  {
    id: 'surge_4',
    label: 'TURBO BOOST',
    badgeClass: 'tier-good',
    finalMultiplier: 4.0,
    landed: true,
    weight: 2900,
    variants: [
      ['+1', 'x2'],
      ['x4'],
      ['+2', '+1'],
      ['+5', 'x2', 'rocket', 'rocket', '+1']
    ]
  },
  {
    id: 'golden_6',
    label: 'GOUDEN ESCADRILLE',
    badgeClass: 'tier-big',
    finalMultiplier: 6.0,
    landed: true,
    weight: 750,
    variants: [
      ['+2', 'x2'],
      ['+5'],
      ['+1', 'x3']
    ]
  },
  {
    id: 'wing_8',
    label: 'SUPERSONISCH',
    badgeClass: 'tier-big',
    finalMultiplier: 8.0,
    landed: true,
    weight: 350,
    variants: [
      ['+2', '+5', 'rocket', 'x2'],
      ['+1', 'x4']
    ]
  },
  {
    id: 'ace_12',
    label: 'TOP GUN VLUCHT',
    badgeClass: 'tier-mega',
    finalMultiplier: 12.0,
    landed: true,
    weight: 200,
    variants: [
      ['+5', 'x2'],
      ['+2', 'x4'],
      ['+5', 'x4', 'rocket']
    ]
  },
  {
    id: 'skyline_20',
    label: 'STRATOSFEER',
    badgeClass: 'tier-mega',
    finalMultiplier: 20.0,
    landed: true,
    weight: 120,
    variants: [
      ['+1', 'x2', '+5', 'x2', '+2'],
      ['+2', 'x3', '+1', 'x2']
    ]
  },
  {
    id: 'sovereign_40',
    label: 'MONTE CARLO ACE',
    badgeClass: 'tier-ultra',
    finalMultiplier: 40.0,
    landed: true,
    weight: 80,
    variants: [
      ['+5', 'x3', '+2', 'x2'],
      ['+1', 'x5', '+10', 'x2']
    ]
  },
  {
    id: 'emperor_75',
    label: 'KEIZERLIJKE KRUISVLUCHT',
    badgeClass: 'tier-ultra',
    finalMultiplier: 75.0,
    landed: true,
    weight: 60,
    variants: [
      ['+1', 'x3', 'x4', '+1', 'x3'],
      ['+5', 'x5', 'rocket', 'x5']
    ]
  },
  {
    id: 'legend_150',
    label: 'SALLE BLANCHE LEGENDE',
    badgeClass: 'tier-jackpot',
    finalMultiplier: 150.0,
    landed: true,
    weight: 40,
    variants: [
      ['+5', 'x5', 'x5'],
      ['+5', 'x3', 'rocket', '+1', 'x3', 'x5']
    ]
  }
];

function computeTheoreticalRtp() {
  let weightSum = 0;
  let evSum = 0;
  for (let i = 0; i < AVIA_OUTCOME_TIERS.length; i += 1) {
    const tier = AVIA_OUTCOME_TIERS[i];
    weightSum += tier.weight;
    evSum += tier.weight * tier.finalMultiplier;
  }
  return {
    weightSum,
    evSum,
    rtp: weightSum > 0 ? evSum / weightSum : 0
  };
}

const DECOY_TOKENS = ['+1', '+2', '+5', '+10', 'x2', 'x3', 'x5', 'rocket'];

module.exports = {
  MIN_BET,
  MAX_BET,
  VALID_SPEEDS,
  RECENT_HISTORY_LIMIT,
  TOTAL_WEIGHT,
  CARRIER_NAMES,
  PICKUP_ADD_TOKENS,
  PICKUP_MULT_TOKENS,
  ROCKET_TOKEN,
  DECOY_TOKENS,
  AVIA_OUTCOME_TIERS,
  tok,
  evaluateSequenceMultiplier,
  computeTheoreticalRtp
};
