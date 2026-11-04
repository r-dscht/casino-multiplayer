/**
 * tunnel.js
 * Automated Cloudflare Quick Tunnel Integration.
 * Spawns `cloudflared` to establish a zero-config public HTTPS tunnel
 * and captures the ephemeral `trycloudflare.com` URL.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const TRYCLOUDFLARE_REGEX = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

/**
 * Extracts a trycloudflare.com URL from console output text.
 * @param {string} text
 * @returns {string|null}
 */
function extractTunnelUrl(text) {
  if (typeof text !== 'string') return null;
  const match = text.match(TRYCLOUDFLARE_REGEX);
  return match ? match[0] : null;
}

/**
 * Formats a clean, prominent luxury casino banner with the public HTTPS URL.
 * @param {string} url
 * @param {number|string} port
 * @returns {string}
 */
function formatLuxuryBanner(url, port = 3000) {
  return [
    '========================================================================',
    '  💎 MONTE CARLO ROYALE — LUXURY MULTIPLAYER CASINO 💎',
    '  Live European Roulette (Single-Zero 37 Pockets) • 100% Silent Mode',
    '========================================================================',
    '  ★ PUBLIC HTTPS TUNNEL ACCESS (Share with remote players):',
    `    >>> ${url} <<<`,
    '',
    `  ♦ Local Server:  http://127.0.0.1:${port}`,
    '  ♠ Protocol:      HTTPS & WSS Secure WebSocket Connection',
    '  ♥ Requirements:  Zero Install • Any Desktop or Mobile Browser',
    '  ♣ Network:       Cloudflare Global Edge Network Active',
    '========================================================================'
  ].join('\n');
}

/**
 * Prints the luxury casino banner to the console.
 * @param {string} url
 * @param {number|string} port
 * @returns {string}
 */
function printLuxuryBanner(url, port = 3000) {
  const banner = formatLuxuryBanner(url, port);
  console.log('\n' + banner + '\n');
  return banner;
}

class CloudflareTunnel {
  constructor(port = 3000, options = {}) {
    this.port = parseInt(port, 10) || 3000;
    this.options = options;
    this.childProcess = null;
    this.url = null;
    this._hooksRegistered = false;
    this._exitHandler = null;
  }

  /**
   * Evaluates whether current environment is a cloud hosting provider.
   * @param {NodeJS.ProcessEnv} [env=process.env]
   * @returns {boolean}
   */
  static isCloudEnvironment(env = process.env) {
    return Boolean(
      env.RENDER ||
      env.RAILWAY_ENVIRONMENT ||
      env.FLY_ALLOC_ID ||
      env.DYNO ||
      env.HEROKU_APP_NAME ||
      env.KUBERNETES_SERVICE_HOST
    );
  }

  /**
   * Determines whether the quick tunnel should be launched.
   * Returns false when in cloud hosting or when explicitly disabled.
   * @param {NodeJS.ProcessEnv} [env=process.env]
   * @returns {boolean}
   */
  static shouldEnableTunnel(env = process.env) {
    if (env.ENABLE_TUNNEL === 'false') {
      return false;
    }
    if (CloudflareTunnel.isCloudEnvironment(env)) {
      return false;
    }
    return true;
  }

  /**
   * Resolves the cloudflared executable path.
   * Checks explicit env, installed npm package, npx cache, or system PATH.
   * @returns {string}
   */
  getBinaryPath() {
    // 1. Explicit environment variable override
    if (process.env.CLOUDFLARED_PATH && fs.existsSync(process.env.CLOUDFLARED_PATH)) {
      return process.env.CLOUDFLARED_PATH;
    }

    // 2. Installed npm package 'cloudflared'
    try {
      const cf = require('cloudflared');
      if (cf && cf.bin && fs.existsSync(cf.bin)) {
        return cf.bin;
      }
    } catch (e) {
      // Package not resolvable or missing binary
    }

    // 3. npx cache directory on Windows
    if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
      const npxCacheDir = path.join(process.env.LOCALAPPDATA, 'npm-cache', '_npx');
      if (fs.existsSync(npxCacheDir)) {
        try {
          const entries = fs.readdirSync(npxCacheDir);
          for (const entry of entries) {
            const candidate = path.join(npxCacheDir, entry, 'node_modules', 'cloudflared', 'bin', 'cloudflared.exe');
            if (fs.existsSync(candidate)) {
              return candidate;
            }
          }
        } catch (e) {}
      }
    }

