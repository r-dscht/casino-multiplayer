/**
 * lottery.js
 * Frontend controller for Casino Staatsloterij (100% player pot, 0% house edge, 10-minute cycle).
 * Syncs top HUD timer/pot badge, live buy preview, offline backup/clock continuity,
 * dramatic 3-stage animated raffle drum reel with canvas sparks, participant odds bars, and history.
 *
 * Strict Guardrails: 100% Silent Mode (Zero Audio) and Zero Unicode Emojis.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CasinoLottery = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const TICKET_PRICE = 2500;
  const MAX_PER_REQUEST = 10000;

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatCountdown(seconds) {
    const clean = Math.max(0, Math.floor(Number(seconds) || 0));
    const mins = Math.floor(clean / 60);
    const secs = clean % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function formatCompactChips(amount) {
    const val = Math.max(0, Math.floor(Number(amount) || 0));
    if (val >= 1000000) {
      return `${(val / 1000000).toFixed(val % 1000000 === 0 ? 1 : 2)}M F`;
    }
    if (val >= 10000) {
      return `${Math.round(val / 1000).toLocaleString()}K F`;
    }
    return `${val.toLocaleString()} F`;
  }

  class CasinoLottery {
    /**
     * @param {Object} options
     * @param {Object} options.network
     * @param {Object} options.ui
     */
    constructor({ network, ui } = {}) {
      this.network = network || null;
      this.ui = ui || null;

      this.state = {
        roundId: 1,
        phase: 'OPEN',
        secondsRemaining: 600,
        roundEndsAt: 0,
        ticketPrice: TICKET_PRICE,
        houseEdgePct: 0,
        pot: 0,
        totalTickets: 0,
        uniqueParticipants: 0,
        participants: [],
        mySummary: { tickets: 0, totalSpent: 0, sharePct: 0, ranges: [] },
        myPendingOfflineWin: null,
        lastDraw: null,
        history: []
      };

      this._reelTimer = null;
      this._stageTimers = [];
      this._toastTimer = null;
      this._fxRaf = null;
      this._animatingDrawRoundId = null;
      this._localTickTimer = null;
      this._lastServerTickAt = 0;
      this._lastZeroRefreshAt = 0;
      this._announcedOfflineWinRounds = new Set();
      this._announcedOfflineOutcomeRounds = new Set();
      this._buyTimeout = null;
      this._pendingBuy = null;
      this._isBuying = false;

      this._loadOfflineBackup();
      this._cacheElements();
      this._bindEvents();
      this._bindNetworkEvents();
      this._startLocalClock();
      this.renderAll();
    }

    _cacheElements() {
      const byId = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);

      this.el = {
        btnOpen: byId('btn-open-lottery'),
        hudTimer: byId('hud-lottery-timer'),
        hudPot: byId('hud-lottery-pot'),
        modal: byId('lottery-modal'),
        btnClose: byId('btn-close-lottery-modal'),
        roundId: byId('lottery-round-id'),
        phasePill: byId('lottery-phase-pill'),
        timerVal: byId('lottery-timer-val'),
        potCounter: byId('lottery-jackpot-counter'),
        totalTickets: byId('lottery-total-tickets'),
        participantsCount: byId('lottery-participants-count'),
        drawStatus: byId('lottery-draw-status'),
        reelStage: byId('lottery-reel-stage'),
        fxCanvas: byId('lottery-fx-canvas'),
        reelTrack: byId('lottery-reel-track'),
        drawBanner: byId('lottery-draw-banner'),
        qtyInput: byId('lottery-qty-input'),
        btnQtyDec: byId('btn-lottery-qty-dec'),
        btnQtyInc: byId('btn-lottery-qty-inc'),
        btnBuy: byId('btn-buy-lottery-ticket'),
        previewCost: byId('lottery-preview-cost'),
        previewTickets: byId('lottery-preview-tickets'),
        previewOdds: byId('lottery-preview-odds'),
        myTickets: byId('lottery-my-tickets'),
        mySpent: byId('lottery-my-spent'),
        myOdds: byId('lottery-my-odds'),
        myRanges: byId('lottery-my-ranges'),
        participantsList: byId('lottery-participants-list'),
        historyList: byId('lottery-history-list')
      };

      this.presetBtns = typeof document !== 'undefined'
        ? Array.from(document.querySelectorAll('.lottery-preset-btn'))
        : [];
    }

    _bindEvents() {
      if (this.el.btnOpen) {
        this.el.btnOpen.addEventListener('click', () => this.open());
      }
      if (this.el.btnClose) {
        this.el.btnClose.addEventListener('click', () => this.close());
      }
      if (this.el.modal) {
        this.el.modal.addEventListener('click', (e) => {
          if (e.target === this.el.modal) this.close();
        });
      }
      if (typeof document !== 'undefined') {
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape' && this.isOpen()) {
            this.close();
          }
        });
      }

      if (this.el.qtyInput) {
        this.el.qtyInput.addEventListener('input', () => this.renderBuyPreview());
      }
      if (this.el.btnQtyDec) {
        this.el.btnQtyDec.addEventListener('click', () => this.adjustQuantity(-1));
      }
      if (this.el.btnQtyInc) {
        this.el.btnQtyInc.addEventListener('click', () => this.adjustQuantity(1));
      }

      this.presetBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          const val = btn.dataset.preset;
          if (val === 'max') {
            this.setMaxAffordableQuantity();
          } else {
            const parsed = Math.max(1, parseInt(val, 10) || 1);
            this.setQuantity(parsed);
          }
        });
      });

      if (this.el.btnBuy) {
        this.el.btnBuy.addEventListener('click', () => this.submitBuy());
      }
    }

    _bindNetworkEvents() {
      if (!this.network || typeof this.network.on !== 'function') return;

      this.network.on('lottery_state', (data) => {
        if (!data || typeof data !== 'object') return;
        this.applyState(data);
      });

      this.network.on('lottery_tick', (tick) => {
        if (!tick || typeof tick !== 'object') return;
        this._lastServerTickAt = Date.now();
        this.state.roundId = tick.roundId ?? this.state.roundId;
        this.state.phase = tick.phase || this.state.phase;
        this.state.secondsRemaining = typeof tick.secondsRemaining === 'number' ? tick.secondsRemaining : this.state.secondsRemaining;
        if (typeof tick.roundEndsAt === 'number') this.state.roundEndsAt = tick.roundEndsAt;
        this.state.pot = typeof tick.pot === 'number' ? tick.pot : this.state.pot;
        this.state.totalTickets = typeof tick.totalTickets === 'number' ? tick.totalTickets : this.state.totalTickets;
        this.state.uniqueParticipants = typeof tick.uniqueParticipants === 'number' ? tick.uniqueParticipants : this.state.uniqueParticipants;
        this._saveOfflineBackup();
        this.renderHeaderHud();
        this.renderTimerAndStats();
      });

      this.network.on('lottery_buy_ack', (ack) => {
        this._clearBuyLock(false);
        this._pendingBuy = null;
        if (!ack) {
          this.renderBuyPreview();
          return;
        }
        if (typeof ack.remainingChips === 'number' && this.ui && this.ui.myPlayer) {
          this.ui.myPlayer.chips = ack.remainingChips;
          this.ui.updatePlayerHUD();
        }
        if (this.ui && typeof this.ui.showToast === 'function') {
          const rangeText = ack.startTicket === ack.endTicket
            ? `Lot #${ack.startTicket}`
            : `Loten #${ack.startTicket}-${ack.endTicket}`;
          this.ui.showToast(`${ack.count}x lot gekocht (${rangeText}) voor ${(ack.totalCost || 0).toLocaleString()} fiches!`, 'success');
        }
        this.renderBuyPreview();
      });

      this.network.on('lottery_rejected', (err) => {
        if (err && err.code === 'PLAYER_NOT_FOUND' && this._pendingBuy && Date.now() <= this._pendingBuy.expiresAt) {
          return;
        }
        this._pendingBuy = null;
        this._clearBuyLock(true);
        if (this.ui && typeof this.ui.showToast === 'function' && err && err.reason) {
          this.ui.showToast(err.reason, 'error');
        }
      });

      this.network.on('connection_change', (data) => {
        if (!data || !data.connected) {
          const wasActive = this._isBuying || Boolean(this._pendingBuy);
          this._pendingBuy = null;
          this._clearBuyLock(true);
          if (wasActive && this.ui && typeof this.ui.showToast === 'function') {
            this.ui.showToast('Verbinding verbroken tijdens aankoop. Probeer zo opnieuw.', 'error');
          }
          return;
        }
        if (this.isOpen() && this.network && typeof this.network.requestLotteryState === 'function') {
          this.network.requestLotteryState();
        }
      });

      this.network.on('auth_success', () => {
        if (this.network && typeof this.network.requestLotteryState === 'function') {
          this.network.requestLotteryState();
        }
        const pending = this._pendingBuy;
        this._pendingBuy = null;
        if (pending && Date.now() <= pending.expiresAt) {
          this._clearBuyLock(false);
          this.submitBuy(pending.count);
        } else {
          this._clearBuyLock(true);
        }
      });

      const cancelAuthBuy = () => {
        this._pendingBuy = null;
        this._clearBuyLock(true);
      };
      this.network.on('auth_error', cancelAuthBuy);
      this.network.on('session_lost', cancelAuthBuy);
      this.network.on('session_required', () => {
        if (!this._pendingBuy) {
          this._clearBuyLock(true);
        }
      });
      this.network.on('error_msg', () => {
        if (this._isBuying && !this._pendingBuy) {
          this._clearBuyLock(true);
        }
      });

      this.network.on('lottery_draw_result', (res) => {
        if (!res) return;
        this.state.lastDraw = res;
        this.handleDrawResult(res);
      });
    }

    _clearBuyLock(shouldRender = true) {
      if (this._buyTimeout) {
        clearTimeout(this._buyTimeout);
        this._buyTimeout = null;
      }
      this._isBuying = false;
      if (shouldRender) {
        this.renderBuyPreview();
      }
    }

    _isNetworkConnected() {
      if (!this.network || typeof this.network.buyLotteryTickets !== 'function') return false;
      if ('isConnected' in this.network) {
        if (!this.network.isConnected) return false;
        if (this.network.socket && this.network.socket.connected === false) return false;
      }
      return true;
    }

    _isNetworkAuthenticated() {
      if (this.ui && this.ui.myPlayer && this.ui.myPlayer.id) return true;
      if (this.network && 'isAuthenticated' in this.network) {
        return Boolean(this.network.isAuthenticated);
      }
      return true;
    }

    isOpen() {
      return Boolean(this.el.modal && !this.el.modal.classList.contains('hidden'));
    }

    open() {
      if (!this.el.modal) return;
      if (this._isBuying && !this._buyTimeout) {
        this._clearBuyLock(false);
      }
      this.el.modal.classList.remove('hidden');
      if (this.network && typeof this.network.requestLotteryState === 'function') {
        this.network.requestLotteryState();
      }
      this.renderAll();
    }

    close() {
      if (!this.el.modal) return;
      this.el.modal.classList.add('hidden');
    }

    getMyChips() {
      return (this.ui && this.ui.myPlayer && typeof this.ui.myPlayer.chips === 'number')
        ? this.ui.myPlayer.chips
        : 0;
    }

    getQuantity() {
      const raw = this.el.qtyInput ? parseInt(this.el.qtyInput.value, 10) : 1;
      if (!Number.isInteger(raw) || raw < 1) return 1;
      return Math.min(MAX_PER_REQUEST, raw);
    }

    setQuantity(n) {
      const clamped = Math.max(1, Math.min(MAX_PER_REQUEST, Math.floor(Number(n) || 1)));
      if (this.el.qtyInput) {
        this.el.qtyInput.value = String(clamped);
      }
      this.renderBuyPreview();
    }

    adjustQuantity(delta) {
      this.setQuantity(this.getQuantity() + delta);
    }

    setMaxAffordableQuantity() {
      const price = this.state.ticketPrice || TICKET_PRICE;
      const maxCount = Math.max(1, Math.min(MAX_PER_REQUEST, Math.floor(this.getMyChips() / price)));
      this.setQuantity(maxCount);
    }

    /**
     * Computes pre-purchase preview metrics cleanly.
     * @param {number} [qty]
     */
    computePreview(qty = this.getQuantity()) {
      const count = Math.max(1, Math.min(MAX_PER_REQUEST, Math.floor(Number(qty) || 1)));
      const price = this.state.ticketPrice || TICKET_PRICE;
      const totalCost = count * price;
      const myChips = this.getMyChips();
      const canAfford = myChips >= totalCost && this.state.phase === 'OPEN';

      const currentOwn = (this.state.mySummary && this.state.mySummary.tickets) || 0;
      const currentTotal = this.state.totalTickets || 0;
      const newOwnTickets = currentOwn + count;
      const newTotalTickets = currentTotal + count;
      const estimatedPct = newTotalTickets > 0
        ? Math.round((newOwnTickets / newTotalTickets) * 10000) / 100
        : 0;

      return { count, totalCost, canAfford, newOwnTickets, newTotalTickets, estimatedPct };
    }

    submitBuy(overrideCount = null) {
      if (this._isBuying) return;
      if (this.state.phase !== 'OPEN') {
        if (this.ui) this.ui.showToast('Trekking is bezig — wacht op de volgende ronde.', 'info');
        return;
      }

      if (!this._isNetworkConnected()) {
        if (this.ui && typeof this.ui.showToast === 'function') {
          this.ui.showToast('Geen verbinding met casinotafel. Opnieuw verbinden...', 'error');
        }
        return;
      }

      const count = overrideCount !== null
        ? Math.max(1, Math.min(MAX_PER_REQUEST, Math.floor(Number(overrideCount) || 1)))
        : this.getQuantity();

      if (!this._isNetworkAuthenticated()) {
        const hasCreds = typeof this.network?.hasStoredCredentials === 'function' && this.network.hasStoredCredentials();
        if (hasCreds && typeof this.network.tryAutoReauth === 'function') {
          this._pendingBuy = { count, expiresAt: Date.now() + 5000 };
          this._isBuying = true;
          this.renderBuyPreview();
          this._buyTimeout = setTimeout(() => {
            this._pendingBuy = null;
            this._clearBuyLock(true);
            if (this.ui && typeof this.ui.showToast === 'function') {
              this.ui.showToast('Sessieherstel duurde te lang. Probeer het opnieuw.', 'error');
            }
          }, 5500);
          this.network.tryAutoReauth({ code: 'PLAYER_NOT_FOUND' });
          if (this.ui && typeof this.ui.showToast === 'function') {
            this.ui.showToast('Sessie wordt hersteld, loten worden zo gekocht...', 'info');
          }
          return;
        }
        if (this.ui) {
          if (typeof this.ui.showLoginModal === 'function') this.ui.showLoginModal();
          if (typeof this.ui.showToast === 'function') {
            this.ui.showToast('Log eerst in om Staatsloterij-loten te kopen.', 'error');
          }
        }
        return;
      }

      const preview = this.computePreview(count);
      if (this.getMyChips() < preview.totalCost) {
        if (this.ui) {
          this.ui.showToast(`Onvoldoende fiches (${preview.totalCost.toLocaleString()} fiches nodig).`, 'error');
        }
        return;
      }

      if (this.network && typeof this.network.buyLotteryTickets === 'function') {
        this._isBuying = true;
        this.renderBuyPreview();
        if (this._buyTimeout) clearTimeout(this._buyTimeout);
        this._buyTimeout = setTimeout(() => {
          this._pendingBuy = null;
          this._clearBuyLock(true);
          if (this.ui && typeof this.ui.showToast === 'function') {
            this.ui.showToast('Aankoop duurde te lang (geen reactie van server). Probeer opnieuw.', 'error');
          }
        }, 6000);
        this.network.buyLotteryTickets(preview.count);
      }
    }

    _loadOfflineBackup() {
      try {
        if (typeof localStorage === 'undefined') return;
        const raw = localStorage.getItem('casino_lottery_backup');
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return;
        if (parsed.savedAt && Date.now() - parsed.savedAt > 12 * 60 * 60 * 1000) return;

        let computedSecs = typeof parsed.secondsRemaining === 'number' ? parsed.secondsRemaining : 600;
        if (parsed.phase === 'OPEN' && typeof parsed.roundEndsAt === 'number' && parsed.roundEndsAt > 0) {
          computedSecs = Math.max(0, Math.min(600, Math.ceil((parsed.roundEndsAt - Date.now()) / 1000)));
        }
        const restoredSummary = (parsed.mySummary && parsed.mySummary.tickets > 0)
          ? parsed.mySummary
          : (parsed.activeStake && parsed.activeStake.tickets > 0 && parsed.activeStake.roundId === parsed.roundId
              ? {
                  tickets: parsed.activeStake.tickets,
                  totalSpent: parsed.activeStake.totalSpent,
                  sharePct: parsed.totalTickets > 0
                    ? Math.round((parsed.activeStake.tickets / parsed.totalTickets) * 10000) / 100
                    : 100,
                  ranges: []
                }
              : this.state.mySummary);

        this.state = {
          ...this.state,
          roundId: parsed.roundId ?? this.state.roundId,
          phase: parsed.phase || 'OPEN',
          secondsRemaining: computedSecs,
          roundEndsAt: parsed.roundEndsAt || 0,
          pot: parsed.pot || 0,
          totalTickets: parsed.totalTickets || 0,
          uniqueParticipants: parsed.uniqueParticipants || 0,
          participants: Array.isArray(parsed.participants) ? parsed.participants : [],
          mySummary: restoredSummary,
          lastDraw: parsed.lastDraw || null,
          history: Array.isArray(parsed.history) ? parsed.history : []
        };
      } catch (_) {}
    }

    _saveOfflineBackup() {
      try {
        if (typeof localStorage === 'undefined') return;
        let existingActiveStake = null;
        try {
          const prevRaw = localStorage.getItem('casino_lottery_backup');
          if (prevRaw) {
            const prevParsed = JSON.parse(prevRaw);
            if (prevParsed && prevParsed.activeStake && typeof prevParsed.activeStake === 'object') {
              existingActiveStake = prevParsed.activeStake;
            }
          }
        } catch (_) {}

        const resolvedEndsAt = this.state.roundEndsAt || (this.state.phase === 'OPEN' ? Date.now() + (this.state.secondsRemaining * 1000) : 0);
        const settledList = Array.isArray(this.state.settledRoundIds) ? this.state.settledRoundIds : [];
        const isCurrentRoundSettled = Boolean(
          this.state.phase !== 'OPEN' ||
          settledList.includes(Number(this.state.roundId)) ||
          (this.state.lastDraw && Number(this.state.lastDraw.roundId) === Number(this.state.roundId))
        );
        let activeStake = existingActiveStake;
        if (activeStake) {
          const stakeRid = Number(activeStake.roundId);
          const stakeSettled = Boolean(
            (this.state.phase !== 'OPEN' && Number(this.state.roundId) === stakeRid) ||
            settledList.includes(stakeRid) ||
            (this.state.lastDraw && Number(this.state.lastDraw.roundId) === stakeRid) ||
            (Array.isArray(this.state.history) && this.state.history.some((h) => h && Number(h.roundId) === stakeRid)) ||
            Number(this.state.backupClaimResolvedRoundId) === stakeRid
          );
          if (stakeSettled) {
            activeStake = null;
          }
        }
        if (!isCurrentRoundSettled && this.state.mySummary && this.state.mySummary.tickets > 0 && resolvedEndsAt > 0) {
          activeStake = {
            roundId: this.state.roundId,
            roundEndsAt: resolvedEndsAt,
            tickets: this.state.mySummary.tickets,
            totalSpent: this.state.mySummary.totalSpent,
            playerId: (this.ui && this.ui.myPlayer && this.ui.myPlayer.id) || (existingActiveStake && existingActiveStake.playerId) || null,
            playerName: (this.ui && this.ui.myPlayer && this.ui.myPlayer.name) || (existingActiveStake && existingActiveStake.playerName) || null,
            savedAt: Date.now()
          };
        }

        const snapshot = {
          roundId: this.state.roundId,
          phase: this.state.phase,
          secondsRemaining: this.state.secondsRemaining,
          roundEndsAt: resolvedEndsAt,
          pot: this.state.pot,
          totalTickets: this.state.totalTickets,
          uniqueParticipants: this.state.uniqueParticipants,
          participants: Array.isArray(this.state.participants) ? this.state.participants.slice(0, 30) : [],
          mySummary: this.state.mySummary,
          lastDraw: this.state.lastDraw,
          history: Array.isArray(this.state.history) ? this.state.history.slice(0, 10) : [],
          savedAt: Date.now()
        };
        if (activeStake) {
          snapshot.activeStake = activeStake;
        }
        localStorage.setItem('casino_lottery_backup', JSON.stringify(snapshot));
      } catch (_) {}
    }

    _startLocalClock() {
      if (this._localTickTimer) return;
      this._localTickTimer = setInterval(() => {
        if (this.state.phase !== 'OPEN') return;
        const sinceServer = Date.now() - (this._lastServerTickAt || 0);
        if (sinceServer < 1100) return;
        if (this.state.roundEndsAt && this.state.roundEndsAt > 0) {
          const computed = Math.max(0, Math.ceil((this.state.roundEndsAt - Date.now()) / 1000));
          if (computed !== this.state.secondsRemaining) {
            this.state.secondsRemaining = computed;
            this.renderHeaderHud();
            this.renderTimerAndStats();
          }
          if (computed === 0 &&
              (Date.now() - (this._lastZeroRefreshAt || 0)) >= 3000 &&
              this._isNetworkConnected() &&
              typeof this.network.requestLotteryState === 'function') {
            this._lastZeroRefreshAt = Date.now();
            this.network.requestLotteryState();
          }
        } else if (this.state.secondsRemaining > 0) {
          this.state.secondsRemaining -= 1;
          this.renderHeaderHud();
          this.renderTimerAndStats();
        }
      }, 1000);
      if (this._localTickTimer && typeof this._localTickTimer.unref === 'function') {
        this._localTickTimer.unref();
      }
    }

    _clearReelChoreography() {
      if (this._reelTimer) {
        clearTimeout(this._reelTimer);
        this._reelTimer = null;
      }
      if (Array.isArray(this._stageTimers)) {
        this._stageTimers.forEach((t) => clearTimeout(t));
        this._stageTimers = [];
      }
      if (this._fxRaf && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this._fxRaf);
        this._fxRaf = null;
      }
    }

    _burstLotterySparks() {
      const canvas = this.el.fxCanvas;
      if (!canvas || typeof canvas.getContext !== 'function') return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.clientWidth || (this.el.reelStage && this.el.reelStage.clientWidth) || 560;
      const h = canvas.clientHeight || (this.el.reelStage && this.el.reelStage.clientHeight) || 108;
      canvas.width = w;
      canvas.height = h;

      const colors = ['#facc15', '#fde047', '#10b981', '#34d399', '#fef08a', '#ffffff'];
      const sparks = [];
      for (let i = 0; i < 64; i += 1) {
        const angle = -Math.PI + Math.random() * Math.PI * 2;
        const speed = 1.6 + Math.random() * 5.2;
        sparks.push({
          x: w * 0.5 + (Math.random() - 0.5) * 40,
          y: h * 0.5 + (Math.random() - 0.5) * 20,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1.2,
          size: 2 + Math.random() * 3.5,
          alpha: 1,
          color: colors[i % colors.length]
        });
      }

      const startAt = Date.now();
      const step = () => {
        const elapsed = Date.now() - startAt;
        ctx.clearRect(0, 0, w, h);
        let alive = 0;
        for (const s of sparks) {
          s.x += s.vx;
          s.y += s.vy;
          s.vy += 0.08;
          s.alpha = Math.max(0, 1 - elapsed / 2200);
          if (s.alpha <= 0) continue;
          alive += 1;
          ctx.globalAlpha = s.alpha;
          ctx.fillStyle = s.color;
          ctx.fillRect(s.x, s.y, s.size, s.size * 0.8);
        }
        ctx.globalAlpha = 1;
        if (alive > 0 && elapsed < 2300 && typeof requestAnimationFrame === 'function') {
          this._fxRaf = requestAnimationFrame(step);
        } else {
          ctx.clearRect(0, 0, w, h);
          this._fxRaf = null;
        }
      };

      if (typeof requestAnimationFrame === 'function') {
        this._fxRaf = requestAnimationFrame(step);
      }
    }

    applyState(nextState) {
      const prevRoundId = this.state.roundId;
      const prevPhase = this.state.phase;
      this._lastServerTickAt = Date.now();

      this.state = {
        ...this.state,
        ...nextState,
        mySummary: nextState.mySummary || this.state.mySummary
      };
      this._saveOfflineBackup();

      // Announce any won lottery round that settled while this player was offline
      const offWin = nextState.myPendingOfflineWin;
      if (offWin && offWin.roundId && !this._announcedOfflineWinRounds.has(offWin.roundId)) {
        this._announcedOfflineWinRounds.add(offWin.roundId);
        if (typeof offWin.newChips === 'number' && this.ui && this.ui.myPlayer) {
          this.ui.myPlayer.chips = offWin.newChips;
          if (typeof this.ui.updatePlayerHUD === 'function') this.ui.updatePlayerHUD();
        }
        if (this.ui && typeof this.ui.triggerWinShimmer === 'function') {
          this.ui.triggerWinShimmer(4500);
        }
        if (this.ui && typeof this.ui.showToast === 'function') {
          this.ui.showToast(
            `STAATSLOTERIJ GEWONNEN (TERWIJL OFFLINE)! +${(offWin.potWon || 0).toLocaleString()} fiches (Lot #${offWin.winningTicketDisplay}, Ronde #${offWin.roundId})!`,
            'success'
          );
        }
        if (this.network && typeof this.network.ackLotteryOfflineWin === 'function') {
          this.network.ackLotteryOfflineWin(offWin.roundId);
        }
      }

      // Inform non-winning participants when a round they bought into settled while offline
      const offOut = nextState.myPendingOfflineOutcome;
      if (offOut && offOut.roundId && !this._announcedOfflineOutcomeRounds.has(offOut.roundId)) {
        this._announcedOfflineOutcomeRounds.add(offOut.roundId);
        if (this.ui && typeof this.ui.showToast === 'function') {
          this.ui.showToast(
            `Loterij Ronde #${offOut.roundId} afgerond (terwijl offline): ${offOut.winnerName} won ${(offOut.potWon || 0).toLocaleString()} fiches.`,
            'info'
          );
        }
        if (this.network && typeof this.network.ackLotteryOfflineOutcome === 'function') {
          this.network.ackLotteryOfflineOutcome(offOut.roundId);
        }
      }

      // Clear draw celebration banner cleanly when a new OPEN round starts
      if (this.state.phase === 'OPEN' && (this.state.roundId !== prevRoundId || prevPhase === 'DRAWING')) {
        this._animatingDrawRoundId = null;
        this._clearReelChoreography();
        if (this.el.drawBanner) {
          this.el.drawBanner.classList.add('hidden');
        }
        if (this.el.drawStatus) {
          this.el.drawStatus.classList.add('hidden');
        }
        if (this.el.reelStage) {
          this.el.reelStage.classList.remove('is-spinning-up', 'is-near-miss', 'is-celebrating');
        }
      }

      this.renderAll();
    }

    handleDrawResult(res) {
      if (res && Number(res.roundId) === Number(this.state.roundId)) {
        this.state.phase = 'DRAWING';
      }
      this.renderReel(res);
      this.renderHistory();
      this._saveOfflineBackup();

      const myId = this.ui && this.ui.myPlayer && this.ui.myPlayer.id;
      const isWinner = Boolean(myId && res.winnerId === myId);
      const modalWatchingLive = this.isOpen();
      const delayMs = modalWatchingLive ? 10050 : 0;

      if (this._toastTimer) {
        clearTimeout(this._toastTimer);
        this._toastTimer = null;
      }

      const fireDrawToast = () => {
        this._toastTimer = null;
        if (!this.ui || typeof this.ui.showToast !== 'function') return;
        if (isWinner) {
          if (typeof this.ui.triggerWinShimmer === 'function') {
            this.ui.triggerWinShimmer(4200);
          }
          this.ui.showToast(
            `STAATSLOTERIJ GEWONNEN! +${(res.potWon || 0).toLocaleString()} fiches (Lot #${res.winningTicketDisplay})!`,
            'success'
          );
        } else {
          this.ui.showToast(
            `Loterij Ronde #${res.roundId}: ${res.winnerName} wint ${(res.potWon || 0).toLocaleString()} fiches (Lot #${res.winningTicketDisplay})!`,
            'info'
          );
        }
      };

      if (delayMs > 0) {
        this._toastTimer = setTimeout(fireDrawToast, delayMs);
      } else {
        fireDrawToast();
      }
    }

    renderAll() {
      this.renderHeaderHud();
      this.renderTimerAndStats();
      this.renderMySummary();
      this.renderBuyPreview();
      this.renderParticipants();
      this.renderHistory();
      if (this.state.phase === 'DRAWING' && this.state.lastDraw && this._animatingDrawRoundId !== this.state.lastDraw.roundId) {
        this.renderReel(this.state.lastDraw, { skipAnimation: true });
      }
    }

    renderHeaderHud() {
      if (this.el.hudTimer) {
        this.el.hudTimer.textContent = this.state.phase === 'DRAWING'
          ? 'TREKKING'
          : formatCountdown(this.state.secondsRemaining);
      }
      if (this.el.hudPot) {
        this.el.hudPot.textContent = formatCompactChips(this.state.pot);
      }
      if (this.el.btnOpen) {
        const isHot = this.state.phase === 'DRAWING' || (this.state.secondsRemaining <= 30 && this.state.pot > 0);
        this.el.btnOpen.classList.toggle('lottery-hud-hot', isHot);
      }
    }

    renderTimerAndStats() {
      if (this.el.roundId) {
        this.el.roundId.textContent = String(this.state.roundId || 1);
      }
      if (this.el.phasePill) {
        this.el.phasePill.textContent = this.state.phase === 'DRAWING' ? 'LIVE TREKKING' : 'INZET OPEN';
        this.el.phasePill.className = `lottery-phase-pill ${this.state.phase === 'DRAWING' ? 'is-drawing' : 'is-open'}`;
      }
      if (this.el.timerVal) {
        this.el.timerVal.textContent = this.state.phase === 'DRAWING'
          ? `00:${String(Math.max(0, this.state.secondsRemaining)).padStart(2, '0')}`
          : formatCountdown(this.state.secondsRemaining);
        this.el.timerVal.classList.toggle('is-urgent', this.state.secondsRemaining <= 30);
      }
      if (this.el.potCounter) {
        this.el.potCounter.textContent = `${(this.state.pot || 0).toLocaleString()} Fiches`;
      }
      if (this.el.totalTickets) {
        const count = this.state.totalTickets || 0;
        this.el.totalTickets.textContent = `${count.toLocaleString()} lot${count === 1 ? '' : 'en'}`;
      }
      if (this.el.participantsCount) {
        const n = this.state.uniqueParticipants || 0;
        this.el.participantsCount.textContent = `${n} speler${n === 1 ? '' : 's'}`;
      }
    }

    renderMySummary() {
      const mine = this.state.mySummary || { tickets: 0, totalSpent: 0, sharePct: 0, ranges: [] };
      if (this.el.myTickets) {
        this.el.myTickets.textContent = `${(mine.tickets || 0).toLocaleString()} lot${mine.tickets === 1 ? '' : 'en'}`;
      }
      if (this.el.mySpent) {
        this.el.mySpent.textContent = `${(mine.totalSpent || 0).toLocaleString()} F`;
      }
      if (this.el.myOdds) {
        this.el.myOdds.textContent = `${(mine.sharePct || 0).toFixed(2)}%`;
      }
      if (this.el.myRanges) {
        const ranges = Array.isArray(mine.ranges) ? mine.ranges : [];
        if (ranges.length === 0) {
          this.el.myRanges.textContent = 'Nog geen loten in deze ronde';
        } else {
          const shown = ranges.slice(-4).map((r) => (r.start === r.end ? `#${r.start}` : `#${r.start}-#${r.end}`));
          const extra = ranges.length > 4 ? ` (+${ranges.length - 4})` : '';
          this.el.myRanges.textContent = `${shown.join(', ')}${extra}`;
        }
      }
    }

    renderBuyPreview() {
      const p = this.computePreview();
      if (this.el.previewCost) {
        this.el.previewCost.textContent = `${p.totalCost.toLocaleString()} F`;
      }
      if (this.el.previewTickets) {
        this.el.previewTickets.textContent = `${p.newOwnTickets.toLocaleString()} lot${p.newOwnTickets === 1 ? '' : 'en'}`;
      }
      if (this.el.previewOdds) {
        this.el.previewOdds.textContent = `${p.estimatedPct.toFixed(2)}%`;
      }
      if (this.el.btnBuy) {
        const isClosed = this.state.phase !== 'OPEN';
        this.el.btnBuy.disabled = isClosed || this._isBuying;
        this.el.btnBuy.classList.toggle('is-unaffordable', !isClosed && !this._isBuying && !p.canAfford);
        this.el.btnBuy.textContent = isClosed
          ? 'TREKKING BEZIG...'
          : (this._isBuying ? 'BEZIG MET KOPEN...' : `KOOP ${p.count.toLocaleString()} LOT${p.count > 1 ? 'EN' : ''} (${p.totalCost.toLocaleString()} F)`);
      }
    }

    renderParticipants() {
      if (!this.el.participantsList) return;
      const list = Array.isArray(this.state.participants) ? this.state.participants : [];
      if (list.length === 0) {
        this.el.participantsList.innerHTML = '<div class="empty-state-notice">Nog geen deelnemers — koop het eerste lot en open de prijzenpot!</div>';
        return;
      }

      const myId = this.ui && this.ui.myPlayer && this.ui.myPlayer.id;
      this.el.participantsList.innerHTML = list.map((p) => {
        const isSelf = myId && p.playerId === myId;
        const pct = Math.min(100, Math.max(0, Number(p.sharePct) || 0));
        return `
          <div class="lottery-participant-row${isSelf ? ' is-self' : ''}">
            <div class="lottery-participant-top">
              <div class="lottery-participant-ident">
                <span class="lottery-color-badge" style="background:${escapeHtml(p.playerColor || '#D4AF37')}">${escapeHtml(p.monogram || '?')}</span>
                <span class="lottery-participant-name">${escapeHtml(p.playerName)}${isSelf ? ' (Jij)' : ''}</span>
              </div>
              <div class="lottery-participant-metrics">
                <strong>${(p.tickets || 0).toLocaleString()} lot${p.tickets === 1 ? '' : 'en'}</strong>
                <span class="lottery-odds-chip">${pct.toFixed(2)}%</span>
              </div>
            </div>
            <div class="lottery-odds-track">
              <div class="lottery-odds-fill" style="width:${pct}%; background:${escapeHtml(p.playerColor || '#D4AF37')};"></div>
            </div>
          </div>
        `;
      }).join('');
    }

    renderHistory() {
      if (!this.el.historyList) return;
      const list = Array.isArray(this.state.history) ? this.state.history : [];
      if (list.length === 0) {
        this.el.historyList.innerHTML = '<div class="empty-state-notice">Nog geen afgeronde trekkingen</div>';
        return;
      }

      this.el.historyList.innerHTML = list.slice(0, 10).map((item) => `
        <div class="lottery-history-chip">
          <div class="lottery-history-head">
            <span class="lottery-history-round">#${item.roundId}</span>
            <span class="lottery-history-pot">+${(item.potWon || 0).toLocaleString()} F</span>
          </div>
          <div class="lottery-history-winner">
            <span class="lottery-history-dot" style="background:${escapeHtml(item.winnerColor || '#D4AF37')}"></span>
            <span>${escapeHtml(item.winnerName)}</span>
          </div>
          <div class="lottery-history-meta">Lot #${item.winningTicketDisplay} (${Number(item.winnerOddsPct || 0).toFixed(1)}% kans)</div>
        </div>
      `).join('');
    }

    renderReel(drawResult, { skipAnimation = false } = {}) {
      if (!this.el.reelStage || !this.el.reelTrack) return;
      const entries = Array.isArray(drawResult.reelEntries) ? drawResult.reelEntries : [];
      if (entries.length === 0) {
        this.el.reelStage.classList.add('hidden');
        if (this.el.drawStatus) this.el.drawStatus.classList.add('hidden');
        return;
      }

      this.el.reelStage.classList.remove('hidden');
      this.el.reelTrack.innerHTML = entries.map((e, idx) => `
        <div class="lottery-reel-card${e.isWinner ? ' is-winner-slot' : ''}" data-slot="${idx}">
          <span class="lottery-reel-avatar" style="background:${escapeHtml(e.playerColor || '#D4AF37')}">${escapeHtml(e.monogram || '?')}</span>
          <span class="lottery-reel-name">${escapeHtml(e.playerName)}</span>
          <span class="lottery-reel-ticket">Lot #${e.ticketNumber}</span>
        </div>
      `).join('');

      const winnerSlot = typeof drawResult.winnerSlot === 'number' ? drawResult.winnerSlot : 52;
      const cardStepPx = 114; // 106px width + 8px gap
      const stageWidth = this.el.reelStage.clientWidth || 560;
      const targetOffset = -((winnerSlot * cardStepPx) + (106 / 2) - (stageWidth / 2));

      this._clearReelChoreography();

      const setDrawStatus = (text, mode = '') => {
        if (!this.el.drawStatus) return;
        this.el.drawStatus.textContent = text;
        this.el.drawStatus.classList.remove('hidden', 'is-near-miss', 'is-winner');
        if (mode) this.el.drawStatus.classList.add(mode);
      };

      const showWinnerBanner = (fireFx = true) => {
        this.el.reelStage.classList.remove('is-spinning-up', 'is-near-miss');
        this.el.reelStage.classList.add('is-celebrating');
        const winCard = this.el.reelTrack.querySelector(`.lottery-reel-card[data-slot="${winnerSlot}"]`);
        if (winCard) winCard.classList.add('landed-highlight');
        setDrawStatus(
          `OFFICIELE UITSLAG RONDE #${drawResult.roundId} — ${drawResult.winnerName.toUpperCase()} WINT!`,
          'is-winner'
        );
        if (fireFx) {
          this._burstLotterySparks();
        }
        if (this.el.drawBanner) {
          this.el.drawBanner.innerHTML = `
            <span class="lottery-draw-badge">WINNAAR RONDE #${drawResult.roundId}</span>
            <strong>${escapeHtml(drawResult.winnerName)}</strong> wint <strong>${(drawResult.potWon || 0).toLocaleString()} fiches</strong> met Lot #${drawResult.winningTicketDisplay} (${Number(drawResult.winnerOddsPct || 0).toFixed(2)}% winkans)
          `;
          this.el.drawBanner.classList.remove('hidden');
        }
      };

      if (skipAnimation) {
        this._animatingDrawRoundId = null;
        this.el.reelTrack.style.transition = 'none';
        this.el.reelTrack.style.transform = `translate3d(${targetOffset}px, 0, 0)`;
        showWinnerBanner(false);
        return;
      }

      this._animatingDrawRoundId = drawResult.roundId;
      if (this.el.drawBanner) this.el.drawBanner.classList.add('hidden');
      this.el.reelStage.classList.remove('is-near-miss', 'is-celebrating');
      this.el.reelStage.classList.add('is-spinning-up');
      setDrawStatus(
        `TREKKING GESTART — ${(drawResult.totalTickets || 0).toLocaleString()} LOTEN IN DE TROMMEL (${(drawResult.potWon || 0).toLocaleString()} F POT)...`
      );

      this.el.reelTrack.style.transition = 'none';
      this.el.reelTrack.style.transform = 'translate3d(0px, 0, 0)';
      void this.el.reelTrack.offsetWidth;

      const launchTimer = setTimeout(() => {
        this.el.reelStage.classList.remove('is-spinning-up');
        setDrawStatus(`TROMMEL DRAAIT OP VOLLE SNELHEID — RONDE #${drawResult.roundId}...`);
        this.el.reelTrack.style.transition = 'transform 9.4s cubic-bezier(0.06, 0.88, 0.14, 1)';
        this.el.reelTrack.style.transform = `translate3d(${targetOffset}px, 0, 0)`;
      }, 450);

      const nearMissTimer = setTimeout(() => {
        this.el.reelStage.classList.add('is-near-miss');
        setDrawStatus('SPANNING STIJGT — TROMMEL VERTRAGT BIJ DE LAATSTE LOTEN...', 'is-near-miss');
      }, 5000);

      const finalBreathTimer = setTimeout(() => {
        setDrawStatus('LAATSTE SECONDEN — WIE HEEFT HET WINNENDE LOT?!', 'is-near-miss');
      }, 7800);

      this._stageTimers.push(launchTimer, nearMissTimer, finalBreathTimer);

      this._reelTimer = setTimeout(() => {
        showWinnerBanner(true);
      }, 9950);
    }
  }

  return CasinoLottery;
}));
