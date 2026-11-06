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
    { name: 'Gold', color: '#D4AF37' },
    { name: 'Emerald', color: '#10B981' },
    { name: 'Sapphire', color: '#3B82F6' },
    { name: 'Ruby', color: '#EF4444' },
    { name: 'Amethyst', color: '#8B5CF6' },
    { name: 'Amber', color: '#F59E0B' },
    { name: 'Turquoise', color: '#14B8A6' },
    { name: 'Coral', color: '#F97316' }
  ];

  function getMonogram(name) {
    if (!name || typeof name !== 'string') return '?';
    const clean = name.trim();
    if (!clean) return '?';
    const parts = clean.split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
    }
    return clean.slice(0, 2).toUpperCase();
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

        // Board & Controls
        gridContainer: document.getElementById('roulette-betting-grid'),
        chipButtons: document.querySelectorAll('.chip-btn'),
        btnClearBets: document.getElementById('btn-clear-bets'),
        btnDoubleBets: document.getElementById('btn-double-bets'),
        btnInsideHelper: document.getElementById('btn-inside-helper'),
        insideModal: document.getElementById('inside-bets-modal'),
        btnCloseInsideModal: document.getElementById('btn-close-inside-modal'),

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

        // Chat
        chatContainer: document.getElementById('chat-messages-container'),
        chatForm: document.getElementById('chat-form'),
        chatInput: document.getElementById('chat-input'),
        reactionPills: document.querySelectorAll('.reaction-pill'),

        // Result banner
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

      const savedColor = localStorage.getItem('roulette_player_color') || '#D4AF37';

      LUXURY_SWATCHES.forEach((swatch, idx) => {
        const div = document.createElement('div');
        div.className = 'color-swatch' + (swatch.color === savedColor ? ' active' : '');
        div.dataset.color = swatch.color;
        div.title = swatch.name;
        div.style.backgroundColor = swatch.color;

        div.addEventListener('click', () => {
          document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
          div.classList.add('active');
          this.myPlayer.color = swatch.color;
        });

        this.elements.palette.appendChild(div);
      });
    }

    setupOnboarding() {
      const savedName = localStorage.getItem('roulette_player_name') || '';
      const savedPassword = localStorage.getItem('roulette_player_password') || '';
      const savedColor = localStorage.getItem('roulette_player_color') || '#D4AF37';

      if (this.elements.inputName && savedName) {
        this.elements.inputName.value = savedName;
      }
      if (this.elements.inputPassword && savedPassword) {
        this.elements.inputPassword.value = savedPassword;
      }
      this.myPlayer.color = savedColor;

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
        if (rawPassword) {
          localStorage.setItem('roulette_player_password', rawPassword);
        } else {
          localStorage.removeItem('roulette_player_password');
        }
        localStorage.setItem('roulette_player_color', color);
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
      if (this.elements.loginErrorMsg) {
        this.elements.loginErrorMsg.textContent = msg;
        this.elements.loginErrorMsg.classList.add('visible');
        this.elements.loginErrorMsg.classList.remove('hidden');
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

    updatePlayerHUD() {
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
        this.elements.playerChips.textContent = `${this.myPlayer.chips.toLocaleString()} CHIPS`;
      }
      this.renderMyProfile();
    }

    setupProfileTab() {
      if (!this.elements.profileColorPalette) return;
      this.elements.profileColorPalette.innerHTML = '';

      LUXURY_SWATCHES.forEach(swatch => {
        const div = document.createElement('div');
        div.className = 'color-swatch' + (swatch.color === this.myPlayer.color ? ' active' : '');
        div.dataset.color = swatch.color;
        div.title = swatch.name;
        div.style.backgroundColor = swatch.color;

        div.addEventListener('click', () => {
          document.querySelectorAll('#profile-color-palette .color-swatch').forEach(s => s.classList.remove('active'));
          div.classList.add('active');
          this.myPlayer.color = swatch.color;
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
            this.showToast('Betting is closed for this round', 'warning');
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
            this.showToast('Betting is closed for this round', 'warning');
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
        this.showToast('Betting is closed for this round', 'warning');
        return;
      }

      if (this.myPlayer.chips < this.selectedChip) {
        this.showToast('Insufficient chip balance', 'error');
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
          this.elements.phaseTitle.textContent = 'PLACE YOUR BETS';
          this.elements.phaseTitle.className = 'phase-title phase-betting';
        } else if (phase === 'SPINNING') {
          this.elements.phaseTitle.textContent = 'WHEEL SPINNING';
          this.elements.phaseTitle.className = 'phase-title phase-spinning';
        } else if (phase === 'PAYOUT') {
          this.elements.phaseTitle.textContent = 'PAYOUT & RESULTS';
          this.elements.phaseTitle.className = 'phase-title phase-payout';
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
      let headline = `WINNING NUMBER: ${winningNumber} ${colorCap}`;

      let subline = '';
      if (myResult) {
        if (myResult.totalWon > 0) {
          subline = `Gewonnen: +${myResult.totalWon.toLocaleString()} fiches (Netto: +${myResult.net.toLocaleString()})`;
        } else if (myResult.totalBet > 0) {
          subline = `Volgende ronde meer geluk (-${myResult.totalBet.toLocaleString()} fiches)`;
        }
      }

      this.elements.resultBanner.innerHTML = `
        <div class="result-number result-${winningColor}">${winningNumber}</div>
        <div class="result-text">
          <div class="result-headline">${headline}</div>
          ${subline ? `<div class="result-subline">${subline}</div>` : ''}
        </div>
      `;
      this.elements.resultBanner.classList.remove('hidden');
    }

    hideResultBanner() {
      if (this.elements.resultBanner) {
        this.elements.resultBanner.classList.add('hidden');
      }
    }

    /* =========================================================================
     * Multiplayer Chatbox (XSS Protected)
     * ========================================================================= */

    setupChat() {
      if (this.elements.chatForm) {
        this.elements.chatForm.addEventListener('submit', (e) => {
          e.preventDefault();
          const text = this.elements.chatInput ? this.elements.chatInput.value.trim() : '';
          if (!text) return;

          if (this.options.onSendChat) {
            this.options.onSendChat(text);
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
              this.options.onSendChat(msg);
            }
          });
        });
      }
    }

    /**
     * Appends a chat message to the activity drawer.
     * Guaranteed XSS safe by using textContent and DOM text nodes.
     * @param {{ sender: string, color?: string, text: string, timestamp: number, isSystem: boolean }} msg 
     */
    addChatMessage(msg) {
      if (!this.elements.chatContainer || !msg) return;

      const item = document.createElement('div');
      item.className = 'chat-item' + (msg.isSystem ? ' chat-system' : '');

      if (msg.isSystem) {
        const content = document.createElement('span');
        content.className = 'system-text';
        content.textContent = msg.text;
        item.appendChild(content);
      } else {
        const sender = document.createElement('span');
        sender.className = 'chat-sender';
        sender.style.color = msg.color || '#D4AF37';
        sender.textContent = `${msg.sender}: `;

        const body = document.createElement('span');
        body.className = 'chat-body';
        body.textContent = msg.text; // TextContent strictly escapes HTML

        item.appendChild(sender);
        item.appendChild(body);
      }

      this.elements.chatContainer.appendChild(item);
      // Auto scroll to latest
      this.elements.chatContainer.scrollTop = this.elements.chatContainer.scrollHeight;
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
  }

  return CasinoUI;
}));
