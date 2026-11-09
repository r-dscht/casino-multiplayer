/**
 * bank.js
 * Frontend controller for Casino Bank & Deals.
 * Handles direct chip transfers, P2P loan negotiations with win deduction,
 * active debt repayment, and the 10-minute emergency chip bailout.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CasinoBank = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const WHEEL_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes
  const DEFAULT_WHEEL_SEGMENTS = [
    { index: 0, amount: 50000, label: '50.000', tier: 'jackpot', color: '#d4af37', textColor: '#071a12' },
    { index: 1, amount: 250, label: '250', tier: 'standard', color: '#0a2e20', textColor: '#f8fafc' },
    { index: 2, amount: 1500, label: '1.500', tier: 'medium', color: '#114b34', textColor: '#fde68a' },
    { index: 3, amount: 500, label: '500', tier: 'standard', color: '#071f15', textColor: '#e2e8f0' },
    { index: 4, amount: 5000, label: '5.000', tier: 'high', color: '#14532d', textColor: '#fcd34d' },
    { index: 5, amount: 750, label: '750', tier: 'common', color: '#0a2e20', textColor: '#f8fafc' },
    { index: 6, amount: 25000, label: '25.000', tier: 'mega', color: '#991b1b', textColor: '#fef08a' },
    { index: 7, amount: 250, label: '250', tier: 'standard', color: '#071f15', textColor: '#e2e8f0' },
    { index: 8, amount: 2500, label: '2.500', tier: 'medium', color: '#114b34', textColor: '#fde68a' },
    { index: 9, amount: 1000, label: '1.000', tier: 'common', color: '#0a2e20', textColor: '#fde68a' },
    { index: 10, amount: 10000, label: '10.000', tier: 'vip', color: '#78350f', textColor: '#fde047' },
    { index: 11, amount: 500, label: '500', tier: 'standard', color: '#071f15', textColor: '#e2e8f0' }
  ];

  class CasinoBank {
    /**
     * @param {Object} options
     * @param {Object} options.network
     * @param {Object} options.ui
     */
    constructor({ network, ui }) {
      this.network = network;
      this.ui = ui;

      this.repaidLoanIds = new Set();
      this.lastWheelSpin = 0;
      this.isWheelSpinning = false;
      this.currentWheelRotation = 0;
      this.wheelCountdownInterval = null;
      this._lastReconcileSentAt = 0;

      this.currentBankData = {
        incomingProposals: [],
        outgoingProposals: [],
        inboxNotifications: [],
        activeDebts: [],
        activeLoansGiven: [],
        repaidLoanIds: [],
        bailoutStatus: { canClaim: false, timeLeftMs: 0, eligibleByChips: false },
        wheelStatus: {
          canSpin: true,
          timeLeftMs: 0,
          cooldownMs: WHEEL_COOLDOWN_MS,
          lastSpinTime: 0,
          nextAvailableTime: 0,
          segments: DEFAULT_WHEEL_SEGMENTS
        }
      };

      this.connectedPlayers = [];
      this.bailoutInterval = null;

      // Restore cached bank data from localStorage across sessions/restarts
      try {
        if (typeof localStorage !== 'undefined') {
          const cached = localStorage.getItem('casino_bank_backup');
          if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed && typeof parsed === 'object') {
              this.currentBankData = {
                ...this.currentBankData,
                ...parsed
              };
              if (Array.isArray(parsed.repaidLoanIds)) {
                parsed.repaidLoanIds.forEach(id => this.repaidLoanIds.add(id));
              }
              if (typeof parsed.lastWheelSpin === 'number' && parsed.lastWheelSpin > 0) {
                this.lastWheelSpin = Math.min(Date.now(), parsed.lastWheelSpin);
              }
            }
          }
          const playerCached = localStorage.getItem('casino_player_backup');
          if (playerCached) {
            const pParsed = JSON.parse(playerCached);
            if (pParsed && typeof pParsed === 'object') {
              if (typeof pParsed.lastWheelSpin === 'number' && pParsed.lastWheelSpin > this.lastWheelSpin) {
                this.lastWheelSpin = Math.min(Date.now(), pParsed.lastWheelSpin);
              }
              if (Array.isArray(pParsed.repaidLoanIds)) {
                pParsed.repaidLoanIds.forEach(id => this.repaidLoanIds.add(id));
              }
            }
          }
        }
      } catch (e) {
        // Ignore localStorage access errors
      }

      this._cacheElements();
      this._bindEvents();
      this._renderWheelSvg(DEFAULT_WHEEL_SEGMENTS);
      this._updateWheelDisplay(this.currentBankData.wheelStatus);

      // Render cached items if present
      if (this.currentBankData) {
        this._renderInboxNotifications(this.currentBankData.inboxNotifications || []);
        this._renderIncomingProposals(this.currentBankData.incomingProposals || []);
        this._renderMyDebts(this.currentBankData.activeDebts || []);
        this._renderMyLoansGiven(this.currentBankData.activeLoansGiven || []);
      }
    }

    _cacheElements() {
      this.btnOpenBank = document.getElementById('btn-open-bank');
      this.btnOpenWheel = document.getElementById('btn-open-wheel');
      this.hudWheelCooldown = document.getElementById('hud-wheel-cooldown');
      this.bankBadge = document.getElementById('bank-badge');
      this.bankTabBadge = document.getElementById('bank-tab-badge');
      this.wheelTabBadge = document.getElementById('wheel-tab-badge');
      this.bankModal = document.getElementById('bank-modal');
      this.btnCloseBankModal = document.getElementById('btn-close-bank-modal');

      // Tabs
      this.tabButtons = document.querySelectorAll('.bank-tab');
      this.tabPanes = document.querySelectorAll('.bank-tab-pane');

      // Transfer Form
      this.formTransfer = document.getElementById('form-bank-transfer');
      this.selectTransferRecipient = document.getElementById('bank-transfer-recipient');
      this.inputTransferAmount = document.getElementById('bank-transfer-amount');

      // Loan Form
      this.formLoan = document.getElementById('form-bank-loan');
      this.selectLoanTarget = document.getElementById('bank-loan-target');
      this.inputLoanAmount = document.getElementById('bank-loan-amount');
      this.sliderLoanInterest = document.getElementById('bank-loan-interest');
      this.sliderLoanDeduction = document.getElementById('bank-loan-deduction');
      this.lblLoanInterest = document.getElementById('lbl-loan-interest');
      this.lblLoanDeduction = document.getElementById('lbl-loan-deduction');

      // Loan Calculation
      this.calcPrincipal = document.getElementById('calc-principal');
      this.calcInterest = document.getElementById('calc-interest');
      this.calcTotalOwed = document.getElementById('calc-total-owed');
      this.calcDeductionPct = document.getElementById('calc-deduction-pct');

      // Inbox Lists
      this.listInboxNotifications = document.getElementById('bank-inbox-notifications');
      this.listIncomingProposals = document.getElementById('bank-incoming-proposals');
      this.listMyDebts = document.getElementById('bank-my-debts');
      this.listMyLoansGiven = document.getElementById('bank-my-loans-given');

      // Bailout
      this.lblBailoutTimer = document.getElementById('bailout-timer-val');
      this.lblBailoutReason = document.getElementById('bailout-reason-text');
      this.btnClaimBailout = document.getElementById('btn-claim-bailout');

      // 15-Minute Lucky Wheel ("Rad van Fortuin")
      this.wheelSvg = document.getElementById('lucky-wheel-svg');
      this.wheelRotor = document.getElementById('lucky-wheel-rotor');
      this.wheelPointer = document.getElementById('lucky-wheel-pointer');
      this.wheelStatusText = document.getElementById('wheel-status-text');
      this.wheelTimerVal = document.getElementById('wheel-timer-val');
      this.wheelTimerPill = document.getElementById('wheel-timer-pill');
      this.wheelResultBanner = document.getElementById('wheel-result-banner');
      this.wheelResultTitle = document.getElementById('wheel-result-title');
      this.wheelResultAmount = document.getElementById('wheel-result-amount');
      this.btnSpinWheel = document.getElementById('btn-spin-wheel');
    }

    _bindEvents() {
      // Open / Close Modal
      if (this.btnOpenBank) {
        this.btnOpenBank.addEventListener('click', () => this.open());
      }
      if (this.btnOpenWheel) {
        this.btnOpenWheel.addEventListener('click', () => this.open('wheel'));
      }
      if (this.btnCloseBankModal) {
        this.btnCloseBankModal.addEventListener('click', () => this.close());
      }
      if (this.bankModal) {
        this.bankModal.addEventListener('click', (e) => {
          if (e.target === this.bankModal) this.close();
        });
      }

      // Tab Switching
      this.tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          const tab = btn.dataset.tab;
          this.switchTab(tab);
        });
      });

      // Transfer Form Submit
      if (this.formTransfer) {
        this.formTransfer.addEventListener('submit', (e) => {
          e.preventDefault();
          const toId = this.selectTransferRecipient.value;
          const amount = parseInt(this.inputTransferAmount.value, 10);
          if (!toId) {
            this.ui.showToast('Selecteer een speler om fiches naar over te maken', 'error');
            return;
          }
          if (!amount || amount <= 0) {
            this.ui.showToast('Voer een geldig aantal fiches in', 'error');
            return;
          }
          this.network.transferChips(toId, amount);
          this.inputTransferAmount.value = '';
        });
      }

      // Loan Calculation Listeners
      const updateCalc = () => this._updateLoanCalculation();
      if (this.inputLoanAmount) this.inputLoanAmount.addEventListener('input', updateCalc);

      // Preset Pill Buttons for Interest (Replaces sliders)
      const interestPills = document.querySelectorAll('#interest-pill-group .preset-pill');
      const summaryInterestPct = document.getElementById('summary-interest-pct');
      interestPills.forEach(pill => {
        pill.addEventListener('click', () => {
          interestPills.forEach(p => p.classList.remove('active'));
          pill.classList.add('active');
          if (this.sliderLoanInterest) {
            this.sliderLoanInterest.value = pill.dataset.val;
          }
          if (this.lblLoanInterest) {
            this.lblLoanInterest.textContent = `${pill.dataset.val}%`;
          }
          if (summaryInterestPct) {
            summaryInterestPct.textContent = `${pill.dataset.val}%`;
          }
          updateCalc();
        });
      });

      // Preset Pill Buttons for Deduction (Replaces sliders)
      const deductionPills = document.querySelectorAll('#deduction-pill-group .preset-pill');
      deductionPills.forEach(pill => {
        pill.addEventListener('click', () => {
          deductionPills.forEach(p => p.classList.remove('active'));
          pill.classList.add('active');
          if (this.sliderLoanDeduction) {
            this.sliderLoanDeduction.value = pill.dataset.val;
          }
          if (this.lblLoanDeduction) {
            this.lblLoanDeduction.textContent = `${pill.dataset.val}%`;
          }
          if (this.calcDeductionPct) {
            this.calcDeductionPct.textContent = `${pill.dataset.val}%`;
          }
          updateCalc();
        });
      });

      // Segmented Deal Direction Toggle (Replaces radio buttons)
      const segmentBtns = document.querySelectorAll('#loan-type-segmented .segment-btn');
      const hiddenDirection = document.getElementById('loan-direction-val');
      segmentBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          segmentBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          if (hiddenDirection) {
            hiddenDirection.value = btn.dataset.type;
          }
        });
      });

      // Quick Chip Increments
      document.querySelectorAll('.btn-quick-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          const targetId = btn.dataset.target;
          const targetInput = document.getElementById(targetId);
          if (!targetInput) return;

          if (btn.dataset.action === 'all') {
            const myChips = (this.ui.myPlayer && typeof this.ui.myPlayer.chips === 'number')
              ? this.ui.myPlayer.chips
              : 0;
            targetInput.value = myChips;
          } else {
            const addVal = parseInt(btn.dataset.add, 10) || 0;
            const currentVal = parseInt(targetInput.value, 10) || 0;
            targetInput.value = currentVal + addVal;
          }
          targetInput.dispatchEvent(new Event('input'));
        });
      });

      // Loan Form Submit
      if (this.formLoan) {
        this.formLoan.addEventListener('submit', (e) => {
          e.preventDefault();
          const toPlayerId = this.selectLoanTarget.value;
          const amount = parseInt(this.inputLoanAmount.value, 10);
          const type = this.formLoan.elements['loan-direction'].value;
          const interestPct = parseInt(this.sliderLoanInterest.value, 10);
          const winDeductionPct = parseInt(this.sliderLoanDeduction.value, 10);

          if (!toPlayerId) {
            this.ui.showToast('Selecteer een speler', 'error');
            return;
          }
          if (!amount || amount < 10) {
            this.ui.showToast('Minimale lening is 10 fiches', 'error');
            return;
          }

          this.network.proposeLoan({
            toPlayerId,
            type,
            amount,
            interestPct,
            winDeductionPct
          });
          this.inputLoanAmount.value = '';
          this.switchTab('inbox');
        });
      }

      // Bailout Claim Button
      if (this.btnClaimBailout) {
        this.btnClaimBailout.addEventListener('click', () => {
          this.network.claimBailout();
        });
      }

      // 15-Minute Lucky Wheel Spin Button
      if (this.btnSpinWheel) {
        this.btnSpinWheel.addEventListener('click', () => {
          this._triggerWheelSpin();
        });
      }
    }

    _updateLoanCalculation() {
      const amount = parseInt(this.inputLoanAmount?.value, 10) || 0;
      const interestPct = parseInt(this.sliderLoanInterest?.value, 10) || 0;
      const interestAmount = Math.round(amount * (interestPct / 100));
      const totalOwed = amount + interestAmount;

      if (this.calcPrincipal) this.calcPrincipal.textContent = `${amount.toLocaleString()} fiches`;
      if (this.calcInterest) this.calcInterest.textContent = `+${interestAmount.toLocaleString()} fiches (${interestPct}%)`;
      if (this.calcTotalOwed) this.calcTotalOwed.textContent = `${totalOwed.toLocaleString()} fiches`;
    }

    open(initialTab = null) {
      if (this.bankModal) {
        this.bankModal.classList.remove('hidden');
        if (initialTab && typeof initialTab === 'string') {
          this.switchTab(initialTab);
        }
        let backup = null;
        try {
          if (typeof localStorage !== 'undefined') {
            const cached = localStorage.getItem('casino_bank_backup');
            if (cached) backup = JSON.parse(cached);
          }
        } catch (e) {}
        this.network.getBankState(backup);
      }
    }

    close() {
      if (this.bankModal) {
        this.bankModal.classList.add('hidden');
      }
    }

    switchTab(tabName) {
      this.tabButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
      });
      this.tabPanes.forEach(pane => {
        pane.classList.toggle('active', pane.id === `bank-pane-${tabName}`);
      });
    }

    /**
     * Updates list of connected online players for transfer/loan dropdowns.
     * @param {Array<Object>} players 
     */
    updateConnectedPlayers(players) {
      if (!Array.isArray(players)) return;
      this.connectedPlayers = players;
      const myId = this.network.myPlayerId || (this.ui.myPlayer ? this.ui.myPlayer.id : null);

      const otherPlayers = players.filter(p => p.id !== myId);

      const updateSelect = (selectElem) => {
        if (!selectElem) return;
        const currentVal = selectElem.value;
        selectElem.innerHTML = '<option value="">Selecteer een speler...</option>';

        if (otherPlayers.length === 0) {
          const opt = document.createElement('option');
          opt.value = '';
          opt.textContent = 'Geen andere spelers online';
          opt.disabled = true;
          selectElem.appendChild(opt);
          return;
        }

        otherPlayers.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = `${p.name} (${(p.chips || 0).toLocaleString()} fiches)`;
          selectElem.appendChild(opt);
        });

        if (currentVal && otherPlayers.some(p => p.id === currentVal)) {
          selectElem.value = currentVal;
        }
      };

      updateSelect(this.selectTransferRecipient);
      updateSelect(this.selectLoanTarget);
    }

    /**
     * Updates bank data received from server.
     * Merges un-repaid local loans if server restarted with an empty state and pushes reconciliation.
     * @param {Object} data 
     */
    updateBankData(data) {
      if (!data) return;

      // 1. Update repaid loan tombstones
      if (Array.isArray(data.repaidLoanIds)) {
        data.repaidLoanIds.forEach(id => {
          if (typeof id === 'string') this.repaidLoanIds.add(id);
        });
      }

      // 2. Reconcile activeDebts & activeLoansGiven so a fresh server restart never wipes local loans
      const prevDebts = (this.currentBankData && Array.isArray(this.currentBankData.activeDebts))
        ? this.currentBankData.activeDebts
        : [];
      const prevLoansGiven = (this.currentBankData && Array.isArray(this.currentBankData.activeLoansGiven))
        ? this.currentBankData.activeLoansGiven
        : [];

      const serverDebts = Array.isArray(data.activeDebts) ? data.activeDebts : [];
      const serverLoansGiven = Array.isArray(data.activeLoansGiven) ? data.activeLoansGiven : [];

      let needsServerReconcile = false;

      const mergeLoanLists = (serverList, localList) => {
        const byId = new Map();
        serverList.forEach(l => {
          if (!l || !l.id) return;
          if (l.status === 'repaid' || this.repaidLoanIds.has(l.id)) {
            this.repaidLoanIds.add(l.id);
            return;
          }
          byId.set(l.id, { ...l });
        });
        localList.forEach(l => {
          if (!l || !l.id) return;
          if (l.status === 'repaid' || this.repaidLoanIds.has(l.id)) {
            this.repaidLoanIds.add(l.id);
            return;
          }
          if ((l.amountRepaid || 0) >= (l.totalOwed || 0)) {
            this.repaidLoanIds.add(l.id);
            return;
          }
          if (!byId.has(l.id)) {
            byId.set(l.id, { ...l, status: 'active' });
            needsServerReconcile = true;
          } else {
            const sLoan = byId.get(l.id);
            if ((l.amountRepaid || 0) > (sLoan.amountRepaid || 0)) {
              sLoan.amountRepaid = l.amountRepaid;
              needsServerReconcile = true;
            }
          }
        });
        return Array.from(byId.values());
      };

      const mergedDebts = mergeLoanLists(serverDebts, prevDebts);
      const mergedLoansGiven = mergeLoanLists(serverLoansGiven, prevLoansGiven);

      // 3. Reconcile 15-Minute Wheel cooldown timestamp across reloads/restarts
      const serverWheelLastSpin = (data.wheelStatus && typeof data.wheelStatus.lastSpinTime === 'number')
        ? data.wheelStatus.lastSpinTime
        : 0;
      if (this.lastWheelSpin > serverWheelLastSpin) {
        needsServerReconcile = true;
      } else if (serverWheelLastSpin > this.lastWheelSpin) {
        this.lastWheelSpin = Math.min(Date.now(), serverWheelLastSpin);
      }

      const reconciledWheelStatus = {
        ...(data.wheelStatus || {}),
        lastSpinTime: this.lastWheelSpin,
        cooldownMs: WHEEL_COOLDOWN_MS,
        segments: (data.wheelStatus && Array.isArray(data.wheelStatus.segments) && data.wheelStatus.segments.length === 12)
          ? data.wheelStatus.segments
          : DEFAULT_WHEEL_SEGMENTS
      };
      const elapsed = Date.now() - this.lastWheelSpin;
      reconciledWheelStatus.timeLeftMs = this.lastWheelSpin > 0 ? Math.max(0, WHEEL_COOLDOWN_MS - elapsed) : 0;
      reconciledWheelStatus.canSpin = reconciledWheelStatus.timeLeftMs === 0;
      reconciledWheelStatus.nextAvailableTime = this.lastWheelSpin > 0 ? (this.lastWheelSpin + WHEEL_COOLDOWN_MS) : Date.now();

      const inboxNotifs = Array.isArray(data.inboxNotifications) ? data.inboxNotifications : [];

      this.currentBankData = {
        ...data,
        inboxNotifications: inboxNotifs,
        activeDebts: mergedDebts,
        activeLoansGiven: mergedLoansGiven,
        repaidLoanIds: Array.from(this.repaidLoanIds),
        wheelStatus: reconciledWheelStatus
      };

      // Update badge counters (incoming loan proposals + unread donation notifications)
      const incomingCount = (data.incomingProposals || []).length + inboxNotifs.length;

      if (this.bankBadge) {
        this.bankBadge.textContent = incomingCount;
        this.bankBadge.classList.toggle('hidden', incomingCount === 0);
      }
      if (this.bankTabBadge) {
        this.bankTabBadge.textContent = incomingCount;
        this.bankTabBadge.classList.toggle('hidden', incomingCount === 0);
      }
      if (this.wheelTabBadge) {
        this.wheelTabBadge.textContent = '1';
        this.wheelTabBadge.classList.toggle('hidden', !reconciledWheelStatus.canSpin);
      }

      this._renderInboxNotifications(inboxNotifs);
      this._renderIncomingProposals(data.incomingProposals || []);
      this._renderMyDebts(mergedDebts);
      this._renderMyLoansGiven(mergedLoansGiven);
      this._updateBailoutDisplay(data.bailoutStatus);
      this._updateWheelDisplay(reconciledWheelStatus);

      // Persist backup in localStorage across sessions/restarts
      const backupPayload = {
        incomingProposals: data.incomingProposals || [],
        outgoingProposals: data.outgoingProposals || [],
        inboxNotifications: inboxNotifs,
        activeDebts: mergedDebts,
        activeLoansGiven: mergedLoansGiven,
        repaidLoanIds: Array.from(this.repaidLoanIds),
        lastWheelSpin: this.lastWheelSpin
      };

      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('casino_bank_backup', JSON.stringify(backupPayload));
        }
      } catch (e) {
        // Ignore localStorage access errors
      }

      if (this.network && typeof this.network.saveClientBackup === 'function') {
        this.network.saveClientBackup({
          activeDebts: mergedDebts,
          activeLoansGiven: mergedLoansGiven,
          repaidLoanIds: Array.from(this.repaidLoanIds),
          lastWheelSpin: this.lastWheelSpin
        });
      }

      // If server was missing un-repaid loans or wheel spin timestamp after a container restart, push them back
      if (needsServerReconcile && this.network && typeof this.network.reconcileBankBackup === 'function') {
        const now = Date.now();
        if (now - this._lastReconcileSentAt > 1500) {
          this._lastReconcileSentAt = now;
          this.network.reconcileBankBackup(backupPayload);
        }
      }
    }

    _renderInboxNotifications(notifications) {
      if (!this.listInboxNotifications) return;
      this.listInboxNotifications.innerHTML = '';

      if (!Array.isArray(notifications) || notifications.length === 0) {
        this.listInboxNotifications.innerHTML = '<div class="empty-state-notice">Geen nieuwe donaties of meldingen</div>';
        return;
      }

      notifications.forEach(notif => {
        const card = document.createElement('div');
        card.className = 'deal-card glass-panel';

        const senderName = notif.fromName || 'Speler';
        const amountStr = typeof notif.amount === 'number' ? notif.amount.toLocaleString() : '0';
        const timeStr = notif.timestamp
          ? new Date(notif.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : '';

        card.innerHTML = `
          <div class="deal-card-header">
            <strong>Donatie van ${senderName}${timeStr ? ` <span style="opacity:0.65;font-weight:400;font-size:0.78rem;">(${timeStr})</span>` : ''}</strong>
            <span class="gold-badge">+${amountStr} fiches</span>
          </div>
          <div class="deal-card-body">${notif.message || `${senderName} heeft je ${amountStr} fiches geschonken!`}</div>
          <div class="deal-card-actions">
            <button type="button" class="btn btn-gold-sm btn-dismiss-notif" data-id="${notif.id}">Gelezen</button>
          </div>
        `;

        const btnDismiss = card.querySelector('.btn-dismiss-notif');
        if (btnDismiss) {
          btnDismiss.addEventListener('click', () => {
            if (this.network && typeof this.network.dismissBankNotification === 'function') {
              this.network.dismissBankNotification(notif.id);
            }
          });
        }

        this.listInboxNotifications.appendChild(card);
      });
    }

    _renderIncomingProposals(proposals) {
      if (!this.listIncomingProposals) return;
      this.listIncomingProposals.innerHTML = '';

      if (proposals.length === 0) {
        this.listIncomingProposals.innerHTML = '<div class="empty-state-notice">Geen inkomende voorstellen</div>';
        return;
      }

      proposals.forEach(prop => {
        const card = document.createElement('div');
        card.className = 'deal-card glass-panel';

        const isBorrowRequest = prop.type === 'borrow';
        const titleText = isBorrowRequest
          ? `${prop.fromName} wil fiches lenen`
          : `${prop.fromName} biedt een lening aan`;

        const descText = isBorrowRequest
          ? `${prop.fromName} vraagt ${prop.amount.toLocaleString()} fiches te leen. Terug te betalen: ${prop.totalOwed.toLocaleString()} fiches (${prop.interestPct}% rente, ${prop.winDeductionPct}% inhouding op nettowinst).`
          : `${prop.fromName} wil jou ${prop.amount.toLocaleString()} fiches lenen. Terug te betalen: ${prop.totalOwed.toLocaleString()} fiches (${prop.interestPct}% rente, ${prop.winDeductionPct}% inhouding op nettowinst).`;

        card.innerHTML = `
          <div class="deal-card-header">
            <strong>${titleText}</strong>
            <span class="gold-badge">${prop.amount.toLocaleString()} fiches</span>
          </div>
          <div class="deal-card-body">${descText}</div>
          <div class="deal-card-actions">
            <button class="btn btn-gold-sm btn-accept" data-id="${prop.id}">Accepteren</button>
            <button class="btn btn-secondary-sm btn-decline" data-id="${prop.id}">Afwijzen</button>
          </div>
        `;

        card.querySelector('.btn-accept').addEventListener('click', () => {
          this.network.respondLoan(prop.id, 'accept');
        });
        card.querySelector('.btn-decline').addEventListener('click', () => {
          this.network.respondLoan(prop.id, 'decline');
        });

        this.listIncomingProposals.appendChild(card);
      });
    }

    _renderMyDebts(debts) {
      if (!this.listMyDebts) return;
      this.listMyDebts.innerHTML = '';

      if (debts.length === 0) {
        this.listMyDebts.innerHTML = '<div class="empty-state-notice">Geen openstaande schulden</div>';
        return;
      }

      debts.forEach(debt => {
        const remaining = debt.totalOwed - debt.amountRepaid;
        const progressPct = Math.min(100, Math.round((debt.amountRepaid / debt.totalOwed) * 100));

        const card = document.createElement('div');
        card.className = 'debt-card glass-panel';
        card.innerHTML = `
          <div class="debt-card-header">
            <span>Schuld aan <strong>${debt.lenderName}</strong></span>
            <span class="debt-badge">Openstaand: ${remaining.toLocaleString()} fiches</span>
          </div>
          <div class="progress-bar-container">
            <div class="progress-bar-fill" style="width: ${progressPct}%;"></div>
          </div>
          <div class="debt-card-details">
            <span>Hoofdsom: ${debt.amount.toLocaleString()} | Totaal: ${debt.totalOwed.toLocaleString()}</span>
            <span>Afgelost: ${debt.amountRepaid.toLocaleString()} (${progressPct}%)</span>
          </div>
          <div class="debt-card-note">
            Automatische inhouding: <strong>${debt.winDeductionPct}%</strong> van elke roulettewinst.
          </div>
          <div class="debt-card-actions">
            <button class="btn btn-gold-sm btn-repay-full" data-id="${debt.id}">Volledig Aflossen (${remaining.toLocaleString()})</button>
          </div>
        `;

        card.querySelector('.btn-repay-full').addEventListener('click', () => {
          this.network.repayDebt(debt.id, remaining);
        });

        this.listMyDebts.appendChild(card);
      });
    }

    _renderMyLoansGiven(loans) {
      if (!this.listMyLoansGiven) return;
      this.listMyLoansGiven.innerHTML = '';

      if (loans.length === 0) {
        this.listMyLoansGiven.innerHTML = '<div class="empty-state-notice">Geen uitstaande leningen verstrekt</div>';
        return;
      }

      loans.forEach(loan => {
        const remaining = loan.totalOwed - loan.amountRepaid;
        const progressPct = Math.min(100, Math.round((loan.amountRepaid / loan.totalOwed) * 100));

        const card = document.createElement('div');
        card.className = 'loan-card glass-panel';
        card.innerHTML = `
          <div class="loan-card-header">
            <span>Lening verstrekt aan <strong>${loan.borrowerName}</strong></span>
            <span class="loan-badge">Te ontvangen: ${remaining.toLocaleString()} fiches</span>
          </div>
          <div class="progress-bar-container">
            <div class="progress-bar-fill progress-emerald" style="width: ${progressPct}%;"></div>
          </div>
          <div class="loan-card-details">
            <span>Verstrekt: ${loan.amount.toLocaleString()} | Totaal: ${loan.totalOwed.toLocaleString()}</span>
            <span>Ontvangen: ${loan.amountRepaid.toLocaleString()} (${progressPct}%)</span>
          </div>
          <div class="loan-card-actions">
            <button class="btn btn-secondary-sm btn-forgive" data-id="${loan.id}">Kwijtschelden</button>
          </div>
        `;

        card.querySelector('.btn-forgive').addEventListener('click', () => {
          if (confirm(`Weet je zeker dat je de resterende schuld van ${loan.borrowerName} wilt kwijtschelden?`)) {
            this.network.forgiveLoan(loan.id);
          }
        });

        this.listMyLoansGiven.appendChild(card);
      });
    }

    _updateBailoutDisplay(status) {
      // Faucet is permanently removed (R5)
      if (this.lblBailoutTimer) this.lblBailoutTimer.textContent = 'Uitgeschakeld';
      if (this.btnClaimBailout) this.btnClaimBailout.disabled = true;
    }

    _startBailoutTimer() {
      // Faucet is permanently removed (R5)
      if (this.bailoutInterval) {
        clearInterval(this.bailoutInterval);
        this.bailoutInterval = null;
      }
    }

    /**
     * Renders the 12-segment Monte Carlo Rad van Fortuin SVG.
     * @param {Array<Object>} segments
     */
    _renderWheelSvg(segments = DEFAULT_WHEEL_SEGMENTS) {
      if (!this.wheelSvg || !Array.isArray(segments) || segments.length === 0) return;
      const n = segments.length;
      const sliceDeg = 360 / n;
      const outerRadius = 144;

      let svgContent = `
        <defs>
          <radialGradient id="wheelBezelGrad" cx="50%" cy="50%" r="50%">
            <stop offset="82%" stop-color="#071a12" />
            <stop offset="92%" stop-color="#b7791f" />
            <stop offset="97%" stop-color="#fde047" />
            <stop offset="100%" stop-color="#78350f" />
          </radialGradient>
        </defs>
        <circle cx="0" cy="0" r="156" fill="url(#wheelBezelGrad)" stroke="#d4af37" stroke-width="2.5" />
      `;

      segments.forEach((seg, idx) => {
        // Slice idx is centered at (-90 + idx * 30) degrees so idx 0 is at 12 o'clock (-90 deg)
        const startDeg = -90 - (sliceDeg / 2) + idx * sliceDeg;
        const endDeg = startDeg + sliceDeg;
        const midDeg = startDeg + (sliceDeg / 2);

        const startRad = (startDeg * Math.PI) / 180;
        const endRad = (endDeg * Math.PI) / 180;

        const x1 = (outerRadius * Math.cos(startRad)).toFixed(2);
        const y1 = (outerRadius * Math.sin(startRad)).toFixed(2);
        const x2 = (outerRadius * Math.cos(endRad)).toFixed(2);
        const y2 = (outerRadius * Math.sin(endRad)).toFixed(2);

        // Brass pin at segment boundary
        const pinX = (150 * Math.cos(startRad)).toFixed(2);
        const pinY = (150 * Math.sin(startRad)).toFixed(2);

        const fill = seg.color || (idx % 2 === 0 ? '#0d3b29' : '#071f15');
        const textFill = seg.textColor || '#f8fafc';
        const isJackpot = seg.tier === 'jackpot' || seg.tier === 'mega' || seg.tier === 'vip';
        const fontSize = seg.label && seg.label.length >= 6 ? '11.5' : '13';

        svgContent += `
          <path d="M 0 0 L ${x1} ${y1} A ${outerRadius} ${outerRadius} 0 0 1 ${x2} ${y2} Z"
                fill="${fill}" stroke="#d4af37" stroke-width="1.2" />
          <g transform="rotate(${midDeg}) translate(94, 0)">
            <text x="0" y="4" fill="${textFill}"
                  font-family="Cinzel, serif" font-weight="${isJackpot ? '900' : '700'}"
                  font-size="${fontSize}" text-anchor="middle" letter-spacing="0.03em">
              ${seg.label}
            </text>
          </g>
          <circle cx="${pinX}" cy="${pinY}" r="3" fill="#fef08a" stroke="#78350f" stroke-width="1" />
        `;
      });

      svgContent += `
        <circle cx="0" cy="0" r="30" fill="#062016" stroke="#d4af37" stroke-width="3" />
      `;

      this.wheelSvg.innerHTML = svgContent;
    }

    /**
     * Updates the wheel status text, spin button state, and starts/updates the 15m countdown timer.
     * @param {Object} wheelStatus
     */
    _updateWheelDisplay(wheelStatus) {
      if (!wheelStatus) return;
      if (Array.isArray(wheelStatus.segments) && wheelStatus.segments.length === 12) {
        this._renderWheelSvg(wheelStatus.segments);
      }

      if (typeof wheelStatus.lastSpinTime === 'number' && wheelStatus.lastSpinTime > this.lastWheelSpin) {
        this.lastWheelSpin = Math.min(Date.now(), wheelStatus.lastSpinTime);
      }

      this._refreshWheelTimerTick();

      if (this.wheelCountdownInterval) {
        clearInterval(this.wheelCountdownInterval);
        this.wheelCountdownInterval = null;
      }

      if (this.lastWheelSpin > 0 && (Date.now() - this.lastWheelSpin) < WHEEL_COOLDOWN_MS) {
        this.wheelCountdownInterval = setInterval(() => {
          this._refreshWheelTimerTick();
        }, 1000);
      }
    }

    _refreshWheelTimerTick() {
      const now = Date.now();
      const elapsed = this.lastWheelSpin > 0 ? (now - this.lastWheelSpin) : WHEEL_COOLDOWN_MS;
      const timeLeftMs = Math.max(0, WHEEL_COOLDOWN_MS - elapsed);
      const canSpin = timeLeftMs === 0;

      if (canSpin && this.wheelCountdownInterval) {
        clearInterval(this.wheelCountdownInterval);
        this.wheelCountdownInterval = null;
      }

      const incomingCount = (this.currentBankData && Array.isArray(this.currentBankData.incomingProposals))
        ? this.currentBankData.incomingProposals.length
        : 0;

      if (this.bankBadge) {
        this.bankBadge.textContent = incomingCount;
        this.bankBadge.classList.toggle('hidden', incomingCount === 0);
      }
      if (this.wheelTabBadge) {
        this.wheelTabBadge.textContent = '1';
        this.wheelTabBadge.classList.toggle('hidden', !canSpin);
      }

      if (this.isWheelSpinning) {
        if (this.btnOpenWheel) {
          this.btnOpenWheel.classList.remove('ready');
          this.btnOpenWheel.classList.add('cooldown');
        }
        if (this.hudWheelCooldown) this.hudWheelCooldown.textContent = 'DRAAIT';
        if (this.wheelStatusText) this.wheelStatusText.textContent = 'Het Rad van Fortuin draait...';
        if (this.wheelTimerVal) this.wheelTimerVal.textContent = 'BEZIG...';
        if (this.btnSpinWheel) {
          this.btnSpinWheel.disabled = true;
          this.btnSpinWheel.textContent = 'Rad draait...';
        }
        return;
      }

      if (canSpin) {
        if (this.btnOpenWheel) {
          this.btnOpenWheel.classList.add('ready');
          this.btnOpenWheel.classList.remove('cooldown');
        }
        if (this.hudWheelCooldown) this.hudWheelCooldown.textContent = 'KLAAR';
        if (this.wheelStatusText) this.wheelStatusText.textContent = 'Klaar om te draaien!';
        if (this.wheelTimerVal) this.wheelTimerVal.textContent = 'NU KLAAR';
        if (this.wheelTimerPill) this.wheelTimerPill.classList.add('ready');
        if (this.btnSpinWheel) {
          this.btnSpinWheel.disabled = false;
          this.btnSpinWheel.textContent = 'Draai het Rad (Gratis)';
        }
      } else {
        const totalSecs = Math.ceil(timeLeftMs / 1000);
        const mins = Math.floor(totalSecs / 60);
        const secs = totalSecs % 60;
        const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        if (this.btnOpenWheel) {
          this.btnOpenWheel.classList.remove('ready');
          this.btnOpenWheel.classList.add('cooldown');
        }
        if (this.hudWheelCooldown) this.hudWheelCooldown.textContent = formatted;
        if (this.wheelStatusText) this.wheelStatusText.textContent = 'Volgende gratis draai over:';
        if (this.wheelTimerVal) this.wheelTimerVal.textContent = formatted;
        if (this.wheelTimerPill) this.wheelTimerPill.classList.remove('ready');
        if (this.btnSpinWheel) {
          this.btnSpinWheel.disabled = true;
          this.btnSpinWheel.textContent = `Wacht ${formatted}`;
        }
      }
    }

    _triggerWheelSpin() {
      if (this.isWheelSpinning) return;
      const now = Date.now();
      const timeLeftMs = this.lastWheelSpin > 0 ? Math.max(0, WHEEL_COOLDOWN_MS - (now - this.lastWheelSpin)) : 0;
      if (timeLeftMs > 0) {
        this._refreshWheelTimerTick();
        return;
      }

      this.isWheelSpinning = true;
      if (this.wheelResultBanner) {
        this.wheelResultBanner.classList.add('hidden');
      }
      this._refreshWheelTimerTick();
      this.network.spinWheel(this.lastWheelSpin);
    }

    /**
     * Handles server 'bank_wheel_result' event, animating the wheel to the exact winning slice.
     * Immediately persists the spin timestamp locally so F5 reload mid-spin cannot bypass cooldown.
     * @param {Object} res
     */
    handleWheelResult(res) {
      if (!res || !res.success) {
        this.isWheelSpinning = false;
        if (res && res.wheelStatus) {
          this._updateWheelDisplay(res.wheelStatus);
        } else {
          this._refreshWheelTimerTick();
        }
        return;
      }

      // Immediately persist cooldown timestamp in localStorage before animation completes (anti-reload protection)
      const spinTs = typeof res.lastSpinTime === 'number' ? res.lastSpinTime : Date.now();
      this.lastWheelSpin = Math.min(Date.now(), spinTs);
      try {
        if (typeof localStorage !== 'undefined') {
          const raw = localStorage.getItem('casino_bank_backup');
          const parsed = raw ? JSON.parse(raw) : {};
          parsed.lastWheelSpin = this.lastWheelSpin;
          localStorage.setItem('casino_bank_backup', JSON.stringify(parsed));
        }
      } catch (e) {}
      if (this.network && typeof this.network.saveClientBackup === 'function') {
        this.network.saveClientBackup({ lastWheelSpin: this.lastWheelSpin, chips: res.chips });
      }

      const segIdx = typeof res.segmentIndex === 'number' ? res.segmentIndex : 1;
      const sliceDeg = 30; // 360 / 12
      // Target angle mod 360 so segment segIdx aligns with 12 o'clock pointer (0 deg offset)
      const targetMod = (360 - ((segIdx * sliceDeg) % 360)) % 360;
      const currentMod = ((this.currentWheelRotation % 360) + 360) % 360;
      let delta = targetMod - currentMod;
      if (delta <= 0) delta += 360;

      // 6 full rotations (2160 deg) + exact delta to winning slice center
      const totalRotation = this.currentWheelRotation + 2160 + delta;
      this.currentWheelRotation = totalRotation;

      if (this.wheelRotor) {
        this.wheelRotor.style.transition = 'transform 4.6s cubic-bezier(0.12, 0.82, 0.14, 1)';
        this.wheelRotor.style.transform = `rotate(${totalRotation}deg)`;
      }
      if (this.wheelPointer) {
        this.wheelPointer.classList.add('pointer-ticking');
      }

      setTimeout(() => {
        this.isWheelSpinning = false;
        if (this.wheelPointer) {
          this.wheelPointer.classList.remove('pointer-ticking');
        }

        if (this.wheelResultBanner && this.wheelResultAmount) {
          const isBig = res.amount >= 5000;
          if (this.wheelResultTitle) {
            this.wheelResultTitle.textContent = res.amount >= 25000
              ? 'JACKPOT PRIJS!'
              : (isBig ? 'GROTE WINST!' : 'PRIJS GEWONNEN!');
          }
          this.wheelResultAmount.textContent = `+${(res.amount || 0).toLocaleString()} FICHES`;
          this.wheelResultBanner.classList.remove('hidden');
        }

        if (this.ui) {
          if (typeof res.chips === 'number' && this.ui.myPlayer) {
            this.ui.myPlayer.chips = res.chips;
            this.ui.updatePlayerHUD();
          }
          if (typeof this.ui.triggerWinShimmer === 'function') {
            this.ui.triggerWinShimmer(res.amount >= 5000 ? 3500 : 2200);
          }
          if (typeof this.ui.showToast === 'function') {
            this.ui.showToast(`Rad van Fortuin: +${(res.amount || 0).toLocaleString()} fiches gewonnen!`, 'success');
          }
        }

        this._updateWheelDisplay(res.wheelStatus || {
          canSpin: false,
          timeLeftMs: WHEEL_COOLDOWN_MS,
          lastSpinTime: this.lastWheelSpin
        });
      }, 4650);
    }
  }

  return CasinoBank;
}));
