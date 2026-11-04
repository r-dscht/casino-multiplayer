const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PlayerManager = require('../../server/game/playerManager');

describe('User Account Persistence & Password Authentication', () => {
  const testStoragePath = path.join(__dirname, '..', 'data_test_accounts.json');

  beforeEach(() => {
    if (fs.existsSync(testStoragePath)) {
      fs.unlinkSync(testStoragePath);
    }
  });

  afterEach(() => {
    if (fs.existsSync(testStoragePath)) {
      fs.unlinkSync(testStoragePath);
    }
  });

  it('should register a new account with 10,000 chips and save to disk', () => {
    const pm = new PlayerManager({ storagePath: testStoragePath });
    const p = pm.registerPlayer('sock_1', { name: 'Renzo', password: 'secret123', color: '#10b981' });

    assert.equal(p.name, 'Renzo');
    assert.equal(p.chips, 10000);
    assert.equal(p.color, '#10b981');
    assert.ok(fs.existsSync(testStoragePath));

    const diskData = JSON.parse(fs.readFileSync(testStoragePath, 'utf8'));
    assert.ok(diskData.renzo);
    assert.equal(diskData.renzo.chips, 10000);
    assert.ok(diskData.renzo.passwordHash);
  });

  it('should persist chip balances to disk when chips are deducted or credited', () => {
    const pm = new PlayerManager({ storagePath: testStoragePath });
    const p = pm.registerPlayer('sock_1', { name: 'Renzo', password: 'pass' });

    pm.deductChips(p.id, 2000);
    assert.equal(p.chips, 8000);

    let diskData = JSON.parse(fs.readFileSync(testStoragePath, 'utf8'));
    assert.equal(diskData.renzo.chips, 8000);

    pm.addChips(p.id, 5000);
    assert.equal(p.chips, 13000);

    diskData = JSON.parse(fs.readFileSync(testStoragePath, 'utf8'));
    assert.equal(diskData.renzo.chips, 13000);
  });

  it('should restore saved chips upon reconnecting on a fresh PlayerManager instance', () => {
    // Session 1: Player wins chips and disconnects
    {
      const pm1 = new PlayerManager({ storagePath: testStoragePath });
      const p1 = pm1.registerPlayer('sock_1', { name: 'Renzo', password: 'mypassword' });
      pm1.addChips(p1.id, 15000);
      assert.equal(p1.chips, 25000);
      pm1.disconnectPlayer('sock_1');
    }

    // Session 2: Server restarted, fresh PlayerManager reads from disk
    {
      const pm2 = new PlayerManager({ storagePath: testStoragePath });
      const p2 = pm2.registerPlayer('sock_2', { name: 'Renzo', password: 'mypassword' });

      assert.ok(!p2.error);
      assert.equal(p2.name, 'Renzo');
      assert.equal(p2.chips, 25000); // Saved chips accurately restored!
    }
  });

  it('should reject login when an incorrect password is provided', () => {
    const pm = new PlayerManager({ storagePath: testStoragePath });
    pm.registerPlayer('sock_1', { name: 'Renzo', password: 'correctpassword' });

    // Try logging in with wrong password
    const result = pm.registerPlayer('sock_2', { name: 'Renzo', password: 'wrongpassword' });
    assert.ok(result.error);
    assert.equal(result.error, 'INCORRECT_PASSWORD');
  });

  it('should reject login when password is required but not provided', () => {
    const pm = new PlayerManager({ storagePath: testStoragePath });
    pm.registerPlayer('sock_1', { name: 'Renzo', password: 'correctpassword' });

    const result = pm.registerPlayer('sock_2', { name: 'Renzo' });
    assert.ok(result.error);
    assert.equal(result.error, 'PASSWORD_REQUIRED');
  });
});
