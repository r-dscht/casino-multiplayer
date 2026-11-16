/**
 * @fileoverview Monte Carlo Hi-Lo Prive game engine.
 * Supports:
 *  - Solo Ladder: 52-card shoe (auto-reshuffle < 13 cards), strict Hi/Eq/Lo rules,
 *    dynamic 94% RTP odds, max 2 free skips per ladder, 50% Half-Cashout (streak >= 2),
 *    slow-mo suspense triggers, personal ladder history & atomic bank loan repayment.
 *  - Multiplayer Zaal & Blitz: live salon player cards, cosmetic cheers (1.5s cooldown),
 *    synchronized Smart-Clock Blitz rounds (max 8 cards, early-lock speedup when all
 *    survivors pick), crowd consensus telemetry, and global casino highlights.
 */

const EventEmitter = require('events');
const {
  TARGET_RTP,
  MIN_BET,
  MAX_BET,
  MAX_LADDER_POT,
  MAX_SKIPS_PER_LADDER,
  HALF_CASHOUT_MIN_STREAK,
  HALF_CASHOUT_MIN_POT,
  MIN_SHOE_CARDS,
  CARD_TRAIL_LIMIT,
  SLOW_MO_STREAK_THRESHOLD,
  CHEER_COOLDOWN_MS,
  HISTORY_LIMIT,
  RECENT_WINS_LIMIT,
  BIG_WIN_MIN_NET_PROFIT,
  BIG_WIN_MIN_STREAK,
  PREDICTIONS,
  BLITZ_MAX_CARDS,
  BLITZ_PHASES,
  BLITZ_DURATIONS,
  getStreakTier
} = require('./hiloConstants');
const {
  createShuffledDeck,
  drawCard,
  calculateHiloOdds,
  normalizePrediction,
  evaluateGuess
} = require('./hiloDeck');

class HiloEngine extends EventEmitter {
  /**
   * Accepts either (playerManager, options) or ({ playerManager, bankManager, ...options }).
   * @param {Object} playerManagerOrOptions
   * @param {Object} [maybeOptions={}]
   */
  constructor(playerManagerOrOptions, maybeOptions = {}) {
    super();
    let playerManager = playerManagerOrOptions;
    let options = maybeOptions || {};

    if (
      playerManagerOrOptions &&
      typeof playerManagerOrOptions === 'object' &&
      playerManagerOrOptions.playerManager &&
      typeof playerManagerOrOptions.getPlayerById !== 'function'
    ) {
      playerManager = playerManagerOrOptions.playerManager;
      options = { ...playerManagerOrOptions, ...maybeOptions };
    }

    this.playerManager = playerManager;
    this.bankManager = options.bankManager || null;
    this.targetRtp = typeof options.targetRtp === 'number' ? options.targetRtp : TARGET_RTP;

    this.durations = {
      ENTRY_SEC: Number.isFinite(options.entrySec) ? options.entrySec : BLITZ_DURATIONS.ENTRY_SEC,
      DECISION_SEC: Number.isFinite(options.decisionSec) ? options.decisionSec : BLITZ_DURATIONS.DECISION_SEC,
      EARLY_LOCK_SEC: Number.isFinite(options.earlyLockSec) ? options.earlyLockSec : BLITZ_DURATIONS.EARLY_LOCK_SEC,
      REVEAL_MS: Number.isFinite(options.revealMs) ? options.revealMs : BLITZ_DURATIONS.REVEAL_MS,
      SETTLE_MS: Number.isFinite(options.settleMs) ? options.settleMs : BLITZ_DURATIONS.SETTLE_MS
    };

    /** @type {Map<string, Object>} Active Solo Ladders by playerId */
    this.soloLadders = new Map();
    /** @type {Map<string, Array>} Persistent 52-card shoes per player */
    this.soloShoes = new Map();
    /** @type {Map<string, Object>} Players actively present in Hi-Lo Salon */
    this.salonPlayers = new Map();
    /** @type {Map<string, number>} `${fromId}:${toId}` -> last cheer timestamp */
    this.cheerCooldowns = new Map();
    /** @type {Map<string, Array>} Personal completed run history by playerId */
    this.personalHistory = new Map();
    /** @type {Array<Object>} Recent big wins & streak cashouts across Hi-Lo */
    this.recentWins = [];

    this._ladderSeq = 0;
    this._blitzInterval = null;
    this._blitzTimeout = null;
    this._stopped = false;

    this.blitz = {
      roundId: 0,
      phase: BLITZ_PHASES.WAITING_FOR_PLAYERS,
      timerSeconds: 0,
      shoe: createShuffledDeck(),
      currentCard: null,
      cardIndex: 0,
      cardTrail: [],
      odds: null,
      entries: new Map(),
      lastResult: null,
      reshuffled: false
    };
  }

  /**
   * Starts engine lifecycle (no idle timer runs in WAITING_FOR_PLAYERS).
   */
  start() {
    this._stopped = false;
  }

  /**
   * Stops all active timers cleanly for shutdown or test teardown.
   */
  stop() {
    this._stopped = true;
    this._clearBlitzTimers();
  }

  /** @private */
  _clearBlitzTimers() {
    if (this._blitzInterval) {
      clearInterval(this._blitzInterval);
      this._blitzInterval = null;
    }
    if (this._blitzTimeout) {
      clearTimeout(this._blitzTimeout);
      this._blitzTimeout = null;
    }
  }

  /** @private */
  _ensurePlayer(playerId) {
    if (!this.playerManager || typeof this.playerManager.getPlayerById !== 'function') return null;
    return this.playerManager.getPlayerById(playerId) || null;
  }

  /** @private */
  _ensureSalonMember(player) {
    if (!player) return null;
    let member = this.salonPlayers.get(player.id);
    if (!member) {
      member = {
        id: player.id,
        name: player.name,
        initials: player.initials || player.name.slice(0, 2).toUpperCase(),
        avatarColor: player.avatarColor || '#d4af37',
        cheers: 0,
        joinedAt: Date.now()
      };
      this.salonPlayers.set(player.id, member);
    } else {
      member.name = player.name;
      member.initials = player.initials || member.initials;
      member.avatarColor = player.avatarColor || member.avatarColor;
    }
    return member;
  }

  /**
   * Marks a player as present in the Hi-Lo Salon and returns snapshot data.
   * @param {string} playerId
   */
  joinSalon(playerId) {
    const player = this._ensurePlayer(playerId);
    if (!player) return null;
    const member = this._ensureSalonMember(player);
    this.emit('salon_update', { trigger: 'join', playerId });
    return member;
  }

