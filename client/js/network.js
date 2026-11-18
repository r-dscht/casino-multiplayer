/**
 * network.js
 * Socket.io client network layer and real-time state synchronization.
 * Handles automatic reconnection, event dispatching, and typed payloads.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CasinoNetwork = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  class CasinoNetwork {
    constructor() {
      this.socket = null;
      this.isConnected = false;
      this.isAuthenticated = false;
      this.myPlayerId = null;
      this.sessionToken = this.getStoredToken();
      this._lastAuthPayload = null;
      this._reauthInFlight = false;
      this._lastReauthAt = 0;
      this.handlers = new Map();
    }

    /**
     * Reads stored bearer session token from localStorage.
     * @returns {string|null}
     */
    getStoredToken() {
      try {
        if (typeof localStorage !== 'undefined') {
          return localStorage.getItem('casino_session_token');
        }
      } catch (e) {}
      return this.sessionToken || null;
    }

    /**
     * Persists or clears bearer session token in localStorage.
     * @param {string|null} token 
     */
    setStoredToken(token) {
      this.sessionToken = token || null;
      try {
        if (typeof localStorage !== 'undefined') {
          if (token) {
            localStorage.setItem('casino_session_token', token);
          } else {
            localStorage.removeItem('casino_session_token');
          }
        }
      } catch (e) {}
    }

    /**
     * Reads local player state backup from localStorage (prevents data loss if cloud server sleeps).
     * @returns {Object|null}
     */
    getClientBackup() {
      try {
        if (typeof localStorage !== 'undefined') {
          const raw = localStorage.getItem('casino_player_backup');
          let parsed = null;
          if (raw) {
            const p = JSON.parse(raw);
            if (p && typeof p === 'object') parsed = p;
          }
          const bankRaw = localStorage.getItem('casino_bank_backup');
          if (bankRaw) {
            const bankParsed = JSON.parse(bankRaw);
            if (bankParsed && typeof bankParsed === 'object') {
              parsed = parsed || {};
              if (Array.isArray(bankParsed.activeDebts) && bankParsed.activeDebts.length > 0) {
                parsed.activeDebts = bankParsed.activeDebts;
              }
              if (Array.isArray(bankParsed.activeLoansGiven) && bankParsed.activeLoansGiven.length > 0) {
                parsed.activeLoansGiven = bankParsed.activeLoansGiven;
              }
              if (Array.isArray(bankParsed.repaidLoanIds) && bankParsed.repaidLoanIds.length > 0) {
                parsed.repaidLoanIds = bankParsed.repaidLoanIds;
              }
              if (typeof bankParsed.lastWheelSpin === 'number' && bankParsed.lastWheelSpin > (parsed.lastWheelSpin || 0)) {
                parsed.lastWheelSpin = bankParsed.lastWheelSpin;
              }
            }
          }
          return parsed;
        }
      } catch (e) {}
      return null;
    }

    getBankBackup() {
      try {
        if (typeof localStorage !== 'undefined') {
          const raw = localStorage.getItem('casino_bank_backup');
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') return parsed;
          }
        }
      } catch (e) {}
      return null;
    }

    /**
     * Updates local player state backup in localStorage without overwriting existing
     * fields with undefined or regressing career stats.
     * @param {Object} patch
     */
    saveClientBackup(patch = {}) {
      if (!patch || typeof patch !== 'object') return;
      try {
        if (typeof localStorage !== 'undefined') {
          const existing = this.getClientBackup() || {};
          const cleanPatch = {};
          Object.keys(patch).forEach((key) => {
            if (patch[key] !== undefined && key !== 'stats') {
              cleanPatch[key] = patch[key];
            }
          });
          let mergedStats = existing.stats;
          if (patch.stats && typeof patch.stats === 'object') {
            const prev = (existing.stats && typeof existing.stats === 'object') ? existing.stats : {};
            mergedStats = {
              roundsPlayed: Math.max(Number(prev.roundsPlayed) || 0, Number(patch.stats.roundsPlayed) || 0),
              totalWon: Math.max(Number(prev.totalWon) || 0, Number(patch.stats.totalWon) || 0),
              biggestWin: Math.max(Number(prev.biggestWin) || 0, Number(patch.stats.biggestWin) || 0)
            };
          }
          const merged = {
            ...existing,
            ...cleanPatch,
            ...(mergedStats ? { stats: mergedStats } : {}),
            updatedAt: Date.now()
          };
          localStorage.setItem('casino_player_backup', JSON.stringify(merged));
        }
      } catch (e) {}
    }

    /**
     * Reads cached All-Time / Offline leaderboard snapshot from localStorage.
     * @returns {Array<Object>|null}
     */
    getLeaderboardBackup() {
      try {
        if (typeof localStorage !== 'undefined') {
          const raw = localStorage.getItem('casino_leaderboard_backup');
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed.slice(0, 150);
          }
        }
      } catch (e) {}
      return null;
    }

    /**
     * Persists a compact snapshot of the global leaderboard in localStorage
     * so offline players survive ephemeral server restarts.
     * @param {Array<Object>} list
     */
    saveLeaderboardBackup(list) {
      if (!Array.isArray(list) || list.length === 0) return;
      try {
        if (typeof localStorage !== 'undefined') {
          const existing = this.getLeaderboardBackup() || [];
          const mergedMap = new Map();
          const ingestCompact = (entry) => {
            if (!entry || typeof entry !== 'object' || !entry.id || !entry.name) return;
            const normKey = String(entry.name).trim().toLowerCase();
            if (!normKey) return;
            const s = (entry.stats && typeof entry.stats === 'object') ? entry.stats : {};
            const prev = mergedMap.get(normKey);
            const compactStats = {
              roundsPlayed: Math.max((prev && prev.stats && prev.stats.roundsPlayed) || 0, Number(s.roundsPlayed) || 0),
              totalWon: Math.max((prev && prev.stats && prev.stats.totalWon) || 0, Number(s.totalWon) || 0),
              biggestWin: Math.max((prev && prev.stats && prev.stats.biggestWin) || 0, Number(s.biggestWin) || 0)
            };
            const chipsVal = typeof entry.chips === 'number'
              ? entry.chips
              : (prev && typeof prev.chips === 'number' ? prev.chips : 0);
            mergedMap.set(normKey, {
              id: entry.id,
              name: entry.name,
              color: entry.color || (prev && prev.color) || '#10b981',
              avatar: entry.avatar || (prev && prev.avatar) || 'avatar_1',
              chips: chipsVal,
              stats: compactStats,
              lastGame: entry.lastGame || (entry.currentGame && entry.currentGame !== 'Offline' ? entry.currentGame : ((prev && prev.lastGame) || 'Roulette')),
              createdAt: entry.createdAt || (prev && prev.createdAt) || Date.now(),
              lastSeen: Math.max((prev && prev.lastSeen) || 0, Number(entry.lastSeen) || 0)
            });
          };
          existing.forEach(ingestCompact);
          list.forEach(ingestCompact);
          const compacted = Array.from(mergedMap.values())
            .sort((a, b) => (b.chips - a.chips) || (b.lastSeen - a.lastSeen))
            .slice(0, 150);
          localStorage.setItem('casino_leaderboard_backup', JSON.stringify(compacted));
        }
      } catch (e) {}
    }

    /**
     * Reads unsettled active Staatsloterij stake backup from localStorage.
     * @returns {Object|null}
     */
    getLotteryBackup() {
      try {
        if (typeof localStorage !== 'undefined') {
          const raw = localStorage.getItem('casino_lottery_backup');
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          const stake = (parsed && parsed.activeStake && typeof parsed.activeStake === 'object')
            ? parsed.activeStake
            : null;
          if (!stake) return null;
          if (!Number.isInteger(stake.roundId) || stake.roundId < 1) return null;
          if (!Number.isInteger(stake.tickets) || stake.tickets < 1) return null;
          if (!Number.isInteger(stake.totalSpent) || stake.totalSpent <= 0) return null;
          if (typeof stake.roundEndsAt !== 'number' || !Number.isFinite(stake.roundEndsAt) || stake.roundEndsAt <= 0) return null;
          if (stake.savedAt && (Date.now() - stake.savedAt) > 7 * 24 * 60 * 60 * 1000) return null;
          return { ...stake };
        }
      } catch (e) {}
      return null;
    }

    /**
     * Persists unsettled Staatsloterij tickets in localStorage so ephemeral restarts never drop a stake.
     * @param {Object} stake
     */
    saveLotteryStakeBackup(stake) {
      if (!stake || typeof stake !== 'object') return;
      if (!Number.isInteger(stake.roundId) || stake.roundId < 1) return;
      if (!Number.isInteger(stake.tickets) || stake.tickets < 1) return;
      if (!Number.isInteger(stake.totalSpent) || stake.totalSpent <= 0) return;
      if (typeof stake.roundEndsAt !== 'number' || !Number.isFinite(stake.roundEndsAt) || stake.roundEndsAt <= 0) return;
      try {
        if (typeof localStorage !== 'undefined') {
          let parsed = {};
          const raw = localStorage.getItem('casino_lottery_backup');
          if (raw) {
            const p = JSON.parse(raw);
            if (p && typeof p === 'object') parsed = p;
          }
          parsed.activeStake = {
            roundId: stake.roundId,
            roundEndsAt: stake.roundEndsAt,
            tickets: stake.tickets,
            totalSpent: stake.totalSpent,
            playerId: stake.playerId || this.myPlayerId || null,
            playerName: stake.playerName || (this._lastAuthPayload && this._lastAuthPayload.name) || null,
            savedAt: Date.now()
          };
          localStorage.setItem('casino_lottery_backup', JSON.stringify(parsed));
        }
      } catch (e) {}
    }

    /**
     * Clears stored unsettled lottery stake once its round has drawn/settled on server.
     * @param {number|null} [roundId=null]
     */
    clearLotteryStakeBackup(roundId = null) {
      try {
        if (typeof localStorage !== 'undefined') {
          const raw = localStorage.getItem('casino_lottery_backup');
          if (!raw) return;
          const parsed = JSON.parse(raw);
          if (!parsed || typeof parsed !== 'object' || !parsed.activeStake) return;
          if (roundId !== null && Number(parsed.activeStake.roundId) > Number(roundId)) {
            return;
          }
          delete parsed.activeStake;
          localStorage.setItem('casino_lottery_backup', JSON.stringify(parsed));
        }
      } catch (e) {}
    }

    /**
     * Subscribes a callback to an event.
     * @param {string} event 
     * @param {Function} callback 
     */
    on(event, callback) {
      if (!this.handlers.has(event)) {
        this.handlers.set(event, []);
      }
      this.handlers.get(event).push(callback);
    }

    /**
     * Emits an internal event to subscribers.
     * @param {string} event 
     * @param {any} data 
     */
    emitInternal(event, data) {
      const cbs = this.handlers.get(event);
      if (cbs) {
        for (const cb of cbs) {
          try {
            cb(data);
          } catch (err) {
            console.error(`Error in event handler for "${event}":`, err);
          }
        }
      }
    }

    /**
     * Connects to the server via Socket.io.
     */
    connect() {
      // Connect to the same host/port serving the web app
      if (typeof io === 'undefined') {
        console.error('Socket.io client library not loaded');
        return;
      }

      this.socket = io({
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000
      });

      this.socket.on('connect', () => {
        this.isConnected = true;
        this.isAuthenticated = false;
        this._reauthInFlight = false;
        this.emitInternal('connection_change', { connected: true, id: this.socket.id });

        // Auto authenticate session on socket connect if stored bearer token, account name, or in-memory backup exists
        const token = this.getStoredToken() || (this._lastAuthPayload && this._lastAuthPayload.sessionToken) || null;
        const storedName = (typeof localStorage !== 'undefined'
          ? (localStorage.getItem('casino_player_name') || localStorage.getItem('roulette_player_name'))
          : null) || (this._lastAuthPayload && this._lastAuthPayload.name) || null;
        const storedColor = (typeof localStorage !== 'undefined'
          ? (localStorage.getItem('casino_player_color') || localStorage.getItem('roulette_player_color'))
          : null) || (this._lastAuthPayload && this._lastAuthPayload.color) || null;
        const storedPassword = (typeof localStorage !== 'undefined'
          ? (localStorage.getItem('casino_player_password') || localStorage.getItem('roulette_player_password'))
          : null) || (this._lastAuthPayload && this._lastAuthPayload.password) || null;

        if (token || storedName) {
          this.authSession({ sessionToken: token, name: storedName, color: storedColor, password: storedPassword });
        }
      });

      this.socket.on('disconnect', (reason) => {
        this.isConnected = false;
        this.isAuthenticated = false;
        this._reauthInFlight = false;
        this.emitInternal('connection_change', { connected: false, reason });
      });

      this.socket.on('auth_success', (data) => {
        const wasRecovery = Boolean(this._pendingRecoveryNotice);
        this.isAuthenticated = true;
        this._reauthInFlight = false;
        this._pendingRecoveryNotice = false;
        if (data && data.player) {
          this._lastAuthPayload = {
            ...(this._lastAuthPayload || {}),
            sessionToken: data.sessionToken || this.sessionToken || this.getStoredToken(),
            name: data.player.name,
            color: data.player.color
          };
          if (wasRecovery) {
            this.emitInternal('session_recovered', data);
          }
        }
      });

      this.socket.on('auth_error', () => {
        this.isAuthenticated = false;
        this._reauthInFlight = false;
        this._pendingRecoveryNotice = false;
      });

      this.socket.on('login_error', () => {
        this.isAuthenticated = false;
        this._reauthInFlight = false;
        this._pendingRecoveryNotice = false;
      });

      this.socket.on('error_msg', (data) => {
        this.emitInternal('error_msg', data);
        if (this._isSessionMissingError(data)) {
          this.tryAutoReauth(data);
        }
      });

      this.socket.on('session_required', (data) => {
        this.isAuthenticated = false;
        this.emitInternal('session_required', data);
        this.tryAutoReauth(data);
      });

      const sessionRejectEvents = [
        'bet_rejected',
        'crash_bet_rejected',
        'crash_cashout_rejected',
        'plinko_drop_rejected',
        'avia_fly_rejected',
        'slots_spin_rejected',
        'racing_bet_rejected',
        'racing_cheer_rejected',
        'hilo_rejected',
        'mines_rejected',
        'cross_rejected',
        'lottery_rejected',
        'bj_seat_error',
        'bj_bet_rejected',
        'bj_action_rejected',
        'poker_seat_error',
        'poker_action_rejected'
      ];
      sessionRejectEvents.forEach((evtName) => {
        this.socket.on(evtName, (data) => {
          if (this._isSessionMissingError(data)) {
            this.tryAutoReauth(data);
          }
        });
      });

      this.socket.on('connect_error', (error) => {
        this.emitInternal('connection_error', error);
      });

      // Server protocol events
      this.socket.on('table_state', (data) => {
        if (data && data.playerId) {
          this.myPlayerId = data.playerId;
        }
        if (data && Array.isArray(data.players) && this.myPlayerId) {
          const me = data.players.find(p => p.id === this.myPlayerId);
          if (me) {
            this.saveClientBackup({
              id: me.id,
              name: me.name,
              color: me.color,
              avatar: me.avatar,
              chips: me.chips,
              stats: me.stats
            });
          }
        }
        this.emitInternal('table_state', data);
      });

      this.socket.on('phase_tick', (data) => {
        this.emitInternal('phase_tick', data);
      });

      this.socket.on('phase_change', (data) => {
        this.emitInternal('phase_change', data);
      });

      this.socket.on('round_result', (data) => {
        if (data && data.playerResults && this.myPlayerId && data.playerResults[this.myPlayerId]) {
          const myRes = data.playerResults[this.myPlayerId];
          if (typeof myRes.chips === 'number') {
            this.saveClientBackup({ chips: myRes.chips, stats: myRes.stats });
          }
        }
        this.emitInternal('round_result', data);
      });

      this.socket.on('bet_accepted', (data) => {
        if (data && typeof data.remainingChips === 'number') {
          this.saveClientBackup({ chips: data.remainingChips });
        }
        this.emitInternal('bet_accepted', data);
      });

      this.socket.on('bet_rejected', (data) => {
        this.emitInternal('bet_rejected', data);
      });

      this.socket.on('bet_placed', (data) => {
        this.emitInternal('bet_placed', data);
      });

      this.socket.on('bets_cleared', (data) => {
        if (data && typeof data.remainingChips === 'number') {
          this.saveClientBackup({ chips: data.remainingChips });
        }
        this.emitInternal('bets_cleared', data);
      });

      this.socket.on('chips_update', (data) => {
        if (data && typeof data.chips === 'number') {
          const tableStack = typeof data.tableStack === 'number' ? data.tableStack : 0;
          this.saveClientBackup({ chips: data.chips + tableStack });
        }
        this.emitInternal('chips_update', data);
      });

      this.socket.on('player_joined', (data) => {
        this.emitInternal('player_joined', data);
      });

      this.socket.on('player_left', (data) => {
        this.emitInternal('player_left', data);
      });

      this.socket.on('players_update', (data) => {
        if (Array.isArray(data) && this.myPlayerId) {
          const me = data.find(p => p && p.id === this.myPlayerId);
          if (me) {
            this.saveClientBackup({ chips: me.chips, stats: me.stats });
          }
        }
        this.emitInternal('players_update', data);
      });

      this.socket.on('global_leaderboard_update', (data) => {
        if (Array.isArray(data) && data.length > 0) {
          this.saveLeaderboardBackup(data);
        }
        this.emitInternal('global_leaderboard_update', data);
      });

      this.socket.on('login_error', (data) => {
        this.emitInternal('login_error', data);
      });

      this.socket.on('chat_message', (data) => {
        this.emitInternal('chat_message', data);
      });

      // Bank & Loans events
      this.socket.on('bank_update', (data) => {
        if (data && data.wheelStatus && typeof data.wheelStatus.lastSpinTime === 'number' && data.wheelStatus.lastSpinTime > 0) {
          this.saveClientBackup({ lastWheelSpin: data.wheelStatus.lastSpinTime });
        }
        this.emitInternal('bank_update', data);
      });

      this.socket.on('bank_wheel_result', (data) => {
        if (data && typeof data.lastSpinTime === 'number' && data.lastSpinTime > 0) {
          this.saveClientBackup({ lastWheelSpin: data.lastSpinTime });
        }
        this.emitInternal('bank_wheel_result', data);
      });

      this.socket.on('bank_error', (data) => {
        this.emitInternal('bank_error', data);
      });

      this.socket.on('bank_success', (data) => {
        this.emitInternal('bank_success', data);
      });

      this.socket.on('bank_notification', (data) => {
        this.emitInternal('bank_notification', data);
      });

      this.socket.on('bank_bailout_claimed', (data) => {
        this.emitInternal('bank_bailout_claimed', data);
      });

      // Session Auth & Presence events
      this.socket.on('auth_success', (data) => {
        if (data && data.sessionToken) {
          this.setStoredToken(data.sessionToken);
        }
        if (data && data.player && data.player.id) {
          this.myPlayerId = data.player.id;
          this.saveClientBackup({
            id: data.player.id,
            sessionToken: data.sessionToken || this.sessionToken,
            name: data.player.name,
            color: data.player.color,
            avatar: data.player.avatar,
            chips: data.player.chips,
            stats: data.player.stats,
            createdAt: data.player.createdAt
          });
          try {
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem('casino_player_id', data.player.id);
              if (data.player.name) {
                localStorage.setItem('casino_player_name', data.player.name);
                localStorage.setItem('roulette_player_name', data.player.name);
              }
              if (data.player.color) {
                localStorage.setItem('casino_player_color', data.player.color);
                localStorage.setItem('roulette_player_color', data.player.color);
              }
            }
          } catch (e) {}
        }
        this.emitInternal('auth_success', data);
      });

      this.socket.on('auth_error', (data) => {
        this.emitInternal('auth_error', data);
      });

      this.socket.on('presence_update', (data) => {
        this.emitInternal('presence_update', data);
      });

      // Player Profile & Presence events
      this.socket.on('profile_data', (data) => {
        if (data && data.id && data.id === this.myPlayerId) {
          this.saveClientBackup({ chips: data.chips, stats: data.stats });
        }
        this.emitInternal('profile_data', data);
      });

      this.socket.on('profile_updated', (data) => {
        if (data && data.color) {
          try {
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem('casino_player_color', data.color);
              localStorage.setItem('roulette_player_color', data.color);
            }
          } catch (e) {}
          this.saveClientBackup({ color: data.color, avatar: data.avatar });
        }
        this.emitInternal('profile_updated', data);
      });

      this.socket.on('navigation_blocked', (data) => {
        this.emitInternal('navigation_blocked', data);
      });

      this.socket.on('game_switched', (data) => {
        this.emitInternal('game_switched', data);
      });

      this.socket.on('player_password_result', (data) => {
        this.emitInternal('player_password_result', data);
      });

      // Multiplayer 6-Seat Blackjack Protocol Events
      this.socket.on('bj_table_state', (data) => {
        this.emitInternal('bj_table_state', data);
      });

      this.socket.on('bj_seat_taken', (data) => {
        this.emitInternal('bj_seat_taken', data);
      });

      this.socket.on('bj_seat_left', (data) => {
        this.emitInternal('bj_seat_left', data);
      });

      this.socket.on('bj_seat_accepted', (data) => {
        this.emitInternal('bj_seat_accepted', data);
      });

      this.socket.on('bj_seat_vacated', (data) => {
        this.emitInternal('bj_seat_vacated', data);
      });

      this.socket.on('bj_seat_error', (data) => {
        this.emitInternal('bj_seat_error', data);
      });

      this.socket.on('bj_bet_placed', (data) => {
        this.emitInternal('bj_bet_placed', data);
      });

      this.socket.on('bj_bet_accepted', (data) => {
        const rem = data && (typeof data.remainingChips === 'number' ? data.remainingChips : data.chipsRemaining);
        if (typeof rem === 'number') {
          this.saveClientBackup({ chips: rem });
        }
        this.emitInternal('bj_bet_accepted', data);
      });

      this.socket.on('bj_bet_cleared', (data) => {
        this.emitInternal('bj_bet_cleared', data);
      });

      this.socket.on('bj_bet_rejected', (data) => {
        this.emitInternal('bj_bet_rejected', data);
      });

      this.socket.on('bj_action_applied', (data) => {
        this.emitInternal('bj_action_applied', data);
      });

      this.socket.on('bj_action_executed', (data) => {
        this.emitInternal('bj_action_executed', data);
      });

      this.socket.on('bj_action_success', (data) => {
        this.emitInternal('bj_action_success', data);
      });

      this.socket.on('bj_action_rejected', (data) => {
        this.emitInternal('bj_action_rejected', data);
      });

      this.socket.on('bj_phase_tick', (data) => {
        this.emitInternal('bj_phase_tick', data);
      });

      this.socket.on('bj_phase_change', (data) => {
        this.emitInternal('bj_phase_change', data);
      });

      this.socket.on('bj_turn_tick', (data) => {
        this.emitInternal('bj_turn_tick', data);
      });

      this.socket.on('bj_turn_change', (data) => {
        this.emitInternal('bj_turn_change', data);
      });

      this.socket.on('dealer_reveal', (data) => {
        this.emitInternal('bj_dealer_reveal', data);
      });

      this.socket.on('bj_dealer_reveal', (data) => {
        this.emitInternal('bj_dealer_reveal', data);
      });

      this.socket.on('dealer_draw', (data) => {
        this.emitInternal('bj_dealer_draw', data);
      });

      this.socket.on('bj_dealer_draw', (data) => {
        this.emitInternal('bj_dealer_draw', data);
      });

      this.socket.on('bj_shoe_reshuffle', (data) => {
        this.emitInternal('bj_shoe_reshuffle', data);
      });

      this.socket.on('bj_round_result', (data) => {
        const resultsList = data && (data.results || data.seatResults);
        if (Array.isArray(resultsList) && this.myPlayerId) {
          const myRes = resultsList.find(r => r.playerId === this.myPlayerId);
          if (myRes && typeof myRes.chips === 'number') {
            this.saveClientBackup({ chips: myRes.chips, stats: myRes.stats });
          }
        }
        this.emitInternal('bj_round_result', data);
      });

      this.socket.on('bj_round_end', (data) => {
        this.emitInternal('bj_round_end', data);
      });

      // Multiplayer 6-Seat Texas Hold'em Poker Protocol Events
      this.socket.on('poker_table_state', (data) => {
        this.emitInternal('poker_table_state', data);
      });

      this.socket.on('poker_seat_taken', (data) => {
        this.emitInternal('poker_seat_taken', data);
      });

      this.socket.on('poker_seat_left', (data) => {
        this.emitInternal('poker_seat_left', data);
      });

      this.socket.on('poker_seat_vacated', (data) => {
        this.emitInternal('poker_seat_vacated', data);
      });

      this.socket.on('poker_seat_accepted', (data) => {
        this.emitInternal('poker_seat_accepted', data);
      });

      this.socket.on('poker_seat_error', (data) => {
        this.emitInternal('poker_seat_error', data);
      });

      this.socket.on('poker_phase_tick', (data) => {
        this.emitInternal('poker_phase_tick', data);
      });

      this.socket.on('poker_phase_change', (data) => {
        this.emitInternal('poker_phase_change', data);
      });

      this.socket.on('poker_phase_changed', (data) => {
        this.emitInternal('poker_phase_changed', data);
      });

      this.socket.on('poker_turn_tick', (data) => {
        this.emitInternal('poker_turn_tick', data);
      });

      this.socket.on('poker_turn_change', (data) => {
        this.emitInternal('poker_turn_change', data);
      });

      this.socket.on('poker_turn_changed', (data) => {
        this.emitInternal('poker_turn_changed', data);
      });

      this.socket.on('poker_hand_start', (data) => {
        this.emitInternal('poker_hand_start', data);
      });

      this.socket.on('poker_hand_started', (data) => {
        this.emitInternal('poker_hand_started', data);
      });

      this.socket.on('poker_hole_cards', (data) => {
        this.emitInternal('poker_hole_cards', data);
      });

      this.socket.on('poker_community_cards', (data) => {
        this.emitInternal('poker_community_cards', data);
      });

      this.socket.on('poker_community_dealt', (data) => {
        this.emitInternal('poker_community_dealt', data);
      });

      this.socket.on('poker_player_acted', (data) => {
        this.emitInternal('poker_player_acted', data);
      });

      this.socket.on('poker_player_action', (data) => {
        this.emitInternal('poker_player_action', data);
      });

      this.socket.on('poker_action_success', (data) => {
        this.emitInternal('poker_action_success', data);
      });

      this.socket.on('poker_action_rejected', (data) => {
        this.emitInternal('poker_action_rejected', data);
      });

      this.socket.on('poker_hand_end', (data) => {
        this.emitInternal('poker_hand_end', data);
      });

      this.socket.on('poker_hand_ended', (data) => {
        this.emitInternal('poker_hand_ended', data);
      });

      this.socket.on('poker_showdown', (data) => {
        this.emitInternal('poker_showdown', data);
      });

      this.socket.on('poker_rebuy_success', (data) => {
        this.emitInternal('poker_rebuy_success', data);
      });

      this.socket.on('poker_rebuy_error', (data) => {
        this.emitInternal('poker_rebuy_error', data);
      });

      this.socket.on('poker_stack_update', (data) => {
        this.emitInternal('poker_stack_update', data);
      });

      // Multiplayer Velocity Crash Protocol Events
      this.socket.on('crash_table_state', (data) => {
        this.emitInternal('crash_table_state', data);
      });

      this.socket.on('crash_phase_tick', (data) => {
        this.emitInternal('crash_phase_tick', data);
      });

      this.socket.on('crash_tick', (data) => {
        this.emitInternal('crash_tick', data);
      });

      this.socket.on('crash_phase_change', (data) => {
        this.emitInternal('crash_phase_change', data);
      });

      this.socket.on('crash_bet_placed', (data) => {
        this.emitInternal('crash_bet_placed', data);
      });

      this.socket.on('crash_bet_accepted', (data) => {
        if (data && typeof data.remainingChips === 'number') {
          this.saveClientBackup({ chips: data.remainingChips });
        }
        this.emitInternal('crash_bet_accepted', data);
      });

      this.socket.on('crash_bet_cancelled', (data) => {
        this.emitInternal('crash_bet_cancelled', data);
      });

      this.socket.on('crash_bet_cancelled_self', (data) => {
        if (data && typeof data.remainingChips === 'number') {
          this.saveClientBackup({ chips: data.remainingChips });
        }
        this.emitInternal('crash_bet_cancelled_self', data);
      });

      this.socket.on('crash_bet_rejected', (data) => {
        this.emitInternal('crash_bet_rejected', data);
      });

      this.socket.on('crash_player_cashed_out', (data) => {
        if (data && data.playerId === this.myPlayerId && typeof data.remainingChips === 'number') {
          this.saveClientBackup({ chips: data.remainingChips, stats: data.stats });
        }
        this.emitInternal('crash_player_cashed_out', data);
      });

      this.socket.on('crash_cashout_success', (data) => {
        if (data && typeof data.remainingChips === 'number') {
          this.saveClientBackup({ chips: data.remainingChips, stats: data.stats });
        }
        this.emitInternal('crash_cashout_success', data);
      });

      this.socket.on('crash_cashout_rejected', (data) => {
        this.emitInternal('crash_cashout_rejected', data);
      });

      this.socket.on('crash_round_crashed', (data) => {
        this.emitInternal('crash_round_crashed', data);
      });

      // Multiplayer Royal Plinko Protocol Events
      this.socket.on('plinko_state', (data) => {
        this.emitInternal('plinko_state', data);
      });

      this.socket.on('plinko_drop_accepted', (data) => {
        if (data && typeof data.newChips === 'number') {
          this.saveClientBackup({ chips: data.newChips, stats: data.stats });
        }
        this.emitInternal('plinko_drop_accepted', data);
      });

      this.socket.on('plinko_ball_dropped', (data) => {
        this.emitInternal('plinko_ball_dropped', data);
      });

      this.socket.on('plinko_drop_rejected', (data) => {
        this.emitInternal('plinko_drop_rejected', data);
      });

      // Single-Player AviaMasters Protocol Events
      this.socket.on('avia_state', (data) => {
        this.emitInternal('avia_state', data);
      });

      this.socket.on('avia_fly_accepted', (data) => {
        if (data && typeof data.newChips === 'number') {
          this.saveClientBackup({ chips: data.newChips, stats: data.stats });
        }
        this.emitInternal('avia_fly_accepted', data);
      });

      this.socket.on('avia_fly_rejected', (data) => {
        this.emitInternal('avia_fly_rejected', data);
      });

      this.socket.on('avia_flight_logged', (data) => {
        this.emitInternal('avia_flight_logged', data);
      });

      // Multiplayer Grand Sovereign Slots Protocol Events
      this.socket.on('slots_state', (data) => {
        this.emitInternal('slots_state', data);
      });

      this.socket.on('slots_spin_result', (data) => {
        if (data && typeof data.newChips === 'number') {
          this.saveClientBackup({ chips: data.newChips, stats: data.stats });
        }
        this.emitInternal('slots_spin_result', data);
      });

      this.socket.on('slots_spin_rejected', (data) => {
        this.emitInternal('slots_spin_rejected', data);
      });

      this.socket.on('slots_floor_update', (data) => {
        this.emitInternal('slots_floor_update', data);
      });

      this.socket.on('slots_big_win', (data) => {
        this.emitInternal('slots_big_win', data);
      });

      this.socket.on('slots_golden_fever', (data) => {
        this.emitInternal('slots_golden_fever', data);
      });

      // Multiplayer Horse Racing (Monaco Turf Club Derby) Events
      this.socket.on('racing_state', (data) => {
        this.emitInternal('racing_state', data);
      });

      this.socket.on('racing_phase_tick', (data) => {
        this.emitInternal('racing_phase_tick', data);
      });

      this.socket.on('racing_phase_change', (data) => {
        this.emitInternal('racing_phase_change', data);
      });

      this.socket.on('racing_tick', (data) => {
        this.emitInternal('racing_tick', data);
      });

      this.socket.on('racing_bet_accepted', (data) => {
        if (data && typeof data.newChips === 'number') {
          this.saveClientBackup({ chips: data.newChips });
        }
        this.emitInternal('racing_bet_accepted', data);
      });

      this.socket.on('racing_bet_rejected', (data) => {
        this.emitInternal('racing_bet_rejected', data);
      });

      this.socket.on('racing_bet_placed', (data) => {
        this.emitInternal('racing_bet_placed', data);
      });

      this.socket.on('racing_bet_cancelled', (data) => {
        this.emitInternal('racing_bet_cancelled', data);
      });

      this.socket.on('racing_bet_cancelled_self', (data) => {
        if (data && typeof data.newChips === 'number') {
          this.saveClientBackup({ chips: data.newChips });
        }
        this.emitInternal('racing_bet_cancelled_self', data);
      });

      this.socket.on('racing_golden_horse', (data) => {
        this.emitInternal('racing_golden_horse', data);
      });

      this.socket.on('racing_cheered', (data) => {
        this.emitInternal('racing_cheered', data);
      });

      this.socket.on('racing_cheer_rejected', (data) => {
        this.emitInternal('racing_cheer_rejected', data);
      });

      this.socket.on('racing_finished', (data) => {
        this.emitInternal('racing_finished', data);
      });

      this.socket.on('racing_settlement', (data) => {
        if (data && typeof data.newChips === 'number') {
          this.saveClientBackup({ chips: data.newChips, stats: data.stats });
        }
        this.emitInternal('racing_settlement', data);
      });

      // Monte Carlo Hi-Lo Prive Events
      const hiloEvents = [
        'hilo_state',
        'hilo_salon_update',
        'hilo_rejected',
        'hilo_started',
        'hilo_guess_result',
        'hilo_skipped',
        'hilo_half_cashout_result',
        'hilo_cashout_result'
      ];
      hiloEvents.forEach((evt) => {
        this.socket.on(evt, (data) => {
          if (data && typeof data.newChips === 'number') {
            this.saveClientBackup({ chips: data.newChips, stats: data.stats });
          }
          this.emitInternal(evt, data);
        });
      });

      // Royal Mines Vault Events
      const minesEvents = [
        'mines_state',
        'mines_salon_update',
        'mines_rejected',
        'mines_solo_started',
        'mines_solo_result',
        'mines_shared_tick',
        'mines_shared_state',
        'mines_shared_vote_ack',
        'mines_shared_joined',
        'mines_shared_cancelled',
        'mines_shared_tile',
        'mines_shared_click_ack',
        'mines_shared_cashout_ack',
        'mines_shared_settlement',
        'mines_shared_finished'
      ];
      minesEvents.forEach((evt) => {
        this.socket.on(evt, (data) => {
          if (data && typeof data.newChips === 'number') {
            this.saveClientBackup({ chips: data.newChips, stats: data.stats });
          }
          this.emitInternal(evt, data);
        });
      });

      // Monte Carlo Boulevard Cross Events
      const crossEvents = [
        'cross_state',
        'cross_salon_update',
        'cross_rejected',
        'cross_started',
        'cross_step_result',
        'cross_cashout_result'
      ];
      crossEvents.forEach((evt) => {
        this.socket.on(evt, (data) => {
          if (data && typeof data.newChips === 'number') {
            this.saveClientBackup({ chips: data.newChips, stats: data.stats });
          }
          this.emitInternal(evt, data);
        });
      });

      // Casino Staatsloterij Events
      const lotteryEvents = [
        'lottery_state',
        'lottery_tick',
        'lottery_buy_ack',
        'lottery_rejected',
        'lottery_draw_result'
      ];
      lotteryEvents.forEach((evt) => {
        this.socket.on(evt, (data) => {
          if (data && typeof data.remainingChips === 'number') {
            this.saveClientBackup({ chips: data.remainingChips });
          }
          if (evt === 'lottery_buy_ack' && data && data.ok && data.mySummary && data.mySummary.tickets > 0) {
            this.saveLotteryStakeBackup({
              roundId: data.roundId,
              roundEndsAt: data.roundEndsAt || 0,
              tickets: data.mySummary.tickets,
              totalSpent: data.mySummary.totalSpent,
              playerId: data.playerId || this.myPlayerId,
              playerName: data.playerName || (this._lastAuthPayload && this._lastAuthPayload.name) || null
            });
          } else if (evt === 'lottery_draw_result' && data && Number.isInteger(data.roundId)) {
            this.clearLotteryStakeBackup(data.roundId);
          } else if (evt === 'lottery_state' && data && typeof data === 'object') {
            const stake = this.getLotteryBackup();
            const settledList = Array.isArray(data.settledRoundIds) ? data.settledRoundIds : [];
            const inHistory = Array.isArray(data.history) && stake && data.history.some(h => h && Number(h.roundId) === Number(stake.roundId));
            const inOfflineNotice = Boolean(
              stake && (
                (data.myPendingOfflineWin && Number(data.myPendingOfflineWin.roundId) === Number(stake.roundId)) ||
                (data.myPendingOfflineOutcome && Number(data.myPendingOfflineOutcome.roundId) === Number(stake.roundId))
              )
            );
            const hasServerProgress = settledList.length > 0 || (Array.isArray(data.history) && data.history.length > 0);
            const isSettled = Boolean(
              stake && (
                (data.phase === 'DRAWING' && Number(data.roundId) === Number(stake.roundId)) ||
                settledList.includes(Number(stake.roundId)) ||
                inHistory ||
                inOfflineNotice ||
                Number(data.backupClaimResolvedRoundId) === Number(stake.roundId) ||
                (Number(data.roundId) > Number(stake.roundId) && hasServerProgress)
              )
            );
            if (isSettled) {
              this.clearLotteryStakeBackup(stake.roundId);
            } else if (data.phase === 'OPEN' && data.mySummary && data.mySummary.tickets > 0 && Number(data.roundEndsAt) > 0) {
              this.saveLotteryStakeBackup({
                roundId: data.roundId,
                roundEndsAt: data.roundEndsAt,
                tickets: data.mySummary.tickets,
                totalSpent: data.mySummary.totalSpent,
                playerId: this.myPlayerId,
                playerName: (this._lastAuthPayload && this._lastAuthPayload.name) || null
              });
            }
          }
          this.emitInternal(evt, data);
        });
      });
    }

    _isSessionMissingError(data) {
      if (!data || typeof data !== 'object') return false;
      if (data.code === 'PLAYER_NOT_FOUND') return true;
      const msg = String(data.reason || data.message || '').toLowerCase();
      return msg.includes('log eerst in') || msg.includes('player profile not found') || msg.includes('must be authenticated') || msg.includes('sessie verlopen');
    }

    hasStoredCredentials() {
      const token = this.getStoredToken() || (this._lastAuthPayload && this._lastAuthPayload.sessionToken);
      const name = (typeof localStorage !== 'undefined'
        ? (localStorage.getItem('casino_player_name') || localStorage.getItem('roulette_player_name'))
        : null) || (this._lastAuthPayload && this._lastAuthPayload.name);
      return Boolean(token || name);
    }

    tryAutoReauth(triggerPayload = null) {
      if (!this.socket || !this.isConnected) return false;
      const now = Date.now();
      if (this._reauthInFlight || (now - this._lastReauthAt) < 1200) {
        return false;
      }

      const token = this.getStoredToken() || (this._lastAuthPayload && this._lastAuthPayload.sessionToken) || null;
      const name = (typeof localStorage !== 'undefined'
        ? (localStorage.getItem('casino_player_name') || localStorage.getItem('roulette_player_name'))
        : null) || (this._lastAuthPayload && this._lastAuthPayload.name) || null;
      const color = (typeof localStorage !== 'undefined'
        ? (localStorage.getItem('casino_player_color') || localStorage.getItem('roulette_player_color'))
        : null) || (this._lastAuthPayload && this._lastAuthPayload.color) || null;
      const password = (typeof localStorage !== 'undefined'
        ? (localStorage.getItem('casino_player_password') || localStorage.getItem('roulette_player_password'))
        : null) || (this._lastAuthPayload && this._lastAuthPayload.password) || null;

      if (!token && !name) {
        this.isAuthenticated = false;
        this.emitInternal('session_lost', triggerPayload || { code: 'PLAYER_NOT_FOUND' });
        return false;
      }

      this._reauthInFlight = true;
      this._pendingRecoveryNotice = true;
      this._lastReauthAt = now;
      this.authSession({ sessionToken: token, name, color, password });
      return true;
    }

    /**
     * Authenticates or resumes a session with the bearer sessionToken.
     * @param {{ sessionToken?: string, name?: string, color?: string, password?: string }} [payload]
     */
    authSession(payload = {}) {
      if (!this.socket) return;
      const token = payload.sessionToken || this.getStoredToken() || (this._lastAuthPayload && this._lastAuthPayload.sessionToken) || null;
      const name = payload.name || (this._lastAuthPayload && this._lastAuthPayload.name) || null;
      const color = payload.color || (this._lastAuthPayload && this._lastAuthPayload.color) || null;
      const password = (payload.password !== undefined && payload.password !== null && payload.password !== '')
        ? payload.password
        : ((this._lastAuthPayload && this._lastAuthPayload.password) || null);
      this._lastAuthPayload = { sessionToken: token, name, color, password };
      const lotBackup = this.getLotteryBackup();
      const storedName = (typeof localStorage !== 'undefined'
        ? (localStorage.getItem('casino_player_name') || localStorage.getItem('roulette_player_name'))
        : null);
      const authUser = name || storedName || null;
      const sameLotteryUser = !lotBackup || !lotBackup.playerName || !authUser ||
        lotBackup.playerName.trim().toLowerCase() === authUser.trim().toLowerCase();
      this.socket.emit('auth_session', {
        sessionToken: token,
        name,
        color,
        password,
        clientBackup: this.getClientBackup(),
        bankBackup: this.getBankBackup(),
        lotteryBackup: sameLotteryUser ? lotBackup : null,
        leaderboardBackup: this.getLeaderboardBackup()
      });
    }

    /**
     * Sends join_table event with bearer session token.
     * @param {{ name?: string, avatar?: string, color?: string, sessionToken?: string }} playerProfile 
     */
    joinTable(playerProfile = {}) {
      if (!this.socket) return;
      const token = playerProfile.sessionToken || this.getStoredToken();
      this._lastAuthPayload = {
        ...(this._lastAuthPayload || {}),
        sessionToken: token,
        name: playerProfile.name || (this._lastAuthPayload && this._lastAuthPayload.name) || null,
        color: playerProfile.color || (this._lastAuthPayload && this._lastAuthPayload.color) || null,
        password: (playerProfile.password !== undefined && playerProfile.password !== null && playerProfile.password !== '')
          ? playerProfile.password
          : ((this._lastAuthPayload && this._lastAuthPayload.password) || null)
      };
      const backup = this.getClientBackup();
      // Only attach clientBackup if it belongs to the same username (or no username is in backup)
      const sameUser = !backup || !backup.name || !playerProfile.name ||
        backup.name.trim().toLowerCase() === playerProfile.name.trim().toLowerCase();
      const lotBackup = this.getLotteryBackup();
      const sameLotteryUser = !lotBackup || !lotBackup.playerName || !playerProfile.name ||
        lotBackup.playerName.trim().toLowerCase() === playerProfile.name.trim().toLowerCase();
      this.socket.emit('join_table', {
        ...playerProfile,
        sessionToken: token,
        clientBackup: sameUser ? backup : null,
        bankBackup: sameUser ? this.getBankBackup() : null,
        lotteryBackup: sameLotteryUser ? lotBackup : null,
        leaderboardBackup: this.getLeaderboardBackup()
      });
    }

    /**
     * Sends place_bet event.
     * @param {{ type: string, value: any, amount: number }} betPayload 
     */
    placeBet(betPayload) {
      if (!this.socket) return;
      this.socket.emit('place_bet', betPayload);
    }

    /**
     * Sends clear_bets event.
     */
    clearBets() {
      if (!this.socket) return;
      this.socket.emit('clear_bets', {});
    }

    /**
     * Sends chat_message event with scope support.
     * @param {string} text 
     * @param {'global'|'table'} [scope='global']
     * @param {string} [table='blackjack']
     */
    sendChat(text, scope = 'global', table = 'blackjack') {
      if (!this.socket) return;
      this.socket.emit('chat_message', { text, scope, table });
    }

    /**
     * Requests latest player bank status.
     */
    getBankState(backup = null) {
      if (!this.socket) return;
      this.socket.emit('bank_get_state', { backup: backup || this.getBankBackup() });
    }

    /**
     * Pushes reconciled local bank backup to the server.
     */
    reconcileBankBackup(backup = null) {
      if (!this.socket) return;
      this.socket.emit('bank_reconcile_backup', { backup: backup || this.getBankBackup() });
    }

    /**
     * Spins the 15-minute Rad van Fortuin.
     * @param {number} [lastWheelSpin=0]
     */
    spinWheel(lastWheelSpin = 0) {
      if (!this.socket) return;
      this.socket.emit('bank_spin_wheel', { lastWheelSpin });
    }

    /**
     * Direct transfer of chips to another player.
     * @param {string} toPlayerId 
     * @param {number} amount 
     */
    transferChips(toPlayerId, amount) {
      if (!this.socket) return;
      this.socket.emit('bank_transfer', { toPlayerId, amount });
    }

    /**
     * Marks a bank inbox notification (or all) as read/dismissed.
     * @param {string} [notificationId='all']
     */
    dismissBankNotification(notificationId = 'all') {
      if (!this.socket) return;
      this.socket.emit('bank_dismiss_notification', { notificationId });
    }

    /**
     * Proposes a loan (borrow or lend).
     * @param {{ toPlayerId: string, type: 'borrow'|'lend', amount: number, interestPct: number, winDeductionPct: number }} params 
     */
    proposeLoan(params) {
      if (!this.socket) return;
      this.socket.emit('bank_loan_propose', params);
    }

    /**
     * Accepts or declines a loan proposal.
     * @param {string} proposalId 
     * @param {'accept'|'decline'} action 
     */
    respondLoan(proposalId, action) {
      if (!this.socket) return;
      this.socket.emit('bank_loan_respond', { proposalId, action });
    }

    /**
     * Repays an active debt.
     * @param {string} loanId 
     * @param {number} [amount] 
     */
    repayDebt(loanId, amount) {
      if (!this.socket) return;
      this.socket.emit('bank_repay_debt', { loanId, amount });
    }

    /**
     * Forgives a loan (as lender).
     * @param {string} loanId 
     */
    forgiveLoan(loanId) {
      if (!this.socket) return;
      this.socket.emit('bank_forgive_loan', { loanId });
    }

    /**
     * Claims 100 free bailout chips.
     */
    claimBailout() {
      if (!this.socket) return;
      this.socket.emit('bank_claim_bailout', {});
    }

    /**
     * Requests profile information for a player.
     * @param {string} [playerId] 
     */
    getProfile(playerId) {
      if (!this.socket) return;
      this.socket.emit('profile_get', { playerId });
    }

    /**
     * Updates profile customization (color, avatar).
     * @param {{ color?: string, avatar?: string }} customization 
     */
    updateProfile(customization) {
      if (!this.socket) return;
      this.socket.emit('profile_update', customization);
    }

    /**
     * Updates or sets account password.
     * @param {string} newPassword
     * @param {string} [oldPassword='']
     */
    setPassword(newPassword, oldPassword = '') {
      if (!this.socket) return;
      this.socket.emit('player_set_password', { newPassword, oldPassword });
    }

    /**
     * Updates player active game presence.
     * @param {string} game 
     */
    setGamePresence(game) {
      if (!this.socket) return;
      this.socket.emit('player_set_game', { game, location: (game || '').toUpperCase() });
    }

    /**
     * Updates player location and table seat presence.
     * @param {'LOBBY'|'ROULETTE'|'BLACKJACK'} location 
     * @param {number|null} [seatIndex=null] 
     */
    setPlayerPresence(location, seatIndex = null) {
      if (!this.socket) return;
      this.socket.emit('player_set_location', {
        location,
        seatIndex
      });
    }

    /**
     * Joins or switches to a Blackjack table.
     * @param {string} [tableId='table_1']
     */
    bjJoinTable(tableId = 'table_1') {
      if (!this.socket) return;
      this.socket.emit('bj_join_table', { tableId });
    }

    /**
     * Claims an open seat at the Blackjack table.
     * Supports both (seatIndex, tableId) and (tableId, seatIndex).
     * @param {number|string} arg1 
     * @param {string|number} [arg2='table_1']
     */
    bjTakeSeat(arg1, arg2 = 'table_1') {
      if (!this.socket) return;
      let seatIndex = -1;
      let tableId = 'table_1';
      if (typeof arg1 === 'number') {
        seatIndex = arg1;
        tableId = typeof arg2 === 'string' ? arg2 : 'table_1';
      } else if (typeof arg1 === 'string') {
        tableId = arg1;
        seatIndex = typeof arg2 === 'number' ? arg2 : parseInt(arg2, 10);
      }
      this.socket.emit('bj_take_seat', { seatIndex, tableId });
    }

    /**
     * Vacates a seat at the Blackjack table.
     * Supports both (seatIndex, tableId) and (tableId, seatIndex).
     * @param {number|string} [arg1] 
     * @param {string|number} [arg2='table_1']
     */
    bjLeaveSeat(arg1, arg2 = 'table_1') {
      if (!this.socket) return;
      let seatIndex = -1;
      let tableId = 'table_1';
      if (typeof arg1 === 'number') {
        seatIndex = arg1;
        tableId = typeof arg2 === 'string' ? arg2 : 'table_1';
      } else if (typeof arg1 === 'string') {
        tableId = arg1;
        seatIndex = typeof arg2 === 'number' ? arg2 : parseInt(arg2, 10);
      }
      this.socket.emit('bj_leave_seat', { seatIndex, tableId });
    }

    /**
     * Places or increases bet on a seat during BETTING phase.
     * Supports both (seatIndex, amount, tableId) and (tableId, seatIndex, amount).
     */
    bjPlaceBet(arg1, arg2, arg3 = 'table_1') {
      if (!this.socket) return;
      let tableId = 'table_1';
      let seatIndex = 0;
      let amount = 0;
      if (typeof arg1 === 'string' && (arg1.startsWith('table_') || isNaN(parseInt(arg1, 10)))) {
        tableId = arg1;
        seatIndex = typeof arg2 === 'number' ? arg2 : parseInt(arg2, 10);
        amount = typeof arg3 === 'number' ? arg3 : parseInt(arg3, 10);
      } else {
        seatIndex = typeof arg1 === 'number' ? arg1 : parseInt(arg1, 10);
        amount = typeof arg2 === 'number' ? arg2 : parseInt(arg2, 10);
        tableId = typeof arg3 === 'string' ? arg3 : 'table_1';
      }
      this.socket.emit('bj_place_bet', { seatIndex, amount, tableId });
    }

    /**
     * Clears all bets on a seat during BETTING phase.
     * Supports both (seatIndex, tableId) and (tableId, seatIndex).
     */
    bjClearBet(arg1, arg2 = 'table_1') {
      if (!this.socket) return;
      let seatIndex = -1;
      let tableId = 'table_1';
      if (typeof arg1 === 'number') {
        seatIndex = arg1;
        tableId = typeof arg2 === 'string' ? arg2 : 'table_1';
      } else if (typeof arg1 === 'string') {
        tableId = arg1;
        seatIndex = typeof arg2 === 'number' ? arg2 : parseInt(arg2, 10);
      }
      this.socket.emit('bj_clear_bet', { seatIndex, tableId });
    }

    /**
     * Immediately triggers card dealing on the Blackjack table during BETTING phase.
     * @param {string} [tableId='table_1']
     */
    bjDealNow(tableId = 'table_1') {
      if (!this.socket) return;
      this.socket.emit('bj_deal_now', { tableId });
    }

    /**
     * Submits a player decision action on the active hand.
     * Supports both (action, seatIndex, handIndex, tableId) and (tableId, action, seatIndex, handIndex).
     */
    bjAction(arg1, arg2, arg3 = 0, arg4 = 'table_1') {
      if (!this.socket) return;
      let action = 'hit';
      let seatIndex = 0;
      let handIndex = 0;
      let tableId = 'table_1';
      if (typeof arg1 === 'string' && ['table_1', 'table_2'].includes(arg1)) {
        tableId = arg1;
        action = arg2;
        seatIndex = typeof arg3 === 'number' ? arg3 : 0;
        handIndex = typeof arg4 === 'number' ? arg4 : 0;
      } else if (typeof arg1 === 'string' && ['hit', 'stand', 'double', 'split'].includes(arg1)) {
        action = arg1;
        seatIndex = typeof arg2 === 'number' ? arg2 : 0;
        handIndex = typeof arg3 === 'number' ? arg3 : 0;
        tableId = typeof arg4 === 'string' ? arg4 : 'table_1';
      } else {
        action = String(arg1 || 'hit');
        seatIndex = typeof arg2 === 'number' ? arg2 : 0;
        handIndex = typeof arg3 === 'number' ? arg3 : 0;
        tableId = typeof arg4 === 'string' ? arg4 : 'table_1';
      }
      this.socket.emit('bj_action', { action, seatIndex, handIndex, tableId });
    }

    /**
     * Joins or switches to a Texas Hold'em Poker table.
     * @param {string} [tableId='poker_1']
     */
    pokerJoinTable(tableId = 'poker_1') {
      if (!this.socket) return;
      this.socket.emit('poker_join_table', { tableId: tableId || 'poker_1' });
    }

    /**
     * Leaves the Texas Hold'em Poker table room.
     * @param {string} [tableId='poker_1']
     */
    pokerLeaveTable(tableId = 'poker_1') {
      if (!this.socket) return;
      this.socket.emit('poker_leave_table', { tableId: tableId || 'poker_1' });
    }

    /**
     * Claims an open seat at the Poker table with specified buy-in.
     * Supports both (seatIndex, buyInAmount, tableId) and ({ seatIndex, buyInAmount, tableId }).
     * @param {number|Object} arg1
     * @param {number} [arg2=2000]
     * @param {string} [arg3='poker_1']
     */
    pokerTakeSeat(arg1, arg2 = null, arg3 = 'poker_1') {
      if (!this.socket) return;
      let seatIndex = null;
      let buyInAmount = null;
      let fixedEntry = false;
      let tableId = 'poker_1';
      if (typeof arg1 === 'object' && arg1 !== null) {
        seatIndex = typeof arg1.seatIndex === 'number' ? arg1.seatIndex : (arg1.seatIndex !== undefined && arg1.seatIndex !== null ? parseInt(arg1.seatIndex, 10) : null);
        buyInAmount = typeof arg1.buyInAmount === 'number' ? arg1.buyInAmount : (typeof arg1.amount === 'number' ? arg1.amount : null);
        fixedEntry = !!arg1.fixedEntry || buyInAmount === null;
        tableId = arg1.tableId || 'poker_1';
      } else {
        seatIndex = typeof arg1 === 'number' ? arg1 : (arg1 !== undefined && arg1 !== null ? parseInt(arg1, 10) : null);
        buyInAmount = typeof arg2 === 'number' ? arg2 : (arg2 !== null && arg2 !== undefined ? parseInt(arg2, 10) : null);
        fixedEntry = buyInAmount === null || isNaN(buyInAmount);
        tableId = typeof arg3 === 'string' ? arg3 : 'poker_1';
      }
      if (typeof seatIndex !== 'number' || isNaN(seatIndex) || seatIndex < 0 || seatIndex > 5) {
        console.warn('pokerTakeSeat rejected: explicit seatIndex (0-5) required');
        return;
      }
      this.socket.emit('poker_take_seat', { seatIndex, buyInAmount, fixedEntry, tableId });
    }

    /**
     * Vacates a seat at the Poker table.
     * @param {number|Object} [arg1]
     * @param {string} [arg2='poker_1']
     */
    pokerLeaveSeat(arg1, arg2 = 'poker_1') {
      if (!this.socket) return;
      let seatIndex = -1;
      let tableId = 'poker_1';
      if (typeof arg1 === 'object' && arg1 !== null) {
        seatIndex = typeof arg1.seatIndex === 'number' ? arg1.seatIndex : -1;
        tableId = arg1.tableId || 'poker_1';
      } else if (typeof arg1 === 'number') {
        seatIndex = arg1;
        tableId = typeof arg2 === 'string' ? arg2 : 'poker_1';
      } else if (typeof arg1 === 'string') {
        tableId = arg1;
      }
      this.socket.emit('poker_leave_seat', { seatIndex, tableId });
    }

    /**
     * Submits a player decision action on the active poker turn.
     * Supports both (action, amount, seatIndex, tableId) and ({ action, amount, seatIndex, tableId }).
     * @param {string|Object} arg1
     * @param {number} [arg2=0]
     * @param {number} [arg3=0]
     * @param {string} [arg4='poker_1']
     */
    pokerAction(arg1, arg2 = 0, arg3 = 0, arg4 = 'poker_1') {
      if (!this.socket) return;
      let action = 'check';
      let amount = 0;
      let seatIndex = 0;
      let tableId = 'poker_1';
      if (typeof arg1 === 'object' && arg1 !== null) {
        action = arg1.action || 'check';
        amount = typeof arg1.amount === 'number' ? arg1.amount : 0;
        seatIndex = typeof arg1.seatIndex === 'number' ? arg1.seatIndex : 0;
        tableId = arg1.tableId || 'poker_1';
      } else {
        action = String(arg1 || 'check');
        amount = typeof arg2 === 'number' ? arg2 : parseInt(arg2, 10) || 0;
        seatIndex = typeof arg3 === 'number' ? arg3 : parseInt(arg3, 10) || 0;
        tableId = typeof arg4 === 'string' ? arg4 : 'poker_1';
      }
      this.socket.emit('poker_action', { action, amount, seatIndex, tableId });
    }

    /**
     * Tops up table stack between hands (buy-in / rebuy).
     * @param {number|Object} arg1
     * @param {number} [arg2=0]
     * @param {string} [arg3='poker_1']
     */
    pokerBuyIn(arg1, arg2 = 0, arg3 = 'poker_1') {
      if (!this.socket) return;
      let amount = 0;
      let seatIndex = 0;
      let tableId = 'poker_1';
      if (typeof arg1 === 'object' && arg1 !== null) {
        amount = typeof arg1.amount === 'number' ? arg1.amount : 0;
        seatIndex = typeof arg1.seatIndex === 'number' ? arg1.seatIndex : 0;
        tableId = arg1.tableId || 'poker_1';
      } else {
        amount = typeof arg1 === 'number' ? arg1 : parseInt(arg1, 10) || 0;
        seatIndex = typeof arg2 === 'number' ? arg2 : parseInt(arg2, 10) || 0;
        tableId = typeof arg3 === 'string' ? arg3 : 'poker_1';
      }
      this.socket.emit('poker_rebuy', { amount, seatIndex, tableId });
    }

    /**
     * Alias for pokerBuyIn
     */
    pokerRebuy(arg1, arg2 = 0, arg3 = 'poker_1') {
      this.pokerBuyIn(arg1, arg2, arg3);
    }

    /**
     * Requests latest Crash table state snapshot.
     */
    crashJoinTable() {
      if (!this.socket) return;
      this.socket.emit('crash_join_table', {});
    }

    /**
     * Places or increases bet on Crash during BETTING phase.
     * @param {{ amount: number, autoCashout?: number|null }} payload
     */
    crashPlaceBet(payload = {}) {
      if (!this.socket) return;
      this.socket.emit('crash_place_bet', payload);
    }

    /**
     * Cancels active bet on Crash during BETTING phase.
     */
    crashCancelBet() {
      if (!this.socket) return;
      this.socket.emit('crash_cancel_bet', {});
    }

    /**
     * Manually cashes out active Crash bet during RUNNING phase.
     * @param {{ multiplier?: number }} [payload={}]
     */
    crashCashOut(payload = {}) {
      if (!this.socket) return;
      this.socket.emit('crash_cash_out', payload);
    }

    /**
     * Requests latest Plinko state & recent drops history.
     */
    plinkoJoin() {
      if (!this.socket) return;
      this.socket.emit('plinko_join', {});
    }

    /**
     * Submits a Plinko ball drop (1 to 10 balls) to the server.
     * @param {{ amount: number, rows: number, risk: string, count?: number }} payload
     */
    plinkoDrop(payload = {}) {
      if (!this.socket) return;
      this.socket.emit('plinko_drop', payload);
    }

    /**
     * Requests initial AviaMasters state and recent flight log.
     */
    aviaJoin() {
      if (!this.socket) return;
      this.socket.emit('avia_join', {});
    }

    /**
     * Launches an authoritative AviaMasters arcade flight.
     * @param {{ amount: number, speed?: '1x'|'2x'|'4x' }} payload
     */
    aviaFly(payload = {}) {
      if (!this.socket) return;
      this.socket.emit('avia_fly', payload);
    }

    /**
     * Joins the Slots floor (auto-assigning an open cabinet or preferred machineId).
     * @param {number|null} [machineId]
     */
    slotsJoin(machineId = null) {
      if (!this.socket) return;
      this.socket.emit('slots_join', { machineId });
    }

    /**
     * Switches to a specific Slots floor cabinet (1..8).
     * @param {number} machineId
     */
    slotsSelectMachine(machineId) {
      if (!this.socket) return;
      this.socket.emit('slots_select_machine', { machineId });
    }

    /**
     * Sends an authoritative spin request (paid, free spin, or Bonus Buy).
     * @param {{ bet?: number, isBonusBuy?: boolean, machineId?: number }} [payload]
     */
    slotsSpin(payload = {}) {
      if (!this.socket) return;
      this.socket.emit('slots_spin', payload);
    }

    /**
     * Requests the current Monaco Turf Club Derby race state.
     */
    racingJoin() {
      if (!this.socket) return;
      this.socket.emit('racing_join', {});
    }

    /**
     * Submits a WIN or PLACE horse racing ticket.
     * @param {{ horseId: number, betType: 'WIN'|'PLACE', amount: number }} payload
     */
    racingPlaceBet(payload = {}) {
      if (!this.socket) return;
      this.socket.emit('racing_place_bet', payload);
    }

    /**
     * Cancels an unsettled ticket before gates lock.
     * @param {string} ticketId
     */
    racingCancelBet(ticketId) {
      if (!this.socket) return;
      this.socket.emit('racing_cancel_bet', { ticketId });
    }

    /**
     * Sends a purely cosmetic cheer hype pulse for a horse.
     * @param {number} horseId
     */
    racingCheer(horseId) {
      if (!this.socket) return;
      this.socket.emit('racing_cheer', { horseId });
    }

    hiloJoin() {
      if (!this.socket) return;
      this.socket.emit('hilo_join', {});
    }

    hiloStart(betAmount) {
      if (!this.socket) return;
      this.socket.emit('hilo_start', { betAmount });
    }

    hiloGuess(prediction) {
      if (!this.socket) return;
      this.socket.emit('hilo_guess', { prediction });
    }

    hiloSkip() {
      if (!this.socket) return;
      this.socket.emit('hilo_skip', {});
    }

    hiloHalfCashout() {
      if (!this.socket) return;
      this.socket.emit('hilo_half_cashout', {});
    }

    hiloCashout() {
      if (!this.socket) return;
      this.socket.emit('hilo_cashout', {});
    }

    minesJoin() {
      if (!this.socket) return;
      this.socket.emit('mines_join', {});
    }

    minesSoloStart(payload = {}) {
      if (!this.socket) return;
      this.socket.emit('mines_solo_start', payload);
    }

    minesSoloClick(tileIndex) {
      if (!this.socket) return;
      this.socket.emit('mines_solo_click', { tileIndex });
    }

    minesSoloCashout() {
      if (!this.socket) return;
      this.socket.emit('mines_solo_cashout', {});
    }

    minesSharedVote(payload = {}) {
      if (!this.socket) return;
      this.socket.emit('mines_shared_vote', payload);
    }

    minesSharedJoin(payload = {}) {
      if (!this.socket) return;
      this.socket.emit('mines_shared_join', payload);
    }

    minesSharedCancel() {
      if (!this.socket) return;
      this.socket.emit('mines_shared_cancel', {});
    }

    minesSharedClick(tileIndex) {
      if (!this.socket) return;
      this.socket.emit('mines_shared_click', { tileIndex });
    }

    minesSharedCashout() {
      if (!this.socket) return;
      this.socket.emit('mines_shared_cashout', {});
    }

    crossJoin() {
      if (!this.socket) return;
      this.socket.emit('cross_join', {});
    }

    crossStart(payload = {}) {
      if (!this.socket) return;
      this.socket.emit('cross_start', payload);
    }

    crossStep() {
      if (!this.socket) return;
      this.socket.emit('cross_step', {});
    }

    crossCashout() {
      if (!this.socket) return;
      this.socket.emit('cross_cashout', {});
    }

    requestLotteryState() {
      if (!this.socket) return;
      this.socket.emit('lottery_get_state', {});
    }

    buyLotteryTickets(count) {
      if (!this.socket) return;
      this.socket.emit('lottery_buy_tickets', { count });
    }

    ackLotteryOfflineWin(roundId) {
      if (!this.socket) return;
      this.socket.emit('lottery_ack_offline_win', { roundId });
    }

    ackLotteryOfflineOutcome(roundId) {
      if (!this.socket) return;
      this.socket.emit('lottery_ack_offline_outcome', { roundId });
    }

    /**
     * Requests the latest Global All-Time Leaderboard snapshot.
     * @param {Object} [options]
     */
    getGlobalLeaderboard(options = {}) {
      if (!this.socket) return;
      const payload = (options && typeof options === 'object') ? { ...options } : {};
      const lbBackup = this.getLeaderboardBackup();
      if (lbBackup && lbBackup.length > 0) {
        payload.leaderboardBackup = lbBackup;
      }
      this.socket.emit('leaderboard_get', payload);
    }
  }

  return CasinoNetwork;
}));
