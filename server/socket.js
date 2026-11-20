/**
 * socket.js
 * Real-time Socket.io communication protocol.
 * Integrates PlayerManager and RouletteEngine with full HTML entity sanitization.
 * Zero GTA branding and zero audio code.
 */

const { Server } = require('socket.io');
const { getVersionInfo } = require('./version');
const PlayerManager = require('./game/playerManager');
const RouletteEngine = require('./game/rouletteEngine');
const BankManager = require('./game/bankManager');
const BlackjackEngine = require('./game/blackjackEngine');
const PokerEngine = require('./game/pokerEngine');
const CrashEngine = require('./game/crashEngine');
const PlinkoEngine = require('./game/plinkoEngine');
const SlotsEngine = require('./game/slotsEngine');
const RacingEngine = require('./game/racingEngine');
const HiloEngine = require('./game/hiloEngine');
const MinesEngine = require('./game/minesEngine');
const AviaEngine = require('./game/aviaEngine');
const CrossEngine = require('./game/crossEngine');
const VaultsEngine = require('./game/vaultsEngine');
const LotteryEngine = require('./game/lotteryEngine');

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
 * @param {Object} [crashEngine=null]
 * @param {Object} [racingEngine=null]
 * @returns {{ allowed: boolean, code?: string, game?: string, amount?: number, reason?: string, message?: string }}
 */
