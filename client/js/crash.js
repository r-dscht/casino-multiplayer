/**
 * crash.js
 * High-Dopamine Multiplayer Crash Client Controller & 60FPS Canvas Trajectory Renderer.
 *
 * Features:
 * - Smooth 60FPS HTML5 Canvas exponential curve rendering with auto-scaling axes.
 * - Pure vector ascending comet/diamond head with glowing gold/emerald particle trail.
 * - Live multiplayer cashout markers plotted directly on the trajectory curve.
 * - Dramatic crimson/gold shockwave particle burst on CRASHED.
 * - Instant 1-Click Manual Cash Out + Spacebar shortcut + Server-Authoritative Auto-Cashout.
 * - Strict compliance: Zero audio, zero unicode emojis, zero-scroll 100vh layout.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CasinoCrash = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const GROWTH_K = 0.065;
  const GROWTH_EXP = 1.18;
  const MAX_MULTIPLIER = 1000.00;

  function getMonogram(name) {
    if (!name || typeof name !== 'string') return '?';
    const clean = name.replace(/<[^>]*>/g, '').trim();
    if (!clean) return '?';
    const tokens = clean.split(/[\s_\-]+/).filter(t => t.length > 0);
    if (tokens.length >= 2) {
      return (Array.from(tokens[0])[0] + Array.from(tokens[1])[0]).toUpperCase();
    }
    const chars = Array.from(tokens[0]);
    return (chars.length === 1 ? chars[0] : chars[0] + chars[1]).toUpperCase();
  }

  class CasinoCrash {
    /**
     * @param {{ network: Object, ui: Object }} options
     */
    constructor({ network, ui }) {
      this.network = network;
      this.ui = ui;

      // Game State
      this.phase = 'BETTING';
      this.roundId = 1;
      this.timeLeft = 8;
      this.duration = 8;
      this.currentMultiplier = 1.00;
      this.crashPoint = null;
      this.elapsedMs = 0;
      this.localFlightStartPerf = 0;

      // Players & Bets in current round
      this.bets = [];
      this.history = [];
      this.myBet = null;

      // Controls state
      this.selectedChip = 100;
      this.betAmount = 100;
      this.autoCashoutEnabled = false;
      this.autoCashoutValue = 2.00;

      // Canvas & Particles
      this.canvas = null;
      this.ctx = null;
      this.trailParticles = [];
      this.burstParticles = [];
      this.animFrameId = null;

      this.elements = {};
    }

    init() {
      this.cacheElements();
      this.bindEvents();
      this.bindNetworkEvents();
      this.startRenderLoop();
      this.updateControlsUI();
    }

    cacheElements() {
      this.elements = {
        view: document.getElementById('crash-view'),
        canvas: document.getElementById('crash-flight-canvas'),
        historyStrip: document.getElementById('crash-history-strip'),
        statusBadge: document.getElementById('crash-status-badge'),
        multiplierValue: document.getElementById('crash-multiplier-value'),
        livePayoutPill: document.getElementById('crash-live-payout-pill'),
        stageContainer: document.getElementById('crash-stage-container'),

        // Roster
        rosterCount: document.getElementById('crash-roster-count'),
        rosterPot: document.getElementById('crash-roster-pot'),
        playersList: document.getElementById('crash-players-list'),

        // Controls
        betInput: document.getElementById('crash-bet-input'),
        chipBtns: document.querySelectorAll('#crash-view .crash-chip-btn'),
        btnHalf: document.getElementById('btn-crash-half'),
        btnDouble: document.getElementById('btn-crash-double'),
        btnMax: document.getElementById('btn-crash-max'),
        autoToggle: document.getElementById('crash-auto-toggle'),
        autoInput: document.getElementById('crash-auto-input'),
        autoPresets: document.querySelectorAll('#crash-view .crash-auto-preset'),
        mainActionBtn: document.getElementById('btn-crash-main-action'),
        cancelBetBtn: document.getElementById('btn-crash-cancel-bet')
      };

      this.canvas = this.elements.canvas;
      if (this.canvas) {
        this.ctx = this.canvas.getContext('2d');
      }
    }

    bindEvents() {
      // Chip buttons: set or increment bet amount cleanly
      if (this.elements.chipBtns) {
        this.elements.chipBtns.forEach(btn => {
          btn.addEventListener('click', () => {
            this.elements.chipBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const val = parseInt(btn.dataset.val, 10);
            if (!isNaN(val) && val > 0) {
              this.selectedChip = val;
              this.setBetAmount(val);
            }
          });
        });
      }

      if (this.elements.betInput) {
        this.elements.betInput.addEventListener('change', () => {
          const val = parseInt(this.elements.betInput.value, 10);
          this.setBetAmount(isNaN(val) ? 100 : val);
        });
      }

      if (this.elements.btnHalf) {
        this.elements.btnHalf.addEventListener('click', () => {
          this.setBetAmount(Math.max(10, Math.floor(this.betAmount / 2)));
        });
      }

      if (this.elements.btnDouble) {
        this.elements.btnDouble.addEventListener('click', () => {
          const maxAvail = Math.min(50000, (this.ui && this.ui.myPlayer && this.ui.myPlayer.chips) || 50000);
          this.setBetAmount(Math.min(maxAvail, Math.max(10, this.betAmount * 2)));
        });
      }

      if (this.elements.btnMax) {
        this.elements.btnMax.addEventListener('click', () => {
          const maxAvail = Math.min(50000, (this.ui && this.ui.myPlayer && this.ui.myPlayer.chips) || 50000);
          this.setBetAmount(Math.max(10, maxAvail));
        });
      }

      if (this.elements.autoToggle) {
        this.elements.autoToggle.addEventListener('change', () => {
          this.autoCashoutEnabled = !!this.elements.autoToggle.checked;
          if (this.elements.autoInput) {
            this.elements.autoInput.disabled = !this.autoCashoutEnabled;
          }
          this.updateControlsUI();
        });
      }

      if (this.elements.autoInput) {
        this.elements.autoInput.addEventListener('change', () => {
          let val = parseFloat(this.elements.autoInput.value);
          if (isNaN(val) || val < 1.10) val = 1.10;
          if (val > 1000) val = 1000;
          this.autoCashoutValue = Math.floor(val * 100) / 100;
          this.elements.autoInput.value = this.autoCashoutValue.toFixed(2);
        });
      }

      if (this.elements.autoPresets) {
        this.elements.autoPresets.forEach(btn => {
          btn.addEventListener('click', () => {
            const val = parseFloat(btn.dataset.mult);
            if (!isNaN(val) && val >= 1.10) {
              this.autoCashoutEnabled = true;
              this.autoCashoutValue = val;
              if (this.elements.autoToggle) this.elements.autoToggle.checked = true;
              if (this.elements.autoInput) {
                this.elements.autoInput.disabled = false;
                this.elements.autoInput.value = val.toFixed(2);
              }
              this.elements.autoPresets.forEach(b => b.classList.toggle('active', b === btn));
              this.updateControlsUI();
            }
          });
        });
      }

      if (this.elements.mainActionBtn) {
        this.elements.mainActionBtn.addEventListener('click', () => {
          this.handlePrimaryAction();
        });
      }

      if (this.elements.cancelBetBtn) {
        this.elements.cancelBetBtn.addEventListener('click', () => {
          if (this.phase === 'BETTING' && this.myBet) {
            this.network.crashCancelBet();
          }
        });
      }

      // Spacebar shortcut for instant Cash Out during flight
      window.addEventListener('keydown', (e) => {
        if (e.code !== 'Space') return;
        const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') return;
        if (!this.elements.view || this.elements.view.classList.contains('hidden')) return;

        if (this.phase === 'RUNNING' && this.myBet && !this.myBet.cashedOut) {
          e.preventDefault();
          this.network.crashCashOut();
        }
      });
    }

    setBetAmount(val) {
      const clamped = Math.max(10, Math.min(50000, Math.floor(val)));
      this.betAmount = clamped;
      if (this.elements.betInput) {
        this.elements.betInput.value = clamped;
      }
      this.updateControlsUI();
    }

    handlePrimaryAction() {
      if (this.phase === 'BETTING') {
        const autoMult = this.autoCashoutEnabled ? this.autoCashoutValue : null;
        this.network.crashPlaceBet({
          amount: this.betAmount,
          autoCashout: autoMult
        });
      } else if (this.phase === 'RUNNING') {
        if (this.myBet && !this.myBet.cashedOut) {
          this.network.crashCashOut();
        }
      }
    }

    bindNetworkEvents() {
      if (!this.network) return;

      this.network.on('crash_table_state', (state) => {
        if (!state) return;
        this.applyStateSnapshot(state);
      });

      this.network.on('crash_phase_tick', (data) => {
        if (!data) return;
        this.timeLeft = data.timeLeft;
        this.updateCenterHUD();
        if (this.isCrashViewActive()) {
          this.ui.updateTimer(data.timeLeft);
        }
      });

      this.network.on('crash_tick', (data) => {
        if (!data || this.phase !== 'RUNNING') return;
        this.currentMultiplier = data.currentMultiplier;
        this.elapsedMs = data.elapsedMs;
        // Keep local performance clock tightly synced to server elapsedMs
        this.localFlightStartPerf = performance.now() - data.elapsedMs;
        this.updateCenterHUD();
        this.updateControlsUI();
      });

      this.network.on('crash_phase_change', (data) => {
        if (!data) return;
        this.phase = data.phase;
        this.roundId = data.roundId || this.roundId;

        if (Array.isArray(data.history)) {
          this.history = data.history;
          this.renderHistoryStrip();
        }
        if (Array.isArray(data.bets)) {
          this.syncBets(data.bets);
        }

        if (data.phase === 'BETTING') {
          this.timeLeft = data.timeLeft !== undefined ? data.timeLeft : 8;
          this.duration = data.duration || 8;
          this.currentMultiplier = 1.00;
          this.crashPoint = null;
          this.elapsedMs = 0;
          this.myBet = null;
          this.trailParticles = [];
          this.burstParticles = [];
          if (this.elements.stageContainer) {
            this.elements.stageContainer.classList.remove('is-crashed', 'is-flying');
          }
          if (this.isCrashViewActive()) {
            this.ui.updatePhase('BETTING', this.duration, this.timeLeft);
          }
        } else if (data.phase === 'RUNNING') {
          this.currentMultiplier = data.currentMultiplier || 1.00;
          this.elapsedMs = data.elapsedMs || 0;
          this.localFlightStartPerf = performance.now() - this.elapsedMs;
          this.trailParticles = [];
          this.burstParticles = [];
          if (this.elements.stageContainer) {
            this.elements.stageContainer.classList.remove('is-crashed');
            this.elements.stageContainer.classList.add('is-flying');
          }
          if (this.isCrashViewActive()) {
            this.ui.updatePhase('SPINNING', 0, 0);
          }
        } else if (data.phase === 'CRASHED') {
          this.crashPoint = data.crashPoint || this.currentMultiplier;
          this.currentMultiplier = this.crashPoint;
          this.elapsedMs = data.elapsedMs || this.elapsedMs;
          this.timeLeft = data.timeLeft !== undefined ? data.timeLeft : 4;
          this.duration = data.duration || 4;
          if (this.elements.stageContainer) {
            this.elements.stageContainer.classList.remove('is-flying');
            this.elements.stageContainer.classList.add('is-crashed');
          }
          this.spawnCrashBurst();
          if (this.isCrashViewActive()) {
            this.ui.updatePhase('PAYOUT', this.duration, this.timeLeft);
          }
        }

        this.updateCenterHUD();
        this.updateControlsUI();
        this.renderPlayersRoster();
        this.syncNavLock();
      });

      this.network.on('crash_bet_placed', (data) => {
        if (!data) return;
        if (Array.isArray(data.bets)) {
          this.syncBets(data.bets);
        }
        this.renderPlayersRoster();
        this.updateControlsUI();
        this.syncNavLock();
      });

      this.network.on('crash_bet_accepted', (data) => {
        if (!data) return;
        if (data.bet) {
          this.myBet = data.bet;
        }
        this.ui.showToast(`Inzet van ${this.myBet ? this.myBet.amount.toLocaleString() : ''} fiches geplaatst op Crash!`, 'success');
        this.updateCenterHUD();
        this.updateControlsUI();
        this.syncNavLock();
      });

      this.network.on('crash_bet_cancelled', (data) => {
        if (!data) return;
        if (Array.isArray(data.bets)) {
          this.syncBets(data.bets);
        }
        this.renderPlayersRoster();
        this.updateCenterHUD();
        this.updateControlsUI();
        this.syncNavLock();
      });

      this.network.on('crash_bet_cancelled_self', (data) => {
        this.myBet = null;
        this.ui.showToast(`Inzet geannuleerd (+${(data && data.refunded ? data.refunded : 0).toLocaleString()} fiches terug)`, 'info');
        this.updateCenterHUD();
        this.updateControlsUI();
        this.syncNavLock();
      });

      this.network.on('crash_bet_rejected', (data) => {
        const msg = (data && (data.reason || data.message)) || 'Inzet geweigerd';
        this.ui.showToast(msg, 'error');
      });

      this.network.on('crash_player_cashed_out', (data) => {
        if (!data) return;
        if (Array.isArray(data.bets)) {
          this.syncBets(data.bets);
        }
        if (this.ui && this.ui.myPlayer && data.playerId === this.ui.myPlayer.id) {
          if (typeof data.remainingChips === 'number') {
            this.ui.myPlayer.chips = data.remainingChips;
            this.ui.updatePlayerHUD();
          }
          if (data.stats) {
            this.ui.myPlayer.stats = data.stats;
            this.ui.renderMyProfile();
          }
          this.ui.showToast(
            `Uitgecasht op ${data.cashoutMultiplier.toFixed(2)}x! Uitbetaling: +${data.payout.toLocaleString()} fiches`,
            'success'
          );
          if (this.isCrashViewActive() && typeof this.ui.triggerWinShimmer === 'function') {
            this.ui.triggerWinShimmer(data.profit >= 1000 ? 3000 : 2000);
          }
        }
        this.renderPlayersRoster();
        this.updateCenterHUD();
        this.updateControlsUI();
        this.syncNavLock();
      });

      this.network.on('crash_cashout_rejected', (data) => {
        const msg = (data && (data.reason || data.message)) || 'Cashout mislukt';
        this.ui.showToast(msg, 'error');
      });

      this.network.on('crash_round_crashed', (data) => {
        if (!data) return;
        this.phase = 'CRASHED';
        this.crashPoint = data.crashPoint;
        this.currentMultiplier = data.crashPoint;
        this.elapsedMs = data.elapsedMs || this.elapsedMs;
        if (Array.isArray(data.history)) {
          this.history = data.history;
          this.renderHistoryStrip();
        }
        if (Array.isArray(data.bets)) {
          this.syncBets(data.bets);
        }
        this.renderPlayersRoster();
        this.updateCenterHUD();
        this.updateControlsUI();
        this.syncNavLock();
      });
    }

    isCrashViewActive() {
      return Boolean(this.elements.view && !this.elements.view.classList.contains('hidden'));
    }

    hasActiveBet() {
      if (!this.myBet) return false;
      if (this.phase === 'BETTING') return true;
      if (this.phase === 'RUNNING' && !this.myBet.cashedOut) return true;
      return false;
    }

    syncNavLock() {
      if (this.ui && typeof this.ui.setNavigationLocked === 'function') {
        this.ui.setNavigationLocked(this.hasActiveBet());
      }
    }

    applyStateSnapshot(state) {
      this.phase = state.phase || 'BETTING';
      this.roundId = state.roundId || 1;
      this.timeLeft = state.timeLeft || 0;
      this.duration = state.duration || 8;
      this.currentMultiplier = state.currentMultiplier || 1.00;
      this.crashPoint = state.crashPoint || null;
      this.elapsedMs = state.elapsedMs || 0;

      if (this.phase === 'RUNNING') {
        this.localFlightStartPerf = performance.now() - this.elapsedMs;
      }

      if (Array.isArray(state.history)) {
        this.history = state.history;
        this.renderHistoryStrip();
      }

      if (Array.isArray(state.bets)) {
        this.syncBets(state.bets);
      }

      this.renderPlayersRoster();
      this.updateCenterHUD();
      this.updateControlsUI();
      this.syncNavLock();
    }

    syncBets(betsList) {
      this.bets = betsList || [];
      const myId = this.ui && this.ui.myPlayer ? this.ui.myPlayer.id : null;
      this.myBet = myId ? (this.bets.find(b => b.playerId === myId) || null) : null;
    }

    /**
     * Computes smooth interpolated multiplier for 60FPS rendering during RUNNING.
     * @returns {{ mult: number, elapsed: number }}
     */
    getLiveInterpolatedFlight() {
      if (this.phase !== 'RUNNING') {
        return {
          mult: this.phase === 'CRASHED' && this.crashPoint ? this.crashPoint : this.currentMultiplier,
          elapsed: this.elapsedMs
        };
      }
      const nowPerf = performance.now();
      const elapsed = Math.max(this.elapsedMs, nowPerf - this.localFlightStartPerf);
      const tSec = Math.max(0, elapsed / 1000);
      const rawMult = Math.exp(GROWTH_K * Math.pow(tSec, GROWTH_EXP));
      const clamped = Math.min(MAX_MULTIPLIER, Math.max(1.00, rawMult));
      return {
        mult: Math.max(this.currentMultiplier, Math.floor(clamped * 100) / 100),
        elapsed
      };
    }

    renderHistoryStrip() {
      if (!this.elements.historyStrip) return;
      this.elements.historyStrip.innerHTML = '';

      const slice = (this.history || []).slice(0, 12);
      slice.forEach((item, idx) => {
        const val = typeof item === 'number' ? item : (item && item.crashPoint ? item.crashPoint : 1.00);
        const badge = document.createElement('div');
        let tierClass = 'crash-pill-low';
        if (val >= 10.0) {
          tierClass = 'crash-pill-jackpot';
        } else if (val >= 2.0) {
          tierClass = 'crash-pill-mid';
        } else if (val <= 1.05) {
          tierClass = 'crash-pill-bust';
        }
        badge.className = `crash-history-pill ${tierClass}${idx === 0 ? ' is-latest' : ''}`;
        badge.textContent = `${val.toFixed(2)}x`;
        this.elements.historyStrip.appendChild(badge);
      });
    }

    renderPlayersRoster() {
      if (this.elements.rosterCount) {
        this.elements.rosterCount.textContent = `${this.bets.length} ${this.bets.length === 1 ? 'speler' : 'spelers'}`;
      }
      if (this.elements.rosterPot) {
        const total = this.bets.reduce((acc, b) => acc + (b.amount || 0), 0);
        this.elements.rosterPot.textContent = `${total.toLocaleString()} fiches`;
      }

      if (!this.elements.playersList) return;
      this.elements.playersList.innerHTML = '';

      if (this.bets.length === 0) {
        this.elements.playersList.innerHTML = '<div class="empty-state-notice">Nog geen spelers in deze vlucht — plaats je inzet!</div>';
        return;
      }

      const myId = this.ui && this.ui.myPlayer ? this.ui.myPlayer.id : null;

      this.bets.forEach(b => {
        const row = document.createElement('div');
        const isMe = myId && b.playerId === myId;
        let statusClass = 'status-waiting';
        let statusHtml = '';

        if (b.cashedOut) {
          statusClass = 'status-cashed';
          statusHtml = `
            <span class="roster-mult-badge cashed">${b.cashoutMultiplier.toFixed(2)}x</span>
            <span class="roster-payout-val text-emerald">+${(b.payout || 0).toLocaleString()}</span>
          `;
        } else if (this.phase === 'CRASHED') {
          statusClass = 'status-crashed';
          statusHtml = `<span class="roster-mult-badge crashed">Gecrasht</span>`;
        } else if (this.phase === 'RUNNING') {
          statusClass = 'status-flying';
          statusHtml = `<span class="roster-mult-badge flying">In vlucht...</span>`;
        } else {
          statusClass = 'status-betting';
          statusHtml = b.autoCashout
            ? `<span class="roster-mult-badge auto-tag">Auto ${b.autoCashout.toFixed(2)}x</span>`
            : `<span class="roster-mult-badge ready-tag">Gereed</span>`;
        }

        row.className = `crash-roster-row ${statusClass}${isMe ? ' is-me' : ''}`;
        row.innerHTML = `
          <div class="roster-player-col">
            <div class="roster-avatar" style="background-color: ${b.playerColor || '#D4AF37'};">
              <span>${getMonogram(b.playerName)}</span>
            </div>
            <div class="roster-name-wrap">
              <span class="roster-name">${b.playerName}${isMe ? ' (Jij)' : ''}</span>
              <span class="roster-bet">${(b.amount || 0).toLocaleString()} fiches</span>
            </div>
          </div>
          <div class="roster-status-col">
            ${statusHtml}
          </div>
        `;
        this.elements.playersList.appendChild(row);
      });
    }

    updateCenterHUD() {
      const { mult } = this.getLiveInterpolatedFlight();

      if (this.elements.statusBadge) {
        if (this.phase === 'BETTING') {
          this.elements.statusBadge.textContent = `VOLGENDE VLUCHT START OVER ${this.timeLeft}S`;
          this.elements.statusBadge.className = 'crash-status-badge status-betting';
        } else if (this.phase === 'RUNNING') {
          this.elements.statusBadge.textContent = 'IN VLUCHT — MULTIPLIER STIJGT';
          this.elements.statusBadge.className = 'crash-status-badge status-running';
        } else {
          this.elements.statusBadge.textContent = `GECRASHT OP ${(this.crashPoint || mult).toFixed(2)}x`;
          this.elements.statusBadge.className = 'crash-status-badge status-crashed';
        }
      }

      if (this.elements.multiplierValue) {
        const displayMult = this.phase === 'CRASHED' ? (this.crashPoint || mult) : mult;
        this.elements.multiplierValue.textContent = `${displayMult.toFixed(2)}x`;

        let tier = 'tier-1x';
        if (this.phase === 'CRASHED') {
          tier = 'tier-crashed';
        } else if (displayMult >= 10.0) {
          tier = 'tier-10x';
        } else if (displayMult >= 3.0) {
          tier = 'tier-3x';
        } else if (displayMult >= 2.0) {
          tier = 'tier-2x';
        }
        this.elements.multiplierValue.className = `crash-multiplier-value ${tier}`;
      }

      if (this.elements.livePayoutPill) {
        if (this.myBet) {
          if (this.myBet.cashedOut) {
            this.elements.livePayoutPill.textContent =
              `UITGECASHT OP ${this.myBet.cashoutMultiplier.toFixed(2)}x — +${this.myBet.payout.toLocaleString()} FICHES (+${this.myBet.profit.toLocaleString()} WINST)`;
            this.elements.livePayoutPill.className = 'crash-live-payout-pill cashed-win';
          } else if (this.phase === 'RUNNING') {
            const livePayout = Math.floor(this.myBet.amount * mult);
            const liveProfit = Math.max(0, livePayout - this.myBet.amount);
            this.elements.livePayoutPill.textContent =
              `ACTIEVE INZET: ${this.myBet.amount.toLocaleString()} • NU UITCASHEN: ${livePayout.toLocaleString()} FICHES (+${liveProfit.toLocaleString()})`;
            this.elements.livePayoutPill.className = 'crash-live-payout-pill in-flight';
          } else if (this.phase === 'CRASHED') {
            this.elements.livePayoutPill.textContent =
              `TE LAAT! INZET VAN ${this.myBet.amount.toLocaleString()} FICHES VERLOREN`;
            this.elements.livePayoutPill.className = 'crash-live-payout-pill crashed-loss';
          } else {
            const autoTxt = this.myBet.autoCashout ? ` • AUTO-CASHOUT OP ${this.myBet.autoCashout.toFixed(2)}x` : '';
            this.elements.livePayoutPill.textContent =
              `JOUW INZET: ${this.myBet.amount.toLocaleString()} FICHES KLAAR VOOR LANCERING${autoTxt}`;
            this.elements.livePayoutPill.className = 'crash-live-payout-pill ready-bet';
          }
        } else {
          this.elements.livePayoutPill.textContent =
            this.phase === 'BETTING'
              ? 'Kies je inzet en stap in voor de lancering'
              : 'Kijk live mee — je kunt inzetten zodra de volgende ronde start';
          this.elements.livePayoutPill.className = 'crash-live-payout-pill spectator';
        }
      }
    }

    updateControlsUI() {
      const btn = this.elements.mainActionBtn;
      const cancelBtn = this.elements.cancelBetBtn;
      if (!btn) return;

      const { mult } = this.getLiveInterpolatedFlight();

      if (this.phase === 'BETTING') {
        if (this.myBet) {
          btn.disabled = false;
          btn.className = 'btn-crash-action state-add-bet';
          btn.innerHTML = `
            <span class="action-main-label">VERHOOG INZET (+${this.betAmount.toLocaleString()})</span>
            <span class="action-sub-label">Huidige inzet: ${this.myBet.amount.toLocaleString()} fiches</span>
          `;
          if (cancelBtn) {
            cancelBtn.classList.remove('hidden');
          }
        } else {
          btn.disabled = false;
          btn.className = 'btn-crash-action state-bet';
          const autoSub = this.autoCashoutEnabled
            ? `Auto-Cashout actief op ${this.autoCashoutValue.toFixed(2)}x`
            : 'Handmatig uitcashen tijdens de vlucht';
          btn.innerHTML = `
            <span class="action-main-label">PLAATS INZET (${this.betAmount.toLocaleString()} FICHES)</span>
            <span class="action-sub-label">${autoSub}</span>
          `;
          if (cancelBtn) {
            cancelBtn.classList.add('hidden');
          }
        }
      } else if (this.phase === 'RUNNING') {
        if (cancelBtn) cancelBtn.classList.add('hidden');

        if (this.myBet && !this.myBet.cashedOut) {
          const livePayout = Math.floor(this.myBet.amount * mult);
          btn.disabled = false;
          btn.className = 'btn-crash-action state-cashout';
          btn.innerHTML = `
            <span class="action-main-label">CASH OUT — PAK ${livePayout.toLocaleString()} FICHES</span>
            <span class="action-sub-label">Nu op ${mult.toFixed(2)}x (Of druk op SPATIEBALK)</span>
          `;
        } else if (this.myBet && this.myBet.cashedOut) {
          btn.disabled = true;
          btn.className = 'btn-crash-action state-cashed-done';
          btn.innerHTML = `
            <span class="action-main-label">UITGECASHT OP ${this.myBet.cashoutMultiplier.toFixed(2)}x</span>
            <span class="action-sub-label">+${this.myBet.payout.toLocaleString()} fiches bijgeschreven</span>
          `;
        } else {
          btn.disabled = true;
          btn.className = 'btn-crash-action state-waiting';
          btn.innerHTML = `
            <span class="action-main-label">RONDE BEZIG (${mult.toFixed(2)}x)</span>
            <span class="action-sub-label">Wacht op volgende inzetronde...</span>
          `;
        }
      } else {
        // CRASHED
        if (cancelBtn) cancelBtn.classList.add('hidden');
        btn.disabled = true;
        btn.className = 'btn-crash-action state-crashed';
        btn.innerHTML = `
          <span class="action-main-label">GECRASHT OP ${(this.crashPoint || mult).toFixed(2)}x</span>
          <span class="action-sub-label">Nieuwe ronde start over ${this.timeLeft}s...</span>
        `;
      }
    }

    spawnCrashBurst() {
      if (!this.canvas) return;
      this.burstParticles = [];
      const tip = this.lastTipCoords || { x: this.canvas.width * 0.65, y: this.canvas.height * 0.35 };
      const colors = ['#ef4444', '#f87171', '#d4af37', '#fde047', '#ffffff'];
      for (let i = 0; i < 42; i++) {
        const angle = (Math.PI * 2 * i) / 42 + (Math.random() - 0.5) * 0.3;
        const speed = 1.5 + Math.random() * 5.5;
        this.burstParticles.push({
          x: tip.x,
          y: tip.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          r: 2 + Math.random() * 3.5,
          color: colors[i % colors.length],
          alpha: 1.0
        });
      }
    }

    startRenderLoop() {
      const render = () => {
        this.drawCanvasFrame();
        if (this.phase === 'RUNNING') {
          this.updateCenterHUD();
          this.updateControlsUI();
        }
        this.animFrameId = requestAnimationFrame(render);
      };
      this.animFrameId = requestAnimationFrame(render);
    }

    drawCanvasFrame() {
      if (!this.canvas || !this.ctx) return;
      const parent = this.canvas.parentElement;
      if (!parent || parent.clientWidth === 0 || parent.clientHeight === 0) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = parent.clientWidth;
      const height = parent.clientHeight;

      if (this.canvas.width !== Math.floor(width * dpr) || this.canvas.height !== Math.floor(height * dpr)) {
        this.canvas.width = Math.floor(width * dpr);
        this.canvas.height = Math.floor(height * dpr);
      }

      const ctx = this.ctx;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const padLeft = 56;
      const padRight = 36;
      const padTop = 32;
      const padBottom = 38;
      const plotW = Math.max(100, width - padLeft - padRight);
      const plotH = Math.max(80, height - padTop - padBottom);

      const { mult, elapsed } = this.getLiveInterpolatedFlight();

      // Dynamic axis bounds that smoothly expand as the flight progresses
      const maxTimeSec = Math.max(10, (elapsed / 1000) * 1.22);
      const maxMultAxis = Math.max(2.2, mult * 1.25);

      const mapX = (tSec) => padLeft + Math.min(1, Math.max(0, tSec / maxTimeSec)) * plotW;
      const mapY = (mVal) => {
        const norm = Math.max(0, (mVal - 1.0) / Math.max(0.2, maxMultAxis - 1.0));
        return padTop + plotH - Math.min(1, norm) * plotH;
      };

      // 1. Draw Subtle Luxury Grid & Axes Labels
      ctx.strokeStyle = 'rgba(212, 175, 55, 0.11)';
      ctx.fillStyle = 'rgba(212, 175, 55, 0.55)';
      ctx.font = '600 11px Inter, sans-serif';
      ctx.lineWidth = 1;

      const ySteps = 4;
      for (let i = 0; i <= ySteps; i++) {
        const mVal = 1.0 + ((maxMultAxis - 1.0) * i) / ySteps;
        const y = mapY(mVal);
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(padLeft + plotW, y);
        ctx.stroke();

        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(mVal < 10 ? `${mVal.toFixed(1)}x` : `${Math.round(mVal)}x`, padLeft - 8, y);
      }

      const xSteps = 5;
      for (let i = 0; i <= xSteps; i++) {
        const tVal = (maxTimeSec * i) / xSteps;
        const x = mapX(tVal);
        ctx.beginPath();
        ctx.moveTo(x, padTop);
        ctx.lineTo(x, padTop + plotH);
        ctx.stroke();

        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(`${Math.round(tVal)}s`, x, padTop + plotH + 10);
      }

      // Draw Auto-Cashout Target Line if active
      if (this.autoCashoutEnabled && this.autoCashoutValue >= 1.10 && this.autoCashoutValue <= maxMultAxis) {
        const autoY = mapY(this.autoCashoutValue);
        ctx.save();
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(padLeft, autoY);
        ctx.lineTo(padLeft + plotW, autoY);
        ctx.stroke();
        ctx.fillStyle = '#10b981';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.font = '700 10px Inter, sans-serif';
        ctx.fillText(`AUTO ${this.autoCashoutValue.toFixed(2)}x`, padLeft + 8, autoY - 4);
        ctx.restore();
      }

      // 2. If BETTING, draw subtle launchpad origin pulse
      if (this.phase === 'BETTING') {
        const originX = mapX(0);
        const originY = mapY(1.0);
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 220);

        ctx.save();
        ctx.fillStyle = `rgba(212, 175, 55, ${0.15 + pulse * 0.25})`;
        ctx.beginPath();
        ctx.arc(originX, originY, 10 + pulse * 8, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#d4af37';
        ctx.beginPath();
        ctx.arc(originX, originY, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.restore();
        return;
      }

      // 3. Draw Trajectory Curve & Area Fill (RUNNING or CRASHED)
      const totalSec = Math.max(0.02, elapsed / 1000);
      const samples = 80;
      const points = [];
      for (let i = 0; i <= samples; i++) {
        const t = (totalSec * i) / samples;
        const m = i === samples ? mult : Math.exp(GROWTH_K * Math.pow(t, GROWTH_EXP));
        points.push({ x: mapX(t), y: mapY(m), t, m });
      }

      const tip = points[points.length - 1];
      this.lastTipCoords = tip;

      const isCrashed = this.phase === 'CRASHED';
      const strokePrimary = isCrashed
        ? '#ef4444'
        : (mult >= 10.0 ? '#fde047' : (mult >= 2.0 ? '#d4af37' : '#10b981'));

      // Gradient fill under curve
      const areaGrad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
      if (isCrashed) {
        areaGrad.addColorStop(0, 'rgba(239, 68, 68, 0.28)');
        areaGrad.addColorStop(1, 'rgba(239, 68, 68, 0.01)');
      } else if (mult >= 2.0) {
        areaGrad.addColorStop(0, 'rgba(212, 175, 55, 0.34)');
        areaGrad.addColorStop(1, 'rgba(16, 185, 129, 0.02)');
      } else {
        areaGrad.addColorStop(0, 'rgba(16, 185, 129, 0.32)');
        areaGrad.addColorStop(1, 'rgba(16, 185, 129, 0.01)');
      }

      ctx.beginPath();
      ctx.moveTo(points[0].x, padTop + plotH);
      for (const pt of points) {
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.lineTo(tip.x, padTop + plotH);
      ctx.closePath();
      ctx.fillStyle = areaGrad;
      ctx.fill();

      // Main glowing trajectory stroke
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.strokeStyle = strokePrimary;
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.shadowColor = strokePrimary;
      ctx.shadowBlur = 14;
      ctx.stroke();
      ctx.restore();

      // 4. Draw Live Player Cashout Markers Along the Curve
      for (const b of this.bets) {
        if (b.cashedOut && b.cashoutMultiplier) {
          const cSec = (b.cashoutElapsedMs || (Math.pow(Math.log(b.cashoutMultiplier) / GROWTH_K, 1 / GROWTH_EXP) * 1000)) / 1000;
          const cx = mapX(cSec);
          const cy = mapY(b.cashoutMultiplier);

          ctx.save();
          // Outer ring
          ctx.fillStyle = b.playerColor || '#d4af37';
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(cx, cy, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          // Tag label
          const label = `${b.playerName} ${b.cashoutMultiplier.toFixed(2)}x`;
          ctx.font = '700 10px Inter, sans-serif';
          ctx.fillStyle = '#f8fafc';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(label, cx, cy - 9);
          ctx.restore();
        }
      }

      // 5. Draw Vector Comet/Diamond Head (RUNNING) or Shockwave Burst (CRASHED)
      if (!isCrashed) {
        // Spawn trail particle
        if (Math.random() < 0.75) {
          this.trailParticles.push({
            x: tip.x + (Math.random() - 0.5) * 4,
            y: tip.y + (Math.random() - 0.5) * 4,
            vx: -1.2 - Math.random() * 1.5,
            vy: 0.5 + Math.random() * 1.2,
            r: 1.5 + Math.random() * 2.2,
            alpha: 0.9,
            color: mult >= 2.0 ? '#fde047' : '#34d399'
          });
        }

        for (let i = this.trailParticles.length - 1; i >= 0; i--) {
          const p = this.trailParticles[i];
          p.x += p.vx;
          p.y += p.vy;
          p.alpha -= 0.035;
          if (p.alpha <= 0) {
            this.trailParticles.splice(i, 1);
            continue;
          }
          ctx.save();
          ctx.globalAlpha = p.alpha;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        // Compute tangent angle at tip
        const prev = points[Math.max(0, points.length - 4)];
        const angle = Math.atan2(tip.y - prev.y, tip.x - prev.x);

        // Draw sleek geometric vector craft / diamond spearhead
        ctx.save();
        ctx.translate(tip.x, tip.y);
        ctx.rotate(angle);
        ctx.shadowColor = strokePrimary;
        ctx.shadowBlur = 16;
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = strokePrimary;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(11, 0);
        ctx.lineTo(-7, -6);
        ctx.lineTo(-4, 0);
        ctx.lineTo(-7, 6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      } else {
        // Draw crash shockwave particles
        for (let i = this.burstParticles.length - 1; i >= 0; i--) {
          const p = this.burstParticles[i];
          p.x += p.vx;
          p.y += p.vy;
          p.vx *= 0.96;
          p.vy *= 0.96;
          p.alpha -= 0.022;
          if (p.alpha <= 0) {
            this.burstParticles.splice(i, 1);
            continue;
          }
          ctx.save();
          ctx.globalAlpha = Math.max(0, p.alpha);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      ctx.restore();
    }
  }

  return CasinoCrash;
}));
