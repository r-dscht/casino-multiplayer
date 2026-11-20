/**
 * vaultsConstants.js
 * Monte Carlo Kluizenroof — Multiplayer Survival Battle-Royale Constants.
 * Strict Guardrails: Zero audio, zero Unicode emojis, zero banned brand terms.
 */

const STAKE_OPTIONS = Object.freeze([500, 1000, 2500, 5000, 10000, 25000]);
const DEFAULT_STAKE = 1000;
const MIN_CUSTOM_STAKE = 100;
const MAX_CUSTOM_STAKE = 100000;

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 12;

// 2% casino rake from total pot -> 98% net payout to last survivor
const HOUSE_RAKE_RATE = 0.02;

const INITIAL_DOOR_COUNT = 5;
const MIN_DOOR_COUNT = 2;

const LOBBY_COUNTDOWN_MS = 8000;
const CHOOSE_DURATION_MS = 10000;
const REVEAL_DURATION_MS = 3200;
const COMPLETE_HOLD_MS = 5000;

const RECENT_WINS_LIMIT = 12;

const PHASES = Object.freeze({
  WAITING: 'WAITING',
  LOBBY_COUNTDOWN: 'LOBBY_COUNTDOWN',
  CHOOSING: 'CHOOSING',
  REVEALING: 'REVEALING',
  COMPLETE: 'COMPLETE'
});

const VAULT_DOOR_PROFILES = Object.freeze([
  { index: 0, code: 'KLUIS I', name: 'Salle Grimaldi', accent: '#fde047' },
  { index: 1, code: 'KLUIS II', name: 'Coffre Royal', accent: '#34d399' },
  { index: 2, code: 'KLUIS III', name: 'Chambre Imperiale', accent: '#60a5fa' },
  { index: 3, code: 'KLUIS IV', name: 'Reserve d\'Or', accent: '#f59e0b' },
  { index: 4, code: 'KLUIS V', name: 'Sanctuaire Noir', accent: '#c084fc' }
]);

function getVaultMonogram(name) {
  const clean = String(name || 'VIP').trim();
  if (!clean) return 'VP';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

function isValidStake(amount) {
  const num = Number(amount);
  return Number.isInteger(num) && num >= MIN_CUSTOM_STAKE && num <= MAX_CUSTOM_STAKE;
}

module.exports = {
  STAKE_OPTIONS,
  DEFAULT_STAKE,
  MIN_CUSTOM_STAKE,
  MAX_CUSTOM_STAKE,
  MIN_PLAYERS,
  MAX_PLAYERS,
  HOUSE_RAKE_RATE,
  INITIAL_DOOR_COUNT,
  MIN_DOOR_COUNT,
  LOBBY_COUNTDOWN_MS,
  CHOOSE_DURATION_MS,
  REVEAL_DURATION_MS,
  COMPLETE_HOLD_MS,
  RECENT_WINS_LIMIT,
  PHASES,
  VAULT_DOOR_PROFILES,
  getVaultMonogram,
  isValidStake
};