  /**
   * Removes a player from Salon presence (only if not mid-ladder or mid-blitz).
   * @param {string} playerId
   */
  leaveSalon(playerId) {
    if (!this.hasActiveBets(playerId) && this.salonPlayers.has(playerId)) {
      this.salonPlayers.delete(playerId);
      this.emit('salon_update', { trigger: 'leave', playerId });
    }
  }

  /** @private */
  _settlePayout(playerId, payout, realizedProfit) {
    let newChips = 0;
    if (payout > 0) {
      this.playerManager.addChips(playerId, payout);
    }
    let repayments = [];
    if (realizedProfit > 0 && this.bankManager && typeof this.bankManager.processWinRepayment === 'function') {
      const res = this.bankManager.processWinRepayment(playerId, realizedProfit);
      if (Array.isArray(res)) repayments = res;
    }
    const updatedPlayer = this._ensurePlayer(playerId);
    newChips = updatedPlayer ? updatedPlayer.chips : 0;
    return { newChips, repayments };
  }

  /** @private */
  _recordPersonalHistory(playerId, entry) {
    if (!this.personalHistory.has(playerId)) {
      this.personalHistory.set(playerId, []);
    }
    const list = this.personalHistory.get(playerId);
    list.unshift(entry);
    if (list.length > HISTORY_LIMIT) {
      list.length = HISTORY_LIMIT;
    }
  }

  /** @private */
  _maybeRecordRecentWin(player, details) {
    const { mode, initialBet, payout, netProfit, maxStreak } = details;
    if (netProfit <= 0) return;
    const ratio = initialBet > 0 ? payout / initialBet : 1;
    if (maxStreak < BIG_WIN_MIN_STREAK && netProfit < BIG_WIN_MIN_NET_PROFIT && ratio < 2) {
      return;
    }
    this.recentWins.unshift({
      playerId: player.id,
      playerName: player.name,
      initials: player.initials || player.name.slice(0, 2).toUpperCase(),
      avatarColor: player.avatarColor || '#d4af37',
      mode,
      initialBet,
      payout,
      netProfit,
      multiplier: initialBet > 0 ? Math.round((payout / initialBet) * 100) / 100 : 1,
      maxStreak,
      timestamp: Date.now()
    });
    if (this.recentWins.length > RECENT_WINS_LIMIT) {
      this.recentWins.length = RECENT_WINS_LIMIT;
    }
  }

  /** @private */
  _serializeLadder(ladder) {
    if (!ladder) return null;
    const tier = getStreakTier(ladder.streak);
    return {
      id: ladder.id,
      status: ladder.status,
      initialBet: ladder.initialBet,
      pot: ladder.pot,
      halfCashedOutTotal: ladder.halfCashedOutTotal,
      streak: ladder.streak,
      tier,
      skipsUsed: ladder.skipsUsed,
      skipsRemaining: Math.max(0, ladder.maxSkips - ladder.skipsUsed),
      maxSkips: ladder.maxSkips,
      canHalfCashout:
        ladder.streak >= HALF_CASHOUT_MIN_STREAK && ladder.pot >= HALF_CASHOUT_MIN_POT,
      halfCashoutPreview:
        ladder.streak >= HALF_CASHOUT_MIN_STREAK && ladder.pot >= HALF_CASHOUT_MIN_POT
          ? Math.floor(ladder.pot / 2)
          : 0,
      currentCard: ladder.currentCard,
      cardTrail: ladder.cardTrail.slice(-CARD_TRAIL_LIMIT),
      odds: ladder.odds,
      shoeRemaining: Array.isArray(ladder.shoe) ? ladder.shoe.length : 0,
      shoeSize: 52
    };
  }

  /**
   * Starts a new Solo Ladder for the given player.
   * @param {string} playerId
   * @param {number} rawBet
   * @returns {Object}
   */
  startLadder(playerId, rawBet) {
    const player = this._ensurePlayer(playerId);
    if (!player) {
      return { ok: false, code: 'PLAYER_NOT_FOUND', message: 'Speler sessie niet gevonden. Log opnieuw in.' };
    }
    if (this.soloLadders.has(playerId)) {
      return {
        ok: false,
        code: 'LADDER_ALREADY_ACTIVE',
        message: 'Je hebt al een actieve Hi-Lo reeks openstaan.'
      };
    }

    const bet = Math.floor(Number(rawBet));
    if (!Number.isFinite(bet) || bet < MIN_BET || bet > MAX_BET) {
      return {
        ok: false,
        code: 'INVALID_BET',
        message: `Inzet moet tussen ${MIN_BET} en ${MAX_BET.toLocaleString()} fiches liggen.`
      };
    }

    const deduct = this.playerManager.deductChips(playerId, bet);
    if (!deduct || !deduct.success) {
      return {
        ok: false,
        code: 'INSUFFICIENT_CHIPS',
        message: 'Onvoldoende fiches voor deze inzet.'
      };
    }

    let shoe = this.soloShoes.get(playerId);
    let reshuffled = false;
    if (!Array.isArray(shoe) || shoe.length < MIN_SHOE_CARDS) {
      shoe = createShuffledDeck();
      reshuffled = true;
    }

    const currentCard = drawCard(shoe);
    const ensured = this._ensurePlayableEdgeShoe(shoe, currentCard);
    shoe = ensured.shoe;
    const odds = ensured.odds;
    if (ensured.edgeReshuffled) reshuffled = true;
    this.soloShoes.set(playerId, shoe);

    const ladder = {
      id: `hl_${++this._ladderSeq}`,
      playerId,
      status: 'ACTIVE',
      initialBet: bet,
      pot: bet,
      unrecoveredCost: bet,
      halfCashedOutTotal: 0,
      streak: 0,
      skipsUsed: 0,
      maxSkips: MAX_SKIPS_PER_LADDER,
      shoe,
      currentCard,
      cardTrail: [{ ...currentCard }],
      odds,
      startedAt: Date.now()
    };

    this.soloLadders.set(playerId, ladder);
    this._ensureSalonMember(player);
    this.emit('salon_update', { trigger: 'solo_start', playerId });

    return {
      ok: true,
      ladder: this._serializeLadder(ladder),
      newChips: player.chips,
      reshuffled
    };
  }

