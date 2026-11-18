/**
 * avia.js
 * High-FPS Zero-Lag Canvas Engine for AviaMasters:
 * Offscreen sprite & backdrop caching, zero per-frame gradient allocations,
 * batched contrails, throttled DOM HUD updates, genuine 2D Newtonian physics.
 * Zero audio APIs, zero Unicode emojis, zero GTA branding.
 */

(function (global) {
  'use strict';

  function formatFiches(val) {
    const n = Math.round(Number(val) || 0);
    return n.toLocaleString('nl-NL');
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function catmullRom(v0, v1, v2, v3, u) {
    const u2 = u * u;
    const u3 = u2 * u;
    return 0.5 * (
      (2 * v1) +
      (-v0 + v2) * u +
      (2 * v0 - 5 * v1 + 4 * v2 - v3) * u2 +
      (-v0 + 3 * v1 - 3 * v2 + v3) * u3
    );
  }

  class CasinoAvia {
    /**
     * @param {Object} params
     * @param {Object} params.network
     * @param {Object} params.ui
     */
    constructor({ network, ui }) {
      this.network = network;
      this.ui = ui;

      this.minBet = 10;
      this.maxBet = 50000;
      this.betAmount = 100;
      this.speed = '1x';

      this.isActiveView = false;
      this.isFlightPending = false;
      this.isFlightAnimating = false;
      this.activeFlight = null;
      this.flightElapsedMs = 0;
      this.flightDurationMs = 5000;
      this.triggeredEvents = new Set();
      this.triggeredTouchGos = new Set();
      this.waterImpactTriggered = false;
      this.deckTouchdownTriggered = false;
      this.prevPlaneY = 18;
      this.smoothedPitchDeg = 0;
      this.currentLiveChips = 100;
      this.currentLiveMult = 1.0;
      this.currentLiveChipLabel = '100 F';
      this.counterTone = 'neutral';
      this.counterPopTimer = 0;
      this.comboCount = 0;
      this.chainItems = [];

      this.pendingFinalChips = null;
      this.pendingStats = null;

      this.recentFlights = [];
      this.sessionFlights = 0;
      this.sessionNet = 0;
      this.lastWin = 0;

      // Visual & render cache state
      this.canvas = null;
      this.ctx = null;
      this.viewW = 0;
      this.viewH = 0;
      this.dpr = 1;
      this.rafId = null;
      this.lastFrameTime = 0;
      this.idlePhase = 0;
      this.resultTimeout = null;

      // Offscreen GPU-friendly caches (eliminates per-frame shader/gradient stalls)
      this._bgCache = null;
      this._cloudSprite = null;
      this._itemSprites = new Map();
      this._seaGrad = null;
      this._frontGrad = null;
      this._hullGrad = null;
      this._hudAccum = 0;
      this._lastHud = { alt: '', spd: '', combo: '', dist: '', ship: '' };

      // Camera & FX pools
      this.camX = 0;
      this.camZoom = 1.0;
      this.shakeTime = 0;
      this.shakeMag = 0;
      this.afterburnerTime = 0;
      this.rocketSmokeTime = 0;
      this.vignetteFlash = null;
      this.trail = [];
      this.particles = [];
      this.bubbles = [];
      this.shockwaves = [];
      this.floatingTexts = [];
      this.clouds = [];

      this.idleCarriers = [
        { index: 0, role: 'departure', name: 'USS RIVIERA', deckStart: -45, deckEnd: 225 },
        { index: 1, role: 'horizon', name: 'PORT HERCULE', deckStart: 560, deckEnd: 780 },
        { index: 2, role: 'horizon', name: 'MONTE CARLO BAY', deckStart: 1180, deckEnd: 1400 },
        { index: 3, role: 'horizon', name: 'GRAND HORIZON', deckStart: 1820, deckEnd: 2040 },
        { index: 4, role: 'horizon', name: 'SOVEREIGN ISLE', deckStart: 2460, deckEnd: 2680 }
      ];

      this.elements = {};
    }

    init() {
      this.cacheElements();
      this._initBackdropAssets();
      this._prebuildSprites();
      this.bindEvents();
      this.bindNetworkEvents();
      this.updateControlsUI();
      this.updateHistoryUI();
    }

    cacheElements() {
      this.elements = {
        view: document.getElementById('avia-view'),
        stage: document.getElementById('avia-stage'),
        canvas: document.getElementById('avia-canvas'),
        historyStrip: document.getElementById('avia-history-strip'),
        lastWin: document.getElementById('avia-last-win'),
        sessionNet: document.getElementById('avia-session-net'),
        hudAlt: document.getElementById('avia-hud-alt'),
        hudSpd: document.getElementById('avia-hud-spd'),
        hudCombo: document.getElementById('avia-hud-combo'),
        hudDist: document.getElementById('avia-hud-dist'),
        hudShip: document.getElementById('avia-hud-ship'),
        liveCounterBox: document.getElementById('avia-live-counter-box'),
        liveCounter: document.getElementById('avia-live-counter'),
        liveMult: document.getElementById('avia-live-mult'),
        comboBadge: document.getElementById('avia-combo-badge'),
        chainBar: document.getElementById('avia-chain-bar'),
        resultBanner: document.getElementById('avia-result-banner'),
        resultKicker: document.getElementById('avia-result-kicker'),
        resultMult: document.getElementById('avia-result-mult'),
        resultPayout: document.getElementById('avia-result-payout'),
        betInput: document.getElementById('avia-bet-input'),
        btnHalf: document.getElementById('btn-avia-half'),
        btnDouble: document.getElementById('btn-avia-double'),
        btnMax: document.getElementById('btn-avia-max'),
        quickChips: document.querySelectorAll('#avia-view .btn-avia-chip'),
        speedBtns: document.querySelectorAll('#avia-view .btn-avia-speed'),
        btnFly: document.getElementById('btn-avia-fly'),
        btnFlyLabel: document.getElementById('avia-fly-btn-label'),
        btnFlySub: document.getElementById('avia-fly-btn-sub')
      };

      this.canvas = this.elements.canvas;
      if (this.canvas) {
        this.ctx = this.canvas.getContext('2d', { alpha: false });
      }
    }

    _initBackdropAssets() {
      this.clouds = [];
      for (let i = 0; i < 20; i += 1) {
        this.clouds.push({
          x: i * 240 + ((i * 53) % 90),
          yAlt: 55 + ((i * 39) % 195),
          scale: 0.65 + ((i * 19) % 58) / 100,
          depth: 0.28 + ((i * 13) % 45) / 100
        });
      }
    }

    _prebuildSprites() {
      if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;

      // 1. Pre-render Cloud Sprite (170x90)
      const cc = document.createElement('canvas');
      cc.width = 170;
      cc.height = 90;
      const cctx = cc.getContext('2d');
      cctx.fillStyle = 'rgba(226, 232, 240, 0.11)';
      cctx.beginPath();
      cctx.arc(62, 48, 28, 0, Math.PI * 2);
      cctx.arc(88, 39, 24, 0, Math.PI * 2);
      cctx.arc(118, 48, 26, 0, Math.PI * 2);
      cctx.arc(38, 53, 19, 0, Math.PI * 2);
      cctx.fill();
      this._cloudSprite = cc;

      // 2. Pre-render Sky Collectibles & Rockets once into GPU textures
      const defs = [
        { key: 'add:+1', kind: 'add', label: '+1' },
        { key: 'add:+2', kind: 'add', label: '+2' },
        { key: 'add:+5', kind: 'add', label: '+5' },
        { key: 'add:+10', kind: 'add', label: '+10' },
        { key: 'mult:x2', kind: 'mult', label: 'x2' },
        { key: 'mult:x3', kind: 'mult', label: 'x3' },
        { key: 'mult:x4', kind: 'mult', label: 'x4' },
        { key: 'mult:x5', kind: 'mult', label: 'x5' },
        { key: 'rocket:-50%', kind: 'rocket', label: '-50%' }
      ];
      for (let i = 0; i < defs.length; i += 1) {
        const d = defs[i];
        this._itemSprites.set(d.key, this._buildItemSpriteCanvas(d.kind, d.label));
      }
    }

    _buildItemSpriteCanvas(kind, label) {
      const size = 96;
      const half = size / 2;
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d');
      ctx.translate(half, half);

      if (kind === 'rocket') {
        ctx.save();
        ctx.rotate(-0.18);
        const rGlow = ctx.createRadialGradient(0, 0, 4, 0, 0, 34);
        rGlow.addColorStop(0, 'rgba(239, 68, 68, 0.55)');
        rGlow.addColorStop(1, 'rgba(239, 68, 68, 0)');
        ctx.fillStyle = rGlow;
        ctx.beginPath();
        ctx.arc(0, 0, 34, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(249, 115, 22, 0.92)';
        ctx.beginPath();
        ctx.moveTo(16, -4);
        ctx.lineTo(35, 0);
        ctx.lineTo(16, 4);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#991b1b';
        ctx.beginPath();
        ctx.moveTo(10, -5);
        ctx.lineTo(17, -11);
        ctx.lineTo(17, -5);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(10, 5);
        ctx.lineTo(17, 11);
        ctx.lineTo(17, 5);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.roundRect(-16, -6.5, 33, 13, 5);
        ctx.fill();
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(-5, -6.5, 6, 13);
        ctx.strokeStyle = '#fecaca';
        ctx.lineWidth = 1.4;
        ctx.stroke();

        ctx.fillStyle = '#f8fafc';
        ctx.beginPath();
        ctx.moveTo(-16, -6.5);
        ctx.lineTo(-26, 0);
        ctx.lineTo(-16, 6.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        ctx.font = '900 12px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fecaca';
        ctx.fillText(label, 0, -18);
      } else if (kind === 'mult') {
        const glow = ctx.createRadialGradient(0, 0, 5, 0, 0, 38);
        glow.addColorStop(0, 'rgba(250, 204, 21, 0.72)');
        glow.addColorStop(1, 'rgba(250, 204, 21, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, 0, 38, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(254, 240, 138, 0.72)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.arc(0, 0, 22, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        const coreGrad = ctx.createLinearGradient(-14, -14, 14, 14);
        coreGrad.addColorStop(0, '#422006');
        coreGrad.addColorStop(1, '#18181b');
        ctx.fillStyle = coreGrad;
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 2.8;
        ctx.beginPath();
        ctx.arc(0, 0, 17, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.font = '900 13.5px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fef08a';
        ctx.fillText(label, 0, 1);
      } else {
        const glow = ctx.createRadialGradient(0, 0, 4, 0, 0, 32);
        glow.addColorStop(0, 'rgba(16, 185, 129, 0.62)');
        glow.addColorStop(1, 'rgba(16, 185, 129, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, 0, 32, 0, Math.PI * 2);
        ctx.fill();

        const orbGrad = ctx.createRadialGradient(-4, -5, 2, 0, 0, 16);
        orbGrad.addColorStop(0, '#10b981');
        orbGrad.addColorStop(1, '#064e3b');
        ctx.fillStyle = orbGrad;
        ctx.strokeStyle = '#6ee7b7';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(0, 0, 15.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.font = '900 12.5px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ecfdf5';
        ctx.fillText(label, 0, 1);
      }

      return c;
    }

    _rebuildBackdropCache(width, height) {
      if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;
      const seaY = height * 0.77;

      const bg = document.createElement('canvas');
      bg.width = width;
      bg.height = Math.ceil(seaY + 8);
      const bctx = bg.getContext('2d', { alpha: false });

      const skyGrad = bctx.createLinearGradient(0, 0, 0, seaY);
      skyGrad.addColorStop(0, '#050918');
      skyGrad.addColorStop(0.5, '#0f2447');
      skyGrad.addColorStop(0.84, '#1b3b66');
      skyGrad.addColorStop(1, '#314459');
      bctx.fillStyle = skyGrad;
      bctx.fillRect(0, 0, width, bg.height);

      const horizonGlow = bctx.createRadialGradient(width * 0.48, seaY + 10, 8, width * 0.48, seaY + 10, width * 0.72);
      horizonGlow.addColorStop(0, 'rgba(245, 158, 11, 0.25)');
      horizonGlow.addColorStop(0.45, 'rgba(212, 175, 55, 0.11)');
      horizonGlow.addColorStop(1, 'rgba(7, 17, 38, 0)');
      bctx.fillStyle = horizonGlow;
      bctx.fillRect(0, 0, width, seaY + 8);

      // Bake starfield directly into static sky backdrop
      for (let i = 0; i < 60; i += 1) {
        const nx = ((i * 73 + 17) % 1000) / 1000;
        const ny = ((i * 139 + 29) % 580) / 1000;
        const r = 0.65 + ((i * 11) % 15) / 10;
        const alpha = 0.25 + ((i * 17) % 55) / 100;
        bctx.fillStyle = `rgba(248, 250, 252, ${alpha.toFixed(2)})`;
        bctx.beginPath();
        bctx.arc(nx * width, ny * seaY, r, 0, Math.PI * 2);
        bctx.fill();
      }
      this._bgCache = bg;

      // Pre-build ocean & ship gradients for zero per-frame allocation
      if (this.ctx) {
        const seaGrad = this.ctx.createLinearGradient(0, seaY - 6, 0, height);
        seaGrad.addColorStop(0, '#0284c7');
        seaGrad.addColorStop(0.28, '#0c4a6e');
        seaGrad.addColorStop(1, '#030712');
        this._seaGrad = seaGrad;

        const frontGrad = this.ctx.createLinearGradient(0, seaY + 2, 0, height);
        frontGrad.addColorStop(0, 'rgba(14, 116, 144, 0.56)');
        frontGrad.addColorStop(0.42, 'rgba(15, 23, 42, 0.86)');
        frontGrad.addColorStop(1, 'rgba(3, 7, 18, 0.98)');
        this._frontGrad = frontGrad;

        const hullGrad = this.ctx.createLinearGradient(0, seaY - 26, 0, seaY + 6);
        hullGrad.addColorStop(0, '#475569');
        hullGrad.addColorStop(0.55, '#1e293b');
        hullGrad.addColorStop(1, '#0f172a');
        this._hullGrad = hullGrad;
      }
    }

    bindEvents() {
      if (this.elements.speedBtns) {
        this.elements.speedBtns.forEach((btn) => {
          btn.addEventListener('click', () => {
            const sp = (btn.dataset.speed || '1x').toLowerCase();
            if (['1x', '2x', '4x'].includes(sp)) {
              this.speed = sp;
              this.elements.speedBtns.forEach((b) => {
                b.classList.toggle('active', (b.dataset.speed || '').toLowerCase() === sp);
              });
            }
          });
        });
      }

      if (this.elements.betInput) {
        this.elements.betInput.addEventListener('input', () => {
          const val = parseInt(this.elements.betInput.value, 10);
          if (!Number.isNaN(val)) {
            this.betAmount = clamp(val, this.minBet, this.maxBet);
            this.updateFlyButtonText();
          }
        });
        this.elements.betInput.addEventListener('change', () => {
          const val = parseInt(this.elements.betInput.value, 10);
          this.setBetAmount(Number.isNaN(val) ? this.minBet : val);
        });
      }

      if (this.elements.btnHalf) {
        this.elements.btnHalf.addEventListener('click', () => {
          if (this.isFlightAnimating || this.isFlightPending) return;
          this.setBetAmount(Math.max(this.minBet, Math.floor(this.betAmount / 2)));
        });
      }

      if (this.elements.btnDouble) {
        this.elements.btnDouble.addEventListener('click', () => {
          if (this.isFlightAnimating || this.isFlightPending) return;
          const playerChips = this.ui && this.ui.myPlayer ? (this.ui.myPlayer.chips || 0) : this.maxBet;
          const cap = Math.min(this.maxBet, Math.max(this.minBet, playerChips));
          this.setBetAmount(Math.min(cap, this.betAmount * 2));
        });
      }

      if (this.elements.btnMax) {
        this.elements.btnMax.addEventListener('click', () => {
          if (this.isFlightAnimating || this.isFlightPending) return;
          const playerChips = this.ui && this.ui.myPlayer ? (this.ui.myPlayer.chips || 0) : this.maxBet;
          this.setBetAmount(Math.max(this.minBet, Math.min(this.maxBet, playerChips)));
        });
      }

      if (this.elements.quickChips) {
        this.elements.quickChips.forEach((btn) => {
          btn.addEventListener('click', () => {
            if (this.isFlightAnimating || this.isFlightPending) return;
            const add = parseInt(btn.dataset.add, 10) || 0;
            this.setBetAmount(Math.min(this.maxBet, this.betAmount + add));
          });
        });
      }

      if (this.elements.btnFly) {
        this.elements.btnFly.addEventListener('click', () => {
          this.launchFlight();
        });
      }

      if (typeof document !== 'undefined') {
        document.addEventListener('keydown', (ev) => {
          if (!this.isActiveView || ev.code !== 'Space' || ev.repeat) return;
          const tag = ev.target && ev.target.tagName ? ev.target.tagName.toLowerCase() : '';
          if (tag === 'input' || tag === 'textarea' || tag === 'button') return;
          ev.preventDefault();
          if (!this.isFlightAnimating && !this.isFlightPending) {
            this.launchFlight();
          }
        });
      }

      window.addEventListener('resize', () => {
        if (this.isActiveView) {
          this.resizeCanvas();
        }
      });
    }

    bindNetworkEvents() {
      if (!this.network || typeof this.network.on !== 'function') return;

      this.network.on('avia_state', (data) => {
        if (!data) return;
        if (typeof data.minBet === 'number') this.minBet = data.minBet;
        if (typeof data.maxBet === 'number') this.maxBet = data.maxBet;
        if (Array.isArray(data.recentFlights)) {
          this.recentFlights = data.recentFlights.slice(0, 25);
          this.updateHistoryUI();
        }
        this.updateControlsUI();
      });

      this.network.on('avia_fly_accepted', (data) => {
        if (!data || !data.flight) return;
        this.isFlightPending = false;
        this.pendingFinalChips = typeof data.newChips === 'number' ? data.newChips : null;
        this.pendingStats = data.stats || null;
        if (Array.isArray(data.recentFlights)) {
          this.recentFlights = data.recentFlights.slice(0, 25);
        }

        if (this.ui && this.ui.myPlayer && typeof data.flight.amount === 'number') {
          this.ui.myPlayer.chips = Math.max(0, (this.ui.myPlayer.chips || 0) - data.flight.amount);
          this.ui.updatePlayerHUD();
        }

        this.startFlightAnimation(data.flight);
      });

      this.network.on('avia_fly_rejected', (data) => {
        this.isFlightPending = false;
        this.updateControlsUI();
        if (data && data.reason && this.ui) {
          this.ui.showToast(data.reason, 'error');
        }
      });

      this.network.on('avia_flight_logged', (data) => {
        if (!data || !Array.isArray(data.recentFlights)) return;
        if (!this.isFlightAnimating) {
          this.recentFlights = data.recentFlights.slice(0, 25);
          this.updateHistoryUI();
        }
      });
    }

    onViewActivated() {
      this.isActiveView = true;
      this.resizeCanvas();
      this.startLoop();
      if (this.network && typeof this.network.aviaJoin === 'function') {
        this.network.aviaJoin();
      }
      if (this.ui) {
        this.ui.updatePhase(this.isFlightAnimating ? 'AVIA_FLYING' : 'AVIA_READY', 0, 'SOLO');
      }
    }

    onViewDeactivated() {
      this.isActiveView = false;
      this.flushPendingSettlement();
      this.stopLoop();
    }

    flushPendingSettlement() {
      if (this.isFlightAnimating && this.activeFlight) {
        this.completeFlightVisuals({ instantSnap: true });
      } else if (this.pendingFinalChips !== null && this.ui && this.ui.myPlayer) {
        this.ui.myPlayer.chips = this.pendingFinalChips;
        if (this.pendingStats) {
          this.ui.myPlayer.stats = this.pendingStats;
          this.ui.renderMyProfile();
        }
        this.ui.updatePlayerHUD();
        this.pendingFinalChips = null;
        this.pendingStats = null;
      }
      this.isFlightPending = false;
      this.updateControlsUI();
    }

    setBetAmount(val) {
      const clean = clamp(Math.round(Number(val) || this.minBet), this.minBet, this.maxBet);
      this.betAmount = clean;
      if (this.elements.betInput) {
        this.elements.betInput.value = clean;
      }
      this.updateFlyButtonText();
    }

    launchFlight() {
      if (this.isFlightPending || this.isFlightAnimating) return;

      if (this.resultTimeout) {
        clearTimeout(this.resultTimeout);
        this.resultTimeout = null;
      }

      const rawInput = this.elements.betInput ? parseInt(this.elements.betInput.value, 10) : this.betAmount;
      const amount = clamp(Number.isNaN(rawInput) ? this.betAmount : rawInput, this.minBet, this.maxBet);
      this.setBetAmount(amount);

      const playerChips = this.ui && this.ui.myPlayer ? (this.ui.myPlayer.chips || 0) : 0;
      if (playerChips < amount) {
        if (this.ui) {
          this.ui.showToast('Onvoldoende fiches voor deze vlucht.', 'error');
        }
        return;
      }

      this.isFlightPending = true;
      this.hideResultBanner();
      this.updateControlsUI();

      if (this.network && typeof this.network.aviaFly === 'function') {
        this.network.aviaFly({ amount, speed: this.speed });
      }
    }

    startFlightAnimation(flight) {
      this.activeFlight = flight;
      this.isFlightAnimating = true;
      this.flightElapsedMs = 0;
      this.flightDurationMs = flight.durationMs || 5200;
      this.triggeredEvents.clear();
      this.triggeredTouchGos.clear();
      this.waterImpactTriggered = false;
      this.deckTouchdownTriggered = false;
      this.prevPlaneY = 18;
      this.smoothedPitchDeg = 0;
      this.comboCount = 0;
      this.chainItems = [{ label: '1.0x', kind: 'start' }];
      this.renderChainBar();

      this.trail.length = 0;
      this.particles.length = 0;
      this.bubbles.length = 0;
      this.shockwaves.length = 0;
      this.floatingTexts.length = 0;
      this.shakeTime = 0;
      this.afterburnerTime = 0;
      this.rocketSmokeTime = 0;
      this.vignetteFlash = null;
      this.camX = 0;
      this._hudAccum = 1;

      this.hideResultBanner();
      this.setLiveCounterDisplay(flight.amount, 1.0, 'neutral');
      this.updateComboBadge();
      this.updateControlsUI();

      if (this.ui && this.isActiveView) {
        this.ui.updatePhase('AVIA_FLYING', 0, 'IN VLUCHT');
      }
    }

    completeFlightVisuals({ instantSnap = false } = {}) {
      if (!this.activeFlight) return;
      const flight = this.activeFlight;
      this.isFlightAnimating = false;

      if (Array.isArray(flight.events)) {
        for (let i = 0; i < flight.events.length; i += 1) {
          const ev = flight.events[i];
          if (!this.triggeredEvents.has(ev.id)) {
            this.triggeredEvents.add(ev.id);
            this.chainItems.push({ label: ev.label, kind: ev.kind });
          }
        }
        this.renderChainBar();
      }

      if (flight.landed) {
        this.setLiveCounterDisplay(flight.payout, flight.finalMultiplier, flight.finalMultiplier >= 3 ? 'gold' : 'win');
      } else {
        this.setLiveCounterDisplay(0, 0, 'rocket');
      }

      if (!instantSnap) {
        if (flight.landed) {
          this._spawnLandingCelebration(flight.totalDistance - 40, 18, flight.finalMultiplier >= 10);
          this.vignetteFlash = { color: flight.finalMultiplier >= 6 ? '250, 204, 21' : '52, 211, 153', alpha: 0.42 };
        } else if (!this.waterImpactTriggered) {
          this.waterImpactTriggered = true;
          this._spawnWaterSplash(flight.totalDistance - 30, 0);
          this.triggerShake(11, 0.38);
          this.vignetteFlash = { color: '239, 68, 68', alpha: 0.45 };
        }
      }

      if (this.ui && this.ui.myPlayer && this.pendingFinalChips !== null) {
        this.ui.myPlayer.chips = this.pendingFinalChips;
        if (this.pendingStats) {
          this.ui.myPlayer.stats = this.pendingStats;
          this.ui.renderMyProfile();
        }
        this.ui.updatePlayerHUD();
      }
      this.pendingFinalChips = null;
      this.pendingStats = null;

      this.sessionFlights += 1;
      this.sessionNet += (flight.payout - flight.amount);
      this.lastWin = flight.payout;

      if (!instantSnap) {
        this.showResultBanner(flight);
        if (flight.profit > 0 && this.ui && typeof this.ui.triggerWinShimmer === 'function') {
          this.ui.triggerWinShimmer(flight.finalMultiplier >= 10 ? 3400 : 2000);
        }
      }

      this.updateHistoryUI();
      this.updateControlsUI();

      if (this.ui && this.isActiveView) {
        this.ui.updatePhase('AVIA_READY', 0, 'SOLO');
      }
    }

    renderChainBar() {
      if (!this.elements.chainBar) return;
      const items = this.chainItems.slice(-8);
      this.elements.chainBar.innerHTML = items.map((it) => {
        let cls = 'avia-chain-pill ';
        if (it.kind === 'rocket') cls += 'is-rocket';
        else if (it.kind === 'mult') cls += 'is-mult';
        else if (it.kind === 'add') cls += 'is-add';
        else cls += 'is-start';
        return `<span class="${cls}">${it.label}</span>`;
      }).join('');
    }

    updateComboBadge() {
      if (!this.elements.comboBadge) return;
      if (this.comboCount >= 2 && this.isFlightAnimating) {
        this.elements.comboBadge.textContent = `STREAK x${this.comboCount}`;
        this.elements.comboBadge.classList.remove('hidden');
      } else {
        this.elements.comboBadge.classList.add('hidden');
      }
    }

    setLiveCounterDisplay(chipsVal, multVal, tone) {
      this.currentLiveChips = chipsVal;
      this.currentLiveMult = multVal;
      this.currentLiveChipLabel = `${formatFiches(chipsVal)} F`;
      this.counterTone = tone || 'neutral';
      this.counterPopTimer = 0.28;

      if (this.elements.liveCounter) {
        this.elements.liveCounter.textContent = this.currentLiveChipLabel;
      }
      if (this.elements.liveMult) {
        const cleanMult = Number(multVal || 0).toFixed(2).replace(/\.00$/, '.0').replace(/(\.\d)0$/, '$1');
        this.elements.liveMult.textContent = `${cleanMult}x`;
      }
      if (this.elements.liveCounterBox) {
        const el = this.elements.liveCounterBox;
        el.classList.remove('tone-win', 'tone-gold', 'tone-rocket');
        if (tone === 'win') el.classList.add('tone-win');
        else if (tone === 'gold') el.classList.add('tone-gold');
        else if (tone === 'rocket') el.classList.add('tone-rocket');
      }
    }

    showResultBanner(flight) {
      if (!this.elements.resultBanner) return;
      const el = this.elements.resultBanner;
      el.classList.remove('hidden', 'banner-win', 'banner-mega', 'banner-splash');

      if (flight.landed) {
        const isMega = flight.finalMultiplier >= 10;
        el.classList.add(isMega ? 'banner-mega' : 'banner-win');
        if (this.elements.resultKicker) {
          this.elements.resultKicker.textContent = flight.tierLabel || 'DEK LANDING GESLAAGD';
        }
        if (this.elements.resultMult) {
          this.elements.resultMult.textContent = `${flight.finalMultiplier.toFixed(flight.finalMultiplier % 1 === 0 ? 1 : 2)}x`;
        }
        if (this.elements.resultPayout) {
          this.elements.resultPayout.textContent = `+${formatFiches(flight.payout)} fiches`;
        }
      } else {
        el.classList.add('banner-splash');
        if (this.elements.resultKicker) {
          this.elements.resultKicker.textContent = 'IN WATER BELAND';
        }
        if (this.elements.resultMult) {
          this.elements.resultMult.textContent = 'PLONS!';
        }
        if (this.elements.resultPayout) {
          this.elements.resultPayout.textContent = `-${formatFiches(flight.amount)} fiches`;
        }
      }

      this.resultTimeout = setTimeout(() => {
        this.hideResultBanner();
      }, 2800);
    }

    hideResultBanner() {
      if (this.elements.resultBanner) {
        this.elements.resultBanner.classList.add('hidden');
      }
    }

    updateHistoryUI() {
      if (this.elements.historyStrip) {
        if (!this.recentFlights || this.recentFlights.length === 0) {
          this.elements.historyStrip.innerHTML = '<span class="avia-hist-empty">Klaar voor opstijgen</span>';
        } else {
          const pills = this.recentFlights.slice(0, 12).map((item) => {
            let cls = 'avia-hist-pill ';
            if (!item.landed || item.finalMultiplier <= 0) cls += 'is-splash';
            else if (item.finalMultiplier >= 10) cls += 'is-mega';
            else if (item.finalMultiplier >= 2) cls += 'is-win';
            else cls += 'is-low';
            const label = item.landed && item.finalMultiplier > 0
              ? `${Number(item.finalMultiplier).toFixed(item.finalMultiplier % 1 === 0 ? 1 : 2)}x`
              : 'PLONS';
            return `<span class="${cls}" title="${item.tierLabel || ''}">${label}</span>`;
          }).join('');
          this.elements.historyStrip.innerHTML = pills;
        }
      }

      if (this.elements.lastWin) {
        this.elements.lastWin.textContent = `${formatFiches(this.lastWin)} F`;
      }
      if (this.elements.sessionNet) {
        const prefix = this.sessionNet > 0 ? '+' : '';
        this.elements.sessionNet.textContent = `${prefix}${formatFiches(this.sessionNet)} F`;
        this.elements.sessionNet.classList.toggle('is-positive', this.sessionNet > 0);
        this.elements.sessionNet.classList.toggle('is-negative', this.sessionNet < 0);
      }
    }

    updateFlyButtonText() {
      if (this.elements.btnFlySub) {
        this.elements.btnFlySub.textContent = `INZET: ${formatFiches(this.betAmount)} F`;
      }
    }

    updateControlsUI() {
      const busy = this.isFlightAnimating || this.isFlightPending;
      if (this.elements.btnFly) {
        this.elements.btnFly.disabled = busy;
        this.elements.btnFly.classList.toggle('is-busy', busy);
      }
      if (this.elements.btnFlyLabel) {
        if (this.isFlightPending) this.elements.btnFlyLabel.textContent = 'STARTEN...';
        else if (this.isFlightAnimating) this.elements.btnFlyLabel.textContent = 'IN VLUCHT';
        else this.elements.btnFlyLabel.textContent = 'VLIEG!';
      }
      if (this.elements.betInput) {
        this.elements.betInput.disabled = busy;
      }
      this.updateFlyButtonText();
    }

    resizeCanvas() {
      if (!this.canvas || !this.elements.stage) return;
      const rect = this.elements.stage.getBoundingClientRect();
      const w = Math.max(320, Math.floor(rect.width));
      const h = Math.max(220, Math.floor(rect.height));
      // Cap DPR at 1.5 for crisp vector canvas without excessive HiDPI pixel fill latency
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      this.viewW = w;
      this.viewH = h;
      this.dpr = dpr;
      this.canvas.width = Math.floor(w * dpr);
      this.canvas.height = Math.floor(h * dpr);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
      if (this.ctx) {
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      this._rebuildBackdropCache(w, h);
    }

    startLoop() {
      if (this.rafId !== null) return;
      this.lastFrameTime = performance.now();
      const tick = (now) => {
        const rawDt = (now - this.lastFrameTime) / 1000;
        const dt = Math.min(0.05, Math.max(0.001, rawDt));
        this.lastFrameTime = now;
        this.update(dt, now);
        this.render(now);
        this.rafId = requestAnimationFrame(tick);
      };
      this.rafId = requestAnimationFrame(tick);
    }

    stopLoop() {
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
    }

    triggerShake(mag, durationSec) {
      this.shakeMag = Math.max(this.shakeMag, mag);
      this.shakeTime = Math.max(this.shakeTime, durationSec);
    }

    _sampleFlightState(flight, t) {
      const wps = flight.waypoints;
      if (!wps || wps.length === 0) {
        return { x: 25, y: 18, pitchDeg: 0, phase: 'takeoff' };
      }
      if (t <= wps[0].t) return wps[0];
      const last = wps[wps.length - 1];
      if (t >= last.t) return last;

      let lo = 0;
      let hi = wps.length - 2;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (wps[mid].t <= t && t <= wps[mid + 1].t) {
          const i = mid;
          const p1 = wps[i];
          const p2 = wps[i + 1];
          const p0 = i > 0 ? wps[i - 1] : p1;
          const p3 = i + 2 < wps.length ? wps[i + 2] : p2;
          const span = Math.max(0.00001, p2.t - p1.t);
          const u = clamp((t - p1.t) / span, 0, 1);

          return {
            x: catmullRom(p0.x, p1.x, p2.x, p3.x, u),
            y: catmullRom(p0.y, p1.y, p2.y, p3.y, u),
            pitchDeg: lerp(p1.pitchDeg, p2.pitchDeg, u),
            phase: u > 0.5 ? p2.phase : p1.phase,
            carrierName: p2.carrierName || p1.carrierName || null
          };
        }
        if (wps[mid].t < t) lo = mid + 1;
        else hi = mid - 1;
      }
      return last;
    }

    _spawnPickupFX(worldX, worldY, ev) {
      this.chainItems.push({ label: ev.label, kind: ev.kind });
      this.renderChainBar();

      if (ev.kind === 'rocket') {
        this.comboCount = 0;
        this.updateComboBadge();
        this.rocketSmokeTime = 1.05;
        this.triggerShake(9.5, 0.34);
        this.vignetteFlash = { color: '239, 68, 68', alpha: 0.44 };
        this.shockwaves.push({
          x: worldX,
          y: worldY,
          r: 10,
          maxR: 98,
          life: 0.42,
          maxLife: 0.42,
          color: '#ef4444'
        });
        for (let i = 0; i < 18; i += 1) {
          const ang = (Math.PI * 2 * i) / 18 + (Math.random() - 0.5) * 0.28;
          const spd = 52 + Math.random() * 130;
          this.particles.push({
            x: worldX,
            y: worldY,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd,
            life: 0.45 + Math.random() * 0.28,
            maxLife: 0.73,
            size: 3 + Math.random() * 4,
            color: i % 3 === 0 ? '#ef4444' : (i % 3 === 1 ? '#f97316' : '#64748b')
          });
        }
        this.floatingTexts.push({
          x: worldX,
          y: worldY + 24,
          vy: 30,
          life: 1.0,
          maxLife: 1.0,
          text: `${ev.label} RAKET!`,
          color: '#fca5a5',
          scale: 1.15
        });
      } else if (ev.kind === 'mult') {
        this.comboCount += 1;
        this.updateComboBadge();
        this.afterburnerTime = 0.9;
        this.triggerShake(5.5, 0.22);
        this.vignetteFlash = { color: '250, 204, 21', alpha: 0.38 };
        this.shockwaves.push(
          { x: worldX, y: worldY, r: 8, maxR: 112, life: 0.48, maxLife: 0.48, color: '#fde047' }
        );
        for (let i = 0; i < 20; i += 1) {
          const ang = (Math.PI * 2 * i) / 20;
          const spd = 64 + Math.random() * 140;
          this.particles.push({
            x: worldX,
            y: worldY,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd,
            life: 0.5 + Math.random() * 0.3,
            maxLife: 0.8,
            size: 2.2 + Math.random() * 3.5,
            color: i % 3 === 0 ? '#fde047' : (i % 3 === 1 ? '#fbbf24' : '#ffffff')
          });
        }
        this.floatingTexts.push({
          x: worldX,
          y: worldY + 26,
          vy: 38,
          life: 1.15,
          maxLife: 1.15,
          text: `${ev.label} MEGA BOOST!`,
          color: '#fde047',
          scale: 1.28
        });
      } else {
        this.comboCount += 1;
        this.updateComboBadge();
        this.vignetteFlash = { color: '52, 211, 153', alpha: 0.24 };
        this.shockwaves.push({
          x: worldX,
          y: worldY,
          r: 8,
          maxR: 68,
          life: 0.36,
          maxLife: 0.36,
          color: '#34d399'
        });
        for (let i = 0; i < 14; i += 1) {
          const ang = (Math.PI * 2 * i) / 14;
          const spd = 44 + Math.random() * 94;
          this.particles.push({
            x: worldX,
            y: worldY,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd,
            life: 0.42 + Math.random() * 0.26,
            maxLife: 0.68,
            size: 2 + Math.random() * 2.8,
            color: i % 2 === 0 ? '#34d399' : '#a7f3d0'
          });
        }
        this.floatingTexts.push({
          x: worldX,
          y: worldY + 22,
          vy: 32,
          life: 0.95,
          maxLife: 0.95,
          text: `${ev.label} (+${formatFiches(ev.counterAfter - ev.counterBefore)} F)`,
          color: '#6ee7b7',
          scale: 1.08
        });
      }
    }

    _spawnTouchGoFX(worldX, worldY) {
      this.afterburnerTime = 0.6;
      this.triggerShake(3.2, 0.16);
      for (let i = 0; i < 12; i += 1) {
        this.particles.push({
          x: worldX - 10,
          y: worldY,
          vx: -42 - Math.random() * 90,
          vy: 18 + Math.random() * 56,
          life: 0.38 + Math.random() * 0.22,
          maxLife: 0.6,
          size: 2.2 + Math.random() * 2.4,
          color: i % 2 === 0 ? '#fef08a' : '#e2e8f0'
        });
      }
      this.floatingTexts.push({
        x: worldX,
        y: worldY + 32,
        vy: 26,
        life: 0.95,
        maxLife: 0.95,
        text: 'TOUCH & GO!',
        color: '#eed5a2',
        scale: 1.0
      });
    }

    _spawnLandingCelebration(worldX, worldY, isMega) {
      const count = isMega ? 44 : 26;
      for (let i = 0; i < count; i += 1) {
        const ang = Math.PI * 0.12 + Math.random() * Math.PI * 0.76;
        const spd = 72 + Math.random() * (isMega ? 200 : 135);
        this.particles.push({
          x: worldX + (Math.random() - 0.5) * 48,
          y: worldY + 6,
          vx: Math.cos(ang) * spd * (Math.random() < 0.5 ? 1 : -1),
          vy: Math.sin(ang) * spd,
          life: 0.85 + Math.random() * 0.65,
          maxLife: 1.5,
          size: 2.6 + Math.random() * 3.5,
          color: i % 3 === 0 ? '#fde047' : (i % 3 === 1 ? '#34d399' : '#f8fafc')
        });
      }
    }

    _spawnWaterSplash(worldX, worldY) {
      this.shockwaves.push({
        x: worldX,
        y: 2,
        r: 8,
        maxR: 120,
        life: 0.52,
        maxLife: 0.52,
        color: '#bae6fd'
      });
      for (let i = 0; i < 34; i += 1) {
        const spread = (Math.random() - 0.5) * 1.45;
        const spd = 68 + Math.random() * 170;
        this.particles.push({
          x: worldX + (Math.random() - 0.5) * 24,
          y: Math.max(0, worldY + 2),
          vx: Math.sin(spread) * spd,
          vy: Math.cos(spread) * spd * 1.25,
          life: 0.65 + Math.random() * 0.5,
          maxLife: 1.15,
          size: 2.8 + Math.random() * 4.2,
          color: i % 3 === 0 ? '#38bdf8' : (i % 3 === 1 ? '#bae6fd' : '#ffffff')
        });
      }
      this.floatingTexts.push({
        x: worldX,
        y: 28,
        vy: 30,
        life: 1.0,
        maxLife: 1.0,
        text: 'PLONS!!',
        color: '#fca5a5',
        scale: 1.25
      });
    }

    _syncHudIfChanged(altStr, spdStr, comboStr, distStr, shipStr) {
      if (this.elements.hudAlt && this._lastHud.alt !== altStr) {
        this._lastHud.alt = altStr;
        this.elements.hudAlt.textContent = altStr;
      }
      if (this.elements.hudSpd && this._lastHud.spd !== spdStr) {
        this._lastHud.spd = spdStr;
        this.elements.hudSpd.textContent = spdStr;
      }
      if (this.elements.hudCombo && this._lastHud.combo !== comboStr) {
        this._lastHud.combo = comboStr;
        this.elements.hudCombo.textContent = comboStr;
      }
      if (this.elements.hudDist && this._lastHud.dist !== distStr) {
        this._lastHud.dist = distStr;
        this.elements.hudDist.textContent = distStr;
      }
      if (this.elements.hudShip && this._lastHud.ship !== shipStr) {
        this._lastHud.ship = shipStr;
        this.elements.hudShip.textContent = shipStr;
      }
    }

    update(dt, nowMs) {
      this.idlePhase += dt;

      if (this.shakeTime > 0) {
        this.shakeTime = Math.max(0, this.shakeTime - dt);
        if (this.shakeTime <= 0) this.shakeMag = 0;
      }
      if (this.afterburnerTime > 0) {
        this.afterburnerTime = Math.max(0, this.afterburnerTime - dt);
      }
      if (this.rocketSmokeTime > 0) {
        this.rocketSmokeTime = Math.max(0, this.rocketSmokeTime - dt);
      }
      if (this.counterPopTimer > 0) {
        this.counterPopTimer = Math.max(0, this.counterPopTimer - dt);
      }
      if (this.vignetteFlash) {
        this.vignetteFlash.alpha -= dt * 0.9;
        if (this.vignetteFlash.alpha <= 0) this.vignetteFlash = null;
      }

      for (let i = this.particles.length - 1; i >= 0; i -= 1) {
        const p = this.particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy -= 145 * dt;
        p.life -= dt;
        if (p.life <= 0) this.particles.splice(i, 1);
      }

      for (let i = this.bubbles.length - 1; i >= 0; i -= 1) {
        const b = this.bubbles[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.life -= dt;
        if (b.life <= 0 || b.y > 2) this.bubbles.splice(i, 1);
      }

      for (let i = this.shockwaves.length - 1; i >= 0; i -= 1) {
        const s = this.shockwaves[i];
        s.life -= dt;
        const p = 1 - Math.max(0, s.life / s.maxLife);
        s.r = lerp(8, s.maxR, p);
        if (s.life <= 0) this.shockwaves.splice(i, 1);
      }

      for (let i = this.floatingTexts.length - 1; i >= 0; i -= 1) {
        const f = this.floatingTexts[i];
        f.y += f.vy * dt;
        f.life -= dt;
        if (f.life <= 0) this.floatingTexts.splice(i, 1);
      }

      if (this.isFlightAnimating && this.activeFlight) {
        this.flightElapsedMs += dt * 1000;
        const t = clamp(this.flightElapsedMs / this.flightDurationMs, 0, 1);
        const state = this._sampleFlightState(this.activeFlight, t);

        this.smoothedPitchDeg = lerp(this.smoothedPitchDeg, state.pitchDeg, 1 - Math.exp(-12 * dt));

        const targetCamX = Math.max(0, state.x - 165);
        this.camX = lerp(this.camX, targetCamX, 1 - Math.exp(-9 * dt));

        const targetZoom = state.y > 140 ? clamp(1 - (state.y - 140) / 360, 0.72, 1) : 1.0;
        this.camZoom = lerp(this.camZoom, targetZoom, 1 - Math.exp(-4.5 * dt));

        if (state.y > 0 && state.phase !== 'takeoff') {
          this.trail.push({
            x: state.x - 20,
            y: state.y,
            boost: this.afterburnerTime > 0,
            smoke: this.rocketSmokeTime > 0
          });
          if (this.trail.length > 56) {
            this.trail.shift();
          }
        }

        if (!this.activeFlight.landed && this.prevPlaneY > 0 && state.y <= 0 && !this.waterImpactTriggered) {
          this.waterImpactTriggered = true;
          this._spawnWaterSplash(state.x, 0);
          this.triggerShake(12, 0.42);
          this.vignetteFlash = { color: '239, 68, 68', alpha: 0.48 };
          this.setLiveCounterDisplay(0, 0, 'rocket');
        }
        if (state.y <= 0 && this.bubbles.length < 18 && Math.random() < 0.55) {
          this.bubbles.push({
            x: state.x + (Math.random() - 0.5) * 18,
            y: state.y - 2,
            vx: (Math.random() - 0.5) * 14,
            vy: 22 + Math.random() * 26,
            r: 2 + Math.random() * 3.5,
            life: 0.65,
            maxLife: 0.65
          });
        }
        this.prevPlaneY = state.y;

        if (this.activeFlight.landed && state.phase === 'landed' && !this.deckTouchdownTriggered) {
          this.deckTouchdownTriggered = true;
          this._spawnTouchGoFX(state.x, state.y);
        }

        const events = this.activeFlight.events || [];
        for (let i = 0; i < events.length; i += 1) {
          const ev = events[i];
          if (!this.triggeredEvents.has(ev.id) && (state.x >= ev.worldX || t >= ev.progress)) {
            this.triggeredEvents.add(ev.id);
            this._spawnPickupFX(ev.worldX, ev.worldY, ev);
            const tone = ev.kind === 'rocket' ? 'rocket' : (ev.kind === 'mult' ? 'gold' : 'win');
            this.setLiveCounterDisplay(ev.counterAfter, ev.multAfter, tone);
          }
        }

        const carriers = this.activeFlight.carriers || [];
        let passedCarriers = 1;
        for (let i = 0; i < carriers.length; i += 1) {
          const c = carriers[i];
          if (state.x >= c.deckStart) passedCarriers = i + 1;
          if (c.role === 'touchgo' && !this.triggeredTouchGos.has(c.index) && state.x >= c.deckStart && state.y <= 22) {
            this.triggeredTouchGos.add(c.index);
            this._spawnTouchGoFX(state.x, state.y);
          }
        }

        // Throttle DOM telemetry text writes (~12Hz max) to prevent DOM repaint stalls
        this._hudAccum += dt;
        if (this._hudAccum >= 0.085 || t >= 1) {
          this._hudAccum = 0;
          const spd = state.phase === 'landed'
            ? Math.round(145 * Math.max(0, 1 - (t - 0.85) / 0.15))
            : (state.y <= 0 ? 0 : Math.round(240 + Math.abs(this.smoothedPitchDeg) * 3.2 + (this.afterburnerTime > 0 ? 110 : 0)));
          this._syncHudIfChanged(
            `${Math.max(0, Math.round(state.y))} m`,
            `${spd} kts`,
            `${this.triggeredEvents.size}/${events.length}`,
            `${Math.max(0, Math.round(state.x))} m`,
            `${passedCarriers}`
          );
        }

        if (t >= 1) {
          this.completeFlightVisuals({ instantSnap: false });
        }
      } else {
        this.smoothedPitchDeg = lerp(this.smoothedPitchDeg, 0, 1 - Math.exp(-8 * dt));
        if (this.activeFlight) {
          const focusX = Math.max(0, (this.activeFlight.totalDistance || 180) - 200);
          this.camX = lerp(this.camX, focusX, 1 - Math.exp(-3.5 * dt));
        } else {
          this.camX = lerp(this.camX, 0, 1 - Math.exp(-4 * dt));
        }
        this.camZoom = lerp(this.camZoom, 1.0, 1 - Math.exp(-3.5 * dt));
      }
    }

    render(nowMs) {
      if (!this.canvas || !this.ctx) return;
      const ctx = this.ctx;
      const width = this.viewW || (this.canvas.width / (this.dpr || 1));
      const height = this.viewH || (this.canvas.height / (this.dpr || 1));
      if (width <= 0 || height <= 0) return;

      const shakeX = (this.shakeTime > 0 && this.shakeMag > 0) ? (Math.random() - 0.5) * this.shakeMag * 2 : 0;
      const shakeY = (this.shakeTime > 0 && this.shakeMag > 0) ? (Math.random() - 0.5) * this.shakeMag * 2 : 0;
      const hasShake = shakeX !== 0 || shakeY !== 0;

      if (hasShake) {
        ctx.save();
        ctx.translate(shakeX, shakeY);
      }

      let planeState = { x: 45, y: 18, pitchDeg: 0, phase: 'takeoff' };
      let activeCarriers = this.idleCarriers;
      let activeEvents = [];
      let activeDecoys = [];

      if (this.activeFlight) {
        activeCarriers = this.activeFlight.carriers || this.idleCarriers;
        activeEvents = this.activeFlight.events || [];
        activeDecoys = this.activeFlight.decoys || [];
        const t = this.isFlightAnimating
          ? clamp(this.flightElapsedMs / this.flightDurationMs, 0, 1)
          : 1.0;
        planeState = this._sampleFlightState(this.activeFlight, t);
      }

      const seaY = height * 0.77;
      const pxPerMeter = clamp((height * 0.58) / 215, 1.18, 2.4) * this.camZoom;
      const leftMargin = width * 0.25;
      const xScale = pxPerMeter * 0.85;

      const worldToScreenX = (wx) => leftMargin + (wx - this.camX) * xScale;
      const worldToScreenY = (wy) => seaY - wy * pxPerMeter;

      // 1. Blit pre-rendered Sky + Sunset Glow + Stars backdrop in ONE fast GPU drawImage
      if (this._bgCache) {
        ctx.drawImage(this._bgCache, 0, 0);
      } else {
        ctx.fillStyle = '#0f2447';
        ctx.fillRect(0, 0, width, height);
      }

      // 2. Layered Parallax Clouds via cached sprite blit
      if (this._cloudSprite) {
        const cloudSpan = 5000;
        for (let i = 0; i < this.clouds.length; i += 1) {
          const c = this.clouds[i];
          const rawX = c.x - this.camX * c.depth - this.idlePhase * 14 * c.depth;
          const wrappedX = ((rawX % cloudSpan) + cloudSpan) % cloudSpan - 220;
          const cy = worldToScreenY(c.yAlt);
          if (cy < seaY - 18 && cy > -40 && wrappedX < width + 180) {
            const dw = 170 * c.scale;
            const dh = 90 * c.scale;
            ctx.drawImage(this._cloudSprite, wrappedX - dw * 0.5, cy - dh * 0.5, dw, dh);
          }
        }
      }

      // 3. Deep Back Ocean Layer
      this._drawOceanBack(ctx, width, height, seaY);

      // 4. Multiple Aircraft Carriers (aligned cleanly under landing gear at y=18)
      const deckSurfaceY = worldToScreenY(18) + 12.2;
      for (let i = 0; i < activeCarriers.length; i += 1) {
        const car = activeCarriers[i];
        const sx1 = worldToScreenX(car.deckStart);
        const sx2 = worldToScreenX(car.deckEnd);
        if (sx2 >= -180 && sx1 <= width + 220) {
          this._drawCarrier(ctx, sx1, sx2, seaY, deckSurfaceY, car, nowMs);
        }
      }

      // 5. Decoy Sky Items via cached sprites
      ctx.globalAlpha = 0.44;
      for (let i = 0; i < activeDecoys.length; i += 1) {
        const dc = activeDecoys[i];
        const sx = worldToScreenX(dc.worldX);
        if (sx >= -70 && sx <= width + 70) {
          const sy = worldToScreenY(dc.worldY) + Math.sin(this.idlePhase * 3.1 + i) * 4;
          const sp = this._itemSprites.get(`${dc.kind}:${dc.label}`);
          if (sp) {
            ctx.drawImage(sp, sx - 40, sy - 40, 80, 80);
          } else {
            this._drawSkyItemFallback(ctx, sx, sy, dc, 0.85);
          }
        }
      }
      ctx.globalAlpha = 1;

      // 6. Active Collectible Targets & Rockets via cached sprites
      for (let i = 0; i < activeEvents.length; i += 1) {
        const ev = activeEvents[i];
        if (this.triggeredEvents.has(ev.id)) continue;
        const sx = worldToScreenX(ev.worldX);
        if (sx >= -70 && sx <= width + 70) {
          const sy = worldToScreenY(ev.worldY) + Math.sin(this.idlePhase * 4.0 + i * 1.15) * 3.5;
          const sp = this._itemSprites.get(`${ev.kind}:${ev.label}`);
          if (sp) {
            ctx.drawImage(sp, sx - 48, sy - 48, 96, 96);
          } else {
            this._drawSkyItemFallback(ctx, sx, sy, ev, 1.0);
          }
        }
      }

      // 7. Single-Path Batched Contrail Ribbon (zero per-segment stroke stalls)
      const trailLen = this.trail.length;
      if (trailLen > 1) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = this.afterburnerTime > 0 ? 5.2 : 2.8;
        ctx.strokeStyle = this.rocketSmokeTime > 0
          ? 'rgba(148, 163, 184, 0.45)'
          : (this.afterburnerTime > 0 ? 'rgba(253, 224, 71, 0.72)' : 'rgba(241, 245, 249, 0.36)');
        ctx.beginPath();
        ctx.moveTo(worldToScreenX(this.trail[0].x), worldToScreenY(this.trail[0].y));
        for (let i = 1; i < trailLen; i += 1) {
          ctx.lineTo(worldToScreenX(this.trail[i].x), worldToScreenY(this.trail[i].y));
        }
        ctx.stroke();
      }

      // 8. Shockwave Rings
      if (this.shockwaves.length > 0) {
        ctx.lineWidth = 3.2;
        for (let i = 0; i < this.shockwaves.length; i += 1) {
          const sw = this.shockwaves[i];
          ctx.globalAlpha = clamp(sw.life / sw.maxLife, 0, 1) * 0.85;
          ctx.strokeStyle = sw.color;
          ctx.beginPath();
          ctx.arc(worldToScreenX(sw.x), worldToScreenY(sw.y), sw.r, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // 9. Aircraft + Floating Counter Balance Pill
      const px = worldToScreenX(planeState.x);
      const py = worldToScreenY(planeState.y);
      const sinkFade = planeState.y < 0 ? clamp(1 + planeState.y / 28, 0.25, 1) : 1;
      const pitchToDraw = this.isFlightAnimating ? this.smoothedPitchDeg : planeState.pitchDeg;

      ctx.globalAlpha = sinkFade;
      this._drawAirplane(
        ctx,
        px,
        py,
        pitchToDraw,
        nowMs,
        this.afterburnerTime > 0 || (this.isFlightAnimating && planeState.y > 0),
        planeState.y <= 0,
        planeState.phase
      );
      ctx.globalAlpha = 1;

      if (this.isFlightAnimating && planeState.y > -4) {
        this._drawFloatingCounterPill(ctx, px, py - 34);
      }

      // 10. Front Ocean Waves & Bubbles
      this._drawOceanFront(ctx, width, height, seaY);

      if (this.bubbles.length > 0) {
        ctx.strokeStyle = '#e0f2fe';
        ctx.lineWidth = 1.4;
        for (let i = 0; i < this.bubbles.length; i += 1) {
          const b = this.bubbles[i];
          ctx.globalAlpha = clamp(b.life / b.maxLife, 0, 1) * 0.78;
          ctx.beginPath();
          ctx.arc(worldToScreenX(b.x), worldToScreenY(b.y), b.r, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // 11. Sparks, Smoke & Water Plumes
      for (let i = 0; i < this.particles.length; i += 1) {
        const p = this.particles[i];
        ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(worldToScreenX(p.x), worldToScreenY(p.y), p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // 12. Floating Callout Texts
      if (this.floatingTexts.length > 0) {
        ctx.textAlign = 'center';
        ctx.font = '900 17px "JetBrains Mono", monospace';
        for (let i = 0; i < this.floatingTexts.length; i += 1) {
          const ft = this.floatingTexts[i];
          ctx.globalAlpha = clamp(ft.life / ft.maxLife, 0, 1);
          const tx = worldToScreenX(ft.x);
          const ty = worldToScreenY(ft.y);
          ctx.fillStyle = 'rgba(0,0,0,0.8)';
          ctx.fillText(ft.text, tx + 1.5, ty + 1.5);
          ctx.fillStyle = ft.color;
          ctx.fillText(ft.text, tx, ty);
        }
        ctx.globalAlpha = 1;
      }

      // 13. Lightweight Dopamine Edge Vignette Pulse (zero RadialGradient allocation!)
      if (this.vignetteFlash && this.vignetteFlash.alpha > 0) {
        ctx.strokeStyle = `rgba(${this.vignetteFlash.color}, ${clamp(this.vignetteFlash.alpha * 0.9, 0, 0.42).toFixed(2)})`;
        ctx.lineWidth = 18;
        ctx.strokeRect(0, 0, width, height);
      }

      if (hasShake) {
        ctx.restore();
      }
    }

    _drawFloatingCounterPill(ctx, x, y) {
      const popScale = this.counterPopTimer > 0 ? 1 + (this.counterPopTimer / 0.28) * 0.14 : 1;
      const text = this.currentLiveChipLabel || '100 F';
      ctx.save();
      ctx.translate(x, y);
      if (popScale !== 1) ctx.scale(popScale, popScale);
      const w = Math.max(64, text.length * 8.2 + 20);
      const h = 23;

      let border = 'rgba(238, 213, 162, 0.72)';
      let bg = 'rgba(10, 15, 28, 0.88)';
      let fg = '#ffffff';
      if (this.counterTone === 'gold') {
        border = '#fde047';
        bg = 'rgba(66, 32, 6, 0.92)';
        fg = '#fef08a';
      } else if (this.counterTone === 'win') {
        border = '#34d399';
        bg = 'rgba(6, 78, 59, 0.9)';
        fg = '#d1fae5';
      } else if (this.counterTone === 'rocket') {
        border = '#ef4444';
        bg = 'rgba(69, 10, 10, 0.92)';
        fg = '#fecaca';
      }

      ctx.fillStyle = bg;
      ctx.strokeStyle = border;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.roundRect(-w / 2, -h / 2, w, h, 999);
      ctx.fill();
      ctx.stroke();

      ctx.font = '800 12px "JetBrains Mono", monospace';
      ctx.fillStyle = fg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 0, 1);
      ctx.restore();
    }

    _drawOceanBack(ctx, width, height, seaY) {
      ctx.fillStyle = this._seaGrad || '#0c4a6e';
      ctx.beginPath();
      ctx.moveTo(0, height);
      ctx.lineTo(0, seaY);
      const step = 32;
      const camFactor = this.camX * 0.65;
      const phase24 = this.idlePhase * 2.4;
      for (let x = 0; x <= width + step; x += step) {
        const wave = Math.sin((x + camFactor) * 0.024 + phase24) * 3.0;
        ctx.lineTo(x, seaY + wave);
      }
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fill();
    }

    _drawOceanFront(ctx, width, height, seaY) {
      ctx.fillStyle = this._frontGrad || 'rgba(14, 116, 144, 0.7)';
      ctx.beginPath();
      ctx.moveTo(0, height);
      ctx.lineTo(0, seaY + 3);
      const step = 30;
      const camA = this.camX * 0.92;
      const camB = this.camX * 0.5;
      const phA = this.idlePhase * 3.1;
      const phB = this.idlePhase * 2.1;
      for (let x = 0; x <= width + step; x += step) {
        const wave = Math.sin((x + camA) * 0.032 + phA) * 3.4
          + Math.cos((x + camB) * 0.017 - phB) * 2.1;
        ctx.lineTo(x, seaY + 4 + wave);
      }
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = 'rgba(186, 230, 253, 0.44)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let x = 0; x <= width + step; x += step) {
        const wave = Math.sin((x + camA) * 0.032 + phA) * 3.4
          + Math.cos((x + camB) * 0.017 - phB) * 2.1;
        if (x === 0) ctx.moveTo(x, seaY + 4 + wave);
        else ctx.lineTo(x, seaY + 4 + wave);
      }
      ctx.stroke();
    }

    _drawCarrier(ctx, x1, x2, seaY, deckSurfaceY, carrier, nowMs) {
      const deckLen = Math.max(130, x2 - x1);
      const deckY = Math.min(seaY - 13, deckSurfaceY + 4);

      ctx.fillStyle = 'rgba(224, 242, 254, 0.25)';
      ctx.fillRect(x1 - 6, seaY + 1, deckLen + 26, 3);

      ctx.fillStyle = this._hullGrad || '#1e293b';
      ctx.beginPath();
      ctx.moveTo(x1 - 12, deckY + 2);
      ctx.lineTo(x2 + 20, deckY + 2);
      ctx.lineTo(x2 + 6, seaY + 4);
      ctx.lineTo(x1 + 8, seaY + 4);
      ctx.closePath();
      ctx.fill();

      const towerX = x1 + deckLen * 0.66;
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(towerX, deckY - 28, 28, 28);
      ctx.fillStyle = 'rgba(56, 189, 248, 0.5)';
      ctx.fillRect(towerX + 3, deckY - 23, 18, 4);
      ctx.fillStyle = '#475569';
      ctx.fillRect(towerX + 5, deckY - 35, 16, 7);

      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(towerX + 13, deckY - 35);
      ctx.lineTo(towerX + 13, deckY - 46);
      ctx.stroke();

      const blink = Math.sin(nowMs * 0.009 + carrier.index) > 0;
      ctx.fillStyle = blink ? '#fbbf24' : '#78350f';
      ctx.beginPath();
      ctx.arc(towerX + 13, deckY - 47, 2.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#0f172a';
      ctx.fillRect(x1 - 16, deckY - 4, deckLen + 36, 7);

      const isTarget = carrier.role === 'destination' || carrier.role === 'touchgo';
      ctx.strokeStyle = isTarget ? 'rgba(52, 211, 153, 0.85)' : 'rgba(238, 213, 162, 0.65)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([9, 6]);
      ctx.beginPath();
      ctx.moveTo(x1 - 6, deckY - 1);
      ctx.lineTo(x2 + 12, deckY - 1);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = isTarget ? '#34d399' : '#f59e0b';
      for (let lx = x1 - 4; lx <= x2 + 8; lx += 24) {
        ctx.fillRect(lx - 1.5, deckY - 4, 3, 3);
      }

      ctx.font = '800 9.5px "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(248, 250, 252, 0.92)';
      ctx.fillText(carrier.name || 'CARRIER', x1 + deckLen * 0.42, deckY + 14);
    }

    _drawSkyItemFallback(ctx, x, y, item, scale) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.fillStyle = item.kind === 'rocket' ? '#ef4444' : (item.kind === 'mult' ? '#fde047' : '#34d399');
      ctx.beginPath();
      ctx.arc(0, 0, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    _drawAirplane(ctx, x, y, pitchDeg, nowMs, engineRunning, isSubmerged, phase) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1.22, 1.22);
      ctx.rotate((pitchDeg * Math.PI) / 180);

      if (engineRunning && !isSubmerged && this.afterburnerTime > 0) {
        const flicker = 0.8 + 0.3 * Math.sin(nowMs * 0.06);
        ctx.fillStyle = 'rgba(253, 224, 71, 0.88)';
        ctx.beginPath();
        ctx.moveTo(-24, -4);
        ctx.lineTo(-52 * flicker, 0);
        ctx.lineTo(-24, 4);
        ctx.closePath();
        ctx.fill();
      }

      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.moveTo(-19, -2);
      ctx.lineTo(-29, -16);
      ctx.lineTo(-19, -16);
      ctx.lineTo(-9, -2);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#b91c1c';
      ctx.beginPath();
      ctx.moveTo(-4, 2);
      ctx.lineTo(-13, 12.5);
      ctx.lineTo(4, 12.5);
      ctx.lineTo(13, 2);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = (Math.sin(nowMs * 0.014) > 0) ? '#34d399' : '#f87171';
      ctx.beginPath();
      ctx.arc(-5, 12, 1.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.moveTo(-26, -1);
      ctx.quadraticCurveTo(-8, -8.5, 18, -4.5);
      ctx.quadraticCurveTo(31, 0, 32, 2);
      ctx.quadraticCurveTo(19, 6.5, -26, 3.5);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#fde68a';
      ctx.fillRect(-20, -0.5, 40, 2.5);

      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.ellipse(6.5, -4.5, 7.5, 3.5, 0.08, Math.PI, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#fde047';
      ctx.beginPath();
      ctx.arc(31, 1.5, 3.0, 0, Math.PI * 2);
      ctx.fill();

      if (engineRunning && !isSubmerged) {
        const propH = 11 + Math.sin(nowMs * 0.1) * 3.5;
        ctx.strokeStyle = 'rgba(248, 250, 252, 0.85)';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(32.5, 1.5 - propH);
        ctx.lineTo(32.5, 1.5 + propH);
        ctx.stroke();
      }

      if (!isSubmerged && ['takeoff', 'touchgo', 'approach', 'landed', 'idle'].includes(phase)) {
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(8, 4.5);
        ctx.lineTo(9, 10);
        ctx.moveTo(-12, 3.5);
        ctx.lineTo(-14, 9.5);
        ctx.stroke();
        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.arc(9, 10.5, 2.2, 0, Math.PI * 2);
        ctx.arc(-14, 10, 2.0, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CasinoAvia;
  } else {
    global.CasinoAvia = CasinoAvia;
  }
})(typeof window !== 'undefined' ? window : globalThis);
