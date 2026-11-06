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
const BlackjackEngine = require('./game/blackjackEngine');

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
 * Central Navigation Validator Contract.
 * Blocks table exit or room switching while unresolved bets are active on Roulette or Blackjack.
 * @param {string} playerId 
 * @param {Object} [rouletteEngine] 
 * @param {Object} [blackjackEngine] 
 * @returns {{ allowed: boolean, code?: string, game?: string, amount?: number, message?: string }}
 */
function canPlayerNavigate(playerId, rouletteEngine, blackjackEngine) {
  if (rouletteEngine && typeof rouletteEngine.hasActiveBets === 'function' && rouletteEngine.hasActiveBets(playerId)) {
    return {
      allowed: false,
      code: 'CANNOT_LEAVE_ACTIVE_BETS',
      game: 'Roulette',
      amount: typeof rouletteEngine.getActiveBetTotal === 'function' ? rouletteEngine.getActiveBetTotal(playerId) : 0,
      message: 'Active bets present on Roulette table.'
    };
  }
  if (blackjackEngine && typeof blackjackEngine.hasActiveBets === 'function' && blackjackEngine.hasActiveBets(playerId)) {
    return {
      allowed: false,
      code: 'CANNOT_LEAVE_ACTIVE_BETS',
      game: 'Blackjack',
      amount: typeof blackjackEngine.getActiveBetTotal === 'function' ? blackjackEngine.getActiveBetTotal(playerId) : 0,
      message: 'Active bets present on Blackjack table.'
    };
  }
  return { allowed: true };
}

