/**
 * lotteryEngine.js
 * Server-authoritative Monte Carlo Gouden Krasloten Engine (replaces scheduled Staatsloterij).
 *
 * Economic Model:
 *  - Every 1.000 F kraslot adds 100% (1.000 F) directly into the shared Krasloten-pot.
 *  - Every net casino loss by any player feeds 1% (`LOSS_CONTRIBUTION_RATE = 0.01`) into `this.pot`.
 *  - Players scratch 3x3 gold-foil cards for a chance to win 100% of the pot (jackpot!), 25%, 10%, 4%, or 500 F.
 *  - When 100% Jackpot hits, the pot re-seeds to `RESET_FLOOR_POT = 5.000 F`.
 *  - Persistent state saved atomically to `lottery.json` (excluding test runs).
 *
 * Strict Guardrails: Zero audio, zero Unicode emojis, zero banned brand terms.
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const {
  TICKET_PRICE,
  INITIAL_POT,
  RESET_FLOOR_POT,
  MIN_POT_AFTER_PARTIAL,
  LOSS_CONTRIBUTION_RATE,
  HOUSE_FEE_RATE,
  MIN_PURCHASE_COUNT,
  MAX_PURCHASE_PER_REQUEST,
  ROUND_DURATION_MS,
  DRAW_REVEAL_MS,
  HISTORY_LIMIT,
  PERSONAL_HISTORY_LIMIT,
  PHASES,
  WINNING_SYMBOL_TIERS,
  getLotteryMonogram,
  pickScratchTier,
  calculateTierPayout,
  buildScratchGrid
} = require('./lotteryConstants');

class LotteryEngine extends EventEmitter {
  /**
   * @param {import('./playerManager')} playerManager
   * @param {Object} [options={}]
   * @param {import('./bankManager')|null} [options.bankManager=null]
   * @param {Function} [options.rng=Math.random]
   * @param {string|false} [options.storagePath]
   * @param {number} [options.debounceMs=300]
   * @param {number} [options.initialPot=INITIAL_POT]
   */
  constructor(playerManager, options = {}) {
    super();
    this.playerManager = playerManager;
    this.bankManager = options.bankManager || null;
    this.rng = typeof options.rng === 'function' ? options.rng : Math.random;

    this.roundDurationMs = Math.max(50, Number(options.roundDurationMs) || ROUND_DURATION_MS);
    this.drawRevealMs = Math.max(50, Number(options.drawRevealMs) || DRAW_REVEAL_MS);
    this.debounceMs = Math.max(0, Number(options.debounceMs ?? 300));
    this.initialPot = Number.isInteger(options.initialPot) && options.initialPot >= 0 ? options.initialPot : INITIAL_POT;

    const isTestEnv = process.env.NODE_ENV === 'test' ||
      process.execArgv.includes('--test') ||
      process.argv.some((arg) => arg.includes('--test') || arg.includes('.test.js'));

    /** @type {string|false} */
    this.storagePath = options.storagePath !== undefined
      ? options.storagePath
      : (isTestEnv ? false : path.join(__dirname, '..', 'data', 'lottery.json'));

    this.roundId = 1;
    this.phase = PHASES.READY;
    this.pot = this.initialPot;
    this.totalTickets = 0;
    this.totalLossContributions = 0;
    this.totalPaidOut = 0;
    this.ticketSeq = 0;
    this.history = [];
    this.lastDraw = null;

    /** @type {Map<string, Array<Object>>} playerKey -> personal scratch ticket history */
    this.personalHistory = new Map();

    // Retained for socket compatibility (krasloten resolves immediately, so participant map stays empty)
    this.participants = new Map();

    this.loadedFromDisk = false;
    this._saveTimer = null;
    this._isRunning = false;

    this.loadState();

    // Hook casino net-loss callback onto PlayerManager so 1% of every net loss feeds the pot
    if (this.playerManager && typeof this.playerManager === 'object') {
      this.playerManager.onHouseNetLoss = (lostAmount) => {
        this.addLossContribution(lostAmount);
      };
    }
  }

  _getPlayerKey(player) {
    if (!player) return '';
    return String(player.usernameKey || player.name || player.id || '').trim().toLowerCase();
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

      if (data.mode === 'KRASLOTEN') {
        if (Number.isInteger(data.pot) && data.pot >= RESET_FLOOR_POT) {
          this.pot = data.pot;
        }
        if (Number.isInteger(data.totalTickets) && data.totalTickets >= 0) {
          this.totalTickets = data.totalTickets;
        }
        if (Number.isInteger(data.totalLossContributions) && data.totalLossContributions >= 0) {
          this.totalLossContributions = data.totalLossContributions;
        }
        if (Number.isInteger(data.totalPaidOut) && data.totalPaidOut >= 0) {
          this.totalPaidOut = data.totalPaidOut;
        }
        if (Number.isInteger(data.ticketSeq) && data.ticketSeq >= 0) {
          this.ticketSeq = data.ticketSeq;
        }
        if (Array.isArray(data.history)) {
          this.history = data.history.slice(0, HISTORY_LIMIT);
        }
        if (data.lastDraw && typeof data.lastDraw === 'object') {
          this.lastDraw = data.lastDraw;
        }
        if (Array.isArray(data.personalHistory)) {
          for (const entry of data.personalHistory) {
            if (Array.isArray(entry) && entry[0] && Array.isArray(entry[1])) {
              this.personalHistory.set(String(entry[0]), entry[1].slice(0, PERSONAL_HISTORY_LIMIT));
            }
          }
        }
      }
    } catch (err) {
      console.error('[LotteryEngine/Krasloten] Failed to load state:', err.message);
    }
  }

  _serializeState() {
    return JSON.stringify({
      mode: 'KRASLOTEN',
      pot: this.pot,
      totalTickets: this.totalTickets,
      totalLossContributions: this.totalLossContributions,
      totalPaidOut: this.totalPaidOut,
      ticketSeq: this.ticketSeq,
      history: this.history.slice(0, HISTORY_LIMIT),
      lastDraw: this.lastDraw,
      personalHistory: Array.from(this.personalHistory.entries()).slice(-100)
    }, null, 2);
  }

  scheduleSave() {
    if (!this.storagePath) return;
    if (this.debounceMs <= 0) {
      this.saveStateSync();
      return;
    }
    if (!this._saveTimer) {
      this._saveTimer = setTimeout(() => {
        this._saveTimer = null;
        this.saveStateSync();
      }, this.debounceMs);
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
      const tmpPath = `${this.storagePath}.tmp.${process.pid}.${Date.now()}`;
      fs.writeFileSync(tmpPath, this._serializeState(), 'utf8');
      fs.renameSync(tmpPath, this.storagePath);
    } catch (err) {
      console.error('[LotteryEngine/Krasloten] Failed to save state:', err.message);
    }
  }

  start() {
    this._isRunning = true;
  }

  stop() {
    this._isRunning = false;
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this.saveStateSync();
  }

  tick() {
    // Instant scratch cards do not wait for scheduled countdown draws.
  }

  /**
   * Feeds 1% (`LOSS_CONTRIBUTION_RATE`) of a player's net loss from any casino game
   * into the shared Krasloten-pot and broadcasts updated pot state.
   * @param {number} netLossAmount Positive chip net loss (> 0)
   * @returns {number} Exact chips added to the pot
   */
  addLossContribution(netLossAmount) {
    if (typeof netLossAmount !== 'number' || !Number.isFinite(netLossAmount) || netLossAmount <= 0) {
      return 0;
    }
    const added = Math.max(1, Math.round(netLossAmount * LOSS_CONTRIBUTION_RATE));
    this.pot += added;
    this.totalLossContributions += added;
    this.scheduleSave();
    this.emit('state', this.getPublicState(null));
    return added;
  }

  _recordPersonalTicket(player, summary) {
    const key = this._getPlayerKey(player);
    if (!key) return;
    if (!this.personalHistory.has(key)) {
      this.personalHistory.set(key, []);
    }
    const list = this.personalHistory.get(key);
    list.unshift(summary);
    if (list.length > PERSONAL_HISTORY_LIMIT) {
      list.length = PERSONAL_HISTORY_LIMIT;
    }
  }

  /**
   * Purchases & immediately resolves `count` (1..25) Gouden Krasloten for `playerId`.
   * 100% of every 1.000 F ticket goes into `this.pot` before drawing the prize tier.
   * @param {string} playerId
   * @param {number} [count=1]
   * @returns {Object}
   */
  buyTickets(playerId, count = 1) {
    const player = this.playerManager ? this.playerManager.getPlayerById(playerId) : null;
    if (!player) {
      return { ok: false, code: 'PLAYER_NOT_FOUND', message: 'Log eerst in om een kraslot te kopen.' };
    }

    const cleanCount = Number(count);
    if (!Number.isInteger(cleanCount) || cleanCount < MIN_PURCHASE_COUNT || cleanCount > MAX_PURCHASE_PER_REQUEST) {
      return {
        ok: false,
        code: 'INVALID_TICKET_COUNT',
        message: `Kies een geldig aantal krasloten (${MIN_PURCHASE_COUNT}-${MAX_PURCHASE_PER_REQUEST}).`
      };
    }

    const totalCost = cleanCount * TICKET_PRICE;
    if (player.chips < totalCost) {
      return {
        ok: false,
        code: 'INSUFFICIENT_FUNDS',
        message: `Onvoldoende fiches (nodig: ${totalCost.toLocaleString()} F, saldo: ${player.chips.toLocaleString()} F).`
      };
    }

    const deductRes = this.playerManager.deductChips(playerId, totalCost);
    if (!deductRes || !deductRes.success) {
      return {
        ok: false,
        code: 'DEDUCT_FAILED',
        message: (deductRes && deductRes.reason) || 'Kon inzet niet afschrijven.'
      };
    }

    const tickets = [];
    let totalPayout = 0;
    let bestTicket = null;
    const monogram = getLotteryMonogram(player.name);

    for (let i = 0; i < cleanCount; i += 1) {
      // 100% of the kraslot price feeds directly into the shared pot
      this.pot += TICKET_PRICE;
      this.totalTickets += 1;
      this.ticketSeq += 1;
      this.roundId += 1;

      const potBeforeDraw = this.pot;
      const tier = pickScratchTier(this.rng);
      let payout = calculateTierPayout(tier, potBeforeDraw);

      if (tier.resetsPot) {
        payout = potBeforeDraw;
        this.pot = RESET_FLOOR_POT;
      } else if (payout > 0) {
        // Never allow non-jackpot payouts to empty the pot below a small playable buffer
        const maxPartial = Math.max(0, potBeforeDraw - MIN_POT_AFTER_PARTIAL);
        payout = potBeforeDraw <= MIN_POT_AFTER_PARTIAL ? Math.min(potBeforeDraw, payout) : Math.min(payout, maxPartial);
        this.pot = Math.max(tier.resetsPot ? RESET_FLOOR_POT : MIN_POT_AFTER_PARTIAL, potBeforeDraw - payout);
      }

      if (payout > 0) {
        this.totalPaidOut += payout;
      }

      const grid = buildScratchGrid(tier.id, potBeforeDraw, payout, this.rng);
      const ticketObj = {
        ticketId: `krs_${this.ticketSeq}_${Date.now()}`,
        ticketNumber: this.ticketSeq,
        playerId: player.id,
        playerName: player.name,
        playerColor: player.color || '#D4AF37',
        monogram,
        cost: TICKET_PRICE,
        tierId: tier.id,
        tierLabel: tier.label,
        tierShortLabel: tier.shortLabel,
        tierColor: tier.color,
        payout,
        won: payout > 0,
        potBeforeDraw,
        potAfterDraw: this.pot,
        grid,
        timestamp: Date.now()
      };

      tickets.push(ticketObj);
      totalPayout += payout;
      if (!bestTicket || ticketObj.payout >= bestTicket.payout) {
        bestTicket = ticketObj;
      }

      this._recordPersonalTicket(player, {
        ticketId: ticketObj.ticketId,
        ticketNumber: ticketObj.ticketNumber,
        tierId: ticketObj.tierId,
        tierLabel: ticketObj.tierLabel,
        tierShortLabel: ticketObj.tierShortLabel,
        payout: ticketObj.payout,
        cost: TICKET_PRICE,
        timestamp: ticketObj.timestamp
      });

      if (payout > 0) {
        const winEntry = {
          roundId: this.ticketSeq,
          ticketNumber: this.ticketSeq,
          winnerId: player.id,
          winnerName: player.name,
          winnerColor: player.color || '#D4AF37',
          winnerMonogram: monogram,
          tierId: tier.id,
          tierLabel: tier.label,
          potWon: payout,
          timestamp: ticketObj.timestamp
        };
        this.history.unshift(winEntry);
        if (this.history.length > HISTORY_LIMIT) {
          this.history.length = HISTORY_LIMIT;
        }
        this.lastDraw = winEntry;
      }
    }

    if (totalPayout > 0) {
      this.playerManager.addChips(playerId, totalPayout);
    }

    const netProfit = Math.max(0, totalPayout - totalCost);
    let repayments = [];
    if (netProfit > 0 && this.bankManager && typeof this.bankManager.processWinRepayment === 'function') {
      const repRes = this.bankManager.processWinRepayment(playerId, netProfit);
      if (Array.isArray(repRes)) {
        repayments = repRes;
      }
    }

    if (typeof this.playerManager.updatePlayerStats === 'function') {
      // Do NOT pass lostAmount here: 100% of TICKET_PRICE already entered this.pot directly
      this.playerManager.updatePlayerStats(playerId, { wonAmount: netProfit });
    }
    if (typeof this.playerManager._persistPlayer === 'function') {
      this.playerManager._persistPlayer(player);
    }

    this.saveStateSync();
    const state = this.getPublicState(playerId);
    this.emit('state', this.getPublicState(null));

    const highlightTicket = bestTicket && (bestTicket.tierId === 'JACKPOT_100' || bestTicket.tierId === 'POT_25' || bestTicket.tierId === 'POT_10' || totalPayout >= 2500)
      ? bestTicket
      : null;
    if (highlightTicket) {
      this.emit('draw_result', {
        roundId: highlightTicket.ticketNumber,
        winnerId: player.id,
        winnerName: player.name,
        winnerColor: player.color || '#D4AF37',
        tierId: highlightTicket.tierId,
        tierLabel: highlightTicket.tierLabel,
        potWon: bestTicket.payout > 0 ? totalPayout : highlightTicket.payout,
        remainingPot: this.pot,
        repayments
      });
    }

    const updatedPlayer = this.playerManager.getPlayerById(playerId) || player;
    const latestTicket = tickets[tickets.length - 1];
    const firstTicketNum = tickets[0].ticketNumber;
    const lastTicketNum = latestTicket.ticketNumber;

    return {
      ok: true,
      roundId: lastTicketNum,
      roundEndsAt: 0,
      playerId: player.id,
      playerName: player.name,
      count: cleanCount,
      totalCost,
      totalPayout,
      netProfit,
      pot: this.pot,
      startTicket: firstTicketNum,
      endTicket: lastTicketNum,
      totalTickets: this.totalTickets,
      remainingChips: updatedPlayer.chips,
      stats: updatedPlayer.stats ? { ...updatedPlayer.stats } : null,
      ticket: bestTicket && bestTicket.payout > 0 ? bestTicket : latestTicket,
      tickets,
      repayments,
      mySummary: state.mySummary,
      state
    };
  }

  // Legacy offline hooks kept as safe no-ops for socket.js compatibility
  hasPendingOfflineWin() { return false; }
  hasPendingOfflineOutcome() { return false; }
  acknowledgeOfflineWin() { return false; }
  acknowledgeOfflineOutcome() { return false; }
  restoreFromBackup() { return { restored: false, drawExecuted: false, resolvedRoundId: null }; }

  /**
   * Computes current live prize preview for each tier based on `this.pot`.
   */
  getLivePrizeTiers() {
    return WINNING_SYMBOL_TIERS.map((t) => ({
      id: t.id,
      label: t.label,
      shortLabel: t.shortLabel,
      badge: t.badge,
      symbolName: t.symbolName,
      color: t.color,
      chancePct: Math.round((t.weight / 10000) * 10000) / 100,
      currentPayout: calculateTierPayout(t, this.pot)
    }));
  }

  getPublicState(playerId = null) {
    const player = playerId && this.playerManager ? this.playerManager.getPlayerById(playerId) : null;
    const pKey = this._getPlayerKey(player);
    const myHistory = pKey && this.personalHistory.has(pKey)
      ? this.personalHistory.get(pKey).slice(0, PERSONAL_HISTORY_LIMIT)
      : [];

    const totalMySpent = myHistory.length * TICKET_PRICE;
    const totalMyWon = myHistory.reduce((s, t) => s + (Number(t.payout) || 0), 0);

    return {
      mode: 'KRASLOTEN',
      isPersonal: Boolean(player),
      roundId: this.ticketSeq + 1,
      phase: PHASES.READY,
      secondsRemaining: 600,
      roundEndsAt: 0,
      ticketPrice: TICKET_PRICE,
      initialPot: this.initialPot,
      resetFloorPot: RESET_FLOOR_POT,
      lossContributionRate: LOSS_CONTRIBUTION_RATE,
      houseEdgePct: Math.round(HOUSE_FEE_RATE * 10000) / 100,
      pot: this.pot,
      totalTickets: this.totalTickets,
      totalLossContributions: this.totalLossContributions,
      totalPaidOut: this.totalPaidOut,
      prizeTiers: this.getLivePrizeTiers(),
      uniqueParticipants: this.personalHistory.size,
      participants: myHistory,
      mySummary: {
        tickets: myHistory.length,
        totalSpent: totalMySpent,
        totalWon: totalMyWon,
        sharePct: 0,
        ranges: []
      },
      myHistory,
      myPendingOfflineWin: null,
      myPendingOfflineOutcome: null,
      lastDraw: this.lastDraw,
      history: this.history.slice(0, HISTORY_LIMIT)
    };
  }
}

module.exports = LotteryEngine;
module.exports.LotteryEngine = LotteryEngine;
