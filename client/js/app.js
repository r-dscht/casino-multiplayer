/**
 * app.js
 * Main client coordinator for Modern 3D Multiplayer European Roulette Casino.
 * Coordinates 3D Viewport (Three.js), Real-time Socket Networking, and UX interactions.
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize 3D Roulette Engine
  const rouletteContainer = document.getElementById('roulette-canvas-container');
  let roulette3D = null;

  if (rouletteContainer && typeof Roulette3D !== 'undefined') {
    try {
      roulette3D = new Roulette3D(rouletteContainer);
    } catch (err) {
      console.error('Failed to initialize Roulette3D:', err);
    }
  }

  // 2. Initialize Network Layer
  const network = new CasinoNetwork();

  // 3. Keep track of local active bets and multi-table presence
  let currentActiveBets = [];
  let tableLiveBets = [];
  let currentActiveGame = 'Roulette';
  let confirmedServerGame = 'Roulette';
  let currentBjTableId = 'table_1';
  let currentBjTableState = null;
  let myBjSeatIndex = -1;
  let selectedBjChip = 100;
  let lastRoulettePhase = 'BETTING';
  let lastRouletteDuration = 20;
  let lastRouletteTimeLeft = 20;
  let racing = null;
  let hilo = null;
  let mines = null;
  let cross = null;

  function getActiveBetGame() {
    if (currentActiveBets.length > 0) return 'Roulette';
    if (myBjSeatIndex !== -1 && currentBjTableState) {
      const mySeat = currentBjTableState.seats && currentBjTableState.seats[myBjSeatIndex];
      if (mySeat && mySeat.bet > 0 && ['BETTING', 'DEALING', 'PLAYER_TURNS', 'DEALER_TURN'].includes(currentBjTableState.phase)) {
        return 'Blackjack';
      }
    }
    if (poker && poker.mySeatIndex !== -1 && poker.currentTableState) {
      const mySeat = poker.currentTableState.seats && poker.currentTableState.seats[poker.mySeatIndex];
      const inPokerHand = mySeat && !mySeat.folded && (
        mySeat.hasCards ||
        (Array.isArray(mySeat.cards) && mySeat.cards.length > 0) ||
        (mySeat.totalCommittedThisHand || 0) > 0
      );
      if (inPokerHand && !['WAITING_FOR_PLAYERS', 'HAND_END'].includes(poker.currentTableState.currentPhase)) {
        return 'Poker';
      }
    }
    if (crash && typeof crash.hasActiveBet === 'function' && crash.hasActiveBet()) {
      return 'Crash';
    }
    if (racing && typeof racing.hasActiveBets === 'function' && racing.hasActiveBets()) {
      return 'Racing';
    }
    if (hilo && typeof hilo.hasActiveBets === 'function' && hilo.hasActiveBets()) {
      return 'HiLo';
    }
    if (mines && typeof mines.hasActiveBets === 'function' && mines.hasActiveBets()) {
      return 'Mines';
    }
    if (cross && typeof cross.hasActiveBets === 'function' && cross.hasActiveBets()) {
      return 'Cross';
    }
    return null;
  }

  function hasUnsettledBets() {
    return Boolean(getActiveBetGame());
  }

  // Helper to compute spot key from bet payload
  function computeSpotKey(type, value) {
    if (type === 'straight') return `straight_${value}`;
    if (type === 'column') return `column_${value}`;
    if (type === 'dozen') return `dozen_${value}`;
    if (['red', 'black', 'even', 'odd', 'low', 'high'].includes(type)) return `${type}_null`;
    return `${type}_${JSON.stringify(value)}`;
  }

  // 4. Initialize User Interface
  const ui = new CasinoUI({
    onJoinTable: (profile) => {
      network.joinTable(profile);
    },
    onPlaceBet: (betPayload) => {
      network.placeBet({
        type: betPayload.type,
        value: betPayload.value,
        amount: betPayload.amount
      });
    },
    onClearBets: () => {
      network.clearBets();
    },
    onDoubleBets: () => {
      if (currentActiveBets.length === 0) {
        ui.showToast('Geen actieve inzetten om te verdubbelen', 'info');
        return;
      }
      const totalRequired = currentActiveBets.reduce((sum, b) => sum + b.amount, 0);
      if (ui.myPlayer.chips < totalRequired) {
        ui.showToast('Onvoldoende fiches om inzetten te verdubbelen', 'error');
        return;
      }
      // Re-place each active bet
      currentActiveBets.slice().forEach((b) => {
        network.placeBet({
          type: b.type,
          value: b.value,
          amount: b.amount
        });
      });
      ui.showToast(`${currentActiveBets.length} inzetten verdubbeld!`, 'info');
    },
    onSendChat: (text, scope = 'global') => {
      let roomTable = 'roulette';
      if (currentActiveGame === 'Blackjack') {
        roomTable = currentBjTableId;
      } else if (currentActiveGame === 'Poker') {
        roomTable = (poker && poker.currentTableId) || 'poker_1';
      } else if (currentActiveGame === 'Crash') {
        roomTable = 'crash';
      } else if (currentActiveGame === 'Plinko' || currentActiveGame === 'PLINKO') {
        roomTable = 'plinko';
      } else if (currentActiveGame === 'Slots' || currentActiveGame === 'SLOTS') {
        roomTable = 'slots';
      } else if (currentActiveGame === 'Racing' || currentActiveGame === 'RACING') {
        roomTable = 'racing';
      } else if (currentActiveGame === 'HiLo' || currentActiveGame === 'HILO') {
        roomTable = 'hilo';
      } else if (currentActiveGame === 'Mines' || currentActiveGame === 'MINES') {
        roomTable = 'mines';
      } else if (currentActiveGame === 'Cross' || currentActiveGame === 'CROSS') {
        roomTable = 'cross';
      } else if (currentActiveGame === 'Avia' || currentActiveGame === 'AVIA') {
        roomTable = 'avia';
      }
      network.sendChat(text, scope, roomTable);
    },
    onInspectPlayer: (playerId) => {
      network.getProfile(playerId);
    },
    onRequestGlobalLeaderboard: () => {
      network.getGlobalLeaderboard();
    },
    onUpdateCustomization: (customization) => {
      network.updateProfile(customization);
    },
    onOpenTransferToPlayer: (playerId) => {
      if (bank) {
        bank.open();
        bank.switchTab('transfer');
        if (bank.selectTransferRecipient) {
          bank.selectTransferRecipient.value = playerId;
        }
      }
    }
  });

  // 5. Initialize Casino Bank & Deals
  let bank = null;
  if (typeof CasinoBank !== 'undefined') {
    bank = new CasinoBank({ network, ui });
  }

  // 5b. Initialize Texas Hold'em Poker Controller
  let poker = null;
  if (typeof CasinoPoker !== 'undefined') {
    poker = new CasinoPoker({
      network,
      ui,
      onBetStateChange: () => ui.setNavigationLocked(hasUnsettledBets())
    });
    poker.init();
  }

  // 5c. Initialize Multiplayer Velocity Crash Controller
  let crash = null;
  if (typeof CasinoCrash !== 'undefined') {
    crash = new CasinoCrash({ network, ui });
    crash.init();
  }

  // 5d. Initialize Multiplayer Royal Plinko Controller
  let plinko = null;
  if (typeof CasinoPlinko !== 'undefined') {
    plinko = new CasinoPlinko({ network, ui });
    plinko.init();
    if (typeof window !== 'undefined') {
      window.plinkoInstance = plinko;
    }
  }

  // 5e. Initialize Multiplayer Grand Sovereign Slots Controller
  let slots = null;
  if (typeof CasinoSlots !== 'undefined') {
    slots = new CasinoSlots({ network, ui });
    slots.init();
    if (typeof window !== 'undefined') {
      window.slotsInstance = slots;
    }
  }

  // 5f. Initialize Multiplayer Monaco Turf Club (Horse Racing) Controller
  if (typeof CasinoRacing !== 'undefined') {
    racing = new CasinoRacing({ network, ui });
    racing.init();
    if (typeof window !== 'undefined') {
      window.racingInstance = racing;
    }
  }

  // 5g. Initialize Monte Carlo Hi-Lo Prive Controller
  if (typeof CasinoHilo !== 'undefined') {
    hilo = new CasinoHilo({ network, ui });
    hilo.init();
    if (typeof window !== 'undefined') {
      window.hiloInstance = hilo;
    }
  }

  // 5h. Initialize Royal Mines Vault Controller
  if (typeof CasinoMines !== 'undefined') {
    mines = new CasinoMines({ network, ui });
    mines.init();
    if (typeof window !== 'undefined') {
      window.minesInstance = mines;
    }
  }

  // 5h-2. Monte Carlo Boulevard Cross Controller
  if (typeof CasinoCross !== 'undefined') {
    cross = new CasinoCross({ network, ui });
    cross.init();
    if (typeof window !== 'undefined') {
      window.crossInstance = cross;
    }
  }

  // 5h-3. AviaMasters Arcade Flight Controller (tijdelijk gepauzeerd voor latere hervatting -> 0 CPU)
  const AVIA_WIP_ENABLED = false;
  let avia = null;
  if (AVIA_WIP_ENABLED && typeof CasinoAvia !== 'undefined') {
    avia = new CasinoAvia({ network, ui });
    avia.init();
    if (typeof window !== 'undefined') {
      window.aviaInstance = avia;
    }
  }

  // 5i. Initialize Casino Staatsloterij Controller
  let lottery = null;
  if (typeof CasinoLottery !== 'undefined') {
    lottery = new CasinoLottery({ network, ui });
    if (typeof window !== 'undefined') {
      window.lotteryInstance = lottery;
    }
  }

  // 6. Connect Socket Network
  network.connect();

  // 7. Hook Socket Network Events to UI, Bank & 3D Wheel

  network.on('connection_change', ({ connected }) => {
    if (connected) {
      ui.showToast('Verbonden met casinotafel', 'info');
    } else {
      ui.showToast('Verbinding verbroken. Opnieuw verbinden...', 'error');
    }
  });

  network.on('login_error', (data) => {
    ui.showLoginError(data ? data.message : 'Inloggen mislukt');
  });

  network.on('auth_error', (data) => {
    ui.myPlayer.id = null;
    ui.showLoginError(data ? data.message : 'Authenticatie mislukt');
  });

  network.on('error_msg', (data) => {
    if (!data || !data.message) return;
    if (data.code === 'PLAYER_NOT_FOUND' && typeof network.hasStoredCredentials === 'function' && network.hasStoredCredentials()) {
      ui.showToast('Sessie wordt hersteld, probeer zo opnieuw...', 'info');
      return;
    }
    ui.showToast(data.message, 'error');
  });

  network.on('session_recovered', () => {
    ui.showToast('Sessie hersteld!', 'info');
  });

  network.on('session_lost', () => {
    ui.myPlayer.id = null;
    ui.showLoginModal();
    ui.showLoginError('Sessie verlopen. Log opnieuw in om verder te spelen.');
  });

  // Live Deploy & Auto-Update Banner Controller
  const deployBanner = document.getElementById('deploy-update-banner');
  const deployText = document.getElementById('deploy-update-text');
  const btnDeployReload = document.getElementById('btn-deploy-reload-now');

  function showDeployBanner(text, { reloading = false, showBtn = true } = {}) {
    if (!deployBanner) return;
    if (deployText) deployText.textContent = text;
    deployBanner.classList.toggle('is-reloading', Boolean(reloading));
    if (btnDeployReload) btnDeployReload.classList.toggle('hidden', !showBtn);
    deployBanner.classList.remove('hidden');
  }

  function hideDeployBanner() {
    if (!deployBanner) return;
    deployBanner.classList.add('hidden');
  }

  if (btnDeployReload) {
    btnDeployReload.addEventListener('click', () => {
      try {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem('casino_updated_toast', '1');
        }
      } catch (e) {}
      window.location.reload();
    });
  }

  network.on('server_updating', (data) => {
    showDeployBanner(
      (data && data.message) || 'Nieuwe casino-update wordt geladen — je saldo blijft veilig bewaard...',
      { reloading: false, showBtn: true }
    );
  });

  network.on('reconnecting_status', ({ active } = {}) => {
    if (active) {
      showDeployBanner('Verbinding verbroken — opnieuw verbinden met nieuwste server...', { reloading: false, showBtn: true });
    } else if (!network._isReloadingPage) {
      hideDeployBanner();
    }
  });

  network.on('version_mismatch', () => {
    showDeployBanner('Nieuwe casino-versie gedetecteerd — pagina wordt automatisch ververst...', { reloading: true, showBtn: true });
  });

  network.on('version_reloading', () => {
    showDeployBanner('Nieuwe versie gereed — pagina wordt vernieuwd...', { reloading: true, showBtn: false });
  });

  try {
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('casino_updated_toast') === '1') {
      sessionStorage.removeItem('casino_updated_toast');
      ui.showToast('Casino is bijgewerkt naar de nieuwste versie!', 'success');
    }
  } catch (e) {}

  network.on('auth_success', (data) => {
    ui.hideLoginModal();
    if (data && data.player) {
      ui.myPlayer.id = data.player.id;
      ui.myPlayer.name = data.player.name;
      ui.myPlayer.chips = data.player.chips;
      ui.myPlayer.color = data.player.color;
      ui.myPlayer.avatar = data.player.avatar || 'avatar_1';
      ui.updatePlayerHUD();
      ui.renderMyProfile(data.player);
      if (lottery) lottery.renderBuyPreview();
    }
    // Re-sync current game presence & state after reconnect or silent session recovery
    const activeLower = String(currentActiveGame || 'Roulette').toLowerCase();
    if (activeLower && network.myPlayerId) {
      if (activeLower !== 'roulette') {
        network.setGamePresence(activeLower.toUpperCase());
      }
      if (activeLower === 'blackjack') network.bjJoinTable(currentBjTableId);
      else if (activeLower === 'poker') network.pokerJoinTable((poker && poker.currentTableId) || 'poker_1');
      else if (activeLower === 'crash') network.crashJoinTable();
      else if (activeLower === 'plinko') network.plinkoJoin();
      else if (activeLower === 'slots') network.slotsJoin(slots ? slots.selectedMachineId : null);
      else if (activeLower === 'racing') network.racingJoin();
      else if (activeLower === 'hilo') network.hiloJoin();
      else if (activeLower === 'mines') network.minesJoin();
      else if (activeLower === 'cross') network.crossJoin();
      else if (activeLower === 'avia' && AVIA_WIP_ENABLED) network.aviaJoin();
    }
    if (lottery && typeof network.requestLotteryState === 'function') {
      network.requestLotteryState();
    }
    ui.setNavigationLocked(hasUnsettledBets());
    // Reconcile and request bank state with cached backup
    if (bank) {
      let backup = null;
      try {
        if (typeof localStorage !== 'undefined') {
          const cached = localStorage.getItem('casino_bank_backup');
          if (cached) backup = JSON.parse(cached);
        }
      } catch (e) {}
      network.getBankState(backup);
    }
  });

  network.on('table_state', (state) => {
    if (!state) return;

    ui.hideLoginModal();

    if (state.playerId) {
      ui.myPlayer.id = state.playerId;
    }

    // Find our player in players array
    if (Array.isArray(state.players)) {
      const me = state.players.find(p => p.id === ui.myPlayer.id);
      if (me) {
        ui.myPlayer.chips = me.chips;
        ui.myPlayer.name = me.name;
        ui.myPlayer.color = me.color;
        ui.myPlayer.currentGame = me.currentGame || 'Roulette';
        if (me.stats) ui.myPlayer.stats = me.stats;
        if (me.createdAt) ui.myPlayer.createdAt = me.createdAt;
        ui.updatePlayerHUD();
        ui.renderMyProfile(me);
        if (lottery) lottery.renderBuyPreview();
      }
    }

    lastRoulettePhase = state.currentPhase || 'BETTING';
    lastRouletteDuration = state.phaseDuration || 20;
    lastRouletteTimeLeft = state.timeLeft || 0;

    // Set phase and countdown
    if (currentActiveGame === 'Roulette') {
      ui.updatePhase(state.currentPhase, state.phaseDuration || 20, state.timeLeft || 0);
    }

    // Update history strip
    if (Array.isArray(state.recentHistory)) {
      ui.updateHistoryStrip(state.recentHistory);
    }

    // Populate existing chat history without duplicating on reconnect
    if (Array.isArray(state.chatHistory)) {
      if (typeof ui.loadChatHistory === 'function') {
        ui.loadChatHistory(state.chatHistory);
      } else {
        state.chatHistory.forEach(msg => ui.addChatMessage(msg));
      }
    }

    // Render active bets across all players
    currentActiveBets = [];
    tableLiveBets = [];
    const roulettePhaseActive = !state.currentPhase || ['BETTING', 'SPINNING'].includes(state.currentPhase);
    if (state.activeBets && typeof state.activeBets === 'object') {
      Object.entries(state.activeBets).forEach(([pid, bets]) => {
        if (Array.isArray(bets)) {
          // Find player color and name
          const player = (state.players || []).find(p => p.id === pid);
          const color = player ? player.color : '#D4AF37';
          const name = player ? player.name : `VIP_${pid.slice(0, 4)}`;

          bets.forEach(b => {
            tableLiveBets.push({
              playerId: pid,
              playerName: name,
              playerColor: color,
              bet: b
            });
            const spotKey = computeSpotKey(b.type, b.value);
            ui.addChipToSpot(spotKey, color, b.amount);
            if (roulettePhaseActive && pid === ui.myPlayer.id) {
              currentActiveBets.push(b);
            }
          });
        }
      });
    }
    ui.setNavigationLocked(hasUnsettledBets());

    ui.updateActiveBetsList(tableLiveBets, state.tableChipsTotal || 0);

    // Populate initial leaderboard & bank players
    if (Array.isArray(state.players)) {
      ui.updateLeaderboard(state.players);
      if (bank) bank.updateConnectedPlayers(state.players);
    }
    if (Array.isArray(state.globalLeaderboard)) {
      ui.updateGlobalLeaderboard(state.globalLeaderboard);
    }

    // Set initial resting pocket on 3D wheel if not spinning
    if (roulette3D && state.currentPhase !== 'SPINNING') {
      if (Array.isArray(state.recentHistory) && state.recentHistory.length > 0) {
        roulette3D.setRestingPocket(state.recentHistory[0]);
      }
    }

    // If joining mid-spin, catch up 3D wheel
    if (state.currentPhase === 'SPINNING' && roulette3D && state.winningNumber !== undefined) {
      const elapsed = Math.max(0, (state.phaseDuration || 9) - (state.timeLeft || 0));
      roulette3D.startSpin(state.winningNumber, state.phaseDuration || 9, elapsed);
    }
  });

  network.on('phase_tick', (data) => {
    if (!data) return;
    lastRouletteTimeLeft = data.timeLeft;
    if (currentActiveGame === 'Roulette') {
      ui.updateTimer(data.timeLeft);
    }
  });

  network.on('phase_change', (data) => {
    if (!data) return;
    lastRoulettePhase = data.phase;
    lastRouletteDuration = data.duration || 20;
    lastRouletteTimeLeft = data.timeLeft || 0;

    if (currentActiveGame === 'Roulette') {
      ui.updatePhase(data.phase, data.duration, data.timeLeft);
    }

    if (data.phase === 'SPINNING') {
      if (roulette3D && typeof data.winningNumber === 'number') {
        roulette3D.startSpin(data.winningNumber, data.duration || 9.0);
      }
    } else if (data.phase === 'BETTING') {
      // Clear table chips for next round
      ui.clearAllChips();
      currentActiveBets = [];
      tableLiveBets = [];
      ui.updateActiveBetsList([], 0);
      ui.setNavigationLocked(hasUnsettledBets());
      if (roulette3D && typeof roulette3D.resetCamera === 'function') {
        roulette3D.resetCamera();
      }
    }
  });

  network.on('round_result', (data) => {
    if (!data) return;

    // Settle 3D wheel and ball precisely on winning pocket
    if (roulette3D && typeof data.winningNumber === 'number') {
      roulette3D.setRestingPocket(data.winningNumber);
    }

    // Find my personal result
    let myResult = null;
    if (Array.isArray(data.results)) {
      myResult = data.results.find(r => r.playerId === ui.myPlayer.id);
      if (myResult) {
        ui.myPlayer.chips = myResult.chips;
        if (myResult.stats) {
          ui.myPlayer.stats = myResult.stats;
          ui.renderMyProfile();
        }
        ui.updatePlayerHUD();
      }
    }

    // Update history strip
    if (Array.isArray(data.history)) {
      ui.updateHistoryStrip(data.history);
    }

    // Show victory banner & trigger golden win celebration
    ui.showRoundResult(data.winningNumber, data.winningColor, myResult);
    if (myResult && myResult.totalWon > 0) {
      const netWin = typeof myResult.net === 'number' ? myResult.net : myResult.totalWon;
      ui.triggerWinShimmer(netWin >= 1000 ? 3500 : 2500);
    }
    currentActiveBets = [];
    ui.setNavigationLocked(hasUnsettledBets());
  });

  network.on('bet_accepted', (data) => {
    if (!data) return;
    if (typeof data.remainingChips === 'number') {
      ui.myPlayer.chips = data.remainingChips;
      ui.updatePlayerHUD();
    }
    if (data.bet) {
      currentActiveBets.push(data.bet);
    }
    ui.setNavigationLocked(hasUnsettledBets());
  });

  network.on('bet_rejected', (data) => {
    const reason = data ? (data.reason || data.code) : 'Bet was rejected';
    ui.showToast(reason, 'error');
  });

  network.on('bet_placed', (data) => {
    if (!data || !data.bet) return;
    const spotKey = computeSpotKey(data.bet.type, data.bet.value);
    ui.addChipToSpot(spotKey, data.playerColor || '#D4AF37', data.bet.amount);

    tableLiveBets.push({
      playerId: data.playerId,
      playerName: data.playerName,
      playerColor: data.playerColor,
      bet: data.bet
    });
    ui.updateActiveBetsList(tableLiveBets, data.tableChipsTotal);
  });

  network.on('bets_cleared', (data) => {
    if (!data) return;
    ui.clearPlayerChips(data.playerId);
    tableLiveBets = tableLiveBets.filter(b => b.playerId !== data.playerId);
    ui.updateActiveBetsList(tableLiveBets, data.tableChipsTotal);
    if (data.playerId === ui.myPlayer.id) {
      currentActiveBets = [];
      ui.setNavigationLocked(hasUnsettledBets());
      ui.showToast('Al je inzetten zijn geretourneerd', 'info');
    }
  });

  network.on('global_leaderboard_update', (players) => {
    if (Array.isArray(players)) {
      ui.updateGlobalLeaderboard(players);
    }
  });

  network.on('players_update', (players) => {
    if (Array.isArray(players)) {
      ui.updateLeaderboard(players);
      if (bank) bank.updateConnectedPlayers(players);
      const me = players.find(p => p.id === ui.myPlayer.id);
      if (me) {
        const deferAvia = !!(avia && (avia.isFlightAnimating || avia.isFlightPending));
        if (deferAvia) {
          avia.pendingFinalChips = me.chips;
        } else if (!bank || !bank.isWheelSpinning) {
          ui.myPlayer.chips = me.chips;
          ui.updatePlayerHUD();
        }
        if (me.currentGame) ui.myPlayer.currentGame = me.currentGame;
        if (me.stats) ui.myPlayer.stats = me.stats;
        if (me.createdAt) ui.myPlayer.createdAt = me.createdAt;
        ui.renderMyProfile(me);
        if (bank) bank.updateBankData(bank.currentBankData);
      }
    }
  });

  network.on('profile_data', (profile) => {
    if (!profile) return;
    if (profile.id === ui.myPlayer.id) {
      ui.myPlayer.stats = profile.stats;
      ui.myPlayer.createdAt = profile.createdAt;
      ui.myPlayer.currentGame = profile.currentGame;
      ui.renderMyProfile(profile);
    } else {
      ui.showPlayerProfile(profile);
    }
  });

  network.on('profile_updated', (profile) => {
    if (!profile) return;
    if (profile.id === ui.myPlayer.id) {
      ui.myPlayer.stats = profile.stats;
      ui.myPlayer.color = profile.color;
      ui.myPlayer.createdAt = profile.createdAt;
      ui.myPlayer.currentGame = profile.currentGame;
      try {
        if (typeof localStorage !== 'undefined' && profile.color) {
          localStorage.setItem('casino_player_color', profile.color);
          localStorage.setItem('roulette_player_color', profile.color);
        }
      } catch (e) {}
      network.saveClientBackup({ color: profile.color, avatar: profile.avatar });
      ui.updatePlayerHUD();
      ui.renderMyProfile(profile);
      ui.showToast('Profielkleur bijgewerkt!', 'success');
    }
  });

  // Profile Password Save
  const btnSavePass = document.getElementById('btn-save-profile-password');
  const inputPass = document.getElementById('profile-new-password');
  const msgPass = document.getElementById('profile-password-msg');

  let pendingSavedPassword = '';
  if (btnSavePass && inputPass) {
    btnSavePass.addEventListener('click', () => {
      const pw = inputPass.value.trim();
      if (!pw || pw.length < 3) {
        if (msgPass) {
          msgPass.textContent = 'Wachtwoord moet minimaal 3 tekens bevatten';
          msgPass.style.color = '#ff6b6b';
          msgPass.classList.remove('hidden');
        }
        return;
      }
      pendingSavedPassword = pw;
      network.setPassword(pw);
    });
  }

  network.on('player_password_result', (res) => {
    if (msgPass) {
      if (res && res.success) {
        if (pendingSavedPassword) {
          try {
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem('casino_player_password', pendingSavedPassword);
              localStorage.setItem('roulette_player_password', pendingSavedPassword);
            }
          } catch (e) {}
          pendingSavedPassword = '';
        }
        msgPass.textContent = 'Wachtwoord succesvol ingesteld!';
        msgPass.style.color = '#10b981';
        msgPass.classList.remove('hidden');
        if (inputPass) inputPass.value = '';
        setTimeout(() => msgPass.classList.add('hidden'), 4000);
      } else {
        pendingSavedPassword = '';
        msgPass.textContent = (res && res.reason) || 'Fout bij opslaan van wachtwoord';
        msgPass.style.color = '#ff6b6b';
        msgPass.classList.remove('hidden');
      }
    }
  });

  const GAME_VIEW_NAMES = new Set([
    'roulette', 'blackjack', 'poker', 'crash', 'plinko', 'slots', 'racing', 'hilo', 'mines', 'cross'
  ]);

  function deactivateInactiveViews(targetKey) {
    if (targetKey !== 'poker' && poker && typeof poker.onViewDeactivated === 'function') {
      poker.onViewDeactivated();
    }
    if (targetKey !== 'slots' && slots && typeof slots.onViewDeactivated === 'function') {
      slots.onViewDeactivated();
    }
    if (targetKey !== 'racing' && racing && typeof racing.onViewDeactivated === 'function') {
      racing.onViewDeactivated();
    }
    if (targetKey !== 'hilo' && hilo && typeof hilo.onViewDeactivated === 'function') {
      hilo.onViewDeactivated();
    }
    if (targetKey !== 'mines' && mines && typeof mines.onViewDeactivated === 'function') {
      mines.onViewDeactivated();
    }
    if (targetKey !== 'cross' && cross && typeof cross.onViewDeactivated === 'function') {
      cross.onViewDeactivated();
    }
    if (targetKey !== 'avia' && avia && typeof avia.onViewDeactivated === 'function') {
      avia.onViewDeactivated();
    }
  }

  function activateGameView(rawGame, { syncPresence = false, joinPrimaryTables = false, joinAuxiliary = false, announce = false } = {}) {
    const key = String(rawGame || 'Roulette').trim().toLowerCase();
    deactivateInactiveViews(key);
    try {
      if (typeof sessionStorage !== 'undefined' && GAME_VIEW_NAMES.has(key)) {
        sessionStorage.setItem('casino_active_game', key);
      }
    } catch (e) {}

    if (key === 'roulette') {
      currentActiveGame = 'Roulette';
      ui.switchGameView('roulette');
      if (syncPresence) network.setGamePresence('Roulette');
      ui.switchChatScope('table');
      ui.updatePhase(lastRoulettePhase, lastRouletteDuration, lastRouletteTimeLeft);
      if (announce) ui.showToast('Je speelt nu Roulette', 'info');
    } else if (key === 'blackjack') {
      currentActiveGame = 'Blackjack';
      ui.switchGameView('blackjack', currentBjTableId);
      if (syncPresence) network.setGamePresence('Blackjack');
      if (joinPrimaryTables) network.bjJoinTable(currentBjTableId);
      ui.switchChatScope('table');
      if (currentBjTableState) {
        ui.updatePhase(currentBjTableState.phase, 15, currentBjTableState.timeLeft || 0);
        ui.renderBlackjackDealer(currentBjTableState.dealerHand || [], currentBjTableState.dealerScore || 0, currentBjTableState.phase);
        ui.renderBlackjackSeats(currentBjTableState.seats || [], currentBjTableState.activeSeatIndex, myBjSeatIndex, currentBjTableState.phase);
      } else {
        ui.updatePhase('WAITING_FOR_PLAYERS', 15, 0);
      }
      if (announce) ui.showToast('Je speelt nu Blackjack', 'info');
    } else if (key === 'poker') {
      currentActiveGame = 'Poker';
      const targetPokerTable = (poker && poker.currentTableId) || 'poker_1';
      ui.switchGameView('poker', targetPokerTable);
      if (syncPresence) network.setGamePresence('POKER');
      if (joinPrimaryTables) network.pokerJoinTable(targetPokerTable);
      ui.switchChatScope('table');
      if (poker && typeof poker.onViewActivated === 'function') {
        poker.onViewActivated();
      } else {
        ui.updatePhase('WAITING_FOR_PLAYERS', 15, 0);
      }
      if (poker && poker.currentTableState) {
        poker.renderTable(poker.currentTableState);
      }
      if (announce) ui.showToast('Je speelt nu Texas Hold\'em Poker', 'info');
    } else if (key === 'crash') {
      currentActiveGame = 'Crash';
      ui.switchGameView('crash');
      if (syncPresence) network.setGamePresence('CRASH');
      if (joinPrimaryTables) network.crashJoinTable();
      ui.switchChatScope('table');
      if (crash) {
        ui.updatePhase(crash.phase === 'RUNNING' ? 'CRASH_FLYING' : (crash.phase === 'CRASHED' ? 'PAYOUT' : 'BETTING'), crash.duration || 8, crash.phase === 'RUNNING' ? 'LIVE' : (crash.timeLeft || 0));
      }
      if (announce) ui.showToast('Je speelt nu Velocity Crash', 'info');
    } else if (key === 'plinko') {
      currentActiveGame = 'Plinko';
      ui.switchGameView('plinko');
      if (syncPresence) network.setGamePresence('PLINKO');
      if (joinPrimaryTables) network.plinkoJoin();
      ui.switchChatScope('table');
      ui.updatePhase('PLINKO_READY', 0, 'LIVE');
      if (plinko) plinko.onViewActivated();
      if (announce) ui.showToast('Je speelt nu Royal Plinko', 'info');
    } else if (key === 'slots') {
      currentActiveGame = 'Slots';
      ui.switchGameView('slots');
      if (syncPresence) network.setGamePresence('SLOTS');
      if (joinPrimaryTables) network.slotsJoin(slots ? slots.selectedMachineId : null);
      ui.switchChatScope('table');
      if (slots) {
        slots.onViewActivated();
      } else {
        ui.updatePhase('SLOTS_READY', 0, 'LIVE');
      }
      if (announce) ui.showToast('Je speelt nu Grand Sovereign Slots', 'info');
    } else if (key === 'racing') {
      currentActiveGame = 'Racing';
      ui.switchGameView('racing');
      if (syncPresence) network.setGamePresence('RACING');
      if (joinPrimaryTables || joinAuxiliary) network.racingJoin();
      ui.switchChatScope('table');
      if (racing) {
        racing.onViewActivated();
      } else {
        ui.updatePhase('WAITING_FOR_BETS', 18, 18);
      }
      if (announce) ui.showToast('Je bezoekt nu Monaco Turf Club Derby', 'info');
    } else if (key === 'hilo') {
      currentActiveGame = 'HiLo';
      ui.switchGameView('hilo');
      if (syncPresence) network.setGamePresence('HILO');
      if (joinPrimaryTables || joinAuxiliary) network.hiloJoin();
      ui.switchChatScope('table');
      if (hilo) {
        hilo.onViewActivated();
      } else {
        ui.updatePhase('HILO_READY', 0, 'SOLO');
      }
      if (announce) ui.showToast('Je speelt nu Monte Carlo Hi-Lo Privé', 'info');
    } else if (key === 'mines') {
      currentActiveGame = 'Mines';
      ui.switchGameView('mines');
      if (syncPresence) network.setGamePresence('MINES');
      if (joinPrimaryTables || joinAuxiliary) network.minesJoin();
      ui.switchChatScope('table');
      if (mines) {
        mines.onViewActivated();
      } else {
        ui.updatePhase('MINES_READY', 0, 'SOLO');
      }
      if (announce) ui.showToast('Je speelt nu Royal Mines Vault', 'info');
    } else if (key === 'cross') {
      currentActiveGame = 'Cross';
      ui.switchGameView('cross');
      if (syncPresence) network.setGamePresence('CROSS');
      if (joinPrimaryTables || joinAuxiliary) network.crossJoin();
      ui.switchChatScope('table');
      if (cross) {
        cross.onViewActivated();
      } else {
        ui.updatePhase('CROSS_READY', 0, 'SOLO');
      }
      if (announce) ui.showToast('Je speelt nu Monte Carlo Boulevard Cross', 'info');
    } else if (key === 'avia') {
      if (!AVIA_WIP_ENABLED) {
        activateGameView('roulette', { syncPresence, joinPrimaryTables, joinAuxiliary, announce: false });
        return;
      }
      currentActiveGame = 'Avia';
      ui.switchGameView('avia');
      if (syncPresence) network.setGamePresence('AVIA');
      if (joinPrimaryTables || joinAuxiliary) network.aviaJoin();
      ui.switchChatScope('table');
      if (avia) {
        avia.onViewActivated();
      } else {
        ui.updatePhase('AVIA_READY', 0, 'SOLO');
      }
      if (announce) ui.showToast('Je speelt nu AviaMasters Luchtvaart Arcade', 'info');
    }
  }

  // Game Presence & Table View switcher pills
  document.querySelectorAll('.game-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const game = btn.dataset.game;
      const activeBetGame = getActiveBetGame();
      if (activeBetGame) {
        ui.setNavigationLocked(true);
        if (String(activeBetGame).toLowerCase() !== String(currentActiveGame || '').toLowerCase() &&
            String(activeBetGame).toLowerCase() === String(game || '').toLowerCase()) {
          activateGameView(activeBetGame, { syncPresence: false, joinPrimaryTables: false, announce: false });
          return;
        }
        ui.showToast(`Inzet actief op ${activeBetGame} — Navigatie vergrendeld tot einde van de ronde`, 'error');
        return;
      }
      ui.setNavigationLocked(false);
      if (!GAME_VIEW_NAMES.has(String(game || '').toLowerCase())) {
        ui.showToast(`${btn.textContent.trim()} is binnenkort beschikbaar!`, 'info');
        return;
      }
      activateGameView(game, { syncPresence: true, joinPrimaryTables: true, announce: true });
    });
  });

  // Restore last active game on tab refresh (F5) immediately without flashing Roulette
  try {
    if (typeof sessionStorage !== 'undefined') {
      const savedTabGame = sessionStorage.getItem('casino_active_game');
      if (savedTabGame && savedTabGame !== 'roulette' && GAME_VIEW_NAMES.has(savedTabGame)) {
        activateGameView(savedTabGame, { syncPresence: false, joinPrimaryTables: false, announce: false });
      }
    }
  } catch (e) {}

  // Left Command Dock button delegation
  document.querySelectorAll('.dock-left-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const g = btn.dataset.game;
      const targetPill = document.querySelector(`.game-pill[data-game="${g}"]`);
      if (targetPill) targetPill.click();
    });
  });

  // Backlog Feature Modals & Navigation Wiring (WIP features remain guarded when hidden)
  const marketModal = document.getElementById('market-modal');
  const btnOpenMarket = document.getElementById('btn-open-market');
  const btnCloseMarket = document.getElementById('btn-close-market-modal');
  if (btnOpenMarket && marketModal) {
    btnOpenMarket.addEventListener('click', () => {
      if (btnOpenMarket.classList.contains('feature-wip-hidden') || marketModal.classList.contains('feature-wip-hidden')) return;
      marketModal.classList.remove('hidden');
    });
  }
  if (btnCloseMarket && marketModal) {
    btnCloseMarket.addEventListener('click', () => marketModal.classList.add('hidden'));
  }

  const exchangeModal = document.getElementById('exchange-modal');
  const btnOpenExchange = document.getElementById('btn-open-exchange');
  const btnCloseExchange = document.getElementById('btn-close-exchange-modal');
  if (btnOpenExchange && exchangeModal) {
    btnOpenExchange.addEventListener('click', () => {
      if (btnOpenExchange.classList.contains('feature-wip-hidden') || exchangeModal.classList.contains('feature-wip-hidden')) return;
      exchangeModal.classList.remove('hidden');
    });
  }
  if (btnCloseExchange && exchangeModal) {
    btnCloseExchange.addEventListener('click', () => exchangeModal.classList.add('hidden'));
  }

  if (!lottery) {
    const lotteryModal = document.getElementById('lottery-modal');
    const btnOpenLottery = document.getElementById('btn-open-lottery');
    const btnCloseLottery = document.getElementById('btn-close-lottery-modal');
    if (btnOpenLottery && lotteryModal) {
      btnOpenLottery.addEventListener('click', () => lotteryModal.classList.remove('hidden'));
    }
    if (btnCloseLottery && lotteryModal) {
      btnCloseLottery.addEventListener('click', () => lotteryModal.classList.add('hidden'));
    }
  }

  const racingModal = document.getElementById('racing-modal');
  const btnCloseRacing = document.getElementById('btn-close-racing-modal');
  const btnViewRacingLive = document.getElementById('btn-view-racing-live');
  if (btnCloseRacing && racingModal) {
    btnCloseRacing.addEventListener('click', () => racingModal.classList.add('hidden'));
  }
  if (btnViewRacingLive && racingModal) {
    btnViewRacingLive.addEventListener('click', () => {
      racingModal.classList.add('hidden');
      const racingPill = document.getElementById('pill-racing');
      if (racingPill) racingPill.click();
    });
  }

  // Gadgets & Perks Dock Toggle
  const gadgetsDock = document.getElementById('gadgets-perks-dock');
  const btnToggleGadgets = document.getElementById('btn-toggle-gadgets');
  if (btnToggleGadgets && gadgetsDock) {
    btnToggleGadgets.addEventListener('click', () => {
      if (gadgetsDock.classList.contains('feature-wip-hidden')) return;
      gadgetsDock.classList.toggle('expanded');
    });
  }

  // Table Switcher (Table 1 vs Table 2)
  const handleBjTableSwitch = (targetTableId) => {
    if (targetTableId === currentBjTableId) return;
    if (hasUnsettledBets()) {
      ui.showToast('Inzet actief — Navigatie vergrendeld tot einde van de ronde', 'error');
      return;
    }
    currentBjTableId = targetTableId;
    myBjSeatIndex = -1;
    currentBjTableState = null;

    if (ui.elements.bjTableBtn1 && ui.elements.bjTableBtn2) {
      ui.elements.bjTableBtn1.classList.toggle('active', targetTableId === 'table_1');
      ui.elements.bjTableBtn2.classList.toggle('active', targetTableId === 'table_2');
    }
    if (ui.elements.bjTableName) {
      ui.elements.bjTableName.textContent = (targetTableId === 'table_1' ? 'Tafel 1 (Standaard)' : 'Tafel 2 (VIP High-Roller)');
    }

    if (typeof ui.updateChatTableFilter === 'function') {
      ui.updateChatTableFilter(targetTableId);
    }
    if (typeof ui.updateChatTableTabLabel === 'function') {
      ui.updateChatTableTabLabel();
    }

    network.bjJoinTable(targetTableId);
    ui.showToast(`Geschakeld naar ${targetTableId === 'table_1' ? 'Tafel 1' : 'Tafel 2'}`, 'info');
  };

  if (ui.elements.bjTableBtn1) {
    ui.elements.bjTableBtn1.addEventListener('click', () => handleBjTableSwitch('table_1'));
  }
  if (ui.elements.bjTableBtn2) {
    ui.elements.bjTableBtn2.addEventListener('click', () => handleBjTableSwitch('table_2'));
  }

  // Blackjack Chip Selection (Click to choose chip denomination without auto-betting)
  const bjChipBtns = document.querySelectorAll('#blackjack-view .chip-selector .chip-btn, #bj-bet-chips-row .chip-btn');
  bjChipBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      bjChipBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const val = parseInt(btn.dataset.val || btn.dataset.value || btn.textContent.trim(), 10);
      if (!isNaN(val) && val > 0) {
        selectedBjChip = val;
      }
    });
  });

  const btnBjDeal = document.getElementById('btn-bj-deal');
  if (btnBjDeal) {
    btnBjDeal.addEventListener('click', () => {
      if (myBjSeatIndex === -1) {
        ui.showToast('Neem eerst plaats aan tafel', 'info');
        return;
      }
      network.bjDealNow(currentBjTableId);
    });
  }

  // Blackjack Seats Arc interactions (Sit, Leave, Bet)
  if (ui.elements.bjSeatsArc) {
    ui.elements.bjSeatsArc.addEventListener('click', (e) => {
      // Sit button
      const sitBtn = e.target.closest('.btn-seat-sit');
      if (sitBtn) {
        const seatIdx = parseInt(sitBtn.dataset.seat, 10);
        if (!isNaN(seatIdx)) {
          network.bjTakeSeat(seatIdx, currentBjTableId);
        }
        return;
      }

      // Leave button
      const leaveBtn = e.target.closest('.btn-seat-leave');
      if (leaveBtn) {
        const seatIdx = parseInt(leaveBtn.dataset.seat, 10);
        if (isNaN(seatIdx)) return;

        const mySeat = currentBjTableState && currentBjTableState.seats ? currentBjTableState.seats[seatIdx] : null;
        const currentPhase = currentBjTableState ? currentBjTableState.phase : 'BETTING';

        if (['DEALING', 'PLAYER_TURNS', 'DEALER_TURN'].includes(currentPhase) && mySeat && mySeat.bet > 0) {
          ui.showToast('Inzet actief — Je kunt de stoel pas verlaten na afloop van de hand', 'error');
          return;
        }

        // If in BETTING phase and a bet was placed, clear it first so chips are refunded!
        if (currentPhase === 'BETTING' && mySeat && mySeat.bet > 0) {
          network.bjClearBet(seatIdx, currentBjTableId);
        }
        network.bjLeaveSeat(seatIdx, currentBjTableId);
        return;
      }

      // Betting spot (hokje)
      let spot = e.target.closest('.betting-spot') || (e.target.closest('.seat-betting-area') ? e.target.closest('.seat-betting-area').querySelector('.betting-spot') : null);
      if (!spot && myBjSeatIndex !== -1) {
        const seatEl = e.target.closest('.bj-seat');
        if (seatEl && parseInt(seatEl.dataset.seat, 10) === myBjSeatIndex) {
          spot = seatEl.querySelector('.betting-spot');
        }
      }

      if (spot) {
        const seatIdx = parseInt(spot.dataset.seat, 10);
        if (seatIdx !== myBjSeatIndex) {
          if (myBjSeatIndex === -1) {
            ui.showToast('Neem eerst plaats aan tafel om in te zetten', 'info');
          } else {
            ui.showToast('Je kunt alleen op je eigen stoel inzetten', 'info');
          }
          return;
        }
        if (!currentBjTableState || currentBjTableState.phase !== 'BETTING') {
          ui.showToast('Inzetten kan alleen tijdens de inzetfase', 'info');
          return;
        }
        if (ui.myPlayer.chips < selectedBjChip) {
          ui.showToast('Onvoldoende fiches voor deze inzet', 'error');
          return;
        }
        network.bjPlaceBet(seatIdx, selectedBjChip, currentBjTableId);
      }
    });
  }

  // Helper to get active hand index for my seat
  function getMyActiveHandIndex() {
    if (currentBjTableState && currentBjTableState.activeTurn && currentBjTableState.activeTurn.seatIndex === myBjSeatIndex) {
      return currentBjTableState.activeTurn.handIndex || 0;
    }
    const mySeat = currentBjTableState && currentBjTableState.seats ? currentBjTableState.seats[myBjSeatIndex] : null;
    return mySeat ? (mySeat.activeHandIndex || 0) : 0;
  }

  // Blackjack Action Buttons
  if (ui.elements.btnBjHit) {
    ui.elements.btnBjHit.addEventListener('click', () => {
      if (myBjSeatIndex !== -1) {
        network.bjAction('hit', myBjSeatIndex, getMyActiveHandIndex(), currentBjTableId);
      }
    });
  }
  if (ui.elements.btnBjStand) {
    ui.elements.btnBjStand.addEventListener('click', () => {
      if (myBjSeatIndex !== -1) {
        network.bjAction('stand', myBjSeatIndex, getMyActiveHandIndex(), currentBjTableId);
      }
    });
  }
  if (ui.elements.btnBjDouble) {
    ui.elements.btnBjDouble.addEventListener('click', () => {
      if (myBjSeatIndex !== -1) {
        network.bjAction('double', myBjSeatIndex, getMyActiveHandIndex(), currentBjTableId);
      }
    });
  }
  if (ui.elements.btnBjSplit) {
    ui.elements.btnBjSplit.addEventListener('click', () => {
      if (myBjSeatIndex !== -1) {
        network.bjAction('split', myBjSeatIndex, getMyActiveHandIndex(), currentBjTableId);
      }
    });
  }
  if (ui.elements.btnBjClear) {
    ui.elements.btnBjClear.addEventListener('click', () => {
      if (myBjSeatIndex !== -1) {
        network.bjClearBet(myBjSeatIndex, currentBjTableId);
      }
    });
  }

  const btnBjDoubleBet = document.getElementById('btn-bj-double-bet');
  if (btnBjDoubleBet) {
    btnBjDoubleBet.addEventListener('click', () => {
      if (myBjSeatIndex === -1) {
        ui.showToast('Neem eerst plaats aan tafel', 'info');
        return;
      }
      if (!currentBjTableState || currentBjTableState.phase !== 'BETTING') {
        ui.showToast('Inzetten kan alleen tijdens de inzetfase', 'info');
        return;
      }
      const mySeat = currentBjTableState.seats ? currentBjTableState.seats[myBjSeatIndex] : null;
      const currentBet = mySeat ? (mySeat.bet || 0) : 0;
      if (currentBet <= 0) {
        if (ui.myPlayer.chips < selectedBjChip) {
          ui.showToast('Onvoldoende fiches voor deze inzet', 'error');
          return;
        }
        network.bjPlaceBet(myBjSeatIndex, selectedBjChip, currentBjTableId);
        return;
      }
      const addAmount = Math.min(currentBet, ui.myPlayer.chips, 100000 - currentBet);
      if (addAmount <= 0) {
        ui.showToast('Onvoldoende fiches of maximale tafellimiet bereikt', 'error');
        return;
      }
      network.bjPlaceBet(myBjSeatIndex, addAmount, currentBjTableId);
    });
  }

  const btnBjMaxBet = document.getElementById('btn-bj-max-bet');
  if (btnBjMaxBet) {
    btnBjMaxBet.addEventListener('click', () => {
      if (myBjSeatIndex === -1) {
        ui.showToast('Neem eerst plaats aan tafel', 'info');
        return;
      }
      if (!currentBjTableState || currentBjTableState.phase !== 'BETTING') {
        ui.showToast('Inzetten kan alleen tijdens de inzetfase', 'info');
        return;
      }
      const mySeat = currentBjTableState.seats ? currentBjTableState.seats[myBjSeatIndex] : null;
      const currentBet = mySeat ? (mySeat.bet || 0) : 0;
      const maxAllowed = 100000;
      const desiredBet = Math.min(ui.myPlayer.chips + currentBet, maxAllowed);
      const addAmount = desiredBet - currentBet;
      if (addAmount <= 0) {
        ui.showToast('Maximale tafellimiet bereikt of onvoldoende fiches', 'info');
        return;
      }
      network.bjPlaceBet(myBjSeatIndex, addAmount, currentBjTableId);
    });
  }

  // Helper to recompute turn action buttons
  function updateBjActionButtons() {
    if (!currentBjTableState) {
      if (btnBjDeal) btnBjDeal.disabled = true;
      if (btnBjDoubleBet) btnBjDoubleBet.disabled = true;
      if (btnBjMaxBet) btnBjMaxBet.disabled = true;
      ui.setBlackjackActionsState({ canHit: false, canStand: false, canDouble: false, canSplit: false, canClearBet: false });
      return;
    }
    const isMyTurn = (currentBjTableState.phase === 'PLAYER_TURNS' && currentBjTableState.activeSeatIndex === myBjSeatIndex && myBjSeatIndex !== -1);
    const mySeat = (myBjSeatIndex >= 0 && currentBjTableState.seats) ? currentBjTableState.seats[myBjSeatIndex] : null;
    let canHit = isMyTurn;
    let canStand = isMyTurn;
    let canDouble = false;
    let canSplit = false;

    if (isMyTurn && mySeat) {
      const hands = mySeat.hands || mySeat.splitHands || [];
      const activeHandIdx = getMyActiveHandIndex();
      const activeHand = hands[activeHandIdx] || (mySeat.cards ? mySeat : null);

      if (activeHand && activeHand.cards && activeHand.cards.length === 2) {
        const betAmt = activeHand.bet || mySeat.bet || 0;
        canDouble = (ui.myPlayer.chips >= betAmt);
        const rank0 = activeHand.cards[0].rank;
        const rank1 = activeHand.cards[1].rank;
        if (rank0 === rank1 && hands.length < 2) {
          canSplit = (ui.myPlayer.chips >= betAmt);
        }
      }
    }
    const hasBet = Boolean(mySeat && (mySeat.bet > 0 || (mySeat.hands && mySeat.hands[0] && mySeat.hands[0].bet > 0)));
    const canClearBet = (currentBjTableState.phase === 'BETTING' && hasBet);
    const canQuickBet = (currentBjTableState.phase === 'BETTING' && myBjSeatIndex !== -1);

    if (btnBjDeal) {
      btnBjDeal.disabled = !canClearBet;
    }
    if (btnBjDoubleBet) {
      btnBjDoubleBet.disabled = !canQuickBet;
    }
    if (btnBjMaxBet) {
      btnBjMaxBet.disabled = !canQuickBet;
    }
    ui.setBlackjackActionsState({ canHit, canStand, canDouble, canSplit, canClearBet });
  }

  // Blackjack WebSocket Events
  network.on('bj_table_state', (data) => {
    if (!data || data.tableId !== currentBjTableId) return;
    currentBjTableState = data;

    myBjSeatIndex = -1;
    if (Array.isArray(data.seats) && ui.myPlayer && ui.myPlayer.id) {
      data.seats.forEach((s, idx) => {
        if (s && (s.playerId === ui.myPlayer.id || (s.player && s.player.id === ui.myPlayer.id))) {
          myBjSeatIndex = idx;
        }
      });
    }

    if (currentActiveGame === 'Blackjack') {
      ui.updatePhase(data.phase, 15, data.timeLeft || 0);
    }

    ui.setNavigationLocked(hasUnsettledBets());
    ui.renderBlackjackDealer(data.dealerHand || [], data.dealerScore || 0, data.phase);
    ui.renderBlackjackSeats(
      data.seats || [],
      data.activeSeatIndex !== undefined ? data.activeSeatIndex : (data.activeTurn ? data.activeTurn.seatIndex : -1),
      myBjSeatIndex,
      data.phase
    );
    if (data.shoe) {
      ui.updateShoePenetration(data.shoe.remainingCards, data.shoe.totalCards);
    }
    updateBjActionButtons();
  });

  network.on('bj_seat_taken', (data) => {
    if (!data || data.tableId !== currentBjTableId) return;
    if (!currentBjTableState) {
      currentBjTableState = { seats: [null, null, null, null, null, null], phase: 'BETTING', activeSeatIndex: -1 };
    }
    if (!Array.isArray(currentBjTableState.seats)) {
      currentBjTableState.seats = [null, null, null, null, null, null];
    }
    const seatObj = data.seat || {
      playerId: data.player ? data.player.id : null,
      player: data.player || {
        id: data.player ? data.player.id : null,
        name: data.player ? data.player.name : 'Player',
        color: data.player ? data.player.color : '#c5a059',
        chips: data.player ? data.player.chips : 0
      },
      name: data.player ? data.player.name : 'Player',
      color: data.player ? data.player.color : '#c5a059',
      chips: data.player ? data.player.chips : 0,
      bet: 0,
      cards: []
    };
    currentBjTableState.seats[data.seatIndex] = seatObj;

    if (data.player && data.player.id === ui.myPlayer.id) {
      myBjSeatIndex = data.seatIndex;
    }
    ui.renderBlackjackSeats(currentBjTableState.seats, currentBjTableState.activeSeatIndex, myBjSeatIndex, currentBjTableState.phase);
    updateBjActionButtons();
  });

  network.on('bj_seat_left', (data) => {
    if (!data || data.tableId !== currentBjTableId) return;
    if (data.seatIndex === myBjSeatIndex) {
      myBjSeatIndex = -1;
    }
    if (currentBjTableState && Array.isArray(currentBjTableState.seats)) {
      currentBjTableState.seats[data.seatIndex] = null;
    }
    ui.renderBlackjackSeats(currentBjTableState ? currentBjTableState.seats : [], currentBjTableState ? currentBjTableState.activeSeatIndex : -1, myBjSeatIndex, currentBjTableState ? currentBjTableState.phase : 'BETTING');
    updateBjActionButtons();
  });

  network.on('bj_seat_accepted', (data) => {
    myBjSeatIndex = data.seatIndex;
    ui.showToast(`Plek ${data.seatIndex + 1} ingenomen aan Blackjacktafel`, 'success');
    ui.switchChatScope('table');
    if (!currentBjTableState) {
      currentBjTableState = { seats: [null, null, null, null, null, null], phase: 'BETTING', activeSeatIndex: -1 };
    }
    if (!Array.isArray(currentBjTableState.seats)) {
      currentBjTableState.seats = [null, null, null, null, null, null];
    }
    const seatObj = data.seat || {
      playerId: ui.myPlayer.id,
      player: {
        id: ui.myPlayer.id,
        name: ui.myPlayer.name,
        color: ui.myPlayer.color,
        chips: data.chips !== undefined ? data.chips : ui.myPlayer.chips
      },
      name: ui.myPlayer.name,
      color: ui.myPlayer.color,
      chips: data.chips !== undefined ? data.chips : ui.myPlayer.chips,
      bet: 0,
      cards: []
    };
    currentBjTableState.seats[data.seatIndex] = seatObj;
    ui.renderBlackjackSeats(currentBjTableState.seats, currentBjTableState.activeSeatIndex, myBjSeatIndex, currentBjTableState.phase);
    updateBjActionButtons();
  });

  network.on('bj_seat_vacated', (data) => {
    if (data.seatIndex === myBjSeatIndex) {
      myBjSeatIndex = -1;
    }
    ui.showToast('Stoel verlaten', 'info');
    if (currentBjTableState && Array.isArray(currentBjTableState.seats)) {
      currentBjTableState.seats[data.seatIndex] = null;
      ui.renderBlackjackSeats(currentBjTableState.seats, currentBjTableState.activeSeatIndex, myBjSeatIndex, currentBjTableState.phase);
    }
    ui.setNavigationLocked(hasUnsettledBets());
    updateBjActionButtons();
  });

  network.on('bj_seat_error', (data) => {
    ui.showToast((data && (data.reason || data.message)) || 'Kon stoel niet innemen', 'error');
  });

  network.on('bj_bet_accepted', (data) => {
    const newChips = typeof data.remainingChips === 'number' ? data.remainingChips : data.chipsRemaining;
    if (typeof newChips === 'number') {
      ui.myPlayer.chips = newChips;
      ui.updatePlayerHUD();
    }
    if (currentBjTableState && Array.isArray(currentBjTableState.seats) && data.seatIndex !== undefined) {
      const totalSeatBet = typeof data.totalBet === 'number' ? data.totalBet : data.amount;
      if (!currentBjTableState.seats[data.seatIndex]) {
        currentBjTableState.seats[data.seatIndex] = { bet: totalSeatBet };
      } else {
        currentBjTableState.seats[data.seatIndex].bet = totalSeatBet;
        if (currentBjTableState.seats[data.seatIndex].player && typeof newChips === 'number') {
          currentBjTableState.seats[data.seatIndex].player.chips = newChips;
        }
      }
      ui.renderBlackjackSeats(currentBjTableState.seats, currentBjTableState.activeSeatIndex, myBjSeatIndex, currentBjTableState.phase);
    }
    ui.setNavigationLocked(hasUnsettledBets());
    updateBjActionButtons();
  });

  network.on('bj_bet_placed', (data) => {
    if (!data || data.tableId !== currentBjTableId) return;
    if (currentBjTableState && Array.isArray(currentBjTableState.seats) && data.seatIndex !== undefined) {
      const seat = currentBjTableState.seats[data.seatIndex];
      if (seat) {
        seat.bet = typeof data.totalBet === 'number' ? data.totalBet : data.amount;
        if (seat.player && typeof data.remainingChips === 'number') {
          seat.player.chips = data.remainingChips;
        }
      }
      ui.renderBlackjackSeats(currentBjTableState.seats, currentBjTableState.activeSeatIndex, myBjSeatIndex, currentBjTableState.phase);
    }
    ui.setNavigationLocked(hasUnsettledBets());
    updateBjActionButtons();
  });

  network.on('bj_bet_cleared', (data) => {
    const newChips = (typeof data.remainingChips === 'number')
      ? data.remainingChips
      : (typeof data.chipsRemaining === 'number' ? data.chipsRemaining : (typeof data.chips === 'number' ? data.chips : null));
    if (typeof newChips === 'number' && (data.playerId === ui.myPlayer.id || data.seatIndex === myBjSeatIndex)) {
      ui.myPlayer.chips = newChips;
      ui.updatePlayerHUD();
    }
    if (currentBjTableState && Array.isArray(currentBjTableState.seats) && data.seatIndex !== undefined) {
      const seat = currentBjTableState.seats[data.seatIndex];
      if (seat) {
        seat.bet = 0;
        if (seat.player && typeof newChips === 'number') {
          seat.player.chips = newChips;
        }
      }
      ui.renderBlackjackSeats(currentBjTableState.seats, currentBjTableState.activeSeatIndex, myBjSeatIndex, currentBjTableState.phase);
    }
    if (data.seatIndex === myBjSeatIndex) {
      ui.showToast('Inzet gewist', 'info');
    }
    ui.setNavigationLocked(hasUnsettledBets());
    updateBjActionButtons();
  });

  network.on('bj_bet_rejected', (data) => {
    ui.showToast((data && (data.reason || data.message)) || 'Inzet geweigerd', 'error');
  });

  network.on('bj_action_applied', (data) => {
    if (!data || data.tableId !== currentBjTableId) return;
    if (data.playerId === ui.myPlayer.id && typeof data.remainingChips === 'number') {
      ui.myPlayer.chips = data.remainingChips;
      ui.updatePlayerHUD();
    }
    if (currentBjTableState && Array.isArray(currentBjTableState.seats) && data.seatIndex !== undefined) {
      const seat = currentBjTableState.seats[data.seatIndex];
      if (seat) {
        if (typeof data.totalSeatBet === 'number') {
          seat.bet = data.totalSeatBet;
        }
        if (seat.player && typeof data.remainingChips === 'number') {
          seat.player.chips = data.remainingChips;
        }
        if (Array.isArray(data.hands)) {
          seat.hands = data.hands;
          if (seat.hands[0] && Array.isArray(seat.hands[0].cards)) {
            seat.cards = [...seat.hands[0].cards];
          }
        } else if (data.hand && typeof data.handIndex === 'number') {
          if (!Array.isArray(seat.hands)) seat.hands = [];
          seat.hands[data.handIndex] = data.hand;
          if (data.handIndex === 0 && Array.isArray(data.hand.cards)) {
            seat.cards = [...data.hand.cards];
          }
        } else if (data.card) {
          const hIdx = typeof data.handIndex === 'number' ? data.handIndex : 0;
          if (seat.hands && seat.hands[hIdx]) {
            if (!seat.hands[hIdx].cards) seat.hands[hIdx].cards = [];
            const lastCard = seat.hands[hIdx].cards[seat.hands[hIdx].cards.length - 1];
            if (!lastCard || lastCard.suit !== data.card.suit || lastCard.rank !== data.card.rank) {
              seat.hands[hIdx].cards.push(data.card);
            }
          }
          if (!seat.cards) seat.cards = [];
          const lastSeatCard = seat.cards[seat.cards.length - 1];
          if (!lastSeatCard || lastSeatCard.suit !== data.card.suit || lastSeatCard.rank !== data.card.rank) {
            seat.cards.push(data.card);
          }
        }
      }
      ui.renderBlackjackSeats(currentBjTableState.seats, currentBjTableState.activeSeatIndex, myBjSeatIndex, currentBjTableState.phase);
    }
    ui.setNavigationLocked(hasUnsettledBets());
    updateBjActionButtons();
  });

  network.on('bj_action_executed', (data) => {
    if (!data || data.tableId !== currentBjTableId) return;
    updateBjActionButtons();
  });

  network.on('bj_action_rejected', (data) => {
    ui.showToast((data && (data.reason || data.message)) || 'Actie niet toegestaan', 'error');
  });

  network.on('bj_turn_change', (data) => {
    if (!data || data.tableId !== currentBjTableId) return;
    if (currentBjTableState) {
      currentBjTableState.activeSeatIndex = data.seatIndex;
      currentBjTableState.activeTurn = { seatIndex: data.seatIndex, handIndex: data.handIndex || 0 };
      if (data.seats) currentBjTableState.seats = data.seats;
      if (data.dealerHand) currentBjTableState.dealerHand = data.dealerHand;
      if (data.dealerScore !== undefined) currentBjTableState.dealerScore = data.dealerScore;
      ui.renderBlackjackSeats(currentBjTableState.seats, currentBjTableState.activeTurn, myBjSeatIndex, currentBjTableState.phase);
      ui.renderBlackjackDealer(currentBjTableState.dealerHand || [], currentBjTableState.dealerScore || 0, currentBjTableState.phase);
    }
    if (currentActiveGame === 'Blackjack') {
      ui.updateTimer(data.turnTimeLeft !== undefined ? data.turnTimeLeft : 15);
    }
    updateBjActionButtons();
  });

  network.on('bj_turn_tick', (data) => {
    if (!data || data.tableId !== currentBjTableId) return;
    if (currentActiveGame === 'Blackjack') {
      ui.updateTimer(data.turnTimeLeft);
    }
  });

  network.on('bj_phase_tick', (data) => {
    if (!data || data.tableId !== currentBjTableId) return;
    if (currentActiveGame === 'Blackjack') {
      ui.updateTimer(data.timeLeft);
    }
  });

  network.on('bj_phase_change', (data) => {
    if (!data || data.tableId !== currentBjTableId) return;
    if (data.phase === 'BETTING' || data.phase === 'WAITING_FOR_PLAYERS') {
      ui.hideBlackjackBanner();
    }
    if (currentBjTableState) {
      currentBjTableState.phase = data.phase;
      currentBjTableState.activeSeatIndex = data.activeSeatIndex !== undefined ? data.activeSeatIndex : currentBjTableState.activeSeatIndex;
      if (data.seats) {
        currentBjTableState.seats = data.seats;
      } else if ((data.phase === 'BETTING' || data.phase === 'WAITING_FOR_PLAYERS') && Array.isArray(currentBjTableState.seats)) {
        currentBjTableState.seats.forEach((s) => {
          if (s) {
            s.bet = 0;
            s.cards = [];
            if (Array.isArray(s.hands)) {
              s.hands.forEach((h) => { if (h) { h.bet = 0; h.cards = []; } });
            }
          }
        });
      }
      if (data.dealerHand) currentBjTableState.dealerHand = data.dealerHand;
      if (data.dealerScore !== undefined) currentBjTableState.dealerScore = data.dealerScore;
    }
    if (currentActiveGame === 'Blackjack') {
      ui.updatePhase(data.phase, data.duration || 15, data.timeLeft || 15);
      if (currentBjTableState) {
        ui.renderBlackjackDealer(currentBjTableState.dealerHand || [], currentBjTableState.dealerScore || 0, data.phase);
        ui.renderBlackjackSeats(
          currentBjTableState.seats || [],
          currentBjTableState.activeSeatIndex !== undefined ? currentBjTableState.activeSeatIndex : -1,
          myBjSeatIndex,
          data.phase
        );
      }
    }
    ui.setNavigationLocked(hasUnsettledBets());
    updateBjActionButtons();
  });

  network.on('bj_dealer_reveal', (data) => {
    if (!data || data.tableId !== currentBjTableId) return;
    const rawScore = (data.dealerScore !== undefined) ? data.dealerScore : data.score;
    const score = (rawScore && typeof rawScore === 'object' && typeof rawScore.value === 'number')
      ? rawScore.value
      : (typeof rawScore === 'number' ? rawScore : (ui.computeCardsScore ? ui.computeCardsScore(data.dealerHand) : 0));
    if (currentBjTableState) {
      currentBjTableState.dealerHand = data.dealerHand;
      currentBjTableState.dealerScore = score;
    }
    ui.renderBlackjackDealer(data.dealerHand || [], score, 'DEALER_TURN');
  });

  network.on('bj_dealer_draw', (data) => {
    if (!data || data.tableId !== currentBjTableId) return;
    const rawScore = (data.dealerScore !== undefined) ? data.dealerScore : data.score;
    const score = (rawScore && typeof rawScore === 'object' && typeof rawScore.value === 'number')
      ? rawScore.value
      : (typeof rawScore === 'number' ? rawScore : (ui.computeCardsScore ? ui.computeCardsScore(data.dealerHand) : 0));
    if (currentBjTableState) {
      currentBjTableState.dealerHand = data.dealerHand;
      currentBjTableState.dealerScore = score;
    }
    ui.renderBlackjackDealer(data.dealerHand || [], score, 'DEALER_TURN');
  });

  network.on('bj_shoe_reshuffle', (data) => {
    if (!data || data.tableId !== currentBjTableId) return;
    ui.showToast('Kaartschoen geschud (Monte Carlo 6-Deck)', 'info');
    if (data.shoe) {
      ui.updateShoePenetration(data.shoe.remainingCards, data.shoe.totalCards);
    }
  });

  network.on('bj_round_result', (data) => {
    if (!data || data.tableId !== currentBjTableId) return;
    const rawScore = (data.dealerScore !== undefined) ? data.dealerScore : data.score;
    const score = (rawScore && typeof rawScore === 'object' && typeof rawScore.value === 'number')
      ? rawScore.value
      : (typeof rawScore === 'number' ? rawScore : (ui.computeCardsScore ? ui.computeCardsScore(data.dealerHand) : 0));
    if (currentBjTableState) {
      currentBjTableState.phase = 'ROUND_OVER';
      currentBjTableState.dealerScore = score;
    }
    if (data.dealerHand) {
      ui.renderBlackjackDealer(data.dealerHand, score, 'ROUND_OVER');
    }

    // Inspect outcome for my seat
    const resultsList = data.results || data.seatResults;
    if (myBjSeatIndex !== -1 && Array.isArray(resultsList)) {
      const myRes = resultsList.find(r => r.seatIndex === myBjSeatIndex || r.playerId === ui.myPlayer.id);
      if (myRes) {
        if (typeof myRes.chips === 'number') {
          ui.myPlayer.chips = myRes.chips;
          ui.updatePlayerHUD();
        }
        const payoutVal = (typeof myRes.payout === 'number')
          ? myRes.payout
          : (typeof myRes.totalWon === 'number' ? myRes.totalWon : 0);
        const outcome = myRes.outcome || (myRes.hands && myRes.hands[0] && (myRes.hands[0].outcome || myRes.hands[0].result)) || (myRes.net > 0 ? 'WIN' : 'LOSE');

        if (outcome === 'BLACKJACK') {
          ui.showBlackjackBanner('BLACKJACK!', `Uitbetaling: +${payoutVal.toLocaleString()} fiches`, '3:2 Monte Carlo Royale');
          ui.triggerWinShimmer(2500);
        } else if (outcome === 'WIN') {
          ui.showBlackjackBanner('GEWONNEN!', `Uitbetaling: +${payoutVal.toLocaleString()} fiches`, 'Hand wint van de bank');
          ui.triggerWinShimmer(2000);
        } else if (outcome === 'PUSH') {
          ui.showBlackjackBanner('STAND-OFF', `Inzet terug: ${payoutVal.toLocaleString()} fiches`, 'Gelijkspel met de bank');
        } else if (outcome === 'BUST') {
          ui.showBlackjackBanner('BUST', 'Boven 21 punten', 'Inzet verloren');
        } else {
          ui.showBlackjackBanner('VERLOREN', 'Bank wint ronde');
        }
      }
    }

    ui.setNavigationLocked(false);
    updateBjActionButtons();
  });

  network.on('bj_round_end', (data) => {
    if (!data || data.tableId !== currentBjTableId) return;
    if (currentBjTableState) {
      currentBjTableState.phase = 'ROUND_OVER';
      if (Array.isArray(currentBjTableState.seats)) {
        currentBjTableState.seats.forEach((s) => {
          if (s) s.bet = 0;
        });
      }
    }
    ui.setNavigationLocked(hasUnsettledBets());
    updateBjActionButtons();
  });

  network.on('navigation_blocked', (data) => {
    const fallbackGame = (data && (data.game || data.currentGame)) || confirmedServerGame;
    if (fallbackGame && String(fallbackGame).toLowerCase() !== String(currentActiveGame || '').toLowerCase()) {
      activateGameView(fallbackGame, { syncPresence: false, joinPrimaryTables: false, announce: false });
    }
    ui.setNavigationLocked(true);
    const msg = (data && data.message) || 'Inzet actief — Navigatie vergrendeld tot einde van de ronde';
    ui.showToast(msg, 'error');
  });

  network.on('game_switched', (data) => {
    if (data && data.game) {
      if (String(data.game).toLowerCase() === 'lobby') {
        deactivateInactiveViews('lobby');
        return;
      }
      confirmedServerGame = data.game;
      activateGameView(data.game, { syncPresence: false, joinPrimaryTables: false, joinAuxiliary: true, announce: false });
      ui.setNavigationLocked(hasUnsettledBets());
    }
  });

  network.on('chips_update', (data) => {
    if (data && typeof data.chips === 'number') {
      if (data.wheelDelayed && bank && bank.isWheelSpinning) {
        return;
      }
      if (data.aviaDelayed && avia && (avia.isFlightAnimating || avia.isFlightPending)) {
        avia.pendingFinalChips = data.chips;
        return;
      }
      ui.myPlayer.chips = data.chips;
      ui.updatePlayerHUD();
      if (bank) bank.updateBankData(bank.currentBankData);
      if (lottery) lottery.renderBuyPreview();
    }
  });

  network.on('chat_message', (msg) => {
    ui.addChatMessage(msg);
  });

  // Bank & Deals Network Events
  network.on('bank_update', (data) => {
    if (bank) bank.updateBankData(data);
  });

  network.on('bank_wheel_result', (data) => {
    if (bank && typeof bank.handleWheelResult === 'function') {
      bank.handleWheelResult(data);
    }
  });

  network.on('bank_error', (data) => {
    const msg = data ? (data.message || 'Bankfout opgetreden') : 'Bankfout opgetreden';
    ui.showToast(msg, 'error');
  });

  network.on('bank_success', (data) => {
    const msg = data ? (data.message || 'Transactie geslaagd') : 'Transactie geslaagd';
    ui.showToast(msg, 'success');
  });

  network.on('bank_notification', (data) => {
    if (data && data.message) {
      ui.showToast(`${data.title || 'Bank'}: ${data.message}`, 'info');
    }
  });

  network.on('bank_bailout_claimed', (data) => {
    ui.showToast('100 noodfiches bijgeschreven op je saldo!', 'success');
  });

  network.on('player_joined', (data) => {
    // Optionally display small toast
  });

  network.on('player_left', (data) => {
    // Optionally display small toast
  });
});
