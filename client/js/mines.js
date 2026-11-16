/**
 * @fileoverview Royal Mines Vault Client Controller.
 * Supports:
 * - Solo Vault (4x4, 5x5, 6x6, 7x7 grids & 1..N-1 mines selector, live next-tile odds & payouts)
 * - Shared Vault Multiplayer (Smart Timer 8s start on first bet, live board/bomb voting,
 *   turn-based clicking with 10s turn clock, auto-random click on timeout, >= 1 click before Cashout,
 *   clicker initials stamped on shared diamonds, shared detonation vs cashed-out survivors)
 * - Live Mines Zaal player cards + Big Wins & Personal History tabs
 * - Canvas particle celebration & shockwave FX (zero emojis, zero audio)
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.CasinoMines = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  const MIN_BET = 10;
  const MAX_BET = 50000;
  const SHARED_BOMB_PRESETS = [3, 5, 8, 12];
  const VALID_GRID_SIDES = [4, 5, 6, 7];

  const SVG_DIAMOND = [
    '<svg class="mines-tile-svg mines-gem-svg" viewBox="0 0 24 24" aria-hidden="true">',
    '<polygon points="6,4 18,4 22,10 12,21 2,10" fill="rgba(16,185,129,0.22)" stroke="#34d399" stroke-width="1.8" stroke-linejoin="round"/>',
    '<polyline points="2,10 22,10" fill="none" stroke="#a7f3d0" stroke-width="1.2"/>',
    '<polyline points="6,4 9,10 12,21 15,10 18,4" fill="none" stroke="#6ee7b7" stroke-width="1.15" stroke-linejoin="round"/>',
    '</svg>'
  ].join('');

  const SVG_MINE = [
    '<svg class="mines-tile-svg mines-bomb-svg" viewBox="0 0 24 24" aria-hidden="true">',
    '<circle cx="11" cy="13" r="6" fill="rgba(239,68,68,0.24)" stroke="#f87171" stroke-width="1.8"/>',
    '<line x1="11" y1="4.5" x2="11" y2="7" stroke="#fca5a5" stroke-width="1.8" stroke-linecap="round"/>',
    '<line x1="11" y1="19" x2="11" y2="21.5" stroke="#fca5a5" stroke-width="1.8" stroke-linecap="round"/>',
    '<line x1="2.5" y1="13" x2="5" y2="13" stroke="#fca5a5" stroke-width="1.8" stroke-linecap="round"/>',
    '<line x1="17" y1="13" x2="19.5" y2="13" stroke="#fca5a5" stroke-width="1.8" stroke-linecap="round"/>',
    '<line x1="5" y1="7" x2="6.8" y2="8.8" stroke="#fca5a5" stroke-width="1.6" stroke-linecap="round"/>',
    '<line x1="15.2" y1="17.2" x2="17" y2="19" stroke="#fca5a5" stroke-width="1.6" stroke-linecap="round"/>',
    '<line x1="5" y1="19" x2="6.8" y2="17.2" stroke="#fca5a5" stroke-width="1.6" stroke-linecap="round"/>',
    '<path d="M15.5 8.5L18.5 5.5" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/>',
    '<circle cx="19.5" cy="4.5" r="1.7" fill="#fbbf24"/>',
    '</svg>'
  ].join('');

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatChips(val) {
    return Math.floor(Number(val) || 0).toLocaleString('nl-NL');
  }

  function computeLocalStepMultiplier(totalTiles, mineCount, diamondsFound) {
    const N = Math.floor(Number(totalTiles) || 25);
    const M = Math.floor(Number(mineCount) || 5);
    if (diamondsFound <= 0 || M < 1 || M >= N) return 1.0;

    const targetRtp = 0.98;
    const maxEvCap = 0.99;
    let prev = 1.0;
    let fairMult = 1.0;
    const steps = Math.min(diamondsFound, N - M);

    for (let d = 1; d <= steps; d += 1) {
      const i = d - 1;
      fairMult *= (N - i) / (N - M - i);
      const base = Math.floor(fairMult * targetRtp * 100) / 100;
      const evCap = Math.floor(fairMult * maxEvCap * 100) / 100;
      let chosen = Math.min(base, evCap);
      if (chosen < Math.max(1.01, prev + 0.01)) {
        const bumped = Math.round(Math.max(1.01, prev + 0.01) * 100) / 100;
        if (bumped <= evCap) chosen = bumped;
      }
      if (chosen < 1.01 && evCap >= 1.01) chosen = 1.01;
      prev = Math.min(chosen, evCap);
    }
    return prev;
  }

  class CasinoMines {
    constructor({ network, ui = null } = {}) {
      this.network = network;
      this.ui = ui;

      this.mode = 'solo'; // 'solo' | 'shared'
      this.activeFeedTab = 'wins'; // 'wins' | 'history'
      this.betAmount = 100;
      this.soloGridSide = 5;
      this.soloMineCount = 5;
      this.sharedVoteSide = 5;
      this.sharedVoteMines = 5;

      this.soloGame = null;
      this.soloLastReveal = null; // { gridSide, mineCount, allMines, revealedDiamonds, hitTile, outcome, payout, multiplier }
      this.sharedState = {
        roundId: 0,
        phase: 'WAITING_FOR_PLAYERS',
        timerSeconds: 0,
        turnTimeLeft: 0,
        gridSide: 5,
        totalTiles: 25,
        mineCount: 5,
        safeTiles: 20,
        diamondsOpened: 0,
        currentMultiplier: 1.0,
        nextMultiplier: 1.2,
        safeChancePct: 80.0,
        mineRiskPct: 20.0,
        turnOrder: [],
        turnPlayerId: null,
        aliveCount: 0,
        participants: [],
        revealedTiles: [],
        allMines: null,
        detonatedBy: null,
        lastActionNote: 'Kies Solo Kluis of stap samen in de Shared Vault!',
        voteSummary: { sizes: {}, mines: {}, totalVotes: 0 },
      };

      this.salonPlayers = [];
      this.recentWins = [];
      this.personalHistory = [];
      this.pendingAction = false;
      this._pendingKind = null;
      this._queuedCashout = false;
      this._actionTimeout = null;
      this.viewActive = false;

      this.particles = [];
      this.fxRafId = null;
      this.lastFxTs = 0;

      this.els = {};
    }

    init() {
      this._cacheElements();
      this._bindUIEvents();
      this._bindNetworkEvents();
      this._buildBoardGrid();
      this._renderAll();
    }

    _setPendingAction(kind) {
      this.pendingAction = true;
      this._pendingKind = kind || 'action';
      if (this._actionTimeout) clearTimeout(this._actionTimeout);
      this._actionTimeout = setTimeout(() => {
        this._clearPendingAction();
      }, 4000);
    }

    _clearPendingAction() {
      this.pendingAction = false;
      this._pendingKind = null;
      if (this._actionTimeout) {
        clearTimeout(this._actionTimeout);
        this._actionTimeout = null;
      }
    }

    _executeCashoutNow() {
      if (this.mode === 'solo') {
        if (!this.soloGame || !this.soloGame.canCashout) return false;
        this._queuedCashout = false;
        this._setPendingAction('cashout');
        this.network.minesSoloCashout();
        return true;
      }
      const myId = this._getMyId();
      const s = this.sharedState;
      const myP = myId && s && Array.isArray(s.participants)
        ? s.participants.find((p) => p.playerId === myId)
        : null;
      if (!s || s.phase !== 'PLAYING' || !myP || myP.status !== 'ALIVE') return false;
      if (!myP.canCashout) {
        if (this.ui) {
          this.ui.showToast('Open eerst minstens 1 eigen vakje voordat je mag cashen.', 'info');
        }
        return false;
      }
      this._queuedCashout = false;
      this._setPendingAction('cashout');
      this.network.minesSharedCashout();
      return true;
    }

    onViewActivated() {
      this.viewActive = true;
      this._resizeFxCanvas();
      this._renderAll();
      this._syncHudPhase();
    }

    onViewDeactivated() {
      this.viewActive = false;
      this._stopParticles();
    }

    /**
     * Navigation Lock check: active Solo game OR in Shared BETTING OR ALIVE during Shared PLAYING.
     */
    hasActiveBets() {
      if (this.soloGame && this.soloGame.status === 'ACTIVE') return true;
      const myId = this._getMyId();
      if (!myId || !this.sharedState) return false;
      const sp = (this.sharedState.participants || []).find((p) => p.playerId === myId);
      if (!sp) return false;
      if (this.sharedState.phase === 'BETTING') return true;
      if (this.sharedState.phase === 'PLAYING' && sp.status === 'ALIVE') return true;
      return false;
    }

    _getMyId() {
      if (this.network && this.network.myPlayerId) return this.network.myPlayerId;
      if (this.ui && this.ui.myPlayer && this.ui.myPlayer.id) return this.ui.myPlayer.id;
      return null;
    }

    _cacheElements() {
      if (typeof document === 'undefined') return;
      this.els = {
        view: document.getElementById('mines-view'),
        btnModeSolo: document.getElementById('btn-mines-mode-solo'),
        btnModeShared: document.getElementById('btn-mines-mode-shared'),
        sharedDot: document.getElementById('mines-shared-dot'),
        headerBoardBadge: document.getElementById('mines-header-board'),
        headerMultBadge: document.getElementById('mines-header-mult'),
        headerStatusBadge: document.getElementById('mines-header-status'),

        topStrip: document.getElementById('mines-top-strip'),
        statusBanner: document.getElementById('mines-status-banner'),
        sharedBanner: document.getElementById('mines-shared-banner'),
        sharedRoundTag: document.getElementById('mines-shared-round'),
        sharedPhaseTag: document.getElementById('mines-shared-phase'),
        sharedCountdown: document.getElementById('mines-shared-countdown'),
        sharedTurnTag: document.getElementById('mines-shared-turn'),
        sharedNote: document.getElementById('mines-shared-note'),

        stage: document.getElementById('mines-stage'),
        fxCanvas: document.getElementById('mines-fx-canvas'),
        board: document.getElementById('mines-board'),
        resultOverlay: document.getElementById('mines-result-banner'),

        configControls: document.getElementById('mines-config-controls'),
        sizeBtns: document.querySelectorAll('.mines-size-btn'),
        soloMinesWrap: document.getElementById('mines-solo-mines-wrap'),
        soloMinesInput: document.getElementById('mines-solo-count-input'),
        soloMinesDown: document.getElementById('btn-mines-count-down'),
        soloMinesUp: document.getElementById('btn-mines-count-up'),
        soloMinePresetBtns: document.querySelectorAll('.mines-preset-mine-btn'),
        sharedMinesWrap: document.getElementById('mines-shared-mines-wrap'),
        sharedMineBtns: document.querySelectorAll('.mines-shared-mine-btn'),

        betInput: document.getElementById('mines-bet-input'),
        chipBtns: document.querySelectorAll('.mines-chip-btn'),
        btnSoloStart: document.getElementById('btn-mines-solo-start'),
        btnSharedJoin: document.getElementById('btn-mines-shared-join'),
        btnSharedCancel: document.getElementById('btn-mines-shared-cancel'),

        activeControls: document.getElementById('mines-active-controls'),
        statGemsVal: document.getElementById('mines-stat-gems'),
        statMultVal: document.getElementById('mines-stat-mult'),
        statNextVal: document.getElementById('mines-stat-next'),
        statRiskVal: document.getElementById('mines-stat-risk'),
        activeTurnHint: document.getElementById('mines-active-turn-hint'),
        btnCashout: document.getElementById('btn-mines-cashout'),
        cashoutVal: document.getElementById('mines-cashout-val'),

        salonCount: document.getElementById('mines-salon-count'),
        salonList: document.getElementById('mines-salon-list'),
        btnTabWins: document.getElementById('btn-mines-tab-wins'),
        btnTabHistory: document.getElementById('btn-mines-tab-history'),
        feedWins: document.getElementById('mines-feed-wins'),
        feedHistory: document.getElementById('mines-feed-history'),
      };
    }

    _bindUIEvents() {
      if (!this.els || typeof document === 'undefined') return;

      if (this.els.btnModeSolo) {
        this.els.btnModeSolo.addEventListener('click', () => this.switchMode('solo'));
      }
      if (this.els.btnModeShared) {
        this.els.btnModeShared.addEventListener('click', () => this.switchMode('shared'));
      }

      this.els.sizeBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          const side = Number(btn.dataset.gridSide);
          if (!VALID_GRID_SIDES.includes(side)) return;
          if (this.mode === 'solo') {
            if (this.soloGame && this.soloGame.status === 'ACTIVE') return;
            this.soloGridSide = side;
            const maxM = side * side - 1;
            if (this.soloMineCount > maxM) this.soloMineCount = Math.max(1, Math.min(maxM, 5));
            this.soloLastReveal = null;
            this._buildBoardGrid();
            this._renderAll();
          } else {
            this.sharedVoteSide = side;
            this.network.minesSharedVote({ gridSide: side, mineCount: this.sharedVoteMines });
            this._renderControls();
          }
        });
      });

      this.els.soloMinePresetBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          if (this.soloGame && this.soloGame.status === 'ACTIVE') return;
          const m = Number(btn.dataset.minePreset);
          const maxM = this.soloGridSide * this.soloGridSide - 1;
          this.soloMineCount = Math.max(1, Math.min(maxM, m));
          this.soloLastReveal = null;
          this._renderControls();
        });
      });

      if (this.els.soloMinesDown) {
        this.els.soloMinesDown.addEventListener('click', () => {
          if (this.soloGame && this.soloGame.status === 'ACTIVE') return;
          this.soloMineCount = Math.max(1, this.soloMineCount - 1);
          this._renderControls();
        });
      }
      if (this.els.soloMinesUp) {
        this.els.soloMinesUp.addEventListener('click', () => {
          if (this.soloGame && this.soloGame.status === 'ACTIVE') return;
          const maxM = this.soloGridSide * this.soloGridSide - 1;
          this.soloMineCount = Math.min(maxM, this.soloMineCount + 1);
          this._renderControls();
        });
      }
      if (this.els.soloMinesInput) {
        this.els.soloMinesInput.addEventListener('change', () => {
          const maxM = this.soloGridSide * this.soloGridSide - 1;
          const val = Math.floor(Number(this.els.soloMinesInput.value) || 5);
          this.soloMineCount = Math.max(1, Math.min(maxM, val));
          this._renderControls();
        });
      }

      this.els.sharedMineBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          const m = Number(btn.dataset.sharedMines);
          if (!SHARED_BOMB_PRESETS.includes(m)) return;
          this.sharedVoteMines = m;
          this.network.minesSharedVote({ gridSide: this.sharedVoteSide, mineCount: m });
          this._renderControls();
        });
      });

      if (this.els.betInput) {
        this.els.betInput.addEventListener('input', () => {
          const parsed = Math.floor(Number(this.els.betInput.value) || 0);
          this.betAmount = Math.max(MIN_BET, Math.min(MAX_BET, parsed || MIN_BET));
          this._renderControls();
        });
      }

      this.els.chipBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          if (btn.dataset.minesBet) {
            this.betAmount = Number(btn.dataset.minesBet);
          } else if (btn.dataset.minesMod === 'half') {
            this.betAmount = Math.max(MIN_BET, Math.floor(this.betAmount / 2));
          } else if (btn.dataset.minesMod === 'double') {
            this.betAmount = Math.min(MAX_BET, this.betAmount * 2);
          } else if (btn.dataset.minesMod === 'max') {
            const avail = this.ui && this.ui.myPlayer ? Number(this.ui.myPlayer.chips || MAX_BET) : MAX_BET;
            this.betAmount = Math.max(MIN_BET, Math.min(MAX_BET, Math.floor(avail)));
          }
          if (this.els.betInput) this.els.betInput.value = this.betAmount;
          this._renderControls();
        });
      });

      if (this.els.btnSoloStart) {
        this.els.btnSoloStart.addEventListener('click', () => {
          if (this.pendingAction) return;
          this._queuedCashout = false;
          this._setPendingAction('start');
          this.soloLastReveal = null;
          this.network.minesSoloStart({
            betAmount: this.betAmount,
            gridSide: this.soloGridSide,
            mineCount: this.soloMineCount,
          });
        });
      }

      if (this.els.btnSharedJoin) {
        this.els.btnSharedJoin.addEventListener('click', () => {
          if (this.pendingAction) return;
          this._queuedCashout = false;
          this._setPendingAction('shared_join');
          this.network.minesSharedJoin({
            betAmount: this.betAmount,
            gridSide: this.sharedVoteSide,
            mineCount: this.sharedVoteMines,
          });
        });
      }

      if (this.els.btnSharedCancel) {
        this.els.btnSharedCancel.addEventListener('click', () => {
          this.network.minesSharedCancel();
        });
      }

      if (this.els.btnCashout) {
        this.els.btnCashout.addEventListener('click', () => {
          if (this.pendingAction) {
            if (this._pendingKind === 'cashout') return;
            if (this._pendingKind === 'tile') {
              this._queuedCashout = true;
              return;
            }
            this._clearPendingAction();
          }
          this._executeCashoutNow();
        });
      }

      if (this.els.board) {
        this.els.board.addEventListener('click', (e) => {
          const tileBtn = e.target.closest('.mines-tile');
          if (!tileBtn || tileBtn.disabled) return;
          const idx = Number(tileBtn.dataset.tileIndex);
          if (!Number.isInteger(idx)) return;
          this._handleTileClick(idx);
        });
      }

      if (this.els.btnTabWins) {
        this.els.btnTabWins.addEventListener('click', () => {
          this.activeFeedTab = 'wins';
          this._renderFeeds();
        });
      }
      if (this.els.btnTabHistory) {
        this.els.btnTabHistory.addEventListener('click', () => {
          this.activeFeedTab = 'history';
          this._renderFeeds();
        });
      }

      if (typeof window !== 'undefined') {
        window.addEventListener('resize', () => {
          if (this.viewActive) this._resizeFxCanvas();
        });
      }
    }

    _handleTileClick(tileIndex) {
      if (this.pendingAction) return;
      if (this.mode === 'solo') {
        if (!this.soloGame || this.soloGame.status !== 'ACTIVE') return;
        const already = (this.soloGame.revealedDiamonds || []).some((d) => d.tileIndex === tileIndex);
        if (already) return;
        this._queuedCashout = false;
        this._setPendingAction('tile');
        this.network.minesSoloClick(tileIndex);
      } else {
        const myId = this._getMyId();
        if (!myId || this.sharedState.phase !== 'PLAYING' || this.sharedState.turnPlayerId !== myId) return;
        const already = (this.sharedState.revealedTiles || []).some((t) => t.tileIndex === tileIndex);
        if (already) return;
        this._queuedCashout = false;
        this._setPendingAction('tile');
        this.network.minesSharedClick(tileIndex);
      }
    }

    _bindNetworkEvents() {
      if (!this.network || typeof this.network.on !== 'function') return;

      const clearAllPending = () => {
        this._clearPendingAction();
        this._queuedCashout = false;
      };
      this.network.on('connection_change', (data) => {
        if (!data || !data.connected) clearAllPending();
      });
      this.network.on('session_required', clearAllPending);
      this.network.on('session_lost', clearAllPending);
      this.network.on('auth_error', clearAllPending);
      this.network.on('auth_success', () => {
        clearAllPending();
        if (this.viewActive && typeof this.network.minesJoin === 'function') {
          this.network.minesJoin();
        }
      });

      this.network.on('mines_state', (data) => {
        if (!data) return;
        clearAllPending();
        this.soloGame = data.solo || null;
        if (this.soloGame) {
          this.soloGridSide = this.soloGame.gridSide;
          this.soloMineCount = this.soloGame.mineCount;
          this.soloLastReveal = null;
        }
        if (data.shared) this.sharedState = data.shared;
        if (data.myVote) {
          this.sharedVoteSide = data.myVote.gridSide || 5;
          this.sharedVoteMines = data.myVote.mineCount || 5;
        }
        if (Array.isArray(data.players)) this.salonPlayers = data.players;
        if (Array.isArray(data.recentWins)) this.recentWins = data.recentWins;
        if (Array.isArray(data.personalHistory)) this.personalHistory = data.personalHistory;

        this._buildBoardGrid();
        this._renderAll();
        this._syncNavLock();
        this._syncHudPhase();
      });

      this.network.on('mines_salon_update', (data) => {
        if (!data) return;
        if (Array.isArray(data.players)) this.salonPlayers = data.players;
        if (Array.isArray(data.recentWins)) this.recentWins = data.recentWins;
        if (data.shared) this.sharedState = data.shared;
        this._renderSalonList();
        this._renderFeeds();
        this._renderHeader();
        if (this.mode === 'shared') this._renderSharedBanner();
      });

      this.network.on('mines_rejected', (err) => {
        clearAllPending();
        if (err && err.reason && this.ui) {
          const isRecovering =
            err.code === 'PLAYER_NOT_FOUND' &&
            this.network &&
            typeof this.network.hasStoredCredentials === 'function' &&
            this.network.hasStoredCredentials();
          this.ui.showToast(isRecovering ? 'Sessie wordt hersteld...' : err.reason, isRecovering ? 'info' : 'error');
        }
      });

      this.network.on('mines_solo_started', (res) => {
        clearAllPending();
        if (!res || !res.solo) return;
        this.soloGame = res.solo;
        this.soloLastReveal = null;
        this.soloGridSide = res.solo.gridSide;
        this.soloMineCount = res.solo.mineCount;
        this._hideResultBanner();
        this._buildBoardGrid();
        this._renderAll();
        this._syncNavLock();
        this._syncHudPhase();
      });

      this.network.on('mines_solo_result', (res) => {
        const hadQueuedCashout = this._queuedCashout;
        this._clearPendingAction();
        if (!res) {
          this._queuedCashout = false;
          return;
        }

        if (res.outcome === 'DIAMOND') {
          this.soloGame = res.solo;
          this._renderAll();
          this._spawnTileParticles(res.tileIndex, 'diamond', 14);
          if (hadQueuedCashout && this.soloGame && this.soloGame.canCashout) {
            this._executeCashoutNow();
          } else {
            this._queuedCashout = false;
          }
        } else if (res.outcome === 'MINE') {
          this._queuedCashout = false;
          const gridSide = this.soloGame ? this.soloGame.gridSide : this.soloGridSide;
          const mineCount = this.soloGame ? this.soloGame.mineCount : this.soloMineCount;
          this.soloGame = null;
          this.soloLastReveal = {
            gridSide,
            mineCount,
            outcome: 'MINE',
            hitTile: res.tileIndex,
            allMines: res.allMines || [],
            revealedDiamonds: res.revealedDiamonds || [],
            payout: 0,
            netProfit: res.netProfit || 0,
            multiplier: 0,
          };
          if (res.historyEntry) this._prependHistory(res.historyEntry);
          this._renderAll();
          this._spawnTileParticles(res.tileIndex, 'bomb', 28);
          this._showResultBanner(`BOEM! -${formatChips(Math.abs(res.netProfit || this.betAmount))} F`, false);
        } else if (res.outcome === 'CASHOUT' || res.outcome === 'GRAND_CLEAR') {
          this._queuedCashout = false;
          const gridSide = this.soloGame ? this.soloGame.gridSide : this.soloGridSide;
          const mineCount = this.soloGame ? this.soloGame.mineCount : this.soloMineCount;
          this.soloGame = null;
          this.soloLastReveal = {
            gridSide,
            mineCount,
            outcome: res.outcome,
            hitTile: null,
            allMines: res.allMines || [],
            revealedDiamonds: res.revealedDiamonds || [],
            payout: res.payout || 0,
            netProfit: res.netProfit || 0,
            multiplier: res.multiplier || 1,
          };
          if (res.historyEntry) this._prependHistory(res.historyEntry);
          this._renderAll();
          this._spawnStageBurst('win', 38);
          this._showResultBanner(
            `${res.outcome === 'GRAND_CLEAR' ? 'KLUIS LEEG!' : 'UITBETAALD!'} +${formatChips(res.payout)} F (${Number(res.multiplier).toFixed(2)}x)`,
            true
          );
          if (this.ui) {
            this.ui.showToast(`Mines winst: +${formatChips(res.payout)} F (${Number(res.multiplier).toFixed(2)}x)!`, 'success');
          }
        }
        this._syncNavLock();
        this._syncHudPhase();
      });

      this.network.on('mines_shared_tick', (tick) => {
        if (!tick) return;
        this.sharedState.phase = tick.phase || this.sharedState.phase;
        this.sharedState.timerSeconds = typeof tick.timerSeconds === 'number' ? tick.timerSeconds : this.sharedState.timerSeconds;
        this.sharedState.turnTimeLeft = typeof tick.turnTimeLeft === 'number' ? tick.turnTimeLeft : this.sharedState.turnTimeLeft;
        this.sharedState.turnPlayerId = tick.turnPlayerId !== undefined ? tick.turnPlayerId : this.sharedState.turnPlayerId;
        this._renderSharedBanner();
        this._renderControls();
        this._syncHudPhase();
      });

      this.network.on('mines_shared_vote_ack', () => {
        this._clearPendingAction();
      });

      this.network.on('mines_shared_joined', (res) => {
        clearAllPending();
        if (res && res.shared) {
          this.sharedState = res.shared;
          this._buildBoardGrid();
          this._renderAll();
          this._syncNavLock();
          this._syncHudPhase();
        }
        if (this.ui) {
          this.ui.showToast('Inzet geplaatst in Shared Vault!', 'success');
        }
      });

      this.network.on('mines_shared_cancelled', (res) => {
        clearAllPending();
        if (res && res.shared) {
          this.sharedState = res.shared;
          this._buildBoardGrid();
          this._renderAll();
          this._syncNavLock();
          this._syncHudPhase();
        }
        if (this.ui) this.ui.showToast('Shared Vault inzet geannuleerd.', 'info');
      });

      this.network.on('mines_shared_state', (shared) => {
        if (!shared) return;
        const sizeChanged = Number(shared.gridSide) !== Number(this.sharedState.gridSide);
        this.sharedState = shared;
        if (shared.phase === 'WAITING_FOR_PLAYERS' || shared.phase === 'BETTING') {
          clearAllPending();
          this._hideResultBanner();
        }
        if (sizeChanged || !this.els.board || this.els.board.children.length !== shared.totalTiles) {
          this._buildBoardGrid();
        }
        this._renderAll();
        this._syncNavLock();
        this._syncHudPhase();
      });

      this.network.on('mines_shared_tile', (payload) => {
        const hadQueued = this._queuedCashout;
        this._clearPendingAction();
        if (!payload) {
          this._queuedCashout = false;
          return;
        }
        if (payload.shared) this.sharedState = payload.shared;
        this._renderAll();
        if (payload.tileInfo && payload.tileInfo.type === 'DIAMOND') {
          this._spawnTileParticles(payload.tileInfo.tileIndex, 'diamond', 14);
          if (hadQueued && this.mode === 'shared') {
            this._executeCashoutNow();
          }
        } else {
          this._queuedCashout = false;
        }
        this._syncNavLock();
      });

      this.network.on('mines_shared_click_ack', (res) => {
        const hadQueued = this._queuedCashout;
        this._clearPendingAction();
        if (res && res.shared) {
          this.sharedState = res.shared;
          this._renderAll();
        }
        if (hadQueued && res && res.outcome === 'DIAMOND' && this.mode === 'shared') {
          this._executeCashoutNow();
        } else {
          this._queuedCashout = false;
        }
      });

      this.network.on('mines_shared_cashout_ack', () => {
        clearAllPending();
      });

      this.network.on('mines_shared_settlement', (s) => {
        clearAllPending();
        if (!s) return;
        if (s.historyEntry) this._prependHistory(s.historyEntry);
        if (this.ui) {
          if (s.payout > 0) {
            this.ui.showToast(`Shared Mines winst: +${formatChips(s.payout)} F (${Number(s.multiplier).toFixed(2)}x)!`, 'success');
          } else {
            this.ui.showToast(`Shared Vault bom geraakt — inzet ${formatChips(s.betAmount)} F verloren.`, 'info');
          }
        }
        this._renderFeeds();
        this._syncNavLock();
      });

      this.network.on('mines_shared_finished', (payload) => {
        clearAllPending();
        if (!payload) return;
        if (payload.shared) this.sharedState = payload.shared;
        this._renderAll();
        if (payload.reason === 'BOMB_HIT' && payload.triggerTile) {
          this._spawnTileParticles(payload.triggerTile.tileIndex, 'bomb', 34);
          this._showResultBanner(`BOEM! ${payload.triggerTile.playerName} raakte een mijn!`, false);
        } else if (payload.reason === 'GRAND_CLEAR') {
          this._spawnStageBurst('win', 40);
          this._showResultBanner(`KLUIZENAAR JACKPOT! Alle diamanten gevonden op ${Number(payload.finalMultiplier).toFixed(2)}x!`, true);
        } else {
          this._spawnStageBurst('win', 26);
          this._showResultBanner(`ALLE OVERLEVENDEN GEKASHED OP ${Number(payload.finalMultiplier).toFixed(2)}x!`, true);
        }
        this._syncNavLock();
        this._syncHudPhase();
      });
    }

    _prependHistory(entry) {
      this.personalHistory.unshift(entry);
      if (this.personalHistory.length > 25) this.personalHistory.length = 25;
    }

    switchMode(newMode) {
      const normalized = newMode === 'shared' ? 'shared' : 'solo';
      if (this.mode === normalized) return;
      this.mode = normalized;
      this._hideResultBanner();
      this._buildBoardGrid();
      this._renderAll();
      this._syncHudPhase();
    }

    _getDisplayedGridSide() {
      if (this.mode === 'solo') {
        if (this.soloGame) return this.soloGame.gridSide;
        if (this.soloLastReveal) return this.soloLastReveal.gridSide;
        return this.soloGridSide;
      }
      return (this.sharedState && this.sharedState.gridSide) || 5;
    }

    _buildBoardGrid() {
      if (!this.els.board) return;
      const side = this._getDisplayedGridSide();
      const total = side * side;
      this.els.board.style.setProperty('--mines-cols', String(side));
      this.els.board.dataset.gridSide = String(side);

      let html = '';
      for (let i = 0; i < total; i += 1) {
        html += `<button type="button" class="mines-tile" data-tile-index="${i}" aria-label="Vakje ${i + 1}"></button>`;
      }
      this.els.board.innerHTML = html;
    }

    _renderAll() {
      this._renderHeader();
      this._renderTopStrip();
      this._renderSharedBanner();
      this._renderBoardTiles();
      this._renderControls();
      this._renderSalonList();
      this._renderFeeds();
    }

    _renderHeader() {
      if (!this.els.btnModeSolo || !this.els.btnModeShared) return;
      this.els.btnModeSolo.classList.toggle('active', this.mode === 'solo');
      this.els.btnModeShared.classList.toggle('active', this.mode === 'shared');

      if (this.els.sharedDot) {
        const activeShared = this.sharedState && ['BETTING', 'PLAYING'].includes(this.sharedState.phase);
        this.els.sharedDot.classList.toggle('live', Boolean(activeShared));
      }

      if (this.mode === 'solo') {
        const side = this.soloGame ? this.soloGame.gridSide : this.soloGridSide;
        const mines = this.soloGame ? this.soloGame.mineCount : this.soloMineCount;
        const mult = this.soloGame ? this.soloGame.currentMultiplier : 1.0;
        const payout = this.soloGame ? this.soloGame.currentPayout : 0;
        if (this.els.headerBoardBadge) this.els.headerBoardBadge.textContent = `${side}x${side} • ${mines} Bommen`;
        if (this.els.headerMultBadge) this.els.headerMultBadge.textContent = `${Number(mult).toFixed(2)}x`;
        if (this.els.headerStatusBadge) {
          this.els.headerStatusBadge.textContent = this.soloGame
            ? `${formatChips(payout)} F`
            : 'SOLO KLAAR';
        }
      } else {
        const s = this.sharedState;
        if (this.els.headerBoardBadge) this.els.headerBoardBadge.textContent = `${s.gridSide}x${s.gridSide} • ${s.mineCount} Bommen`;
        if (this.els.headerMultBadge) this.els.headerMultBadge.textContent = `${Number(s.currentMultiplier || 1).toFixed(2)}x`;
        if (this.els.headerStatusBadge) {
          const pCount = Array.isArray(s.participants) ? s.participants.length : 0;
          this.els.headerStatusBadge.textContent = `${pCount} Spelers`;
        }
      }
    }

    _renderTopStrip() {
      if (!this.els.statusBanner || !this.els.sharedBanner) return;
      const isShared = this.mode === 'shared';
      this.els.statusBanner.classList.toggle('hidden', isShared);
      this.els.sharedBanner.classList.toggle('hidden', !isShared);

      if (!isShared) {
        if (this.soloGame) {
          const safeTotal = this.soloGame.safeTiles;
          const mult = Number(this.soloGame.currentMultiplier).toFixed(2);
          this.els.statusBanner.innerHTML = [
            `<span class="mines-status-pill is-live">SOLO KLUIS ACTIEF</span>`,
            `<span class="mines-status-detail">${this.soloGame.gridSide}x${this.soloGame.gridSide} (${this.soloGame.mineCount} bommen)</span>`,
            `<span class="mines-status-detail">Diamanten: <strong>${this.soloGame.diamondsOpened}/${safeTotal}</strong></span>`,
            `<span class="mines-status-mult">Multi: <strong>${mult}x</strong> (${formatChips(this.soloGame.currentPayout)} F)</span>`,
          ].join('');
        } else {
          const previewNext = computeLocalStepMultiplier(this.soloGridSide * this.soloGridSide, this.soloMineCount, 1);
          this.els.statusBanner.innerHTML = [
            `<span class="mines-status-pill">SOLO KLUIS</span>`,
            `<span class="mines-status-detail">Kies bord (${this.soloGridSide}x${this.soloGridSide}) &amp; aantal bommen (${this.soloMineCount})</span>`,
            `<span class="mines-status-mult">1e Diamant: <strong>${previewNext.toFixed(2)}x</strong> • 98% RTP (2% Huisvoordeel)</span>`,
          ].join('');
        }
      }
    }

    _renderSharedBanner() {
      if (this.mode !== 'shared' || !this.sharedState) return;
      const s = this.sharedState;
      const myId = this._getMyId();

      if (this.els.sharedRoundTag) {
        this.els.sharedRoundTag.textContent = `SHARED #${s.roundId || 0}`;
      }
      if (this.els.sharedPhaseTag) {
        const phaseLabels = {
          WAITING_FOR_PLAYERS: 'WACHT OP INZET',
          BETTING: 'INZETTEN & STEMMEN',
          PLAYING: 'ELKE KLIK LIVE',
          REVEALED: 'BORD ONTHULD',
        };
        this.els.sharedPhaseTag.textContent = phaseLabels[s.phase] || s.phase;
        this.els.sharedPhaseTag.dataset.phase = s.phase;
      }
      if (this.els.sharedCountdown) {
        if (s.phase === 'BETTING') {
          this.els.sharedCountdown.textContent = `Start: ${s.timerSeconds}s`;
          this.els.sharedCountdown.classList.remove('is-urgent');
        } else if (s.phase === 'PLAYING') {
          this.els.sharedCountdown.textContent = `Beurt: ${s.turnTimeLeft}s`;
          this.els.sharedCountdown.classList.toggle('is-urgent', s.turnTimeLeft <= 3);
        } else {
          this.els.sharedCountdown.textContent = s.phase === 'REVEALED' ? 'Nieuwe ronde zo' : 'Slimme Klok (1e Inzet)';
          this.els.sharedCountdown.classList.remove('is-urgent');
        }
      }
      if (this.els.sharedTurnTag) {
        if (s.phase === 'PLAYING' && s.turnPlayerId) {
          const actor = (s.participants || []).find((p) => p.playerId === s.turnPlayerId);
          const isMe = s.turnPlayerId === myId;
          this.els.sharedTurnTag.textContent = isMe ? 'JOUW BEURT — KLIK EEN VAKJE!' : `Aan zet: ${actor ? actor.playerName : '-'}`;
          this.els.sharedTurnTag.classList.toggle('is-my-turn', isMe);
        } else {
          this.els.sharedTurnTag.textContent = `${(s.participants || []).length} in kluis • ${s.aliveCount || 0} over`;
          this.els.sharedTurnTag.classList.remove('is-my-turn');
        }
      }
      if (this.els.sharedNote) {
        this.els.sharedNote.textContent = s.lastActionNote || '';
      }
    }

    _renderBoardTiles() {
      if (!this.els.board) return;
      const side = this._getDisplayedGridSide();
      const total = side * side;
      if (this.els.board.children.length !== total) {
        this._buildBoardGrid();
      }

      const tiles = this.els.board.children;
      if (this.mode === 'solo') {
        const revealedMap = new Map();
        const mineSet = new Set();
        let hitTile = null;
        let canClick = false;

        if (this.soloGame && this.soloGame.status === 'ACTIVE') {
          canClick = true;
          (this.soloGame.revealedDiamonds || []).forEach((d) => revealedMap.set(d.tileIndex, d));
        } else if (this.soloLastReveal) {
          (this.soloLastReveal.revealedDiamonds || []).forEach((d) => revealedMap.set(d.tileIndex, d));
          (this.soloLastReveal.allMines || []).forEach((idx) => mineSet.add(idx));
          hitTile = this.soloLastReveal.hitTile;
        }

        for (let i = 0; i < total; i += 1) {
          const btn = tiles[i];
          if (!btn) continue;
          const gem = revealedMap.get(i);
          const isMine = mineSet.has(i);
          if (gem) {
            btn.className = 'mines-tile tile-diamond';
            btn.disabled = true;
            btn.innerHTML = `${SVG_DIAMOND}<span class="tile-step-mult">${Number(gem.multiplier).toFixed(2)}x</span>`;
          } else if (isMine) {
            const isTrigger = hitTile === i;
            btn.className = `mines-tile ${isTrigger ? 'tile-mine is-trigger' : 'tile-mine-reveal'}`;
            btn.disabled = true;
            btn.innerHTML = SVG_MINE;
          } else {
            btn.className = `mines-tile ${canClick ? 'tile-hidden-interactive' : 'tile-hidden-idle'}`;
            btn.disabled = !canClick;
            btn.innerHTML = '<span class="tile-rivet"></span>';
          }
        }
        return;
      }

      // SHARED MULTIPLAYER BOARD
      const s = this.sharedState;
      const myId = this._getMyId();
      const canClickShared = Boolean(myId && s.phase === 'PLAYING' && s.turnPlayerId === myId);
      const revealedMap = new Map();
      (s.revealedTiles || []).forEach((t) => revealedMap.set(t.tileIndex, t));
      const allMinesSet = new Set(Array.isArray(s.allMines) ? s.allMines : []);

      this.els.board.classList.toggle('is-my-turn', canClickShared);

      for (let i = 0; i < total; i += 1) {
        const btn = tiles[i];
        if (!btn) continue;
        const info = revealedMap.get(i);
        if (info) {
          const initialsHtml = info.initials
            ? `<span class="tile-actor-chip" style="background:${escapeHtml(info.avatarColor || '#d4af37')}" title="${escapeHtml(info.playerName)}">${escapeHtml(info.initials)}${info.autoTimeout ? '*' : ''}</span>`
            : '';
          if (info.type === 'MINE') {
            btn.className = 'mines-tile tile-mine is-trigger';
            btn.disabled = true;
            btn.innerHTML = `${initialsHtml}${SVG_MINE}`;
          } else {
            btn.className = 'mines-tile tile-diamond';
            btn.disabled = true;
            btn.innerHTML = `${initialsHtml}${SVG_DIAMOND}<span class="tile-step-mult">${Number(info.multiplier).toFixed(2)}x</span>`;
          }
        } else if (allMinesSet.has(i)) {
          btn.className = 'mines-tile tile-mine-reveal';
          btn.disabled = true;
          btn.innerHTML = SVG_MINE;
        } else {
          btn.className = `mines-tile ${canClickShared ? 'tile-hidden-interactive' : 'tile-hidden-idle'}`;
          btn.disabled = !canClickShared;
          btn.innerHTML = '<span class="tile-rivet"></span>';
        }
      }
    }

    _renderControls() {
      if (!this.els.configControls || !this.els.activeControls) return;
      const myId = this._getMyId();

      if (this.mode === 'solo') {
        const isActive = Boolean(this.soloGame && this.soloGame.status === 'ACTIVE');
        this.els.configControls.classList.toggle('hidden', isActive);
        this.els.activeControls.classList.toggle('hidden', !isActive);

        if (!isActive) {
          this._renderSharedOrSoloSizeButtons(this.soloGridSide, null);
          if (this.els.soloMinesWrap) this.els.soloMinesWrap.classList.remove('hidden');
          if (this.els.sharedMinesWrap) this.els.sharedMinesWrap.classList.add('hidden');
          if (this.els.soloMinesInput) {
            this.els.soloMinesInput.max = String(this.soloGridSide * this.soloGridSide - 1);
            this.els.soloMinesInput.value = String(this.soloMineCount);
          }
          this.els.soloMinePresetBtns.forEach((btn) => {
            const val = Number(btn.dataset.minePreset);
            const valid = val < this.soloGridSide * this.soloGridSide;
            btn.disabled = !valid;
            btn.classList.toggle('active', val === this.soloMineCount);
          });
          if (this.els.btnSoloStart) this.els.btnSoloStart.classList.remove('hidden');
          if (this.els.btnSharedJoin) this.els.btnSharedJoin.classList.add('hidden');
          if (this.els.btnSharedCancel) this.els.btnSharedCancel.classList.add('hidden');
        } else {
          const g = this.soloGame;
          if (this.els.statGemsVal) this.els.statGemsVal.textContent = `${g.diamondsOpened} / ${g.safeTiles}`;
          if (this.els.statMultVal) this.els.statMultVal.textContent = `${Number(g.currentMultiplier).toFixed(2)}x`;
          if (this.els.statNextVal) this.els.statNextVal.textContent = `${Number(g.nextMultiplier).toFixed(2)}x (${formatChips(g.nextPayout)} F)`;
          if (this.els.statRiskVal) this.els.statRiskVal.textContent = `${g.safeChancePct}% veilig`;
          if (this.els.activeTurnHint) {
            this.els.activeTurnHint.textContent = g.diamondsOpened === 0
              ? 'Klik op een gouden kluisvakje om te beginnen.'
              : 'Kies nog een vakje voor hogere vermenigvuldiger of cash nu uit!';
          }
          if (this.els.btnCashout) this.els.btnCashout.disabled = !g.canCashout;
          if (this.els.cashoutVal) this.els.cashoutVal.textContent = formatChips(g.currentPayout);
        }
        return;
      }

      // SHARED VAULT CONTROLS
      const s = this.sharedState;
      const myP = myId ? (s.participants || []).find((p) => p.playerId === myId) : null;
      const isPlayingParticipant = Boolean(s.phase === 'PLAYING' && myP && myP.status === 'ALIVE');

      this.els.configControls.classList.toggle('hidden', isPlayingParticipant);
      this.els.activeControls.classList.toggle('hidden', !isPlayingParticipant);

      if (!isPlayingParticipant) {
        const sizeVotes = (s.voteSummary && s.voteSummary.sizes) || {};
        const mineVotes = (s.voteSummary && s.voteSummary.mines) || {};
        this._renderSharedOrSoloSizeButtons(this.sharedVoteSide, sizeVotes, s.gridSide);

        if (this.els.soloMinesWrap) this.els.soloMinesWrap.classList.add('hidden');
        if (this.els.sharedMinesWrap) this.els.sharedMinesWrap.classList.remove('hidden');

        this.els.sharedMineBtns.forEach((btn) => {
          const m = Number(btn.dataset.sharedMines);
          const count = mineVotes[m] || 0;
          const badge = count > 0 ? ` (${count})` : '';
          btn.textContent = `${m} Bom${badge}`;
          btn.classList.toggle('active', m === this.sharedVoteMines);
          btn.disabled = !['WAITING_FOR_PLAYERS', 'BETTING'].includes(s.phase);
        });

        const inBetting = Boolean(myP && s.phase === 'BETTING');
        const roundOpen = ['WAITING_FOR_PLAYERS', 'BETTING'].includes(s.phase);
        if (this.els.btnSoloStart) this.els.btnSoloStart.classList.add('hidden');
        if (this.els.btnSharedJoin) {
          this.els.btnSharedJoin.classList.toggle('hidden', inBetting);
          this.els.btnSharedJoin.disabled = !roundOpen;
          this.els.btnSharedJoin.textContent = s.phase === 'PLAYING'
            ? 'RONDE BEZIG — WACHT EVEN'
            : s.phase === 'REVEALED'
            ? 'NIEUWE RONDE START ZO...'
            : 'DOE MEE AAN SHARED VAULT';
        }
        if (this.els.btnSharedCancel) {
          this.els.btnSharedCancel.classList.toggle('hidden', !inBetting);
        }
      } else {
        const myPayout = s.diamondsOpened > 0 ? Math.floor(myP.betAmount * s.currentMultiplier) : 0;
        const nextPayout = Math.floor(myP.betAmount * (s.nextMultiplier || 1));
        if (this.els.statGemsVal) this.els.statGemsVal.textContent = `${s.diamondsOpened} / ${s.safeTiles}`;
        if (this.els.statMultVal) this.els.statMultVal.textContent = `${Number(s.currentMultiplier).toFixed(2)}x`;
        if (this.els.statNextVal) this.els.statNextVal.textContent = `${Number(s.nextMultiplier).toFixed(2)}x (${formatChips(nextPayout)} F)`;
        if (this.els.statRiskVal) this.els.statRiskVal.textContent = `${s.safeChancePct}% veilig`;

        if (this.els.activeTurnHint) {
          if (myP.clicksMade < 1) {
            this.els.activeTurnHint.textContent = s.turnPlayerId === myId
              ? 'JOUW BEURT! Open eerst minstens 1 eigen vakje voor je kunt cashen.'
              : 'Wacht op jouw beurt (min. 1 eigen klik vereist om te mogen cashen).';
          } else {
            this.els.activeTurnHint.textContent = s.turnPlayerId === myId
              ? `JOUW BEURT (${s.turnTimeLeft}s) — Klik een vakje of cash veilig uit!`
              : 'Je hebt minstens 1 vakje geopend — je kunt op elk moment cashen!';
          }
        }
        if (this.els.btnCashout) this.els.btnCashout.disabled = !myP.canCashout;
        if (this.els.cashoutVal) this.els.cashoutVal.textContent = formatChips(myPayout);
      }
    }

    _renderSharedOrSoloSizeButtons(selectedSide, voteCounts = null, activeRoundSide = null) {
      const locked = this.mode === 'shared' && this.sharedState && !['WAITING_FOR_PLAYERS', 'BETTING'].includes(this.sharedState.phase);
      this.els.sizeBtns.forEach((btn) => {
        const side = Number(btn.dataset.gridSide);
        btn.disabled = Boolean(locked);
        btn.classList.toggle('active', side === selectedSide);
        btn.classList.toggle('is-leading', Boolean(voteCounts && side === activeRoundSide && (voteCounts[side] || 0) > 0));
        if (voteCounts) {
          const c = voteCounts[side] || 0;
          btn.textContent = c > 0 ? `${side}x${side} (${c})` : `${side}x${side}`;
        } else {
          btn.textContent = `${side}x${side}`;
        }
      });
    }

    _renderSalonList() {
      if (!this.els.salonList || !this.els.salonCount) return;
      const myId = this._getMyId();
      const players = Array.isArray(this.salonPlayers) ? this.salonPlayers : [];
      this.els.salonCount.textContent = `${players.length} speler${players.length === 1 ? '' : 's'}`;

      if (players.length === 0) {
        this.els.salonList.innerHTML = '<div class="mines-empty-note">Nog geen spelers in de Mines Zaal.</div>';
        return;
      }

      this.els.salonList.innerHTML = players.map((p) => {
        const isMe = myId && p.playerId === myId;
        let badge = 'KIJKT';
        let detail = 'Klaar om te spelen';
        if (p.sharedStatus) {
          badge = p.isTurn ? 'AAN ZET' : (p.sharedStatus === 'ALIVE' ? 'SHARED' : p.sharedStatus);
          detail = p.isTurn ? 'Kiest nu een vakje' : `Shared Vault (${p.sharedStatus})`;
        } else if (p.soloActive) {
          badge = `${p.soloActive.gridSide}x${p.soloActive.gridSide}`;
          detail = `Solo ${Number(p.soloActive.currentMultiplier || 1).toFixed(2)}x (${p.soloActive.diamondsOpened} gem)`;
        }

        return `
          <div class="mines-salon-row ${p.isTurn ? 'is-turn' : ''}">
            <span class="salon-avatar" style="background:${escapeHtml(p.avatarColor || '#d4af37')}">${escapeHtml(p.initials || '?')}</span>
            <div class="salon-meta">
              <div class="salon-name">${escapeHtml(p.name)}${isMe ? ' (Jij)' : ''}</div>
              <div class="salon-sub">${escapeHtml(detail)}</div>
            </div>
            <span class="salon-mode-badge ${p.isTurn ? 'turn-hot' : ''}">${escapeHtml(badge)}</span>
          </div>
        `;
      }).join('');
    }

    _renderFeeds() {
      if (!this.els.feedWins || !this.els.feedHistory) return;
      const showWins = this.activeFeedTab === 'wins';
      if (this.els.btnTabWins) this.els.btnTabWins.classList.toggle('active', showWins);
      if (this.els.btnTabHistory) this.els.btnTabHistory.classList.toggle('active', !showWins);
      this.els.feedWins.classList.toggle('hidden', !showWins);
      this.els.feedHistory.classList.toggle('hidden', showWins);

      if (this.recentWins.length === 0) {
        this.els.feedWins.innerHTML = '<div class="mines-empty-note">Nog geen grote Mines cashouts in deze sessie.</div>';
      } else {
        this.els.feedWins.innerHTML = this.recentWins.slice(0, 12).map((w) => `
          <div class="mines-feed-row">
            <span class="feed-badge-mode">${escapeHtml(w.mode)} • ${escapeHtml(w.gridLabel)}</span>
            <span class="feed-player">${escapeHtml(w.playerName)}</span>
            <span class="feed-amount">+${formatChips(w.payout)} F (${Number(w.multiplier).toFixed(2)}x)</span>
          </div>
        `).join('');
      }

      if (this.personalHistory.length === 0) {
        this.els.feedHistory.innerHTML = '<div class="mines-empty-note">Speel een Solo Kluis of Shared Vault voor jouw historiek.</div>';
      } else {
        this.els.feedHistory.innerHTML = this.personalHistory.slice(0, 15).map((h) => {
          const won = Number(h.payout || 0) > 0;
          return `
            <div class="mines-feed-row ${won ? 'is-win' : 'is-bust'}">
              <span class="feed-badge-mode">${escapeHtml(h.mode)} ${h.gridSide}x${h.gridSide} (${h.mineCount}m)</span>
              <span class="feed-player">${h.diamondsOpened} gem • ${formatChips(h.initialBet)} F</span>
              <span class="feed-amount ${won ? 'win-txt' : 'bust-txt'}">${won ? `+${formatChips(h.payout)} F (${Number(h.multiplier).toFixed(2)}x)` : `BOEM (-${formatChips(h.initialBet)})`}</span>
            </div>
          `;
        }).join('');
      }
    }

    _showResultBanner(text, isWin) {
      if (!this.els.resultOverlay) return;
      this.els.resultOverlay.textContent = text;
      this.els.resultOverlay.className = `mines-result-banner ${isWin ? 'is-win' : 'is-bust'}`;
    }

    _hideResultBanner() {
      if (!this.els.resultOverlay) return;
      this.els.resultOverlay.className = 'mines-result-banner hidden';
    }

    _syncNavLock() {
      if (this.ui && typeof this.ui.setNavigationLocked === 'function') {
        this.ui.setNavigationLocked(this.hasActiveBets());
      }
    }

    _syncHudPhase() {
      if (!this.viewActive || !this.ui || typeof this.ui.updatePhase !== 'function') return;
      if (this.mode === 'solo') {
        if (this.soloGame && this.soloGame.status === 'ACTIVE') {
          this.ui.updatePhase('MINES_SOLO', 0, `${this.soloGame.diamondsOpened} GEM`);
        } else {
          this.ui.updatePhase('MINES_READY', 0, 'SOLO');
        }
        return;
      }
      const s = this.sharedState || {};
      if (s.phase === 'BETTING') {
        this.ui.updatePhase('MINES_BET', s.entryDuration || 8, s.timerSeconds || 0);
      } else if (s.phase === 'PLAYING') {
        this.ui.updatePhase('MINES_PLAY', s.turnDuration || 10, s.turnTimeLeft || 0);
      } else if (s.phase === 'REVEALED') {
        this.ui.updatePhase('MINES_REVEAL', 4, 'OPEN');
      } else {
        this.ui.updatePhase('MINES_WAIT', 0, 'KLAAR');
      }
    }

    _resizeFxCanvas() {
      const c = this.els.fxCanvas;
      const stage = this.els.stage;
      if (!c || !stage) return;
      const rect = stage.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        c.width = Math.floor(rect.width);
        c.height = Math.floor(rect.height);
      }
    }

    _spawnTileParticles(tileIndex, kind, count) {
      const c = this.els.fxCanvas;
      const board = this.els.board;
      if (!c || !board) return;
      this._resizeFxCanvas();
      const tileEl = board.querySelector(`[data-tile-index="${tileIndex}"]`);
      if (!tileEl) return;
      const cRect = c.getBoundingClientRect();
      const tRect = tileEl.getBoundingClientRect();
      const cx = (tRect.left - cRect.left) + tRect.width / 2;
      const cy = (tRect.top - cRect.top) + tRect.height / 2;
      this._spawnParticlesAt(cx, cy, kind, count);
    }

    _spawnStageBurst(kind, count) {
      const c = this.els.fxCanvas;
      if (!c) return;
      this._resizeFxCanvas();
      this._spawnParticlesAt(c.width / 2, c.height / 2, kind, count);
    }

    _spawnParticlesAt(cx, cy, kind, count) {
      const palette = kind === 'bomb'
        ? ['#ef4444', '#f97316', '#fbbf24', '#fca5a5']
        : kind === 'win'
        ? ['#d4af37', '#fde68a', '#34d399', '#6ee7b7']
        : ['#34d399', '#6ee7b7', '#a7f3d0', '#fde68a'];

      for (let i = 0; i < count; i += 1) {
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
        const speed = 70 + Math.random() * 190;
        this.particles.push({
          x: cx,
          y: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - (kind === 'bomb' ? 30 : 50),
          life: 0,
          maxLife: 0.55 + Math.random() * 0.35,
          size: 2.5 + Math.random() * 3.5,
          color: palette[i % palette.length],
        });
      }
      if (!this.fxRafId && typeof requestAnimationFrame === 'function') {
        this.lastFxTs = 0;
        this.fxRafId = requestAnimationFrame((ts) => this._stepParticles(ts));
      }
    }

    _stepParticles(ts) {
      const c = this.els.fxCanvas;
      if (!c || !this.viewActive || this.particles.length === 0) {
        this._stopParticles();
        return;
      }
      const ctx = c.getContext('2d');
      if (!ctx) {
        this._stopParticles();
        return;
      }
      if (!this.lastFxTs) this.lastFxTs = ts;
      const dt = Math.min(0.05, Math.max(0.001, (ts - this.lastFxTs) / 1000));
      this.lastFxTs = ts;

      ctx.clearRect(0, 0, c.width, c.height);
      const next = [];
      for (const p of this.particles) {
        p.life += dt;
        if (p.life >= p.maxLife) continue;
        p.vy += 260 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const alpha = Math.max(0, 1 - p.life / p.maxLife);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        next.push(p);
      }
      ctx.globalAlpha = 1;
      this.particles = next;
      if (this.particles.length > 0) {
        this.fxRafId = requestAnimationFrame((t) => this._stepParticles(t));
      } else {
        this._stopParticles();
      }
    }

    _stopParticles() {
      if (this.fxRafId && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.fxRafId);
      }
      this.fxRafId = null;
      this.particles = [];
      const c = this.els && this.els.fxCanvas;
      if (c) {
        const ctx = c.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, c.width, c.height);
      }
    }
  }

  return CasinoMines;
}));
