/**
 * racingConstants.js
 * Constanten, pure random loting en high-drama race-choreografie voor Monaco Turf Club (Paardracen).
 *
 * House Edge & Eerlijkheid:
 * - 6 paarden per race, elk met exact 1/6 (16.67%) gelijke winstkans (geen statistieken, geen verborgen gewichten).
 * - Maximaal 1 inzet per speler per race (enkelvoudige WIN-inzet op #1).
 * - 3.0x vaste basisuitbetaling + 50% van alle verliezende inzetten verdeeld over de winnaars (Winnaarspot); andere 50% gaat naar het Casino.
 * - Bij 0 winnaars schuift 50% door naar de Winnaarspot van de volgende race (rollover max 2.5x winnende inzet -> altijd max 91.67% RTP / >= 8.33% huisvoordeel).
 */

const PHASES = Object.freeze({
  WAITING_FOR_BETS: 'WAITING_FOR_BETS',
  BETTING: 'BETTING',
  STARTING: 'STARTING',
  RACING: 'RACING',
  FINISHED: 'FINISHED',
});

const VALID_BET_TYPES = Object.freeze(['WIN']);

const MIN_BET = 10;
const MAX_BET = 50000;
const MAX_TICKETS_PER_PLAYER = 1;
const BASE_WIN_ODDS = 3.0;
const WINNER_POT_LOSER_SHARE = 0.50;
const WINNER_POT_ROLLOVER_CAP_MULT = 2.5;
const FIXED_WIN_ODDS = BASE_WIN_ODDS;

const BETTING_DURATION_SEC = 18;
const STARTING_DURATION_MS = 2600;
const RACE_TARGET_DURATION_MS = 14000;
const FINISHED_DURATION_SEC = 6;
const PHOTO_FINISH_MARGIN_MS = 180;

const TRACK_CONDITIONS = Object.freeze([
  Object.freeze({
    id: 'RIVIERA_TURF',
    label: 'Riviera Grasbaan',
    badgeClass: 'surface-turf',
    description: 'Zonnig Monaco-gras langs de haven van Port Hercule.',
  }),
  Object.freeze({
    id: 'NIGHT_DERBY',
    label: 'Nachtderby',
    badgeClass: 'surface-night',
    description: 'Verlichte Monte Carlo avondbaan onder stadionlichten.',
  }),
  Object.freeze({
    id: 'GOLDEN_HOUR',
    label: 'Goudsprint',
    badgeClass: 'surface-sunset',
    description: 'Gouden zonsondergang op snelle kustbaan.',
  }),
  Object.freeze({
    id: 'RAIN_DERBY',
    label: 'Regenbaan',
    badgeClass: 'surface-rain',
    description: 'Dramatische regenrace met opspattende kluiten.',
  }),
]);

const HORSE_ROSTER = Object.freeze([
  {
    id: 'prince-de-monaco',
    name: 'Prince de Monaco',
    jockey: 'L. Moreau',
    silkColor: '#e11d48',
    silkAccent: '#fde68a',
    silkPattern: 'sash',
    coatColor: '#7c3f1d',
  },
  {
    id: 'azure-mirage',
    name: 'Azure Mirage',
    jockey: 'C. Rossi',
    silkColor: '#0284c7',
    silkAccent: '#ffffff',
    silkPattern: 'stripe',
    coatColor: '#4b3621',
  },
  {
    id: 'obsidian-stealth',
    name: 'Obsidian Stealth',
    jockey: 'K. De Vries',
    silkColor: '#7c3aed',
    silkAccent: '#e9d5ff',
    silkPattern: 'diamond',
    coatColor: '#1f242d',
  },
  {
    id: 'belle-epoque-royal',
    name: 'Belle Epoque Royal',
    jockey: 'M. Dubois',
    silkColor: '#059669',
    silkAccent: '#fbbf24',
    silkPattern: 'chevron',
    coatColor: '#8d5524',
  },
  {
    id: 'grimaldi-champion',
    name: 'Grimaldi Champion',
    jockey: 'A. Conti',
    silkColor: '#d97706',
    silkAccent: '#fffbeb',
    silkPattern: 'check',
    coatColor: '#5c3317',
  },
  {
    id: 'riviera-lightning',
    name: 'Riviera Lightning',
    jockey: 'T. Jansen',
    silkColor: '#ec4899',
    silkAccent: '#fce7f3',
    silkPattern: 'star',
    coatColor: '#6f4e37',
  },
  {
    id: 'cote-dazur-comete',
    name: "Cote d'Azur Comete",
    jockey: 'S. Laurent',
    silkColor: '#06b6d4',
    silkAccent: '#0f172a',
    silkPattern: 'sash',
    coatColor: '#9a7b4f',
  },
  {
    id: 'monte-carlo-baron',
    name: 'Monte Carlo Baron',
    jockey: 'F. Vermeulen',
    silkColor: '#b91c1c',
    silkAccent: '#facc15',
    silkPattern: 'stripe',
    coatColor: '#3b2f2f',
  },
  {
    id: 'salle-blanche-star',
    name: 'Salle Blanche Star',
    jockey: 'E. Chevalier',
    silkColor: '#eab308',
    silkAccent: '#111827',
    silkPattern: 'star',
    coatColor: '#d2b48c',
  },
  {
    id: 'sovereign-stride',
    name: 'Sovereign Stride',
    jockey: 'J. Bakker',
    silkColor: '#14b8a6',
    silkAccent: '#ffffff',
    silkPattern: 'chevron',
    coatColor: '#63412c',
  },
  {
    id: 'golden-furlong',
    name: 'Golden Furlong',
    jockey: 'N. Fontaine',
    silkColor: '#f97316',
    silkAccent: '#1e293b',
    silkPattern: 'diamond',
    coatColor: '#8b4513',
  },
  {
    id: 'casino-eclipse',
    name: 'Casino Eclipse',
    jockey: 'D. Romano',
    silkColor: '#6366f1',
    silkAccent: '#fbbf24',
    silkPattern: 'check',
    coatColor: '#2d2926',
  },
]);

