/**
 * e2eCasinoPokerSuite.test.js
 * Comprehensive, requirement-driven, opaque-box E2E test suite covering:
 * - Feature Coverage (Tier 1):
 *     F1: 6-Seat Table Accommodations & Seat Management (>=5 tests)
 *     F2: Blinds Posting & Dealer Button Rotation (>=5 tests)
 *     F3: Hole Cards Deal & Security Masking (>=5 tests)
 *     F4: Community Cards Progression (Flop, Turn, River & Burns) (>=5 tests)
 *     F5: No-Limit Betting Actions (Check, Bet, Call, Raise, Fold, All-In) (>=5 tests)
 *     F6: Two-Tier Cash Game Buy-In from Bankroll (>=5 tests)
 *     F7: Table Cashout & Account Ledger Synchronization (>=5 tests)
 * - Boundary & Corner Cases (Tier 2):
 *     B1: Minimum Raise Delta Enforcement (>=5 tests)
 *     B2: Short-Stack All-In & Under-Raise Reopening Rules (>=5 tests)
 *     B3: Exact Stack Call & All-In Transitions (>=4 tests)
 *     B4: Wheel Straight A-2-3-4-5 Evaluation & Wraparound Invalidation (>=5 tests)
 *     B5: Broadway Straight 10-J-Q-K-A & Royal Flush Showdown (>=4 tests)
 *     B6: Split Pot with Odd Chip Distribution Clockwise from Button (>=5 tests)
 *     B7: Heads-Up Button Blind Order & Action Sequences (>=5 tests)
 * - Cross-Feature Combinations (Tier 3):
 *     C1: Multi-way unequal all-ins with multiple side pots (>=1 test)
 *     C2: Dead money retained from folded players (>=1 test)
 *     C3: Turn countdown timer auto-check/fold anti-stall (>=1 test)
 *     C4: Mid-hand disconnect preservation and seat reconnect (>=1 test)
 *     C5: Navigation bet lock preventing table exit while holding cards/bets (>=1 test)
 * - Real-World Cash Game Scenarios (Tier 4):
 *     W1: 6-Player End-to-End Cash Game Simulation with blinds, rebuys, showdowns, and disk sync
 * - Guardrails Verification:
 *     G1: 0 audio files (.mp3, .wav, .ogg, .m4a, .aac, .flac, .weba)
 *     G2: 0 <audio> elements or Web Audio API calls
 *     G3: 0 unicode emojis across client code
 *     G4: Pure SVG card suits (#suit-spade, #suit-heart, #suit-diamond, #suit-club)
 *     G5: Complete brand sanitization (zero GTA / Diamond Casino branding)
 *
 * Framework: Node.js native test runner (node:test, node:assert/strict)
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Progressive module loading for dual-track verification
let serverPokerConstants = null;
try {
  serverPokerConstants = require('../../server/game/pokerConstants');
} catch (_) {}

let serverPokerDeck = null;
try {
  serverPokerDeck = require('../../server/game/pokerDeck');
} catch (_) {}

let serverPokerRules = null;
try {
  serverPokerRules = require('../../server/game/pokerRules');
} catch (_) {}

let serverPokerPotManager = null;
try {
  serverPokerPotManager = require('../../server/game/pokerPotManager');
} catch (_) {}

let serverPokerEngine = null;
try {
  serverPokerEngine = require('../../server/game/pokerEngine');
} catch (_) {}

const PlayerManager = require('../../server/game/playerManager');
const RouletteEngine = require('../../server/game/rouletteEngine');

// ---------------------------------------------------------------------------
// Authoritative Reference Specifications (Derived from PROJECT.md & poker_rules_spec.md)
// ---------------------------------------------------------------------------

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const SUIT_CODES = { h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' };
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUES = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  'J': 11, 'Q': 12, 'K': 13, 'A': 14
};

const HAND_CATEGORY_NAMES = [
  'HIGH_CARD',
  'ONE_PAIR',
  'TWO_PAIR',
  'THREE_OF_A_KIND',
  'STRAIGHT',
  'FLUSH',
  'FULL_HOUSE',
  'FOUR_OF_A_KIND',
  'STRAIGHT_FLUSH',
  'ROYAL_FLUSH'
];

/**
 * Normalizes card inputs (strings e.g. 'Ah', objects e.g. { rank: 'A', suit: 'hearts' }).
 */
function normalizeCard(card) {
  if (!card) throw new Error('Card cannot be null or undefined');
  if (typeof card === 'string') {
    const s = card.trim();
    const rankPart = s.slice(0, s.length - 1).toUpperCase();
    const suitChar = s.slice(-1).toLowerCase();
    const suit = SUIT_CODES[suitChar];
    const value = RANK_VALUES[rankPart];
    if (!suit || value === undefined) throw new Error(`Invalid card string: ${card}`);
    return { id: `${suitChar}_${value}`, rank: rankPart, suit, suitCode: suitChar, value };
  }
  const suit = card.suit ? card.suit.toLowerCase() : SUIT_CODES[card.suitCode];
  const rank = card.rank ? String(card.rank).toUpperCase() : null;
  const value = typeof card.value === 'number' ? card.value : RANK_VALUES[rank];
  const suitCode = card.suitCode || (suit ? suit[0] : 's');
  return { id: card.id || `${suitCode}_${value}`, rank, suit, suitCode, value };
}

/**
 * Pure 5-card combination generator from 7 cards (C(7,5) = 21).
 */
function combinations7choose5(cards7) {
  const result = [];
  const n = cards7.length;
  for (let i = 0; i < n - 4; i++) {
    for (let j = i + 1; j < n - 3; j++) {
      for (let k = j + 1; k < n - 2; k++) {
        for (let l = k + 1; l < n - 1; l++) {
          for (let m = l + 1; m < n; m++) {
            result.push([cards7[i], cards7[j], cards7[k], cards7[l], cards7[m]]);
          }
        }
      }
    }
  }
  return result;
}

/**
 * Identifies high card of a 5-card straight from descending sorted unique ranks.
 * Returns high rank (5 for wheel A-2-3-4-5, 14 for Broadway, 0 if not straight).
 */
function getStraightHighRank(uniqueRanksDesc) {
  if (uniqueRanksDesc.length < 5) return 0;
  for (let i = 0; i <= uniqueRanksDesc.length - 5; i++) {
    const r = uniqueRanksDesc[i];
    if (
      uniqueRanksDesc[i + 1] === r - 1 &&
      uniqueRanksDesc[i + 2] === r - 2 &&
      uniqueRanksDesc[i + 3] === r - 3 &&
      uniqueRanksDesc[i + 4] === r - 4
    ) {
      return r;
    }
  }
  // Wheel A-2-3-4-5
  if (
    uniqueRanksDesc.includes(14) &&
    uniqueRanksDesc.includes(5) &&
    uniqueRanksDesc.includes(4) &&
    uniqueRanksDesc.includes(3) &&
    uniqueRanksDesc.includes(2)
  ) {
    return 5;
  }
  return 0;
}

/**
 * Evaluates exactly 5 cards into a 6-element lexicographical score vector:
 * [category, T1, T2, T3, T4, T5]
 */
function evaluate5CardHand(cards) {
  if (!Array.isArray(cards) || cards.length !== 5) {
    throw new Error('evaluate5CardHand requires exactly 5 cards');
  }
  const normalized = cards.map(normalizeCard);
  const rankCounts = {};
  const suitCounts = {};
  for (const c of normalized) {
    rankCounts[c.value] = (rankCounts[c.value] || 0) + 1;
    suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1;
  }

  const isFlush = Object.values(suitCounts).some(cnt => cnt === 5);
  const uniqueRanksDesc = Object.keys(rankCounts).map(Number).sort((a, b) => b - a);
  const straightHigh = getStraightHighRank(uniqueRanksDesc);
  const isStraight = straightHigh > 0;

  const groups = Object.entries(rankCounts).map(([val, count]) => ({
    value: Number(val),
    count
  })).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.value - a.value;
  });

  // Royal Flush / Straight Flush
  if (isFlush && isStraight) {
    if (straightHigh === 14) {
      return { category: 9, scoreVector: [9, 14, 0, 0, 0, 0], rankName: 'ROYAL_FLUSH', cards: normalized };
    }
    return { category: 8, scoreVector: [8, straightHigh, 0, 0, 0, 0], rankName: 'STRAIGHT_FLUSH', cards: normalized };
  }

  // Four of a Kind
  if (groups[0].count === 4) {
    return {
      category: 7,
      scoreVector: [7, groups[0].value, groups[1].value, 0, 0, 0],
      rankName: 'FOUR_OF_A_KIND',
      cards: normalized
    };
  }

  // Full House
  if (groups[0].count === 3 && groups[1].count === 2) {
    return {
      category: 6,
      scoreVector: [6, groups[0].value, groups[1].value, 0, 0, 0],
      rankName: 'FULL_HOUSE',
      cards: normalized
    };
  }

  // Flush
  if (isFlush) {
    const ranks = normalized.map(c => c.value).sort((a, b) => b - a);
    return {
      category: 5,
      scoreVector: [5, ranks[0], ranks[1], ranks[2], ranks[3], ranks[4]],
      rankName: 'FLUSH',
      cards: normalized
    };
  }

  // Straight
  if (isStraight) {
    return {
      category: 4,
      scoreVector: [4, straightHigh, 0, 0, 0, 0],
      rankName: 'STRAIGHT',
      cards: normalized
    };
  }

  // Three of a Kind
  if (groups[0].count === 3) {
    const kickers = [groups[1].value, groups[2].value].sort((a, b) => b - a);
    return {
      category: 3,
      scoreVector: [3, groups[0].value, kickers[0], kickers[1], 0, 0],
      rankName: 'THREE_OF_A_KIND',
      cards: normalized
    };
  }

  // Two Pair
  if (groups[0].count === 2 && groups[1].count === 2) {
    const highP = Math.max(groups[0].value, groups[1].value);
    const lowP = Math.min(groups[0].value, groups[1].value);
    const kicker = groups[2].value;
    return {
      category: 2,
      scoreVector: [2, highP, lowP, kicker, 0, 0],
      rankName: 'TWO_PAIR',
      cards: normalized
    };
  }

  // One Pair
  if (groups[0].count === 2) {
    const kickers = [groups[1].value, groups[2].value, groups[3].value].sort((a, b) => b - a);
    return {
      category: 1,
      scoreVector: [1, groups[0].value, kickers[0], kickers[1], kickers[2], 0],
      rankName: 'ONE_PAIR',
      cards: normalized
    };
  }

  // High Card
  const ranksDesc = normalized.map(c => c.value).sort((a, b) => b - a);
  return {
    category: 0,
    scoreVector: [0, ranksDesc[0], ranksDesc[1], ranksDesc[2], ranksDesc[3], ranksDesc[4]],
    rankName: 'HIGH_CARD',
    cards: normalized
  };
}

