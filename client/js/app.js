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

  // 3. Keep track of local active bets for "Double Bets" functionality
  let currentActiveBets = [];

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
    onSendChat: (text) => {
      network.sendChat(text);
    }
  });

  // 5. Connect Socket Network
  network.connect();

  // 6. Hook Socket Network Events to UI & 3D Wheel

  network.on('connection_change', ({ connected }) => {
    if (connected) {
      ui.showToast('Connected to casino table', 'info');
    } else {
      ui.showToast('Connection lost. Reconnecting...', 'error');
    }
  });

  network.on('table_state', (state) => {
    if (!state) return;

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
        ui.updatePlayerHUD();
      }
    }

    // Set phase and countdown
    ui.updatePhase(state.currentPhase, state.phaseDuration || 20, state.timeLeft || 0);

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
    if (state.activeBets && typeof state.activeBets === 'object') {
      Object.entries(state.activeBets).forEach(([pid, bets]) => {
        if (Array.isArray(bets)) {
          // Find player color
          const player = (state.players || []).find(p => p.id === pid);
          const color = player ? player.color : '#D4AF37';

          bets.forEach(b => {
            const spotKey = computeSpotKey(b.type, b.value);
            ui.addChipToSpot(spotKey, color, b.amount);
            if (pid === ui.myPlayer.id) {
              currentActiveBets.push(b);
            }
          });
        }
      });
    }

    // If joining mid-spin, catch up 3D wheel
    if (state.currentPhase === 'SPINNING' && roulette3D && state.winningNumber !== undefined) {
      const elapsed = Math.max(0, (state.phaseDuration || 9) - (state.timeLeft || 0));
      roulette3D.startSpin(state.winningNumber, state.phaseDuration || 9, elapsed);
    }
  });

  network.on('phase_tick', (data) => {
    if (!data) return;
    ui.updateTimer(data.timeLeft);
  });

  network.on('phase_change', (data) => {
    if (!data) return;
    ui.updatePhase(data.phase, data.duration, data.timeLeft);

    if (data.phase === 'SPINNING') {
      if (roulette3D && typeof data.winningNumber === 'number') {
        roulette3D.startSpin(data.winningNumber, data.duration || 9.0);
      }
    } else if (data.phase === 'BETTING') {
      // Clear table chips for next round
      ui.clearAllChips();
      currentActiveBets = [];
    }
  });

  network.on('round_result', (data) => {
    if (!data) return;

    // Find my personal result
    let myResult = null;
    if (Array.isArray(data.results)) {
      myResult = data.results.find(r => r.playerId === ui.myPlayer.id);
      if (myResult) {
        ui.myPlayer.chips = myResult.chips;
        ui.updatePlayerHUD();
      }
    }

    // Update history strip
    if (Array.isArray(data.history)) {
      ui.updateHistoryStrip(data.history);
    }

    // Show victory banner
    ui.showRoundResult(data.winningNumber, data.winningColor, myResult);
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
  });

  network.on('bet_rejected', (data) => {
    const reason = data ? (data.reason || data.code) : 'Bet was rejected';
    ui.showToast(reason, 'error');
  });

  network.on('bet_placed', (data) => {
    if (!data || !data.bet) return;
    const spotKey = computeSpotKey(data.bet.type, data.bet.value);
    ui.addChipToSpot(spotKey, data.playerColor || '#D4AF37', data.bet.amount);
  });

  network.on('bets_cleared', (data) => {
    if (!data) return;
    ui.clearPlayerChips(data.playerId);
    if (data.playerId === ui.myPlayer.id) {
      currentActiveBets = [];
      ui.showToast('All your bets have been refunded', 'info');
    }
  });

  network.on('chips_update', (data) => {
    if (data && typeof data.chips === 'number') {
      ui.myPlayer.chips = data.chips;
      ui.updatePlayerHUD();
    }
  });

  network.on('chat_message', (msg) => {
    ui.addChatMessage(msg);
  });

  network.on('player_joined', (data) => {
    // Optionally display small toast
  });

  network.on('player_left', (data) => {
    // Optionally display small toast
  });
});
