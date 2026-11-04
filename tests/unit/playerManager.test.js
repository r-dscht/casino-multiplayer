const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const PlayerManager = require('../../server/game/playerManager');
const { STARTING_CHIPS } = require('../../server/game/rouletteConstants');

describe('PlayerManager Lifecycle & Bankroll Ledger', () => {
  let pm;

  beforeEach(() => {
    pm = new PlayerManager();
  });

  it('should initialize a new player with exactly 10,000 chips', () => {
    const player = pm.registerPlayer('socket_1', { name: 'MonteCarloVIP' });
    assert.equal(player.chips, 10000);
    assert.equal(player.chips, STARTING_CHIPS);
    assert.equal(player.name, 'MonteCarloVIP');
    assert.equal(player.connected, true);
    assert.equal(player.isHost, true); // First player is host
  });

  it('should sanitize player names, strip HTML, and cap length to 16 characters', () => {
    const p1 = pm.registerPlayer('s1', { name: '<script>alert("hack")</script>Alice' });
    assert.ok(!p1.name.includes('<script>'));
    assert.equal(p1.name, 'alert("hack")Ali'); // stripped tags and capped to 16 chars

    const p2 = pm.registerPlayer('s2', { name: '   ' }); // empty whitespace
    assert.ok(p2.name.startsWith('Player_')); // Fallback name
  });

  it('should assign modern casino luxury colors from palette', () => {
    const p1 = pm.registerPlayer('s1', { name: 'P1' });
    assert.ok(p1.color.startsWith('#'));

    // Custom valid hex color should be preserved
    const p2 = pm.registerPlayer('s2', { name: 'P2', color: '#ffaa00' });
    assert.equal(p2.color, '#ffaa00');
  });

  it('should retrieve players by socketId and by playerId', () => {
    const created = pm.registerPlayer('sock_123', { name: 'Bond' });
    const bySocket = pm.getPlayerBySocket('sock_123');
    const byId = pm.getPlayerById(created.id);

    assert.equal(bySocket.id, created.id);
    assert.equal(byId.id, created.id);
    assert.equal(byId.name, 'Bond');
  });

  it('should atomically deduct chips when funds are sufficient', () => {
    const player = pm.registerPlayer('s1', { name: 'Player1' });
    const result = pm.deductChips(player.id, 2500);

    assert.equal(result.success, true);
    assert.equal(result.chips, 7500);
    assert.equal(player.chips, 7500);
  });

  it('should reject deduction when funds are insufficient and leave balance unchanged', () => {
    const player = pm.registerPlayer('s1', { name: 'Player1' });
    const result = pm.deductChips(player.id, 10001);

    assert.equal(result.success, false);
    assert.equal(result.reason, 'Insufficient chip balance');
    assert.equal(player.chips, 10000);
  });

  it('should reject invalid deduction amounts (negative, zero, decimal, non-number)', () => {
    const player = pm.registerPlayer('s1', { name: 'Player1' });

    assert.equal(pm.deductChips(player.id, 0).success, false);
    assert.equal(pm.deductChips(player.id, -500).success, false);
    assert.equal(pm.deductChips(player.id, 25.5).success, false);
    assert.equal(pm.deductChips(player.id, '100').success, false);
    assert.equal(player.chips, 10000);
  });

  it('should atomically add/credit chips on win or refund', () => {
    const player = pm.registerPlayer('s1', { name: 'Player1' });
    const result = pm.addChips(player.id, 3600);

    assert.equal(result.success, true);
    assert.equal(result.chips, 13600);
    assert.equal(player.chips, 13600);
  });

  it('should tolerate disconnections and preserve chips and session data', () => {
    const player = pm.registerPlayer('s1', { name: 'HighRoller' });
    pm.deductChips(player.id, 3000);
    assert.equal(player.chips, 7000);

    // Player disconnects
    const disconnected = pm.disconnectPlayer('s1');
    assert.equal(disconnected.id, player.id);
    assert.equal(player.connected, false);

    // Socket lookup should return null
    assert.equal(pm.getPlayerBySocket('s1'), null);

    // Player ID lookup must still find player with preserved chips!
    const stored = pm.getPlayerById(player.id);
    assert.ok(stored);
    assert.equal(stored.chips, 7000);
    assert.equal(stored.name, 'HighRoller');

    // Player reconnects on new socket with same playerId
    const reconnected = pm.registerPlayer('s2', { id: player.id });
    assert.equal(reconnected.id, player.id);
    assert.equal(reconnected.connected, true);
    assert.equal(reconnected.chips, 7000);
    assert.equal(pm.getPlayerBySocket('s2').id, player.id);
  });

  it('getConnectedPlayers should only return currently active players', () => {
    pm.registerPlayer('s1', { name: 'P1' });
    const p2 = pm.registerPlayer('s2', { name: 'P2' });

    assert.equal(pm.getConnectedPlayers().length, 2);

    pm.disconnectPlayer('s2');
    const active = pm.getConnectedPlayers();
    assert.equal(active.length, 1);
    assert.equal(active[0].name, 'P1');
  });

  it('should reset player bankroll upon request', () => {
    const player = pm.registerPlayer('s1', { name: 'Bankrupt' });
    pm.deductChips(player.id, 10000);
    assert.equal(player.chips, 0);

    const reloaded = pm.resetBankroll(player.id, 5000);
    assert.equal(reloaded, 5000);
    assert.equal(player.chips, 5000);
  });
});