/**
 * Initializes Socket.io with the HTTP server.
 * @param {import('http').Server} httpServer 
 * @param {Object} [options]
 * @returns {{ io: Server, playerManager: PlayerManager, engine: RouletteEngine, blackjackEngine: BlackjackEngine }}
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

  /** @type {Map<string, BlackjackEngine>} Multi-table registry */
  const blackjackTables = new Map();
  const defaultBjEngine = new BlackjackEngine(playerManager, {
    tableId: 'table_1',
    tableName: 'Monte Carlo Royale 1',
    maxSeats: 6,
    bankManager
  });
  blackjackTables.set('table_1', defaultBjEngine);

  const highRollerBjEngine = new BlackjackEngine(playerManager, {
    tableId: 'table_2',
    tableName: 'Monte Carlo High Roller 2',
    maxSeats: 6,
    bankManager
  });
  blackjackTables.set('table_2', highRollerBjEngine);

  if (options && options.autoStartBlackjack === true) {
    for (const tbl of blackjackTables.values()) {
      tbl.start();
    }
  }

  function getTable(tableId) {
    if (tableId && blackjackTables.has(tableId)) {
      return blackjackTables.get(tableId);
    }
    return defaultBjEngine;
  }

  function checkNavigation(playerId) {
    if (engine && typeof engine.hasActiveBets === 'function' && engine.hasActiveBets(playerId)) {
      return {
        allowed: false,
        code: 'CANNOT_LEAVE_ACTIVE_BETS',
        game: 'Roulette',
        amount: typeof engine.getActiveBetTotal === 'function' ? engine.getActiveBetTotal(playerId) : 0,
        message: 'Active bets present on Roulette table.'
      };
    }
    for (const tbl of blackjackTables.values()) {
      if (typeof tbl.hasActiveBets === 'function' && tbl.hasActiveBets(playerId)) {
        return {
          allowed: false,
          code: 'CANNOT_LEAVE_ACTIVE_BETS',
          game: 'Blackjack',
          amount: typeof tbl.getActiveBetTotal === 'function' ? tbl.getActiveBetTotal(playerId) : 0,
          message: 'Active bets present on Blackjack table.'
        };
      }
    }
    return { allowed: true };
  }

  /** @type {Array<Object>} In-memory chat buffer (max 50) */
  const chatHistory = [];

  function broadcastChatMessage(msg) {
    if (!msg.scope) msg.scope = 'global';
    if (!msg.table) msg.table = 'all';
    chatHistory.push(msg);
    if (chatHistory.length > 50) chatHistory.shift();
    io.emit('chat_message', msg);
  }

  function broadcastPlayersUpdate() {
    const list = playerManager.getConnectedPlayers().sort((a, b) => b.chips - a.chips);
    io.emit('players_update', list);
  }

  // Hook blackjack tables events
  function hookBlackjackEvents(tbl) {
    tbl.on('phase_tick', (data) => {
      io.emit('bj_phase_tick', data);
    });
    tbl.on('phase_change', (data) => {
      io.emit('bj_phase_change', data);
      if (data && data.phase === 'BETTING') {
        broadcastPlayersUpdate();
      }
    });
    tbl.on('turn_tick', (data) => {
      io.emit('bj_turn_tick', data);
    });
    tbl.on('turn_change', (data) => {
      io.emit('bj_turn_change', data);
    });
    tbl.on('seat_taken', (data) => {
      io.emit('bj_seat_taken', data);
      broadcastPlayersUpdate();
    });
    tbl.on('seat_left', (data) => {
      io.emit('bj_seat_left', data);
      broadcastPlayersUpdate();
    });
    tbl.on('bet_placed', (data) => {
      io.emit('bj_bet_placed', data);
      broadcastPlayersUpdate();
    });
    tbl.on('bet_cleared', (data) => {
      io.emit('bj_bet_cleared', data);
      broadcastPlayersUpdate();
    });
    tbl.on('action_applied', (data) => {
      io.emit('bj_action_applied', data);
      io.emit('bj_action_executed', data);
    });
    tbl.on('dealer_reveal', (data) => {
      io.emit('bj_dealer_reveal', data);
    });
    tbl.on('dealer_draw', (data) => {
      io.emit('bj_dealer_draw', data);
    });
    tbl.on('shoe_reshuffle', (data) => {
      io.emit('bj_shoe_reshuffle', data);
    });
    tbl.on('round_result', (data) => {
      io.emit('bj_round_result', data);
      io.emit('bj_round_end', data);
      broadcastPlayersUpdate();

      const tableLabel = (tbl.tableId === 'table_2') ? 'Blackjack VIP Tafel 2' : 'Blackjack Tafel 1';

      // 1. Announce Dealer Bust if applicable
      if (data && data.dealerScore && data.dealerScore.isBust) {
        broadcastChatMessage({
          sender: 'CASINO',
          color: '#d4af37',
          text: `[DEALER] Dealer is bust met ${data.dealerScore.value}! Alle actieve spelers winnen.`,
          timestamp: Date.now(),
          isSystem: true,
          scope: 'table',
          table: tbl.tableId
        });
      }

      // 2. Announce round results & wins for each player
      if (Array.isArray(data.results)) {
        data.results.forEach((r) => {
          const hasBJ = Array.isArray(r.hands) && r.hands.some(h => h.outcome === 'BLACKJACK' || h.result === 'BLACKJACK');
          if (hasBJ) {
            // Table Chat announcement
            broadcastChatMessage({
              sender: 'CASINO',
              color: '#d4af37',
              text: `[BLACKJACK] ${r.playerName} heeft Natural Blackjack en wint ${r.totalWon.toLocaleString()} fiches (3:2)!`,
              timestamp: Date.now(),
              isSystem: true,
              scope: 'table',
              table: tbl.tableId
            });
            // Global Casino Chat announcement
            broadcastChatMessage({
              sender: 'CASINO',
              color: '#d4af37',
              text: `[BLACKJACK] ${r.playerName} heeft Natural Blackjack aan ${tableLabel} (+${Math.max(0, r.net || r.totalWon).toLocaleString()} fiches)!`,
              timestamp: Date.now(),
              isSystem: true,
              scope: 'global',
              table: 'all'
            });
          } else if (r.net > 0) {
            // Table Chat announcement
            broadcastChatMessage({
              sender: 'CASINO',
              color: '#d4af37',
              text: `[CASINO] ${r.playerName} verslaat de dealer en wint ${r.totalWon.toLocaleString()} fiches (Netto: +${r.net.toLocaleString()})!`,
              timestamp: Date.now(),
              isSystem: true,
              scope: 'table',
              table: tbl.tableId
            });
            // If significant win, announce to Global Casino Chat
            if (r.net >= 1000) {
              broadcastChatMessage({
                sender: 'CASINO',
                color: '#d4af37',
                text: `[GRAND WIN] ${r.playerName} wint ${r.net.toLocaleString()} fiches aan ${tableLabel}!`,
                timestamp: Date.now(),
                isSystem: true,
                scope: 'global',
                table: 'all'
              });
            }
          } else if (r.totalWon > 0 && r.net === 0) {
            // Push announcement in Table Chat
            broadcastChatMessage({
              sender: 'CASINO',
              color: '#d4af37',
              text: `[CASINO] ${r.playerName} speelt gelijk met de dealer — inzet geretourneerd.`,
              timestamp: Date.now(),
              isSystem: true,
              scope: 'table',
              table: tbl.tableId
            });
          }

          if (Array.isArray(r.repayments) && r.repayments.length > 0) {
            r.repayments.forEach((rep) => {
              broadcastChatMessage({
                sender: 'BANK',
                color: '#10b981',
                text: `[BANK] ${r.playerName} heeft ${rep.amount.toLocaleString()} fiches afgelost aan ${rep.lenderName} via winstinhouding.${rep.isFullyRepaid ? ' (Schuld volledig voldaan!)' : ''}`,
                timestamp: Date.now(),
                isSystem: true,
                scope: 'table',
                table: tbl.tableId
              });
              const lender = playerManager.getPlayerById(rep.lenderId);
              if (lender && lender.socketId) {
                io.to(lender.socketId).emit('chips_update', { chips: lender.chips });
                io.to(lender.socketId).emit('bank_update', bankManager.getPlayerBankData(lender.id));
              }
              const borrower = playerManager.getPlayerById(r.playerId);
              if (borrower && borrower.socketId) {
                io.to(borrower.socketId).emit('chips_update', { chips: borrower.chips });
                io.to(borrower.socketId).emit('bank_update', bankManager.getPlayerBankData(borrower.id));
              }
            });
          }
        });
      }
    });
  }

  for (const tbl of blackjackTables.values()) {
    hookBlackjackEvents(tbl);
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
    
    // Find winners
    const winners = Array.isArray(data.results) ? data.results.filter(r => r.totalWon > 0) : [];
    let details = '';
    let topWinner = null;
    if (winners.length > 0) {
      topWinner = winners.sort((a, b) => b.totalWon - a.totalWon)[0];
      details = ` — ${topWinner.playerName} won ${topWinner.totalWon.toLocaleString()} chips!`;
    }

    // 1. Announce to Roulette Table Chat
    broadcastChatMessage({
      sender: 'CASINO',
      color: '#d4af37', // Gold
      text: `[CASINO] Round result: ${data.winningNumber} ${colorCap}${details ? details : ' — Geen winnaars deze ronde.'}`,
      timestamp: Date.now(),
      isSystem: true,
      scope: 'table',
      table: 'roulette'
    });

    // 2. If there are winners, broadcast to Global Casino Chat
    if (topWinner && topWinner.totalWon > 0) {
      const isGrand = topWinner.totalWon >= 1000;
      broadcastChatMessage({
        sender: 'CASINO',
        color: '#d4af37',
        text: isGrand
          ? `[GRAND WIN] ${topWinner.playerName} wint ${topWinner.totalWon.toLocaleString()} fiches op Roulette (${data.winningNumber} ${colorCap})!`
          : `[CASINO] ${topWinner.playerName} wint ${topWinner.totalWon.toLocaleString()} fiches op Roulette (${data.winningNumber} ${colorCap})!`,
        timestamp: Date.now(),
        isSystem: true,
        scope: 'global',
        table: 'all'
      });
    }

    // Check if any win repayments occurred on active debts
    if (Array.isArray(data.results)) {
      data.results.forEach((r) => {
        if (Array.isArray(r.repayments) && r.repayments.length > 0) {
          r.repayments.forEach((rep) => {
            broadcastChatMessage({
              sender: 'BANK',
              color: '#10b981',
              text: `[BANK] ${r.playerName} heeft ${rep.amount.toLocaleString()} fiches afgelost aan ${rep.lenderName} via winstinhouding.${rep.isFullyRepaid ? ' (Schuld volledig voldaan!)' : ''}`,
              timestamp: Date.now(),
              isSystem: true,
              scope: 'table',
              table: 'roulette'
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

    // 0. auth_session
    socket.on('auth_session', (payload = {}) => {
      const opts = (payload && typeof payload === 'object') ? payload : {};
      const authResult = playerManager.authSession(socket.id, opts);
      if (authResult.error) {
        socket.emit('auth_error', {
          code: authResult.error,
          message: authResult.message
        });
        return;
      }

      const { player, sessionToken, isNew } = authResult;
      currentSocketPlayerId = player.id;

      // Send auth_success with bearer session token & player profile
      socket.emit('auth_success', {
        sessionToken,
        isNew: !!isNew,
        player: {
          id: player.id,
          name: player.name,
          avatar: player.avatar,
          color: player.color,
          chips: player.chips,
          currentGame: player.currentGame || 'Roulette',
          location: player.location || 'ROULETTE',
          seatIndex: player.seatIndex !== undefined ? player.seatIndex : null,
          stats: player.stats || { roundsPlayed: 0, totalWon: 0, biggestWin: 0 }
        }
      });

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
          currentGame: player.currentGame || 'Roulette',
          location: player.location || 'ROULETTE',
          seatIndex: player.seatIndex !== undefined ? player.seatIndex : null
        }
      });

      // Broadcast presence_update to all clients
      io.emit('presence_update', {
        playerId: player.id,
        location: player.location || 'ROULETTE',
        currentGame: player.currentGame || 'Roulette',
        seatIndex: player.seatIndex !== undefined ? player.seatIndex : null,
        player: {
          id: player.id,
          name: player.name,
          color: player.color,
          avatar: player.avatar,
          chips: player.chips,
          location: player.location || 'ROULETTE',
          seatIndex: player.seatIndex !== undefined ? player.seatIndex : null
        }
      });
      broadcastPlayersUpdate();

      // Announce in chat
      broadcastChatMessage({
        sender: 'CASINO',
        color: '#d4af37',
        text: isNew ? `${player.name} joined the table.` : `${player.name} reconnected.`,
        timestamp: Date.now(),
        isSystem: true
      });
    });

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

      // Emit auth_success so client network can retain bearer sessionToken
      socket.emit('auth_success', {
        sessionToken: player.sessionToken,
        isNew: true,
        player: {
          id: player.id,
          name: player.name,
          avatar: player.avatar,
          color: player.color,
          chips: player.chips,
          currentGame: player.currentGame || 'Roulette',
          location: player.location || 'ROULETTE',
          seatIndex: player.seatIndex !== undefined ? player.seatIndex : null,
          stats: player.stats || { roundsPlayed: 0, totalWon: 0, biggestWin: 0 }
        }
      });

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
          currentGame: player.currentGame || 'Roulette',
          location: player.location || 'ROULETTE',
          seatIndex: player.seatIndex !== undefined ? player.seatIndex : null
        }
      });

      // Broadcast presence_update to all clients
      io.emit('presence_update', {
        playerId: player.id,
        location: player.location || 'ROULETTE',
        currentGame: player.currentGame || 'Roulette',
        seatIndex: player.seatIndex !== undefined ? player.seatIndex : null,
        player: {
          id: player.id,
          name: player.name,
          color: player.color,
          avatar: player.avatar,
          chips: player.chips,
          location: player.location || 'ROULETTE',
          seatIndex: player.seatIndex !== undefined ? player.seatIndex : null
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

      const scope = (payload && payload.scope === 'table') ? 'table' : 'global';
      let table = 'roulette';
      if (payload && typeof payload.table === 'string' && payload.table.trim()) {
        table = payload.table.trim();
      } else if (player.currentGame === 'Blackjack') {
        table = (player.location && player.location.startsWith('table_')) ? player.location : 'table_1';
      }

      broadcastChatMessage({
        sender: sanitizeHtml(player.name),
        color: player.color,
        text: sanitized,
        timestamp: Date.now(),
        isSystem: false,
        scope,
        table
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
        text: `[BANK] ${player.name} heeft ${res.transaction.amount.toLocaleString()} fiches geschonken aan ${res.toPlayer.name}.`,
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
          text: `[BANK] Deal gesloten: ${res.lender.name} verstrekt ${res.loan.amount.toLocaleString()} fiches aan ${res.borrower.name} (${res.loan.interestPct}% rente, ${res.loan.winDeductionPct}% winstinhouding).`,
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
        text: `[CASINO] ${player.name} ontving 100 noodfiches van het casinofonds.`,
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

      const navCheck = checkNavigation(player.id);
      if (!navCheck.allowed) {
        socket.emit('navigation_blocked', {
          code: navCheck.code,
          reason: navCheck.message,
          game: navCheck.game,
          amount: navCheck.amount,
          activeBetsTotal: navCheck.amount
        });
        return;
      }

      const game = payload.game || payload.location || 'Roulette';
      const seatIndex = payload.seatIndex !== undefined ? payload.seatIndex : null;
      playerManager.setPlayerPresence(player.id, game, seatIndex);

      socket.emit('game_switched', {
        game: player.currentGame,
        location: player.location,
        seatIndex: player.seatIndex
      });

      io.emit('presence_update', {
        playerId: player.id,
        location: player.location,
        currentGame: player.currentGame,
        seatIndex: player.seatIndex,
        player: {
          id: player.id,
          name: player.name,
          color: player.color,
          chips: player.chips,
          location: player.location,
          seatIndex: player.seatIndex
        }
      });
      broadcastPlayersUpdate();
    });

    socket.on('player_set_location', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) return;

      const navCheck = checkNavigation(player.id);
      if (!navCheck.allowed) {
        socket.emit('navigation_blocked', {
          code: navCheck.code,
          reason: navCheck.message,
          game: navCheck.game,
          amount: navCheck.amount,
          activeBetsTotal: navCheck.amount
        });
        return;
      }

      const location = payload.location || payload.game || 'ROULETTE';
      const seatIndex = payload.seatIndex !== undefined ? payload.seatIndex : null;
      playerManager.setPlayerPresence(player.id, location, seatIndex);

      socket.emit('game_switched', {
        game: player.currentGame,
        location: player.location,
        seatIndex: player.seatIndex
      });

      io.emit('presence_update', {
        playerId: player.id,
        location: player.location,
        currentGame: player.currentGame,
        seatIndex: player.seatIndex,
        player: {
          id: player.id,
          name: player.name,
          color: player.color,
          chips: player.chips,
          location: player.location,
          seatIndex: player.seatIndex
        }
      });
      broadcastPlayersUpdate();
    });

    socket.on('leave_table', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) return;

      const navCheck = checkNavigation(player.id);
      if (!navCheck.allowed) {
        socket.emit('navigation_blocked', {
          code: navCheck.code,
          reason: navCheck.message,
          game: navCheck.game,
          amount: navCheck.amount,
          activeBetsTotal: navCheck.amount
        });
        return;
      }

      playerManager.setPlayerPresence(player.id, 'LOBBY', null);
      socket.emit('game_switched', {
        game: 'Lobby',
        location: 'LOBBY',
        seatIndex: null
      });

      io.emit('presence_update', {
        playerId: player.id,
        location: 'LOBBY',
        currentGame: 'Lobby',
        seatIndex: null,
        player: {
          id: player.id,
          name: player.name,
          color: player.color,
          chips: player.chips,
          location: 'LOBBY',
          seatIndex: null
        }
      });
      broadcastPlayersUpdate();
    });

    // 7. Multiplayer Blackjack Socket Protocol (6 Seats & Multi-Table)

    socket.on('bj_join_table', (payload = {}) => {
      const table = getTable(payload && payload.tableId);
      const player = playerManager.getPlayerBySocket(socket.id);
      const state = table.getTableState(player ? player.id : null);
      socket.emit('bj_table_state', state);
    });

    socket.on('bj_take_seat', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) {
        socket.emit('bj_seat_error', { code: 'PLAYER_NOT_FOUND', reason: 'Must be authenticated before taking a seat' });
        return;
      }
      let tableId = (payload && payload.tableId) || 'table_1';
      let seatIndex = -1;
      if (payload && typeof payload.seatIndex === 'number') {
        seatIndex = payload.seatIndex;
      } else if (payload && typeof payload.seat === 'number') {
        seatIndex = payload.seat;
      } else if (payload && typeof payload.seatIndex === 'string') {
        if (payload.seatIndex.startsWith('table_')) {
          tableId = payload.seatIndex;
          seatIndex = typeof payload.tableId === 'number' ? payload.tableId : parseInt(payload.tableId, 10);
        } else if (!isNaN(parseInt(payload.seatIndex, 10))) {
          seatIndex = parseInt(payload.seatIndex, 10);
        }
      } else if (payload && typeof payload.seat === 'string' && !isNaN(parseInt(payload.seat, 10))) {
        seatIndex = parseInt(payload.seat, 10);
      }
      const table = getTable(tableId);
      const res = table.takeSeat(seatIndex, player.id);
      if (!res.success) {
        socket.emit('bj_seat_error', res);
        return;
      }
      socket.emit('bj_seat_accepted', {
        tableId: table.tableId,
        seatIndex,
        seat: res.seat,
        player: res.seat.player
      });
      broadcastPlayersUpdate();
    });

    socket.on('bj_leave_seat', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) return;

      const navCheck = checkNavigation(player.id);
      if (!navCheck.allowed) {
        socket.emit('navigation_blocked', {
          code: navCheck.code,
          reason: navCheck.message,
          game: navCheck.game,
          amount: navCheck.amount,
          activeBetsTotal: navCheck.amount
        });
        socket.emit('bj_seat_error', { code: navCheck.code, reason: navCheck.message });
        return;
      }

      const table = getTable(payload && payload.tableId);
      const seatIndex = (payload && typeof payload.seatIndex === 'number') ? payload.seatIndex : player.seatIndex;
      const res = table.leaveSeat(seatIndex, player.id);
      if (!res.success) {
        socket.emit('bj_seat_error', res);
        return;
      }
      socket.emit('bj_seat_vacated', { tableId: table.tableId, seatIndex });
      broadcastPlayersUpdate();
    });

    socket.on('bj_place_bet', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) {
        socket.emit('bj_bet_rejected', { code: 'PLAYER_NOT_FOUND', reason: 'Player profile not found' });
        return;
      }
      const table = getTable(payload && payload.tableId);
      const seatIndex = (payload && typeof payload.seatIndex === 'number') ? payload.seatIndex : player.seatIndex;
      const amount = payload ? payload.amount : 0;
      const res = table.placeBet(seatIndex, player.id, amount);
      if (!res.success) {
        socket.emit('bj_bet_rejected', res);
        return;
      }
      socket.emit('bj_bet_accepted', {
        tableId: table.tableId,
        seatIndex,
        amount,
        totalBet: res.totalBet,
        chipsRemaining: res.chips,
        remainingChips: res.chips,
        playerChips: res.chips
      });
      broadcastPlayersUpdate();
    });

    socket.on('bj_clear_bet', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) return;
      const table = getTable(payload && payload.tableId);
      const seatIndex = (payload && typeof payload.seatIndex === 'number') ? payload.seatIndex : player.seatIndex;
      const res = table.clearBet(seatIndex, player.id);
      if (!res.success) {
        socket.emit('bj_bet_rejected', res);
        return;
      }
      socket.emit('chips_update', { chips: res.chips });
      broadcastPlayersUpdate();
    });

    socket.on('bj_action', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) {
        socket.emit('bj_action_rejected', { code: 'PLAYER_NOT_FOUND', reason: 'Player profile not found' });
        return;
      }
      const table = getTable(payload && payload.tableId);
      const seatIndex = (payload && typeof payload.seatIndex === 'number') ? payload.seatIndex : -1;
      const handIndex = (payload && typeof payload.handIndex === 'number') ? payload.handIndex : 0;
      const action = payload ? payload.action : '';
      const res = table.handleAction(seatIndex, handIndex, player.id, action);
      if (!res.success) {
        socket.emit('bj_action_rejected', res);
        return;
      }
      socket.emit('bj_action_success', { action, hand: res.hand });
      broadcastPlayersUpdate();
    });

    // 8. disconnect
    socket.on('disconnect', () => {
      const player = playerManager.disconnectPlayer(socket.id);
      if (player) {
        io.emit('player_left', {
          id: player.id,
          name: player.name
        });
        io.emit('presence_update', {
          playerId: player.id,
          connected: false,
          location: player.location || 'ROULETTE',
          currentGame: player.currentGame || 'Roulette',
          seatIndex: player.seatIndex !== undefined ? player.seatIndex : null
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

  return {
    io,
    playerManager,
    bankManager,
    engine,
    rouletteEngine: engine,
    blackjackEngine: defaultBjEngine,
    blackjackTables,
    canPlayerNavigate: checkNavigation,
    broadcastChatMessage,
    stop: () => {
      engine.stop();
      for (const tbl of blackjackTables.values()) {
        tbl.stop();
      }
    }
  };
}

module.exports = {
  setupSocket,
  sanitizeHtml,
  canPlayerNavigate
};
