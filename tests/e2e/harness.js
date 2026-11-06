/**
 * harness.js
 * E2E Test Harness for European Roulette Multiplayer Casino.
 * Provides ephemeral in-process server management, typed Socket.io client wrapper,
 * and HTTP inspection helpers using Node 24 native capabilities.
 */

const http = require('http');
const ioClient = require('socket.io-client');
const app = require('../../server/app');
const { setupSocket } = require('../../server/socket');

/**
 * Starts an ephemeral in-process test server.
 * @param {Object} [options]
 * @param {boolean} [options.autoStartEngine=true]
 * @returns {Promise<{
 *   server: http.Server,
 *   io: import('socket.io').Server,
 *   playerManager: any,
 *   engine: any,
 *   broadcastChatMessage: Function,
 *   port: number,
 *   url: string,
 *   close: () => Promise<void>
 * }>}
 */
function startTestServer(options = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const { io, playerManager, engine, blackjackTables, broadcastChatMessage } = setupSocket(server, options);

    if (options.autoStartEngine !== false) {
      engine.start();
      if (blackjackTables) {
        for (const tbl of blackjackTables.values()) {
          tbl.start();
        }
      }
    }

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address.port;
      const url = `http://127.0.0.1:${port}`;

      async function close() {
        try {
          engine.stop();
          if (blackjackTables) {
            for (const tbl of blackjackTables.values()) {
              tbl.stop();
            }
          }
          const sockets = await io.fetchSockets();
          for (const s of sockets) {
            s.disconnect(true);
          }
          await new Promise((r) => io.close(r));
          await new Promise((r) => server.close(r));
        } catch (err) {
          // Ignore shutdown cleanup errors
        }
      }

      resolve({
        server,
        io,
        playerManager,
        engine,
        broadcastChatMessage,
        port,
        url,
        close
      });
    });

    server.on('error', reject);
  });
}

/**
 * Creates an instrumented Socket.io test client.
 * @param {string} serverUrl 
 * @param {Object} [clientOptions] 
 */
