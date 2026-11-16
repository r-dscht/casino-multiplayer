/**
 * racing.js
 * Client-side controller & 60fps HTML5 Canvas Broadcast Renderer voor
 * Monaco Turf Club & Port Hercule Derby (Paardracen).
 *
 * Kenmerken:
 *  - Simpel & eerlijk: maximaal 1 WIN-ticket per speler, vaste 5.50x uitbetaling, 6 gelijke 1/6 paarden.
 *  - Rijk geanimeerde 60fps Canvas: openende starthekken, startlichten, parallax grasstroken,
 *    twee-delige galopperende benen, unieke jockey-patroonhemden, Sprintpoort-vlammen,
 *    cosmetisch supporter-vuurwerk en Photo-Finish cameraflits.
 *  - Nul Unicode emoji's, nul audio API's (volledig conform casino-richtlijnen).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CasinoRacing = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  const MIN_BET = 10;
  const MAX_BET = 50000;
  const BASE_WIN_ODDS = 3.0;
  const WINNER_POT_LOSER_SHARE = 0.50;
  const WINNER_POT_ROLLOVER_CAP_MULT = 2.5;
  const FIXED_WIN_ODDS = BASE_WIN_ODDS;
  const MAX_TICKETS_PER_PLAYER = 1;

  const SURFACE_THEMES = {
    RIVIERA_TURF: {
      grassA: '#0f3828',
      grassB: '#154734',
      railColor: '#d4af37',
      skyTint: 'rgba(212, 175, 55, 0.05)',
      particleColor: 'rgba(214, 198, 150, 0.72)',
    },
    NIGHT_DERBY: {
      grassA: '#0b1e2e',
      grassB: '#112a3d',
      railColor: '#38bdf8',
      skyTint: 'rgba(56, 189, 248, 0.09)',
      particleColor: 'rgba(186, 230, 253, 0.7)',
    },
    GOLDEN_HOUR: {
      grassA: '#2a2214',
      grassB: '#382d1a',
      railColor: '#f59e0b',
      skyTint: 'rgba(245, 158, 11, 0.09)',
      particleColor: 'rgba(253, 230, 138, 0.74)',
    },
    RAIN_DERBY: {
      grassA: '#0c2720',
      grassB: '#12352c',
      railColor: '#94a3b8',
      skyTint: 'rgba(148, 163, 184, 0.08)',
      particleColor: 'rgba(148, 163, 184, 0.75)',
    },
  };

  const DEFAULT_TRACK = {
    id: 'RIVIERA_TURF',
    label: 'Riviera Grasbaan',
    badgeClass: 'surface-turf',
  };

  const DEFAULT_HORSES = [
    { horseId: 1, name: 'Prince de Monaco', jockey: 'L. Moreau', silkColor: '#e11d48', silkAccent: '#fde68a', silkPattern: 'sash', coatColor: '#7c3f1d', winOdds: FIXED_WIN_ODDS, cheers: 0 },
    { horseId: 2, name: 'Azure Mirage', jockey: 'C. Rossi', silkColor: '#0284c7', silkAccent: '#ffffff', silkPattern: 'stripe', coatColor: '#4b3621', winOdds: FIXED_WIN_ODDS, cheers: 0 },
    { horseId: 3, name: 'Obsidian Stealth', jockey: 'K. De Vries', silkColor: '#7c3aed', silkAccent: '#e9d5ff', silkPattern: 'diamond', coatColor: '#1f242d', winOdds: FIXED_WIN_ODDS, cheers: 0 },
    { horseId: 4, name: 'Belle Epoque Royal', jockey: 'M. Dubois', silkColor: '#059669', silkAccent: '#fbbf24', silkPattern: 'chevron', coatColor: '#8d5524', winOdds: FIXED_WIN_ODDS, cheers: 0 },
    { horseId: 5, name: 'Grimaldi Champion', jockey: 'A. Conti', silkColor: '#d97706', silkAccent: '#fffbeb', silkPattern: 'check', coatColor: '#5c3317', winOdds: FIXED_WIN_ODDS, cheers: 0 },
    { horseId: 6, name: 'Riviera Lightning', jockey: 'T. Jansen', silkColor: '#ec4899', silkAccent: '#fce7f3', silkPattern: 'star', coatColor: '#6f4e37', winOdds: FIXED_WIN_ODDS, cheers: 0 },
  ];

  const COAT_PALETTE = ['#7c3f1d', '#4b3621', '#1f242d', '#8d5524', '#5c3317', '#9a7b4f'];

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatChips(val) {
    const n = Math.floor(Number(val) || 0);
    return n.toLocaleString('nl-NL');
  }

  class CasinoRacing {
    constructor({ network, ui = null } = {}) {
      this.network = network;
      this.ui = ui;

      this.state = {
        raceId: 1,
        phase: 'WAITING_FOR_BETS',
        timeLeft: 18,
        bettingDuration: 18,
        minBet: MIN_BET,
        maxBet: MAX_BET,
        maxTicketsPerPlayer: MAX_TICKETS_PER_PLAYER,
        baseWinOdds: BASE_WIN_ODDS,
        winnerLoserShare: WINNER_POT_LOSER_SHARE,
        winnerRolloverCapMult: WINNER_POT_ROLLOVER_CAP_MULT,
        fixedWinOdds: FIXED_WIN_ODDS,
        winnerPot: 0,
        totalRacePool: 0,
        track: { ...DEFAULT_TRACK },
        horses: DEFAULT_HORSES.map((h) => ({ ...h })),
        turboZones: [
          { label: 'MID-SPRINT', startPct: 33, endPct: 47 },
          { label: 'EINDSPRINT', startPct: 68, endPct: 86 },
        ],
        tickets: [],
        myTickets: [],
        livePositions: {},
        liveSpeeds: {},
        surgingIds: [],
        progressPct: 0,
        photoFinishActive: false,
        commentary: 'Kies 1 winnaar (3.0x basis + 50% Verliezers Winnaarspot). De klok start bij 1e inzet!',
        result: null,
        history: [],
      };

      this.selectedHorseId = 1;
      this.betAmount = 100;
      this.viewActive = false;
      this.rafId = null;
      this.lastFrameTs = 0;

      this.visualPositions = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
      this.targetPositions = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
      this.horseSpeeds = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
      this.surgingSet = new Set();
      this.stridePhases = { 1: 0, 2: 0.9, 3: 1.7, 4: 2.5, 5: 3.3, 6: 4.1 };
      this.cheerPulses = {};
      this.particles = [];
      this.confetti = [];
      this.gateOpenProgress = 0;
      this.cameraFlashAlpha = 0;
      this.lastRaceFinishFlashed = 0;
      this.lastCheerSentAt = 0;
      this.lastSettlement = null;

      this.els = {};
      this.initialized = false;
    }

    init() {
      if (this.initialized) return;
      this.initialized = true;
      this._cacheElements();
      this._bindUIEvents();
      this._bindNetworkEvents();
      this._renderAll();
    }

    onViewActivated() {
      this.viewActive = true;
      this._startAnimationLoop();
      this._renderHeader();
      if (this.ui && typeof this.ui.setNavigationLocked === 'function') {
        this.ui.setNavigationLocked(this.hasActiveBets());
      }
    }

    onViewDeactivated() {
      this.viewActive = false;
      if (this.rafId && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
    }

    hasActiveBets() {
      if (!this.state) return false;
      if (this.state.phase === 'FINISHED') return false;
      return Array.isArray(this.state.myTickets) && this.state.myTickets.length > 0;
    }

    _cacheElements() {
      if (typeof document === 'undefined') return;
      this.els = {
        view: document.getElementById('racing-view'),
        raceBadge: document.getElementById('racing-race-badge'),
        surfaceBadge: document.getElementById('racing-surface-badge'),
        winnerPotVal: document.getElementById('racing-winner-pot-val'),
        fixedOddsVal: document.getElementById('racing-fixed-odds-val'),
        timerLabel: document.getElementById('racing-timer-label'),
        timerVal: document.getElementById('racing-timer-val'),
        commentaryText: document.getElementById('racing-commentary-text'),
        liveTop3: document.getElementById('racing-live-top3'),
        canvas: document.getElementById('racing-canvas'),
        eventBanner: document.getElementById('racing-event-banner'),
        podiumOverlay: document.getElementById('racing-podium-overlay'),
        paddockGrid: document.getElementById('racing-paddock-grid'),
        historyBar: document.getElementById('racing-history-bar'),
        ticketCount: document.getElementById('racing-ticket-count'),
        horseSelect: document.getElementById('racing-horse-select'),
        betAmountInput: document.getElementById('racing-bet-amount'),
        potentialPayout: document.getElementById('racing-potential-payout'),
        btnPlaceBet: document.getElementById('btn-place-racing-bet'),
        btnCheer: document.getElementById('btn-racing-cheer'),
        myTicketsList: document.getElementById('racing-my-tickets'),
        liveBetsFeed: document.getElementById('racing-live-bets-feed'),
      };
    }

    _bindUIEvents() {
      if (typeof document === 'undefined') return;

      if (this.els.horseSelect) {
        this.els.horseSelect.addEventListener('change', (e) => {
          this.selectHorse(Number(e.target.value));
        });
      }

      if (this.els.paddockGrid) {
        this.els.paddockGrid.addEventListener('click', (e) => {
          const card = e.target.closest('.racing-horse-card');
          if (!card) return;
          const hId = Number(card.dataset.horseId);
          if (hId) this.selectHorse(hId);
        });
      }

      if (this.els.betAmountInput) {
        this.els.betAmountInput.addEventListener('input', () => {
          this._syncBetInput();
        });
      }

      if (this.els.view) {
        this.els.view.addEventListener('click', (e) => {
          const preset = e.target.closest('.racing-chip-preset');
          if (preset) {
            const val = Number(preset.dataset.amount);
            if (val > 0) this.setBetAmount(val);
            return;
          }

          const modBtn = e.target.closest('.racing-bet-mod');
          if (modBtn) {
            this._applyBetModifier(modBtn.dataset.mod);
            return;
          }

          const cancelBtn = e.target.closest('.racing-cancel-ticket-btn');
          if (cancelBtn) {
            const tId = cancelBtn.dataset.ticketId;
            if (tId && this.network && typeof this.network.racingCancelBet === 'function') {
              this.network.racingCancelBet(tId);
            }
            return;
          }

          const closePodium = e.target.closest('#btn-racing-close-podium');
          if (closePodium && this.els.podiumOverlay) {
            this.els.podiumOverlay.classList.add('hidden');
          }
        });
      }

      if (this.els.btnPlaceBet) {
        this.els.btnPlaceBet.addEventListener('click', () => this.submitBet());
      }

      if (this.els.btnCheer) {
        this.els.btnCheer.addEventListener('click', () => this.sendCheer());
      }
    }

    _bindNetworkEvents() {
      if (!this.network || typeof this.network.on !== 'function') return;

      this.network.on('racing_state', (state) => {
        this.applyState(state);
      });

      this.network.on('racing_phase_tick', (data) => {
        if (!data) return;
        this.state.phase = data.phase || this.state.phase;
        this.state.timeLeft = typeof data.timeLeft === 'number' ? data.timeLeft : this.state.timeLeft;
        this._renderHeader();
      });

      this.network.on('racing_phase_change', (data) => {
        if (!data) return;
        if (data.state) {
          this.applyState(data.state);
        } else {
          this.state.phase = data.phase;
          this.state.timeLeft = data.timeLeft || 0;
          if (data.phase === 'WAITING_FOR_BETS') {
            this.state.myTickets = [];
            this.state.tickets = [];
          }
          this._renderAll();
          if (this.ui && typeof this.ui.setNavigationLocked === 'function') {
            this.ui.setNavigationLocked(this.hasActiveBets());
          }
        }
        if (data.phase === 'STARTING') {
          this._showEventBanner('POORTEN DICHT!', 'Alle 6 paarden staan startklaar (3.0x basis + 50% Verliezers Winnaarspot)', 'banner-start');
        } else if (data.phase === 'RACING') {
          this._showEventBanner('DAAR GAAN ZE!', 'De hekken klappen open op Port Hercule!', 'banner-go');
        }
      });

      this.network.on('racing_tick', (tick) => {
        if (!tick) return;
        this.state.progressPct = tick.progressPct || 0;
        this.state.photoFinishActive = Boolean(tick.photoFinishActive);
        if (tick.commentary) {
          this.state.commentary = tick.commentary;
        }
        if (tick.positions) {
          Object.keys(tick.positions).forEach((k) => {
            this.targetPositions[k] = Number(tick.positions[k] || 0);
          });
        }
        if (tick.speeds) {
          Object.keys(tick.speeds).forEach((k) => {
            this.horseSpeeds[k] = Number(tick.speeds[k] || 0);
          });
        }
        this.surgingSet = new Set(Array.isArray(tick.surgingIds) ? tick.surgingIds.map(Number) : []);
        this._renderLiveStrip();
      });

      this.network.on('racing_bet_accepted', (res) => {
        if (!res) return;
        if (res.ticket) {
          const exists = this.state.myTickets.some((t) => t.ticketId === res.ticket.ticketId);
          if (!exists) this.state.myTickets.push(res.ticket);
        }
        if (Array.isArray(res.tickets)) this.state.tickets = res.tickets;
        if (res.phase) this.state.phase = res.phase;
        if (typeof res.timeLeft === 'number') this.state.timeLeft = res.timeLeft;
        if (typeof res.winnerPot === 'number') this.state.winnerPot = res.winnerPot;
        if (typeof res.totalRacePool === 'number') this.state.totalRacePool = res.totalRacePool;
        this._renderAll();
        if (this.ui && typeof this.ui.setNavigationLocked === 'function') {
          this.ui.setNavigationLocked(this.hasActiveBets());
        }
        if (this.ui && res.ticket) {
          this.ui.showToast(`Inzet geplaatst: #${res.ticket.horseId} ${res.ticket.horseName} (${formatChips(res.ticket.amount)} F -> min. ${formatChips(res.ticket.potentialPayout)} F + Pot)`, 'success');
        }
      });

      this.network.on('racing_bet_rejected', (err) => {
        if (err && err.reason && this.ui) {
          const isRecovering = err.code === 'PLAYER_NOT_FOUND' && this.network && typeof this.network.hasStoredCredentials === 'function' && this.network.hasStoredCredentials();
          this.ui.showToast(isRecovering ? 'Sessie wordt hersteld, probeer zo opnieuw...' : err.reason, isRecovering ? 'info' : 'error');
        }
      });

      this.network.on('racing_bet_placed', (payload) => {
        if (!payload) return;
        if (Array.isArray(payload.tickets)) this.state.tickets = payload.tickets;
        if (payload.phase) this.state.phase = payload.phase;
        if (typeof payload.timeLeft === 'number') this.state.timeLeft = payload.timeLeft;
        if (typeof payload.winnerPot === 'number') this.state.winnerPot = payload.winnerPot;
        if (typeof payload.totalRacePool === 'number') this.state.totalRacePool = payload.totalRacePool;
        this._renderHeader();
        this._renderPaddock();
        this._renderBetSlip();
        this._renderTicketsAndFeed();
      });

      this.network.on('racing_bet_cancelled', (payload) => {
        if (!payload) return;
        if (Array.isArray(payload.tickets)) this.state.tickets = payload.tickets;
        if (typeof payload.winnerPot === 'number') this.state.winnerPot = payload.winnerPot;
        if (typeof payload.totalRacePool === 'number') this.state.totalRacePool = payload.totalRacePool;
        this._renderHeader();
        this._renderPaddock();
        this._renderBetSlip();
        this._renderTicketsAndFeed();
      });

      this.network.on('racing_bet_cancelled_self', (res) => {
        if (!res) return;
        if (res.cancelledTicket) {
          this.state.myTickets = this.state.myTickets.filter((t) => t.ticketId !== res.cancelledTicket.ticketId);
        }
        if (Array.isArray(res.tickets)) this.state.tickets = res.tickets;
        if (res.phase) this.state.phase = res.phase;
        if (typeof res.timeLeft === 'number') this.state.timeLeft = res.timeLeft;
        if (typeof res.winnerPot === 'number') this.state.winnerPot = res.winnerPot;
        if (typeof res.totalRacePool === 'number') this.state.totalRacePool = res.totalRacePool;
        this._renderAll();
        if (this.ui && typeof this.ui.setNavigationLocked === 'function') {
          this.ui.setNavigationLocked(this.hasActiveBets());
        }
        if (this.ui) {
          this.ui.showToast('Ticket geannuleerd en inzet teruggestort.', 'info');
        }
      });

      this.network.on('racing_cheered', (evt) => {
        if (!evt) return;
        const horse = this.state.horses.find((h) => h.horseId === evt.horseId);
        if (horse) {
          horse.cheers = evt.cheers;
        }
        this.cheerPulses[evt.horseId] = {
          until: (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 1600,
          color: evt.fromPlayerColor || '#d4af37',
          label: evt.fromPlayerName ? `${evt.fromPlayerName}!` : 'HYPE!',
        };
        this._spawnCheerParticles(evt.horseId, evt.fromPlayerColor || '#d4af37');
        this._renderPaddock();
      });

      this.network.on('racing_cheer_rejected', (err) => {
        if (err && err.reason && this.ui) {
          this.ui.showToast(err.reason, 'info');
        }
      });

      this.network.on('racing_finished', (result) => {
        if (!result) return;
        this.state.result = result;
        this.state.phase = 'FINISHED';
        this.state.photoFinishActive = Boolean(result.isPhotoFinish);
        this.surgingSet.clear();

        if (result.raceId !== this.lastRaceFinishFlashed) {
          this.lastRaceFinishFlashed = result.raceId;
          this.cameraFlashAlpha = result.isPhotoFinish ? 0.92 : 0.45;
        }

        if (typeof result.winnerPotAfter === 'number') {
          this.state.winnerPot = result.winnerPotAfter;
        }
        if (result.raceId && Array.isArray(this.state.history)) {
          const already = this.state.history.some((x) => x.raceId === result.raceId);
          if (!already) {
            this.state.history.unshift({
              raceId: result.raceId,
              winnerHorseId: result.winnerHorseId,
              winnerName: result.winnerName,
              winnerSilk: result.winnerSilk,
              winOdds: result.winOdds || BASE_WIN_ODDS,
              potDistributed: result.potDistributed || 0,
              winnerCount: result.winnerCount || 0,
              isPhotoFinish: result.isPhotoFinish,
              marginMs: result.marginMs,
            });
            if (this.state.history.length > 20) this.state.history.length = 20;
          }
        }

        const backedWinner = Array.isArray(this.state.myTickets) &&
          this.state.myTickets.some((t) => t.horseId === result.winnerHorseId);
        this._launchConfetti(backedWinner ? 110 : 60);
        this._showPodiumOverlay(result, this.lastSettlement);
        this._renderAll();
        if (this.ui && typeof this.ui.setNavigationLocked === 'function') {
          this.ui.setNavigationLocked(this.hasActiveBets());
        }
      });

      this.network.on('racing_settlement', (settlement) => {
        this.lastSettlement = settlement;
        if (this.state.phase === 'FINISHED' && this.state.result) {
          this._showPodiumOverlay(this.state.result, settlement);
        }
        if (this.ui && settlement) {
          if (settlement.totalReturned > 0) {
            const multStr = Number(settlement.bestMultiplier || BASE_WIN_ODDS).toFixed(2);
            const potNote = settlement.potBonusTotal > 0 ? ` incl. +${formatChips(settlement.potBonusTotal)} F Pot` : '';
            this.ui.showToast(`Derby winst: +${formatChips(settlement.totalReturned)} fiches (${multStr}x${potNote})!`, 'success');
          } else if (settlement.totalStaked > 0) {
            this.ui.showToast('Race afgelopen — 50% in Winnaarspot, 50% naar Casino.', 'info');
          }
        }
      });
    }

    applyState(newState) {
      if (!newState || typeof newState !== 'object') return;
      const prevPhase = this.state ? this.state.phase : null;
      const prevRaceId = this.state ? this.state.raceId : null;

      this.state = {
        ...this.state,
        ...newState,
        horses: Array.isArray(newState.horses) && newState.horses.length > 0 ? newState.horses : this.state.horses,
        tickets: Array.isArray(newState.tickets) ? newState.tickets : [],
        myTickets: Array.isArray(newState.myTickets) ? newState.myTickets : [],
        history: Array.isArray(newState.history) ? newState.history : this.state.history,
      };

      if (prevRaceId !== this.state.raceId || (this.state.phase === 'WAITING_FOR_BETS' && prevPhase !== 'WAITING_FOR_BETS')) {
        this.lastSettlement = null;
        this.particles = [];
        this.confetti = [];
        this.surgingSet.clear();
        this.gateOpenProgress = 0;
        this.cameraFlashAlpha = 0;
        if (this.els.podiumOverlay) this.els.podiumOverlay.classList.add('hidden');
        if (this.els.eventBanner) this.els.eventBanner.classList.add('hidden');
      }

      if (['RACING', 'FINISHED'].includes(this.state.phase)) {
        this.gateOpenProgress = 1;
      }

      const lp = this.state.livePositions || {};
      this.state.horses.forEach((h) => {
        const pos = Number(lp[h.horseId] || 0);
        this.targetPositions[h.horseId] = pos;
        if (this.state.phase === 'WAITING_FOR_BETS' || this.state.phase === 'BETTING' || pos === 0) {
          this.visualPositions[h.horseId] = pos;
        }
      });

      this.surgingSet = new Set(Array.isArray(this.state.surgingIds) ? this.state.surgingIds.map(Number) : []);

      if (this.els.horseSelect && this.state.horses.length > 0) {
        const currentOpts = Array.from(this.els.horseSelect.options);
        if (currentOpts.length !== this.state.horses.length || currentOpts[0].text.indexOf(this.state.horses[0].name) === -1 || currentOpts[0].text.indexOf('+ Pot') === -1) {
          this.els.horseSelect.innerHTML = this.state.horses
            .map((h) => `<option value="${h.horseId}">#${h.horseId} ${escapeHtml(h.name)} (${BASE_WIN_ODDS.toFixed(1)}x + Pot)</option>`)
            .join('');
        }
        this.els.horseSelect.value = String(this.selectedHorseId);
      }

      if (this.state.phase === 'FINISHED' && this.state.result && this.els.podiumOverlay && this.els.podiumOverlay.classList.contains('hidden')) {
        this._showPodiumOverlay(this.state.result, this.lastSettlement);
      }

      this._renderAll();
      if (this.viewActive && this.ui && typeof this.ui.setNavigationLocked === 'function') {
        this.ui.setNavigationLocked(this.hasActiveBets());
      }
    }

    selectHorse(horseId) {
      const idNum = Math.max(1, Math.min(6, Number(horseId) || 1));
      this.selectedHorseId = idNum;
      if (this.els.horseSelect) {
        this.els.horseSelect.value = String(idNum);
      }
      this._renderPaddock();
      this._renderBetSlip();
    }

    setBetAmount(val) {
      const clean = Math.max(MIN_BET, Math.min(MAX_BET, Math.floor(Number(val) || MIN_BET)));
      this.betAmount = clean;
      if (this.els.betAmountInput) {
        this.els.betAmountInput.value = String(clean);
      }
      this._renderPaddock();
      this._renderBetSlip();
    }

    _syncBetInput() {
      if (!this.els.betAmountInput) return;
      const raw = Math.floor(Number(this.els.betAmountInput.value) || 0);
      this.betAmount = Math.max(0, Math.min(MAX_BET, raw));
      this._renderPaddock();
      this._renderBetSlip();
    }

    _applyBetModifier(mod) {
      const cur = Math.max(MIN_BET, this.betAmount || MIN_BET);
      if (mod === 'half') {
        this.setBetAmount(Math.max(MIN_BET, Math.floor(cur / 2 / 10) * 10 || MIN_BET));
      } else if (mod === 'double') {
        this.setBetAmount(Math.min(MAX_BET, cur * 2));
      } else if (mod === 'max') {
        const myChips = (this.network && this.network.player && typeof this.network.player.chips === 'number')
          ? this.network.player.chips
          : MAX_BET;
        const maxAllowed = Math.max(MIN_BET, Math.min(MAX_BET, Math.floor(myChips / 10) * 10 || MIN_BET));
        this.setBetAmount(maxAllowed);
      }
    }

    submitBet() {
      if (!this.network || typeof this.network.racingPlaceBet !== 'function') return;
      const amount = Math.floor(Number(this.els.betAmountInput ? this.els.betAmountInput.value : this.betAmount) || 0);
      if (amount < MIN_BET || amount > MAX_BET) {
        if (this.ui) this.ui.showToast(`Inzet moet tussen ${MIN_BET} en ${formatChips(MAX_BET)} liggen.`, 'error');
        return;
      }
      this.network.racingPlaceBet({
        horseId: this.selectedHorseId,
        betType: 'WIN',
        amount,
      });
    }

    sendCheer() {
      const now = Date.now();
      if (now - this.lastCheerSentAt < 1500) {
        if (this.ui) this.ui.showToast('Wacht even voor je volgende aanmoediging.', 'info');
        return;
      }
      this.lastCheerSentAt = now;
      if (this.network && typeof this.network.racingCheer === 'function') {
        this.network.racingCheer(this.selectedHorseId);
      }
    }

    _renderAll() {
      this._renderHeader();
      this._renderLiveStrip();
      this._renderPaddock();
      this._renderBetSlip();
      this._renderTicketsAndFeed();
      this._renderHistory();
    }

    _estimateHorsePoolStats(horseId, prospectiveStake = 0, alreadyBacked = false) {
      const tickets = Array.isArray(this.state.tickets) ? this.state.tickets : [];
      const rolloverPot = Math.max(0, Math.floor(Number(this.state.winnerPot || 0)));
      let onHorseExisting = 0;
      let otherStaked = 0;
      for (let i = 0; i < tickets.length; i += 1) {
        const t = tickets[i];
        const amt = Math.max(0, Math.floor(Number(t.amount || 0)));
        if (Number(t.horseId) === Number(horseId)) onHorseExisting += amt;
        else otherStaked += amt;
      }

      const inRacePot = Math.floor(otherStaked * WINNER_POT_LOSER_SHARE);
      const stakeAmt = Math.max(0, Math.floor(Number(prospectiveStake || 0)));
      const totalWinningIfWins = alreadyBacked ? onHorseExisting : (onHorseExisting + stakeAmt);
      const rolloverUsable = totalWinningIfWins > 0
        ? Math.min(rolloverPot, Math.floor(totalWinningIfWins * WINNER_POT_ROLLOVER_CAP_MULT))
        : 0;
      const totalPotIfWins = inRacePot + rolloverUsable;
      const myShare = (stakeAmt > 0 && totalWinningIfWins > 0) ? (stakeAmt / totalWinningIfWins) : 0;
      const estPotBonus = Math.floor(totalPotIfWins * myShare);
      const estBase = Math.floor(stakeAmt * BASE_WIN_ODDS);
      const estTotal = estBase + estPotBonus;
      const estMult = stakeAmt > 0 ? Math.round((estTotal / stakeAmt) * 100) / 100 : BASE_WIN_ODDS;

      return {
        rolloverPot,
        onHorseExisting,
        otherStaked,
        inRacePot,
        rolloverUsable,
        totalPotIfWins,
        totalWinningIfWins,
        estPotBonus,
        estBase,
        estTotal,
        estMult,
      };
    }

    _renderHeader() {
      if (!this.state) return;
      if (this.els.raceBadge) {
        this.els.raceBadge.textContent = `RACE #${this.state.raceId || 1}`;
      }
      if (this.els.winnerPotVal) {
        const rollover = Math.max(0, Math.floor(Number(this.state.winnerPot || 0)));
        const tickets = Array.isArray(this.state.tickets) ? this.state.tickets : [];
        const totalRacePool = tickets.reduce((sum, t) => sum + Math.max(0, Math.floor(Number(t.amount || 0))), 0);
        const displayPot = this.state.phase === 'FINISHED'
          ? rollover
          : rollover + Math.floor(totalRacePool * WINNER_POT_LOSER_SHARE);
        this.els.winnerPotVal.textContent = `${formatChips(displayPot)} F`;
      }
      if (this.els.fixedOddsVal) {
        this.els.fixedOddsVal.textContent = `${BASE_WIN_ODDS.toFixed(2)}x + POT`;
      }
      if (this.els.surfaceBadge) {
        const t = this.state.track || DEFAULT_TRACK;
        this.els.surfaceBadge.className = `racing-surface-badge ${t.badgeClass || 'surface-turf'}`;
        const nameEl = this.els.surfaceBadge.querySelector('.surface-name');
        if (nameEl) nameEl.textContent = t.label || DEFAULT_TRACK.label;
      }

      if (this.els.timerLabel && this.els.timerVal) {
        const ph = this.state.phase;
        if (ph === 'WAITING_FOR_BETS') {
          this.els.timerLabel.textContent = 'SLIMME KLOK (1E INZET):';
          this.els.timerVal.textContent = 'KLAAR';
          this.els.timerVal.className = 'racing-timer-val timer-idle';
        } else if (ph === 'BETTING') {
          this.els.timerLabel.textContent = 'INZETTEN SLUITEN OVER:';
          this.els.timerVal.textContent = `${Math.max(0, this.state.timeLeft)}s`;
          this.els.timerVal.className = this.state.timeLeft <= 5 ? 'racing-timer-val timer-urgent' : 'racing-timer-val timer-live';
        } else if (ph === 'STARTING') {
          this.els.timerLabel.textContent = 'STARTBOXEN:';
          this.els.timerVal.textContent = 'KLAAR!';
          this.els.timerVal.className = 'racing-timer-val timer-urgent';
        } else if (ph === 'RACING') {
          this.els.timerLabel.textContent = 'LIVE RACE:';
          this.els.timerVal.textContent = `${Math.min(100, Math.round(this.state.progressPct || 0))}%`;
          this.els.timerVal.className = 'racing-timer-val timer-live';
        } else {
          this.els.timerLabel.textContent = 'VOLGENDE RACE:';
          this.els.timerVal.textContent = `${Math.max(0, this.state.timeLeft)}s`;
          this.els.timerVal.className = 'racing-timer-val timer-idle';
        }
      }

      if (this.viewActive && this.ui) {
        const duration = this.state.bettingDuration || 18;
        const timeLeft = typeof this.state.timeLeft === 'number'
          ? Math.max(0, Math.ceil(this.state.timeLeft))
          : 0;
        const displayTimer = (this.state.phase === 'RACING')
          ? 'LIVE'
          : (this.state.phase === 'WAITING_FOR_BETS'
            ? 'KLAAR'
            : (this.state.phase === 'FINISHED' ? 'UITSLAG' : timeLeft));
        this.ui.updatePhase(this.state.phase || 'WAITING_FOR_BETS', duration, displayTimer);
      }
    }

    _renderLiveStrip() {
      if (this.els.commentaryText && this.state.commentary) {
        this.els.commentaryText.textContent = this.state.commentary;
      }
      if (!this.els.liveTop3 || !Array.isArray(this.state.horses)) return;

      const leaderRank = this.state.horses
        .map((h) => ({
          ...h,
          pos: Number((this.targetPositions && this.targetPositions[h.horseId]) || 0),
        }))
        .sort((a, b) => b.pos - a.pos);

      if (this.state.phase === 'RACING' || this.state.phase === 'FINISHED') {
        const top3 = leaderRank.slice(0, 3);
        this.els.liveTop3.innerHTML = top3.map((h, i) => `
          <span class="live-rank-chip rank-${i + 1}">
            <span class="rank-pos">${i + 1}e</span>
            <span class="rank-dot" style="background:${escapeHtml(h.silkColor)}"></span>
            <span class="rank-name">#${h.horseId} ${escapeHtml(h.name)}</span>
          </span>
        `).join('');
      } else {
        const rollover = Math.max(0, Math.floor(Number(this.state.winnerPot || 0)));
        const rollStr = rollover > 0 ? ` • Rollover Pot: ${formatChips(rollover)} F` : '';
        this.els.liveTop3.innerHTML = `<span class="live-leader-pill">6 Gelijke Paarden (1/6) • ${BASE_WIN_ODDS.toFixed(2)}x Basis + 50% Verliezers Winnaarspot${rollStr}</span>`;
      }
    }

    _renderPaddock() {
      if (!this.els.paddockGrid || !Array.isArray(this.state.horses)) return;

      const cleanAmt = Math.max(MIN_BET, Math.floor(Number(this.betAmount) || MIN_BET));
      const myTicketByHorse = new Map();
      (this.state.myTickets || []).forEach((t) => {
        myTicketByHorse.set(Number(t.horseId), t);
      });
      const ticketsByHorse = {};
      (this.state.tickets || []).forEach((t) => {
        if (!ticketsByHorse[t.horseId]) ticketsByHorse[t.horseId] = [];
        ticketsByHorse[t.horseId].push(t);
      });

      this.els.paddockGrid.innerHTML = this.state.horses.map((h) => {
        const isSelected = h.horseId === this.selectedHorseId;
        const myTkt = myTicketByHorse.get(Number(h.horseId));
        const isBacked = Boolean(myTkt);
        const backers = ticketsByHorse[h.horseId] || [];

        const uniqueBackers = [];
        const seen = new Set();
        backers.forEach((b) => {
          if (!seen.has(b.playerId)) {
            seen.add(b.playerId);
            uniqueBackers.push(b);
          }
        });

        const backerBadges = uniqueBackers.slice(0, 4).map((b) => `
          <span class="horse-bettor-dot" title="${escapeHtml(b.playerName)} (${formatChips(b.amount)})" style="background:${escapeHtml(b.playerColor || '#d4af37')}">
            ${escapeHtml(b.monogram || '?')}
          </span>
        `).join('');

        const poolEst = this._estimateHorsePoolStats(
          h.horseId,
          myTkt ? myTkt.amount : cleanAmt,
          Boolean(myTkt)
        );
        const liveOddsDisplay = poolEst.onHorseExisting > 0 && !myTkt
          ? this._estimateHorsePoolStats(h.horseId, poolEst.onHorseExisting, true).estMult
          : poolEst.estMult;
        const potChipNum = poolEst.onHorseExisting > 0 && !myTkt
          ? poolEst.totalPotIfWins
          : poolEst.estPotBonus;
        const potBadgeHtml = potChipNum > 0
          ? `<span class="horse-pot-share-badge">+${formatChips(potChipNum)} F Pot${uniqueBackers.length > 1 ? ` / ${uniqueBackers.length}` : ''}</span>`
          : '';

        return `
          <div class="racing-horse-card ${isSelected ? 'selected' : ''} ${isBacked ? 'is-backed' : ''}" data-horse-id="${h.horseId}">
            <div class="horse-card-top">
              <div class="horse-silk-badge" style="background:${escapeHtml(h.silkColor)};border-bottom:3px solid ${escapeHtml(h.silkAccent || '#ffffff')};">
                ${h.horseId}
              </div>
              <div class="horse-identity">
                <div class="horse-name-row">
                  <span class="horse-name">${escapeHtml(h.name)}</span>
                  ${isBacked ? '<span class="horse-backed-tag">JOUW INZET</span>' : ''}
                </div>
                <div class="horse-meta-row">
                  <span class="horse-jockey">Jockey: ${escapeHtml(h.jockey)}</span>
                </div>
              </div>
              <div class="horse-odds-col">
                <span class="odds-pill odds-win"><strong>${liveOddsDisplay.toFixed(2)}x</strong></span>
                ${potBadgeHtml}
              </div>
            </div>

            <div class="horse-card-footer">
              <div class="horse-supporters">
                ${backerBadges || '<span class="no-bets-hint">1 op 6 gelijke kans</span>'}
                ${uniqueBackers.length > 4 ? `<span class="horse-bettor-more">+${uniqueBackers.length - 4}</span>` : ''}
              </div>
              ${h.cheers > 0 ? `<span class="horse-cheers-pill">Hype ${h.cheers}</span>` : ''}
            </div>
          </div>
        `;
      }).join('');
    }

    _renderBetSlip() {
      const selectedHorse = this.state.horses.find((h) => h.horseId === this.selectedHorseId) || this.state.horses[0];
      const myCount = Array.isArray(this.state.myTickets) ? this.state.myTickets.length : 0;
      const canBetPhase = ['WAITING_FOR_BETS', 'BETTING'].includes(this.state.phase);
      const hasMaxTicket = myCount >= MAX_TICKETS_PER_PLAYER;

      if (this.els.ticketCount) {
        this.els.ticketCount.textContent = `${myCount} / ${MAX_TICKETS_PER_PLAYER} Ticket`;
      }

      if (this.els.potentialPayout && selectedHorse) {
        const myExistingOnSelected = (this.state.myTickets || []).find((t) => Number(t.horseId) === Number(selectedHorse.horseId));
        const cleanAmt = myExistingOnSelected
          ? Math.max(0, Math.floor(Number(myExistingOnSelected.amount) || 0))
          : Math.max(0, Math.floor(Number(this.betAmount) || 0));
        const est = this._estimateHorsePoolStats(selectedHorse.horseId, cleanAmt, Boolean(myExistingOnSelected));
        const potText = est.estPotBonus > 0
          ? ` + <strong>${formatChips(est.estPotBonus)} F</strong> Pot = <strong>${formatChips(est.estTotal)} F</strong> (${est.estMult.toFixed(2)}x)`
          : ` (${BASE_WIN_ODDS.toFixed(2)}x + 50% Verliezers-Pot)`;
        this.els.potentialPayout.innerHTML = `
          Basis ${formatChips(est.estBase)} F${potText}
          <span class="crown-hint">50% verliezers in Pot &bull; 50% naar Casino${est.onHorseExisting > 0 && !myExistingOnSelected ? ` &bull; Deelt op #${selectedHorse.horseId}` : ''}</span>
        `;
      }

      if (this.els.btnPlaceBet && selectedHorse) {
        this.els.btnPlaceBet.disabled = !canBetPhase || hasMaxTicket;
        if (hasMaxTicket) {
          this.els.btnPlaceBet.textContent = 'TICKET GEPLAATST (MAX 1 PER RACE)';
        } else if (!canBetPhase) {
          this.els.btnPlaceBet.textContent = 'INZETTEN GESLOTEN';
        } else {
          this.els.btnPlaceBet.textContent = `ZET IN OP #${selectedHorse.horseId} ${selectedHorse.name.toUpperCase()}`;
        }
      }

      if (this.els.btnCheer && selectedHorse) {
        this.els.btnCheer.textContent = `JUICH VOOR PAARD #${selectedHorse.horseId}`;
      }
    }

    _renderTicketsAndFeed() {
      if (this.els.myTicketsList) {
        const canCancel = ['WAITING_FOR_BETS', 'BETTING'].includes(this.state.phase);
        if (!this.state.myTickets || this.state.myTickets.length === 0) {
          this.els.myTicketsList.innerHTML = '<div class="racing-empty-note">Nog geen inzet geplaatst voor deze race.</div>';
        } else {
          this.els.myTicketsList.innerHTML = this.state.myTickets.map((t) => {
            const est = this._estimateHorsePoolStats(t.horseId, t.amount, true);
            const potStr = est.estPotBonus > 0 ? ` (+${formatChips(est.estPotBonus)} F Pot)` : '';
            return `
              <div class="my-ticket-row">
                <div class="tkt-info">
                  <span class="tkt-type tkt-win">WIN ${est.estMult.toFixed(2)}x</span>
                  <strong>#${t.horseId} ${escapeHtml(t.horseName)}</strong>
                  <span class="tkt-meta">${formatChips(t.amount)} F &rarr; ${formatChips(est.estBase)} F${potStr}</span>
                </div>
                ${canCancel ? `<button type="button" class="racing-cancel-ticket-btn" data-ticket-id="${escapeHtml(t.ticketId)}">Annuleer</button>` : ''}
              </div>
            `;
          }).join('');
        }
      }

      if (this.els.liveBetsFeed) {
        const all = Array.isArray(this.state.tickets) ? [...this.state.tickets].reverse() : [];
        if (all.length === 0) {
          this.els.liveBetsFeed.innerHTML = '<div class="racing-empty-note">Nog geen andere spelers ingezet.</div>';
        } else {
          this.els.liveBetsFeed.innerHTML = all.slice(0, 12).map((t) => `
            <div class="racing-feed-item">
              <span class="feed-avatar" style="background:${escapeHtml(t.playerColor || '#d4af37')}">${escapeHtml(t.monogram || '?')}</span>
              <span class="feed-player">${escapeHtml(t.playerName)}</span>
              <span class="feed-detail">#${t.horseId} &bull; ${formatChips(t.amount)} F</span>
            </div>
          `).join('');
        }
      }
    }

    _renderHistory() {
      if (!this.els.historyBar) return;
      const hist = Array.isArray(this.state.history) ? this.state.history : [];
      if (hist.length === 0) {
        this.els.historyBar.innerHTML = '<span class="history-placeholder">Nog geen voltooide races in deze sessie.</span>';
        return;
      }

      this.els.historyBar.innerHTML = hist.slice(0, 14).map((h) => {
        const oddsNum = Number(h.winOdds || BASE_WIN_ODDS);
        const potInfo = h.potDistributed > 0 ? ` • Pot +${formatChips(h.potDistributed)} F` : '';
        return `
          <span class="racing-history-pill" title="Race #${h.raceId}: #${h.winnerHorseId} ${escapeHtml(h.winnerName)} (${oddsNum.toFixed(2)}x${potInfo})">
            <span class="hist-dot" style="background:${escapeHtml(h.winnerSilk || '#d4af37')}"></span>
            <span>#${h.winnerHorseId} ${escapeHtml((h.winnerName || '').split(' ')[0])}</span>
            <span class="hist-odds">${oddsNum.toFixed(2)}x</span>
            ${h.isPhotoFinish ? '<span class="hist-badge">PHOTO</span>' : ''}
          </span>
        `;
      }).join('');
    }

    _showEventBanner(title, subtitle, extraClass = '') {
      if (!this.els.eventBanner) return;
      this.els.eventBanner.className = `racing-event-banner ${extraClass}`;
      this.els.eventBanner.innerHTML = `
        <span class="event-badge">${escapeHtml(title)}</span>
        <span class="event-text">${escapeHtml(subtitle)}</span>
      `;
      this.els.eventBanner.classList.remove('hidden');
      setTimeout(() => {
        if (this.els.eventBanner) {
          this.els.eventBanner.classList.add('hidden');
        }
      }, 2800);
    }

    _showPodiumOverlay(result, mySettlement) {
      if (!this.els.podiumOverlay || !result || !Array.isArray(result.podium)) return;

      const winOddsDisplay = Number(result.winOdds || BASE_WIN_ODDS).toFixed(2);
      const podiumHtml = result.podium.map((p) => `
        <div class="podium-card podium-place-${p.rank}">
          <div class="podium-rank">${p.rank === 1 ? '1E WINNAAR' : `${p.rank}E PLAATS`}</div>
          <div class="podium-silk" style="background:${escapeHtml(p.silkColor)};border-bottom:3px solid ${escapeHtml(p.silkAccent || '#ffffff')}">${p.horseId}</div>
          <div class="podium-horse-name">${escapeHtml(p.name)}</div>
          <div class="podium-meta">
            <span>${p.rank === 1 ? `${winOddsDisplay}x` : '-'}</span>
            <span>${((p.finishTimeMs || 12800) / 1000).toFixed(2)}s</span>
          </div>
        </div>
      `).join('');

      let bannerMsg = '';
      if (result.isPhotoFinish) {
        bannerMsg = `<div class="podium-alert photo-alert">PHOTO FINISH! Verschil tussen #1 en #2 was slechts ${(result.marginMs / 1000).toFixed(3)} seconden!</div>`;
      }

      let potBanner = '';
      if (result.potDistributed > 0) {
        potBanner = `<div class="podium-alert pot-alert">WINNAARSPOT VERDEELD: <strong>+${formatChips(result.potDistributed)} F</strong> over ${result.winnerCount || 1} winnaar${(result.winnerCount || 1) > 1 ? 's' : ''} &bull; 50% Casino: ${formatChips(result.casinoCut || 0)} F</div>`;
      } else if (result.inRacePotAddition > 0) {
        potBanner = `<div class="podium-alert pot-alert">0 WINNAARS! <strong>+${formatChips(result.inRacePotAddition)} F</strong> toegevoegd aan Winnaarspot (nu ${formatChips(result.winnerPotAfter || 0)} F) &bull; Casino: ${formatChips(result.casinoCut || 0)} F</div>`;
      }

      let myHtml = '';
      if (mySettlement) {
        const won = mySettlement.totalReturned > 0;
        const bonusTxt = mySettlement.potBonusTotal > 0
          ? ` (Basis ${formatChips(mySettlement.baseReturnTotal)} F + ${formatChips(mySettlement.potBonusTotal)} F Pot)`
          : '';
        myHtml = `
          <div class="podium-my-result ${won ? 'my-win' : 'my-loss'}">
            ${won
              ? `GEFELICITEERD! Je wint <strong>+${formatChips(mySettlement.totalReturned)} fiches</strong>${bonusTxt} &mdash; Netto +${formatChips(mySettlement.netProfit)} F!`
              : `Helaas, inzet van ${formatChips(mySettlement.totalStaked)} fiches niet gewonnen (50% naar Pot, 50% Casino).`}
          </div>
        `;
      }

      this.els.podiumOverlay.innerHTML = `
        <div class="podium-modal-box">
          <div class="podium-header">
            <span>PORT HERCULE DERBY #${result.raceId} &mdash; UITSLAG</span>
            <button type="button" class="podium-close-btn" id="btn-racing-close-podium" aria-label="Sluiten">X</button>
          </div>
          ${bannerMsg}
          ${potBanner}
          <div class="podium-cards-row">${podiumHtml}</div>
          ${myHtml}
        </div>
      `;
      this.els.podiumOverlay.classList.remove('hidden');
    }

    _spawnCheerParticles(horseId, color) {
      const palette = [color || '#d4af37', '#fbbf24', '#ffffff', '#10b981'];
      for (let i = 0; i < 12; i += 1) {
        this.particles.push({
          type: 'cheer',
          horseId,
          offsetX: (Math.random() - 0.5) * 30,
          offsetY: (Math.random() - 0.5) * 14,
          vx: (Math.random() - 0.5) * 52,
          vy: -32 - Math.random() * 48,
          life: 1,
          decay: 0.95 + Math.random() * 0.55,
          size: 2.2 + Math.random() * 2.8,
          color: palette[i % palette.length],
        });
      }
    }

    _launchConfetti(count = 70) {
      const palette = ['#d4af37', '#10b981', '#38bdf8', '#f59e0b', '#ffffff', '#fb7185'];
      for (let i = 0; i < count; i += 1) {
        this.confetti.push({
          xPct: Math.random(),
          yPct: -0.05 - Math.random() * 0.25,
          vx: (Math.random() - 0.5) * 0.32,
          vy: 0.36 + Math.random() * 0.48,
          rot: Math.random() * Math.PI * 2,
          vRot: (Math.random() - 0.5) * 9,
          size: 4 + Math.random() * 5,
          color: palette[i % palette.length],
          life: 1,
        });
      }
    }

    _startAnimationLoop() {
      if (this.rafId || typeof requestAnimationFrame !== 'function') return;
      this.lastFrameTs = performance.now();
      const step = (ts) => {
        if (!this.viewActive) {
          this.rafId = null;
          return;
        }
        const dt = Math.min(0.05, Math.max(0.001, (ts - this.lastFrameTs) / 1000));
        this.lastFrameTs = ts;
        this._updateAnimationState(dt);
        this._drawFrame(ts);
        this.rafId = requestAnimationFrame(step);
      };
      this.rafId = requestAnimationFrame(step);
    }

    _updateAnimationState(dt) {
      if (!this.state || !Array.isArray(this.state.horses)) return;
      const isRacing = this.state.phase === 'RACING';
      const isFinished = this.state.phase === 'FINISHED';
      const lerpAlpha = Math.min(1, dt * 13);

      // Gate opening smooth transition
      if (isRacing || isFinished) {
        this.gateOpenProgress = Math.min(1, this.gateOpenProgress + dt * 4.5);
      } else {
        this.gateOpenProgress = Math.max(0, this.gateOpenProgress - dt * 5);
      }

      if (this.cameraFlashAlpha > 0) {
        this.cameraFlashAlpha = Math.max(0, this.cameraFlashAlpha - dt * 2.2);
      }

      this.state.horses.forEach((h) => {
        const key = String(h.horseId);
        const target = this.targetPositions[key] !== undefined ? this.targetPositions[key] : (this.targetPositions[h.horseId] || 0);
        const cur = this.visualPositions[key] !== undefined ? this.visualPositions[key] : (this.visualPositions[h.horseId] || 0);
        const next = cur + (target - cur) * lerpAlpha;
        this.visualPositions[key] = next;
        this.visualPositions[h.horseId] = next;

        const spd = this.horseSpeeds[h.horseId] || (isRacing ? 7.2 : 0);
        const isSurging = this.surgingSet.has(h.horseId);

        if (isRacing) {
          this.stridePhases[h.horseId] = (this.stridePhases[h.horseId] || 0) + dt * (9.5 + spd * 1.25 + (isSurging ? 4.5 : 0));
          const dustProb = isSurging ? dt * 32 : dt * 16;
          if (Math.random() < dustProb) {
            this.particles.push({
              type: isSurging ? 'spark' : 'dust',
              horseId: h.horseId,
              posPct: Math.max(0, next - 1.4),
              offsetY: (Math.random() - 0.5) * 9,
              vx: isSurging ? (-45 - Math.random() * 45) : (-22 - Math.random() * 28),
              vy: (Math.random() - 0.5) * 16,
              life: 1,
              decay: isSurging ? 2.4 : 2.1,
              size: isSurging ? (2.0 + Math.random() * 2.4) : (1.6 + Math.random() * 2.0),
              color: isSurging ? '#fbbf24' : null,
            });
          }
        }
      });

      this.particles.forEach((p) => {
        p.offsetX = (p.offsetX || 0) + p.vx * dt;
        p.offsetY = (p.offsetY || 0) + p.vy * dt;
        p.life -= p.decay * dt;
      });
      this.particles = this.particles.filter((p) => p.life > 0);

      this.confetti.forEach((c) => {
        c.xPct += c.vx * dt;
        c.yPct += c.vy * dt;
        c.rot += c.vRot * dt;
        if (c.yPct > 1.05) c.life = 0;
      });
      this.confetti = this.confetti.filter((c) => c.life > 0);
    }

    _drawFrame(nowMs) {
      const canvas = this.els.canvas;
      if (!canvas || typeof canvas.getContext !== 'function') return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const targetW = Math.round(rect.width * dpr);
      const targetH = Math.round(rect.height * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      const ctx = canvas.getContext('2d');
      ctx.save();
      ctx.scale(dpr, dpr);

      const W = rect.width;
      const H = rect.height;
      const track = (this.state && this.state.track) || DEFAULT_TRACK;
      const theme = SURFACE_THEMES[track.id] || SURFACE_THEMES.RIVIERA_TURF;
      const horses = (this.state && Array.isArray(this.state.horses)) ? this.state.horses : [];
      const myTickets = (this.state && Array.isArray(this.state.myTickets)) ? this.state.myTickets : [];
      const backedSet = new Set(myTickets.map((t) => t.horseId));

      const padLeft = 58;
      const padRight = 54;
      const usableW = Math.max(120, W - padLeft - padRight);
      const topRail = 24;
      const botRail = H - 16;
      const laneH = (botRail - topRail) / 6;

      // 1. Track Background + Parallax Mowed Turf Stripes
      ctx.fillStyle = theme.grassB;
      ctx.fillRect(0, 0, W, H);

      const stripeCount = 14;
      const stripeW = usableW / stripeCount;
      const isRacing = this.state && this.state.phase === 'RACING';
      const parallaxShift = isRacing ? ((this.state.progressPct || 0) * 1.4) % (stripeW * 2) : 0;

      ctx.save();
      ctx.beginPath();
      ctx.rect(padLeft, topRail, usableW, botRail - topRail);
      ctx.clip();
      for (let i = -2; i <= stripeCount + 2; i += 1) {
        if (Math.abs(i) % 2 === 0) {
          ctx.fillStyle = theme.grassA;
          ctx.fillRect(padLeft + i * stripeW - parallaxShift, topRail, stripeW, botRail - topRail);
        }
      }
      ctx.restore();

      // Atmospheric layer (Rain or Floodlights or Sky Tint)
      ctx.fillStyle = theme.skyTint;
      ctx.fillRect(0, 0, W, H);

      if (track.id === 'RAIN_DERBY') {
        ctx.strokeStyle = 'rgba(186, 230, 253, 0.22)';
        ctx.lineWidth = 1;
        const shift = (nowMs * 0.28) % 44;
        for (let rx = -44; rx < W + 44; rx += 28) {
          ctx.beginPath();
          ctx.moveTo(rx + shift, 0);
          ctx.lineTo(rx - 22 + shift, H);
          ctx.stroke();
        }
      } else if (track.id === 'NIGHT_DERBY') {
        for (let lx = 0.2; lx <= 0.85; lx += 0.3) {
          const grad = ctx.createRadialGradient(W * lx, 0, 4, W * lx, H * 0.4, H * 0.9);
          grad.addColorStop(0, 'rgba(56, 189, 248, 0.16)');
          grad.addColorStop(1, 'rgba(56, 189, 248, 0)');
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, W, H);
        }
      }

      // Highlight player's backed lane subtly all across the track
      horses.forEach((h, i) => {
        if (backedSet.has(h.horseId)) {
          const yTop = topRail + i * laneH;
          ctx.fillStyle = 'rgba(212, 175, 55, 0.08)';
          ctx.fillRect(padLeft, yTop, usableW, laneH);
        }
      });

      // 2. Sprintpoort & Eindsprint Visual Zones
      const turboZones = (this.state && Array.isArray(this.state.turboZones)) ? this.state.turboZones : [];
      turboZones.forEach((z) => {
        const zx = padLeft + (z.startPct / 100) * usableW;
        const zw = ((z.endPct - z.startPct) / 100) * usableW;
        const pulse = 0.11 + 0.05 * Math.sin(nowMs * 0.005);
        const zGrad = ctx.createLinearGradient(zx, topRail, zx + zw, topRail);
        zGrad.addColorStop(0, 'rgba(212, 175, 55, 0)');
        zGrad.addColorStop(0.5, `rgba(212, 175, 55, ${pulse.toFixed(3)})`);
        zGrad.addColorStop(1, 'rgba(212, 175, 55, 0)');
        ctx.fillStyle = zGrad;
        ctx.fillRect(zx, topRail, zw, botRail - topRail);

        ctx.fillStyle = 'rgba(245, 198, 72, 0.82)';
        ctx.font = '700 9px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(z.label || 'SPRINTPOORT', zx + zw / 2, topRail - 8);
      });

      // 3. Monaco Guardrails & Distance Posts
      ctx.strokeStyle = theme.railColor;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(padLeft, topRail);
      ctx.lineTo(W - padRight + 14, topRail);
      ctx.moveTo(padLeft, botRail);
      ctx.lineTo(W - padRight + 14, botRail);
      ctx.stroke();

      [25, 50, 75].forEach((pct) => {
        const x = padLeft + (pct / 100) * usableW;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x, topRail);
        ctx.lineTo(x, botRail);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(229, 231, 235, 0.46)';
        ctx.font = '600 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${pct * 8}m`, x, H - 5);
      });

      // Finish Wire (Checkered + Photo-Finish laser)
      const finishX = padLeft + usableW;
      const cell = 6;
      const rows = Math.ceil((botRail - topRail) / cell);
      for (let r = 0; r < rows; r += 1) {
        ctx.fillStyle = r % 2 === 0 ? '#f8fafc' : '#111827';
        ctx.fillRect(finishX - 4, topRail + r * cell, 4, cell);
        ctx.fillStyle = r % 2 === 0 ? '#111827' : '#f8fafc';
        ctx.fillRect(finishX, topRail + r * cell, 4, cell);
      }
      ctx.fillStyle = '#e5e7eb';
      ctx.font = '700 9px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('FINISH', finishX, topRail - 8);

      if (this.state && this.state.photoFinishActive) {
        const laserAlpha = 0.65 + 0.35 * Math.sin(nowMs * 0.02);
        ctx.strokeStyle = `rgba(239, 68, 68, ${laserAlpha.toFixed(2)})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(finishX, topRail - 4);
        ctx.lineTo(finishX, botRail + 4);
        ctx.stroke();
      }

      // 4. Lane Dividers, Stall Badges & Mechanical Starting Gates
      for (let i = 0; i < 6; i += 1) {
        const yTop = topRail + i * laneH;
        const yMid = yTop + laneH / 2;
        if (i > 0) {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(padLeft, yTop);
          ctx.lineTo(finishX + 10, yTop);
          ctx.stroke();
        }
        const h = horses[i];
        const silk = h ? h.silkColor : '#d4af37';
        ctx.fillStyle = silk;
        ctx.beginPath();
        ctx.roundRect(10, yMid - 11, 26, 22, 5);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = '800 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(h ? h.horseId : i + 1), 23, yMid);

        // Starting gate frame + swinging door
        ctx.strokeStyle = 'rgba(226, 232, 240, 0.34)';
        ctx.lineWidth = 1.6;
        ctx.strokeRect(padLeft - 14, yTop + 3, 14, laneH - 6);

        const swingAngle = (this.gateOpenProgress || 0) * (Math.PI * 0.45);
        ctx.save();
        ctx.translate(padLeft, yTop + 3);
        ctx.rotate(-swingAngle);
        ctx.strokeStyle = this.gateOpenProgress > 0.2 ? 'rgba(16, 185, 129, 0.65)' : '#f59e0b';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, laneH - 6);
        ctx.stroke();
        ctx.restore();
      }

      // Starting Lights HUD at Start Line
      this._drawStartingLights(ctx, padLeft - 7, topRail - 10, nowMs);

      // 5. Particles (Dust, Surge Sparks & Cheer Fireworks)
      this.particles.forEach((p) => {
        const idx = Math.max(0, Math.min(5, (p.horseId || 1) - 1));
        const yMid = topRail + idx * laneH + laneH / 2;
        const basePos = p.type === 'cheer'
          ? (this.visualPositions[p.horseId] || 0)
          : (p.posPct || 0);
        const px = padLeft + (basePos / 100) * usableW + (p.offsetX || 0);
        const py = yMid + (p.offsetY || 0);
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
        ctx.fillStyle = p.color || theme.particleColor;
        ctx.beginPath();
        ctx.arc(px, py, p.size, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;

      // 6. Galloping Horses, Sprint Speed Lines & Silk Jockeys
      horses.forEach((h, i) => {
        const yMid = topRail + i * laneH + laneH / 2;
        const posPct = this.visualPositions[h.horseId] || 0;
        const hx = padLeft + (posPct / 100) * usableW;
        const phase = this.stridePhases[h.horseId] || 0;
        const bob = isRacing ? Math.sin(phase) * 2.3 : 0;
        const isBacked = backedSet.has(h.horseId);
        const isSelected = h.horseId === this.selectedHorseId;
        const isSurging = isRacing && this.surgingSet.has(h.horseId);

        // Sprint Surge Turbo Speed Lines
        if (isSurging) {
          ctx.save();
          for (let s = 0; s < 3; s += 1) {
            const sy = yMid + bob - 5 + s * 5;
            const len = 18 + ((nowMs * 0.08 + s * 9) % 14);
            ctx.strokeStyle = s === 1 ? 'rgba(251, 191, 36, 0.85)' : 'rgba(56, 189, 248, 0.65)';
            ctx.lineWidth = s === 1 ? 2.2 : 1.4;
            ctx.beginPath();
            ctx.moveTo(hx - 18, sy);
            ctx.lineTo(hx - 18 - len, sy);
            ctx.stroke();
          }
          ctx.restore();
        }

        if (isBacked || isSelected) {
          ctx.save();
          ctx.strokeStyle = isBacked ? '#10b981' : '#d4af37';
          ctx.lineWidth = isBacked ? 2.2 : 1.4;
          ctx.beginPath();
          ctx.ellipse(hx - 3, yMid + bob + 1, 24, 13, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        this._drawHorseSilhouette(ctx, hx, yMid + bob, h, phase, isRacing, isSurging);

        // Clear Backed Tag or Selected Pointer next to Horse
        if (isBacked) {
          ctx.fillStyle = '#10b981';
          ctx.font = '800 9px Inter, sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText('JIJ', Math.min(W - 36, hx + 18), yMid - 8);
        }

        // Floating Cheer callout banner
        const pulse = this.cheerPulses[h.horseId];
        if (pulse && pulse.until > nowMs) {
          const floatOffset = ((pulse.until - nowMs) / 1600);
          ctx.save();
          ctx.globalAlpha = Math.min(1, floatOffset * 1.4);
          ctx.fillStyle = pulse.color || '#d4af37';
          ctx.font = '800 10px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(pulse.label || 'HYPE!', hx - 4, yMid - 15 - (1 - floatOffset) * 8);
          ctx.restore();
        }
      });

      // 7. Confetti Celebration overlay
      this.confetti.forEach((c) => {
        ctx.save();
        ctx.translate(c.xPct * W, c.yPct * H);
        ctx.rotate(c.rot);
        ctx.fillStyle = c.color;
        ctx.fillRect(-c.size / 2, -c.size / 3, c.size, c.size * 0.65);
        ctx.restore();
      });

      // 8. Photo-Finish / Crossing Camera Flash
      if (this.cameraFlashAlpha > 0.01) {
        ctx.fillStyle = `rgba(255, 255, 255, ${this.cameraFlashAlpha.toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
      }

      ctx.restore();
    }

    _drawStartingLights(ctx, cx, cy, nowMs) {
      const ph = this.state ? this.state.phase : 'WAITING_FOR_BETS';
      let color = '#fbbf24';
      let glow = 'rgba(251, 191, 36, 0.3)';
      let label = 'KLAAR';

      if (ph === 'BETTING') {
        color = (this.state.timeLeft || 0) <= 5 ? '#ef4444' : '#f59e0b';
        glow = 'rgba(245, 158, 11, 0.4)';
        label = `${Math.max(0, this.state.timeLeft || 0)}s`;
      } else if (ph === 'STARTING') {
        color = '#ef4444';
        glow = 'rgba(239, 68, 68, 0.75)';
        label = 'SET';
      } else if (ph === 'RACING' || ph === 'FINISHED') {
        color = '#10b981';
        glow = 'rgba(16, 185, 129, 0.65)';
        label = 'GO';
      }

      const blink = ph === 'STARTING' ? (0.6 + 0.4 * Math.sin(nowMs * 0.02)) : 1;
      ctx.save();
      ctx.globalAlpha = blink;
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '700 8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(label, cx, cy - 8);
    }

    _drawHorseSilhouette(ctx, hx, hy, horse, phase, isMoving, isSurging = false) {
      const coatIdx = Math.max(0, ((Number(horse.horseId) || 1) - 1) % COAT_PALETTE.length);
      const coat = horse.coatColor || COAT_PALETTE[coatIdx];
      const silk = horse.silkColor || '#d4af37';
      const accent = horse.silkAccent || '#ffffff';
      const legSwing = isMoving ? Math.sin(phase) * 7 : 0;
      const legOpp = isMoving ? Math.sin(phase + Math.PI) * 7 : 0;
      const kneeBend = isMoving ? Math.max(0, Math.cos(phase)) * 3.5 : 0;
      const kneeBendOpp = isMoving ? Math.max(0, Math.cos(phase + Math.PI)) * 3.5 : 0;

      ctx.save();
      ctx.translate(hx, hy);

      // Ground shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.34)';
      ctx.beginPath();
      ctx.ellipse(-3, 12, 14, 3.2, 0, 0, Math.PI * 2);
      ctx.fill();

      // Articulated Fore & Hind Legs (two-segment gallop + white hoof sock)
      const drawLeg = (hipX, reachX, bendY) => {
        const kneeX = hipX + reachX * 0.48;
        const kneeY = 6.8 - bendY * 0.45;
        const hoofX = hipX + reachX;
        const hoofY = 11.4 - bendY;

        ctx.strokeStyle = coat;
        ctx.lineWidth = 2.3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(hipX, 2.5);
        ctx.lineTo(kneeX, kneeY);
        ctx.lineTo(hoofX, hoofY);
        ctx.stroke();

        ctx.fillStyle = '#e5e7eb';
        ctx.beginPath();
        ctx.arc(hoofX, hoofY, 1.3, 0, Math.PI * 2);
        ctx.fill();
      };

      drawLeg(-12, -2 + legSwing, kneeBend);
      drawLeg(-8, -1 + legOpp, kneeBendOpp);
      drawLeg(4, 3 + legOpp, kneeBendOpp);
      drawLeg(7, 4 + legSwing, kneeBend);

      // Wind-whipped flowing tail
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(-15, -1);
      ctx.quadraticCurveTo(-24, -3 + (isMoving ? Math.cos(phase) * 3 : 0), -28, 3);
      ctx.stroke();

      // Athletic horse torso
      ctx.fillStyle = coat;
      ctx.beginPath();
      ctx.ellipse(-4, 0, 12.5, 5.6, -0.05, 0, Math.PI * 2);
      ctx.fill();

      // Extending Neck & Head (lunges lower/forward during surge!)
      const lungeX = isSurging ? 2 : 0;
      ctx.beginPath();
      ctx.moveTo(4, -2.5);
      ctx.lineTo(13 + lungeX, -8.5);
      ctx.lineTo(17.5 + lungeX, -5);
      ctx.lineTo(16 + lungeX, -2);
      ctx.lineTo(8, 2.2);
      ctx.closePath();
      ctx.fill();

      // Flowing Mane
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(5, -3.5);
      ctx.lineTo(11 + lungeX, -9);
      ctx.stroke();

      // Saddlecloth + Distinct Silk Jersey + Accent Stripe
      ctx.fillStyle = silk;
      ctx.beginPath();
      ctx.roundRect(-10, -6.2, 10.5, 6.8, 2);
      ctx.fill();

      ctx.fillStyle = accent;
      ctx.fillRect(-10, -3.5, 10.5, 1.8);

      // Jockey Helmet
      ctx.fillStyle = silk;
      ctx.beginPath();
      ctx.arc(-2.5, -9.2, 3.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.fillRect(-1, -9.8, 4.2, 1.4);

      ctx.restore();
    }
  }

  return CasinoRacing;
}));
