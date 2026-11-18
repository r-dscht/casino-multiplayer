/**
 * versionSync.test.js
 * Tests live deploy detection, anti-cache headers, Socket.IO server_version / server_updating,
 * and CasinoNetwork loop-guarded auto-reload behavior.
 */

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { io: Client } = require('socket.io-client');

process.env.NODE_ENV = 'test';

const app = require('../../server/app');
const { setupSocket } = require('../../server/socket');
const { getVersionInfo, computeClientBuildHash } = require('../../server/version');
const CasinoNetwork = require('../../client/js/network');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function httpGet(port, route) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${route}`, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

describe('Live Deploy Detection, No-Cache Headers & Safe Auto-Reload', () => {
  let server = null;
  let socketHandler = null;
  let client = null;

  afterEach(async () => {
    if (client && client.connected) client.disconnect();
    client = null;
    if (socketHandler && typeof socketHandler.stop === 'function') socketHandler.stop();
    if (socketHandler && socketHandler.io) {
      await new Promise((resolve) => socketHandler.io.close(resolve));
    }
    socketHandler = null;
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      server = null;
    }
  });

  it('serves deterministic buildHash via /api/version and sets strict no-cache headers on HTML/JS/CSS', async () => {
    const info = getVersionInfo();
    assert.equal(typeof info.buildHash, 'string');
    assert.equal(info.buildHash.length, 12);
    assert.equal(info.buildHash, computeClientBuildHash());
    assert.ok(info.bootId.startsWith('boot_'));

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const verRes = await httpGet(port, '/api/version');
    assert.equal(verRes.status, 200);
    assert.ok(String(verRes.headers['cache-control']).includes('no-store'));
    const json = JSON.parse(verRes.body);
    assert.equal(json.status, 'ok');
    assert.equal(json.buildHash, info.buildHash);
    assert.equal(json.bootId, info.bootId);

    for (const asset of ['/', '/js/network.js', '/css/shell.css']) {
      const res = await httpGet(port, asset);
      assert.equal(res.status, 200);
      assert.ok(String(res.headers['cache-control']).includes('no-store'), `${asset} missing no-store`);
      assert.equal(res.headers.pragma, 'no-cache', `${asset} missing Pragma: no-cache`);
      if (asset === '/') {
        assert.ok(res.body.includes(`js/network.js?v=${info.buildHash}`), 'index.html missing ?v= cache-buster');
        assert.ok(res.body.includes(`css/shell.css?v=${info.buildHash}`), 'index.html missing CSS ?v= cache-buster');
        assert.ok(res.body.includes('window.__CASINO_VERSION__='), 'index.html missing __CASINO_VERSION__');
      }
    }
  });

  it('emits server_version on Socket.IO connect and broadcasts server_updating via notifyServerUpdating', async () => {
    server = http.createServer(app);
    socketHandler = setupSocket(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    client = Client(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });
    const ver = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Timeout waiting for server_version')), 3000);
      client.once('server_version', (d) => { clearTimeout(t); resolve(d); });
    });

    const expected = getVersionInfo();
    assert.equal(ver.buildHash, expected.buildHash);
    assert.equal(ver.bootId, expected.bootId);

    const updatingP = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Timeout waiting for server_updating')), 3000);
      client.once('server_updating', (d) => { clearTimeout(t); resolve(d); });
    });
    socketHandler.notifyServerUpdating('Test deploy restart');
    const upd = await updatingP;
    assert.equal(upd.bootId, expected.bootId);
    assert.equal(upd.message, 'Test deploy restart');
  });

  it('triggers safe loop-guarded auto-reload once per new bootId/buildHash in CasinoNetwork', async () => {
    const store = new Map();
    const prevStorage = global.sessionStorage;
    const prevWindow = global.window;
    let windowReloadCount = 0;

    global.sessionStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    };
    global.window = {
      location: {
        reload: () => { windowReloadCount += 1; }
      }
    };

    try {
      const net = new CasinoNetwork();
      const events = [];
      net.on('version_mismatch', (d) => events.push(['mismatch', d.bootId]));
      net.on('version_reloading', (d) => events.push(['reloading', d.bootId]));

      // 1. Initial version -> baseline recorded, NO reload
      assert.equal(net.handleServerVersion({ buildHash: 'aaa111', bootId: 'boot_1' }), false);
      assert.equal(net.initialBootId, 'boot_1');
      assert.equal(events.length, 0);

      // 2. Same version on minor blip -> NO reload
      assert.equal(net.handleServerVersion({ buildHash: 'aaa111', bootId: 'boot_1' }), false);
      assert.equal(events.length, 0);

      // 3. New deploy version arrives -> schedules safe reload + prevents duplicate reload for same boot_2
      assert.equal(net.handleServerVersion({ buildHash: 'bbb222', bootId: 'boot_2' }), true);
      assert.equal(events[0][0], 'mismatch');
      assert.equal(net._performSafePageReload({ buildHash: 'bbb222', bootId: 'boot_2' }), true);
      assert.equal(store.get('casino_reloaded_boot_id'), 'boot_2:bbb222');
      assert.equal(store.get('casino_updated_toast'), '1');

      // Second call for exact same boot_2 must be blocked by loop guard
      net._isReloadingPage = false;
      assert.equal(net._performSafePageReload({ buildHash: 'bbb222', bootId: 'boot_2' }), false);

      await new Promise((resolve) => setTimeout(resolve, 680));
      assert.equal(windowReloadCount, 1);
    } finally {
      if (prevStorage === undefined) delete global.sessionStorage;
      else global.sessionStorage = prevStorage;
      if (prevWindow === undefined) delete global.window;
      else global.window = prevWindow;
    }
  });

  it('includes deploy banner markup and adheres to casino zero-emoji/zero-audio guardrails', () => {
    const html = fs.readFileSync(path.join(REPO_ROOT, 'client/index.html'), 'utf8');
    const verSrc = fs.readFileSync(path.join(REPO_ROOT, 'server/version.js'), 'utf8');
    assert.ok(html.includes('id="deploy-update-banner"'));
    assert.ok(html.includes('id="btn-deploy-reload-now"'));

    const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    assert.equal(emojiRe.test(verSrc), false);
  });
});