function pickTrackCondition(rng = Math.random) {
  const idx = Math.floor(rng() * TRACK_CONDITIONS.length);
  return { ...TRACK_CONDITIONS[Math.min(TRACK_CONDITIONS.length - 1, Math.max(0, idx))] };
}

function shuffleWithRng(arr, rng = Math.random) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

/**
 * Genereert 6 eerlijke random deelnemers zonder statistieken of verborgen modifiers.
 * Ieder paard heeft exact 1/6 (16.67%) kans en 3.0x basis + 50% verliezers Winnaarspot.
 */
function generateRaceCard(rng = Math.random) {
  const track = pickTrackCondition(rng);
  const selected = shuffleWithRng(HORSE_ROSTER, rng).slice(0, 6);
  const equalProb = Math.round((1 / 6) * 10000) / 10000;

  const horses = selected.map((tmpl, idx) => ({
    horseId: idx + 1,
    rosterId: tmpl.id,
    name: tmpl.name,
    jockey: tmpl.jockey,
    silkColor: tmpl.silkColor,
    silkAccent: tmpl.silkAccent,
    silkPattern: tmpl.silkPattern,
    coatColor: tmpl.coatColor,
    winProb: equalProb,
    winOdds: BASE_WIN_ODDS,
    cheers: 0,
  }));

  const turboZones = [
    { label: 'MID-SPRINT', startPct: 33, endPct: 47 },
    { label: 'EINDSPRINT', startPct: 68, endPct: 86 },
  ];

  return { track, horses, turboZones };
}

/**
 * Bouwt een visueel spannende maar 100% willekeurige 6-paarden race-tijdlijn.
 * Finishvolgorde komt uit exacte Fisher-Yates shuffle -> exact 1/6 kans per paard.
 * Bevat realistische inhaalmanoeuvres, Sprintpoort-explosies en kans op een Photo-Finish (<180ms).
 */