function createTestClient(serverUrl, clientOptions = {}) {
  const socket = ioClient(serverUrl, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    autoConnect: false,
    ...clientOptions
  });

  const eventHistory = [];
  const eventMap = new Map();
  const waiters = new Map();

  function recordEvent(name, data) {
    eventHistory.push({ name, data, time: Date.now() });
    if (!eventMap.has(name)) eventMap.set(name, []);
    eventMap.get(name).push(data);

    if (waiters.has(name)) {
      const pendingList = waiters.get(name);
      for (let i = pendingList.length - 1; i >= 0; i--) {
        const { predicate, resolve } = pendingList[i];
        if (!predicate || predicate(data)) {
          pendingList.splice(i, 1);
          resolve(data);
        }
      }
    }
  }

  socket.onAny((event, ...args) => {
    recordEvent(event, args[0]);
  });

  const client = {
    socket,
    id: null,
    eventHistory,
    eventMap,

    /**
     * Connects to the server.
     * @param {number} [timeoutMs=5000]
     */
    async connect(timeoutMs = 5000) {
      if (socket.connected) {
        client.id = socket.id;
        return socket;
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Socket connection timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        socket.once('connect', () => {
          clearTimeout(timer);
          client.id = socket.id;
          resolve(socket);
        });

        socket.once('connect_error', (err) => {
          clearTimeout(timer);
          reject(err);
        });

        socket.connect();
      });
    },

    /**
     * Waits for an event matching optional predicate.
     * @param {string} eventName 
     * @param {Function} [predicate] 
     * @param {number} [timeoutMs=5000] 
     */
    async waitFor(eventName, predicate = null, timeoutMs = 5000) {
      const existing = eventMap.get(eventName) || [];
      for (const item of existing) {
        if (!predicate || predicate(item)) {
          return item;
        }
      }

      return this.waitForNext(eventName, predicate, timeoutMs);
    },

    /**
     * Waits strictly for a FUTURE event arriving after this call.
     * @param {string} eventName 
     * @param {Function} [predicate] 
     * @param {number} [timeoutMs=5000] 
     */
    async waitForNext(eventName, predicate = null, timeoutMs = 5000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const received = Array.from(eventMap.keys()).join(', ');
          reject(new Error(`Timeout waiting for next event '${eventName}' after ${timeoutMs}ms. Received: [${received}]`));
        }, timeoutMs);

        if (!waiters.has(eventName)) {
          waiters.set(eventName, []);
        }

        waiters.get(eventName).push({
          predicate,
          resolve: (data) => {
            clearTimeout(timer);
            resolve(data);
          }
        });
      });
    },

    /**
     * Clears recorded events in memory.
     * @param {string} [eventName]
     */
    clearEvents(eventName) {
      if (eventName) {
        eventMap.delete(eventName);
      } else {
        eventMap.clear();
      }
    },

    /**
     * Joins the table.
     * @param {{ id?: string, name?: string, avatar?: string, color?: string }} [payload] 
     */
    async joinTable({ id, name = 'Tester', avatar = 'avatar1', color = '#d4af37' } = {}) {
      const statePromise = client.waitFor('table_state');
      socket.emit('join_table', { id, name, avatar, color });
      const state = await statePromise;
      if (state && state.playerId) {
        client.playerId = state.playerId;
      }
      return state;
    },

    /**
     * Places a bet and awaits bet_accepted or bet_rejected.
     * @param {{ type: string, value: any, amount: number }} betPayload 
     * @param {number} [timeoutMs=5000] 
     * @returns {Promise<{ accepted: boolean, data?: Object, error?: Object }>}
     */
    async placeBet(betPayload, timeoutMs = 5000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Timeout waiting for place_bet response (${betPayload.type}, ${betPayload.amount}) after ${timeoutMs}ms`));
        }, timeoutMs);

        function cleanup() {
          clearTimeout(timer);
          socket.off('bet_accepted', onAccepted);
          socket.off('bet_rejected', onRejected);
        }

        function onAccepted(payload) {
          cleanup();
          resolve({ accepted: true, data: payload });
        }

        function onRejected(payload) {
          cleanup();
          resolve({ accepted: false, error: payload });
        }

        socket.on('bet_accepted', onAccepted);
        socket.on('bet_rejected', onRejected);

        socket.emit('place_bet', betPayload);
      });
    },

    /**
     * Clears all bets for this player.
     * @param {number} [timeoutMs=5000] 
     * @returns {Promise<{ cleared: boolean, chips?: number, error?: Object }>}
     */
    async clearBets(timeoutMs = 5000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Timeout waiting for clear_bets response after ${timeoutMs}ms`));
        }, timeoutMs);

        function cleanup() {
          clearTimeout(timer);
          socket.off('chips_update', onUpdate);
          socket.off('bet_rejected', onRejected);
        }

        function onUpdate(payload) {
          cleanup();
          resolve({ cleared: true, chips: payload.chips });
        }

        function onRejected(payload) {
          cleanup();
          resolve({ cleared: false, error: payload });
        }

        socket.on('chips_update', onUpdate);
        socket.on('bet_rejected', onRejected);

        socket.emit('clear_bets', {});
      });
    },

    /**
     * Sends a chat message.
     * @param {string} text 
     */
    sendChat(text) {
      socket.emit('chat_message', { text });
    },

    /**
     * Cleanly disconnects the socket client.
     */
    async disconnect() {
      if (socket.connected) {
        socket.disconnect();
      }
      return new Promise((r) => setTimeout(r, 50));
    }
  };

  return client;
}

/**
 * Performs a simple HTTP GET request.
 * @param {string} baseUrl 
 * @param {string} [path='/'] 
 */
async function httpGet(baseUrl, path = '/') {
  const fullUrl = new URL(path, baseUrl).toString();
  const res = await fetch(fullUrl);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (e) {
    // not JSON
  }
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    text,
    json
  };
}

module.exports = {
  startTestServer,
  createTestClient,
  httpGet
};