    // 4. Default to system PATH
    return 'cloudflared';
  }

  /**
   * Registers process termination hooks to clean up child process.
   */
  registerLifecycleHooks() {
    if (this._hooksRegistered) return;
    this._hooksRegistered = true;

    this._exitHandler = () => {
      this.stop();
    };

    process.once('beforeExit', this._exitHandler);
    process.once('exit', this._exitHandler);
    process.on('SIGINT', this._exitHandler);
    process.on('SIGTERM', this._exitHandler);
  }

  /**
   * Starts the cloudflared quick tunnel child process.
   * @param {number} [timeoutMs=30000] Maximum time to wait for URL.
   * @returns {Promise<string|null>} Resolves with captured public URL or null on failure.
   */
  start(timeoutMs = 30000) {
    return new Promise((resolve) => {
      const bin = this.getBinaryPath();
      const args = ['tunnel', '--url', `http://127.0.0.1:${this.port}`];

      let resolved = false;
      let timer = null;

      const safeResolve = (url) => {
        if (resolved) return;
        resolved = true;
        if (timer) clearTimeout(timer);
        this.url = url;
        if (url) {
          printLuxuryBanner(url, this.port);
        }
        resolve(url);
      };

      try {
        const isWindows = process.platform === 'win32';
        const useShell = isWindows && !bin.toLowerCase().endsWith('.exe');

        this.childProcess = spawn(bin, args, {
          shell: useShell,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true
        });
      } catch (err) {
        console.warn(`[Tunnel] Failed to spawn cloudflared (${bin}):`, err.message);
        return safeResolve(null);
      }

      this.registerLifecycleHooks();

      const onChunk = (chunk) => {
        const text = chunk.toString();
        const detected = extractTunnelUrl(text);
        if (detected) {
          safeResolve(detected);
        }
      };

      // cloudflared emits quick tunnel connection information to stderr
      if (this.childProcess.stderr) {
        this.childProcess.stderr.on('data', onChunk);
      }
      if (this.childProcess.stdout) {
        this.childProcess.stdout.on('data', onChunk);
      }

      this.childProcess.on('error', (err) => {
        console.warn(`[Tunnel] Cloudflare process encountered an error: ${err.message}`);
        safeResolve(null);
      });

      this.childProcess.on('exit', (code) => {
        if (!resolved) {
          console.warn(`[Tunnel] Cloudflare process exited before URL was obtained (code ${code})`);
          safeResolve(null);
        }
        this.childProcess = null;
      });

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          if (!resolved) {
            console.warn(`[Tunnel] Timed out waiting for Cloudflare quick tunnel after ${timeoutMs}ms.`);
            safeResolve(null);
          }
        }, timeoutMs);
      }
    });
  }

  /**
   * Stops and kills the child cloudflared process cleanly.
   */
  stop() {
    if (this.childProcess) {
      try {
        this.childProcess.kill('SIGINT');
      } catch (e) {
        try {
          this.childProcess.kill();
        } catch (e2) {}
      }
      this.childProcess = null;
    }
  }
}

module.exports = CloudflareTunnel;
CloudflareTunnel.CloudflareTunnel = CloudflareTunnel;
CloudflareTunnel.extractTunnelUrl = extractTunnelUrl;
CloudflareTunnel.formatLuxuryBanner = formatLuxuryBanner;
CloudflareTunnel.printLuxuryBanner = printLuxuryBanner;
CloudflareTunnel.TRYCLOUDFLARE_REGEX = TRYCLOUDFLARE_REGEX;

if (require.main === module) {
  const port = parseInt(process.env.PORT, 10) || 3000;
  const tunnel = new CloudflareTunnel(port);
  console.log(`[Tunnel] Launching Cloudflare Quick Tunnel for port ${port}...`);
  tunnel.start().then((url) => {
    if (!url) {
      console.error('[Tunnel] Failed to establish Cloudflare quick tunnel.');
      process.exit(1);
    }
  });
}
