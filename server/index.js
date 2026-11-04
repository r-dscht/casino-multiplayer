/**
 * index.js
 * Server entry point.
 * Boots Express HTTP server and Socket.io European Roulette engine.
 */

const http = require('http');
const app = require('./app');
const { setupSocket } = require('./socket');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const server = http.createServer(app);
const { engine } = setupSocket(server);

// Start game loop engine
engine.start();

server.listen(PORT, HOST, () => {
  console.log('========================================================');
  console.log('  EUROPEAN ROULETTE — MULTIPLAYER CASINO SERVER');
  console.log(`  Status: Running on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log('  Mode: Single-Zero European Standard (37 pockets)');
  console.log('========================================================');
});

let tunnel = null;

// Automated Cloudflare Quick Tunnel (launches when ENABLE_TUNNEL !== 'false' and not in cloud)
if (process.env.ENABLE_TUNNEL !== 'false' && !process.env.RENDER && !process.env.RAILWAY_ENVIRONMENT) {
  try {
    const CloudflareTunnel = require('./tunnel');
    tunnel = new CloudflareTunnel(PORT);
    tunnel.start().then((url) => {
      if (url) {
        // Banner is displayed by tunnel
      }
    }).catch((err) => {
      console.warn('  Cloudflare tunnel failed to start:', err.message);
    });
  } catch (e) {
    console.warn('  Failed to load Cloudflare tunnel module:', e.message);
  }
} else {
  console.log('  Cloudflare Tunnel: Bypassed (cloud environment or ENABLE_TUNNEL=false)');
  console.log('========================================================');
}

// Graceful shutdown
function shutdown() {
  console.log('\nShutting down server...');
  if (tunnel) {
    try {
      tunnel.stop();
    } catch (e) {}
  }
  engine.stop();
  server.close(() => {
    console.log('Server closed successfully.');
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('beforeExit', () => {
  if (tunnel) tunnel.stop();
});

module.exports = { server, engine, tunnel };
