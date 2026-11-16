/**
 * slots.js
 * Client controller for Multiplayer Monte Carlo Grand Sovereign Slots.
 * Features:
 *  - 5x3 luxury reel strip animator with elastic stops, slow-mo anticipation & slam-stop
 *  - 20-payline Canvas laser visualizer & coin fountain particle system
 *  - Clean 2x Free Spins + Bonus Buy (30x) confirmation
 *  - 8-cabinet live multiplayer floor strip, cabinet peeking & +2.5% Golden Fever cheers
 *  - Shared Progressive Grand Jackpot ticker & 30s Golden Fever countdown aura
 *  - Synchronized pendingPayoutHold HUD animation + Turbo + Spacebar shortcut
 *  - Pure inline vector SVG artwork: zero Unicode emojis and zero audio APIs.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const cls = factory();
    root.CasinoSlots = cls;
    root.SlotsGame = cls;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_VALID_BETS = [20, 40, 100, 200, 500, 1000, 2500, 5000, 10000];
  const BONUS_BUY_MULTIPLIER = 30;
  const FREE_SPINS_MULTIPLIER = 2;
  const GOLDEN_FEVER_MULTIPLIER = 1.25;

  const FALLBACK_PAYLINES = [
    [1, 1, 1, 1, 1],
    [0, 0, 0, 0, 0],
    [2, 2, 2, 2, 2],
    [0, 1, 2, 1, 0],
    [2, 1, 0, 1, 2],
    [0, 0, 1, 2, 2],
    [2, 2, 1, 0, 0],
    [1, 2, 2, 2, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 1, 2, 1],
    [1, 2, 1, 0, 1],
    [0, 1, 0, 1, 0],
    [2, 1, 2, 1, 2],
    [0, 1, 1, 1, 0],
    [2, 1, 1, 1, 2],
    [0, 0, 2, 0, 0],
    [2, 2, 0, 2, 2],
    [0, 2, 2, 2, 0],
    [2, 0, 0, 0, 2],
    [1, 1, 0, 1, 1],
  ];

  const PAYLINE_COLORS = [
    '#D4AF37', '#10B981', '#38BDF8', '#F472B6', '#F59E0B',
    '#A78BFA', '#34D399', '#FB7185', '#60A5FA', '#FBBF24',
    '#2DD4BF', '#C084FC', '#F87171', '#22D3EE', '#818CF8',
    '#4ADE80', '#E879F9', '#FACC15', '#FCA5A5', '#93C5FD',
  ];

  const FALLBACK_GRID = [
    ['K', 'CREST', '10'],
    ['Q', 'WILD', 'J'],
    ['A', 'DIAMOND', 'K'],
    ['J', 'WILD', 'Q'],
    ['10', 'CREST', 'A'],
  ];

  const SYMBOL_ORDER = ['WILD', 'CREST', 'SCATTER', 'DIAMOND', 'GOLD_BARS', 'EMERALD', 'A', 'K', 'Q', 'J', '10'];

  const SYMBOL_META = {
    '10': {
      name: 'Tien',
      tier: 'low',
      accent: '#94A3B8',
      svg: '<svg viewBox="0 0 64 64" class="slot-sym-svg" aria-hidden="true"><rect x="8" y="10" width="48" height="44" rx="10" fill="rgba(15,23,42,0.88)" stroke="#64748B" stroke-width="2"/><text x="32" y="41" text-anchor="middle" font-family="Cinzel,Georgia,serif" font-weight="800" font-size="25" fill="#CBD5E1">10</text></svg>',
    },
    'J': {
      name: 'Boer',
      tier: 'low',
      accent: '#38BDF8',
      svg: '<svg viewBox="0 0 64 64" class="slot-sym-svg" aria-hidden="true"><rect x="8" y="10" width="48" height="44" rx="10" fill="rgba(14,30,48,0.9)" stroke="#38BDF8" stroke-width="2"/><text x="32" y="42" text-anchor="middle" font-family="Cinzel,Georgia,serif" font-weight="800" font-size="28" fill="#7DD3FC">J</text></svg>',
    },
    'Q': {
      name: 'Vrouw',
      tier: 'low',
      accent: '#C084FC',
      svg: '<svg viewBox="0 0 64 64" class="slot-sym-svg" aria-hidden="true"><rect x="8" y="10" width="48" height="44" rx="10" fill="rgba(34,20,48,0.9)" stroke="#A855F7" stroke-width="2"/><text x="32" y="42" text-anchor="middle" font-family="Cinzel,Georgia,serif" font-weight="800" font-size="27" fill="#E9D5FF">Q</text></svg>',
    },
    'K': {
      name: 'Koning',
      tier: 'low',
      accent: '#FB7185',
      svg: '<svg viewBox="0 0 64 64" class="slot-sym-svg" aria-hidden="true"><rect x="8" y="10" width="48" height="44" rx="10" fill="rgba(45,16,28,0.9)" stroke="#F43F5E" stroke-width="2"/><text x="32" y="42" text-anchor="middle" font-family="Cinzel,Georgia,serif" font-weight="800" font-size="28" fill="#FDA4AF">K</text></svg>',
    },
    'A': {
      name: 'Aas',
      tier: 'low',
      accent: '#F59E0B',
      svg: '<svg viewBox="0 0 64 64" class="slot-sym-svg" aria-hidden="true"><rect x="8" y="10" width="48" height="44" rx="10" fill="rgba(42,30,12,0.92)" stroke="#D4AF37" stroke-width="2"/><text x="32" y="42" text-anchor="middle" font-family="Cinzel,Georgia,serif" font-weight="800" font-size="28" fill="#FDE68A">A</text></svg>',
    },
    'EMERALD': {
      name: 'Smaragd',
      tier: 'mid',
      accent: '#10B981',
      svg: '<svg viewBox="0 0 64 64" class="slot-sym-svg" aria-hidden="true"><polygon points="20,10 44,10 54,22 54,44 44,54 20,54 10,44 10,22" fill="#065F46" stroke="#34D399" stroke-width="2.2"/><polygon points="22,16 42,16 48,24 48,41 42,48 22,48 16,41 16,24" fill="#10B981"/><polygon points="22,16 42,16 32,31" fill="#6EE7B7" opacity="0.65"/></svg>',
    },
    'GOLD_BARS': {
      name: 'Goudstaven',
      tier: 'mid',
      accent: '#FBBF24',
      svg: '<svg viewBox="0 0 64 64" class="slot-sym-svg" aria-hidden="true"><polygon points="10,48 18,32 42,32 34,48" fill="#B45309" stroke="#FDE047" stroke-width="1.8"/><polygon points="18,32 42,32 46,37 22,37" fill="#FDE68A" opacity="0.8"/><polygon points="22,36 30,20 54,20 46,36" fill="#D97706" stroke="#FEF08A" stroke-width="1.8"/><polygon points="30,20 54,20 50,25 26,25" fill="#FEF9C3" opacity="0.9"/></svg>',
    },
    'DIAMOND': {
      name: 'Diamant',
      tier: 'high',
      accent: '#7DD3FC',
      svg: '<svg viewBox="0 0 64 64" class="slot-sym-svg" aria-hidden="true"><polygon points="18,12 46,12 56,26 32,54 8,26" fill="#0284C7" stroke="#E0F2FE" stroke-width="2.2"/><polygon points="18,12 46,12 39,26 25,26" fill="#BAE6FD"/><polygon points="25,26 39,26 32,54" fill="#38BDF8"/><polygon points="8,26 25,26 32,54" fill="#0369A1" opacity="0.8"/><polygon points="39,26 56,26 32,54" fill="#7DD3FC" opacity="0.55"/></svg>',
    },
    'CREST': {
      name: 'Paleis Kroon',
      tier: 'premium',
      accent: '#FDE047',
      svg: '<svg viewBox="0 0 64 64" class="slot-sym-svg" aria-hidden="true"><path d="M12 18 L52 18 L50 38 C50 47 32 55 32 55 C32 55 14 47 14 38 Z" fill="#1E1B18" stroke="#D4AF37" stroke-width="2.4"/><path d="M17 24 L23 14 L32 22 L41 14 L47 24 Z" fill="#FACC15" stroke="#FEF08A" stroke-width="1.4"/><polygon points="32,27 38,36 32,46 26,36" fill="#EF4444" stroke="#FCA5A5" stroke-width="1.4"/></svg>',
    },
    'WILD': {
      name: 'Gouden Wild',
      tier: 'wild',
      accent: '#FACC15',
      svg: '<svg viewBox="0 0 64 64" class="slot-sym-svg" aria-hidden="true"><rect x="6" y="8" width="52" height="48" rx="12" fill="rgba(120,75,8,0.92)" stroke="#FDE047" stroke-width="2.5"/><polygon points="32,12 37,24 50,24 40,31 44,42 32,35 20,42 24,31 14,24 27,24" fill="#FACC15" opacity="0.32"/><text x="32" y="34" text-anchor="middle" font-family="Cinzel,Georgia,serif" font-weight="900" font-size="16" fill="#FEF9C3" letter-spacing="1">WILD</text><rect x="14" y="40" width="36" height="10" rx="4" fill="#D4AF37"/><text x="32" y="48" text-anchor="middle" font-family="Inter,sans-serif" font-weight="800" font-size="8" fill="#181204">VERVANGER</text></svg>',
    },
    'SCATTER': {
      name: 'Scatter Medaillon',
      tier: 'scatter',
      accent: '#F472B6',
      svg: '<svg viewBox="0 0 64 64" class="slot-sym-svg" aria-hidden="true"><circle cx="32" cy="30" r="21" fill="rgba(76,18,54,0.94)" stroke="#F472B6" stroke-width="2.4"/><circle cx="32" cy="30" r="14" fill="none" stroke="#FDE047" stroke-width="1.6" stroke-dasharray="4 3"/><polygon points="32,17 36,26 45,26 38,31 40,40 32,35 24,40 26,31 19,26 28,26" fill="#FDE047"/><rect x="10" y="45" width="44" height="11" rx="5" fill="#BE185D" stroke="#F9A8D4" stroke-width="1.2"/><text x="32" y="53" text-anchor="middle" font-family="Inter,sans-serif" font-weight="800" font-size="7.8" fill="#FDF2F8" letter-spacing="0.8">SCATTER</text></svg>',
    },
  };

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  class CasinoSlots {
    /**
     * @param {{ network: Object, ui: Object }} deps
     */
    constructor({ network, ui }) {
      this.network = network;
      this.ui = ui;

      this.validBets = [...DEFAULT_VALID_BETS];
      this.currentBet = 100;
      this.turboMode = false;
      this.bonusBuyMultiplier = BONUS_BUY_MULTIPLIER;
      this.freeSpinsMultiplier = FREE_SPINS_MULTIPLIER;
      this.goldenFeverMultiplier = GOLDEN_FEVER_MULTIPLIER;

      this.jackpotPool = 10000;
      this.paytable = null;
      this.paylines = FALLBACK_PAYLINES;
      this.reelStrips = null;

      this.machines = [];
      this.myMachineId = null;
      this.selectedMachineId = null;
      this.spotlightMachineId = null;
      this.recentBigWins = [];
      this.myRollHistory = [];
      this.rollSeqCounter = 0;
      this.activeSideFeedTab = 'rolls';

      this.goldenFever = {
        active: false,
        progress: 0,
        multiplier: 1,
        remainingMs: 0,
        endsAt: 0,
        durationMs: 30000,
      };

      this.freeSpins = {
        freeSpinsRemaining: 0,
        lockedBet: null,
        totalBonusWin: 0,
      };

      this.currentGrid = FALLBACK_GRID.map((c) => [...c]);
      this.isSpinning = false;
      this.slamStopped = false;
      this.pendingSpinResult = null;
      this.spinQueueTimers = [];
      this.revealTimers = [];
      this.paylineCycleTimer = null;
      this.bonusBuyConfirmTimer = null;
      this.bonusBuyArmed = false;

      // Synced HUD hold (prevents balance spoiler before reels finish landing)
      this.pendingPayoutHold = 0;
      this.payoutReleases = [];

      // Canvas FX state
      this.particles = [];
      this.activePaylineWaves = [];
      this.shockwaves = [];
      this.fxRafId = null;
      this.feverTickerTimer = null;
      this.lastFrameTime = 0;
      this.viewActive = false;

      this.els = {};
      this.boundKeydown = this._handleKeydown.bind(this);
      this.boundResize = this.resizeCanvas.bind(this);
    }

    init() {
      this._cacheElements();
      this._bindUIEvents();
      this._bindNetworkEvents();
      this.renderGridInstant(this.currentGrid);
      this.renderBetUI();
      this.renderFloor();
      this.renderSpotlight();
      this.resizeCanvas();
      this._startFeverTicker();
    }

    _cacheElements() {
      this.els = {
        view: document.getElementById('slots-view'),
        headerBar: document.getElementById('slots-header-bar'),
        feverBox: document.getElementById('slots-fever-box'),
        feverLabel: document.getElementById('slots-fever-label'),
        feverFill: document.getElementById('slots-fever-fill'),
        jackpotPill: document.getElementById('slots-jackpot-pill'),
        jackpotAmount: document.getElementById('slots-jackpot-amount'),
        floorCount: document.getElementById('slots-floor-count'),
        floorStrip: document.getElementById('slots-floor-strip'),
        activeCabBadge: document.getElementById('slots-active-cab-badge'),
        effectiveMultPill: document.getElementById('slots-effective-mult-pill'),
        fsBanner: document.getElementById('slots-fs-banner'),
        fsCountLabel: document.getElementById('slots-fs-count-label'),
        fsTotalLabel: document.getElementById('slots-fs-total-label'),
        btnPaytable: document.getElementById('btn-slots-paytable'),
        reelsStage: document.getElementById('slots-reels-stage'),
        reelsFrame: document.getElementById('slots-reels-frame'),
        fxCanvas: document.getElementById('slots-fx-canvas'),
        paylineReadout: document.getElementById('slots-payline-readout'),
        winBanner: document.getElementById('slots-win-banner'),
        winKicker: document.getElementById('slots-win-kicker'),
        winAmount: document.getElementById('slots-win-amount'),
        winSub: document.getElementById('slots-win-sub'),
        totalBetVal: document.getElementById('slots-total-bet-val'),
        lineBetVal: document.getElementById('slots-bet-val'),
        betPresets: document.getElementById('slots-bet-presets'),
        btnHalf: document.getElementById('btn-slots-bet-half'),
        btnDouble: document.getElementById('btn-slots-bet-double'),
        btnMax: document.getElementById('btn-slots-bet-max'),
        btnTurbo: document.getElementById('btn-slots-turbo'),
        btnBonusBuy: document.getElementById('btn-slots-bonus-buy'),
        bonusBuyCost: document.getElementById('slots-bonus-buy-cost'),
        btnSpin: document.getElementById('btn-spin-slots'),
        spotlightTitle: document.getElementById('slots-spotlight-title'),
        btnBackMine: document.getElementById('btn-slots-back-mine'),
        spotlightPlayer: document.getElementById('slots-spotlight-player'),
        spectateMiniGrid: document.getElementById('slots-spectate-mini-grid'),
        spotlightStats: document.getElementById('slots-spotlight-stats'),
        btnCheerSpotlight: document.getElementById('btn-slots-cheer-spotlight'),
        bigWinsList: document.getElementById('slots-big-wins-list'),
        rollHistoryList: document.getElementById('slots-roll-history-list'),
        rollSummary: document.getElementById('slots-roll-summary'),
        btnTabRolls: document.getElementById('btn-slots-tab-rolls'),
        btnTabFloor: document.getElementById('btn-slots-tab-floor'),
        paytableOverlay: document.getElementById('slots-paytable-overlay'),
        paytableBody: document.getElementById('slots-paytable-body'),
        btnClosePaytable: document.getElementById('btn-close-slots-paytable'),
      };
    }

    _bindUIEvents() {
      if (this.els.betPresets) {
        this.els.betPresets.addEventListener('click', (e) => {
          const btn = e.target.closest('.btn-slot-chip');
          if (!btn) return;
          const val = Number(btn.dataset.bet);
          this.setBet(val);
        });
      }

      if (this.els.btnHalf) {
        this.els.btnHalf.addEventListener('click', () => this.stepBet(-1));
      }
      if (this.els.btnDouble) {
        this.els.btnDouble.addEventListener('click', () => this.stepBet(1));
      }
      if (this.els.btnMax) {
        this.els.btnMax.addEventListener('click', () => this.setBet(this.validBets[this.validBets.length - 1]));
      }

      if (this.els.btnTurbo) {
        this.els.btnTurbo.addEventListener('click', () => {
          this.turboMode = !this.turboMode;
          this.els.btnTurbo.classList.toggle('active', this.turboMode);
          if (this.els.view) {
            this.els.view.classList.toggle('slots-turbo-on', this.turboMode);
          }
        });
      }

      if (this.els.btnBonusBuy) {
        this.els.btnBonusBuy.addEventListener('click', () => this._handleBonusBuyClick());
      }

      if (this.els.btnSpin) {
        this.els.btnSpin.addEventListener('click', () => this.handlePrimarySpinButton());
      }

      if (this.els.btnPaytable) {
        this.els.btnPaytable.addEventListener('click', () => this.openPaytable());
      }
      if (this.els.btnTabRolls) {
        this.els.btnTabRolls.addEventListener('click', () => this.switchSideFeedTab('rolls'));
      }
      if (this.els.btnTabFloor) {
        this.els.btnTabFloor.addEventListener('click', () => this.switchSideFeedTab('floor'));
      }
      if (this.els.btnClosePaytable) {
        this.els.btnClosePaytable.addEventListener('click', () => this.closePaytable());
      }
      if (this.els.paytableOverlay) {
        this.els.paytableOverlay.addEventListener('click', (e) => {
          if (e.target === this.els.paytableOverlay) this.closePaytable();
        });
      }

      if (this.els.floorStrip) {
        this.els.floorStrip.addEventListener('click', (e) => {
          const cheerBtn = e.target.closest('.slots-card-cheer-btn');
          if (cheerBtn) {
            e.stopPropagation();
            const mId = Number(cheerBtn.dataset.machineId);
            if (mId && this.network && typeof this.network.slotsCheer === 'function') {
              this.network.slotsCheer(mId);
            }
            return;
          }
          const card = e.target.closest('.slots-floor-card');
          if (!card) return;
          const machineId = Number(card.dataset.machineId);
          this._handleFloorCardClick(machineId);
        });
      }

      if (this.els.btnBackMine) {
        this.els.btnBackMine.addEventListener('click', () => {
          this.spotlightMachineId = this.myMachineId || 1;
          this.renderFloor();
          this.renderSpotlight();
        });
      }

      if (this.els.btnCheerSpotlight) {
        this.els.btnCheerSpotlight.addEventListener('click', () => {
          const targetId = this.spotlightMachineId || this.myMachineId;
          if (targetId && this.network && typeof this.network.slotsCheer === 'function') {
            this.network.slotsCheer(targetId);
          }
        });
      }

      if (typeof window !== 'undefined') {
        window.addEventListener('resize', this.boundResize);
        window.addEventListener('keydown', this.boundKeydown);
      }
    }

    _bindNetworkEvents() {
      if (!this.network || typeof this.network.on !== 'function') return;

      this.network.on('slots_state', (state) => this.applyFloorState(state));
      this.network.on('slots_floor_update', (state) => this.applyFloorUpdate(state));
      this.network.on('slots_spin_result', (res) => this.onSpinResult(res));
      this.network.on('slots_spin_rejected', (err) => this.onSpinRejected(err));
      this.network.on('slots_big_win', (entry) => this.onBigWinEvent(entry));
      this.network.on('slots_golden_fever', (fever) => this.onGoldenFeverEvent(fever));
      this.network.on('slots_cheer_event', (evt) => this.onCheerEvent(evt));
      this.network.on('slots_cheer_rejected', (err) => {
        if (err && err.reason && this.ui) {
          this.ui.showToast(err.reason, err.code === 'PLAYER_NOT_FOUND' ? 'info' : 'error');
        }
      });
    }

    onViewActivated() {
      this.viewActive = true;
      this.resizeCanvas();
      this._updateFeverUI();
      this._syncHeaderPhase();
    }

    _syncHeaderPhase() {
      if (!this.viewActive || !this.ui || typeof this.ui.updatePhase !== 'function') return;
      const now = Date.now();
      const fever = this.goldenFever || {};
      if (fever.active && fever.endsAt > now) {
        const secs = Math.max(0, Math.ceil((fever.endsAt - now) / 1000));
        this.ui.updatePhase('GOLDEN_FEVER', Math.ceil((fever.durationMs || 30000) / 1000), secs);
        return;
      }
      if (this.freeSpins && this.freeSpins.freeSpinsRemaining > 0) {
        this.ui.updatePhase('FREE_SPINS', this.freeSpins.freeSpinsRemaining, `${this.freeSpins.freeSpinsRemaining} SPINS`);
        return;
      }
      if (this.isSpinning) {
        this.ui.updatePhase('SLOTS_SPINNING', 0, 'DRAAIT');
        return;
      }
      this.ui.updatePhase('SLOTS_READY', 0, 'LIVE');
    }

    onViewDeactivated() {
      this.viewActive = false;
      this._disarmBonusBuy();
      if (this.paylineCycleTimer) {
        clearInterval(this.paylineCycleTimer);
        this.paylineCycleTimer = null;
      }
      if (this.pendingPayoutHold > 0) {
        this.pendingPayoutHold = 0;
        this.payoutReleases.forEach((e) => { e.released = true; });
        this.payoutReleases = [];
        if (this.ui && typeof this.ui.updatePlayerHUD === 'function') {
          this.ui.updatePlayerHUD(false);
        }
      }
    }

    resizeCanvas() {
      const canvas = this.els.fxCanvas;
      const stage = this.els.reelsStage;
      if (!canvas || !stage) return;
      const rect = stage.getBoundingClientRect ? stage.getBoundingClientRect() : { width: 640, height: 320 };
      const w = Math.max(200, Math.round(rect.width || 640));
      const h = Math.max(160, Math.round(rect.height || 320));
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? Math.min(2, window.devicePixelRatio) : 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext && canvas.getContext('2d');
      if (ctx && typeof ctx.setTransform === 'function') {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    }

    applyFloorState(state) {
      if (!state || typeof state !== 'object') return;
      if (Array.isArray(state.validBets) && state.validBets.length) {
        this.validBets = [...state.validBets];
        if (!this.validBets.includes(this.currentBet)) {
          this.currentBet = this.validBets[0];
        }
      }
      if (Array.isArray(state.paylines) && state.paylines.length) {
        this.paylines = state.paylines;
      }
      if (state.paytable) {
        this.paytable = state.paytable;
      }
      if (Array.isArray(state.reelStrips)) {
        this.reelStrips = state.reelStrips;
      }
      if (typeof state.jackpotPool === 'number') {
        this.jackpotPool = state.jackpotPool;
        this._renderJackpot();
      }
      if (state.goldenFever) {
        this.goldenFever = { ...this.goldenFever, ...state.goldenFever };
        this._updateFeverUI();
      }
      if (Array.isArray(state.machines)) {
        this.machines = state.machines;
      }
      if (state.myMachineId) {
        this.myMachineId = state.myMachineId;
        this.selectedMachineId = state.myMachineId;
        if (!this.spotlightMachineId) {
          this.spotlightMachineId = state.myMachineId;
        }
      }
      if (typeof state.bonusBuyMultiplier === 'number' && state.bonusBuyMultiplier > 0) {
        this.bonusBuyMultiplier = state.bonusBuyMultiplier;
      }
      if (typeof state.freeSpinsMultiplier === 'number' && state.freeSpinsMultiplier > 0) {
        this.freeSpinsMultiplier = state.freeSpinsMultiplier;
      }
      if (typeof state.goldenFeverMultiplier === 'number' && state.goldenFeverMultiplier > 0) {
        this.goldenFeverMultiplier = state.goldenFeverMultiplier;
      }
      if (state.myBonus) {
        this.freeSpins = {
          freeSpinsRemaining: state.myBonus.freeSpinsRemaining || 0,
          lockedBet: state.myBonus.lockedBet || null,
          totalBonusWin: state.myBonus.totalBonusWin || 0,
        };
        if (this.freeSpins.freeSpinsRemaining > 0 && this.freeSpins.lockedBet) {
          this.currentBet = this.freeSpins.lockedBet;
        }
      }
      if (Array.isArray(state.recentBigWins)) {
        this.recentBigWins = state.recentBigWins;
      }

      this.renderBetUI();
      this.renderCabinetTopbar();
      this._syncHeaderPhase();
      this.renderFloor();
      this.renderSpotlight();
      this.renderBigWinsFeed();
      this.renderPaytableContent();
    }

    applyFloorUpdate(data) {
      if (!data || typeof data !== 'object') return;
      if (typeof data.jackpotPool === 'number') {
        this.jackpotPool = data.jackpotPool;
        this._renderJackpot();
      }
      if (data.goldenFever) {
        this.goldenFever = { ...this.goldenFever, ...data.goldenFever };
        this._updateFeverUI();
      }
      if (Array.isArray(data.machines)) {
        this.machines = data.machines;
        const myId = this.ui && this.ui.myPlayer ? this.ui.myPlayer.id : null;
        if (myId) {
          const mine = this.machines.find((m) => m.occupiedBy && m.occupiedBy.playerId === myId);
          if (mine) {
            this.myMachineId = mine.machineId;
            this.selectedMachineId = mine.machineId;
          }
        }
      }
      if (Array.isArray(data.recentBigWins)) {
        this.recentBigWins = data.recentBigWins;
      }
      this.renderCabinetTopbar();
      this._syncHeaderPhase();
      this.renderFloor();
      this.renderSpotlight();
      this.renderBigWinsFeed();
    }

    setBet(amount) {
      if (this.freeSpins.freeSpinsRemaining > 0) {
        if (this.ui) this.ui.showToast('Inzet vergrendeld tijdens Gratis Spins.', 'info');
        return;
      }
      if (!this.validBets.includes(amount)) return;
      this.currentBet = amount;
      this._disarmBonusBuy();
      this.renderBetUI();
    }

    stepBet(dir) {
      if (this.freeSpins.freeSpinsRemaining > 0) return;
      const idx = this.validBets.indexOf(this.currentBet);
      const safeIdx = idx >= 0 ? idx : 0;
      const nextIdx = Math.max(0, Math.min(this.validBets.length - 1, safeIdx + dir));
      this.setBet(this.validBets[nextIdx]);
    }

    renderBetUI() {
      const locked = this.freeSpins.freeSpinsRemaining > 0;
      const activeBet = locked && this.freeSpins.lockedBet ? this.freeSpins.lockedBet : this.currentBet;
      const lineBet = Math.round((activeBet / 20) * 100) / 100;
      const buyMult = this.bonusBuyMultiplier || BONUS_BUY_MULTIPLIER;
      const buyCost = activeBet * buyMult;

      if (this.els.totalBetVal) {
        this.els.totalBetVal.textContent = `${activeBet.toLocaleString()} Fiches`;
      }
      if (this.els.lineBetVal) {
        this.els.lineBetVal.textContent = `${lineBet.toLocaleString()} Fiches`;
      }
      if (this.els.bonusBuyCost && !this.bonusBuyArmed) {
        this.els.bonusBuyCost.textContent = `${buyCost.toLocaleString()} F`;
      }

      if (this.els.betPresets) {
        this.els.betPresets.querySelectorAll('.btn-slot-chip').forEach((btn) => {
          const val = Number(btn.dataset.bet);
          btn.classList.toggle('active', val === activeBet);
          btn.disabled = locked;
        });
      }
      [this.els.btnHalf, this.els.btnDouble, this.els.btnMax].forEach((b) => {
        if (b) b.disabled = locked;
      });
      if (this.els.btnBonusBuy) {
        this.els.btnBonusBuy.disabled = locked || this.isSpinning;
      }

      this._updateSpinButtonLabel();
    }

    _updateSpinButtonLabel() {
      const btn = this.els.btnSpin;
      if (!btn) return;
      if (this.isSpinning && !this.slamStopped) {
        btn.textContent = 'STOPPEN';
        btn.classList.add('slots-btn-stop');
        btn.disabled = false;
      } else if (this.isSpinning && this.slamStopped) {
        btn.textContent = 'LANDEN...';
        btn.classList.remove('slots-btn-stop');
        btn.disabled = true;
      } else if (this.freeSpins.freeSpinsRemaining > 0) {
        btn.textContent = `GRATIS DRAAI (${this.freeSpins.freeSpinsRemaining})`;
        btn.classList.remove('slots-btn-stop');
        btn.disabled = false;
      } else {
        btn.textContent = 'DRAAIEN';
        btn.classList.remove('slots-btn-stop');
        btn.disabled = false;
      }
    }

    _handleFloorCardClick(machineId) {
      if (!machineId) return;
      const machine = this.machines.find((m) => m.machineId === machineId);
      if (!machine) return;

      const myId = this.ui && this.ui.myPlayer ? this.ui.myPlayer.id : null;
      const isMine = machine.occupiedBy && machine.occupiedBy.playerId === myId;
      const isOccupiedByOther = machine.occupiedBy && !isMine;

      if (isOccupiedByOther) {
        this.spotlightMachineId = machineId;
        this.renderFloor();
        this.renderSpotlight();
        return;
      }

      if (isMine) {
        this.spotlightMachineId = machineId;
        this.renderFloor();
        this.renderSpotlight();
        return;
      }

      // Empty cabinet: sit down if not mid-spin
      if (this.isSpinning) {
        if (this.ui) this.ui.showToast('Wacht tot deze draai is afgelopen voor je van kast wisselt.', 'info');
        return;
      }
      if (this.network && typeof this.network.slotsSelectMachine === 'function') {
        this.selectedMachineId = machineId;
        this.spotlightMachineId = machineId;
        this.network.slotsSelectMachine(machineId);
      }
    }

    handlePrimarySpinButton() {
      if (this.isSpinning) {
        this.slamStop();
        return;
      }
      this.requestSpin(false);
    }

    _handleBonusBuyClick() {
      if (this.isSpinning || this.freeSpins.freeSpinsRemaining > 0) return;
      const buyMult = this.bonusBuyMultiplier || BONUS_BUY_MULTIPLIER;
      const cost = this.currentBet * buyMult;

      if (!this.bonusBuyArmed) {
        this.bonusBuyArmed = true;
        if (this.els.btnBonusBuy) this.els.btnBonusBuy.classList.add('armed');
        if (this.els.bonusBuyCost) this.els.bonusBuyCost.textContent = `BEVESTIG ${cost.toLocaleString()} F`;
        clearTimeout(this.bonusBuyConfirmTimer);
        this.bonusBuyConfirmTimer = setTimeout(() => this._disarmBonusBuy(), 4000);
        return;
      }

      this._disarmBonusBuy();
      this.requestSpin(true);
    }

    _disarmBonusBuy() {
      this.bonusBuyArmed = false;
      clearTimeout(this.bonusBuyConfirmTimer);
      if (this.els.btnBonusBuy) this.els.btnBonusBuy.classList.remove('armed');
      if (this.els.bonusBuyCost) {
        const activeBet = this.freeSpins.lockedBet || this.currentBet;
        const buyMult = this.bonusBuyMultiplier || BONUS_BUY_MULTIPLIER;
        this.els.bonusBuyCost.textContent = `${(activeBet * buyMult).toLocaleString()} F`;
      }
    }

    requestSpin(isBonusBuy = false) {
      if (this.isSpinning) return;
      if (!this.network || typeof this.network.slotsSpin !== 'function') return;

      const betToSend = (this.freeSpins.freeSpinsRemaining > 0 && this.freeSpins.lockedBet)
        ? this.freeSpins.lockedBet
        : this.currentBet;

      this._clearFXOverlays();
      this.isSpinning = true;
      this.slamStopped = false;
      this.pendingSpinResult = null;
      this._updateSpinButtonLabel();
      this.renderBetUI();
      this._syncHeaderPhase();
      this._startPreSpinBlur();

      this.network.slotsSpin({
        bet: betToSend,
        isBonusBuy: !!isBonusBuy,
        machineId: this.myMachineId || this.selectedMachineId,
      });
    }

    onSpinRejected(err) {
      this._stopAllSpinTimers();
      this.isSpinning = false;
      this.slamStopped = false;
      this._clearReelVisualStates();
      this.renderGridInstant(this.currentGrid);
      this._updateSpinButtonLabel();
      this.renderBetUI();
      this._syncHeaderPhase();

      if (err && err.reason && this.ui) {
        const isRecovering = err.code === 'PLAYER_NOT_FOUND' && this.network && typeof this.network.hasStoredCredentials === 'function' && this.network.hasStoredCredentials();
        this.ui.showToast(isRecovering ? 'Sessie wordt hersteld, probeer zo opnieuw...' : err.reason, isRecovering ? 'info' : 'error');
      }
    }

    onSpinResult(res) {
      if (!res || !res.ok) return;

      this.pendingSpinResult = res;
      this.isSpinning = true;
      this.slamStopped = false;

      if (res.machineId) {
        this.myMachineId = res.machineId;
        this.selectedMachineId = res.machineId;
      }

      if (typeof res.jackpotPool === 'number') {
        this.jackpotPool = res.jackpotPool;
        this._renderJackpot();
      }
      if (res.goldenFever) {
        this.goldenFever = { ...this.goldenFever, ...res.goldenFever };
        this._updateFeverUI();
      }

      // Hold payout in HUD until reels finish landing (synced via ui.updatePlayerHUD)
      if (typeof res.totalPayout === 'number' && res.totalPayout > 0) {
        this.pendingPayoutHold += res.totalPayout;
        const releaseEntry = { id: res.spinId, amount: res.totalPayout, released: false };
        this.payoutReleases.push(releaseEntry);
        if (this.ui) this.ui.updatePlayerHUD(false);
      }

      const targetGrid = Array.isArray(res.grid) && res.grid.length === 5
        ? res.grid
        : this.currentGrid;

      this._animateReelsToResult(res, targetGrid);
    }

    _startPreSpinBlur() {
      for (let col = 0; col < 5; col += 1) {
        const colEl = document.getElementById(`slots-reel-${col}`);
        if (colEl) {
          colEl.classList.add('reel-spinning');
          colEl.classList.remove('reel-anticipating');
        }
      }
    }

    _clearReelVisualStates() {
      for (let col = 0; col < 5; col += 1) {
        const colEl = document.getElementById(`slots-reel-${col}`);
        if (!colEl) continue;
        colEl.classList.remove('reel-spinning', 'reel-anticipating', 'reel-landed');
        const cells = colEl.querySelectorAll('.slots-symbol');
        cells.forEach((cell) => {
          cell.classList.remove('symbol-win-pulse', 'symbol-dimmed', 'symbol-scatter-hit');
        });
      }
    }

    _stopAllSpinTimers() {
      this.spinQueueTimers.forEach((t) => clearTimeout(t));
      this.spinQueueTimers = [];
      this.revealTimers.forEach((t) => clearTimeout(t));
      this.revealTimers = [];
      if (this.paylineCycleTimer) {
        clearInterval(this.paylineCycleTimer);
        this.paylineCycleTimer = null;
      }
    }

    _animateReelsToResult(res, targetGrid) {
      this._stopAllSpinTimers();

      const anticipationSet = new Set(Array.isArray(res.anticipationReels) ? res.anticipationReels : []);
      const baseStops = this.turboMode
        ? [300, 400, 500, 600, 700]
        : [680, 920, 1180, 1440, 1700];
      const teaseExtra = this.turboMode ? 420 : 900;

      // Compute progressive stop times (any anticipated reel adds delay cascading forward)
      const stopTimes = [];
      let cumulativeExtra = 0;
      for (let col = 0; col < 5; col += 1) {
        if (anticipationSet.has(col)) {
          cumulativeExtra += teaseExtra;
        }
        stopTimes[col] = baseStops[col] + cumulativeExtra;
      }

      // Build animated vertical strip per column
      for (let col = 0; col < 5; col += 1) {
        const oldCol = this.currentGrid[col] || FALLBACK_GRID[col];
        const newCol = targetGrid[col] || FALLBACK_GRID[col];
        this._mountAnimatedColumnTrack(col, oldCol, newCol, 14 + col * 3, stopTimes[col]);

        // Highlight anticipation glow right after the preceding reel stops
        if (anticipationSet.has(col)) {
          const teaseStartAt = Math.max(220, (col > 0 ? stopTimes[col - 1] : 250));
          const tGlow = setTimeout(() => {
            if (this.slamStopped) return;
            const colEl = document.getElementById(`slots-reel-${col}`);
            if (colEl) colEl.classList.add('reel-anticipating');
          }, teaseStartAt);
          this.spinQueueTimers.push(tGlow);
        }

        const tStop = setTimeout(() => {
          if (this.slamStopped) return;
          this._finishColumnLanding(col, newCol, res);
        }, stopTimes[col]);
        this.spinQueueTimers.push(tStop);
      }

      const finalAt = stopTimes[4] + 60;
      const tFinal = setTimeout(() => {
        if (this.slamStopped) return;
        this._finalizeSpinReveal(res, targetGrid);
      }, finalAt);
      this.spinQueueTimers.push(tFinal);

      // Safety fallback: guarantee payout hold cannot stay stuck even if browser throttles timers
      const tSafety = setTimeout(() => {
        this._releaseSpinPayout(res.spinId);
      }, finalAt + 2500);
      this.revealTimers.push(tSafety);
    }

    _mountAnimatedColumnTrack(col, oldCol, newCol, fillerCount, durationMs) {
      const colEl = document.getElementById(`slots-reel-${col}`);
      if (!colEl) return;
      const track = colEl.querySelector('.slots-reel-track');
      if (!track) return;

      const fillers = [];
      const stripSource = (this.reelStrips && this.reelStrips[col]) || SYMBOL_ORDER;
      for (let i = 0; i < fillerCount; i += 1) {
        fillers.push(stripSource[Math.floor(Math.random() * stripSource.length)]);
      }

      // Track order from top to bottom: [newCol(0..2), ...fillers, oldCol(0..2)]
      const sequence = [...newCol, ...fillers, ...oldCol];
      const totalItems = sequence.length;
      const trackPct = (totalItems / 3) * 100;
      const cellPct = 100 / totalItems;
      const startOffsetPct = -((totalItems - 3) / totalItems) * 100;

      track.style.transition = 'none';
      track.style.height = `${trackPct}%`;
      track.style.transform = `translate3d(0, ${startOffsetPct}%, 0)`;

      track.innerHTML = sequence.map((symId, idx) => {
        const meta = SYMBOL_META[symId] || SYMBOL_META['10'];
        return `<div class="slots-symbol slots-symbol-tier-${meta.tier}" data-sym="${escapeHtml(symId)}" data-idx="${idx}" style="height:${cellPct}%;">${meta.svg}<span class="slots-sym-tag">${escapeHtml(symId === 'GOLD_BARS' ? 'GOLD' : symId)}</span></div>`;
      }).join('');

      // Force layout reflow so browser starts transition cleanly from startOffsetPct
      void track.offsetHeight;
      track.style.transition = `transform ${Math.max(160, durationMs)}ms cubic-bezier(0.14, 1.03, 0.28, 1)`;
      track.style.transform = 'translate3d(0, 0%, 0)';
    }

    _finishColumnLanding(col, newCol, res) {
      const colEl = document.getElementById(`slots-reel-${col}`);
      if (!colEl) return;
      colEl.classList.remove('reel-spinning', 'reel-anticipating');
      colEl.classList.add('reel-landed');

      const track = colEl.querySelector('.slots-reel-track');
      if (track) {
        this._renderTrackStatic(track, newCol, col);
      }

      // Highlight scatters visually as they drop in
      newCol.forEach((symId, row) => {
        if (symId === 'SCATTER' && track) {
          const cell = track.querySelector(`.slots-symbol[data-row="${row}"]`);
          if (cell) cell.classList.add('symbol-scatter-hit');
        }
      });
    }

    slamStop() {
      if (!this.isSpinning || this.slamStopped) return;
      this.slamStopped = true;
      this._stopAllSpinTimers();
      this._updateSpinButtonLabel();

      const res = this.pendingSpinResult;
      if (!res) {
        // Result not back from server yet; flag guarantees immediate snap on arrival
        return;
      }

      const targetGrid = Array.isArray(res.grid) && res.grid.length === 5 ? res.grid : this.currentGrid;
      for (let col = 0; col < 5; col += 1) {
        const colEl = document.getElementById(`slots-reel-${col}`);
        const track = colEl && colEl.querySelector('.slots-reel-track');
        if (track) {
          track.style.transition = 'transform 140ms ease-out';
          track.style.transform = 'translate3d(0, 0%, 0)';
        }
      }

      const tSnap = setTimeout(() => {
        this._finalizeSpinReveal(res, targetGrid);
      }, 160);
      this.revealTimers.push(tSnap);
    }

    _finalizeSpinReveal(res, targetGrid) {
      this._stopAllSpinTimers();
      this.currentGrid = targetGrid.map((c) => [...c]);

      for (let col = 0; col < 5; col += 1) {
        this._finishColumnLanding(col, this.currentGrid[col], res);
      }

      // Update authoritative bonus & floor state after spin lands
      this.freeSpins = {
        freeSpinsRemaining: res.freeSpinsRemaining || 0,
        lockedBet: (res.freeSpinsRemaining || 0) > 0 ? res.bet : null,
        totalBonusWin: res.totalBonusWin || 0,
      };

      if (Array.isArray(res.machines)) this.machines = res.machines;
      if (Array.isArray(res.recentBigWins)) this.recentBigWins = res.recentBigWins;

      this._releaseSpinPayout(res.spinId);
      this.isSpinning = false;
      this.slamStopped = false;
      this.pendingSpinResult = null;

      this._recordRollHistory(res);
      this._updateSpinButtonLabel();
      this.renderBetUI();
      this.renderCabinetTopbar();
      this._syncHeaderPhase();
      this.renderFloor();
      this.renderSpotlight();
      this.renderRollHistory();
      this.renderBigWinsFeed();

      // Celebrate wins, paylines & bonus triggers!
      this._celebrateSpinOutcome(res);
    }

    _releaseSpinPayout(spinId) {
      const entry = this.payoutReleases.find((e) => e.id === spinId && !e.released);
      if (entry) {
        entry.released = true;
        this.pendingPayoutHold = Math.max(0, this.pendingPayoutHold - entry.amount);
        if (this.ui) this.ui.updatePlayerHUD(true);
      } else if (!spinId && this.pendingPayoutHold > 0) {
        this.pendingPayoutHold = 0;
        if (this.ui) this.ui.updatePlayerHUD(true);
      }
      this.payoutReleases = this.payoutReleases.filter((e) => !e.released);
    }

    _celebrateSpinOutcome(res) {
      const hasLines = Array.isArray(res.lineWins) && res.lineWins.length > 0;
      const hasTotalWin = res.totalPayout > 0;

      if (hasLines) {
        this._highlightWinningCells(res.lineWins, res.scatterPositions || []);
        this._drawPaylineBatch(res.lineWins);
        this._cyclePaylines(res.lineWins, res.multiplier || 1);
      } else if (res.scatterCount >= 3 && Array.isArray(res.scatterPositions)) {
        this._highlightWinningCells([], res.scatterPositions);
      }

      if (res.jackpotWon > 0) {
        this._showWinBanner('GRAND JACKPOT', res.totalPayout, `5x Op Winlijn 1 (+${res.jackpotWon.toLocaleString()} Jackpot)`, 'tier-jackpot');
        this._spawnCoinFountain(140, true);
      } else if (res.freeSpinsEnded && res.finalBonusSummary) {
        const bonusTotal = res.finalBonusSummary.totalWon !== undefined
          ? res.finalBonusSummary.totalWon
          : (res.finalBonusSummary.totalBonusWin || 0);
        this._showWinBanner(
          'BONUS VOLTOOID',
          bonusTotal,
          'Gratis Spins afgerond',
          'tier-mega'
        );
        if (bonusTotal > 0) this._spawnCoinFountain(90, true);
      } else if (res.freeSpinsAwarded > 0) {
        const fsMult = this.freeSpinsMultiplier || FREE_SPINS_MULTIPLIER;
        const sub = `${res.freeSpinsAwarded} Gratis Spins @ ${fsMult}x${res.wasFreeSpin ? ' (+3 Extra!)' : ''}`;
        this._showWinBanner(res.wasFreeSpin ? 'EXTRA GRATIS SPINS' : 'BONUS GEACTIVEERD', res.totalPayout, sub, 'tier-bonus');
        this._spawnCoinFountain(65, false);
      } else if (res.winTier === 'MEGA_WIN') {
        this._showWinBanner('MEGA WIN', res.totalPayout, `${res.payoutMultiplier}x Totale Inzet`, 'tier-mega');
        this._spawnCoinFountain(110, true);
      } else if (res.winTier === 'BIG_WIN') {
        this._showWinBanner('BIG WIN', res.totalPayout, `${res.payoutMultiplier}x Totale Inzet`, 'tier-big');
        this._spawnCoinFountain(70, false);
      } else if (res.winTier === 'NICE_WIN') {
        this._showWinBanner('NICE WIN', res.totalPayout, `${res.payoutMultiplier}x Totale Inzet`, 'tier-nice');
        this._spawnCoinFountain(28, false);
      } else if (hasTotalWin) {
        this._spawnCoinFountain(14, false);
      }

      if (res.feverTriggered && this.ui) {
        const fevMult = this.goldenFeverMultiplier || GOLDEN_FEVER_MULTIPLIER;
        this.ui.showToast(`GOLDEN FEVER! 30 seconden lang ${fevMult}x winst en extra Wilds voor de hele zaal!`, 'win');
      }
    }

    renderGridInstant(grid) {
      for (let col = 0; col < 5; col += 1) {
        const colEl = document.getElementById(`slots-reel-${col}`);
        if (!colEl) continue;
        const track = colEl.querySelector('.slots-reel-track');
        if (!track) continue;
        const colSymbols = (grid && grid[col]) || FALLBACK_GRID[col];
        this._renderTrackStatic(track, colSymbols, col);
      }
    }

    _renderTrackStatic(track, colSymbols, col) {
      track.style.transition = 'none';
      track.style.height = '100%';
      track.style.transform = 'translate3d(0, 0%, 0)';
      track.innerHTML = colSymbols.map((symId, row) => {
        const meta = SYMBOL_META[symId] || SYMBOL_META['10'];
        return `<div class="slots-symbol slots-symbol-tier-${meta.tier}" data-col="${col}" data-row="${row}" data-sym="${escapeHtml(symId)}" style="height:33.3333%;">${meta.svg}<span class="slots-sym-tag">${escapeHtml(symId === 'GOLD_BARS' ? 'GOLD' : symId)}</span></div>`;
      }).join('');
    }

    _highlightWinningCells(lineWins, scatterPositions) {
      const winKeys = new Set();
      (lineWins || []).forEach((lw) => {
        const lineNum = lw.lineNumber || ((lw.lineIndex || 0) + 1);
        const positions = Array.isArray(lw.positions)
          ? lw.positions
          : ((this.paylines[lineNum - 1] || []).slice(0, lw.count || 0).map((row, col) => ({ col, row })));
        positions.forEach((pos) => winKeys.add(`${pos.col}:${pos.row}`));
      });
      (scatterPositions || []).forEach((pos) => winKeys.add(`${pos.col}:${pos.row}`));

      for (let col = 0; col < 5; col += 1) {
        const colEl = document.getElementById(`slots-reel-${col}`);
        if (!colEl) continue;
        colEl.querySelectorAll('.slots-symbol').forEach((cell) => {
          const r = cell.dataset.row;
          const key = `${col}:${r}`;
          if (winKeys.has(key)) {
            cell.classList.add('symbol-win-pulse');
            cell.classList.remove('symbol-dimmed');
          } else {
            cell.classList.add('symbol-dimmed');
          }
        });
      }
    }

    _cyclePaylines(lineWins, mult) {
      if (!lineWins || lineWins.length === 0) return;
      const getLineNum = (lw) => lw.lineNumber || ((lw.lineIndex || 0) + 1);
      const getPositions = (lw, lineNum) => (
        Array.isArray(lw.positions)
          ? lw.positions
          : (this.paylines[lineNum - 1] || []).slice(0, lw.count || 0).map((row, col) => ({ col, row }))
      );
      const updateReadout = (lw) => {
        if (!this.els.paylineReadout) return;
        const symMeta = SYMBOL_META[lw.symbol] || { name: lw.symbol };
        const lineNum = getLineNum(lw);
        const amt = lw.amount !== undefined ? lw.amount : (lw.payout || 0);
        const color = PAYLINE_COLORS[(lineNum - 1) % PAYLINE_COLORS.length];
        const mTag = mult > 1 ? ` &bull; ${mult}x` : '';
        this.els.paylineReadout.innerHTML = `<span class="payline-dot" style="background:${color};"></span>LIJN ${lineNum}: ${lw.count}x ${escapeHtml(symMeta.name.toUpperCase())} &mdash; +${Number(amt).toLocaleString()} Fiches${mTag}`;
        this.els.paylineReadout.classList.remove('hidden');
      };

      updateReadout(lineWins[0]);
      if (lineWins.length === 1) return;

      let idx = 0;
      this.paylineCycleTimer = setInterval(() => {
        idx = (idx + 1) % lineWins.length;
        const cur = lineWins[idx];
        const lineNum = getLineNum(cur);
        updateReadout(cur);
        this.activePaylineWaves = [{
          lineNumber: lineNum,
          positions: getPositions(cur, lineNum),
          color: PAYLINE_COLORS[(lineNum - 1) % PAYLINE_COLORS.length],
          alpha: 1,
          until: Date.now() + 1100,
        }];
        this._ensureFxLoop();
      }, 1250);
    }

    _drawPaylineBatch(lineWins) {
      const now = Date.now();
      this.activePaylineWaves = lineWins.map((lw) => {
        const lineNum = lw.lineNumber || ((lw.lineIndex || 0) + 1);
        const positions = Array.isArray(lw.positions)
          ? lw.positions
          : (this.paylines[lineNum - 1] || []).slice(0, lw.count || 0).map((row, col) => ({ col, row }));
        return {
          lineNumber: lineNum,
          positions,
          color: PAYLINE_COLORS[(lineNum - 1) % PAYLINE_COLORS.length],
          alpha: 1,
          until: now + 1350,
        };
      });
      this._ensureFxLoop();
    }

    _spawnCoinFountain(count, isGrand) {
      const stage = this.els.reelsStage;
      const w = (stage && stage.clientWidth) ? stage.clientWidth : 640;
      const h = (stage && stage.clientHeight) ? stage.clientHeight : 320;
      const cx = w * 0.5;
      const cy = h * 0.48;

      if (isGrand) {
        this.shockwaves.push({ x: cx, y: cy, r: 16, maxR: Math.max(w, h) * 0.65, color: '#FACC15', alpha: 0.95 });
      }

      const palette = isGrand
        ? ['#FACC15', '#FEF08A', '#10B981', '#F472B6']
        : ['#D4AF37', '#FDE047', '#34D399'];

      for (let i = 0; i < count; i += 1) {
        const angle = -Math.PI + Math.random() * Math.PI * 2;
        const speed = 130 + Math.random() * (isGrand ? 360 : 250);
        this.particles.push({
          x: cx + (Math.random() - 0.5) * (w * 0.35),
          y: cy + (Math.random() - 0.5) * (h * 0.25),
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 120,
          size: 3 + Math.random() * (isGrand ? 6 : 4),
          color: palette[i % palette.length],
          life: 0,
          maxLife: 0.75 + Math.random() * 0.85,
          spin: Math.random() * Math.PI * 2,
          spinVel: (Math.random() - 0.5) * 14,
          shape: i % 3 === 0 ? 'diamond' : 'coin',
        });
      }
      this._ensureFxLoop();
    }

    _ensureFxLoop() {
      if (this.fxRafId || typeof requestAnimationFrame !== 'function') return;
      this.lastFrameTime = performance.now ? performance.now() : Date.now();
      const step = (now) => {
        const dt = Math.min(0.05, Math.max(0.001, (now - this.lastFrameTime) / 1000));
        this.lastFrameTime = now;
        const keepGoing = this._renderFxFrame(dt);
        if (keepGoing) {
          this.fxRafId = requestAnimationFrame(step);
        } else {
          this.fxRafId = null;
        }
      };
      this.fxRafId = requestAnimationFrame(step);
    }

    _renderFxFrame(dt) {
      const canvas = this.els.fxCanvas;
      const stage = this.els.reelsStage;
      if (!canvas || !stage) return false;
      const ctx = canvas.getContext && canvas.getContext('2d');
      if (!ctx) return false;

      const w = stage.clientWidth || 640;
      const h = stage.clientHeight || 320;
      ctx.clearRect(0, 0, w, h);

      const nowMs = Date.now();
      let active = false;

      // 1. Draw Payline Lasers aligned to the 5x3 grid cells inside reels-frame
      const frame = this.els.reelsFrame;
      if (this.activePaylineWaves.length > 0 && frame) {
        const stageRect = stage.getBoundingClientRect ? stage.getBoundingClientRect() : null;
        const frameRect = frame.getBoundingClientRect ? frame.getBoundingClientRect() : null;
        const fxX = (stageRect && frameRect) ? (frameRect.left - stageRect.left) : 0;
        const fxY = (stageRect && frameRect) ? (frameRect.top - stageRect.top) : 0;
        const fw = (frameRect && frameRect.width) ? frameRect.width : w;
        const fh = (frameRect && frameRect.height) ? frameRect.height : h;
        const colW = fw / 5;
        const rowH = fh / 3;

        this.activePaylineWaves = this.activePaylineWaves.filter((wave) => wave.until > nowMs);
        this.activePaylineWaves.forEach((wave) => {
          const linePattern = this.paylines[(wave.lineNumber || 1) - 1] || [];
          if (linePattern.length !== 5) return;
          ctx.save();
          ctx.strokeStyle = wave.color;
          ctx.lineWidth = 4;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.shadowColor = wave.color;
          ctx.shadowBlur = 14;
          ctx.globalAlpha = 0.92;
          ctx.beginPath();
          for (let c = 0; c < 5; c += 1) {
            const x = fxX + c * colW + colW * 0.5;
            const y = fxY + linePattern[c] * rowH + rowH * 0.5;
            if (c === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();

          // Winning symbol node rings
          (wave.positions || []).forEach((pos) => {
            const cx = fxX + pos.col * colW + colW * 0.5;
            const cy = fxY + pos.row * rowH + rowH * 0.5;
            ctx.beginPath();
            ctx.arc(cx, cy, Math.min(colW, rowH) * 0.24, 0, Math.PI * 2);
            ctx.strokeStyle = '#FEF9C3';
            ctx.lineWidth = 2.2;
            ctx.stroke();
          });
          ctx.restore();
          active = true;
        });
      }

      // 2. Shockwaves
      this.shockwaves = this.shockwaves.filter((sw) => sw.alpha > 0.03);
      this.shockwaves.forEach((sw) => {
        sw.r += 540 * dt;
        sw.alpha *= Math.pow(0.08, dt);
        ctx.save();
        ctx.strokeStyle = sw.color;
        ctx.globalAlpha = sw.alpha;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(sw.x, sw.y, sw.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        active = true;
      });

      // 3. Coin & Diamond Particles
      this.particles = this.particles.filter((p) => p.life < p.maxLife);
      this.particles.forEach((p) => {
        p.life += dt;
        p.vy += 460 * dt; // Gravity
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.spin += p.spinVel * dt;
        const alpha = Math.max(0, 1 - p.life / p.maxLife);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        if (p.shape === 'diamond') {
          ctx.beginPath();
          ctx.moveTo(0, -p.size);
          ctx.lineTo(p.size * 0.8, 0);
          ctx.lineTo(0, p.size);
          ctx.lineTo(-p.size * 0.8, 0);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size, Math.max(1.5, Math.abs(Math.cos(p.spin)) * p.size), 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        active = true;
      });

      return active;
    }

    _clearFXOverlays() {
      this.activePaylineWaves = [];
      if (this.paylineCycleTimer) {
        clearInterval(this.paylineCycleTimer);
        this.paylineCycleTimer = null;
      }
      if (this.els.paylineReadout) this.els.paylineReadout.classList.add('hidden');
      if (this.els.winBanner) {
        this.els.winBanner.classList.add('hidden');
        this.els.winBanner.classList.remove('tier-nice', 'tier-big', 'tier-mega', 'tier-jackpot', 'tier-bonus');
      }
    }

    _showWinBanner(kicker, amount, subText, tierClass) {
      if (!this.els.winBanner) return;
      this.els.winBanner.classList.remove('hidden', 'tier-nice', 'tier-big', 'tier-mega', 'tier-jackpot', 'tier-bonus');
      this.els.winBanner.classList.add(tierClass);
      if (this.els.winKicker) this.els.winKicker.textContent = kicker;
      if (this.els.winSub) this.els.winSub.textContent = subText || '';
      if (this.els.winAmount) {
        if (amount > 0) {
          this._animateCountUp(this.els.winAmount, amount);
        } else {
          this.els.winAmount.textContent = subText || '';
        }
      }

      const hideAfter = tierClass === 'tier-jackpot' || tierClass === 'tier-mega' ? 3200 : 2100;
      const tHide = setTimeout(() => {
        if (!this.isSpinning && this.els.winBanner) {
          this.els.winBanner.classList.add('hidden');
        }
      }, hideAfter);
      this.revealTimers.push(tHide);
    }

    _animateCountUp(el, targetAmount) {
      const start = performance.now ? performance.now() : Date.now();
      const duration = Math.min(1100, Math.max(400, Math.log10(Math.max(10, targetAmount)) * 220));
      const tick = (now) => {
        const p = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        const cur = Math.round(targetAmount * eased);
        el.textContent = `+${cur.toLocaleString()} Fiches`;
        if (p < 1 && typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(tick);
        } else {
          el.textContent = `+${targetAmount.toLocaleString()} Fiches`;
        }
      };
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(tick);
      } else {
        el.textContent = `+${targetAmount.toLocaleString()} Fiches`;
      }
    }

    _renderJackpot() {
      if (!this.els.jackpotAmount) return;
      this.els.jackpotAmount.textContent = `${Math.floor(this.jackpotPool).toLocaleString()} Fiches`;
      if (this.els.jackpotPill) {
        this.els.jackpotPill.classList.remove('jackpot-pulse');
        void this.els.jackpotPill.offsetWidth;
        this.els.jackpotPill.classList.add('jackpot-pulse');
      }
    }

    onGoldenFeverEvent(fever) {
      if (!fever || typeof fever !== 'object') return;
      this.goldenFever = { ...this.goldenFever, ...fever };
      this._updateFeverUI();
      this.renderCabinetTopbar();
    }

    _startFeverTicker() {
      if (this.feverTickerTimer) clearInterval(this.feverTickerTimer);
      this.feverTickerTimer = setInterval(() => {
        if (this.goldenFever && this.goldenFever.active) {
          this._updateFeverUI();
        }
      }, 250);
      if (this.feverTickerTimer && typeof this.feverTickerTimer.unref === 'function') {
        this.feverTickerTimer.unref();
      }
    }

    _updateFeverUI() {
      const fever = this.goldenFever || {};
      const now = Date.now();
      const isActive = !!(fever.active && fever.endsAt > now);
      if (fever.active && fever.endsAt > 0 && fever.endsAt <= now) {
        this.goldenFever.active = false;
        this.goldenFever.progress = 0;
      }

      if (this.els.view) {
        this.els.view.classList.toggle('slots-golden-fever-active', isActive);
      }
      if (this.els.feverBox) {
        this.els.feverBox.classList.toggle('fever-live', isActive);
      }
      if (this.els.feverFill && this.els.feverLabel) {
        if (isActive) {
          const leftMs = Math.max(0, fever.endsAt - now);
          const pct = Math.max(0, Math.min(100, (leftMs / (fever.durationMs || 30000)) * 100));
          const secs = Math.ceil(leftMs / 1000);
          const fevMult = Number(fever.multiplier) || this.goldenFeverMultiplier || GOLDEN_FEVER_MULTIPLIER;
          this.els.feverFill.style.width = `${pct.toFixed(1)}%`;
          this.els.feverLabel.textContent = `${fevMult}x ACTIEF (${secs}s)`;
        } else {
          const pct = Math.max(0, Math.min(100, Number(fever.progress) || 0));
          this.els.feverFill.style.width = `${pct.toFixed(1)}%`;
          this.els.feverLabel.textContent = `${Math.round(pct)}%`;
        }
      }
      this._syncHeaderPhase();
    }

    renderCabinetTopbar() {
      const myMachine = this.machines.find((m) => m.machineId === (this.myMachineId || 1));
      if (this.els.activeCabBadge) {
        const name = myMachine ? myMachine.name.toUpperCase() : `SOVEREIGN 0${this.myMachineId || 1}`;
        this.els.activeCabBadge.textContent = `KAST #${this.myMachineId || 1} \u2022 ${name}`;
      }

      const fsBaseMult = this.freeSpinsMultiplier || FREE_SPINS_MULTIPLIER;
      const feverBaseMult = (this.goldenFever && Number(this.goldenFever.multiplier) > 1)
        ? Number(this.goldenFever.multiplier)
        : (this.goldenFeverMultiplier || GOLDEN_FEVER_MULTIPLIER);
      const fsMult = this.freeSpins.freeSpinsRemaining > 0 ? fsBaseMult : 1;
      const feverMult = (this.goldenFever.active && this.goldenFever.endsAt > Date.now()) ? feverBaseMult : 1;
      const combinedMult = Math.round(fsMult * feverMult * 100) / 100;

      if (this.els.effectiveMultPill) {
        if (fsMult > 1 && feverMult > 1) {
          this.els.effectiveMultPill.textContent = `${combinedMult}x ULTRA MULTIPLIER (${fsMult}x FS + ${feverMult}x FEVER)`;
        } else if (feverMult > 1) {
          this.els.effectiveMultPill.textContent = `${feverMult}x GOLDEN FEVER ACTIEF`;
        } else if (fsMult > 1) {
          this.els.effectiveMultPill.textContent = `${fsMult}x GRATIS SPINS MULTIPLIER`;
        } else {
          this.els.effectiveMultPill.textContent = '1x LIJN MULTIPLIER';
        }
        this.els.effectiveMultPill.classList.toggle('mult-boosted', combinedMult > 1);
      }

      if (this.els.fsBanner) {
        const hasFs = this.freeSpins.freeSpinsRemaining > 0;
        this.els.fsBanner.classList.toggle('hidden', !hasFs);
        if (hasFs) {
          if (this.els.fsCountLabel) {
            this.els.fsCountLabel.textContent = `GRATIS SPINS: ${this.freeSpins.freeSpinsRemaining}`;
          }
          if (this.els.fsTotalLabel) {
            this.els.fsTotalLabel.textContent = `Bonus: ${(this.freeSpins.totalBonusWin || 0).toLocaleString()} F`;
          }
        }
      }
    }

    renderFloor() {
      const strip = this.els.floorStrip;
      if (!strip) return;
      const list = (Array.isArray(this.machines) && this.machines.length > 0)
        ? this.machines
        : Array.from({ length: 8 }, (_, idx) => ({
            machineId: idx + 1,
            name: `Kast ${idx + 1}`,
            occupiedBy: null,
            status: 'IDLE',
            lastMultiplier: 0,
            winStreak: 0,
            cheersReceived: 0,
          }));

      const myId = this.ui && this.ui.myPlayer ? this.ui.myPlayer.id : null;
      const occupiedCount = list.filter((m) => !!m.occupiedBy).length;
      if (this.els.floorCount) {
        this.els.floorCount.textContent = `${occupiedCount}/8 bezet`;
      }

      strip.innerHTML = list.map((m) => {
        const occ = m.occupiedBy;
        const isMine = occ && occ.playerId === myId;
        const isFocused = m.machineId === this.spotlightMachineId;
        const badgeCls = m.status === 'FREE_SPINS' ? 'is-fs' : (m.winStreak >= 2 ? 'is-hot' : (occ ? 'is-occupied' : 'is-open'));
        const statusText = occ
          ? (m.status === 'FREE_SPINS'
              ? 'FREE SPINS'
              : (m.winStreak >= 2 ? `${m.winStreak}x STREAK` : (m.lastMultiplier >= 2 ? `${m.lastMultiplier}x` : 'SPEELT')))
          : 'VRIJ';

        const cheerBtn = occ
          ? `<button type="button" class="slots-card-cheer-btn" data-machine-id="${m.machineId}" title="Moedig aan (+2.5% Golden Fever)">+HYPE</button>`
          : '';

        return `
          <div class="slots-floor-card ${badgeCls}${isMine ? ' is-mine' : ''}${isFocused ? ' is-spotlight' : ''}" data-machine-id="${m.machineId}" role="listitem">
            <div class="slots-card-top">
              <span class="slots-card-num">#${m.machineId}</span>
              <span class="slots-card-status">${escapeHtml(statusText)}</span>
            </div>
            <div class="slots-card-player">
              ${occ
                ? `<span class="slots-card-dot" style="background:${escapeHtml(occ.playerColor || '#D4AF37')};">${escapeHtml(occ.monogram || '?')}</span><span class="slots-card-name">${escapeHtml(occ.playerName)}${isMine ? ' (Jij)' : ''}</span>`
                : `<span class="slots-card-open-lbl">Kies Kast</span>`}
            </div>
            <div class="slots-card-foot">
              <span class="slots-card-cheers">${m.cheersReceived > 0 ? `${m.cheersReceived} hype` : escapeHtml(m.name)}</span>
              ${cheerBtn}
            </div>
          </div>
        `;
      }).join('');
    }

    renderSpotlight() {
      const targetId = this.spotlightMachineId || this.myMachineId || 1;
      const m = this.machines.find((item) => item.machineId === targetId);
      const myId = this.ui && this.ui.myPlayer ? this.ui.myPlayer.id : null;
      const occ = m && m.occupiedBy;
      const isMine = occ && occ.playerId === myId;

      if (this.els.spotlightTitle) {
        this.els.spotlightTitle.textContent = occ && !isMine
          ? `KIJK-MODUS \u2022 KAST #${targetId}`
          : `JOUW KAST #${targetId}`;
      }
      if (this.els.btnBackMine) {
        const showBack = !!(occ && !isMine && this.myMachineId);
        this.els.btnBackMine.classList.toggle('hidden', !showBack);
      }

      if (this.els.spotlightPlayer) {
        if (occ) {
          this.els.spotlightPlayer.innerHTML = `
            <span class="slots-spot-avatar" style="background:${escapeHtml(occ.playerColor || '#D4AF37')};">${escapeHtml(occ.monogram || '?')}</span>
            <div class="slots-spot-meta">
              <strong>${escapeHtml(occ.playerName)}${isMine ? ' (Jij)' : ''}</strong>
              <span>${m.status === 'FREE_SPINS' ? 'Bezig met Gratis Spins (3x)' : `Streak: ${m.winStreak} \u2022 Spins: ${m.totalSpins}`}</span>
            </div>
          `;
        } else {
          this.els.spotlightPlayer.innerHTML = `<span class="slots-spot-empty">Kast #${targetId} wacht op een speler.</span>`;
        }
      }

      if (this.els.spectateMiniGrid) {
        const grid = (m && Array.isArray(m.lastGrid) && m.lastGrid.length === 5)
          ? m.lastGrid
          : FALLBACK_GRID;
        let html = '';
        for (let row = 0; row < 3; row += 1) {
          for (let col = 0; col < 5; col += 1) {
            const sym = grid[col][row] || '10';
            const meta = SYMBOL_META[sym] || SYMBOL_META['10'];
            html += `<div class="slots-mini-cell" style="border-color:${meta.accent}55;" title="${escapeHtml(sym)}">${escapeHtml(sym === 'GOLD_BARS' ? 'BAR' : (sym === 'EMERALD' ? 'EM' : (sym === 'DIAMOND' ? 'DIA' : (sym === 'CREST' ? 'CR' : (sym === 'SCATTER' ? 'SC' : (sym === 'WILD' ? 'W' : sym))))))}</div>`;
          }
        }
        this.els.spectateMiniGrid.innerHTML = html;
      }

      if (this.els.spotlightStats) {
        if (m) {
          const lastW = m.lastWin ? `${m.lastWin.toLocaleString()} F (${m.lastMultiplier}x)` : 'Nog geen winst';
          this.els.spotlightStats.textContent = `Laatste: ${lastW} \u2022 ${m.cheersReceived || 0} cheers`;
        } else {
          this.els.spotlightStats.textContent = '';
        }
      }

      if (this.els.btnCheerSpotlight) {
        this.els.btnCheerSpotlight.disabled = !occ;
      }
    }

    onCheerEvent(evt) {
      if (!evt || !evt.machineId) return;
      if (Array.isArray(evt.machines)) this.machines = evt.machines;
      if (evt.goldenFever) {
        this.goldenFever = { ...this.goldenFever, ...evt.goldenFever };
        this._updateFeverUI();
      }
      this.renderFloor();
      this.renderSpotlight();

      // Floating +2.5% HYPE pill on the cheered cabinet card
      if (this.els.floorStrip) {
        const card = this.els.floorStrip.querySelector(`.slots-floor-card[data-machine-id="${evt.machineId}"]`);
        if (card) {
          const floater = document.createElement('span');
          floater.className = 'slots-cheer-floater';
          floater.textContent = '+2.5% HYPE';
          card.appendChild(floater);
          setTimeout(() => {
            if (floater.parentNode) floater.parentNode.removeChild(floater);
          }, 1200);
        }
      }

      const myId = this.ui && this.ui.myPlayer ? this.ui.myPlayer.id : null;
      if (myId && evt.targetPlayerId === myId && evt.fromPlayerId !== myId && this.ui) {
        this.ui.showToast(`${evt.fromPlayerName} moedigt jouw gokkast aan (+2.5% Golden Fever)!`, 'info');
      }
    }

    switchSideFeedTab(tab) {
      const next = tab === 'floor' ? 'floor' : 'rolls';
      this.activeSideFeedTab = next;
      if (this.els.btnTabRolls) {
        const active = next === 'rolls';
        this.els.btnTabRolls.classList.toggle('active', active);
        this.els.btnTabRolls.setAttribute('aria-selected', String(active));
      }
      if (this.els.btnTabFloor) {
        const active = next === 'floor';
        this.els.btnTabFloor.classList.toggle('active', active);
        this.els.btnTabFloor.setAttribute('aria-selected', String(active));
      }
      if (this.els.rollHistoryList) {
        this.els.rollHistoryList.classList.toggle('hidden', next !== 'rolls');
      }
      if (this.els.bigWinsList) {
        this.els.bigWinsList.classList.toggle('hidden', next !== 'floor');
      }
    }

    _recordRollHistory(res) {
      if (!res || typeof res !== 'object') return;
      if (res.spinId && this.myRollHistory.some((r) => r.spinId === res.spinId)) return;

      this.rollSeqCounter += 1;
      const wager = typeof res.wager === 'number'
        ? res.wager
        : (res.wasFreeSpin ? 0 : Number(res.bet || 0));
      const payout = Number(res.totalPayout || 0);
      const net = payout - wager;
      const mult = typeof res.payoutMultiplier === 'number'
        ? res.payoutMultiplier
        : (res.bet > 0 ? Math.round((payout / res.bet) * 100) / 100 : 0);

      let typeTag = 'SPIN';
      if (res.jackpotWon > 0) typeTag = 'JACKPOT';
      else if (res.isBonusBuy) typeTag = 'BONUS';
      else if (res.wasFreeSpin) typeTag = 'FREE';

      this.myRollHistory = [{
        spinId: res.spinId || `roll_${this.rollSeqCounter}`,
        spinNum: this.rollSeqCounter,
        wager,
        bet: Number(res.bet || wager || 0),
        payout,
        net,
        mult,
        wasFreeSpin: Boolean(res.wasFreeSpin),
        isBonusBuy: Boolean(res.isBonusBuy),
        jackpotWon: Number(res.jackpotWon || 0),
        winTier: res.winTier || 'NONE',
        typeTag,
      }, ...this.myRollHistory].slice(0, 30);
    }

    renderRollHistory() {
      if (this.els.rollSummary) {
        if (this.myRollHistory.length === 0) {
          this.els.rollSummary.textContent = '0 rolls';
        } else {
          const sessionNet = this.myRollHistory.reduce((acc, r) => acc + r.net, 0);
          const sign = sessionNet > 0 ? '+' : '';
          this.els.rollSummary.textContent = `${this.rollSeqCounter} rolls | ${sign}${sessionNet.toLocaleString()}`;
          this.els.rollSummary.className = `slots-roll-summary ${sessionNet > 0 ? 'net-pos' : (sessionNet < 0 ? 'net-neg' : '')}`;
        }
      }

      const list = this.els.rollHistoryList;
      if (!list) return;
      if (this.myRollHistory.length === 0) {
        list.innerHTML = '<div class="slots-feed-empty">Draai de rollen om je winst per roll te zien.</div>';
        return;
      }

      list.innerHTML = this.myRollHistory.map((r) => {
        const rowCls = r.jackpotWon > 0
          ? 'roll-jackpot'
          : (r.net > 0 ? 'roll-win' : (r.net < 0 ? 'roll-loss' : 'roll-even'));
        const betLabel = r.wasFreeSpin ? 'Gratis' : `${r.wager.toLocaleString()}`;
        const payoutLabel = r.payout > 0 ? `+${r.payout.toLocaleString()}` : '0';
        const netSign = r.net > 0 ? '+' : '';
        const netCls = r.net > 0 ? 'net-pos' : (r.net < 0 ? 'net-neg' : 'net-even');
        return `
          <div class="slots-roll-item ${rowCls}">
            <div class="slots-roll-left">
              <span class="slots-roll-num">#${r.spinNum}</span>
              <span class="slots-roll-tag tag-${escapeHtml(r.typeTag.toLowerCase())}">${escapeHtml(r.typeTag)}</span>
              <span class="slots-roll-bet">In: ${escapeHtml(betLabel)}</span>
            </div>
            <div class="slots-roll-right">
              <span class="slots-roll-payout">${escapeHtml(payoutLabel)}${r.mult > 0 ? ` (${r.mult}x)` : ''}</span>
              <span class="slots-roll-net ${netCls}">${netSign}${r.net.toLocaleString()}</span>
            </div>
          </div>
        `;
      }).join('');
    }

    onBigWinEvent(entry) {
      if (!entry) return;
      this.recentBigWins = [entry, ...this.recentBigWins.filter((e) => e.id !== entry.id)].slice(0, 20);
      this.renderBigWinsFeed();
    }

    renderBigWinsFeed() {
      const list = this.els.bigWinsList;
      if (!list) return;
      if (!Array.isArray(this.recentBigWins) || this.recentBigWins.length === 0) {
        list.innerHTML = '<div class="slots-feed-empty">Nog geen grote winsten in deze sessie.</div>';
        return;
      }
      list.innerHTML = this.recentBigWins.slice(0, 8).map((w) => {
        const cls = w.jackpotWon > 0 ? 'feed-jackpot' : (w.winTier === 'MEGA_WIN' ? 'feed-mega' : 'feed-big');
        const label = w.jackpotWon > 0 ? 'JACKPOT' : `${w.multiplier}x`;
        return `
          <div class="slots-feed-item ${cls}">
            <div class="slots-feed-left">
              <span class="slots-feed-dot" style="background:${escapeHtml(w.playerColor || '#D4AF37')};"></span>
              <span class="slots-feed-name">${escapeHtml(w.playerName)}</span>
              <span class="slots-feed-cab">K#${w.machineId}</span>
            </div>
            <div class="slots-feed-right">
              <span class="slots-feed-mult">${escapeHtml(label)}</span>
              <span class="slots-feed-amt">+${Number(w.winAmount || 0).toLocaleString()}</span>
            </div>
          </div>
        `;
      }).join('');
    }

    openPaytable() {
      this.renderPaytableContent();
      if (this.els.paytableOverlay) {
        this.els.paytableOverlay.classList.remove('hidden');
      }
    }

    closePaytable() {
      if (this.els.paytableOverlay) {
        this.els.paytableOverlay.classList.add('hidden');
      }
    }

    renderPaytableContent() {
      const body = this.els.paytableBody;
      if (!body || !this.paytable) return;

      const symCards = SYMBOL_ORDER.filter((sym) => sym !== 'SCATTER').map((sym) => {
        const meta = SYMBOL_META[sym] || SYMBOL_META['10'];
        const payouts = this.paytable[sym] || {};
        const rows = Object.keys(payouts)
          .sort((a, b) => Number(b) - Number(a))
          .map((count) => `<span><strong>${count}x:</strong> ${payouts[count]}x lijn</span>`)
          .join('');
        return `
          <div class="slots-pt-card">
            <div class="slots-pt-icon">${meta.svg}</div>
            <div class="slots-pt-info">
              <strong>${escapeHtml(meta.name)}</strong>
              <div class="slots-pt-rates">${rows}</div>
            </div>
          </div>
        `;
      }).join('');

      const lineDiagrams = (this.paylines || FALLBACK_PAYLINES).map((pattern, idx) => {
        let cells = '';
        for (let r = 0; r < 3; r += 1) {
          for (let c = 0; c < 5; c += 1) {
            const on = pattern[c] === r;
            const color = PAYLINE_COLORS[idx % PAYLINE_COLORS.length];
            cells += `<span class="pt-line-dot${on ? ' on' : ''}"${on ? ` style="background:${color};"` : ''}></span>`;
          }
        }
        return `<div class="slots-pt-line-box"><span class="pt-line-num">${idx + 1}</span><div class="pt-line-mini">${cells}</div></div>`;
      }).join('');

      body.innerHTML = `
        <div class="slots-pt-rules">
          <div class="slots-pt-rule-pill"><strong>Scatter Bonus:</strong> 3/4/5 Scatters geven 10/15/20 Gratis Spins @ ${this.freeSpinsMultiplier || FREE_SPINS_MULTIPLIER}x Winst (max +3 extra bij retrigger).</div>
          <div class="slots-pt-rule-pill"><strong>Grand Jackpot:</strong> 5x Paleis Kroon (of Wild) op Winlijn 1 wint de volledige Progressieve Jackpot!</div>
          <div class="slots-pt-rule-pill"><strong>Golden Fever:</strong> Bij 100% vloer-energie 30s lang ${this.goldenFeverMultiplier || GOLDEN_FEVER_MULTIPLIER}x multiplier (tot ${Math.round((this.freeSpinsMultiplier || FREE_SPINS_MULTIPLIER) * (this.goldenFeverMultiplier || GOLDEN_FEVER_MULTIPLIER) * 100) / 100}x in Free Spins) + extra Wild!</div>
        </div>
        <h4 class="slots-pt-section-title">SYMBOOL UITBETALINGEN</h4>
        <div class="slots-pt-grid">${symCards}</div>
        <h4 class="slots-pt-section-title">20 VASTE WINLIJNEN</h4>
        <div class="slots-pt-lines-grid">${lineDiagrams}</div>
      `;
    }

    _handleKeydown(e) {
      if (!this.viewActive || e.repeat) return;
      if (e.code !== 'Space') return;
      const activeTag = document.activeElement && document.activeElement.tagName
        ? document.activeElement.tagName.toUpperCase()
        : '';
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(activeTag)) return;
      if (this.els.paytableOverlay && !this.els.paytableOverlay.classList.contains('hidden')) return;
      e.preventDefault();
      this.handlePrimarySpinButton();
    }
  }

  return CasinoSlots;
}));
