/**
 * app.js
 * Express application configuration.
 * Configured with trust proxy for cloud environments and static serving of client.
 */

const express = require('express');
const path = require('path');

const app = express();

// Trust reverse proxies (Cloudflare Tunnel, Render, Railway, etc.)
app.set('trust proxy', 1);

// JSON body parsing
app.use(express.json());

// Serve static web client assets
const clientPath = path.join(__dirname, '../client');
app.use(express.static(clientPath));

// Health check endpoint for uptime monitors and cloud orchestrators
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    uptime: process.uptime()
  });
});

module.exports = app;
