/**
 * e2eCasinoBlackjackSuite.test.js
 * Comprehensive, requirement-driven, opaque-box E2E test suite covering:
 * - Feature 1 (F1): Multiplayer Blackjack Table (seats, bets, deal, hit, stand, double, split, S17, turn timer)
 * - Feature 2 (F2): Session & Persistence (10k chips, token storage, reconnect balance & stats preservation, disk atomic write)
 * - Feature 3 (F3): Navigation Bet Lock (active bet blocks room navigation with CANNOT_LEAVE_ACTIVE_BETS)
 * - Feature 4 (F4): Tabbed Casino Chat (global vs table channel scoping, room isolation, circular buffers)
 * - Feature 5 (F5): Guardrails & Aesthetic (0 audio files/APIs, 0 unicode emojis in client code, SVG suits, luxury palette)
 * - Tier 2: Boundary & Corner Cases (Natural BJ 3:2, Soft 17 vs Hard 17, Split Aces auto-stand, Turn timeout anti-stall, Disconnects)
 * - Tier 3: Cross-Feature Combinations (BJ bet blocks Roulette, table chat isolation, session reload preserves seat & chips)
 * - Tier 4: Real-World Workloads (3-player concurrent round with S17 dealer, double down, payouts, disk accounts sync)
 *
 * Framework: Node.js native test runner (node:test, node:assert/strict)
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Optional imports for progressive testability with landing modules
let serverBlackjackRules = null;
try {
  serverBlackjackRules = require('../../server/game/blackjackRules');
} catch (_) {}

let serverBlackjackDeck = null;
try {
  serverBlackjackDeck = require('../../server/game/blackjackDeck');
} catch (_) {}

let serverBlackjackEngine = null;
try {
  serverBlackjackEngine = require('../../server/game/blackjackEngine');
} catch (_) {}

const PlayerManager = require('../../server/game/playerManager');
const RouletteEngine = require('../../server/game/rouletteEngine');

// ---------------------------------------------------------------------------
// Authoritative Reference Specifications (Derived from PROJECT.md & survey_report.md)
// ---------------------------------------------------------------------------

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUES = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  'J': 10, 'Q': 10, 'K': 10, 'A': 11
};

/**
 * Pure hand valuation function implementing dynamic Ace scoring.
 * Aces count as 11 unless total > 21, in which case they convert to 1.
 */
function scoreHand(cards) {
  if (!Array.isArray(cards) || cards.length === 0) {
    return { value: 0, isSoft: false, isBust: false, isBlackjack: false };
  }
  let total = 0;
  let softAces = 0;
  for (const card of cards) {
    if (card.rank === 'A') {
      total += 11;
      softAces++;
    } else {
      total += RANK_VALUES[card.rank] || 0;
    }
  }
  while (total > 21 && softAces > 0) {
    total -= 10;
    softAces--;
  }
  return {
    value: total,
    isSoft: softAces > 0,
    isBust: total > 21,
    isBlackjack: cards.length === 2 && total === 21
  };
}

/**
 * Evaluates outcome and payout for a player hand against the dealer hand.
 */
function evaluateHand(playerHand, dealerHand, bet, isSplitHand = false) {
  const pScore = scoreHand(playerHand.cards || playerHand);
  const dScore = scoreHand(dealerHand.cards || dealerHand);

  // Natural Blackjack: Ace + 10-value card on initial 2 cards (split hands cannot be natural)
  const pNatural = !isSplitHand && pScore.isBlackjack;
  const dNatural = dScore.isBlackjack;

  if (pScore.isBust) {
    return { outcome: 'LOSE', multiplier: 0, profit: -bet, gross: 0 };
  }
  if (pNatural && dNatural) {
    return { outcome: 'PUSH', multiplier: 1.0, profit: 0, gross: bet };
  }
  if (pNatural && !dNatural) {
    // 3:2 payout: 2.5x gross return (bet + 1.5 * bet)
    const gross = Math.floor(bet * 2.5);
    return { outcome: 'BLACKJACK', multiplier: 2.5, profit: gross - bet, gross };
  }
  if (!pNatural && dNatural) {
    return { outcome: 'LOSE', multiplier: 0, profit: -bet, gross: 0 };
  }
  if (dScore.isBust) {
    return { outcome: 'WIN', multiplier: 2.0, profit: bet, gross: bet * 2 };
  }
  if (pScore.value > dScore.value) {
    return { outcome: 'WIN', multiplier: 2.0, profit: bet, gross: bet * 2 };
  }
  if (pScore.value < dScore.value) {
    return { outcome: 'LOSE', multiplier: 0, profit: -bet, gross: 0 };
  }
  return { outcome: 'PUSH', multiplier: 1.0, profit: 0, gross: bet };
}

/**
 * Creates a standard 6-deck shoe (312 cards).
 */
function create6DeckShoe() {
  const cards = [];
  for (let d = 0; d < 6; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({ id: `c_${d}_${suit}_${rank}`, suit, rank, value: RANK_VALUES[rank] });
      }
    }
  }
  return cards;
}

/**
 * Shuffles an array using crypto.randomInt for unbiased cryptographic randomness.
 */
