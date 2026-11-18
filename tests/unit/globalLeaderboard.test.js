const { describe, it, beforeEach, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { io: Client } = require('socket.io-client');

const app = require('../../server/app');
const { setupSocket } = require('../../server/socket');
const PlayerManager = require('../../server/game/playerManager');
const PokerEngine = require('../../server/game/pokerEngine');

function waitForEvent(socket, eventName, predicate = null, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, handler);
      reject(new Error(`Timed out waiting for socket event "${eventName}"`));
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

describe('Global All-Time & Online/Offline Leaderboard', () => {
  describe('PlayerManager.getGlobalLeaderboard unit behavior', () => {
    let pm;

    beforeEach(() => {
      pm = new PlayerManager({ storagePath: false });
    });

    it('includes only players who have actually played (online and offline) and omits sensitive fields', () => {
      const idleVisitor = pm.registerPlayer('s_idle', { name: 'IdleVisitor', password: 'secret' });
      const activeOnline = pm.registerPlayer('s_online', { name: 'ActiveOnline', color: '#D4AF37', password: 'pw1' });
      const offlineLegend = pm.registerPlayer('s_off', { name: 'OfflineLegend', color: '#38BDF8', password: 'pw2' });

      pm.updatePlayerStats(activeOnline.id, { wonAmount: 1500 });
      pm.updatePlayerStats(offlineLegend.id, { wonAmount: 5000 });
      pm.addChips(offlineLegend.id, 5000);
      pm.setPlayerPresence(offlineLegend.id, 'PLINKO');
      pm.disconnectPlayer('s_off');

      const board = pm.getGlobalLeaderboard();
      const names = board.map((p) => p.name);

      assert.equal(names.includes(idleVisitor.name), false, 'Idle 0-round visitor should not appear');
      assert.ok(names.includes('ActiveOnline'));
      assert.ok(names.includes('OfflineLegend'));

      assert.equal(board[0].name, 'OfflineLegend');
      assert.equal(board[0].connected, false);
      assert.equal(board[0].currentGame, 'Offline');
      assert.equal(board[0].lastGame, 'Plinko');
      assert.equal(board[0].location, 'OFFLINE');
      assert.equal(board[0].chips, 15000);
      assert.equal(board[0].stats.roundsPlayed, 1);
      assert.equal(board[0].stats.totalWon, 5000);
      assert.equal(board[0].passwordHash, undefined);
      assert.equal(board[0].sessionToken, undefined);

      const onlineRow = board.find((p) => p.name === 'ActiveOnline');
      assert.equal(onlineRow.connected, true);
      assert.equal(onlineRow.currentGame, 'Roulette');
    });

    it('supports online/offline filtering and sorting by chips, totalWon, roundsPlayed, biggestWin', () => {
      const p1 = pm.registerPlayer('s1', { name: 'RichLowRounds' });
      pm.addChips(p1.id, 20000);
      pm.updatePlayerStats(p1.id, { wonAmount: 100 });

      const p2 = pm.registerPlayer('s2', { name: 'GrinderOffline' });
      pm.updatePlayerStats(p2.id, { wonAmount: 8000 });
      pm.updatePlayerStats(p2.id, { wonAmount: 4000 });
      pm.disconnectPlayer('s2');

      const offlineOnly = pm.getGlobalLeaderboard({ status: 'offline' });
      assert.equal(offlineOnly.length, 1);
      assert.equal(offlineOnly[0].name, 'GrinderOffline');

      const onlineOnly = pm.getGlobalLeaderboard({ status: 'online' });
      assert.equal(onlineOnly.length, 1);
      assert.equal(onlineOnly[0].name, 'RichLowRounds');

      const byChips = pm.getGlobalLeaderboard({ sortBy: 'chips' });
      assert.equal(byChips[0].name, 'RichLowRounds');

      const byTotalWon = pm.getGlobalLeaderboard({ sortBy: 'totalWon' });
      assert.equal(byTotalWon[0].name, 'GrinderOffline');

      const byRounds = pm.getGlobalLeaderboard({ sortBy: 'roundsPlayed' });
      assert.equal(byRounds[0].name, 'GrinderOffline');
    });

    it('restores offline players who played from persisted storage across restart', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'casino-lb-'));
      const tempFile = path.join(tempDir, 'players.json');
      try {
        const pm1 = new PlayerManager({ storagePath: tempFile, debounceMs: 0 });
        const p = pm1.registerPlayer('s_persist', { name: 'PersistedVIP', color: '#EC4899' });
        pm1.addChips(p.id, 2500);
        pm1.updatePlayerStats(p.id, { wonAmount: 2500 });
        pm1.flushToDiskSync();

        const pm2 = new PlayerManager({ storagePath: tempFile, debounceMs: 0 });
        const board = pm2.getGlobalLeaderboard();
        assert.equal(board.length, 1);
        assert.equal(board[0].name, 'PersistedVIP');
        assert.equal(board[0].connected, false);
        assert.equal(board[0].currentGame, 'Offline');
        assert.equal(board[0].chips, 12500);
        assert.equal(board[0].stats.roundsPlayed, 1);
        assert.equal(board[0].stats.totalWon, 2500);

        const profile = pm2.getPlayerProfile(board[0].id);
        assert.ok(profile);
        assert.equal(profile.name, 'PersistedVIP');
        assert.equal(profile.connected, false);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('tracks Poker hands in stats so Poker players count toward Global All-Time', () => {
      const p1 = pm.registerPlayer('s_pk1', { name: 'PokerHero' });
      const p2 = pm.registerPlayer('s_pk2', { name: 'PokerVillain' });
      const poker = new PokerEngine(pm, { tableId: 'poker_test', autoStart: false });

      try {
        const s1 = poker.takeSeat(0, p1.id, 2000);
        const s2 = poker.takeSeat(1, p2.id, 2000);
        assert.equal(s1.success, true);
        assert.equal(s2.success, true);

        poker.startNewHand();
        assert.ok(poker.activeTurn);

        const foldRes = poker.handleAction(poker.activeTurn.seatIndex, poker.activeTurn.playerId, 'fold');
        assert.equal(foldRes.success, true);

        const board = pm.getGlobalLeaderboard({ sortBy: 'totalWon' });
        const names = board.map((x) => x.name);
        assert.ok(names.includes('PokerHero'));
        assert.ok(names.includes('PokerVillain'));
      } finally {
        poker.stop();
      }
    });

    it('includes offline players with chip/wheel/bank activity even when roundsPlayed is 0, while excluding untouched 10k visitors', () => {
      const idle = pm.registerPlayer('s_v0', { name: 'UntouchedVisitor' });
      const chipChanged = pm.registerPlayer('s_v1', { name: 'ChipBuyerOff' });
      pm.deductChips(chipChanged.id, 1500);
      pm.disconnectPlayer('s_v1');

      const wheelOnly = pm.registerPlayer('s_v2', { name: 'WheelSpinnerOff' });
      wheelOnly.lastWheelSpin = Date.now();
      pm.disconnectPlayer('s_v2');

      const board = pm.getGlobalLeaderboard();
      const names = board.map((p) => p.name);
      assert.equal(names.includes(idle.name), false);
      assert.ok(names.includes('ChipBuyerOff'));
      assert.ok(names.includes('WheelSpinnerOff'));

      const offlineOnly = pm.getGlobalLeaderboard({ status: 'offline' });
      assert.ok(offlineOnly.some((p) => p.name === 'ChipBuyerOff' && p.chips === 8500));
      assert.ok(offlineOnly.some((p) => p.name === 'WheelSpinnerOff'));
    });

    it('preserves stats in client backup when patches have undefined stats and restores offline leaderboard entries', () => {
      const CasinoNetwork = require('../../client/js/network');
      const store = new Map();
      const prevStorage = global.localStorage;
      global.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k)
      };

      try {
        const net = Object.create(CasinoNetwork.prototype);
        net.saveClientBackup({
          id: 'ply_backup_1',
          name: 'BackupHero',
          chips: 12000,
          stats: { roundsPlayed: 4, totalWon: 2500, biggestWin: 1800 }
        });
        // Regression check: stats: undefined must NOT overwrite cached career stats
        net.saveClientBackup({ chips: 11500, stats: undefined });
        const saved = net.getClientBackup();
        assert.equal(saved.chips, 11500);
        assert.equal(saved.stats.roundsPlayed, 4);
        assert.equal(saved.stats.totalWon, 2500);
        assert.equal(saved.stats.biggestWin, 1800);
      } finally {
        if (prevStorage === undefined) delete global.localStorage;
        else global.localStorage = prevStorage;
      }

      // Simulated ephemeral server restart: new PlayerManager restores offline VIP from client leaderboardBackup
      const restored = pm.restoreLeaderboardBackup([
        {
          id: 'ply_offline_hero',
          name: 'OfflineVeteran',
          color: '#e5c158',
          chips: 45000,
          stats: { roundsPlayed: 12, totalWon: 35000, biggestWin: 15000 },
          lastGame: 'Cross',
          lastSeen: Date.now() - 60000
        },
        {
          id: 'ply_untouched_skip',
          name: 'IdleZero',
          chips: 10000,
          stats: { roundsPlayed: 0, totalWon: 0, biggestWin: 0 }
        }
      ]);
      assert.equal(restored, true);

      const board = pm.getGlobalLeaderboard({ status: 'offline' });
      const vet = board.find((p) => p.name === 'OfflineVeteran');
      assert.ok(vet);
      assert.equal(vet.chips, 45000);
      assert.equal(vet.stats.roundsPlayed, 12);
      assert.equal(vet.connected, false);
      assert.equal(vet.lastGame, 'Cross');
      assert.equal(board.some((p) => p.name === 'IdleZero'), false);
    });
  });

  describe('Socket.IO integration for Online & Global All-Time Leaderboards', () => {
    let server;
    let socketHandler;
    let baseUrl;
    let client1;
    let client2;

    before(async () => {
      server = http.createServer(app);
      socketHandler = setupSocket(server);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    after(async () => {
      if (client1 && client1.connected) client1.disconnect();
      if (client2 && client2.connected) client2.disconnect();
      if (socketHandler && typeof socketHandler.stop === 'function') socketHandler.stop();
      if (socketHandler && socketHandler.engine && typeof socketHandler.engine.stop === 'function') socketHandler.engine.stop();
      if (socketHandler && socketHandler.crashEngine && typeof socketHandler.crashEngine.stop === 'function') socketHandler.crashEngine.stop();
      if (socketHandler && socketHandler.io) socketHandler.io.close();
      if (server) await new Promise((resolve) => server.close(resolve));
    });

    it('emits global_leaderboard_update on join, updates on play, and retains offline players after disconnect', async () => {
      client1 = Client(baseUrl, { transports: ['websocket'], forceNew: true });
      client2 = Client(baseUrl, { transports: ['websocket'], forceNew: true });

      await Promise.all([waitForEvent(client1, 'connect'), waitForEvent(client2, 'connect')]);

      const c1InitBoard = waitForEvent(client1, 'global_leaderboard_update');
      const c2InitBoard = waitForEvent(client2, 'global_leaderboard_update');
      client1.emit('join_table', { name: 'BoardAlice', color: '#D4AF37' });
      client2.emit('join_table', { name: 'BoardBob', color: '#38BDF8' });
      const [init1, init2] = await Promise.all([c1InitBoard, c2InitBoard]);

      assert.ok(Array.isArray(init1));
      assert.ok(Array.isArray(init2));
      // Neither has played a round yet
      assert.equal(init2.some((p) => p.name === 'BoardAlice'), false);

      // Alice plays 1 Plinko ball so she counts as having played
      const boardOnPlayPromise = waitForEvent(
        client2,
        'global_leaderboard_update',
        (list) => Array.isArray(list) && list.some((p) => p.name === 'BoardAlice' && p.stats && p.stats.roundsPlayed >= 1)
      );
      client1.emit('plinko_drop', { amount: 10, rows: 8, risk: 'low', count: 1 });
      const boardAfterPlay = await boardOnPlayPromise;
      const aliceOnline = boardAfterPlay.find((p) => p.name === 'BoardAlice');
      assert.ok(aliceOnline);
      assert.equal(aliceOnline.connected, true);
      assert.ok(aliceOnline.stats.roundsPlayed >= 1);

      // Alice disconnects -> removed from players_update (Online) but remains in global_leaderboard_update (Offline)
      const playersAfterDcPromise = waitForEvent(
        client2,
        'players_update',
        (list) => Array.isArray(list) && !list.some((p) => p.name === 'BoardAlice')
      );
      const boardAfterDcPromise = waitForEvent(
        client2,
        'global_leaderboard_update',
        (list) => Array.isArray(list) && list.some((p) => p.name === 'BoardAlice' && p.connected === false)
      );
      client1.disconnect();
      const [onlineList, globalAfterDc] = await Promise.all([playersAfterDcPromise, boardAfterDcPromise]);

      assert.equal(onlineList.some((p) => p.name === 'BoardAlice'), false);
      const aliceOffline = globalAfterDc.find((p) => p.name === 'BoardAlice');
      assert.ok(aliceOffline);
      assert.equal(aliceOffline.connected, false);
      assert.equal(aliceOffline.currentGame, 'Offline');

      // Explicit leaderboard_get with status='offline'
      const offlineReqPromise = waitForEvent(client2, 'global_leaderboard_update');
      client2.emit('leaderboard_get', { status: 'offline' });
      const offlineOnlyList = await offlineReqPromise;
      assert.ok(offlineOnlyList.some((p) => p.name === 'BoardAlice' && p.connected === false));
      assert.equal(offlineOnlyList.some((p) => p.connected === true), false);

      // Reconnecting/refreshing client passes leaderboardBackup via leaderboard_get to restore lost offline veterans
      const restoredPromise = waitForEvent(
        client2,
        'global_leaderboard_update',
        (list) => Array.isArray(list) && list.some((p) => p.name === 'EphemeralVeteran' && p.chips === 33000)
      );
      client2.emit('leaderboard_get', {
        leaderboardBackup: [
          {
            id: 'ply_ephemeral_vet',
            name: 'EphemeralVeteran',
            color: '#d4af37',
            chips: 33000,
            stats: { roundsPlayed: 9, totalWon: 23000, biggestWin: 9000 },
            lastGame: 'Slots'
          }
        ]
      });
      const restoredList = await restoredPromise;
      const vet = restoredList.find((p) => p.name === 'EphemeralVeteran');
      assert.ok(vet);
      assert.equal(vet.connected, false);
      assert.equal(vet.stats.roundsPlayed, 9);
    });
  });

  describe('Leaderboard markup & zero-emoji / zero-audio guardrails', () => {
    it('renders both Online and All-Time leaderboard tabs without unicode emojis or audio tokens', () => {
      const html = fs.readFileSync(path.join(__dirname, '../../client/index.html'), 'utf8');
      const uiJs = fs.readFileSync(path.join(__dirname, '../../client/js/ui.js'), 'utf8');
      const css = fs.readFileSync(path.join(__dirname, '../../client/css/shell.css'), 'utf8');

      assert.ok(html.includes('id="tab-lb-online"'));
      assert.ok(html.includes('id="tab-lb-global"'));
      assert.ok(html.includes('id="leaderboard-list"'));
      assert.ok(html.includes('id="global-leaderboard-list"'));
      assert.ok(html.includes('id="btn-lb-offline-only"'));
      assert.ok(uiJs.includes('updateGlobalLeaderboard('));
      assert.ok(uiJs.includes('switchLeaderboardTab('));

      const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
      assert.equal(emojiRegex.test(uiJs), false);
      assert.equal(emojiRegex.test(css), false);
    });
  });
});
