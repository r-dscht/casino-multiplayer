/**
 * cross.js
 * Client controller & zero-lag 60 FPS Canvas renderer for Monte Carlo Boulevard Cross.
 * Pure visual presentation synced strictly to authoritative Socket.IO CrossEngine state.
 * Zero audio, zero Unicode emojis, zero banned brand terms.
 */

(function (global) {
  'use strict';

  const DEFAULT_SURVIVAL = 0.80;
  const DEFAULT_TARGET_RTP = 0.98;
  const MAX_MULT = 10000;

  const VEHICLE_PALETTES = {
    F1_GOLD: { body: '#e5c158', accent: '#997a1f', cabin: '#171923', stripe: '#fff2b2', glow: 'rgba(229,193,88,0.28)' },
    GT_CRIMSON: { body: '#d93848', accent: '#7c1722', cabin: '#11131a', stripe: '#f8fafc', glow: 'rgba(217,56,72,0.28)' },
    LIMO_OBSIDIAN: { body: '#1f2433', accent: '#d4af37', cabin: '#0c0e15', stripe: '#d4af37', glow: 'rgba(212,175,55,0.20)' },
    SUPERCAR_EMERALD: { body: '#10b981', accent: '#065f46', cabin: '#0c1317', stripe: '#a7f3d0', glow: 'rgba(16,185,129,0.26)' },
    COUPE_SILVER: { body: '#cbd5e1', accent: '#64748b', cabin: '#131722', stripe: '#e2e8f0', glow: 'rgba(203,213,225,0.24)' }
  };

  function calcClientMultiplier(lane) {
    if (!Number.isInteger(lane) || lane <= 0) return 1.0;
    const joint = Math.pow(DEFAULT_SURVIVAL, lane);
    if (joint <= 0) return MAX_MULT;
    let m = Math.floor((DEFAULT_TARGET_RTP / joint) * 100) / 100;
    m = Math.min(MAX_MULT, Math.max(1.0, m));
    while (m > 1.0 && m * joint > DEFAULT_TARGET_RTP + 1e-12) {
      m = Math.round((m - 0.01) * 100) / 100;
    }
    return m;
  }

  function formatChips(num) {
    return `${Math.round(Number(num) || 0).toLocaleString()} F`;
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  class CasinoCross {
    constructor({ network, ui }) {
      this.network = network;
      this.ui = ui;

      this.minBet = 10;
      this.maxBet = 50000;
      this.activeRun = null;
      this.salonPlayers = [];
      this.recentWins = [];
      this.myHistory = [];
      this.historyTab = 'mine';

      this.sessionNet = 0;
      this.lastWinAmount = 0;
      this.lastBetAmount = 100;

      // View & loop lifecycle
      this._viewActive = false;
      this._rafId = 0;
      this._lastFrameMs = 0;

      // Canvas & camera layout
      this.canvas = null;
      this.ctx = null;
      this.dpr = 1;
      this.viewW = 860;
      this.viewH = 420;
      this.sidewalkW = 148;
      this.laneW = 112;
      this.camX = 0;
      this.targetCamX = 0;
      this.hoverNextLane = false;

      // Player animation state
      this.playerLanePos = 0;
      this.fromLanePos = 0;
      this.toLanePos = 0;
      this.hopProgress = 1;
      this.hopDuration = 0.24;
      this.isCrashed = false;
      this.crashLane = 0;
      this.shakeTimer = 0;
      this.flashColor = '';
      this.flashAlpha = 0;
      this._stepPending = false;
      this._startPending = false;
      this._cashoutPending = false;

      // Ambient & crash traffic pools (keyed by lane number)
      this.laneTraffic = new Map();
      this.interceptCar = null;
      this.particles = [];
      this.floatingTexts = [];

      // Pre-rendered offscreen sprite caches
      this.carSprites = {};
      this.asphaltCanvas = null;
      this._resultHideTimer = 0;
      this._boundResize = null;
      this._boundKeyDown = null;
    }

    init() {
      this.cacheElements();
      this._buildCachedSprites();
      this.bindDOM();
      this.bindNetwork();
      this._ensureVisibleTraffic(1, 14);
      this.renderControls();
      this.renderMultiplierStrip();
      this.renderSalonPanel();
      this.renderHistoryPanel();
    }

    cacheElements() {
      this.el = {
        view: document.getElementById('cross-view'),
        stage: document.getElementById('cross-stage'),
        canvas: document.getElementById('cross-canvas'),
        multStrip: document.getElementById('cross-multiplier-strip'),
        lastWin: document.getElementById('cross-last-win'),
        sessionNet: document.getElementById('cross-session-net'),
        hudLane: document.getElementById('cross-hud-lane'),
        hudMult: document.getElementById('cross-hud-mult'),
        hudNext: document.getElementById('cross-hud-next'),
        hudPot: document.getElementById('cross-hud-pot'),
        stagePill: document.getElementById('cross-stage-pill'),
        resultBanner: document.getElementById('cross-result-banner'),
        canvasHint: document.getElementById('cross-canvas-hint'),
        betInput: document.getElementById('cross-bet-input'),
        btnStart: document.getElementById('btn-cross-start'),
        btnStep: document.getElementById('btn-cross-step'),
        btnStepSub: document.getElementById('cross-step-sub'),
        btnCashout: document.getElementById('btn-cross-cashout'),
        cashoutAmount: document.getElementById('cross-cashout-amount'),
        salonCount: document.getElementById('cross-salon-count'),
        salonList: document.getElementById('cross-salon-list'),
        historyList: document.getElementById('cross-history-list'),
        tabMine: document.getElementById('btn-cross-tab-mine'),
        tabSalon: document.getElementById('btn-cross-tab-salon')
      };
      this.canvas = this.el.canvas;
      this.ctx = this.canvas ? this.canvas.getContext('2d', { alpha: false }) : null;
    }

    _buildCachedSprites() {
      if (typeof document === 'undefined') return;

      // Offscreen car sprites (front points downward along +Y)
      Object.entries(VEHICLE_PALETTES).forEach(([type, p]) => {
        const c = document.createElement('canvas');
        c.width = 76;
        c.height = 148;
        const g = c.getContext('2d');
        const cx = 38;
        const carW = type === 'LIMO_OBSIDIAN' ? 40 : 38;
        const carL = type === 'LIMO_OBSIDIAN' ? 102 : 82;
        const bodyY = 18;
        const bodyX = cx - carW / 2;

        // Soft headlight beam ahead (+Y)
        const beamGrad = g.createLinearGradient(cx, bodyY + carL - 4, cx, bodyY + carL + 38);
        beamGrad.addColorStop(0, 'rgba(255, 244, 196, 0.34)');
        beamGrad.addColorStop(1, 'rgba(255, 244, 196, 0)');
        g.fillStyle = beamGrad;
        g.beginPath();
        g.moveTo(cx - 14, bodyY + carL - 2);
        g.lineTo(cx - 26, bodyY + carL + 36);
        g.lineTo(cx + 26, bodyY + carL + 36);
        g.lineTo(cx + 14, bodyY + carL - 2);
        g.closePath();
        g.fill();

        // Ground shadow
        g.fillStyle = 'rgba(0,0,0,0.52)';
        g.beginPath();
        g.roundRect(bodyX - 3, bodyY - 2, carW + 6, carL + 6, 12);
        g.fill();

        // Main chassis
        const bodyGrad = g.createLinearGradient(bodyX, bodyY, bodyX + carW, bodyY + carL);
        bodyGrad.addColorStop(0, p.accent);
        bodyGrad.addColorStop(0.5, p.body);
        bodyGrad.addColorStop(1, p.accent);
        g.fillStyle = bodyGrad;
        g.beginPath();
        g.roundRect(bodyX, bodyY, carW, carL, 10);
        g.fill();

        // Racing center stripe
        g.fillStyle = p.stripe;
        g.globalAlpha = 0.25;
        g.fillRect(cx - 3, bodyY + 4, 6, carL - 8);
        g.globalAlpha = 1;

        // Cabin windshield & roof
        const cabW = carW - 10;
        const cabL = type === 'LIMO_OBSIDIAN' ? 54 : 36;
        const cabY = bodyY + 18;
        g.fillStyle = p.cabin;
        g.beginPath();
        g.roundRect(cx - cabW / 2, cabY, cabW, cabL, 7);
        g.fill();

        // Glossy roof highlight
        g.fillStyle = 'rgba(255,255,255,0.12)';
        g.beginPath();
        g.roundRect(cx - cabW / 2 + 3, cabY + 6, cabW - 6, cabL - 16, 4);
        g.fill();

        // Headlights (+Y front)
        g.fillStyle = '#fef3c7';
        g.fillRect(bodyX + 4, bodyY + carL - 5, 7, 3);
        g.fillRect(bodyX + carW - 11, bodyY + carL - 5, 7, 3);

        // Taillights (-Y rear)
        g.fillStyle = '#ef4444';
        g.fillRect(bodyX + 4, bodyY + 2, 7, 3);
        g.fillRect(bodyX + carW - 11, bodyY + 2, 7, 3);

        // Chassis outline
        g.strokeStyle = 'rgba(255,255,255,0.22)';
        g.lineWidth = 1.2;
        g.beginPath();
        g.roundRect(bodyX, bodyY, carW, carL, 10);
        g.stroke();

        this.carSprites[type] = c;
      });

      // Subtle offscreen asphalt grain tile
      const ac = document.createElement('canvas');
      ac.width = 96;
      ac.height = 96;
      const ag = ac.getContext('2d');
      ag.fillStyle = '#12151f';
      ag.fillRect(0, 0, 96, 96);
      ag.fillStyle = 'rgba(255,255,255,0.022)';
      for (let i = 0; i < 64; i += 1) {
        const px = (i * 37) % 96;
        const py = (i * 53) % 96;
        ag.fillRect(px, py, 2, 2);
      }
      this.asphaltCanvas = ac;
    }

    bindDOM() {
      if (this.el.betInput) {
        this.el.betInput.addEventListener('change', () => {
          const val = this.getInputBetAmount();
          this.el.betInput.value = val;
          this.lastBetAmount = val;
          this.renderMultiplierStrip();
        });
      }

      document.querySelectorAll('[data-cross-chip]').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (this.hasActiveBets()) return;
          const amount = Number(btn.getAttribute('data-cross-chip'));
          if (Number.isFinite(amount) && this.el.betInput) {
            const clamped = Math.max(this.minBet, Math.min(this.maxBet, Math.floor(amount)));
            this.el.betInput.value = clamped;
            this.lastBetAmount = clamped;
            this.renderMultiplierStrip();
          }
        });
      });

      document.querySelectorAll('[data-cross-mod]').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (this.hasActiveBets() || !this.el.betInput) return;
          const mod = btn.getAttribute('data-cross-mod');
          const cur = this.getInputBetAmount();
          let next = cur;
          if (mod === 'half') next = Math.max(this.minBet, Math.floor(cur / 2));
          else if (mod === 'double') next = Math.min(this.maxBet, cur * 2);
          else if (mod === 'max') next = Math.min(this.maxBet, Math.max(this.minBet, Math.floor(this.network.myChips || this.maxBet)));
          this.el.betInput.value = next;
          this.lastBetAmount = next;
          this.renderMultiplierStrip();
        });
      });

      if (this.el.btnStart) {
        this.el.btnStart.addEventListener('click', () => this.startRun());
      }
      if (this.el.btnStep) {
        this.el.btnStep.addEventListener('click', () => this.stepForward());
      }
      if (this.el.btnCashout) {
        this.el.btnCashout.addEventListener('click', () => this.cashout());
      }

      if (this.el.tabMine) {
        this.el.tabMine.addEventListener('click', () => {
          this.historyTab = 'mine';
          this.renderHistoryPanel();
        });
      }
      if (this.el.tabSalon) {
        this.el.tabSalon.addEventListener('click', () => {
          this.historyTab = 'salon';
          this.renderHistoryPanel();
        });
      }

      if (this.canvas) {
        this.canvas.addEventListener('mousemove', (e) => {
          this._updateCanvasHover(e);
        });
        this.canvas.addEventListener('mouseleave', () => {
          this.hoverNextLane = false;
          if (this.canvas) this.canvas.style.cursor = 'default';
        });
        this.canvas.addEventListener('click', (e) => {
          this._updateCanvasHover(e);
          if (this.hoverNextLane && this.hasActiveBets()) {
            this.stepForward();
          }
        });
      }

      this._boundResize = () => {
        if (this._viewActive) this.resizeCanvas();
      };
      window.addEventListener('resize', this._boundResize);

      this._boundKeyDown = (e) => {
        if (!this._viewActive) return;
        if (e.code === 'Space' || e.key === ' ') {
          const activeTag = document.activeElement ? document.activeElement.tagName : '';
          if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(activeTag)) return;
          if (this.hasActiveBets()) {
            e.preventDefault();
            this.stepForward();
          }
        }
      };
      window.addEventListener('keydown', this._boundKeyDown);
    }

    bindNetwork() {
      if (!this.network || typeof this.network.on !== 'function') return;

      this.network.on('cross_state', (state) => {
        if (!state) return;
        if (typeof state.minBet === 'number') this.minBet = state.minBet;
        if (typeof state.maxBet === 'number') this.maxBet = state.maxBet;
        this.activeRun = state.activeRun || null;
        this.salonPlayers = Array.isArray(state.salonPlayers) ? state.salonPlayers : [];
        this.recentWins = Array.isArray(state.recentWins) ? state.recentWins : [];
        this.myHistory = Array.isArray(state.myHistory) ? state.myHistory : [];

        if (this.activeRun) {
          this.isCrashed = false;
          this.playerLanePos = this.activeRun.currentLane;
          this.fromLanePos = this.activeRun.currentLane;
          this.toLanePos = this.activeRun.currentLane;
          this.hopProgress = 1;
          this._ensureVisibleTraffic(1, this.activeRun.currentLane + 14);
        }

        this._stepPending = false;
        this._startPending = false;
        this._cashoutPending = false;
        this._syncNavLock();
        this.renderControls();
        this.renderMultiplierStrip();
        this.renderSalonPanel();
        this.renderHistoryPanel();
      });

      this.network.on('cross_salon_update', (pub) => {
        if (!pub) return;
        if (Array.isArray(pub.salonPlayers)) this.salonPlayers = pub.salonPlayers;
        if (Array.isArray(pub.recentWins)) this.recentWins = pub.recentWins;
        this.renderSalonPanel();
        if (this.historyTab === 'salon') this.renderHistoryPanel();
      });

      this.network.on('cross_rejected', (err) => {
        this._stepPending = false;
        this._startPending = false;
        this._cashoutPending = false;
        this.renderControls();
        if (err && err.reason && this.ui && typeof this.ui.showToast === 'function') {
          this.ui.showToast(err.reason, 'error');
        }
      });

      this.network.on('cross_started', (res) => {
        this._startPending = false;
        if (!res || !res.ok) return;
        this.activeRun = res.run || null;
        if (res.salon) {
          this.salonPlayers = res.salon.salonPlayers || this.salonPlayers;
          this.recentWins = res.salon.recentWins || this.recentWins;
          this.myHistory = res.salon.myHistory || this.myHistory;
        }
        this.isCrashed = false;
        this.crashLane = 0;
        this.interceptCar = null;
        this.particles = [];
        this.floatingTexts = [];
        this.playerLanePos = 0;
        this.fromLanePos = 0;
        this.toLanePos = 0;
        this.hopProgress = 1;
        this.camX = 0;
        this.targetCamX = 0;
        this._hideResultBanner();
        this._ensureVisibleTraffic(1, 14);

        this._syncNavLock();
        this.renderControls();
        this.renderMultiplierStrip();
        this.renderSalonPanel();
      });

      this.network.on('cross_step_result', (res) => {
        this._stepPending = false;
        if (!res || !res.ok) return;

        if (res.salon) {
          this.salonPlayers = res.salon.salonPlayers || this.salonPlayers;
          this.recentWins = res.salon.recentWins || this.recentWins;
          this.myHistory = res.salon.myHistory || this.myHistory;
        }

        if (res.hit) {
          const hitLane = res.lane || (this.activeRun ? this.activeRun.currentLane + 1 : 1);
          const stakeLost = res.completedRun ? res.completedRun.betAmount : (this.activeRun ? this.activeRun.betAmount : 0);
          this.activeRun = null;
          this.isCrashed = true;
          this.crashLane = hitLane;
          this.fromLanePos = this.playerLanePos;
          this.toLanePos = hitLane;
          this.hopProgress = 0;
          this.hopDuration = 0.22;

          this._triggerCrashIntercept(hitLane, res.carType, res.carDirection);
          this.sessionNet -= stakeLost;
          this._showResultBanner(
            `AANGEREDEN OP BAAN ${hitLane} (-${formatChips(stakeLost)})`,
            'loss'
          );
          this._syncNavLock();
          this.renderControls();
          this.renderMultiplierStrip();
          this.renderSalonPanel();
          this.renderHistoryPanel();
          return;
        }

        // Survived step cleanly
        const targetLane = res.lane || (res.run ? res.run.currentLane : 1);
        this.fromLanePos = this.playerLanePos;
        this.toLanePos = targetLane;
        this.hopProgress = 0;
        this.hopDuration = 0.22;
        this._ensureVisibleTraffic(targetLane + 1, targetLane + 14);

        const lx = this._laneCenterX(targetLane);
        const ly = this.viewH * 0.56;
        const multLabel = res.autoCashedOut
          ? `${Number(res.multiplier || 1).toFixed(2)}x`
          : `${Number(res.run ? res.run.currentMultiplier : calcClientMultiplier(targetLane)).toFixed(2)}x`;
        this._spawnSparks(lx, ly, '#e5c158', 14);
        this._addFloatingText(lx, ly - 32, `VEILIG ${multLabel}`, '#34d399');

        if (res.autoCashedOut) {
          this.activeRun = null;
          const net = Number(res.netProfit || 0);
          this.lastWinAmount = Number(res.payout || 0);
          this.sessionNet += net;
          this._spawnSparks(lx, ly, '#34d399', 26);
          this._showResultBanner(
            `MAX LIMIET BEREIKT! +${formatChips(res.payout)} (${Number(res.multiplier).toFixed(2)}x)`,
            'win'
          );
        } else {
          this.activeRun = res.run || null;
        }

        this._syncNavLock();
        this.renderControls();
        this.renderMultiplierStrip();
        this.renderSalonPanel();
        if (res.autoCashedOut) this.renderHistoryPanel();
      });

      this.network.on('cross_cashout_result', (res) => {
        this._cashoutPending = false;
        if (!res || !res.ok) return;

        this.activeRun = null;
        if (res.salon) {
          this.salonPlayers = res.salon.salonPlayers || this.salonPlayers;
          this.recentWins = res.salon.recentWins || this.recentWins;
          this.myHistory = res.salon.myHistory || this.myHistory;
        }

        const net = Number(res.netProfit || 0);
        const payout = Number(res.payout || 0);
        this.lastWinAmount = payout;
        this.sessionNet += net;

        const lx = this._laneCenterX(this.playerLanePos);
        const ly = this.viewH * 0.56;
        this._spawnSparks(lx, ly, '#e5c158', 26);
        this._spawnSparks(lx, ly, '#34d399', 18);
        this._addFloatingText(lx, ly - 36, `+${formatChips(payout)}`, '#f5d060');
        this._showResultBanner(
          `VEILIG GECASHED! +${formatChips(payout)} (${Number(res.multiplier || 1).toFixed(2)}x)`,
          'win'
        );

        // Return VIP avatar smoothly back to safe start sidewalk
        this.fromLanePos = this.playerLanePos;
        this.toLanePos = 0;
        this.hopProgress = 0;
        this.hopDuration = 0.28;

        this._syncNavLock();
        this.renderControls();
        this.renderMultiplierStrip();
        this.renderSalonPanel();
        this.renderHistoryPanel();
      });
    }

    hasActiveBets() {
      return Boolean(this.activeRun && this.activeRun.status === 'ACTIVE');
    }

    _syncNavLock() {
      if (this.ui && typeof this.ui.setNavigationLocked === 'function') {
        this.ui.setNavigationLocked(this.hasActiveBets());
      }
      if (this._viewActive && this.ui && typeof this.ui.updatePhase === 'function') {
        this.ui.updatePhase(this.hasActiveBets() ? 'CROSS_ACTIVE' : 'CROSS_READY', 0, 'SOLO');
      }
    }

    getInputBetAmount() {
      const raw = this.el.betInput ? Math.floor(Number(this.el.betInput.value)) : this.lastBetAmount;
      if (!Number.isFinite(raw) || raw < this.minBet) return this.minBet;
      return Math.min(this.maxBet, raw);
    }

    startRun() {
      if (this.hasActiveBets() || this._startPending) return;
      const betAmount = this.getInputBetAmount();
      if (this.el.betInput) this.el.betInput.value = betAmount;
      this.lastBetAmount = betAmount;
      this._startPending = true;
      this.renderControls();
      this.network.crossStart({ betAmount });
    }

    stepForward() {
      if (!this.hasActiveBets() || this._stepPending || this._cashoutPending) return;
      if (this.hopProgress < 0.85) return;
      this._stepPending = true;
      this.renderControls();
      this.network.crossStep();
    }

    cashout() {
      if (!this.hasActiveBets() || !this.activeRun || this.activeRun.currentLane < 1) return;
      if (this._cashoutPending || this._stepPending) return;
      this._cashoutPending = true;
      this.renderControls();
      this.network.crossCashout();
    }

    onViewActivated() {
      this._viewActive = true;
      this.resizeCanvas();
      this._syncNavLock();
      this.renderControls();
      this.renderMultiplierStrip();
      this.renderSalonPanel();
      this.renderHistoryPanel();
      this._startRaf();
    }

    onViewDeactivated() {
      this._viewActive = false;
      this._stopRaf();
    }

    resizeCanvas() {
      if (!this.canvas || !this.el.stage) return;
      const rect = this.el.stage.getBoundingClientRect();
      const w = Math.max(320, Math.floor(rect.width || 860));
      const h = Math.max(240, Math.floor(rect.height || 380));
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      if (this.viewW === w && this.viewH === h && this.dpr === dpr && this.canvas.width === Math.floor(w * dpr)) {
        return;
      }
      this.viewW = w;
      this.viewH = h;
      this.dpr = dpr;
      this.canvas.width = Math.floor(w * dpr);
      this.canvas.height = Math.floor(h * dpr);
      this.laneW = w < 640 ? 86 : 112;
      this.sidewalkW = w < 640 ? 112 : 148;
    }

    _startRaf() {
      if (this._rafId) return;
      this._lastFrameMs = performance.now();
      const loop = (now) => {
        if (!this._viewActive) {
          this._rafId = 0;
          return;
        }
        const dt = Math.min(0.05, Math.max(0.001, (now - this._lastFrameMs) / 1000));
        this._lastFrameMs = now;
        this._update(dt);
        this._draw();
        this._rafId = window.requestAnimationFrame(loop);
      };
      this._rafId = window.requestAnimationFrame(loop);
    }

    _stopRaf() {
      if (this._rafId) {
        window.cancelAnimationFrame(this._rafId);
        this._rafId = 0;
      }
    }

    _laneCenterX(laneIndex) {
      if (laneIndex <= 0) return this.sidewalkW * 0.52;
      return this.sidewalkW + (laneIndex - 0.5) * this.laneW;
    }

    _updateCanvasHover(e) {
      if (!this.canvas || !this.hasActiveBets() || !this.activeRun) {
        this.hoverNextLane = false;
        if (this.canvas) this.canvas.style.cursor = 'default';
        return;
      }
      const rect = this.canvas.getBoundingClientRect();
      const xWorld = (e.clientX - rect.left) + this.camX;
      const nextLane = this.activeRun.currentLane + 1;
      const laneLeft = this.sidewalkW + (nextLane - 1) * this.laneW;
      const laneRight = laneLeft + this.laneW;
      const inside = xWorld >= laneLeft && xWorld <= laneRight;
      this.hoverNextLane = inside;
      this.canvas.style.cursor = inside ? 'pointer' : 'default';
    }

    _ensureVisibleTraffic(fromLane, toLane) {
      const types = Object.keys(VEHICLE_PALETTES);
      for (let lane = Math.max(1, fromLane); lane <= toLane; lane += 1) {
        if (this.laneTraffic.has(lane)) continue;
        const dir = lane % 2 === 0 ? 1 : -1;
        const count = 2;
        const spacing = 260 + ((lane * 37) % 70);
        const wrapH = count * spacing;
        const baseOffset = (lane * 89) % wrapH;
        const cars = [];
        for (let i = 0; i < count; i += 1) {
          let y = ((baseOffset + i * spacing) % wrapH) - 120;
          cars.push({
            y,
            speed: (125 + ((lane * 29 + i * 19) % 95)) * dir,
            type: types[(lane + i * 2) % types.length]
          });
        }
        this.laneTraffic.set(lane, { dir, cars, spacing, wrapH });
      }
      // Trim distant passed lanes behind camera to keep memory tiny
      const minKeep = Math.max(1, (this.activeRun ? this.activeRun.currentLane : Math.floor(this.playerLanePos)) - 10);
      for (const k of this.laneTraffic.keys()) {
        if (k < minKeep) this.laneTraffic.delete(k);
      }
    }

    _triggerCrashIntercept(hitLane, carType, carDir) {
      const dir = carDir === 1 || carDir === -1 ? carDir : (hitLane % 2 === 0 ? 1 : -1);
      const startY = dir > 0 ? -90 : this.viewH + 90;
      const impactY = this.viewH * 0.56;
      this.interceptCar = {
        lane: hitLane,
        type: VEHICLE_PALETTES[carType] ? carType : 'GT_CRIMSON',
        dir,
        y: startY,
        targetY: impactY,
        impactDone: false
      };
    }

    _spawnSparks(x, y, color, count) {
      for (let i = 0; i < count; i += 1) {
        const ang = (Math.PI * 2 * i) / count + Math.random() * 0.4;
        const spd = 65 + Math.random() * 145;
        this.particles.push({
          x,
          y,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd - 30,
          life: 0,
          maxLife: 0.45 + Math.random() * 0.35,
          size: 2.5 + Math.random() * 2.5,
          color
        });
      }
    }

    _addFloatingText(x, y, text, color) {
      this.floatingTexts.push({ x, y, text, color, life: 0, maxLife: 1.1 });
    }

    _update(dt) {
      // Advance hop interpolation
      if (this.hopProgress < 1) {
        this.hopProgress = Math.min(1, this.hopProgress + dt / this.hopDuration);
        const eased = 1 - Math.pow(1 - this.hopProgress, 3);
        this.playerLanePos = this.fromLanePos + (this.toLanePos - this.fromLanePos) * eased;
      } else {
        this.playerLanePos = this.toLanePos;
      }

      // Smooth forward tracking camera
      const worldX = this._laneCenterX(this.playerLanePos);
      const desiredScreenX = Math.min(this.viewW * 0.34, 290);
      this.targetCamX = Math.max(0, worldX - desiredScreenX);
      const camFactor = 1 - Math.exp(-8.5 * dt);
      this.camX += (this.targetCamX - this.camX) * camFactor;

      // Ambient traffic animation on visible lanes
      const maxPassedLane = this.activeRun ? this.activeRun.currentLane : (this.isCrashed ? this.crashLane - 1 : 0);
      const minVis = Math.max(1, Math.floor((this.camX - this.sidewalkW) / this.laneW) - 1);
      const maxVis = Math.max(minVis + 12, minVis + Math.ceil(this.viewW / this.laneW) + 3);
      this._ensureVisibleTraffic(minVis, maxVis);

      const barrierTopY = Math.max(18, this.viewH * 0.25);
      for (let lane = minVis; lane <= maxVis; lane += 1) {
        const entry = this.laneTraffic.get(lane);
        if (!entry) continue;
        const loopSpan = entry.wrapH || (this.viewH + 260);
        const blockedByBarrier = lane <= maxPassedLane;
        for (let i = 0; i < entry.cars.length; i += 1) {
          const car = entry.cars[i];
          if (blockedByBarrier) {
            // Stop smoothly behind VIP barrier if heading toward crossing zone
            if (entry.dir > 0 && car.y > barrierTopY - 95 && car.y < barrierTopY - 40) {
              continue;
            }
            if (entry.dir < 0 && car.y < this.viewH - barrierTopY + 95 && car.y > this.viewH - barrierTopY + 40) {
              continue;
            }
          }
          car.y += car.speed * dt;
          if (entry.dir > 0 && car.y > loopSpan - 120) {
            car.y -= loopSpan;
          } else if (entry.dir < 0 && car.y < -120) {
            car.y += loopSpan;
          }
        }
      }

      // Intercept crash car rush
      if (this.interceptCar) {
        const ic = this.interceptCar;
        const speed = 1350;
        ic.y += ic.dir * speed * dt;
        const reached = ic.dir > 0 ? ic.y >= ic.targetY - 12 : ic.y <= ic.targetY + 12;
        if (!ic.impactDone && reached) {
          ic.impactDone = true;
          this.shakeTimer = 0.28;
          this.flashColor = '#ef4444';
          this.flashAlpha = 0.36;
          const ix = this._laneCenterX(ic.lane);
          this._spawnSparks(ix, ic.targetY, '#ef4444', 22);
          this._spawnSparks(ix, ic.targetY, '#f5d060', 10);
          this._addFloatingText(ix, ic.targetY - 26, 'CRASH!', '#fca5a5');
        }
        if ((ic.dir > 0 && ic.y > this.viewH + 180) || (ic.dir < 0 && ic.y < -180)) {
          this.interceptCar = null;
        }
      }

      // Shake & flash decay
      if (this.shakeTimer > 0) this.shakeTimer = Math.max(0, this.shakeTimer - dt);
      if (this.flashAlpha > 0) this.flashAlpha = Math.max(0, this.flashAlpha - dt * 1.4);

      // Particles
      for (let i = this.particles.length - 1; i >= 0; i -= 1) {
        const pt = this.particles[i];
        pt.life += dt;
        if (pt.life >= pt.maxLife) {
          this.particles.splice(i, 1);
          continue;
        }
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.vy += 240 * dt;
      }

      // Floating texts
      for (let i = this.floatingTexts.length - 1; i >= 0; i -= 1) {
        const ft = this.floatingTexts[i];
        ft.life += dt;
        if (ft.life >= ft.maxLife) {
          this.floatingTexts.splice(i, 1);
          continue;
        }
        ft.y -= 36 * dt;
      }
    }

    _draw() {
      const ctx = this.ctx;
      if (!ctx) return;

      const w = this.viewW;
      const h = this.viewH;
      ctx.save();
      ctx.scale(this.dpr, this.dpr);

      // Apply impact shake offset
      if (this.shakeTimer > 0) {
        const mag = (this.shakeTimer / 0.28) * 7;
        ctx.translate((Math.random() - 0.5) * mag * 2, (Math.random() - 0.5) * mag * 2);
      }

      // Dark obsidian road base
      ctx.fillStyle = '#0d1018';
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.translate(-this.camX, 0);

      // 1. Draw VIP Golden Start Sidewalk (Lane 0)
      if (this.camX < this.sidewalkW + 40) {
        const swGrad = ctx.createLinearGradient(0, 0, this.sidewalkW, 0);
        swGrad.addColorStop(0, '#1e222f');
        swGrad.addColorStop(0.82, '#282d3e');
        swGrad.addColorStop(1, '#393320');
        ctx.fillStyle = swGrad;
        ctx.fillRect(0, 0, this.sidewalkW, h);

        // VIP carpet runner along crossing y
        const midY = h * 0.56;
        ctx.fillStyle = 'rgba(212, 175, 55, 0.16)';
        ctx.fillRect(16, midY - 34, this.sidewalkW - 22, 68);
        ctx.strokeStyle = 'rgba(212, 175, 55, 0.65)';
        ctx.lineWidth = 2;
        ctx.strokeRect(16, midY - 34, this.sidewalkW - 22, 68);

        // Golden curb edge
        ctx.fillStyle = '#d4af37';
        ctx.fillRect(this.sidewalkW - 6, 0, 6, h);

        ctx.fillStyle = '#e5c158';
        ctx.font = '700 11px "Inter", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('CASINO START', this.sidewalkW * 0.5, 28);
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.font = '600 10px "Inter", sans-serif';
        ctx.fillText('VEILIGE STOEP', this.sidewalkW * 0.5, h - 20);
      }

      // 2. Visible traffic lanes
      const minVis = Math.max(1, Math.floor((this.camX - this.sidewalkW) / this.laneW) + 1);
      const maxVis = Math.max(minVis + 6, Math.ceil((this.camX + w - this.sidewalkW) / this.laneW) + 1);
      const activeLane = this.activeRun ? this.activeRun.currentLane : (this.isCrashed ? this.crashLane - 1 : 0);
      const nextTargetLane = this.activeRun ? this.activeRun.currentLane + 1 : -1;
      const midY = h * 0.56;
      const barrierY = Math.max(20, h * 0.25);

      for (let lane = minVis; lane <= maxVis; lane += 1) {
        const lx = this.sidewalkW + (lane - 1) * this.laneW;
        const cx = lx + this.laneW * 0.5;
        const isPassed = this.activeRun ? lane <= activeLane : (this.isCrashed ? lane < this.crashLane : false);
        const isNext = lane === nextTargetLane;
        const isCrashLane = this.isCrashed && lane === this.crashLane;

        // Lane asphalt fill
        if (isCrashLane) {
          ctx.fillStyle = '#251218';
        } else if (isNext && this.hoverNextLane) {
          ctx.fillStyle = '#1b2232';
        } else if (isPassed) {
          ctx.fillStyle = '#141926';
        } else {
          ctx.fillStyle = lane % 2 === 0 ? '#10141f' : '#121623';
        }
        ctx.fillRect(lx, 0, this.laneW, h);

        // Next target lane highlight
        if (isNext) {
          ctx.fillStyle = this.hoverNextLane ? 'rgba(212, 175, 55, 0.14)' : 'rgba(212, 175, 55, 0.06)';
          ctx.fillRect(lx + 2, 0, this.laneW - 4, h);
          ctx.strokeStyle = this.hoverNextLane ? 'rgba(229, 193, 88, 0.78)' : 'rgba(212, 175, 55, 0.36)';
          ctx.lineWidth = this.hoverNextLane ? 2 : 1;
          ctx.strokeRect(lx + 2, 2, this.laneW - 4, h - 4);
        }

        // Crosswalk stripes at pedestrian level
        ctx.fillStyle = isPassed
          ? 'rgba(52, 211, 153, 0.18)'
          : isCrashLane
          ? 'rgba(239, 68, 68, 0.22)'
          : isNext
          ? 'rgba(229, 193, 88, 0.26)'
          : 'rgba(255, 255, 255, 0.08)';
        for (let sy = -24; sy <= 24; sy += 16) {
          ctx.fillRect(lx + 14, midY + sy - 4, this.laneW - 28, 7);
        }

        // Dashed lane border divider on right edge
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.lineWidth = 2;
        ctx.setLineDash([14, 14]);
        ctx.beginPath();
        ctx.moveTo(lx + this.laneW, 0);
        ctx.lineTo(lx + this.laneW, h);
        ctx.stroke();
        ctx.setLineDash([]);

        // VIP gold safety barrier on cleared lanes
        if (isPassed) {
          ctx.fillStyle = '#d4af37';
          ctx.fillRect(lx + 10, barrierY, this.laneW - 20, 6);
          ctx.fillStyle = '#0f172a';
          for (let rx = lx + 14; rx < lx + this.laneW - 18; rx += 16) {
            ctx.fillRect(rx, barrierY, 8, 6);
          }
          ctx.fillStyle = '#34d399';
          ctx.beginPath();
          ctx.roundRect(cx - 32, h - 62, 64, 24, 12);
          ctx.fill();
          ctx.fillStyle = '#07130e';
          ctx.font = '800 10px "Inter", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('VEILIG', cx, h - 46);
        } else {
          // Multiplier pill cleanly above bottom hint bar
          const mult = calcClientMultiplier(lane);
          const pillW = Math.min(this.laneW - 12, 78);
          ctx.fillStyle = isNext ? 'rgba(212, 175, 55, 0.22)' : 'rgba(15, 23, 42, 0.86)';
          ctx.strokeStyle = isNext ? '#e5c158' : 'rgba(212, 175, 55, 0.35)';
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          ctx.roundRect(cx - pillW / 2, h - 64, pillW, 26, 13);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = isNext ? '#fef08a' : '#e2e8f0';
          ctx.font = '700 11px "JetBrains Mono", "Inter", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`${mult.toFixed(2)}x`, cx, h - 47);
        }

        // Lane number label at top
        ctx.fillStyle = isNext ? '#f5d060' : 'rgba(255,255,255,0.45)';
        ctx.font = '700 11px "Inter", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`BAAN ${lane}`, cx, 22);

        // Ambient cars on this lane
        const traffic = this.laneTraffic.get(lane);
        if (traffic) {
          for (let i = 0; i < traffic.cars.length; i += 1) {
            const car = traffic.cars[i];
            if (isPassed && car.y > barrierY - 35 && car.y < midY + 55) continue;
            const sprite = this.carSprites[car.type] || this.carSprites.COUPE_SILVER;
            if (!sprite) continue;
            ctx.save();
            ctx.translate(cx, car.y);
            if (traffic.dir < 0) ctx.rotate(Math.PI);
            ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2);
            ctx.restore();
          }
        }
      }

      // 3. Intercepting crash car if active
      if (this.interceptCar) {
        const ic = this.interceptCar;
        const cx = this._laneCenterX(ic.lane);
        const sprite = this.carSprites[ic.type] || this.carSprites.GT_CRIMSON;
        if (sprite) {
          ctx.save();
          ctx.translate(cx, ic.y);
          if (ic.dir < 0) ctx.rotate(Math.PI);
          ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2);
          ctx.restore();
        }
      }

      // 4. Player Character Avatar
      this._drawPlayerAvatar(ctx, midY);

      // 5. Sparks & Floating Texts
      for (let i = 0; i < this.particles.length; i += 1) {
        const pt = this.particles[i];
        const alpha = 1 - pt.life / pt.maxLife;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      for (let i = 0; i < this.floatingTexts.length; i += 1) {
        const ft = this.floatingTexts[i];
        const alpha = 1 - ft.life / ft.maxLife;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = ft.color;
        ctx.font = '800 13px "Inter", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(ft.text, ft.x, ft.y);
      }
      ctx.globalAlpha = 1;

      ctx.restore();

      // Screen impact flash overlay
      if (this.flashAlpha > 0) {
        ctx.fillStyle = this.flashColor || '#ef4444';
        ctx.globalAlpha = this.flashAlpha;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
      }

      ctx.restore();
    }

    _drawPlayerAvatar(ctx, baseY) {
      const px = this._laneCenterX(this.playerLanePos);
      const hopArc = this.hopProgress < 1 ? Math.sin(this.hopProgress * Math.PI) * 16 : 0;
      const py = baseY - hopArc;

      // Ground drop shadow
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.ellipse(px, baseY + 14, 15 - hopArc * 0.25, 7 - hopArc * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();

      // Spotlight ring under VIP player
      ctx.strokeStyle = this.isCrashed
        ? 'rgba(239, 68, 68, 0.85)'
        : this.hasActiveBets()
        ? 'rgba(229, 193, 88, 0.9)'
        : 'rgba(148, 163, 184, 0.45)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(px, baseY + 8, 22, 11, 0, 0, Math.PI * 2);
      ctx.stroke();

      // VIP tuxedo torso
      ctx.fillStyle = this.isCrashed ? '#7f1d1d' : '#181c28';
      ctx.strokeStyle = '#e5c158';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(px - 13, py - 8, 26, 20, 9);
      ctx.fill();
      ctx.stroke();

      // Gold lapel tie
      ctx.fillStyle = '#e5c158';
      ctx.beginPath();
      ctx.moveTo(px + 2, py - 4);
      ctx.lineTo(px + 10, py + 2);
      ctx.lineTo(px + 2, py + 8);
      ctx.closePath();
      ctx.fill();

      // Head
      ctx.fillStyle = '#f8fafc';
      ctx.strokeStyle = '#d4af37';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py - 10, 9.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Floating live pot badge above player during active run
      if (this.activeRun && this.activeRun.status === 'ACTIVE') {
        const label = this.activeRun.currentLane > 0
          ? `${formatChips(this.activeRun.currentPayout)} (${Number(this.activeRun.currentMultiplier).toFixed(2)}x)`
          : `${formatChips(this.activeRun.betAmount)} KLAAR`;
        ctx.font = '800 11px "Inter", sans-serif';
        const tw = ctx.measureText(label).width + 18;
        ctx.fillStyle = 'rgba(10, 13, 20, 0.92)';
        ctx.strokeStyle = '#e5c158';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.roundRect(px - tw / 2, py - 46, tw, 22, 11);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fef08a';
        ctx.textAlign = 'center';
        ctx.fillText(label, px, py - 31);
      }
    }

    _showResultBanner(text, kind) {
      if (!this.el.resultBanner) return;
      this.el.resultBanner.textContent = text;
      this.el.resultBanner.className = `cross-result-banner cross-result-${kind}`;
      clearTimeout(this._resultHideTimer);
      this._resultHideTimer = window.setTimeout(() => {
        this._hideResultBanner();
      }, 3600);
    }

    _hideResultBanner() {
      if (!this.el.resultBanner) return;
      this.el.resultBanner.className = 'cross-result-banner hidden';
    }

    renderControls() {
      const active = this.hasActiveBets();
      const lane = active ? this.activeRun.currentLane : 0;
      const mult = active ? this.activeRun.currentMultiplier : 1.0;
      const nextMult = active ? this.activeRun.nextMultiplier : calcClientMultiplier(1);
      const pot = active ? this.activeRun.currentPayout : 0;

      if (this.el.hudLane) this.el.hudLane.textContent = String(lane);
      if (this.el.hudMult) this.el.hudMult.textContent = `${Number(mult).toFixed(2)}x`;
      if (this.el.hudNext) this.el.hudNext.textContent = `${Number(nextMult).toFixed(2)}x`;
      if (this.el.hudPot) this.el.hudPot.textContent = formatChips(pot);

      if (this.el.stagePill) {
        if (active) {
          this.el.stagePill.textContent = lane > 0 ? `OP BAAN ${lane}` : 'KLAAR OP STOEP';
          this.el.stagePill.className = 'cross-stage-pill active';
        } else if (this.isCrashed) {
          this.el.stagePill.textContent = `AANGEREDEN BAAN ${this.crashLane}`;
          this.el.stagePill.className = 'cross-stage-pill crashed';
        } else {
          this.el.stagePill.textContent = 'KLAAR VOOR OVERSTEEK';
          this.el.stagePill.className = 'cross-stage-pill';
        }
      }

      if (this.el.lastWin) this.el.lastWin.textContent = formatChips(this.lastWinAmount);
      if (this.el.sessionNet) {
        const sign = this.sessionNet > 0 ? '+' : '';
        this.el.sessionNet.textContent = `${sign}${formatChips(this.sessionNet)}`;
        this.el.sessionNet.style.color = this.sessionNet >= 0 ? '#34d399' : '#f87171';
      }

      if (this.el.betInput) this.el.betInput.disabled = active;
      document.querySelectorAll('[data-cross-chip], [data-cross-mod]').forEach((b) => {
        b.disabled = active;
      });

      if (this.el.btnStart) {
        this.el.btnStart.disabled = active || this._startPending;
        this.el.btnStart.classList.toggle('hidden', active);
      }
      if (this.el.btnStep) {
        this.el.btnStep.disabled = !active || this._stepPending || this._cashoutPending;
        this.el.btnStep.classList.toggle('hidden', !active);
      }
      if (this.el.btnStepSub) {
        this.el.btnStepSub.textContent = active
          ? `Volgende: ${Number(nextMult).toFixed(2)}x (80% veilig)`
          : '80% kans per baan';
      }
      if (this.el.btnCashout) {
        const canCash = active && lane >= 1 && !this._cashoutPending;
        this.el.btnCashout.disabled = !canCash;
        this.el.btnCashout.classList.toggle('hidden', !active);
      }
      if (this.el.cashoutAmount) {
        this.el.cashoutAmount.textContent = formatChips(pot);
      }
      if (this.el.canvasHint) {
        this.el.canvasHint.textContent = active
          ? 'Klik op de volgende baan of druk op [SPATIE] om vooruit te stappen'
          : 'Kies je inzet en klik op START OVERSTEEK om de boulevard op te gaan';
      }
    }

    renderMultiplierStrip() {
      if (!this.el.multStrip) return;
      const curLane = this.activeRun ? this.activeRun.currentLane : 0;
      const bet = this.activeRun ? this.activeRun.betAmount : this.getInputBetAmount();
      const startLane = Math.max(1, curLane + 1);
      const chips = [];
      for (let i = 0; i < 3; i += 1) {
        const lane = startLane + i;
        const mult = calcClientMultiplier(lane);
        const estPayout = Math.floor(bet * mult);
        const isNext = Boolean(this.activeRun) && i === 0;
        chips.push(
          `<div class="cross-ladder-pill${isNext ? ' is-next' : ''}" title="Baan ${lane}: ${formatChips(estPayout)}">` +
            `<span class="cl-lane">B${lane}</span>` +
            `<span class="cl-mult">${mult.toFixed(2)}x</span>` +
          `</div>`
        );
      }
      this.el.multStrip.innerHTML = chips.join('');
    }

    renderSalonPanel() {
      if (this.el.salonCount) {
        this.el.salonCount.textContent = String(this.salonPlayers.length);
      }
      if (!this.el.salonList) return;
      if (!this.salonPlayers.length) {
        this.el.salonList.innerHTML = '<div class="cross-empty-note">Nog geen andere spelers op de boulevard.</div>';
        return;
      }
      this.el.salonList.innerHTML = this.salonPlayers.slice(0, 12).map((p) => {
        const dotColor = escapeHtml(p.color || '#d4af37');
        const statusText = p.inRun
          ? `Baan ${p.lane} (${Number(p.multiplier || 1).toFixed(2)}x)`
          : 'Op de stoep';
        const badgeCls = p.inRun ? 'is-live' : '';
        return (
          `<div class="cross-salon-row">` +
            `<span class="cross-player-dot" style="background:${dotColor}"></span>` +
            `<span class="cross-player-name">${escapeHtml(p.name)}</span>` +
            `<span class="cross-player-state ${badgeCls}">${escapeHtml(statusText)}</span>` +
          `</div>`
        );
      }).join('');
    }

    renderHistoryPanel() {
      if (this.el.tabMine) this.el.tabMine.classList.toggle('active', this.historyTab === 'mine');
      if (this.el.tabSalon) this.el.tabSalon.classList.toggle('active', this.historyTab === 'salon');
      if (!this.el.historyList) return;

      const list = this.historyTab === 'mine' ? this.myHistory : this.recentWins;
      if (!list || !list.length) {
        this.el.historyList.innerHTML = this.historyTab === 'mine'
          ? '<div class="cross-empty-note">Start een oversteek om jouw ritten hier te zien.</div>'
          : '<div class="cross-empty-note">Nog geen grote salon cashouts in deze sessie.</div>';
        return;
      }

      this.el.historyList.innerHTML = list.slice(0, 15).map((item) => {
        const isWin = item.outcome === 'CASHED_OUT' || item.outcome === 'MAX_CAP_CASHOUT';
        const net = Number(item.netProfit || 0);
        const netStr = `${net >= 0 ? '+' : ''}${formatChips(net)}`;
        const who = this.historyTab === 'salon' ? `${escapeHtml(item.playerName || 'Speler')} • ` : '';
        const detail = isWin
          ? `${who}Baan ${item.safeLanes} (${Number(item.multiplier).toFixed(2)}x)`
          : `${who}Crash baan ${item.finalLane}`;
        return (
          `<div class="cross-hist-row ${isWin ? 'win' : 'loss'}">` +
            `<span class="cross-hist-meta">${detail}</span>` +
            `<span class="cross-hist-val">${netStr}</span>` +
          `</div>`
        );
      }).join('');
    }
  }

  global.CasinoCross = CasinoCross;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CasinoCross, calcClientMultiplier };
  }
})(typeof window !== 'undefined' ? window : globalThis);
