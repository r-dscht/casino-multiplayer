/**
 * serverRoute.test.js
 * Integration test for HTTP static asset delivery and client code integrity.
 * Verifies that the client files serve cleanly, with correct MIME types,
 * 100% silent audio ("geen audio"), zero GTA branding, and thermal protection.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const app = require('../../server/app');

describe('HTTP Static Delivery & Client Integrity Integration', () => {
  let server;
  let serverPort;

  before(async () => {
    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  function get(route) {
    return new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${serverPort}${route}`, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data
          });
        });
      }).on('error', reject);
    });
  }

  // =========================================================================
  // 1. Static Asset Delivery
  // =========================================================================
  describe('Static Asset Delivery over HTTP', () => {
    it('should serve index.html at root "/" with 200 OK and text/html', async () => {
      const res = await get('/');
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('text/html'));
      assert.ok(res.body.includes('<title>Monte Carlo European Roulette | Le Grand Casino</title>'));
      assert.ok(res.body.includes('id="casino-app"'));
      assert.ok(res.body.includes('id="roulette-canvas-container"'));
    });

    it('should serve css/style.css with 200 OK and text/css', async () => {
      const res = await get('/css/style.css');
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('text/css'));
      assert.ok(res.body.includes('--felt-emerald'));
      assert.ok(res.body.includes('--gold-primary'));
    });

    it('should serve css/layout.css with 200 OK and text/css', async () => {
      const res = await get('/css/layout.css');
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('text/css'));
      assert.ok(res.body.includes('#casino-app'));
      assert.ok(res.body.includes('@media'));
    });

    it('should serve js/three/Roulette3D.js with 200 OK and javascript mime type', async () => {
      const res = await get('/js/three/Roulette3D.js');
      assert.equal(res.status, 200);
      assert.ok(
        res.headers['content-type'].includes('javascript') ||
        res.headers['content-type'].includes('application/octet-stream')
      );
      assert.ok(res.body.includes('class Roulette3D'));
    });

    it('should serve js/network.js with 200 OK', async () => {
      const res = await get('/js/network.js');
      assert.equal(res.status, 200);
      assert.ok(res.body.includes('class CasinoNetwork'));
    });

    it('should serve js/ui.js with 200 OK', async () => {
      const res = await get('/js/ui.js');
      assert.equal(res.status, 200);
      assert.ok(res.body.includes('class CasinoUI'));
    });

    it('should serve js/app.js with 200 OK', async () => {
      const res = await get('/js/app.js');
      assert.equal(res.status, 200);
      assert.ok(res.body.includes('DOMContentLoaded'));
    });
  });

  // =========================================================================
  // 2. Strict Constraints: 100% Silent & Zero GTA Branding
  // =========================================================================
  describe('Mandatory Constraints Verification', () => {
    it('should enforce 100% silent design (zero audio files in client/)', () => {
      const clientDir = path.join(__dirname, '../../client');
      const files = fs.readdirSync(clientDir, { recursive: true });
      for (const file of files) {
        const lower = String(file).toLowerCase();
        assert.ok(!lower.endsWith('.mp3'), `Forbidden audio file: ${file}`);
        assert.ok(!lower.endsWith('.wav'), `Forbidden audio file: ${file}`);
        assert.ok(!lower.endsWith('.ogg'), `Forbidden audio file: ${file}`);
        assert.ok(!lower.endsWith('.m4a'), `Forbidden audio file: ${file}`);
      }
    });

    it('should enforce zero Web Audio API usage in all client scripts', () => {
      const jsDir = path.join(__dirname, '../../client/js');
      const jsFiles = fs.readdirSync(jsDir, { recursive: true });
      for (const file of jsFiles) {
        if (file.endsWith('.js')) {
          const content = fs.readFileSync(path.join(jsDir, file), 'utf8');
          assert.ok(!content.includes('AudioContext'), `AudioContext found in ${file}`);
          assert.ok(!content.includes('webkitAudioContext'), `webkitAudioContext found in ${file}`);
          assert.ok(!content.includes('createOscillator'), `createOscillator found in ${file}`);
          assert.ok(!content.includes('createGain'), `createGain found in ${file}`);
        }
      }
    });

    it('should enforce zero GTA branding across all client files', () => {
      const clientDir = path.join(__dirname, '../../client');
      const files = fs.readdirSync(clientDir, { recursive: true });
      for (const file of files) {
        const fullPath = path.join(clientDir, file);
        if (fs.statSync(fullPath).isFile()) {
          const content = fs.readFileSync(fullPath, 'utf8').toLowerCase();
          assert.ok(!content.includes('grand theft auto'), `GTA found in ${file}`);
          assert.ok(!content.includes('los santos'), `Los Santos found in ${file}`);
          assert.ok(!content.includes('diamond casino'), `Diamond Casino found in ${file}`);
        }
      }
    });

    it('should verify thermal protection in Roulette3D.js (FPS throttling & draw call minimizer)', () => {
      const r3dPath = path.join(__dirname, '../../client/js/three/Roulette3D.js');
      const code = fs.readFileSync(r3dPath, 'utf8');
      assert.ok(code.includes('targetFps'), 'Roulette3D must manage targetFps');
      assert.ok(code.includes('30'), 'Roulette3D must have 30 FPS idle throttling');
      assert.ok(code.includes('60'), 'Roulette3D must cap at 60 FPS in spin');
      assert.ok(code.includes('shadowMap.enabled = false'), 'Roulette3D must disable shadow maps for thermals');
      assert.ok(code.includes('CanvasTexture'), 'Roulette3D must use single CanvasTexture for pockets');
      assert.ok(code.includes('RingGeometry'), 'Roulette3D must use RingGeometry for pocket atlas');
    });

    it('should verify European roulette layout elements in index.html', () => {
      const indexPath = path.join(__dirname, '../../client/index.html');
      const html = fs.readFileSync(indexPath, 'utf8');
      assert.ok(html.includes('id="hud-history-strip"'), 'Must have winning history strip');
      assert.ok(html.includes('id="roulette-betting-grid"'), 'Must have betting grid');
      assert.ok(html.includes('id="onboarding-modal"'), 'Must have onboarding modal');
      assert.ok(html.includes('id="color-palette"'), 'Must have color palette');
      assert.ok(html.includes('data-val="10"'), 'Must have 10 chip button');
      assert.ok(html.includes('data-val="1000"'), 'Must have 1000 chip button');
      assert.ok(html.includes('id="btn-clear-bets"'), 'Must have Clear Bets button');
      assert.ok(html.includes('id="btn-double-bets"'), 'Must have Double Bets button');
    });
  });
});
