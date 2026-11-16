/**
 * @fileoverview Monte Carlo Hi-Lo Prive client controller (Solo Ladder).
 * Manages Solo Ladder mode, 3D card flip reveals with slow-mo suspense,
 * canvas particle FX, live Zaal player cards, 50% Half-Cashout, free Card Swaps,
 * and personal ladder history.
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

      this.mode = 'solo';
      this.feedTab = 'wins'; // 'wins' | 'history'
      this.soloLadder = null;
      this.salonPlayers = [];
      this.recentWins = [];
      this.personalHistory = [];
      this.isRevealing = false;
      this._isActiveView = false;

      this._flipTimeout = null;
      this._settleTimeout = null;
      this._afterRevealTimeout = null;
      this._guessTimeout = null;
      this._pendingStartAction = null;
      this._revealLockedCard = null;
      this._lastDisplayedCard = null;
      this._particles = [];
      this._fxRaf = null;
    }

    _isNetworkConnected() {
      if (!this.network) return false;
      if ('isConnected' in this.network) {
        if (!this.network.isConnected) return false;
        if (this.network.socket && this.network.socket.connected === false) return false;
      }
      return true;
    }

    _isNetworkAuthenticated() {
      if (this.ui && this.ui.myPlayer && this.ui.myPlayer.id) return true;
      if (this.network && 'isAuthenticated' in this.network) {
        return Boolean(this.network.isAuthenticated);
      }
      return true;
    }

    _isViewVisible() {
      return Boolean(this._isActiveView || (this.el?.view && !this.el.view.classList.contains('hidden')));
    }

    _clearGuessTimeout() {
      if (this._guessTimeout) {
        clearTimeout(this._guessTimeout);
        this._guessTimeout = null;
      }
    }

    _ensureReadyForAction(actionDesc, onAuthReady) {
      if (!this._isNetworkConnected()) {
        if (this.ui && typeof this.ui.showToast === 'function') {
          this.ui.showToast('Geen verbinding met de server. Opnieuw verbinden...', 'error');
        }
        return false;
      }
      if (!this._isNetworkAuthenticated()) {
        const hasCreds = typeof this.network?.hasStoredCredentials === 'function' && this.network.hasStoredCredentials();
        if (hasCreds && typeof this.network.tryAutoReauth === 'function') {
          if (typeof onAuthReady === 'function') {
            this._pendingStartAction = { fn: onAuthReady, expiresAt: Date.now() + 5000 };
          }
          this.network.tryAutoReauth({ code: 'PLAYER_NOT_FOUND' });
          if (this.ui && typeof this.ui.showToast === 'function') {
            this.ui.showToast('Sessie wordt hersteld, even geduld...', 'info');
          }
          return false;
        }
        if (this.ui) {
          if (typeof this.ui.showLoginModal === 'function') this.ui.showLoginModal();
          if (typeof this.ui.showToast === 'function') {
            this.ui.showToast(`Log eerst in om ${actionDesc}.`, 'error');
          }
        }
        return false;
      }
      return true;
    }

    _startSoloFromInput() {
      if (!this._ensureReadyForAction('Hi-Lo te starten', () => this._startSoloFromInput())) return;
      if (this.soloLadder && this.soloLadder.status === 'ACTIVE') {
        this.render();
        if (this.ui && typeof this.ui.showToast === 'function') {
          this.ui.showToast('Je hebt al een actieve Hi-Lo reeks openstaan.', 'info');
        }
        return;
      }
      const rawVal = this.el?.betInput?.value;
      const bet = Math.floor(Number(rawVal !== undefined && rawVal !== '' ? rawVal : 100));
      if (!Number.isFinite(bet) || bet < 10 || bet > 50000) {
        if (this.ui && typeof this.ui.showToast === 'function') {
          this.ui.showToast('Inzet moet tussen 10 en 50.000 fiches liggen.', 'error');
        }
        return;
      }
      if (this.ui?.myPlayer?.id && typeof this.ui.myPlayer.chips === 'number' && this.ui.myPlayer.chips < bet) {
        if (this.ui && typeof this.ui.showToast === 'function') {
          this.ui.showToast('Onvoldoende fiches voor deze inzet.', 'error');
        }
        return;
      }
      this.network.hiloStart(bet);
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
        tierPill: document.getElementById('hilo-tier-pill'),
        tierLabel: document.getElementById('hilo-tier-label'),
        streakCount: document.getElementById('hilo-streak-count'),
        shoeCount: document.getElementById('hilo-shoe-count'),
        potValue: document.getElementById('hilo-pot-value'),

        cardTrail: document.getElementById('hilo-card-trail'),

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
          this._startSoloFromInput();
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
          if (this.isRevealing) return;
          if (!this._ensureReadyForAction('een kaart te wisselen')) return;
          this.network.hiloSkip();
        });
      }

      if (this.el.halfCashoutBtn) {
        this.el.halfCashoutBtn.addEventListener('click', () => {
          if (this.isRevealing) return;
          if (!this._ensureReadyForAction('50% uit te cashen')) return;
          this.network.hiloHalfCashout();
        });
      }

      if (this.el.cashoutBtn) {
        this.el.cashoutBtn.addEventListener('click', () => {
          if (this.isRevealing) return;
          if (!this._ensureReadyForAction('uit te betalen')) return;
          this.network.hiloCashout();
        });
      }

      if (this.el.tabWins) {
        this.el.tabWins.addEventListener('click', () => this.switchFeedTab('wins'));
      }
      if (this.el.tabHistory) {
        this.el.tabHistory.addEventListener('click', () => this.switchFeedTab('history'));
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
        this.renderSalonList();
        this.renderFeedPanels();
      });

      this.network.on('hilo_rejected', (data) => {
        this._clearGuessTimeout();
        this._revealLockedCard = null;
        this.isRevealing = false;
        if (data?.code === 'PLAYER_NOT_FOUND' && this._pendingStartAction && Date.now() <= this._pendingStartAction.expiresAt) {
          this.renderControlsAndStage();
          return;
        }
        if (data?.reason && this._isViewVisible()) {
          this.ui?.showToast?.(data.reason, 'error');
        }
        this.renderControlsAndStage();
      });

      this.network.on('connection_change', (data) => {
        if (!data || !data.connected) {
          this._pendingStartAction = null;
          this._clearGuessTimeout();
          if (this.isRevealing) {
            this._revealLockedCard = null;
            this.isRevealing = false;
            this._resetFlipCardVisual();
            this.renderControlsAndStage();
          }
          return;
        }
      });

      this.network.on('auth_success', () => {
        if (this._isViewVisible() && typeof this.network.hiloJoin === 'function') {
          this.network.hiloJoin();
        }
        const pending = this._pendingStartAction;
        this._pendingStartAction = null;
        if (pending && Date.now() <= pending.expiresAt && typeof pending.fn === 'function') {
          pending.fn();
        }
      });

      const cancelAuthHilo = () => {
        this._pendingStartAction = null;
        this._clearGuessTimeout();
        if (this.isRevealing) {
          this._revealLockedCard = null;
          this.isRevealing = false;
          this._resetFlipCardVisual();
          this.renderControlsAndStage();
        }
      };
      this.network.on('auth_error', cancelAuthHilo);
      this.network.on('session_lost', cancelAuthHilo);

      this.network.on('hilo_started', (data) => {
        if (!data) return;
        this._clearGuessTimeout();
        this.mode = 'solo';
        this.soloLadder = data.ladder || null;
        this._revealLockedCard = null;
        this.isRevealing = false;
        this._resetFlipCardVisual();
        if (data.reshuffled && this._isViewVisible()) {
          this.ui?.showToast?.('Nieuwe 52-kaarten slof geschud!', 'info');
        }
        this.render();
        this._syncNavLock();
        this._syncTopPhase();
      });

      this.network.on('hilo_guess_result', (res) => {
        if (!res) return;
        this._clearGuessTimeout();
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
      return Boolean(this.soloLadder && this.soloLadder.status === 'ACTIVE');
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
      if (!this._ensureReadyForAction('een kaartkeuze te maken')) return;
      if (!this.soloLadder) return;
      this.isRevealing = true;
      this.renderControlsAndStage();
      this._clearGuessTimeout();
      this._guessTimeout = setTimeout(() => {
        this._guessTimeout = null;
        if (this.isRevealing && !this._revealLockedCard) {
          this.isRevealing = false;
          this.renderControlsAndStage();
          if (this.ui && typeof this.ui.showToast === 'function') {
            this.ui.showToast('Geen reactie van server. Probeer je keuze opnieuw.', 'error');
          }
        }
      }, 4500);
      this.network.hiloGuess(prediction);
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
      } else if (key === 's' && this.soloLadder && this.soloLadder.skipsRemaining > 0) {
        e.preventDefault();
        this.network.hiloSkip();
      } else if (key === 'c' && this.soloLadder) {
        e.preventDefault();
        this.network.hiloCashout();
      }
    }

    _syncNavLock() {
      if (this.ui && typeof this.ui.setNavigationLocked === 'function') {
        this.ui.setNavigationLocked(this.hasActiveBets());
      }
    }

    _syncTopPhase() {
      if (!this._isActiveView || !this.ui || typeof this.ui.updatePhase !== 'function') return;
      if (this.soloLadder) {
        this.ui.updatePhase('HILO_ACTIVE', 0, `${this.soloLadder.streak}x`);
      } else {
        this.ui.updatePhase('HILO_READY', 0, 'SOLO');
      }
    }

    render() {
      if (!this.el.view) return;
      this.renderHeaderMetrics();
      this.renderTopStrip();
      this.renderControlsAndStage();
      this.renderSalonList();
      this.renderFeedPanels();
    }

    renderHeaderMetrics() {
      const activeData = this.soloLadder
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
      if (!this.el.cardTrail) return;
      const trail = this.soloLadder?.cardTrail || [];
      if (trail.length === 0) {
        this.el.cardTrail.innerHTML = '<span class="hilo-trail-empty">Start een Solo Ladder om kaartgeschiedenis te zien...</span>';
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

    renderControlsAndStage() {
      let cardToDisplay = { rank: 'K', suit: 'spades', value: 13 };
      const l = this.soloLadder;
      if (l && l.currentCard) cardToDisplay = l.currentCard;
      const odds = l ? l.odds : null;
      const pot = l ? l.pot : 0;

      const isActive = Boolean(l && l.status === 'ACTIVE');
      if (this.el.entryControls) this.el.entryControls.classList.toggle('hidden', isActive);
      if (this.el.activeControls) this.el.activeControls.classList.toggle('hidden', !isActive);

      if (this.el.startBtn) this.el.startBtn.classList.remove('hidden');

      if (this.el.skipBtn) {
        this.el.skipBtn.classList.remove('hidden');
        const skipsLeft = l ? l.skipsRemaining : 2;
        this.el.skipBtn.disabled = !isActive || skipsLeft <= 0 || this.isRevealing;
        if (this.el.skipCount) this.el.skipCount.textContent = `${skipsLeft}/2`;
      }
      if (this.el.halfCashoutBtn) {
        this.el.halfCashoutBtn.classList.remove('hidden');
        this.el.halfCashoutBtn.disabled = !isActive || !l || !l.canHalfCashout || this.isRevealing;
        if (this.el.halfAmount) {
          this.el.halfAmount.textContent = l && l.canHalfCashout ? `+${formatChips(l.halfCashoutPreview)}` : '+0';
        }
      }
      if (this.el.cashoutBtn) {
        this.el.cashoutBtn.disabled = !isActive || this.isRevealing;
        if (this.el.currentPayout) this.el.currentPayout.textContent = formatChips(pot);
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

      this._bindDirBtn(this.el.higherBtn, this.el.higherOdds, this.el.higherPayout, h, pot, false);
      this._bindDirBtn(this.el.equalBtn, this.el.equalOdds, this.el.equalPayout, e, pot, false);
      this._bindDirBtn(this.el.lowerBtn, this.el.lowerOdds, this.el.lowerPayout, l, pot, false);
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
          const modeLabel = p.activeSolo ? 'SOLO' : 'KIJKT';
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
          this.el.feedHistory.innerHTML = '<div class="hilo-empty-note">Speel een Solo Ladder voor jouw historiek.</div>';
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
        this.soloLadder?.currentCard ||
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
              : 'GOED! WINST';
            this._showBanner(winBanner, 'win');
            this._spawnParticles(slowMo ? 'gold' : 'emerald', slowMo ? 32 : 18);
          } else {
            this._showBanner('MIS! REEKS VOORBIJ', 'loss');
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
