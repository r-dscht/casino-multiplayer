/**
 * poker.js
 * Client controller for 6-Seat Texas Hold'em Poker in the Monte Carlo Casino.
 * Coordinates 6-seat elliptical felt, 3D card dealing, action bar,
 * bet sizing slider, 15s turn countdown timer, and buy-in modal.
 * 
 * Strict Guardrails: 100% Silent Mode (Zero Audio) and Zero Unicode Emojis.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CasinoPoker = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  class CasinoPoker {
    /**
     * @param {Object} options
     * @param {Object} options.network CasinoNetwork instance
     * @param {Object} options.ui CasinoUI instance
     */
    constructor({ network, ui }) {
      this.network = network;
      this.ui = ui;
      this.currentTableId = 'poker_1';
      this.currentTableState = null;
      this.mySeatIndex = -1;
      this.privateHoleCards = [];
      this.isPeekRevealed = true;
      this.turnTimerInterval = null;
      this.turnTimeLeft = 15;
      this.turnTimeTotal = 15;
      this.selectedRaiseAmount = 200;
      this.pendingBuyInSeat = null;
      this.currentCheckCallAction = 'check';
      this.currentCheckCallAmount = 0;
      this.lastSeatActions = new Map(); // seatIndex -> { action, text, amount }

      // Cache DOM Elements
      this.elements = {
        viewPoker: document.getElementById('poker-view'),
        tableBtn1: document.getElementById('poker-table-btn-1'),
        tableBtn2: document.getElementById('poker-table-btn-2'),
        tableName: document.getElementById('poker-table-name'),
        tableStakes: document.getElementById('poker-table-stakes'),
        handNumber: document.getElementById('poker-hand-number'),
        feltStage: document.getElementById('poker-felt-stage'),
        potAmount: document.getElementById('poker-pot-amount'),
        sidePotsRow: document.getElementById('poker-side-pots'),
        phaseText: document.getElementById('poker-phase-text'),
        resultBanner: document.getElementById('poker-result-banner'),
        winShimmerCanvas: document.getElementById('poker-win-shimmer-canvas'),

        // Community Slots (0..4)
        communitySlots: [
          document.getElementById('poker-card-slot-0'),
          document.getElementById('poker-card-slot-1'),
          document.getElementById('poker-card-slot-2'),
          document.getElementById('poker-card-slot-3'),
          document.getElementById('poker-card-slot-4')
        ],

        // Controls
        controlsPanel: document.getElementById('poker-controls-panel'),
        timerBarFill: document.getElementById('poker-turn-timer-fill'),
        timerText: document.getElementById('poker-turn-timer-text'),
        raiseSlider: document.getElementById('poker-raise-slider'),
        raiseInput: document.getElementById('poker-raise-input'),
        btnPreset1bb: document.getElementById('btn-preset-1bb'),
        btnPreset2x: document.getElementById('btn-preset-2x'),
        btnPreset3x: document.getElementById('btn-preset-3x'),
        btnPresetHalfPot: document.getElementById('btn-preset-half-pot'),
        btnPresetPot: document.getElementById('btn-preset-pot'),
        btnPresetAllin: document.getElementById('btn-preset-allin'),
        btnPeek: document.getElementById('btn-poker-peek'),
        btnFold: document.getElementById('btn-poker-fold'),
        btnCheckCall: document.getElementById('btn-poker-check-call'),
        btnCheckCallText: document.getElementById('btn-poker-check-call-text'),
        btnRaise: document.getElementById('btn-poker-raise'),
        btnRaiseText: document.getElementById('btn-poker-raise-text'),

        // Buy-In Modal
        buyinModal: document.getElementById('poker-buyin-modal'),
        buyinSeatTitle: document.getElementById('poker-modal-seat-title'),
        buyinBankroll: document.getElementById('poker-buyin-bankroll'),
        buyinBlindsLabel: document.getElementById('poker-buyin-blinds-label'),
        buyinDefaultLabel: document.getElementById('poker-buyin-default-label'),
        buyinMinLabel: document.getElementById('poker-buyin-min-label'),
        buyinMaxLabel: document.getElementById('poker-buyin-max-label'),
        buyinAmount: document.getElementById('poker-buyin-amount'),
        buyinSlider: document.getElementById('poker-buyin-slider'),
        btnBuyinMin: document.getElementById('btn-buyin-min'),
        btnBuyinMid: document.getElementById('btn-buyin-mid'),
        btnBuyinMax: document.getElementById('btn-buyin-max'),
        buyinError: document.getElementById('poker-buyin-error'),
        btnConfirmBuyin: document.getElementById('btn-confirm-poker-buyin'),
        btnCancelBuyin: document.getElementById('btn-cancel-poker-buyin'),
        btnCloseModal: document.getElementById('btn-close-poker-modal'),
        btnRebuyHeader: document.getElementById('btn-poker-rebuy-header'),
        buyinTitle: document.getElementById('poker-buyin-title'),
        buyinLabel: document.getElementById('poker-buyin-label')
      };

      // Seat element bundles (0..5)
      this.seatElements = [];
      for (let i = 0; i <= 5; i++) {
        this.seatElements.push({
          seat: document.getElementById(`poker-seat-${i}`),
          emptyBadge: document.getElementById(`poker-seat-empty-${i}`),
          btnSit: document.getElementById(`btn-poker-sit-${i}`),
          occupiedWrap: document.getElementById(`poker-seat-occupied-${i}`),
          playerBox: document.getElementById(`poker-player-box-${i}`),
          avatar: document.getElementById(`poker-avatar-${i}`),
          mono: document.getElementById(`poker-mono-${i}`),
          username: document.getElementById(`poker-user-${i}`),
          stack: document.getElementById(`poker-stack-${i}`),
          dealerBtn: document.getElementById(`poker-dealer-btn-${i}`),
          blindBadge: document.getElementById(`poker-blind-badge-${i}`),
          actionPill: document.getElementById(`poker-action-pill-${i}`),
          streetBet: document.getElementById(`poker-street-bet-${i}`),
          betVal: document.getElementById(`poker-bet-val-${i}`),
          cardsDock: document.getElementById(`poker-cards-dock-${i}`),
          btnLeave: document.getElementById(`btn-poker-leave-${i}`)
        });
      }
    }

    /**
     * Initializes DOM event listeners and socket event subscriptions.
     */
    init() {
      this.bindDomEvents();
      this.bindSocketEvents();
    }

    /**
     * Binds user interaction events (buttons, sliders, presets, buy-in modal).
     */
    bindDomEvents() {
      // Table Switcher
      if (this.elements.tableBtn1) {
        this.elements.tableBtn1.addEventListener('click', () => this.switchTable('poker_1'));
      }
      if (this.elements.tableBtn2) {
        this.elements.tableBtn2.addEventListener('click', () => this.switchTable('poker_2'));
      }

      // Seat Sit & Leave Buttons
      this.seatElements.forEach((seatBundle, idx) => {
        if (seatBundle.btnSit) {
          seatBundle.btnSit.addEventListener('click', () => this.openBuyInModal(idx));
        }
        if (seatBundle.btnLeave) {
          seatBundle.btnLeave.addEventListener('click', () => this.handleLeaveSeat(idx));
        }
      });

      // Header Rebuy / Top-up Button
      if (this.elements.btnRebuyHeader) {
        this.elements.btnRebuyHeader.addEventListener('click', () => {
          if (this.mySeatIndex !== -1) {
            this.openBuyInModal(this.mySeatIndex, { isRebuy: true });
          }
        });
      }

      // Buy-In Modal Controls
      if (this.elements.buyinSlider && this.elements.buyinAmount) {
        this.elements.buyinSlider.addEventListener('input', () => {
          this.elements.buyinAmount.value = this.elements.buyinSlider.value;
          this.updateBuyinConfirmButtonText();
        });
        this.elements.buyinAmount.addEventListener('input', () => {
          this.elements.buyinSlider.value = this.elements.buyinAmount.value;
          this.updateBuyinConfirmButtonText();
        });
      }

      if (this.elements.btnBuyinMin) {
        this.elements.btnBuyinMin.addEventListener('click', () => {
          if (this.isRebuyMode) {
            const bb = (this.currentTableState && this.currentTableState.bigBlindAmount) || 100;
            const maxVal = parseInt(this.elements.buyinSlider.max, 10) || 5000;
            this.setBuyinAmount(Math.min(bb * 5, maxVal));
          } else {
            const minVal = parseInt(this.elements.buyinSlider.min, 10) || 2000;
            this.setBuyinAmount(minVal);
          }
        });
      }
      if (this.elements.btnBuyinMid) {
        this.elements.btnBuyinMid.addEventListener('click', () => {
          if (this.isRebuyMode) {
            const bb = (this.currentTableState && this.currentTableState.bigBlindAmount) || 100;
            const maxVal = parseInt(this.elements.buyinSlider.max, 10) || 5000;
            this.setBuyinAmount(Math.min(bb * 20, maxVal));
          } else {
            const minVal = parseInt(this.elements.buyinSlider ? this.elements.buyinSlider.min : 2000, 10);
            const maxVal = parseInt(this.elements.buyinSlider ? this.elements.buyinSlider.max : 10000, 10);
            const midVal = Math.round((minVal + maxVal) / 2 / 100) * 100;
            const bankroll = (this.ui && this.ui.myPlayer && this.ui.myPlayer.chips) || 0;
            let target = midVal;
            if (bankroll >= minVal && bankroll < target) target = bankroll;
            this.setBuyinAmount(Math.min(Math.max(target, minVal), maxVal));
          }
        });
      }
      if (this.elements.btnBuyinMax) {
        this.elements.btnBuyinMax.addEventListener('click', () => {
          const maxVal = parseInt(this.elements.buyinSlider.max, 10) || 10000;
          const bankroll = (this.ui && this.ui.myPlayer && this.ui.myPlayer.chips) || 0;
          this.setBuyinAmount(Math.min(maxVal, bankroll));
        });
      }

      if (this.elements.btnConfirmBuyin) {
        this.elements.btnConfirmBuyin.addEventListener('click', () => this.confirmBuyIn());
      }
      if (this.elements.btnCancelBuyin) {
        this.elements.btnCancelBuyin.addEventListener('click', () => this.closeBuyInModal());
      }
      if (this.elements.btnCloseModal) {
        this.elements.btnCloseModal.addEventListener('click', () => this.closeBuyInModal());
      }

      // Keyboard shortcuts for Buy-In modal (Enter confirms default/chosen buy-in, Escape cancels)
      if (this.elements.buyinModal) {
        this.elements.buyinModal.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            this.confirmBuyIn();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            this.closeBuyInModal();
          }
        });
      }
      if (this.elements.buyinAmount) {
        this.elements.buyinAmount.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            this.confirmBuyIn();
          }
        });
      }

      // Raise Sizing Slider & Input
      if (this.elements.raiseSlider && this.elements.raiseInput) {
        this.elements.raiseSlider.addEventListener('input', () => {
          this.selectedRaiseAmount = parseInt(this.elements.raiseSlider.value, 10);
          this.elements.raiseInput.value = this.selectedRaiseAmount;
          this.updateRaiseButtonText();
        });
        this.elements.raiseInput.addEventListener('input', () => {
          let val = parseInt(this.elements.raiseInput.value, 10);
          if (!isNaN(val)) {
            const min = parseInt(this.elements.raiseSlider.min, 10);
            const max = parseInt(this.elements.raiseSlider.max, 10);
            if (val > max) val = max;
            this.selectedRaiseAmount = val;
            this.elements.raiseSlider.value = val;
            this.updateRaiseButtonText();
          }
        });
      }

      // Quick Preset Sizing Buttons
      const presetButtons = [
        { btn: this.elements.btnPreset1bb, preset: '1bb' },
        { btn: this.elements.btnPreset2x, preset: '2x' },
        { btn: this.elements.btnPreset3x, preset: '3x' },
        { btn: this.elements.btnPresetHalfPot, preset: 'half_pot' },
        { btn: this.elements.btnPresetPot, preset: 'pot' },
        { btn: this.elements.btnPresetAllin, preset: 'all_in' }
      ];

      presetButtons.forEach(({ btn, preset }) => {
        if (btn) {
          btn.addEventListener('click', () => this.applyPresetSizing(preset));
        }
      });

      // Decision Buttons
      if (this.elements.btnFold) {
        this.elements.btnFold.addEventListener('click', () => this.handleAction('fold', 0));
      }
      if (this.elements.btnCheckCall) {
        this.elements.btnCheckCall.addEventListener('click', () => {
          this.handleAction(this.currentCheckCallAction, this.currentCheckCallAmount);
        });
      }
      if (this.elements.btnRaise) {
        this.elements.btnRaise.addEventListener('click', () => {
          const act = (this.currentTableState && this.currentTableState.currentBet > 0) ? 'raise' : 'bet';
          this.handleAction(act, this.selectedRaiseAmount);
        });
      }

      // Peek / Hide Cards Toggle Button
      if (this.elements.btnPeek) {
        this.elements.btnPeek.addEventListener('click', () => {
          this.togglePeekRevealed();
        });
      }

      // Keyboard shortcuts for Poker (Spacebar or 'P' toggles Peek/Hide)
      window.addEventListener('keydown', (e) => {
        const activeTag = document.activeElement && document.activeElement.tagName ? document.activeElement.tagName.toLowerCase() : '';
        if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') return;
        if (this.elements.buyinModal && !this.elements.buyinModal.classList.contains('hidden')) return;
        if (this.elements.viewPoker && this.elements.viewPoker.classList.contains('hidden')) return;

        if (e.key === ' ' || e.code === 'Space' || e.key === 'p' || e.key === 'P') {
          if (this.mySeatIndex !== -1) {
            e.preventDefault();
            this.togglePeekRevealed();
          }
        }
      });
    }

    /**
     * Binds real-time socket events from CasinoNetwork.
     */
    bindSocketEvents() {
      if (!this.network) return;

      this.network.on('poker_table_state', (data) => this.onTableState(data));
      this.network.on('poker_seat_taken', (data) => this.onSeatTaken(data));
      this.network.on('poker_seat_left', (data) => this.onSeatLeft(data));
      this.network.on('poker_seat_vacated', (data) => this.onSeatLeft(data));
      this.network.on('poker_seat_accepted', (data) => this.onSeatAccepted(data));
      this.network.on('poker_seat_error', (data) => this.onSeatError(data));
      this.network.on('poker_hole_cards', (data) => this.onHoleCards(data));
      this.network.on('poker_community_cards', (data) => this.onCommunityCards(data));
      this.network.on('poker_community_dealt', (data) => this.onCommunityCards(data));
      this.network.on('poker_turn_change', (data) => this.onTurnChange(data));
      this.network.on('poker_turn_changed', (data) => this.onTurnChange(data));
      this.network.on('poker_turn_tick', (data) => this.onPhaseTick(data));
      this.network.on('poker_phase_tick', (data) => this.onPhaseTick(data));
      this.network.on('poker_phase_change', (data) => this.onPhaseChange(data));
      this.network.on('poker_phase_changed', (data) => this.onPhaseChange(data));
      this.network.on('poker_player_acted', (data) => this.onPlayerActed(data));
      this.network.on('poker_player_action', (data) => this.onPlayerActed(data));
      this.network.on('poker_action_rejected', (data) => this.onActionRejected(data));
      this.network.on('poker_hand_start', (data) => this.onHandStart(data));
      this.network.on('poker_hand_started', (data) => this.onHandStart(data));
      this.network.on('poker_hand_end', (data) => this.onHandEnd(data));
      this.network.on('poker_hand_ended', (data) => this.onHandEnd(data));
      this.network.on('poker_showdown', (data) => this.onShowdown(data));
      this.network.on('poker_stack_update', (data) => this.onStackUpdate(data));
      this.network.on('poker_rebuy_success', (data) => this.onRebuySuccess(data));
      this.network.on('poker_rebuy_error', (data) => this.onRebuyError(data));
    }

    /**
     * Handles switching tables between Table 1 and Table 2.
     * @param {'poker_1'|'poker_2'} tableId
     */
    switchTable(tableId) {
      if (tableId === this.currentTableId) return;

      // Check unsettled bets
      if (this.mySeatIndex !== -1 && this.currentTableState) {
        const mySeat = this.currentTableState.seats && this.currentTableState.seats[this.mySeatIndex];
        if (mySeat && !mySeat.folded && !['WAITING_FOR_PLAYERS', 'HAND_END'].includes(this.currentTableState.currentPhase)) {
          this.ui.showToast('Inzet actief — Speel de hand uit voordat je de tafel verlaat', 'error');
          return;
        }
      }

      this.currentTableId = tableId;
      this.mySeatIndex = -1;
      this.privateHoleCards = [];
      this.currentTableState = null;
      this.lastSeatActions.clear();

      if (this.elements.tableBtn1 && this.elements.tableBtn2) {
        this.elements.tableBtn1.classList.toggle('active', tableId === 'poker_1');
        this.elements.tableBtn2.classList.toggle('active', tableId === 'poker_2');
      }

      this.network.pokerJoinTable(tableId);
      this.ui.updateChatTableFilter(tableId);
      this.ui.showToast(`Verbonden met Poker ${tableId === 'poker_1' ? 'Tafel 1 (50/100)' : 'Tafel 2 (High-Roller)'}`, 'info');
    }

    /**
     * Full table state broadcast received from server.
     * @param {Object} state
     */
    onTableState(state) {
      if (!state || (state.tableId && state.tableId !== this.currentTableId)) return;
      this.currentTableState = state;

      // Identify local hero's seat
      this.detectMySeat(state);

      // Render full table elements
      this.renderTable(state);
    }

    /**
     * Detects if local player occupies one of the seats.
     * @param {Object} state
     */
    detectMySeat(state) {
      const myId = (this.ui && this.ui.myPlayer && this.ui.myPlayer.id) || (this.network && this.network.myPlayerId);
      const myName = (this.ui && this.ui.myPlayer && this.ui.myPlayer.name);
      this.mySeatIndex = -1;

      if (Array.isArray(state.seats) && (myId || myName)) {
        const found = state.seats.find(s => s.player && ((myId && s.player.id === myId) || (myName && s.player.name === myName)));
        if (found) {
          this.mySeatIndex = found.seatIndex;
          if (Array.isArray(found.cards) && found.cards.length > 0 && !found.cards[0].hidden) {
            this.privateHoleCards = found.cards;
          }
        } else {
          this.privateHoleCards = [];
        }
      }

      // Update presence if seated
      if (this.network && typeof this.network.setPlayerPresence === 'function') {
        this.network.setPlayerPresence('POKER', this.mySeatIndex !== -1 ? this.mySeatIndex : null);
      }
    }

    /**
     * Renders the complete 6-seat table, felt, pots, community cards, and controls.
     * @param {Object} state
     */
    renderTable(state) {
      if (!state) return;

      // 1. Header Information
      if (this.elements.tableName) {
        this.elements.tableName.textContent = state.tableName || (state.tableId === 'poker_2' ? "Monte Carlo High-Roller Hold'em" : "Monte Carlo No-Limit Hold'em");
      }
      if (this.elements.tableStakes) {
        const sb = state.smallBlindAmount || 50;
        const bb = state.bigBlindAmount || 100;
        const minB = state.minBuyIn || (bb * 20);
        const maxB = state.maxBuyIn || (bb * 100);
        const defB = state.defaultBuyIn || (bb * 20);
        this.elements.tableStakes.textContent = `Blinds: ${sb} / ${bb} fiches • Entry: ${defB.toLocaleString()} (${minB.toLocaleString()} - ${maxB.toLocaleString()})`;
      }
      if (this.elements.handNumber) {
        this.elements.handNumber.textContent = `#${state.handId || 1}`;
      }

      // 2. Pots (Main Pot & Dynamic Side Pots)
      if (this.elements.potAmount) {
        const potTotal = typeof state.pot === 'number' ? state.pot : 0;
        this.elements.potAmount.textContent = potTotal.toLocaleString();
      }

      if (this.elements.sidePotsRow) {
        this.elements.sidePotsRow.innerHTML = '';
        if (Array.isArray(state.sidePots) && state.sidePots.length > 0) {
          state.sidePots.forEach((sp, idx) => {
            const sidePill = document.createElement('div');
            sidePill.className = 'side-pot-pill';
            const label = document.createElement('span');
            label.textContent = `Side Pot ${idx + 1}:`;
            const val = document.createElement('strong');
            val.textContent = (sp.amount || 0).toLocaleString();
            sidePill.appendChild(label);
            sidePill.appendChild(val);
            this.elements.sidePotsRow.appendChild(sidePill);
          });
        }
      }

      // 3. Phase Indicator
      if (this.elements.phaseText) {
        const phaseName = (state.currentPhase || 'WAITING_FOR_PLAYERS').replace(/_/g, ' ');
        this.elements.phaseText.textContent = phaseName;
      }

      // 4. Community Cards (5 slots)
      this.renderCommunityCards(state.communityCards || []);

      // 5. 6 Radial Player Seats
      const activeSeatIdx = state.activeTurn ? state.activeTurn.seatIndex : -1;
      for (let i = 0; i <= 5; i++) {
        const seatData = (state.seats && state.seats[i]) || { seatIndex: i, player: null };
        this.renderSeat(i, seatData, {
          isActiveTurn: activeSeatIdx === i,
          dealerSeat: state.dealerButtonSeat,
          sbSeat: state.smallBlindSeat,
          bbSeat: state.bigBlindSeat,
          phase: state.currentPhase
        });
      }

      // 6. Player Action Controls
      this.renderActionControls(state);

      // 7. Header Rebuy Button (active when hero is seated)
      if (this.elements.btnRebuyHeader) {
        this.elements.btnRebuyHeader.classList.toggle('hidden', this.mySeatIndex === -1);
      }
    }

    /**
     * Renders the 5 central community card slots with 3D deal animations.
     * @param {Array<Object>} cards
     */
    renderCommunityCards(cards = []) {
      for (let i = 0; i < 5; i++) {
        const slotEl = this.elements.communitySlots[i];
        if (!slotEl) continue;

        const card = cards[i];
        if (!card) {
          // Empty slot placeholder
          slotEl.innerHTML = '<div class="slot-placeholder"></div>';
          slotEl.classList.remove('winning-highlight');
        } else {
          // Only re-render if card changed
          const rawSuit = (card.suit || 'spades').toLowerCase();
          const suitKey = rawSuit.endsWith('s') ? rawSuit.slice(0, -1) : rawSuit;
          const cardSig = `${card.rank}_${suitKey}`;
          const existingCard = slotEl.querySelector('.bj-card');

          if (!existingCard || existingCard.getAttribute('data-card-sig') !== cardSig) {
            slotEl.innerHTML = this.renderCardHtml(card, {
              dealDelay: i >= 3 ? 0.1 : (i * 0.15),
              cardSig
            });
          }
        }
      }
    }

    /**
     * Renders a single radial seat dock.
     * @param {number} seatIndex
     * @param {Object} seatData
     * @param {Object} context
     */
    renderSeat(seatIndex, seatData, { isActiveTurn, dealerSeat, sbSeat, bbSeat, phase }) {
      const bundle = this.seatElements[seatIndex];
      if (!bundle || !bundle.seat) return;

      const player = seatData.player;
      const isHero = seatIndex === this.mySeatIndex;

      if (!player) {
        // Empty Seat
        bundle.seat.classList.add('empty');
        bundle.seat.classList.remove('occupied', 'is-active-turn', 'is-folded');
        if (bundle.emptyBadge) bundle.emptyBadge.classList.remove('hidden');
        if (bundle.occupiedWrap) bundle.occupiedWrap.classList.add('hidden');
        if (bundle.cardsDock) bundle.cardsDock.innerHTML = '';
        if (bundle.btnSit) {
          if (this.mySeatIndex !== -1) {
            bundle.btnSit.classList.add('btn-seat-disabled');
            bundle.btnSit.title = `Je zit al op stoel ${this.mySeatIndex + 1}`;
          } else {
            bundle.btnSit.classList.remove('btn-seat-disabled');
            bundle.btnSit.title = 'Neem plaats aan tafel';
          }
        }
        return;
      }

      // Occupied Seat
      bundle.seat.classList.remove('empty');
      bundle.seat.classList.add('occupied');
      bundle.seat.classList.toggle('is-active-turn', !!isActiveTurn);
      bundle.seat.classList.toggle('is-folded', !!seatData.folded);

      if (bundle.emptyBadge) bundle.emptyBadge.classList.add('hidden');
      if (bundle.occupiedWrap) bundle.occupiedWrap.classList.remove('hidden');

      // Avatar & Monogram
      if (bundle.avatar && bundle.mono) {
        const color = player.color || '#c5a059';
        bundle.avatar.style.backgroundColor = color;
        bundle.mono.textContent = this.ui.getMonogram ? this.ui.getMonogram(player.name) : (player.name ? player.name.slice(0, 2).toUpperCase() : '?');
      }

      // Name & Stack
      if (bundle.username) {
        bundle.username.textContent = player.name || 'Player';
      }
      if (bundle.stack) {
        const stackNum = typeof seatData.stack === 'number' ? seatData.stack : (player.tableStack || 0);
        const pendingStr = seatData.pendingRebuy > 0 ? ` (+${seatData.pendingRebuy.toLocaleString()})` : '';
        bundle.stack.textContent = `${stackNum.toLocaleString()}${pendingStr} fiches`;
        if (isHero && stackNum === 0 && (!seatData.pendingRebuy || seatData.pendingRebuy === 0)) {
          bundle.stack.innerHTML = `<span style="color: #ff6b6b; font-weight: bold;">0 fiches</span> <span style="text-decoration: underline; color: #f9e79f; cursor: pointer; margin-left: 4px;">(+ Bijkopen)</span>`;
        }
      }

      // Player Box interaction: allow hero to click their box to rebuy/top-up
      if (bundle.playerBox) {
        if (isHero) {
          bundle.playerBox.style.cursor = 'pointer';
          bundle.playerBox.title = 'Klik om fiches bij te kopen (Rebuy)';
          if (!bundle.playerBox._rebuyBound) {
            bundle.playerBox._rebuyBound = true;
            bundle.playerBox.addEventListener('click', (e) => {
              if (e.target.closest('.btn-seat-leave')) return;
              this.openBuyInModal(this.mySeatIndex, { isRebuy: true });
            });
          }
        } else {
          bundle.playerBox.style.cursor = 'default';
          bundle.playerBox.title = '';
        }
      }

      // Dealer & Blind Badges
      if (bundle.dealerBtn) {
        bundle.dealerBtn.classList.toggle('hidden', dealerSeat !== seatIndex);
      }
      if (bundle.blindBadge) {
        const isSb = sbSeat === seatIndex;
        const isBb = bbSeat === seatIndex;
        bundle.blindBadge.classList.toggle('hidden', !isSb && !isBb);
        bundle.blindBadge.textContent = isBb ? 'BB' : (isSb ? 'SB' : '');
      }

      // Street Bet Badge (Chips committed this round)
      if (bundle.streetBet && bundle.betVal) {
        const curBet = seatData.currentBet || 0;
        if (curBet > 0 && !seatData.folded) {
          bundle.streetBet.classList.remove('hidden');
          bundle.betVal.textContent = curBet.toLocaleString();
        } else {
          bundle.streetBet.classList.add('hidden');
        }
      }

      // Action Status Pill
      if (bundle.actionPill) {
        const lastAction = this.lastSeatActions.get(seatIndex);
        if (seatData.folded) {
          bundle.actionPill.className = 'poker-action-pill pill-fold';
          bundle.actionPill.textContent = 'FOLD';
          bundle.actionPill.classList.remove('hidden');
        } else if (seatData.isAllIn) {
          bundle.actionPill.className = 'poker-action-pill pill-allin';
          bundle.actionPill.textContent = 'ALL-IN';
          bundle.actionPill.classList.remove('hidden');
        } else if (lastAction && phase !== 'WAITING_FOR_PLAYERS' && phase !== 'HAND_END') {
          bundle.actionPill.className = `poker-action-pill pill-${lastAction.action || 'call'}`;
          bundle.actionPill.textContent = lastAction.text;
          bundle.actionPill.classList.remove('hidden');
        } else {
          bundle.actionPill.classList.add('hidden');
        }
      }

      // Leave Button (Visible only for local hero)
      if (bundle.btnLeave) {
        bundle.btnLeave.classList.toggle('hidden', !isHero);
      }

      // Hole Cards Dock (2 cards)
      if (bundle.cardsDock) {
        const cardsToRender = isHero && this.privateHoleCards.length > 0
          ? this.privateHoleCards
          : (seatData.cards || []);

        this.renderHoleCards(bundle.cardsDock, cardsToRender, isHero, seatData.folded);
      }
    }

    /**
     * Renders the 2 hole cards for a seat with security masking and 3D flip.
     * @param {HTMLElement} dock
     * @param {Array<Object>} cards
     * @param {boolean} isHero
     * @param {boolean} isFolded
     */
    renderHoleCards(dock, cards = [], isHero = false, isFolded = false) {
      if (!Array.isArray(cards) || cards.length === 0) {
        dock.innerHTML = '';
        return;
      }

      const existingCards = Array.from(dock.querySelectorAll('.bj-card'));

      // If dock count does not match cards count, re-render
      if (existingCards.length !== cards.length) {
        dock.innerHTML = '';
        cards.forEach((card, idx) => {
          const isFaceDown = !isHero ? (card.hidden || !card.rank) : (!this.isPeekRevealed || !this.privateHoleCards.length);
          const rawSuit = ((card && card.suit) || 'spades').toLowerCase();
          const suitKey = rawSuit.endsWith('s') ? rawSuit.slice(0, -1) : rawSuit;
          const rank = (card && card.rank) || 'A';
          const cardSig = isFaceDown ? (isHero && !this.isPeekRevealed ? 'peek_hidden' : 'hole_card') : `${rank}_${suitKey}`;

          dock.insertAdjacentHTML('beforeend', this.renderCardHtml(card, {
            dealDelay: idx * 0.12,
            cardSig,
            isFaceDown
          }));
        });
      } else {
        // Incrementally update face-down to face-up on showdown reveal or peek toggle
        cards.forEach((card, idx) => {
          const cardEl = existingCards[idx];
          if (!cardEl) return;
          const isFaceDown = !isHero ? (card.hidden || !card.rank) : (!this.isPeekRevealed || !this.privateHoleCards.length);
          const rawSuit = ((card && card.suit) || 'spades').toLowerCase();
          const suitKey = rawSuit.endsWith('s') ? rawSuit.slice(0, -1) : rawSuit;
          const rank = (card && card.rank) || 'A';
          const newSig = isFaceDown ? (isHero && !this.isPeekRevealed ? 'peek_hidden' : 'hole_card') : `${rank}_${suitKey}`;
          const currentSig = cardEl.getAttribute('data-card-sig');

          if ((currentSig === 'hole_card' || currentSig === 'peek_hidden') && !isFaceDown) {
            // 3D Flip reveal
            cardEl.setAttribute('data-card-sig', newSig);
            cardEl.classList.remove('face-down');
            cardEl.classList.add('face-up', 'card-flip-reveal');
            const front = cardEl.querySelector('.bj-card-front');
            if (front) {
              const isRed = suitKey === 'heart' || suitKey === 'diamond';
              cardEl.classList.add(isRed ? 'card-red' : 'card-black');
              front.innerHTML = `
                <div class="card-corner-top">
                  <span class="card-rank">${rank}</span>
                  <svg class="card-suit-svg" viewBox="0 0 24 24"><use href="#suit-${suitKey}"></use></svg>
                </div>
                <svg class="card-center-suit" viewBox="0 0 24 24"><use href="#suit-${suitKey}"></use></svg>
                <div class="card-corner-bottom">
                  <span class="card-rank">${rank}</span>
                  <svg class="card-suit-svg" viewBox="0 0 24 24"><use href="#suit-${suitKey}"></use></svg>
                </div>
              `;
            }
          } else if (isFaceDown && (currentSig !== 'hole_card' && currentSig !== 'peek_hidden')) {
            // Hero toggled cards concealed
            cardEl.setAttribute('data-card-sig', 'peek_hidden');
            cardEl.classList.remove('face-up', 'card-flip-reveal');
            cardEl.classList.add('face-down');
          }
        });
      }
    }

    /**
     * Toggles the hero private hole card peek reveal state.
     */
    togglePeekRevealed() {
      this.isPeekRevealed = !this.isPeekRevealed;
      this.updatePeekButton();
      if (this.mySeatIndex !== -1 && this.seatElements[this.mySeatIndex]) {
        const dock = this.seatElements[this.mySeatIndex].cardsDock;
        if (dock && this.privateHoleCards.length > 0) {
          this.renderHoleCards(dock, this.privateHoleCards, true, false);
        }
      }
    }

    /**
     * Updates Peek/Hide button attributes and pure vector SVG icon.
     */
    updatePeekButton() {
      if (!this.elements.btnPeek) return;
      const isRevealed = !!this.isPeekRevealed;
      this.elements.btnPeek.setAttribute('aria-pressed', isRevealed ? 'true' : 'false');
      this.elements.btnPeek.title = isRevealed ? 'Spiek / Verberg Kaarten (P)' : 'Spiek / Toon Kaarten (P)';
      const iconUse = this.elements.btnPeek.querySelector('use');
      if (iconUse) {
        iconUse.setAttribute('href', isRevealed ? '#icon-eye-open' : '#icon-eye-closed');
      }
      const label = this.elements.btnPeek.querySelector('.action-btn-text');
      if (label) {
        label.textContent = isRevealed ? 'Verberg' : 'Spiek';
      }
    }

    /**
     * Pure SVG Card HTML Generator with Zero Unicode Emojis.
     * @param {Object} card
     * @param {Object} [opts={}]
     * @returns {string}
     */
    renderCardHtml(card, opts = {}) {
      const dealDelay = (opts && typeof opts.dealDelay === 'number') ? opts.dealDelay : 0;
      const delayStyle = dealDelay > 0 ? `style="--deal-delay: ${dealDelay}s;"` : '';
      const isFaceDown = opts && opts.isFaceDown;

      if (!card || card.hidden || isFaceDown) {
        const sig = (opts && opts.cardSig) || 'hole_card';
        return `
          <div class="bj-card face-down deal-animating" data-card-sig="${sig}" ${delayStyle}>
            <div class="bj-card-inner">
              <div class="bj-card-back"></div>
              <div class="bj-card-front"></div>
            </div>
          </div>
        `;
      }

      const rawSuit = (card.suit || 'spades').toLowerCase();
      const suitKey = rawSuit.endsWith('s') ? rawSuit.slice(0, -1) : rawSuit;
      const rank = card.rank || 'A';
      const isRed = suitKey === 'heart' || suitKey === 'diamond';
      const colorClass = isRed ? 'card-red' : 'card-black';
      const sig = (opts && opts.cardSig) || `${rank}_${suitKey}`;

      return `
        <div class="bj-card face-up ${colorClass} deal-animating" data-card-sig="${sig}" ${delayStyle}>
          <div class="bj-card-inner">
            <div class="bj-card-back"></div>
            <div class="bj-card-front">
              <div class="card-corner-top">
                <span class="card-rank">${rank}</span>
                <svg class="card-suit-svg" viewBox="0 0 24 24"><use href="#suit-${suitKey}"></use></svg>
              </div>
              <svg class="card-center-suit" viewBox="0 0 24 24"><use href="#suit-${suitKey}"></use></svg>
              <div class="card-corner-bottom">
                <span class="card-rank">${rank}</span>
                <svg class="card-suit-svg" viewBox="0 0 24 24"><use href="#suit-${suitKey}"></use></svg>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    /**
     * Reconfigures decision action buttons based on betting state matrix.
     * @param {Object} state
     */
    renderActionControls(state) {
      const isSeated = this.mySeatIndex !== -1;
      const mySeat = isSeated && state.seats && state.seats[this.mySeatIndex];
      const activeSeatIdx = state.activeTurn ? state.activeTurn.seatIndex : -1;
      const isMyTurn = isSeated && mySeat && !mySeat.folded && !mySeat.isAllIn && activeSeatIdx === this.mySeatIndex;

      // Update Peek Toggle Button
      if (this.elements.btnPeek) {
        this.elements.btnPeek.disabled = !isSeated;
        this.updatePeekButton();
      }

      // Start/Stop Turn Countdown Timer
      if (isMyTurn && state.turnTimeLeft !== undefined) {
        this.startTurnTimer(state.turnTimeLeft);
      } else if (!state.activeTurn) {
        this.stopTurnTimer();
      }

      if (!isMyTurn || !mySeat) {
        // Disabled Controls State
        if (this.elements.btnFold) this.elements.btnFold.disabled = true;
        if (this.elements.btnCheckCall) {
          this.elements.btnCheckCall.disabled = true;
          if (this.elements.btnCheckCallText) this.elements.btnCheckCallText.textContent = 'CHECK';
        }
        if (this.elements.btnRaise) {
          this.elements.btnRaise.disabled = true;
          if (this.elements.btnRaiseText) this.elements.btnRaiseText.textContent = 'BET / RAISE';
        }
        if (this.elements.raiseSlider) this.elements.raiseSlider.disabled = true;
        if (this.elements.raiseInput) this.elements.raiseInput.disabled = true;
        this.setPresetsDisabled(true);
        return;
      }

      // Active Decision Turn for Hero
      const currentTableBet = state.currentBet || 0;
      const heroCommitted = mySeat.currentBet || 0;
      const toCall = Math.max(0, currentTableBet - heroCommitted);
      const heroStack = mySeat.stack || 0;
      const bb = state.bigBlindAmount || 100;
      const minRaise = state.minRaise || (currentTableBet + bb);
      const totalCommittedPossibility = heroCommitted + heroStack;

      // 1. Fold Button
      if (this.elements.btnFold) {
        this.elements.btnFold.disabled = false;
      }

      // 2. Check / Call Button
      if (this.elements.btnCheckCall && this.elements.btnCheckCallText) {
        this.elements.btnCheckCall.disabled = false;
        if (toCall === 0) {
          this.currentCheckCallAction = 'check';
          this.currentCheckCallAmount = 0;
          this.elements.btnCheckCallText.textContent = 'CHECK';
        } else if (toCall >= heroStack) {
          this.currentCheckCallAction = 'call';
          this.currentCheckCallAmount = heroStack;
          this.elements.btnCheckCallText.textContent = `CALL ${heroStack.toLocaleString()} (ALL-IN)`;
        } else {
          this.currentCheckCallAction = 'call';
          this.currentCheckCallAmount = toCall;
          this.elements.btnCheckCallText.textContent = `CALL ${toCall.toLocaleString()}`;
        }
      }

      // 3. Bet / Raise Button & Sizing
      const canRaise = heroStack > toCall;
      if (this.elements.btnRaise) {
        this.elements.btnRaise.disabled = !canRaise;
      }

      if (canRaise) {
        // Min & Max Bet/Raise sizing bounds
        let minSize = currentTableBet === 0 ? bb : minRaise;
        minSize = Math.min(minSize, totalCommittedPossibility);
        const maxSize = totalCommittedPossibility;
        const step = state.smallBlindAmount || 50;

        if (this.elements.raiseSlider) {
          this.elements.raiseSlider.disabled = false;
          this.elements.raiseSlider.min = minSize;
          this.elements.raiseSlider.max = maxSize;
          this.elements.raiseSlider.step = step;
          if (this.selectedRaiseAmount < minSize || this.selectedRaiseAmount > maxSize) {
            this.selectedRaiseAmount = minSize;
          }
          this.elements.raiseSlider.value = this.selectedRaiseAmount;
        }

        if (this.elements.raiseInput) {
          this.elements.raiseInput.disabled = false;
          this.elements.raiseInput.min = minSize;
          this.elements.raiseInput.max = maxSize;
          this.elements.raiseInput.step = step;
          this.elements.raiseInput.value = this.selectedRaiseAmount;
        }

        this.setPresetsDisabled(false);
        this.updateRaiseButtonText();
      } else {
        if (this.elements.raiseSlider) this.elements.raiseSlider.disabled = true;
        if (this.elements.raiseInput) this.elements.raiseInput.disabled = true;
        this.setPresetsDisabled(true);
        if (this.elements.btnRaiseText) this.elements.btnRaiseText.textContent = 'BET / RAISE';
      }
    }

    /**
     * Updates text on the Bet/Raise button based on selected amount.
     */
    updateRaiseButtonText() {
      if (!this.elements.btnRaiseText || !this.currentTableState) return;
      const isBet = (this.currentTableState.currentBet || 0) === 0;
      const label = isBet ? 'BET' : 'RAISE NAAR';
      this.elements.btnRaiseText.textContent = `${label} ${this.selectedRaiseAmount.toLocaleString()}`;
    }

    /**
     * Calculates and sets bet sizing preset values.
     * @param {'1bb'|'2x'|'3x'|'half_pot'|'pot'|'all_in'} preset
     */
    applyPresetSizing(preset) {
      if (!this.currentTableState || this.mySeatIndex === -1) return;
      const state = this.currentTableState;
      const mySeat = state.seats && state.seats[this.mySeatIndex];
      if (!mySeat) return;

      const currentBet = state.currentBet || 0;
      const totalPot = state.pot || 0;
      const bb = state.bigBlindAmount || 100;
      const minRaise = state.minRaise || (currentBet + bb);
      const maxPossible = (mySeat.currentBet || 0) + (mySeat.stack || 0);

      let target = minRaise;
      switch (preset) {
        case '1bb':
          target = currentBet === 0 ? bb : minRaise + bb;
          break;
        case '2x':
          target = currentBet === 0 ? bb * 2 : currentBet * 2;
          break;
        case '3x':
          target = currentBet === 0 ? bb * 3 : currentBet * 3;
          break;
        case 'half_pot':
          target = currentBet + Math.round(totalPot / 2);
          break;
        case 'pot':
          target = currentBet + totalPot;
          break;
        case 'all_in':
          target = maxPossible;
          break;
      }

      // Clamp between min and max
      target = Math.max(minRaise, Math.min(target, maxPossible));
      // Round to step
      const step = state.smallBlindAmount || 50;
      target = Math.round(target / step) * step;
      target = Math.max(minRaise, Math.min(target, maxPossible));

      this.selectedRaiseAmount = target;
      if (this.elements.raiseSlider) this.elements.raiseSlider.value = target;
      if (this.elements.raiseInput) this.elements.raiseInput.value = target;
      this.updateRaiseButtonText();
    }

    /**
     * Enables or disables quick sizing preset buttons.
     * @param {boolean} disabled
     */
    setPresetsDisabled(disabled) {
      const btns = [
        this.elements.btnPreset1bb,
        this.elements.btnPreset2x,
        this.elements.btnPreset3x,
        this.elements.btnPresetHalfPot,
        this.elements.btnPresetPot,
        this.elements.btnPresetAllin
      ];
      btns.forEach(b => {
        if (b) b.disabled = !!disabled;
      });
    }

    /**
     * Starts the 15-second visual countdown timer bar with urgent warning states.
     * @param {number} seconds
     */
    startTurnTimer(seconds = 15) {
      this.stopTurnTimer();
      this.turnTimeLeft = seconds;
      this.turnTimeTotal = 15;
      this.updateTimerBar();

      this.turnTimerInterval = setInterval(() => {
        this.turnTimeLeft = Math.max(0, this.turnTimeLeft - 1);
        this.updateTimerBar();
        if (this.turnTimeLeft <= 0) {
          this.stopTurnTimer();
        }
      }, 1000);
    }

    /**
     * Updates linear timer bar width and color based on seconds left.
     */
    updateTimerBar() {
      if (!this.elements.timerBarFill || !this.elements.timerText) return;
      const pct = Math.max(0, Math.min(100, (this.turnTimeLeft / this.turnTimeTotal) * 100));
      this.elements.timerBarFill.style.width = `${pct}%`;
      this.elements.timerText.textContent = `${this.turnTimeLeft}s`;

      this.elements.timerBarFill.classList.remove('timer-warning', 'timer-urgent');
      if (this.turnTimeLeft <= 3) {
        this.elements.timerBarFill.classList.add('timer-urgent');
      } else if (this.turnTimeLeft <= 6) {
        this.elements.timerBarFill.classList.add('timer-warning');
      }
    }

    /**
     * Stops the turn timer and resets progress bar.
     */
    stopTurnTimer() {
      if (this.turnTimerInterval) {
        clearInterval(this.turnTimerInterval);
        this.turnTimerInterval = null;
      }
      if (this.elements.timerBarFill) {
        this.elements.timerBarFill.style.width = '100%';
        this.elements.timerBarFill.classList.remove('timer-warning', 'timer-urgent');
      }
      if (this.elements.timerText) {
        this.elements.timerText.textContent = '15s';
      }
    }

    /**
     * Submits a player decision action to the server via network.
     * @param {'fold'|'check'|'call'|'bet'|'raise'|'allin'} action
     * @param {number} [amount=0]
     */
    handleAction(action, amount = 0) {
      if (this.mySeatIndex === -1) return;
      this.stopTurnTimer();

      // Optimistic UI lock
      if (this.elements.btnFold) this.elements.btnFold.disabled = true;
      if (this.elements.btnCheckCall) this.elements.btnCheckCall.disabled = true;
      if (this.elements.btnRaise) this.elements.btnRaise.disabled = true;
      this.setPresetsDisabled(true);

      this.network.pokerAction(action, amount, this.mySeatIndex, this.currentTableId);
    }

    /**
     * Opens the Cash Game Buy-In Modal for the specified seat index.
     * Supports both initial buy-in and subsequent rebuy / top-up.
     * @param {number} seatIndex
     * @param {{ isRebuy?: boolean }} [options]
     */
    openBuyInModal(seatIndex, { isRebuy = false } = {}) {
      if (!isRebuy && this.mySeatIndex !== -1) {
        if (this.mySeatIndex === seatIndex) {
          this.ui.showToast(`Je zit al op stoel ${seatIndex + 1}`, 'info');
        } else {
          this.ui.showToast(`Je zit al op stoel ${this.mySeatIndex + 1}. Verlaat eerst je huidige stoel om van plaats te wisselen.`, 'warning');
        }
        return;
      }

      this.isRebuyMode = !!isRebuy;
      this.pendingBuyInSeat = seatIndex;
      const bankroll = (this.ui && this.ui.myPlayer && this.ui.myPlayer.chips) || 0;
      const bb = (this.currentTableState && this.currentTableState.bigBlindAmount) || (this.currentTableId === 'poker_2' ? 200 : 100);
      const sb = (this.currentTableState && this.currentTableState.smallBlindAmount) || (bb / 2);
      const minBuyIn = (this.currentTableState && this.currentTableState.minBuyIn) || (bb * 20);
      const maxBuyIn = (this.currentTableState && this.currentTableState.maxBuyIn) || (bb * 100);
      const defaultBuyIn = (this.currentTableState && this.currentTableState.defaultBuyIn) || (bb * 20);

      const currentSeat = isRebuy && this.currentTableState && this.currentTableState.seats && this.currentTableState.seats[seatIndex];
      const currentStack = currentSeat ? ((currentSeat.stack || 0) + (currentSeat.pendingRebuy || 0)) : 0;
      const maxRebuy = Math.max(0, maxBuyIn - currentStack);

      if (isRebuy && maxRebuy <= 0) {
        this.ui.showToast(`Je stack is al maximaal (${maxBuyIn.toLocaleString()} fiches)`, 'info');
        return;
      }

      const tableTitle = this.currentTableId === 'poker_2' ? 'High-Roller Hold\'em' : 'No-Limit Hold\'em';

      if (this.elements.buyinTitle) {
        this.elements.buyinTitle.textContent = isRebuy ? 'Fiches Bijkopen (Rebuy)' : 'Plaatsnemen aan Tafel';
      }
      if (this.elements.buyinLabel) {
        this.elements.buyinLabel.textContent = isRebuy ? 'Kies het gewenste bijkoop bedrag:' : 'Kies je Buy-in Bedrag:';
      }
      if (this.elements.buyinSeatTitle) {
        this.elements.buyinSeatTitle.textContent = isRebuy
          ? `Stoel ${seatIndex + 1} • Huidige stack: ${currentStack.toLocaleString()} fiches (${tableTitle})`
          : `Stoel ${seatIndex + 1} • ${tableTitle}`;
      }
      if (this.elements.buyinBankroll) {
        this.elements.buyinBankroll.textContent = `${bankroll.toLocaleString()} fiches`;
      }
      if (this.elements.buyinBlindsLabel) {
        this.elements.buyinBlindsLabel.innerHTML = `Blinds: <strong>${sb.toLocaleString()} / ${bb.toLocaleString()} fiches</strong>`;
      }
      if (this.elements.buyinDefaultLabel) {
        if (isRebuy) {
          this.elements.buyinDefaultLabel.innerHTML = `Max Stack: <strong>${maxBuyIn.toLocaleString()} fiches</strong>`;
        } else {
          const kStr = defaultBuyIn >= 1000 ? (defaultBuyIn / 1000) + 'k' : defaultBuyIn;
          this.elements.buyinDefaultLabel.innerHTML = `Entry: <strong>${defaultBuyIn.toLocaleString()} fiches (${kStr})</strong>`;
        }
      }
      if (this.elements.buyinMinLabel) {
        if (isRebuy) {
          const minRebuy = Math.min(100, maxRebuy);
          this.elements.buyinMinLabel.innerHTML = `Min Rebuy: <strong>${minRebuy.toLocaleString()} fiches</strong>`;
        } else {
          this.elements.buyinMinLabel.innerHTML = `Min: <strong>${minBuyIn.toLocaleString()} fiches</strong> (20 BB)`;
        }
      }
      if (this.elements.buyinMaxLabel) {
        if (isRebuy) {
          this.elements.buyinMaxLabel.innerHTML = `Max Rebuy: <strong>${maxRebuy.toLocaleString()} fiches</strong>`;
        } else {
          this.elements.buyinMaxLabel.innerHTML = `Max: <strong>${maxBuyIn.toLocaleString()} fiches</strong> (100 BB)`;
        }
      }

      const effectiveMin = isRebuy ? Math.min(100, maxRebuy) : minBuyIn;
      const effectiveMax = isRebuy ? maxRebuy : maxBuyIn;

      if (this.elements.btnBuyinMin) {
        if (isRebuy) {
          const p1 = Math.min(bb * 5, effectiveMax);
          const kStr = p1 >= 1000 ? (p1 / 1000) + 'k' : p1;
          this.elements.btnBuyinMin.textContent = `+${kStr}`;
        } else {
          const kStr = minBuyIn >= 1000 ? (minBuyIn / 1000) + 'k' : minBuyIn;
          this.elements.btnBuyinMin.textContent = `Entry (${kStr})`;
        }
      }
      if (this.elements.btnBuyinMid) {
        if (isRebuy) {
          const p2 = Math.min(bb * 20, effectiveMax);
          const kStr = p2 >= 1000 ? (p2 / 1000) + 'k' : p2;
          this.elements.btnBuyinMid.textContent = `+${kStr}`;
        } else {
          const midVal = Math.round((minBuyIn + maxBuyIn) / 2 / 100) * 100;
          const kStr = midVal >= 1000 ? (midVal / 1000) + 'k' : midVal;
          this.elements.btnBuyinMid.textContent = `${kStr} (50 BB)`;
        }
      }
      if (this.elements.btnBuyinMax) {
        if (isRebuy) {
          const kStr = effectiveMax >= 1000 ? (effectiveMax / 1000) + 'k' : effectiveMax;
          this.elements.btnBuyinMax.textContent = `Max (+${kStr})`;
        } else {
          const kStr = maxBuyIn >= 1000 ? (maxBuyIn / 1000) + 'k' : maxBuyIn;
          this.elements.btnBuyinMax.textContent = `Max (${kStr})`;
        }
      }

      if (this.elements.buyinSlider && this.elements.buyinAmount) {
        this.elements.buyinSlider.min = effectiveMin;
        this.elements.buyinSlider.max = effectiveMax;
        this.elements.buyinSlider.step = bb;
        this.elements.buyinAmount.min = effectiveMin;
        this.elements.buyinAmount.max = effectiveMax;
        this.elements.buyinAmount.step = bb;

        let initialAmount = isRebuy ? Math.min(bb * 20, effectiveMax) : defaultBuyIn;
        if (bankroll >= effectiveMin && bankroll < initialAmount) {
          initialAmount = bankroll;
        } else if (bankroll < effectiveMin) {
          initialAmount = effectiveMin;
        }
        this.setBuyinAmount(initialAmount);
      }

      if (this.elements.buyinError) {
        this.elements.buyinError.classList.add('hidden');
        this.elements.buyinError.textContent = '';
      }

      if (this.elements.buyinModal) {
        this.elements.buyinModal.classList.remove('hidden');
        if (this.elements.btnConfirmBuyin) {
          setTimeout(() => this.elements.btnConfirmBuyin.focus(), 50);
        }
      }
    }

    /**
     * Sets value on both buy-in range slider and number input.
     * @param {number} amount
     */
    setBuyinAmount(amount) {
      if (this.elements.buyinSlider) this.elements.buyinSlider.value = amount;
      if (this.elements.buyinAmount) this.elements.buyinAmount.value = amount;
      this.updateBuyinConfirmButtonText();
    }

    /**
     * Updates confirm button text with chosen buy-in chips amount.
     */
    updateBuyinConfirmButtonText() {
      if (!this.elements.btnConfirmBuyin || !this.elements.buyinAmount) return;
      const amt = parseInt(this.elements.buyinAmount.value, 10) || 0;

      if (this.isRebuyMode) {
        this.elements.btnConfirmBuyin.textContent = `Koop ${amt.toLocaleString()} Fiches Bij`;
        return;
      }

      const bb = (this.currentTableState && this.currentTableState.bigBlindAmount) || (this.currentTableId === 'poker_2' ? 200 : 100);
      const defaultBuyIn = (this.currentTableState && this.currentTableState.defaultBuyIn) || (bb * 20);
      const isDefault = amt === defaultBuyIn;

      const kStr = amt >= 1000 ? (amt / 1000) + 'k' : amt;
      this.elements.btnConfirmBuyin.textContent = isDefault
        ? `Neem Plaats met Entry van ${amt.toLocaleString()} fiches (${kStr})`
        : `Neem Plaats met ${amt.toLocaleString()} fiches`;

      const minVal = parseInt(this.elements.buyinSlider ? this.elements.buyinSlider.min : 2000, 10);
      const maxVal = parseInt(this.elements.buyinSlider ? this.elements.buyinSlider.max : 10000, 10);
      const midVal = Math.round((minVal + maxVal) / 2 / 100) * 100;

      if (this.elements.btnBuyinMin) {
        this.elements.btnBuyinMin.classList.toggle('active-preset', amt === minVal);
      }
      if (this.elements.btnBuyinMid) {
        this.elements.btnBuyinMid.classList.toggle('active-preset', amt === midVal);
      }
      if (this.elements.btnBuyinMax) {
        this.elements.btnBuyinMax.classList.toggle('active-preset', amt === maxVal);
      }
    }

    /**
     * Closes the buy-in modal.
     */
    closeBuyInModal() {
      this.pendingBuyInSeat = null;
      if (this.elements.buyinModal) {
        this.elements.buyinModal.classList.add('hidden');
      }
    }

    /**
     * Validates buy-in amount and submits poker_take_seat socket emit.
     */
    confirmBuyIn() {
      if (typeof this.pendingBuyInSeat !== 'number' || this.pendingBuyInSeat < 0 || this.pendingBuyInSeat > 5) {
        this.closeBuyInModal();
        return;
      }

      if (this.isRebuyMode) {
        const amount = parseInt(this.elements.buyinAmount ? this.elements.buyinAmount.value : 0, 10);
        const bankroll = (this.ui && this.ui.myPlayer && this.ui.myPlayer.chips) || 0;
        const currentSeat = this.currentTableState && this.currentTableState.seats && this.currentTableState.seats[this.pendingBuyInSeat];
        const currentStack = currentSeat ? ((currentSeat.stack || 0) + (currentSeat.pendingRebuy || 0)) : 0;
        const maxBuyIn = (this.currentTableState && this.currentTableState.maxBuyIn) || 10000;
        const maxRebuy = maxBuyIn - currentStack;

        if (isNaN(amount) || amount <= 0) {
          this.showBuyinError('Voer een geldig bijkoop bedrag in');
          return;
        }
        if (amount > maxRebuy) {
          this.showBuyinError(`Maximaal bijkopen is ${maxRebuy.toLocaleString()} fiches (totale stack max ${maxBuyIn.toLocaleString()})`);
          return;
        }
        if (amount > bankroll) {
          this.showBuyinError(`Onvoldoende saldo in je bank (${bankroll.toLocaleString()} fiches beschikbaar)`);
          return;
        }

        this.network.pokerRebuy(amount, this.pendingBuyInSeat, this.currentTableId);
        this.closeBuyInModal();
        return;
      }

      if (this.mySeatIndex !== -1) {
        this.closeBuyInModal();
        this.ui.showToast(`Je zit al op stoel ${this.mySeatIndex + 1}. Verlaat eerst je huidige stoel om van plaats te wisselen.`, 'warning');
        return;
      }

      const amount = parseInt(this.elements.buyinAmount ? this.elements.buyinAmount.value : 0, 10);
      const bankroll = (this.ui && this.ui.myPlayer && this.ui.myPlayer.chips) || 0;
      const bb = (this.currentTableState && this.currentTableState.bigBlindAmount) || (this.currentTableId === 'poker_2' ? 200 : 100);
      const minBuyIn = bb * 20;
      const maxBuyIn = bb * 100;

      if (isNaN(amount) || amount < minBuyIn) {
        this.showBuyinError(`Minimale buy-in is ${minBuyIn.toLocaleString()} fiches (20 BB)`);
        return;
      }
      if (amount > maxBuyIn) {
        this.showBuyinError(`Maximale buy-in is ${maxBuyIn.toLocaleString()} fiches (100 BB)`);
        return;
      }
      if (amount > bankroll) {
        this.showBuyinError(`Onvoldoende saldo in je bank (${bankroll.toLocaleString()} fiches beschikbaar)`);
        return;
      }

      this.network.pokerTakeSeat(this.pendingBuyInSeat, amount, this.currentTableId);
      this.closeBuyInModal();
    }

    /**
     * Shows error inside the buy-in modal dialog.
     * @param {string} msg
     */
    showBuyinError(msg) {
      if (this.elements.buyinError) {
        this.elements.buyinError.textContent = msg;
        this.elements.buyinError.classList.remove('hidden');
      }
    }

    /**
     * Handles clicking the leave seat button.
     * @param {number} seatIndex
     */
    handleLeaveSeat(seatIndex) {
      if (this.currentTableState) {
        const mySeat = this.currentTableState.seats && this.currentTableState.seats[seatIndex];
        if (mySeat && !mySeat.folded && !['WAITING_FOR_PLAYERS', 'HAND_END'].includes(this.currentTableState.currentPhase)) {
          this.ui.showToast('Je hebt een actieve pokerhand. Speel de hand uit voordat je de tafel verlaat.', 'error');
          return;
        }
      }
      this.network.pokerLeaveSeat(seatIndex, this.currentTableId);
    }

    /* =========================================================================
     * Real-time Socket Event Handlers
     * ========================================================================= */

    onSeatTaken(data) {
      if (!data || (data.tableId && data.tableId !== this.currentTableId)) return;
      if (this.currentTableState) {
        this.renderTable(this.currentTableState);
      }
    }

    onSeatLeft(data) {
      if (!data || (data.tableId && data.tableId !== this.currentTableId)) return;
      if (data.seatIndex === this.mySeatIndex) {
        this.mySeatIndex = -1;
        this.privateHoleCards = [];
        this.pendingBuyInSeat = null;
        this.stopTurnTimer();
        this.ui.showToast('Je hebt de tafel verlaten', 'info');
      }
      if (this.currentTableState) {
        this.renderTable(this.currentTableState);
      }
    }

    onSeatAccepted(data) {
      if (!data || (data.tableId && data.tableId !== this.currentTableId)) return;
      this.mySeatIndex = data.seatIndex;
      this.closeBuyInModal();
      const stack = typeof data.stack === 'number' ? data.stack : 0;
      this.ui.showToast(`Plaatsgenomen op stoel ${data.seatIndex + 1} met ${stack.toLocaleString()} fiches`, 'success');
      if (this.currentTableState) {
        this.renderTable(this.currentTableState);
      }
    }

    onSeatError(data) {
      let msg = (data && (data.reason || data.message)) || 'Fout bij plaatsnemen';
      if (data && data.code === 'ALREADY_SEATED') {
        msg = `Je zit al aan deze tafel op stoel ${this.mySeatIndex !== -1 ? this.mySeatIndex + 1 : ''}. Verlaat eerst je huidige stoel.`;
      } else if (data && data.code === 'SEAT_OCCUPIED') {
        msg = 'Deze stoel is al bezet door een andere speler';
      }
      this.ui.showToast(msg, 'error');
      if (this.elements.buyinModal && !this.elements.buyinModal.classList.contains('hidden')) {
        this.showBuyinError(msg);
      }
    }

    onHoleCards(data) {
      if (!data || (data.tableId && data.tableId !== this.currentTableId)) return;
      const cards = data.cards || data.holeCards;
      if (Array.isArray(cards) && cards.length > 0) {
        this.privateHoleCards = cards;
        this.isPeekRevealed = true;
        this.updatePeekButton();
        if (this.mySeatIndex !== -1 && this.seatElements[this.mySeatIndex]) {
          const dock = this.seatElements[this.mySeatIndex].cardsDock;
          if (dock) {
            this.renderHoleCards(dock, this.privateHoleCards, true, false);
          }
        }
      }
    }

    onCommunityCards(data) {
      if (!data || (data.tableId && data.tableId !== this.currentTableId)) return;
      const allCards = data.allCommunityCards || data.communityCards;
      if (Array.isArray(allCards)) {
        this.renderCommunityCards(allCards);
      }
    }

    onTurnChange(data) {
      if (!data || (data.tableId && data.tableId !== this.currentTableId)) return;
      if (this.currentTableState) {
        this.currentTableState.activeTurn = {
          seatIndex: data.activeSeatIndex !== undefined ? data.activeSeatIndex : data.seatIndex,
          playerId: data.playerId
        };
        this.currentTableState.turnTimeLeft = data.turnTimeLeft !== undefined ? data.turnTimeLeft : 15;
        this.renderTable(this.currentTableState);
      }
    }

    onPhaseTick(data) {
      if (!data || (data.tableId && data.tableId !== this.currentTableId)) return;
      const timeLeft = (data.turnTimeLeft !== undefined) ? data.turnTimeLeft : (data.timeLeft !== undefined ? data.timeLeft : 15);
      this.turnTimeLeft = timeLeft;
      this.updateTimerBar();
    }

    onPhaseChange(data) {
      if (!data || (data.tableId && data.tableId !== this.currentTableId)) return;
      if (this.currentTableState) {
        this.currentTableState.currentPhase = data.phase;
        this.renderTable(this.currentTableState);
      }
    }

    onPlayerActed(data) {
      if (!data || (data.tableId && data.tableId !== this.currentTableId)) return;
      if (data.seatIndex !== undefined) {
        let text = (data.action || '').toUpperCase();
        if (data.amount > 0 && (data.action === 'call' || data.action === 'bet' || data.action === 'raise')) {
          text = `${text} ${data.amount.toLocaleString()}`;
        }
        this.lastSeatActions.set(data.seatIndex, {
          action: data.action,
          text,
          amount: data.amount
        });
      }
      if (this.currentTableState) {
        this.renderTable(this.currentTableState);
      }
    }

    onActionRejected(data) {
      const msg = (data && (data.reason || data.message)) || 'Actie afgewezen door dealer';
      this.ui.showToast(msg, 'error');
      if (this.currentTableState) {
        this.renderActionControls(this.currentTableState);
      }
    }

    onHandStart(data) {
      if (!data || (data.tableId && data.tableId !== this.currentTableId)) return;
      this.isPeekRevealed = true;
      this.updatePeekButton();
      this.lastSeatActions.clear();
      this.stopTurnTimer();
      this.hideResultBanner();

      // Clear community cards winning highlights
      for (const slot of this.elements.communitySlots) {
        if (slot) slot.classList.remove('winning-highlight');
      }

      if (this.currentTableState) {
        this.renderTable(this.currentTableState);
      }
    }

    onHandEnd(data) {
      if (!data || (data.tableId && data.tableId !== this.currentTableId)) return;
      this.privateHoleCards = [];
      this.stopTurnTimer();

      // Display Winners Banner & Shimmer
      const winners = data.winners || (data.potsSettled && data.potsSettled[0] && data.potsSettled[0].winners);
      if (Array.isArray(winners) && winners.length > 0) {
        const first = winners[0];
        const winnerName = first.playerName || (first.player && first.player.name) || 'Speler';
        const winAmount = typeof first.amount === 'number' ? first.amount : (first.amountWon || 0);
        const handName = first.handName || (first.hand && first.hand.name) || 'Winnende hand';

        this.showResultBanner(
          `${winnerName.toUpperCase()} WINT!`,
          `+${winAmount.toLocaleString()} fiches`,
          handName
        );

        // Highlight winning 5-card combination on community cards
        if (first.hand && Array.isArray(first.hand.best5)) {
          this.highlightWinningCards(first.hand.best5);
        }

        // If local hero won, burst gold shimmers
        const myId = (this.ui && this.ui.myPlayer && this.ui.myPlayer.id) || (this.network && this.network.myPlayerId);
        const isHeroWinner = winners.some(w => w.playerId === myId || w.seatIndex === this.mySeatIndex);
        if (isHeroWinner) {
          this.triggerWinShimmer(2600);
        }
      }

      if (this.currentTableState) {
        this.renderTable(this.currentTableState);
      }
    }

    onShowdown(data) {
      if (!data || (data.tableId && data.tableId !== this.currentTableId)) return;
      const hands = data.showdownHands || data.revealedHands;
      if (Array.isArray(hands)) {
        hands.forEach(sh => {
          if (sh.seatIndex !== undefined && this.seatElements[sh.seatIndex]) {
            const dock = this.seatElements[sh.seatIndex].cardsDock;
            if (dock && Array.isArray(sh.holeCards || sh.cards)) {
              this.renderHoleCards(dock, sh.holeCards || sh.cards, true, false);
            }
          }
        });
      }
    }

    onStackUpdate(data) {
      if (!data || (data.tableId && data.tableId !== this.currentTableId)) return;
      if (data.seatIndex !== undefined && this.seatElements[data.seatIndex]) {
        const stackEl = this.seatElements[data.seatIndex].stack;
        if (stackEl && typeof data.newStack === 'number') {
          stackEl.textContent = `${data.newStack.toLocaleString()} fiches`;
        }
      }
    }

    onRebuySuccess(data) {
      if (!data) return;
      const amount = data.amount || 0;
      if (data.pending) {
        this.ui.showToast(`Rebuy van ${amount.toLocaleString()} fiches ontvangen! Wordt toegevoegd aan het begin van de volgende hand.`, 'success');
      } else {
        this.ui.showToast(`Rebuy van ${amount.toLocaleString()} fiches succesvol toegevoegd aan je stack!`, 'success');
      }
      if (this.currentTableState && this.currentTableState.seats && typeof data.seatIndex === 'number') {
        const s = this.currentTableState.seats[data.seatIndex];
        if (s) {
          if (typeof data.stack === 'number') s.stack = data.stack;
          if (typeof data.pendingRebuy === 'number') s.pendingRebuy = data.pendingRebuy;
          this.renderTable(this.currentTableState);
        }
      }
    }

    onRebuyError(data) {
      if (!data) return;
      this.ui.showToast(data.reason || 'Bijkopen mislukt', 'error');
    }

    /**
     * Highlights winning community cards with a radiant gold aura.
     * @param {Array<Object>} best5Cards
     */
    highlightWinningCards(best5Cards) {
      if (!Array.isArray(best5Cards)) return;
      for (const slot of this.elements.communitySlots) {
        if (!slot) continue;
        const cardEl = slot.querySelector('.bj-card');
        if (!cardEl) continue;
        const sig = cardEl.getAttribute('data-card-sig');
        const matches = best5Cards.some(c => {
          const rawSuit = (c.suit || '').toLowerCase();
          const suitKey = rawSuit.endsWith('s') ? rawSuit.slice(0, -1) : rawSuit;
          return `${c.rank}_${suitKey}` === sig;
        });
        if (matches) {
          slot.classList.add('winning-highlight');
        }
      }
    }

    /**
     * Displays outcome result banner.
     * @param {string} title
     * @param {string} [subtitle='']
     * @param {string} [detail='']
     */
    showResultBanner(title, subtitle = '', detail = '') {
      const banner = this.elements.resultBanner;
      if (!banner) return;
      banner.innerHTML = `
        <div class="result-banner-title">${title}</div>
        ${subtitle ? `<div class="result-banner-sub text-gold">${subtitle}</div>` : ''}
        ${detail ? `<div class="result-banner-detail">${detail}</div>` : ''}
      `;
      banner.classList.remove('hidden');
      setTimeout(() => this.hideResultBanner(), 4000);
    }

    /**
     * Hides outcome result banner.
     */
    hideResultBanner() {
      if (this.elements.resultBanner) {
        this.elements.resultBanner.classList.add('hidden');
        this.elements.resultBanner.innerHTML = '';
      }
    }

    /**
     * Celebratory golden particle shimmer on poker win canvas.
     * @param {number} [durationMs=2400]
     */
    triggerWinShimmer(durationMs = 2400) {
      const canvas = this.elements.winShimmerCanvas;
      if (!canvas || !canvas.getContext) return;

      canvas.width = canvas.parentElement ? canvas.parentElement.clientWidth : 800;
      canvas.height = canvas.parentElement ? canvas.parentElement.clientHeight : 500;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const particles = [];
      const colors = ['#f9e79f', '#d4af37', '#ffffff', '#10b981'];
      for (let i = 0; i < 60; i++) {
        particles.push({
          x: canvas.width / 2 + (Math.random() - 0.5) * 120,
          y: canvas.height / 2 + (Math.random() - 0.5) * 60,
          vx: (Math.random() - 0.5) * 6,
          vy: -Math.random() * 5 - 2,
          radius: Math.random() * 3.5 + 1.5,
          color: colors[Math.floor(Math.random() * colors.length)],
          alpha: 1.0,
          decay: Math.random() * 0.015 + 0.01
        });
      }

      const start = Date.now();
      const loop = () => {
        const elapsed = Date.now() - start;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        particles.forEach(p => {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.08; // gravity
          p.alpha = Math.max(0, p.alpha - p.decay);

          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.globalAlpha = p.alpha;
          ctx.fill();
        });

        if (elapsed < durationMs) {
          requestAnimationFrame(loop);
        } else {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      };

      requestAnimationFrame(loop);
    }
  }

  return CasinoPoker;
}));
