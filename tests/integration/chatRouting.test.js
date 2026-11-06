/**
 * chatRouting.test.js
 * Integration test suite for Chat Scope Routing & Win Announcement Partitioning.
 * Verifies:
 * 1. Global vs Table chat message scope propagation from client to server broadcast.
 * 2. Table identification (table_1, table_2, roulette) on table scoped messages.
 * 3. Blackjack round result notifications:
 *    - Dealer bust announcements to Table Chat.
 *    - Natural Blackjack announcements to Table Chat and Global Casino Chat.
 *    - Player wins against dealer to Table Chat and Grand Win to Global Casino Chat.
 * 4. Roulette round result notifications to Table Chat and Global Casino Chat.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { io: Client } = require('socket.io-client');

const app = require('../../server/app');
const { setupSocket } = require('../../server/socket');

describe('Chat Scope Routing & Win Notifications Protocol', () => {
  let server;
  let socketHandler;
  let serverPort;
  let client1;
  let client2;

  before(async () => {
    server = http.createServer(app);
    socketHandler = setupSocket(server);

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port;
        resolve();
      });
    });

    client1 = Client(`http://127.0.0.1:${serverPort}`, {
      transports: ['websocket'],
      forceNew: true
    });
    client2 = Client(`http://127.0.0.1:${serverPort}`, {
      transports: ['websocket'],
      forceNew: true
    });

    await Promise.all([
      new Promise((resolve) => client1.on('connect', resolve)),
      new Promise((resolve) => client2.on('connect', resolve))
    ]);

    // Authenticate both clients
    client1.emit('join_table', { name: 'PlayerOne', color: '#d4af37' });
    client2.emit('join_table', { name: 'PlayerTwo', color: '#10b981' });

    await new Promise((r) => setTimeout(r, 100));
  });

  after(async () => {
    if (client1 && client1.connected) client1.disconnect();
    if (client2 && client2.connected) client2.disconnect();
    if (socketHandler && typeof socketHandler.stop === 'function') {
      socketHandler.stop();
    }
    if (socketHandler && socketHandler.io) {
      await new Promise((resolve) => socketHandler.io.close(resolve));
    }
    await new Promise((resolve) => server.close(resolve));
  });

  it('should preserve scope: "table" and table: "table_1" on table chat messages', async () => {
    const receivedPromise = new Promise((resolve) => {
      const handler = (msg) => {
        if (msg.text && msg.text.includes('Table 1 specific message')) {
          client2.off('chat_message', handler);
          resolve(msg);
        }
      };
      client2.on('chat_message', handler);
    });

    client1.emit('chat_message', {
      text: 'Table 1 specific message',
      scope: 'table',
      table: 'table_1'
    });

    const received = await receivedPromise;
    assert.equal(received.scope, 'table');
    assert.equal(received.table, 'table_1');
    assert.equal(received.sender, 'PlayerOne');
  });

  it('should preserve scope: "global" on global casino chat messages', async () => {
    const receivedPromise = new Promise((resolve) => {
      const handler = (msg) => {
        if (msg.text && msg.text.includes('Global casino shoutout')) {
          client2.off('chat_message', handler);
          resolve(msg);
        }
      };
      client2.on('chat_message', handler);
    });

    client1.emit('chat_message', {
      text: 'Global casino shoutout',
      scope: 'global'
    });

    const received = await receivedPromise;
    assert.equal(received.scope, 'global');
    assert.equal(received.sender, 'PlayerOne');
  });

  it('should broadcast Blackjack dealer bust announcements to Table Chat', async () => {
    const table1 = socketHandler.blackjackTables.get('table_1');
    assert.ok(table1, 'Table 1 must exist');

    const bustMsgPromise = new Promise((resolve) => {
      const handler = (msg) => {
        if (msg.isSystem && msg.text && msg.text.includes('[DEALER] Dealer is bust')) {
          client1.off('chat_message', handler);
          resolve(msg);
        }
      };
      client1.on('chat_message', handler);
    });

    // Simulate round_result with busted dealer
    table1.emit('round_result', {
      tableId: 'table_1',
      dealerScore: { value: 24, isBust: true, isSoft: false },
      results: []
    });

    const msg = await bustMsgPromise;
    assert.equal(msg.scope, 'table');
    assert.equal(msg.table, 'table_1');
    assert.ok(msg.text.includes('Dealer is bust met 24!'));
  });

  it('should broadcast Blackjack Natural Blackjack announcements to Table Chat and Global Chat', async () => {
    const table1 = socketHandler.blackjackTables.get('table_1');

    const tableMsgPromise = new Promise((resolve) => {
      const handler = (msg) => {
        if (msg.isSystem && msg.scope === 'table' && msg.text.includes('[BLACKJACK]')) {
          client1.off('chat_message', handler);
          resolve(msg);
        }
      };
      client1.on('chat_message', handler);
    });

    const globalMsgPromise = new Promise((resolve) => {
      const handler = (msg) => {
        if (msg.isSystem && msg.scope === 'global' && msg.text.includes('[BLACKJACK]')) {
          client1.off('chat_message', handler);
          resolve(msg);
        }
      };
      client1.on('chat_message', handler);
    });

    table1.emit('round_result', {
      tableId: 'table_1',
      dealerScore: { value: 20, isBust: false },
      results: [
        {
          playerName: 'Alice',
          hands: [{ outcome: 'BLACKJACK', result: 'BLACKJACK' }],
          totalWon: 2500,
          net: 1500
        }
      ]
    });

    const [tableMsg, globalMsg] = await Promise.all([tableMsgPromise, globalMsgPromise]);
    assert.equal(tableMsg.scope, 'table');
    assert.equal(tableMsg.table, 'table_1');
    assert.ok(tableMsg.text.includes('Alice heeft Natural Blackjack en wint'));
    assert.ok(tableMsg.text.includes((2500).toLocaleString()));

    assert.equal(globalMsg.scope, 'global');
    assert.ok(globalMsg.text.includes('Alice heeft Natural Blackjack aan Blackjack Tafel 1'));
  });

  it('should broadcast Roulette win results to Table Chat and Grand Win to Global Chat', async () => {
    const roulette = socketHandler.rouletteEngine;

    const tableMsgPromise = new Promise((resolve) => {
      const handler = (msg) => {
        if (msg.isSystem && msg.scope === 'table' && msg.table === 'roulette' && msg.text.includes('[CASINO] Round result: 17 Black')) {
          client1.off('chat_message', handler);
          resolve(msg);
        }
      };
      client1.on('chat_message', handler);
    });

    const globalMsgPromise = new Promise((resolve) => {
      const handler = (msg) => {
        if (msg.isSystem && msg.scope === 'global' && msg.text.includes('[GRAND WIN] Bob wint') && msg.text.includes((36000).toLocaleString())) {
          client1.off('chat_message', handler);
          resolve(msg);
        }
      };
      client1.on('chat_message', handler);
    });

    roulette.emit('round_result', {
      winningNumber: 17,
      winningColor: 'black',
      results: [
        {
          playerName: 'Bob',
          totalWon: 36000,
          net: 35000
        }
      ]
    });

    const [tableMsg, globalMsg] = await Promise.all([tableMsgPromise, globalMsgPromise]);
    assert.equal(tableMsg.scope, 'table');
    assert.equal(tableMsg.table, 'roulette');
    assert.ok(tableMsg.text.includes('Bob won'));
    assert.ok(tableMsg.text.includes((36000).toLocaleString()));

    assert.equal(globalMsg.scope, 'global');
    assert.ok(globalMsg.text.includes('Bob wint'));
    assert.ok(globalMsg.text.includes('op Roulette (17 Black)!'));
  });
});
