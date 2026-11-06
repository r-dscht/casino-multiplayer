/**
 * socket.js
 * Real-time Socket.io communication protocol.
 * Integrates PlayerManager and RouletteEngine with full HTML entity sanitization.
 * Zero GTA branding and zero audio code.
 */

const { Server } = require('socket.io');
const PlayerManager = require('./game/playerManager');
const RouletteEngine = require('./game/rouletteEngine');
const BankManager = require('./game/bankManager');

/**
 * Escapes HTML characters to prevent XSS.
 * @param {string} str 
 * @returns {string}
 */
function sanitizeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Initializes Socket.io with the HTTP server.
 * @param {import('http').Server} httpServer 
 * @param {Object} [options]
 * @returns {{ io: Server, playerManager: PlayerManager, engine: RouletteEngine }}
 */
function setupSocket(httpServer, options = {}) {
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    },
    ...options
  });

  const playerManager = new PlayerManager();
  const bankManager = new BankManager(playerManager);
  const engine = new RouletteEngine(playerManager, { bankManager });

  /** @type {Array<Object>} In-memory chat buffer (max 50) */
  const chatHistory = [];

  function broadcastChatMessage(msg) {
    chatHistory.push(msg);
    if (chatHistory.length > 50) chatHistory.shift();
    io.emit('chat_message', msg);
  }

  function broadcastPlayersUpdate() {
    const list = playerManager.getConnectedPlayers().sort((a, b) => b.chips - a.chips);
    io.emit('players_update', list);
  }

  // Hook engine events to socket broadcasts
  engine.on('tick', (data) => {
    io.emit('phase_tick', data);
  });

  engine.on('phase_change', (data) => {
    io.emit('phase_change', data);
    if (data && data.phase === 'BETTING') {
      broadcastPlayersUpdate();
    }
  });

  engine.on('round_result', (data) => {
    io.emit('round_result', data);
    broadcastPlayersUpdate();

    // Announce result in system chat
    const colorCap = data.winningColor
      ? data.winningColor.charAt(0).toUpperCase() + data.winningColor.slice(1)
      : '';
    const winAnnouncement = `Round result: ${data.winningNumber} ${colorCap}`;
    
    // Find winners
    const winners = data.results.filter(r => r.totalWon > 0);
    let details = '';
    if (winners.length > 0) {
      const topWinner = winners.sort((a, b) => b.totalWon - a.totalWon)[0];
      details = ` — ${topWinner.playerName} won ${topWinner.totalWon.toLocaleString()} chips!`;
    }

    broadcastChatMessage({
      sender: 'CASINO',
      color: '#d4af37', // Gold
      text: winAnnouncement + details,
      timestamp: Date.now(),
      isSystem: true
    });

    // Check if any win repayments occurred on active debts
    if (Array.isArray(data.results)) {
      data.results.forEach((r) => {
        if (Array.isArray(r.repayments) && r.repayments.length > 0) {
          r.repayments.forEach((rep) => {
            broadcastChatMessage({
              sender: 'BANK',
              color: '#10b981',
              text: `${r.playerName} heeft ${rep.amount.toLocaleString()} fiches afgelost aan ${rep.lenderName} via winstinhouding.${rep.isFullyRepaid ? ' (Schuld volledig voldaan!)' : ''}`,
              timestamp: Date.now(),
              isSystem: true
            });

            // Update lender socket
            const lender = playerManager.getPlayerById(rep.lenderId);
            if (lender && lender.socketId) {
              io.to(lender.socketId).emit('chips_update', { chips: lender.chips });
              io.to(lender.socketId).emit('bank_update', bankManager.getPlayerBankData(lender.id));
            }
          });

          // Update borrower socket
          const borrower = playerManager.getPlayerById(r.playerId);
          if (borrower && borrower.socketId) {
            io.to(borrower.socketId).emit('chips_update', { chips: borrower.chips });
            io.to(borrower.socketId).emit('bank_update', bankManager.getPlayerBankData(borrower.id));
          }
        }
      });
    }
  });

  // Client connection handler
  io.on('connection', (socket) => {
    let currentSocketPlayerId = null;

    // 1. join_table
    socket.on('join_table', (payload = {}) => {
      const opts = (payload && typeof payload === 'object') ? payload : {};
      const result = playerManager.registerPlayer(socket.id, opts);
      if (result && result.error) {
        socket.emit('login_error', {
          code: result.error,
          message: result.message
        });
        return;
      }
      const player = result;
      currentSocketPlayerId = player.id;

      // Send initial table state to joining player
      const tableState = engine.getTableState(player.id);
      socket.emit('table_state', {
        ...tableState,
        chatHistory: [...chatHistory]
      });

      // Send initial banking & debt state to player
      socket.emit('bank_update', bankManager.getPlayerBankData(player.id));

      // Send initial player profile to client
      socket.emit('profile_data', playerManager.getPlayerProfile(player.id));

      // Broadcast join event to everyone else
      socket.broadcast.emit('player_joined', {
        player: {
          id: player.id,
          name: player.name,
          avatar: player.avatar,
          color: player.color,
          chips: player.chips,
          currentGame: player.currentGame || 'Roulette'
        }
      });
      broadcastPlayersUpdate();

      // Announce in chat
      broadcastChatMessage({
        sender: 'CASINO',
        color: '#d4af37',
        text: `${player.name} joined the table.`,
        timestamp: Date.now(),
        isSystem: true
      });
    });

    // 2. place_bet
    socket.on('place_bet', (betPayload = {}) => {
      if (!betPayload || typeof betPayload !== 'object') {
        socket.emit('bet_rejected', {
          code: 'INVALID_PAYLOAD',
          reason: 'Invalid bet payload'
        });
        return;
      }

      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) {
        socket.emit('bet_rejected', {
          code: 'PLAYER_NOT_FOUND',
          reason: 'Please join the table before placing bets'
        });
        return;
      }

      const result = engine.placeBet(player.id, betPayload);
      if (!result.success) {
        socket.emit('bet_rejected', {
          code: result.code,
          reason: result.reason
        });
        return;
      }

      // Bet accepted: notify player
      socket.emit('bet_accepted', {
        betId: result.bet.id,
        bet: result.bet,
        playerChips: result.remainingChips,
        remainingChips: result.remainingChips,
        tableChipsTotal: result.tableChipsTotal
      });

      // Broadcast to table so all players see chip stacks
      io.emit('bet_placed', {
        playerId: player.id,
        playerName: player.name,
        playerColor: player.color,
        bet: result.bet,
        tableChipsTotal: result.tableChipsTotal
      });
      broadcastPlayersUpdate();
    });

    // 3. clear_bets
    socket.on('clear_bets', () => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) return;

      const result = engine.clearBets(player.id);
      if (!result.success) {
        socket.emit('bet_rejected', {
          code: result.code,
          reason: result.reason
        });
        return;
      }

      // Notify player of new balance
      socket.emit('chips_update', {
        chips: result.chips
      });

      // Broadcast clear event to room
      io.emit('bets_cleared', {
        playerId: player.id,
        tableChipsTotal: result.tableChipsTotal
      });
      broadcastPlayersUpdate();
    });

    // 4. chat_message
    socket.on('chat_message', (payload = {}) => {
      if (!payload || typeof payload !== 'object') return;

      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) return;

      const rawText = typeof payload.text === 'string' ? payload.text.trim() : '';
      if (!rawText) return;

      // Handle admin / testing commands
      if (rawText === '/spin') {
        const forced = engine.forceSpin();
        if (forced) {
          socket.emit('chat_message', {
            sender: 'CASINO',
            color: '#d4af37',
            text: 'Spin manually triggered.',
            timestamp: Date.now(),
            isSystem: true
          });
        }
        return;
      }

      if (rawText.startsWith('/chips')) {
        const parts = rawText.split(' ');
        const amount = parseInt(parts[1], 10);
        if (Number.isInteger(amount) && amount > 0) {
          playerManager.addChips(player.id, amount);
          socket.emit('chips_update', { chips: player.chips });
          broadcastPlayersUpdate();
          socket.emit('chat_message', {
            sender: 'CASINO',
            color: '#d4af37',
            text: `Added ${amount.toLocaleString()} chips to your balance.`,
            timestamp: Date.now(),
            isSystem: true
          });
        }
        return;
      }

      // Standard chat message: sanitize HTML and cap length
      const capped = rawText.slice(0, 150);
      const sanitized = sanitizeHtml(capped);

      broadcastChatMessage({
        sender: sanitizeHtml(player.name),
        color: player.color,
        text: sanitized,
        timestamp: Date.now(),
        isSystem: false
      });
    });

    // 5. Casino Banking & Loans Protocol

    socket.on('bank_get_state', () => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) return;
      socket.emit('bank_update', bankManager.getPlayerBankData(player.id));
    });

    socket.on('bank_transfer', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) return;
      const { toPlayerId, amount } = payload;
      const res = bankManager.directTransfer(player.id, toPlayerId, amount);
      if (!res.success) {
        socket.emit('bank_error', { message: res.reason });
        return;
      }

      socket.emit('chips_update', { chips: res.fromChips });
      socket.emit('bank_update', bankManager.getPlayerBankData(player.id));
      socket.emit('bank_success', { message: `${res.transaction.amount.toLocaleString()} fiches overgemaakt naar ${res.toPlayer.name}.` });

      if (res.toPlayer && res.toPlayer.socketId) {
        io.to(res.toPlayer.socketId).emit('chips_update', { chips: res.toChips });
        io.to(res.toPlayer.socketId).emit('bank_update', bankManager.getPlayerBankData(res.toPlayer.id));
        io.to(res.toPlayer.socketId).emit('bank_notification', {
          title: 'Fiches Ontvangen',
          message: `${player.name} heeft ${res.transaction.amount.toLocaleString()} fiches naar je overgemaakt.`
        });
      }

      broadcastPlayersUpdate();
      broadcastChatMessage({
        sender: 'BANK',
        color: '#10b981',
        text: `${player.name} heeft ${res.transaction.amount.toLocaleString()} fiches geschonken aan ${res.toPlayer.name}.`,
        timestamp: Date.now(),
        isSystem: true
      });
    });

    socket.on('bank_loan_propose', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) return;
      const { toPlayerId, type, amount, interestPct, winDeductionPct } = payload;
      const res = bankManager.createLoanProposal({
        fromId: player.id,
        toId: toPlayerId,
        type: type || 'borrow',
        amount,
        interestPct,
        winDeductionPct
      });
      if (!res.success) {
        socket.emit('bank_error', { message: res.reason });
        return;
      }

      socket.emit('bank_update', bankManager.getPlayerBankData(player.id));
      socket.emit('bank_success', { message: 'Leningvoorstel succesvol verzonden.' });

      const targetPlayer = playerManager.getPlayerById(toPlayerId);
      if (targetPlayer && targetPlayer.socketId) {
        io.to(targetPlayer.socketId).emit('bank_update', bankManager.getPlayerBankData(targetPlayer.id));
        const actionText = res.proposal.type === 'borrow' ? 'wil fiches lenen' : 'biedt een lening aan';
        io.to(targetPlayer.socketId).emit('bank_notification', {
          title: 'Nieuw Leningvoorstel',
          message: `${player.name} ${actionText} (${res.proposal.amount.toLocaleString()} fiches). Bekijk de Bank inbox.`
        });
      }
    });

    socket.on('bank_loan_respond', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) return;
      const { proposalId, action } = payload;

      if (action === 'accept') {
        const res = bankManager.acceptProposal(proposalId, player.id);
        if (!res.success) {
          socket.emit('bank_error', { message: res.reason });
          return;
        }

        // Update lender
        if (res.lender.socketId) {
          io.to(res.lender.socketId).emit('chips_update', { chips: res.lender.chips });
          io.to(res.lender.socketId).emit('bank_update', bankManager.getPlayerBankData(res.lender.id));
        }
        // Update borrower
        if (res.borrower.socketId) {
          io.to(res.borrower.socketId).emit('chips_update', { chips: res.borrower.chips });
          io.to(res.borrower.socketId).emit('bank_update', bankManager.getPlayerBankData(res.borrower.id));
        }

        broadcastPlayersUpdate();
        broadcastChatMessage({
          sender: 'BANK',
          color: '#10b981',
          text: `Deal gesloten: ${res.lender.name} verstrekt ${res.loan.amount.toLocaleString()} fiches aan ${res.borrower.name} (${res.loan.interestPct}% rente, ${res.loan.winDeductionPct}% winstinhouding).`,
          timestamp: Date.now(),
          isSystem: true
        });
      } else {
        const res = bankManager.declineProposal(proposalId, player.id);
        if (!res.success) {
          socket.emit('bank_error', { message: res.reason });
          return;
        }
        socket.emit('bank_update', bankManager.getPlayerBankData(player.id));
        if (res.proposal) {
          const otherId = res.proposal.fromId === player.id ? res.proposal.toId : res.proposal.fromId;
          const otherPlayer = playerManager.getPlayerById(otherId);
          if (otherPlayer && otherPlayer.socketId) {
            io.to(otherPlayer.socketId).emit('bank_update', bankManager.getPlayerBankData(otherPlayer.id));
          }
        }
        socket.emit('bank_success', { message: 'Voorstel afgewezen.' });
      }
    });

    socket.on('bank_repay_debt', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) return;
      const { loanId, amount } = payload;
      const res = bankManager.repayLoan(loanId, player.id, amount);
      if (!res.success) {
        socket.emit('bank_error', { message: res.reason });
        return;
      }

      socket.emit('chips_update', { chips: player.chips });
      socket.emit('bank_update', bankManager.getPlayerBankData(player.id));
      socket.emit('bank_success', {
        message: `${res.amountRepaid.toLocaleString()} fiches afgelost.${res.isFullyRepaid ? ' Lening is volledig afbetaald!' : ''}`
      });

      const lender = playerManager.getPlayerById(res.loan.lenderId);
      if (lender && lender.socketId) {
        io.to(lender.socketId).emit('chips_update', { chips: lender.chips });
        io.to(lender.socketId).emit('bank_update', bankManager.getPlayerBankData(lender.id));
        io.to(lender.socketId).emit('bank_notification', {
          title: 'Aflossing Ontvangen',
          message: `${player.name} heeft ${res.amountRepaid.toLocaleString()} fiches handmatig afgelost.`
        });
      }

      broadcastPlayersUpdate();
    });

    socket.on('bank_forgive_loan', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) return;
      const { loanId } = payload;
      const res = bankManager.forgiveLoan(loanId, player.id);
      if (!res.success) {
        socket.emit('bank_error', { message: res.reason });
        return;
      }
      socket.emit('bank_update', bankManager.getPlayerBankData(player.id));
      socket.emit('bank_success', { message: 'Lening kwijtgescholden.' });

      const borrower = playerManager.getPlayerById(res.loan.borrowerId);
      if (borrower && borrower.socketId) {
        io.to(borrower.socketId).emit('bank_update', bankManager.getPlayerBankData(borrower.id));
        io.to(borrower.socketId).emit('bank_notification', {
          title: 'Schuld Kwijtgescholden',
          message: `${player.name} heeft je openstaande schuld kwijtgescholden.`
        });
      }
    });

    socket.on('bank_claim_bailout', () => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) return;
      const res = bankManager.claimEmergencyBailout(player.id);
      if (!res.success) {
        socket.emit('bank_error', { message: res.reason });
        return;
      }

      socket.emit('chips_update', { chips: res.chips });
      socket.emit('bank_update', bankManager.getPlayerBankData(player.id));
      socket.emit('bank_bailout_claimed', { chips: res.chips, amount: res.amount });
      broadcastPlayersUpdate();

      broadcastChatMessage({
        sender: 'CASINO',
        color: '#d4af37',
        text: `${player.name} ontving 100 noodfiches van het casinofonds.`,
        timestamp: Date.now(),
        isSystem: true
      });
    });

    // 6. Player Profile & Presence Protocol

    socket.on('profile_get', (payload = {}) => {
      const targetId = payload.playerId || currentSocketPlayerId;
      if (!targetId) return;
      const profile = playerManager.getPlayerProfile(targetId);
      if (profile) {
        socket.emit('profile_data', profile);
      }
    });

    socket.on('profile_update', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) return;
      const color = payload.color || (payload.customization && payload.customization.color);
      const avatar = payload.avatar || (payload.customization && payload.customization.avatar);
      const updated = playerManager.updatePlayerCustomization(player.id, { color, avatar });
      if (updated) {
        const fullProfile = playerManager.getPlayerProfile(player.id);
        socket.emit('profile_updated', fullProfile);
        socket.emit('profile_data', fullProfile);
        broadcastPlayersUpdate();
      }
    });

    socket.on('player_set_game', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) return;
      const game = payload.game || 'Roulette';
      playerManager.setPlayerGame(player.id, game);
      broadcastPlayersUpdate();
    });

    // 7. disconnect
    socket.on('disconnect', () => {
      const player = playerManager.disconnectPlayer(socket.id);
      if (player) {
        io.emit('player_left', {
          id: player.id,
          name: player.name
        });
        broadcastPlayersUpdate();

        broadcastChatMessage({
          sender: 'CASINO',
          color: '#d4af37',
          text: `${player.name} left the table.`,
          timestamp: Date.now(),
          isSystem: true
        });
      }
    });
  });

  return { io, playerManager, bankManager, engine, broadcastChatMessage };
}

module.exports = {
  setupSocket,
  sanitizeHtml
};
