/**
 * lotterySocket.test.js
 * End-to-end Socket.IO integration tests for Casino Staatsloterij & WIP feature hiding contracts.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { io: Client } = require('socket.io-client');

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

describe('Lottery Socket.IO Integration & WIP Feature Hiding Contracts', () => {
  let server;
  let socketHandler;
  let port;
  const clients = [];

  beforeEach(async () => {
    server = http.createServer(app);
    socketHandler = setupSocket(server, {
      lotteryOptions: {
        roundDurationMs: 650,
        drawRevealMs: 120,
        tickIntervalMs: 60,
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

  it('runs a live multiplayer round: Alice buys 3x, Bob buys 1x, timer draws 100% pot, chips reconcile with 0% house edge', async () => {
    const alice = await connectAndAuth('LotAlice');
    const bob = await connectAndAuth('LotBob');

    assert.equal(alice.initialLottery.ticketPrice, 2500);
    assert.equal(alice.initialLottery.houseEdgePct, 0);

    // Pause clock briefly via distant deadline while both buy cleanly, then set short remaining window
    socketHandler.lotteryEngine.roundEndsAt = Date.now() + 5000;

    const aliceAckP = waitForEvent(alice.socket, 'lottery_buy_ack');
    alice.socket.emit('lottery_buy_tickets', { count: 3 }); // 7.500 F
    const aliceAck = await aliceAckP;

    assert.equal(aliceAck.ok, true);
    assert.equal(aliceAck.count, 3);
    assert.equal(aliceAck.totalCost, 7500);
    assert.equal(aliceAck.startTicket, 1);
    assert.equal(aliceAck.endTicket, 3);
    assert.equal(aliceAck.remainingChips, 2500);

    const bobAckP = waitForEvent(bob.socket, 'lottery_buy_ack');
    bob.socket.emit('lottery_buy_tickets', { count: 1 }); // 2.500 F
    const bobAck = await bobAckP;

    assert.equal(bobAck.ok, true);
    assert.equal(bobAck.pot, 10000);
    assert.equal(bobAck.totalTickets, 4);
    assert.equal(bobAck.remainingChips, 7500);

    // Wait for natural tick countdown & global chat winner announcement
    const drawP = waitForEvent(alice.socket, 'lottery_draw_result', 5000);
    const chatP = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for Staatsloterij global chat')), 5000);
      const onChat = (msg) => {
        if (msg && typeof msg.text === 'string' && msg.text.includes('[STAATSLOTERIJ]')) {
          clearTimeout(timer);
          alice.socket.off('chat_message', onChat);
          resolve(msg);
        }
      };
      alice.socket.on('chat_message', onChat);
    });

    // Trigger imminent draw within 120ms so test finishes fast cleanly
    socketHandler.lotteryEngine.roundEndsAt = Date.now() + 90;

    const [drawRes, chatMsg] = await Promise.all([drawP, chatP]);
    assert.equal(drawRes.potWon, 10000);
    assert.equal(drawRes.totalTickets, 4);
    assert.ok([alice.player.id, bob.player.id].includes(drawRes.winnerId));
    assert.ok(chatMsg.text.includes('100%-pot van 10,000 fiches') || chatMsg.text.includes('100%-pot van 10.000 fiches'));

    // Exact chip conservation: total chips between Alice and Bob must equal 20,000 (0% rake)
    const pAlice = socketHandler.playerManager.getPlayerById(alice.player.id);
    const pBob = socketHandler.playerManager.getPlayerById(bob.player.id);
    assert.equal(pAlice.chips + pBob.chips, 20000);
  });

  it('draws cleanly while buyer is offline, credits saved account, and delivers myPendingOfflineWin on reconnect until acked', async () => {
    const offSock = Client(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });
    clients.push(offSock);
    await new Promise((resolve) => offSock.on('connect', resolve));
    const authP = waitForEvent(offSock, 'auth_success');
    const lotP = waitForEvent(offSock, 'lottery_state');
    offSock.emit('auth_session', { name: 'OffLotHero', color: '#10B981' });
    const [authData] = await Promise.all([authP, lotP]);

    const ackP = waitForEvent(offSock, 'lottery_buy_ack');
    offSock.emit('lottery_buy_tickets', { count: 2 }); // 5,000 F -> 5,000 F left
    const ack = await ackP;
    assert.equal(ack.remainingChips, 5000);

    // Buyer closes tab / goes completely offline before draw
    offSock.disconnect();
    await new Promise((r) => setTimeout(r, 80));

    // Simulate restart loss of active live Map while saved account persists
    const savedAcc = socketHandler.playerManager.accounts.get('offlothero');
    assert.ok(savedAcc);
    socketHandler.playerManager.players.delete(authData.player.id);

    // Draw executes while player is offline
    const drawP = new Promise((resolve) => socketHandler.lotteryEngine.once('draw_result', resolve));
    socketHandler.lotteryEngine.roundEndsAt = Date.now() - 10;
    socketHandler.lotteryEngine.tick(Date.now());
    const drawRes = await drawP;
    assert.equal(drawRes.winnerWasOffline, true);
    assert.equal(drawRes.potWon, 5000);
    assert.equal(savedAcc.chips, 10000);

    // Reconnect later: auth_session restores chips and delivers myPendingOfflineWin immediately
    const reSock = Client(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });
    clients.push(reSock);
    await new Promise((resolve) => reSock.on('connect', resolve));
    const reAuthP = waitForEvent(reSock, 'auth_success');
    const reLotP = waitForEvent(reSock, 'lottery_state');
    reSock.emit('auth_session', { sessionToken: authData.sessionToken, name: 'OffLotHero' });
    const [reAuth, reLot] = await Promise.all([reAuthP, reLotP]);

    assert.equal(reAuth.player.chips, 10000);
    assert.ok(reLot.myPendingOfflineWin, 'Reconnecting offline winner receives myPendingOfflineWin');
    assert.equal(reLot.myPendingOfflineWin.roundId, drawRes.roundId);
    assert.equal(reLot.myPendingOfflineWin.potWon, 5000);

    // Ack clears pending notification so it does not repeat
    reSock.emit('lottery_ack_offline_win', { roundId: drawRes.roundId });
    const postAckP = waitForEvent(reSock, 'lottery_state');
    reSock.emit('lottery_get_state');
    const postAck = await postAckP;
    assert.equal(postAck.myPendingOfflineWin, null);
  });

  it('verifies socket.js starts lotteryEngine AFTER attaching listeners and removes cheer/blitz from non-racing games', () => {
    const socketJs = fs.readFileSync(path.join(__dirname, '../../server/socket.js'), 'utf8');
    const listenerIdx = socketJs.indexOf("lotteryEngine.on('draw_result'");
    const startIdx = socketJs.indexOf('lotteryEngine.start()');
    assert.ok(listenerIdx !== -1 && startIdx !== -1 && startIdx > listenerIdx, 'lotteryEngine.start() must run after draw_result listener attaches');
    assert.equal(socketJs.includes("socket.on('slots_cheer'"), false);
    assert.equal(socketJs.includes("socket.on('hilo_cheer'"), false);
    assert.equal(socketJs.includes("socket.on('mines_cheer'"), false);
    assert.equal(socketJs.includes("socket.on('hilo_blitz_join'"), false);
    assert.equal(socketJs.includes("socket.on('racing_cheer'"), true, 'Horse Racing cheer MUST remain active');

    const indexJs = fs.readFileSync(path.join(__dirname, '../../server/index.js'), 'utf8');
    assert.ok(indexJs.includes('stopSocketEngines') || indexJs.includes('lotteryEngine.stop'), 'server shutdown must stop lotteryEngine cleanly');
  });

  it('persists 100k stake across full server restart past draw deadline and recovers ephemeral wipes via lotteryBackup', async () => {
    const os = require('os');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lottery-persist-e2e-'));
    const playersFile = path.join(tmpDir, 'players.json');
    const bankFile = path.join(tmpDir, 'bank.json');
    const lotteryFile = path.join(tmpDir, 'lottery.json');

    const bootServer = async ({ roundDurationMs = 600000, drawRevealMs = 50, tickIntervalMs = 40 } = {}) => {
      const srv = http.createServer(app);
      const pm = new (require('../../server/game/playerManager'))({ storagePath: playersFile, debounceMs: 0 });
      const bm = new (require('../../server/game/bankManager'))(pm, { storagePath: bankFile });
      const handler = setupSocket(srv, {
        playerManager: pm,
        bankManager: bm,
        lotteryOptions: {
          storagePath: lotteryFile,
          debounceMs: 0,
          roundDurationMs,
          drawRevealMs,
          tickIntervalMs
        }
      });
      await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
      return { srv, handler, port: srv.address().port };
    };

    const stopServer = async (inst) => {
      if (!inst) return;
      inst.handler.stop();
      await new Promise((resolve) => inst.handler.io.close(resolve));
      await new Promise((resolve) => inst.srv.close(resolve));
    };

    let s1 = null;
    let s2 = null;
    let s3 = null;
    try {
      // 1. Player deposits 100,000 F (40 tickets) before server shutdown
      s1 = await bootServer();
      const c1 = Client(`http://127.0.0.1:${s1.port}`, { transports: ['websocket'], forceNew: true });
      clients.push(c1);
      await new Promise((resolve) => c1.on('connect', resolve));
      const a1P = waitForEvent(c1, 'auth_success');
      c1.emit('auth_session', { name: 'HundredKHero', color: '#D4AF37' });
      const a1 = await a1P;
      s1.handler.playerManager.resetBankroll(a1.player.id, 150000);
      s1.handler.playerManager.flushToDiskSync();

      const ackP = waitForEvent(c1, 'lottery_buy_ack');
      c1.emit('lottery_buy_tickets', { count: 40 }); // 100,000 F
      const ack = await ackP;
      assert.equal(ack.ok, true);
      assert.equal(ack.totalCost, 100000);
      assert.equal(ack.remainingChips, 50000);

      c1.disconnect();
      await stopServer(s1);
      s1 = null;

      // Fast-forward persisted deadline to 2 minutes ago (server stayed offline past 10m draw)
      const persistedLot = JSON.parse(fs.readFileSync(lotteryFile, 'utf8'));
      persistedLot.roundEndsAt = Date.now() - 120000;
      fs.writeFileSync(lotteryFile, JSON.stringify(persistedLot, null, 2), 'utf8');

      // 2. Restart server -> boots & settles overdue round offline, then player reconnects via username
      s2 = await bootServer({ roundDurationMs: 600000, drawRevealMs: 50 });
      const c2 = Client(`http://127.0.0.1:${s2.port}`, { transports: ['websocket'], forceNew: true });
      clients.push(c2);
      await new Promise((resolve) => c2.on('connect', resolve));
      const a2P = waitForEvent(c2, 'auth_success');
      const l2P = waitForEvent(c2, 'lottery_state');
      c2.emit('join_table', { name: 'HundredKHero', color: '#D4AF37' });
      const [a2, l2] = await Promise.all([a2P, l2P]);

      assert.equal(a2.player.chips, 150000); // 50,000 + 100,000 pot restored!
      assert.equal(l2.phase, 'OPEN');
      assert.ok(l2.myPendingOfflineWin && l2.myPendingOfflineWin.potWon === 100000);
      c2.disconnect();
      await stopServer(s2);
      s2 = null;

      // 3. Simulate ephemeral cloud wipe (delete players/bank/lottery JSONs), reconnect with client lotteryBackup
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.mkdirSync(tmpDir, { recursive: true });

      s3 = await bootServer({ roundDurationMs: 600000, drawRevealMs: 50 });
      const c3 = Client(`http://127.0.0.1:${s3.port}`, { transports: ['websocket'], forceNew: true });
      clients.push(c3);
      await new Promise((resolve) => c3.on('connect', resolve));
      const a3P = waitForEvent(c3, 'auth_success');
      const l3P = waitForEvent(c3, 'lottery_state');
      c3.emit('auth_session', {
        name: 'RenderWipeHero',
        clientBackup: { name: 'RenderWipeHero', chips: 50000 },
        lotteryBackup: {
          roundId: 1,
          roundEndsAt: Date.now() - 120000,
          tickets: 40,
          totalSpent: 100000,
          playerName: 'RenderWipeHero'
        }
      });
      const [a3, l3] = await Promise.all([a3P, l3P]);

      assert.equal(a3.player.chips, 150000); // 100k recovered on wiped server & drawn cleanly
      assert.ok(l3.myPendingOfflineWin && l3.myPendingOfflineWin.potWon === 100000);
      assert.equal(l3.backupClaimResolvedRoundId, 1);
      c3.disconnect();
    } finally {
      if (s1) await stopServer(s1);
      if (s2) await stopServer(s2);
      if (s3) await stopServer(s3);
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
  });

  it('hides unfinished WIP triggers/modals/perks dock in HTML/CSS while keeping DOM IDs intact', () => {
    const clientDir = path.resolve(__dirname, '../../client');
    const html = fs.readFileSync(path.join(clientDir, 'index.html'), 'utf8');
    const shellCss = fs.readFileSync(path.join(clientDir, 'css', 'shell.css'), 'utf8');

    assert.ok(html.includes('data-perks-hidden="true"'));
    assert.match(html, /class="btn-service-hud feature-wip-hidden"\s+id="btn-open-market"/);
    assert.match(html, /class="btn-service-hud feature-wip-hidden"\s+id="btn-open-exchange"/);
    assert.match(html, /id="market-modal"[\s\S]{0,60}aria-hidden="true"/);
    assert.match(html, /class="modal-overlay hidden feature-wip-hidden"\s+id="market-modal"/);
    assert.match(html, /class="modal-overlay hidden feature-wip-hidden"\s+id="exchange-modal"/);
    assert.match(html, /class="modal-overlay hidden feature-wip-hidden"\s+id="racing-modal"/);
    assert.match(html, /class="gadgets-perks-dock feature-wip-hidden"\s+id="gadgets-perks-dock"/);

    // Loterij trigger & rich HUD spans remain active & unhidden
    assert.match(html, /class="btn-service-hud btn-lottery-hud"\s+id="btn-open-lottery"/);
    assert.ok(html.includes('id="hud-lottery-timer"'));
    assert.ok(html.includes('id="hud-lottery-pot"'));

    // Shell CSS collapses perks height to 0px and hides .feature-wip-hidden
    assert.ok(shellCss.includes('html[data-perks-hidden="true"]'));
    assert.ok(shellCss.includes('--shell-perk-h: 0px'));
    assert.ok(shellCss.includes('.feature-wip-hidden'));
  });
});
