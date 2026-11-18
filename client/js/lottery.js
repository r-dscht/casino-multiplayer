/**
 * lottery.js
 * Frontend controller for Monte Carlo Gouden Krasloten (1.000 F/ticket,
 * 100% ticket + 1% casino net loss into live shared pot, interactive 3x3 gold foil scratch card).
 *
 * Strict Guardrails: 100% Silent Mode (Zero Audio), Zero Unicode Emojis, Zero Banned Brand Terms.
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

  const TICKET_PRICE = 1000;
  const MAX_PER_REQUEST = 25;

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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
        mode: 'KRASLOTEN',
        roundId: 1,
        phase: 'READY',
        secondsRemaining: 600,
        roundEndsAt: 0,
        ticketPrice: TICKET_PRICE,
        houseEdgePct: 0,
        pot: 10000,
        totalTickets: 0,
        totalLossContributions: 0,
        prizeTiers: [],
        uniqueParticipants: 0,
        mySummary: { tickets: 0, totalSpent: 0, totalWon: 0, sharePct: 0, ranges: [] },
        myHistory: [],
        lastDraw: null,
        history: []
      };

      this._buyTimeout = null;
      this._pendingBuy = null;
      this._isBuying = false;
      this._localTickTimer = null;

      // Active scratch card state
      this.activeTicket = null;
      this.activeBatchSummary = null;
      this.isScratchRevealed = false;
      this._isScratchingPointer = false;
      this._foilReady = false;
      this._scratchedZones = new Set();

      this._cacheElements();
      this._bindEvents();
      this._bindNetworkEvents();
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
        prizeTable: byId('scratch-prize-table'),
        drawStatus: byId('lottery-draw-status'),
        reelStage: byId('lottery-reel-stage'),
        fxCanvas: byId('lottery-fx-canvas'),
        reelTrack: byId('lottery-reel-track'),
        btnRevealAll: byId('btn-scratch-reveal-all'),
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
            const parsed = Math.max(1, Math.min(MAX_PER_REQUEST, parseInt(val, 10) || 1));
            this.setQuantity(parsed);
          }
        });
      });

      if (this.el.btnBuy) {
        this.el.btnBuy.addEventListener('click', () => this.submitBuy());
      }
      if (this.el.btnRevealAll) {
        this.el.btnRevealAll.addEventListener('click', () => this.revealScratchCard(true));
      }

      this._bindFoilScratchPointerEvents();
    }

    _bindFoilScratchPointerEvents() {
      const canvas = this.el.fxCanvas;
      if (!canvas) return;

      const scratchAt = (e) => {
        if (!this.activeTicket || this.isScratchRevealed || !this._foilReady) return;
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        this._eraseFoilBrush(x, y, rect.width, rect.height);
      };

      canvas.addEventListener('pointerdown', (e) => {
        if (!this.activeTicket || this.isScratchRevealed) return;
        this._isScratchingPointer = true;
        if (typeof canvas.setPointerCapture === 'function') {
          try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
        }
        scratchAt(e);
      });

      canvas.addEventListener('pointermove', (e) => {
        if (!this._isScratchingPointer) return;
        scratchAt(e);
      });

      const endScratch = () => {
        this._isScratchingPointer = false;
      };
      canvas.addEventListener('pointerup', endScratch);
      canvas.addEventListener('pointercancel', endScratch);
      canvas.addEventListener('pointerleave', endScratch);
    }

    _bindNetworkEvents() {
      if (!this.network || typeof this.network.on !== 'function') return;

      this.network.on('lottery_state', (data) => {
        if (!data || typeof data !== 'object') return;
        this.applyState(data);
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
        if (ack.mySummary) {
          this.state.mySummary = ack.mySummary;
        }
        if (ack.ticket) {
          this._loadInteractiveScratchCard(ack.ticket, ack);
        } else {
          this.renderBuyPreview();
        }
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
        if (pending && Date.now() <= pending.expiresAt && this.network && typeof this.network.buyLotteryTickets === 'function') {
          this._startBuyTimeout();
          this.network.buyLotteryTickets(pending.count);
        } else {
          this._clearBuyLock(false);
        }
      });

      this.network.on('error_msg', () => {
        if (this._isBuying && !this._pendingBuy) {
          this._clearBuyLock(true);
        }
      });
    }

    isOpen() {
      return Boolean(this.el.modal && !this.el.modal.classList.contains('hidden'));
    }

    open() {
      if (!this.el.modal) return;
      this.el.modal.classList.remove('hidden');
      if (this.network && typeof this.network.requestLotteryState === 'function') {
        this.network.requestLotteryState();
      }
      this.renderAll();
      if (this.activeTicket && !this.isScratchRevealed) {
        this._paintGoldFoil();
      }
    }

    close() {
      if (!this.el.modal) return;
      this.el.modal.classList.add('hidden');
    }

    applyState(data) {
      const hasPersonal = data.isPersonal !== false;
      this.state = {
        ...this.state,
        ...data,
        ticketPrice: typeof data.ticketPrice === 'number' ? data.ticketPrice : TICKET_PRICE,
        pot: typeof data.pot === 'number' ? data.pot : this.state.pot,
        totalTickets: typeof data.totalTickets === 'number' ? data.totalTickets : this.state.totalTickets,
        totalLossContributions: typeof data.totalLossContributions === 'number' ? data.totalLossContributions : this.state.totalLossContributions,
        prizeTiers: Array.isArray(data.prizeTiers) ? data.prizeTiers : this.state.prizeTiers,
        mySummary: hasPersonal && data.mySummary ? data.mySummary : this.state.mySummary,
        myHistory: hasPersonal && Array.isArray(data.myHistory) ? data.myHistory : this.state.myHistory,
        history: Array.isArray(data.history) ? data.history : this.state.history
      };
      this.renderAll();
    }

    _loadInteractiveScratchCard(ticket, ack) {
      this.activeTicket = ticket;
      this.activeBatchSummary = {
        count: Number(ack.count) || 1,
        totalCost: Number(ack.totalCost) || TICKET_PRICE,
        totalPayout: Number(ack.totalPayout) || 0,
        remainingChips: ack.remainingChips
      };
      this.isScratchRevealed = false;
      this._scratchedZones.clear();
      this._foilReady = false;

      if (this.el.roundId) {
        this.el.roundId.textContent = String(ticket.ticketNumber || this.state.roundId);
      }
      if (this.el.drawStatus) {
        this.el.drawStatus.className = 'lottery-draw-status';
        this.el.drawStatus.textContent = this.activeBatchSummary.count > 1
          ? `Lot #${ticket.ticketNumber} (+${this.activeBatchSummary.count - 1} extra) — Veeg het goud weg of klik KRAS ALLES OPEN!`
          : `Lot #${ticket.ticketNumber} klaar! Veeg over het gouden folie en zoek 3 dezelfde symbolen!`;
      }
      if (this.el.drawBanner) {
        this.el.drawBanner.className = 'lottery-draw-banner hidden';
      }
      if (this.el.btnRevealAll) {
        this.el.btnRevealAll.classList.remove('hidden');
        this.el.btnRevealAll.disabled = false;
      }

      this._renderScratchCells(ticket, false);
      this._paintGoldFoil();
      this.renderBuyPreview();
    }

    _renderScratchCells(ticket, markWinners) {
      if (!this.el.reelTrack) return;
      if (!ticket || !Array.isArray(ticket.grid) || ticket.grid.length !== 9) {
        this.el.reelTrack.innerHTML = `<div class="scratch-placeholder-note">Kraslot #${Number(this.state.roundId) || 1} • Klik rechts op KOOP KRASLOT om te beginnen</div>`;
        return;
      }

      this.el.reelTrack.innerHTML = ticket.grid.map((cell) => {
        const winCls = markWinners && cell.isWinningCell ? ' is-winner' : '';
        const dimCls = markWinners && ticket.won && !cell.isWinningCell ? ' is-dim' : '';
        return (
          `<div class="scratch-cell${winCls}${dimCls}" data-cell-idx="${cell.index}">` +
            `<span class="sc-badge" style="color:${escapeHtml(cell.color || '#d4af37')}">${escapeHtml(cell.badge)}</span>` +
            `<strong class="sc-val" style="color:${escapeHtml(cell.color || '#f8fafc')}">${escapeHtml(cell.label)}</strong>` +
            `<span class="sc-sub">${escapeHtml(cell.symbolName)}</span>` +
          `</div>`
        );
      }).join('');
    }

    _paintGoldFoil() {
      const canvas = this.el.fxCanvas;
      const stage = this.el.reelStage;
      if (!canvas || !stage) return;

      const rect = stage.getBoundingClientRect();
      const w = Math.max(260, Math.floor(rect.width || 380));
      const h = Math.max(220, Math.floor(rect.height || 260));
      const dpr = Math.min(typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1, 1.5);

      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.opacity = '1';
      canvas.style.pointerEvents = 'auto';

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.globalCompositeOperation = 'source-over';

      // Brushed champagne-gold metallic foil gradient
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#a67c2e');
      grad.addColorStop(0.28, '#eed5a2');
      grad.addColorStop(0.55, '#c99b3b');
      grad.addColorStop(0.82, '#f5d98a');
      grad.addColorStop(1, '#8c661c');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Crisp 3x3 foil cell guides & brushed diagonal lines
      ctx.strokeStyle = 'rgba(20, 15, 6, 0.22)';
      ctx.lineWidth = 2;
      const colW = w / 3;
      const rowH = h / 3;
      for (let i = 1; i <= 2; i += 1) {
        ctx.beginPath();
        ctx.moveTo(colW * i, 0);
        ctx.lineTo(colW * i, h);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, rowH * i);
        ctx.lineTo(w, rowH * i);
        ctx.stroke();
      }

      // Foil watermark text in each cell
      ctx.fillStyle = 'rgba(30, 22, 7, 0.55)';
      ctx.font = '800 12px "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let r = 0; r < 3; r += 1) {
        for (let c = 0; c < 3; c += 1) {
          ctx.fillText('KRAS HIER', colW * (c + 0.5), rowH * (r + 0.5));
        }
      }
      ctx.restore();
      this._foilReady = true;
    }

    _eraseFoilBrush(x, y, w, h) {
      const canvas = this.el.fxCanvas;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = canvas.width / Math.max(1, w);
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(x, y, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Coarse 5x5 grid coverage check for instant, zero-CPU completion detection
      const zx = Math.min(4, Math.max(0, Math.floor((x / w) * 5)));
      const zy = Math.min(4, Math.max(0, Math.floor((y / h) * 5)));
      this._scratchedZones.add(`${zx},${zy}`);
      if (this._scratchedZones.size >= 14) {
        this.revealScratchCard(true);
      }
    }

    revealScratchCard(animateClear = true) {
      if (!this.activeTicket || this.isScratchRevealed) return;
      this.isScratchRevealed = true;
      this._foilReady = false;

      if (animateClear && this.el.fxCanvas) {
        const ctx = this.el.fxCanvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, this.el.fxCanvas.width, this.el.fxCanvas.height);
        }
        this.el.fxCanvas.style.pointerEvents = 'none';
      }

      this._renderScratchCells(this.activeTicket, true);
      if (this.el.btnRevealAll) {
        this.el.btnRevealAll.classList.add('hidden');
      }

      const batch = this.activeBatchSummary || { count: 1, totalCost: TICKET_PRICE, totalPayout: this.activeTicket.payout };
      const wonAmount = batch.count > 1 ? batch.totalPayout : this.activeTicket.payout;

      if (this.el.drawStatus) {
        this.el.drawStatus.className = wonAmount > 0 ? 'lottery-draw-status is-winner' : 'lottery-draw-status';
        this.el.drawStatus.textContent = wonAmount > 0
          ? `${this.activeTicket.tierLabel} OPENGEKRAST! Uitbetaling: +${wonAmount.toLocaleString()} F`
          : 'Helaas, geen 3 dezelfde symbolen op dit kraslot. Je inzet versterkt de pot!';
      }

      if (this.el.drawBanner) {
        if (wonAmount > 0) {
          const isJackpot = this.activeTicket.tierId === 'JACKPOT_100';
          this.el.drawBanner.className = `lottery-draw-banner is-win${isJackpot ? ' is-jackpot' : ''}`;
          this.el.drawBanner.textContent = isJackpot
            ? `JACKPOT KLAPPER! Je wint heel de pot: +${wonAmount.toLocaleString()} Fiches!`
            : `GEFELICITEERD! +${wonAmount.toLocaleString()} Fiches bijgeschreven!`;
        } else {
          this.el.drawBanner.className = 'lottery-draw-banner is-miss';
          this.el.drawBanner.textContent = `Niet gewonnen (+${batch.totalCost.toLocaleString()} F in de Krasloten-pot)`;
        }
      }

      if (this.ui && typeof this.ui.showToast === 'function' && wonAmount > 0) {
        this.ui.showToast(`Kraslot gewonnen: +${wonAmount.toLocaleString()} fiches!`, 'success');
      }
    }

    getSelectedQuantity() {
      const raw = this.el.qtyInput ? parseInt(this.el.qtyInput.value, 10) : 1;
      if (!Number.isInteger(raw) || raw < 1) return 1;
      return Math.min(MAX_PER_REQUEST, raw);
    }

    setQuantity(count) {
      const clean = Math.max(1, Math.min(MAX_PER_REQUEST, parseInt(count, 10) || 1));
      if (this.el.qtyInput) this.el.qtyInput.value = clean;
      this.renderBuyPreview();
    }

    adjustQuantity(delta) {
      this.setQuantity(this.getSelectedQuantity() + delta);
    }

    setMaxAffordableQuantity() {
      const chips = (this.ui && this.ui.myPlayer && typeof this.ui.myPlayer.chips === 'number')
        ? this.ui.myPlayer.chips
        : 0;
      const price = this.state.ticketPrice || TICKET_PRICE;
      const maxCount = Math.max(1, Math.min(MAX_PER_REQUEST, Math.floor(chips / price)));
      this.setQuantity(maxCount);
    }

    _startBuyTimeout() {
      if (this._buyTimeout) {
        clearTimeout(this._buyTimeout);
        this._buyTimeout = null;
      }
      this._buyTimeout = setTimeout(() => {
        this._buyTimeout = null;
        this._pendingBuy = null;
        if (this._isBuying) {
          this._clearBuyLock(true);
          if (this.ui && typeof this.ui.showToast === 'function') {
            this.ui.showToast('Kraslot aankoop duurde te lang. Probeer opnieuw.', 'error');
          }
        }
      }, 6500);
    }

    _clearBuyLock(restoreBtn = true) {
      if (this._buyTimeout) {
        clearTimeout(this._buyTimeout);
        this._buyTimeout = null;
      }
      this._isBuying = false;
      if (this.el.btnBuy) {
        this.el.btnBuy.disabled = false;
        if (this.el.btnBuy.classList && typeof this.el.btnBuy.classList.toggle === 'function') {
          this.el.btnBuy.classList.toggle('is-loading', false);
        }
      }
      if (restoreBtn) {
        this.renderBuyPreview();
      }
    }

    submitBuy(countOverride) {
      if (this._isBuying) return;
      const count = countOverride !== undefined
        ? Math.max(1, Math.min(MAX_PER_REQUEST, parseInt(countOverride, 10) || 1))
        : this.getSelectedQuantity();

      if (!this.network || typeof this.network.buyLotteryTickets !== 'function') return;

      const socketConnected = this.network.isConnected || Boolean(this.network.socket && this.network.socket.connected);
      if (!socketConnected) {
        if (this.ui && typeof this.ui.showToast === 'function') {
          this.ui.showToast('Geen verbinding met de server. Even geduld...', 'error');
        }
        return;
      }

      const authed = Boolean(this.network.isAuthenticated || (this.ui && this.ui.myPlayer && this.ui.myPlayer.id));
      if (!authed) {
        if (typeof this.network.hasStoredCredentials === 'function' && this.network.hasStoredCredentials() && typeof this.network.tryAutoReauth === 'function') {
          this._pendingBuy = { count, expiresAt: Date.now() + 5000 };
          this._isBuying = true;
          if (this.el.btnBuy) {
            this.el.btnBuy.disabled = true;
            if (this.el.btnBuy.classList && typeof this.el.btnBuy.classList.toggle === 'function') {
              this.el.btnBuy.classList.toggle('is-loading', true);
            }
            this.el.btnBuy.textContent = 'SESSIE HERSTELLEN...';
          }
          this._startBuyTimeout();
          this.network.tryAutoReauth({ reason: 'Kraslot sessie herstellen' });
          return;
        }
        if (this.ui && typeof this.ui.showToast === 'function') {
          this.ui.showToast('Log eerst in om een kraslot te kopen.', 'error');
        }
        return;
      }

      const totalCost = count * (this.state.ticketPrice || TICKET_PRICE);
      const chips = (this.ui && this.ui.myPlayer && typeof this.ui.myPlayer.chips === 'number')
        ? this.ui.myPlayer.chips
        : 0;
      if (chips < totalCost) {
        if (this.ui && typeof this.ui.showToast === 'function') {
          this.ui.showToast(`Onvoldoende fiches (nodig: ${totalCost.toLocaleString()} F).`, 'error');
        }
        return;
      }

      // If previous ticket wasn't scratched yet, auto-reveal it before loading next card
      if (this.activeTicket && !this.isScratchRevealed) {
        this.revealScratchCard(true);
      }

      this._isBuying = true;
      if (this.el.btnBuy) {
        this.el.btnBuy.disabled = true;
        if (this.el.btnBuy.classList && typeof this.el.btnBuy.classList.toggle === 'function') {
          this.el.btnBuy.classList.toggle('is-loading', true);
        }
        this.el.btnBuy.textContent = 'BEZIG MET KOPEN...';
      }
      this._startBuyTimeout();
      this.network.buyLotteryTickets(count);
    }

    renderAll() {
      this.renderHeaderHud();
      this.renderHeroStats();
      this.renderPrizeTable();
      this.renderBuyPreview();
      this.renderHistoryLists();
    }

    renderHeaderHud() {
      const pot = Number(this.state.pot) || 0;
      if (this.el.hudPot) {
        this.el.hudPot.textContent = formatCompactChips(pot);
      }
      if (this.el.hudTimer) {
        const price = Number(this.state.ticketPrice) || TICKET_PRICE;
        this.el.hudTimer.textContent = `${price.toLocaleString()} F`;
      }
    }

    renderHeroStats() {
      const pot = Number(this.state.pot) || 0;
      if (this.el.roundId && !this.activeTicket) {
        this.el.roundId.textContent = String(this.state.roundId || 1);
      }
      if (this.el.potCounter) {
        this.el.potCounter.textContent = `${pot.toLocaleString()} Fiches`;
      }
      if (this.el.timerVal) {
        this.el.timerVal.textContent = formatCompactChips(pot);
      }
      if (this.el.totalTickets) {
        const cnt = Number(this.state.totalTickets) || 0;
        this.el.totalTickets.textContent = `${cnt.toLocaleString()} loten gekrast`;
      }
      if (this.el.participantsCount) {
        const lossCont = Number(this.state.totalLossContributions) || 0;
        this.el.participantsCount.textContent = `${lossCont.toLocaleString()} F uit verliezen`;
      }
    }

    renderPrizeTable() {
      if (!this.el.prizeTable) return;
      const tiers = Array.isArray(this.state.prizeTiers) && this.state.prizeTiers.length > 0
        ? this.state.prizeTiers
        : [
            { id: 'JACKPOT_100', shortLabel: '100% POT', symbolName: '3x KROON', chancePct: 0.15, currentPayout: this.state.pot, color: '#fde047' },
            { id: 'POT_25', shortLabel: '25% POT', symbolName: '3x GOUD', chancePct: 0.85, currentPayout: Math.floor((this.state.pot || 0) * 0.25), color: '#f59e0b' },
            { id: 'POT_10', shortLabel: '10% POT', symbolName: '3x KLAVER', chancePct: 3, currentPayout: Math.floor((this.state.pot || 0) * 0.10), color: '#34d399' },
            { id: 'POT_4', shortLabel: '4% POT', symbolName: '3x ROBIJN', chancePct: 8, currentPayout: Math.max(500, Math.floor((this.state.pot || 0) * 0.04)), color: '#f43f5e' },
            { id: 'CONSOLATION_500', shortLabel: '500 F', symbolName: '3x MUNT', chancePct: 20, currentPayout: 500, color: '#93c5fd' }
          ];

      this.el.prizeTable.innerHTML = tiers.map((t) => (
        `<div class="scratch-tier-pill">` +
          `<span class="stp-top" style="color:${escapeHtml(t.color || '#d4af37')}">${escapeHtml(t.shortLabel)}</span>` +
          `<strong class="stp-val">${formatCompactChips(t.currentPayout)}</strong>` +
          `<span class="stp-chance">${Number(t.chancePct).toFixed(t.chancePct < 1 ? 2 : 0)}% kans</span>` +
        `</div>`
      )).join('');
    }

    renderBuyPreview() {
      const count = this.getSelectedQuantity();
      const price = this.state.ticketPrice || TICKET_PRICE;
      const cost = count * price;
      const afterPot = (Number(this.state.pot) || 0) + cost;

      if (this.el.previewCost) {
        this.el.previewCost.textContent = `${cost.toLocaleString()} F`;
      }
      if (this.el.previewTickets) {
        this.el.previewTickets.textContent = `${afterPot.toLocaleString()} F`;
      }
      if (this.el.previewOdds) {
        this.el.previewOdds.textContent = '32.00%';
      }
      if (this.el.btnBuy && !this._isBuying) {
        this.el.btnBuy.textContent = count === 1
          ? `KOOP 1 KRASLOT (${cost.toLocaleString()} F)`
          : `KOOP ${count} KRASLOTEN (${cost.toLocaleString()} F)`;
      }

      const my = this.state.mySummary || {};
      if (this.el.myTickets) {
        const cnt = Number(my.tickets) || 0;
        this.el.myTickets.textContent = `${cnt} ${cnt === 1 ? 'lot' : 'loten'}`;
      }
      if (this.el.mySpent) {
        this.el.mySpent.textContent = `${(Number(my.totalSpent) || 0).toLocaleString()} F`;
      }
      if (this.el.myOdds) {
        this.el.myOdds.textContent = `${(Number(my.totalWon) || 0).toLocaleString()} F`;
      }
    }

    renderHistoryLists() {
      if (this.el.participantsList) {
        const myHist = Array.isArray(this.state.myHistory) ? this.state.myHistory : [];
        if (myHist.length === 0) {
          this.el.participantsList.innerHTML = '<div class="empty-state-notice">Nog geen krasloten opengekrast</div>';
        } else {
          this.el.participantsList.innerHTML = myHist.slice(0, 12).map((item) => {
            const won = Number(item.payout) > 0;
            const label = won ? `${escapeHtml(item.tierShortLabel || item.tierLabel)}` : 'Geen match';
            const valStr = won ? `+${Number(item.payout).toLocaleString()} F` : '-1.000 F';
            return (
              `<div class="scratch-hist-row ${won ? 'is-win' : 'is-loss'}">` +
                `<span class="shr-num">#${Number(item.ticketNumber) || 0}</span>` +
                `<span class="shr-lbl">${label}</span>` +
                `<strong class="shr-val">${valStr}</strong>` +
              `</div>`
            );
          }).join('');
        }
      }

      if (this.el.historyList) {
        const wins = Array.isArray(this.state.history) ? this.state.history : [];
        if (wins.length === 0) {
          this.el.historyList.innerHTML = '<div class="empty-state-notice">Nog geen prijzen gevallen — pak de eerste klapper!</div>';
        } else {
          this.el.historyList.innerHTML = wins.slice(0, 12).map((w) => (
            `<div class="scratch-hist-row is-win">` +
              `<span class="shr-num" style="color:${escapeHtml(w.winnerColor || '#d4af37')}">${escapeHtml(w.winnerName)}</span>` +
              `<span class="shr-lbl">${escapeHtml(w.tierLabel || 'PRIJS')}</span>` +
              `<strong class="shr-val">+${Number(w.potWon || 0).toLocaleString()} F</strong>` +
            `</div>`
          )).join('');
        }
      }
    }
  }

  return CasinoLottery;
}));
