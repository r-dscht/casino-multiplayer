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
  let currentBjTableId = 'table_1';
  let currentBjTableState = null;
  let myBjSeatIndex = -1;
  let selectedBjChip = 100;
  let lastRoulettePhase = 'BETTING';
  let lastRouletteDuration = 20;
  let lastRouletteTimeLeft = 20;

  function hasUnsettledBets() {
    if (currentActiveBets.length > 0) return true;
    if (myBjSeatIndex !== -1 && currentBjTableState) {
      const mySeat = currentBjTableState.seats && currentBjTableState.seats[myBjSeatIndex];
      if (mySeat && mySeat.bet > 0 && ['DEALING', 'PLAYER_TURNS', 'DEALER_TURN'].includes(currentBjTableState.phase)) {
        return true;
      }
    }
    return false;
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
        ui.showToast('No active bets to double', 'info');
        return;
      }
      const totalRequired = currentActiveBets.reduce((sum, b) => sum + b.amount, 0);
      if (ui.myPlayer.chips < totalRequired) {
        ui.showToast('Insufficient chips to double bets', 'error');
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
      ui.showToast(`Doubled ${currentActiveBets.length} bets!`, 'info');
    },
    onSendChat: (text, scope = 'global') => {
      network.sendChat(text, scope, currentActiveGame === 'Blackjack' ? currentBjTableId : 'roulette');
    },
    onInspectPlayer: (playerId) => {
      network.getProfile(playerId);
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
    ui.showLoginError(data ? data.message : 'Authenticatie mislukt');
  });

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

    // Populate existing chat history
    if (Array.isArray(state.chatHistory)) {
      state.chatHistory.forEach(msg => ui.addChatMessage(msg));
    }

    // Render active bets across all players
    currentActiveBets = [];
    tableLiveBets = [];
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
            if (pid === ui.myPlayer.id) {
              currentActiveBets.push(b);
            }
          });
        }
      });
    }

    ui.updateActiveBetsList(tableLiveBets, state.tableChipsTotal || 0);

    // Populate initial leaderboard & bank players
    if (Array.isArray(state.players)) {
      ui.updateLeaderboard(state.players);
      if (bank) bank.updateConnectedPlayers(state.players);
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

    // Show victory banner
    ui.showRoundResult(data.winningNumber, data.winningColor, myResult);
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
      ui.showToast('All your bets have been refunded', 'info');
    }
  });

  network.on('players_update', (players) => {
    if (Array.isArray(players)) {
      ui.updateLeaderboard(players);
      if (bank) bank.updateConnectedPlayers(players);
      const me = players.find(p => p.id === ui.myPlayer.id);
      if (me) {
        ui.myPlayer.chips = me.chips;
        if (me.currentGame) ui.myPlayer.currentGame = me.currentGame;
        if (me.stats) ui.myPlayer.stats = me.stats;
        if (me.createdAt) ui.myPlayer.createdAt = me.createdAt;
        ui.updatePlayerHUD();
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
      ui.updatePlayerHUD();
      ui.renderMyProfile(profile);
      ui.showToast('Profielkleur bijgewerkt!', 'success');
    }
  });

  // Game Presence & Table View switcher pills
  document.querySelectorAll('.game-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const game = btn.dataset.game;
      if (hasUnsettledBets()) {
        ui.showToast('Inzet actief — Navigatie vergrendeld tot einde van de ronde', 'error');
        return;
      }
      if (game === 'roulette') {
        currentActiveGame = 'Roulette';
        ui.switchGameView('roulette');
        network.setGamePresence('Roulette');
        ui.switchChatScope('table');
        ui.updatePhase(lastRoulettePhase, lastRouletteDuration, lastRouletteTimeLeft);
        ui.showToast('Je speelt nu Roulette', 'info');
      } else if (game === 'blackjack') {
        currentActiveGame = 'Blackjack';
        ui.switchGameView('blackjack', currentBjTableId);
        network.setGamePresence('Blackjack');
        network.bjJoinTable(currentBjTableId);
        ui.switchChatScope('table');
        if (currentBjTableState) {
          ui.updatePhase(currentBjTableState.phase, 15, currentBjTableState.timeLeft || 0);
          ui.renderBlackjackDealer(currentBjTableState.dealerHand || [], currentBjTableState.dealerScore || 0, currentBjTableState.phase);
          ui.renderBlackjackSeats(currentBjTableState.seats || [], currentBjTableState.activeSeatIndex, myBjSeatIndex, currentBjTableState.phase);
        } else {
          ui.updatePhase('WAITING_FOR_PLAYERS', 15, 0);
        }
        ui.showToast('Je speelt nu Blackjack', 'info');
      } else {
        ui.showToast(`${btn.textContent.trim()} is binnenkort beschikbaar!`, 'info');
      }
    });
  });

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

  // Blackjack Chip Selection
  const bjChipBtns = document.querySelectorAll('#blackjack-view .chip-btn');
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

      // Betting spot
      const spot = e.target.closest('.betting-spot');
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

  // Blackjack Action Buttons
  if (ui.elements.btnBjHit) {
    ui.elements.btnBjHit.addEventListener('click', () => {
      if (myBjSeatIndex !== -1) {
        const mySeat = currentBjTableState && currentBjTableState.seats ? currentBjTableState.seats[myBjSeatIndex] : null;
        const handIndex = mySeat ? (mySeat.activeHandIndex || 0) : 0;
        network.bjAction('hit', myBjSeatIndex, handIndex, currentBjTableId);
      }
    });
  }
  if (ui.elements.btnBjStand) {
    ui.elements.btnBjStand.addEventListener('click', () => {
      if (myBjSeatIndex !== -1) {
        const mySeat = currentBjTableState && currentBjTableState.seats ? currentBjTableState.seats[myBjSeatIndex] : null;
        const handIndex = mySeat ? (mySeat.activeHandIndex || 0) : 0;
        network.bjAction('stand', myBjSeatIndex, handIndex, currentBjTableId);
      }
    });
  }
  if (ui.elements.btnBjDouble) {
    ui.elements.btnBjDouble.addEventListener('click', () => {
      if (myBjSeatIndex !== -1) {
        const mySeat = currentBjTableState && currentBjTableState.seats ? currentBjTableState.seats[myBjSeatIndex] : null;
        const handIndex = mySeat ? (mySeat.activeHandIndex || 0) : 0;
        network.bjAction('double', myBjSeatIndex, handIndex, currentBjTableId);
      }
    });
  }
  if (ui.elements.btnBjSplit) {
    ui.elements.btnBjSplit.addEventListener('click', () => {
      if (myBjSeatIndex !== -1) {
        const mySeat = currentBjTableState && currentBjTableState.seats ? currentBjTableState.seats[myBjSeatIndex] : null;
        const handIndex = mySeat ? (mySeat.activeHandIndex || 0) : 0;
        network.bjAction('split', myBjSeatIndex, handIndex, currentBjTableId);
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
      const activeHandIdx = mySeat.activeHandIndex || 0;
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
    const hasBet = mySeat && (mySeat.bet > 0 || (mySeat.hands && mySeat.hands[0] && mySeat.hands[0].bet > 0));
    const canClearBet = (currentBjTableState.phase === 'BETTING' && hasBet);
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
    if (typeof data.chipsRemaining === 'number') {
      ui.myPlayer.chips = data.chipsRemaining;
      ui.updatePlayerHUD();
    }
    if (currentBjTableState && Array.isArray(currentBjTableState.seats) && data.seatIndex !== undefined) {
      if (!currentBjTableState.seats[data.seatIndex]) {
        currentBjTableState.seats[data.seatIndex] = { bet: data.amount };
      } else {
        currentBjTableState.seats[data.seatIndex].bet = data.amount;
      }
      ui.renderBlackjackSeats(currentBjTableState.seats, currentBjTableState.activeSeatIndex, myBjSeatIndex, currentBjTableState.phase);
    }
    ui.setNavigationLocked(hasUnsettledBets());
    updateBjActionButtons();
  });

  network.on('bj_bet_placed', (data) => {
    if (!data || data.tableId !== currentBjTableId) return;
    if (currentBjTableState && Array.isArray(currentBjTableState.seats) && data.seatIndex !== undefined) {
      if (currentBjTableState.seats[data.seatIndex]) {
        currentBjTableState.seats[data.seatIndex].bet = data.amount;
      }
      ui.renderBlackjackSeats(currentBjTableState.seats, currentBjTableState.activeSeatIndex, myBjSeatIndex, currentBjTableState.phase);
    }
  });

  network.on('bj_bet_cleared', (data) => {
    if (typeof data.chipsRemaining === 'number') {
      ui.myPlayer.chips = data.chipsRemaining;
      ui.updatePlayerHUD();
    }
    if (currentBjTableState && Array.isArray(currentBjTableState.seats) && data.seatIndex !== undefined) {
      if (currentBjTableState.seats[data.seatIndex]) {
        currentBjTableState.seats[data.seatIndex].bet = 0;
      }
      ui.renderBlackjackSeats(currentBjTableState.seats, currentBjTableState.activeSeatIndex, myBjSeatIndex, currentBjTableState.phase);
    }
    ui.showToast('Inzet gewist', 'info');
    ui.setNavigationLocked(hasUnsettledBets());
    updateBjActionButtons();
  });

  network.on('bj_bet_rejected', (data) => {
    ui.showToast((data && data.message) || 'Inzet geweigerd', 'error');
  });

  network.on('bj_action_applied', (data) => {
    if (!data || data.tableId !== currentBjTableId) return;
    if (currentBjTableState && Array.isArray(currentBjTableState.seats) && data.seatIndex !== undefined) {
      const seat = currentBjTableState.seats[data.seatIndex];
      if (seat && data.card) {
        if (!seat.cards) seat.cards = [];
        seat.cards.push(data.card);
        if (seat.hands && seat.hands[0]) {
          if (!seat.hands[0].cards) seat.hands[0].cards = [];
          seat.hands[0].cards.push(data.card);
        }
      }
      ui.renderBlackjackSeats(currentBjTableState.seats, currentBjTableState.activeSeatIndex, myBjSeatIndex, currentBjTableState.phase);
    }
    updateBjActionButtons();
  });

  network.on('bj_action_executed', (data) => {
    if (!data || data.tableId !== currentBjTableId) return;
    updateBjActionButtons();
  });

  network.on('bj_action_rejected', (data) => {
    ui.showToast((data && data.message) || 'Actie niet toegestaan', 'error');
  });

  network.on('bj_turn_change', (data) => {
    if (!data || data.tableId !== currentBjTableId) return;
    if (currentBjTableState) {
      currentBjTableState.activeSeatIndex = data.seatIndex;
      if (data.seats) currentBjTableState.seats = data.seats;
      if (data.dealerHand) currentBjTableState.dealerHand = data.dealerHand;
      if (data.dealerScore !== undefined) currentBjTableState.dealerScore = data.dealerScore;
      ui.renderBlackjackSeats(currentBjTableState.seats, data.seatIndex, myBjSeatIndex, currentBjTableState.phase);
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
    if (currentBjTableState) {
      currentBjTableState.phase = data.phase;
      currentBjTableState.activeSeatIndex = data.activeSeatIndex !== undefined ? data.activeSeatIndex : currentBjTableState.activeSeatIndex;
      if (data.seats) currentBjTableState.seats = data.seats;
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
    const score = (data.dealerScore !== undefined) ? data.dealerScore : (ui.computeCardsScore ? ui.computeCardsScore(data.dealerHand) : 0);
    if (currentBjTableState) {
      currentBjTableState.dealerHand = data.dealerHand;
      currentBjTableState.dealerScore = score;
    }
    ui.renderBlackjackDealer(data.dealerHand || [], score, 'DEALER_TURN');
  });

  network.on('bj_dealer_draw', (data) => {
    if (!data || data.tableId !== currentBjTableId) return;
    const score = (data.dealerScore !== undefined) ? data.dealerScore : (ui.computeCardsScore ? ui.computeCardsScore(data.dealerHand) : 0);
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
    const score = (data.dealerScore !== undefined) ? data.dealerScore : (ui.computeCardsScore ? ui.computeCardsScore(data.dealerHand) : 0);
    if (currentBjTableState) {
      currentBjTableState.phase = 'ROUND_OVER';
      currentBjTableState.dealerScore = score;
    }
    if (data.dealerHand) {
      ui.renderBlackjackDealer(data.dealerHand, score, 'ROUND_OVER');
    }

    // Inspect outcome for my seat
    if (myBjSeatIndex !== -1 && Array.isArray(data.results)) {
      const myRes = data.results.find(r => r.seatIndex === myBjSeatIndex || r.playerId === ui.myPlayer.id);
      if (myRes) {
        if (typeof myRes.chips === 'number') {
          ui.myPlayer.chips = myRes.chips;
          ui.updatePlayerHUD();
        }
        if (myRes.outcome === 'BLACKJACK') {
          ui.showBlackjackBanner('BLACKJACK!', `Winst: +${myRes.payout || 0} fiches`, '3:2 Monte Carlo Royale');
          ui.triggerWinShimmer(2500);
        } else if (myRes.outcome === 'WIN') {
          ui.showBlackjackBanner('GEWONNEN!', `Winst: +${myRes.payout || 0} fiches`, 'Hand wint van de bank');
          ui.triggerWinShimmer(2000);
        } else if (myRes.outcome === 'PUSH') {
          ui.showBlackjackBanner('STAND-OFF', 'Inzet geretourneerd', 'Gelijkspel met de bank');
        } else if (myRes.outcome === 'BUST') {
          ui.showBlackjackBanner('BUST', 'Boven 21 punten', 'Inzet verloren');
        } else if (myRes.outcome === 'LOSE') {
          ui.showBlackjackBanner('VERLOREN', 'Bank wint ronde');
        }
      }
    }

    ui.setNavigationLocked(false);
    updateBjActionButtons();
  });

  network.on('bj_round_end', (data) => {
    if (!data || data.tableId !== currentBjTableId) return;
    ui.setNavigationLocked(false);
    updateBjActionButtons();
  });

  network.on('navigation_blocked', (data) => {
    ui.setNavigationLocked(true);
    const msg = (data && data.message) || 'Inzet actief — Navigatie vergrendeld tot einde van de ronde';
    ui.showToast(msg, 'error');
  });

  network.on('game_switched', (data) => {
    if (data && data.game) {
      if (data.game === 'Blackjack') {
        currentActiveGame = 'Blackjack';
        ui.switchGameView('blackjack', currentBjTableId);
        ui.switchChatScope('table');
        if (currentBjTableState) {
          ui.updatePhase(currentBjTableState.phase, 15, currentBjTableState.timeLeft || 0);
          ui.renderBlackjackDealer(currentBjTableState.dealerHand || [], currentBjTableState.dealerScore || 0, currentBjTableState.phase);
          ui.renderBlackjackSeats(currentBjTableState.seats || [], currentBjTableState.activeSeatIndex, myBjSeatIndex, currentBjTableState.phase);
        } else {
          ui.updatePhase('WAITING_FOR_PLAYERS', 15, 0);
        }
      } else if (data.game === 'Roulette') {
        currentActiveGame = 'Roulette';
        ui.switchGameView('roulette');
        ui.switchChatScope('table');
        ui.updatePhase(lastRoulettePhase, lastRouletteDuration, lastRouletteTimeLeft);
      }
    }
  });

  network.on('chips_update', (data) => {
    if (data && typeof data.chips === 'number') {
      ui.myPlayer.chips = data.chips;
      ui.updatePlayerHUD();
      if (bank) bank.updateBankData(bank.currentBankData);
    }
  });

  network.on('chat_message', (msg) => {
    ui.addChatMessage(msg);
  });

  // Bank & Deals Network Events
  network.on('bank_update', (data) => {
    if (bank) bank.updateBankData(data);
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
