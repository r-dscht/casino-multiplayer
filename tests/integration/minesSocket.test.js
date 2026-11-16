const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { io: ioClient } = require('socket.io-client');

process.env.NODE_ENV = 'test';

const app = require('../../server/app');
const { setupSocket } = require('../../server/socket');

function waitForEvent(socket, eventName, predicate = null, timeoutMs = 4500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, handler);
      reject(new Error(`Timed out waiting for socket event: ${eventName}`));
    }, timeoutMs);

    function handler(data) {
      if (!predicate || predicate(data)) {
        clearTimeout(timer);
        socket.off(eventName, handler);
        resolve(data);
      }
    }

    socket.on(eventName, handler);
  });
}

async function connectAndJoin(port, name) {
  const socket = ioClient(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    reconnection: false,
  });
  await waitForEvent(socket, 'connect');
  const authPromise = waitForEvent(socket, 'auth_success');
  const minesPromise = waitForEvent(socket, 'mines_state');
  socket.emit('join_table', { name, color: '#10b981' });
  const authData = await authPromise;
  const minesState = await minesPromise;
  return { socket, player: authData.player, minesState };
}

describe('Royal Mines Vault Socket.IO Integration Suite', () => {
  let server;
  let socketHandler;
  let port;
  const socketsToClose = [];

  before(async () => {
    server = http.createServer(app);
    socketHandler = setupSocket(server);
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    for (const s of socketsToClose) {
      try {
        if (s.connected) s.disconnect();
      } catch (e) {}
    }
    if (socketHandler) {
      socketHandler.stop();
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('syncs MINES presence, enforces Solo navigation lock, and executes Shared Multiplayer turn-based click & cashout over Socket.IO', async () => {
    const c1 = await connectAndJoin(port, 'MinesAlice');
    const c2 = await connectAndJoin(port, 'MinesBob');
    socketsToClose.push(c1.socket, c2.socket);

    assert.equal(c1.minesState.minBet, 10);
    assert.equal(c1.minesState.shared.phase, 'WAITING_FOR_PLAYERS');

    // Switch presence to MINES
    const switchedP = waitForEvent(c1.socket, 'game_switched');
    c1.socket.emit('player_set_game', { game: 'Mines', location: 'MINES' });
    const sw = await switchedP;
    assert.equal(sw.location, 'MINES');

    // Start Solo 4x4 with 2 mines
    const soloStartedP = waitForEvent(c1.socket, 'mines_solo_started');
    c1.socket.emit('mines_solo_start', { betAmount: 200, gridSide: 4, mineCount: 2 });
    const soloStarted = await soloStartedP;
    assert.equal(soloStarted.solo.gridSide, 4);
    assert.equal(soloStarted.solo.mineCount, 2);

    // Verify navigation lock blocks leaving MINES while Solo active
    const navBlockedP = waitForEvent(c1.socket, 'navigation_blocked');
    c1.socket.emit('player_set_game', { game: 'Roulette', location: 'ROULETTE' });
    const navBlocked = await navBlockedP;
    assert.equal(navBlocked.code, 'CANNOT_LEAVE_ACTIVE_BETS');
    assert.equal(navBlocked.game, 'Mines');

    // Pick a guaranteed safe tile on c1's server-side solo board, then cashout!
    const internalSolo = socketHandler.minesEngine.soloGames.get(c1.player.id);
    let safeTile = 0;
    for (let i = 0; i < 16; i += 1) {
      if (!internalSolo.minesSet.has(i)) {
        safeTile = i;
        break;
      }
    }
    const soloClickP = waitForEvent(c1.socket, 'mines_solo_result');
    c1.socket.emit('mines_solo_click', { tileIndex: safeTile });
    const soloClick = await soloClickP;
    assert.equal(soloClick.outcome, 'DIAMOND');

    const soloCashP = waitForEvent(c1.socket, 'mines_solo_result');
    c1.socket.emit('mines_solo_cashout');
    const soloCash = await soloCashP;
    assert.equal(soloCash.outcome, 'CASHOUT');
    assert.ok(soloCash.payout >= 200);

    // Join Shared Vault with both players, voting 4x4 & 3 mines
    const join1P = waitForEvent(c1.socket, 'mines_shared_joined');
    c1.socket.emit('mines_shared_join', { betAmount: 100, gridSide: 4, mineCount: 3 });
    const join1 = await join1P;
    assert.equal(join1.startedCountdown, true);
    assert.equal(join1.shared.phase, 'BETTING');

    const join2P = waitForEvent(c2.socket, 'mines_shared_joined');
    c2.socket.emit('mines_shared_join', { betAmount: 150, gridSide: 4, mineCount: 3 });
    await join2P;

    // Advance straight to PLAYING deterministically via engine method
    const playingStateP = waitForEvent(
      c1.socket,
      'mines_shared_state',
      (s) => s && s.phase === 'PLAYING'
    );
    socketHandler.minesEngine._beginSharedPlay();
    const playingState = await playingStateP;
    assert.equal(playingState.turnPlayerId, c1.player.id);
    assert.equal(playingState.gridSide, 4);
    assert.equal(playingState.mineCount, 3);

    // Alice opens a safe diamond on the shared board -> broadcasts to Bob too!
    let sharedSafe = 0;
    for (let i = 0; i < 16; i += 1) {
      if (!socketHandler.minesEngine.shared.minesSet.has(i)) {
        sharedSafe = i;
        break;
      }
    }
    const peerTileP = waitForEvent(c2.socket, 'mines_shared_tile');
    const c1AckP = waitForEvent(c1.socket, 'mines_shared_click_ack');
    c1.socket.emit('mines_shared_click', { tileIndex: sharedSafe });
    const [peerTile, c1Ack] = await Promise.all([peerTileP, c1AckP]);
    assert.equal(c1Ack.outcome, 'DIAMOND');
    assert.equal(peerTile.tileInfo.initials, 'MI');
    assert.equal(peerTile.shared.turnPlayerId, c2.player.id);

    // Bob cannot cash out yet (0 clicks made!)
    const bobRejectP = waitForEvent(c2.socket, 'mines_rejected');
    c2.socket.emit('mines_shared_cashout');
    const bobReject = await bobRejectP;
    assert.equal(bobReject.code, 'MIN_ONE_CLICK_REQUIRED');

    // Alice cashes out safely, then Bob triggers a bomb to end the round
    const c1SettleP = waitForEvent(c1.socket, 'mines_shared_settlement');
    c1.socket.emit('mines_shared_cashout');
    const c1Settle = await c1SettleP;
    assert.equal(c1Settle.status, 'CASHED_OUT');
    assert.ok(c1Settle.payout >= 100);

    const sharedBomb = Array.from(socketHandler.minesEngine.shared.minesSet)[0];
    const finishedP = waitForEvent(c2.socket, 'mines_shared_finished');
    c2.socket.emit('mines_shared_click', { tileIndex: sharedBomb });
    const finished = await finishedP;
    assert.equal(finished.reason, 'BOMB_HIT');
    assert.equal(finished.triggerTile.playerId, c2.player.id);
  });
});
