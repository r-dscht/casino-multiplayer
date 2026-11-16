/**
 * @fileoverview Monte Carlo Hi-Lo Prive client controller.
 * Manages Hybrid Solo Ladder & Multiplayer Blitz modes, 3D card flip reveals with
 * slow-mo suspense, canvas particle FX, live Salon player cards, hype cheers,
 * 50% Half-Cashout, free Card Swaps, and personal ladder history.
 * Zero emojis, zero audio APIs.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CasinoHilo = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  const SUIT_SYMBOL_MAP = {
    spades: '#suit-spade',
    hearts: '#suit-heart',
    diamonds: '#suit-diamond',
    clubs: '#suit-club'
  };

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isRedSuit(suit) {
    return suit === 'hearts' || suit === 'diamonds';
  }

  function formatChips(num) {
    return Math.max(0, Math.floor(Number(num) || 0)).toLocaleString();
  }

  class CasinoHilo {
    constructor({ network, ui }) {
      this.network = network;
      this.ui = ui;

      this.mode = 'solo'; // 'solo' | 'blitz'
      this.feedTab = 'wins'; // 'wins' | 'history'
      this.soloLadder = null;
      this.blitzState = null;
      this.salonPlayers = [];
      this.recentWins = [];
      this.personalHistory = [];
      this.isRevealing = false;
      this._isActiveView = false;

      this._flipTimeout = null;
      this._settleTimeout = null;
      this._afterRevealTimeout = null;
      this._revealLockedCard = null;
      this._lastDisplayedCard = null;
      this._particles = [];
      this._fxRaf = null;
    }

    init() {
      this.cacheElements();
      if (!this.el.view) return;
      this.bindUiEvents();
      this.bindNetworkEvents();
      this.render();
    }

    cacheElements() {
      this.el = {
        view: document.getElementById('hilo-view'),
        modeSoloBtn: document.getElementById('btn-hilo-mode-solo'),
        modeBlitzBtn: document.getElementById('btn-hilo-mode-blitz'),
        blitzDot: document.getElementById('hilo-blitz-dot'),
        tierPill: document.getElementById('hilo-tier-pill'),
        tierLabel: document.getElementById('hilo-tier-label'),
        streakCount: document.getElementById('hilo-streak-count'),
        shoeCount: document.getElementById('hilo-shoe-count'),
        potValue: document.getElementById('hilo-pot-value'),

        cardTrail: document.getElementById('hilo-card-trail'),
        blitzBanner: document.getElementById('hilo-blitz-banner'),
        blitzRound: document.getElementById('hilo-blitz-round'),
        blitzPhase: document.getElementById('hilo-blitz-phase'),
        blitzCountdown: document.getElementById('hilo-blitz-countdown'),
        blitzSurvivors: document.getElementById('hilo-blitz-survivors'),
        crowdHigher: document.getElementById('hilo-crowd-higher'),
        crowdEqual: document.getElementById('hilo-crowd-equal'),
        crowdLower: document.getElementById('hilo-crowd-lower'),
        crowdPcts: document.getElementById('hilo-crowd-pcts'),

        stage: document.getElementById('hilo-stage'),
        fxCanvas: document.getElementById('hilo-fx-canvas'),
        currentCard: document.getElementById('hilo-current-card'),
        curRankTL: document.getElementById('hilo-cur-rank-tl'),
        curSuitTL: document.getElementById('hilo-cur-suit-tl'),
        curRankMain: document.getElementById('hilo-cur-rank'),
        curSuitMain: document.getElementById('hilo-cur-suit'),
        curRankBR: document.getElementById('hilo-cur-rank-br'),
        curSuitBR: document.getElementById('hilo-cur-suit-br'),

        flipCard: document.getElementById('hilo-flip-card'),
        nextCard: document.getElementById('hilo-next-card'),
        nextRankTL: document.getElementById('hilo-next-rank-tl'),
        nextSuitTL: document.getElementById('hilo-next-suit-tl'),
        nextRankMain: document.getElementById('hilo-next-rank'),
        nextSuitMain: document.getElementById('hilo-next-suit'),
        nextRankBR: document.getElementById('hilo-next-rank-br'),
        nextSuitBR: document.getElementById('hilo-next-suit-br'),
        resultBanner: document.getElementById('hilo-result-banner'),

        probHigherPct: document.getElementById('hilo-prob-higher-pct'),
        probEqualPct: document.getElementById('hilo-prob-equal-pct'),
        probLowerPct: document.getElementById('hilo-prob-lower-pct'),
        probHigherBar: document.getElementById('hilo-prob-higher-bar'),
        probEqualBar: document.getElementById('hilo-prob-equal-bar'),
        probLowerBar: document.getElementById('hilo-prob-lower-bar'),

        entryControls: document.getElementById('hilo-entry-controls'),
        betInput: document.getElementById('hilo-bet-input'),
        startBtn: document.getElementById('btn-hilo-start'),
        blitzJoinBtn: document.getElementById('btn-hilo-blitz-join'),
        blitzCancelBtn: document.getElementById('btn-hilo-blitz-cancel'),

        activeControls: document.getElementById('hilo-active-controls'),
        higherBtn: document.getElementById('btn-hilo-higher'),
        higherOdds: document.getElementById('hilo-higher-odds'),
        higherPayout: document.getElementById('hilo-higher-payout'),
        equalBtn: document.getElementById('btn-hilo-equal'),
        equalOdds: document.getElementById('hilo-equal-odds'),
        equalPayout: document.getElementById('hilo-equal-payout'),
        lowerBtn: document.getElementById('btn-hilo-lower'),
        lowerOdds: document.getElementById('hilo-lower-odds'),
        lowerPayout: document.getElementById('hilo-lower-payout'),

        skipBtn: document.getElementById('btn-hilo-skip'),
        skipCount: document.getElementById('hilo-skip-count'),
        halfCashoutBtn: document.getElementById('btn-hilo-half-cashout'),
        halfAmount: document.getElementById('hilo-half-amount'),
        cashoutBtn: document.getElementById('btn-hilo-cashout'),
        currentPayout: document.getElementById('hilo-current-payout'),

        salonCount: document.getElementById('hilo-salon-count'),
        salonList: document.getElementById('hilo-salon-list'),
        tabWins: document.getElementById('btn-hilo-tab-wins'),
        tabHistory: document.getElementById('btn-hilo-tab-history'),
        feedWins: document.getElementById('hilo-feed-wins'),
        feedHistory: document.getElementById('hilo-feed-history')
      };
    }

    bindUiEvents() {
      if (this.el.modeSoloBtn) {
        this.el.modeSoloBtn.addEventListener('click', () => this.switchMode('solo'));
      }
      if (this.el.modeBlitzBtn) {
        this.el.modeBlitzBtn.addEventListener('click', () => this.switchMode('blitz'));
      }

      document.querySelectorAll('#hilo-view [data-hilo-bet]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const val = parseInt(btn.getAttribute('data-hilo-bet'), 10);
          if (this.el.betInput && Number.isFinite(val)) {
            this.el.betInput.value = String(val);
          }
        });
      });

      document.querySelectorAll('#hilo-view [data-hilo-mod]').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (!this.el.betInput) return;
          const mod = btn.getAttribute('data-hilo-mod');
          const cur = Math.max(10, parseInt(this.el.betInput.value, 10) || 100);
          const maxChips = Math.min(50000, Math.max(10, Math.floor(Number(this.ui?.myPlayer?.chips || 0))));
          if (mod === 'half') this.el.betInput.value = String(Math.max(10, Math.floor(cur / 2)));
          else if (mod === 'double') this.el.betInput.value = String(Math.min(50000, cur * 2));
          else if (mod === 'max') this.el.betInput.value = String(maxChips);
        });
      });

      if (this.el.startBtn) {
        this.el.startBtn.addEventListener('click', () => {
          const bet = Math.floor(Number(this.el.betInput?.value || 100));
          this.network.hiloStart(bet);
        });
      }

      if (this.el.blitzJoinBtn) {
        this.el.blitzJoinBtn.addEventListener('click', () => {
          const bet = Math.floor(Number(this.el.betInput?.value || 100));
          this.network.hiloBlitzJoin(bet);
        });
      }

      if (this.el.blitzCancelBtn) {
        this.el.blitzCancelBtn.addEventListener('click', () => {
          this.network.hiloBlitzCancel();
        });
      }

      if (this.el.higherBtn) {
        this.el.higherBtn.addEventListener('click', () => this.submitPrediction('HIGHER'));
      }
      if (this.el.equalBtn) {
        this.el.equalBtn.addEventListener('click', () => this.submitPrediction('EQUAL'));
      }
      if (this.el.lowerBtn) {
        this.el.lowerBtn.addEventListener('click', () => this.submitPrediction('LOWER'));
      }

      if (this.el.skipBtn) {
        this.el.skipBtn.addEventListener('click', () => {
          if (this.isRevealing || this.mode !== 'solo') return;
          this.network.hiloSkip();
        });
      }

      if (this.el.halfCashoutBtn) {
        this.el.halfCashoutBtn.addEventListener('click', () => {
          if (this.isRevealing || this.mode !== 'solo') return;
          this.network.hiloHalfCashout();
        });
      }

      if (this.el.cashoutBtn) {
        this.el.cashoutBtn.addEventListener('click', () => {
          if (this.isRevealing) return;
          if (this.mode === 'blitz') {
            this.network.hiloBlitzAction('CASHOUT');
          } else {
            this.network.hiloCashout();
          }
        });
      }

      if (this.el.tabWins) {
        this.el.tabWins.addEventListener('click', () => this.switchFeedTab('wins'));
      }
      if (this.el.tabHistory) {
        this.el.tabHistory.addEventListener('click', () => this.switchFeedTab('history'));
      }

      if (this.el.salonList) {
        this.el.salonList.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-cheer-target]');
          if (!btn) return;
          const targetId = btn.getAttribute('data-cheer-target');
          if (targetId) this.network.hiloCheer(targetId);
        });
      }

      if (typeof document !== 'undefined') {
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
      }
    }

    bindNetworkEvents() {
      this.network.on('hilo_state', (data) => {
        if (!data) return;
        this.salonPlayers = Array.isArray(data.players) ? data.players : [];
        this.recentWins = Array.isArray(data.recentWins) ? data.recentWins : [];
        this.personalHistory = Array.isArray(data.personalHistory) ? data.personalHistory : [];
        if ('soloLadder' in data) this.soloLadder = data.soloLadder;
        if (data.blitz) this.blitzState = data.blitz;
        this._revealLockedCard = null;
        this.isRevealing = false;
        this._resetFlipCardVisual();
        this.render();
        this._syncNavLock();
        this._syncTopPhase();
      });

      this.network.on('hilo_salon_update', (data) => {
        if (!data) return;
        if (Array.isArray(data.players)) this.salonPlayers = data.players;
        if (Array.isArray(data.recentWins)) this.recentWins = data.recentWins;
        if (data.blitz) this._mergePublicBlitz(data.blitz);
        this.renderSalonList();
        this.renderFeedPanels();
        if (this.mode === 'blitz' && !this.isRevealing) this.renderControlsAndStage();
      });

      this.network.on('hilo_cheered', (data) => {
        if (!data) return;
        if (this._isActiveView && data.targetId === this.ui?.myPlayer?.id) {
          this.ui.showToast(`${data.fromName} juicht voor je in Hi-Lo!`, 'success');
          this._spawnParticles('gold', 14);
        }
      });

      this.network.on('hilo_cheer_rejected', (data) => {
        if (this._isActiveView && data?.reason) {
          this.ui.showToast(data.reason, 'info');
        }
      });

      this.network.on('hilo_rejected', (data) => {
        this._revealLockedCard = null;
        this.isRevealing = false;
        if (data?.reason && this._isActiveView) {
          this.ui.showToast(data.reason, 'error');
        }
        this.renderControlsAndStage();
      });

      this.network.on('hilo_started', (data) => {
        if (!data) return;
        this.mode = 'solo';
        this.soloLadder = data.ladder || null;
        this._revealLockedCard = null;
        this.isRevealing = false;
        this._resetFlipCardVisual();
        if (data.reshuffled && this._isActiveView) {
          this.ui.showToast('Nieuwe 52-kaarten slof geschud!', 'info');
        }
        this.render();
        this._syncNavLock();
        this._syncTopPhase();
      });

      this.network.on('hilo_guess_result', (res) => {
        if (!res) return;
        this.mode = 'solo';
        this._playCardReveal(res, () => {
          this.soloLadder = res.ladder || null;
          if (!res.won && res.historyEntry) {
            this.personalHistory.unshift(res.historyEntry);
            if (this.personalHistory.length > 25) this.personalHistory.length = 25;
          }
          if (typeof res.newChips === 'number' && this.ui?.myPlayer) {
            this.ui.myPlayer.chips = res.newChips;
            this.ui.updatePlayerHUD();
          }
          if (res.reshuffled && this._isActiveView) {
            this.ui.showToast('Slof automatisch opnieuw geschud (< 13 kaarten).', 'info');
          }
          this.render();
          if (res.won) this._triggerPromoteAnim();
          this._syncNavLock();
          this._syncTopPhase();
        });
      });

      this.network.on('hilo_skipped', (res) => {
        if (!res) return;
        this.soloLadder = res.ladder || null;
        this._revealLockedCard = null;
        this.isRevealing = false;
        this._resetFlipCardVisual();
        this._showBanner('KAART GEWISSELD', 'win');
        this.render();
      });

      this.network.on('hilo_half_cashout_result', (res) => {
        if (!res) return;
        this.soloLadder = res.ladder || null;
        if (typeof res.newChips === 'number' && this.ui?.myPlayer) {
          this.ui.myPlayer.chips = res.newChips;
          this.ui.updatePlayerHUD();
        }
        this._spawnParticles('gold', 22);
        this.ui.showToast(`50% verzekerd: +${formatChips(res.payout)} fiches veiliggesteld!`, 'success');
        this.render();
        this._syncNavLock();
      });

      this.network.on('hilo_cashout_result', (res) => {
        if (!res) return;
        this.soloLadder = null;
        if (res.historyEntry) {
          this.personalHistory.unshift(res.historyEntry);
          if (this.personalHistory.length > 25) this.personalHistory.length = 25;
        }
        if (typeof res.newChips === 'number' && this.ui?.myPlayer) {
          this.ui.myPlayer.chips = res.newChips;
          this.ui.updatePlayerHUD();
        }
        if (res.payout > 0) {
          this._spawnParticles('gold', 34);
          this._showBanner(`+${formatChips(res.totalPayout)} F CASHOUT`, 'win');
          const msg = res.streak === 0
            ? `Inzet van ${formatChips(res.payout)} fiches teruggestort.`
            : `Uitbetaald! ${formatChips(res.totalPayout)} fiches na ${res.streak} kaarten.`;
          this.ui.showToast(msg, 'success');
        }
        this.render();
        this._syncNavLock();
        this._syncTopPhase();
      });

      // Multiplayer Blitz Listeners
      this.network.on('hilo_blitz_tick', (tick) => {
        if (!tick) return;
        if (!this.blitzState) this.blitzState = {};
        this.blitzState.phase = tick.phase;
        this.blitzState.timerSeconds = tick.timerSeconds;
        this.renderBlitzStatus();
        this._syncTopPhase();
      });

      this.network.on('hilo_blitz_state', (state) => {
        if (!state) return;
        this._mergePublicBlitz(state);
        if (!this.isRevealing) {
          this.render();
        } else {
          this.renderBlitzStatus();
        }
        this._syncNavLock();
        this._syncTopPhase();
      });

      this.network.on('hilo_blitz_joined', (res) => {
        if (!res) return;
        this.mode = 'blitz';
        if (res.blitz) this.blitzState = res.blitz;
        this.ui.showToast('Ingeschreven voor Hi-Lo Blitz!', 'success');
        this.render();
        this._syncNavLock();
        this._syncTopPhase();
      });

      this.network.on('hilo_blitz_cancelled', (res) => {
        if (!res) return;
        if (res.blitz) this.blitzState = res.blitz;
        this.ui.showToast(`Blitz inzet (${formatChips(res.refunded)} F) geannuleerd.`, 'info');
        this.render();
        this._syncNavLock();
        this._syncTopPhase();
      });

      this.network.on('hilo_blitz_action_ack', (res) => {
        if (!res) return;
        if (res.blitz) this.blitzState = res.blitz;
        this.renderControlsAndStage();
        this._syncNavLock();
      });

      this.network.on('hilo_blitz_reveal', (reveal) => {
        if (!reveal) return;
        const previousCard = reveal.previousCard || this._revealLockedCard || this._lastDisplayedCard || this.blitzState?.currentCard || null;
        if (reveal.blitz) this._mergePublicBlitz(reveal.blitz);
        const myId = this.ui?.myPlayer?.id;
        const winners = Array.isArray(reveal.winners) ? reveal.winners : [];
        const busted = Array.isArray(reveal.busted) ? reveal.busted : [];
        const didWin = winners.some((w) => w.playerId === myId);
        const didBust = busted.some((b) => b.playerId === myId);
        const didParticipate = didWin || didBust;
        const multiplier = didWin
          ? ((winners.find((w) => w.playerId === myId) || {}).multiplier || 1)
          : 0;
        const resPayload = {
          won: didWin || (!didBust && winners.length > 0),
          previousCard,
          nextCard: reveal.nextCard,
          multiplier,
          newPot: didWin ? ((winners.find((w) => w.playerId === myId) || {}).newPot || 0) : 0,
          slowMo: Boolean(reveal.slowMo),
          isBlitz: true,
          didBust,
          didParticipate
        };
        if (this.mode === 'blitz') {
          this._playCardReveal(resPayload, () => {
            this.render();
            if (!didBust && (reveal.winners || []).length > 0) this._triggerPromoteAnim();
            this._syncNavLock();
            this._syncTopPhase();
          });
        } else {
          this.renderBlitzStatus();
        }
      });

      this.network.on('hilo_blitz_settlement', (s) => {
        if (!s) return;
        if (typeof s.newChips === 'number' && this.ui?.myPlayer) {
          this.ui.myPlayer.chips = s.newChips;
          this.ui.updatePlayerHUD();
        }
        if (this.blitzState && this.blitzState.viewerEntry && s.playerId === this.ui?.myPlayer?.id) {
          this.blitzState.viewerEntry.status = s.outcome;
        }
        this.personalHistory.unshift({
          mode: 'BLITZ',
          initialBet: s.initialBet,
          payout: s.payout,
          netProfit: s.netProfit,
          maxStreak: s.streak,
          outcome: s.outcome,
          timestamp: Date.now()
        });
        if (this.personalHistory.length > 25) this.personalHistory.length = 25;

        if (this.mode === 'blitz' || this._isActiveView) {
          this._spawnParticles('gold', 28);
          this.ui.showToast(`Blitz uitbetaling: +${formatChips(s.payout)} fiches (${s.streak}x)!`, 'success');
        }
        if (!this.isRevealing) {
          this.render();
          this._syncNavLock();
          this._syncTopPhase();
        }
      });

      this.network.on('hilo_blitz_finished', (data) => {
        if (data?.blitz) this._mergePublicBlitz(data.blitz);
        if (!this.isRevealing) {
          this.render();
          this._syncNavLock();
          this._syncTopPhase();
        }
      });
    }

    /** Preserves the player's own viewerEntry while applying public Blitz updates. */
    _mergePublicBlitz(publicBlitz) {
      if (!publicBlitz) return;
      const myId = this.ui?.myPlayer?.id;
      let viewerEntry = publicBlitz.viewerEntry || null;
      if (!viewerEntry && myId && Array.isArray(publicBlitz.participants)) {
        const prev = this.blitzState?.viewerEntry;
        const pEntry = publicBlitz.participants.find((p) => p.playerId === myId);
        if (pEntry) {
          viewerEntry = {
            ...pEntry,
            choice: prev && prev.playerId === myId && pEntry.hasChoice ? prev.choice : null
          };
        }
      }
      this.blitzState = {
        ...publicBlitz,
        viewerEntry
      };
    }

    onViewActivated() {
      this._isActiveView = true;
      this.render();
      this._syncNavLock();
      this._syncTopPhase();
    }

    onViewDeactivated() {
      this._isActiveView = false;
    }

    hasActiveBets() {
      if (this.soloLadder && this.soloLadder.status === 'ACTIVE') return true;
      const ve = this.blitzState?.viewerEntry;
      const phase = this.blitzState?.phase;
      if (ve && ve.status === 'ALIVE' && ['BETTING', 'DECISION', 'REVEALING'].includes(phase)) {
        return true;
      }
      return false;
    }

    switchMode(newMode) {
      if (newMode !== 'solo' && newMode !== 'blitz') return;
      this.mode = newMode;
      this._revealLockedCard = null;
      this.isRevealing = false;
      this._resetFlipCardVisual();
      this.render();
      this._syncTopPhase();
    }

    switchFeedTab(tab) {
      this.feedTab = tab === 'history' ? 'history' : 'wins';
      if (this.el.tabWins) this.el.tabWins.classList.toggle('active', this.feedTab === 'wins');
      if (this.el.tabHistory) this.el.tabHistory.classList.toggle('active', this.feedTab === 'history');
      if (this.el.feedWins) this.el.feedWins.classList.toggle('hidden', this.feedTab !== 'wins');
      if (this.el.feedHistory) this.el.feedHistory.classList.toggle('hidden', this.feedTab !== 'history');
    }

    submitPrediction(prediction) {
      if (this.isRevealing) return;
      if (this.mode === 'blitz') {
        const ve = this.blitzState?.viewerEntry;
        if (!ve || ve.status !== 'ALIVE' || this.blitzState?.phase !== 'DECISION') return;
        this.network.hiloBlitzAction(prediction);
      } else {
        if (!this.soloLadder) return;
        this.isRevealing = true;
        this.renderControlsAndStage();
        this.network.hiloGuess(prediction);
      }
    }

    handleKeyDown(e) {
      if (!this._isActiveView || this.isRevealing) return;
      const tag = e.target && e.target.tagName ? e.target.tagName.toUpperCase() : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const key = (e.key || '').toLowerCase();
      if (key === 'h' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.submitPrediction('HIGHER');
      } else if (key === 'e') {
        e.preventDefault();
        this.submitPrediction('EQUAL');
      } else if (key === 'l' || e.key === 'ArrowDown') {
        e.preventDefault();
        this.submitPrediction('LOWER');
      } else if (key === 's' && this.mode === 'solo' && this.soloLadder && this.soloLadder.skipsRemaining > 0) {
        e.preventDefault();
        this.network.hiloSkip();
      } else if (key === 'c') {
        e.preventDefault();
        if (this.mode === 'solo' && this.soloLadder) {
          this.network.hiloCashout();
        } else if (this.mode === 'blitz' && this.blitzState?.viewerEntry?.streak >= 1) {
          this.network.hiloBlitzAction('CASHOUT');
        }
      }
    }

    _syncNavLock() {
      if (this.ui && typeof this.ui.setNavigationLocked === 'function') {
        this.ui.setNavigationLocked(this.hasActiveBets());
      }
    }

    _syncTopPhase() {
      if (!this._isActiveView || !this.ui || typeof this.ui.updatePhase !== 'function') return;
      if (this.mode === 'blitz' && this.blitzState) {
        const p = this.blitzState.phase;
        const sec = this.blitzState.timerSeconds || 0;
        if (p === 'BETTING') this.ui.updatePhase('BLITZ_BET', 8, sec);
        else if (p === 'DECISION') this.ui.updatePhase('BLITZ_DECISION', 8, sec);
        else if (p === 'REVEALING') this.ui.updatePhase('BLITZ_REVEAL', 3, sec);
        else if (p === 'SETTLED') this.ui.updatePhase('BLITZ_SETTLED', 5, sec);
        else this.ui.updatePhase('BLITZ_WAIT', 0, 'OPEN');
      } else if (this.soloLadder) {
        this.ui.updatePhase('HILO_ACTIVE', 0, `${this.soloLadder.streak}x`);
      } else {
        this.ui.updatePhase('HILO_READY', 0, 'SOLO');
      }
    }

    render() {
      if (!this.el.view) return;
      if (this.el.modeSoloBtn) this.el.modeSoloBtn.classList.toggle('active', this.mode === 'solo');
      if (this.el.modeBlitzBtn) this.el.modeBlitzBtn.classList.toggle('active', this.mode === 'blitz');

      const blitzActive =
        this.blitzState && ['BETTING', 'DECISION', 'REVEALING'].includes(this.blitzState.phase);
      if (this.el.blitzDot) this.el.blitzDot.classList.toggle('live', Boolean(blitzActive));

      this.renderHeaderMetrics();
      this.renderTopStrip();
      this.renderControlsAndStage();
      this.renderSalonList();
      this.renderFeedPanels();
    }

    renderHeaderMetrics() {
      const activeData =
        this.mode === 'blitz'
          ? (this.blitzState?.viewerEntry && this.blitzState.viewerEntry.status === 'ALIVE'
              ? {
                  streak: this.blitzState.viewerEntry.streak,
                  pot: this.blitzState.viewerEntry.pot,
                  shoeRemaining: this.blitzState.shoeRemaining ?? 52
                }
              : {
                  streak: 0,
                  pot: 0,
                  shoeRemaining: this.blitzState?.shoeRemaining ?? 52
                })
          : this.soloLadder
          ? {
              streak: this.soloLadder.streak,
              pot: this.soloLadder.pot,
              shoeRemaining: this.soloLadder.shoeRemaining
            }
          : { streak: 0, pot: 0, shoeRemaining: 52 };

      const streak = activeData.streak || 0;
      let tierKey = 'tier-start';
      let tierText = 'START';
      if (streak >= 5) {
        tierKey = 'tier-royale';
        tierText = 'ROYALE';
      } else if (streak >= 3) {
        tierKey = 'tier-on-fire';
        tierText = 'ON FIRE';
      } else if (streak >= 1) {
        tierKey = 'tier-warm';
        tierText = 'WARM';
      }

      if (this.el.tierPill) {
        this.el.tierPill.className = `hilo-tier-pill ${tierKey}`;
      }
      if (this.el.tierLabel) this.el.tierLabel.textContent = tierText;
      if (this.el.streakCount) {
        this.el.streakCount.textContent = `${streak} ${streak === 1 ? 'Kaart' : 'Kaarten'}`;
      }
      if (this.el.shoeCount) {
        this.el.shoeCount.textContent = `${activeData.shoeRemaining || 52}/52`;
      }
      if (this.el.potValue) {
        this.el.potValue.textContent = formatChips(activeData.pot);
      }
      if (this.el.stage) {
        this.el.stage.classList.toggle('tier-on-fire', streak >= 3 && streak < 5);
        this.el.stage.classList.toggle('tier-royale', streak >= 5);
      }
    }

    renderTopStrip() {
      const showBlitz = this.mode === 'blitz';
      if (this.el.cardTrail) this.el.cardTrail.classList.toggle('hidden', showBlitz);
      if (this.el.blitzBanner) this.el.blitzBanner.classList.toggle('hidden', !showBlitz);

      if (showBlitz) {
        this.renderBlitzStatus();
        return;
      }

      if (!this.el.cardTrail) return;
      const trail = this.soloLadder?.cardTrail || [];
      if (trail.length === 0) {
        this.el.cardTrail.innerHTML = '<span class="hilo-trail-empty">Start een Solo Ladder of schakel over naar Multiplayer Blitz...</span>';
        return;
      }
      this.el.cardTrail.innerHTML = trail
        .map((c, idx) => {
          const isCur = idx === trail.length - 1;
          const cls = `hilo-trail-chip${isRedSuit(c.suit) ? ' is-red' : ''}${isCur ? ' is-current' : ''}${c.fromSkip ? ' is-skip' : ''}`;
          const suitRef = SUIT_SYMBOL_MAP[c.suit] || '#suit-spade';
          return `<span class="${cls}">${escapeHtml(c.rank)}<svg viewBox="0 0 24 24"><use href="${suitRef}"></use></svg></span>`;
        })
        .join('');
    }

    renderBlitzStatus() {
      const b = this.blitzState;
      if (!b) return;
      if (this.el.blitzRound) this.el.blitzRound.textContent = `BLITZ #${b.roundId || 0}`;
      const phaseNames = {
        WAITING_FOR_PLAYERS: 'WACHT OP EERSTE INZET',
        BETTING: 'INSCHRIJVEN OPEN',
        DECISION: `KAART ${b.cardIndex || 1}/${b.maxCards || 8} • KIES`,
        REVEALING: 'KAART DRAAIT...',
        SETTLED: 'RONDE AFGEROND'
      };
      if (this.el.blitzPhase) {
        this.el.blitzPhase.textContent = phaseNames[b.phase] || b.phase;
      }
      if (this.el.blitzCountdown) {
        this.el.blitzCountdown.textContent = b.timerSeconds > 0 ? `${b.timerSeconds}s` : '--';
      }
      if (this.el.blitzSurvivors) {
        this.el.blitzSurvivors.textContent = `${b.aliveCount || 0} actief`;
      }
      const cv = b.crowdVotes || { higher: 0, equal: 0, lower: 0 };
      if (this.el.crowdHigher) this.el.crowdHigher.style.width = `${cv.higher}%`;
      if (this.el.crowdEqual) this.el.crowdEqual.style.width = `${cv.equal}%`;
      if (this.el.crowdLower) this.el.crowdLower.style.width = `${cv.lower}%`;
      if (this.el.crowdPcts) {
        this.el.crowdPcts.textContent = `${cv.higher}% / ${cv.equal}% / ${cv.lower}%`;
      }
    }

    renderControlsAndStage() {
      let cardToDisplay = { rank: 'K', suit: 'spades', value: 13 };
      let odds = null;
      let pot = 0;

      if (this.mode === 'blitz') {
        const b = this.blitzState;
        if (b && b.currentCard) cardToDisplay = b.currentCard;
        odds = b ? b.odds : null;
        const ve = b?.viewerEntry;
        pot = ve && ve.status === 'ALIVE' ? ve.pot : 0;

        const isDecision = Boolean(b && b.phase === 'DECISION' && ve && ve.status === 'ALIVE');
        const showEntry = !isDecision;
        if (this.el.entryControls) this.el.entryControls.classList.toggle('hidden', !showEntry);
        if (this.el.activeControls) this.el.activeControls.classList.toggle('hidden', !isDecision);

        if (this.el.startBtn) this.el.startBtn.classList.add('hidden');
        const canJoin = Boolean(!ve && (!b || b.phase === 'WAITING_FOR_PLAYERS' || b.phase === 'BETTING'));
        const canCancel = Boolean(ve && b && b.phase === 'BETTING');
        if (this.el.blitzJoinBtn) {
          this.el.blitzJoinBtn.classList.toggle('hidden', !showEntry);
          this.el.blitzJoinBtn.disabled = !canJoin;
        }
        if (this.el.blitzCancelBtn) {
          this.el.blitzCancelBtn.classList.toggle('hidden', !canCancel);
        }

        if (this.el.skipBtn) this.el.skipBtn.classList.add('hidden');
        if (this.el.halfCashoutBtn) this.el.halfCashoutBtn.classList.add('hidden');
        if (this.el.cashoutBtn) {
          const canBlitzCash = isDecision && ve && ve.streak >= 1;
          this.el.cashoutBtn.disabled = !canBlitzCash || this.isRevealing;
          if (this.el.currentPayout) this.el.currentPayout.textContent = formatChips(pot);
        }
      } else {
        const l = this.soloLadder;
        if (l && l.currentCard) cardToDisplay = l.currentCard;
        odds = l ? l.odds : null;
        pot = l ? l.pot : 0;

        const isActive = Boolean(l && l.status === 'ACTIVE');
        if (this.el.entryControls) this.el.entryControls.classList.toggle('hidden', isActive);
        if (this.el.activeControls) this.el.activeControls.classList.toggle('hidden', !isActive);

        if (this.el.startBtn) this.el.startBtn.classList.remove('hidden');
        if (this.el.blitzJoinBtn) this.el.blitzJoinBtn.classList.add('hidden');
        if (this.el.blitzCancelBtn) this.el.blitzCancelBtn.classList.add('hidden');

        if (this.el.skipBtn) {
          this.el.skipBtn.classList.remove('hidden');
          const skipsLeft = l ? l.skipsRemaining : 2;
          this.el.skipBtn.disabled = !isActive || skipsLeft <= 0 || this.isRevealing;
          if (this.el.skipCount) this.el.skipCount.textContent = `${skipsLeft}/2`;
        }
        if (this.el.halfCashoutBtn) {
          this.el.halfCashoutBtn.classList.remove('hidden');
          this.el.halfCashoutBtn.disabled = !isActive || !l.canHalfCashout || this.isRevealing;
          if (this.el.halfAmount) {
            this.el.halfAmount.textContent = l && l.canHalfCashout ? `+${formatChips(l.halfCashoutPreview)}` : '+0';
          }
        }
        if (this.el.cashoutBtn) {
          this.el.cashoutBtn.disabled = !isActive || this.isRevealing;
          if (this.el.currentPayout) this.el.currentPayout.textContent = formatChips(pot);
        }
      }

      if (this.isRevealing && this._revealLockedCard) {
        cardToDisplay = this._revealLockedCard;
      } else {
        this._lastDisplayedCard = cardToDisplay;
      }

      this._paintCardElement(this.el.currentCard, {
        rankTL: this.el.curRankTL,
        suitTL: this.el.curSuitTL,
        rankMain: this.el.curRankMain,
        suitMain: this.el.curSuitMain,
        rankBR: this.el.curRankBR,
        suitBR: this.el.curSuitBR
      }, cardToDisplay);

      this._renderOddsAndButtons(odds, pot);
    }

    _paintCardElement(cardBox, refs, card) {
      if (!cardBox || !card) return;
      cardBox.classList.toggle('is-red', isRedSuit(card.suit));
      const suitHref = SUIT_SYMBOL_MAP[card.suit] || '#suit-spade';
      if (refs.rankTL) refs.rankTL.textContent = card.rank;
      if (refs.rankMain) refs.rankMain.textContent = card.rank;
      if (refs.rankBR) refs.rankBR.textContent = card.rank;
      if (refs.suitTL) refs.suitTL.setAttribute('href', suitHref);
      if (refs.suitMain) refs.suitMain.setAttribute('href', suitHref);
      if (refs.suitBR) refs.suitBR.setAttribute('href', suitHref);
    }

    _renderOddsAndButtons(odds, pot) {
      const h = odds?.higher || { available: true, pct: 15.7, multiplier: 1.25 };
      const e = odds?.equal || { available: true, pct: 5.9, multiplier: 16.0 };
      const l = odds?.lower || { available: true, pct: 78.4, multiplier: 1.20 };

      if (this.el.probHigherPct) this.el.probHigherPct.textContent = `${h.pct}%`;
      if (this.el.probEqualPct) this.el.probEqualPct.textContent = `${e.pct}%`;
      if (this.el.probLowerPct) this.el.probLowerPct.textContent = `${l.pct}%`;
      if (this.el.probHigherBar) this.el.probHigherBar.style.width = `${h.pct}%`;
      if (this.el.probEqualBar) this.el.probEqualBar.style.width = `${e.pct}%`;
      if (this.el.probLowerBar) this.el.probLowerBar.style.width = `${l.pct}%`;

      const selectedBlitzChoice =
        this.mode === 'blitz' && this.blitzState?.viewerEntry ? this.blitzState.viewerEntry.choice : null;

      this._bindDirBtn(this.el.higherBtn, this.el.higherOdds, this.el.higherPayout, h, pot, selectedBlitzChoice === 'HIGHER');
      this._bindDirBtn(this.el.equalBtn, this.el.equalOdds, this.el.equalPayout, e, pot, selectedBlitzChoice === 'EQUAL');
      this._bindDirBtn(this.el.lowerBtn, this.el.lowerOdds, this.el.lowerPayout, l, pot, selectedBlitzChoice === 'LOWER');
    }

    _bindDirBtn(btn, oddsEl, payoutEl, dirOdds, pot, isSelected) {
      if (!btn) return;
      const enabled = Boolean(dirOdds && dirOdds.available && dirOdds.multiplier > 0 && !this.isRevealing);
      btn.disabled = !enabled;
      btn.classList.toggle('is-selected', Boolean(isSelected));
      if (oddsEl) {
        oddsEl.textContent = dirOdds && dirOdds.available ? `${dirOdds.multiplier.toFixed(2)}x` : '--';
      }
      if (payoutEl) {
        if (dirOdds && dirOdds.available && pot > 0) {
          const nextPot = Math.max(1, Math.floor(pot * dirOdds.multiplier));
          payoutEl.textContent = `-> ${formatChips(nextPot)} F`;
        } else {
          payoutEl.textContent = dirOdds && dirOdds.available ? `${dirOdds.pct}%` : 'Niet mogelijk';
        }
      }
    }

    renderSalonList() {
      if (!this.el.salonList) return;
      const myId = this.ui?.myPlayer?.id;
      const players = this.salonPlayers || [];
      if (this.el.salonCount) {
        this.el.salonCount.textContent = `${players.length} ${players.length === 1 ? 'speler' : 'spelers'}`;
      }
      if (players.length === 0) {
        this.el.salonList.innerHTML = '<div class="hilo-empty-note">Nog geen spelers actief in de Hi-Lo Zaal.</div>';
        return;
      }

      this.el.salonList.innerHTML = players
        .map((p) => {
          const isSelf = myId && p.id === myId;
          const cardHtml = p.currentCard
            ? `<span class="hilo-mini-card${isRedSuit(p.currentCard.suit) ? ' is-red' : ''}">${escapeHtml(p.currentCard.rank)}<svg viewBox="0 0 24 24"><use href="${SUIT_SYMBOL_MAP[p.currentCard.suit] || '#suit-spade'}"></use></svg></span>`
            : '';
          const modeLabel = p.activeBlitz ? 'BLITZ' : p.activeSolo ? 'SOLO' : 'KIJKT';
          const cheerBtn = isSelf
            ? `<span class="hilo-count-pill">${p.cheers || 0} juich</span>`
            : `<button type="button" class="btn-hilo-cheer" data-cheer-target="${escapeHtml(p.id)}">JUICH (${p.cheers || 0})</button>`;
          return `
            <div class="hilo-salon-card">
              <div class="hilo-salon-player">
                <span class="hilo-avatar-dot" style="background:${escapeHtml(p.avatarColor || '#d4af37')}">${escapeHtml(p.initials || 'PL')}</span>
                <div class="hilo-salon-meta">
                  <span class="hilo-salon-name">${escapeHtml(p.name)}${isSelf ? ' (Jij)' : ''}</span>
                  <span class="hilo-salon-stats">${modeLabel} • ${p.streak || 0}x • ${formatChips(p.pot)} F</span>
                </div>
              </div>
              <div class="hilo-salon-actions">
                ${cardHtml}
                ${cheerBtn}
              </div>
            </div>`;
        })
        .join('');
    }

    renderFeedPanels() {
      if (this.el.feedWins) {
        if (!this.recentWins || this.recentWins.length === 0) {
          this.el.feedWins.innerHTML = '<div class="hilo-empty-note">Nog geen grote uitbetalingen in deze sessie.</div>';
        } else {
          this.el.feedWins.innerHTML = this.recentWins
            .map(
              (w) => `
              <div class="hilo-feed-item">
                <span><strong>${escapeHtml(w.playerName)}</strong> (${w.mode} ${w.maxStreak}x)</span>
                <span class="hilo-feed-pos">+${formatChips(w.netProfit)} F</span>
              </div>`
            )
            .join('');
        }
      }

      if (this.el.feedHistory) {
        if (!this.personalHistory || this.personalHistory.length === 0) {
          this.el.feedHistory.innerHTML = '<div class="hilo-empty-note">Speel een Solo Ladder of Blitz voor jouw historiek.</div>';
        } else {
          this.el.feedHistory.innerHTML = this.personalHistory
            .map((h) => {
              const cls = h.netProfit >= 0 ? 'hilo-feed-pos' : 'hilo-feed-neg';
              const sign = h.netProfit >= 0 ? '+' : '-';
              return `
                <div class="hilo-feed-item">
                  <span>${escapeHtml(h.mode)} • ${h.maxStreak || 0}x (${escapeHtml(h.outcome)})</span>
                  <span class="${cls}">${sign}${formatChips(Math.abs(h.netProfit))} F</span>
                </div>`;
            })
            .join('');
        }
      }
    }

    _resetFlipCardVisual() {
      clearTimeout(this._flipTimeout);
      clearTimeout(this._settleTimeout);
      clearTimeout(this._afterRevealTimeout);
      if (this.el.flipCard) {
        this.el.flipCard.classList.add('is-instant');
        this.el.flipCard.classList.remove('flipped', 'is-slowmo', 'is-suspense');
        void this.el.flipCard.offsetWidth;
        this.el.flipCard.classList.remove('is-instant');
      }
      if (this.el.currentCard) {
        this.el.currentCard.classList.remove('card-promote');
      }
      if (this.el.nextCard) {
        this.el.nextCard.classList.remove('flash-win', 'flash-loss');
      }
      if (this.el.resultBanner) {
        this.el.resultBanner.classList.add('hidden');
      }
    }

    _triggerPromoteAnim() {
      if (!this.el.currentCard) return;
      this.el.currentCard.classList.remove('card-promote');
      void this.el.currentCard.offsetWidth;
      this.el.currentCard.classList.add('card-promote');
    }

    _showBanner(text, kind) {
      if (!this.el.resultBanner) return;
      this.el.resultBanner.textContent = text;
      this.el.resultBanner.className = `hilo-result-banner ${kind}`;
    }

    _playCardReveal(res, onDone) {
      const fallbackCard =
        this._lastDisplayedCard ||
        (this.mode === 'blitz' ? this.blitzState?.currentCard : this.soloLadder?.currentCard) ||
        null;
      const lockedPreviousCard = res.previousCard || fallbackCard;

      this._resetFlipCardVisual();
      this._revealLockedCard = lockedPreviousCard;
      this.isRevealing = true;
      this.renderControlsAndStage();

      if (res.nextCard) {
        this._paintCardElement(this.el.nextCard, {
          rankTL: this.el.nextRankTL,
          suitTL: this.el.nextSuitTL,
          rankMain: this.el.nextRankMain,
          suitMain: this.el.nextSuitMain,
          rankBR: this.el.nextRankBR,
          suitBR: this.el.nextSuitBR
        }, res.nextCard);
      }

      const slowMo = Boolean(res.slowMo);
      const preDelay = slowMo ? 450 : 40;
      const flipDuration = slowMo ? 1350 : 550;
      const holdAfterFlip = slowMo ? 650 : 700;

      if (this.el.flipCard && slowMo) {
        this.el.flipCard.classList.add('is-slowmo', 'is-suspense');
      }

      this._flipTimeout = setTimeout(() => {
        if (this.el.flipCard) {
          this.el.flipCard.classList.remove('is-suspense');
          this.el.flipCard.classList.add('flipped');
        }

        this._settleTimeout = setTimeout(() => {
          const isWin = Boolean(res.won);
          if (this.el.nextCard) {
            this.el.nextCard.classList.add(isWin ? 'flash-win' : 'flash-loss');
          }
          if (isWin) {
            const winBanner = res.multiplier
              ? `GOED! ${res.multiplier.toFixed(2)}x`
              : (res.isBlitz && !res.didParticipate ? 'TAFEL DOOR!' : 'GOED! WINST');
            this._showBanner(winBanner, 'win');
            this._spawnParticles(slowMo ? 'gold' : 'emerald', slowMo ? 32 : 18);
          } else {
            const lossBanner = res.isBlitz && !res.didParticipate ? 'TAFEL MIS!' : 'MIS! REEKS VOORBIJ';
            this._showBanner(lossBanner, 'loss');
            this._spawnParticles('crimson', 16);
          }

          this._afterRevealTimeout = setTimeout(() => {
            this._resetFlipCardVisual();
            this._revealLockedCard = null;
            this.isRevealing = false;
            if (typeof onDone === 'function') onDone();
          }, holdAfterFlip);
        }, flipDuration);
      }, preDelay);
    }

    _spawnParticles(palette, count) {
      const canvas = this.el.fxCanvas;
      if (!canvas || !canvas.getContext) return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      canvas.width = rect.width;
      canvas.height = rect.height;

      const colors =
        palette === 'gold'
          ? ['#fde68a', '#d4af37', '#f59e0b', '#ffffff']
          : palette === 'crimson'
          ? ['#ef4444', '#fca5a5', '#991b1b']
          : ['#10b981', '#6ee7b7', '#d4af37'];

      const cx = rect.width * 0.56;
      const cy = rect.height * 0.45;
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
        const speed = 1.8 + Math.random() * 4.5;
        this._particles.push({
          x: cx,
          y: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1.2,
          life: 1,
          decay: 0.02 + Math.random() * 0.02,
          size: 3 + Math.random() * 4,
          color: colors[i % colors.length]
        });
      }

      if (!this._fxRaf) {
        const step = () => {
          const ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          this._particles = this._particles.filter((p) => p.life > 0);
          for (const p of this._particles) {
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.12;
            p.life -= p.decay;
            ctx.globalAlpha = Math.max(0, p.life);
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
          if (this._particles.length > 0) {
            this._fxRaf = requestAnimationFrame(step);
          } else {
            this._fxRaf = null;
          }
        };
        this._fxRaf = requestAnimationFrame(step);
      }
    }
  }

  return CasinoHilo;
}));
