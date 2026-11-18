/**
 * aviaEngine.test.js
 * Unit, Monte Carlo RTP, choreography integrity, navigation switch, and guardrail tests for AviaMasters.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PlayerManager = require('../../server/game/playerManager');
const AviaEngine = require('../../server/game/aviaEngine');
const {
  MIN_BET,
  MAX_BET,
  VALID_SPEEDS,
  TOTAL_WEIGHT,
  AVIA_OUTCOME_TIERS,
  tok,
  evaluateSequenceMultiplier,
  computeTheoreticalRtp
} = require('../../server/game/aviaConstants');
const CasinoUI = require('../../client/js/ui');

describe('AviaMasters Engine & UI Unit Suite', () => {
  let playerManager;
  let engine;
  let player;

  beforeEach(() => {
    playerManager = new PlayerManager({ storagePath: null });
    engine = new AviaEngine({ playerManager });
    player = playerManager.registerPlayer('sock_avia_1', {
      name: 'PilotRenzo',
      color: '#d4af37'
    });
    playerManager.addChips(player.id, 100000);
  });

  it('A1: maintains exact TOTAL_WEIGHT = 100,000, ~98.00% theoretical RTP, and consistent pickup arithmetic across all variants', () => {
    const summary = computeTheoreticalRtp();
    assert.equal(summary.weightSum, TOTAL_WEIGHT);
    assert.equal(summary.weightSum, 100000);
    assert.ok(
      Math.abs(summary.rtp - 0.98) < 1e-6,
      `Expected exact 98.000% RTP, got ${(summary.rtp * 100).toFixed(4)}%`
    );

    for (const tier of AVIA_OUTCOME_TIERS) {
      assert.ok(Array.isArray(tier.variants) && tier.variants.length > 0, `Missing variants for ${tier.id}`);
      for (const variant of tier.variants) {
        const computed = evaluateSequenceMultiplier(variant.map(tok));
        if (tier.landed) {
          assert.equal(
            computed,
            tier.finalMultiplier,
            `Arithmetic mismatch in ${tier.id} variant [${variant.join(',')}]: expected ${tier.finalMultiplier}, got ${computed}`
          );
        } else {
          assert.equal(tier.finalMultiplier, 0);
        }
      }
    }
  });

  it('A2: empirical 50,000-flight draw converges near 98% RTP without bias', () => {
    let totalReturned = 0;
    const samples = 50000;
    for (let i = 0; i < samples; i += 1) {
      const tier = engine.drawOutcomeTier();
      totalReturned += tier.finalMultiplier;
    }
    const sampleRtp = totalReturned / samples;
    assert.ok(
      sampleRtp >= 0.90 && sampleRtp <= 1.06,
      `Sampled RTP ${(sampleRtp * 100).toFixed(2)}% drifted out of bounds`
    );
  });

  it('A3: builds strictly ascending waypoints passing through events cleanly and matches finalMultiplier payout', () => {
    // Force a deterministic win tier (surge_4 -> idx 7 in AVIA_OUTCOME_TIERS -> roll cumulative weight)
    let cumRoll = 0;
    for (let i = 0; i < AVIA_OUTCOME_TIERS.length; i += 1) {
      if (AVIA_OUTCOME_TIERS[i].id === 'golden_6') break;
      cumRoll += AVIA_OUTCOME_TIERS[i].weight;
    }
    const fixedEngine = new AviaEngine({
      playerManager,
      randInt: (min, max) => (max === TOTAL_WEIGHT ? cumRoll + 5 : min)
    });

    const beforeChips = player.chips;
    const res = fixedEngine.startFlight(player.id, { amount: 500, speed: '2x' });
    assert.equal(res.ok, true);
    assert.equal(res.flight.tierId, 'golden_6');
    assert.equal(res.flight.landed, true);
    assert.equal(res.flight.finalMultiplier, 6);
    assert.equal(res.flight.payout, 3000);
    assert.equal(res.flight.profit, 2500);
    assert.equal(res.newChips, beforeChips - 500 + 3000);

    // Every step in events chains cleanly and ends at exact payout
    const evs = res.flight.events;
    assert.ok(evs.length > 0);
    assert.equal(evs[evs.length - 1].counterAfter, res.flight.payout);

    // Monotonic waypoint progression t in [0..1] and increasing world X
    const wps = res.flight.waypoints;
    assert.ok(wps.length >= 4);
    assert.equal(wps[0].t, 0);
    assert.equal(wps[wps.length - 1].t, 1);
    for (let i = 1; i < wps.length; i += 1) {
      assert.ok(wps[i].x > wps[i - 1].x, 'Waypoints x must strictly increase');
      assert.ok(wps[i].t >= wps[i - 1].t, 'Waypoints t must be non-decreasing');
    }
    assert.ok(res.flight.carriers.some(c => c.role === 'destination'));
    assert.ok(res.flight.carriers.length >= 3, 'Must populate multiple carriers across ocean');

    // Splash flight must reach water surface y <= 0 and sink cleanly
    const splashEngine = new AviaEngine({
      playerManager,
      randInt: (min, max) => (max === TOTAL_WEIGHT ? 0 : min)
    });
    const splashRes = splashEngine.startFlight(player.id, { amount: 250, speed: '1x' });
    assert.equal(splashRes.ok, true);
    assert.equal(splashRes.flight.landed, false);
    assert.equal(splashRes.flight.finalMultiplier, 0);
    assert.equal(splashRes.flight.payout, 0);
    assert.ok(
      splashRes.flight.waypoints.some(w => w.phase === 'splash' && w.y <= 0),
      'Splash flight must intersect water surface (y <= 0)'
    );
  });

  it('A4: validates payload, bet bounds, speed options, insufficient balance, history cap & bank repayment', () => {
    assert.equal(engine.startFlight(player.id, null).code, 'INVALID_PAYLOAD');
    assert.equal(engine.startFlight('nonexistent', { amount: 100 }).code, 'PLAYER_NOT_FOUND');
    assert.equal(engine.startFlight(player.id, { amount: MIN_BET - 1 }).code, 'INVALID_BET');
    assert.equal(engine.startFlight(player.id, { amount: MAX_BET + 1 }).code, 'INVALID_BET');
    assert.equal(engine.startFlight(player.id, { amount: 100.5 }).code, 'INVALID_BET');
    assert.equal(engine.startFlight(player.id, { amount: 100, speed: '10x' }).code, 'INVALID_SPEED');

    // Insufficient chips
    playerManager.deductChips(player.id, player.chips - 25);
    assert.equal(engine.startFlight(player.id, { amount: 100 }).code, 'INSUFFICIENT_FUNDS');
    playerManager.addChips(player.id, 100000);

    // Bank repayment hook invoked on profitable flight
    const repaymentCalls = [];
    const stubBank = {
      processWinRepayment(pid, netProfit) {
        repaymentCalls.push({ pid, netProfit });
        return [{ loanId: 'l1', lenderId: 'lender1', lenderName: 'Banker', amount: 100, isFullyRepaid: false }];
      }
    };
    const winningRoll = AVIA_OUTCOME_TIERS[0].weight + AVIA_OUTCOME_TIERS[1].weight + AVIA_OUTCOME_TIERS[2].weight + 1;
    const winEngine = new AviaEngine({
      playerManager,
      bankManager: stubBank,
      randInt: (min, max) => (max === TOTAL_WEIGHT ? winningRoll : min)
    });

    for (let i = 0; i < 30; i += 1) {
      const r = winEngine.startFlight(player.id, { amount: 200, speed: VALID_SPEEDS[i % VALID_SPEEDS.length] });
      assert.equal(r.ok, true);
    }

    assert.equal(repaymentCalls.length, 30);
    assert.equal(winEngine.getRecentFlights().length, 25);
    assert.equal(winEngine.getState().recentFlights.length, 25);
  });

  it('A5: wires #avia-view, #pill-avia, left dock button, view switching, and passes zero audio/emoji/GTA guardrails', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const html = fs.readFileSync(path.join(repoRoot, 'client/index.html'), 'utf8');
    assert.ok(html.includes('id="icon-avia"'), 'Missing #icon-avia SVG def');
    assert.ok(html.includes('id="pill-avia"'), 'Missing #pill-avia header pill');
    assert.ok(html.includes('data-game="avia"'), 'Missing dock/pill data-game="avia"');
    assert.ok(html.includes('id="avia-view"'), 'Missing #avia-view pane');
    assert.ok(html.includes('id="avia-canvas"'), 'Missing #avia-canvas element');
    assert.ok(html.includes('id="avia-chain-bar"'), 'Missing #avia-chain-bar element');
    assert.ok(html.includes('id="btn-avia-fly"'), 'Missing #btn-avia-fly trigger');
    assert.equal(html.includes('btn-avia-auto'), false, 'Auto-fly button must be removed');
    assert.equal(html.includes('btn-avia-skip'), false, 'Skip acceleration button must be removed');
    assert.ok(html.includes('class="game-pill feature-wip-hidden" data-game="avia" id="pill-avia"'), 'WIP hidden #pill-avia required while paused');
    assert.ok(html.includes('class="dock-left-btn feature-wip-hidden" data-game="avia"'), 'WIP hidden dock button required while paused');
    assert.ok(html.includes('id="avia-view" class="game-view-pane hidden feature-wip-hidden"'), 'WIP hidden #avia-view required while paused');
    const appJs = fs.readFileSync(path.join(repoRoot, 'client/js/app.js'), 'utf8');
    assert.ok(appJs.includes('const AVIA_WIP_ENABLED = false;'), 'AVIA_WIP_ENABLED must stay false while paused for zero CPU');

    const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    const audioApiRe = /AudioContext|webkitAudioContext|<audio|new Audio\s*\(|\.(mp3|wav|ogg)\b/i;
    const brandRe = /Grand Theft Auto|Diamond Casino|GTA V|GTA Online|Los Santos/i;
    const aviaFiles = [
      'server/game/aviaConstants.js',
      'server/game/aviaEngine.js',
      'client/js/avia.js'
    ];
    for (const rel of aviaFiles) {
      const src = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
      assert.equal(emojiRe.test(src), false, `Forbidden emoji in ${rel}`);
      assert.equal(audioApiRe.test(src), false, `Forbidden audio API in ${rel}`);
      assert.equal(brandRe.test(src), false, `Forbidden brand in ${rel}`);
    }

    // View switch test
    const ui = Object.create(CasinoUI.prototype);
    ui.elements = {};
    const elementsMap = {};
    function makeEl(id, cls = []) {
      const set = new Set(cls);
      const el = {
        id,
        classList: {
          add: (c) => set.add(c),
          remove: (c) => set.delete(c),
          toggle: (c, f) => (f === undefined ? (set.has(c) ? set.delete(c) : set.add(c)) : (f ? set.add(c) : set.delete(c))),
          contains: (c) => set.has(c)
        },
        dataset: { game: id.replace('pill-', '').replace('-view', '') },
        style: {}
      };
      elementsMap[id] = el;
      return el;
    }
    const vRoulette = makeEl('roulette-view', ['game-view-pane', 'active']);
    const vAvia = makeEl('avia-view', ['game-view-pane', 'hidden']);
    const pRoulette = makeEl('pill-roulette', ['game-pill', 'active']);
    const pAvia = makeEl('pill-avia', ['game-pill']);
    ui.elements.viewRoulette = vRoulette;
    ui.elements.pillRoulette = pRoulette;

    const origDoc = global.document;
    global.document = { getElementById: (id) => elementsMap[id] || null, querySelectorAll: () => [] };
    ui.updateChatTableFilter = () => {};
    ui.switchChatScope = () => {};
    try {
      ui.switchGameView('avia');
      assert.equal(vAvia.classList.contains('active'), true);
      assert.equal(vAvia.classList.contains('hidden'), false);
      assert.equal(pAvia.classList.contains('active'), true);
      assert.equal(vRoulette.classList.contains('hidden'), true);

      ui.switchGameView('roulette');
      assert.equal(vAvia.classList.contains('hidden'), true);
      assert.equal(vAvia.classList.contains('active'), false);
      assert.equal(pAvia.classList.contains('active'), false);
    } finally {
      global.document = origDoc;
    }
  });
});