  /**
   * Resolves a Solo Ladder card guess ('HIGHER', 'EQUAL', 'LOWER').
   * @param {string} playerId
   * @param {string} rawPrediction
   * @returns {Object}
   */
  makeGuess(playerId, rawPrediction) {
    const player = this._ensurePlayer(playerId);
    if (!player) {
      return { ok: false, code: 'PLAYER_NOT_FOUND', message: 'Speler sessie niet gevonden.' };
    }
    const ladder = this.soloLadders.get(playerId);
    if (!ladder || ladder.status !== 'ACTIVE') {
      return { ok: false, code: 'NO_ACTIVE_LADDER', message: 'Start eerst een Hi-Lo ronde.' };
    }

    const prediction = normalizePrediction(rawPrediction);
    if (!prediction) {
      return {
        ok: false,
        code: 'INVALID_PREDICTION',
        message: 'Ongeldige keuze. Kies Hoger, Gelijk of Lager.'
      };
    }

    const dirKey = prediction.toLowerCase();
    const dirOdds = ladder.odds && ladder.odds[dirKey];
    if (!dirOdds || !dirOdds.available || dirOdds.multiplier <= 0) {
      return {
        ok: false,
        code: 'OPTION_UNAVAILABLE',
        message: `Optie ${prediction} is bij deze kaart niet beschikbaar.`
      };
    }

    let reshuffledBeforeDraw = false;
    if (!Array.isArray(ladder.shoe) || ladder.shoe.length === 0) {
      ladder.shoe = createShuffledDeck(ladder.currentCard);
      reshuffledBeforeDraw = true;
    }

    const previousCard = ladder.currentCard;
    const nextCard = drawCard(ladder.shoe);
    const won = evaluateGuess(previousCard, nextCard, prediction);
    const slowMo =
      ladder.streak >= SLOW_MO_STREAK_THRESHOLD || prediction === PREDICTIONS.EQUAL;

    if (won) {
      const previousPot = ladder.pot;
      const newPot = Math.min(
        MAX_LADDER_POT,
        Math.max(1, Math.floor(ladder.pot * dirOdds.multiplier))
      );
      ladder.pot = newPot;
      ladder.streak += 1;
      ladder.currentCard = nextCard;
      ladder.cardTrail.push({ ...nextCard });

      let reshuffled = reshuffledBeforeDraw;
      if (ladder.shoe.length < MIN_SHOE_CARDS) {
        ladder.shoe = createShuffledDeck(nextCard);
        reshuffled = true;
      }
      const ensured = this._ensurePlayableEdgeShoe(ladder.shoe, ladder.currentCard);
      ladder.shoe = ensured.shoe;
      ladder.odds = ensured.odds;
      if (ensured.edgeReshuffled) reshuffled = true;
      this.soloShoes.set(playerId, ladder.shoe);

      this.emit('salon_update', { trigger: 'solo_win', playerId, streak: ladder.streak });
      if (ladder.streak >= 5 || (prediction === PREDICTIONS.EQUAL && dirOdds.multiplier >= 10)) {
        this.emit('big_moment', {
          playerId,
          playerName: player.name,
          type: prediction === PREDICTIONS.EQUAL ? 'EQUAL_HIT' : 'STREAK_MILESTONE',
          streak: ladder.streak,
          multiplier: dirOdds.multiplier,
          pot: ladder.pot
        });
      }

      return {
        ok: true,
        won: true,
        prediction,
        previousCard,
        nextCard,
        multiplier: dirOdds.multiplier,
        previousPot,
        newPot,
        streak: ladder.streak,
        tier: getStreakTier(ladder.streak),
        slowMo,
        reshuffled,
        ladder: this._serializeLadder(ladder),
        newChips: player.chips
      };
    }

    // Lost guess -> ladder ends immediately
    const lostPot = ladder.pot;
    const halfCashedOutTotal = ladder.halfCashedOutTotal;
    const initialBet = ladder.initialBet;
    const maxStreak = ladder.streak;
    const netProfit = halfCashedOutTotal - initialBet;

    let reshuffled = reshuffledBeforeDraw;
    if (ladder.shoe.length < MIN_SHOE_CARDS) {
      ladder.shoe = createShuffledDeck();
      reshuffled = true;
    }
    this.soloShoes.set(playerId, ladder.shoe);
    this.soloLadders.delete(playerId);

    this.playerManager.updatePlayerStats(playerId, { wonAmount: halfCashedOutTotal });
    const historyEntry = {
      mode: 'SOLO',
      initialBet,
      payout: halfCashedOutTotal,
      netProfit,
      maxStreak,
      outcome: 'BUST',
      previousCard,
      bustCard: nextCard,
      prediction,
      timestamp: Date.now()
    };
    this._recordPersonalHistory(playerId, historyEntry);
    this._maybeRecordRecentWin(player, {
      mode: 'SOLO',
      initialBet,
      payout: halfCashedOutTotal,
      netProfit,
      maxStreak
    });

    this.emit('salon_update', { trigger: 'solo_bust', playerId });

    return {
      ok: true,
      won: false,
      prediction,
      previousCard,
      nextCard,
      multiplier: dirOdds.multiplier,
      lostPot,
      halfCashedOutTotal,
      initialBet,
      netProfit,
      streak: maxStreak,
      slowMo,
      reshuffled,
      ladder: null,
      newChips: player.chips,
      historyEntry
    };
  }

  /**
   * Consumes 1 free card swap (up to 2 per Solo Ladder) without changing pot or streak.
   * @param {string} playerId
   * @returns {Object}
   */
  skipCard(playerId) {
    const player = this._ensurePlayer(playerId);
    if (!player) {
      return { ok: false, code: 'PLAYER_NOT_FOUND', message: 'Speler sessie niet gevonden.' };
    }
    const ladder = this.soloLadders.get(playerId);
    if (!ladder || ladder.status !== 'ACTIVE') {
      return { ok: false, code: 'NO_ACTIVE_LADDER', message: 'Geen actieve Hi-Lo reeks.' };
    }
    if (ladder.skipsUsed >= ladder.maxSkips) {
      return {
        ok: false,
        code: 'NO_SKIPS_LEFT',
        message: 'Je hebt beide gratis kaartwissels in deze reeks al gebruikt.'
      };
    }

    let reshuffled = false;
    if (!Array.isArray(ladder.shoe) || ladder.shoe.length === 0) {
      ladder.shoe = createShuffledDeck(ladder.currentCard);
      reshuffled = true;
    }

    const previousCard = ladder.currentCard;
    const nextCard = drawCard(ladder.shoe);
    ladder.skipsUsed += 1;
    ladder.currentCard = nextCard;
    ladder.cardTrail.push({ ...nextCard, fromSkip: true });

    if (ladder.shoe.length < MIN_SHOE_CARDS) {
      ladder.shoe = createShuffledDeck(nextCard);
      reshuffled = true;
    }
    const ensured = this._ensurePlayableEdgeShoe(ladder.shoe, ladder.currentCard);
    ladder.shoe = ensured.shoe;
    ladder.odds = ensured.odds;
    if (ensured.edgeReshuffled) reshuffled = true;
    this.soloShoes.set(playerId, ladder.shoe);

    this.emit('salon_update', { trigger: 'solo_skip', playerId });

    return {
      ok: true,
      previousCard,
      nextCard,
      skipsRemaining: Math.max(0, ladder.maxSkips - ladder.skipsUsed),
      reshuffled,
      ladder: this._serializeLadder(ladder)
    };
  }