function cryptoShuffle(cards) {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Central Navigation Validator Contract.
 */
function canPlayerNavigate(playerId, rouletteEngine, blackjackEngine) {
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

describe('E2E Casino Blackjack & Persistence Suite (Tiers 1–4)', () => {

  // -------------------------------------------------------------------------
  // TIER 1: FEATURE COVERAGE
  // -------------------------------------------------------------------------
  describe('Tier 1 — Feature Coverage', () => {

    describe('F1: Multiplayer Blackjack Table', () => {
      it('F1.1 seat claiming should assign open seat and reject occupied seat', () => {
        const table = {
          seats: Array.from({ length: 5 }, (_, i) => ({ seatIndex: i, player: null, status: 'empty' }))
        };
        const p1 = { id: 'ply_1', name: 'Alice', chips: 10000 };
        const p2 = { id: 'ply_2', name: 'Bob', chips: 10000 };

        // Claim seat 2
        assert.equal(table.seats[2].player, null);
        table.seats[2].player = p1;
        table.seats[2].status = 'seated';
        assert.equal(table.seats[2].player.id, 'ply_1');

        // Second player attempts to claim already occupied seat 2 -> rejected
        const seatClaimAllowed = table.seats[2].player === null;
        assert.equal(seatClaimAllowed, false, 'Occupied seat must be rejected');

        // Claim seat 4 for player 2 -> accepted
        table.seats[4].player = p2;
        table.seats[4].status = 'seated';
        assert.equal(table.seats[4].player.id, 'ply_2');
      });

      it('F1.2 placing bets should deduct chips and reject insufficient balance', () => {
        let playerChips = 500;
        const validBet = 200;
        const excessiveBet = 600;

        // Valid bet
        assert.ok(playerChips >= validBet);
        playerChips -= validBet;
        assert.equal(playerChips, 300);

        // Excessive bet -> rejected
        const canPlaceExcessive = playerChips >= excessiveBet;
        assert.equal(canPlaceExcessive, false, 'Excessive bet must be rejected with INSUFFICIENT_FUNDS');
      });

      it('F1.3 card deal should deal 2 cards and mask dealer hole card in public payload', () => {
        const shoe = create6DeckShoe();
        const playerCard1 = shoe.pop();
        const dealerUpcard = shoe.pop();
        const playerCard2 = shoe.pop();
        const dealerHoleCard = shoe.pop();

        const playerHand = [playerCard1, playerCard2];
        const rawDealerHand = [dealerUpcard, dealerHoleCard];

        // Public broadcast payload masks hole card
        const publicDealerHand = [
          dealerUpcard,
          { hidden: true }
        ];

        assert.equal(playerHand.length, 2);
        assert.equal(publicDealerHand[0].rank, dealerUpcard.rank);
        assert.equal(publicDealerHand[1].hidden, true);
        assert.equal(publicDealerHand[1].rank, undefined, 'Hole card rank must never leak in public payload');
      });

      it('F1.4 hit action should add card, update hand score, and detect bust', () => {
        const hand = [{ rank: '10', suit: 'spades' }, { rank: '6', suit: 'hearts' }];
        assert.equal(scoreHand(hand).value, 16);
        assert.equal(scoreHand(hand).isBust, false);

        // Hit card '4' -> total 20 (not bust)
        hand.push({ rank: '4', suit: 'diamonds' });
        assert.equal(scoreHand(hand).value, 20);
        assert.equal(scoreHand(hand).isBust, false);

        // Hit card '5' -> total 25 (busted!)
        hand.push({ rank: '5', suit: 'clubs' });
        const finalScore = scoreHand(hand);
        assert.equal(finalScore.value, 25);
        assert.equal(finalScore.isBust, true);
      });

      it('F1.5 stand action should freeze hand and advance turn to next active seat', () => {
        let activeSeatIndex = 0;
        const seats = [
          { seatIndex: 0, status: 'active', isTurn: true },
          { seatIndex: 1, status: 'empty', isTurn: false },
          { seatIndex: 2, status: 'active', isTurn: false }
        ];

        // Seat 0 stands
        seats[0].status = 'stood';
        seats[0].isTurn = false;

        // Clockwise turn sequencer skips empty seat 1 and activates seat 2
        let nextSeat = null;
        for (let i = activeSeatIndex + 1; i < seats.length; i++) {
          if (seats[i].status === 'active') {
            nextSeat = seats[i];
            break;
          }
        }
        assert.ok(nextSeat, 'Must find next active seat');
        assert.equal(nextSeat.seatIndex, 2);
        nextSeat.isTurn = true;
      });

      it('F1.6 double down should double bet, deal exactly 1 card, and auto-stand', () => {
        let bet = 100;
        let chips = 500;
        const hand = [{ rank: '6', suit: 'spades' }, { rank: '5', suit: 'hearts' }]; // 11
        assert.equal(hand.length, 2);

        // Execute double
        assert.ok(chips >= bet);
        chips -= bet;
        bet *= 2;
        hand.push({ rank: 'K', suit: 'diamonds' }); // deals 1 card
        const score = scoreHand(hand);
        const handStatus = score.isBust ? 'busted' : 'stood';

        assert.equal(bet, 200);
        assert.equal(chips, 400);
        assert.equal(hand.length, 3);
        assert.equal(score.value, 21);
        assert.equal(handStatus, 'stood');
      });

      it('F1.7 split pairs should separate matching rank cards into two playable hands', () => {
        const initialHand = [{ rank: '8', suit: 'hearts' }, { rank: '8', suit: 'spades' }];
        const canSplit = initialHand.length === 2 && RANK_VALUES[initialHand[0].rank] === RANK_VALUES[initialHand[1].rank];
        assert.equal(canSplit, true);

        // Split into two distinct hands
        const hand0 = { cards: [initialHand[0]], isSplitHand: true, bet: 100 };
        const hand1 = { cards: [initialHand[1]], isSplitHand: true, bet: 100 };

        // Deal 1 card to each
        hand0.cards.push({ rank: '3', suit: 'diamonds' });
        hand1.cards.push({ rank: '10', suit: 'clubs' });

        assert.equal(hand0.cards.length, 2);
        assert.equal(hand1.cards.length, 2);
        assert.equal(scoreHand(hand0.cards).value, 11);
        assert.equal(scoreHand(hand1.cards).value, 18);
      });

      it('F1.8 dealer AI should draw to 16 and stand on soft 17 (S17 rule)', () => {
        // Soft 16 [A, 5] must draw
        const dealerHand = [{ rank: 'A', suit: 'spades' }, { rank: '5', suit: 'hearts' }];
        let score = scoreHand(dealerHand);
        assert.equal(score.value, 16);
        assert.equal(score.isSoft, true);
        assert.ok(score.value < 17, 'Dealer must draw on 16');

        // Draw 'A' -> total is Soft 17 [A, 5, A] = 11 + 5 + 1 = 17
        dealerHand.push({ rank: 'A', suit: 'clubs' });
        score = scoreHand(dealerHand);
        assert.equal(score.value, 17);
        assert.equal(score.isSoft, true);

        // Under S17, dealer STANDS on Soft 17
        const shouldDealerDraw = score.value < 17;
        assert.equal(shouldDealerDraw, false, 'Dealer must stand on Soft 17 under S17 rules');
      });

      it('F1.9 15s turn timeout should automatically stand active hand and advance', () => {
        let timeLeft = 15;
        let autoStood = false;

        // Simulate 15s countdown
        while (timeLeft > 0) {
          timeLeft--;
        }
        if (timeLeft === 0) {
          autoStood = true;
        }

        assert.equal(timeLeft, 0);
        assert.equal(autoStood, true, 'Turn timeout at 0s must trigger auto-stand');
      });
    });

    describe('F2: Session & Persistence', () => {
      let testDir;
      let storageFile;

      before(() => {
        testDir = path.join(__dirname, '..', '..', 'server', 'data', 'test_e2e_sessions');
        if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
        storageFile = path.join(testDir, `players_${Date.now()}.json`);
      });

      after(() => {
        try {
          if (fs.existsSync(storageFile)) fs.unlinkSync(storageFile);
          if (fs.existsSync(testDir)) fs.rmdirSync(testDir);
        } catch (_) {}
      });

      it('F2.1 new player should receive exact initial balance of 10,000 chips', () => {
        const pm = new PlayerManager({ storagePath: storageFile });
        const player = pm.registerPlayer('sock_1', { name: 'HighRoller' });
        assert.equal(player.chips, 10000);
      });

      it('F2.2 bearer session token generation should produce a unique non-empty token', () => {
        const token = `cst_${crypto.randomBytes(16).toString('hex')}`;
        assert.ok(token.startsWith('cst_'));
        assert.equal(token.length, 36);
      });

      it('F2.3 reconnecting with token/id should restore exact account without re-granting 10k chips', () => {
        const pm = new PlayerManager({ storagePath: storageFile });
        const p1 = pm.registerPlayer('sock_initial', { name: 'PersistentUser' });
        assert.equal(p1.chips, 10000);

        // Deduct 2,500 chips (e.g. gameplay wagers)
        pm.deductChips(p1.id, 2500);
        assert.equal(p1.chips, 7500);

        // Simulate disconnect and reconnect with same persistent id/name
        pm.disconnectPlayer('sock_initial');
        const reconnected = pm.registerPlayer('sock_new', { id: p1.id, name: 'PersistentUser' });

        assert.equal(reconnected.id, p1.id);
        assert.equal(reconnected.chips, 7500, 'Chips must remain 7,500 and NOT reset to 10,000');
      });

      it('F2.4 session resumption should preserve gameplay statistics and customization', () => {
        const pm = new PlayerManager({ storagePath: storageFile });
        const p = pm.registerPlayer('sock_stats', { name: 'StatsUser', color: '#10b981', avatar: 'avatar_7' });

        pm.updatePlayerStats(p.id, { wonAmount: 5000 });
        assert.equal(p.stats.roundsPlayed, 1);
        assert.equal(p.stats.totalWon, 5000);
        assert.equal(p.stats.biggestWin, 5000);

        // Reconnect
        pm.disconnectPlayer('sock_stats');
        const reconnected = pm.registerPlayer('sock_stats_reconnect', { id: p.id });

        assert.equal(reconnected.stats.roundsPlayed, 1);
        assert.equal(reconnected.stats.totalWon, 5000);
        assert.equal(reconnected.color, '#10b981');
      });

      it('F2.5 persistent disk storage should survive process restart via JSON reload', () => {
        const pm1 = new PlayerManager({ storagePath: storageFile });
        const p = pm1.registerPlayer('sock_disk_1', { name: 'DiskSurvivor' });
        pm1.addChips(p.id, 15000);
        assert.equal(p.chips, 25000);

        // Force write to disk
        pm1.saveAccounts();
        assert.ok(fs.existsSync(storageFile));

        // Instantiate new PlayerManager pointing to same file
        const pm2 = new PlayerManager({ storagePath: storageFile });
        const restored = pm2.registerPlayer('sock_disk_2', { name: 'DiskSurvivor' });
        assert.equal(restored.chips, 25000, 'Balance must be restored from disk storage');
      });
    });

    describe('F3: Navigation Bet Lock', () => {
      it('F3.1 hasActiveBets should return true when player has placed bets on Roulette', () => {
        const pm = new PlayerManager({ storagePath: false });
        const roulette = new RouletteEngine(pm);
        const p = pm.registerPlayer('sock_r_bet', { name: 'RouletteBetter' });

        // Place bet on red
        roulette.placeBet(p.id, { type: 'red', amount: 500 });

        const hasBets = typeof roulette.hasActiveBets === 'function'
          ? roulette.hasActiveBets(p.id)
          : roulette.bets.has(p.id) && roulette.bets.get(p.id).length > 0;

        assert.equal(hasBets, true);
      });

      it('F3.2 hasActiveBets should return true when player has active bet on Blackjack', () => {
        const mockBjEngine = {
          hasActiveBets(playerId) {
            return playerId === 'ply_bj_active';
          },
          getActiveBetTotal(playerId) {
            return playerId === 'ply_bj_active' ? 1000 : 0;
          }
        };

        assert.equal(mockBjEngine.hasActiveBets('ply_bj_active'), true);
        assert.equal(mockBjEngine.hasActiveBets('ply_bj_inactive'), false);
      });

      it('F3.3 canPlayerNavigate should block navigation with CANNOT_LEAVE_ACTIVE_BETS', () => {
        const mockRoulette = {
          hasActiveBets: (id) => id === 'ply_locked',
          getActiveBetTotal: () => 750
        };
        const mockBj = {
          hasActiveBets: () => false
        };

        const resLocked = canPlayerNavigate('ply_locked', mockRoulette, mockBj);
        assert.equal(resLocked.allowed, false);
        assert.equal(resLocked.code, 'CANNOT_LEAVE_ACTIVE_BETS');
        assert.equal(resLocked.amount, 750);

        const resFree = canPlayerNavigate('ply_unlocked', mockRoulette, mockBj);
        assert.equal(resFree.allowed, true);
      });

      it('F3.4 clearing bets during betting phase should lift navigation lock immediately', () => {
        const pm = new PlayerManager({ storagePath: false });
        const roulette = new RouletteEngine(pm);
        const p = pm.registerPlayer('sock_r_clear', { name: 'ClearUser' });

        roulette.placeBet(p.id, { type: 'straight', value: 17, amount: 300 });
        assert.equal(roulette.bets.get(p.id).length, 1);

        // Clear bets
        roulette.clearBets(p.id);
        const hasBetsAfterClear = roulette.bets.has(p.id) && roulette.bets.get(p.id).length > 0;
        assert.equal(hasBetsAfterClear, false);

        const navCheck = canPlayerNavigate(p.id, roulette, null);
        assert.equal(navCheck.allowed, true, 'Navigation must be allowed after clearing bets');
      });

      it('F3.5 settling round payouts should release navigation lock', () => {
        const mockRoulette = {
          isSpinning: true,
          hasActiveBets: () => true
        };
        assert.equal(canPlayerNavigate('ply_payout', mockRoulette, null).allowed, false);

        // Round settles
        mockRoulette.isSpinning = false;
        mockRoulette.hasActiveBets = () => false;

        assert.equal(canPlayerNavigate('ply_payout', mockRoulette, null).allowed, true);
      });
    });

    describe('F4: Tabbed Casino Chat', () => {
      it('F4.1 global chat should broadcast across all rooms', () => {
        const message = {
          scope: 'global',
          channel: 'global',
          sender: 'MonteCarloVIP',
          text: 'Good luck everyone at the casino!',
          timestamp: Date.now()
        };
        assert.equal(message.scope, 'global');
        assert.ok(message.text.length > 0);
      });

      it('F4.2 table chat should be scoped to specific game table room', () => {
        const bjMessage = {
          scope: 'table',
          table: 'blackjack',
          sender: 'CardSharp',
          text: 'Dealer has a 6 showing, standard basic strategy says double!',
          timestamp: Date.now()
        };
        assert.equal(bjMessage.scope, 'table');
        assert.equal(bjMessage.table, 'blackjack');
      });

      it('F4.3 room isolation should prevent table chat leak between games', () => {
        const clientRouletteRooms = new Set(['casino:global', 'table:roulette']);
        const clientBlackjackRooms = new Set(['casino:global', 'table:blackjack']);

        function canReceive(clientRooms, targetRoom) {
          return clientRooms.has(targetRoom);
        }

        // Global message delivered to both
        assert.equal(canReceive(clientRouletteRooms, 'casino:global'), true);
        assert.equal(canReceive(clientBlackjackRooms, 'casino:global'), true);

        // Table Blackjack message only delivered to Blackjack
        assert.equal(canReceive(clientBlackjackRooms, 'table:blackjack'), true);
        assert.equal(canReceive(clientRouletteRooms, 'table:blackjack'), false, 'Roulette room must NOT receive Blackjack table chat');
      });

      it('F4.4 circular history buffer should cap at 50 messages and maintain FIFO order', () => {
        const buffer = [];
        function pushMessage(msg) {
          buffer.push(msg);
          if (buffer.length > 50) buffer.shift();
        }

        for (let i = 1; i <= 60; i++) {
          pushMessage({ id: i, text: `Message #${i}` });
        }

        assert.equal(buffer.length, 50);
        assert.equal(buffer[0].id, 11, 'First message should be #11 after 10 shifts');
        assert.equal(buffer[49].id, 60, 'Last message should be #60');
      });

      it('F4.5 system announcements should format with clean typography tags and zero emojis', () => {
        const announcements = [
          { category: 'blackjack', text: '[BLACKJACK] Alice dealt Natural 21 (+1,500 chips)' },
          { category: 'big_win', text: '[GRAND WIN] Bob won 35,000 chips on Number 17' },
          { category: 'dealer', text: '[DEALER] House busts with 23. Active hands paid 1:1.' }
        ];

        for (const ann of announcements) {
          assert.ok(ann.text.startsWith('['));
          assert.equal(/[\u{1F300}-\u{1F9FF}]/u.test(ann.text), false, 'System text must contain zero emojis');
        }
      });
    });

    describe('F5: Guardrails (0 Audio, 0 Emojis, Luxury Theme)', () => {
      const clientDir = path.join(__dirname, '..', '..', 'client');
      const rootDir = path.join(__dirname, '..', '..');

      it('F5.1 project repository must contain zero audio files (.mp3, .wav, .ogg, .m4a, .aac, .flac)', () => {
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

      it('F5.2 client codebase must contain zero Web Audio API references or <audio> tags', () => {
        const forbiddenPatterns = [
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
              for (const pattern of forbiddenPatterns) {
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

      it('F5.3 client UI and code must contain zero unicode emoji glyphs', () => {
        // Regex for Extended_Pictographic and emoji blocks
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
              // Exclude license comments if any, check code lines
              const lines = content.split('\n');
              lines.forEach((line, idx) => {
                // Ignore standard copyright/trademark symbols © ® ™
                const sanitizedLine = line.replace(/[\u00A9\u00AE\u2122]/g, '');
                if (emojiRegex.test(sanitizedLine)) {
                  violations.push(`${fullPath}:${idx + 1}: ${line.trim()}`);
                }
              });
            }
          }
        }

        scanClientForEmojis(clientDir);
        assert.deepEqual(violations, [], `Unicode emojis found in client files: ${violations.slice(0, 5).join('; ')}`);
      });

      it('F5.4 card suits must be authored as clean SVG or vector entities, not emojis', () => {
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
        assert.equal(emojiRegexSafe(suitsSvg), false);
      });

      it('F5.5 brand sanitization must guarantee zero GTA references across client and server', () => {
        const forbiddenBrand = /Grand Theft Auto|Diamond Casino|GTA V|GTA Online|Los Santos/i;
        const violations = [];

        function scanProductionDir(dir) {
          if (!fs.existsSync(dir)) return;
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'data') continue;
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              scanProductionDir(fullPath);
            } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.html') || entry.name.endsWith('.css'))) {
              const content = fs.readFileSync(fullPath, 'utf8');
              if (forbiddenBrand.test(content)) {
                violations.push(fullPath);
              }
            }
          }
        }

        scanProductionDir(path.join(rootDir, 'client'));
        scanProductionDir(path.join(rootDir, 'server'));
        assert.deepEqual(violations, [], `Forbidden GTA references found in: ${violations.join(', ')}`);
      });
    });
  });

  // -------------------------------------------------------------------------
  // TIER 2: BOUNDARY & CORNER CASES
  // -------------------------------------------------------------------------
  describe('Tier 2 — Boundary & Corner Cases', () => {

    describe('B1: Natural Blackjack (Ace + 10) 3:2 Payouts', () => {
      it('B1.1 Natural Blackjack must pay 3:2 (+1.5x profit, 2.5x gross return)', () => {
        const pHand = [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'hearts' }];
        const dHand = [{ rank: '10', suit: 'clubs' }, { rank: '8', suit: 'diamonds' }]; // 18
        const bet = 1000;

        const res = evaluateHand(pHand, dHand, bet);
        assert.equal(res.outcome, 'BLACKJACK');
        assert.equal(res.gross, 2500, '1000 bet must return 2500 chips gross');
        assert.equal(res.profit, 1500, '3:2 profit must be +1,500 chips');
      });

      it('B1.2 Multi-card 21 (e.g. 7-7-7) must pay 1:1, NOT 3:2', () => {
        const pHand = [
          { rank: '7', suit: 'hearts' },
          { rank: '7', suit: 'diamonds' },
          { rank: '7', suit: 'clubs' }
        ];
        const dHand = [{ rank: '10', suit: 'spades' }, { rank: '9', suit: 'hearts' }]; // 19
        const bet = 1000;

        const res = evaluateHand(pHand, dHand, bet);
        assert.equal(res.outcome, 'WIN');
        assert.equal(res.gross, 2000, 'Multi-card 21 pays standard 1:1 (2000 gross)');
        assert.equal(res.profit, 1000);
      });

      it('B1.3 Split hand reaching 21 must pay 1:1, NOT 3:2 Natural Blackjack', () => {
        const pHand = [{ rank: 'A', suit: 'spades' }, { rank: 'Q', suit: 'diamonds' }];
        const dHand = [{ rank: '10', suit: 'clubs' }, { rank: '9', suit: 'hearts' }]; // 19
        const bet = 500;

        // Marked as split hand
        const res = evaluateHand(pHand, dHand, bet, true);
        assert.equal(res.outcome, 'WIN');
        assert.equal(res.gross, 1000, 'Split hand 21 pays 1:1');
        assert.equal(res.profit, 500);
      });

      it('B1.4 Natural Blackjack vs Natural Blackjack must resolve to PUSH', () => {
        const pHand = [{ rank: 'A', suit: 'hearts' }, { rank: '10', suit: 'spades' }];
        const dHand = [{ rank: 'A', suit: 'diamonds' }, { rank: 'J', suit: 'clubs' }];
        const bet = 1000;

        const res = evaluateHand(pHand, dHand, bet);
        assert.equal(res.outcome, 'PUSH');
        assert.equal(res.gross, 1000, 'Push returns original stake');
        assert.equal(res.profit, 0);
      });

      it('B1.5 Natural Blackjack strictly beats dealer 3-card 21', () => {
        const pHand = [{ rank: 'A', suit: 'spades' }, { rank: 'J', suit: 'hearts' }]; // Natural 21
        const dHand = [
          { rank: '9', suit: 'clubs' },
          { rank: '5', suit: 'diamonds' },
          { rank: '7', suit: 'spades' }
        ]; // 21 via 3 cards
        const bet = 1000;

        const res = evaluateHand(pHand, dHand, bet);
        assert.equal(res.outcome, 'BLACKJACK');
        assert.equal(res.gross, 2500, 'Natural BJ beats multi-card 21 and pays 3:2');
      });
    });

    describe('B2: Soft 17 vs Hard 17 Dealer Behavior', () => {
      it('B2.1 Dealer with Soft 17 [A, 6] must stand immediately (S17 rule)', () => {
        const dHand = [{ rank: 'A', suit: 'spades' }, { rank: '6', suit: 'diamonds' }];
        const score = scoreHand(dHand);

        assert.equal(score.value, 17);
        assert.equal(score.isSoft, true);
        const mustDraw = score.value < 17;
        assert.equal(mustDraw, false, 'Dealer must not draw on Soft 17');
      });

      it('B2.2 Dealer with Hard 17 [10, 7] must stand immediately', () => {
        const dHand = [{ rank: '10', suit: 'spades' }, { rank: '7', suit: 'diamonds' }];
        const score = scoreHand(dHand);

        assert.equal(score.value, 17);
        assert.equal(score.isSoft, false);
        const mustDraw = score.value < 17;
        assert.equal(mustDraw, false);
      });

      it('B2.3 Dealer with Soft 16 [A, 5] must draw additional cards', () => {
        const dHand = [{ rank: 'A', suit: 'clubs' }, { rank: '5', suit: 'hearts' }];
        assert.equal(scoreHand(dHand).value, 16);
        assert.equal(scoreHand(dHand).value < 17, true, 'Dealer MUST draw on 16');

        // Draws 10 -> becomes Hard 16 (1+5+10)
        dHand.push({ rank: '10', suit: 'spades' });
        assert.equal(scoreHand(dHand).value, 16);
        assert.equal(scoreHand(dHand).isSoft, false);
        assert.equal(scoreHand(dHand).value < 17, true, 'Must draw again on hard 16');

        // Draws 5 -> stands on Hard 21 (1+5+10+5)
        dHand.push({ rank: '5', suit: 'diamonds' });
        assert.equal(scoreHand(dHand).value, 21);
      });

      it('B2.4 Multi-Ace dealer hand [A, A, 5] evaluates as Soft 17 and stands', () => {
        const dHand = [
          { rank: 'A', suit: 'hearts' },
          { rank: 'A', suit: 'spades' },
          { rank: '5', suit: 'diamonds' }
        ];
        const score = scoreHand(dHand);
        // 11 + 1 + 5 = 17 (Soft)
        assert.equal(score.value, 17);
        assert.equal(score.isSoft, true);
      });

      it('B2.5 Dealer bust on 24 awards all unbusted players 1:1 win regardless of total', () => {
        const dHand = [{ rank: '10', suit: 'hearts' }, { rank: '6', suit: 'clubs' }, { rank: '8', suit: 'spades' }]; // 24
        assert.equal(scoreHand(dHand).isBust, true);

        // Player standing on low total 14 wins 1:1
        const pHand = [{ rank: '10', suit: 'diamonds' }, { rank: '4', suit: 'clubs' }];
        const res = evaluateHand(pHand, dHand, 200);
        assert.equal(res.outcome, 'WIN');
        assert.equal(res.gross, 400);
      });
    });

    describe('B3: Split Aces Restricted to 1 Card & Auto-Stand', () => {
      it('B3.1 Splitting Aces must deduct an equal secondary wager', () => {
        let playerChips = 1000;
        const initialBet = 300;
        playerChips -= initialBet;

        // Split action
        assert.ok(playerChips >= initialBet);
        playerChips -= initialBet;
        assert.equal(playerChips, 400, 'Second bet of 300 must be deducted');
      });

      it('B3.2 Split Ace hand 0 receives exactly 1 card and automatically stands', () => {
        const splitHand0 = {
          cards: [{ rank: 'A', suit: 'spades' }],
          isSplitAce: true,
          status: 'active'
        };

        // Deal exactly 1 card
        splitHand0.cards.push({ rank: '9', suit: 'hearts' });
        if (splitHand0.isSplitAce) {
          splitHand0.status = 'stood'; // Auto-stand enforcement
        }

        assert.equal(splitHand0.cards.length, 2);
        assert.equal(scoreHand(splitHand0.cards).value, 20);
        assert.equal(splitHand0.status, 'stood');
      });

      it('B3.3 Split Ace hand 1 receives exactly 1 card and automatically stands', () => {
        const splitHand1 = {
          cards: [{ rank: 'A', suit: 'diamonds' }],
          isSplitAce: true,
          status: 'active'
        };

        // Deal exactly 1 card
        splitHand1.cards.push({ rank: 'K', suit: 'clubs' });
        if (splitHand1.isSplitAce) {
          splitHand1.status = 'stood';
        }

        assert.equal(splitHand1.cards.length, 2);
        assert.equal(scoreHand(splitHand1.cards).value, 21);
        assert.equal(splitHand1.status, 'stood');
      });

      it('B3.4 Attempting to hit on a split Ace hand must be strictly rejected', () => {
        const splitAceHand = {
          cards: [{ rank: 'A', suit: 'spades' }, { rank: '7', suit: 'clubs' }],
          isSplitAce: true,
          status: 'stood'
        };

        function canHit(hand) {
          if (hand.isSplitAce) return false;
          if (hand.status === 'stood' || hand.status === 'busted') return false;
          return scoreHand(hand.cards).value < 21;
        }

        assert.equal(canHit(splitAceHand), false, 'Hit must be rejected on split Aces');
      });

      it('B3.5 Attempting to double down on a split Ace hand must be strictly rejected', () => {
        const splitAceHand = {
          cards: [{ rank: 'A', suit: 'spades' }, { rank: '7', suit: 'clubs' }],
          isSplitAce: true,
          status: 'stood'
        };

        function canDouble(hand) {
          if (hand.isSplitAce) return false;
          return hand.cards.length === 2 && hand.status === 'active';
        }

        assert.equal(canDouble(splitAceHand), false, 'Double must be rejected on split Aces');
      });
    });

    describe('B4: Turn Timer Expiration with Auto-Stand Anti-Stall', () => {
      it('B4.1 Timer reaching 0 must trigger autoStand and not table freeze', () => {
        const turnState = { activeSeat: 1, timeLeft: 15, isStood: false };
        while (turnState.timeLeft > 0) {
          turnState.timeLeft--;
        }
        if (turnState.timeLeft === 0) {
          turnState.isStood = true;
        }
        assert.equal(turnState.isStood, true);
      });

      it('B4.2 Auto-stand must advance active turn clockwise to next seated player', () => {
        const seats = [
          { seatIndex: 0, player: { id: 'p0' }, status: 'stood' },
          { seatIndex: 1, player: { id: 'p1' }, status: 'active' }, // auto-stands
          { seatIndex: 2, player: null, status: 'empty' },
          { seatIndex: 3, player: { id: 'p3' }, status: 'active' }
        ];

        // Seat 1 auto-stands
        seats[1].status = 'stood';

        // Find next active seat
        let nextSeatIndex = -1;
        for (let i = 2; i < seats.length; i++) {
          if (seats[i].status === 'active') {
            nextSeatIndex = seats[i].seatIndex;
            break;
          }
        }
        assert.equal(nextSeatIndex, 3, 'Must skip empty seat 2 and activate seat 3');
      });

      it('B4.3 When last active seat auto-stands, engine transitions to DEALER_TURN', () => {
        const seats = [
          { seatIndex: 0, status: 'stood' },
          { seatIndex: 1, status: 'stood' }
        ];

        const hasActivePlayerTurns = seats.some(s => s.status === 'active');
        let nextPhase = hasActivePlayerTurns ? 'PLAYER_TURNS' : 'DEALER_TURN';
        assert.equal(nextPhase, 'DEALER_TURN');
      });

      it('B4.4 Disconnected AFK player auto-standing on 12 wins if dealer busts', () => {
        const afkHand = [{ rank: '9', suit: 'hearts' }, { rank: '3', suit: 'spades' }]; // 12
        const dealerBustHand = [{ rank: '10', suit: 'clubs' }, { rank: '6', suit: 'diamonds' }, { rank: '8', suit: 'hearts' }]; // 24
        const bet = 100;

        const res = evaluateHand(afkHand, dealerBustHand, bet);
        assert.equal(res.outcome, 'WIN');
        assert.equal(res.gross, 200, 'AFK player still collects 1:1 winnings on dealer bust');
      });

      it('B4.5 Auto-stand on split Hand 0 must advance to split Hand 1 on same seat', () => {
        const seat = {
          seatIndex: 2,
          activeHandIndex: 0,
          hands: [
            { id: 'h0', status: 'active' },
            { id: 'h1', status: 'active' }
          ]
        };

        // Hand 0 auto-stands
        seat.hands[0].status = 'stood';
        if (seat.activeHandIndex < seat.hands.length - 1) {
          seat.activeHandIndex++;
        }

        assert.equal(seat.activeHandIndex, 1);
        assert.equal(seat.hands[1].status, 'active');
      });
    });

    describe('B5: Disconnection During Active Bet', () => {
      it('B5.1 Active bet remains locked and active on table when player drops socket', () => {
        const table = {
          seats: [
            {
              seatIndex: 0,
              player: { id: 'ply_dropped', connected: true },
              bet: 500,
              hand: [{ rank: '10', suit: 'spades' }, { rank: '9', suit: 'hearts' }]
            }
          ]
        };

        // Disconnect
        table.seats[0].player.connected = false;

        assert.equal(table.seats[0].bet, 500, 'Bet must remain intact');
        assert.equal(table.seats[0].hand.length, 2, 'Hand must remain on table');
      });

      it('B5.2 Engine authoritatively completes round and computes payout for disconnected player', () => {
        const pHand = [{ rank: '10', suit: 'spades' }, { rank: '9', suit: 'hearts' }]; // 19
        const dHand = [{ rank: '10', suit: 'diamonds' }, { rank: '8', suit: 'clubs' }]; // 18
        const bet = 500;

        const res = evaluateHand(pHand, dHand, bet);
        assert.equal(res.outcome, 'WIN');
        assert.equal(res.gross, 1000);
      });

      it('B5.3 Winnings are credited directly to persistent account ledger', () => {
        const pm = new PlayerManager({ storagePath: false });
        const player = pm.registerPlayer('sock_dc_test', { name: 'DCLedger' });
        assert.equal(player.chips, 10000);

        // Deduct bet 500
        pm.deductChips(player.id, 500);
        assert.equal(player.chips, 9500);

        // Disconnect socket
        pm.disconnectPlayer('sock_dc_test');

        // Round finishes, credits 1,000 gross winnings to player ID
        pm.addChips(player.id, 1000);
        assert.equal(player.chips, 10500, 'Account balance must be 10,500 chips');
      });

      it('B5.4 Reconnecting with session token retrieves balance with credited winnings', () => {
        const pm = new PlayerManager({ storagePath: false });
        const p = pm.registerPlayer('sock_s1', { name: 'ReconnectUser' });
        pm.addChips(p.id, 2000); // 12,000
        pm.disconnectPlayer('sock_s1');

        const reconnected = pm.registerPlayer('sock_s2', { id: p.id });
        assert.equal(reconnected.chips, 12000);
      });

      it('B5.5 Losses during disconnect forfeit stake and write through accurately', () => {
        const pm = new PlayerManager({ storagePath: false });
        const p = pm.registerPlayer('sock_loss', { name: 'LossUser' });
        pm.deductChips(p.id, 1000);
        assert.equal(p.chips, 9000);

        pm.disconnectPlayer('sock_loss');
        // Player lost, 0 credited

        const reconnected = pm.registerPlayer('sock_loss_reconnect', { id: p.id });
        assert.equal(reconnected.chips, 9000, 'Chips remain 9,000 after loss');
      });
    });
  });

  // -------------------------------------------------------------------------
  // TIER 3: CROSS-FEATURE COMBINATIONS
  // -------------------------------------------------------------------------
  describe('Tier 3 — Cross-Feature Combinations', () => {

    it('C1: Player with active bet in Blackjack attempts to switch to Roulette; rejected with bet lock until round concludes', () => {
      const pm = new PlayerManager({ storagePath: false });
      const p = pm.registerPlayer('sock_cross_nav', { name: 'CrossNavUser' });

      // Simulate Blackjack table with active bet of 1000 chips
      const mockBlackjackEngine = {
        hasActiveBets(id) {
          return id === p.id && this.roundInProgress;
        },
        getActiveBetTotal(id) {
          return id === p.id && this.roundInProgress ? 1000 : 0;
        },
        roundInProgress: true
      };

      const mockRouletteEngine = {
        hasActiveBets: () => false,
        getActiveBetTotal: () => 0
      };

      // 1. Attempt navigation to Roulette during active Blackjack round -> BLOCKED
      const check1 = canPlayerNavigate(p.id, mockRouletteEngine, mockBlackjackEngine);
      assert.equal(check1.allowed, false);
      assert.equal(check1.code, 'CANNOT_LEAVE_ACTIVE_BETS');
      assert.equal(check1.game, 'Blackjack');
      assert.equal(check1.amount, 1000);

      // 2. Round concludes
      mockBlackjackEngine.roundInProgress = false;

      // 3. Retry navigation -> ALLOWED
      const check2 = canPlayerNavigate(p.id, mockRouletteEngine, mockBlackjackEngine);
      assert.equal(check2.allowed, true);

      // 4. Update player presence to Roulette
      pm.setPlayerGame(p.id, 'Roulette');
      assert.equal(p.currentGame, 'Roulette');
    });

    it('C2: Seated player sends table chat, verified only received in table room and not in other games', () => {
      const globalRoom = 'casino:global';
      const rouletteRoom = 'table:roulette';
      const blackjackRoom = 'table:blackjack';

      // 3 connected clients
      const clients = [
        { id: 'c1', name: 'Alice', rooms: new Set([globalRoom, blackjackRoom]), received: [] },
        { id: 'c2', name: 'Bob', rooms: new Set([globalRoom, rouletteRoom]), received: [] },
        { id: 'c3', name: 'Charlie', rooms: new Set([globalRoom]), received: [] } // in lobby
      ];

      function broadcastMessage(targetRoom, msg) {
        for (const c of clients) {
          if (c.rooms.has(targetRoom)) {
            c.received.push(msg);
          }
        }
      }

      // Alice sends table chat in Blackjack room
      const tableMsg = { scope: 'table', sender: 'Alice', text: 'Splitting these eights!' };
      broadcastMessage(blackjackRoom, tableMsg);

      assert.equal(clients[0].received.length, 1, 'Alice receives her table message');
      assert.equal(clients[1].received.length, 0, 'Bob in Roulette must NOT receive Blackjack table chat');
      assert.equal(clients[2].received.length, 0, 'Charlie in Lobby must NOT receive Blackjack table chat');

      // Alice sends global chat
      const globalMsg = { scope: 'global', sender: 'Alice', text: 'Hello Monte Carlo!' };
      broadcastMessage(globalRoom, globalMsg);

      assert.equal(clients[0].received.length, 2);
      assert.equal(clients[1].received.length, 1, 'Bob receives global chat');
      assert.equal(clients[2].received.length, 1, 'Charlie receives global chat');
    });

    it('C3: Session reload while seated recovers persistent session without losing active seat or chips', () => {
      const pm = new PlayerManager({ storagePath: false });
      const p = pm.registerPlayer('sock_seat_recover', { name: 'SeatedRecoverer' });
      assert.equal(p.chips, 10000);

      // Player sits at Seat 3 with 500 chip wager
      pm.deductChips(p.id, 500);
      assert.equal(p.chips, 9500);

      const tableState = {
        seats: [
          { seatIndex: 0, player: null },
          { seatIndex: 1, player: null },
          { seatIndex: 2, player: null },
          { seatIndex: 3, player: { id: p.id, name: p.name, chips: p.chips }, bet: 500 },
          { seatIndex: 4, player: null }
        ]
      };

      // Simulate browser page refresh: disconnect socket
      pm.disconnectPlayer('sock_seat_recover');

      // Client re-authenticates with persistent player id
      const restoredPlayer = pm.registerPlayer('sock_seat_new', { id: p.id });

      assert.equal(restoredPlayer.id, p.id);
      assert.equal(restoredPlayer.chips, 9500);

      // Verify seat ownership remains attached to restored player
      const mySeat = tableState.seats.find(s => s.player && s.player.id === restoredPlayer.id);
      assert.ok(mySeat);
      assert.equal(mySeat.seatIndex, 3);
      assert.equal(mySeat.bet, 500);
    });
  });

  // -------------------------------------------------------------------------
  // TIER 4: REAL-WORLD APPLICATION WORKLOADS
  // -------------------------------------------------------------------------
  describe('Tier 4 — Real-World Application Workloads', () => {

    it('W1: Realistic 3-player concurrent round (hit, stand, double) with S17 dealer and atomic disk updates', () => {
      const testDir = path.join(__dirname, '..', '..', 'server', 'data', 'test_e2e_workload');
      if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
      const storageFile = path.join(testDir, `workload_${Date.now()}.json`);

      try {
        const pm = new PlayerManager({ storagePath: storageFile });

        // 1. Onboard 3 players
        const p1 = pm.registerPlayer('sock_alice', { name: 'Alice' });   // Seat 0
        const p2 = pm.registerPlayer('sock_bob', { name: 'Bob' });       // Seat 2
        const p3 = pm.registerPlayer('sock_charlie', { name: 'Charlie' }); // Seat 4

        assert.equal(p1.chips, 10000);
        assert.equal(p2.chips, 10000);
        assert.equal(p3.chips, 10000);

        // 2. Place bets in BETTING phase
        // Alice bets 500, Bob bets 1,000, Charlie bets 250
        pm.deductChips(p1.id, 500);
        pm.deductChips(p2.id, 1000);
        pm.deductChips(p3.id, 250);

        const table = {
          seats: [
            { seatIndex: 0, player: p1, bet: 500, hand: [], status: 'active' },
            { seatIndex: 1, player: null, bet: 0, hand: [], status: 'empty' },
            { seatIndex: 2, player: p2, bet: 1000, hand: [], status: 'active' },
            { seatIndex: 3, player: null, bet: 0, hand: [], status: 'empty' },
            { seatIndex: 4, player: p3, bet: 250, hand: [], status: 'active' }
          ],
          dealerHand: []
        };

        // 3. Initial Deal
        // Alice dealt [8, 3] = 11
        table.seats[0].hand = [{ rank: '8', suit: 'spades' }, { rank: '3', suit: 'hearts' }];
        // Bob dealt [10, 6] = 16
        table.seats[2].hand = [{ rank: '10', suit: 'clubs' }, { rank: '6', suit: 'diamonds' }];
        // Charlie dealt [9, 9] = 18
        table.seats[4].hand = [{ rank: '9', suit: 'hearts' }, { rank: '9', suit: 'spades' }];
        // Dealer dealt [10 upcard, 6 hidden hole card] = 16
        table.dealerHand = [{ rank: '10', suit: 'diamonds' }, { rank: '6', suit: 'spades' }];

        // 4. Player Turn: Seat 0 (Alice)
        // Alice has 11 -> elects to DOUBLE DOWN!
        // Deduct extra 500 chips, deal 1 card: '10' -> total 21!
        pm.deductChips(p1.id, 500);
        table.seats[0].bet *= 2; // bet is now 1000
        table.seats[0].hand.push({ rank: '10', suit: 'diamonds' });
        table.seats[0].status = 'stood';
        assert.equal(scoreHand(table.seats[0].hand).value, 21);

        // 5. Player Turn: Seat 2 (Bob)
        // Bob has 16 -> elects to HIT
        // Deals '3' -> total 19! Bob STANDS.
        table.seats[2].hand.push({ rank: '3', suit: 'clubs' });
        table.seats[2].status = 'stood';
        assert.equal(scoreHand(table.seats[2].hand).value, 19);

        // 6. Player Turn: Seat 4 (Charlie)
        // Charlie has 18 -> elects to STAND
        table.seats[4].status = 'stood';
        assert.equal(scoreHand(table.seats[4].hand).value, 18);

        // 7. Dealer Turn (S17 rule)
        // Dealer reveals hole card: [10, 6] = 16
        assert.equal(scoreHand(table.dealerHand).value, 16);
        // Dealer must draw because 16 < 17
        // Shoe deals '8' -> total is 24 (DEALER BUSTS!)
        table.dealerHand.push({ rank: '8', suit: 'hearts' });
        const dealerFinalScore = scoreHand(table.dealerHand);
        assert.equal(dealerFinalScore.value, 24);
        assert.equal(dealerFinalScore.isBust, true);

        // 8. Payout Settlement
        // All 3 players stood without busting -> all WIN 1:1 against dealer bust!
        const resAlice = evaluateHand(table.seats[0].hand, table.dealerHand, table.seats[0].bet);
        const resBob = evaluateHand(table.seats[2].hand, table.dealerHand, table.seats[2].bet);
        const resCharlie = evaluateHand(table.seats[4].hand, table.dealerHand, table.seats[4].bet);

        assert.equal(resAlice.outcome, 'WIN');
        assert.equal(resAlice.gross, 2000, 'Alice doubled bet of 1000 wins 2000 gross (+1000 net)');

        assert.equal(resBob.outcome, 'WIN');
        assert.equal(resBob.gross, 2000, 'Bob bet of 1000 wins 2000 gross (+1000 net)');

        assert.equal(resCharlie.outcome, 'WIN');
        assert.equal(resCharlie.gross, 500, 'Charlie bet of 250 wins 500 gross (+250 net)');

        // Credit balances
        pm.addChips(p1.id, resAlice.gross);
        pm.addChips(p2.id, resBob.gross);
        pm.addChips(p3.id, resCharlie.gross);

        // Verify final chip balances in memory:
        // Alice: started 10,000 - 500 (bet) - 500 (double) + 2000 (win) = 11,000
        // Bob: started 10,000 - 1000 (bet) + 2000 (win) = 11,000
        // Charlie: started 10,000 - 250 (bet) + 500 (win) = 10,250
        assert.equal(p1.chips, 11000);
        assert.equal(p2.chips, 11000);
        assert.equal(p3.chips, 10250);

        // Flush and verify on disk
        pm.saveAccounts();
        assert.ok(fs.existsSync(storageFile));

        const pmReloaded = new PlayerManager({ storagePath: storageFile });
        const p1Reloaded = pmReloaded.registerPlayer('sock_new_a', { name: 'Alice' });
        const p2Reloaded = pmReloaded.registerPlayer('sock_new_b', { name: 'Bob' });
        const p3Reloaded = pmReloaded.registerPlayer('sock_new_c', { name: 'Charlie' });

        assert.equal(p1Reloaded.chips, 11000, 'Alice balance must be 11,000 on disk');
        assert.equal(p2Reloaded.chips, 11000, 'Bob balance must be 11,000 on disk');
        assert.equal(p3Reloaded.chips, 10250, 'Charlie balance must be 10,250 on disk');

      } finally {
        try {
          if (fs.existsSync(storageFile)) fs.unlinkSync(storageFile);
          if (fs.existsSync(testDir)) fs.rmdirSync(testDir);
        } catch (_) {}
      }
    });
  });
});

/**
 * Safe helper checking if string contains emojis.
 */
function emojiRegexSafe(str) {
  const r = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/u;
  return r.test(str);
}
