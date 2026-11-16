/**
 * plinko.js
 * High-Precision Multiplayer Royal Plinko Controller & 60FPS Canvas Physics Renderer.
 *
 * Features:
 * - Authentic sub-stepped parabolic peg-bounce physics matched to server binomial paths.
 * - Multi-ball rapid-fire & staggered burst drops (1x, 3x, 5x, 10x).
 * - Multiplayer room sync: watch all players' custom-colored orbs cascade simultaneously.
 * - Peg impact shockwave ripples, comet trails, golden spark fountains, bucket springs & popups.
 * - Visual Chip Sync: deducts bet immediately and credits each ball's payout on exact bin impact.
 * - Strict compliance: Zero audio, zero unicode emojis, responsive 100vh Obsidian Salle Blanche layout.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const Exported = factory();
    root.CasinoPlinko = Exported;
    root.PlinkoGame = Exported;
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const DEFAULT_MULTIPLIER_TABLES = {
    8: {
      low:    [5.4, 2.0, 1.05, 0.95, 0.45, 0.95, 1.05, 2.0, 5.4],
      medium: [12.5, 2.9, 1.25, 0.65, 0.35, 0.65, 1.25, 2.9, 12.5],
      high:   [27, 3.8, 1.45, 0.25, 0.2, 0.25, 1.45, 3.8, 27]
    },
    10: {
      low:    [8.5, 2.9, 1.35, 1.05, 0.95, 0.5, 0.95, 1.05, 1.35, 2.9, 8.5],
      medium: [21, 4.8, 1.9, 1.35, 0.55, 0.35, 0.55, 1.35, 1.9, 4.8, 21],
      high:   [72, 9.5, 2.8, 0.85, 0.3, 0.2, 0.3, 0.85, 2.8, 9.5, 72]
    },
    12: {
      low:    [9.6, 2.9, 1.55, 1.35, 1.05, 0.95, 0.45, 0.95, 1.05, 1.35, 1.55, 2.9, 9.6],
      medium: [32, 10.5, 3.8, 1.9, 1.05, 0.55, 0.25, 0.55, 1.05, 1.9, 3.8, 10.5, 32],
      high:   [165, 23, 7.6, 1.9, 0.65, 0.2, 0.2, 0.2, 0.65, 1.9, 7.6, 23, 165]
    },
    14: {
      low:    [6.8, 3.8, 1.8, 1.35, 1.25, 1.05, 0.95, 0.45, 0.95, 1.05, 1.25, 1.35, 1.8, 3.8, 6.8],
      medium: [55, 14.5, 6.6, 3.8, 1.8, 0.95, 0.45, 0.2, 0.45, 0.95, 1.8, 3.8, 6.6, 14.5, 55],
      high:   [400, 54, 17, 4.8, 1.8, 0.25, 0.2, 0.2, 0.2, 0.25, 1.8, 4.8, 17, 54, 400]
    },
    16: {
      low:    [15, 8.5, 1.9, 1.35, 1.35, 1.15, 1.05, 0.95, 0.45, 0.95, 1.05, 1.15, 1.35, 1.35, 1.9, 8.5, 15],
      medium: [105, 39, 9.5, 4.8, 2.8, 1.45, 0.95, 0.45, 0.25, 0.45, 0.95, 1.45, 2.8, 4.8, 9.5, 39, 105],
      high:   [1000, 122, 25, 8.5, 3.8, 1.9, 0.2, 0.2, 0.15, 0.2, 0.2, 1.9, 3.8, 8.5, 25, 122, 1000]
    }
  };

  function getMonogram(name) {
    if (!name || typeof name !== 'string') return '?';
    const clean = name.replace(/<[^>]*>/g, '').trim();
    if (!clean) return '?';
    const parts = clean.split(/[\s_-]+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return clean.slice(0, 2).toUpperCase();
  }

  function hexToRgba(hex, alpha) {
    if (typeof hex !== 'string') return `rgba(212, 175, 55, ${alpha})`;
    const clean = hex.trim().replace('#', '');
    if (clean.length === 3) {
      const r = parseInt(clean[0] + clean[0], 16);
      const g = parseInt(clean[1] + clean[1], 16);
      const b = parseInt(clean[2] + clean[2], 16);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }
    } else if (clean.length >= 6) {
      const r = parseInt(clean.slice(0, 2), 16);
      const g = parseInt(clean.slice(2, 4), 16);
      const b = parseInt(clean.slice(4, 6), 16);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }
    }
    return `rgba(212, 175, 55, ${alpha})`;
  }

  function getBucketTheme(mult) {
    if (mult >= 100) {
      return {
        bg: 'rgba(131, 24, 67, 0.88)',
        border: '#f472b6',
        glow: 'rgba(244, 114, 182, 0.65)',
        text: '#fdf2f8',
        pillClass: 'mult-royal'
      };
    }
    if (mult >= 10) {
      return {
        bg: 'rgba(127, 29, 29, 0.86)',
        border: '#fb7185',
        glow: 'rgba(244, 63, 94, 0.55)',
        text: '#ffe4e6',
        pillClass: 'mult-crimson'
      };
    }
    if (mult >= 2) {
      return {
        bg: 'rgba(120, 53, 15, 0.86)',
        border: '#f59e0b',
        glow: 'rgba(245, 158, 11, 0.5)',
        text: '#fef3c7',
        pillClass: 'mult-amber'
      };
    }
    if (mult >= 1) {
      return {
        bg: 'rgba(66, 52, 18, 0.84)',
        border: '#d4af37',
        glow: 'rgba(212, 175, 55, 0.35)',
        text: '#fef9c3',
        pillClass: 'mult-gold'
      };
    }
    return {
      bg: 'rgba(17, 44, 48, 0.82)',
      border: '#2dd4bf',
      glow: 'rgba(45, 212, 191, 0.25)',
      text: '#ccfbf1',
      pillClass: 'mult-teal'
    };
  }

  class CasinoPlinko {
    /**
     * @param {{ network: Object, ui: Object }} options
     */
    constructor({ network, ui }) {
      this.network = network;
      this.ui = ui;

      // Config state
      this.multiplierTables = DEFAULT_MULTIPLIER_TABLES;
      this.rows = 12;
      this.risk = 'medium';
      this.burstCount = 1;
      this.betAmount = 100;
      this.minBet = 10;
      this.maxBet = 50000;

      // Physics & visual FX state
      this.balls = [];
      this.spawnedDropIds = new Set();
      this.pegFlashes = new Map();
      this.ripples = [];
      this.particles = [];
      this.floatingTexts = [];
      this.bucketSprings = new Array(17).fill(0);
      this.nozzleFlash = 0;
      this.boardGlow = 0;
      this.pendingPayoutHold = 0;
      this.lastSelfWin = 0;

      // Recent history synced from server & landed balls
      this.recentDrops = [];

      // Canvas
      this.canvas = null;
      this.ctx = null;
      this.width = 0;
      this.height = 0;
      this.dpr = 1;
      this.animFrameId = null;
      this.lastFrameTime = 0;
      this.resizeObserver = null;
      this.jackpotHideTimer = null;

      this.elements = {};
    }

    init() {
      this.cacheElements();
      this.bindEvents();
      this.bindNetworkEvents();
      this.setupCanvasResize();
      this.updateControlsUI();
      this.startLoop();
    }

    cacheElements() {
      this.elements = {
        view: document.getElementById('plinko-view'),
        stage: document.getElementById('plinko-stage'),
        canvas: document.getElementById('plinko-canvas'),
        historyStrip: document.getElementById('plinko-history-strip'),
        inflightCount: document.getElementById('plinko-inflight-count'),
        lastWin: document.getElementById('plinko-last-win'),
        jackpotBanner: document.getElementById('plinko-jackpot-banner'),
        jackpotKicker: document.getElementById('plinko-jackpot-kicker'),
        jackpotMult: document.getElementById('plinko-jackpot-mult'),
        jackpotPayout: document.getElementById('plinko-jackpot-payout'),
        liveFeed: document.getElementById('plinko-live-feed'),
        riskBtns: document.querySelectorAll('#plinko-view .btn-risk'),
        rowsBtns: document.querySelectorAll('#plinko-view .btn-plinko-rows'),
        burstBtns: document.querySelectorAll('#plinko-view .btn-plinko-burst'),
        betInput: document.getElementById('plinko-bet-amount'),
        btnHalf: document.getElementById('btn-plinko-half'),
        btnDouble: document.getElementById('btn-plinko-double'),
        btnMax: document.getElementById('btn-plinko-max'),
        quickChips: document.querySelectorAll('#plinko-view .btn-plinko-chip'),
        totalBetDisplay: document.getElementById('plinko-total-bet-display'),
        btnDrop: document.getElementById('btn-drop-plinko')
      };

      this.canvas = this.elements.canvas;
      if (this.canvas) {
        this.ctx = this.canvas.getContext('2d');
      }
    }

    bindEvents() {
      // Risk selector
      if (this.elements.riskBtns) {
        this.elements.riskBtns.forEach(btn => {
          btn.addEventListener('click', () => {
            const raw = (btn.dataset.risk || 'medium').toLowerCase();
            this.risk = raw === 'med' ? 'medium' : raw;
            this.elements.riskBtns.forEach(b => {
              const r = (b.dataset.risk || '').toLowerCase();
              const norm = r === 'med' ? 'medium' : r;
              b.classList.toggle('active', norm === this.risk);
            });
          });
        });
      }

      // Row count selector
      if (this.elements.rowsBtns) {
        this.elements.rowsBtns.forEach(btn => {
          btn.addEventListener('click', () => {
            const val = parseInt(btn.dataset.rows, 10);
            if (!isNaN(val) && [8, 10, 12, 14, 16].includes(val)) {
              this.rows = val;
              this.bucketSprings = new Array(val + 1).fill(0);
              this.elements.rowsBtns.forEach(b => b.classList.toggle('active', parseInt(b.dataset.rows, 10) === val));
            }
          });
        });
      }

      // Burst selector (1, 3, 5, 10)
      if (this.elements.burstBtns) {
        this.elements.burstBtns.forEach(btn => {
          btn.addEventListener('click', () => {
            const val = parseInt(btn.dataset.burst, 10);
            if (!isNaN(val) && [1, 3, 5, 10].includes(val)) {
              this.burstCount = val;
              this.elements.burstBtns.forEach(b => b.classList.toggle('active', parseInt(b.dataset.burst, 10) === val));
              this.updateControlsUI();
            }
          });
        });
      }

      // Bet amount input
      if (this.elements.betInput) {
        this.elements.betInput.addEventListener('input', () => {
          const parsed = parseInt(this.elements.betInput.value, 10);
          if (!isNaN(parsed)) {
            this.betAmount = Math.max(this.minBet, Math.min(this.maxBet, parsed));
            this.updateTotalBetLabel();
          }
        });
        this.elements.betInput.addEventListener('change', () => {
          const parsed = parseInt(this.elements.betInput.value, 10);
          this.setBetAmount(isNaN(parsed) ? this.minBet : parsed);
        });
      }

      if (this.elements.btnHalf) {
        this.elements.btnHalf.addEventListener('click', () => {
          this.setBetAmount(Math.max(this.minBet, Math.floor(this.betAmount / 2)));
        });
      }

      if (this.elements.btnDouble) {
        this.elements.btnDouble.addEventListener('click', () => {
          const playerChips = this.getAvailableChips();
          const cap = playerChips > 0 ? Math.min(this.maxBet, Math.floor(playerChips / this.burstCount)) : this.maxBet;
          this.setBetAmount(Math.max(this.minBet, Math.min(cap || this.maxBet, this.betAmount * 2)));
        });
      }

      if (this.elements.btnMax) {
        this.elements.btnMax.addEventListener('click', () => {
          const playerChips = this.getAvailableChips();
          const perBall = Math.floor(playerChips / this.burstCount);
          const nextBet = Math.max(this.minBet, Math.min(this.maxBet, perBall));
          this.setBetAmount(nextBet);
        });
      }

      if (this.elements.quickChips) {
        this.elements.quickChips.forEach(btn => {
          btn.addEventListener('click', () => {
            const addVal = parseInt(btn.dataset.add, 10) || 0;
            this.setBetAmount(this.betAmount + addVal);
          });
        });
      }

      // Primary Drop Button - instant trigger for tactile spam clicking
      if (this.elements.btnDrop) {
        this.elements.btnDrop.addEventListener('click', () => {
          this.triggerDrop();
        });
      }

      // Spacebar shortcut when Plinko view is active
      if (typeof document !== 'undefined') {
        document.addEventListener('keydown', (e) => {
          if (e.code === 'Space' && this.isViewActive()) {
            const tag = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            e.preventDefault();
            this.triggerDrop();
          }
        });

        // Flush pending hold safely if tab becomes visible after background throttling
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) {
            this.settleExpiredBalls();
          }
        });
      }
    }

    bindNetworkEvents() {
      if (!this.network) return;

      this.network.on('plinko_state', (data) => {
        if (!data) return;
        if (data.multiplierTables) {
          this.multiplierTables = data.multiplierTables;
        }
        if (typeof data.minBet === 'number') this.minBet = data.minBet;
        if (typeof data.maxBet === 'number') this.maxBet = data.maxBet;
        if (Array.isArray(data.recentDrops)) {
          this.recentDrops = data.recentDrops.slice(0, 25);
          this.renderHistoryStrip();
          this.renderLiveFeed();
        }
      });

      this.network.on('plinko_drop_accepted', (data) => {
        if (!data || !Array.isArray(data.drops)) return;
        let addedHold = 0;
        const now = performance.now();

        data.drops.forEach((drop, idx) => {
          this.spawnedDropIds.add(drop.id);
          addedHold += (drop.payout || 0);
          this.enqueueBall(drop, true, now + idx * 65);
        });

        this.pendingPayoutHold += addedHold;

        if (typeof data.newChips === 'number' && this.ui && this.ui.myPlayer) {
          this.ui.myPlayer.chips = data.newChips;
          if (data.stats) {
            this.ui.myPlayer.stats = data.stats;
            if (typeof this.ui.renderMyProfile === 'function') {
              this.ui.renderMyProfile();
            }
          }
          if (typeof this.ui.updatePlayerHUD === 'function') {
            this.ui.updatePlayerHUD();
          }
        }
      });

      this.network.on('plinko_ball_dropped', (data) => {
        if (!data || !Array.isArray(data.drops)) return;
        const myId = (this.ui && this.ui.myPlayer && this.ui.myPlayer.id) || (this.network && this.network.myPlayerId);
        const now = performance.now();

        let otherIndex = 0;
        data.drops.forEach((drop) => {
          if (this.spawnedDropIds.has(drop.id)) {
            this.spawnedDropIds.delete(drop.id);
            return;
          }
          const isSelf = myId && drop.playerId === myId;
          this.enqueueBall(drop, isSelf, now + otherIndex * 65);
          otherIndex += 1;
        });

        // Clean old set entries to keep memory tiny
        if (this.spawnedDropIds.size > 200) {
          this.spawnedDropIds.clear();
        }
      });

      this.network.on('plinko_drop_rejected', (data) => {
        const msg = (data && data.reason) || 'Worp geweigerd.';
        const isRecovering = data && data.code === 'PLAYER_NOT_FOUND' && this.network && typeof this.network.hasStoredCredentials === 'function' && this.network.hasStoredCredentials();
        if (this.ui && typeof this.ui.showToast === 'function') {
          this.ui.showToast(isRecovering ? 'Sessie wordt hersteld, probeer zo opnieuw...' : msg, isRecovering ? 'info' : 'error');
        }
      });
    }

    isViewActive() {
      return !!(this.elements.view && this.elements.view.classList.contains('active') && !this.elements.view.classList.contains('hidden'));
    }

    onViewActivated() {
      this.resizeCanvas();
      this.updateControlsUI();
      if (this.ui && typeof this.ui.updatePhase === 'function') {
        this.ui.updatePhase('PLINKO_READY', 0, 'LIVE');
      }
    }

    getAvailableChips() {
      const total = (this.ui && this.ui.myPlayer && typeof this.ui.myPlayer.chips === 'number')
        ? this.ui.myPlayer.chips
        : 0;
      return Math.max(0, total - this.pendingPayoutHold);
    }

    setBetAmount(amount) {
      const clamped = Math.max(this.minBet, Math.min(this.maxBet, Math.round(Number(amount) || this.minBet)));
      this.betAmount = clamped;
      this.updateControlsUI();
    }

    updateTotalBetLabel() {
      if (this.elements.totalBetDisplay) {
        const total = this.betAmount * this.burstCount;
        this.elements.totalBetDisplay.textContent = `${total.toLocaleString()} fiches`;
      }
      if (this.elements.btnDrop) {
        this.elements.btnDrop.textContent = this.burstCount > 1
          ? `LAAT ${this.burstCount} BALLEN VALLEN`
          : 'LAAT BAL VALLEN';
      }
    }

    updateControlsUI() {
      if (this.elements.betInput && document.activeElement !== this.elements.betInput) {
        this.elements.betInput.value = String(this.betAmount);
      }
      this.updateTotalBetLabel();
      this.updateInflightCounter();
    }

    updateInflightCounter() {
      if (this.elements.inflightCount) {
        const myBalls = this.balls.filter(b => b.isSelf && !b.landed).length;
        this.elements.inflightCount.textContent = String(myBalls);
      }
    }

    triggerDrop() {
      if (!this.network) return;
      const totalBet = this.betAmount * this.burstCount;
      const available = this.getAvailableChips();

      if (available < totalBet) {
        if (this.ui && typeof this.ui.showToast === 'function') {
          this.ui.showToast(`Onvoldoende fiches (nodig: ${totalBet.toLocaleString()})`, 'error');
        }
        return;
      }

      this.network.plinkoDrop({
        amount: this.betAmount,
        rows: this.rows,
        risk: this.risk,
        count: this.burstCount
      });
    }

    enqueueBall(drop, isSelf, launchAt) {
      if (!drop || !Array.isArray(drop.path)) return;

      // Also sync active rows if player had auto-synced drops, keeping non-blocking per-ball row geometry
      const rCount = drop.rows || this.rows;
      const stepDurationMs = rCount >= 14 ? 115 : (rCount >= 12 ? 128 : 142);

      // Compute exact offsetX waypoints for each stage r = 0..R
      const waypoints = [0];
      let offset = 0;
      for (let i = 0; i < rCount; i++) {
        const dir = drop.path[i] === 1 ? 0.5 : -0.5;
        offset += dir;
        waypoints.push(offset);
      }

      this.balls.push({
        id: drop.id,
        drop,
        isSelf: !!isSelf,
        color: drop.playerColor || '#D4AF37',
        monogram: getMonogram(drop.playerName),
        rows: rCount,
        path: drop.path,
        waypoints,
        slotIndex: drop.slotIndex,
        multiplier: drop.multiplier,
        payout: drop.payout || 0,
        launchAt,
        preDropMs: 95,
        stepDurationMs,
        lastTriggeredStep: -1,
        landed: false,
        fadeAlpha: 1,
        trail: []
      });

      this.updateInflightCounter();

      // Guarantee safety payout release in case canvas stays off-screen / backgrounded
      const totalFlightMs = Math.max(400, (launchAt - performance.now()) + 95 + rCount * stepDurationMs + 150);
      setTimeout(() => {
        const target = this.balls.find(b => b.id === drop.id);
        if (target && !target.landed) {
          this.onBallLand(target);
        }
      }, totalFlightMs + 250);
    }

    setupCanvasResize() {
      this.resizeCanvas();
      if (typeof ResizeObserver !== 'undefined' && this.elements.stage) {
        this.resizeObserver = new ResizeObserver(() => {
          this.resizeCanvas();
        });
        this.resizeObserver.observe(this.elements.stage);
      } else if (typeof window !== 'undefined') {
        window.addEventListener('resize', () => this.resizeCanvas());
      }
    }

    resizeCanvas() {
      if (!this.canvas || !this.elements.stage) return;
      const rect = this.elements.stage.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.width = rect.width;
      this.height = rect.height;
      this.canvas.width = Math.round(rect.width * this.dpr);
      this.canvas.height = Math.round(rect.height * this.dpr);
    }

    computeGeometry(rows) {
      const w = this.width || 640;
      const h = this.height || 460;

      const padTop = Math.max(30, h * 0.08);
      const bucketH = Math.max(24, Math.min(34, h * 0.075));
      const padBottom = Math.max(14, h * 0.04) + bucketH;
      const usableH = Math.max(120, h - padTop - padBottom);
      const pegGapY = usableH / rows;

      const maxHorizontalSpan = Math.min(w - 36, usableH * 1.38);
      const pegGapX = maxHorizontalSpan / (rows + 2.2);
      const centerX = w / 2;
      const pegRadius = Math.max(2.6, Math.min(5.2, pegGapX * 0.145));
      const ballRadius = Math.max(4.5, Math.min(9.5, pegGapX * 0.25));

      const rowY = (r) => padTop + r * pegGapY;
      const bucketY = padTop + rows * pegGapY + Math.max(6, pegGapY * 0.22);

      return {
        w,
        h,
        centerX,
        padTop,
        pegGapX,
        pegGapY,
        pegRadius,
        ballRadius,
        bucketH,
        rowY,
        bucketY
      };
    }

    startLoop() {
      const tick = (now) => {
        const dt = this.lastFrameTime ? Math.min(0.05, (now - this.lastFrameTime) / 1000) : 0.016;
        this.lastFrameTime = now;
        this.update(now, dt);
        if (this.isViewActive()) {
          this.render(now);
        }
        this.animFrameId = requestAnimationFrame(tick);
      };
      this.animFrameId = requestAnimationFrame(tick);
    }

    settleExpiredBalls() {
      const now = performance.now();
      for (const b of this.balls) {
        if (b.landed) continue;
        const finishTime = b.launchAt + b.preDropMs + b.rows * b.stepDurationMs;
        if (now >= finishTime) {
          this.onBallLand(b);
        }
      }
    }

    update(now, dt) {
      // Decay peg flashes
      for (const [key, val] of this.pegFlashes.entries()) {
        const next = val - dt * 3.8;
        if (next <= 0) {
          this.pegFlashes.delete(key);
        } else {
          this.pegFlashes.set(key, next);
        }
      }

      // Decay nozzle and board glow
      if (this.nozzleFlash > 0) this.nozzleFlash = Math.max(0, this.nozzleFlash - dt * 4);
      if (this.boardGlow > 0) this.boardGlow = Math.max(0, this.boardGlow - dt * 2.2);

      // Decay bucket springs
      for (let i = 0; i < this.bucketSprings.length; i++) {
        if (this.bucketSprings[i] > 0) {
          this.bucketSprings[i] = Math.max(0, this.bucketSprings[i] - dt * 4.5);
        }
      }

      // Update ripples
      for (let i = this.ripples.length - 1; i >= 0; i--) {
        const rp = this.ripples[i];
        rp.progress += dt * 3.4;
        if (rp.progress >= 1) {
          this.ripples.splice(i, 1);
        }
      }

      // Update sparks/fountain particles
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += p.gravity * dt;
        p.life -= dt / p.maxLife;
        if (p.life <= 0) {
          this.particles.splice(i, 1);
        }
      }

      // Update floating popups
      for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
        const ft = this.floatingTexts[i];
        ft.y += ft.vy * dt;
        ft.life -= dt / ft.maxLife;
        if (ft.life <= 0) {
          this.floatingTexts.splice(i, 1);
        }
      }

      // Update balls
      const geo = this.computeGeometry(this.rows);

      for (let i = this.balls.length - 1; i >= 0; i--) {
        const b = this.balls[i];
        if (b.landed) {
          b.fadeAlpha -= dt * 3.5;
          if (b.fadeAlpha <= 0) {
            this.balls.splice(i, 1);
          }
          continue;
        }

        if (now < b.launchAt) continue;

        const bGeo = b.rows === this.rows ? geo : this.computeGeometry(b.rows);
        const elapsed = now - b.launchAt;

        if (b.lastTriggeredStep === -1) {
          this.nozzleFlash = 1;
        }

        if (elapsed < b.preDropMs) {
          const tPre = Math.max(0, Math.min(1, elapsed / b.preDropMs));
          const x = bGeo.centerX;
          const startY = Math.max(8, bGeo.padTop - bGeo.pegGapY * 0.9);
          const endY = bGeo.rowY(0) - bGeo.pegRadius - bGeo.ballRadius;
          const y = startY + (endY - startY) * (tPre * tPre);
          b.x = x;
          b.y = y;
          b.trail.push({ x, y });
          if (b.trail.length > 10) b.trail.shift();
          continue;
        }

        const bounceElapsed = elapsed - b.preDropMs;
        const stepFloat = bounceElapsed / b.stepDurationMs;

        if (stepFloat >= b.rows) {
          b.x = bGeo.centerX + b.waypoints[b.rows] * bGeo.pegGapX;
          b.y = bGeo.bucketY;
          this.onBallLand(b);
          continue;
        }

        const step = Math.floor(stepFloat);
        const t = stepFloat - step;

        // Trigger peg hit visual when entering a new peg row
        if (step > b.lastTriggeredStep) {
          b.lastTriggeredStep = step;
          if (b.rows === this.rows && this.isViewActive()) {
            let rightsSoFar = 0;
            for (let k = 0; k < step; k++) rightsSoFar += b.path[k];
            const colIndex = 1 + rightsSoFar;
            const pegKey = `${step}_${colIndex}`;
            this.pegFlashes.set(pegKey, 1.0);

            const pegX = bGeo.centerX + b.waypoints[step] * bGeo.pegGapX;
            const pegY = bGeo.rowY(step);
            this.spawnPegImpactFX(pegX, pegY, b.color, b.isSelf);
          }
        }

        const startOff = b.waypoints[step];
        const endOff = b.waypoints[step + 1];
        const dirSign = endOff >= startOff ? 1 : -1;

        // Organic smooth horizontal curve + subtle outward bounce
        const easeX = 1 - Math.pow(1 - t, 1.85);
        const xOff = startOff + (endOff - startOff) * easeX + Math.sin(t * Math.PI) * dirSign * 0.06;

        const y0 = bGeo.rowY(step) - bGeo.pegRadius - bGeo.ballRadius * 0.65;
        const y1 = (step + 1 < b.rows)
          ? (bGeo.rowY(step + 1) - bGeo.pegRadius - bGeo.ballRadius * 0.65)
          : bGeo.bucketY;

        const bounceLift = Math.sin(t * Math.PI) * Math.min(13, bGeo.pegGapY * 0.36);
        const y = y0 + (y1 - y0) * (t * t) - bounceLift;
        const x = bGeo.centerX + xOff * bGeo.pegGapX;

        b.x = x;
        b.y = y;
        b.trail.push({ x, y });
        if (b.trail.length > 10) b.trail.shift();
      }
    }

    spawnPegImpactFX(x, y, color, isSelf) {
      if (this.ripples.length < 40) {
        this.ripples.push({ x, y, progress: 0, color: isSelf ? color : '#d4af37' });
      }
      const count = isSelf ? 5 : 2;
      for (let i = 0; i < count && this.particles.length < 320; i++) {
        const angle = -Math.PI + Math.random() * Math.PI * 2;
        const speed = 35 + Math.random() * 85;
        this.particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 25,
          gravity: 220,
          radius: 1.5 + Math.random() * 1.8,
          color: Math.random() < 0.55 ? '#f9e79f' : color,
          life: 1,
          maxLife: 0.28 + Math.random() * 0.16
        });
      }
    }

    onBallLand(ball) {
      if (ball.landed) return;
      ball.landed = true;
      this.updateInflightCounter();

      const geo = this.computeGeometry(this.rows);
      const mult = ball.multiplier;
      const slotX = geo.centerX + (ball.slotIndex - ball.rows / 2) * geo.pegGapX;
      const slotY = geo.bucketY;

      // Only trigger canvas bucket springs & particle burst if board row matches
      if (ball.rows === this.rows) {
        this.bucketSprings[ball.slotIndex] = 1.0;

        const theme = getBucketTheme(mult);
        const isBig = mult >= 10;
        const isWin = ball.payout > ball.drop.amount;
        if (isBig) this.boardGlow = 1.0;

        const burstCount = isBig ? 42 : (isWin ? 16 : 8);
        for (let i = 0; i < burstCount && this.particles.length < 360; i++) {
          const angle = -Math.PI * 0.92 + Math.random() * (Math.PI * 0.84);
          const speed = (isBig ? 140 : 75) + Math.random() * (isBig ? 220 : 110);
          this.particles.push({
            x: slotX,
            y: slotY + 4,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 40,
            gravity: 340,
            radius: (isBig ? 2.4 : 1.7) + Math.random() * 2.2,
            color: i % 3 === 0 ? '#ffffff' : (i % 2 === 0 ? '#facc15' : theme.border),
            life: 1,
            maxLife: isBig ? 0.78 + Math.random() * 0.35 : 0.42 + Math.random() * 0.22
          });
        }

        // Floating popup label
        if (ball.isSelf || mult >= 5) {
          const label = ball.payout > 0
            ? `+${ball.payout.toLocaleString()} (${mult}x)`
            : `${mult}x`;
          this.floatingTexts.push({
            x: slotX,
            y: slotY - 6,
            vy: -42,
            text: label,
            color: isBig ? '#fde047' : (isWin ? '#34d399' : '#e2e8f0'),
            bold: isBig || isWin,
            life: 1,
            maxLife: isBig ? 1.35 : 0.9
          });
        }
      }

      // Release held payout back into HUD at exact landing frame
      if (ball.isSelf && ball.payout > 0) {
        this.pendingPayoutHold = Math.max(0, this.pendingPayoutHold - ball.payout);
        this.lastSelfWin = ball.payout;
        if (this.elements.lastWin) {
          this.elements.lastWin.textContent = `+${ball.payout.toLocaleString()}`;
        }
        if (this.ui && typeof this.ui.updatePlayerHUD === 'function') {
          this.ui.updatePlayerHUD();
        }
        if (mult >= 10) {
          this.showJackpotBanner(mult, ball.payout);
          if (this.ui && typeof this.ui.triggerWinShimmer === 'function') {
            this.ui.triggerWinShimmer(mult >= 50 ? 3200 : 2200);
          }
        }
      }

      // Record in visible recent history ribbon & live drops feed
      this.recentDrops.unshift(ball.drop);
      if (this.recentDrops.length > 25) {
        this.recentDrops.length = 25;
      }
      this.renderHistoryStrip();
      this.renderLiveFeed();
    }

    showJackpotBanner(mult, payout) {
      if (!this.elements.jackpotBanner) return;
      if (this.jackpotHideTimer) {
        clearTimeout(this.jackpotHideTimer);
        this.jackpotHideTimer = null;
      }
      const kicker = mult >= 100 ? 'ROYAL JACKPOT' : (mult >= 25 ? 'MEGA MULTIPLIER' : 'GRAND HIT');
      if (this.elements.jackpotKicker) this.elements.jackpotKicker.textContent = kicker;
      if (this.elements.jackpotMult) this.elements.jackpotMult.textContent = `${mult}x`;
      if (this.elements.jackpotPayout) this.elements.jackpotPayout.textContent = `+${payout.toLocaleString()} fiches`;

      this.elements.jackpotBanner.classList.remove('hidden');
      this.jackpotHideTimer = setTimeout(() => {
        if (this.elements.jackpotBanner) {
          this.elements.jackpotBanner.classList.add('hidden');
        }
      }, 2400);
    }

    renderHistoryStrip() {
      const strip = this.elements.historyStrip;
      if (!strip) return;
      strip.innerHTML = '';

      const slice = this.recentDrops.slice(0, 14);
      slice.forEach((drop) => {
        const pill = document.createElement('span');
        const theme = getBucketTheme(drop.multiplier);
        pill.className = `plinko-mult-pill ${theme.pillClass}`;
        pill.textContent = `${drop.multiplier}x`;
        pill.title = `${drop.playerName} | Inzet ${drop.amount} -> ${drop.payout} fiches (${drop.rows} rijen)`;
        strip.appendChild(pill);
      });
    }

    renderLiveFeed() {
      const feed = this.elements.liveFeed;
      if (!feed) return;
      feed.innerHTML = '';

      if (!this.recentDrops || this.recentDrops.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'plinko-feed-empty';
        empty.textContent = 'Laat een bal vallen om de actie te starten';
        feed.appendChild(empty);
        return;
      }

      this.recentDrops.slice(0, 12).forEach((drop) => {
        const row = document.createElement('div');
        const isProfit = drop.payout > drop.amount;
        const isHigh = drop.multiplier >= 10;
        row.className = `plinko-feed-row ${isHigh ? 'is-high' : (isProfit ? 'is-win' : 'is-loss')}`;

        const who = document.createElement('div');
        who.className = 'plinko-feed-player';
        const dot = document.createElement('span');
        dot.className = 'plinko-feed-dot';
        dot.style.backgroundColor = drop.playerColor || '#D4AF37';
        const nameEl = document.createElement('span');
        nameEl.className = 'plinko-feed-name';
        nameEl.textContent = drop.playerName || 'Speler';
        who.appendChild(dot);
        who.appendChild(nameEl);

        const multEl = document.createElement('span');
        const theme = getBucketTheme(drop.multiplier);
        multEl.className = `plinko-feed-mult ${theme.pillClass}`;
        multEl.textContent = `${drop.multiplier}x`;

        const payEl = document.createElement('span');
        payEl.className = 'plinko-feed-payout';
        payEl.textContent = `${drop.payout.toLocaleString()}`;

        row.appendChild(who);
        row.appendChild(multEl);
        row.appendChild(payEl);
        feed.appendChild(row);
      });
    }

    render(now) {
      if (!this.ctx || !this.canvas) return;
      const ctx = this.ctx;
      const w = this.width;
      const h = this.height;
      if (w <= 0 || h <= 0) return;

      ctx.save();
      ctx.scale(this.dpr, this.dpr);
      ctx.clearRect(0, 0, w, h);

      const rows = this.rows;
      const geo = this.computeGeometry(rows);

      // 1. Subtle Obsidian radial felt glow
      const bgGrad = ctx.createRadialGradient(geo.centerX, h * 0.45, 20, geo.centerX, h * 0.5, Math.max(w, h) * 0.7);
      bgGrad.addColorStop(0, this.boardGlow > 0.05 ? `rgba(212, 175, 55, ${0.16 * this.boardGlow})` : 'rgba(212, 175, 55, 0.05)');
      bgGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // 2. Top Nozzle Gate
      const nozzleY = Math.max(10, geo.padTop - geo.pegGapY * 0.92);
      ctx.save();
      const nzAlpha = 0.35 + 0.65 * this.nozzleFlash;
      ctx.strokeStyle = `rgba(238, 213, 162, ${nzAlpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(geo.centerX - 18, nozzleY - 8, 36, 12, 6) : ctx.rect(geo.centerX - 18, nozzleY - 8, 36, 12);
      ctx.stroke();
      if (this.nozzleFlash > 0.05) {
        const g = ctx.createRadialGradient(geo.centerX, nozzleY, 1, geo.centerX, nozzleY, 26);
        g.addColorStop(0, `rgba(250, 204, 21, ${0.65 * this.nozzleFlash})`);
        g.addColorStop(1, 'rgba(250, 204, 21, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(geo.centerX, nozzleY, 26, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // 3. Draw Pyramid Pegs (row r has r + 3 pegs)
      for (let r = 0; r < rows; r++) {
        const y = geo.rowY(r);
        const count = r + 3;
        for (let c = 0; c < count; c++) {
          const offsetX = c - (r + 2) / 2;
          const x = geo.centerX + offsetX * geo.pegGapX;
          const flash = this.pegFlashes.get(`${r}_${c}`) || 0;

          if (flash > 0.02) {
            const halo = ctx.createRadialGradient(x, y, 0, x, y, geo.pegRadius * 3.8);
            halo.addColorStop(0, `rgba(253, 224, 71, ${0.85 * flash})`);
            halo.addColorStop(1, 'rgba(212, 175, 55, 0)');
            ctx.fillStyle = halo;
            ctx.beginPath();
            ctx.arc(x, y, geo.pegRadius * 3.8, 0, Math.PI * 2);
            ctx.fill();
          }

          ctx.fillStyle = flash > 0.3 ? '#fef08a' : '#e2e8f0';
          ctx.beginPath();
          ctx.arc(x, y, geo.pegRadius + flash * 1.3, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = flash > 0.1 ? 'rgba(250, 204, 21, 0.9)' : 'rgba(212, 175, 55, 0.45)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // 4. Expanding Peg Ripples
      for (const rp of this.ripples) {
        const radius = geo.pegRadius + rp.progress * Math.max(12, geo.pegGapX * 0.55);
        const alpha = (1 - rp.progress) * 0.7;
        ctx.strokeStyle = hexToRgba(rp.color, alpha);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(rp.x, rp.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 5. Multiplier Buckets at Bottom
      const riskTable = (this.multiplierTables[rows] && this.multiplierTables[rows][this.risk])
        || DEFAULT_MULTIPLIER_TABLES[rows][this.risk];
      const binW = Math.max(16, geo.pegGapX * 0.88);
      const binH = geo.bucketH;
      const fontSize = Math.max(8.5, Math.min(12.5, binW * 0.34));

      for (let slot = 0; slot <= rows; slot++) {
        const mult = riskTable[slot];
        const theme = getBucketTheme(mult);
        const spring = this.bucketSprings[slot] || 0;
        const pressY = Math.sin(spring * Math.PI) * 6;
        const bx = geo.centerX + (slot - rows / 2) * geo.pegGapX - binW / 2;
        const by = geo.bucketY + pressY;

        ctx.save();
        if (spring > 0.05 || mult >= 100) {
          ctx.shadowColor = theme.glow;
          ctx.shadowBlur = spring > 0.05 ? 18 : 8;
        }
        ctx.fillStyle = spring > 0.25 ? theme.border : theme.bg;
        ctx.strokeStyle = theme.border;
        ctx.lineWidth = spring > 0.2 ? 2 : 1.25;

        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(bx, by, binW, binH, 6);
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.fillRect(bx, by, binW, binH);
          ctx.strokeRect(bx, by, binW, binH);
        }

        ctx.shadowBlur = 0;
        ctx.fillStyle = spring > 0.25 ? '#0a0f0d' : theme.text;
        ctx.font = `800 ${fontSize}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = mult >= 100 ? `${mult}` : `${mult}x`;
        ctx.fillText(label, bx + binW / 2, by + binH / 2 + 0.5);
        ctx.restore();
      }

      // 6. Active Balls & Glowing Comet Trails
      for (const b of this.balls) {
        if (b.x === undefined || b.y === undefined) continue;
        const alpha = b.landed ? Math.max(0, b.fadeAlpha) : 1;
        if (alpha <= 0) continue;

        ctx.save();
        ctx.globalAlpha = b.isSelf ? alpha : alpha * 0.72;

        // Draw trail
        if (b.trail.length > 1) {
          for (let tIdx = 1; tIdx < b.trail.length; tIdx++) {
            const frac = tIdx / b.trail.length;
            const prev = b.trail[tIdx - 1];
            const curr = b.trail[tIdx];
            ctx.strokeStyle = hexToRgba(b.color, frac * (b.isSelf ? 0.55 : 0.28));
            ctx.lineWidth = geo.ballRadius * frac * 1.45;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(curr.x, curr.y);
            ctx.stroke();
          }
        }

        const r = b.isSelf ? geo.ballRadius : geo.ballRadius * 0.85;

        // Outer halo for own balls
        if (b.isSelf) {
          const halo = ctx.createRadialGradient(b.x, b.y, r * 0.3, b.x, b.y, r * 2.4);
          halo.addColorStop(0, hexToRgba(b.color, 0.5));
          halo.addColorStop(1, hexToRgba(b.color, 0));
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(b.x, b.y, r * 2.4, 0, Math.PI * 2);
          ctx.fill();
        }

        // Specular 3D pearl orb
        const orbGrad = ctx.createRadialGradient(b.x - r * 0.3, b.y - r * 0.3, r * 0.12, b.x, b.y, r);
        orbGrad.addColorStop(0, '#ffffff');
        orbGrad.addColorStop(0.35, b.color);
        orbGrad.addColorStop(1, '#111827');
        ctx.fillStyle = orbGrad;
        ctx.beginPath();
        ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }

      // 7. Sparks & Jackpot Fountain Particles
      for (const p of this.particles) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 8. Floating Score Popups
      for (const ft of this.floatingTexts) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, ft.life * 1.4));
        ctx.font = `${ft.bold ? 800 : 700} ${ft.bold ? 13 : 11}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
        ctx.fillText(ft.text, ft.x + 1, ft.y + 1);
        ctx.fillStyle = ft.color;
        ctx.fillText(ft.text, ft.x, ft.y);
        ctx.restore();
      }

      ctx.restore();
    }
  }

  return CasinoPlinko;
}));