  /**
   * Banks 50% of the active Solo Ladder pot immediately while preserving streak.
   * Requires streak >= 2 and pot >= 20.
   * @param {string} playerId
   * @returns {Object}
   */
  halfCashout(playerId) {
    const player = this._ensurePlayer(playerId);
    if (!player) {
      return { ok: false, code: 'PLAYER_NOT_FOUND', message: 'Speler sessie niet gevonden.' };
    }
    const ladder = this.soloLadders.get(playerId);
    if (!ladder || ladder.status !== 'ACTIVE') {
      return { ok: false, code: 'NO_ACTIVE_LADDER', message: 'Geen actieve Hi-Lo reeks.' };
    }
    if (ladder.streak < HALF_CASHOUT_MIN_STREAK) {
      return {
        ok: false,
        code: 'HALF_CASHOUT_STREAK_TOO_LOW',
        message: `50% Verzekeren is beschikbaar vanaf reeks ${HALF_CASHOUT_MIN_STREAK}.`
      };
    }
    if (ladder.pot < HALF_CASHOUT_MIN_POT) {
      return {
        ok: false,
        code: 'HALF_CASHOUT_POT_TOO_LOW',
        message: `Pot moet minimaal ${HALF_CASHOUT_MIN_POT} fiches zijn voor 50% verzekeren.`
      };
    }

    const payout = Math.floor(ladder.pot / 2);
    ladder.pot -= payout;
    ladder.halfCashedOutTotal += payout;

    const recoveredNow = Math.min(ladder.unrecoveredCost, payout);
    const realizedProfit = payout - recoveredNow;
    ladder.unrecoveredCost -= recoveredNow;

    const { newChips, repayments } = this._settlePayout(playerId, payout, realizedProfit);
    this.emit('salon_update', { trigger: 'solo_half_cashout', playerId });

    return {
      ok: true,
      payout,
      remainingPot: ladder.pot,
      halfCashedOutTotal: ladder.halfCashedOutTotal,
      realizedProfit,
      newChips,
      repayments,
      ladder: this._serializeLadder(ladder)
    };
  }

  /**
   * Cashes out the full remaining pot of an active Solo Ladder (at streak 0 refunds initialBet).
   * @param {string} playerId
   * @returns {Object}
   */
  cashout(playerId) {
    const player = this._ensurePlayer(playerId);
    if (!player) {
      return { ok: false, code: 'PLAYER_NOT_FOUND', message: 'Speler sessie niet gevonden.' };
    }
    const ladder = this.soloLadders.get(playerId);
    if (!ladder || ladder.status !== 'ACTIVE') {
      return { ok: false, code: 'NO_ACTIVE_LADDER', message: 'Geen actieve Hi-Lo reeks om uit te betalen.' };
    }

    const payout = ladder.pot;
    const totalPayout = ladder.halfCashedOutTotal + payout;
    const netProfit = totalPayout - ladder.initialBet;
    const recoveredNow = Math.min(ladder.unrecoveredCost, payout);
    const realizedProfit = Math.max(0, payout - recoveredNow);
    ladder.unrecoveredCost -= recoveredNow;

    const { newChips, repayments } = this._settlePayout(playerId, payout, realizedProfit);
    this.playerManager.updatePlayerStats(playerId, { wonAmount: totalPayout });

    const historyEntry = {
      mode: 'SOLO',
      initialBet: ladder.initialBet,
      payout: totalPayout,
      netProfit,
      maxStreak: ladder.streak,
      outcome: ladder.streak === 0 ? 'REFUND' : 'CASHOUT',
      lastCard: ladder.currentCard,
      timestamp: Date.now()
    };
    this._recordPersonalHistory(playerId, historyEntry);
    this._maybeRecordRecentWin(player, {
      mode: 'SOLO',
      initialBet: ladder.initialBet,
      payout: totalPayout,
      netProfit,
      maxStreak: ladder.streak
    });

    this.soloLadders.delete(playerId);
    this.emit('salon_update', { trigger: 'solo_cashout', playerId });

    if (ladder.streak >= 3 && netProfit >= BIG_WIN_MIN_NET_PROFIT) {
      this.emit('big_moment', {
        playerId,
        playerName: player.name,
        type: 'CASHOUT',
        streak: ladder.streak,
        payout: totalPayout,
        netProfit
      });
    }

    return {
      ok: true,
      payout,
      totalPayout,
      initialBet: ladder.initialBet,
      netProfit,
      streak: ladder.streak,
      newChips,
      repayments,
      historyEntry,
      ladder: null
    };
  }

  /**
   * Sends a cosmetic hype cheer from one Salon player to another (1.5s pair cooldown).
   * @param {string} fromPlayerId
   * @param {string} targetPlayerId
   * @returns {Object}
   */
  cheerPlayer(fromPlayerId, targetPlayerId) {
    const sender = this._ensurePlayer(fromPlayerId);
    if (!sender) {
      return { ok: false, code: 'PLAYER_NOT_FOUND', message: 'Speler sessie niet gevonden.' };
    }
    const target = this._ensurePlayer(targetPlayerId);
    if (!target) {
      return { ok: false, code: 'TARGET_NOT_FOUND', message: 'Doelspeler niet gevonden.' };
    }
    if (fromPlayerId === targetPlayerId) {
      return { ok: false, code: 'CANNOT_CHEER_SELF', message: 'Je kunt anderen aanmoedigen, niet jezelf.' };
    }

    const now = Date.now();
    const key = `${fromPlayerId}:${targetPlayerId}`;
    const lastCheer = this.cheerCooldowns.get(key) || 0;
    if (now - lastCheer < CHEER_COOLDOWN_MS) {
      return {
        ok: false,
        code: 'CHEER_COOLDOWN',
        message: 'Even geduld voordat je opnieuw juicht voor deze speler.'
      };
    }

    this.cheerCooldowns.set(key, now);
    const targetMember = this._ensureSalonMember(target);
    targetMember.cheers += 1;

    const payload = {
      fromId: sender.id,
      fromName: sender.name,
      targetId: target.id,
      targetName: target.name,
      targetCheers: targetMember.cheers,
      timestamp: now
    };
    this.emit('player_cheered', payload);
    this.emit('salon_update', { trigger: 'cheer', targetId: target.id });

    return { ok: true, ...payload };
  }

