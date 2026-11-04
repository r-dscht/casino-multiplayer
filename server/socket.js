/**
 * socket.js
 * Real-time Socket.io communication protocol.
 * Integrates PlayerManager and RouletteEngine with full HTML entity sanitization.
 * Zero GTA branding and zero audio code.
 */

const { Server } = require('socket.io');
const PlayerManager = require('./game/playerManager');
const RouletteEngine = require('./game/rouletteEngine');

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
  const engine = new RouletteEngine(playerManager);

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

      // Broadcast join event to everyone else
      socket.broadcast.emit('player_joined', {
        player: {
          id: player.id,
          name: player.name,
          avatar: player.avatar,
          color: player.color,
          chips: player.chips
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

    // 5. disconnect
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

  return { io, playerManager, engine, broadcastChatMessage };
}

module.exports = {
  setupSocket,
  sanitizeHtml
};
