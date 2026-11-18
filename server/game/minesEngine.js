/**
 * @fileoverview Royal Mines Vault game engine (Solo Vault + Shared Multiplayer Vault).
 *
 * Features:
 * - Solo Vault: selectable 4x4 / 5x5 / 6x6 / 7x7 grids, selectable mine counts (1..N-1),
 *   strict 98% RTP (2% house edge, zero +EV states), automatic Grand Clear on last gem,
 *   atomic bank loan repayment & personal history.
 * - Shared Vault (Live Multiplayer): Smart Timer (8s countdown starting on first bet),
 *   player board & bomb voting, turn-based clicking on ONE shared board with 10s turn clock,
 *   auto-random tile click on timeout (zero passive hiding), mandatory >= 1 own click before
 *   Cash Out, and shared bomb detonation while already-cashed winners keep payouts.
 */

const EventEmitter = require('events');
const {
  VALID_GRID_SIDES,
  GRID_CONFIGS,
  SHARED_BOMB_PRESETS,
  TARGET_RTP,
  MIN_BET,
  MAX_BET,
  MAX_PAYOUT,
  HISTORY_LIMIT,
  RECENT_WINS_LIMIT,
  BIG_WIN_MIN_NET_PROFIT,
  BIG_WIN_MIN_MULT,
  SHARED_PHASES,
  SHARED_DURATIONS,
  buildMultiplierTable,
  computeNextPickMeta,
  generateMinePositions,
  normalizeBoardSettings,
} = require('./minesConstants');

class MinesEngine extends EventEmitter {
  /**
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
    this.rng = typeof options.rng === 'function' ? options.rng : Math.random;
    this.targetRtp = typeof options.targetRtp === 'number' ? options.targetRtp : TARGET_RTP;

    this.durations = {
      ENTRY_SEC: Number.isFinite(options.entrySec) ? Math.max(1, options.entrySec) : SHARED_DURATIONS.ENTRY_SEC,
      TURN_SEC: Number.isFinite(options.turnSec) ? Math.max(1, options.turnSec) : SHARED_DURATIONS.TURN_SEC,
      REVEAL_MS: Number.isFinite(options.revealMs) ? Math.max(50, options.revealMs) : SHARED_DURATIONS.REVEAL_MS,
    };

    /** @type {Map<string, Object>} Active solo boards by playerId */
    this.soloGames = new Map();
    /** @type {Map<string, Object>} Players actively present in Mines Salon */
    this.salonPlayers = new Map();
    /** @type {Map<string, Array>} Personal run history by playerId */
    this.personalHistory = new Map();
    /** @type {Array<Object>} Recent big cashouts across Solo & Shared */
    this.recentWins = [];

    this._gameSeq = 0;
    this._sharedInterval = null;
    this._sharedTimeout = null;
    this._stopped = false;