  // ==================== MULTIPLAYER BLITZ (SMART CLOCK) ====================

  /** @private */
  _getAliveBlitzEntries() {
    const alive = [];
    for (const entry of this.blitz.entries.values()) {
      if (entry.status === 'ALIVE') alive.push(entry);
    }
    return alive;
  }

  /** @private */
  _serializeBlitzState(viewerPlayerId = null) {
    const alive = this._getAliveBlitzEntries();
    let higherVotes = 0;
    let equalVotes = 0;
    let lowerVotes = 0;
    let pickedCount = 0;

    for (const e of alive) {
      if (e.choice === PREDICTIONS.HIGHER) {
        higherVotes++;
        pickedCount++;
      } else if (e.choice === PREDICTIONS.EQUAL) {
        equalVotes++;
        pickedCount++;
      } else if (e.choice === PREDICTIONS.LOWER) {
        lowerVotes++;
        pickedCount++;
      }
    }

    const participants = Array.from(this.blitz.entries.values()).map((e) => ({
      playerId: e.playerId,
      name: e.name,
      initials: e.initials,
      avatarColor: e.avatarColor,
      initialBet: e.initialBet,
      pot: e.pot,
      streak: e.streak,
      status: e.status,
      hasChoice: Boolean(e.choice)
    }));

    const viewerEntry = viewerPlayerId ? this.blitz.entries.get(viewerPlayerId) : null;

    return {
      roundId: this.blitz.roundId,
      phase: this.blitz.phase,
      timerSeconds: this.blitz.timerSeconds,
      cardIndex: this.blitz.cardIndex,
      maxCards: BLITZ_MAX_CARDS,
      currentCard: this.blitz.currentCard,
      cardTrail: this.blitz.cardTrail.slice(-CARD_TRAIL_LIMIT),
      odds: this.blitz.odds,
      shoeRemaining: this.blitz.shoe.length,
      aliveCount: alive.length,
      totalEntries: this.blitz.entries.size,
      crowdVotes: {
        pickedCount,
        aliveCount: alive.length,
        higher: pickedCount > 0 ? Math.round((higherVotes / pickedCount) * 100) : 0,
        equal: pickedCount > 0 ? Math.round((equalVotes / pickedCount) * 100) : 0,
        lower: pickedCount > 0 ? Math.round((lowerVotes / pickedCount) * 100) : 0
      },
      participants,
      viewerEntry: viewerEntry
        ? {
            playerId: viewerEntry.playerId,
            initialBet: viewerEntry.initialBet,
            pot: viewerEntry.pot,
            streak: viewerEntry.streak,
            status: viewerEntry.status,
            choice: viewerEntry.choice
          }
        : null,
      lastResult: this.blitz.lastResult
    };
  }

  /**
   * Player buys into the upcoming Multiplayer Blitz round.
   * Starts the 8s BETTING clock immediately when transitioning from WAITING_FOR_PLAYERS.
   * @param {string} playerId
   * @param {number} rawBet
   * @returns {Object}
   */
  blitzJoin(playerId, rawBet) {
    const player = this._ensurePlayer(playerId);
    if (!player) {
      return { ok: false, code: 'PLAYER_NOT_FOUND', message: 'Speler sessie niet gevonden.' };
    }
    if (
      this.blitz.phase !== BLITZ_PHASES.WAITING_FOR_PLAYERS &&
      this.blitz.phase !== BLITZ_PHASES.BETTING
    ) {
      return {
        ok: false,
        code: 'BLITZ_BETTING_CLOSED',
        message: 'Huidige Blitz ronde is al bezig. Wacht op de volgende ronde.'
      };
    }
    if (this.blitz.entries.has(playerId)) {
      return {
        ok: false,
        code: 'BLITZ_ALREADY_JOINED',
        message: 'Je doet al mee aan deze Blitz ronde.'
      };
    }

    const bet = Math.floor(Number(rawBet));
    if (!Number.isFinite(bet) || bet < MIN_BET || bet > MAX_BET) {
      return {
        ok: false,
        code: 'INVALID_BET',
        message: `Blitz inzet moet tussen ${MIN_BET} en ${MAX_BET.toLocaleString()} fiches liggen.`
      };
    }

    const deduct = this.playerManager.deductChips(playerId, bet);
    if (!deduct || !deduct.success) {
      return { ok: false, code: 'INSUFFICIENT_CHIPS', message: 'Onvoldoende fiches voor Blitz.' };
    }

    this._ensureSalonMember(player);
    this.blitz.entries.set(playerId, {
      playerId,
      name: player.name,
      initials: player.initials || player.name.slice(0, 2).toUpperCase(),
      avatarColor: player.avatarColor || '#d4af37',
      initialBet: bet,
      pot: bet,
      unrecoveredCost: bet,
      streak: 0,
      choice: null,
      status: 'ALIVE',
      joinedAt: Date.now()
    });

    if (this.blitz.phase === BLITZ_PHASES.WAITING_FOR_PLAYERS) {
      this._startBlitzBettingPhase();
    } else {
      this.emit('blitz_update', this._serializeBlitzState());
      this.emit('salon_update', { trigger: 'blitz_join', playerId });
    }

    return {
      ok: true,
      newChips: player.chips,
      blitz: this._serializeBlitzState(playerId)
    };
  }

  /**
   * Cancels a player's Blitz entry before the first card deals (BETTING phase only).
   * @param {string} playerId
   * @returns {Object}
   */
  blitzCancel(playerId) {
    const player = this._ensurePlayer(playerId);
    if (!player) {
      return { ok: false, code: 'PLAYER_NOT_FOUND', message: 'Speler sessie niet gevonden.' };
    }
    if (this.blitz.phase !== BLITZ_PHASES.BETTING) {
      return {
        ok: false,
        code: 'BLITZ_CANCEL_LOCKED',
        message: 'Annuleren is alleen mogelijk tijdens de inschrijffase.'
      };
    }
    const entry = this.blitz.entries.get(playerId);
    if (!entry) {
      return { ok: false, code: 'NO_BLITZ_ENTRY', message: 'Geen actieve Blitz inzet gevonden.' };
    }

    this.blitz.entries.delete(playerId);
    this.playerManager.addChips(playerId, entry.initialBet);

    if (this.blitz.entries.size === 0) {
      this._resetBlitzToWaiting();
    } else {
      this.emit('blitz_update', this._serializeBlitzState());
      this.emit('salon_update', { trigger: 'blitz_cancel', playerId });
    }

    return {
      ok: true,
      refunded: entry.initialBet,
      newChips: player.chips,
      blitz: this._serializeBlitzState(playerId)
    };
  }

