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
      this.myPlayerId = null;
      this.sessionToken = this.getStoredToken();
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
     * Updates local player state backup in localStorage.
     * @param {Object} patch
     */
    saveClientBackup(patch = {}) {
      if (!patch || typeof patch !== 'object') return;
      try {
        if (typeof localStorage !== 'undefined') {
          const existing = this.getClientBackup() || {};
          const merged = {
            ...existing,
            ...patch,
            updatedAt: Date.now()
          };
          localStorage.setItem('casino_player_backup', JSON.stringify(merged));
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
        this.emitInternal('connection_change', { connected: true, id: this.socket.id });

        // Auto authenticate session on socket connect if stored bearer token or account name exists
        const token = this.getStoredToken();
        const storedName = (typeof localStorage !== 'undefined')
          ? (localStorage.getItem('casino_player_name') || localStorage.getItem('roulette_player_name'))
          : null;
        const storedColor = (typeof localStorage !== 'undefined')
          ? (localStorage.getItem('casino_player_color') || localStorage.getItem('roulette_player_color'))
          : null;
        const storedPassword = (typeof localStorage !== 'undefined')
          ? (localStorage.getItem('casino_player_password') || localStorage.getItem('roulette_player_password'))
          : null;

        if (token || storedName) {
          this.authSession({ sessionToken: token, name: storedName, color: storedColor, password: storedPassword });
        }
      });

      this.socket.on('disconnect', (reason) => {
        this.isConnected = false;
        this.emitInternal('connection_change', { connected: false, reason });
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
            this.saveClientBackup({ chips: myRes.chips });
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
        this.emitInternal('players_update', data);
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
            this.saveClientBackup({ chips: myRes.chips });
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
    }

    /**
     * Authenticates or resumes a session with the bearer sessionToken.
     * @param {{ sessionToken?: string, name?: string, color?: string, password?: string }} [payload]
     */
    authSession(payload = {}) {
      if (!this.socket) return;
      const token = payload.sessionToken || this.getStoredToken();
      this.socket.emit('auth_session', {
        sessionToken: token,
        name: payload.name,
        color: payload.color,
        password: payload.password,
        clientBackup: this.getClientBackup(),
        bankBackup: this.getBankBackup()
      });
    }

    /**
     * Sends join_table event with bearer session token.
     * @param {{ name?: string, avatar?: string, color?: string, sessionToken?: string }} playerProfile 
     */
    joinTable(playerProfile = {}) {
      if (!this.socket) return;
      const token = playerProfile.sessionToken || this.getStoredToken();
      const backup = this.getClientBackup();
      // Only attach clientBackup if it belongs to the same username (or no username is in backup)
      const sameUser = !backup || !backup.name || !playerProfile.name ||
        backup.name.trim().toLowerCase() === playerProfile.name.trim().toLowerCase();
      this.socket.emit('join_table', {
        ...playerProfile,
        sessionToken: token,
        clientBackup: sameUser ? backup : null,
        bankBackup: sameUser ? this.getBankBackup() : null
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
  }

  return CasinoNetwork;
}));
