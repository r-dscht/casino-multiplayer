/**
 * ui.js
 * European Roulette UI Controller & DOM Interaction Engine.
 * 
 * Features:
 * - Interactive European Roulette board (0, 1-36, Columns, Dozens, Outside bets, Splits, Streets, Corners, Six-Lines).
 * - Multi-player chip rendering and stacking on betting spots.
 * - Chip selector dock (10, 50, 100, 500, 1000, Clear, Double).
 * - Top HUD (player bankroll, countdown timer, phase badge, 15-number winning history strip).
 * - Live multiplayer chatbox with system event logging and XSS-safe text rendering.
 * - VIP Onboarding Modal with 8 luxury color swatches and localStorage memory.
 * - Toast alert notification system.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CasinoUI = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const RED_NUMBERS = new Set([
    1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36
  ]);

  const LUXURY_SWATCHES = [
    { name: 'Imperial Gold', color: '#c5a059' },
    { name: 'Monte Carlo Emerald', color: '#0d5c3a' },
    { name: 'Royal Sapphire', color: '#1e3a8a' },
    { name: 'Crimson Ruby', color: '#991b1b' },
    { name: 'Smoked Obsidian', color: '#18181b' },
    { name: 'Polished Platinum', color: '#475569' },
    { name: 'Monaco Amethyst', color: '#581c87' },
    { name: 'Antique Bronze', color: '#78350f' },
    { name: 'Riviera Turquoise', color: '#0f766e' },
    { name: 'Champagne Rose', color: '#831843' },
    { name: 'Cognac Amber', color: '#92400e' },
    { name: 'Brushed Titanium', color: '#334155' }
  ];

  function getMonogram(name) {
    if (!name || typeof name !== 'string') return '?';
    // Strip special symbols, HTML artifacts, and excess spaces
    const clean = name.replace(/<[^>]*>/g, '').trim();
    if (!clean) return '?';

    // Split on whitespace, underscores, or hyphens
    const tokens = clean.split(/[\s_\-]+/).filter(t => t.length > 0);
    
    if (tokens.length >= 2) {
      // First character of first token + first character of second token
      const firstChar = Array.from(tokens[0])[0];
      const secondChar = Array.from(tokens[1])[0];
      return (firstChar + secondChar).toUpperCase();
    }
    
    // Single token: take first 2 characters if available, else 1
    const chars = Array.from(tokens[0]);
    if (chars.length === 1) {
      return chars[0].toUpperCase();
    }
    return (chars[0] + chars[1]).toUpperCase();
  }

  class CasinoUI {
    /**
     * @param {Object} options
     * @param {Function} options.onJoinTable
     * @param {Function} options.onPlaceBet
     * @param {Function} options.onClearBets
     * @param {Function} options.onSendChat
     * @param {Function} options.onDoubleBets
     */
    constructor(options = {}) {
      this.options = options;

      // Player state
      this.myPlayer = {
        id: null,
        name: 'VIP Player',
        color: '#D4AF37',
        chips: 10000
      };

      // Current betting selection
      this.selectedChip = 100;
      this.currentPhase = 'BETTING';
      this.myBets = [];
      this.allBetsBySpot = new Map(); // spotKey -> Array<{ playerId, playerName, playerColor, amount }>

      // Tabbed Chat State (R5)
      this.activeChatScope = 'global';
      this.unreadCounts = { global: 0, table: 0 };
      this.currentTableId = 'roulette';

      // Navigation Bet Lock State (R2)
      this.isNavigationLocked = false;

      // Payout Counter Ticker Previous Balance (R6)
      this._prevChips = 10000;

      // DOM Elements cache
      this.elements = {};

      this.init();
    }

    init() {
      this.cacheElements();
      this.setupColorSwatches();
      this.setupOnboarding();
      this.buildBettingGrid();
      this.setupChipDock();
      this.setupChat();
      this.setupSidebarTabs();
      this.setupProfileTab();
      this.setupInspectorModal();
    }

    cacheElements() {
      this.elements = {
        // Modal & Account Login
        modal: document.getElementById('onboarding-modal'),
        inputName: document.getElementById('input-player-name'),
        inputPassword: document.getElementById('input-player-password'),
        loginErrorMsg: document.getElementById('login-error-msg'),
        palette: document.getElementById('color-palette'),
        btnEnterTable: document.getElementById('btn-enter-table'),

        // HUD
        avatarDisc: document.getElementById('hud-avatar-disc'),
        playerName: document.getElementById('hud-player-name'),
        playerChips: document.getElementById('hud-player-chips'),
        phaseTitle: document.getElementById('phase-title'),
        phaseTimer: document.getElementById('phase-timer'),
        historyStrip: document.getElementById('hud-history-strip'),

        // View Panes & Game Switcher
        viewRoulette: document.getElementById('roulette-view'),
        viewBlackjack: document.getElementById('blackjack-view'),
        viewPoker: document.getElementById('poker-view'),
        pillRoulette: document.getElementById('pill-roulette'),
        pillBlackjack: document.getElementById('pill-blackjack'),
        pillPoker: document.getElementById('pill-poker'),
        pokerFeltStage: document.getElementById('poker-felt-stage'),
        pokerBuyinModal: document.getElementById('poker-buyin-modal'),
        gamePills: document.querySelectorAll('.game-pill'),

        // Board & Controls (Roulette)
        gridContainer: document.getElementById('roulette-betting-grid'),
        chipButtons: document.querySelectorAll('#roulette-view .chip-btn, .controls-bar .chip-btn'),
        btnClearBets: document.getElementById('btn-clear-bets'),
        btnDoubleBets: document.getElementById('btn-double-bets'),
        btnInsideHelper: document.getElementById('btn-inside-helper'),
        insideModal: document.getElementById('inside-bets-modal'),
        btnCloseInsideModal: document.getElementById('btn-close-inside-modal'),

        // Blackjack Table Elements
        bjTableBtn1: document.getElementById('bj-table-btn-1'),
        bjTableBtn2: document.getElementById('bj-table-btn-2'),
        bjTableName: document.getElementById('bj-table-name'),
        bjShoeFill: document.getElementById('bj-shoe-fill'),
        bjShoeText: document.getElementById('bj-shoe-text'),
        bjDealerCards: document.getElementById('bj-dealer-cards'),
        bjDealerScore: document.getElementById('bj-dealer-score'),
        bjSeatsArc: document.getElementById('bj-seats-arc'),
        btnBjHit: document.getElementById('btn-bj-hit'),
        btnBjStand: document.getElementById('btn-bj-stand'),
        btnBjDouble: document.getElementById('btn-bj-double'),
        btnBjSplit: document.getElementById('btn-bj-split'),
        btnBjClear: document.getElementById('btn-bj-clear'),
        bjResultBanner: document.getElementById('blackjack-result-banner'),
        winShimmerCanvas: document.getElementById('win-shimmer-canvas'),

        // Sidebar Tabs, Leaderboard & Bets
        sidebarTabs: document.querySelectorAll('.sidebar-tab'),
        tabPanes: document.querySelectorAll('.sidebar-tab-pane'),
        leaderboardList: document.getElementById('leaderboard-list'),
        activeBetsList: document.getElementById('active-bets-list'),
        betsCountBadge: document.getElementById('bets-count-badge'),
        tableTotalChips: document.getElementById('table-total-chips'),
        playersOnlineCount: document.getElementById('players-online-count'),

        // Profile Tab
        profileAvatarDisc: document.getElementById('profile-avatar-disc'),
        profileMonogramLetter: document.getElementById('profile-monogram-letter'),
        profileUserName: document.getElementById('profile-user-name'),
        profilePresenceBadge: document.getElementById('profile-presence-badge'),
        profilePresenceText: document.getElementById('profile-presence-text'),
        profileStatChips: document.getElementById('profile-stat-chips'),
        profileStatRounds: document.getElementById('profile-stat-rounds'),
        profileStatTotalWon: document.getElementById('profile-stat-total-won'),
        profileStatBiggestWin: document.getElementById('profile-stat-biggest-win'),
        profileMemberDate: document.getElementById('profile-member-date'),
        profileColorPalette: document.getElementById('profile-color-palette'),

        // Player Inspector Modal
        inspectorModal: document.getElementById('player-profile-modal'),
        btnCloseProfileModal: document.getElementById('btn-close-profile-modal'),
        inspectorAvatarDisc: document.getElementById('inspector-avatar-disc'),
        inspectorMonogramLetter: document.getElementById('inspector-monogram-letter'),
        inspectorUserName: document.getElementById('inspector-user-name'),
        inspectorPresenceBadge: document.getElementById('inspector-presence-badge'),
        inspectorPresenceText: document.getElementById('inspector-presence-text'),
        inspectorStatChips: document.getElementById('inspector-stat-chips'),
        inspectorStatRounds: document.getElementById('inspector-stat-rounds'),
        inspectorStatTotalWon: document.getElementById('inspector-stat-total-won'),
        inspectorStatBiggestWin: document.getElementById('inspector-stat-biggest-win'),
        inspectorMemberDate: document.getElementById('inspector-member-date'),
        btnInspectorTransfer: document.getElementById('btn-inspector-transfer'),

        // Tabbed Chat Elements
        chatPanel: document.getElementById('chat-panel'),
        tabChatGlobal: document.getElementById('tab-chat-global'),
        tabChatTable: document.getElementById('tab-chat-table'),
        badgeUnreadGlobal: document.getElementById('badge-unread-global'),
        badgeUnreadTable: document.getElementById('badge-unread-table'),
        chatMessagesGlobal: document.getElementById('chat-messages-global'),
        chatMessagesTable: document.getElementById('chat-messages-table'),
        labelChatTable: document.getElementById('label-chat-table'),
        chatContainer: document.getElementById('chat-messages-container'),
        chatForm: document.getElementById('chat-form'),
        chatInput: document.getElementById('chat-input'),
        reactionPills: document.querySelectorAll('.reaction-pill'),

        // Result banner & toasts
        resultBanner: document.getElementById('result-banner'),
        toastContainer: document.getElementById('toast-container')
      };
    }

    switchSidebarTab(targetTab) {
      if (this.elements.sidebarTabs) {
        this.elements.sidebarTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === targetTab));
      }
      if (this.elements.tabPanes) {
        this.elements.tabPanes.forEach(pane => pane.classList.toggle('active', pane.id === `tab-pane-${targetTab}`));
      }
    }

    setupSidebarTabs() {
      if (!this.elements.sidebarTabs) return;
      this.elements.sidebarTabs.forEach(tab => {
        tab.addEventListener('click', () => {
          this.switchSidebarTab(tab.dataset.tab);
        });
      });

      if (this.elements.avatarDisc) {
        this.elements.avatarDisc.addEventListener('click', () => {
          this.switchSidebarTab('profile');
        });
      }
    }

    /* =========================================================================
     * Onboarding & Player Registration
     * ========================================================================= */

    setupColorSwatches() {
      if (!this.elements.palette) return;
      this.elements.palette.innerHTML = '';

      const savedColor = localStorage.getItem('casino_player_color') || localStorage.getItem('roulette_player_color') || '#D4AF37';

      LUXURY_SWATCHES.forEach((swatch, idx) => {
        const div = document.createElement('div');
        div.className = 'color-swatch' + ((swatch.color.toLowerCase() === savedColor.toLowerCase()) ? ' active' : '');
        div.dataset.color = swatch.color;
        div.title = swatch.name;
        div.style.backgroundColor = swatch.color;

        div.addEventListener('click', () => {
          document.querySelectorAll('#color-palette .color-swatch').forEach(s => s.classList.remove('active'));
          div.classList.add('active');
          this.myPlayer.color = swatch.color;
          try {
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem('casino_player_color', swatch.color);
              localStorage.setItem('roulette_player_color', swatch.color);
            }
          } catch (e) {}
        });

        this.elements.palette.appendChild(div);
      });
    }

    setupOnboarding() {
      const savedName = localStorage.getItem('casino_player_name') || localStorage.getItem('roulette_player_name') || '';
      const savedPassword = localStorage.getItem('casino_player_password') || localStorage.getItem('roulette_player_password') || '';
      const savedColor = localStorage.getItem('casino_player_color') || localStorage.getItem('roulette_player_color') || '#D4AF37';
      const savedToken = localStorage.getItem('casino_session_token');

      if (this.elements.inputName && savedName) {
        this.elements.inputName.value = savedName;
      }
      if (this.elements.inputPassword && savedPassword) {
        this.elements.inputPassword.value = savedPassword;
      }
      this.myPlayer.color = savedColor;

      // Auto-hide modal initially if account session exists to avoid jarring popup on reload
      if ((savedToken || savedName) && this.elements.modal) {
        this.elements.modal.classList.add('hidden');
      }

      if (this.elements.btnEnterTable) {
        this.elements.btnEnterTable.addEventListener('click', () => this.handleOnboardingSubmit());
      }

      const handleKey = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.handleOnboardingSubmit();
        }
      };

      if (this.elements.inputName) {
        this.elements.inputName.addEventListener('keydown', handleKey);
      }
      if (this.elements.inputPassword) {
        this.elements.inputPassword.addEventListener('keydown', handleKey);
      }
    }

    handleOnboardingSubmit() {
      const rawName = this.elements.inputName ? this.elements.inputName.value.trim() : '';
      const rawPassword = this.elements.inputPassword ? this.elements.inputPassword.value.trim() : '';

      if (!rawName) {
        this.showLoginError('Voer een gebruikersnaam in');
        return;
      }

      const name = rawName.slice(0, 16);
      const activeSwatch = document.querySelector('.color-swatch.active');
      const color = activeSwatch ? activeSwatch.dataset.color : this.myPlayer.color;

      this.myPlayer.name = name;
      this.myPlayer.color = color;

      try {
        localStorage.setItem('roulette_player_name', name);
        localStorage.setItem('casino_player_name', name);
        if (rawPassword) {
          localStorage.setItem('roulette_player_password', rawPassword);
          localStorage.setItem('casino_player_password', rawPassword);
        } else {
          localStorage.removeItem('roulette_player_password');
          localStorage.removeItem('casino_player_password');
        }
        localStorage.setItem('roulette_player_color', color);
        localStorage.setItem('casino_player_color', color);
      } catch (e) {}

      if (this.options.onJoinTable) {
        this.options.onJoinTable({
          name: this.myPlayer.name,
          password: rawPassword,
          color: this.myPlayer.color
        });
      }
    }

    showLoginError(msg) {
      if (this.elements.modal) {
        this.elements.modal.classList.remove('hidden');
      }
      if (this.elements.loginErrorMsg) {
        this.elements.loginErrorMsg.textContent = msg;
        this.elements.loginErrorMsg.classList.add('visible');
        this.elements.loginErrorMsg.classList.remove('hidden');
      }
    }

    showLoginModal() {
      if (this.elements.modal) {
        this.elements.modal.classList.remove('hidden');
      }
    }

    hideLoginModal() {
      if (this.elements.modal) {
        this.elements.modal.classList.add('hidden');
      }
      if (this.elements.loginErrorMsg) {
        this.elements.loginErrorMsg.textContent = '';
        this.elements.loginErrorMsg.classList.remove('visible');
        this.elements.loginErrorMsg.classList.add('hidden');
      }
    }

    /**
     * Updates player HUD with avatar, monogram, name, and balance.
     * Supports smooth rolling ticker animation for dopamine feedback.
     * @param {boolean} [animated=true]
     */
    updatePlayerHUD(animated = true) {
      if (this.elements.avatarDisc) {
        this.elements.avatarDisc.style.backgroundColor = this.myPlayer.color;
        this.elements.avatarDisc.classList.add('avatar-monogram');
        this.elements.avatarDisc.innerHTML = `<span class="monogram-letter">${getMonogram(this.myPlayer.name)}</span>`;
        this.elements.avatarDisc.title = 'Bekijk je profiel';
        this.elements.avatarDisc.style.cursor = 'pointer';
      }
      if (this.elements.playerName) {
        this.elements.playerName.textContent = this.myPlayer.name;
      }
      if (this.elements.playerChips) {
        const targetChips = typeof this.myPlayer.chips === 'number' ? this.myPlayer.chips : 0;
        const startFrom = (this._displayedChips !== undefined)
          ? this._displayedChips
          : (this._prevChips !== undefined ? this._prevChips : targetChips);
        if (animated && startFrom !== targetChips) {
          this.animateBalanceChange(this.elements.playerChips, startFrom, targetChips);
        } else {
          if (this._chipAnimFrameId && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(this._chipAnimFrameId);
            this._chipAnimFrameId = null;
          }
          this._displayedChips = targetChips;
          this.elements.playerChips.textContent = `${targetChips.toLocaleString()} CHIPS`;
          this.elements.playerChips.classList.remove('ticker-active-glow');
        }
        this._prevChips = targetChips;
      }
      this.renderMyProfile();
    }

    /**
     * Smoothly rolls a number counter with ease-out cubic interpolation.
     * Highlights element with gold glow during transit. Zero audio.
     * @param {HTMLElement} element 
     * @param {number} startVal 
     * @param {number} endVal 
     * @param {number} [duration=600] 
     * @param {string} [suffix=' CHIPS']
     */
    animateBalanceChange(element, startVal, endVal, duration = 600, suffix = ' CHIPS') {
      if (this._chipAnimFrameId && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this._chipAnimFrameId);
        this._chipAnimFrameId = null;
      }
      if (!element || startVal === endVal || typeof requestAnimationFrame !== 'function') {
        this._displayedChips = endVal || 0;
        if (element) element.textContent = `${(endVal || 0).toLocaleString()}${suffix}`;
        return;
      }
      const startTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const diff = endVal - startVal;
      element.classList.add('ticker-active-glow');

      const update = (now) => {
        const currentNow = typeof now === 'number' ? now : Date.now();
        const elapsed = Math.max(0, currentNow - startTime);
        const progress = Math.min(elapsed / duration, 1);
        // Ease-out cubic: 1 - (1 - t)^3
        const ease = 1 - Math.pow(1 - progress, 3);
        const current = Math.round(startVal + diff * ease);
        this._displayedChips = current;
        element.textContent = `${current.toLocaleString()}${suffix}`;

        if (progress < 1) {
          this._chipAnimFrameId = requestAnimationFrame(update);
        } else {
          this._chipAnimFrameId = null;
          this._displayedChips = endVal;
          element.textContent = `${endVal.toLocaleString()}${suffix}`;
          element.classList.remove('ticker-active-glow');
        }
      };
      this._chipAnimFrameId = requestAnimationFrame(update);
    }

    setupProfileTab() {
      if (!this.elements.profileColorPalette) return;
      this.elements.profileColorPalette.innerHTML = '';

      const currentColor = (this.myPlayer.color || '#D4AF37').toLowerCase();

      LUXURY_SWATCHES.forEach(swatch => {
        const div = document.createElement('div');
        div.className = 'color-swatch' + (swatch.color.toLowerCase() === currentColor ? ' active' : '');
        div.dataset.color = swatch.color;
        div.title = swatch.name;
        div.style.backgroundColor = swatch.color;

        div.addEventListener('click', () => {
          document.querySelectorAll('#profile-color-palette .color-swatch').forEach(s => s.classList.remove('active'));
          div.classList.add('active');
          this.myPlayer.color = swatch.color;
          try {
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem('casino_player_color', swatch.color);
              localStorage.setItem('roulette_player_color', swatch.color);
            }
          } catch (e) {}
          if (this.elements.profileAvatarDisc) {
            this.elements.profileAvatarDisc.style.backgroundColor = swatch.color;
          }
          this.updatePlayerHUD();
          if (typeof this.options.onUpdateCustomization === 'function') {
            this.options.onUpdateCustomization({ color: swatch.color });
          }
        });

        this.elements.profileColorPalette.appendChild(div);
      });
    }

    renderMyProfile(profileData = {}) {
      const stats = profileData.stats || (this.myPlayer.stats || { roundsPlayed: 0, totalWon: 0, biggestWin: 0 });
      const chips = typeof profileData.chips === 'number' ? profileData.chips : this.myPlayer.chips;
      const color = profileData.color || this.myPlayer.color || '#D4AF37';
      const name = profileData.name || this.myPlayer.name;
      const game = profileData.currentGame || this.myPlayer.currentGame || 'Roulette';

      this.myPlayer.color = color;
      try {
        if (typeof localStorage !== 'undefined' && color) {
          localStorage.setItem('casino_player_color', color);
          localStorage.setItem('roulette_player_color', color);
        }
      } catch (e) {}

      if (this.elements.profileAvatarDisc) {
        this.elements.profileAvatarDisc.style.backgroundColor = color;
      }
      if (this.elements.profileMonogramLetter) {
        this.elements.profileMonogramLetter.textContent = getMonogram(name);
      }
      if (this.elements.profileUserName) {
        this.elements.profileUserName.textContent = name;
      }
      if (this.elements.profilePresenceText) {
        this.elements.profilePresenceText.textContent = game;
      }
      if (this.elements.profileStatChips) {
        this.elements.profileStatChips.textContent = chips.toLocaleString();
      }
      if (this.elements.profileStatRounds) {
        this.elements.profileStatRounds.textContent = (stats.roundsPlayed || 0).toLocaleString();
      }
      if (this.elements.profileStatTotalWon) {
        this.elements.profileStatTotalWon.textContent = (stats.totalWon || 0).toLocaleString();
      }
      if (this.elements.profileStatBiggestWin) {
        this.elements.profileStatBiggestWin.textContent = (stats.biggestWin || 0).toLocaleString();
      }
      if (this.elements.profileMemberDate) {
        const ts = profileData.createdAt || this.myPlayer.createdAt;
        const d = ts ? new Date(ts) : new Date();
        this.elements.profileMemberDate.textContent = d.toLocaleDateString('nl-NL');
      }

      // Synchronize active swatch in profile palette
      if (this.elements.profileColorPalette) {
        const targetColor = color.toLowerCase();
        this.elements.profileColorPalette.querySelectorAll('.color-swatch').forEach(sw => {
          if ((sw.dataset.color || '').toLowerCase() === targetColor) {
            sw.classList.add('active');
          } else {
            sw.classList.remove('active');
          }
        });
      }
    }

    setupInspectorModal() {
      if (this.elements.btnCloseProfileModal) {
        this.elements.btnCloseProfileModal.addEventListener('click', () => {
          if (this.elements.inspectorModal) this.elements.inspectorModal.classList.add('hidden');
        });
      }
      if (this.elements.inspectorModal) {
        this.elements.inspectorModal.addEventListener('click', (e) => {
          if (e.target === this.elements.inspectorModal) {
            this.elements.inspectorModal.classList.add('hidden');
          }
        });
      }
    }

    showPlayerProfile(p) {
      if (!p || !this.elements.inspectorModal) return;
      const stats = p.stats || { roundsPlayed: 0, totalWon: 0, biggestWin: 0 };
      const chips = typeof p.chips === 'number' ? p.chips : 0;
      const color = p.color || '#D4AF37';
      const name = p.name || 'Speler';
      const game = p.currentGame || 'Roulette';

      if (this.elements.inspectorAvatarDisc) {
        this.elements.inspectorAvatarDisc.style.backgroundColor = color;
      }
      if (this.elements.inspectorMonogramLetter) {
        this.elements.inspectorMonogramLetter.textContent = getMonogram(name);
      }
      if (this.elements.inspectorUserName) {
        this.elements.inspectorUserName.textContent = name;
      }
      if (this.elements.inspectorPresenceText) {
        this.elements.inspectorPresenceText.textContent = game;
      }
      if (this.elements.inspectorStatChips) {
        this.elements.inspectorStatChips.textContent = chips.toLocaleString();
      }
      if (this.elements.inspectorStatRounds) {
        this.elements.inspectorStatRounds.textContent = (stats.roundsPlayed || 0).toLocaleString();
      }
      if (this.elements.inspectorStatTotalWon) {
        this.elements.inspectorStatTotalWon.textContent = (stats.totalWon || 0).toLocaleString();
      }
      if (this.elements.inspectorStatBiggestWin) {
        this.elements.inspectorStatBiggestWin.textContent = (stats.biggestWin || 0).toLocaleString();
      }
      if (this.elements.inspectorMemberDate) {
        const d = p.createdAt ? new Date(p.createdAt) : new Date();
        this.elements.inspectorMemberDate.textContent = d.toLocaleDateString('nl-NL');
      }

      if (this.elements.btnInspectorTransfer) {
        this.elements.btnInspectorTransfer.onclick = () => {
          this.elements.inspectorModal.classList.add('hidden');
          if (typeof this.options.onOpenTransferToPlayer === 'function') {
            this.options.onOpenTransferToPlayer(p.id);
          }
        };
      }

      this.elements.inspectorModal.classList.remove('hidden');
    }

    /* =========================================================================
     * European Betting Board Architecture
     * ========================================================================= */

    buildBettingGrid() {
      const container = this.elements.gridContainer;
      if (!container) return;
      container.innerHTML = '';

      const boardWrapper = document.createElement('div');
      boardWrapper.className = 'roulette-board';

      // 1. Zero Cell (Green 0 on the left spanning 3 rows)
      const zeroCell = document.createElement('div');
      zeroCell.className = 'grid-cell cell-zero';
      zeroCell.dataset.type = 'straight';
      zeroCell.dataset.value = '0';
      zeroCell.dataset.spot = 'straight_0';
      zeroCell.innerHTML = `<span class="cell-label">0</span><div class="chip-slot"></div>`;
      zeroCell.addEventListener('click', () => this.handleSpotClick('straight', 0, 'straight_0'));
      boardWrapper.appendChild(zeroCell);

      // 2. Numbers Grid (3 rows x 12 columns)
      const numbersGrid = document.createElement('div');
      numbersGrid.className = 'numbers-grid';

      // Authentic row layout:
      // Row 1 (top): 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36
      // Row 2 (middle): 2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35
      // Row 3 (bottom): 1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34
      const rows = [
        [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36],
        [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35],
        [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34]
      ];

      rows.forEach((rowNumbers, rowIdx) => {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'number-row';

        rowNumbers.forEach((num) => {
          const cell = document.createElement('div');
          const isRed = RED_NUMBERS.has(num);
          cell.className = `grid-cell number-cell ${isRed ? 'cell-red' : 'cell-black'}`;
          cell.dataset.type = 'straight';
          cell.dataset.value = num.toString();
          const spotKey = `straight_${num}`;
          cell.dataset.spot = spotKey;
          cell.innerHTML = `<span class="cell-label">${num}</span><div class="chip-slot"></div>`;

          cell.addEventListener('click', (e) => {
            e.stopPropagation();
            this.handleSpotClick('straight', num, spotKey);
          });

          rowDiv.appendChild(cell);
        });

        numbersGrid.appendChild(rowDiv);
      });

      boardWrapper.appendChild(numbersGrid);

      // 3. Column Bets (2 to 1) at the end of each row on right
      const colsContainer = document.createElement('div');
      colsContainer.className = 'columns-container';

      // Matching rows: Col 3 (top), Col 2 (mid), Col 1 (bot)
      const cols = [
        { col: 3, label: '2 to 1' },
        { col: 2, label: '2 to 1' },
        { col: 1, label: '2 to 1' }
      ];

      cols.forEach((c) => {
        const cell = document.createElement('div');
        cell.className = 'grid-cell column-cell';
        cell.dataset.type = 'column';
        cell.dataset.value = c.col.toString();
        const spotKey = `column_${c.col}`;
        cell.dataset.spot = spotKey;
        cell.innerHTML = `<span class="cell-label">${c.label}</span><div class="chip-slot"></div>`;
        cell.addEventListener('click', () => this.handleSpotClick('column', c.col, spotKey));
        colsContainer.appendChild(cell);
      });

      boardWrapper.appendChild(colsContainer);

      // 4. Dozens Row (1st 12, 2nd 12, 3rd 12)
      const dozensRow = document.createElement('div');
      dozensRow.className = 'outside-row dozens-row';

      const dozens = [
        { val: 1, label: '1st 12 (1-12)' },
        { val: 2, label: '2nd 12 (13-24)' },
        { val: 3, label: '3rd 12 (25-36)' }
      ];

      dozens.forEach((d) => {
        const cell = document.createElement('div');
        cell.className = 'grid-cell dozen-cell';
        cell.dataset.type = 'dozen';
        cell.dataset.value = d.val.toString();
        const spotKey = `dozen_${d.val}`;
        cell.dataset.spot = spotKey;
        cell.innerHTML = `<span class="cell-label">${d.label}</span><div class="chip-slot"></div>`;
        cell.addEventListener('click', () => this.handleSpotClick('dozen', d.val, spotKey));
        dozensRow.appendChild(cell);
      });

      // 5. Outside Even-Money Bets (1-18, EVEN, RED, BLACK, ODD, 19-36)
      const outsideRow = document.createElement('div');
      outsideRow.className = 'outside-row even-money-row';

      const outsideBets = [
        { type: 'low', label: '1 to 18', css: 'cell-outside' },
        { type: 'even', label: 'EVEN', css: 'cell-outside' },
        { type: 'red', label: 'RED', css: 'cell-outside cell-red-outside' },
        { type: 'black', label: 'BLACK', css: 'cell-outside cell-black-outside' },
        { type: 'odd', label: 'ODD', css: 'cell-outside' },
        { type: 'high', label: '19 to 36', css: 'cell-outside' }
      ];

      outsideBets.forEach((b) => {
        const cell = document.createElement('div');
        cell.className = `grid-cell ${b.css}`;
        cell.dataset.type = b.type;
        const spotKey = `${b.type}_null`;
        cell.dataset.spot = spotKey;
        cell.innerHTML = `<span class="cell-label">${b.label}</span><div class="chip-slot"></div>`;
        cell.addEventListener('click', () => this.handleSpotClick(b.type, null, spotKey));
        outsideRow.appendChild(cell);
      });

      container.appendChild(boardWrapper);
      container.appendChild(dozensRow);
      container.appendChild(outsideRow);

      // Setup Inside Bets Helper Modal
      this.setupInsideBetsModal();
    }

    /**
     * Sets up the interactive modal for multi-number inside bets
     * (splits, streets, corners, six-lines) for mobile and precise touch entry.
     */
    setupInsideBetsModal() {
      if (this.elements.btnInsideHelper) {
        this.elements.btnInsideHelper.addEventListener('click', () => {
          if (this.elements.insideModal) {
            this.elements.insideModal.classList.remove('hidden');
          }
        });
      }

      if (this.elements.btnCloseInsideModal) {
        this.elements.btnCloseInsideModal.addEventListener('click', () => {
          if (this.elements.insideModal) {
            this.elements.insideModal.classList.add('hidden');
          }
        });
      }

      // Generate popular inside bet presets
      const list = document.getElementById('inside-bets-list');
      if (!list) return;
      list.innerHTML = '';

      // Tabs: Split, Street, Corner, Six-Line
      const tabs = document.querySelectorAll('.inside-tab');
      tabs.forEach(tab => {
        tab.addEventListener('click', () => {
          tabs.forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          this.renderInsideBetCategory(tab.dataset.cat);
        });
      });

      this.renderInsideBetCategory('split');
    }

    renderInsideBetCategory(category) {
      const list = document.getElementById('inside-bets-list');
      if (!list) return;
      list.innerHTML = '';

      let items = [];

      if (category === 'split') {
        // Zero splits
        items.push({ type: 'split', value: [0, 1], label: 'Split [0, 1]' });
        items.push({ type: 'split', value: [0, 2], label: 'Split [0, 2]' });
        items.push({ type: 'split', value: [0, 3], label: 'Split [0, 3]' });

        // Horizontal splits
        for (let n = 1; n <= 33; n++) {
          items.push({ type: 'split', value: [n, n + 3], label: `Split [${n}, ${n + 3}]` });
        }
        // Vertical splits
        for (let col = 0; col < 12; col++) {
          const b = col * 3 + 1;
          items.push({ type: 'split', value: [b, b + 1], label: `Split [${b}, ${b + 1}]` });
          items.push({ type: 'split', value: [b + 1, b + 2], label: `Split [${b + 1}, ${b + 2}]` });
        }
      } else if (category === 'street') {
        items.push({ type: 'street', value: [0, 1, 2], label: 'Trio [0, 1, 2]' });
        items.push({ type: 'street', value: [0, 2, 3], label: 'Trio [0, 2, 3]' });
        for (let row = 0; row < 12; row++) {
          const a = row * 3 + 1;
          items.push({ type: 'street', value: [a, a + 1, a + 2], label: `Street [${a}, ${a + 1}, ${a + 2}]` });
        }
      } else if (category === 'corner') {
        items.push({ type: 'corner', value: [0, 1, 2, 3], label: 'First Four [0, 1, 2, 3]' });
        for (let col = 0; col < 11; col++) {
          const b = col * 3 + 1;
          items.push({ type: 'corner', value: [b, b + 1, b + 3, b + 4], label: `Corner [${b}, ${b + 1}, ${b + 3}, ${b + 4}]` });
          items.push({ type: 'corner', value: [b + 1, b + 2, b + 4, b + 5], label: `Corner [${b + 1}, ${b + 2}, ${b + 4}, ${b + 5}]` });
        }
      } else if (category === 'six_line') {
        for (let col = 0; col < 11; col++) {
          const b = col * 3 + 1;
          items.push({
            type: 'six_line',
            value: [b, b + 1, b + 2, b + 3, b + 4, b + 5],
            label: `Six Line [${b} - ${b + 5}]`
          });
        }
      }

      items.forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'btn-inside-preset';
        btn.textContent = `${item.label} (100)`;
        btn.addEventListener('click', () => {
          const spotKey = `${item.type}_${JSON.stringify(item.value)}`;
          this.handleSpotClick(item.type, item.value, spotKey);
          if (this.elements.insideModal) {
            this.elements.insideModal.classList.add('hidden');
          }
        });
        list.appendChild(btn);
      });
    }

    /* =========================================================================
     * Chip Selector & Bet Action Handlers
     * ========================================================================= */

    setupChipDock() {
      // Chip selector buttons
      if (this.elements.chipButtons) {
        this.elements.chipButtons.forEach((btn) => {
          btn.addEventListener('click', () => {
            this.elements.chipButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this.selectedChip = parseInt(btn.dataset.val, 10) || 100;
          });
        });
      }

      // Clear bets
      if (this.elements.btnClearBets) {
        this.elements.btnClearBets.addEventListener('click', () => {
          if (this.currentPhase !== 'BETTING') {
            this.showToast('Inzetten is gesloten voor deze ronde', 'warning');
            return;
          }
          if (this.options.onClearBets) {
            this.options.onClearBets();
          }
        });
      }

      // Double bets
      if (this.elements.btnDoubleBets) {
        this.elements.btnDoubleBets.addEventListener('click', () => {
          if (this.currentPhase !== 'BETTING') {
            this.showToast('Inzetten is gesloten voor deze ronde', 'warning');
            return;
          }
          if (this.options.onDoubleBets) {
            this.options.onDoubleBets();
          }
        });
      }
    }

    handleSpotClick(type, value, spotKey) {
      if (this.currentPhase !== 'BETTING') {
        this.showToast('Inzetten is gesloten voor deze ronde', 'warning');
        return;
      }

      if (this.myPlayer.chips < this.selectedChip) {
        this.showToast('Onvoldoende fiches voor deze inzet', 'error');
        return;
      }

      // Dispatch bet placement to network controller
      if (this.options.onPlaceBet) {
        this.options.onPlaceBet({
          type,
          value,
          amount: this.selectedChip,
          spotKey
        });
      }
    }

    /**
     * Renders a stacked chip token on a betting cell.
     * @param {string} spotKey 
     * @param {string} playerColor 
     * @param {number} amount 
     */
    addChipToSpot(spotKey, playerColor, amount) {
      // Find element with data-spot
      const cell = document.querySelector(`[data-spot="${spotKey}"]`);
      if (!cell) return;

      let slot = cell.querySelector('.chip-slot');
      if (!slot) {
        slot = document.createElement('div');
        slot.className = 'chip-slot';
        cell.appendChild(slot);
      }

      // Check if a chip already exists on this spot
      let chipBadge = slot.querySelector('.chip-badge');
      if (!chipBadge) {
        chipBadge = document.createElement('div');
        chipBadge.className = 'chip-badge';
        chipBadge.style.borderColor = playerColor;
        chipBadge.style.boxShadow = `0 0 8px ${playerColor}88`;
        slot.appendChild(chipBadge);
      }

      // Accumulate amount on cell
      const currentAmt = parseInt(chipBadge.dataset.totalAmount || '0', 10);
      const newAmt = currentAmt + amount;
      chipBadge.dataset.totalAmount = newAmt.toString();

      // Format amount label (e.g. 100, 1.5k, 10k)
      let label = newAmt >= 1000 ? `${(newAmt / 1000).toFixed(newAmt % 1000 === 0 ? 0 : 1)}k` : newAmt.toString();
      chipBadge.textContent = label;
    }

    /**
     * Clears all rendered chip badges from the table.
     */
    clearAllChips() {
      document.querySelectorAll('.chip-badge').forEach((badge) => {
        badge.parentNode.removeChild(badge);
      });
      document.querySelectorAll('.spot-winning-highlight').forEach((el) => {
        el.classList.remove('spot-winning-highlight');
      });
      this.allBetsBySpot.clear();
      this.myBets = [];
    }

    /**
     * Clears chips belonging to a specific player.
     * @param {string} playerId 
     */
    clearPlayerChips(playerId) {
      if (playerId === this.myPlayer.id) {
        this.clearAllChips();
      }
    }

    /* =========================================================================
     * Top HUD Updates (Phase, Timer, History)
     * ========================================================================= */

    updatePhase(phase, duration, timeLeft) {
      this.currentPhase = phase;

      if (this.elements.phaseTitle) {
        if (phase === 'BETTING') {
          this.elements.phaseTitle.textContent = 'INZETTEN';
          this.elements.phaseTitle.className = 'phase-title phase-betting';
        } else if (phase === 'SPINNING') {
          this.elements.phaseTitle.textContent = 'WIEL DRAAIT';
          this.elements.phaseTitle.className = 'phase-title phase-spinning';
        } else if (phase === 'WAITING_FOR_PLAYERS') {
          this.elements.phaseTitle.textContent = 'WACHTEN OP SPELERS';
          this.elements.phaseTitle.className = 'phase-title phase-waiting';
        } else if (phase === 'DEALING') {
          this.elements.phaseTitle.textContent = 'KAARTEN DELEN';
          this.elements.phaseTitle.className = 'phase-title phase-dealing';
        } else if (phase === 'PLAYER_TURNS') {
          this.elements.phaseTitle.textContent = 'SPELER BEURT';
          this.elements.phaseTitle.className = 'phase-title phase-player-turns';
        } else if (phase === 'DEALER_TURN') {
          this.elements.phaseTitle.textContent = 'DEALER SPEELT';
          this.elements.phaseTitle.className = 'phase-title phase-dealer-turn';
        } else if (phase === 'PAYOUT' || phase === 'ROUND_OVER') {
          this.elements.phaseTitle.textContent = 'UITBETALING';
          this.elements.phaseTitle.className = 'phase-title phase-payout';
        } else {
          this.elements.phaseTitle.textContent = phase;
          this.elements.phaseTitle.className = 'phase-title';
        }
      }

      this.updateTimer(timeLeft);

      if (phase === 'BETTING') {
        this.hideResultBanner();
      }
    }

    updateTimer(timeLeft) {
      if (this.elements.phaseTimer) {
        this.elements.phaseTimer.textContent = `${Math.max(0, timeLeft)}s`;
      }
    }

    updateHistoryStrip(history = []) {
      if (!this.elements.historyStrip) return;
      this.elements.historyStrip.innerHTML = '';

      history.slice(0, 15).forEach((num, idx) => {
        const pill = document.createElement('div');
        let colorClass = 'pill-black';
        if (num === 0) colorClass = 'pill-green';
        else if (RED_NUMBERS.has(num)) colorClass = 'pill-red';

        pill.className = `history-pill ${colorClass}` + (idx === 0 ? ' pill-latest' : '');
        pill.textContent = num.toString();
        this.elements.historyStrip.appendChild(pill);
      });
    }

    /* =========================================================================
     * Result Banner
     * ========================================================================= */

    showRoundResult(winningNumber, winningColor, myResult) {
      if (!this.elements.resultBanner) return;

      const colorCap = winningColor ? winningColor.charAt(0).toUpperCase() + winningColor.slice(1) : '';
      const isWin = Boolean(myResult && myResult.totalWon > 0);
      const netWin = (myResult && typeof myResult.net === 'number') ? myResult.net : (myResult && myResult.totalWon ? myResult.totalWon : 0);
      const isGrand = Boolean(isWin && (netWin >= 1000 || myResult.totalWon >= 2000));
      const isJackpot = Boolean(isWin && (netWin >= 5000 || myResult.totalWon >= 10000));

      let headline = `WINNING NUMBER: ${winningNumber} ${colorCap}`;
      if (isJackpot) {
        headline = `JACKPOT! NUMMER ${winningNumber} ${colorCap.toUpperCase()}`;
      } else if (isGrand) {
        headline = `GROTE WINST! NUMMER ${winningNumber} ${colorCap.toUpperCase()}`;
      } else if (isWin) {
        headline = `GEWONNEN! NUMMER ${winningNumber} ${colorCap.toUpperCase()}`;
      }

      let subline = '';
      if (myResult) {
        if (myResult.totalWon > 0) {
          subline = `Uitbetaling: +${myResult.totalWon.toLocaleString()} fiches (Netto: +${myResult.net.toLocaleString()})`;
        } else if (myResult.totalBet > 0) {
          subline = `Volgende ronde meer geluk (-${myResult.totalBet.toLocaleString()} fiches)`;
        }
      }

      this.elements.resultBanner.className = 'result-banner' + (isWin ? ' has-win win-celebration' : '');
      this.elements.resultBanner.innerHTML = `
        <div class="result-number result-${winningColor} ${isWin ? 'result-pulse-gold' : ''}">${winningNumber}</div>
        <div class="result-text">
          <div class="result-headline ${isWin ? 'headline-gold' : ''}">${headline}</div>
          ${subline ? `<div class="result-subline">${subline}</div>` : ''}
        </div>
      `;
      this.elements.resultBanner.classList.remove('hidden');

      // Highlight winning spots on the felt
      this.highlightWinningFeltSpots(winningNumber, winningColor);

      // Pulse chip counter in HUD if won
      if (isWin && this.elements.playerChips) {
        this.elements.playerChips.classList.remove('chips-won-pulse');
        void this.elements.playerChips.offsetWidth;
        this.elements.playerChips.classList.add('chips-won-pulse');
        setTimeout(() => {
          if (this.elements.playerChips) this.elements.playerChips.classList.remove('chips-won-pulse');
        }, 3000);
      }
    }

    /**
     * Highlights winning spots on the roulette betting felt with a golden glow.
     * @param {number} winningNumber 
     * @param {string} winningColor 
     */
    highlightWinningFeltSpots(winningNumber, winningColor) {
      if (!this.elements.gridContainer) return;

      // Remove existing highlights
      const existing = this.elements.gridContainer.querySelectorAll('.spot-winning-highlight');
      existing.forEach(el => el.classList.remove('spot-winning-highlight'));

      // 1. Straight number
      const straightEl = this.elements.gridContainer.querySelector(`.grid-cell[data-spot="straight_${winningNumber}"]`);
      if (straightEl) straightEl.classList.add('spot-winning-highlight');

      if (winningNumber > 0) {
        // 2. Color (red or black)
        const colorEl = this.elements.gridContainer.querySelector(`.grid-cell[data-spot="color_${winningColor}"]`);
        if (colorEl) colorEl.classList.add('spot-winning-highlight');

        // 3. Even / Odd
        const parity = winningNumber % 2 === 0 ? 'even' : 'odd';
        const parityEl = this.elements.gridContainer.querySelector(`.grid-cell[data-spot="parity_${parity}"]`);
        if (parityEl) parityEl.classList.add('spot-winning-highlight');

        // 4. Low (1-18) / High (19-36)
        const range = winningNumber <= 18 ? 'low' : 'high';
        const rangeEl = this.elements.gridContainer.querySelector(`.grid-cell[data-spot="range_${range}"]`);
        if (rangeEl) rangeEl.classList.add('spot-winning-highlight');

        // 5. Dozen (1-12, 13-24, 25-36)
        const dozen = Math.ceil(winningNumber / 12);
        const dozenEl = this.elements.gridContainer.querySelector(`.grid-cell[data-spot="dozen_${dozen}"]`);
        if (dozenEl) dozenEl.classList.add('spot-winning-highlight');

        // 6. Column (1, 2, 3)
        const col = ((winningNumber - 1) % 3) + 1;
        const colEl = this.elements.gridContainer.querySelector(`.grid-cell[data-spot="column_${col}"]`);
        if (colEl) colEl.classList.add('spot-winning-highlight');
      }

      // Auto-clear highlight after 5 seconds
      setTimeout(() => {
        if (this.elements.gridContainer) {
          const highlights = this.elements.gridContainer.querySelectorAll('.spot-winning-highlight');
          highlights.forEach(el => el.classList.remove('spot-winning-highlight'));
        }
      }, 5000);
    }

    hideResultBanner() {
      if (this.elements.resultBanner) {
        this.elements.resultBanner.classList.add('hidden');
        this.elements.resultBanner.className = 'result-banner hidden';
      }
      if (this.elements.gridContainer) {
        const highlights = this.elements.gridContainer.querySelectorAll('.spot-winning-highlight');
        highlights.forEach(el => el.classList.remove('spot-winning-highlight'));
      }
    }

    /* =========================================================================
     * Multiplayer Tabbed Chatbox (R5 - Global Casino & Table Scopes)
     * ========================================================================= */

    setupChat() {
      if (this.elements.tabChatGlobal) {
        this.elements.tabChatGlobal.addEventListener('click', () => {
          this.switchChatScope('global');
        });
      }

      if (this.elements.tabChatTable) {
        this.elements.tabChatTable.addEventListener('click', () => {
          this.switchChatScope('table');
        });
      }

      if (this.elements.chatForm) {
        this.elements.chatForm.addEventListener('submit', (e) => {
          e.preventDefault();
          const text = this.elements.chatInput ? this.elements.chatInput.value.trim() : '';
          if (!text) return;

          if (this.options.onSendChat) {
            this.options.onSendChat(text, this.activeChatScope);
          }
          if (this.elements.chatInput) {
            this.elements.chatInput.value = '';
          }
        });
      }

      if (this.elements.reactionPills) {
        this.elements.reactionPills.forEach((pill) => {
          pill.addEventListener('click', () => {
            const msg = pill.dataset.msg;
            if (msg && this.options.onSendChat) {
              this.options.onSendChat(msg, this.activeChatScope);
            }
          });
        });
      }

      this.updateChatTableTabLabel();
      this.updateChatInputPlaceholder();
    }

    /**
     * Updates the Table Chat tab text based on active game table.
     */
    updateChatTableTabLabel() {
      if (!this.elements.labelChatTable) return;
      const curTable = this.currentTableId || 'roulette';
      if (curTable === 'roulette') {
        this.elements.labelChatTable.textContent = 'Roulette Chat';
      } else if (curTable === 'poker_2') {
        this.elements.labelChatTable.textContent = 'Poker Tafel 2';
      } else if (curTable.startsWith('poker')) {
        this.elements.labelChatTable.textContent = 'Poker Tafel 1';
      } else if (curTable === 'table_2') {
        this.elements.labelChatTable.textContent = 'Blackjack Tafel 2';
      } else {
        this.elements.labelChatTable.textContent = 'Blackjack Tafel 1';
      }
    }

    /**
     * Updates the chat input placeholder to match active scope and table.
     */
    updateChatInputPlaceholder() {
      if (!this.elements.chatInput) return;
      if (this.activeChatScope === 'global') {
        this.elements.chatInput.placeholder = 'Typ een bericht in Global Casino...';
      } else {
        const curTable = this.currentTableId || 'roulette';
        if (curTable === 'roulette') {
          this.elements.chatInput.placeholder = 'Typ een bericht in Roulette Chat...';
        } else if (curTable === 'poker_2') {
          this.elements.chatInput.placeholder = 'Typ een bericht in Poker Tafel 2...';
        } else if (curTable.startsWith('poker')) {
          this.elements.chatInput.placeholder = 'Typ een bericht in Poker Tafel 1...';
        } else if (curTable === 'table_2') {
          this.elements.chatInput.placeholder = 'Typ een bericht in Blackjack Tafel 2...';
        } else {
          this.elements.chatInput.placeholder = 'Typ een bericht in Blackjack Tafel 1...';
        }
      }
    }

    /**
     * Updates table filter on table chat items.
     * @param {string} [tableId]
     */
    updateChatTableFilter(tableId) {
      if (tableId) {
        this.currentTableId = tableId;
      }
      const curTable = this.currentTableId || 'roulette';
      if (this.elements.chatMessagesTable) {
        const items = this.elements.chatMessagesTable.querySelectorAll('.chat-item');
        items.forEach(item => {
          const itemTable = item.dataset.table || 'all';
          const matches = (
            itemTable === 'all' ||
            itemTable === curTable ||
            (curTable.startsWith('table_') && itemTable === 'blackjack') ||
            (curTable.startsWith('poker') && (itemTable === 'poker' || itemTable === curTable)) ||
            (curTable === 'roulette' && itemTable === 'roulette')
          );
          item.style.display = matches ? '' : 'none';
        });
        if (this.activeChatScope === 'table') {
          this.elements.chatMessagesTable.scrollTop = this.elements.chatMessagesTable.scrollHeight;
        }
      }
      this.updateChatTableTabLabel();
      this.updateChatInputPlaceholder();
    }

    /**
     * Switches active chat tab between 'global' and 'table'.
     * @param {'global'|'table'} scope 
     */
    switchChatScope(scope) {
      this.activeChatScope = scope;

      if (this.elements.tabChatGlobal && this.elements.tabChatTable) {
        this.elements.tabChatGlobal.classList.toggle('active', scope === 'global');
        this.elements.tabChatTable.classList.toggle('active', scope === 'table');
      }

      if (this.elements.chatMessagesGlobal && this.elements.chatMessagesTable) {
        this.elements.chatMessagesGlobal.classList.toggle('active', scope === 'global');
        this.elements.chatMessagesGlobal.classList.toggle('hidden', scope !== 'global');
        this.elements.chatMessagesTable.classList.toggle('active', scope === 'table');
        this.elements.chatMessagesTable.classList.toggle('hidden', scope !== 'table');
      }

      this.updateChatInputPlaceholder();

      // Reset unread counter for current active scope
      this.unreadCounts[scope] = 0;
      const badge = scope === 'global' ? this.elements.badgeUnreadGlobal : this.elements.badgeUnreadTable;
      if (badge) {
        badge.textContent = '0';
        badge.classList.add('hidden');
      }

      // Scroll to bottom of active feed
      const activeFeed = scope === 'global' ? this.elements.chatMessagesGlobal : this.elements.chatMessagesTable;
      if (activeFeed) {
        activeFeed.scrollTop = activeFeed.scrollHeight;
      }
    }

    /**
     * Safely decodes server-escaped HTML entities for use with .textContent.
     * @param {string} str
     * @returns {string}
     */
    decodeHtmlEntities(str) {
      if (typeof str !== 'string') return '';
      return str
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, '/')
        .replace(/&quot;/g, '"')
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&');
    }

    /**
     * Replaces chat feeds with history snapshot without duplicating messages or triggering unread badges.
     * @param {Array<Object>} [history=[]]
     */
    loadChatHistory(history = []) {
      if (this.elements.chatMessagesGlobal) {
        this.elements.chatMessagesGlobal.innerHTML = '';
      }
      if (this.elements.chatMessagesTable) {
        this.elements.chatMessagesTable.innerHTML = '';
      }
      this.unreadCounts = { global: 0, table: 0 };
      if (this.elements.badgeUnreadGlobal) {
        this.elements.badgeUnreadGlobal.textContent = '0';
        this.elements.badgeUnreadGlobal.classList.add('hidden');
      }
      if (this.elements.badgeUnreadTable) {
        this.elements.badgeUnreadTable.textContent = '0';
        this.elements.badgeUnreadTable.classList.add('hidden');
      }
      if (Array.isArray(history)) {
        history.forEach(msg => this.addChatMessage(msg, { isHistory: true }));
      }
    }

    /**
     * Appends a chat message to the partitioned activity drawer.
     * Guaranteed XSS safe by using textContent and DOM text nodes. Zero emojis.
     * @param {{ sender: string, color?: string, text: string, timestamp: number, isSystem: boolean, scope?: string, table?: string, category?: string }} msg 
     * @param {{ isHistory?: boolean }} [options={}]
     */
    addChatMessage(msg, options = {}) {
      if (!msg) return;

      const scope = (msg.scope === 'table') ? 'table' : 'global';
      const targetFeed = scope === 'table' ? this.elements.chatMessagesTable : this.elements.chatMessagesGlobal;

      const item = document.createElement('div');
      item.className = 'chat-item' + (msg.isSystem ? ' chat-system' : '');

      let isVisibleInCurrentTable = true;
      if (scope === 'table') {
        const itemTable = msg.table || 'all';
        item.dataset.table = itemTable;
        const curTable = this.currentTableId || 'roulette';
        isVisibleInCurrentTable = (
          itemTable === 'all' ||
          itemTable === curTable ||
          (curTable.startsWith('table_') && itemTable === 'blackjack') ||
          (curTable.startsWith('poker') && (itemTable === 'poker' || itemTable === curTable)) ||
          (curTable === 'roulette' && itemTable === 'roulette')
        );
        if (!isVisibleInCurrentTable) {
          item.style.display = 'none';
        }
      }

      if (msg.isSystem) {
        const content = document.createElement('span');
        content.className = 'system-text';

        // Clean typography categories formatting (Strict Zero Emojis)
        const text = this.decodeHtmlEntities(String(msg.text || ''));
        const categories = [
          { prefix: '[POKER]', className: 'tag-poker' },
          { prefix: '[BLACKJACK]', className: 'tag-blackjack' },
          { prefix: '[GRAND WIN]', className: 'tag-grand-win' },
          { prefix: '[DEALER]', className: 'tag-dealer' },
          { prefix: '[CASINO]', className: 'tag-casino' },
          { prefix: '[BANK]', className: 'tag-grand-win' }
        ];

        let matched = false;
        for (const cat of categories) {
          if (text.startsWith(cat.prefix)) {
            const tagSpan = document.createElement('span');
            tagSpan.className = `msg-category-tag ${cat.className}`;
            tagSpan.textContent = cat.prefix;

            const textSpan = document.createElement('span');
            textSpan.textContent = ' ' + text.slice(cat.prefix.length).trim();

            content.appendChild(tagSpan);
            content.appendChild(textSpan);
            matched = true;
            break;
          }
        }

        if (!matched) {
          content.textContent = text;
        }

        item.appendChild(content);
      } else {
        const sender = document.createElement('span');
        sender.className = 'chat-sender';
        sender.style.color = msg.color || '#D4AF37';
        sender.textContent = `${this.decodeHtmlEntities(String(msg.sender || 'Speler'))}: `;

        const body = document.createElement('span');
        body.className = 'chat-body';
        body.textContent = this.decodeHtmlEntities(String(msg.text || ''));

        item.appendChild(sender);
        item.appendChild(body);
      }

      if (targetFeed) {
        targetFeed.appendChild(item);
        // Auto scroll if user is viewing this feed
        if (scope === this.activeChatScope) {
          if (isVisibleInCurrentTable) {
            targetFeed.scrollTop = targetFeed.scrollHeight;
          }
        } else if (!options.isHistory) {
          // Increment unread count for inactive scope only if visible to this table
          if (scope === 'global' || isVisibleInCurrentTable) {
            this.unreadCounts[scope] = (this.unreadCounts[scope] || 0) + 1;
            const badge = scope === 'global' ? this.elements.badgeUnreadGlobal : this.elements.badgeUnreadTable;
            if (badge) {
              badge.textContent = this.unreadCounts[scope];
              badge.classList.remove('hidden');
            }
          }
        }
      }

      // Also append clone to legacy fallback container if present
      if (this.elements.chatContainer && this.elements.chatContainer !== targetFeed) {
        const clone = item.cloneNode(true);
        this.elements.chatContainer.appendChild(clone);
        this.elements.chatContainer.scrollTop = this.elements.chatContainer.scrollHeight;
      }
    }

    /* =========================================================================
     * Leaderboard & Active Bets Rendering
     * ========================================================================= */

    formatBetDescription(bet) {
      if (!bet) return '';
      const { type, value } = bet;
      switch (type) {
        case 'straight':
          return `Nummer ${value} (35:1)`;
        case 'red':
          return `Rood (1:1)`;
        case 'black':
          return `Zwart (1:1)`;
        case 'even':
          return `Even (1:1)`;
        case 'odd':
          return `Oneven (1:1)`;
        case 'low':
          return `1 t/m 18 (1:1)`;
        case 'high':
          return `19 t/m 36 (1:1)`;
        case 'dozen':
          return `${value}e Dozijn [${value === 1 ? '1-12' : value === 2 ? '13-24' : '25-36'}] (2:1)`;
        case 'column':
          return `Kolom ${value} (2:1)`;
        case 'split':
          return `Split [${Array.isArray(value) ? value.join(', ') : value}] (17:1)`;
        case 'street':
          return `Street [${Array.isArray(value) ? value.join(', ') : value}] (11:1)`;
        case 'corner':
          return `Corner [${Array.isArray(value) ? value.join(', ') : value}] (8:1)`;
        case 'six_line':
          return `Six-Line [${Array.isArray(value) ? `${value[0]}-${value[value.length - 1]}` : value}] (5:1)`;
        default:
          return `${type} (${value || ''})`;
      }
    }

    updateLeaderboard(players = []) {
      if (!this.elements.leaderboardList) return;
      const sorted = [...players].sort((a, b) => (b.chips || 0) - (a.chips || 0));

      if (this.elements.playersOnlineCount) {
        this.elements.playersOnlineCount.textContent = `${sorted.length} online`;
      }

      this.elements.leaderboardList.innerHTML = '';

      if (sorted.length === 0) {
        this.elements.leaderboardList.innerHTML = '<div class="empty-state-notice">Geen spelers gevonden</div>';
        return;
      }

      sorted.forEach((p, idx) => {
        const item = document.createElement('div');
        const isMe = p.id === this.myPlayer.id;
        item.className = 'leaderboard-item' + (isMe ? ' is-me' : '');
        item.title = isMe ? 'Jouw profiel' : `${p.name} inspecteren`;
        item.style.cursor = 'pointer';

        const rankIcon = (idx + 1).toString();
        const nameSuffix = isMe ? ' (Jij)' : '';
        const game = p.currentGame || 'Roulette';
        const gameSlug = game.toLowerCase();

        item.innerHTML = `
          <div class="leaderboard-rank">${rankIcon}</div>
          <div class="leaderboard-avatar avatar-monogram" style="background-color: ${p.color || '#D4AF37'};">
            <span class="monogram-letter-sm">${getMonogram(p.name)}</span>
          </div>
          <div class="leaderboard-details">
            <div class="leaderboard-name-row">
              <span class="leaderboard-name">${p.name}${nameSuffix}</span>
              <span class="presence-badge badge-${gameSlug}"><span class="presence-dot"></span>${game}</span>
            </div>
            <span class="leaderboard-chips">${(p.chips || 0).toLocaleString()} fiches</span>
          </div>
        `;

        item.addEventListener('click', () => {
          if (typeof this.options.onInspectPlayer === 'function') {
            this.options.onInspectPlayer(p.id);
          }
        });

        this.elements.leaderboardList.appendChild(item);
      });
    }

    updateActiveBetsList(allBets = [], tableChipsTotal = 0) {
      if (this.elements.tableTotalChips) {
        this.elements.tableTotalChips.textContent = `${(tableChipsTotal || 0).toLocaleString()} fiches`;
      }

      if (this.elements.betsCountBadge) {
        this.elements.betsCountBadge.textContent = allBets.length.toString();
      }

      if (!this.elements.activeBetsList) return;
      this.elements.activeBetsList.innerHTML = '';

      if (allBets.length === 0) {
        this.elements.activeBetsList.innerHTML = '<div class="empty-state-notice">Geen actieve inzetten deze ronde</div>';
        return;
      }

      allBets.forEach(b => {
        const card = document.createElement('div');
        card.className = 'bet-card';
        card.style.borderLeftColor = b.playerColor || '#D4AF37';

        const desc = this.formatBetDescription(b.bet);

        card.innerHTML = `
          <div class="bet-card-avatar" style="background-color: ${b.playerColor || '#D4AF37'};"></div>
          <div class="bet-card-info">
            <span class="bet-card-player">${b.playerName}</span>
            <span class="bet-card-target">${desc}</span>
          </div>
          <div class="bet-card-amount">${(b.bet.amount || 0).toLocaleString()} fiches</div>
        `;
        this.elements.activeBetsList.appendChild(card);
      });
    }

    /* =========================================================================
     * Toast Alerts
     * ========================================================================= */

    showToast(message, type = 'info') {
      if (!this.elements.toastContainer) return;

      const toast = document.createElement('div');
      toast.className = `toast-msg toast-${type}`;
      toast.textContent = message;

      this.elements.toastContainer.appendChild(toast);

      setTimeout(() => {
        toast.classList.add('toast-fade');
        setTimeout(() => {
          if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 300);
      }, 3500);
    }

    /* =========================================================================
     * Milestone 3: Multiplayer 6-Seat Blackjack & Visual Game Feel UI
     * ========================================================================= */

    /**
     * Computes the Blackjack score for an array of cards with soft Ace handling.
     * @param {Array<{ rank: string, value: number, hidden?: boolean }>} [cards=[]]
     * @returns {number}
     */
    computeCardsScore(cards = []) {
      if (!Array.isArray(cards) || cards.length === 0) return 0;
      let total = 0;
      let aces = 0;
      for (const c of cards) {
        if (!c || c.hidden) continue;
        const rank = String(c.rank || '');
        if (rank === 'A') {
          aces++;
          total += 11;
        } else if (['K', 'Q', 'J', '10'].includes(rank)) {
          total += 10;
        } else {
          total += parseInt(rank, 10) || (c.value || 0);
        }
      }
      while (total > 21 && aces > 0) {
        total -= 10;
        aces--;
      }
      return total;
    }

    /**
     * Renders a 3D perspective playing card with luxury vector graphics. Zero emojis.
     * @param {{ suit: string, rank: string, value: number, hidden?: boolean, isBlackjack?: boolean }} card 
     * @param {boolean} [isDealerHole=false] 
     * @param {Object} [opts={}]
     * @param {number} [opts.dealDelay=0]
     * @param {string} [opts.cardSig=null]
     * @returns {string} HTML string
     */
    renderBlackjackCardHtml(card, isDealerHole = false, opts = {}) {
      const dealDelay = (opts && typeof opts.dealDelay === 'number') ? opts.dealDelay : 0;
      const delayStyle = dealDelay > 0 ? `style="--deal-delay: ${dealDelay}s;"` : '';
      if (!card || card.hidden || isDealerHole) {
        const sig = (opts && opts.cardSig) || 'hole_card';
        return `
          <div class="bj-card face-down deal-animating" data-card-sig="${sig}" ${delayStyle}>
            <div class="bj-card-inner">
              <div class="bj-card-back"></div>
              <div class="bj-card-front"></div>
            </div>
          </div>
        `;
      }

      const rawSuit = (card.suit || 'spades').toLowerCase();
      const suitKey = rawSuit.endsWith('s') ? rawSuit.slice(0, -1) : rawSuit;
      const rank = card.rank || 'A';
      const isRed = suitKey === 'heart' || suitKey === 'diamond';
      const colorClass = isRed ? 'card-red' : 'card-black';
      const highlightClass = card.isBlackjack ? ' card-highlight-gold' : '';
      const sig = (opts && opts.cardSig) || `${rank}_${suitKey}`;

      return `
        <div class="bj-card face-up ${colorClass}${highlightClass} deal-animating" data-card-sig="${sig}" ${delayStyle}>
          <div class="bj-card-inner">
            <div class="bj-card-back"></div>
            <div class="bj-card-front">
              <div class="card-corner-top">
                <span class="card-rank">${rank}</span>
                <svg class="card-suit-svg" viewBox="0 0 24 24"><use href="#suit-${suitKey}"></use></svg>
              </div>
              <svg class="card-center-suit" viewBox="0 0 24 24"><use href="#suit-${suitKey}"></use></svg>
              <div class="card-corner-bottom">
                <span class="card-rank">${rank}</span>
                <svg class="card-suit-svg" viewBox="0 0 24 24"><use href="#suit-${suitKey}"></use></svg>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    /**
     * Incrementally updates a card dock with luxury staggered animations and persistence.
     * Prevents cards from re-animating or dealing twice when state updates fire.
     * @param {HTMLElement} dock 
     * @param {Array<Object>} cards 
     * @param {Object} [options={}]
     * @param {boolean} [options.isDealer=false]
     * @param {boolean} [options.isHoleMasked=false]
     * @param {string} [options.phase='BETTING']
     */
    updateCardDock(dock, cards = [], { isDealer = false, isHoleMasked = false, phase = 'BETTING' } = {}) {
      if (!dock) return;

      if (!Array.isArray(cards) || cards.length === 0) {
        dock.innerHTML = '';
        return;
      }

      const existingCards = Array.from(dock.querySelectorAll('.bj-card'));

      // If dock has more cards than the new state, remove excess cards
      while (existingCards.length > cards.length) {
        const excess = existingCards.pop();
        if (excess && excess.parentNode) {
          excess.parentNode.removeChild(excess);
        }
      }

      cards.forEach((card, idx) => {
        const isHole = Boolean(isDealer && (card.hidden || (idx === 1 && isHoleMasked)));
        const rawSuit = ((card && card.suit) || 'spades').toLowerCase();
        const suitKey = rawSuit.endsWith('s') ? rawSuit.slice(0, -1) : rawSuit;
        const rank = (card && card.rank) || 'A';
        const cardSig = isHole ? 'hole_card' : `${rank}_${suitKey}`;

        if (idx < existingCards.length) {
          const cardEl = existingCards[idx];
          const existingSig = cardEl.getAttribute('data-card-sig');

          // If this was a hidden hole card and is now revealed as a face-up card:
          if (existingSig === 'hole_card' && !isHole) {
            cardEl.setAttribute('data-card-sig', cardSig);
            const isRed = suitKey === 'heart' || suitKey === 'diamond';
            const colorClass = isRed ? 'card-red' : 'card-black';
            const highlightClass = card.isBlackjack ? ' card-highlight-gold' : '';
            cardEl.className = `bj-card face-up card-flip-reveal ${colorClass}${highlightClass}`;
            const frontEl = cardEl.querySelector('.bj-card-front');
            if (frontEl) {
              frontEl.innerHTML = `
                <div class="card-corner-top">
                  <span class="card-rank">${rank}</span>
                  <svg class="card-suit-svg" viewBox="0 0 24 24"><use href="#suit-${suitKey}"></use></svg>
                </div>
                <svg class="card-center-suit" viewBox="0 0 24 24"><use href="#suit-${suitKey}"></use></svg>
                <div class="card-corner-bottom">
                  <span class="card-rank">${rank}</span>
                  <svg class="card-suit-svg" viewBox="0 0 24 24"><use href="#suit-${suitKey}"></use></svg>
                </div>
              `;
            }
            setTimeout(() => {
              if (cardEl.parentNode) {
                cardEl.classList.remove('card-flip-reveal');
                cardEl.classList.add('card-settled');
              }
            }, 750);
          } else {
            // Already dealt card - keep it settled so it NEVER slides or flashes again
            if (!cardEl.classList.contains('deal-animating') && !cardEl.classList.contains('card-flip-reveal')) {
              cardEl.classList.add('card-settled');
            }
          }
        } else {
          // New card being dealt!
          let dealDelay = 0;
          if (phase === 'DEALING') {
            if (isDealer) {
              dealDelay = idx === 0 ? 0.22 : 0.62;
            } else {
              dealDelay = idx === 0 ? 0.06 : 0.42;
            }
          }

          const cardHtml = this.renderBlackjackCardHtml(card, isHole, { dealDelay, cardSig });
          const temp = document.createElement('div');
          temp.innerHTML = cardHtml.trim();
          const newCardEl = temp.firstElementChild;
          if (newCardEl) {
            dock.appendChild(newCardEl);
            setTimeout(() => {
              if (newCardEl.parentNode) {
                newCardEl.classList.remove('deal-animating');
                newCardEl.classList.add('card-settled');
              }
            }, Math.round((dealDelay + 0.75) * 1000));
          }
        }
      });
    }

    /**
     * Renders dealer area cards and score pill.
     * @param {Array<Object>} [cards=[]]
     * @param {number|Object} [score=0]
     * @param {string} [phase='BETTING']
     */
    renderBlackjackDealer(cards = [], score = 0, phase = 'BETTING') {
      if (!this.elements.bjDealerCards) return;

      if (!cards || cards.length === 0) {
        this.elements.bjDealerCards.innerHTML = '';
        if (this.elements.bjDealerScore) {
          this.elements.bjDealerScore.classList.add('hidden');
        }
        return;
      }

      const isHoleMasked = cards.some((c, idx) => c && (c.hidden || (idx === 1 && c.hidden)));
      this.updateCardDock(this.elements.bjDealerCards, cards, { isDealer: true, isHoleMasked, phase });

      if (this.elements.bjDealerScore) {
        if (isHoleMasked) {
          // Show only upcard rank or value
          const upcard = cards[0];
          const upcardRank = upcard ? (upcard.rank || upcard.value || '') : '';
          this.elements.bjDealerScore.textContent = upcardRank ? `${upcardRank}` : '?';
        } else {
          const numericScore = (score && typeof score === 'object' && typeof score.value === 'number')
            ? score.value
            : (typeof score === 'number' ? score : 0);
          const effectiveScore = numericScore > 0 ? numericScore : this.computeCardsScore(cards);
          let scoreText = `${effectiveScore}`;
          if (effectiveScore > 21) scoreText = `BUST ${effectiveScore}`;
          else if (effectiveScore === 21 && cards.length === 2) scoreText = 'BJ 21';
          this.elements.bjDealerScore.textContent = scoreText;
        }
        this.elements.bjDealerScore.classList.remove('hidden');
      }
    }

    /**
     * Renders all 6 seats in the semicircular Blackjack table arc.
     * @param {Array<Object>} [seats=[]]
     * @param {{ seatIndex: number, handIndex: number }|null} [activeTurn=null]
     * @param {string|number|null} [myPlayerId=null]
     * @param {string} [currentPhase='BETTING']
     */
    renderBlackjackSeats(seats = [], activeTurn = null, myPlayerId = null, currentPhase = 'BETTING') {
      for (let i = 0; i < 6; i++) {
        const seat = seats && seats[i] ? seats[i] : null;
        const seatEl = document.getElementById(`bj-seat-${i}`);
        const emptyBadge = document.getElementById(`seat-empty-${i}`);
        const playerBox = document.getElementById(`seat-player-${i}`);
        const userEl = document.getElementById(`seat-user-${i}`);
        const chipsEl = document.getElementById(`seat-chips-${i}`);
        const avatarDisc = document.getElementById(`seat-avatar-${i}`);
        const avatarMono = document.getElementById(`seat-mono-${i}`);
        const leaveBtn = document.getElementById(`btn-leave-${i}`);
        const betSpot = document.getElementById(`betting-spot-${i}`) || document.getElementById(`seat-bet-spot-${i}`);
        const chipsDock = document.getElementById(`seat-chips-dock-${i}`);
        const dock0 = document.getElementById(`seat-cards-dock-${i}-0`);
        const score0 = document.getElementById(`seat-score-${i}-0`);
        const handBlock1 = document.getElementById(`seat-hand-${i}-1`);
        const dock1 = document.getElementById(`seat-cards-dock-${i}-1`);
        const score1 = document.getElementById(`seat-score-${i}-1`);

        if (!seatEl) continue;

        const seatPlayer = (seat && (seat.player || (seat.playerId ? seat : null))) || null;
        if (seat && seatPlayer) {
          seatEl.classList.remove('empty');
          if (emptyBadge) emptyBadge.classList.add('hidden');
          if (playerBox) playerBox.classList.remove('hidden');

          if (userEl) userEl.textContent = seatPlayer.name || `Player ${i + 1}`;
          if (chipsEl) chipsEl.textContent = `${(seatPlayer.chips || 0).toLocaleString()} fiches`;

          const color = seatPlayer.color || '#c5a059';
          if (avatarDisc) {
            avatarDisc.style.backgroundColor = color;
          }
          if (avatarMono) {
            avatarMono.textContent = getMonogram(seatPlayer.name);
          }

          // Leave button only for seated player on their own seat
          const myId = (typeof myPlayerId === 'string' && myPlayerId) ? myPlayerId : (this.myPlayer && this.myPlayer.id);
          const isMe = (myId && seatPlayer.id === myId) || (typeof myPlayerId === 'number' && myPlayerId >= 0 && i === myPlayerId);
          if (leaveBtn) {
            leaveBtn.classList.toggle('hidden', !isMe);
            leaveBtn.classList.toggle('navigation-locked', this.isNavigationLocked);
          }

          // Active turn thinking pulse animation
          const isTurn = activeTurn !== null && activeTurn !== undefined && (typeof activeTurn === 'number' ? activeTurn === i : (activeTurn && activeTurn.seatIndex === i));
          seatEl.classList.toggle('is-active-turn', !!isTurn);
          if (avatarDisc) {
            avatarDisc.classList.toggle('is-active-turn', !!isTurn);
          }

          const handBlock0 = document.getElementById(`seat-hand-${i}-0`);
          const isHand0Active = Boolean(isTurn && (!activeTurn || typeof activeTurn.handIndex !== 'number' || activeTurn.handIndex === 0));
          const isHand1Active = Boolean(isTurn && activeTurn && activeTurn.handIndex === 1);
          if (handBlock0) handBlock0.classList.toggle('is-active-hand', isHand0Active);
          if (handBlock1) handBlock1.classList.toggle('is-active-hand', isHand1Active);

          // Betting spot chips & label
          const betLabel = betSpot ? betSpot.querySelector('.bet-spot-label') : null;
          if (betSpot) {
            betSpot.classList.toggle('my-bet-spot', Boolean(isMe));
            betSpot.classList.toggle('can-bet', Boolean(isMe && currentPhase === 'BETTING'));
            betSpot.title = isMe ? 'Klik op dit inzetvak om je geselecteerde fiche in te zetten' : 'Inzetvak';
          }
          if (chipsDock) {
            if (seat.bet > 0) {
              const formattedBet = (seat.bet >= 1000 && seat.bet % 1000 === 0)
                ? `${seat.bet / 1000}k`
                : seat.bet.toLocaleString();
              chipsDock.innerHTML = `
                <div class="placed-chip-badge" style="width: 38px; height: 38px; font-size: 0.72rem; font-weight: 700; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: ${color}; color: #ffffff; border: 1.5px solid var(--gold-bright); box-shadow: 0 2px 6px rgba(0,0,0,0.5);">
                  ${formattedBet}
                </div>
              `;
              if (betLabel) betLabel.textContent = `${seat.bet.toLocaleString()}`;
            } else {
              chipsDock.innerHTML = '';
              if (betLabel) betLabel.textContent = isMe ? 'KLIK HIER' : 'INZET';
            }
          }

          // Hand 0 cards & score
          const hand0 = seat.hands && seat.hands[0];
          const cards0 = (hand0 && Array.isArray(hand0.cards) && hand0.cards.length > 0)
            ? hand0.cards
            : (Array.isArray(seat.cards) ? seat.cards : []);

          if (dock0) {
            this.updateCardDock(dock0, cards0, { isDealer: false, phase: currentPhase });
            if (cards0.length > 0) {
              if (score0) {
                const scoreVal = (hand0 && typeof hand0.value === 'number' && hand0.value > 0)
                  ? hand0.value
                  : this.computeCardsScore(cards0);
                let scoreText = `${scoreVal}`;
                if (scoreVal > 21) scoreText = `BUST ${scoreVal}`;
                else if (scoreVal === 21 && cards0.length === 2 && !(hand0 && hand0.isSplitHand)) scoreText = 'BJ 21';
                else if (hand0 && hand0.isSoft) scoreText = `Soft ${scoreVal}`;
                score0.textContent = scoreText;
                score0.classList.remove('hidden');
              }
            } else {
              if (score0) score0.classList.add('hidden');
            }
          }

          // Hand 1 (Split hand) cards & score
          const hand1 = seat.hands && seat.hands[1];
          if (handBlock1 && dock1) {
            const cards1 = (hand1 && Array.isArray(hand1.cards) && hand1.cards.length > 0) ? hand1.cards : [];
            this.updateCardDock(dock1, cards1, { isDealer: false, phase: currentPhase });
            if (cards1.length > 0) {
              handBlock1.classList.remove('hidden');
              if (score1) {
                const scoreVal = (hand1 && typeof hand1.value === 'number' && hand1.value > 0)
                  ? hand1.value
                  : this.computeCardsScore(cards1);
                let scoreText = `${scoreVal}`;
                if (scoreVal > 21) scoreText = `BUST ${scoreVal}`;
                else if (scoreVal === 21 && cards1.length === 2 && !(hand1 && hand1.isSplitHand)) scoreText = 'BJ 21';
                else if (hand1 && hand1.isSoft) scoreText = `Soft ${scoreVal}`;
                score1.textContent = scoreText;
                score1.classList.remove('hidden');
              }
            } else {
              handBlock1.classList.add('hidden');
              if (score1) score1.classList.add('hidden');
            }
          }

        } else {
          // Empty seat
          seatEl.classList.add('empty');
          if (emptyBadge) emptyBadge.classList.remove('hidden');
          if (playerBox) playerBox.classList.add('hidden');
          seatEl.classList.remove('is-active-turn');
          if (avatarDisc) avatarDisc.classList.remove('is-active-turn');
          if (betSpot) {
            betSpot.classList.remove('my-bet-spot', 'can-bet');
            betSpot.title = 'Inzetvak';
          }
          if (chipsDock) chipsDock.innerHTML = '';
          const betLabel = betSpot ? betSpot.querySelector('.bet-spot-label') : null;
          if (betLabel) betLabel.textContent = 'INZET';
          const handBlock0 = document.getElementById(`seat-hand-${i}-0`);
          if (handBlock0) handBlock0.classList.remove('is-active-hand');
          if (dock0) dock0.innerHTML = '';
          if (score0) score0.classList.add('hidden');
          if (handBlock1) {
            handBlock1.classList.add('hidden');
            handBlock1.classList.remove('is-active-hand');
          }
          if (dock1) dock1.innerHTML = '';
          if (score1) score1.classList.add('hidden');
        }
      }
    }

    /**
     * Updates shoe penetration bar and card count.
     * @param {number} [cardsRemaining=312]
     * @param {number} [totalCards=312]
     */
    updateShoePenetration(cardsRemaining = 312, totalCards = 312) {
      if (this.elements.bjShoeText) {
        this.elements.bjShoeText.textContent = `${cardsRemaining} krt`;
      }
      if (this.elements.bjShoeFill) {
        const pct = Math.max(0, Math.min(100, Math.round((cardsRemaining / totalCards) * 100)));
        this.elements.bjShoeFill.style.width = `${pct}%`;
      }
    }

    /**
     * Controls enabled/disabled states of Blackjack action buttons.
     * @param {{ canHit?: boolean, canStand?: boolean, canDouble?: boolean, canSplit?: boolean, canClearBet?: boolean }} [opts={}]
     */
    setBlackjackActionsState(opts = {}) {
      if (this.elements.btnBjHit) this.elements.btnBjHit.disabled = !opts.canHit;
      if (this.elements.btnBjStand) this.elements.btnBjStand.disabled = !opts.canStand;
      if (this.elements.btnBjDouble) this.elements.btnBjDouble.disabled = !opts.canDouble;
      if (this.elements.btnBjSplit) this.elements.btnBjSplit.disabled = !opts.canSplit;
      if (this.elements.btnBjClear) this.elements.btnBjClear.disabled = !opts.canClearBet;
    }

    /**
     * Displays grand luxury result announcement banner for Blackjack. Zero emojis.
     * @param {string} title 
     * @param {string} [payoutText=''] 
     * @param {string} [subText=''] 
     * @param {number} [duration=4000] 
     */
    showBlackjackBanner(title, payoutText = '', subText = '', duration = 4000) {
      const banner = this.elements.bjResultBanner;
      if (!banner) return;

      banner.innerHTML = `
        <div class="banner-crest-text">LE GRAND CASINO</div>
        <div class="banner-main-title">${title}</div>
        ${payoutText ? `<div class="banner-payout-text">${payoutText}</div>` : ''}
        ${subText ? `<div class="banner-sub-text">${subText}</div>` : ''}
      `;
      banner.classList.remove('hidden');

      if (this._bjBannerTimer) clearTimeout(this._bjBannerTimer);
      this._bjBannerTimer = setTimeout(() => {
        banner.classList.add('hidden');
      }, duration);
    }

    /**
     * Triggers golden celebratory shimmer particle explosion on win canvas. Zero audio.
     * @param {number} [duration=2000] 
     */
    triggerWinShimmer(duration = 2000) {
      const canvas = this.elements.winShimmerCanvas;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const parent = canvas.parentElement || document.body;
      canvas.width = parent.clientWidth || 800;
      canvas.height = parent.clientHeight || 500;

      const colors = ['#f9e79f', '#d4af37', '#c5a059', '#ffffff'];
      const particles = [];
      const count = 45;

      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * canvas.width,
          y: canvas.height * 0.65 + Math.random() * (canvas.height * 0.35),
          vx: (Math.random() - 0.5) * 3,
          vy: -Math.random() * 3.5 - 1.5,
          radius: Math.random() * 3 + 1.5,
          color: colors[Math.floor(Math.random() * colors.length)],
          alpha: 1,
          decay: Math.random() * 0.015 + 0.008
        });
      }

      const startTime = performance.now();
      const animate = (now) => {
        const elapsed = now - startTime;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        let alive = false;
        for (const p of particles) {
          p.x += p.vx + Math.sin(elapsed / 200) * 0.5;
          p.y += p.vy;
          p.alpha -= p.decay;

          if (p.alpha > 0) {
            alive = true;
            ctx.save();
            ctx.globalAlpha = Math.max(0, p.alpha);
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }

        if (alive && elapsed < duration) {
          requestAnimationFrame(animate);
        } else {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      };
      requestAnimationFrame(animate);
    }

    /**
     * Toggles navigation lock visual state on navigation pills and seat exit buttons.
     * @param {boolean} [isLocked=true]
     */
    setNavigationLocked(isLocked = true) {
      this.isNavigationLocked = !!isLocked;
      if (this.elements.gamePills) {
        this.elements.gamePills.forEach(pill => {
          pill.classList.toggle('navigation-locked', !!isLocked);
        });
      }
      const leaveBtns = document.querySelectorAll('.btn-seat-leave');
      leaveBtns.forEach(btn => {
        btn.classList.toggle('navigation-locked', !!isLocked);
      });
    }

    /**
     * Switches between Roulette, Blackjack and Poker table viewports.
     * @param {'roulette'|'blackjack'|'poker'} [gameName='roulette']
     * @param {string} [subTableId=null]
     */
    switchGameView(gameName = 'roulette', subTableId = null) {
      const g = (gameName || '').toLowerCase();
      const isRoulette = g === 'roulette';
      const isBlackjack = g === 'blackjack';
      const isPoker = g === 'poker';

      if (isRoulette) {
        this.currentTableId = 'roulette';
      } else if (isPoker) {
        this.currentTableId = subTableId || (this.currentTableId && this.currentTableId.startsWith('poker_') ? this.currentTableId : 'poker_1');
      } else {
        this.currentTableId = subTableId || (this.currentTableId && this.currentTableId.startsWith('table_') ? this.currentTableId : 'table_1');
      }

      if (this.elements.viewRoulette) {
        this.elements.viewRoulette.classList.toggle('active', isRoulette);
        this.elements.viewRoulette.classList.toggle('hidden', !isRoulette);
      }
      if (this.elements.viewBlackjack) {
        this.elements.viewBlackjack.classList.toggle('active', isBlackjack);
        this.elements.viewBlackjack.classList.toggle('hidden', !isBlackjack);
      }
      if (this.elements.viewPoker) {
        this.elements.viewPoker.classList.toggle('active', isPoker);
        this.elements.viewPoker.classList.toggle('hidden', !isPoker);
      }

      if (this.elements.pillRoulette) {
        this.elements.pillRoulette.classList.toggle('active', isRoulette);
      }
      if (this.elements.pillBlackjack) {
        this.elements.pillBlackjack.classList.toggle('active', isBlackjack);
      }
      if (this.elements.pillPoker) {
        this.elements.pillPoker.classList.toggle('active', isPoker);
      }

      if (this.elements.historyStrip) {
        this.elements.historyStrip.style.display = isRoulette ? '' : 'none';
      }

      this.updateChatTableFilter(this.currentTableId);
      this.switchChatScope('table');
    }
  }

  return CasinoUI;
}));