  /**
   * Submits a survivor's decision ('HIGHER', 'EQUAL', 'LOWER', or 'CASHOUT') during DECISION.
   * Triggers Smart Clock early lock when all surviving players have picked.
   * @param {string} playerId
   * @param {string} rawAction
   * @returns {Object}
   */
  blitzAction(playerId, rawAction) {
    const player = this._ensurePlayer(playerId);
    if (!player) {
      return { ok: false, code: 'PLAYER_NOT_FOUND', message: 'Speler sessie niet gevonden.' };
    }
    if (this.blitz.phase !== BLITZ_PHASES.DECISION) {
      return {
        ok: false,
        code: 'BLITZ_NOT_DECISION',
        message: 'Keuze insturen kan alleen tijdens de beslissingsklok.'
      };
    }
    const entry = this.blitz.entries.get(playerId);
    if (!entry || entry.status !== 'ALIVE') {
      return {
        ok: false,
        code: 'NOT_ACTIVE_SURVIVOR',
        message: 'Je bent niet langer actief in deze Blitz ronde.'
      };
    }

    const upper = typeof rawAction === 'string' ? rawAction.trim().toUpperCase() : '';
    if (upper === 'CASHOUT' || upper === 'UITBETALEN') {
      if (entry.streak < 1 && this.blitz.cardIndex <= 1) {
        return {
          ok: false,
          code: 'BLITZ_CASHOUT_MIN_ONE_FLIP',
          message: 'Speel minimaal 1 kaart in Blitz voordat je kunt uitcashen.'
        };
      }
      const settleInfo = this._settleBlitzSurvivor(entry, 'CASHED_OUT');
      this.emit('blitz_settlement', settleInfo);
      this.emit('blitz_update', this._serializeBlitzState());
      this.emit('salon_update', { trigger: 'blitz_cashout', playerId });

      this._checkBlitzEarlyAdvance();
      return {
        ok: true,
        action: 'CASHOUT',
        settlement: settleInfo,
        newChips: settleInfo.newChips,
        blitz: this._serializeBlitzState(playerId)
      };
    }

    const prediction = normalizePrediction(rawAction);
    if (!prediction) {
      return {
        ok: false,
        code: 'INVALID_PREDICTION',
        message: 'Ongeldige Blitz keuze.'
      };
    }
    const dirOdds = this.blitz.odds && this.blitz.odds[prediction.toLowerCase()];
    if (!dirOdds || !dirOdds.available || dirOdds.multiplier <= 0) {
      return {
        ok: false,
        code: 'OPTION_UNAVAILABLE',
        message: `Optie ${prediction} is bij deze kaart niet beschikbaar.`
      };
    }

    entry.choice = prediction;
    this.emit('blitz_update', this._serializeBlitzState());
    this._checkBlitzEarlyAdvance();

    return {
      ok: true,
      action: prediction,
      blitz: this._serializeBlitzState(playerId)
    };
  }

  /** @private */
  _settleBlitzSurvivor(entry, outcomeStatus) {
    entry.status = outcomeStatus;
    entry.choice = null;
    const payout = entry.pot;
    const netProfit = payout - entry.initialBet;
    const recoveredNow = Math.min(entry.unrecoveredCost, payout);
    const realizedProfit = Math.max(0, payout - recoveredNow);
    entry.unrecoveredCost -= recoveredNow;

    const { newChips, repayments } = this._settlePayout(entry.playerId, payout, realizedProfit);
    this.playerManager.updatePlayerStats(entry.playerId, { wonAmount: payout });

    const player = this._ensurePlayer(entry.playerId);
    const historyEntry = {
      mode: 'BLITZ',
      initialBet: entry.initialBet,
      payout,
      netProfit,
      maxStreak: entry.streak,
      outcome: outcomeStatus,
      timestamp: Date.now()
    };
    this._recordPersonalHistory(entry.playerId, historyEntry);
    if (player) {
      this._maybeRecordRecentWin(player, {
        mode: 'BLITZ',
        initialBet: entry.initialBet,
        payout,
        netProfit,
        maxStreak: entry.streak
      });
    }

    return {
      roundId: this.blitz.roundId,
      playerId: entry.playerId,
      playerName: entry.name,
      initialBet: entry.initialBet,
      payout,
      netProfit,
      streak: entry.streak,
      outcome: outcomeStatus,
      newChips,
      repayments
    };
  }

  /** @private */
  _startBlitzBettingPhase() {
    this._clearBlitzTimers();
    this.blitz.roundId += 1;
    this.blitz.phase = BLITZ_PHASES.BETTING;
    this.blitz.timerSeconds = Math.max(1, this.durations.ENTRY_SEC);
    this.blitz.cardIndex = 0;
    this.blitz.currentCard = null;
    this.blitz.cardTrail = [];
    this.blitz.odds = null;
    this.blitz.lastResult = null;

    this.emit('blitz_phase_change', this._serializeBlitzState());
    this.emit('salon_update', { trigger: 'blitz_betting' });

    this._blitzInterval = setInterval(() => {
      if (this._stopped || this.blitz.phase !== BLITZ_PHASES.BETTING) return;
      this.blitz.timerSeconds = Math.max(0, this.blitz.timerSeconds - 1);
      this.emit('blitz_tick', {
        roundId: this.blitz.roundId,
        phase: this.blitz.phase,
        timerSeconds: this.blitz.timerSeconds
      });
      if (this.blitz.timerSeconds <= 0) {
        this._clearBlitzTimers();
        if (this.blitz.entries.size === 0) {
          this._resetBlitzToWaiting();
        } else {
          this._beginBlitzFirstCard();
        }
      }
    }, 1000);
  }

  /** @private */
  _beginBlitzFirstCard() {
    if (this._stopped) return;
    let reshuffled = false;
    if (!Array.isArray(this.blitz.shoe) || this.blitz.shoe.length < MIN_SHOE_CARDS) {
      this.blitz.shoe = createShuffledDeck();
      reshuffled = true;
    }
    const firstCard = drawCard(this.blitz.shoe);
    const ensured = this._ensurePlayableEdgeShoe(this.blitz.shoe, firstCard);
    this.blitz.shoe = ensured.shoe;
    if (ensured.edgeReshuffled) reshuffled = true;
    this.blitz.cardIndex = 1;
    this.blitz.currentCard = firstCard;
    this.blitz.cardTrail = [{ ...firstCard }];
    this.blitz.odds = ensured.odds;
    this.blitz.reshuffled = reshuffled;

    this._startBlitzDecisionPhase();
  }

