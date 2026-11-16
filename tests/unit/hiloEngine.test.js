const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';

const PlayerManager = require('../../server/game/playerManager');
const BankManager = require('../../server/game/bankManager');
const HiloEngine = require('../../server/game/hiloEngine');
const {
  TARGET_RTP,
  MAX_EV_CAP,
  MIN_BET,
  MAX_BET,
  MAX_SKIPS_PER_LADDER,
  BLITZ_PHASES,
  getStreakTier
} = require('../../server/game/hiloConstants');
const {
  createDeck,
  createShuffledDeck,
  calculateHiloOdds,
  evaluateGuess,
  normalizePrediction
} = require('../../server/game/hiloDeck');

describe('Hi-Lo Privé Engine, 94% RTP & Game Logic Unit Suite', () => {
  it('constructs a valid 52-card unique deck and strict EV <= MAX_EV_CAP across every rank', () => {
    const deck = createDeck();
    assert.equal(deck.length, 52);
    const codes = new Set(deck.map((c) => c.code));
    assert.equal(codes.size, 52);

    const shuffled = createShuffledDeck();
    assert.equal(shuffled.length, 52);

    // Verify EV <= MAX_EV_CAP for every starting card against remaining 51 cards
    const seenRanks = new Set();
    for (const card of deck) {
      if (seenRanks.has(card.rank)) continue;
      seenRanks.add(card.rank);
      const remaining = deck.filter((c) => c.code !== card.code);
      const odds = calculateHiloOdds(card, remaining, TARGET_RTP);

      assert.equal(odds.total, 51);
      for (const key of ['higher', 'equal', 'lower']) {
        const d = odds[key];
        if (d.available) {
          const ev = d.probability * d.multiplier;
          assert.ok(
            ev <= MAX_EV_CAP,
            `Expected EV <= ${MAX_EV_CAP} for ${card.rank} ${key}, got ${ev.toFixed(4)}`
          );
          assert.ok(d.multiplier >= 1.01, `Multiplier must be >= 1.01 when available`);
        } else {
          assert.equal(d.multiplier, 0);
        }
      }

      if (card.value === 14) {
        assert.equal(odds.higher.available, false);
        assert.equal(odds.higher.multiplier, 0);
      }
      if (card.value === 2) {
        assert.equal(odds.lower.available, false);
        assert.equal(odds.lower.multiplier, 0);
      }
    }
  });

  it('disables 100%-certain tail directions to prevent any >96% EV exploit', () => {
    const deuce = { rank: '2', suit: 'spades', value: 2, code: '2S', isRed: false };
    const highTail = createDeck().filter((c) => c.value >= 10).slice(0, 14);
    const odds = calculateHiloOdds(deuce, highTail, TARGET_RTP);

    // 14/14 higher -> prob = 1.0 -> prob * 1.01 = 1.01 > 0.96 -> MUST disable!
    assert.equal(odds.higher.available, false);
    assert.equal(odds.higher.multiplier, 0);
  });

  it('enforces strict Hi-Lo rules where equal rank loses HIGHER and LOWER', () => {
    const sevenS = { rank: '7', suit: 'spades', value: 7 };
    const sevenH = { rank: '7', suit: 'hearts', value: 7 };
    const eightD = { rank: '8', suit: 'diamonds', value: 8 };
    const sixC = { rank: '6', suit: 'clubs', value: 6 };

    assert.equal(evaluateGuess(sevenS, sevenH, 'HIGHER'), false);
    assert.equal(evaluateGuess(sevenS, sevenH, 'LOWER'), false);
    assert.equal(evaluateGuess(sevenS, sevenH, 'EQUAL'), true);
    assert.equal(evaluateGuess(sevenS, eightD, 'HIGHER'), true);
    assert.equal(evaluateGuess(sevenS, sixC, 'LOWER'), true);

    assert.equal(normalizePrediction('hoger'), 'HIGHER');
    assert.equal(normalizePrediction('gelijk'), 'EQUAL');
    assert.equal(normalizePrediction('lager'), 'LOWER');
    assert.equal(normalizePrediction('invalid_bet'), null);
  });

  it('handles Solo Ladder start, Streak 0 cashout refund, skips, 50% Half-Cashout & loss', () => {
    const pm = new PlayerManager({ storagePath: false });
    const player = pm.registerPlayer('s1', { name: 'Renzo' });
    pm.resetBankroll(player.id, 10000);
    const startChips = player.chips; // 10,000
    const engine = new HiloEngine(pm);

    // Invalid bets rejected
    assert.equal(engine.startLadder(player.id, MIN_BET - 1).code, 'INVALID_BET');
    assert.equal(engine.startLadder(player.id, MAX_BET + 1).code, 'INVALID_BET');
    assert.equal(engine.startLadder(player.id, startChips + 500).code, 'INSUFFICIENT_CHIPS');

    // Start & cashout at streak 0 returns exact initial bet
    const s0 = engine.startLadder(player.id, 200);
    assert.equal(s0.ok, true);
    assert.equal(player.chips, startChips - 200);
    assert.equal(engine.hasActiveBets(player.id), true);

    const cash0 = engine.cashout(player.id);
    assert.equal(cash0.ok, true);
    assert.equal(cash0.payout, 200);
    assert.equal(cash0.netProfit, 0);
    assert.equal(player.chips, startChips);
    assert.equal(engine.hasActiveBets(player.id), false);

    // Rigged shoe for deterministic progression test: draw uses .pop() (top = tail)
    engine.soloShoes.set(player.id, [
      { rank: 'A', suit: 'spades', value: 14, code: 'AS', isRed: false },
      { rank: '9', suit: 'hearts', value: 9, code: '9H', isRed: true },
      { rank: '8', suit: 'clubs', value: 8, code: '8C', isRed: false },
      { rank: '7', suit: 'diamonds', value: 7, code: '7D', isRed: true },
      { rank: '6', suit: 'spades', value: 6, code: '6S', isRed: false },
      { rank: '5', suit: 'hearts', value: 5, code: '5H', isRed: true },
      { rank: '4', suit: 'clubs', value: 4, code: '4C', isRed: false },
      { rank: 'K', suit: 'hearts', value: 13, code: 'KH', isRed: true },
      { rank: 'K', suit: 'clubs', value: 13, code: 'KC', isRed: false },
      { rank: '2', suit: 'diamonds', value: 2, code: '2D', isRed: true },
      { rank: '10', suit: 'spades', value: 10, code: '10S', isRed: false }, // drawn by skip 2
      { rank: 'Q', suit: 'hearts', value: 12, code: 'QH', isRed: true }, // drawn by skip 1
      { rank: '9', suit: 'diamonds', value: 9, code: '9D', isRed: true }, // win 2 (> 7)
      { rank: '7', suit: 'clubs', value: 7, code: '7C', isRed: false }, // win 1 (> 3)
      { rank: '3', suit: 'spades', value: 3, code: '3S', isRed: false } // start card (popped first)
    ]);

    const s1 = engine.startLadder(player.id, 1000);
    assert.equal(s1.ok, true);
    assert.equal(s1.ladder.currentCard.rank, '3');

    // Invalid prediction rejected
    const badPred = engine.makeGuess(player.id, 'FOOBAR');
    assert.equal(badPred.ok, false);
    assert.equal(badPred.code, 'INVALID_PREDICTION');

    // Half cashout rejected below streak 2
    assert.equal(engine.halfCashout(player.id).code, 'HALF_CASHOUT_STREAK_TOO_LOW');

    // Win 1 & Win 2
    const w1 = engine.makeGuess(player.id, 'HIGHER');
    assert.equal(w1.won, true);
    assert.equal(w1.streak, 1);

    const w2 = engine.makeGuess(player.id, 'HIGHER');
    assert.equal(w2.won, true);
    assert.equal(w2.streak, 2);
    assert.equal(w2.ladder.canHalfCashout, true);

    // Execute 50% Half-Cashout
    const halfRes = engine.halfCashout(player.id);
    assert.equal(halfRes.ok, true);
    const chipsAfterHalf = player.chips;
    assert.ok(halfRes.payout > 0);
    assert.equal(halfRes.ladder.streak, 2);

    // Execute max 2 skips
    const sk1 = engine.skipCard(player.id);
    assert.equal(sk1.ok, true);
    assert.equal(sk1.skipsRemaining, MAX_SKIPS_PER_LADDER - 1);
    const sk2 = engine.skipCard(player.id);
    assert.equal(sk2.ok, true);
    assert.equal(sk2.skipsRemaining, 0);
    assert.equal(engine.skipCard(player.id).code, 'NO_SKIPS_LEFT');

    // Cashout remainder cleanly
    const finalCash = engine.cashout(player.id);
    assert.equal(finalCash.ok, true);
    assert.equal(player.chips, chipsAfterHalf + finalCash.payout);
    assert.equal(engine.hasActiveBets(player.id), false);
    assert.equal(engine.personalHistory.get(player.id).length, 2);
  });

  it('triggers slowMo on streak >= 4 or EQUAL bet and auto-reshuffles below 13 shoe cards', () => {
    const pm = new PlayerManager({ storagePath: false });
    const player = pm.registerPlayer('s2', { name: 'Elena' });
    const engine = new HiloEngine(pm);

    // 14 cards total -> start draws 1 (13 left), win 1 leaves 12 < 13 -> reshuffles!
    const shoe = [];
    for (let i = 2; i <= 14; i++) {
      const rank = i === 14 ? 'A' : i === 13 ? 'K' : i === 12 ? 'Q' : i === 11 ? 'J' : String(i);
      shoe.push({ rank, suit: 'spades', value: i, code: `${rank}S`, isRed: false });
    }
    shoe.push({ rank: '2', suit: 'hearts', value: 2, code: '2H', isRed: true }); // top card -> start card
    // Put King above top? Wait: let's make top card 2H, next drawn (2nd from top) = AS (value 14 > 2)
    shoe[shoe.length - 1] = { rank: '2', suit: 'hearts', value: 2, code: '2H', isRed: true };
    shoe[shoe.length - 2] = { rank: 'A', suit: 'spades', value: 14, code: 'AS', isRed: false };
    engine.soloShoes.set(player.id, shoe);

    const startRes = engine.startLadder(player.id, 100);
    assert.equal(startRes.ok, true);
    assert.equal(startRes.ladder.shoeRemaining, 13);

    const guessRes = engine.makeGuess(player.id, 'EQUAL');
    assert.equal(guessRes.slowMo, true); // EQUAL triggers slow-mo suspense!
    assert.equal(guessRes.won, false); // AS (14) != 2H (2) -> bust
    assert.equal(guessRes.reshuffled, true); // 12 < 13 triggered automatic reshuffle
    assert.equal(engine.soloShoes.get(player.id).length, 52);

    assert.equal(getStreakTier(0).key, 'START');
    assert.equal(getStreakTier(1).key, 'WARM');
    assert.equal(getStreakTier(3).key, 'ON_FIRE');
    assert.equal(getStreakTier(5).key, 'ROYALE');
  });

  it('repays bank loan automatically only on realized Solo profit', () => {
    const pm = new PlayerManager({ storagePath: false });
    const bm = new BankManager(pm, { storagePath: false });
    const lender = pm.registerPlayer('l1', { name: 'Lender' });
    const borrower = pm.registerPlayer('b1', { name: 'Borrower' });
    pm.resetBankroll(lender.id, 10000);
    pm.resetBankroll(borrower.id, 10000);

    const req = bm.createLoanProposal({
      fromId: borrower.id,
      toId: lender.id,
      type: 'borrow',
      amount: 500,
      interestPct: 10,
      winDeductionPct: 50
    });
    assert.equal(req.success, true);
    const acc = bm.acceptProposal(req.proposal.id, lender.id);
    assert.equal(acc.success, true);
    const lenderBefore = lender.chips;

    const engine = new HiloEngine(pm, { bankManager: bm });
    engine.soloShoes.set(borrower.id, [
      ...createDeck().slice(0, 20),
      { rank: '10', suit: 'hearts', value: 10, code: '10H', isRed: true }, // next card
      { rank: '2', suit: 'spades', value: 2, code: '2S', isRed: false } // start card
    ]);

    engine.startLadder(borrower.id, 1000);
    // Win on 2 -> HIGHER (odds computed dynamically against remaining 21 cards)
    const ladder = engine.soloLadders.get(borrower.id);
    // Set explicit 2.00x odds temporarily to guarantee measurable realized profit on next win
    ladder.odds.higher = { available: true, count: 10, probability: 0.47, pct: 47, multiplier: 2.0 };
    const win = engine.makeGuess(borrower.id, 'HIGHER');
    assert.equal(win.won, true);
    assert.equal(win.newPot, 2000);

    const cash = engine.cashout(borrower.id);
    assert.equal(cash.ok, true);
    assert.equal(cash.netProfit, 1000);
    assert.ok(cash.repayments.length > 0);
    assert.ok(lender.chips > lenderBefore);
  });

  it('runs Multiplayer Blitz smart clock, early-lock speedup & cancel refund cleanly', async () => {
    const pm = new PlayerManager({ storagePath: false });
    const p1 = pm.registerPlayer('a1', { name: 'Alice' });
    const p2 = pm.registerPlayer('b2', { name: 'Bob' });
    const engine = new HiloEngine(pm, {
      entrySec: 5,
      decisionSec: 5,
      earlyLockSec: 1,
      revealMs: 50,
      settleMs: 50
    });

    assert.equal(engine.blitz.phase, BLITZ_PHASES.WAITING_FOR_PLAYERS);

    const j1 = engine.blitzJoin(p1.id, 250);
    assert.equal(j1.ok, true);
    assert.equal(engine.blitz.phase, BLITZ_PHASES.BETTING);
    assert.equal(engine.hasActiveBets(p1.id), true);

    // Cancelling returns player & resets empty room back to WAITING_FOR_PLAYERS
    const c1 = engine.blitzCancel(p1.id);
    assert.equal(c1.ok, true);
    assert.equal(c1.refunded, 250);
    assert.equal(engine.blitz.phase, BLITZ_PHASES.WAITING_FOR_PLAYERS);
    assert.equal(engine.hasActiveBets(p1.id), false);

    // Join both players & test DECISION early-lock speedup directly
    engine.blitzJoin(p1.id, 100);
    engine.blitzJoin(p2.id, 100);
    engine._clearBlitzTimers();
    engine._beginBlitzFirstCard();

    assert.equal(engine.blitz.phase, BLITZ_PHASES.DECISION);
    const d = engine.blitz.odds.higher.available ? 'HIGHER' : 'LOWER';
    engine.blitzAction(p1.id, d);
    // Still 5s because p2 hasn't picked
    assert.equal(engine.blitz.timerSeconds, 5);

    // P2 picks -> triggers Smart Clock early lock to 1s!
    let earlyTick = false;
    engine.once('blitz_tick', (t) => {
      if (t.earlyLocked) earlyTick = true;
    });
    engine.blitzAction(p2.id, d);
    assert.equal(earlyTick, true);
    assert.equal(engine.blitz.timerSeconds, 1);

    // Resolve flip cleanly and settle p1 via Blitz CASHOUT on surviving win (if won) or verify clean phase
    engine._resolveBlitzFlip();
    assert.ok(['REVEALING', 'SETTLED'].includes(engine.blitz.phase));

    // Cheer cooldown validation
    assert.equal(engine.cheerPlayer(p1.id, p1.id).code, 'CANNOT_CHEER_SELF');
    assert.equal(engine.cheerPlayer(p1.id, p2.id).ok, true);
    assert.equal(engine.cheerPlayer(p1.id, p2.id).code, 'CHEER_COOLDOWN');

    engine.stop();
  });

  it('keeps HIGHER playable on card 2 and LOWER playable on Ace across depleted & zero-match shoes with EV < 1', () => {
    const pm = new PlayerManager({ storagePath: false });
    const player = pm.registerPlayer('s_edge', { name: 'EdgeTester' });
    const engine = new HiloEngine(pm);

    // Scenario A: 26-card shoe where 2 twos already exited (25 higher + 1 remaining two -> 96.15%)
    const shoeDepleted = [];
    for (let v = 3; v <= 14; v++) {
      const rank = v === 14 ? 'A' : v === 13 ? 'K' : v === 12 ? 'Q' : v === 11 ? 'J' : String(v);
      shoeDepleted.push({ rank, suit: 'spades', value: v, code: `${rank}S`, isRed: false });
      shoeDepleted.push({ rank, suit: 'hearts', value: v, code: `${rank}H`, isRed: true });
    }
    shoeDepleted.push({ rank: 'K', suit: 'clubs', value: 13, code: 'KC', isRed: false });
    shoeDepleted.push({ rank: '2', suit: 'clubs', value: 2, code: '2C', isRed: false }); // 1 remaining two
    shoeDepleted.push({ rank: '2', suit: 'spades', value: 2, code: '2S', isRed: false }); // top card -> start card (2S)
    engine.soloShoes.set(player.id, shoeDepleted);

    const startA = engine.startLadder(player.id, 100);
    assert.equal(startA.ok, true);
    assert.equal(startA.ladder.currentCard.value, 2);
    assert.equal(startA.ladder.odds.higher.available, true);
    assert.equal(startA.ladder.odds.higher.multiplier, 1.01);
    assert.ok(startA.ladder.odds.higher.probability * startA.ladder.odds.higher.multiplier < 1.0);
    engine.cashout(player.id);

    // Scenario B: 20-card shoe with ZERO remaining twos -> engine reshuffles fresh 51-card shoe automatically!
    const zeroTwosShoe = [];
    for (let v = 3; v <= 12; v++) {
      const rank = v === 12 ? 'Q' : v === 11 ? 'J' : String(v);
      zeroTwosShoe.push({ rank, suit: 'spades', value: v, code: `${rank}S`, isRed: false });
      zeroTwosShoe.push({ rank, suit: 'hearts', value: v, code: `${rank}H`, isRed: true });
    }
    zeroTwosShoe.push({ rank: '2', suit: 'diamonds', value: 2, code: '2D', isRed: true }); // top card
    engine.soloShoes.set(player.id, zeroTwosShoe);

    const startB = engine.startLadder(player.id, 100);
    assert.equal(startB.ok, true);
    assert.equal(startB.ladder.currentCard.value, 2);
    assert.equal(startB.reshuffled, true);
    assert.equal(startB.ladder.odds.higher.available, true);
    assert.equal(startB.ladder.odds.higher.multiplier, 1.01);
    assert.equal(startB.ladder.odds.lower.available, false);
    assert.equal(startB.ladder.odds.equal.available, true);

    const guessB = engine.makeGuess(player.id, 'HIGHER');
    assert.equal(guessB.ok, true);
    engine.stop();
  });

  it('contains zero audio references and zero Unicode emojis in Hi-Lo modules', () => {
    const emojiRe = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/u;
    const audioRe = /AudioContext|webkitAudioContext|<audio|\.mp3|\.wav|\.ogg/i;

    const filesToCheck = [
      path.resolve(__dirname, '../../server/game/hiloConstants.js'),
      path.resolve(__dirname, '../../server/game/hiloDeck.js'),
      path.resolve(__dirname, '../../server/game/hiloEngine.js'),
      path.resolve(__dirname, '../../client/js/hilo.js')
    ];

    for (const file of filesToCheck) {
      const content = fs.readFileSync(file, 'utf8');
      assert.equal(emojiRe.test(content), false, `Found emoji in ${path.basename(file)}`);
      assert.equal(audioRe.test(content), false, `Found audio ref in ${path.basename(file)}`);
    }
  });
});
