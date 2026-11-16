/**
 * lottery.js
 * Frontend controller for Casino Staatsloterij (100% player pot, 0% house edge, 10-minute cycle).
 * Syncs top HUD timer/pot badge, live buy preview, animated raffle drum reel,
 * participant odds bars, and recent winner history.
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
        ticketPrice: TICKET_PRICE,
        houseEdgePct: 0,
        pot: 0,
        totalTickets: 0,
        uniqueParticipants: 0,
        participants: [],
        mySummary: { tickets: 0, totalSpent: 0, sharePct: 0, ranges: [] },
        lastDraw: null,
        history: []
      };

      this._reelTimer = null;
      this._isBuying = false;

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
        reelStage: byId('lottery-reel-stage'),
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
        this.state.roundId = tick.roundId ?? this.state.roundId;
        this.state.phase = tick.phase || this.state.phase;
        this.state.secondsRemaining = typeof tick.secondsRemaining === 'number' ? tick.secondsRemaining : this.state.secondsRemaining;
        this.state.pot = typeof tick.pot === 'number' ? tick.pot : this.state.pot;
        this.state.totalTickets = typeof tick.totalTickets === 'number' ? tick.totalTickets : this.state.totalTickets;
        this.state.uniqueParticipants = typeof tick.uniqueParticipants === 'number' ? tick.uniqueParticipants : this.state.uniqueParticipants;
        this.renderHeaderHud();
        this.renderTimerAndStats();
      });

      this.network.on('lottery_buy_ack', (ack) => {
        this._isBuying = false;
        if (!ack) return;
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
        this._isBuying = false;
        this.renderBuyPreview();
        if (this.ui && typeof this.ui.showToast === 'function' && err && err.reason) {
          this.ui.showToast(err.reason, 'error');
        }
      });

      this.network.on('lottery_draw_result', (res) => {
        if (!res) return;
        this.state.lastDraw = res;
        this.handleDrawResult(res);
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

    submitBuy() {
      if (this._isBuying) return;
      if (this.state.phase !== 'OPEN') {
        if (this.ui) this.ui.showToast('Trekking is bezig — wacht op de volgende ronde.', 'info');
        return;
      }

      const preview = this.computePreview();
      if (this.getMyChips() < preview.totalCost) {
        if (this.ui) {
          this.ui.showToast(`Onvoldoende fiches (${preview.totalCost.toLocaleString()} fiches nodig).`, 'error');
        }
        return;
      }

      if (this.network && typeof this.network.buyLotteryTickets === 'function') {
        this._isBuying = true;
        this.renderBuyPreview();
        this.network.buyLotteryTickets(preview.count);
      }
    }

    applyState(nextState) {
      const prevRoundId = this.state.roundId;
      const prevPhase = this.state.phase;

      this.state = {
        ...this.state,
        ...nextState,
        mySummary: nextState.mySummary || this.state.mySummary
      };

      // Clear draw celebration banner cleanly when a new OPEN round starts
      if (this.state.phase === 'OPEN' && (this.state.roundId !== prevRoundId || prevPhase === 'DRAWING')) {
        if (this.el.drawBanner) {
          this.el.drawBanner.classList.add('hidden');
        }
      }

      this.renderAll();
    }

    handleDrawResult(res) {
      this.renderReel(res);
      this.renderHistory();

      const myId = this.ui && this.ui.myPlayer && this.ui.myPlayer.id;
      const isWinner = Boolean(myId && res.winnerId === myId);

      if (this.ui && typeof this.ui.showToast === 'function') {
        if (isWinner) {
          if (typeof this.ui.triggerWinShimmer === 'function') {
            this.ui.triggerWinShimmer(3200);
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
      }
    }

    renderAll() {
      this.renderHeaderHud();
      this.renderTimerAndStats();
      this.renderMySummary();
      this.renderBuyPreview();
      this.renderParticipants();
      this.renderHistory();
      if (this.state.phase === 'DRAWING' && this.state.lastDraw) {
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
        this.el.btnBuy.disabled = isClosed || this._isBuying || !p.canAfford;
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

      const winnerSlot = typeof drawResult.winnerSlot === 'number' ? drawResult.winnerSlot : 36;
      const cardStepPx = 114; // 106px width + 8px gap
      const stageWidth = this.el.reelStage.clientWidth || 560;
      const targetOffset = -((winnerSlot * cardStepPx) + (106 / 2) - (stageWidth / 2));

      if (this._reelTimer) {
        clearTimeout(this._reelTimer);
        this._reelTimer = null;
      }

      const showWinnerBanner = () => {
        const winCard = this.el.reelTrack.querySelector(`.lottery-reel-card[data-slot="${winnerSlot}"]`);
        if (winCard) winCard.classList.add('landed-highlight');
        if (this.el.drawBanner) {
          this.el.drawBanner.innerHTML = `
            <span class="lottery-draw-badge">WINNAAR RONDE #${drawResult.roundId}</span>
            <strong>${escapeHtml(drawResult.winnerName)}</strong> wint <strong>${(drawResult.potWon || 0).toLocaleString()} fiches</strong> met Lot #${drawResult.winningTicketDisplay} (${Number(drawResult.winnerOddsPct || 0).toFixed(2)}% winkans)
          `;
          this.el.drawBanner.classList.remove('hidden');
        }
      };

      if (skipAnimation) {
        this.el.reelTrack.style.transition = 'none';
        this.el.reelTrack.style.transform = `translate3d(${targetOffset}px, 0, 0)`;
        showWinnerBanner();
        return;
      }

      if (this.el.drawBanner) this.el.drawBanner.classList.add('hidden');
      this.el.reelTrack.style.transition = 'none';
      this.el.reelTrack.style.transform = 'translate3d(0px, 0, 0)';
      void this.el.reelTrack.offsetWidth;
      this.el.reelTrack.style.transition = 'transform 6.2s cubic-bezier(0.10, 0.86, 0.18, 1)';
      this.el.reelTrack.style.transform = `translate3d(${targetOffset}px, 0, 0)`;

      this._reelTimer = setTimeout(() => {
        showWinnerBanner();
      }, 6300);
    }
  }

  return CasinoLottery;
}));
