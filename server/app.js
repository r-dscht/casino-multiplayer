/**
 * app.js
 * Express application configuration.
 * Configured with trust proxy for cloud environments, zero-stale static headers,
 * and /api/version + /health endpoints for deploy auto-update detection.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { getVersionInfo } = require('./version');

const app = express();

// Trust reverse proxies (Cloudflare Tunnel, Render, Railway, etc.)
app.set('trust proxy', 1);

// JSON body parsing
app.use(express.json());

// Serve index.html dynamically with ?v=<buildHash> asset cache-busting and embedded version metadata
const clientPath = path.join(__dirname, '../client');
const indexHtmlPath = path.join(clientPath, 'index.html');

function sendVersionedIndex(req, res, next) {
  try {
    const info = getVersionInfo();
    let html = fs.readFileSync(indexHtmlPath, 'utf8');
    html = html.replace(/(href|src)="((?:css|js)\/[^"?#]+)"/g, (_, attr, asset) => `${attr}="${asset}?v=${info.buildHash}"`);
    const bootScript = `<script>window.__CASINO_VERSION__=${JSON.stringify({ buildHash: info.buildHash, bootId: info.bootId })};</script>`;
    html = html.replace('</head>', `  ${bootScript}\n</head>`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.type('html').send(html);
  } catch (err) {
    next(err);
  }
}

app.get(['/', '/index.html'], sendVersionedIndex);

// Serve static web client assets with strict no-cache on code/markup to avoid version drift
app.use(express.static(clientPath, {
  index: false,
  setHeaders(res, filePath) {
    const lower = String(filePath || '').toLowerCase();
    if (lower.endsWith('.html') || lower.endsWith('.js') || lower.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// Version metadata endpoint for deploy-refresh polling
app.get('/api/version', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json({
    status: 'ok',
    ...getVersionInfo(),
    timestamp: Date.now()
  });
});

// Health check endpoint for uptime monitors and cloud orchestrators
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    ...getVersionInfo(),
    timestamp: Date.now(),
    uptime: process.uptime()
  });
});

module.exports = app;