function simulateFairRaceTimeline(horses, rng = Math.random) {
  const count = horses.length;
  const orderIndices = shuffleWithRng(
    Array.from({ length: count }, (_, i) => i),
    rng
  );
  const finishingOrder = orderIndices.map((idx) => horses[idx].horseId);

  const isPhotoScenario = rng() < 0.30;
  const winnerFinishMs = RACE_TARGET_DURATION_MS - 1300;
  const finishTimeByHorse = {};
  const finishTimesOrdered = [winnerFinishMs];

  for (let rank = 1; rank < count; rank += 1) {
    const gap = rank === 1 && isPhotoScenario
      ? 45 + Math.floor(rng() * 120)
      : 190 + Math.floor(rng() * 260);
    finishTimesOrdered.push(finishTimesOrdered[rank - 1] + gap);
  }

  finishingOrder.forEach((horseId, rank) => {
    finishTimeByHorse[horseId] = finishTimesOrdered[rank];
  });

  const marginMs = Math.max(25, Math.round(finishTimesOrdered[1] - finishTimesOrdered[0]));
  const isPhotoFinish = marginMs <= PHOTO_FINISH_MARGIN_MS;

  // Geef elk paard een uniek visueel looppatroon (vroege starter, midden-aanvaller, late closer)
  // zodat leidingwisselingen en eindsprints op beeld echt spannend zijn.
  const tickStepMs = 150;
  const totalSimMs = Math.max(RACE_TARGET_DURATION_MS, winnerFinishMs + 650);
  const stepsToFinish = {};
  const profiles = {};

  horses.forEach((h) => {
    const archetypeRoll = rng();
    const frontBias = archetypeRoll < 0.33 ? 0.34 : (archetypeRoll < 0.66 ? -0.05 : -0.32);
    const kickCenter = archetypeRoll < 0.33 ? 0.25 : (archetypeRoll < 0.66 ? 0.50 : 0.80);
    const kickPower = archetypeRoll < 0.33 ? 0.25 : (archetypeRoll < 0.66 ? 0.48 : 0.72);
    const waveFreq = 3 + rng() * 3.5;
    const wavePhase = rng() * Math.PI * 2;

    const tFinish = finishTimeByHorse[h.horseId];
    const fineSteps = 120;
    const cumPos = [0];
    const rawVels = [];

    for (let s = 1; s <= fineSteps; s += 1) {
      const u = s / fineSteps;
      const sprintBoost = kickPower * Math.exp(-Math.pow((u - kickCenter) / 0.14, 2));
      const wave = 0.15 * Math.sin(u * Math.PI * waveFreq + wavePhase);
      const v = Math.max(0.28, 1.0 + frontBias * Math.cos(u * Math.PI) + sprintBoost + wave);
      rawVels.push(v);
      cumPos.push(cumPos[s - 1] + v);
    }

    const totalRaw = cumPos[fineSteps];
    profiles[h.horseId] = {
      tFinish,
      fineSteps,
      cumNorm: cumPos.map((c) => (c / totalRaw) * 100),
      tailCruiseVel: (rawVels[fineSteps - 1] / totalRaw) * 100 * (fineSteps / (tFinish / 1000)),
    };
    stepsToFinish[h.horseId] = tFinish;
  });

  const frames = [];
  let prevPositions = {};
  horses.forEach((h) => { prevPositions[h.horseId] = 0; });

  for (let elapsed = 0; elapsed <= totalSimMs; elapsed += tickStepMs) {
    const positions = {};
    const speeds = {};
    const surgingIds = [];

    horses.forEach((h) => {
      const prof = profiles[h.horseId];
      let posPct = 0;

      if (elapsed <= prof.tFinish) {
        const u = Math.max(0, Math.min(1, elapsed / prof.tFinish));
        const exactIdx = u * prof.fineSteps;
        const lo = Math.floor(exactIdx);
        const hi = Math.min(prof.fineSteps, lo + 1);
        const alpha = exactIdx - lo;
        posPct = prof.cumNorm[lo] * (1 - alpha) + prof.cumNorm[hi] * alpha;
      } else {
        const overtimeSec = (elapsed - prof.tFinish) / 1000;
        posPct = Math.min(103.5, 100 + overtimeSec * Math.max(5.5, prof.tailCruiseVel));
      }

      const clampedPos = Math.round(posPct * 100) / 100;
      const deltaPct = clampedPos - (prevPositions[h.horseId] || 0);
      const instSpeed = Math.round((deltaPct / (tickStepMs / 1000)) * 100) / 100;
      positions[h.horseId] = clampedPos;
      speeds[h.horseId] = instSpeed;
      if (elapsed > 600 && clampedPos < 99.5 && instSpeed >= 8.6) {
        surgingIds.push(h.horseId);
      }
    });

    prevPositions = positions;
    frames.push({
      elapsedMs: elapsed,
      positions,
      speeds,
      surgingIds,
    });

    if (elapsed >= winnerFinishMs + 420 && Object.values(positions).filter((p) => p >= 100).length >= 2) {
      break;
    }
  }

  return {
    frames,
    finishingOrder,
    finishTimes: finishTimeByHorse,
    marginMs,
    isPhotoFinish,
    durationMs: frames[frames.length - 1].elapsedMs,
  };
}

module.exports = {
  PHASES,
  VALID_BET_TYPES,
  MIN_BET,
  MAX_BET,
  MAX_TICKETS_PER_PLAYER,
  BASE_WIN_ODDS,
  WINNER_POT_LOSER_SHARE,
  WINNER_POT_ROLLOVER_CAP_MULT,
  FIXED_WIN_ODDS,
  BETTING_DURATION_SEC,
  STARTING_DURATION_MS,
  RACE_TARGET_DURATION_MS,
  FINISHED_DURATION_SEC,
  PHOTO_FINISH_MARGIN_MS,
  TRACK_CONDITIONS,
  HORSE_ROSTER,
  pickTrackCondition,
  generateRaceCard,
  simulateFairRaceTimeline,
};
