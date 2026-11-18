/**
 * version.js
 * Tracks deterministic client asset buildHash and unique server bootId so connected
 * clients detect new deployments/restarts and safely auto-refresh without stale cache glitches.
 * Zero audio, zero Unicode emojis, zero banned brand terms.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CLIENT_DIR = path.join(__dirname, '..', 'client');

function collectFilesSorted(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFilesSorted(full, acc);
    } else if (entry.isFile()) {
      const lower = entry.name.toLowerCase();
      if (lower.endsWith('.html') || lower.endsWith('.js') || lower.endsWith('.css')) {
        acc.push(full);
      }
    }
  }
  return acc;
}

function computeClientBuildHash() {
  const hash = crypto.createHash('sha256');
  try {
    const files = collectFilesSorted(CLIENT_DIR);
    for (const filePath of files) {
      const rel = path.relative(CLIENT_DIR, filePath).replace(/\\/g, '/');
      hash.update(rel);
      hash.update('\0');
      hash.update(fs.readFileSync(filePath));
      hash.update('\0');
    }
  } catch (err) {
    hash.update(String(Date.now()));
  }
  return hash.digest('hex').slice(0, 12);
}

const startedAt = Date.now();
const buildHash = computeClientBuildHash();
const bootId = `boot_${startedAt}_${crypto.randomBytes(4).toString('hex')}`;

function getVersionInfo() {
  return {
    buildHash,
    bootId,
    startedAt
  };
}

module.exports = {
  getVersionInfo,
  computeClientBuildHash
};
