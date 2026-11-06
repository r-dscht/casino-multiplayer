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

        // Auto authenticate session on socket connect if stored bearer token exists
        const token = this.getStoredToken();
        if (token) {
          const storedName = (typeof localStorage !== 'undefined')
            ? (localStorage.getItem('casino_player_name') || localStorage.getItem('roulette_player_name'))
            : null;
          const storedColor = (typeof localStorage !== 'undefined')
            ? (localStorage.getItem('casino_player_color') || localStorage.getItem('roulette_player_color'))
            : null;
          const storedPassword = (typeof localStorage !== 'undefined')
            ? (localStorage.getItem('casino_player_password') || localStorage.getItem('roulette_player_password'))
            : null;
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
        this.emitInternal('table_state', data);
      });

      this.socket.on('phase_tick', (data) => {
        this.emitInternal('phase_tick', data);
      });

      this.socket.on('phase_change', (data) => {
        this.emitInternal('phase_change', data);
      });

      this.socket.on('round_result', (data) => {
        this.emitInternal('round_result', data);
      });

      this.socket.on('bet_accepted', (data) => {
        this.emitInternal('bet_accepted', data);
      });

      this.socket.on('bet_rejected', (data) => {
        this.emitInternal('bet_rejected', data);
      });

      this.socket.on('bet_placed', (data) => {
        this.emitInternal('bet_placed', data);
      });

      this.socket.on('bets_cleared', (data) => {
        this.emitInternal('bets_cleared', data);
      });

      this.socket.on('chips_update', (data) => {
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
        this.emitInternal('bank_update', data);
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
        this.emitInternal('profile_updated', data);
      });

      this.socket.on('navigation_blocked', (data) => {
        this.emitInternal('navigation_blocked', data);
      });

      this.socket.on('game_switched', (data) => {
        this.emitInternal('game_switched', data);
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
        this.emitInternal('bj_round_result', data);
      });

      this.socket.on('bj_round_end', (data) => {
        this.emitInternal('bj_round_end', data);
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
        password: payload.password
      });
    }

    /**
     * Sends join_table event with bearer session token.
     * @param {{ name?: string, avatar?: string, color?: string, sessionToken?: string }} playerProfile 
     */
    joinTable(playerProfile = {}) {
      if (!this.socket) return;
      const token = playerProfile.sessionToken || this.getStoredToken();
      this.socket.emit('join_table', {
        ...playerProfile,
        sessionToken: token
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
    getBankState() {
      if (!this.socket) return;
      this.socket.emit('bank_get_state', {});
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
  }

  return CasinoNetwork;
}));
