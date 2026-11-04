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
      this.handlers = new Map();
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

      this.socket.on('chat_message', (data) => {
        this.emitInternal('chat_message', data);
      });
    }

    /**
     * Sends join_table event.
     * @param {{ name: string, avatar?: string, color?: string }} playerProfile 
     */
    joinTable(playerProfile) {
      if (!this.socket) return;
      this.socket.emit('join_table', playerProfile);
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
     * Sends chat_message event.
     * @param {string} text 
     */
    sendChat(text) {
      if (!this.socket) return;
      this.socket.emit('chat_message', { text });
    }
  }

  return CasinoNetwork;
}));
