/**
 * sessionPersistence.test.js
 * Unit test suite for production-grade bearer session tokens, atomic debounced storage,
 * accounts migration, and multiplayer game presence.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PlayerManager = require('../../server/game/playerManager');
const { STARTING_CHIPS } = require('../../server/game/rouletteConstants');

describe('Milestone 1: Session Persistence & Multi-Game Player Presence', () => {
  const testDir = path.join(__dirname, '..', 'temp_session_test');
  const testPlayersPath = path.join(testDir, 'players.json');
  const testAccountsPath = path.join(testDir, 'accounts.json');

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Bearer Session Token Issuance & Formatting', () => {
    it('should generate a cryptographic bearer token (cst_ prefix) and permanent player ID (ply_ prefix)', () => {
      const pm = new PlayerManager({ storagePath: testPlayersPath, debounceMs: 0 });
      const auth = pm.authSession('socket_101', { name: 'MonteCarloVIP', color: '#10b981' });

      assert.equal(auth.isNew, true);
      assert.ok(auth.sessionToken, 'Bearer session token must exist');
      assert.ok(auth.sessionToken.startsWith('cst_'), 'Session token must use cst_ prefix');
      assert.ok(auth.sessionToken.length >= 36, 'Session token must have sufficient cryptographic entropy');

      assert.ok(auth.player, 'Player object must be returned');
      assert.ok(auth.player.id.startsWith('ply_'), 'Player ID must use permanent ply_ prefix');
      assert.equal(auth.player.chips, STARTING_CHIPS, 'New player must receive exactly 10,000 chips');
      assert.equal(auth.player.name, 'MonteCarloVIP');
      assert.equal(auth.player.color, '#10b981');
      assert.equal(auth.player.location, 'ROULETTE');
      assert.equal(auth.player.seatIndex, null);
    });

    it('should look up player record directly via getPlayerByToken', () => {
      const pm = new PlayerManager({ storagePath: testPlayersPath, debounceMs: 0 });
      const auth = pm.authSession('sock_lookup', { name: 'HighRoller' });

      const found = pm.getPlayerByToken(auth.sessionToken);
      assert.ok(found);
      assert.equal(found.id, auth.player.id);
      assert.equal(found.name, 'HighRoller');

      // Invalid tokens return null
      assert.equal(pm.getPlayerByToken('cst_nonexistent'), null);
      assert.equal(pm.getPlayerByToken(''), null);
      assert.equal(pm.getPlayerByToken(null), null);
    });
  });

  describe('Session Re-Authentication & Exact Balance Retention', () => {
    it('should restore exact chip balance without resetting when re-authenticating with valid token', () => {
      const pm = new PlayerManager({ storagePath: testPlayersPath, debounceMs: 0 });

      // 1. Initial login: receives 10,000 starting chips
      const auth1 = pm.authSession('sock_initial', { name: 'Bond' });
      assert.equal(auth1.isNew, true);
      assert.equal(auth1.player.chips, 10000);

      // 2. Player bets and loses 4,000 chips
      pm.deductChips(auth1.player.id, 4000);
      assert.equal(auth1.player.chips, 6000);

      // 3. Player disconnects
      pm.disconnectPlayer('sock_initial');

      // 4. Player reconnects on new socket with bearer sessionToken
      const auth2 = pm.authSession('sock_reconnected', { sessionToken: auth1.sessionToken });

      assert.equal(auth2.isNew, false, 'Existing session must be identified as isNew: false');
      assert.equal(auth2.sessionToken, auth1.sessionToken, 'Session token must match');
      assert.equal(auth2.player.id, auth1.player.id, 'Permanent player ID must match');
      assert.equal(auth2.player.chips, 6000, 'Chips must remain exactly 6,000 and NEVER reset to 10,000');
      assert.equal(auth2.player.connected, true);
      assert.equal(pm.getPlayerBySocket('sock_reconnected').id, auth1.player.id);
    });

    it('should NEVER grant another 10,000 chips across multiple page refreshes or balance changes', () => {
      const pm = new PlayerManager({ storagePath: testPlayersPath, debounceMs: 0 });
      const auth = pm.authSession('sock_1', { name: 'Winner' });

      // Player wins 15,000 chips (balance = 25,000)
      pm.addChips(auth.player.id, 15000);
      assert.equal(auth.player.chips, 25000);

      // Simulate 5 consecutive page reloads
      for (let i = 2; i <= 6; i++) {
        const reload = pm.authSession(`sock_reload_${i}`, { sessionToken: auth.sessionToken });
        assert.equal(reload.isNew, false);
        assert.equal(reload.player.chips, 25000, `Reload #${i} must retain exact 25,000 chips`);
      }
    });

    it('should preserve player stats, customization, and name across session restoration', () => {
      const pm = new PlayerManager({ storagePath: testPlayersPath, debounceMs: 0 });
      const auth = pm.authSession('sock_stats', { name: 'StatTracker', color: '#8b5cf6' });

      pm.updatePlayerStats(auth.player.id, { wonAmount: 7500 });
      pm.updatePlayerCustomization(auth.player.id, { avatar: 'avatar_luxury_5' });

      // Reconnect
      const reloaded = pm.authSession('sock_stats_2', { sessionToken: auth.sessionToken });
      assert.equal(reloaded.player.stats.roundsPlayed, 1);
      assert.equal(reloaded.player.stats.totalWon, 7500);
      assert.equal(reloaded.player.stats.biggestWin, 7500);
      assert.equal(reloaded.player.avatar, 'avatar_luxury_5');
      assert.equal(reloaded.player.color, '#8b5cf6');
    });

    it('should generate a new player with 10k chips if provided token is unknown or expired', () => {
      const pm = new PlayerManager({ storagePath: testPlayersPath, debounceMs: 0 });
      const auth = pm.authSession('sock_invalid', { sessionToken: 'cst_invalid_fake_token_12345' });

      assert.equal(auth.isNew, true, 'Unknown token must register as new player');
      assert.ok(auth.sessionToken);
      assert.notEqual(auth.sessionToken, 'cst_invalid_fake_token_12345');
      assert.equal(auth.player.chips, 10000);
    });
  });

  describe('Resilient Atomic Debounced File Storage (players.json)', () => {
    it('should perform atomic file swap with temporary file and fs.renameSync without corruption', () => {
      const pm = new PlayerManager({ storagePath: testPlayersPath, debounceMs: 0 });
      const auth = pm.authSession('s_atomic', { name: 'AtomicTester' });
      pm.deductChips(auth.player.id, 2500);

      // Verify file exists on disk
      assert.ok(fs.existsSync(testPlayersPath), 'players.json must exist');

      // Verify no dangling .tmp files exist in storage directory
      const files = fs.readdirSync(testDir);
      const tempFiles = files.filter(f => f.includes('.tmp.'));
      assert.equal(tempFiles.length, 0, 'No temporary files should linger after atomic rename');

      // Verify valid, well-formed JSON content
      const diskRaw = fs.readFileSync(testPlayersPath, 'utf8');
      const diskData = JSON.parse(diskRaw);
      assert.ok(diskData[auth.player.id]);
      assert.equal(diskData[auth.player.id].chips, 7500);
      assert.equal(diskData[auth.player.id].name, 'AtomicTester');
      assert.equal(diskData[auth.player.id].sessionToken, auth.sessionToken);
    });

    it('should survive process restart and restore all accounts, tokens, and chips from disk', () => {
      // Server Session 1: Create accounts and mutate balances
      let token1, token2, p1Id, p2Id;
      {
        const pm1 = new PlayerManager({ storagePath: testPlayersPath, debounceMs: 0 });
        const a1 = pm1.authSession('s1', { name: 'PlayerOne', color: '#10b981' });
        const a2 = pm1.authSession('s2', { name: 'PlayerTwo', color: '#f59e0b' });
        token1 = a1.sessionToken;
        token2 = a2.sessionToken;
        p1Id = a1.player.id;
        p2Id = a2.player.id;

        pm1.addChips(p1Id, 8000);  // 18,000 chips
        pm1.deductChips(p2Id, 3000); // 7,000 chips
        pm1.flushToDiskSync();
      }

      // Server Session 2: Fresh PlayerManager loads from disk
      {
        const pm2 = new PlayerManager({ storagePath: testPlayersPath, debounceMs: 0 });

        // Authenticate with token 1
        const r1 = pm2.authSession('new_s1', { sessionToken: token1 });
        assert.equal(r1.isNew, false);
        assert.equal(r1.player.id, p1Id);
        assert.equal(r1.player.name, 'PlayerOne');
        assert.equal(r1.player.chips, 18000);

        // Authenticate with token 2
        const r2 = pm2.authSession('new_s2', { sessionToken: token2 });
        assert.equal(r2.isNew, false);
        assert.equal(r2.player.id, p2Id);
        assert.equal(r2.player.name, 'PlayerTwo');
        assert.equal(r2.player.chips, 7000);
      }
    });

    it('should debounce rapid writes over debounceMs interval and flush on demand', async () => {
      const pm = new PlayerManager({ storagePath: testPlayersPath, debounceMs: 100 });
      const auth = pm.authSession('s_debounce', { name: 'FastWriter' });

      // Immediate check: save is debounced by 100ms so isDirty is true
      assert.equal(pm.isDirty, true);

      // Force synchronous flush
      pm.flushToDiskSync();
      assert.equal(pm.isDirty, false);
      assert.ok(fs.existsSync(testPlayersPath));

      const parsed = JSON.parse(fs.readFileSync(testPlayersPath, 'utf8'));
      assert.ok(parsed[auth.player.id]);
    });
  });

  describe('Automatic Migration from Legacy accounts.json', () => {
    it('should automatically import legacy accounts into players.json and generate bearer session tokens', () => {
      // 1. Create a legacy accounts.json without sessionToken or permanent id
      const legacyData = {
        montecarlovip: {
          name: 'MonteCarloVIP',
          passwordHash: 'hash123',
          chips: 45000,
          color: '#d4af37',
          stats: { roundsPlayed: 12, totalWon: 60000, biggestWin: 25000 },
          currentGame: 'Roulette',
          createdAt: 1700000000000
        },
        highroller: {
          name: 'HighRoller',
          passwordHash: '',
          chips: 85000,
          color: '#10b981',
          stats: { roundsPlayed: 20, totalWon: 120000, biggestWin: 50000 },
          currentGame: 'Roulette',
          createdAt: 1700001000000
        }
      };
      fs.writeFileSync(testAccountsPath, JSON.stringify(legacyData, null, 2), 'utf8');

      // Ensure players.json does not exist yet
      assert.equal(fs.existsSync(testPlayersPath), false);

      // 2. Instantiate PlayerManager with legacyAccountsPath configured
      const pm = new PlayerManager({
        storagePath: testPlayersPath,
        legacyAccountsPath: testAccountsPath,
        debounceMs: 0
      });

      // 3. Verify players.json was automatically created via atomic write
      assert.ok(fs.existsSync(testPlayersPath), 'players.json must be created during migration');

      // 4. Verify accounts were loaded with generated bearer tokens and ids
      const vip = pm.accounts.get('montecarlovip');
      assert.ok(vip, 'Legacy account must be loaded');
      assert.equal(vip.name, 'MonteCarloVIP');
      assert.equal(vip.chips, 45000, 'Legacy chips must be preserved');
      assert.ok(vip.id.startsWith('ply_'), 'Migrated account must receive permanent ply_ id');
      assert.ok(vip.sessionToken.startsWith('cst_'), 'Migrated account must receive bearer sessionToken');

      // 5. Verify bearer token re-authentication works for migrated account
      const auth = pm.authSession('sock_migrated', { sessionToken: vip.sessionToken });
      assert.equal(auth.isNew, false);
      assert.equal(auth.player.chips, 45000);
      assert.equal(auth.player.name, 'MonteCarloVIP');
    });
  });

  describe('Multi-Game Real-Time Presence Tracking', () => {
    it('should track and update player presence across LOBBY, ROULETTE, and BLACKJACK tables', () => {
      const pm = new PlayerManager({ storagePath: testPlayersPath, debounceMs: 0 });
      const auth = pm.authSession('s_pres', { name: 'Explorer' });
      const player = auth.player;

      // Default location is ROULETTE
      assert.equal(player.location, 'ROULETTE');
      assert.equal(player.seatIndex, null);

      // Transition to Blackjack Table at Seat 2
      const res1 = pm.setPlayerPresence(player.id, 'BLACKJACK', 2);
      assert.equal(res1, true);
      assert.equal(player.location, 'BLACKJACK');
      assert.equal(player.seatIndex, 2);
      assert.equal(player.currentGame, 'Blackjack');

      // Transition to Lobby
      const res2 = pm.setPlayerPresence(player.id, 'LOBBY', null);
      assert.equal(res2, true);
      assert.equal(player.location, 'LOBBY');
      assert.equal(player.seatIndex, null);
      assert.equal(player.currentGame, 'Lobby');

      // Transition to Roulette
      const res3 = pm.setPlayerPresence(player.id, 'ROULETTE', null);
      assert.equal(res3, true);
      assert.equal(player.location, 'ROULETTE');
      assert.equal(player.seatIndex, null);
    });

    it('should include location and seatIndex in getConnectedPlayers', () => {
      const pm = new PlayerManager({ storagePath: testPlayersPath, debounceMs: 0 });
      const a1 = pm.authSession('s_list_1', { name: 'RouletteKing' });
      const a2 = pm.authSession('s_list_2', { name: 'BlackjackPro' });

      pm.setPlayerPresence(a2.player.id, 'BLACKJACK', 4);

      const active = pm.getConnectedPlayers();
      assert.equal(active.length, 2);

      const p1 = active.find(p => p.id === a1.player.id);
      assert.equal(p1.location, 'ROULETTE');
      assert.equal(p1.seatIndex, null);

      const p2 = active.find(p => p.id === a2.player.id);
      assert.equal(p2.location, 'BLACKJACK');
      assert.equal(p2.seatIndex, 4);
    });
  });
});