    this.shared = this._createFreshSharedState(0);
  }

  /** @private */
  _createFreshSharedState(nextRoundId) {
    return {
      roundId: nextRoundId,
      phase: SHARED_PHASES.WAITING_FOR_PLAYERS,
      timerSeconds: 0,
      turnTimeLeft: 0,
      gridSide: 5,
      totalTiles: 25,
      mineCount: 5,
      participants: new Map(),
      votes: new Map(), // playerId -> { gridSide, mineCount, ts }
      turnOrder: [],
      turnIndex: 0,
      turnPlayerId: null,
      minesSet: new Set(),
      revealedMap: new Map(), // tileIndex -> public tile info
      revealedList: [],
      diamondsOpened: 0,
      currentMultiplier: 1.0,
      multiplierTable: buildMultiplierTable(25, 5, this.targetRtp),
      detonatedBy: null,
      allMinesReveal: null,
      lastActionNote: 'Wacht op spelers voor de Shared Vault.',
      lastResult: null,
    };
  }

  start() {
    this._stopped = false;
  }

  stop() {
    this._stopped = true;
    this._clearSharedTimers();
  }

  /** @private */
  _clearSharedTimers() {
    if (this._sharedInterval) {
      clearInterval(this._sharedInterval);
      this._sharedInterval = null;
    }
    if (this._sharedTimeout) {
      clearTimeout(this._sharedTimeout);
      this._sharedTimeout = null;
    }
  }

  /** @private */
  _ensurePlayer(playerId) {
    if (!this.playerManager || typeof this.playerManager.getPlayerById !== 'function') {
      return null;
    }
    return this.playerManager.getPlayerById(playerId) || null;
  }

  /** @private */
  _settlePayout(playerId, payout, realizedProfit) {
    if (payout <= 0) {
      const p = this._ensurePlayer(playerId);
      return { newChips: p ? p.chips : 0, repayments: [] };
    }
    this.playerManager.addChips(playerId, payout);
    let repayments = [];
    if (this.bankManager && typeof this.bankManager.processWinRepayment === 'function' && realizedProfit > 0) {
      const res = this.bankManager.processWinRepayment(playerId, realizedProfit);
      if (Array.isArray(res)) repayments = res;
    }
    const updated = this._ensurePlayer(playerId);
    if (updated && typeof this.playerManager._persistPlayer === 'function') {
      this.playerManager._persistPlayer(updated);
    }
    return { newChips: updated ? updated.chips : 0, repayments };
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
    const { mode, initialBet, payout, netProfit, multiplier, gridSide, mineCount, diamondsOpened } = details;
    if (netProfit <= 0) return;
    if (multiplier < BIG_WIN_MIN_MULT && netProfit < BIG_WIN_MIN_NET_PROFIT) return;

    this.recentWins.unshift({
      playerId: player.id,
      playerName: player.name,
      initials: player.initials || player.name.slice(0, 2).toUpperCase(),
      avatarColor: player.avatarColor || '#d4af37',
      mode,
      gridLabel: `${gridSide}x${gridSide}`,
      mineCount,
      diamondsOpened,
      initialBet,
      payout,
      netProfit,
      multiplier: Math.round(multiplier * 100) / 100,
      timestamp: Date.now(),
    });
    if (this.recentWins.length > RECENT_WINS_LIMIT) {
      this.recentWins.length = RECENT_WINS_LIMIT;
    }
  }

  /**
   * Registers presence in the Mines Salon.
   * @param {string} playerId
   */
  joinSalon(playerId) {
    const player = this._ensurePlayer(playerId);
    if (!player) return null;
    const prev = this.salonPlayers.get(playerId);
    this.salonPlayers.set(playerId, {
      playerId: player.id,
      name: player.name,
      initials: player.initials || player.name.slice(0, 2).toUpperCase(),
      avatarColor: player.avatarColor || '#d4af37',
      joinedAt: prev ? prev.joinedAt : Date.now(),
    });
    this.emit('salon_update', { trigger: 'join', playerId });
    return this.getPublicState(playerId);
  }

  /**
   * Removes presence from the Mines Salon.
   * @param {string} playerId
   */
  leaveSalon(playerId) {
    if (this.salonPlayers.delete(playerId)) {
      this.emit('salon_update', { trigger: 'leave', playerId });
      return true;
    }
    return false;
  }

  /**
   * Returns true if the player has an active Solo board OR an unresolved ALIVE / BETTING Shared stake.
   * @param {string} playerId
   * @returns {boolean}
   */
  hasActiveBets(playerId) {
    if (this.soloGames.has(playerId)) return true;
    const p = this.shared.participants.get(playerId);
    if (!p) return false;
    if (this.shared.phase === SHARED_PHASES.BETTING) return true;
    if (this.shared.phase === SHARED_PHASES.PLAYING && p.status === 'ALIVE') return true;
    return false;
  }

  /**
   * Returns active locked bet amount for navigation lock display.
   * @param {string} playerId
   * @returns {number}
   */
  getActiveBetTotal(playerId) {
    let total = 0;
    const solo = this.soloGames.get(playerId);
    if (solo && solo.status === 'ACTIVE') total += solo.betAmount;
    const sp = this.shared.participants.get(playerId);
    if (sp && (this.shared.phase === SHARED_PHASES.BETTING || (this.shared.phase === SHARED_PHASES.PLAYING && sp.status === 'ALIVE'))) {
      total += sp.betAmount;
    }
    return total;
  }

  // =========================================================================
  // SOLO VAULT
  // =========================================================================

  /** @private */
  _serializeSoloGame(game) {
    if (!game) return null;
    const safeTiles = game.totalTiles - game.mineCount;
    const nextMeta = computeNextPickMeta(game.totalTiles, game.mineCount, game.diamondsOpened, this.targetRtp);
    const currentPayout = game.diamondsOpened > 0
      ? Math.min(MAX_PAYOUT, Math.floor(game.betAmount * game.currentMultiplier))
      : 0;
    const nextPayout = Math.min(MAX_PAYOUT, Math.floor(game.betAmount * nextMeta.nextMultiplier));

    return {
      id: game.id,
      status: game.status,
      gridSide: game.gridSide,
      totalTiles: game.totalTiles,
      mineCount: game.mineCount,
      safeTiles,
      betAmount: game.betAmount,
      diamondsOpened: game.diamondsOpened,
      currentMultiplier: game.currentMultiplier,
      currentPayout,
      nextMultiplier: nextMeta.nextMultiplier,
      nextPayout,
      safeChancePct: nextMeta.safeChancePct,
      mineRiskPct: nextMeta.mineRiskPct,
      canCashout: game.status === 'ACTIVE' && game.diamondsOpened >= 1,
      revealedDiamonds: [...game.revealedDiamonds],
    };
  }

  /**
   * Starts a Solo Mines Vault board with custom gridSide (4..7) and mineCount (1..N-1).
   * @param {string} playerId
   * @param {{ betAmount: number, gridSide?: number, mineCount?: number }} payload
   */
  startSolo(playerId, payload = {}) {
    const player = this._ensurePlayer(playerId);
    if (!player) {
      return { ok: false, code: 'PLAYER_NOT_FOUND', message: 'Speler sessie niet gevonden. Log opnieuw in.' };
    }
    if (this.soloGames.has(playerId)) {
      return { ok: false, code: 'SOLO_ALREADY_ACTIVE', message: 'Je hebt al een Solo Kluis openstaan. Cash eerst uit of speel verder.' };
    }

    const sideInput = payload.gridSide !== undefined ? payload.gridSide : 5;
    const defaultM = GRID_CONFIGS[Number(sideInput)] ? GRID_CONFIGS[Number(sideInput)].defaultMines : 5;
    const mineInput = payload.mineCount !== undefined ? payload.mineCount : defaultM;

    const settingsCheck = normalizeBoardSettings(sideInput, mineInput);
    if (!settingsCheck.ok) {
      return { ok: false, code: 'INVALID_SETTINGS', message: settingsCheck.message };
    }

    const bet = Math.floor(Number(payload.betAmount));
    if (!Number.isFinite(bet) || bet < MIN_BET || bet > MAX_BET) {
      return {
        ok: false,
        code: 'INVALID_BET',
        message: `Inzet moet tussen ${MIN_BET} en ${MAX_BET.toLocaleString()} fiches liggen.`,
      };
    }

    const deduct = this.playerManager.deductChips(playerId, bet);
    if (!deduct || !deduct.success) {
      return { ok: false, code: 'INSUFFICIENT_CHIPS', message: 'Onvoldoende fiches voor deze inzet.' };
    }
    if (typeof this.playerManager._persistPlayer === 'function') {
      this.playerManager._persistPlayer(player);
    }

    this._gameSeq += 1;
    const { gridSide, totalTiles, mineCount } = settingsCheck;
    const minesSet = generateMinePositions(totalTiles, mineCount, this.rng);
    const multiplierTable = buildMultiplierTable(totalTiles, mineCount, this.targetRtp);

    const game = {
      id: `mines_solo_${this._gameSeq}`,
      playerId,
      status: 'ACTIVE',
      gridSide,
      totalTiles,
      mineCount,
      betAmount: bet,
      minesSet,
      revealedSet: new Set(),
      revealedDiamonds: [],
      diamondsOpened: 0,
      currentMultiplier: 1.0,
      multiplierTable,
      startedAt: Date.now(),
    };

    this.soloGames.set(playerId, game);
    this.emit('salon_update', { trigger: 'solo_start', playerId });

    return {
      ok: true,
      solo: this._serializeSoloGame(game),
      newChips: player.chips,
    };
  }

  /**
   * Opens one tile in the player's Solo Mines Vault board.
   * Automatically executes Grand Clear Cashout if the last safe diamond is opened.
   * @param {string} playerId
   * @param {number} rawTileIndex
   */
  clickSoloTile(playerId, rawTileIndex) {
    const player = this._ensurePlayer(playerId);
    if (!player) {
      return { ok: false, code: 'PLAYER_NOT_FOUND', message: 'Speler sessie niet gevonden.' };
    }
    const game = this.soloGames.get(playerId);
    if (!game || game.status !== 'ACTIVE') {
      return { ok: false, code: 'NO_ACTIVE_SOLO', message: 'Start eerst een nieuwe Solo Kluis.' };
    }

    const tileIndex = Math.floor(Number(rawTileIndex));
    if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= game.totalTiles) {
      return { ok: false, code: 'INVALID_TILE', message: 'Ongeldig vakje geselecteerd.' };
    }
    if (game.revealedSet.has(tileIndex)) {
      return { ok: false, code: 'TILE_ALREADY_OPEN', message: 'Dit vakje is al geopend.' };
    }

    game.revealedSet.add(tileIndex);

    // Hit bomb -> bust immediately
    if (game.minesSet.has(tileIndex)) {
      const allMines = Array.from(game.minesSet).sort((a, b) => a - b);
      const historyEntry = {
        mode: 'SOLO',
        outcome: 'BUST',
        gridSide: game.gridSide,
        mineCount: game.mineCount,
        initialBet: game.betAmount,
        payout: 0,
        netProfit: -game.betAmount,
        multiplier: 0,
        diamondsOpened: game.diamondsOpened,
        hitTile: tileIndex,
        timestamp: Date.now(),
      };

      this.soloGames.delete(playerId);
      this.playerManager.updatePlayerStats(playerId, { wonAmount: 0, lostAmount: game.betAmount });
      if (typeof this.playerManager._persistPlayer === 'function') {
        this.playerManager._persistPlayer(player);
      }
      this._recordPersonalHistory(playerId, historyEntry);
      this.emit('salon_update', { trigger: 'solo_bust', playerId });

      return {
        ok: true,
        outcome: 'MINE',
        tileIndex,
        allMines,
        revealedDiamonds: [...game.revealedDiamonds],
        diamondsOpened: game.diamondsOpened,
        payout: 0,
        netProfit: -game.betAmount,
        solo: null,
        newChips: player.chips,
        historyEntry,
      };
    }

    // Safe diamond!
    game.diamondsOpened += 1;
    const stepMult = game.multiplierTable[game.diamondsOpened] || game.currentMultiplier;
    game.currentMultiplier = stepMult;
    game.revealedDiamonds.push({
      tileIndex,
      step: game.diamondsOpened,
      multiplier: stepMult,
    });

    const safeTiles = game.totalTiles - game.mineCount;
    const clearedBoard = game.diamondsOpened >= safeTiles;

    if (clearedBoard) {
      return this._finalizeSoloWin(player, game, 'GRAND_CLEAR', tileIndex);
    }

    this.emit('salon_update', { trigger: 'solo_gem', playerId, diamondsOpened: game.diamondsOpened });

    return {
      ok: true,
      outcome: 'DIAMOND',
      tileIndex,
      step: game.diamondsOpened,
      multiplier: stepMult,
      solo: this._serializeSoloGame(game),
      newChips: player.chips,
    };
  }

  /**
   * Cashes out an active Solo Mines board after at least 1 diamond has been found.
   * @param {string} playerId
   */
  cashoutSolo(playerId) {
    const player = this._ensurePlayer(playerId);
    if (!player) {
      return { ok: false, code: 'PLAYER_NOT_FOUND', message: 'Speler sessie niet gevonden.' };
    }
    const game = this.soloGames.get(playerId);
    if (!game || game.status !== 'ACTIVE') {
      return { ok: false, code: 'NO_ACTIVE_SOLO', message: 'Geen actieve Solo Kluis om uit te betalen.' };
    }
    if (game.diamondsOpened < 1) {
      return {
        ok: false,
        code: 'MIN_ONE_CLICK_REQUIRED',
        message: 'Open minstens 1 vakje voordat je kunt cashen.',
      };
    }
    return this._finalizeSoloWin(player, game, 'CASHOUT', null);
  }

  /** @private */
  _finalizeSoloWin(player, game, reason, lastTileIndex) {
    const payout = Math.min(MAX_PAYOUT, Math.floor(game.betAmount * game.currentMultiplier));
    const realizedProfit = Math.max(0, payout - game.betAmount);
    const netProfit = payout - game.betAmount;
    const allMines = Array.from(game.minesSet).sort((a, b) => a - b);

    const { newChips, repayments } = this._settlePayout(player.id, payout, realizedProfit);
    this.playerManager.updatePlayerStats(player.id, { wonAmount: payout });

    const historyEntry = {
      mode: 'SOLO',
      outcome: reason,
      gridSide: game.gridSide,
      mineCount: game.mineCount,
      initialBet: game.betAmount,
      payout,
      netProfit,
      multiplier: game.currentMultiplier,
      diamondsOpened: game.diamondsOpened,
      timestamp: Date.now(),
    };

    this.soloGames.delete(player.id);
    this._recordPersonalHistory(player.id, historyEntry);
    this._maybeRecordRecentWin(player, {
      mode: 'SOLO',
      gridSide: game.gridSide,
      mineCount: game.mineCount,
      diamondsOpened: game.diamondsOpened,
      initialBet: game.betAmount,
      payout,
      netProfit,
      multiplier: game.currentMultiplier,
    });

    this.emit('salon_update', { trigger: 'solo_cashout', playerId: player.id });
    if (game.currentMultiplier >= BIG_WIN_MIN_MULT && netProfit >= BIG_WIN_MIN_NET_PROFIT) {
      this.emit('big_moment', {
        mode: 'SOLO',
        playerId: player.id,
        playerName: player.name,
        gridLabel: `${game.gridSide}x${game.gridSide}`,
        mineCount: game.mineCount,
        diamondsOpened: game.diamondsOpened,
        multiplier: game.currentMultiplier,
        payout,
        netProfit,
      });
    }

    return {
      ok: true,
      outcome: reason,
      tileIndex: lastTileIndex,
      allMines,
      revealedDiamonds: [...game.revealedDiamonds],
      diamondsOpened: game.diamondsOpened,
      multiplier: game.currentMultiplier,
      payout,
      netProfit,
      repayments,
      solo: null,
      newChips,
      historyEntry,
    };
  }

  // =========================================================================
  // SHARED VAULT (MULTIPLAYER TURN-BASED CLICK-BY-CLICK)
  // =========================================================================

  /** @private */
  _tallySharedVotes() {
    const validVotes = Array.from(this.shared.votes.values());
    if (validVotes.length === 0) {
      return { gridSide: 5, totalTiles: 25, mineCount: 5 };
    }

    // Plurality by latest timestamp tie-breaker for gridSide, then mineCount within valid bounds
    const sideCounts = new Map();
    const mineCounts = new Map();

    for (const v of validVotes) {
      const sPrev = sideCounts.get(v.gridSide) || { count: 0, latestTs: 0 };
      sideCounts.set(v.gridSide, { count: sPrev.count + 1, latestTs: Math.max(sPrev.latestTs, v.ts) });

      const mPrev = mineCounts.get(v.mineCount) || { count: 0, latestTs: 0 };
      mineCounts.set(v.mineCount, { count: mPrev.count + 1, latestTs: Math.max(mPrev.latestTs, v.ts) });
    }

    let bestSide = 5;
    let bestSideScore = { count: -1, latestTs: -1 };
    for (const [side, sc] of sideCounts.entries()) {
      if (sc.count > bestSideScore.count || (sc.count === bestSideScore.count && sc.latestTs > bestSideScore.latestTs)) {
        bestSide = side;
        bestSideScore = sc;
      }
    }

    const totalTiles = GRID_CONFIGS[bestSide].totalTiles;
    let bestMines = 5;
    let bestMineScore = { count: -1, latestTs: -1 };
    for (const [mc, sc] of mineCounts.entries()) {
      if (mc >= 1 && mc < totalTiles) {
        if (sc.count > bestMineScore.count || (sc.count === bestMineScore.count && sc.latestTs > bestMineScore.latestTs)) {
          bestMines = mc;
          bestMineScore = sc;
        }
      }
    }
    if (bestMines >= totalTiles) bestMines = GRID_CONFIGS[bestSide].defaultMines;

    return {
      gridSide: bestSide,
      totalTiles,
      mineCount: bestMines,
    };
  }

  /** @private */
  _applyVoteSummaryToShared() {
    const tallied = this._tallySharedVotes();
    this.shared.gridSide = tallied.gridSide;
    this.shared.totalTiles = tallied.totalTiles;
    this.shared.mineCount = tallied.mineCount;
    this.shared.multiplierTable = buildMultiplierTable(tallied.totalTiles, tallied.mineCount, this.targetRtp);
  }

  /**
   * Records or updates a player's board & bomb vote before round starts.
   * Allowed in WAITING_FOR_PLAYERS or BETTING (if in BETTING, player must be joined OR any salon viewer).
   * @param {string} playerId
   * @param {{ gridSide?: number, mineCount?: number }} payload
   */
  voteSharedSettings(playerId, payload = {}) {
    const player = this._ensurePlayer(playerId);
    if (!player) {
      return { ok: false, code: 'PLAYER_NOT_FOUND', message: 'Speler sessie niet gevonden.' };
    }
    if (![SHARED_PHASES.WAITING_FOR_PLAYERS, SHARED_PHASES.BETTING].includes(this.shared.phase)) {
      return { ok: false, code: 'VOTING_LOCKED', message: 'Bordinstellingen staan vast zodra de kluis open is.' };
    }

    const existingVote = this.shared.votes.get(playerId) || {
      gridSide: this.shared.gridSide,
      mineCount: this.shared.mineCount,
    };
    const side = payload.gridSide !== undefined ? Math.floor(Number(payload.gridSide)) : existingVote.gridSide;
    const rawMines = payload.mineCount !== undefined ? Math.floor(Number(payload.mineCount)) : existingVote.mineCount;

    if (!VALID_GRID_SIDES.includes(side)) {
      return { ok: false, code: 'INVALID_SETTINGS', message: 'Kies een geldige bordgrootte (4x4, 5x5, 6x6 of 7x7).' };
    }
    if (!SHARED_BOMB_PRESETS.includes(rawMines)) {
      return { ok: false, code: 'INVALID_SETTINGS', message: 'Kies een geldige bom-optie (3, 5, 8 of 12).' };
    }

    this.shared.votes.set(playerId, {
      gridSide: side,
      mineCount: rawMines,
      ts: Date.now(),
    });
    this._applyVoteSummaryToShared();

    const state = this._serializeSharedState();
    this.emit('shared_update', state);
    this.emit('salon_update', { trigger: 'shared_vote', playerId });

    return { ok: true, shared: state };
  }

  /**
   * Places a bet into the next Shared Vault multiplayer round.
   * Starts the 8s Smart Timer on the very first player bet.
   * @param {string} playerId
   * @param {{ betAmount: number, gridSide?: number, mineCount?: number }} payload
   */
  joinShared(playerId, payload = {}) {
    const player = this._ensurePlayer(playerId);
    if (!player) {
      return { ok: false, code: 'PLAYER_NOT_FOUND', message: 'Speler sessie niet gevonden. Log opnieuw in.' };
    }
    if (![SHARED_PHASES.WAITING_FOR_PLAYERS, SHARED_PHASES.BETTING].includes(this.shared.phase)) {
      return {
        ok: false,
        code: 'SHARED_ROUND_ACTIVE',
        message: 'Huidige Shared Vault is al bezig; wacht tot de volgende ronde start.',
      };
    }
    if (this.shared.participants.has(playerId)) {
      return { ok: false, code: 'ALREADY_IN_SHARED', message: 'Je doet al mee aan deze Shared Vault ronde.' };
    }

    const bet = Math.floor(Number(payload.betAmount));
    if (!Number.isFinite(bet) || bet < MIN_BET || bet > MAX_BET) {
      return {
        ok: false,
        code: 'INVALID_BET',
        message: `Inzet moet tussen ${MIN_BET} en ${MAX_BET.toLocaleString()} fiches liggen.`,
      };
    }

    const deduct = this.playerManager.deductChips(playerId, bet);
    if (!deduct || !deduct.success) {
      return { ok: false, code: 'INSUFFICIENT_CHIPS', message: 'Onvoldoende fiches voor deze inzet.' };
    }
    if (typeof this.playerManager._persistPlayer === 'function') {
      this.playerManager._persistPlayer(player);
    }

    const sidePref = VALID_GRID_SIDES.includes(Number(payload.gridSide)) ? Number(payload.gridSide) : null;
    const minePref = SHARED_BOMB_PRESETS.includes(Number(payload.mineCount)) ? Number(payload.mineCount) : null;
    if (sidePref || minePref) {
      const prevVote = this.shared.votes.get(playerId) || {
        gridSide: this.shared.gridSide,
        mineCount: this.shared.mineCount,
      };
      this.shared.votes.set(playerId, {
        gridSide: sidePref || prevVote.gridSide,
        mineCount: minePref || prevVote.mineCount,
        ts: Date.now(),
      });
      this._applyVoteSummaryToShared();
    }

    const participant = {
      playerId: player.id,
      playerName: player.name,
      initials: player.initials || player.name.slice(0, 2).toUpperCase(),
      avatarColor: player.avatarColor || '#d4af37',
      betAmount: bet,
      status: 'ALIVE',
      clicksMade: 0,
      payout: 0,
      cashoutMultiplier: 0,
      joinedAt: Date.now(),
    };
    this.shared.participants.set(playerId, participant);

    const startedCountdown = this.shared.phase === SHARED_PHASES.WAITING_FOR_PLAYERS;
    if (startedCountdown) {
      this._startSharedBettingCountdown();
    } else {
      const state = this._serializeSharedState();
      this.emit('shared_update', state);
      this.emit('salon_update', { trigger: 'shared_join', playerId });
    }

    return {
      ok: true,
      startedCountdown,
      shared: this._serializeSharedState(),
      newChips: player.chips,
    };
  }

  /**
   * Cancels a player's Shared Vault entry during BETTING and refunds chips.
   * Reverts countdown back to WAITING_FOR_PLAYERS if 0 players remain.
   * @param {string} playerId
   */
  cancelSharedBet(playerId) {
    const player = this._ensurePlayer(playerId);
    if (!player) {
      return { ok: false, code: 'PLAYER_NOT_FOUND', message: 'Speler sessie niet gevonden.' };
    }
    if (this.shared.phase !== SHARED_PHASES.BETTING) {
      return { ok: false, code: 'CANCEL_CLOSED', message: 'Inzet annuleren kan alleen tijdens de aftelfase.' };
    }
    const existing = this.shared.participants.get(playerId);
    if (!existing) {
      return { ok: false, code: 'NOT_IN_SHARED', message: 'Geen Shared inzet om te annuleren.' };
    }

    this.shared.participants.delete(playerId);
    this.shared.votes.delete(playerId);
    this.playerManager.addChips(playerId, existing.betAmount);
    if (typeof this.playerManager._persistPlayer === 'function') {
      this.playerManager._persistPlayer(player);
    }

    if (this.shared.participants.size === 0) {
      this._clearSharedTimers();
      this.shared.phase = SHARED_PHASES.WAITING_FOR_PLAYERS;
      this.shared.timerSeconds = 0;
      this.shared.lastActionNote = 'Alle inzetten geannuleerd. Wacht op eerste speler.';
      this._applyVoteSummaryToShared();
      const state = this._serializeSharedState();
      this.emit('shared_phase_change', state);
      this.emit('salon_update', { trigger: 'shared_revert', playerId });
    } else {
      this._applyVoteSummaryToShared();
      const state = this._serializeSharedState();
      this.emit('shared_update', state);
      this.emit('salon_update', { trigger: 'shared_cancel', playerId });
    }

    return {
      ok: true,
      refundedAmount: existing.betAmount,
      shared: this._serializeSharedState(),
      newChips: player.chips,
    };
  }

  /** @private */
  _startSharedBettingCountdown() {
    this._clearSharedTimers();
    this.shared.roundId += 1;
    this.shared.phase = SHARED_PHASES.BETTING;
    this.shared.timerSeconds = this.durations.ENTRY_SEC;
    this.shared.lastActionNote = `Shared Vault #${this.shared.roundId} opent zo — kies je favoriete bord!`;

    const startState = this._serializeSharedState();
    this.emit('shared_phase_change', startState);
    this.emit('salon_update', { trigger: 'shared_betting' });

    this._sharedInterval = setInterval(() => {
      if (this._stopped || this.shared.phase !== SHARED_PHASES.BETTING) return;
      this.shared.timerSeconds = Math.max(0, this.shared.timerSeconds - 1);
      this.emit('shared_tick', {
        roundId: this.shared.roundId,
        phase: this.shared.phase,
        timerSeconds: this.shared.timerSeconds,
        turnTimeLeft: 0,
        turnPlayerId: null,
      });
      if (this.shared.timerSeconds <= 0) {
        this._clearSharedTimers();
        this._beginSharedPlay();
      }
    }, 1000);
  }

  /**
   * Locks voted board settings, deploys fair random bombs, and starts turn-based play.
   * Can also be invoked directly in unit tests when advancing from BETTING.
   */
  _beginSharedPlay() {
    this._clearSharedTimers();
    if (this.shared.participants.size === 0) {
      this.shared.phase = SHARED_PHASES.WAITING_FOR_PLAYERS;
      this.shared.timerSeconds = 0;
      this.emit('shared_phase_change', this._serializeSharedState());
      return;
    }

    this._applyVoteSummaryToShared();
    this.shared.minesSet = generateMinePositions(this.shared.totalTiles, this.shared.mineCount, this.rng);
    this.shared.revealedMap.clear();
    this.shared.revealedList = [];
    this.shared.diamondsOpened = 0;
    this.shared.currentMultiplier = 1.0;
    this.shared.detonatedBy = null;
    this.shared.allMinesReveal = null;

    this.shared.turnOrder = Array.from(this.shared.participants.keys());
    this.shared.turnIndex = 0;
    this.shared.turnPlayerId = this.shared.turnOrder[0];
    this.shared.turnTimeLeft = this.durations.TURN_SEC;
    this.shared.phase = SHARED_PHASES.PLAYING;

    const firstPlayer = this.shared.participants.get(this.shared.turnPlayerId);
    this.shared.lastActionNote = `${firstPlayer.playerName} mag het eerste vakje kiezen!`;

    this.emit('shared_phase_change', this._serializeSharedState());
    this.emit('salon_update', { trigger: 'shared_playing' });

    this._sharedInterval = setInterval(() => {
      if (this._stopped || this.shared.phase !== SHARED_PHASES.PLAYING) return;
      this.shared.turnTimeLeft = Math.max(0, this.shared.turnTimeLeft - 1);
      this.emit('shared_tick', {
        roundId: this.shared.roundId,
        phase: this.shared.phase,
        timerSeconds: 0,
        turnTimeLeft: this.shared.turnTimeLeft,
        turnPlayerId: this.shared.turnPlayerId,
      });
      if (this.shared.turnTimeLeft <= 0) {
        this._handleTurnTimeout();
      }
    }, 1000);
  }

  /** @private */
  _handleTurnTimeout() {
    if (this.shared.phase !== SHARED_PHASES.PLAYING || !this.shared.turnPlayerId) return;
    const activeId = this.shared.turnPlayerId;
    const hidden = [];
    for (let i = 0; i < this.shared.totalTiles; i += 1) {
      if (!this.shared.revealedMap.has(i)) hidden.push(i);
    }
    if (hidden.length === 0) return;

    const r = Math.min(0.999999999, Math.max(0, Number(this.rng())));
    const pick = hidden[Math.floor(r * hidden.length)];
    this._resolveSharedClick(activeId, pick, true);
  }

  /**
   * Handles a turn-based tile click in Shared Vault multiplayer.
   * @param {string} playerId
   * @param {number} rawTileIndex
   */
  clickSharedTile(playerId, rawTileIndex) {
    const player = this._ensurePlayer(playerId);
    if (!player) {
      return { ok: false, code: 'PLAYER_NOT_FOUND', message: 'Speler sessie niet gevonden.' };
    }
    if (this.shared.phase !== SHARED_PHASES.PLAYING) {
      return { ok: false, code: 'ROUND_NOT_PLAYING', message: 'De Shared Vault is nog niet geopend om te klikken.' };
    }
    const participant = this.shared.participants.get(playerId);
    if (!participant || participant.status !== 'ALIVE') {
      return { ok: false, code: 'NOT_ACTIVE_IN_ROUND', message: 'Je bent niet actief in deze ronde.' };
    }
    if (this.shared.turnPlayerId !== playerId) {
      const turnPlayer = this.shared.participants.get(this.shared.turnPlayerId);
      const who = turnPlayer ? turnPlayer.playerName : 'een andere speler';
      return { ok: false, code: 'NOT_YOUR_TURN', message: `Even geduld — het is de beurt van ${who}.` };
    }

    const tileIndex = Math.floor(Number(rawTileIndex));
    if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= this.shared.totalTiles) {
      return { ok: false, code: 'INVALID_TILE', message: 'Ongeldig vakje.' };
    }
    if (this.shared.revealedMap.has(tileIndex)) {
      return { ok: false, code: 'TILE_ALREADY_OPEN', message: 'Dit vakje is al geopend.' };
    }

    return this._resolveSharedClick(playerId, tileIndex, false);
  }

  /** @private */
  _advanceSharedTurnAfter(playerId) {
    const n = this.shared.turnOrder.length;
    if (n === 0) return null;
    const curIdx = this.shared.turnOrder.indexOf(playerId);
    const startIdx = curIdx >= 0 ? curIdx : this.shared.turnIndex;

    for (let offset = 1; offset <= n; offset += 1) {
      const nextIdx = (startIdx + offset) % n;
      const candId = this.shared.turnOrder[nextIdx];
      const cand = this.shared.participants.get(candId);
      if (cand && cand.status === 'ALIVE') {
        this.shared.turnIndex = nextIdx;
        this.shared.turnPlayerId = candId;
        this.shared.turnTimeLeft = this.durations.TURN_SEC;
        return cand;
      }
    }
    this.shared.turnPlayerId = null;
    this.shared.turnTimeLeft = 0;
    return null;
  }

  /** @private */
  _resolveSharedClick(playerId, tileIndex, autoTimeout) {
    const participant = this.shared.participants.get(playerId);
    if (!participant || participant.status !== 'ALIVE') {
      return { ok: false, code: 'NOT_ACTIVE_IN_ROUND', message: 'Je bent niet actief.' };
    }

    participant.clicksMade += 1;

    // Bomb hit -> all remaining ALIVE players bust! Already-cashed players stay winners!
    if (this.shared.minesSet.has(tileIndex)) {
      const tileInfo = {
        tileIndex,
        type: 'MINE',
        step: this.shared.diamondsOpened + 1,
        playerId: participant.playerId,
        playerName: participant.playerName,
        initials: participant.initials,
        avatarColor: participant.avatarColor,
        autoTimeout: Boolean(autoTimeout),
      };
      this.shared.revealedMap.set(tileIndex, tileInfo);
      this.shared.revealedList.push(tileInfo);
      this.shared.detonatedBy = {
        playerId: participant.playerId,
        playerName: participant.playerName,
        tileIndex,
        autoTimeout: Boolean(autoTimeout),
      };
      this.shared.lastActionNote = autoTimeout
        ? `TIME-OUT BOM! Automatische klik van ${participant.playerName} raakte een mijn!`
        : `BOEM! ${participant.playerName} raakte een mijn op vakje #${tileIndex + 1}!`;

      const settlements = [];
      for (const p of this.shared.participants.values()) {
        if (p.status === 'ALIVE') {
          p.status = 'BUSTED';
          p.payout = 0;
          const playerObj = this._ensurePlayer(p.playerId);
          this.playerManager.updatePlayerStats(p.playerId, { wonAmount: 0, lostAmount: p.betAmount });
          if (playerObj && typeof this.playerManager._persistPlayer === 'function') {
            this.playerManager._persistPlayer(playerObj);
          }
          const historyEntry = {
            mode: 'SHARED',
            outcome: 'BUST',
            gridSide: this.shared.gridSide,
            mineCount: this.shared.mineCount,
            initialBet: p.betAmount,
            payout: 0,
            netProfit: -p.betAmount,
            multiplier: 0,
            diamondsOpened: this.shared.diamondsOpened,
            timestamp: Date.now(),
          };
          this._recordPersonalHistory(p.playerId, historyEntry);
          settlements.push({
            playerId: p.playerId,
            playerName: p.playerName,
            status: 'BUSTED',
            betAmount: p.betAmount,
            payout: 0,
            netProfit: -p.betAmount,
            newChips: playerObj ? playerObj.chips : 0,
            repayments: [],
            historyEntry,
          });
        }
      }

      this._finishSharedRound('BOMB_HIT', tileInfo, settlements);
      return { ok: true, outcome: 'MINE', tileInfo, shared: this._serializeSharedState() };
    }

    // Safe diamond opened on the shared board!
    this.shared.diamondsOpened += 1;
    const stepMult = this.shared.multiplierTable[this.shared.diamondsOpened] || this.shared.currentMultiplier;
    this.shared.currentMultiplier = stepMult;

    const tileInfo = {
      tileIndex,
      type: 'DIAMOND',
      step: this.shared.diamondsOpened,
      multiplier: stepMult,
      playerId: participant.playerId,
      playerName: participant.playerName,
      initials: participant.initials,
      avatarColor: participant.avatarColor,
      autoTimeout: Boolean(autoTimeout),
    };
    this.shared.revealedMap.set(tileIndex, tileInfo);
    this.shared.revealedList.push(tileInfo);

    const safeTiles = this.shared.totalTiles - this.shared.mineCount;
    if (this.shared.diamondsOpened >= safeTiles) {
      // Every remaining survivor auto-cashes at max clear multiplier!
      const settlements = [];
      for (const p of this.shared.participants.values()) {
        if (p.status === 'ALIVE') {
          const s = this._paySharedSurvivor(p, 'GRAND_CLEAR');
          settlements.push(s);
        }
      }
      this.shared.lastActionNote = `KLUIZENAAR JACKPOT! Alle ${safeTiles} diamanten gevonden op ${stepMult.toFixed(2)}x!`;
      this._finishSharedRound('GRAND_CLEAR', tileInfo, settlements);
      return { ok: true, outcome: 'GRAND_CLEAR', tileInfo, shared: this._serializeSharedState() };
    }

    const nextActor = this._advanceSharedTurnAfter(playerId);
    const timeoutPrefix = autoTimeout ? '[Auto Time-out] ' : '';
    this.shared.lastActionNote = nextActor
      ? `${timeoutPrefix}${participant.playerName} vond een diamant (${stepMult.toFixed(2)}x)! Nu aan zet: ${nextActor.playerName}`
      : `${timeoutPrefix}${participant.playerName} vond een diamant (${stepMult.toFixed(2)}x)!`;

    const state = this._serializeSharedState();
    this.emit('shared_tile', { tileInfo, shared: state });
    this.emit('shared_update', state);
    this.emit('salon_update', { trigger: 'shared_gem', playerId });

    return { ok: true, outcome: 'DIAMOND', tileInfo, shared: state };
  }

  /** @private */
  _paySharedSurvivor(p, outcomeLabel = 'CASHOUT') {
    const mult = this.shared.currentMultiplier;
    const payout = Math.min(MAX_PAYOUT, Math.floor(p.betAmount * mult));
    const realizedProfit = Math.max(0, payout - p.betAmount);
    const netProfit = payout - p.betAmount;

    p.status = 'CASHED_OUT';
    p.payout = payout;
    p.cashoutMultiplier = mult;

    const { newChips, repayments } = this._settlePayout(p.playerId, payout, realizedProfit);
    this.playerManager.updatePlayerStats(p.playerId, { wonAmount: payout });

    const historyEntry = {
      mode: 'SHARED',
      outcome: outcomeLabel,
      gridSide: this.shared.gridSide,
      mineCount: this.shared.mineCount,
      initialBet: p.betAmount,
      payout,
      netProfit,
      multiplier: mult,
      diamondsOpened: this.shared.diamondsOpened,
      timestamp: Date.now(),
    };
    this._recordPersonalHistory(p.playerId, historyEntry);

    const playerObj = this._ensurePlayer(p.playerId);
    if (playerObj) {
      this._maybeRecordRecentWin(playerObj, {
        mode: 'SHARED',
        gridSide: this.shared.gridSide,
        mineCount: this.shared.mineCount,
        diamondsOpened: this.shared.diamondsOpened,
        initialBet: p.betAmount,
        payout,
        netProfit,
        multiplier: mult,
      });
    }

    if (mult >= BIG_WIN_MIN_MULT && netProfit >= BIG_WIN_MIN_NET_PROFIT) {
      this.emit('big_moment', {
        mode: 'SHARED',
        playerId: p.playerId,
        playerName: p.playerName,
        gridLabel: `${this.shared.gridSide}x${this.shared.gridSide}`,
        mineCount: this.shared.mineCount,
        diamondsOpened: this.shared.diamondsOpened,
        multiplier: mult,
        payout,
        netProfit,
      });
    }

    return {
      playerId: p.playerId,
      playerName: p.playerName,
      status: 'CASHED_OUT',
      betAmount: p.betAmount,
      multiplier: mult,
      payout,
      netProfit,
      newChips,
      repayments,
      historyEntry,
    };
  }

  /**
   * Cashes out an individual survivor during Shared Vault play.
   * Requires `clicksMade >= 1` (zero passive riding without opening at least 1 own tile).
   * @param {string} playerId
   */
  cashoutShared(playerId) {
    const player = this._ensurePlayer(playerId);
    if (!player) {
      return { ok: false, code: 'PLAYER_NOT_FOUND', message: 'Speler sessie niet gevonden.' };
    }
    if (this.shared.phase !== SHARED_PHASES.PLAYING) {
      return { ok: false, code: 'CASHOUT_CLOSED', message: 'Cashout is alleen mogelijk tijdens het spelen.' };
    }
    const participant = this.shared.participants.get(playerId);
    if (!participant || participant.status !== 'ALIVE') {
      return { ok: false, code: 'NOT_ALIVE', message: 'Je bent niet meer actief in deze Shared Vault ronde.' };
    }
    if (participant.clicksMade < 1) {
      return {
        ok: false,
        code: 'MIN_ONE_CLICK_REQUIRED',
        message: 'Open eerst minstens 1 eigen vakje voordat je mag cashen (anti-passief)!',
      };
    }

    const settlement = this._paySharedSurvivor(participant, 'CASHOUT');
    this.emit('shared_settlement', settlement);

    const aliveCount = Array.from(this.shared.participants.values()).filter((p) => p.status === 'ALIVE').length;
    if (aliveCount === 0) {
      this.shared.lastActionNote = `Alle spelers gecasht — ${participant.playerName} sluit de kluis op ${settlement.multiplier.toFixed(2)}x!`;
      this._finishSharedRound('ALL_CASHED_OUT', null, [settlement]);
      return { ok: true, settlement, shared: this._serializeSharedState() };
    }

    if (this.shared.turnPlayerId === playerId) {
      const nextActor = this._advanceSharedTurnAfter(playerId);
      this.shared.lastActionNote = `${participant.playerName} cashte ${settlement.payout.toLocaleString()} F (${settlement.multiplier.toFixed(2)}x)! Nu aan zet: ${nextActor ? nextActor.playerName : '-'}`;
    } else {
      this.shared.lastActionNote = `${participant.playerName} cashte veilig ${settlement.payout.toLocaleString()} F (${settlement.multiplier.toFixed(2)}x)!`;
    }

    const state = this._serializeSharedState();
    this.emit('shared_update', state);
    this.emit('salon_update', { trigger: 'shared_cashout', playerId });

    return { ok: true, settlement, shared: state };
  }

  /** @private */
  _finishSharedRound(reason, triggerTile, immediateSettlements = []) {
    this._clearSharedTimers();
    this.shared.phase = SHARED_PHASES.REVEALED;
    this.shared.turnPlayerId = null;
    this.shared.turnTimeLeft = 0;
    this.shared.allMinesReveal = Array.from(this.shared.minesSet).sort((a, b) => a - b);

    const participantsSummary = Array.from(this.shared.participants.values()).map((p) => ({
      playerId: p.playerId,
      playerName: p.playerName,
      initials: p.initials,
      avatarColor: p.avatarColor,
      betAmount: p.betAmount,
      status: p.status,
      clicksMade: p.clicksMade,
      payout: p.payout,
      cashoutMultiplier: p.cashoutMultiplier,
    }));

    const resultPayload = {
      roundId: this.shared.roundId,
      reason,
      triggerTile,
      gridSide: this.shared.gridSide,
      mineCount: this.shared.mineCount,
      diamondsOpened: this.shared.diamondsOpened,
      finalMultiplier: this.shared.currentMultiplier,
      allMines: this.shared.allMinesReveal,
      detonatedBy: this.shared.detonatedBy,
      participants: participantsSummary,
    };
    this.shared.lastResult = resultPayload;

    for (const s of immediateSettlements) {
      if (s && s.status === 'BUSTED') {
        this.emit('shared_settlement', s);
      } else if (s && reason === 'GRAND_CLEAR') {
        this.emit('shared_settlement', s);
      }
    }

    const revealedState = this._serializeSharedState();
    this.emit('shared_finished', { ...resultPayload, shared: revealedState });
    this.emit('shared_phase_change', revealedState);
    this.emit('salon_update', { trigger: 'shared_finished' });

    this._sharedTimeout = setTimeout(() => {
      if (this._stopped) return;
      this.shared = this._createFreshSharedState(this.shared.roundId);
      const resetState = this._serializeSharedState();
      this.emit('shared_phase_change', resetState);
      this.emit('salon_update', { trigger: 'shared_reset' });
    }, this.durations.REVEAL_MS);
  }

  // =========================================================================
  // PUBLIC STATE
  // =========================================================================

  /** @private */
  _serializeSharedState() {
    const s = this.shared;
    const participants = Array.from(s.participants.values()).map((p) => ({
      playerId: p.playerId,
      playerName: p.playerName,
      initials: p.initials,
      avatarColor: p.avatarColor,
      betAmount: p.betAmount,
      status: p.status,
      clicksMade: p.clicksMade,
      canCashout: s.phase === SHARED_PHASES.PLAYING && p.status === 'ALIVE' && p.clicksMade >= 1,
      payout: p.payout,
      cashoutMultiplier: p.cashoutMultiplier,
    }));

    const aliveCount = participants.filter((p) => p.status === 'ALIVE').length;
    const voteSizeTally = {};
    const voteMineTally = {};
    for (const v of s.votes.values()) {
      voteSizeTally[v.gridSide] = (voteSizeTally[v.gridSide] || 0) + 1;
      voteMineTally[v.mineCount] = (voteMineTally[v.mineCount] || 0) + 1;
    }

    const nextMeta = computeNextPickMeta(s.totalTiles, s.mineCount, s.diamondsOpened, this.targetRtp);
    const showMines = s.phase === SHARED_PHASES.REVEALED ? (s.allMinesReveal || []) : null;

    return {
      roundId: s.roundId,
      phase: s.phase,
      timerSeconds: s.timerSeconds,
      turnTimeLeft: s.turnTimeLeft,
      entryDuration: this.durations.ENTRY_SEC,
      turnDuration: this.durations.TURN_SEC,
      gridSide: s.gridSide,
      totalTiles: s.totalTiles,
      mineCount: s.mineCount,
      safeTiles: s.totalTiles - s.mineCount,
      diamondsOpened: s.diamondsOpened,
      currentMultiplier: s.currentMultiplier,
      nextMultiplier: nextMeta.nextMultiplier,
      safeChancePct: nextMeta.safeChancePct,
      mineRiskPct: nextMeta.mineRiskPct,
      turnOrder: [...s.turnOrder],
      turnPlayerId: s.turnPlayerId,
      aliveCount,
      participants,
      revealedTiles: [...s.revealedList],
      allMines: showMines,
      detonatedBy: s.detonatedBy,
      lastActionNote: s.lastActionNote,
      lastResult: s.phase === SHARED_PHASES.REVEALED ? s.lastResult : null,
      voteSummary: {
        sizes: voteSizeTally,
        mines: voteMineTally,
        totalVotes: s.votes.size,
      },
    };
  }

  /**
   * Builds complete public Mines Salon snapshot for a given player (never exposing other players' hidden solo mines).
   * @param {string|null} [forPlayerId=null]
   */
  getPublicState(forPlayerId = null) {
    const players = Array.from(this.salonPlayers.values()).map((sp) => {
      const solo = this.soloGames.get(sp.playerId);
      const sharedP = this.shared.participants.get(sp.playerId);
      const isTurn = this.shared.phase === SHARED_PHASES.PLAYING && this.shared.turnPlayerId === sp.playerId;

      return {
        playerId: sp.playerId,
        name: sp.name,
        initials: sp.initials,
        avatarColor: sp.avatarColor,
        activeMode: sharedP ? 'SHARED' : (solo ? 'SOLO' : 'SPECTATING'),
        isTurn,
        soloActive: solo
          ? {
              gridSide: solo.gridSide,
              mineCount: solo.mineCount,
              betAmount: solo.betAmount,
              diamondsOpened: solo.diamondsOpened,
              currentMultiplier: solo.currentMultiplier,
            }
          : null,
        sharedStatus: sharedP ? sharedP.status : null,
      };
    });

    const soloSelf = forPlayerId ? this._serializeSoloGame(this.soloGames.get(forPlayerId)) : null;
    const personalHist = forPlayerId && this.personalHistory.has(forPlayerId)
      ? [...this.personalHistory.get(forPlayerId)]
      : [];
    const myVote = forPlayerId && this.shared.votes.has(forPlayerId)
      ? { gridSide: this.shared.votes.get(forPlayerId).gridSide, mineCount: this.shared.votes.get(forPlayerId).mineCount }
      : null;

    return {
      minBet: MIN_BET,
      maxBet: MAX_BET,
      maxPayout: MAX_PAYOUT,
      targetRtp: this.targetRtp,
      validGridSides: VALID_GRID_SIDES,
      sharedBombPresets: SHARED_BOMB_PRESETS,
      solo: soloSelf,
      shared: this._serializeSharedState(),
      myVote,
      players,
      recentWins: [...this.recentWins],
      personalHistory: personalHist,
    };
  }
}

MinesEngine.SHARED_PHASES = SHARED_PHASES;
MinesEngine.SHARED_DURATIONS = SHARED_DURATIONS;
MinesEngine.MIN_BET = MIN_BET;
MinesEngine.MAX_BET = MAX_BET;
MinesEngine.TARGET_RTP = TARGET_RTP;

module.exports = MinesEngine;
