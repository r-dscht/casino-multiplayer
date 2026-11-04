const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { io: Client } = require('socket.io-client');

const app = require('../../server/app');
const { setupSocket } = require('../../server/socket');
const { BET_TYPES } = require('../../server/game/rouletteConstants');

describe('Socket.IO Event Protocol & Lifecycle Integration', () => {
  let server;
  let socketHandler;
  let serverPort;
  let clientSocket;

  before(async () => {
    server = http.createServer(app);
    socketHandler = setupSocket(server);

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    if (clientSocket && clientSocket.connected) {
      clientSocket.disconnect();
    }
    if (socketHandler && socketHandler.engine) {
      socketHandler.engine.stop();
    }
    if (socketHandler && socketHandler.io) {
      await new Promise(resolve => socketHandler.io.close(resolve));
    }
    await new Promise(resolve => server.close(resolve));
  });

  it('should connect, join table, and receive table_state with 10,000 chips', async () => {
    clientSocket = Client(`http://127.0.0.1:${serverPort}`, {
      transports: ['websocket'],
      forceNew: true
    });

    await new Promise((resolve) => {
      clientSocket.on('connect', resolve);
    });

    const statePromise = new Promise((resolve) => {
      clientSocket.once('table_state', resolve);
    });

    clientSocket.emit('join_table', {
      name: 'JamesBond',
      avatar: 'avatar_1',
      color: '#10b981'
    });

    const state = await statePromise;
    assert.equal(state.currentPhase, 'BETTING');
    assert.ok(Array.isArray(state.players));
    const player = state.players.find(p => p.name === 'JamesBond');
    assert.ok(player, 'Player should be listed in table_state');
    assert.equal(player.chips, 10000);
    assert.equal(player.color, '#10b981');
  });

  it('should accept place_bet and emit bet_accepted', async () => {
    const acceptedPromise = new Promise((resolve) => {
      clientSocket.once('bet_accepted', resolve);
    });

    clientSocket.emit('place_bet', {
      type: BET_TYPES.RED,
      value: null,
      amount: 500
    });

    const accepted = await acceptedPromise;
    assert.ok(accepted.betId);
    assert.equal(accepted.bet.type, 'red');
    assert.equal(accepted.bet.amount, 500);
    assert.equal(accepted.remainingChips, 9500);
    assert.equal(accepted.tableChipsTotal, 500);
  });

  it('should broadcast sanitized chat messages and strip HTML XSS', async () => {
    const chatPromise = new Promise((resolve) => {
      clientSocket.on('chat_message', (msg) => {
        if (!msg.isSystem) resolve(msg);
      });
    });

    clientSocket.emit('chat_message', {
      text: '<b>Good luck!</b> <script>alert("xss")</script>'
    });

    const msg = await chatPromise;
    assert.equal(msg.sender, 'JamesBond');
    assert.ok(!msg.text.includes('<script>'));
    assert.ok(msg.text.includes('&lt;script&gt;'));
    assert.ok(msg.text.includes('&lt;b&gt;Good luck!&lt;&#x2F;b&gt;'));
  });

  it('should clear bets and refund chips to player balance', async () => {
    const updatePromise = new Promise((resolve) => {
      clientSocket.once('chips_update', resolve);
    });

    clientSocket.emit('clear_bets');

    const update = await updatePromise;
    assert.equal(update.chips, 10000); // 9500 + 500 refunded
  });
});
