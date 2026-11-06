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

  class CasinoBank {
    /**
     * @param {Object} options
     * @param {Object} options.network
     * @param {Object} options.ui
     */
    constructor({ network, ui }) {
      this.network = network;
      this.ui = ui;

      this.currentBankData = {
        incomingProposals: [],
        outgoingProposals: [],
        activeDebts: [],
        activeLoansGiven: [],
        bailoutStatus: { canClaim: false, timeLeftMs: 0, eligibleByChips: false }
      };

      this.connectedPlayers = [];
      this.bailoutInterval = null;

      this._cacheElements();
      this._bindEvents();
      this._startBailoutTimer();
    }

    _cacheElements() {
      this.btnOpenBank = document.getElementById('btn-open-bank');
      this.bankBadge = document.getElementById('bank-badge');
      this.bankTabBadge = document.getElementById('bank-tab-badge');
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
      this.listIncomingProposals = document.getElementById('bank-incoming-proposals');
      this.listMyDebts = document.getElementById('bank-my-debts');
      this.listMyLoansGiven = document.getElementById('bank-my-loans-given');

      // Bailout
      this.lblBailoutTimer = document.getElementById('bailout-timer-val');
      this.lblBailoutReason = document.getElementById('bailout-reason-text');
      this.btnClaimBailout = document.getElementById('btn-claim-bailout');
    }

    _bindEvents() {
      // Open / Close Modal
      if (this.btnOpenBank) {
        this.btnOpenBank.addEventListener('click', () => this.open());
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

    open() {
      if (this.bankModal) {
        this.bankModal.classList.remove('hidden');
        this.network.getBankState();
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
     * @param {Object} data 
     */
    updateBankData(data) {
      if (!data) return;
      this.currentBankData = data;

      // Update badge counters
      const incomingCount = (data.incomingProposals || []).length;
      if (this.bankBadge) {
        this.bankBadge.textContent = incomingCount;
        this.bankBadge.classList.toggle('hidden', incomingCount === 0);
      }
      if (this.bankTabBadge) {
        this.bankTabBadge.textContent = incomingCount;
        this.bankTabBadge.classList.toggle('hidden', incomingCount === 0);
      }

      this._renderIncomingProposals(data.incomingProposals || []);
      this._renderMyDebts(data.activeDebts || []);
      this._renderMyLoansGiven(data.activeLoansGiven || []);
      this._updateBailoutDisplay(data.bailoutStatus);
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
      if (!status) return;

      const myChips = this.ui.myPlayer ? this.ui.myPlayer.chips : 0;
      const eligibleByChips = myChips < 10;
      const timeLeftMs = status.timeLeftMs || 0;
      const canClaim = eligibleByChips && timeLeftMs <= 0;

      if (this.btnClaimBailout) {
        this.btnClaimBailout.disabled = !canClaim;
      }

      const reqChips = document.getElementById('req-chips-item');
      if (reqChips) {
        reqChips.classList.toggle('req-met', eligibleByChips);
      }
      const reqCooldown = document.getElementById('req-cooldown-item');
      if (reqCooldown) {
        reqCooldown.classList.toggle('req-met', timeLeftMs <= 0);
      }

      if (this.lblBailoutTimer) {
        if (timeLeftMs > 0) {
          const totalSec = Math.ceil(timeLeftMs / 1000);
          const mins = Math.floor(totalSec / 60);
          const secs = totalSec % 60;
          this.lblBailoutTimer.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
          this.lblBailoutTimer.className = 'bailout-timer-val timer-waiting';
        } else {
          this.lblBailoutTimer.textContent = 'Beschikbaar';
          this.lblBailoutTimer.className = 'bailout-timer-val timer-ready';
        }
      }

      if (this.lblBailoutReason) {
        if (!eligibleByChips) {
          this.lblBailoutReason.textContent = `Noodfiches zijn enkel beschikbaar wanneer je saldo minder dan 10 fiches is (huidig saldo: ${myChips.toLocaleString()} fiches).`;
        } else if (timeLeftMs > 0) {
          this.lblBailoutReason.textContent = 'Wacht tot de aftelklok op 00:00 staat om opnieuw 100 fiches te claimen.';
        } else {
          this.lblBailoutReason.textContent = 'Je saldo is lager dan 10 fiches. Klik op de knop om direct 100 gratis fiches te ontvangen.';
        }
      }
    }

    _startBailoutTimer() {
      if (this.bailoutInterval) clearInterval(this.bailoutInterval);
      this.bailoutInterval = setInterval(() => {
        if (this.currentBankData && this.currentBankData.bailoutStatus) {
          if (this.currentBankData.bailoutStatus.timeLeftMs > 0) {
            this.currentBankData.bailoutStatus.timeLeftMs = Math.max(0, this.currentBankData.bailoutStatus.timeLeftMs - 1000);
          }
          this._updateBailoutDisplay(this.currentBankData.bailoutStatus);
        }
      }, 1000);
    }
  }

  return CasinoBank;
}));
