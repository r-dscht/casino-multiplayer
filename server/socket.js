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
const PokerEngine = require('./game/pokerEngine');
const CrashEngine = require('./game/crashEngine');

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
 * Blocks table exit or room switching while unresolved bets are active on Roulette, Blackjack, or Poker.
 * @param {string} playerId 
 * @param {Object} [rouletteEngine] 
 * @param {Object} [blackjackEngine] 
 * @param {Object} [pokerEngine=null] 
 * @returns {{ allowed: boolean, code?: string, game?: string, amount?: number, reason?: string, message?: string }}
 */
function canPlayerNavigate(playerId, rouletteEngine, blackjackEngine, pokerEngine = null, crashEngine = null) {
  if (rouletteEngine && typeof rouletteEngine.hasActiveBets === 'function' && rouletteEngine.hasActiveBets(playerId)) {
    return {
      allowed: false,
      code: 'CANNOT_LEAVE_ACTIVE_BETS',
      game: 'Roulette',
      amount: typeof rouletteEngine.getActiveBetTotal === 'function' ? rouletteEngine.getActiveBetTotal(playerId) : 0,
      reason: 'Active bets present on Roulette table.',
      message: 'Active bets present on Roulette table.'
    };
  }
  if (blackjackEngine) {
    if (typeof blackjackEngine.hasActiveBets === 'function' && blackjackEngine.hasActiveBets(playerId)) {
      return {
        allowed: false,
        code: 'CANNOT_LEAVE_ACTIVE_BETS',
        game: 'Blackjack',
        amount: typeof blackjackEngine.getActiveBetTotal === 'function' ? blackjackEngine.getActiveBetTotal(playerId) : 0,
        reason: 'Active bets present on Blackjack table.',
        message: 'Active bets present on Blackjack table.'
      };
    }
    if (blackjackEngine instanceof Map || (typeof blackjackEngine.values === 'function' && typeof blackjackEngine.hasActiveBets !== 'function')) {
      for (const tbl of blackjackEngine.values()) {
        if (typeof tbl.hasActiveBets === 'function' && tbl.hasActiveBets(playerId)) {
          return {
            allowed: false,
            code: 'CANNOT_LEAVE_ACTIVE_BETS',
            game: 'Blackjack',
            amount: typeof tbl.getActiveBetTotal === 'function' ? tbl.getActiveBetTotal(playerId) : 0,
            reason: 'Active bets present on Blackjack table.',
            message: 'Active bets present on Blackjack table.'
          };
        }
      }
    }
  }
  if (pokerEngine) {
    if (typeof pokerEngine.hasActiveBets === 'function' && pokerEngine.hasActiveBets(playerId)) {
      return {
        allowed: false,
        code: 'CANNOT_LEAVE_ACTIVE_BETS',
        game: 'Poker',
        amount: typeof pokerEngine.getActiveBetTotal === 'function' ? pokerEngine.getActiveBetTotal(playerId) : 0,
        reason: 'Je hebt een actieve pokerhand. Speel de hand uit voordat je de tafel verlaat.',
        message: 'Active hand in progress on Poker table.'
      };
    }
    if (pokerEngine instanceof Map || (typeof pokerEngine.values === 'function' && typeof pokerEngine.hasActiveBets !== 'function')) {
      for (const tbl of pokerEngine.values()) {
        if (typeof tbl.hasActiveBets === 'function' && tbl.hasActiveBets(playerId)) {
          return {
            allowed: false,
            code: 'CANNOT_LEAVE_ACTIVE_BETS',
            game: 'Poker',
            amount: typeof tbl.getActiveBetTotal === 'function' ? tbl.getActiveBetTotal(playerId) : 0,
            reason: 'Je hebt een actieve pokerhand. Speel de hand uit voordat je de tafel verlaat.',
            message: 'Active hand in progress on Poker table.'
          };
        }
      }
    }
  }
  if (crashEngine && typeof crashEngine.hasActiveBets === 'function' && crashEngine.hasActiveBets(playerId)) {
    return {
      allowed: false,
      code: 'CANNOT_LEAVE_ACTIVE_BETS',
      game: 'Crash',
      amount: typeof crashEngine.getActiveBetTotal === 'function' ? crashEngine.getActiveBetTotal(playerId) : 0,
      reason: 'Je hebt een actieve inzet op Crash. Cash eerst uit of wacht tot de ronde eindigt.',
      message: 'Active bet present on Crash.'
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

  /** @type {Map<string, PokerEngine>} Multi-table registry for Texas Hold'em */
  const pokerTables = new Map();
  const defaultPokerEngine = new PokerEngine(playerManager, {
    tableId: 'poker_1',
    tableName: 'Monte Carlo Texas Hold\'em 1',
    smallBlind: 50,
    bigBlind: 100,
    minBuyIn: 2000,
    defaultBuyIn: 2000,
    maxBuyIn: 10000,
    autoStart: true
  });
  pokerTables.set('poker_1', defaultPokerEngine);

  const highRollerPokerEngine = new PokerEngine(playerManager, {
    tableId: 'poker_2',
    tableName: 'Monte Carlo High-Roller Poker 2',
    smallBlind: 100,
    bigBlind: 200,
    minBuyIn: 4000,
    defaultBuyIn: 10000,
    maxBuyIn: 20000,
    autoStart: true
  });
  pokerTables.set('poker_2', highRollerPokerEngine);

  if (options && options.autoStartPoker === true) {
    for (const tbl of pokerTables.values()) {
      tbl.start();
    }
  }

  const crashEngine = new CrashEngine(playerManager, { bankManager });
  if (options && options.autoStartCrash === true) {
    crashEngine.start();
  }

  function getPokerTable(tableId) {
    if (tableId && pokerTables.has(tableId)) {
      return pokerTables.get(tableId);
    }
    return defaultPokerEngine;
  }

  function checkNavigation(playerId) {
    if (engine && typeof engine.hasActiveBets === 'function' && engine.hasActiveBets(playerId)) {
      return {
        allowed: false,
        code: 'CANNOT_LEAVE_ACTIVE_BETS',
        game: 'Roulette',
        amount: typeof engine.getActiveBetTotal === 'function' ? engine.getActiveBetTotal(playerId) : 0,
        reason: 'Active bets present on Roulette table.',
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
          reason: 'Active bets present on Blackjack table.',
          message: 'Active bets present on Blackjack table.'
        };
      }
    }
    for (const tbl of pokerTables.values()) {
      if (typeof tbl.hasActiveBets === 'function' && tbl.hasActiveBets(playerId)) {
        return {
          allowed: false,
          code: 'CANNOT_LEAVE_ACTIVE_BETS',
          game: 'Poker',
          amount: typeof tbl.getActiveBetTotal === 'function' ? tbl.getActiveBetTotal(playerId) : 0,
          reason: 'Je hebt een actieve pokerhand. Speel de hand uit voordat je de tafel verlaat.',
          message: 'Active hand in progress on Poker table.'
        };
      }
    }
    if (crashEngine && typeof crashEngine.hasActiveBets === 'function' && crashEngine.hasActiveBets(playerId)) {
      return {
        allowed: false,
        code: 'CANNOT_LEAVE_ACTIVE_BETS',
        game: 'Crash',
        amount: typeof crashEngine.getActiveBetTotal === 'function' ? crashEngine.getActiveBetTotal(playerId) : 0,
        reason: 'Je hebt een actieve inzet op Crash. Cash eerst uit of wacht tot de ronde eindigt.',
        message: 'Active bet present on Crash.'
      };
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
      const state = tbl.getTableState();
      io.emit('bj_table_state', state);
      io.emit('bj_phase_change', {
        ...data,
        ...state
      });
      if (data && data.phase === 'BETTING') {
        broadcastPlayersUpdate();
      }
    });
    tbl.on('turn_tick', (data) => {
      io.emit('bj_turn_tick', data);
    });
    tbl.on('turn_change', (data) => {
      const state = tbl.getTableState();
      io.emit('bj_table_state', state);
      io.emit('bj_turn_change', {
        ...data,
        ...state
      });
    });
    tbl.on('seat_taken', (data) => {
      const state = tbl.getTableState();
      io.emit('bj_table_state', state);
      io.emit('bj_seat_taken', data);
      broadcastPlayersUpdate();
    });
    tbl.on('seat_left', (data) => {
      const state = tbl.getTableState();
      io.emit('bj_table_state', state);
      io.emit('bj_seat_left', data);
      broadcastPlayersUpdate();
    });
    tbl.on('seat_vacated', (data) => {
      const state = tbl.getTableState();
      io.emit('bj_table_state', state);
      io.emit('bj_seat_vacated', data);
      broadcastPlayersUpdate();
    });
    tbl.on('bet_placed', (data) => {
      const state = tbl.getTableState();
      io.emit('bj_table_state', state);
      io.emit('bj_bet_placed', data);
      broadcastPlayersUpdate();
    });
    tbl.on('bet_cleared', (data) => {
      const state = tbl.getTableState();
      io.emit('bj_table_state', state);
      io.emit('bj_bet_cleared', data);
      broadcastPlayersUpdate();
    });
    tbl.on('action_applied', (data) => {
      const state = tbl.getTableState();
      io.emit('bj_table_state', state);
      io.emit('bj_action_applied', data);
      io.emit('bj_action_executed', data);
    });
    tbl.on('dealer_reveal', (data) => {
      const state = tbl.getTableState();
      io.emit('bj_table_state', state);
      io.emit('bj_dealer_reveal', data);
    });
    tbl.on('dealer_draw', (data) => {
      const state = tbl.getTableState();
      io.emit('bj_table_state', state);
      io.emit('bj_dealer_draw', data);
    });
    tbl.on('shoe_reshuffle', (data) => {
      io.emit('bj_shoe_reshuffle', data);
    });
    tbl.on('round_result', (data) => {
      const state = tbl.getTableState();
      io.emit('bj_table_state', state);
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
            // Announce to Global Casino Chat as well so all players can celebrate
            const isGrand = r.net >= 1000;
            broadcastChatMessage({
              sender: 'CASINO',
              color: '#d4af37',
              text: isGrand
                ? `[GRAND WIN] ${r.playerName} wint ${r.net.toLocaleString()} fiches aan ${tableLabel}!`
                : `[CASINO] ${r.playerName} wint ${r.net.toLocaleString()} fiches aan ${tableLabel}!`,
              timestamp: Date.now(),
              isSystem: true,
              scope: 'global',
              table: 'all'
            });
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

  // Hook poker tables events
  function hookPokerEvents(tbl) {
    tbl.on('phase_tick', (data) => {
      io.to('table:' + tbl.tableId).emit('poker_phase_tick', data);
      io.emit('poker_phase_tick', data);
    });

    function broadcastPokerState(table) {
      const publicState = table.getTableState(null);
      io.emit('poker_table_state', publicState);

      for (const seat of table.seats) {
        if (seat.player) {
          const p = playerManager.getPlayerById(seat.player.id);
          const socketId = (p && p.socketId) || seat.player.socketId;
          if (socketId) {
            const privateState = table.getTableState(seat.player.id);
            io.to(socketId).emit('poker_table_state', privateState);
            if (seat.cards && seat.cards.length > 0) {
              io.to(socketId).emit('poker_hole_cards', {
                tableId: table.tableId,
                seatIndex: seat.seatIndex,
                cards: seat.cards,
                holeCards: seat.cards
              });
            }
          }
        }
      }
    }

    tbl.on('phase_changed', (data) => {
      const state = tbl.getTableState(null);
      broadcastPokerState(tbl);
      io.to('table:' + tbl.tableId).emit('poker_phase_change', { ...data, ...state });
      io.to('table:' + tbl.tableId).emit('poker_phase_changed', { ...data, ...state });
      io.emit('poker_phase_change', { ...data, ...state });
      io.emit('poker_phase_changed', { ...data, ...state });

      if (data && (data.phase === 'FLOP' || data.phase === 'TURN' || data.phase === 'RIVER')) {
        const commData = {
          tableId: tbl.tableId,
          street: data.phase.toLowerCase(),
          phase: data.phase,
          communityCards: tbl.communityCards,
          allCommunityCards: tbl.communityCards
        };
        io.to('table:' + tbl.tableId).emit('poker_community_cards', commData);
        io.emit('poker_community_cards', commData);
      }
    });

    tbl.on('turn_changed', (data) => {
      const state = tbl.getTableState(null);
      broadcastPokerState(tbl);
      io.to('table:' + tbl.tableId).emit('poker_turn_change', { ...data, ...state });
      io.to('table:' + tbl.tableId).emit('poker_turn_changed', { ...data, ...state });
      io.emit('poker_turn_change', { ...data, ...state });
      io.emit('poker_turn_changed', { ...data, ...state });
    });

    tbl.on('seat_taken', (data) => {
      broadcastPokerState(tbl);
      io.to('table:' + tbl.tableId).emit('poker_seat_taken', data);
      io.emit('poker_seat_taken', data);
      broadcastPlayersUpdate();
    });

    tbl.on('seat_vacated', (data) => {
      broadcastPokerState(tbl);
      io.to('table:' + tbl.tableId).emit('poker_seat_vacated', data);
      io.to('table:' + tbl.tableId).emit('poker_seat_left', data);
      io.emit('poker_seat_vacated', data);
      io.emit('poker_seat_left', data);
      broadcastPlayersUpdate();
    });

    tbl.on('hand_started', (data) => {
      const state = tbl.getTableState(null);
      broadcastPokerState(tbl);
      io.to('table:' + tbl.tableId).emit('poker_hand_start', data);
      io.to('table:' + tbl.tableId).emit('poker_hand_started', data);
      io.emit('poker_hand_start', data);
      io.emit('poker_hand_started', data);
    });

    tbl.on('player_acted', (data) => {
      const state = tbl.getTableState(null);
      broadcastPokerState(tbl);
      io.to('table:' + tbl.tableId).emit('poker_player_acted', data);
      io.to('table:' + tbl.tableId).emit('poker_player_action', data);
      io.emit('poker_player_acted', data);
      io.emit('poker_player_action', data);
    });

    tbl.on('hand_ended', (data) => {
      const state = tbl.getTableState(null);
      broadcastPokerState(tbl);
      io.to('table:' + tbl.tableId).emit('poker_hand_end', data);
      io.to('table:' + tbl.tableId).emit('poker_hand_ended', data);
      io.emit('poker_hand_end', data);
      io.emit('poker_hand_ended', data);
      broadcastPlayersUpdate();

      if (Array.isArray(data.winners) && data.winners.length > 0) {
        for (const w of data.winners) {
          const seat = tbl.seats[w.seatIndex];
          const playerName = (seat && seat.player && seat.player.name) || `Seat ${w.seatIndex}`;
          broadcastChatMessage({
            sender: 'CASINO',
            color: '#d4af37',
            text: `[POKER] ${playerName} wint ${w.amount.toLocaleString()} fiches!`,
            timestamp: Date.now(),
            isSystem: true,
            scope: 'table',
            table: tbl.tableId
          });
        }
      }
    });
  }

  for (const tbl of pokerTables.values()) {
    hookPokerEvents(tbl);
  }

  // Hook CrashEngine events to socket broadcasts
  crashEngine.on('phase_tick', (data) => {
    io.emit('crash_phase_tick', data);
  });

  crashEngine.on('tick', (data) => {
    io.emit('crash_tick', data);
  });

  crashEngine.on('phase_change', (data) => {
    io.emit('crash_phase_change', data);
    if (data && data.phase === 'BETTING') {
      broadcastPlayersUpdate();
    }
  });

  crashEngine.on('bet_placed', (data) => {
    io.emit('crash_bet_placed', data);
    broadcastPlayersUpdate();
  });

  crashEngine.on('bet_cancelled', (data) => {
    io.emit('crash_bet_cancelled', data);
    broadcastPlayersUpdate();
  });

  crashEngine.on('player_cashed_out', (data) => {
    io.emit('crash_player_cashed_out', data);
    broadcastPlayersUpdate();

    const p = playerManager.getPlayerById(data.playerId);
    if (p && p.socketId) {
      io.to(p.socketId).emit('chips_update', { chips: p.chips });
    }

    // Announce in Crash Table Chat
    broadcastChatMessage({
      sender: 'CASINO',
      color: '#d4af37',
      text: `[CRASH] ${data.playerName} casht uit op ${data.cashoutMultiplier.toFixed(2)}x en wint ${data.payout.toLocaleString()} fiches (+${data.profit.toLocaleString()} netto)!`,
      timestamp: Date.now(),
      isSystem: true,
      scope: 'table',
      table: 'crash'
    });

    // Big wins also announced to Global Casino Chat
    if (data.cashoutMultiplier >= 3.0 || data.profit >= 1000) {
      const isGrand = data.cashoutMultiplier >= 10.0 || data.profit >= 5000;
      broadcastChatMessage({
        sender: 'CASINO',
        color: '#d4af37',
        text: isGrand
          ? `[GRAND WIN] ${data.playerName} casht uit op ${data.cashoutMultiplier.toFixed(2)}x bij Crash (+${data.profit.toLocaleString()} fiches)!`
          : `[CRASH] ${data.playerName} casht uit op ${data.cashoutMultiplier.toFixed(2)}x bij Crash (+${data.profit.toLocaleString()} fiches)!`,
        timestamp: Date.now(),
        isSystem: true,
        scope: 'global',
        table: 'all'
      });
    }

    if (Array.isArray(data.repayments) && data.repayments.length > 0) {
      data.repayments.forEach((rep) => {
        broadcastChatMessage({
          sender: 'BANK',
          color: '#10b981',
          text: `[BANK] ${data.playerName} heeft ${rep.amount.toLocaleString()} fiches afgelost aan ${rep.lenderName} via winstinhouding.${rep.isFullyRepaid ? ' (Schuld volledig voldaan!)' : ''}`,
          timestamp: Date.now(),
          isSystem: true,
          scope: 'table',
          table: 'crash'
        });

        const lender = playerManager.getPlayerById(rep.lenderId);
        if (lender && lender.socketId) {
          io.to(lender.socketId).emit('chips_update', { chips: lender.chips });
          io.to(lender.socketId).emit('bank_update', bankManager.getPlayerBankData(lender.id));
        }
        const borrower = playerManager.getPlayerById(data.playerId);
        if (borrower && borrower.socketId) {
          io.to(borrower.socketId).emit('chips_update', { chips: borrower.chips });
          io.to(borrower.socketId).emit('bank_update', bankManager.getPlayerBankData(borrower.id));
        }
      });
    }
  });

  crashEngine.on('round_crashed', (data) => {
    io.emit('crash_round_crashed', data);
    broadcastPlayersUpdate();
  });

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

    function notifyLoanCounterparties(restoredPlayerId) {
      for (const connectedPlayer of playerManager.getConnectedPlayers()) {
        if (!connectedPlayer || connectedPlayer.id === restoredPlayerId || !connectedPlayer.socketId) continue;
        io.to(connectedPlayer.socketId).emit('bank_update', bankManager.getPlayerBankData(connectedPlayer.id));
      }
    }

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

      // Restore active loans & wheel cooldown BEFORE emitting bank_update so client localStorage is never overwritten by an empty restart state
      let restoredLoans = false;
      if (opts.bankBackup && typeof opts.bankBackup === 'object') {
        restoredLoans = bankManager.restoreFromBackup(player.id, opts.bankBackup) || restoredLoans;
      }
      if (opts.clientBackup && typeof opts.clientBackup === 'object') {
        restoredLoans = bankManager.restoreFromBackup(player.id, opts.clientBackup) || restoredLoans;
      }

      // Reconnect to active poker seats if player was seated
      for (const tbl of pokerTables.values()) {
        const seat = tbl.seats.find(s => s.player && s.player.id === player.id);
        if (seat && seat.player) {
          seat.player.connected = true;
          seat.player.socketId = socket.id;
          socket.join('table:' + tbl.tableId);
          socket.emit('poker_table_state', tbl.getTableState(player.id));
          if (seat.cards && seat.cards.length > 0) {
            socket.emit('poker_hole_cards', {
              tableId: tbl.tableId,
              seatIndex: seat.seatIndex,
              cards: seat.cards,
              holeCards: seat.cards
            });
          }
        }
      }

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
          lastWheelSpin: player.lastWheelSpin || 0,
          stats: player.stats || { roundsPlayed: 0, totalWon: 0, biggestWin: 0 }
        }
      });

      // Send initial table state to joining player
      const tableState = engine.getTableState(player.id);
      socket.emit('table_state', {
        ...tableState,
        chatHistory: [...chatHistory]
      });
      socket.emit('crash_table_state', crashEngine.getTableState());

      // Send initial banking & debt state to player
      socket.emit('bank_update', bankManager.getPlayerBankData(player.id));
      if (restoredLoans) {
        notifyLoanCounterparties(player.id);
      }

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

      // Restore active loans & wheel cooldown BEFORE emitting bank_update
      let restoredLoans = false;
      if (opts.bankBackup && typeof opts.bankBackup === 'object') {
        restoredLoans = bankManager.restoreFromBackup(player.id, opts.bankBackup) || restoredLoans;
      }
      if (opts.clientBackup && typeof opts.clientBackup === 'object') {
        restoredLoans = bankManager.restoreFromBackup(player.id, opts.clientBackup) || restoredLoans;
      }

      // Reconnect to active poker seats if player was seated
      for (const tbl of pokerTables.values()) {
        const seat = tbl.seats.find(s => s.player && s.player.id === player.id);
        if (seat && seat.player) {
          seat.player.connected = true;
          seat.player.socketId = socket.id;
          socket.join('table:' + tbl.tableId);
          socket.emit('poker_table_state', tbl.getTableState(player.id));
          if (seat.cards && seat.cards.length > 0) {
            socket.emit('poker_hole_cards', {
              tableId: tbl.tableId,
              seatIndex: seat.seatIndex,
              cards: seat.cards,
              holeCards: seat.cards
            });
          }
        }
      }

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
          lastWheelSpin: player.lastWheelSpin || 0,
          stats: player.stats || { roundsPlayed: 0, totalWon: 0, biggestWin: 0 }
        }
      });

      // Send initial table state to joining player
      const tableState = engine.getTableState(player.id);
      socket.emit('table_state', {
        ...tableState,
        chatHistory: [...chatHistory]
      });
      socket.emit('crash_table_state', crashEngine.getTableState());

      // Send initial banking & debt state to player
      socket.emit('bank_update', bankManager.getPlayerBankData(player.id));
      if (restoredLoans) {
        notifyLoanCounterparties(player.id);
      }

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

      const scope = (payload && payload.scope === 'table') ? 'table' : 'global';
      let table = 'roulette';
      if (payload && typeof payload.table === 'string' && payload.table.trim()) {
        table = payload.table.trim();
      } else if (player.currentGame === 'Blackjack') {
        table = (player.location && player.location.startsWith('table_')) ? player.location : 'table_1';
      }

      // Handle admin / testing commands
      if (rawText === '/spin') {
        const forced = engine.forceSpin();
        if (forced) {
          socket.emit('chat_message', {
            sender: 'CASINO',
            color: '#d4af37',
            text: 'Spin manually triggered.',
            timestamp: Date.now(),
            isSystem: true,
            scope,
            table
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
            isSystem: true,
            scope,
            table
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
        isSystem: false,
        scope,
        table
      });
    });

    // 5. Casino Banking & Loans Protocol

    socket.on('bank_get_state', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) return;
      let restored = false;
      if (payload && payload.backup) {
        restored = bankManager.restoreFromBackup(player.id, payload.backup);
      }
      socket.emit('bank_update', bankManager.getPlayerBankData(player.id));
      if (restored) {
        notifyLoanCounterparties(player.id);
      }
    });

    socket.on('bank_reconcile_backup', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) return;
      let restored = false;
      if (payload && payload.backup) {
        restored = bankManager.restoreFromBackup(player.id, payload.backup);
      }
      socket.emit('bank_update', bankManager.getPlayerBankData(player.id));
      if (restored) {
        notifyLoanCounterparties(player.id);
      }
    });

    socket.on('bank_spin_wheel', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) return;
      const clientLastSpin = (payload && typeof payload.lastWheelSpin === 'number') ? payload.lastWheelSpin : 0;
      const res = bankManager.spinWheel(player.id, clientLastSpin);
      if (!res.success) {
        socket.emit('bank_wheel_result', res);
        socket.emit('bank_error', { code: res.code, message: res.reason });
        socket.emit('bank_update', bankManager.getPlayerBankData(player.id));
        return;
      }

      socket.emit('bank_wheel_result', res);
      socket.emit('chips_update', { chips: res.chips, wheelDelayed: true });
      socket.emit('bank_update', bankManager.getPlayerBankData(player.id));
      broadcastPlayersUpdate();

      if (res.amount >= 5000) {
        broadcastChatMessage({
          sender: 'CASINO',
          color: '#d4af37',
          text: `[RAD VAN FORTUIN] ${player.name} draait het Rad van Fortuin en wint ${res.amount.toLocaleString()} fiches!`,
          timestamp: Date.now(),
          isSystem: true,
          scope: 'global',
          table: 'all'
        });
      }
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

    socket.on('bank_dismiss_notification', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) return;
      const notificationId = (payload && payload.notificationId) || 'all';
      bankManager.dismissNotification(player.id, notificationId);
      socket.emit('bank_update', bankManager.getPlayerBankData(player.id));
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

    socket.on('player_set_password', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) {
        socket.emit('player_password_result', { success: false, reason: 'Speler niet gevonden' });
        return;
      }
      const res = playerManager.updatePlayerPassword(player.id, {
        oldPassword: payload.oldPassword,
        newPassword: payload.newPassword
      });
      socket.emit('player_password_result', res);
    });

    socket.on('player_set_game', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) return;

      const navCheck = checkNavigation(player.id);
      if (!navCheck.allowed) {
        socket.emit('navigation_blocked', {
          code: navCheck.code,
          reason: navCheck.reason || navCheck.message,
          message: navCheck.message,
          game: navCheck.game,
          amount: navCheck.amount,
          activeBetsTotal: navCheck.amount
        });
        return;
      }

      const game = payload.game || payload.location || 'Roulette';
      const seatIndex = payload.seatIndex !== undefined ? payload.seatIndex : null;
      playerManager.setPlayerPresence(player.id, game, seatIndex);

      if (player.location !== 'POKER') {
        for (const tbl of pokerTables.values()) {
          const seat = tbl.seats.find(s => s.player && s.player.id === player.id);
          if (seat && !tbl.hasActiveBets(player.id)) {
            tbl.leaveSeat(seat.seatIndex, player.id);
          }
        }
      }

      if (player.location !== 'BLACKJACK') {
        for (const tbl of blackjackTables.values()) {
          const seat = tbl.seats.find(s => s.player && s.player.id === player.id);
          if (seat && !tbl.hasActiveBets(player.id)) {
            tbl.leaveSeat(seat.seatIndex, player.id, { updatePresence: false });
          }
        }
      }

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
          reason: navCheck.reason || navCheck.message,
          message: navCheck.message,
          game: navCheck.game,
          amount: navCheck.amount,
          activeBetsTotal: navCheck.amount
        });
        return;
      }

      const location = payload.location || payload.game || 'ROULETTE';
      const seatIndex = payload.seatIndex !== undefined ? payload.seatIndex : null;
      playerManager.setPlayerPresence(player.id, location, seatIndex);

      if (player.location !== 'POKER') {
        for (const tbl of pokerTables.values()) {
          const seat = tbl.seats.find(s => s.player && s.player.id === player.id);
          if (seat && !tbl.hasActiveBets(player.id)) {
            tbl.leaveSeat(seat.seatIndex, player.id);
          }
        }
      }

      if (player.location !== 'BLACKJACK') {
        for (const tbl of blackjackTables.values()) {
          const seat = tbl.seats.find(s => s.player && s.player.id === player.id);
          if (seat && !tbl.hasActiveBets(player.id)) {
            tbl.leaveSeat(seat.seatIndex, player.id, { updatePresence: false });
          }
        }
      }

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
          reason: navCheck.reason || navCheck.message,
          message: navCheck.message,
          game: navCheck.game,
          amount: navCheck.amount,
          activeBetsTotal: navCheck.amount
        });
        return;
      }

      for (const tbl of pokerTables.values()) {
        const seat = tbl.seats.find(s => s.player && s.player.id === player.id);
        if (seat && !tbl.hasActiveBets(player.id)) {
          tbl.leaveSeat(seat.seatIndex, player.id);
        }
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
        socket.emit('bj_table_state', table.getTableState(player.id));
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
      socket.emit('bj_action_success', { action, hand: res.hand, remainingChips: player.chips });
      socket.emit('chips_update', { chips: player.chips });
      broadcastPlayersUpdate();
    });

    socket.on('bj_deal_now', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) return;
      const table = getTable(payload && payload.tableId);
      const res = table.dealNow(player.id);
      if (!res.success) {
        socket.emit('bj_bet_rejected', res);
      }
    });

    // 8. Texas Hold'em Poker Protocol
    socket.on('poker_join_table', (payload = {}) => {
      const tableId = (payload && payload.tableId) || 'poker_1';
      const table = getPokerTable(tableId);
      socket.join('table:' + table.tableId);
      const player = playerManager.getPlayerBySocket(socket.id);

      if (player) {
        const seat = table.seats.find(s => s.player && s.player.id === player.id);
        if (seat && seat.player) {
          seat.player.connected = true;
          seat.player.socketId = socket.id;
        }
      }

      const state = table.getTableState(player ? player.id : null);
      socket.emit('poker_table_state', state);

      if (player) {
        const holeCards = table.getHoleCards(player.id);
        if (holeCards) {
          const seat = table.seats.find(s => s.player && s.player.id === player.id);
          socket.emit('poker_hole_cards', {
            tableId: table.tableId,
            seatIndex: seat ? seat.seatIndex : -1,
            cards: holeCards,
            holeCards
          });
        }
      }
    });

    socket.on('poker_leave_table', (payload = {}) => {
      const tableId = (payload && payload.tableId) || 'poker_1';
      const table = getPokerTable(tableId);
      socket.leave('table:' + table.tableId);
    });

    socket.on('poker_take_seat', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) {
        socket.emit('poker_seat_error', { code: 'PLAYER_NOT_FOUND', reason: 'Must be authenticated before taking a seat' });
        return;
      }

      const tableId = (payload && payload.tableId) || 'poker_1';
      const table = getPokerTable(tableId);
      socket.join('table:' + table.tableId);

      let seatIndex = -1;
      if (payload && typeof payload.seatIndex === 'number') {
        seatIndex = payload.seatIndex;
      } else if (payload && typeof payload.seat === 'number') {
        seatIndex = payload.seat;
      } else if (payload && typeof payload.seatIndex === 'string' && !isNaN(parseInt(payload.seatIndex, 10))) {
        seatIndex = parseInt(payload.seatIndex, 10);
      } else if (payload && typeof payload.seat === 'string' && !isNaN(parseInt(payload.seat, 10))) {
        seatIndex = parseInt(payload.seat, 10);
      }

      const explicitBuyIn = payload && (payload.buyInAmount !== undefined ? payload.buyInAmount : payload.amount);
      const isFixedEntry = !!(payload && payload.fixedEntry) || explicitBuyIn === undefined || explicitBuyIn === null;
      const standardEqualStack = table.tableId === 'poker_2' ? 2000 : 1000;
      const buyInAmount = !isFixedEntry
        ? explicitBuyIn
        : Math.max(table.bigBlindAmount || 100, Math.min(standardEqualStack, player.chips || 0));

      const res = table.takeSeat(seatIndex, player.id, buyInAmount, {
        name: player.name,
        avatar: player.avatar,
        color: player.color,
        socketId: socket.id,
        allowShortEntry: isFixedEntry
      });

      if (!res.success) {
        socket.emit('poker_seat_error', res);
        socket.emit('poker_table_state', table.getTableState(player.id));
        return;
      }

      // Update presence
      playerManager.setPlayerPresence(player.id, 'POKER', seatIndex);

      socket.emit('chips_update', { chips: player.chips, tableStack: res.stack });
      socket.emit('poker_seat_accepted', {
        tableId: table.tableId,
        seatIndex,
        stack: res.stack,
        player: table.seats[seatIndex].player
      });
      broadcastPlayersUpdate();
    });

    socket.on('poker_leave_seat', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) return;

      const tableId = (payload && payload.tableId) || 'poker_1';
      const table = getPokerTable(tableId);

      // Check navigation bet lock
      if (table.hasActiveBets(player.id)) {
        const navError = {
          code: 'CANNOT_LEAVE_ACTIVE_BETS',
          game: 'Poker',
          reason: 'Je hebt een actieve pokerhand. Speel de hand uit voordat je de tafel verlaat.',
          message: 'Je hebt een actieve pokerhand. Speel de hand uit voordat je de tafel verlaat.',
          amount: table.getActiveBetTotal(player.id),
          activeBetsTotal: table.getActiveBetTotal(player.id)
        };
        socket.emit('navigation_blocked', navError);
        socket.emit('poker_seat_error', navError);
        return;
      }

      let seatIndex = -1;
      if (payload && typeof payload.seatIndex === 'number') {
        seatIndex = payload.seatIndex;
      } else if (payload && typeof payload.seat === 'number') {
        seatIndex = payload.seat;
      } else {
        const found = table.seats.find(s => s.player && s.player.id === player.id);
        if (found) seatIndex = found.seatIndex;
      }

      const res = table.leaveSeat(seatIndex, player.id);
      if (!res.success) {
        socket.emit('poker_seat_error', res);
        return;
      }

      playerManager.setPlayerPresence(player.id, 'LOBBY', null);
      socket.emit('chips_update', { chips: player.chips });
      socket.emit('poker_seat_vacated', { tableId: table.tableId, seatIndex, playerId: player.id, cashoutAmount: res.cashoutAmount });
      broadcastPlayersUpdate();
    });

    const handlePokerRebuy = (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) return;

      const tableId = (payload && payload.tableId) || 'poker_1';
      const table = getPokerTable(tableId);

      let seatIndex = -1;
      if (payload && typeof payload.seatIndex === 'number') {
        seatIndex = payload.seatIndex;
      } else if (payload && typeof payload.seat === 'number') {
        seatIndex = payload.seat;
      } else {
        const found = table.seats.find(s => s.player && s.player.id === player.id);
        if (found) seatIndex = found.seatIndex;
      }

      const amount = (payload && (payload.amount || payload.buyInAmount)) || 0;

      if (seatIndex < 0 || !table.seats[seatIndex] || !table.seats[seatIndex].player || table.seats[seatIndex].player.id !== player.id) {
        socket.emit('poker_seat_error', { code: 'NOT_SEATED', reason: 'You are not seated at this table' });
        return;
      }

      const res = table.rebuy(seatIndex, player.id, amount);
      if (!res.success) {
        socket.emit('poker_rebuy_error', res);
        socket.emit('poker_seat_error', res);
        return;
      }

      socket.emit('chips_update', { chips: player.chips, tableStack: (res.stack || 0) + (res.pendingRebuy || 0) });
      socket.emit('poker_rebuy_success', {
        tableId: table.tableId,
        seatIndex,
        amount,
        stack: res.stack,
        pendingRebuy: res.pendingRebuy,
        pending: res.pending
      });

      const updateData = {
        tableId: table.tableId,
        seatIndex,
        playerId: player.id,
        stack: res.stack,
        pendingRebuy: res.pendingRebuy
      };
      io.to('table:' + table.tableId).emit('poker_stack_update', updateData);
      io.emit('poker_stack_update', updateData);
      broadcastPlayersUpdate();
    };

    socket.on('poker_rebuy', handlePokerRebuy);
    socket.on('poker_buy_in', handlePokerRebuy);

    socket.on('poker_action', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) {
        socket.emit('poker_action_rejected', { code: 'PLAYER_NOT_FOUND', reason: 'Player profile not found' });
        return;
      }

      const tableId = (payload && payload.tableId) || 'poker_1';
      const table = getPokerTable(tableId);

      let seatIndex = -1;
      if (payload && typeof payload.seatIndex === 'number') {
        seatIndex = payload.seatIndex;
      } else if (payload && typeof payload.seat === 'number') {
        seatIndex = payload.seat;
      } else {
        const found = table.seats.find(s => s.player && s.player.id === player.id);
        if (found) seatIndex = found.seatIndex;
      }

      const action = payload ? payload.action : '';
      const amount = payload ? payload.amount : undefined;

      const res = table.handleAction(seatIndex, player.id, action, { amount });
      if (!res.success) {
        socket.emit('poker_action_rejected', res);
        return;
      }

      socket.emit('poker_action_success', { tableId: table.tableId, seatIndex, action, amount });
    });

    // 8b. Multiplayer Crash Protocol
    socket.on('crash_join_table', () => {
      socket.emit('crash_table_state', crashEngine.getTableState());
    });

    socket.on('crash_place_bet', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) {
        socket.emit('crash_bet_rejected', {
          code: 'PLAYER_NOT_FOUND',
          reason: 'Log eerst in om in te zetten.'
        });
        return;
      }

      const res = crashEngine.placeBet(player.id, payload);
      if (!res.success) {
        socket.emit('crash_bet_rejected', {
          code: res.code,
          reason: res.reason
        });
        return;
      }

      socket.emit('crash_bet_accepted', {
        roundId: crashEngine.roundId,
        bet: res.bet,
        remainingChips: res.remainingChips,
        totalPot: res.totalPot
      });
      socket.emit('chips_update', { chips: res.remainingChips });
    });

    socket.on('crash_cancel_bet', () => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) return;

      const res = crashEngine.cancelBet(player.id);
      if (!res.success) {
        socket.emit('crash_bet_rejected', {
          code: res.code,
          reason: res.reason
        });
        return;
      }

      socket.emit('crash_bet_cancelled_self', {
        roundId: crashEngine.roundId,
        refunded: res.refunded,
        remainingChips: res.remainingChips,
        totalPot: res.totalPot
      });
      socket.emit('chips_update', { chips: res.remainingChips });
    });

    socket.on('crash_cash_out', () => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) {
        socket.emit('crash_cashout_rejected', {
          code: 'PLAYER_NOT_FOUND',
          reason: 'Speler niet gevonden.'
        });
        return;
      }

      const res = crashEngine.cashOut(player.id);
      if (!res.success) {
        socket.emit('crash_cashout_rejected', {
          code: res.code,
          reason: res.reason
        });
        return;
      }

      socket.emit('crash_cashout_success', {
        roundId: res.roundId,
        cashoutMultiplier: res.cashoutMultiplier,
        payout: res.payout,
        profit: res.profit,
        remainingChips: res.remainingChips,
        stats: res.stats
      });
      socket.emit('chips_update', { chips: res.remainingChips });
    });

    // 9. disconnect
    socket.on('disconnect', () => {
      const player = playerManager.disconnectPlayer(socket.id);
      if (player) {
        // Vacate any Blackjack seats where the player has no active bets
        for (const tbl of blackjackTables.values()) {
          if (!tbl.hasActiveBets(player.id)) {
            for (const seat of tbl.seats) {
              if (seat.player && seat.player.id === player.id) {
                tbl.leaveSeat(seat.seatIndex, player.id);
              }
            }
          }
        }

        // Handle Poker seats on disconnect
        for (const tbl of pokerTables.values()) {
          const seat = tbl.seats.find(s => s.player && s.player.id === player.id);
          if (seat) {
            if (tbl.hasActiveBets(player.id)) {
              if (seat.player) {
                seat.player.connected = false;
              }
            } else {
              tbl.leaveSeat(seat.seatIndex, player.id);
            }
          }
        }

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
    pokerEngine: defaultPokerEngine,
    pokerTables,
    crashEngine,
    canPlayerNavigate: checkNavigation,
    broadcastChatMessage,
    stop: () => {
      engine.stop();
      crashEngine.stop();
      for (const tbl of blackjackTables.values()) {
        tbl.stop();
      }
      for (const tbl of pokerTables.values()) {
        try {
          if (typeof tbl.cashoutAllPlayersSync === 'function') {
            tbl.cashoutAllPlayersSync();
          }
          tbl.stop();
        } catch (e) {}
      }
    }
  };
}

module.exports = {
  setupSocket,
  sanitizeHtml,
  canPlayerNavigate
};
