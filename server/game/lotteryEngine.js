/**
 * lotteryEngine.js
 * Server-authoritative multiplayer Casino Staatsloterij engine.
 *
 * Features:
 *  - Fixed 10-minute rounds (ROUND_DURATION_MS) with persistent JSON state (lottery.json).
 *  - Unlimited tickets per player at 2.500 fiches/ticket; 0% house edge (100% pot payout).
 *  - Contiguous ticket-range storage with binary search for O(log R) weighted selection.
 *  - Offline winner support (accounts + BankManager inbox notification + pending win celebration on reconnect) and loan repayment on net profit.
 *  - Strictly zero audio and zero Unicode emojis.
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const {
  TICKET_PRICE,
  HOUSE_FEE_RATE,
  MIN_PURCHASE_COUNT,
  MAX_PURCHASE_PER_REQUEST,
  ROUND_DURATION_MS,
  DRAW_REVEAL_MS,
  HISTORY_LIMIT,
  PHASES,
  getLotteryMonogram,
  computePlayerOdds,
  findRangeForTicketIndex,
  buildRaffleReelEntries
} = require('./lotteryConstants');

class LotteryEngine extends EventEmitter {
  /**
   * @param {import('./playerManager')} playerManager
   * @param {Object} [options={}]
   * @param {import('./bankManager')|null} [options.bankManager=null]
   * @param {Function} [options.rng=Math.random]
   * @param {number} [options.roundDurationMs=ROUND_DURATION_MS]
   * @param {number} [options.drawRevealMs=DRAW_REVEAL_MS]
   * @param {string|false} [options.storagePath]
   * @param {number} [options.debounceMs=400]
   * @param {number} [options.tickIntervalMs=1000]
   */
  constructor(playerManager, options = {}) {
    super();
    this.playerManager = playerManager;
    this.bankManager = options.bankManager || null;
    this.rng = typeof options.rng === 'function' ? options.rng : Math.random;

    this.roundDurationMs = Math.max(50, Number(options.roundDurationMs) || ROUND_DURATION_MS);
    this.drawRevealMs = Math.max(50, Number(options.drawRevealMs) || DRAW_REVEAL_MS);
    this.debounceMs = Math.max(0, Number(options.debounceMs ?? 400));
    this.tickIntervalMs = Math.max(25, Number(options.tickIntervalMs) || 1000);

    const isTestEnv = process.env.NODE_ENV === 'test' ||
      process.execArgv.includes('--test') ||
      process.argv.some((arg) => arg.includes('--test') || arg.includes('.test.js'));

    /** @type {string|false} */
    this.storagePath = options.storagePath !== undefined
      ? options.storagePath
      : (isTestEnv ? false : path.join(__dirname, '..', 'data', 'lottery.json'));

    this.roundId = 1;
    this.phase = PHASES.OPEN;
    this.roundEndsAt = Date.now() + this.roundDurationMs;
    this.drawEndsAt = 0;

    /** @type {Array<{ startTicket: number, endTicket: number, count: number, playerId: string, playerName: string, playerColor: string }>} */
    this.ranges = [];
    this.totalTickets = 0;
    this.pot = 0;

    /** @type {Map<string, Object>} */
    this.participants = new Map();

    /** @type {Object|null} */
    this.lastDraw = null;

    /** @type {Array<Object>} */
    this.history = [];

    /** @type {Map<string, Object>} Unseen offline wins keyed by lowercase winnerKey */
    this.unseenOfflineWins = new Map();

    /** @type {Map<string, Object>} Unseen offline loss/outcome notices keyed by "roundId:playerKey" */
    this.unseenOfflineOutcomes = new Map();

    /** @type {Set<number>} Settled round IDs to guarantee idempotent single draws across restarts */
    this.settledRoundIds = new Set();

    /** @type {Set<string>} Processed client backup claim keys */
    this.restoredClaimKeys = new Set();

    /** @type {boolean} True when constructor loaded an existing lottery.json from disk */
    this.loadedFromDisk = false;

    this._timer = null;
    this._saveTimer = null;
    this._isRunning = false;

    this.loadState();
  }

  /**
   * Rebuilds in-memory participant aggregates and pot totals from persisted ranges.
   * @private
   */
  _rebuildAggregatesFromRanges() {
    this.participants.clear();
    let ticketCounter = 0;
    const validRanges = [];

    for (const r of this.ranges) {
      if (!r || !r.playerId || !Number.isInteger(r.count) || r.count <= 0) continue;
      const startTicket = ticketCounter;
      const endTicket = ticketCounter + r.count - 1;
      ticketCounter += r.count;

      const cleanRange = {
        startTicket,
        endTicket,
        count: r.count,
        playerId: r.playerId,
        playerName: r.playerName || 'Speler',
        playerColor: r.playerColor || '#D4AF37'
      };
      validRanges.push(cleanRange);

      this._recordParticipantRange(cleanRange);
    }

    this.ranges = validRanges;
    this.totalTickets = ticketCounter;
    this.pot = Math.round(this.totalTickets * TICKET_PRICE * (1 - HOUSE_FEE_RATE));
  }

  /** @private */
  _recordParticipantRange(range) {
    let entry = this.participants.get(range.playerId);
    if (!entry) {
      entry = {
        playerId: range.playerId,
        playerName: range.playerName,
        playerColor: range.playerColor || '#D4AF37',
        monogram: getLotteryMonogram(range.playerName),
        tickets: 0,
        totalSpent: 0,
        ranges: []
      };
      this.participants.set(range.playerId, entry);
    }
    entry.playerName = range.playerName || entry.playerName;
    entry.playerColor = range.playerColor || entry.playerColor;
    entry.monogram = getLotteryMonogram(entry.playerName);
    entry.tickets += range.count;
    entry.totalSpent += range.count * TICKET_PRICE;
    entry.ranges.push({
      start: range.startTicket + 1,
      end: range.endTicket + 1,
      count: range.count
    });
  }

  loadState() {
    if (!this.storagePath) return;
    try {
      if (!fs.existsSync(this.storagePath)) return;
      const raw = fs.readFileSync(this.storagePath, 'utf8');
      if (!raw || !raw.trim()) return;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return;
      this.loadedFromDisk = true;

      if (Number.isInteger(data.roundId) && data.roundId >= 1) {
        this.roundId = data.roundId;
      }
      if (Array.isArray(data.ranges)) {
        this.ranges = data.ranges;
      }
      if (Array.isArray(data.history)) {
        this.history = data.history.slice(0, HISTORY_LIMIT);
      }
      if (data.lastDraw && typeof data.lastDraw === 'object') {
        this.lastDraw = data.lastDraw;
      }
      if (!this.unseenOfflineWins) {
        this.unseenOfflineWins = new Map();
      }
      if (Array.isArray(data.unseenOfflineWins)) {
        for (const entry of data.unseenOfflineWins) {
          if (Array.isArray(entry) && entry[0] && entry[1] && typeof entry[1] === 'object') {
            this.unseenOfflineWins.set(String(entry[0]), entry[1]);
          }
        }
      }
      if (!this.unseenOfflineOutcomes) {
        this.unseenOfflineOutcomes = new Map();
      }
      if (Array.isArray(data.unseenOfflineOutcomes)) {
        for (const entry of data.unseenOfflineOutcomes) {
          if (Array.isArray(entry) && entry[0] && entry[1] && typeof entry[1] === 'object') {
            this.unseenOfflineOutcomes.set(String(entry[0]), entry[1]);
          }
        }
      }
      if (!this.settledRoundIds) {
        this.settledRoundIds = new Set();
      }
      if (Array.isArray(data.settledRoundIds)) {
        for (const rid of data.settledRoundIds) {
          if (Number.isInteger(rid) && rid >= 1) {
            this._recordSettledRoundId(rid);
          }
        }
      }
      for (const h of this.history) {
        if (h && Number.isInteger(h.roundId) && h.roundId >= 1) {
          this._recordSettledRoundId(h.roundId);
        }
      }
      if (!this.restoredClaimKeys) {
        this.restoredClaimKeys = new Set();
      }
      if (Array.isArray(data.restoredClaimKeys)) {
        for (const k of data.restoredClaimKeys) {
          if (typeof k === 'string' && k) {
            this._recordRestoredClaimKey(k);
          }
        }
      }

      this._rebuildAggregatesFromRanges();

      // Resume DRAWING safely without double-drawing; keep overdue OPEN rounds intact so start()/tick() settles once
      const now = Date.now();
      if (data.phase === PHASES.DRAWING) {
        this._recordSettledRoundId(this.roundId);
        const savedDrawEndsAt = (typeof data.drawEndsAt === 'number' && Number.isFinite(data.drawEndsAt) && data.drawEndsAt > 0)
          ? data.drawEndsAt
          : (((typeof data.savedAt === 'number' && Number.isFinite(data.savedAt)) ? data.savedAt : now) + this.drawRevealMs);
        if (savedDrawEndsAt > now) {
          this.phase = PHASES.DRAWING;
          this.drawEndsAt = Math.min(savedDrawEndsAt, now + this.drawRevealMs);
          this.roundEndsAt = (typeof data.roundEndsAt === 'number' && Number.isFinite(data.roundEndsAt))
            ? data.roundEndsAt
            : now;
        } else {
          const anchor = (typeof data.roundEndsAt === 'number' && Number.isFinite(data.roundEndsAt))
            ? data.roundEndsAt
            : savedDrawEndsAt;
          this._advanceOfflineOpenRound(now, anchor);
        }
      } else {
        this.phase = PHASES.OPEN;
        this.drawEndsAt = 0;

        if (typeof data.roundEndsAt === 'number' && Number.isFinite(data.roundEndsAt)) {
          if (data.roundEndsAt > now) {
            this.roundEndsAt = Math.min(data.roundEndsAt, now + this.roundDurationMs);
          } else if (this.totalTickets > 0 && !this.settledRoundIds.has(this.roundId)) {
            // Persisted active tickets whose round deadline passed while server was down: start()/tick() executes draw once
            this.roundEndsAt = data.roundEndsAt;
          } else {
            this._advanceOfflineOpenRound(now, data.roundEndsAt);
          }
        } else {
          this.roundEndsAt = now + this.roundDurationMs;
        }
      }
    } catch (err) {
      console.error('LotteryEngine failed to load state:', err.message);
    }
  }

  _scheduleSave() {
    if (!this.storagePath) return;
    if (this.debounceMs === 0) {
      this.saveStateSync();
      return;
    }
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.saveStateSync();
    }, this.debounceMs);
    if (this._saveTimer && typeof this._saveTimer.unref === 'function') {
      this._saveTimer.unref();
    }
  }

  saveStateSync() {
    if (!this.storagePath) return;
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const payload = {
        roundId: this.roundId,
        phase: this.phase,
        roundEndsAt: this.roundEndsAt,
        drawEndsAt: this.drawEndsAt,
        ranges: this.ranges,
        lastDraw: this.lastDraw,
        history: this.history.slice(0, HISTORY_LIMIT),
        unseenOfflineWins: this.unseenOfflineWins ? Array.from(this.unseenOfflineWins.entries()).slice(0, 50) : [],
        unseenOfflineOutcomes: this.unseenOfflineOutcomes ? Array.from(this.unseenOfflineOutcomes.entries()).slice(0, 50) : [],
        settledRoundIds: this.settledRoundIds ? Array.from(this.settledRoundIds).slice(-100) : [],
        restoredClaimKeys: this.restoredClaimKeys ? Array.from(this.restoredClaimKeys).slice(-200) : [],
        savedAt: Date.now()
      };
      const tmp = `${this.storagePath}.tmp.${process.pid}.${Date.now()}`;
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmp, this.storagePath);
    } catch (err) {
      console.error('LotteryEngine failed to save state:', err.message);
    }
  }

  start() {
    if (this._isRunning) return;
    this._isRunning = true;
    // Catch up immediately if persisted round already elapsed while offline
    this.tick(Date.now());
    this._timer = setInterval(() => {
      this.tick(Date.now());
    }, this.tickIntervalMs);
    if (this._timer && typeof this._timer.unref === 'function') {
      this._timer.unref();
    }
  }

  stop() {
    this._isRunning = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this.saveStateSync();
  }

  _recordSettledRoundId(roundId) {
    if (!this.settledRoundIds) this.settledRoundIds = new Set();
    if (!Number.isInteger(roundId) || roundId < 1) return;
    this.settledRoundIds.add(roundId);
    while (this.settledRoundIds.size > 100) {
      const oldest = this.settledRoundIds.values().next().value;
      this.settledRoundIds.delete(oldest);
    }
  }

  _recordRestoredClaimKey(key) {
    if (!this.restoredClaimKeys) this.restoredClaimKeys = new Set();
    if (!key) return;
    this.restoredClaimKeys.add(String(key));
    while (this.restoredClaimKeys.size > 200) {
      const oldest = this.restoredClaimKeys.values().next().value;
      this.restoredClaimKeys.delete(oldest);
    }
  }

  _findParticipant(playerId, playerName = null) {
    if (playerId && this.participants.has(playerId)) {
      return this.participants.get(playerId);
    }
    const normName = String(playerName || '').trim().toLowerCase();
    if (!normName) return null;
    for (const p of this.participants.values()) {
      if (p && String(p.playerName || '').trim().toLowerCase() === normName) {
        return p;
      }
    }
    return null;
  }

  _hasParticipantInRound(playerId, playerName = null) {
    return Boolean(this._findParticipant(playerId, playerName));
  }

  _advanceOfflineOpenRound(now = Date.now(), previousEndsAt = this.roundEndsAt) {
    const cleanAnchor = (typeof previousEndsAt === 'number' && Number.isFinite(previousEndsAt) && previousEndsAt > 0)
      ? previousEndsAt
      : now;
    const elapsedMs = Math.max(0, now - cleanAnchor);
    const missedCycles = Math.floor(elapsedMs / this.roundDurationMs);
    const stepCount = 1 + missedCycles;
    this.roundId += stepCount;
    this.phase = PHASES.OPEN;
    this.roundEndsAt = cleanAnchor + stepCount * this.roundDurationMs;
    if (this.roundEndsAt <= now) {
      this.roundEndsAt = now + this.roundDurationMs;
    }
    this.drawEndsAt = 0;
    this.ranges = [];
    this.totalTickets = 0;
    this.pot = 0;
    this.participants.clear();
  }

  /**
   * Advances round lifecycle according to wall-clock timestamps and emits 1s ticks.
   * @param {number} [now=Date.now()]
   */
  tick(now = Date.now()) {
    if (this.phase === PHASES.OPEN) {
      if (now >= this.roundEndsAt) {
        const scheduledEndsAt = this.roundEndsAt;
        if (this.totalTickets <= 0 || this.ranges.length === 0 || (this.settledRoundIds && this.settledRoundIds.has(this.roundId))) {
          this._startNextRound(now, { offlineAnchorEndsAt: scheduledEndsAt });
          return;
        }
        this._executeDraw(now, { scheduledEndsAt });
        if (now >= this.drawEndsAt) {
          this._startNextRound(now, { offlineAnchorEndsAt: scheduledEndsAt });
        }
        return;
      }
      this.emit('tick', this.getTickPayload(now));
    } else if (this.phase === PHASES.DRAWING) {
      if (now >= this.drawEndsAt) {
        this._startNextRound(now, { offlineAnchorEndsAt: this.roundEndsAt });
        return;
      }
      this.emit('tick', this.getTickPayload(now));
    }
  }

  getTickPayload(now = Date.now()) {
    const target = this.phase === PHASES.DRAWING ? this.drawEndsAt : this.roundEndsAt;
    const msLeft = Math.max(0, target - now);
    const secondsRemaining = Math.ceil(msLeft / 1000);
    return {
      roundId: this.roundId,
      phase: this.phase,
      secondsRemaining,
      roundEndsAt: this.roundEndsAt,
      drawEndsAt: this.drawEndsAt,
      pot: this.pot,
      totalTickets: this.totalTickets,
      uniqueParticipants: this.participants.size
    };
  }

  /**
   * Purchases `rawCount` tickets at TICKET_PRICE (2.500 fiches) with 0% house rake.
   * No upper cap per player across the round.
   * @param {string} playerId
   * @param {number|string} rawCount
   * @returns {Object}
   */
  buyTickets(playerId, rawCount) {
    const player = this.playerManager && typeof this.playerManager.getPlayerById === 'function'
      ? this.playerManager.getPlayerById(playerId)
      : null;

    if (!player) {
      return {
        ok: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Speler niet gevonden. Log opnieuw in.'
      };
    }

    if (this.phase !== PHASES.OPEN) {
      return {
        ok: false,
        code: 'DRAW_IN_PROGRESS',
        message: 'De trekking is momenteel bezig. Wacht tot de nieuwe ronde start.'
      };
    }

    const count = Number(rawCount);
    if (!Number.isInteger(count) || count < MIN_PURCHASE_COUNT || count > MAX_PURCHASE_PER_REQUEST) {
      return {
        ok: false,
        code: 'INVALID_TICKET_COUNT',
        message: `Aantal loten per aankoop moet tussen ${MIN_PURCHASE_COUNT} en ${MAX_PURCHASE_PER_REQUEST.toLocaleString()} liggen.`
      };
    }

    const totalCost = count * TICKET_PRICE;
    const deductRes = this.playerManager.deductChips(playerId, totalCost);
    if (!deductRes || !deductRes.success) {
      return {
        ok: false,
        code: 'INSUFFICIENT_FUNDS',
        message: `Onvoldoende fiches. ${count} lot${count > 1 ? 'en' : ''} kost ${totalCost.toLocaleString()} fiches.`
      };
    }

    const startTicket = this.totalTickets;
    const endTicket = startTicket + count - 1;
    const range = {
      startTicket,
      endTicket,
      count,
      playerId: player.id,
      playerName: player.name,
      playerColor: player.color || '#D4AF37'
    };

    this.ranges.push(range);
    this.totalTickets += count;
    this.pot = Math.round(this.totalTickets * TICKET_PRICE * (1 - HOUSE_FEE_RATE));
    this._recordParticipantRange(range);
    this.saveStateSync();
    if (this.playerManager && typeof this.playerManager.flushToDiskSync === 'function') {
      this.playerManager.flushToDiskSync();
    }

    const state = this.getPublicState(player.id);
    this.emit('state', state);

    return {
      ok: true,
      roundId: this.roundId,
      roundEndsAt: this.roundEndsAt,
      playerId: player.id,
      playerName: player.name,
      count,
      totalCost,
      startTicket: startTicket + 1,
      endTicket: endTicket + 1,
      pot: this.pot,
      totalTickets: this.totalTickets,
      remainingChips: deductRes.chips,
      mySummary: state.mySummary,
      state
    };
  }

  /**
   * Executes weighted random draw at round expiration.
   * Handles empty rounds (0 tickets) and single-buyer refunds cleanly.
   * @param {number} [now=Date.now()]
   * @param {Object} [drawOpts={}]
   */
  _executeDraw(now = Date.now(), drawOpts = {}) {
    if (this.settledRoundIds && this.settledRoundIds.has(this.roundId)) {
      return;
    }
    if (this.totalTickets <= 0 || this.ranges.length === 0) {
      this._startNextRound(now, {
        offlineAnchorEndsAt: drawOpts.scheduledEndsAt,
        skipBroadcast: drawOpts.skipBroadcast
      });
      return;
    }

    this._recordSettledRoundId(this.roundId);

    const rFloat = Math.min(0.999999999999, Math.max(0, Number(this.rng()) || 0));
    const winningTicketIdx = Math.floor(rFloat * this.totalTickets);
    const winningRange = findRangeForTicketIndex(this.ranges, winningTicketIdx) || this.ranges[0];

    const winnerParticipant = this.participants.get(winningRange.playerId) || {
      playerId: winningRange.playerId,
      playerName: winningRange.playerName,
      playerColor: winningRange.playerColor,
      monogram: getLotteryMonogram(winningRange.playerName),
      tickets: winningRange.count,
      totalSpent: winningRange.count * TICKET_PRICE
    };

    const payout = this.pot;
    const netProfit = Math.max(0, payout - (winnerParticipant.totalSpent || 0));
    const { sharePct } = computePlayerOdds(winnerParticipant.tickets, this.totalTickets);

    const forceWinnerOffline = Boolean(
      drawOpts.forceOfflineForPlayerId && drawOpts.forceOfflineForPlayerId === winningRange.playerId
    );
    const creditRes = this._creditWinner(
      winningRange.playerId,
      winnerParticipant.playerName,
      payout,
      this.roundId,
      { forceOffline: forceWinnerOffline }
    );
    const resolvedWinnerId = creditRes.resolvedPlayerId || winningRange.playerId;

    if (!creditRes.wasOfflineAccountStatsUpdated && this.playerManager && typeof this.playerManager.updatePlayerStats === 'function') {
      this.playerManager.updatePlayerStats(resolvedWinnerId, { wonAmount: payout });
    }
    if (this.playerManager && typeof this.playerManager.updatePlayerStats === 'function') {
      for (const part of this.participants.values()) {
        if (!part || !part.playerId || part.playerId === resolvedWinnerId) continue;
        this.playerManager.updatePlayerStats(part.playerId, { wonAmount: 0 });
      }
    }

    let repayments = [];
    if (netProfit > 0 && this.bankManager && typeof this.bankManager.processWinRepayment === 'function') {
      const repRes = this.bankManager.processWinRepayment(resolvedWinnerId, netProfit);
      if (Array.isArray(repRes)) {
        repayments = repRes;
      }
    }

    const reelEntries = buildRaffleReelEntries(
      this.ranges,
      winningRange,
      winningTicketIdx,
      this.totalTickets,
      this.rng,
      64,
      52
    );

    const drawResult = {
      roundId: this.roundId,
      winningTicketIndex: winningTicketIdx,
      winningTicketDisplay: winningTicketIdx + 1,
      winnerId: winningRange.playerId,
      winnerName: winnerParticipant.playerName,
      winnerColor: winnerParticipant.playerColor || '#D4AF37',
      winnerMonogram: getLotteryMonogram(winnerParticipant.playerName),
      winnerTickets: winnerParticipant.tickets,
      winnerSpent: winnerParticipant.totalSpent,
      winnerOddsPct: sharePct,
      totalTickets: this.totalTickets,
      uniqueParticipants: this.participants.size,
      potWon: payout,
      netProfit,
      repayments,
      winnerNewChips: creditRes.newChips,
      winnerWasOffline: creditRes.wasOffline,
      reelEntries,
      winnerSlot: 52,
      drawnAt: now
    };

    if (creditRes.wasOffline) {
      if (!this.unseenOfflineWins) this.unseenOfflineWins = new Map();
      const winKey = String(winnerParticipant.playerName || winningRange.playerId || '').trim().toLowerCase();
      if (winKey) {
        this.unseenOfflineWins.set(winKey, {
          roundId: this.roundId,
          winnerId: winningRange.playerId,
          winnerName: winnerParticipant.playerName,
          potWon: payout,
          netProfit,
          winningTicketDisplay: winningTicketIdx + 1,
          winnerOddsPct: sharePct,
          newChips: creditRes.newChips,
          repayments,
          drawnAt: now
        });
      }
    }

    if (!this.unseenOfflineOutcomes) this.unseenOfflineOutcomes = new Map();
    for (const part of this.participants.values()) {
      if (!part || part.playerId === winningRange.playerId) continue;
      const pNameKey = String(part.playerName || '').trim().toLowerCase();
      if (pNameKey && winnerParticipant.playerName && pNameKey === String(winnerParticipant.playerName).trim().toLowerCase()) {
        continue;
      }
      const liveP = (this.playerManager && typeof this.playerManager.getPlayerById === 'function')
        ? this.playerManager.getPlayerById(part.playerId)
        : null;
      const isPartOffline = !liveP || !liveP.connected || drawOpts.forceOfflineForPlayerId === part.playerId;
      if (isPartOffline) {
        const key = `${this.roundId}:${pNameKey || part.playerId}`;
        this.unseenOfflineOutcomes.set(key, {
          roundId: this.roundId,
          playerId: part.playerId,
          playerName: part.playerName,
          winnerName: drawResult.winnerName,
          winnerColor: drawResult.winnerColor,
          winningTicketDisplay: drawResult.winningTicketDisplay,
          potWon: drawResult.potWon,
          myTickets: part.tickets,
          mySpent: part.totalSpent,
          drawnAt: now
        });
      }
    }
    while (this.unseenOfflineOutcomes.size > 50) {
      const oldestKey = this.unseenOfflineOutcomes.keys().next().value;
      this.unseenOfflineOutcomes.delete(oldestKey);
    }

    if (this.playerManager && typeof this.playerManager.flushToDiskSync === 'function') {
      this.playerManager.flushToDiskSync();
    }

    const scheduledEndsAt = (typeof drawOpts.scheduledEndsAt === 'number' && Number.isFinite(drawOpts.scheduledEndsAt) && drawOpts.scheduledEndsAt > 0)
      ? drawOpts.scheduledEndsAt
      : now;

    this.phase = PHASES.DRAWING;
    this.drawEndsAt = scheduledEndsAt + this.drawRevealMs;
    this.lastDraw = drawResult;

    this.history.unshift({
      roundId: this.roundId,
      winnerId: drawResult.winnerId,
      winnerName: drawResult.winnerName,
      winnerColor: drawResult.winnerColor,
      winnerTickets: drawResult.winnerTickets,
      totalTickets: drawResult.totalTickets,
      winnerOddsPct: drawResult.winnerOddsPct,
      potWon: drawResult.potWon,
      winningTicketDisplay: drawResult.winningTicketDisplay,
      drawnAt: now
    });
    if (this.history.length > HISTORY_LIMIT) {
      this.history.length = HISTORY_LIMIT;
    }

    this.saveStateSync();

    if (!drawOpts.skipBroadcast) {
      this.emit('draw_result', drawResult);
      this.emit('state', this.getPublicState(null));
    }
  }

  /**
   * Credits prize pot to winner whether currently connected or offline (stored in accounts),
   * and records a Bank inbox notification if offline so they see their win on reconnect.
   * @private
   */
  _creditWinner(winnerId, winnerName, payout, roundId, opts = {}) {
    if (!this.playerManager || payout <= 0) {
      return { newChips: null, wasOffline: true };
    }

    const forceOffline = Boolean(opts && opts.forceOffline);
    const livePlayer = typeof this.playerManager.getPlayerById === 'function'
      ? this.playerManager.getPlayerById(winnerId)
      : null;

    if (livePlayer) {
      const addRes = this.playerManager.addChips(winnerId, payout);
      const isOffline = forceOffline || !livePlayer.connected;
      if (isOffline) {
        this._queueOfflineWinNotice(livePlayer, payout, roundId);
      }
      return {
        newChips: addRes && typeof addRes.chips === 'number' ? addRes.chips : livePlayer.chips,
        wasOffline: isOffline,
        resolvedPlayerId: livePlayer.id,
        wasOfflineAccountStatsUpdated: false
      };
    }

    // Fallback: locate saved account on disk/memory when player is not active since server restart
    const normWinnerName = String(winnerName || '').trim().toLowerCase();
    let matchedAcc = null;
    if (this.playerManager.accounts && typeof this.playerManager.accounts.values === 'function') {
      for (const acc of this.playerManager.accounts.values()) {
        if (!acc) continue;
        if (acc.id === winnerId ||
            (normWinnerName && ((acc.usernameKey || '').toLowerCase() === normWinnerName || (acc.name || '').toLowerCase() === normWinnerName))) {
          matchedAcc = acc;
          break;
        }
      }
    }

    if (matchedAcc) {
      matchedAcc.chips = (matchedAcc.chips || 0) + payout;
      if (!matchedAcc.stats || typeof matchedAcc.stats !== 'object') {
        matchedAcc.stats = { roundsPlayed: 0, totalWon: 0, biggestWin: 0 };
      }
      matchedAcc.stats.roundsPlayed = (matchedAcc.stats.roundsPlayed || 0) + 1;
      matchedAcc.stats.totalWon = (matchedAcc.stats.totalWon || 0) + payout;
      matchedAcc.stats.biggestWin = Math.max(matchedAcc.stats.biggestWin || 0, payout);
      if (typeof this.playerManager.scheduleSave === 'function') {
        this.playerManager.scheduleSave();
      }
      if (typeof this.playerManager.saveAccounts === 'function') {
        this.playerManager.saveAccounts();
      }
      this._queueOfflineWinNotice(matchedAcc, payout, roundId);
      return {
        newChips: matchedAcc.chips,
        wasOffline: true,
        resolvedPlayerId: matchedAcc.id,
        wasOfflineAccountStatsUpdated: true
      };
    }

    return { newChips: null, wasOffline: true, resolvedPlayerId: winnerId, wasOfflineAccountStatsUpdated: false };
  }

  /** @private */
  _resolveOfflineWinKey(playerId, playerName) {
    if (!this.unseenOfflineWins || this.unseenOfflineWins.size === 0) return null;
    const normName = String(playerName || '').trim().toLowerCase();
    if (normName && this.unseenOfflineWins.has(normName)) {
      return normName;
    }
    for (const [k, rec] of this.unseenOfflineWins.entries()) {
      if (!rec) continue;
      if ((playerId && rec.winnerId === playerId) || (normName && String(rec.winnerName || '').trim().toLowerCase() === normName)) {
        return k;
      }
    }
    return null;
  }

  hasPendingOfflineWin(playerId, playerName = null) {
    return Boolean(this._resolveOfflineWinKey(playerId, playerName));
  }

  getPendingOfflineWin(playerId, playerName = null) {
    const k = this._resolveOfflineWinKey(playerId, playerName);
    return k ? { ...this.unseenOfflineWins.get(k) } : null;
  }

  acknowledgeOfflineWin(playerId, playerName = null, roundId = null) {
    const k = this._resolveOfflineWinKey(playerId, playerName);
    if (!k) return false;
    const rec = this.unseenOfflineWins.get(k);
    if (roundId != null && rec && Number(roundId) !== Number(rec.roundId)) return false;
    this.unseenOfflineWins.delete(k);
    this._scheduleSave();
    return true;
  }

  /** @private */
  _resolveOfflineOutcomeKey(playerId, playerName) {
    if (!this.unseenOfflineOutcomes || this.unseenOfflineOutcomes.size === 0) return null;
    const normName = String(playerName || '').trim().toLowerCase();
    for (const [k, rec] of this.unseenOfflineOutcomes.entries()) {
      if (!rec) continue;
      if ((playerId && rec.playerId === playerId) ||
          (normName && String(rec.playerName || '').trim().toLowerCase() === normName)) {
        return k;
      }
    }
    return null;
  }

  hasPendingOfflineOutcome(playerId, playerName = null) {
    return Boolean(this._resolveOfflineOutcomeKey(playerId, playerName));
  }

  getPendingOfflineOutcome(playerId, playerName = null) {
    const k = this._resolveOfflineOutcomeKey(playerId, playerName);
    return k ? { ...this.unseenOfflineOutcomes.get(k) } : null;
  }

  acknowledgeOfflineOutcome(playerId, playerName = null, roundId = null) {
    const k = this._resolveOfflineOutcomeKey(playerId, playerName);
    if (!k) return false;
    const rec = this.unseenOfflineOutcomes.get(k);
    if (roundId != null && rec && Number(roundId) !== Number(rec.roundId)) return false;
    this.unseenOfflineOutcomes.delete(k);
    this._scheduleSave();
    return true;
  }

  /** @private */
  _queueOfflineWinNotice(targetPlayer, payout, roundId) {
    if (!this.bankManager || typeof this.bankManager._addInboxNotification !== 'function') return;
    this.bankManager._addInboxNotification(targetPlayer, {
      id: `lottery_win_${roundId}_${Date.now()}`,
      type: 'donation',
      fromId: 'STAATSLOTERIJ',
      fromName: 'Casino Staatsloterij',
      toId: targetPlayer.id,
      toName: targetPlayer.name,
      toKey: (targetPlayer.usernameKey || targetPlayer.name || '').trim().toLowerCase(),
      amount: payout,
      message: `Gefeliciteerd! Je won +${payout.toLocaleString()} fiches in Staatsloterij Ronde #${roundId}!`,
      timestamp: Date.now()
    });
  }

  /**
   * Starts a fresh 10-minute lottery round with zero carried-over tickets.
   * Advances missed cycles cleanly on wall-clock schedule when recovering from downtime.
   * @param {number} [now=Date.now()]
   * @param {Object} [opts={}]
   */
  _startNextRound(now = Date.now(), opts = {}) {
    const anchor = (opts && typeof opts.offlineAnchorEndsAt === 'number' && Number.isFinite(opts.offlineAnchorEndsAt) && opts.offlineAnchorEndsAt > 0)
      ? opts.offlineAnchorEndsAt
      : null;

    if (anchor && (now - anchor) >= this.drawRevealMs) {
      const elapsedMs = Math.max(0, now - anchor);
      const missedCycles = Math.floor(elapsedMs / this.roundDurationMs);
      const stepCount = 1 + missedCycles;
      const candidateEndsAt = anchor + stepCount * this.roundDurationMs;
      this.roundId += stepCount;
      this.roundEndsAt = (candidateEndsAt - now) >= 50 ? candidateEndsAt : (now + this.roundDurationMs);
    } else {
      this.roundId += 1;
      this.roundEndsAt = now + this.roundDurationMs;
    }

    this.phase = PHASES.OPEN;
    this.drawEndsAt = 0;
    this.ranges = [];
    this.totalTickets = 0;
    this.pot = 0;
    this.participants.clear();

    this.saveStateSync();
    if (!opts || !opts.skipBroadcast) {
      this.emit('state', this.getPublicState(null));
    }
  }

  /**
   * Restores an unsettled lottery stake from client localStorage backup if the server restarted
   * without persisted lottery.json (e.g., ephemeral cloud sleep or restart), and settles immediately
   * if the round deadline already passed while offline.
   * @param {Object} player
   * @param {Object} rawBackup
   * @param {number} [now=Date.now()]
   */
  restoreFromBackup(player, rawBackup, now = Date.now()) {
    if (!player || !player.id || !rawBackup || typeof rawBackup !== 'object') {
      return { restored: false, alreadySettled: false, drawExecuted: false, resolvedRoundId: null };
    }
    const stake = (rawBackup.activeStake && typeof rawBackup.activeStake === 'object')
      ? rawBackup.activeStake
      : rawBackup;

    const roundId = Number(stake.roundId);
    const tickets = Number(stake.tickets);
    const totalSpent = Number(stake.totalSpent);
    const roundEndsAt = Number(stake.roundEndsAt);

    if (!Number.isInteger(roundId) || roundId < 1 || roundId > 10000000) {
      return { restored: false, alreadySettled: false, drawExecuted: false, resolvedRoundId: null };
    }
    if (!Number.isInteger(tickets) || tickets < MIN_PURCHASE_COUNT || tickets > 100000) {
      return { restored: false, alreadySettled: false, drawExecuted: false, resolvedRoundId: null };
    }
    if (!Number.isInteger(totalSpent) || totalSpent !== tickets * TICKET_PRICE) {
      return { restored: false, alreadySettled: false, drawExecuted: false, resolvedRoundId: null };
    }
    if (!Number.isFinite(roundEndsAt) || roundEndsAt <= 0) {
      return { restored: false, alreadySettled: false, drawExecuted: false, resolvedRoundId: null };
    }
    if ((now - roundEndsAt) > 7 * 24 * 60 * 60 * 1000 || roundEndsAt > now + this.roundDurationMs + 5000) {
      return { restored: false, alreadySettled: true, drawExecuted: false, resolvedRoundId: roundId };
    }

    const normPlayerName = String(player.usernameKey || player.name || '').trim().toLowerCase();
    const normStakeName = String(stake.playerName || '').trim().toLowerCase();
    if (normStakeName && normPlayerName && normStakeName !== normPlayerName) {
      return { restored: false, alreadySettled: false, drawExecuted: false, resolvedRoundId: null };
    }
    if (!normStakeName && stake.playerId && stake.playerId !== player.id) {
      return { restored: false, alreadySettled: false, drawExecuted: false, resolvedRoundId: null };
    }

    const claimKey = `${normPlayerName || player.id}:${roundId}:${roundEndsAt}`;
    if (this.restoredClaimKeys && this.restoredClaimKeys.has(claimKey)) {
      return { restored: false, alreadySettled: true, drawExecuted: false, resolvedRoundId: roundId };
    }

    const inHistory = this.history.some((h) => h && Number(h.roundId) === roundId);
    const hasAuthoritativeHistory = (this.settledRoundIds && this.settledRoundIds.size > 0) ||
      this.history.length > 0 ||
      this.loadedFromDisk;
    if ((this.settledRoundIds && this.settledRoundIds.has(roundId)) ||
        inHistory ||
        (hasAuthoritativeHistory && this.roundId > roundId)) {
      this._recordRestoredClaimKey(claimKey);
      return { restored: false, alreadySettled: true, drawExecuted: false, resolvedRoundId: roundId };
    }

    if (this.loadedFromDisk && this.settledRoundIds && this.settledRoundIds.size > 0 && !this._hasParticipantInRound(player.id, player.name)) {
      return { restored: false, alreadySettled: true, drawExecuted: false, resolvedRoundId: roundId };
    }

    if (this._hasParticipantInRound(player.id, player.name)) {
      this._recordRestoredClaimKey(claimKey);
      return { restored: false, alreadySettled: false, drawExecuted: false, resolvedRoundId: roundId };
    }

    this._recordRestoredClaimKey(claimKey);

    if (this.totalTickets === 0) {
      this.roundId = roundId;
      this.phase = PHASES.OPEN;
      this.roundEndsAt = roundEndsAt > now
        ? Math.min(roundEndsAt, now + this.roundDurationMs)
        : roundEndsAt;
      this.drawEndsAt = 0;
    } else if (roundEndsAt < this.roundEndsAt) {
      this.roundEndsAt = roundEndsAt;
    }

    const startTicket = this.totalTickets;
    const endTicket = startTicket + tickets - 1;
    const range = {
      startTicket,
      endTicket,
      count: tickets,
      playerId: player.id,
      playerName: player.name,
      playerColor: player.color || '#D4AF37'
    };

    this.ranges.push(range);
    this.totalTickets += tickets;
    this.pot = Math.round(this.totalTickets * TICKET_PRICE * (1 - HOUSE_FEE_RATE));
    this._recordParticipantRange(range);

    let drawExecuted = false;
    if (now >= this.roundEndsAt && this.phase === PHASES.OPEN && !this.settledRoundIds.has(this.roundId)) {
      const scheduledEndsAt = this.roundEndsAt;
      this._executeDraw(now, {
        scheduledEndsAt,
        forceOfflineForPlayerId: player.id,
        skipBroadcast: true
      });
      drawExecuted = true;
      if (now >= this.drawEndsAt) {
        this._startNextRound(now, { offlineAnchorEndsAt: scheduledEndsAt, skipBroadcast: true });
      }
    } else {
      this.saveStateSync();
    }

    return {
      restored: true,
      alreadySettled: drawExecuted,
      drawExecuted,
      resolvedRoundId: drawExecuted ? roundId : null
    };
  }

  /**
   * Returns sanitized public lottery state, plus private `mySummary` when `viewerPlayerId` is given.
   * @param {string|null} [viewerPlayerId=null]
   * @param {number} [now=Date.now()]
   * @param {Object} [extras={}]
   * @returns {Object}
   */
  getPublicState(viewerPlayerId = null, now = Date.now(), extras = {}) {
    const participantsList = Array.from(this.participants.values())
      .map((p) => {
        const { sharePct } = computePlayerOdds(p.tickets, this.totalTickets);
        return {
          playerId: p.playerId,
          playerName: p.playerName,
          playerColor: p.playerColor,
          monogram: p.monogram,
          tickets: p.tickets,
          totalSpent: p.totalSpent,
          sharePct
        };
      })
      .sort((a, b) => (b.tickets - a.tickets) || a.playerName.localeCompare(b.playerName));

    const liveViewer = (viewerPlayerId && this.playerManager && typeof this.playerManager.getPlayerById === 'function')
      ? this.playerManager.getPlayerById(viewerPlayerId)
      : null;

    let mySummary = {
      tickets: 0,
      totalSpent: 0,
      sharePct: 0,
      ranges: []
    };
    const mine = viewerPlayerId
      ? this._findParticipant(viewerPlayerId, liveViewer ? liveViewer.name : null)
      : null;
    if (mine) {
      const { sharePct } = computePlayerOdds(mine.tickets, this.totalTickets);
      mySummary = {
        tickets: mine.tickets,
        totalSpent: mine.totalSpent,
        sharePct,
        ranges: mine.ranges.map((r) => ({ ...r }))
      };
    }

    const tick = this.getTickPayload(now);
    const myPendingOfflineWin = viewerPlayerId
      ? this.getPendingOfflineWin(viewerPlayerId, liveViewer ? liveViewer.name : null)
      : null;
    const myPendingOfflineOutcome = viewerPlayerId
      ? this.getPendingOfflineOutcome(viewerPlayerId, liveViewer ? liveViewer.name : null)
      : null;

    return {
      roundId: this.roundId,
      phase: this.phase,
      secondsRemaining: tick.secondsRemaining,
      roundEndsAt: this.roundEndsAt,
      drawEndsAt: this.drawEndsAt,
      roundDurationSec: Math.round(this.roundDurationMs / 1000),
      ticketPrice: TICKET_PRICE,
      houseEdgePct: HOUSE_FEE_RATE * 100,
      pot: this.pot,
      totalTickets: this.totalTickets,
      uniqueParticipants: this.participants.size,
      participants: participantsList,
      mySummary,
      myPendingOfflineWin,
      myPendingOfflineOutcome,
      settledRoundIds: this.settledRoundIds ? Array.from(this.settledRoundIds).slice(-30) : [],
      backupClaimResolvedRoundId: extras && extras.resolvedRoundId != null ? extras.resolvedRoundId : null,
      lastDraw: this.lastDraw,
      history: this.history
    };
  }
}

module.exports = LotteryEngine;
