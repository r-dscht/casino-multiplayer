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
const GIT_DIR_CANDIDATES = [
  path.join(__dirname, '..', '.git'),
  path.join(__dirname, '..', '..', '.git')
];

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

function hashGitHead(hash) {
  for (const gitDir of GIT_DIR_CANDIDATES) {
    try {
      const headPath = path.join(gitDir, 'HEAD');
      if (!fs.existsSync(headPath)) continue;
      const headContent = fs.readFileSync(headPath, 'utf8').trim();
      hash.update('git-head\0');
      hash.update(headContent);
      hash.update('\0');
      if (headContent.startsWith('ref:')) {
        const refRel = headContent.slice(4).trim();
        const refPath = path.join(gitDir, refRel);
        if (fs.existsSync(refPath)) {
          hash.update(fs.readFileSync(refPath, 'utf8').trim());
          hash.update('\0');
        }
      }
      break;
    } catch (err) {}
  }
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
    hashGitHead(hash);
  } catch (err) {
    hash.update(String(Date.now()));
  }
  return hash.digest('hex').slice(0, 12);
}

const startedAt = Date.now();
let cachedBuildHash = computeClientBuildHash();
let lastHashCheckAt = Date.now();
let currentBootId = `boot_${startedAt}_${crypto.randomBytes(4).toString('hex')}`;

function getVersionInfo() {
  const now = Date.now();
  if ((now - lastHashCheckAt) >= 1000) {
    lastHashCheckAt = now;
    const freshHash = computeClientBuildHash();
    if (freshHash && freshHash !== cachedBuildHash) {
      cachedBuildHash = freshHash;
      currentBootId = `boot_${now}_${crypto.randomBytes(4).toString('hex')}`;
    }
  }
  return {
    buildHash: cachedBuildHash,
    bootId: currentBootId,
    startedAt
  };
}

module.exports = {
  getVersionInfo,
  computeClientBuildHash
};
