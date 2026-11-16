/**
 * projectNavDocs.test.js
 * Guards the compact AGENTS.md + modular .agents/nav/*.md navigation maps:
 *  1. AGENTS.md stays compact and declares all required workflow rules.
 *  2. Zero line numbers or line ranges are hardcoded in navigation cards.
 *  3. Every referenced repo file/directory path actually exists on disk.
 *  4. Zero audio references, zero Unicode emojis, zero banned brand terms.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const NAV_FILES = [
  'AGENTS.md',
  '.agents/nav/games-math.md',
  '.agents/nav/socket-events.md',
  '.agents/nav/client-ui.md',
  '.agents/nav/state-bank-tests.md',
];

describe('Project Navigation Docs (AGENTS.md & .agents/nav/)', () => {
  it('keeps AGENTS.md compact (< 8 KB) and includes the 5 required workflow rules', () => {
    const agentsPath = path.join(REPO_ROOT, 'AGENTS.md');
    assert.equal(fs.existsSync(agentsPath), true, 'AGENTS.md must exist at project root');

    const stat = fs.statSync(agentsPath);
    assert.ok(stat.size < 8192, `AGENTS.md must remain compact (< 8 KB), got ${stat.size} bytes`);

    const content = fs.readFileSync(agentsPath, 'utf8');
    const lines = content.split(/\r?\n/).length;
    assert.ok(lines <= 160, `AGENTS.md must stay <= 160 lines, got ${lines}`);

    const requiredSnippets = [
      'Draai na elke wijziging de volledige testsuite en toon alleen samenvatting + gefaalde tests.',
      'Voeg zelf tests toe voor nieuwe features en bugfixes.',
      'Pas een bestaande test alleen aan als het gedrag bewust verandert, en meld dat.',
      'Werk de relevante kaart kort bij als structuur, events of ID\'s veranderen.',
      'Antwoord kort, zonder inleiding of herhaling.',
    ];
    for (const rule of requiredSnippets) {
      assert.ok(content.includes(rule), `AGENTS.md missing required rule: ${rule}`);
    }
  });

  it('contains all 4 modular cards with zero line numbers or line ranges', () => {
    // Disallow :123, :10-20, L123, L10-L20, "regel 12", "line 12" patterns
    const lineRefRegex = /(?:[a-zA-Z0-9_.\-/)]+:\d+(?:-\d+)?|\bL\d+(?:-L?\d+)?\b|\b(?:line|lines|regel|regels)\s+\d+\b)/i;

    for (const relPath of NAV_FILES) {
      const fullPath = path.join(REPO_ROOT, relPath);
      assert.equal(fs.existsSync(fullPath), true, `Missing navigation doc: ${relPath}`);
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const match = line.match(lineRefRegex);
        assert.equal(
          match,
          null,
          `Found prohibited line number/range anchor "${match && match[0]}" in ${relPath}`
        );
      }
    }
  });

  it('resolves every referenced repo path to an existing file or directory', () => {
    const pathPattern = /(?:^|[\s(`"'\[])((?:\.agents|client|server|tests)\/[A-Za-z0-9_.\-\/*]+)/g;

    for (const relPath of NAV_FILES) {
      const content = fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
      const found = new Set();
      let m;
      while ((m = pathPattern.exec(content)) !== null) {
        found.add(m[1].replace(/[.,:;`'")\]]+$/, ''));
      }

      assert.ok(found.size > 0, `Expected at least one repo path in ${relPath}`);
      for (const target of found) {
        if (target.includes('*')) continue;
        const absTarget = path.join(REPO_ROOT, target);
        assert.equal(
          fs.existsSync(absTarget),
          true,
          `Broken navigation path "${target}" referenced in ${relPath}`
        );
      }
    }
  });

  it('enforces casino guardrails (0 emojis, 0 audio APIs, 0 forbidden brands) across nav docs', () => {
    const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    const audioApiRe = /AudioContext|webkitAudioContext|<audio|new Audio\s*\(|\.(mp3|wav|ogg)\b/i;
    const brandRe = /Grand Theft Auto|Diamond Casino|GTA V|GTA Online|Los Santos/i;

    for (const relPath of NAV_FILES) {
      const content = fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
      assert.equal(emojiRe.test(content), false, `Forbidden emoji in ${relPath}`);
      assert.equal(audioApiRe.test(content), false, `Forbidden audio API/extension in ${relPath}`);
      assert.equal(brandRe.test(content), false, `Forbidden brand name in ${relPath}`);
    }
  });
});
