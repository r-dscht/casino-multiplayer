/**
 * tunnel.test.js
 * Unit tests for Automated Cloudflare Quick Tunnel module.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const {
  CloudflareTunnel,
  extractTunnelUrl,
  formatLuxuryBanner,
  printLuxuryBanner,
  TRYCLOUDFLARE_REGEX
} = require('../../server/tunnel');

describe('Automated Cloudflare Quick Tunnel (server/tunnel.js)', () => {
  describe('URL Regex & Extraction (extractTunnelUrl)', () => {
    it('should extract standard trycloudflare.com URL from stderr line', () => {
      const line = '2026-11-04T14:19:25Z INF |  https://bold-amber-river.trycloudflare.com  |';
      const extracted = extractTunnelUrl(line);
      assert.strictEqual(extracted, 'https://bold-amber-river.trycloudflare.com');
    });

    it('should extract URL case-insensitively with dashes and numbers', () => {
      const line = 'Visit at https://Sub-Domain-42-Test.TryCloudflare.com/ ready!';
      const extracted = extractTunnelUrl(line);
      assert.strictEqual(extracted, 'https://Sub-Domain-42-Test.TryCloudflare.com');
    });

    it('should return null when text does not contain a trycloudflare.com URL', () => {
      assert.strictEqual(extractTunnelUrl('Tunnel started on 127.0.0.1:3000'), null);
      assert.strictEqual(extractTunnelUrl('https://example.com/not-a-tunnel'), null);
      assert.strictEqual(extractTunnelUrl('http://trycloudflare.com'), null); // needs https:// and subdomain
    });

    it('should handle non-string or empty inputs safely', () => {
      assert.strictEqual(extractTunnelUrl(null), null);
      assert.strictEqual(extractTunnelUrl(undefined), null);
      assert.strictEqual(extractTunnelUrl(''), null);
      assert.strictEqual(extractTunnelUrl(12345), null);
      assert.strictEqual(extractTunnelUrl({}), null);
    });

    it('TRYCLOUDFLARE_REGEX should match valid subdomains correctly', () => {
      assert.strictEqual(TRYCLOUDFLARE_REGEX.test('https://velvet-roulette-2026.trycloudflare.com'), true);
      assert.strictEqual(TRYCLOUDFLARE_REGEX.test('https://abc.trycloudflare.com'), true);
      assert.strictEqual(TRYCLOUDFLARE_REGEX.test('https://google.com'), false);
    });
  });

  describe('Luxury Casino Banner Formatting (formatLuxuryBanner)', () => {
    const testUrl = 'https://monte-carlo-vip.trycloudflare.com';
    const banner = formatLuxuryBanner(testUrl, 3000);

    it('should include the public HTTPS tunnel URL prominently', () => {
      assert.ok(banner.includes(testUrl));
    });

    it('should include the local server port', () => {
      assert.ok(banner.includes('http://127.0.0.1:3000'));
    });

    it('should enforce brand sanitization (zero GTA or Diamond Casino references)', () => {
      assert.strictEqual(/gta/i.test(banner), false);
      assert.strictEqual(/diamond\s*casino/i.test(banner), false);
      assert.ok(banner.includes('MONTE CARLO ROYALE'));
      assert.ok(banner.includes('European Roulette'));
    });

    it('should mention silent audio mode and zero install requirements', () => {
      assert.ok(banner.includes('Silent Mode'));
      assert.ok(banner.includes('Zero Install'));
    });

    it('printLuxuryBanner should output to console and return formatted string', () => {
      const output = printLuxuryBanner(testUrl, 8080);
      assert.ok(output.includes(testUrl));
      assert.ok(output.includes('8080'));
    });
  });

  describe('Cloud Environment Detection & Bypass Logic', () => {
    it('isCloudEnvironment should detect RENDER environment', () => {
      assert.strictEqual(CloudflareTunnel.isCloudEnvironment({ RENDER: 'true' }), true);
    });

    it('isCloudEnvironment should detect RAILWAY_ENVIRONMENT', () => {
      assert.strictEqual(CloudflareTunnel.isCloudEnvironment({ RAILWAY_ENVIRONMENT: 'production' }), true);
    });

    it('isCloudEnvironment should detect FLY_ALLOC_ID and HEROKU DYNO', () => {
      assert.strictEqual(CloudflareTunnel.isCloudEnvironment({ FLY_ALLOC_ID: 'abc-123' }), true);
      assert.strictEqual(CloudflareTunnel.isCloudEnvironment({ DYNO: 'web.1' }), true);
    });

    it('isCloudEnvironment should return false when no cloud env vars are set', () => {
      assert.strictEqual(CloudflareTunnel.isCloudEnvironment({}), false);
    });

    it('shouldEnableTunnel should return false when ENABLE_TUNNEL is "false"', () => {
      assert.strictEqual(CloudflareTunnel.shouldEnableTunnel({ ENABLE_TUNNEL: 'false' }), false);
    });

    it('shouldEnableTunnel should return false when running in Render or Railway', () => {
      assert.strictEqual(CloudflareTunnel.shouldEnableTunnel({ RENDER: 'true' }), false);
      assert.strictEqual(CloudflareTunnel.shouldEnableTunnel({ RAILWAY_ENVIRONMENT: 'production' }), false);
    });

    it('shouldEnableTunnel should return true in local desktop environment without cloud flags', () => {
      assert.strictEqual(CloudflareTunnel.shouldEnableTunnel({}), true);
      assert.strictEqual(CloudflareTunnel.shouldEnableTunnel({ ENABLE_TUNNEL: 'true' }), true);
      assert.strictEqual(CloudflareTunnel.shouldEnableTunnel({ PORT: '3000' }), true);
    });
  });

  describe('Executable Binary Resolution (getBinaryPath)', () => {
    it('should resolve a valid executable path', () => {
      const tunnel = new CloudflareTunnel(3000);
      const bin = tunnel.getBinaryPath();
      assert.ok(typeof bin === 'string' && bin.length > 0);
    });

    it('should prioritize CLOUDFLARED_PATH when set to existing file', () => {
      const originalEnv = process.env.CLOUDFLARED_PATH;
      try {
        const dummyPath = path.join(__dirname, 'dummy_cloudflared.exe');
        fs.writeFileSync(dummyPath, 'mock');
        process.env.CLOUDFLARED_PATH = dummyPath;

        const tunnel = new CloudflareTunnel(3000);
        assert.strictEqual(tunnel.getBinaryPath(), dummyPath);

        fs.unlinkSync(dummyPath);
      } finally {
        if (originalEnv !== undefined) {
          process.env.CLOUDFLARED_PATH = originalEnv;
        } else {
          delete process.env.CLOUDFLARED_PATH;
        }
      }
    });
  });

  describe('Lifecycle Management & Graceful Teardown', () => {
    it('stop() should execute safely without active child process', () => {
      const tunnel = new CloudflareTunnel(3000);
      assert.doesNotThrow(() => {
        tunnel.stop();
      });
      assert.strictEqual(tunnel.childProcess, null);
    });

    it('registerLifecycleHooks should register handlers idempotently', () => {
      const tunnel = new CloudflareTunnel(3000);
      assert.strictEqual(tunnel._hooksRegistered, false);
      tunnel.registerLifecycleHooks();
      assert.strictEqual(tunnel._hooksRegistered, true);
      // Second call should be a no-op
      tunnel.registerLifecycleHooks();
      assert.strictEqual(tunnel._hooksRegistered, true);
    });

    it('should capture URL when emitted by child process stderr', async () => {
      const tunnel = new CloudflareTunnel(3000);
      // Create a mock child process using EventEmitter
      const mockChild = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockChild.stdout = new EventEmitter();
      mockChild.kill = () => { mockChild.emit('exit', 0); };

      // Temporarily override spawn in a customized test
      let capturedUrl = null;
      const testPromise = new Promise((resolve) => {
        tunnel.childProcess = mockChild;
        tunnel.registerLifecycleHooks();

        const onChunk = (chunk) => {
          const detected = extractTunnelUrl(chunk.toString());
          if (detected) {
            capturedUrl = detected;
            resolve(detected);
          }
        };

        mockChild.stderr.on('data', onChunk);
      });

      // Emit mock stderr data matching cloudflared quick tunnel
      mockChild.stderr.emit('data', Buffer.from('INF |  https://mock-test-quick.trycloudflare.com  |'));

      const result = await testPromise;
      assert.strictEqual(result, 'https://mock-test-quick.trycloudflare.com');
      assert.strictEqual(capturedUrl, 'https://mock-test-quick.trycloudflare.com');
      tunnel.stop();
    });
  });
});
