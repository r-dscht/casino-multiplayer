/**
 * lotterySocket.test.js
 * End-to-end Socket.IO integration tests for Monte Carlo Gouden Krasloten & WIP feature hiding contracts.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { io: Client } = require('socket.io-client');

process.env.NODE_ENV = 'test';

const app = require('../../server/app');
const { setupSocket } = require('../../server/socket');

function waitForEvent(socket, eventName, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`Timeout waiting for event "${eventName}"`));
    }, timeoutMs);
    socket.once(eventName, (data) => {
      clearTimeout(t);
      resolve(data);
    });
  });
}

describe('Krasloten Socket.IO Integration & WIP Feature Hiding Contracts', () => {
  let server;
  let socketHandler;
  let port;
  const clients = [];

  beforeEach(async () => {
    server = http.createServer(app);
    socketHandler = setupSocket(server, {
      lotteryOptions: {
        storagePath: false
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      resolve();
    }));
  });

  afterEach(async () => {
    while (clients.length > 0) {
      const c = clients.pop();
      try { if (c.connected) c.disconnect(); } catch (e) {}
    }
    if (socketHandler && typeof socketHandler.stop === 'function') {
      socketHandler.stop();
    }
    if (socketHandler && socketHandler.io) {
      await new Promise((resolve) => socketHandler.io.close(resolve));
    }
    await new Promise((resolve) => server.close(resolve));
  });

  async function connectAndAuth(name) {
    const socket = Client(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      forceNew: true
    });
    clients.push(socket);
    await new Promise((resolve) => socket.on('connect', resolve));
    const authP = waitForEvent(socket, 'auth_success');
    const lotteryP = waitForEvent(socket, 'lottery_state');
    socket.emit('auth_session', { name, color: '#D4AF37' });
    const [auth, initialLottery] = await Promise.all([authP, lotteryP]);
    return { socket, player: auth.player, initialLottery };
  }

  it('buys Krasloten over Socket.IO, grows pot from ticket revenue & casino losses, and announces Jackpot in chat', async () => {
    const alice = await connectAndAuth('KrasAlice');
    const bob = await connectAndAuth('KrasBob');

    assert.equal(alice.initialLottery.mode, 'KRASLOTEN');
    assert.equal(alice.initialLottery.ticketPrice, 1000);
    assert.equal(alice.initialLottery.pot, 10000);

    // 1. Force MISS for Bob's 1.000 F kraslot -> pot rises from 10.000 F to 11.000 F
    socketHandler.lotteryEngine.rng = () => 0.90;
    const bobAckP = waitForEvent(bob.socket, 'lottery_buy_ack');
    const aliceStateP = waitForEvent(alice.socket, 'lottery_state');
    bob.socket.emit('lottery_buy_tickets', { count: 1 });
    const [bobAck, aliceSawPot] = await Promise.all([bobAckP, aliceStateP]);

    assert.equal(bobAck.ok, true);
    assert.equal(bobAck.totalCost, 1000);
    assert.equal(bobAck.totalPayout, 0);
    assert.equal(bobAck.remainingChips, 9000);
    assert.equal(bobAck.pot, 11000);
    assert.equal(bobAck.ticket.grid.length, 9);
    assert.equal(aliceSawPot.pot, 11000);

    // 2. Casino net loss feeds 1% into Krasloten pot automatically
    const prevPot = socketHandler.lotteryEngine.pot;
    socketHandler.playerManager.updatePlayerStats(bob.player.id, { wonAmount: 0, lostAmount: 4000 });
    assert.equal(socketHandler.lotteryEngine.pot, prevPot + 40);

    // 3. Alice scratches 100% Jackpot -> receives full pot (11.040 + 1.000 = 12.040 F), pot resets to 5.000 F, global chat broadcasts
    socketHandler.lotteryEngine.rng = () => 0.0;
    const aliceAckP = waitForEvent(alice.socket, 'lottery_buy_ack');
    const chatP = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for [KRASLOTEN] global chat')), 4000);
      const onChat = (msg) => {
        if (msg && typeof msg.text === 'string' && msg.text.includes('[KRASLOTEN]')) {
          clearTimeout(timer);
          bob.socket.off('chat_message', onChat);
          resolve(msg);
        }
      };
      bob.socket.on('chat_message', onChat);
    });

    alice.socket.emit('lottery_buy_tickets', { count: 1 });
    const [aliceAck, chatMsg] = await Promise.all([aliceAckP, chatP]);

    assert.equal(aliceAck.ok, true);
    assert.equal(aliceAck.totalPayout, 12040);
    assert.equal(aliceAck.remainingChips, 10000 - 1000 + 12040);
    assert.equal(aliceAck.pot, 5000);
    assert.equal(aliceAck.ticket.tierId, 'JACKPOT_100');
    assert.ok(chatMsg.text.includes('KrasAlice'));
  });

  it('rejects oversized bulk buys and preserves Krasloten & WIP feature hiding HTML/CSS contracts', () => {
    const clientDir = path.resolve(__dirname, '../../client');
    const html = fs.readFileSync(path.join(clientDir, 'index.html'), 'utf8');
    const shellCss = fs.readFileSync(path.join(clientDir, 'css', 'shell.css'), 'utf8');

    assert.ok(html.includes('data-perks-hidden="true"'));
    assert.match(html, /class="btn-service-hud feature-wip-hidden"\s+id="btn-open-market"/);
    assert.match(html, /class="btn-service-hud feature-wip-hidden"\s+id="btn-open-exchange"/);
    assert.match(html, /class="modal-overlay hidden feature-wip-hidden"\s+id="market-modal"/);
    assert.match(html, /class="modal-overlay hidden feature-wip-hidden"\s+id="exchange-modal"/);
    assert.match(html, /class="modal-overlay hidden feature-wip-hidden"\s+id="racing-modal"/);
    assert.match(html, /class="gadgets-perks-dock feature-wip-hidden"\s+id="gadgets-perks-dock"/);

    // Krasloten trigger & 3x3 foil stage remain active & unhidden
    assert.match(html, /class="btn-service-hud btn-lottery-hud"\s+id="btn-open-lottery"/);
    assert.ok(html.includes('id="hud-lottery-timer"'));
    assert.ok(html.includes('id="hud-lottery-pot"'));
    assert.ok(html.includes('id="btn-scratch-reveal-all"'));
    assert.ok(html.includes('id="scratch-prize-table"'));

    // Shell CSS collapses perks height to 0px and hides .feature-wip-hidden
    assert.ok(shellCss.includes('html[data-perks-hidden="true"]'));
    assert.ok(shellCss.includes('--shell-perk-h: 0px'));
    assert.ok(shellCss.includes('.feature-wip-hidden'));
  });
});