  /** @private */
  _startBlitzDecisionPhase() {
    if (this._stopped) return;
    this._clearBlitzTimers();
    this.blitz.phase = BLITZ_PHASES.DECISION;
    this.blitz.timerSeconds = Math.max(1, this.durations.DECISION_SEC);

    for (const entry of this.blitz.entries.values()) {
      if (entry.status === 'ALIVE') entry.choice = null;
    }

    this.emit('blitz_phase_change', this._serializeBlitzState());

    this._blitzInterval = setInterval(() => {
      if (this._stopped || this.blitz.phase !== BLITZ_PHASES.DECISION) return;
      this.blitz.timerSeconds = Math.max(0, this.blitz.timerSeconds - 1);
      this.emit('blitz_tick', {
        roundId: this.blitz.roundId,
        phase: this.blitz.phase,
        timerSeconds: this.blitz.timerSeconds
      });
      if (this.blitz.timerSeconds <= 0) {
        this._clearBlitzTimers();
        this._resolveBlitzFlip();
      }
    }, 1000);
  }

  /** @private */
  _checkBlitzEarlyAdvance() {
    if (this.blitz.phase !== BLITZ_PHASES.DECISION) return;
    const alive = this._getAliveBlitzEntries();
    if (alive.length === 0) {
      this._clearBlitzTimers();
      this._finishBlitzRound();
      return;
    }
    if (alive.every((e) => e.choice !== null) && this.blitz.timerSeconds > this.durations.EARLY_LOCK_SEC) {
      this.blitz.timerSeconds = this.durations.EARLY_LOCK_SEC;
      this.emit('blitz_tick', {
        roundId: this.blitz.roundId,
        phase: this.blitz.phase,
        timerSeconds: this.blitz.timerSeconds,
        earlyLocked: true
      });
    }
  }

  /** @private */
  _resolveBlitzFlip() {
    if (this._stopped) return;
    this._clearBlitzTimers();

    // Auto-handle undecided survivors cleanly before flip
    const aliveBeforeTimeout = this._getAliveBlitzEntries();
    const earlySettlements = [];
    for (const entry of aliveBeforeTimeout) {
      if (!entry.choice) {
        if (entry.streak >= 1) {
          // Protect streak earnings on AFK survivor
          earlySettlements.push(this._settleBlitzSurvivor(entry, 'CASHED_OUT'));
        } else {
          // Card 1: auto-assign safest available Higher/Lower direction
          const hOdds = this.blitz.odds.higher;
          const lOdds = this.blitz.odds.lower;
          if (hOdds.available && (!lOdds.available || hOdds.probability >= lOdds.probability)) {
            entry.choice = PREDICTIONS.HIGHER;
          } else if (lOdds.available) {
            entry.choice = PREDICTIONS.LOWER;
          } else if (this.blitz.odds.equal.available) {
            entry.choice = PREDICTIONS.EQUAL;
          } else {
            earlySettlements.push(this._settleBlitzSurvivor(entry, 'REFUND'));
          }
        }
      }
    }
    for (const s of earlySettlements) {
      this.emit('blitz_settlement', s);
    }

    const remainingAlive = this._getAliveBlitzEntries();
    if (remainingAlive.length === 0) {
      this._finishBlitzRound();
      return;
    }

    this.blitz.phase = BLITZ_PHASES.REVEALING;
    this.blitz.timerSeconds = Math.ceil(this.durations.REVEAL_MS / 1000);

    let reshuffled = false;
    if (!Array.isArray(this.blitz.shoe) || this.blitz.shoe.length === 0) {
      this.blitz.shoe = createShuffledDeck(this.blitz.currentCard);
      reshuffled = true;
    }

    const previousCard = this.blitz.currentCard;
    const nextCard = drawCard(this.blitz.shoe);
    const winners = [];
    const busted = [];

    for (const entry of remainingAlive) {
      const pred = entry.choice;
      const dirOdds = this.blitz.odds[pred.toLowerCase()];
      const mult = dirOdds ? dirOdds.multiplier : 0;
      const won = evaluateGuess(previousCard, nextCard, pred);
      if (won && mult > 0) {
        entry.streak += 1;
        entry.pot = Math.min(MAX_LADDER_POT, Math.max(1, Math.floor(entry.pot * mult)));
        entry.choice = null;
        winners.push({
          playerId: entry.playerId,
          playerName: entry.name,
          prediction: pred,
          multiplier: mult,
          newPot: entry.pot,
          streak: entry.streak
        });
      } else {
        entry.status = 'BUSTED';
        entry.choice = null;
        this.playerManager.updatePlayerStats(entry.playerId, { wonAmount: 0 });
        this._recordPersonalHistory(entry.playerId, {
          mode: 'BLITZ',
          initialBet: entry.initialBet,
          payout: 0,
          netProfit: -entry.initialBet,
          maxStreak: entry.streak,
          outcome: 'BUST',
          bustCard: nextCard,
          timestamp: Date.now()
        });
        busted.push({
          playerId: entry.playerId,
          playerName: entry.name,
          prediction: pred,
          lostPot: entry.pot,
          streak: entry.streak
        });
      }
    }

    if (this.blitz.shoe.length < MIN_SHOE_CARDS) {
      this.blitz.shoe = createShuffledDeck(nextCard);
      reshuffled = true;
    }

    const ensured = this._ensurePlayableEdgeShoe(this.blitz.shoe, nextCard);
    this.blitz.shoe = ensured.shoe;
    if (ensured.edgeReshuffled) reshuffled = true;

    const survivorsLeft = this._getAliveBlitzEntries().length;
    const isFinalCard = this.blitz.cardIndex >= BLITZ_MAX_CARDS;
    const slowMo = winners.some((w) => w.prediction === PREDICTIONS.EQUAL) || this.blitz.cardIndex >= 4;

    this.blitz.currentCard = nextCard;
    this.blitz.cardTrail.push({ ...nextCard });
    this.blitz.odds = ensured.odds;
    this.blitz.reshuffled = reshuffled;

    const revealPayload = {
      roundId: this.blitz.roundId,
      cardIndex: this.blitz.cardIndex,
      previousCard,
      nextCard,
      winners,
      busted,
      survivorCount: survivorsLeft,
      slowMo,
      reshuffled,
      blitz: this._serializeBlitzState()
    };
    this.blitz.lastResult = revealPayload;
    this.emit('blitz_reveal', revealPayload);

    this._blitzTimeout = setTimeout(() => {
      if (this._stopped) return;
      if (survivorsLeft === 0 || isFinalCard) {
        this._finishBlitzRound();
      } else {
        this.blitz.cardIndex += 1;
        this._startBlitzDecisionPhase();
      }
    }, this.durations.REVEAL_MS);
  }