function canPlayerNavigate(playerId, rouletteEngine, blackjackEngine, pokerEngine = null, crashEngine = null, racingEngine = null, hiloEngine = null, minesEngine = null, crossEngine = null, vaultsEngine = null) {
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
  if (racingEngine && typeof racingEngine.hasActiveBets === 'function' && racingEngine.hasActiveBets(playerId)) {
    return {
      allowed: false,
      code: 'CANNOT_LEAVE_ACTIVE_BETS',
      game: 'Racing',
      amount: typeof racingEngine.getActiveBetTotal === 'function' ? racingEngine.getActiveBetTotal(playerId) : 0,
      reason: 'Je hebt een actief ticket in de Port Hercule Derby. Wacht tot de race is gefinisht.',
      message: 'Active ticket present on Racing.'
    };
  }
  if (hiloEngine && typeof hiloEngine.hasActiveBets === 'function' && hiloEngine.hasActiveBets(playerId)) {
    return {
      allowed: false,
      code: 'CANNOT_LEAVE_ACTIVE_BETS',
      game: 'HiLo',
      amount: typeof hiloEngine.getActiveBetTotal === 'function' ? hiloEngine.getActiveBetTotal(playerId) : 0,
      reason: 'Je hebt een actieve Hi-Lo reeks openstaan. Cash uit of speel deze eerst af.',
      message: 'Active bet present on Hi-Lo.'
    };
  }
  if (minesEngine && typeof minesEngine.hasActiveBets === 'function' && minesEngine.hasActiveBets(playerId)) {
    return {
      allowed: false,
      code: 'CANNOT_LEAVE_ACTIVE_BETS',
      game: 'Mines',
      amount: typeof minesEngine.getActiveBetTotal === 'function' ? minesEngine.getActiveBetTotal(playerId) : 0,
      reason: 'Je hebt een actieve Mines Kluis ronde openstaan. Cash uit of rond de kluis eerst af.',
      message: 'Active bet present on Mines.'
    };
  }
  if (crossEngine && typeof crossEngine.hasActiveBets === 'function' && crossEngine.hasActiveBets(playerId)) {
    return {
      allowed: false,
      code: 'CANNOT_LEAVE_ACTIVE_BETS',
      game: 'Cross',
      amount: typeof crossEngine.getActiveBetTotal === 'function' ? crossEngine.getActiveBetTotal(playerId) : 0,
      reason: 'Je hebt een actieve Boulevard Cross oversteek openstaan. Cash eerst uit of maak je ronde af.',
      message: 'Active bet present on Boulevard Cross.'
    };
  }
  if (vaultsEngine && typeof vaultsEngine.hasActiveBets === 'function' && vaultsEngine.hasActiveBets(playerId)) {
    return {
      allowed: false,
      code: 'CANNOT_LEAVE_ACTIVE_BETS',
      game: 'Vaults',
      amount: typeof vaultsEngine.getActiveBetTotal === 'function' ? vaultsEngine.getActiveBetTotal(playerId) : 0,
      reason: 'Je zit midden in een actieve Kluizenroof ronde. Speel eerst je ronde uit.',
      message: 'Active match in progress on Monte Carlo Kluizenroof.'
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
  const {
    playerManager: injectedPm,
    bankManager: injectedBm,
    playerManagerOptions,
    bankManagerOptions,
    lotteryOptions: _ignoredLotOpts,
    ...ioOptions
  } = (options && typeof options === 'object') ? options : {};

  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    },
    ...ioOptions
  });

  const playerManager = injectedPm || new PlayerManager(playerManagerOptions || {});
  const bankManager = injectedBm || new BankManager(playerManager, bankManagerOptions || {});
  const engine = new RouletteEngine(playerManager, { bankManager });

  /** Emit an event to every connected socket belonging to playerId (supports multiple open tabs). */
  function emitToPlayer(playerId, event, data) {
    if (!playerId) return;
    const sockets = typeof playerManager.getSocketsForPlayer === 'function'
      ? playerManager.getSocketsForPlayer(playerId)
      : [];
    if (sockets.length > 0) {
      sockets.forEach((sid) => io.to(sid).emit(event, data));
      return;
    }
    const target = playerManager.getPlayerById(playerId);
    if (target && target.socketId) {
      io.to(target.socketId).emit(event, data);
    }
  }

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
    bankManager,
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
    bankManager,
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

  const plinkoEngine = new PlinkoEngine({ playerManager, bankManager });
  io.plinkoEngine = plinkoEngine;

  const aviaEngine = new AviaEngine({ playerManager, bankManager });
  io.aviaEngine = aviaEngine;

  const slotsEngine = new SlotsEngine({ playerManager, bankManager });
  io.slotsEngine = slotsEngine;

  function broadcastSlotsFloor() {
    io.emit('slots_floor_update', {
      jackpotPool: Math.floor(slotsEngine.jackpotPool),
      goldenFever: slotsEngine.getGoldenFeverState(),
      machines: slotsEngine.getPublicMachines(),
      recentBigWins: slotsEngine.getRecentBigWins()
    });
  }

  slotsEngine.on('golden_fever_started', (payload) => {
    io.emit('slots_golden_fever', { active: true, ...payload });
    broadcastSlotsFloor();
    broadcastChatMessage({
      sender: 'CASINO',
      color: '#f59e0b',
      text: '[GOLDEN FEVER] VLOER EVENT GEACTIVEERD! 30 seconden lang 2x winst en extra Golden Wilds op alle 8 kasten!',
      timestamp: Date.now(),
      isSystem: true,
      scope: 'table',
      table: 'slots'
    });
    broadcastChatMessage({
      sender: 'CASINO',
      color: '#f59e0b',
      text: '[GOLDEN FEVER] Monte Carlo Slots staat in lichterlaaie — 30s 2x multiplier actief op alle kasten!',
      timestamp: Date.now(),
      isSystem: true,
      scope: 'global',
      table: 'all'
    });
  });

  slotsEngine.on('golden_fever_ended', (payload) => {
    io.emit('slots_golden_fever', { active: false, ...payload });
    broadcastSlotsFloor();
  });

  const racingEngine = new RacingEngine({ playerManager, bankManager });
  io.racingEngine = racingEngine;

  racingEngine.on('phase_tick', (payload) => {
    io.emit('racing_phase_tick', payload);
  });

  racingEngine.on('phase_change', (payload) => {
    io.emit('racing_phase_change', payload);
    if (payload && (payload.phase === 'FINISHED' || payload.phase === 'WAITING_FOR_BETS')) {
      broadcastPlayersUpdate();
    }
  });

  racingEngine.on('tick', (payload) => {
    io.emit('racing_tick', payload);
  });

  racingEngine.on('bet_placed', (payload) => {
    io.emit('racing_bet_placed', payload);
    broadcastPlayersUpdate();
  });

  racingEngine.on('bet_cancelled', (payload) => {
    io.emit('racing_bet_cancelled', payload);
    broadcastPlayersUpdate();
  });

  racingEngine.on('horse_cheered', (payload) => {
    io.emit('racing_cheered', payload);
  });

  racingEngine.on('race_finished', (result) => {
    io.emit('racing_finished', result);
    if (result && Array.isArray(result.settlements)) {
      result.settlements.forEach((s) => {
        emitToPlayer(s.playerId, 'racing_settlement', s);
        if (typeof s.newChips === 'number') {
          emitToPlayer(s.playerId, 'chips_update', { chips: s.newChips, source: 'racing' });
        }

        if (Array.isArray(s.repayments) && s.repayments.length > 0) {
          s.repayments.forEach((rep) => {
            broadcastChatMessage({
              sender: 'BANK',
              color: '#10b981',
              text: `[BANK] ${s.playerName} heeft ${rep.amount.toLocaleString()} fiches afgelost aan ${rep.lenderName} via derby-winstinhouding.${rep.isFullyRepaid ? ' (Schuld volledig voldaan!)' : ''}`,
              timestamp: Date.now(),
              isSystem: true,
              scope: 'table',
              table: 'racing'
            });
            const lender = playerManager.getPlayerById(rep.lenderId);
            if (lender) {
              emitToPlayer(lender.id, 'chips_update', { chips: lender.chips });
              emitToPlayer(lender.id, 'bank_update', bankManager.getPlayerBankData(lender.id));
            }
            const borrower = playerManager.getPlayerById(s.playerId);
            if (borrower) {
              emitToPlayer(borrower.id, 'chips_update', { chips: borrower.chips });
              emitToPlayer(borrower.id, 'bank_update', bankManager.getPlayerBankData(borrower.id));
            }
          });
        }

        if (s.totalReturned > 0 && s.netProfit >= 1000) {
          const isMega = s.netProfit >= 8000;
          const potText = s.potBonusTotal > 0 ? ` (+${s.potBonusTotal.toLocaleString()} Winnaarspot)` : '';
          broadcastChatMessage({
            sender: 'CASINO',
            color: '#d4af37',
            text: `[TURF CLUB] ${s.playerName} won ${s.totalReturned.toLocaleString()} fiches (${s.bestMultiplier}x)${potText} op Race #${result.raceId}!`,
            timestamp: Date.now(),
            isSystem: true,
            scope: 'table',
            table: 'racing'
          });
          broadcastChatMessage({
            sender: 'CASINO',
            color: '#d4af37',
            text: isMega
              ? `[MEGA DERBY] ${s.playerName} pakte een topwinst van ${s.totalReturned.toLocaleString()} fiches in Monaco Turf Club!`
              : `[TURF CLUB] ${s.playerName} cashte ${s.totalReturned.toLocaleString()} fiches op de Derby!`,
            timestamp: Date.now(),
            isSystem: true,
            scope: 'global',
            table: 'all'
          });
        }
      });
    }
    broadcastPlayersUpdate();
  });

  const hiloEngine = new HiloEngine({ playerManager, bankManager });
  io.hiloEngine = hiloEngine;
  hiloEngine.start();

  function emitHiloRepayments(playerId, playerName, repayments, modeLabel = 'Hi-Lo Privé') {
    if (!Array.isArray(repayments) || repayments.length === 0) return;
    repayments.forEach((rep) => {
      broadcastChatMessage({
        sender: 'BANK',
        color: '#10b981',
        text: `[BANK] ${playerName} heeft ${rep.amount.toLocaleString()} fiches afgelost aan ${rep.lenderName} via ${modeLabel}.${rep.isFullyRepaid ? ' (Schuld volledig voldaan!)' : ''}`,
        timestamp: Date.now(),
        isSystem: true,
        scope: 'table',
        table: 'hilo'
      });
      const lender = playerManager.getPlayerById(rep.lenderId);
      if (lender) {
        emitToPlayer(lender.id, 'chips_update', { chips: lender.chips });
        emitToPlayer(lender.id, 'bank_update', bankManager.getPlayerBankData(lender.id));
      }
      const borrower = playerManager.getPlayerById(playerId);
      if (borrower) {
        emitToPlayer(borrower.id, 'chips_update', { chips: borrower.chips });
        emitToPlayer(borrower.id, 'bank_update', bankManager.getPlayerBankData(borrower.id));
      }
    });
  }

  hiloEngine.on('salon_update', () => {
    const pub = hiloEngine.getPublicSalonState(null);
    io.emit('hilo_salon_update', {
      players: pub.players,
      recentWins: pub.recentWins
    });
  });

  hiloEngine.on('big_moment', (payload) => {
    if (!payload) return;
    const msgText = payload.type === 'EQUAL_HIT'
      ? `[HI-LO] ${payload.playerName} raakte GELIJK (${payload.multiplier}x) — pot nu ${payload.pot.toLocaleString()} fiches!`
      : payload.type === 'STREAK_MILESTONE'
      ? `[HI-LO] ${payload.playerName} staat op een ${payload.streak}-kaarten reeks (${payload.pot.toLocaleString()} fiches pot)!`
      : `[HI-LO] ${payload.playerName} cashte ${payload.payout.toLocaleString()} fiches uit (+${payload.netProfit.toLocaleString()}) na ${payload.streak} kaarten!`;
    broadcastChatMessage({
      sender: 'CASINO',
      color: '#d4af37',
      text: msgText,
      timestamp: Date.now(),
      isSystem: true,
      scope: 'table',
      table: 'hilo'
    });
    broadcastChatMessage({
      sender: 'CASINO',
      color: '#d4af37',
      text: msgText,
      timestamp: Date.now(),
      isSystem: true,
      scope: 'global',
      table: 'all'
    });
  });

  // Royal Mines Vault (Solo + Multiplayer Shared Vault)
  const minesEngine = new MinesEngine({ playerManager, bankManager });
  io.minesEngine = minesEngine;
  minesEngine.start();

  function emitMinesRepayments(playerId, playerName, repayments, modeLabel = 'Mines Kluis') {
    if (!Array.isArray(repayments) || repayments.length === 0) return;
    const targetPlayer = playerManager.getPlayerById(playerId);
    if (targetPlayer && typeof playerManager._persistPlayer === 'function') {
      playerManager._persistPlayer(targetPlayer);
    }
    emitToPlayer(playerId, 'bank_update', bankManager.getPlayerBankData(playerId));
    repayments.forEach((rep) => {
      broadcastChatMessage({
        sender: 'BANK',
        color: '#34d399',
        text: `${playerName} loste ${rep.amountPaid.toLocaleString()} fiches (${rep.interestEarned} rente) af uit ${modeLabel}!`,
        timestamp: Date.now(),
        isSystem: true,
        scope: 'table',
        table: 'mines'
      });
      if (rep.counterpartyId) {
        emitToPlayer(rep.counterpartyId, 'bank_update', bankManager.getPlayerBankData(rep.counterpartyId));
        const cp = playerManager.getPlayerById(rep.counterpartyId);
        if (cp) {
          emitToPlayer(rep.counterpartyId, 'chips_update', { chips: cp.chips, source: 'bank_repayment' });
        }
      }
    });
  }

  minesEngine.on('salon_update', () => {
    const pub = minesEngine.getPublicState(null);
    io.emit('mines_salon_update', {
      players: pub.players,
      recentWins: pub.recentWins,
      shared: pub.shared
    });
  });

  minesEngine.on('big_moment', (payload) => {
    if (!payload) return;
    const msgText = `[MINES] ${payload.playerName} cashte ${payload.payout.toLocaleString()} fiches (${Number(payload.multiplier).toFixed(2)}x) na ${payload.diamondsOpened} diamanten (${payload.gridLabel})!`;
    broadcastChatMessage({
      sender: 'CASINO',
      color: '#d4af37',
      text: msgText,
      timestamp: Date.now(),
      isSystem: true,
      scope: 'table',
      table: 'mines'
    });
    broadcastChatMessage({
      sender: 'CASINO',
      color: '#d4af37',
      text: msgText,
      timestamp: Date.now(),
      isSystem: true,
      scope: 'global',
      table: 'all'
    });
  });

  minesEngine.on('shared_tick', (payload) => {
    io.emit('mines_shared_tick', payload);
  });

  minesEngine.on('shared_phase_change', (payload) => {
    io.emit('mines_shared_state', payload);
    if (payload && (payload.phase === 'WAITING_FOR_PLAYERS' || payload.phase === 'REVEALED')) {
      broadcastPlayersUpdate();
    }
  });

  minesEngine.on('shared_update', (payload) => {
    io.emit('mines_shared_state', payload);
  });

  minesEngine.on('shared_tile', (payload) => {
    io.emit('mines_shared_tile', payload);
  });

  minesEngine.on('shared_settlement', (s) => {
    emitToPlayer(s.playerId, 'mines_shared_settlement', s);
    if (typeof s.newChips === 'number') {
      emitToPlayer(s.playerId, 'chips_update', { chips: s.newChips, source: 'mines_shared' });
    }
    emitMinesRepayments(s.playerId, s.playerName, s.repayments, 'Shared Mines');
  });

  minesEngine.on('shared_finished', (payload) => {
    io.emit('mines_shared_finished', payload);
    broadcastPlayersUpdate();
  });

  // -------------------------------------------------------------------------
  // Monte Carlo Boulevard Cross (Unlimited lanes, uniform 20% crash / 80% win)
  // -------------------------------------------------------------------------
  const crossEngine = new CrossEngine({ playerManager, bankManager });
  io.crossEngine = crossEngine;
  crossEngine.start();

  function emitCrossRepayments(playerId, playerName, repayments, modeLabel = 'Boulevard Cross') {
    if (!Array.isArray(repayments) || repayments.length === 0) return;
    repayments.forEach((rep) => {
      broadcastChatMessage({
        sender: 'BANK',
        color: '#10b981',
        text: `[BANK] ${playerName} heeft ${rep.amount.toLocaleString()} fiches afgelost aan ${rep.lenderName} via ${modeLabel}.${rep.isFullyRepaid ? ' (Schuld volledig voldaan!)' : ''}`,
        timestamp: Date.now(),
        isSystem: true,
        scope: 'table',
        table: 'cross'
      });
      const lender = playerManager.getPlayerById(rep.lenderId);
      if (lender) {
        emitToPlayer(lender.id, 'chips_update', { chips: lender.chips });
        emitToPlayer(lender.id, 'bank_update', bankManager.getPlayerBankData(lender.id));
      }
      const borrower = playerManager.getPlayerById(playerId);
      if (borrower) {
        emitToPlayer(borrower.id, 'chips_update', { chips: borrower.chips });
        emitToPlayer(borrower.id, 'bank_update', bankManager.getPlayerBankData(borrower.id));
      }
    });
  }

  crossEngine.on('salon_update', () => {
    const pub = crossEngine.getPublicState(null);
    io.emit('cross_salon_update', {
      salonPlayers: pub.salonPlayers,
      recentWins: pub.recentWins
    });
  });

  crossEngine.on('big_moment', (payload) => {
    if (!payload) return;
    const msgText = `[CROSS] ${payload.playerName} cashte ${payload.payout.toLocaleString()} fiches (${Number(payload.multiplier).toFixed(2)}x) na ${payload.lane} banen op Monte Carlo Boulevard!`;
    broadcastChatMessage({
      sender: 'CASINO',
      color: '#d4af37',
      text: msgText,
      timestamp: Date.now(),
      isSystem: true,
      scope: 'table',
      table: 'cross'
    });
    broadcastChatMessage({
      sender: 'CASINO',
      color: '#d4af37',
      text: msgText,
      timestamp: Date.now(),
      isSystem: true,
      scope: 'global',
      table: 'all'
    });
  });

  // -------------------------------------------------------------------------
  // Monte Carlo Kluizenroof (Multiplayer Elimination Vault Doors, 2% rake)
  // -------------------------------------------------------------------------
  const vaultsEngine = new VaultsEngine({ playerManager, bankManager });
  io.vaultsEngine = vaultsEngine;
  vaultsEngine.start();

  function emitPersonalizedVaultsStates() {
    io.emit('vaults_state', vaultsEngine.getPublicState(null));
    for (const p of playerManager.players.values()) {
      if (!p || !p.connected) continue;
      if (vaultsEngine.participants.has(p.id) || vaultsEngine.salonPlayers.has(p.id)) {
        emitToPlayer(p.id, 'vaults_state', vaultsEngine.getPublicState(p.id));
      }
    }
  }

  vaultsEngine.on('state', () => {
    emitPersonalizedVaultsStates();
  });

  vaultsEngine.on('round_reveal', (payload) => {
    io.emit('vaults_round_reveal', payload);
    broadcastPlayersUpdate();
  });

  vaultsEngine.on('match_won', (payload) => {
    if (!payload) return;
    io.emit('vaults_match_won', payload);
    if (typeof payload.remainingChips === 'number') {
      emitToPlayer(payload.playerId, 'chips_update', { chips: payload.remainingChips, source: 'vaults_win' });
    }
    if (Array.isArray(payload.repayments) && payload.repayments.length > 0) {
      emitCrossRepayments(payload.playerId, payload.playerName, payload.repayments, 'Kluizenroof');
    }
    const winMsg = `[KLUIZENROOF] ${payload.playerName} overleefde ${payload.roundsSurvived} rondes en pakte de pot van +${Number(payload.netPrize || 0).toLocaleString()} fiches!`;
    broadcastChatMessage({
      sender: 'CASINO',
      color: '#d4af37',
      text: winMsg,
      timestamp: Date.now(),
      isSystem: true,
      scope: 'table',
      table: 'vaults'
    });
    if ((Number(payload.netPrize) || 0) >= 2000) {
      broadcastChatMessage({
        sender: 'CASINO',
        color: '#d4af37',
        text: winMsg,
        timestamp: Date.now(),
        isSystem: true,
        scope: 'global',
        table: 'all'
      });
    }
    broadcastPlayersUpdate();
  });

  // -------------------------------------------------------------------------
  // Casino Staatsloterij (30-minute cycle, 100% pot payout, 0% house edge)
  // -------------------------------------------------------------------------
  const lotteryOptions = (options && options.lotteryOptions && typeof options.lotteryOptions === 'object')
    ? options.lotteryOptions
    : {};
  const lotteryEngine = new LotteryEngine(playerManager, { bankManager, ...lotteryOptions });
  io.lotteryEngine = lotteryEngine;

  let lastKnownVersion = getVersionInfo();
  const versionWatchTimer = setInterval(() => {
    try {
      const current = getVersionInfo();
      if (current.buildHash !== lastKnownVersion.buildHash || current.bootId !== lastKnownVersion.bootId) {
        lastKnownVersion = current;
        io.emit('server_updating', {
          ...current,
          message: 'Nieuwe casino-update gedetecteerd — pagina wordt automatisch ververst...'
        });
        io.emit('server_version', current);
      }
    } catch (e) {}
  }, 4000);
  if (typeof versionWatchTimer.unref === 'function') {
    versionWatchTimer.unref();
  }

  function emitPersonalizedLotteryStates() {
    const baseState = lotteryEngine.getPublicState(null);
    io.emit('lottery_state', baseState);
    for (const p of playerManager.players.values()) {
      if (!p || !p.connected) continue;
      const key = String(p.usernameKey || p.name || p.id || '').trim().toLowerCase();
      const needsPersonal = (key && lotteryEngine.personalHistory && lotteryEngine.personalHistory.has(key)) ||
        lotteryEngine.participants.has(p.id);
      if (needsPersonal) {
        emitToPlayer(p.id, 'lottery_state', lotteryEngine.getPublicState(p.id));
      }
    }
  }

  lotteryEngine.on('tick', (tickPayload) => {
    io.emit('lottery_tick', tickPayload);
  });

  lotteryEngine.on('state', () => {
    emitPersonalizedLotteryStates();
  });

  lotteryEngine.on('draw_result', (res) => {
    io.emit('lottery_draw_result', res);

    const winner = playerManager.getPlayerById(res.winnerId);
    if (winner) {
      emitToPlayer(winner.id, 'chips_update', { chips: winner.chips, source: 'lottery' });
    }

    if (Array.isArray(res.repayments) && res.repayments.length > 0) {
      res.repayments.forEach((rep) => {
        broadcastChatMessage({
          sender: 'BANK',
          color: '#10b981',
          text: `[BANK] ${res.winnerName} heeft ${rep.amount.toLocaleString()} fiches afgelost aan ${rep.lenderName} via Staatsloterij-winstinhouding.${rep.isFullyRepaid ? ' (Schuld volledig voldaan!)' : ''}`,
          timestamp: Date.now(),
          isSystem: true,
          scope: 'global',
          table: 'all'
        });
        const lender = playerManager.getPlayerById(rep.lenderId);
        if (lender) {
          emitToPlayer(lender.id, 'chips_update', { chips: lender.chips });
          emitToPlayer(lender.id, 'bank_update', bankManager.getPlayerBankData(lender.id));
        }
        if (winner) {
          emitToPlayer(winner.id, 'chips_update', { chips: winner.chips, source: 'lottery' });
          emitToPlayer(winner.id, 'bank_update', bankManager.getPlayerBankData(winner.id));
        }
      });
    }

    broadcastChatMessage({
      sender: 'CASINO',
      color: '#d4af37',
      text: `[KRASLOTEN] ${res.winnerName} kraste ${res.tierLabel || 'een prijs'} open en won ${(res.potWon || 0).toLocaleString()} fiches uit de Krasloten-pot!`,
      timestamp: Date.now(),
      isSystem: true,
      scope: 'global',
      table: 'all'
    });
    broadcastPlayersUpdate();
  });

  // Lightweight sliding-window rate limiter per socket & event
  const rateLimitBuckets = new Map();
  function checkRateLimit(socketId, eventKey, maxCount, windowMs) {
    const key = `${socketId}:${eventKey}`;
    const now = Date.now();
    const arr = rateLimitBuckets.get(key) || [];
    const recent = arr.filter(ts => now - ts < windowMs);
    if (recent.length >= maxCount) {
      rateLimitBuckets.set(key, recent);
      return false;
    }
    recent.push(now);
    rateLimitBuckets.set(key, recent);
    return true;
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
    if (racingEngine && typeof racingEngine.hasActiveBets === 'function' && racingEngine.hasActiveBets(playerId)) {
      return {
        allowed: false,
        code: 'CANNOT_LEAVE_ACTIVE_BETS',
        game: 'Racing',
        amount: typeof racingEngine.getActiveBetTotal === 'function' ? racingEngine.getActiveBetTotal(playerId) : 0,
        reason: 'Je hebt een actief ticket in de Port Hercule Derby. Wacht tot de race is gefinisht.',
        message: 'Active ticket present on Racing.'
      };
    }
    if (hiloEngine && typeof hiloEngine.hasActiveBets === 'function' && hiloEngine.hasActiveBets(playerId)) {
      return {
        allowed: false,
        code: 'CANNOT_LEAVE_ACTIVE_BETS',
        game: 'HiLo',
        amount: typeof hiloEngine.getActiveBetTotal === 'function' ? hiloEngine.getActiveBetTotal(playerId) : 0,
        reason: 'Je hebt een actieve Hi-Lo reeks openstaan. Cash uit of speel deze eerst af.',
        message: 'Active bet present on Hi-Lo.'
      };
    }
    if (minesEngine && typeof minesEngine.hasActiveBets === 'function' && minesEngine.hasActiveBets(playerId)) {
      return {
        allowed: false,
        code: 'CANNOT_LEAVE_ACTIVE_BETS',
        game: 'Mines',
        amount: typeof minesEngine.getActiveBetTotal === 'function' ? minesEngine.getActiveBetTotal(playerId) : 0,
        reason: 'Je hebt een actieve Mines Kluis ronde openstaan. Cash uit of rond de kluis eerst af.',
        message: 'Active bet present on Mines.'
      };
    }
    if (crossEngine && typeof crossEngine.hasActiveBets === 'function' && crossEngine.hasActiveBets(playerId)) {
      return {
        allowed: false,
        code: 'CANNOT_LEAVE_ACTIVE_BETS',
        game: 'Cross',
        amount: typeof crossEngine.getActiveBetTotal === 'function' ? crossEngine.getActiveBetTotal(playerId) : 0,
        reason: 'Je hebt een actieve oversteek op Monte Carlo Boulevard lopen. Cash uit of maak je oversteek eerst af.',
        message: 'Active bet present on Boulevard Cross.'
      };
    }
    if (vaultsEngine && typeof vaultsEngine.hasActiveBets === 'function' && vaultsEngine.hasActiveBets(playerId)) {
      return {
        allowed: false,
        code: 'CANNOT_LEAVE_ACTIVE_BETS',
        game: 'Vaults',
        amount: typeof vaultsEngine.getActiveBetTotal === 'function' ? vaultsEngine.getActiveBetTotal(playerId) : 0,
        reason: 'Je zit midden in een actieve Kluizenroof ronde. Speel eerst je ronde uit.',
        message: 'Active match in progress on Monte Carlo Kluizenroof.'
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
    io.emit('global_leaderboard_update', playerManager.getGlobalLeaderboard());
  }

  // Start Lottery AFTER listeners, chatHistory, and broadcast helpers are all initialized so offline catch-up draws never hit TDZ
  lotteryEngine.start();

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
              if (lender) {
                emitToPlayer(lender.id, 'chips_update', { chips: lender.chips });
                emitToPlayer(lender.id, 'bank_update', bankManager.getPlayerBankData(lender.id));
              }
              const borrower = playerManager.getPlayerById(r.playerId);
              if (borrower) {
                emitToPlayer(borrower.id, 'chips_update', { chips: borrower.chips });
                emitToPlayer(borrower.id, 'bank_update', bankManager.getPlayerBankData(borrower.id));
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

      if (data && Array.isArray(data.repayments) && data.repayments.length > 0) {
        const borrower = playerManager.getPlayerById(data.playerId);
        const borrowerName = (borrower && borrower.name) || 'Speler';
        data.repayments.forEach((rep) => {
          broadcastChatMessage({
            sender: 'BANK',
            color: '#10b981',
            text: `[BANK] ${borrowerName} heeft ${rep.amount.toLocaleString()} fiches afgelost aan ${rep.lenderName} via Poker-winstinhouding.${rep.isFullyRepaid ? ' (Schuld volledig voldaan!)' : ''}`,
            timestamp: Date.now(),
            isSystem: true,
            scope: 'table',
            table: tbl.tableId
          });
          const lender = playerManager.getPlayerById(rep.lenderId);
          if (lender) {
            emitToPlayer(lender.id, 'chips_update', { chips: lender.chips });
            emitToPlayer(lender.id, 'bank_update', bankManager.getPlayerBankData(lender.id));
          }
          if (borrower) {
            emitToPlayer(borrower.id, 'chips_update', { chips: borrower.chips });
            emitToPlayer(borrower.id, 'bank_update', bankManager.getPlayerBankData(borrower.id));
          }
        });
      }

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
    if (p) {
      emitToPlayer(p.id, 'chips_update', { chips: p.chips });
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
        if (lender) {
          emitToPlayer(lender.id, 'chips_update', { chips: lender.chips });
          emitToPlayer(lender.id, 'bank_update', bankManager.getPlayerBankData(lender.id));
        }
        const borrower = playerManager.getPlayerById(data.playerId);
        if (borrower) {
          emitToPlayer(borrower.id, 'chips_update', { chips: borrower.chips });
          emitToPlayer(borrower.id, 'bank_update', bankManager.getPlayerBankData(borrower.id));
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
            if (lender) {
              emitToPlayer(lender.id, 'chips_update', { chips: lender.chips });
              emitToPlayer(lender.id, 'bank_update', bankManager.getPlayerBankData(lender.id));
            }
          });

          // Update borrower socket
          const borrower = playerManager.getPlayerById(r.playerId);
          if (borrower) {
            emitToPlayer(borrower.id, 'chips_update', { chips: borrower.chips });
            emitToPlayer(borrower.id, 'bank_update', bankManager.getPlayerBankData(borrower.id));
          }
        }
      });
    }
  });

  // Client connection handler
  io.on('connection', (socket) => {
    let currentSocketPlayerId = null;
    socket.emit('server_version', getVersionInfo());

    function notifyLoanCounterparties(restoredPlayerId) {
      for (const connectedPlayer of playerManager.getConnectedPlayers()) {
        if (!connectedPlayer || connectedPlayer.id === restoredPlayerId) continue;
        emitToPlayer(connectedPlayer.id, 'bank_update', bankManager.getPlayerBankData(connectedPlayer.id));
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

      // Restore active loans, wheel cooldown, cached offline leaderboard & unsettled lottery stake BEFORE emitting auth_success / bank_update / lottery_state
      let restoredLoans = false;
      if (opts.bankBackup && typeof opts.bankBackup === 'object') {
        restoredLoans = bankManager.restoreFromBackup(player.id, opts.bankBackup) || restoredLoans;
      }
      if (opts.clientBackup && typeof opts.clientBackup === 'object') {
        restoredLoans = bankManager.restoreFromBackup(player.id, opts.clientBackup) || restoredLoans;
      }
      if (Array.isArray(opts.leaderboardBackup) && typeof playerManager.restoreLeaderboardBackup === 'function') {
        playerManager.restoreLeaderboardBackup(opts.leaderboardBackup);
      }
      const lotteryRestore = (opts.lotteryBackup && typeof lotteryEngine.restoreFromBackup === 'function')
        ? lotteryEngine.restoreFromBackup(player, opts.lotteryBackup)
        : null;

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
      socket.emit('plinko_state', plinkoEngine.getState());
      socket.emit('slots_state', slotsEngine.getFloorState(player.id));
      socket.emit('racing_state', racingEngine.getPublicState(player.id));
      socket.emit('hilo_state', hiloEngine.getPublicSalonState(player.id));
      socket.emit('mines_state', minesEngine.getPublicState(player.id));
      socket.emit('cross_state', crossEngine.getPublicState(player.id));
      socket.emit('vaults_state', vaultsEngine.getPublicState(player.id));
      socket.emit('avia_state', aviaEngine.getState());
      socket.emit('lottery_state', lotteryEngine.getPublicState(player.id, Date.now(), {
        resolvedRoundId: lotteryRestore && lotteryRestore.resolvedRoundId
      }));
      if (lotteryRestore && (lotteryRestore.restored || lotteryRestore.drawExecuted)) {
        socket.broadcast.emit('lottery_state', lotteryEngine.getPublicState(null));
      }
      socket.emit('global_leaderboard_update', playerManager.getGlobalLeaderboard());

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

      // Restore active loans, wheel cooldown, cached offline leaderboard & unsettled lottery stake BEFORE emitting auth_success / bank_update
      let restoredLoans = false;
      if (opts.bankBackup && typeof opts.bankBackup === 'object') {
        restoredLoans = bankManager.restoreFromBackup(player.id, opts.bankBackup) || restoredLoans;
      }
      if (opts.clientBackup && typeof opts.clientBackup === 'object') {
        restoredLoans = bankManager.restoreFromBackup(player.id, opts.clientBackup) || restoredLoans;
      }
      if (Array.isArray(opts.leaderboardBackup) && typeof playerManager.restoreLeaderboardBackup === 'function') {
        playerManager.restoreLeaderboardBackup(opts.leaderboardBackup);
      }
      const lotteryRestore = (opts.lotteryBackup && typeof lotteryEngine.restoreFromBackup === 'function')
        ? lotteryEngine.restoreFromBackup(player, opts.lotteryBackup)
        : null;

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
      socket.emit('plinko_state', plinkoEngine.getState());
      socket.emit('slots_state', slotsEngine.getFloorState(player.id));
      socket.emit('racing_state', racingEngine.getPublicState(player.id));
      socket.emit('hilo_state', hiloEngine.getPublicSalonState(player.id));
      socket.emit('mines_state', minesEngine.getPublicState(player.id));
      socket.emit('cross_state', crossEngine.getPublicState(player.id));
      socket.emit('vaults_state', vaultsEngine.getPublicState(player.id));
      socket.emit('avia_state', aviaEngine.getState());
      socket.emit('lottery_state', lotteryEngine.getPublicState(player.id, Date.now(), {
        resolvedRoundId: lotteryRestore && lotteryRestore.resolvedRoundId
      }));
      if (lotteryRestore && (lotteryRestore.restored || lotteryRestore.drawExecuted)) {
        socket.broadcast.emit('lottery_state', lotteryEngine.getPublicState(null));
      }
      socket.emit('global_leaderboard_update', playerManager.getGlobalLeaderboard());

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
      if (!player) {
        socket.emit('session_required', {
          code: 'PLAYER_NOT_FOUND',
          reason: 'Sessie verlopen — opnieuw authenticeren...'
        });
        return;
      }

      const result = engine.clearBets(player.id);
      if (!result.success) {
        socket.emit('bet_rejected', {
          code: result.code,
          reason: result.reason
        });
        return;
      }

      // Notify player of new balance
      emitToPlayer(player.id, 'chips_update', {
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

      emitToPlayer(player.id, 'chips_update', { chips: res.fromChips });
      emitToPlayer(player.id, 'bank_update', bankManager.getPlayerBankData(player.id));
      socket.emit('bank_success', { message: `${res.transaction.amount.toLocaleString()} fiches overgemaakt naar ${res.toPlayer.name}.` });

      if (res.toPlayer) {
        emitToPlayer(res.toPlayer.id, 'chips_update', { chips: res.toChips });
        emitToPlayer(res.toPlayer.id, 'bank_update', bankManager.getPlayerBankData(res.toPlayer.id));
        emitToPlayer(res.toPlayer.id, 'bank_notification', {
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

      emitToPlayer(player.id, 'bank_update', bankManager.getPlayerBankData(player.id));
      socket.emit('bank_success', { message: 'Leningvoorstel succesvol verzonden.' });

      const targetPlayer = playerManager.getPlayerById(toPlayerId);
      if (targetPlayer) {
        emitToPlayer(targetPlayer.id, 'bank_update', bankManager.getPlayerBankData(targetPlayer.id));
        const actionText = res.proposal.type === 'borrow' ? 'wil fiches lenen' : 'biedt een lening aan';
        emitToPlayer(targetPlayer.id, 'bank_notification', {
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
        if (res.lender) {
          emitToPlayer(res.lender.id, 'chips_update', { chips: res.lender.chips });
          emitToPlayer(res.lender.id, 'bank_update', bankManager.getPlayerBankData(res.lender.id));
        }
        // Update borrower
        if (res.borrower) {
          emitToPlayer(res.borrower.id, 'chips_update', { chips: res.borrower.chips });
          emitToPlayer(res.borrower.id, 'bank_update', bankManager.getPlayerBankData(res.borrower.id));
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
          if (otherPlayer) {
            emitToPlayer(otherPlayer.id, 'bank_update', bankManager.getPlayerBankData(otherPlayer.id));
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

      emitToPlayer(player.id, 'chips_update', { chips: player.chips });
      emitToPlayer(player.id, 'bank_update', bankManager.getPlayerBankData(player.id));
      socket.emit('bank_success', {
        message: `${res.amountRepaid.toLocaleString()} fiches afgelost.${res.isFullyRepaid ? ' Lening is volledig afbetaald!' : ''}`
      });

      const lender = playerManager.getPlayerById(res.loan.lenderId);
      if (lender) {
        emitToPlayer(lender.id, 'chips_update', { chips: lender.chips });
        emitToPlayer(lender.id, 'bank_update', bankManager.getPlayerBankData(lender.id));
        emitToPlayer(lender.id, 'bank_notification', {
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
      emitToPlayer(player.id, 'bank_update', bankManager.getPlayerBankData(player.id));
      socket.emit('bank_success', { message: 'Lening kwijtgescholden.' });

      const borrower = playerManager.getPlayerById(res.loan.borrowerId);
      if (borrower) {
        emitToPlayer(borrower.id, 'bank_update', bankManager.getPlayerBankData(borrower.id));
        emitToPlayer(borrower.id, 'bank_notification', {
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

    socket.on('leaderboard_get', (payload = {}) => {
      const opts = (payload && typeof payload === 'object') ? payload : {};
      const restoredAny = Array.isArray(opts.leaderboardBackup) && typeof playerManager.restoreLeaderboardBackup === 'function'
        ? playerManager.restoreLeaderboardBackup(opts.leaderboardBackup)
        : false;
      if (restoredAny) {
        io.emit('global_leaderboard_update', playerManager.getGlobalLeaderboard());
      }
      socket.emit('global_leaderboard_update', playerManager.getGlobalLeaderboard({
        playedOnly: opts.playedOnly !== false,
        status: opts.status,
        sortBy: opts.sortBy,
        limit: opts.limit
      }));
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

    function emitNavigationBlocked(targetSocket, player, navCheck) {
      targetSocket.emit('navigation_blocked', {
        code: navCheck.code,
        reason: navCheck.reason || navCheck.message,
        message: navCheck.message,
        game: navCheck.game,
        currentGame: player.currentGame,
        location: player.location,
        amount: navCheck.amount,
        activeBetsTotal: navCheck.amount
      });
    }

    socket.on('player_set_game', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) {
        socket.emit('session_required', {
          code: 'PLAYER_NOT_FOUND',
          reason: 'Sessie verlopen — opnieuw authenticeren...'
        });
        return;
      }

      const navCheck = checkNavigation(player.id);
      if (!navCheck.allowed) {
        emitNavigationBlocked(socket, player, navCheck);
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

      if (player.location !== 'SLOTS') {
        if (slotsEngine.leaveMachine(player.id)) {
          broadcastSlotsFloor();
        }
      } else {
        slotsEngine.ensureMachine(player.id);
        socket.emit('slots_state', slotsEngine.getFloorState(player.id));
        broadcastSlotsFloor();
      }

      if (player.location !== 'HILO') {
        hiloEngine.leaveSalon(player.id);
      } else {
        hiloEngine.joinSalon(player.id);
        socket.emit('hilo_state', hiloEngine.getPublicSalonState(player.id));
      }

      if (player.location !== 'MINES') {
        minesEngine.leaveSalon(player.id);
      } else {
        minesEngine.joinSalon(player.id);
        socket.emit('mines_state', minesEngine.getPublicState(player.id));
      }

      if (player.location !== 'CROSS') {
        crossEngine.leaveSalon(player.id);
      } else {
        crossEngine.joinSalon(player.id);
        socket.emit('cross_state', crossEngine.getPublicState(player.id));
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
      if (!player) {
        socket.emit('session_required', {
          code: 'PLAYER_NOT_FOUND',
          reason: 'Sessie verlopen — opnieuw authenticeren...'
        });
        return;
      }

      const navCheck = checkNavigation(player.id);
      if (!navCheck.allowed) {
        emitNavigationBlocked(socket, player, navCheck);
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

      if (player.location !== 'SLOTS') {
        if (slotsEngine.leaveMachine(player.id)) {
          broadcastSlotsFloor();
        }
      } else {
        slotsEngine.ensureMachine(player.id);
        socket.emit('slots_state', slotsEngine.getFloorState(player.id));
        broadcastSlotsFloor();
      }

      if (player.location !== 'HILO') {
        hiloEngine.leaveSalon(player.id);
      } else {
        hiloEngine.joinSalon(player.id);
        socket.emit('hilo_state', hiloEngine.getPublicSalonState(player.id));
      }

      if (player.location !== 'MINES') {
        minesEngine.leaveSalon(player.id);
      } else {
        minesEngine.joinSalon(player.id);
        socket.emit('mines_state', minesEngine.getPublicState(player.id));
      }

      if (player.location !== 'CROSS') {
        crossEngine.leaveSalon(player.id);
      } else {
        crossEngine.joinSalon(player.id);
        socket.emit('cross_state', crossEngine.getPublicState(player.id));
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
      if (!player) {
        socket.emit('session_required', {
          code: 'PLAYER_NOT_FOUND',
          reason: 'Sessie verlopen — opnieuw authenticeren...'
        });
        return;
      }

      const navCheck = checkNavigation(player.id);
      if (!navCheck.allowed) {
        emitNavigationBlocked(socket, player, navCheck);
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
        emitNavigationBlocked(socket, player, navCheck);
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

    socket.on('crash_cash_out', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) {
        socket.emit('crash_cashout_rejected', {
          code: 'PLAYER_NOT_FOUND',
          reason: 'Speler niet gevonden.'
        });
        return;
      }

      const res = crashEngine.cashOut(player.id, payload);
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

    // 8c. Multiplayer Royal Plinko Protocol
    socket.on('plinko_join', () => {
      socket.emit('plinko_state', plinkoEngine.getState());
    });

    socket.on('plinko_drop', (payload = {}) => {
      if (!checkRateLimit(socket.id, 'plinko_drop', 35, 1000)) {
        const msg = 'Te veel ballen tegelijk — wacht een momentje.';
        socket.emit('plinko_drop_rejected', { code: 'RATE_LIMITED', reason: msg });
        socket.emit('error_msg', { code: 'RATE_LIMITED', message: msg });
        return;
      }

      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) {
        const msg = 'Log eerst in om Plinko te spelen.';
        socket.emit('plinko_drop_rejected', { code: 'PLAYER_NOT_FOUND', reason: msg });
        socket.emit('error_msg', { code: 'PLAYER_NOT_FOUND', message: msg });
        return;
      }

      const res = plinkoEngine.dropBalls(player.id, payload);
      if (!res.ok) {
        socket.emit('plinko_drop_rejected', { code: res.code, reason: res.error });
        socket.emit('error_msg', { code: res.code, message: res.error });
        return;
      }

      socket.emit('plinko_drop_accepted', {
        drops: res.drops,
        totalBet: res.totalBet,
        totalPayout: res.totalPayout,
        netProfit: res.netProfit,
        newChips: res.newChips,
        stats: res.stats
      });

      io.emit('plinko_ball_dropped', {
        drops: res.drops,
        recentDrops: res.recentDrops
      });

      emitToPlayer(player.id, 'chips_update', { chips: res.newChips, source: 'plinko' });
      broadcastPlayersUpdate();

      if (Array.isArray(res.repayments) && res.repayments.length > 0) {
        res.repayments.forEach((rep) => {
          broadcastChatMessage({
            sender: 'BANK',
            color: '#10b981',
            text: `[BANK] ${player.name} heeft ${rep.amount.toLocaleString()} fiches afgelost aan ${rep.lenderName} via winstinhouding.${rep.isFullyRepaid ? ' (Schuld volledig voldaan!)' : ''}`,
            timestamp: Date.now(),
            isSystem: true,
            scope: 'table',
            table: 'plinko'
          });

          const lender = playerManager.getPlayerById(rep.lenderId);
          if (lender) {
            emitToPlayer(lender.id, 'chips_update', { chips: lender.chips });
            emitToPlayer(lender.id, 'bank_update', bankManager.getPlayerBankData(lender.id));
          }
          emitToPlayer(player.id, 'bank_update', bankManager.getPlayerBankData(player.id));
        });
      }

      // Announce notable multipliers (>= 10x) or large net profit (>= 2500)
      if (Array.isArray(res.drops) && res.drops.length > 0) {
        const bestDrop = res.drops.reduce((best, cur) => (cur.payout > best.payout ? cur : best), res.drops[0]);
        if (bestDrop.multiplier >= 10 || bestDrop.profit >= 2500) {
          const isGrand = bestDrop.multiplier >= 50 || bestDrop.profit >= 5000;
          broadcastChatMessage({
            sender: 'CASINO',
            color: '#d4af37',
            text: `[PLINKO] ${player.name} raakte ${bestDrop.multiplier}x en won ${bestDrop.payout.toLocaleString()} fiches!`,
            timestamp: Date.now(),
            isSystem: true,
            scope: 'table',
            table: 'plinko'
          });
          broadcastChatMessage({
            sender: 'CASINO',
            color: '#d4af37',
            text: isGrand
              ? `[GRAND WIN] ${player.name} raakte ${bestDrop.multiplier}x bij Royal Plinko (+${bestDrop.profit.toLocaleString()} fiches)!`
              : `[PLINKO] ${player.name} raakte ${bestDrop.multiplier}x bij Royal Plinko (+${bestDrop.profit.toLocaleString()} fiches)!`,
            timestamp: Date.now(),
            isSystem: true,
            scope: 'global',
            table: 'all'
          });
        }
      }
    });

    // 8c-2. Single-Player AviaMasters Arcade Flight Protocol
    socket.on('avia_join', () => {
      socket.emit('avia_state', aviaEngine.getState());
    });

    socket.on('avia_fly', (payload = {}) => {
      if (!checkRateLimit(socket.id, 'avia_fly', 10, 2000)) {
        const msg = 'Te snel achter elkaar opstijgen — wacht een momentje.';
        socket.emit('avia_fly_rejected', { code: 'RATE_LIMITED', reason: msg });
        socket.emit('error_msg', { code: 'RATE_LIMITED', message: msg });
        return;
      }

      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) {
        const msg = 'Log eerst in om AviaMasters te spelen.';
        socket.emit('avia_fly_rejected', { code: 'PLAYER_NOT_FOUND', reason: msg });
        socket.emit('error_msg', { code: 'PLAYER_NOT_FOUND', message: msg });
        return;
      }

      const res = aviaEngine.startFlight(player.id, payload || {});
      if (!res.ok) {
        socket.emit('avia_fly_rejected', { code: res.code, reason: res.error });
        socket.emit('error_msg', { code: res.code, message: res.error });
        return;
      }

      socket.emit('avia_fly_accepted', {
        flight: res.flight,
        newChips: res.newChips,
        stats: res.stats,
        recentFlights: res.recentFlights
      });

      io.emit('avia_flight_logged', {
        recentFlights: res.recentFlights
      });

      emitToPlayer(player.id, 'chips_update', {
        chips: res.newChips,
        source: 'avia',
        aviaDelayed: true
      });
      broadcastPlayersUpdate();
      io.emit('global_leaderboard_update', playerManager.getGlobalLeaderboard());

      if (Array.isArray(res.repayments) && res.repayments.length > 0) {
        res.repayments.forEach((rep) => {
          broadcastChatMessage({
            sender: 'BANK',
            color: '#10b981',
            text: `[BANK] ${player.name} heeft ${rep.amount.toLocaleString()} fiches afgelost aan ${rep.lenderName} via winstinhouding.${rep.isFullyRepaid ? ' (Schuld volledig voldaan!)' : ''}`,
            timestamp: Date.now(),
            isSystem: true,
            scope: 'table',
            table: 'avia'
          });

          const lender = playerManager.getPlayerById(rep.lenderId);
          if (lender) {
            emitToPlayer(lender.id, 'chips_update', { chips: lender.chips });
            emitToPlayer(lender.id, 'bank_update', bankManager.getPlayerBankData(lender.id));
          }
          emitToPlayer(player.id, 'bank_update', bankManager.getPlayerBankData(player.id));
        });
      }

      if (res.flight.landed && (res.flight.finalMultiplier >= 12 || res.flight.profit >= 2500)) {
        const isMega = res.flight.finalMultiplier >= 40 || res.flight.profit >= 10000;
        broadcastChatMessage({
          sender: 'CASINO',
          color: '#d4af37',
          text: isMega
            ? `[AIR WING] ${player.name} landde ${res.flight.finalMultiplier}x bij AviaMasters (+${res.flight.profit.toLocaleString()} fiches)!`
            : `[AVIAMASTERS] ${player.name} pakte een ${res.flight.finalMultiplier}x landing (+${res.flight.profit.toLocaleString()} fiches)!`,
          timestamp: Date.now(),
          isSystem: true,
          scope: 'global',
          table: 'all'
        });
      }
    });

    // 8d. Multiplayer Grand Sovereign Slots Protocol
    socket.on('slots_join', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      let changed = false;
      if (player) {
        const preferredId = payload && payload.machineId ? Number(payload.machineId) : null;
        const seatRes = slotsEngine.ensureMachine(player.id, preferredId);
        if (seatRes.ok) changed = true;
      }
      socket.emit('slots_state', slotsEngine.getFloorState(player ? player.id : null));
      if (changed) {
        broadcastSlotsFloor();
      }
    });

    socket.on('slots_select_machine', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) {
        const msg = 'Log eerst in om een gokkast te kiezen.';
        socket.emit('slots_spin_rejected', { code: 'PLAYER_NOT_FOUND', reason: msg });
        socket.emit('error_msg', { code: 'PLAYER_NOT_FOUND', message: msg });
        return;
      }

      const res = slotsEngine.selectMachine(player.id, payload && payload.machineId);
      if (!res.ok) {
        socket.emit('slots_spin_rejected', { code: res.code, reason: res.error });
        socket.emit('error_msg', { code: res.code, message: res.error });
        return;
      }

      socket.emit('slots_state', slotsEngine.getFloorState(player.id));
      broadcastSlotsFloor();
    });

    socket.on('slots_spin', (payload = {}) => {
      if (!checkRateLimit(socket.id, 'slots_spin', 15, 1000)) {
        const msg = 'Te veel draaien tegelijk — wacht een momentje.';
        socket.emit('slots_spin_rejected', { code: 'RATE_LIMITED', reason: msg });
        socket.emit('error_msg', { code: 'RATE_LIMITED', message: msg });
        return;
      }

      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) {
        const msg = 'Log eerst in om Slots te spelen.';
        socket.emit('slots_spin_rejected', { code: 'PLAYER_NOT_FOUND', reason: msg });
        socket.emit('error_msg', { code: 'PLAYER_NOT_FOUND', message: msg });
        return;
      }

      const res = slotsEngine.spin(player.id, payload);
      if (!res.ok) {
        socket.emit('slots_spin_rejected', { code: res.code, reason: res.error });
        socket.emit('error_msg', { code: res.code, message: res.error });
        return;
      }

      socket.emit('slots_spin_result', res);
      emitToPlayer(player.id, 'chips_update', { chips: res.newChips, source: 'slots' });
      broadcastPlayersUpdate();
      broadcastSlotsFloor();

      if (Array.isArray(res.repayments) && res.repayments.length > 0) {
        res.repayments.forEach((rep) => {
          broadcastChatMessage({
            sender: 'BANK',
            color: '#10b981',
            text: `[BANK] ${player.name} heeft ${rep.amount.toLocaleString()} fiches afgelost aan ${rep.lenderName} via winstinhouding.${rep.isFullyRepaid ? ' (Schuld volledig voldaan!)' : ''}`,
            timestamp: Date.now(),
            isSystem: true,
            scope: 'table',
            table: 'slots'
          });

          const lender = playerManager.getPlayerById(rep.lenderId);
          if (lender) {
            emitToPlayer(lender.id, 'chips_update', { chips: lender.chips });
            emitToPlayer(lender.id, 'bank_update', bankManager.getPlayerBankData(lender.id));
          }
          emitToPlayer(player.id, 'bank_update', bankManager.getPlayerBankData(player.id));
        });
      }

      if (res.jackpotWon > 0 || res.payoutMultiplier >= 10 || res.totalPayout >= 2500) {
        const bigWinEvent = {
          id: res.spinId,
          playerId: player.id,
          playerName: player.name,
          playerColor: res.playerColor || '#D4AF37',
          machineId: res.machineId,
          bet: res.bet,
          winAmount: res.totalPayout,
          multiplier: res.payoutMultiplier,
          winTier: res.winTier,
          jackpotWon: res.jackpotWon,
          timestamp: Date.now()
        };
        io.emit('slots_big_win', bigWinEvent);

        const isJackpot = res.jackpotWon > 0;
        const isMega = res.winTier === 'MEGA_WIN' || res.payoutMultiplier >= 50;
        broadcastChatMessage({
          sender: 'CASINO',
          color: '#d4af37',
          text: isJackpot
            ? `[JACKPOT] ${player.name} won de GRAND JACKPOT van ${res.jackpotWon.toLocaleString()} fiches op Kast #${res.machineId}!`
            : `[SLOTS] ${player.name} pakte ${res.payoutMultiplier}x (${res.totalPayout.toLocaleString()} fiches) op Kast #${res.machineId}!`,
          timestamp: Date.now(),
          isSystem: true,
          scope: 'table',
          table: 'slots'
        });
        broadcastChatMessage({
          sender: 'CASINO',
          color: '#d4af37',
          text: isJackpot
            ? `[GRAND JACKPOT] ${player.name} sloeg toe bij Grand Sovereign Slots en won ${res.totalPayout.toLocaleString()} fiches!`
            : (isMega
              ? `[MEGA WIN] ${player.name} won ${res.payoutMultiplier}x (${res.totalPayout.toLocaleString()} fiches) bij Grand Sovereign Slots!`
              : `[SLOTS] ${player.name} won ${res.totalPayout.toLocaleString()} fiches (${res.payoutMultiplier}x) bij Grand Sovereign Slots!`),
          timestamp: Date.now(),
          isSystem: true,
          scope: 'global',
          table: 'all'
        });
      }
    });

    // 8e. Multiplayer Monaco Turf Club (Horse Racing) Protocol
    socket.on('racing_join', () => {
      const player = playerManager.getPlayerBySocket(socket.id);
      socket.emit('racing_state', racingEngine.getPublicState(player ? player.id : null));
    });

    socket.on('racing_place_bet', (payload = {}) => {
      if (!checkRateLimit(socket.id, 'racing_place_bet', 12, 2000)) {
        const msg = 'Je plaatst te snel tickets achter elkaar. Wacht even.';
        socket.emit('racing_bet_rejected', { code: 'RATE_LIMITED', reason: msg });
        socket.emit('error_msg', { code: 'RATE_LIMITED', message: msg });
        return;
      }

      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) {
        const msg = 'Log eerst in om in te zetten op Paardracen.';
        socket.emit('racing_bet_rejected', { code: 'PLAYER_NOT_FOUND', reason: msg });
        socket.emit('error_msg', { code: 'PLAYER_NOT_FOUND', message: msg });
        return;
      }

      const res = racingEngine.placeBet(player.id, payload);
      if (!res.ok) {
        socket.emit('racing_bet_rejected', { code: res.code, reason: res.error });
        socket.emit('error_msg', { code: res.code, message: res.error });
        return;
      }

      socket.emit('racing_bet_accepted', {
        ticket: res.ticket,
        newChips: res.newChips,
        tickets: res.tickets,
        phase: res.phase,
        timeLeft: res.timeLeft,
        winnerPot: res.winnerPot,
        totalRacePool: res.totalRacePool
      });
      emitToPlayer(player.id, 'chips_update', { chips: res.newChips, source: 'racing' });
    });

    socket.on('racing_cancel_bet', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) {
        socket.emit('racing_bet_rejected', { code: 'PLAYER_NOT_FOUND', reason: 'Log eerst in.' });
        return;
      }

      const ticketId = payload && typeof payload.ticketId === 'string' ? payload.ticketId : '';
      const res = racingEngine.cancelBet(player.id, ticketId);
      if (!res.ok) {
        socket.emit('racing_bet_rejected', { code: res.code, reason: res.error });
        socket.emit('error_msg', { code: res.code, message: res.error });
        return;
      }

      socket.emit('racing_bet_cancelled_self', {
        cancelledTicket: res.cancelledTicket,
        newChips: res.newChips,
        tickets: res.tickets,
        phase: res.phase,
        timeLeft: res.timeLeft,
        winnerPot: res.winnerPot,
        totalRacePool: res.totalRacePool
      });
      emitToPlayer(player.id, 'chips_update', { chips: res.newChips, source: 'racing' });
    });

    socket.on('racing_cheer', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) {
        socket.emit('racing_cheer_rejected', { code: 'PLAYER_NOT_FOUND', reason: 'Log eerst in om een paard aan te moedigen.' });
        socket.emit('error_msg', { code: 'PLAYER_NOT_FOUND', message: 'Log eerst in om een paard aan te moedigen.' });
        return;
      }

      const res = racingEngine.cheerHorse(player.id, payload && payload.horseId);
      if (!res.ok) {
        socket.emit('racing_cheer_rejected', { code: res.code, reason: res.error });
        return;
      }
    });

    // 8f. Monte Carlo Hi-Lo Prive Protocol
    function requireHiloPlayer(rejectEvent, actionDesc) {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) {
        const msg = `Log eerst in om ${actionDesc}.`;
        socket.emit(rejectEvent, { code: 'PLAYER_NOT_FOUND', reason: msg });
        socket.emit('error_msg', { code: 'PLAYER_NOT_FOUND', message: msg });
        return null;
      }
      return player;
    }

    socket.on('hilo_join', () => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (player) hiloEngine.joinSalon(player.id);
      socket.emit('hilo_state', hiloEngine.getPublicSalonState(player ? player.id : null));
    });

    socket.on('hilo_start', (payload = {}) => {
      if (!checkRateLimit(socket.id, 'hilo_action', 16, 2000)) {
        const msg = 'Je speelt iets te snel. Wacht heel even.';
        socket.emit('hilo_rejected', { code: 'RATE_LIMITED', reason: msg });
        return;
      }
      const player = requireHiloPlayer('hilo_rejected', 'Hi-Lo te starten');
      if (!player) return;

      const res = hiloEngine.startLadder(player.id, payload && payload.betAmount);
      if (!res.ok) {
        socket.emit('hilo_rejected', { code: res.code, reason: res.message });
        socket.emit('error_msg', { code: res.code, message: res.message });
        return;
      }
      socket.emit('hilo_started', res);
      emitToPlayer(player.id, 'chips_update', { chips: res.newChips, source: 'hilo' });
      broadcastPlayersUpdate();
    });

    socket.on('hilo_guess', (payload = {}) => {
      if (!checkRateLimit(socket.id, 'hilo_action', 16, 2000)) {
        socket.emit('hilo_rejected', { code: 'RATE_LIMITED', reason: 'Je speelt iets te snel. Wacht heel even.' });
        return;
      }
      const player = requireHiloPlayer('hilo_rejected', 'een kaartkeuze te maken');
      if (!player) return;

      const res = hiloEngine.makeGuess(player.id, payload && payload.prediction);
      if (!res.ok) {
        socket.emit('hilo_rejected', { code: res.code, reason: res.message });
        socket.emit('error_msg', { code: res.code, message: res.message });
        return;
      }
      socket.emit('hilo_guess_result', res);
      if (!res.won) {
        broadcastPlayersUpdate();
      }
    });

    socket.on('hilo_skip', () => {
      const player = requireHiloPlayer('hilo_rejected', 'een kaart te wisselen');
      if (!player) return;
      const res = hiloEngine.skipCard(player.id);
      if (!res.ok) {
        socket.emit('hilo_rejected', { code: res.code, reason: res.message });
        socket.emit('error_msg', { code: res.code, message: res.message });
        return;
      }
      socket.emit('hilo_skipped', res);
    });

    socket.on('hilo_half_cashout', () => {
      const player = requireHiloPlayer('hilo_rejected', '50% uit te cashen');
      if (!player) return;
      const res = hiloEngine.halfCashout(player.id);
      if (!res.ok) {
        socket.emit('hilo_rejected', { code: res.code, reason: res.message });
        socket.emit('error_msg', { code: res.code, message: res.message });
        return;
      }
      socket.emit('hilo_half_cashout_result', res);
      emitToPlayer(player.id, 'chips_update', { chips: res.newChips, source: 'hilo' });
      emitHiloRepayments(player.id, player.name, res.repayments, 'Hi-Lo Privé');
      broadcastPlayersUpdate();
    });

    socket.on('hilo_cashout', () => {
      const player = requireHiloPlayer('hilo_rejected', 'uit te betalen');
      if (!player) return;
      const res = hiloEngine.cashout(player.id);
      if (!res.ok) {
        socket.emit('hilo_rejected', { code: res.code, reason: res.message });
        socket.emit('error_msg', { code: res.code, message: res.message });
        return;
      }
      socket.emit('hilo_cashout_result', res);
      emitToPlayer(player.id, 'chips_update', { chips: res.newChips, source: 'hilo' });
      emitHiloRepayments(player.id, player.name, res.repayments, 'Hi-Lo Privé');
      broadcastPlayersUpdate();
    });

    // 8g. Royal Mines Vault Protocol (Solo + Multiplayer Shared Vault)
    function requireMinesPlayer(rejectEvent, actionDesc) {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) {
        const msg = `Log eerst in om ${actionDesc}.`;
        socket.emit(rejectEvent, { code: 'PLAYER_NOT_FOUND', reason: msg });
        socket.emit('error_msg', { code: 'PLAYER_NOT_FOUND', message: msg });
        return null;
      }
      return player;
    }

    socket.on('mines_join', () => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (player) minesEngine.joinSalon(player.id);
      socket.emit('mines_state', minesEngine.getPublicState(player ? player.id : null));
    });

    socket.on('mines_solo_start', (payload = {}) => {
      if (!checkRateLimit(socket.id, 'mines_action', 16, 2000)) {
        socket.emit('mines_rejected', { code: 'RATE_LIMITED', reason: 'Je speelt iets te snel.' });
        return;
      }
      const player = requireMinesPlayer('mines_rejected', 'een Solo Kluis te starten');
      if (!player) return;
      const res = minesEngine.startSolo(player.id, payload || {});
      if (!res.ok) {
        socket.emit('mines_rejected', { code: res.code, reason: res.message });
        socket.emit('error_msg', { code: res.code, message: res.message });
        return;
      }
      socket.emit('mines_solo_started', res);
      emitToPlayer(player.id, 'chips_update', { chips: res.newChips, source: 'mines' });
      broadcastPlayersUpdate();
    });

    socket.on('mines_solo_click', (payload = {}) => {
      if (!checkRateLimit(socket.id, 'mines_action', 24, 2000)) {
        socket.emit('mines_rejected', { code: 'RATE_LIMITED', reason: 'Je klikt iets te snel.' });
        return;
      }
      const player = requireMinesPlayer('mines_rejected', 'een vakje te openen');
      if (!player) return;
      const res = minesEngine.clickSoloTile(player.id, payload && payload.tileIndex);
      if (!res.ok) {
        socket.emit('mines_rejected', { code: res.code, reason: res.message });
        socket.emit('error_msg', { code: res.code, message: res.message });
        return;
      }
      socket.emit('mines_solo_result', res);
      if (res.outcome === 'GRAND_CLEAR') {
        emitToPlayer(player.id, 'chips_update', { chips: res.newChips, source: 'mines' });
        emitMinesRepayments(player.id, player.name, res.repayments, 'Solo Mines');
      }
      if (res.outcome === 'MINE' || res.outcome === 'GRAND_CLEAR') {
        broadcastPlayersUpdate();
      }
    });

    socket.on('mines_solo_cashout', () => {
      const player = requireMinesPlayer('mines_rejected', 'uit te cashen');
      if (!player) return;
      const res = minesEngine.cashoutSolo(player.id);
      if (!res.ok) {
        socket.emit('mines_rejected', { code: res.code, reason: res.message });
        socket.emit('error_msg', { code: res.code, message: res.message });
        return;
      }
      socket.emit('mines_solo_result', res);
      emitToPlayer(player.id, 'chips_update', { chips: res.newChips, source: 'mines' });
      emitMinesRepayments(player.id, player.name, res.repayments, 'Solo Mines');
      broadcastPlayersUpdate();
    });

    socket.on('mines_shared_vote', (payload = {}) => {
      const player = requireMinesPlayer('mines_rejected', 'op bordinstellingen te stemmen');
      if (!player) return;
      const res = minesEngine.voteSharedSettings(player.id, payload || {});
      if (!res.ok) {
        socket.emit('mines_rejected', { code: res.code, reason: res.message });
        return;
      }
      socket.emit('mines_shared_vote_ack', res);
    });

    socket.on('mines_shared_join', (payload = {}) => {
      if (!checkRateLimit(socket.id, 'mines_action', 16, 2000)) {
        socket.emit('mines_rejected', { code: 'RATE_LIMITED', reason: 'Je speelt iets te snel.' });
        return;
      }
      const player = requireMinesPlayer('mines_rejected', 'mee te doen aan de Shared Vault');
      if (!player) return;
      const res = minesEngine.joinShared(player.id, payload || {});
      if (!res.ok) {
        socket.emit('mines_rejected', { code: res.code, reason: res.message });
        socket.emit('error_msg', { code: res.code, message: res.message });
        return;
      }
      socket.emit('mines_shared_joined', res);
      emitToPlayer(player.id, 'chips_update', { chips: res.newChips, source: 'mines_shared' });
      broadcastPlayersUpdate();
    });

    socket.on('mines_shared_cancel', () => {
      const player = requireMinesPlayer('mines_rejected', 'inzet te annuleren');
      if (!player) return;
      const res = minesEngine.cancelSharedBet(player.id);
      if (!res.ok) {
        socket.emit('mines_rejected', { code: res.code, reason: res.message });
        socket.emit('error_msg', { code: res.code, message: res.message });
        return;
      }
      socket.emit('mines_shared_cancelled', res);
      emitToPlayer(player.id, 'chips_update', { chips: res.newChips, source: 'mines_shared' });
      broadcastPlayersUpdate();
    });

    socket.on('mines_shared_click', (payload = {}) => {
      if (!checkRateLimit(socket.id, 'mines_action', 24, 2000)) {
        socket.emit('mines_rejected', { code: 'RATE_LIMITED', reason: 'Je klikt iets te snel.' });
        return;
      }
      const player = requireMinesPlayer('mines_rejected', 'een vakje te klikken');
      if (!player) return;
      const res = minesEngine.clickSharedTile(player.id, payload && payload.tileIndex);
      if (!res.ok) {
        socket.emit('mines_rejected', { code: res.code, reason: res.message });
        socket.emit('error_msg', { code: res.code, message: res.message });
        return;
      }
      socket.emit('mines_shared_click_ack', res);
    });

    socket.on('mines_shared_cashout', () => {
      const player = requireMinesPlayer('mines_rejected', 'uit te cashen');
      if (!player) return;
      const res = minesEngine.cashoutShared(player.id);
      if (!res.ok) {
        socket.emit('mines_rejected', { code: res.code, reason: res.message });
        socket.emit('error_msg', { code: res.code, message: res.message });
        return;
      }
      socket.emit('mines_shared_cashout_ack', res);
    });

    // -----------------------------------------------------------------------
    // 8h. Monte Carlo Boulevard Cross Protocol
    // -----------------------------------------------------------------------
    function requireCrossPlayer(rejectEvent, actionLabel) {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) {
        const reason = `Log eerst in om ${actionLabel}.`;
        socket.emit(rejectEvent, { code: 'PLAYER_NOT_FOUND', reason });
        socket.emit('error_msg', { code: 'PLAYER_NOT_FOUND', message: reason });
        return null;
      }
      return player;
    }

    socket.on('cross_join', () => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (player) {
        crossEngine.joinSalon(player.id);
        socket.emit('cross_state', crossEngine.getPublicState(player.id));
      } else {
        socket.emit('cross_state', crossEngine.getPublicState(null));
      }
    });

    socket.on('cross_start', (payload = {}) => {
      if (!checkRateLimit(socket.id, 'cross_action', 18, 2000)) {
        const reason = 'Rustig aan — je start te snel achter elkaar.';
        socket.emit('cross_rejected', { code: 'RATE_LIMITED', reason });
        socket.emit('error_msg', { code: 'RATE_LIMITED', message: reason });
        return;
      }
      const player = requireCrossPlayer('cross_rejected', 'een Boulevard oversteek te starten');
      if (!player) return;

      const res = crossEngine.startRun(player.id, payload);
      if (!res.ok) {
        socket.emit('cross_rejected', { code: res.code, reason: res.message });
        socket.emit('error_msg', { code: res.code, message: res.message });
        return;
      }

      socket.emit('cross_started', res);
      if (typeof res.newChips === 'number') {
        socket.emit('chips_update', { chips: res.newChips, source: 'cross_start' });
      }
      broadcastPlayersUpdate();
    });

    socket.on('cross_step', () => {
      if (!checkRateLimit(socket.id, 'cross_action', 18, 2000)) {
        const reason = 'Rustig aan — te veel stappen tegelijk.';
        socket.emit('cross_rejected', { code: 'RATE_LIMITED', reason });
        socket.emit('error_msg', { code: 'RATE_LIMITED', message: reason });
        return;
      }
      const player = requireCrossPlayer('cross_rejected', 'vooruit te stappen');
      if (!player) return;

      const res = crossEngine.stepForward(player.id);
      if (!res.ok) {
        socket.emit('cross_rejected', { code: res.code, reason: res.message });
        socket.emit('error_msg', { code: res.code, message: res.message });
        return;
      }

      socket.emit('cross_step_result', res);
      if (res.hit || res.autoCashedOut) {
        if (typeof res.newChips === 'number') {
          socket.emit('chips_update', { chips: res.newChips, source: res.hit ? 'cross_hit' : 'cross_cap_cashout' });
        }
        if (Array.isArray(res.repayments) && res.repayments.length > 0) {
          emitCrossRepayments(player.id, player.name, res.repayments, 'Boulevard Cross');
        }
        broadcastPlayersUpdate();
      }
    });

    socket.on('cross_cashout', () => {
      if (!checkRateLimit(socket.id, 'cross_action', 18, 2000)) {
        const reason = 'Rustig aan — te veel acties tegelijk.';
        socket.emit('cross_rejected', { code: 'RATE_LIMITED', reason });
        socket.emit('error_msg', { code: 'RATE_LIMITED', message: reason });
        return;
      }
      const player = requireCrossPlayer('cross_rejected', 'uit te cashen');
      if (!player) return;

      const res = crossEngine.cashout(player.id);
      if (!res.ok) {
        socket.emit('cross_rejected', { code: res.code, reason: res.message });
        socket.emit('error_msg', { code: res.code, message: res.message });
        return;
      }

      socket.emit('cross_cashout_result', res);
      socket.emit('chips_update', { chips: res.newChips, source: 'cross_cashout' });
      emitCrossRepayments(player.id, player.name, res.repayments, 'Boulevard Cross');
      broadcastPlayersUpdate();
    });

    // -----------------------------------------------------------------------
    // 8d-2. Monte Carlo Kluizenroof (Multiplayer Elimination Vault Doors)
    // -----------------------------------------------------------------------
    function requireVaultsPlayer(errorEvent, actionDesc) {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) {
        const reason = `Log eerst in om ${actionDesc}.`;
        socket.emit(errorEvent, { code: 'PLAYER_NOT_FOUND', reason });
        socket.emit('error_msg', { code: 'PLAYER_NOT_FOUND', message: reason });
        return null;
      }
      return player;
    }

    socket.on('vaults_join', () => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (player) {
        vaultsEngine.joinSalon(player);
      }
      socket.emit('vaults_state', vaultsEngine.getPublicState(player ? player.id : null));
    });

    socket.on('vaults_leave', () => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (player) {
        vaultsEngine.leaveSalon(player.id);
      }
    });

    socket.on('vaults_set_stake', (payload = {}) => {
      if (!checkRateLimit(socket.id, 'vaults_action', 12, 2000)) {
        const reason = 'Rustig aan — te veel acties tegelijk.';
        socket.emit('vaults_rejected', { code: 'RATE_LIMITED', reason });
        return;
      }
      const player = requireVaultsPlayer('vaults_rejected', 'de inzet aan te passen');
      if (!player) return;

      const prevChips = player.chips;
      const res = vaultsEngine.setStake(player.id, payload && payload.stake);
      if (!res.ok) {
        socket.emit('vaults_rejected', { code: res.code, reason: res.message });
        socket.emit('error_msg', { code: res.code, message: res.message });
        return;
      }
      if (typeof res.remainingChips === 'number' && res.remainingChips !== prevChips) {
        socket.emit('chips_update', { chips: res.remainingChips, source: 'vaults_stake' });
        broadcastPlayersUpdate();
      }
    });

    socket.on('vaults_join_pot', (payload = {}) => {
      if (!checkRateLimit(socket.id, 'vaults_action', 12, 2000)) {
        const reason = 'Rustig aan — te veel acties tegelijk.';
        socket.emit('vaults_rejected', { code: 'RATE_LIMITED', reason });
        return;
      }
      const player = requireVaultsPlayer('vaults_rejected', 'mee te doen aan de Kluizenroof');
      if (!player) return;

      vaultsEngine.joinSalon(player);
      const res = vaultsEngine.joinMatch(player.id, payload && payload.stake);
      if (!res.ok) {
        socket.emit('vaults_rejected', { code: res.code, reason: res.message });
        socket.emit('error_msg', { code: res.code, message: res.message });
        return;
      }
      socket.emit('vaults_joined', { stake: res.stake, remainingChips: res.remainingChips });
      socket.emit('chips_update', { chips: res.remainingChips, source: 'vaults_join' });
      broadcastPlayersUpdate();
    });

    socket.on('vaults_leave_pot', () => {
      if (!checkRateLimit(socket.id, 'vaults_action', 12, 2000)) {
        return;
      }
      const player = requireVaultsPlayer('vaults_rejected', 'de pot te verlaten');
      if (!player) return;

      const res = vaultsEngine.leaveMatch(player.id);
      if (!res.ok) {
        socket.emit('vaults_rejected', { code: res.code, reason: res.message });
        socket.emit('error_msg', { code: res.code, message: res.message });
        return;
      }
      if (typeof res.remainingChips === 'number') {
        socket.emit('chips_update', { chips: res.remainingChips, source: 'vaults_refund' });
      }
      broadcastPlayersUpdate();
    });

    socket.on('vaults_ready', () => {
      if (!checkRateLimit(socket.id, 'vaults_action', 12, 2000)) return;
      const player = requireVaultsPlayer('vaults_rejected', 'klaar te melden');
      if (!player) return;

      const res = vaultsEngine.markReady(player.id);
      if (!res.ok) {
        socket.emit('vaults_rejected', { code: res.code, reason: res.message });
      }
    });

    socket.on('vaults_pick_door', (payload = {}) => {
      if (!checkRateLimit(socket.id, 'vaults_action', 18, 2000)) {
        socket.emit('vaults_rejected', { code: 'RATE_LIMITED', reason: 'Rustig aan — te veel acties tegelijk.' });
        return;
      }
      const player = requireVaultsPlayer('vaults_rejected', 'een kluisdeur te kiezen');
      if (!player) return;

      const res = vaultsEngine.pickDoor(player.id, payload && payload.doorIndex);
      if (!res.ok) {
        socket.emit('vaults_rejected', { code: res.code, reason: res.message });
        socket.emit('error_msg', { code: res.code, message: res.message });
      }
    });

    // -----------------------------------------------------------------------
    // 8e. Casino Staatsloterij (10-minute cycle, 0% rake)
    // -----------------------------------------------------------------------
    socket.on('lottery_get_state', () => {
      const player = playerManager.getPlayerBySocket(socket.id);
      socket.emit('lottery_state', lotteryEngine.getPublicState(player ? player.id : null));
    });

    socket.on('lottery_ack_offline_win', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) return;
      if (typeof lotteryEngine.acknowledgeOfflineWin === 'function') {
        lotteryEngine.acknowledgeOfflineWin(player.id, player.name, payload && payload.roundId);
      }
    });

    socket.on('lottery_ack_offline_outcome', (payload = {}) => {
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) return;
      if (typeof lotteryEngine.acknowledgeOfflineOutcome === 'function') {
        lotteryEngine.acknowledgeOfflineOutcome(player.id, player.name, payload && payload.roundId);
      }
    });

    socket.on('lottery_buy_tickets', (payload = {}) => {
      if (!checkRateLimit(socket.id, 'lottery_buy', 8, 4000)) {
        const msg = 'Rustig aan — je koopt te snel loten achter elkaar.';
        socket.emit('lottery_rejected', { code: 'RATE_LIMITED', reason: msg });
        return;
      }
      const player = playerManager.getPlayerBySocket(socket.id);
      if (!player) {
        const reason = 'Log eerst in om Staatsloterij-loten te kopen.';
        socket.emit('lottery_rejected', { code: 'PLAYER_NOT_FOUND', reason });
        socket.emit('error_msg', { code: 'PLAYER_NOT_FOUND', message: reason });
        return;
      }

      const res = lotteryEngine.buyTickets(player.id, payload && payload.count);
      if (!res.ok) {
        socket.emit('lottery_rejected', { code: res.code, reason: res.message });
        socket.emit('error_msg', { code: res.code, message: res.message });
        return;
      }

      const totalPayout = Number(res.totalPayout) || 0;
      const preWinChips = Math.max(0, res.remainingChips - totalPayout);
      socket.emit('chips_update', {
        chips: res.remainingChips,
        preWinChips,
        totalPayout,
        source: 'lottery'
      });
      if (Array.isArray(res.repayments) && res.repayments.length > 0) {
        emitToPlayer(player.id, 'bank_update', bankManager.getPlayerBankData(player.id));
      }
      socket.emit('lottery_buy_ack', {
        ok: true,
        roundId: res.roundId,
        roundEndsAt: res.roundEndsAt,
        playerId: res.playerId || player.id,
        playerName: res.playerName || player.name,
        count: res.count,
        totalCost: res.totalCost,
        totalPayout: res.totalPayout || 0,
        netProfit: res.netProfit || 0,
        pot: res.pot,
        startTicket: res.startTicket,
        endTicket: res.endTicket,
        totalTickets: res.totalTickets,
        remainingChips: res.remainingChips,
        stats: res.stats || null,
        ticket: res.ticket || null,
        tickets: res.tickets || [],
        repayments: res.repayments || [],
        mySummary: res.mySummary
      });
      socket.emit('lottery_state', res.state);
      emitPersonalizedLotteryStates();
      broadcastPlayersUpdate();
    });

    // 9. disconnect
    socket.on('disconnect', () => {
      rateLimitBuckets.delete(`${socket.id}:plinko_drop`);
      rateLimitBuckets.delete(`${socket.id}:avia_fly`);
      rateLimitBuckets.delete(`${socket.id}:slots_spin`);
      rateLimitBuckets.delete(`${socket.id}:racing_place_bet`);
      rateLimitBuckets.delete(`${socket.id}:hilo_action`);
      rateLimitBuckets.delete(`${socket.id}:mines_action`);
      rateLimitBuckets.delete(`${socket.id}:cross_action`);
      rateLimitBuckets.delete(`${socket.id}:vaults_action`);
      rateLimitBuckets.delete(`${socket.id}:lottery_buy`);
      const player = playerManager.disconnectPlayer(socket.id);
      if (player) {
        hiloEngine.leaveSalon(player.id);
        minesEngine.leaveSalon(player.id);
        crossEngine.leaveSalon(player.id);
        vaultsEngine.handleDisconnect(player.id);
        if (slotsEngine.leaveMachine(player.id)) {
          broadcastSlotsFloor();
        }
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
    plinkoEngine,
    slotsEngine,
    racingEngine,
    hiloEngine,
    minesEngine,
    crossEngine,
    vaultsEngine,
    lotteryEngine,
    canPlayerNavigate: checkNavigation,
    broadcastChatMessage,
    notifyServerUpdating: (reason) => {
      io.emit('server_updating', {
        ...getVersionInfo(),
        message: reason || 'Nieuwe casino-update wordt geladen...'
      });
    },
    stop: () => {
      clearInterval(versionWatchTimer);
      engine.stop();
      crashEngine.stop();
      slotsEngine.stop();
      racingEngine.stop();
      hiloEngine.stop();
      minesEngine.stop();
      crossEngine.stop();
      vaultsEngine.stop();
      lotteryEngine.stop();
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
