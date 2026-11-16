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

      this._rebuildAggregatesFromRanges();

      // Always resume in OPEN phase cleanly; preserve remaining time if round still active
      const now = Date.now();
      this.phase = PHASES.OPEN;
      this.drawEndsAt = 0;

      if (typeof data.roundEndsAt === 'number' && Number.isFinite(data.roundEndsAt)) {
        if (data.roundEndsAt > now) {
          this.roundEndsAt = Math.min(data.roundEndsAt, now + this.roundDurationMs);
        } else if (this.totalTickets > 0) {
          // Persisted active tickets whose round deadline passed while server was down: allow brief grace window before drawing on tick
          this.roundEndsAt = now;
        } else {
          this.roundId += 1;
          this.roundEndsAt = now + this.roundDurationMs;
        }
      } else {
        this.roundEndsAt = now + this.roundDurationMs;
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
        ranges: this.ranges,
        lastDraw: this.lastDraw,
        history: this.history.slice(0, HISTORY_LIMIT),
        unseenOfflineWins: this.unseenOfflineWins ? Array.from(this.unseenOfflineWins.entries()).slice(0, 50) : [],
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

  /**
   * Advances round lifecycle according to wall-clock timestamps and emits 1s ticks.
   * @param {number} [now=Date.now()]
   */
  tick(now = Date.now()) {
    if (this.phase === PHASES.OPEN) {
      if (now >= this.roundEndsAt) {
        this._executeDraw(now);
        return;
      }
      this.emit('tick', this.getTickPayload(now));
    } else if (this.phase === PHASES.DRAWING) {
      if (now >= this.drawEndsAt) {
        this._startNextRound(now);
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
   */
  _executeDraw(now = Date.now()) {
    if (this.totalTickets <= 0 || this.ranges.length === 0) {
      this._startNextRound(now);
      return;
    }

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

    const creditRes = this._creditWinner(
      winningRange.playerId,
      winnerParticipant.playerName,
      payout,
      this.roundId
    );
    const resolvedWinnerId = creditRes.resolvedPlayerId || winningRange.playerId;

    if (!creditRes.wasOfflineAccountStatsUpdated && this.playerManager && typeof this.playerManager.updatePlayerStats === 'function') {
      this.playerManager.updatePlayerStats(resolvedWinnerId, { wonAmount: payout });
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

    if (this.playerManager && typeof this.playerManager.flushToDiskSync === 'function') {
      this.playerManager.flushToDiskSync();
    }

    this.phase = PHASES.DRAWING;
    this.drawEndsAt = now + this.drawRevealMs;
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

    this.emit('draw_result', drawResult);
    this.emit('state', this.getPublicState(null));
  }

  /**
   * Credits prize pot to winner whether currently connected or offline (stored in accounts),
   * and records a Bank inbox notification if offline so they see their win on reconnect.
   * @private
   */
  _creditWinner(winnerId, winnerName, payout, roundId) {
    if (!this.playerManager || payout <= 0) {
      return { newChips: null, wasOffline: true };
    }

    const livePlayer = typeof this.playerManager.getPlayerById === 'function'
      ? this.playerManager.getPlayerById(winnerId)
      : null;

    if (livePlayer) {
      const addRes = this.playerManager.addChips(winnerId, payout);
      const isOffline = !livePlayer.connected;
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
   * @param {number} [now=Date.now()]
   */
  _startNextRound(now = Date.now()) {
    this.roundId += 1;
    this.phase = PHASES.OPEN;
    this.roundEndsAt = now + this.roundDurationMs;
    this.drawEndsAt = 0;
    this.ranges = [];
    this.totalTickets = 0;
    this.pot = 0;
    this.participants.clear();

    this.saveStateSync();
    this.emit('state', this.getPublicState(null));
  }

  /**
   * Returns sanitized public lottery state, plus private `mySummary` when `viewerPlayerId` is given.
   * @param {string|null} [viewerPlayerId=null]
   * @param {number} [now=Date.now()]
   * @returns {Object}
   */
  getPublicState(viewerPlayerId = null, now = Date.now()) {
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

    let mySummary = {
      tickets: 0,
      totalSpent: 0,
      sharePct: 0,
      ranges: []
    };
    if (viewerPlayerId && this.participants.has(viewerPlayerId)) {
      const mine = this.participants.get(viewerPlayerId);
      const { sharePct } = computePlayerOdds(mine.tickets, this.totalTickets);
      mySummary = {
        tickets: mine.tickets,
        totalSpent: mine.totalSpent,
        sharePct,
        ranges: mine.ranges.map((r) => ({ ...r }))
      };
    }

    const tick = this.getTickPayload(now);
    const liveViewer = (viewerPlayerId && this.playerManager && typeof this.playerManager.getPlayerById === 'function')
      ? this.playerManager.getPlayerById(viewerPlayerId)
      : null;
    const myPendingOfflineWin = viewerPlayerId
      ? this.getPendingOfflineWin(viewerPlayerId, liveViewer ? liveViewer.name : null)
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
      lastDraw: this.lastDraw,
      history: this.history
    };
  }
}

module.exports = LotteryEngine;