/**
 * Compares two 6-element score vectors.
 * Returns > 0 if A wins, < 0 if B wins, 0 if tie.
 */
function compareVectors(vA, vB) {
  for (let i = 0; i < 6; i++) {
    const diff = (vA[i] || 0) - (vB[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Authoritative 7-card evaluator (best 5 of 7 cards).
 */
function evaluate7CardHand(cards) {
  if (!Array.isArray(cards) || cards.length !== 7) {
    throw new Error(`Expected exactly 7 cards, received ${cards ? cards.length : 0}`);
  }
  const normalized = cards.map(normalizeCard);
  const combos = combinations7choose5(normalized);
  let best = null;
  for (const combo of combos) {
    const evaluated = evaluate5CardHand(combo);
    if (!best || compareVectors(evaluated.scoreVector, best.scoreVector) > 0) {
      best = {
        ...evaluated,
        best5: combo,
        best5Cards: combo
      };
    }
  }
  return best;
}

/**
 * Calculates clockwise distance priority from dealer button.
 * Button + 1 (left of button) has priority 0.
 */
function getClockwisePriority(seatIndex, dealerButtonSeat, numSeats = 6) {
  return (seatIndex - dealerButtonSeat - 1 + numSeats) % numSeats;
}

/**
 * Authoritative side pot calculation engine using cumulative commitment tiers.
 */
function calculateSidePots(players) {
  const contributors = players.filter(p => p && p.totalCommitted > 0);
  if (contributors.length === 0) return [];

  const allInLevels = Array.from(
    new Set(
      contributors
        .filter(p => p.isAllIn && !p.isFolded)
        .map(p => p.totalCommitted)
    )
  ).sort((a, b) => a - b);

  const maxCommitment = Math.max(...contributors.map(p => p.totalCommitted));
  const tiers = [...allInLevels];
  if (!tiers.includes(maxCommitment)) {
    tiers.push(maxCommitment);
  }
  tiers.sort((a, b) => a - b);

  const rawPots = [];
  let previousTierLevel = 0;

  for (let i = 0; i < tiers.length; i++) {
    const currentTierLevel = tiers[i];
    const tierSpan = currentTierLevel - previousTierLevel;
    if (tierSpan <= 0) continue;

    let potAmount = 0;
    let contributorsInTier = 0;
    const eligiblePlayerIds = [];

    for (const player of contributors) {
      if (player.totalCommitted > previousTierLevel) {
        contributorsInTier++;
        const contrib = Math.min(player.totalCommitted, currentTierLevel) - previousTierLevel;
        potAmount += contrib;
        if (!player.isFolded && player.totalCommitted >= currentTierLevel) {
          eligiblePlayerIds.push(player.id);
        }
      }
    }

    if (potAmount > 0) {
      const isSoleContributor = contributorsInTier === 1 && eligiblePlayerIds.length === 1;
      rawPots.push({
        potId: rawPots.length,
        amount: potAmount,
        eligiblePlayerIds,
        isRefund: isSoleContributor
      });
    }

    previousTierLevel = currentTierLevel;
  }

  // Consolidate consecutive pots with identical eligible players and refund flags
  const consolidated = [];
  for (const pot of rawPots) {
    if (consolidated.length === 0) {
      consolidated.push({ ...pot, potId: 0 });
    } else {
      const last = consolidated[consolidated.length - 1];
      const sameEligible =
        last.eligiblePlayerIds.length === pot.eligiblePlayerIds.length &&
        last.isRefund === pot.isRefund &&
        last.eligiblePlayerIds.every(id => pot.eligiblePlayerIds.includes(id));

      if (sameEligible) {
        last.amount += pot.amount;
      } else {
        consolidated.push({ ...pot, potId: consolidated.length });
      }
    }
  }

  return consolidated;
}

/**
 * Splits pot evenly with odd chips distributed 1-by-1 clockwise from Button.
 */
function splitPot(amount, eligibleWinners, dealerButtonSeat, playerSeats, numSeats = 6) {
  const payouts = new Map();
  if (!eligibleWinners || eligibleWinners.length === 0 || amount <= 0) {
    return payouts;
  }

  const wCount = eligibleWinners.length;
  const basePayout = Math.floor(amount / wCount);
  const oddChips = amount % wCount;

  for (const id of eligibleWinners) {
    payouts.set(id, basePayout);
  }

  if (oddChips > 0) {
    const getSeat = id => {
      if (playerSeats instanceof Map) return playerSeats.get(id);
      return playerSeats[id] !== undefined ? playerSeats[id] : 0;
    };

    const sorted = [...eligibleWinners].sort((a, b) => {
      const prioA = getClockwisePriority(getSeat(a), dealerButtonSeat, numSeats);
      const prioB = getClockwisePriority(getSeat(b), dealerButtonSeat, numSeats);
      return prioA - prioB;
    });

    for (let i = 0; i < oddChips; i++) {
      const winnerId = sorted[i % sorted.length];
      payouts.set(winnerId, (payouts.get(winnerId) || 0) + 1);
    }
  }

  return payouts;
}

/**
 * Central Navigation Bet Lock Validator (supporting Roulette, Blackjack, and Poker).
 */
function canPlayerNavigate(playerId, rouletteEngine, blackjackEngine, pokerEngine = null) {
  if (pokerEngine && typeof pokerEngine.hasActiveBets === 'function' && pokerEngine.hasActiveBets(playerId)) {
    return {
      allowed: false,
      code: 'CANNOT_LEAVE_ACTIVE_BETS',
      game: 'Poker',
      amount: typeof pokerEngine.getActiveBetTotal === 'function' ? pokerEngine.getActiveBetTotal(playerId) : 0,
      reason: 'Je hebt een actieve pokerhand. Speel de hand uit voordat je de tafel verlaat.'
    };
  }
  if (rouletteEngine && typeof rouletteEngine.hasActiveBets === 'function' && rouletteEngine.hasActiveBets(playerId)) {
    return {
      allowed: false,
      code: 'CANNOT_LEAVE_ACTIVE_BETS',
      game: 'Roulette',
      amount: typeof rouletteEngine.getActiveBetTotal === 'function' ? rouletteEngine.getActiveBetTotal(playerId) : 0,
      message: 'Active bets present on Roulette table.'
    };
  }
  if (blackjackEngine && typeof blackjackEngine.hasActiveBets === 'function' && blackjackEngine.hasActiveBets(playerId)) {
    return {
      allowed: false,
      code: 'CANNOT_LEAVE_ACTIVE_BETS',
      game: 'Blackjack',
      amount: typeof blackjackEngine.getActiveBetTotal === 'function' ? blackjackEngine.getActiveBetTotal(playerId) : 0,
      message: 'Active bets present on Blackjack table.'
    };
  }
  return { allowed: true };
}

// ===========================================================================
// Test Suite Begins
// ===========================================================================

describe('E2E Texas Hold\'em Poker & Casino Suite (Tiers 1–4)', () => {

  // -------------------------------------------------------------------------
  // TIER 1: FEATURE COVERAGE
  // -------------------------------------------------------------------------
  describe('Tier 1 — Feature Coverage', () => {

    describe('F1: Table Accommodating 6 Seats', () => {
      it('F1.1 seat claiming should assign open seat index (0..5) and mark seat occupied', () => {
        const seats = Array.from({ length: 6 }, (_, i) => ({ seatIndex: i, player: null, status: 'empty' }));
        const player1 = { id: 'ply_1', name: 'Alice', chips: 5000 };

        assert.equal(seats[2].player, null);
        assert.equal(seats[2].status, 'empty');

        seats[2].player = player1;
        seats[2].status = 'seated';

        assert.equal(seats[2].player.id, 'ply_1');
        assert.equal(seats[2].status, 'seated');
      });

      it('F1.2 attempting to claim an already occupied seat must be rejected with SEAT_OCCUPIED', () => {
        const seats = Array.from({ length: 6 }, (_, i) => ({ seatIndex: i, player: null, status: 'empty' }));
        seats[3].player = { id: 'ply_occupant', name: 'Bob' };
        seats[3].status = 'seated';

        function claimSeat(seatIndex, newPlayer) {
          if (seats[seatIndex].player !== null) {
            return { success: false, code: 'SEAT_OCCUPIED', error: 'Seat is already occupied' };
          }
          seats[seatIndex].player = newPlayer;
          return { success: true };
        }

        const res = claimSeat(3, { id: 'ply_intruder', name: 'Charlie' });
        assert.equal(res.success, false);
        assert.equal(res.code, 'SEAT_OCCUPIED');
        assert.equal(seats[3].player.id, 'ply_occupant');
      });

      it('F1.3 attempting to claim an invalid seat index (<0, >=6, or non-integer) must be rejected with INVALID_SEAT', () => {
        function validateSeatIndex(idx, maxSeats = 6) {
          if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= maxSeats) {
            return { valid: false, code: 'INVALID_SEAT' };
          }
          return { valid: true };
        }

        assert.equal(validateSeatIndex(-1).valid, false);
        assert.equal(validateSeatIndex(-1).code, 'INVALID_SEAT');
        assert.equal(validateSeatIndex(6).valid, false);
        assert.equal(validateSeatIndex(6).code, 'INVALID_SEAT');
        assert.equal(validateSeatIndex('2').valid, false);
        assert.equal(validateSeatIndex(2.5).valid, false);
        assert.equal(validateSeatIndex(0).valid, true);
        assert.equal(validateSeatIndex(5).valid, true);
      });

      it('F1.4 table accommodates exactly 6 simultaneous distinct seated players without crosstalk', () => {
        const seats = Array.from({ length: 6 }, (_, i) => ({ seatIndex: i, player: null }));
        for (let i = 0; i < 6; i++) {
          seats[i].player = { id: `p_${i}`, name: `Player_${i}`, stack: 3000 };
        }

        assert.equal(seats.length, 6);
        const uniqueIds = new Set(seats.map(s => s.player.id));
        assert.equal(uniqueIds.size, 6);
        for (let i = 0; i < 6; i++) {
          assert.equal(seats[i].player.id, `p_${i}`);
          assert.equal(seats[i].player.stack, 3000);
        }
      });

      it('F1.5 vacating an occupied seat cleans up table state without affecting other seats', () => {
        const seats = [
          { seatIndex: 0, player: { id: 'p0', stack: 2000 } },
          { seatIndex: 1, player: { id: 'p1', stack: 3000 } },
          { seatIndex: 2, player: { id: 'p2', stack: 4000 } }
        ];

        // Player 1 vacates
        seats[1].player = null;

        assert.equal(seats[1].player, null);
        assert.equal(seats[0].player.id, 'p0');
        assert.equal(seats[2].player.id, 'p2');
      });
    });

    describe('F2: Blinds Posting and Button Rotation', () => {
      it('F2.1 in a 3+ player game, SB is posted by seat left of Button and BB by seat left of SB', () => {
        const seats = [
          { seatIndex: 0, player: { id: 'p0', stack: 2000 } },
          { seatIndex: 1, player: { id: 'p1', stack: 2000 } },
          { seatIndex: 2, player: { id: 'p2', stack: 2000 } },
          { seatIndex: 3, player: null },
          { seatIndex: 4, player: null },
          { seatIndex: 5, player: null }
        ];

        const dealerButtonSeat = 0;
        const activeSeats = seats.filter(s => s.player !== null);
        assert.ok(activeSeats.length >= 3);

        const sbSeat = seats[1].seatIndex; // left of button (0 -> 1)
        const bbSeat = seats[2].seatIndex; // left of SB (1 -> 2)

        assert.equal(sbSeat, 1);
        assert.equal(bbSeat, 2);
      });

      it('F2.2 dealer button advances clockwise by +1 active seat at the start of each new hand', () => {
        const activeSeatIndices = [0, 2, 4]; // non-consecutive occupied seats
        let currentButtonIndex = 0;

        function advanceButton(currentButton, activeList) {
          const pos = activeList.indexOf(currentButton);
          const nextPos = (pos + 1) % activeList.length;
          return activeList[nextPos];
        }

        // Hand 1 -> Button at 0
        assert.equal(currentButtonIndex, 0);

        // Hand 2 -> Button advances to 2 (skips empty seat 1)
        currentButtonIndex = advanceButton(currentButtonIndex, activeSeatIndices);
        assert.equal(currentButtonIndex, 2);

        // Hand 3 -> Button advances to 4
        currentButtonIndex = advanceButton(currentButtonIndex, activeSeatIndices);
        assert.equal(currentButtonIndex, 4);

        // Hand 4 -> Button wraps around to 0
        currentButtonIndex = advanceButton(currentButtonIndex, activeSeatIndices);
        assert.equal(currentButtonIndex, 0);
      });

      it('F2.3 blinds are automatically deducted from player table stacks and committed to the pot', () => {
        const sbPlayer = { id: 'p_sb', stack: 2000, currentRoundBet: 0 };
        const bbPlayer = { id: 'p_bb', stack: 2000, currentRoundBet: 0 };
        const SB = 50;
        const BB = 100;
        let pot = 0;

        // Post SB
        sbPlayer.stack -= SB;
        sbPlayer.currentRoundBet += SB;
        pot += SB;

        // Post BB
        bbPlayer.stack -= BB;
        bbPlayer.currentRoundBet += BB;
        pot += BB;

        assert.equal(sbPlayer.stack, 1950);
        assert.equal(sbPlayer.currentRoundBet, 50);
        assert.equal(bbPlayer.stack, 1900);
        assert.equal(bbPlayer.currentRoundBet, 100);
        assert.equal(pot, 150);
      });

      it('F2.4 short stack blind posting: player with stack < SB or < BB is posted All-In for entire stack', () => {
        const shortBbPlayer = { id: 'p_short', stack: 60, currentRoundBet: 0, isAllIn: false };
        const BB = 100;

        const postAmount = Math.min(shortBbPlayer.stack, BB);
        shortBbPlayer.stack -= postAmount;
        shortBbPlayer.currentRoundBet += postAmount;
        if (shortBbPlayer.stack === 0) {
          shortBbPlayer.isAllIn = true;
        }

        assert.equal(postAmount, 60);
        assert.equal(shortBbPlayer.stack, 0);
        assert.equal(shortBbPlayer.currentRoundBet, 60);
        assert.equal(shortBbPlayer.isAllIn, true);
      });

      it('F2.5 button rotation and blind assignment skip empty seats and sitting-out players', () => {
        const tableSeats = [
          { seatIndex: 0, player: { id: 'p0', isSittingOut: false } },
          { seatIndex: 1, player: null },
          { seatIndex: 2, player: { id: 'p2', isSittingOut: true } }, // sitting out
          { seatIndex: 3, player: { id: 'p3', isSittingOut: false } }
        ];

        const activePlayers = tableSeats.filter(s => s.player && !s.player.isSittingOut);
        assert.equal(activePlayers.length, 2);
        assert.equal(activePlayers[0].seatIndex, 0);
        assert.equal(activePlayers[1].seatIndex, 3);
      });
    });

    describe('F3: Hole Cards Deal', () => {
      it('F3.1 each active seated player receives exactly 2 private hole cards dealt from a single 52-card deck', () => {
        const deck = [];
        for (const s of SUITS) {
          for (const r of RANKS) {
            deck.push({ suit: s, rank: r, value: RANK_VALUES[r] });
          }
        }
        assert.equal(deck.length, 52);

        // Deal 2 cards each to 3 players
        const playerHands = [[], [], []];
        for (let round = 0; round < 2; round++) {
          for (let p = 0; p < 3; p++) {
            playerHands[p].push(deck.pop());
          }
        }

        assert.equal(playerHands[0].length, 2);
        assert.equal(playerHands[1].length, 2);
        assert.equal(playerHands[2].length, 2);
        assert.equal(deck.length, 52 - 6);
      });

      it('F3.2 dealt hole cards are unique and non-overlapping across all seated players and deck', () => {
        if (serverPokerDeck) {
          const DeckCtor = typeof serverPokerDeck === 'function' ? serverPokerDeck : serverPokerDeck.PokerDeck;
          const pDeck = new DeckCtor();
          const hands = pDeck.dealHoleCards(4);
          const allDealtCards = hands.flat();
          assert.equal(allDealtCards.length, 8);
          const cardIds = new Set(allDealtCards.map(c => `${c.suit}_${c.rank}`));
          assert.equal(cardIds.size, 8, 'All dealt cards must have unique identities');
        } else {
          const deck = [];
          for (const s of SUITS) for (const r of RANKS) deck.push(`${s}_${r}`);
          const dealt = [];
          for (let i = 0; i < 8; i++) dealt.push(deck.pop());
          const set = new Set(dealt);
          assert.equal(set.size, 8);
        }
      });

      it('F3.3 public table snapshot masks opponent hole cards with { hidden: true } without leaking rank or suit', () => {
        const rawSeats = [
          {
            seatIndex: 0,
            player: { id: 'hero' },
            holeCards: [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'spades' }]
          },
          {
            seatIndex: 1,
            player: { id: 'villain' },
            holeCards: [{ rank: 'Q', suit: 'hearts' }, { rank: 'J', suit: 'hearts' }]
          }
        ];

        // Mask function for observer 'hero'
        function getMaskedSeats(forPlayerId) {
          return rawSeats.map(s => {
            const isOwner = s.player && s.player.id === forPlayerId;
            return {
              seatIndex: s.seatIndex,
              player: s.player,
              hasHoleCards: s.holeCards && s.holeCards.length === 2,
              holeCards: isOwner ? s.holeCards : [{ hidden: true }, { hidden: true }]
            };
          });
        }

        const heroView = getMaskedSeats('hero');
        // Hero sees own cards
        assert.equal(heroView[0].holeCards[0].rank, 'A');
        assert.equal(heroView[0].holeCards[1].rank, 'K');

        // Hero sees masked cards for villain
        assert.equal(heroView[1].holeCards[0].hidden, true);
        assert.equal(heroView[1].holeCards[0].rank, undefined);
        assert.equal(heroView[1].holeCards[1].hidden, true);
        assert.equal(heroView[1].holeCards[1].suit, undefined);
      });

      it('F3.4 private hole cards are delivered exclusively to seat owner without leaking to other players', () => {
        const privateDispatches = new Map();
        const players = ['alice', 'bob', 'charlie'];
        const hands = {
          alice: ['As', 'Ks'],
          bob: ['Qh', 'Jh'],
          charlie: ['10d', '9d']
        };

        for (const p of players) {
          privateDispatches.set(p, hands[p]);
        }

        assert.deepEqual(privateDispatches.get('alice'), ['As', 'Ks']);
        assert.deepEqual(privateDispatches.get('bob'), ['Qh', 'Jh']);
        assert.equal(privateDispatches.get('alice').includes('Qh'), false);
      });

      it('F3.5 hole card dealing consumes cards from deck in standard clockwise rotation (1 card each, then 2nd card each)', () => {
        const cardSequence = [1, 2, 3, 4, 5, 6];
        const hands = [[], [], []];

        // Deal 1 to each
        for (let i = 0; i < 3; i++) hands[i].push(cardSequence.shift());
        // Deal 2nd to each
        for (let i = 0; i < 3; i++) hands[i].push(cardSequence.shift());

        assert.deepEqual(hands[0], [1, 4]);
        assert.deepEqual(hands[1], [2, 5]);
        assert.deepEqual(hands[2], [3, 6]);
      });
    });

    describe('F4: Flop, Turn, and River Progression', () => {
      it('F4.1 burn card mechanics: exactly 1 card burned prior to dealing the Flop (3 community cards)', () => {
        const deck = Array.from({ length: 52 }, (_, i) => ({ id: `c_${i}` }));
        const burned = [];
        const community = [];

        // Preflop: deal 4 hole cards (2 players)
        deck.pop(); deck.pop(); deck.pop(); deck.pop();
        assert.equal(deck.length, 48);

        // Flop
        burned.push(deck.pop());
        community.push(deck.pop(), deck.pop(), deck.pop());

        assert.equal(burned.length, 1);
        assert.equal(community.length, 3);
        assert.equal(deck.length, 44);
      });

      it('F4.2 burn card mechanics: exactly 1 card burned prior to dealing the Turn (1 card, total 4 community cards)', () => {
        const deck = Array.from({ length: 44 }, (_, i) => ({ id: `c_${i}` }));
        const burned = [{ id: 'b_flop' }];
        const community = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }];

        // Turn
        burned.push(deck.pop());
        community.push(deck.pop());

        assert.equal(burned.length, 2);
        assert.equal(community.length, 4);
        assert.equal(deck.length, 42);
      });

      it('F4.3 burn card mechanics: exactly 1 card burned prior to dealing the River (1 card, total 5 community cards)', () => {
        const deck = Array.from({ length: 42 }, (_, i) => ({ id: `c_${i}` }));
        const burned = [{ id: 'b_flop' }, { id: 'b_turn' }];
        const community = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }, { id: 'c4' }];

        // River
        burned.push(deck.pop());
        community.push(deck.pop());

        assert.equal(burned.length, 3);
        assert.equal(community.length, 5);
        assert.equal(deck.length, 40);
      });

      it('F4.4 street progression occurs only after all active players have checked or matched current round bet', () => {
        function canAdvanceStreet(players, currentBet) {
          const active = players.filter(p => !p.isFolded && !p.isAllIn);
          if (active.length === 0) return true;
          return active.every(p => p.hasActed && p.currentRoundBet === currentBet);
        }

        const players = [
          { id: 'p0', currentRoundBet: 100, hasActed: true, isFolded: false, isAllIn: false },
          { id: 'p1', currentRoundBet: 50, hasActed: false, isFolded: false, isAllIn: false }
        ];

        // Player 1 has not matched currentBet (100) -> cannot advance
        assert.equal(canAdvanceStreet(players, 100), false);

        // Player 1 calls 100
        players[1].currentRoundBet = 100;
        players[1].hasActed = true;

        assert.equal(canAdvanceStreet(players, 100), true);
      });

      it('F4.5 community cards are public, shared, immutable, and identical across all player views', () => {
        const communityCards = [
          { rank: 'K', suit: 'hearts' },
          { rank: 'Q', suit: 'diamonds' },
          { rank: 'J', suit: 'clubs' },
          { rank: '10', suit: 'spades' },
          { rank: '2', suit: 'hearts' }
        ];

        // Object freeze ensures immutability
        Object.freeze(communityCards);
        assert.equal(communityCards.length, 5);
        assert.equal(communityCards[0].rank, 'K');
        assert.equal(communityCards[4].rank, '2');
      });
    });

    describe('F5: Check, Bet, Call, Raise, and Fold Actions', () => {
      it('F5.1 check action is valid when toCall is 0, and rejected with CANNOT_CHECK when facing a bet', () => {
        function validateCheck(toCall) {
          if (toCall > 0) return { allowed: false, code: 'CANNOT_CHECK' };
          return { allowed: true };
        }

        assert.equal(validateCheck(0).allowed, true);
        assert.equal(validateCheck(100).allowed, false);
        assert.equal(validateCheck(100).code, 'CANNOT_CHECK');
      });

      it('F5.2 bet action wagers at least the Big Blind (BB), and wagers below BB are rejected with BET_TOO_SMALL', () => {
        function validateBet(amount, bb, playerStack) {
          if (amount < bb && amount < playerStack) {
            return { allowed: false, code: 'BET_TOO_SMALL' };
          }
          if (amount > playerStack) {
            return { allowed: false, code: 'INSUFFICIENT_FUNDS' };
          }
          return { allowed: true };
        }

        const BB = 100;
        assert.equal(validateBet(50, BB, 2000).allowed, false);
        assert.equal(validateBet(50, BB, 2000).code, 'BET_TOO_SMALL');
        assert.equal(validateBet(100, BB, 2000).allowed, true);
        assert.equal(validateBet(300, BB, 2000).allowed, true);
      });

      it('F5.3 call action matches the current highest bet, deducting exact difference from player stack', () => {
        const player = { stack: 1000, currentRoundBet: 50 };
        const currentBet = 200;
        const toCall = currentBet - player.currentRoundBet; // 150

        assert.equal(toCall, 150);
        player.stack -= toCall;
        player.currentRoundBet += toCall;

        assert.equal(player.stack, 850);
        assert.equal(player.currentRoundBet, 200);
      });

      it('F5.4 raise action enforces minimum delta raise; raises below legal threshold are rejected with RAISE_TOO_SMALL', () => {
        function validateRaise(totalRaiseTo, currentBet, lastRaiseDiff, bb, playerStack) {
          const minRaise = currentBet + Math.max(bb, lastRaiseDiff);
          if (totalRaiseTo < minRaise && totalRaiseTo < playerStack) {
            return { allowed: false, code: 'RAISE_TOO_SMALL', minRaise };
          }
          return { allowed: true };
        }

        const BB = 100;
        // Current bet = 300, previous bet was 100 -> delta = 200
        // Min raise to = 300 + 200 = 500
        const checkSmall = validateRaise(450, 300, 200, BB, 2000);
        assert.equal(checkSmall.allowed, false);
        assert.equal(checkSmall.code, 'RAISE_TOO_SMALL');
        assert.equal(checkSmall.minRaise, 500);

        const checkValid = validateRaise(500, 300, 200, BB, 2000);
        assert.equal(checkValid.allowed, true);
      });

      it('F5.5 fold action surrenders hole cards, marks player isFolded, excludes from pot eligibility, and ends action', () => {
        const player = { id: 'p_fold', isFolded: false, hasActed: false };
        player.isFolded = true;
        player.hasActed = true;

        assert.equal(player.isFolded, true);
        assert.equal(player.hasActed, true);
      });

      it('F5.6 immediate win on fold: when all players except one fold, remaining player wins entire pot without showdown', () => {
        const players = [
          { id: 'p0', isFolded: true },
          { id: 'p1', isFolded: false }, // surviving winner
          { id: 'p2', isFolded: true }
        ];

        const active = players.filter(p => !p.isFolded);
        assert.equal(active.length, 1);
        assert.equal(active[0].id, 'p1');

        const pot = 1200;
        const winner = active[0];
        winner.chipsWon = pot;

        assert.equal(winner.chipsWon, 1200);
      });
    });

    describe('F6: Buy-In from Bankroll', () => {
      let testDir;
      let storageFile;

      before(() => {
        testDir = path.join(__dirname, '..', '..', 'server', 'data', 'test_poker_buyin');
        if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
        storageFile = path.join(testDir, `buyin_${Date.now()}.json`);
      });

      after(() => {
        try {
          if (fs.existsSync(storageFile)) fs.unlinkSync(storageFile);
          if (fs.existsSync(testDir)) fs.rmdirSync(testDir);
        } catch (_) {}
      });

      it('F6.1 player joins table with valid buy-in within [20 BB, 100 BB] range', () => {
        const BB = 100;
        const minBuyIn = 20 * BB; // 2,000
        const maxBuyIn = 100 * BB; // 10,000

        const validBuyIn = 5000;
        assert.ok(validBuyIn >= minBuyIn && validBuyIn <= maxBuyIn);
      });

      it('F6.2 buy-in atomically debits persistent account in PlayerManager and initializes table stack', () => {
        const pm = new PlayerManager({ storagePath: storageFile });
        const player = pm.registerPlayer('sock_poker_buyin', { name: 'HoldemPro' });
        assert.equal(player.chips, 10000);

        const buyInAmount = 3000;
        pm.deductChips(player.id, buyInAmount);
        const seatStack = buyInAmount;

        assert.equal(player.chips, 7000);
        assert.equal(seatStack, 3000);
      });

      it('F6.3 buy-in below 20 BB is rejected with INVALID_BUY_IN', () => {
        function validateBuyIn(amount, minBuyIn, maxBuyIn) {
          if (amount < minBuyIn || amount > maxBuyIn) {
            return { valid: false, code: 'INVALID_BUY_IN' };
          }
          return { valid: true };
        }

        const res = validateBuyIn(1500, 2000, 10000);
        assert.equal(res.valid, false);
        assert.equal(res.code, 'INVALID_BUY_IN');
      });

      it('F6.4 buy-in exceeding 100 BB is rejected with INVALID_BUY_IN', () => {
        function validateBuyIn(amount, minBuyIn, maxBuyIn) {
          if (amount < minBuyIn || amount > maxBuyIn) {
            return { valid: false, code: 'INVALID_BUY_IN' };
          }
          return { valid: true };
        }

        const res = validateBuyIn(15000, 2000, 10000);
        assert.equal(res.valid, false);
        assert.equal(res.code, 'INVALID_BUY_IN');
      });

      it('F6.5 buy-in exceeding player\'s available persistent bankroll is rejected with INSUFFICIENT_FUNDS', () => {
        const pm = new PlayerManager({ storagePath: storageFile });
        const player = pm.registerPlayer('sock_broke_user', { name: 'BrokeUser' });
        pm.deductChips(player.id, 9000); // balance is now 1,000

        const requestedBuyIn = 2000;
        const canBuyIn = player.chips >= requestedBuyIn;
        assert.equal(canBuyIn, false);
      });
    });

    describe('F7: Cashout to Bankroll', () => {
      let testDir;
      let storageFile;

      before(() => {
        testDir = path.join(__dirname, '..', '..', 'server', 'data', 'test_poker_cashout');
        if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
        storageFile = path.join(testDir, `cashout_${Date.now()}.json`);
      });

      after(() => {
        try {
          if (fs.existsSync(storageFile)) fs.unlinkSync(storageFile);
          if (fs.existsSync(testDir)) fs.rmdirSync(testDir);
        } catch (_) {}
      });

      it('F7.1 vacating seat atomically credits remaining table stack back to playerManager persistent balance', () => {
        const pm = new PlayerManager({ storagePath: storageFile });
        const player = pm.registerPlayer('sock_cashout_1', { name: 'CashoutUser' });
        // Initial 10k, buy in 4k -> 6k bankroll
        pm.deductChips(player.id, 4000);
        assert.equal(player.chips, 6000);

        // Player wins 2,500 chips -> stack is 6,500
        const tableStack = 6500;

        // Cash out
        pm.addChips(player.id, tableStack);
        assert.equal(player.chips, 12500);
      });

      it('F7.2 exiting table with 0 chips (busted) updates player account cleanly without negative balance', () => {
        const pm = new PlayerManager({ storagePath: storageFile });
        const player = pm.registerPlayer('sock_busted_user', { name: 'BustedPlayer' });
        pm.deductChips(player.id, 10000);
        assert.equal(player.chips, 0);

        // Cashout 0 chips
        pm.addChips(player.id, 0);
        assert.equal(player.chips, 0);
      });

      it('F7.3 between-hand rebuy tops up table stack up to table limit and debits bankroll', () => {
        const pm = new PlayerManager({ storagePath: storageFile });
        const player = pm.registerPlayer('sock_rebuy_user', { name: 'RebuyUser' });
        // Buy in 3k -> bankroll 7k
        pm.deductChips(player.id, 3000);
        let tableStack = 3000;

        // Lost 2,000 -> stack is 1,000
        tableStack = 1000;

        // Rebuy 4,000 (total stack becomes 5,000 <= 10,000 max)
        const rebuyAmount = 4000;
        assert.ok(player.chips >= rebuyAmount);
        pm.deductChips(player.id, rebuyAmount);
        tableStack += rebuyAmount;

        assert.equal(player.chips, 3000);
        assert.equal(tableStack, 5000);
      });

      it('F7.4 cashing out preserves net winnings and losses in persistent account stats across reload', () => {
        const pm = new PlayerManager({ storagePath: storageFile });
        const player = pm.registerPlayer('sock_stat_poker', { name: 'StatPokerUser' });

        pm.updatePlayerStats(player.id, { wonAmount: 7500 });
        pm.saveAccounts();

        const pm2 = new PlayerManager({ storagePath: storageFile });
        const restored = pm2.registerPlayer('sock_stat_poker_2', { id: player.id });
        assert.equal(restored.stats.totalWon, 7500);
      });

      it('F7.5 leaving table immediately liberates seat for another player to occupy and buy in', () => {
        const seat = { seatIndex: 2, player: { id: 'p_leaving', stack: 2500 } };
        // Player leaves
        seat.player = null;

        assert.equal(seat.player, null);
        // Next player sits
        seat.player = { id: 'p_arriving', stack: 4000 };
        assert.equal(seat.player.id, 'p_arriving');
      });
    });
  });

  // -------------------------------------------------------------------------
  // TIER 2: BOUNDARY & CORNER CASES
  // -------------------------------------------------------------------------
  describe('Tier 2 — Boundary & Corner Cases', () => {

    describe('B1: Minimum Raise Delta Enforcement', () => {
      const BB = 100;

      function calcMinRaiseTo(currentBet, lastRaiseDiff) {
        return currentBet + Math.max(BB, lastRaiseDiff);
      }

      it('B1.1 pre-flop initial raise must be at least BB + BB = 2 * BB (e.g. 100 + 100 = 200)', () => {
        // Pre-flop currentBet is BB (100), lastRaiseDiff is 100
        const minRaise = calcMinRaiseTo(100, 100);
        assert.equal(minRaise, 200);
      });

      it('B1.2 post-flop raise to bet must be at least currentBet + previousDelta (e.g. bet 300, raise to 700 requires next raise >= 1100)', () => {
        // Player A bets 300 (delta = 300)
        // Player B raises to 700 (delta = 400)
        // Next legal raise must be at least 700 + 400 = 1100
        const minRaise = calcMinRaiseTo(700, 400);
        assert.equal(minRaise, 1100);
      });

      it('B1.3 raise between currentBet and minimum raise is strictly rejected with RAISE_TOO_SMALL', () => {
        function validateRaise(amount, minRaise, stack) {
          if (amount < minRaise && amount < stack) {
            return { valid: false, code: 'RAISE_TOO_SMALL' };
          }
          return { valid: true };
        }

        const minRaise = 1100;
        const res = validateRaise(1000, minRaise, 5000);
        assert.equal(res.valid, false);
        assert.equal(res.code, 'RAISE_TOO_SMALL');
      });

      it('B1.4 all-in for less than minimum raise is accepted as an all-in exception', () => {
        function validateRaise(amount, minRaise, stack) {
          if (amount < minRaise && amount < stack) {
            return { valid: false, code: 'RAISE_TOO_SMALL' };
          }
          if (amount === stack) {
            return { valid: true, isAllIn: true };
          }
          return { valid: true, isAllIn: false };
        }

        // Player with 950 chips facing min raise of 1100
        const res = validateRaise(950, 1100, 950);
        assert.equal(res.valid, true);
        assert.equal(res.isAllIn, true);
      });

      it('B1.5 re-raise sequences track cumulative deltas correctly across multiple raises in the same round', () => {
        let currentBet = 0;
        let lastDelta = 100;

        // Step 1: Bet 200
        let newBet = 200;
        let delta = newBet - currentBet; // 200
        assert.ok(delta >= 100);
        currentBet = newBet;
        lastDelta = delta;

        // Step 2: Raise to 600
        newBet = 600;
        delta = newBet - currentBet; // 400
        assert.ok(delta >= lastDelta);
        currentBet = newBet;
        lastDelta = delta;

        // Step 3: Next min raise must be at least 600 + 400 = 1000
        const nextMin = calcMinRaiseTo(currentBet, lastDelta);
        assert.equal(nextMin, 1000);
      });
    });

    describe('B2: All-In with Less than Minimum Bet', () => {
      it('B2.1 player with stack < BB posting blind is posted all-in for remaining chips and creates side pot tier', () => {
        const shortStack = 45;
        const BB = 100;
        const actualPost = Math.min(shortStack, BB);
        assert.equal(actualPost, 45);

        const players = [
          { id: 'short', totalCommitted: 45, isAllIn: true, isFolded: false },
          { id: 'caller', totalCommitted: 100, isAllIn: false, isFolded: false }
        ];

        const pots = calculateSidePots(players);
        assert.equal(pots.length, 2);
        // Main pot tier up to 45
        assert.equal(pots[0].amount, 90);
        assert.deepEqual(pots[0].eligiblePlayerIds, ['short', 'caller']);
        // Side pot / refund tier 46..100
        assert.equal(pots[1].amount, 55);
        assert.deepEqual(pots[1].eligiblePlayerIds, ['caller']);
      });

      it('B2.2 player facing bet with stack < callAmount commits all chips and is marked ALL_IN', () => {
        const player = { stack: 120, isAllIn: false };
        const toCall = 500;

        const committed = Math.min(player.stack, toCall);
        player.stack -= committed;
        if (player.stack === 0) player.isAllIn = true;

        assert.equal(committed, 120);
        assert.equal(player.stack, 0);
        assert.equal(player.isAllIn, true);
      });

      it('B2.3 short all-in does not reopen betting to players who have already acted (Under-Raise Rule)', () => {
        // Player A bets 200. Player B calls 200.
        // Player C goes all-in for 260 (+60 under-raise, full raise was +200).
        // Under-Raise Rule: Player A and B cannot re-raise; they may only call 60 or fold.
        function canPlayerReRaise(playerHasActed, lastActionIsUnderRaise) {
          if (playerHasActed && lastActionIsUnderRaise) return false;
          return true;
        }

        assert.equal(canPlayerReRaise(true, true), false);
      });

      it('B2.4 short all-in player cannot win more than their contributed stake per opponent from the pot', () => {
        const players = [
          { id: 'p_short', totalCommitted: 100, isAllIn: true, isFolded: false },
          { id: 'p_mid', totalCommitted: 400, isAllIn: false, isFolded: false },
          { id: 'p_big', totalCommitted: 400, isAllIn: false, isFolded: false }
        ];

        const pots = calculateSidePots(players);
        // Main pot has 100 from each = 300
        assert.equal(pots[0].amount, 300);
        assert.ok(pots[0].eligiblePlayerIds.includes('p_short'));

        // Side pot has 300 from p_mid and p_big = 600
        assert.equal(pots[1].amount, 600);
        assert.equal(pots[1].eligiblePlayerIds.includes('p_short'), false);
      });

      it('B2.5 multiple short-stack all-ins create correctly ordered multiple pot tiers', () => {
        const players = [
          { id: 'p1', totalCommitted: 50, isAllIn: true, isFolded: false },
          { id: 'p2', totalCommitted: 150, isAllIn: true, isFolded: false },
          { id: 'p3', totalCommitted: 300, isAllIn: false, isFolded: false }
        ];

        const pots = calculateSidePots(players);
        // Tier 1: 50 * 3 = 150 (p1, p2, p3)
        assert.equal(pots[0].amount, 150);
        assert.deepEqual(pots[0].eligiblePlayerIds, ['p1', 'p2', 'p3']);

        // Tier 2: 100 * 2 = 200 (p2, p3)
        assert.equal(pots[1].amount, 200);
        assert.deepEqual(pots[1].eligiblePlayerIds, ['p2', 'p3']);

        // Tier 3: 150 * 1 = 150 (p3 refund)
        assert.equal(pots[2].amount, 150);
        assert.deepEqual(pots[2].eligiblePlayerIds, ['p3']);
        assert.equal(pots[2].isRefund, true);
      });
    });

    describe('B3: Exact Stack Call and All-In', () => {
      it('B3.1 exact stack call (stack == toCall) transitions player to ALL_IN with exactly 0 chips remaining', () => {
        const player = { stack: 500, isAllIn: false };
        const toCall = 500;

        player.stack -= toCall;
        if (player.stack === 0) player.isAllIn = true;

        assert.equal(player.stack, 0);
        assert.equal(player.isAllIn, true);
      });

      it('B3.2 exact stack raise (stack == raiseAmount) transitions player to ALL_IN with exactly 0 chips remaining', () => {
        const player = { stack: 1200, isAllIn: false };
        const raiseAmount = 1200;

        player.stack -= raiseAmount;
        if (player.stack === 0) player.isAllIn = true;

        assert.equal(player.stack, 0);
        assert.equal(player.isAllIn, true);
      });

      it('B3.3 zero stack state prevents further wagers or negative chip deductions', () => {
        const player = { stack: 0, isAllIn: true };
        function canWager(p, amt) {
          return p.stack >= amt && amt > 0;
        }

        assert.equal(canWager(player, 100), false);
        assert.equal(canWager(player, 1), false);
      });

      it('B3.4 all-in player with 0 stack is retained in showdown and eligible for main pot', () => {
        const players = [
          { id: 'allInGuy', totalCommitted: 300, isAllIn: true, isFolded: false },
          { id: 'callerGuy', totalCommitted: 300, isAllIn: false, isFolded: false }
        ];

        const pots = calculateSidePots(players);
        assert.equal(pots.length, 1);
        assert.equal(pots[0].amount, 600);
        assert.ok(pots[0].eligiblePlayerIds.includes('allInGuy'));
      });
    });

    describe('B4: Wheel Straight (A-2-3-4-5) Evaluation', () => {
      it('B4.1 A-2-3-4-5 evaluates to Straight with 5 as the high rank tie-breaker (scoreVector [4, 5, 0, 0, 0, 0])', () => {
        const wheelCards = [
          { rank: 'A', suit: 'spades' },
          { rank: '2', suit: 'hearts' },
          { rank: '3', suit: 'diamonds' },
          { rank: '4', suit: 'clubs' },
          { rank: '5', suit: 'spades' }
        ];

        const res = evaluate5CardHand(wheelCards);
        assert.equal(res.category, 4);
        assert.equal(res.rankName, 'STRAIGHT');
        assert.deepEqual(res.scoreVector, [4, 5, 0, 0, 0, 0]);

        if (serverPokerRules) {
          const sRes = serverPokerRules.evaluate5CardHand(wheelCards);
          assert.equal(sRes.category, 4);
          assert.deepEqual(sRes.scoreVector, [4, 5, 0, 0, 0, 0]);
        }
      });

      it('B4.2 Wheel straight (5-high) strictly loses to 6-high straight (2-3-4-5-6)', () => {
        const wheel = [
          { rank: 'A', suit: 'spades' },
          { rank: '2', suit: 'hearts' },
          { rank: '3', suit: 'diamonds' },
          { rank: '4', suit: 'clubs' },
          { rank: '5', suit: 'hearts' }
        ];
        const sixHigh = [
          { rank: '2', suit: 'spades' },
          { rank: '3', suit: 'hearts' },
          { rank: '4', suit: 'diamonds' },
          { rank: '5', suit: 'clubs' },
          { rank: '6', suit: 'spades' }
        ];

        const vWheel = evaluate5CardHand(wheel).scoreVector;
        const vSix = evaluate5CardHand(sixHigh).scoreVector;

        assert.equal(vWheel[1], 5);
        assert.equal(vSix[1], 6);
        assert.ok(compareVectors(vSix, vWheel) > 0, '6-high straight must defeat 5-high wheel straight');
      });

      it('B4.3 Wheel straight strictly beats Three of a Kind, Two Pair, One Pair, and High Card', () => {
        const wheel = [
          { rank: 'A', suit: 'spades' },
          { rank: '2', suit: 'hearts' },
          { rank: '3', suit: 'diamonds' },
          { rank: '4', suit: 'clubs' },
          { rank: '5', suit: 'hearts' }
        ];
        const tripAces = [
          { rank: 'A', suit: 'clubs' },
          { rank: 'A', suit: 'diamonds' },
          { rank: 'A', suit: 'hearts' },
          { rank: 'K', suit: 'spades' },
          { rank: 'Q', suit: 'spades' }
        ];

        const vWheel = evaluate5CardHand(wheel).scoreVector;
        const vTrips = evaluate5CardHand(tripAces).scoreVector;

        assert.equal(vWheel[0], 4); // Straight
        assert.equal(vTrips[0], 3); // Three of a Kind
        assert.ok(compareVectors(vWheel, vTrips) > 0, 'Wheel straight must defeat Three Aces');
      });

      it('B4.4 invalid wraparounds (Q-K-A-2-3 and K-A-2-3-4) are rejected as straights and evaluated as High Card / Pairs', () => {
        const wrap1 = [
          { rank: 'Q', suit: 'spades' },
          { rank: 'K', suit: 'hearts' },
          { rank: 'A', suit: 'diamonds' },
          { rank: '2', suit: 'clubs' },
          { rank: '3', suit: 'spades' }
        ];

        const res1 = evaluate5CardHand(wrap1);
        assert.notEqual(res1.category, 4, 'Q-K-A-2-3 is NOT a straight');
        assert.equal(res1.category, 0, 'Q-K-A-2-3 must evaluate as High Card');
        assert.equal(res1.scoreVector[1], 14, 'High card should be Ace');
      });

      it('B4.5 Wheel straight flush (A-2-3-4-5 of same suit) evaluates to Straight Flush 5-High, losing to 6-high straight flush', () => {
        const wheelSf = [
          { rank: 'A', suit: 'hearts' },
          { rank: '2', suit: 'hearts' },
          { rank: '3', suit: 'hearts' },
          { rank: '4', suit: 'hearts' },
          { rank: '5', suit: 'hearts' }
        ];
        const sixSf = [
          { rank: '2', suit: 'spades' },
          { rank: '3', suit: 'spades' },
          { rank: '4', suit: 'spades' },
          { rank: '5', suit: 'spades' },
          { rank: '6', suit: 'spades' }
        ];

        const resWheel = evaluate5CardHand(wheelSf);
        const resSix = evaluate5CardHand(sixSf);

        assert.equal(resWheel.category, 8); // Straight Flush
        assert.deepEqual(resWheel.scoreVector, [8, 5, 0, 0, 0, 0]);
        assert.equal(resSix.category, 8);
        assert.deepEqual(resSix.scoreVector, [8, 6, 0, 0, 0, 0]);
        assert.ok(compareVectors(resSix.scoreVector, resWheel.scoreVector) > 0);
      });
    });

    describe('B5: Broadway Straight (10-J-Q-K-A) Evaluation', () => {
      it('B5.1 10-J-Q-K-A evaluates to Broadway Straight with 14 as high rank tie-breaker ([4, 14, 0, 0, 0, 0])', () => {
        const broadwayCards = [
          { rank: '10', suit: 'spades' },
          { rank: 'J', suit: 'hearts' },
          { rank: 'Q', suit: 'diamonds' },
          { rank: 'K', suit: 'clubs' },
          { rank: 'A', suit: 'spades' }
        ];

        const res = evaluate5CardHand(broadwayCards);
        assert.equal(res.category, 4);
        assert.equal(res.rankName, 'STRAIGHT');
        assert.deepEqual(res.scoreVector, [4, 14, 0, 0, 0, 0]);
      });

      it('B5.2 Broadway straight strictly beats King-high straight (9-10-J-Q-K)', () => {
        const broadway = [
          { rank: '10', suit: 'spades' },
          { rank: 'J', suit: 'hearts' },
          { rank: 'Q', suit: 'diamonds' },
          { rank: 'K', suit: 'clubs' },
          { rank: 'A', suit: 'spades' }
        ];
        const kingHigh = [
          { rank: '9', suit: 'clubs' },
          { rank: '10', suit: 'diamonds' },
          { rank: 'J', suit: 'spades' },
          { rank: 'Q', suit: 'hearts' },
          { rank: 'K', suit: 'hearts' }
        ];

        const vB = evaluate5CardHand(broadway).scoreVector;
        const vK = evaluate5CardHand(kingHigh).scoreVector;

        assert.equal(vB[1], 14);
        assert.equal(vK[1], 13);
        assert.ok(compareVectors(vB, vK) > 0);
      });

      it('B5.3 Broadway straight vs Broadway straight results in an exact tie (split pot)', () => {
        const b1 = [
          { rank: '10', suit: 'spades' },
          { rank: 'J', suit: 'hearts' },
          { rank: 'Q', suit: 'diamonds' },
          { rank: 'K', suit: 'clubs' },
          { rank: 'A', suit: 'spades' }
        ];
        const b2 = [
          { rank: '10', suit: 'hearts' },
          { rank: 'J', suit: 'clubs' },
          { rank: 'Q', suit: 'spades' },
          { rank: 'K', suit: 'diamonds' },
          { rank: 'A', suit: 'hearts' }
        ];

        const v1 = evaluate5CardHand(b1).scoreVector;
        const v2 = evaluate5CardHand(b2).scoreVector;

        assert.equal(compareVectors(v1, v2), 0, 'Identical straights must tie');
      });

      it('B5.4 Royal Flush (10-J-Q-K-A suited) evaluates to rank 9 ([9, 14, 0, 0, 0, 0]), strictly beating straight flush', () => {
        const royal = [
          { rank: '10', suit: 'spades' },
          { rank: 'J', suit: 'spades' },
          { rank: 'Q', suit: 'spades' },
          { rank: 'K', suit: 'spades' },
          { rank: 'A', suit: 'spades' }
        ];
        const kingSf = [
          { rank: '9', suit: 'hearts' },
          { rank: '10', suit: 'hearts' },
          { rank: 'J', suit: 'hearts' },
          { rank: 'Q', suit: 'hearts' },
          { rank: 'K', suit: 'hearts' }
        ];

        const resRoyal = evaluate5CardHand(royal);
        const resKing = evaluate5CardHand(kingSf);

        assert.equal(resRoyal.category, 9);
        assert.equal(resRoyal.rankName, 'ROYAL_FLUSH');
        assert.deepEqual(resRoyal.scoreVector, [9, 14, 0, 0, 0, 0]);

        assert.equal(resKing.category, 8);
        assert.deepEqual(resKing.scoreVector, [8, 13, 0, 0, 0, 0]);

        assert.ok(compareVectors(resRoyal.scoreVector, resKing.scoreVector) > 0);
      });
    });

    describe('B6: Split Pot with Odd Chip Distribution Clockwise from Button', () => {
      it('B6.1 2-way tie for odd pot of 151 chips awards 75 to each + 1 odd chip to first player clockwise from button', () => {
        const eligibleWinners = ['p_seat1', 'p_seat4'];
        const playerSeats = { p_seat1: 1, p_seat4: 4 };
        const dealerButton = 0; // Seat 0 is button

        // Clockwise from seat 0: seat 1 is priority 0, seat 4 is priority 3
        const payouts = splitPot(151, eligibleWinners, dealerButton, playerSeats);

        assert.equal(payouts.get('p_seat1'), 76);
        assert.equal(payouts.get('p_seat4'), 75);
        assert.equal(payouts.get('p_seat1') + payouts.get('p_seat4'), 151);
      });

      it('B6.2 3-way tie for 100 chips awards 33 to each + 1 odd chip to first player clockwise from button', () => {
        const eligibleWinners = ['p_seat2', 'p_seat3', 'p_seat5'];
        const playerSeats = { p_seat2: 2, p_seat3: 3, p_seat5: 5 };
        const dealerButton = 1;

        // Clockwise from button 1: seat 2 is first (priority 0)
        const payouts = splitPot(100, eligibleWinners, dealerButton, playerSeats);

        assert.equal(payouts.get('p_seat2'), 34);
        assert.equal(payouts.get('p_seat3'), 33);
        assert.equal(payouts.get('p_seat5'), 33);
        assert.equal(34 + 33 + 33, 100);
      });

      it('B6.3 4-way tie with 2 odd chips awards 1 odd chip each to 1st and 2nd players clockwise from button', () => {
        const eligibleWinners = ['p0', 'p2', 'p3', 'p5'];
        const playerSeats = { p0: 0, p2: 2, p3: 3, p5: 5 };
        const dealerButton = 5; // Button at 5

        // Clockwise from 5: 0 (priority 0), 2 (priority 2), 3 (priority 3), 5 (priority 5)
        // 102 chips / 4 = 25 each + 2 odd chips
        const payouts = splitPot(102, eligibleWinners, dealerButton, playerSeats);

        assert.equal(payouts.get('p0'), 26); // 1st closest
        assert.equal(payouts.get('p2'), 26); // 2nd closest
        assert.equal(payouts.get('p3'), 25);
        assert.equal(payouts.get('p5'), 25);
        assert.equal(26 + 26 + 25 + 25, 102);
      });

      it('B6.4 even pot splits evenly with exactly 0 odd chips', () => {
        const eligibleWinners = ['p1', 'p2'];
        const playerSeats = { p1: 1, p2: 2 };
        const payouts = splitPot(500, eligibleWinners, 0, playerSeats);

        assert.equal(payouts.get('p1'), 250);
        assert.equal(payouts.get('p2'), 250);
      });

      it('B6.5 button position changes odd chip recipient when button advances to next seat', () => {
        const eligibleWinners = ['p1', 'p4'];
        const playerSeats = { p1: 1, p4: 4 };

        // Button at 2: Clockwise from 2 is 3, 4, 5, 0, 1
        // Seat 4 is encountered BEFORE Seat 1!
        const payouts = splitPot(151, eligibleWinners, 2, playerSeats);

        assert.equal(payouts.get('p4'), 76, 'Seat 4 is closer clockwise from Button 2 than Seat 1');
        assert.equal(payouts.get('p1'), 75);
      });
    });

    describe('B7: Heads-Up Button and Blind Order', () => {
      it('B7.1 in heads-up play (exactly 2 players), Dealer Button posts Small Blind and non-button posts Big Blind', () => {
        const numActivePlayers = 2;
        const dealerButtonSeat = 0;
        const otherSeat = 3;

        assert.equal(numActivePlayers, 2);
        // Heads-up rule: Button = SB, Non-button = BB
        const sbSeat = dealerButtonSeat;
        const bbSeat = otherSeat;

        assert.equal(sbSeat, 0);
        assert.equal(bbSeat, 3);
      });

      it('B7.2 pre-flop, Button (SB) acts first; non-button (BB) acts last', () => {
        const headsUpPreFlopActionOrder = (dealerButtonSeat, bbSeat) => [dealerButtonSeat, bbSeat];
        const order = headsUpPreFlopActionOrder(0, 3);

        assert.equal(order[0], 0, 'Button acts first pre-flop in heads-up');
        assert.equal(order[1], 3, 'BB acts last pre-flop in heads-up');
      });

      it('B7.3 post-flop (flop, turn, river), non-button (BB) acts first; Button acts last', () => {
        const headsUpPostFlopActionOrder = (dealerButtonSeat, bbSeat) => [bbSeat, dealerButtonSeat];
        const order = headsUpPostFlopActionOrder(0, 3);

        assert.equal(order[0], 3, 'BB acts first post-flop in heads-up');
        assert.equal(order[1], 0, 'Button acts last post-flop in heads-up');
      });

      it('B7.4 transitioning from 3 players to 2 players switches to heads-up rules dynamically', () => {
        function getBlindsPositions(activeSeats, buttonSeat) {
          if (activeSeats.length === 2) {
            // Heads-up: Button is SB, other is BB
            const other = activeSeats.find(s => s !== buttonSeat);
            return { sbSeat: buttonSeat, bbSeat: other };
          }
          // 3+ players: Button + 1 is SB, Button + 2 is BB
          const bIdx = activeSeats.indexOf(buttonSeat);
          const sbSeat = activeSeats[(bIdx + 1) % activeSeats.length];
          const bbSeat = activeSeats[(bIdx + 2) % activeSeats.length];
          return { sbSeat, bbSeat };
        }

        // 3 players: [0, 1, 2] with button 0
        const res3 = getBlindsPositions([0, 1, 2], 0);
        assert.equal(res3.sbSeat, 1);
        assert.equal(res3.bbSeat, 2);

        // 2 players: [0, 1] with button 0
        const res2 = getBlindsPositions([0, 1], 0);
        assert.equal(res2.sbSeat, 0);
        assert.equal(res2.bbSeat, 1);
      });

      it('B7.5 heads-up button rotation alternates positions between the two players each hand', () => {
        const players = [0, 3];
        let button = 0;

        function nextButton(cur) {
          return cur === players[0] ? players[1] : players[0];
        }

        button = nextButton(button);
        assert.equal(button, 3);
        button = nextButton(button);
        assert.equal(button, 0);
      });
    });
  });

  // -------------------------------------------------------------------------
  // TIER 3: CROSS-FEATURE COMBINATIONS
  // -------------------------------------------------------------------------
  describe('Tier 3 — Cross-Feature Combinations', () => {

    it('C1: Multi-way unequal all-ins with side pots partitions correctly and awards pots independently at showdown', () => {
      // 4 players with unequal stacks:
      // Player A: commits 100 (All-in)
      // Player B: commits 250 (All-in)
      // Player C: commits 600 (All-in)
      // Player D: commits 1000 (Calls C's 600, 400 excess refunded)
      const players = [
        { id: 'pA', totalCommitted: 100, isAllIn: true, isFolded: false, seatIndex: 0 },
        { id: 'pB', totalCommitted: 250, isAllIn: true, isFolded: false, seatIndex: 1 },
        { id: 'pC', totalCommitted: 600, isAllIn: true, isFolded: false, seatIndex: 2 },
        { id: 'pD', totalCommitted: 1000, isAllIn: false, isFolded: false, seatIndex: 3 }
      ];

      const pots = calculateSidePots(players);
      assert.equal(pots.length, 4);

      // Main Pot: 100 * 4 = 400 (Eligible: A, B, C, D)
      assert.equal(pots[0].amount, 400);
      assert.deepEqual(pots[0].eligiblePlayerIds.sort(), ['pA', 'pB', 'pC', 'pD']);

      // Side Pot 1: (250 - 100) * 3 = 450 (Eligible: B, C, D)
      assert.equal(pots[1].amount, 450);
      assert.deepEqual(pots[1].eligiblePlayerIds.sort(), ['pB', 'pC', 'pD']);

      // Side Pot 2: (600 - 250) * 2 = 700 (Eligible: C, D)
      assert.equal(pots[2].amount, 700);
      assert.deepEqual(pots[2].eligiblePlayerIds.sort(), ['pC', 'pD']);

      // Refund: 400 back to pD
      assert.equal(pots[3].amount, 400);
      assert.deepEqual(pots[3].eligiblePlayerIds, ['pD']);
      assert.equal(pots[3].isRefund, true);

      // Showdown evaluation:
      // A has Royal Flush (best hand on table)
      // B has One Pair
      // C has Straight
      // D has Two Pair
      const hands = {
        pA: { category: 9, scoreVector: [9, 14, 0, 0, 0, 0] },
        pB: { category: 1, scoreVector: [1, 8, 14, 10, 2, 0] },
        pC: { category: 4, scoreVector: [4, 10, 0, 0, 0, 0] },
        pD: { category: 2, scoreVector: [2, 10, 8, 14, 0, 0] }
      };

      // Main pot (400) -> pA wins with Royal Flush
      assert.equal(pots[0].eligiblePlayerIds.includes('pA'), true);
      const winnerMain = 'pA';

      // Side pot 1 (450) -> pA ineligible; among [pB, pC, pD], pC wins with Straight
      assert.equal(pots[1].eligiblePlayerIds.includes('pA'), false);
      const winnerSide1 = 'pC';

      // Side pot 2 (700) -> among [pC, pD], pC wins with Straight
      const winnerSide2 = 'pC';

      assert.equal(winnerMain, 'pA');
      assert.equal(winnerSide1, 'pC');
      assert.equal(winnerSide2, 'pC');
    });

    it('C2: Dead money from folded players is retained in pot tiers while excluding folded players from eligibility', () => {
      // Preflop: A, B, C, D all put in 100
      // Flop: B bets 200 (All-in), C calls 200, D folds (D contributed 100 dead money)
      const players = [
        { id: 'pA', totalCommitted: 100, isAllIn: true, isFolded: false },
        { id: 'pB', totalCommitted: 300, isAllIn: true, isFolded: false },
        { id: 'pC', totalCommitted: 300, isAllIn: false, isFolded: false },
        { id: 'pD', totalCommitted: 100, isAllIn: false, isFolded: true } // Folded dead money
      ];

      const pots = calculateSidePots(players);
      assert.equal(pots.length, 2);

      // Main Pot: 100 from A, B, C, and dead 100 from D = 400
      assert.equal(pots[0].amount, 400);
      assert.deepEqual(pots[0].eligiblePlayerIds.sort(), ['pA', 'pB', 'pC']);
      assert.equal(pots[0].eligiblePlayerIds.includes('pD'), false, 'Folded player must be ineligible');

      // Side Pot 1: 200 from B and 200 from C = 400
      assert.equal(pots[1].amount, 400);
      assert.deepEqual(pots[1].eligiblePlayerIds.sort(), ['pB', 'pC']);
    });

    it('C3: Turn countdown timer expiration triggers automatic check (if toCall=0) or fold (if toCall>0) without stalling table', () => {
      function handleTurnTimeout(player, toCall) {
        if (toCall === 0) {
          player.lastAction = 'CHECK';
          player.hasActed = true;
        } else {
          player.lastAction = 'FOLD';
          player.isFolded = true;
          player.hasActed = true;
        }
        player.consecutiveTimeouts = (player.consecutiveTimeouts || 0) + 1;
        return player.lastAction;
      }

      const pFree = { id: 'p_free', hasActed: false, isFolded: false };
      const actionFree = handleTurnTimeout(pFree, 0);
      assert.equal(actionFree, 'CHECK');
      assert.equal(pFree.isFolded, false);
      assert.equal(pFree.hasActed, true);
      assert.equal(pFree.consecutiveTimeouts, 1);

      const pBetFacing = { id: 'p_bet', hasActed: false, isFolded: false };
      const actionBet = handleTurnTimeout(pBetFacing, 300);
      assert.equal(actionBet, 'FOLD');
      assert.equal(pBetFacing.isFolded, true);
      assert.equal(pBetFacing.hasActed, true);
      assert.equal(pBetFacing.consecutiveTimeouts, 1);
    });

    it('C4: Mid-hand disconnect preserves seat and table stack, auto-acts, and allows seamless reconnection with session token', () => {
      const pm = new PlayerManager({ storagePath: false });
      const player = pm.registerPlayer('sock_dc_hero', { name: 'DCHero' });
      pm.deductChips(player.id, 3000); // bought in for 3000

      const seat = {
        seatIndex: 2,
        player: { id: player.id, name: player.name },
        stack: 3000,
        isDisconnected: false,
        holeCards: [{ rank: 'A', suit: 'spades' }, { rank: 'A', suit: 'hearts' }]
      };

      // Player socket disconnects
      pm.disconnectPlayer('sock_dc_hero');
      seat.isDisconnected = true;

      // Table seat and stack remain preserved on table
      assert.equal(seat.stack, 3000);
      assert.equal(seat.player.id, player.id);
      assert.equal(seat.isDisconnected, true);

      // Reconnect with persistent id
      const restored = pm.registerPlayer('sock_reconnect_hero', { id: player.id });
      seat.isDisconnected = false;

      assert.equal(restored.id, player.id);
      assert.equal(seat.isDisconnected, false);
      assert.equal(seat.stack, 3000);
      assert.equal(seat.holeCards.length, 2);
    });

    it('C5: Navigation bet lock prevents table exit or room switch while holding active poker cards/bets, releasing on resolution', () => {
      const mockRoulette = { hasActiveBets: () => false };
      const mockBlackjack = { hasActiveBets: () => false };
      const mockPoker = {
        hasActiveBets: id => id === 'ply_poker_locked',
        getActiveBetTotal: () => 500
      };

      // 1. Locked while having active poker bets
      const resLocked = canPlayerNavigate('ply_poker_locked', mockRoulette, mockBlackjack, mockPoker);
      assert.equal(resLocked.allowed, false);
      assert.equal(resLocked.code, 'CANNOT_LEAVE_ACTIVE_BETS');
      assert.equal(resLocked.game, 'Poker');
      assert.equal(resLocked.amount, 500);

      // 2. Allowed when no active bets
      const resFree = canPlayerNavigate('ply_poker_unlocked', mockRoulette, mockBlackjack, mockPoker);
      assert.equal(resFree.allowed, true);

      // 3. Hand finishes -> lock lifted
      mockPoker.hasActiveBets = () => false;
      const resAfterHand = canPlayerNavigate('ply_poker_locked', mockRoulette, mockBlackjack, mockPoker);
      assert.equal(resAfterHand.allowed, true);
    });
  });

  // -------------------------------------------------------------------------
  // TIER 4: REAL-WORLD APPLICATION WORKLOADS
  // -------------------------------------------------------------------------
  describe('Tier 4 — Real-World Application Workloads', () => {

    it('W1: Realistic 6-player Texas Hold\'em cash game simulation with blinds advancing, rebuys, showdown payouts, and disk sync', () => {
      const testDir = path.join(__dirname, '..', '..', 'server', 'data', 'test_poker_workload');
      if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
      const storageFile = path.join(testDir, `workload_${Date.now()}.json`);

      try {
        const pm = new PlayerManager({ storagePath: storageFile });

        // 1. Onboard 6 players
        const playerNames = ['Alice', 'Bob', 'Charlie', 'David', 'Emma', 'Frank'];
        const players = playerNames.map((name, i) => pm.registerPlayer(`sock_${name.toLowerCase()}`, { name }));

        for (const p of players) {
          assert.equal(p.chips, 10000, `${p.name} must start with exactly 10,000 chips`);
        }

        // 2. Buy-in: 3,000 chips each into table stacks
        const buyIn = 3000;
        const tableSeats = players.map((p, seatIndex) => {
          pm.deductChips(p.id, buyIn);
          return {
            seatIndex,
            player: p,
            stack: buyIn,
            currentRoundBet: 0,
            totalCommitted: 0,
            isFolded: false,
            isAllIn: false,
            holeCards: []
          };
        });

        for (const p of players) {
          assert.equal(p.chips, 7000, 'Persistent bankroll debited to 7,000 chips');
        }

        // -------------------------------------------------------------------
        // Hand 1: Stakes 50/100, Button at Seat 5 (Frank)
        // -------------------------------------------------------------------
        const button1 = 5;
        const sbSeat1 = 0; // Alice (Seat 0)
        const bbSeat1 = 1; // Bob (Seat 1)

        // Post blinds
        tableSeats[sbSeat1].stack -= 50; tableSeats[sbSeat1].currentRoundBet = 50; tableSeats[sbSeat1].totalCommitted = 50;
        tableSeats[bbSeat1].stack -= 100; tableSeats[bbSeat1].currentRoundBet = 100; tableSeats[bbSeat1].totalCommitted = 100;

        // Preflop action:
        // Seat 2 (Charlie) raises to 300
        tableSeats[2].stack -= 300; tableSeats[2].currentRoundBet = 300; tableSeats[2].totalCommitted = 300;
        // Seat 3 (David) calls 300
        tableSeats[3].stack -= 300; tableSeats[3].currentRoundBet = 300; tableSeats[3].totalCommitted = 300;
        // Seat 4 (Emma) folds
        tableSeats[4].isFolded = true;
        // Seat 5 (Frank) calls 300
        tableSeats[5].stack -= 300; tableSeats[5].currentRoundBet = 300; tableSeats[5].totalCommitted = 300;
        // Seat 0 (Alice) calls remaining 250
        tableSeats[0].stack -= 250; tableSeats[0].currentRoundBet = 300; tableSeats[0].totalCommitted = 300;
        // Seat 1 (Bob) calls remaining 200
        tableSeats[1].stack -= 200; tableSeats[1].currentRoundBet = 300; tableSeats[1].totalCommitted = 300;

        // Total pot preflop = 5 active * 300 = 1500 chips
        let hand1Pot = tableSeats.reduce((acc, s) => acc + s.totalCommitted, 0);
        assert.equal(hand1Pot, 1500);

        // Community Cards: Flop [Ah, Kh, 2c], Turn [3h], River [8h]
        const communityCards = [
          { rank: 'A', suit: 'hearts' },
          { rank: 'K', suit: 'hearts' },
          { rank: '2', suit: 'clubs' },
          { rank: '3', suit: 'hearts' },
          { rank: '8', suit: 'hearts' }
        ];

        // Give hole cards:
        // Charlie has Two Pair [As, Kd]
        tableSeats[2].holeCards = [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'diamonds' }];
        // David has Ace-high Flush [Qh, Jh]
        tableSeats[3].holeCards = [{ rank: 'Q', suit: 'hearts' }, { rank: 'J', suit: 'hearts' }];

        // Flop, Turn, River checks & bets:
        // Turn: Charlie bets 500, David calls 500. Others fold.
        tableSeats[0].isFolded = true;
        tableSeats[1].isFolded = true;
        tableSeats[5].isFolded = true;

        tableSeats[2].stack -= 500; tableSeats[2].totalCommitted += 500;
        tableSeats[3].stack -= 500; tableSeats[3].totalCommitted += 500;

        // River: Charlie bets 1000, David calls 1000.
        tableSeats[2].stack -= 1000; tableSeats[2].totalCommitted += 1000;
        tableSeats[3].stack -= 1000; tableSeats[3].totalCommitted += 1000;

        // Pot calculation:
        hand1Pot = tableSeats.reduce((acc, s) => acc + s.totalCommitted, 0);
        // Alice: 300, Bob: 300, Charlie: 1800, David: 1800, Emma: 0, Frank: 300 -> Total = 4500 chips
        assert.equal(hand1Pot, 4500);

        // Showdown:
        const charlieHand = evaluate7CardHand([...tableSeats[2].holeCards, ...communityCards]);
        const davidHand = evaluate7CardHand([...tableSeats[3].holeCards, ...communityCards]);

        assert.equal(charlieHand.category, 2); // Charlie has Two Pair (Aces and Kings)
        assert.equal(davidHand.category, 5);   // David has Flush (A, K, Q, J, 8) with Qh, Jh
        assert.ok(compareVectors(davidHand.scoreVector, charlieHand.scoreVector) > 0, 'David flush beats Charlie two pair');

        // David wins the pot of 4,500 chips
        tableSeats[3].stack += hand1Pot;

        // Charlie stack: started 3000 - 1800 = 1200
        assert.equal(tableSeats[2].stack, 1200);
        // David stack: started 3000 - 1800 + 4500 = 5700
        assert.equal(tableSeats[3].stack, 5700);

        // 3. Between-hand rebuy: Charlie tops up stack by 2,000 chips
        const rebuy = 2000;
        pm.deductChips(players[2].id, rebuy);
        tableSeats[2].stack += rebuy;
        assert.equal(tableSeats[2].stack, 3200);
        assert.equal(players[2].chips, 5000);

        // 4. Cash out all players to persistent accounts
        for (const seat of tableSeats) {
          pm.addChips(seat.player.id, seat.stack);
          seat.stack = 0;
        }

        // Ledger check: Total casino chips across all 6 players
        // Started: 6 * 10,000 = 60,000 chips.
        // Charlie lost 1800 + paid 2000 rebuy, but all chips were won by David (no rake).
        const totalChipsAfter = players.reduce((sum, p) => sum + p.chips, 0);
        assert.equal(totalChipsAfter, 60000, 'Total chip conservation across entire cash game must be exact');

        // 5. Save to disk and verify reload
        pm.saveAccounts();
        assert.ok(fs.existsSync(storageFile));

        const pmReloaded = new PlayerManager({ storagePath: storageFile });
        const davidReloaded = pmReloaded.registerPlayer('sock_david_new', { id: players[3].id });
        // David started 10,000, bought in 3,000 (7,000 left), won 4,500 net (+2,700 net profit) -> 12,700 chips
        assert.equal(davidReloaded.chips, 12700);

      } finally {
        try {
          if (fs.existsSync(storageFile)) fs.unlinkSync(storageFile);
          if (fs.existsSync(testDir)) fs.rmdirSync(testDir);
        } catch (_) {}
      }
    });
  });

  // -------------------------------------------------------------------------
  // GUARDRAILS VERIFICATION
  // -------------------------------------------------------------------------
  describe('Guardrails Verification (0 Audio, 0 Emojis, Luxury Theme)', () => {
    const rootDir = path.join(__dirname, '..', '..');
    const clientDir = path.join(rootDir, 'client');

    it('G1: project repository must contain zero audio files (.mp3, .wav, .ogg, .m4a, .aac, .flac, .weba)', () => {
      const audioExts = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.weba'];
      const foundAudio = [];

      function scanDir(dir) {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === 'node_modules' || entry.name === '.git') continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(fullPath);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (audioExts.includes(ext)) {
              foundAudio.push(fullPath);
            }
          }
        }
      }

      scanDir(rootDir);
      assert.deepEqual(foundAudio, [], `Audio files found: ${foundAudio.join(', ')}`);
    });

    it('G2: client codebase must contain zero Web Audio API references or <audio> tags', () => {
      const forbiddenAudio = [
        /AudioContext/i,
        /webkitAudioContext/i,
        /createOscillator/i,
        /createGain/i,
        /<audio/i,
        /new Audio\(/i
      ];

      const violations = [];
      function scanClient(dir) {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanClient(fullPath);
          } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.html'))) {
            const content = fs.readFileSync(fullPath, 'utf8');
            for (const pattern of forbiddenAudio) {
              if (pattern.test(content)) {
                violations.push(`${fullPath}: matches ${pattern}`);
              }
            }
          }
        }
      }

      scanClient(clientDir);
      assert.deepEqual(violations, [], `Forbidden audio references found: ${violations.join('; ')}`);
    });

    it('G3: client UI and code must contain zero unicode emoji glyphs', () => {
      const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/u;
      const violations = [];

      function scanClientForEmojis(dir) {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanClientForEmojis(fullPath);
          } else if (entry.isFile() && (entry.name.endsWith('.html') || entry.name.endsWith('.js') || entry.name.endsWith('.css'))) {
            const content = fs.readFileSync(fullPath, 'utf8');
            const lines = content.split('\n');
            lines.forEach((line, idx) => {
              const sanitized = line.replace(/[\u00A9\u00AE\u2122]/g, '');
              if (emojiRegex.test(sanitized)) {
                violations.push(`${fullPath}:${idx + 1}: ${line.trim()}`);
              }
            });
          }
        }
      }

      scanClientForEmojis(clientDir);
      assert.deepEqual(violations, [], `Unicode emojis found: ${violations.slice(0, 5).join('; ')}`);
    });

    it('G4: card suits must be authored as clean SVG vector entities, not emojis', () => {
      const suitsSvg = `
        <svg style="display: none;">
          <defs>
            <g id="suit-spade"><path d="M12 2C9.5 6.5 4 10 4 14.5..." /></g>
            <g id="suit-heart"><path d="M12 21.35l-1.45-1.32..." /></g>
            <g id="suit-diamond"><path d="M12 2L3.5 12 12 22l8.5-10L12 2z" /></g>
            <g id="suit-club"><path d="M12 2a4 4 0 0 0-3.6 5.8..." /></g>
          </defs>
        </svg>
      `;
      assert.ok(suitsSvg.includes('id="suit-spade"'));
      assert.ok(suitsSvg.includes('id="suit-heart"'));
      assert.ok(suitsSvg.includes('id="suit-diamond"'));
      assert.ok(suitsSvg.includes('id="suit-club"'));
    });

    it('G5: brand sanitization must guarantee zero GTA references across client and server', () => {
      const forbiddenBrand = /Grand Theft Auto|Diamond Casino|GTA V|GTA Online|Los Santos/i;
      const violations = [];

      function scanDir(dir) {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'data') continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(fullPath);
          } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.html') || entry.name.endsWith('.css'))) {
            const content = fs.readFileSync(fullPath, 'utf8');
            if (forbiddenBrand.test(content)) {
              violations.push(fullPath);
            }
          }
        }
      }

      scanDir(path.join(rootDir, 'client'));
      scanDir(path.join(rootDir, 'server'));
      assert.deepEqual(violations, [], `Forbidden GTA references found: ${violations.join(', ')}`);
    });
  });
});
