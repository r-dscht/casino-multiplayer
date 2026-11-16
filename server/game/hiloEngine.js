/**
 * @fileoverview Monte Carlo Hi-Lo Prive game engine (Solo Ladder).
 * Supports:
 *  - Solo Ladder: 52-card shoe (auto-reshuffle < 13 cards), strict Hi/Eq/Lo rules,
 *    dynamic 98% RTP (2% house edge) odds, max 2 free skips per ladder, 50% Half-Cashout (streak >= 2),
 *    slow-mo suspense triggers, personal ladder history & atomic bank loan repayment.
 *  - Live Zaal overview & global casino highlights.
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
  HISTORY_LIMIT,
  RECENT_WINS_LIMIT,
  BIG_WIN_MIN_NET_PROFIT,
  BIG_WIN_MIN_STREAK,
  PREDICTIONS,
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

    /** @type {Map<string, Object>} Active Solo Ladders by playerId */
    this.soloLadders = new Map();
    /** @type {Map<string, Array>} Persistent 52-card shoes per player */
    this.soloShoes = new Map();
    /** @type {Map<string, Object>} Players actively present in Hi-Lo Salon */
    this.salonPlayers = new Map();
    /** @type {Map<string, Array>} Personal completed run history by playerId */
    this.personalHistory = new Map();
    /** @type {Array<Object>} Recent big wins & streak cashouts across Hi-Lo */
    this.recentWins = [];

    this._ladderSeq = 0;
    this._stopped = false;
  }

  /**
   * Starts engine lifecycle.
   */
  start() {
    this._stopped = false;
  }

  /**
   * Stops engine lifecycle cleanly for shutdown or test teardown.
   */
  stop() {
    this._stopped = true;
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
   * Removes a player from Salon presence (only if not mid-ladder).
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

  // ==================== SHARED CASINO HOOKS & STATE ====================

  /**
   * True if player has an unsettled Solo Ladder.
   * @param {string} playerId
   * @returns {boolean}
   */
  hasActiveBets(playerId) {
    return this.soloLadders.has(playerId);
  }

  /**
   * Total chips currently at risk in active Solo Ladder.
   * @param {string} playerId
   * @returns {number}
   */
  getActiveBetTotal(playerId) {
    const ladder = this.soloLadders.get(playerId);
    return ladder ? ladder.pot : 0;
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
      players.push({
        id: member.id,
        name: member.name,
        initials: member.initials,
        avatarColor: member.avatarColor,
        activeSolo: Boolean(ladder),
        streak: ladder ? ladder.streak : 0,
        pot: ladder ? ladder.pot : 0,
        currentCard: ladder ? ladder.currentCard : null,
        tier: getStreakTier(ladder ? ladder.streak : 0)
      });
    }

    players.sort((a, b) => (b.streak - a.streak) || (b.pot - a.pot));

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
      personalHistory: viewerHistory
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