  /** @private */
  _finishBlitzRound() {
    if (this._stopped) return;
    this._clearBlitzTimers();

    const finalSettlements = [];
    for (const entry of this._getAliveBlitzEntries()) {
      const s = this._settleBlitzSurvivor(entry, 'GRAND_CASHOUT');
      finalSettlements.push(s);
      this.emit('blitz_settlement', s);
    }

    this.blitz.phase = BLITZ_PHASES.SETTLED;
    this.blitz.timerSeconds = Math.ceil(this.durations.SETTLE_MS / 1000);
    this.emit('blitz_finished', {
      roundId: this.blitz.roundId,
      settlements: finalSettlements,
      blitz: this._serializeBlitzState()
    });
    this.emit('salon_update', { trigger: 'blitz_settled' });

    this._blitzTimeout = setTimeout(() => {
      if (this._stopped) return;
      this._resetBlitzToWaiting();
    }, this.durations.SETTLE_MS);
  }

  /** @private */
  _resetBlitzToWaiting() {
    this._clearBlitzTimers();
    this.blitz.phase = BLITZ_PHASES.WAITING_FOR_PLAYERS;
    this.blitz.timerSeconds = 0;
    this.blitz.cardIndex = 0;
    this.blitz.currentCard = null;
    this.blitz.cardTrail = [];
    this.blitz.odds = null;
    this.blitz.entries.clear();
    if (!Array.isArray(this.blitz.shoe) || this.blitz.shoe.length < MIN_SHOE_CARDS) {
      this.blitz.shoe = createShuffledDeck();
    }
    this.emit('blitz_phase_change', this._serializeBlitzState());
    this.emit('salon_update', { trigger: 'blitz_waiting' });
  }

  // ==================== SHARED CASINO HOOKS & STATE ====================

  /**
   * True if player has an unsettled Solo Ladder or an active Blitz stake.
   * @param {string} playerId
   * @returns {boolean}
   */
  hasActiveBets(playerId) {
    if (this.soloLadders.has(playerId)) return true;
    const blitzEntry = this.blitz.entries.get(playerId);
    if (
      blitzEntry &&
      blitzEntry.status === 'ALIVE' &&
      (this.blitz.phase === BLITZ_PHASES.BETTING ||
        this.blitz.phase === BLITZ_PHASES.DECISION ||
        this.blitz.phase === BLITZ_PHASES.REVEALING)
    ) {
      return true;
    }
    return false;
  }

  /**
   * Total chips currently at risk across Solo Ladder & Blitz.
   * @param {string} playerId
   * @returns {number}
   */
  getActiveBetTotal(playerId) {
    let total = 0;
    const ladder = this.soloLadders.get(playerId);
    if (ladder) total += ladder.pot;
    const blitzEntry = this.blitz.entries.get(playerId);
    if (blitzEntry && blitzEntry.status === 'ALIVE') total += blitzEntry.pot;
    return total;
  }

  /**
   * Returns synchronized public Hi-Lo Salon + viewer private state payload.
   * @param {string|null} [viewerPlayerId=null]
   * @returns {Object}
   */
  getPublicSalonState(viewerPlayerId = null) {
    const salonMap = new Map();

    for (const member of this.salonPlayers.values()) {
      const p = this._ensurePlayer(member.id);
      if (p && p.connected !== false) {
        salonMap.set(member.id, { ...member });
      } else if (this.hasActiveBets(member.id)) {
        salonMap.set(member.id, { ...member });
      }
    }

    if (this.playerManager && this.playerManager.players) {
      for (const p of this.playerManager.players.values()) {
        if (p.connected !== false && p.location === 'HILO' && !salonMap.has(p.id)) {
          salonMap.set(p.id, this._ensureSalonMember(p));
        }
      }
    }

    const players = [];
    for (const member of salonMap.values()) {
      const ladder = this.soloLadders.get(member.id);
      const blitzEntry = this.blitz.entries.get(member.id);
      const isBlitzActive = Boolean(blitzEntry && blitzEntry.status === 'ALIVE');
      players.push({
        id: member.id,
        name: member.name,
        initials: member.initials,
        avatarColor: member.avatarColor,
        cheers: member.cheers || 0,
        activeSolo: Boolean(ladder),
        activeBlitz: isBlitzActive,
        streak: ladder ? ladder.streak : isBlitzActive ? blitzEntry.streak : 0,
        pot: ladder ? ladder.pot : isBlitzActive ? blitzEntry.pot : 0,
        currentCard: ladder
          ? ladder.currentCard
          : isBlitzActive && this.blitz.currentCard
          ? this.blitz.currentCard
          : null,
        tier: getStreakTier(ladder ? ladder.streak : isBlitzActive ? blitzEntry.streak : 0)
      });
    }

    players.sort((a, b) => (b.streak - a.streak) || (b.pot - a.pot) || (b.cheers - a.cheers));

    const viewerLadder = viewerPlayerId ? this._serializeLadder(this.soloLadders.get(viewerPlayerId)) : null;
    const viewerHistory = viewerPlayerId ? (this.personalHistory.get(viewerPlayerId) || []).slice(0, HISTORY_LIMIT) : [];

    return {
      targetRtp: this.targetRtp,
      minBet: MIN_BET,
      maxBet: MAX_BET,
      maxSkips: MAX_SKIPS_PER_LADDER,
      halfCashoutMinStreak: HALF_CASHOUT_MIN_STREAK,
      players,
      recentWins: this.recentWins.slice(0, RECENT_WINS_LIMIT),
      soloLadder: viewerLadder,
      personalHistory: viewerHistory,
      blitz: this._serializeBlitzState(viewerPlayerId)
    };
  }

  /**
   * Ensures edge ranks (2 -> HIGHER, A -> LOWER) never lock out mid-shoe when
   * all 3 other matching ranks were drawn earlier. Reshuffles a 51-card shoe
   * excluding currentCard so strict < 100% EV is kept while staying playable.
   * @private
   */
  _ensurePlayableEdgeShoe(shoe, currentCard) {
    let activeShoe = shoe;
    let edgeReshuffled = false;
    let odds = calculateHiloOdds(currentCard, activeShoe, this.targetRtp);
    if (
      (currentCard.value === 2 && !odds.higher.available) ||
      (currentCard.value === 14 && !odds.lower.available)
    ) {
      activeShoe = createShuffledDeck(currentCard);
      odds = calculateHiloOdds(currentCard, activeShoe, this.targetRtp);
      edgeReshuffled = true;
    }
    return { shoe: activeShoe, odds, edgeReshuffled };
  }
}

module.exports = HiloEngine;
