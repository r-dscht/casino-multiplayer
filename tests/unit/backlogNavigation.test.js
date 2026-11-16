/**
 * backlogNavigation.test.js
 * Automated unit test suite verifying modular navigation slots, anchors,
 * and pure vector SVG defs for all 8 backlog features in Monte Carlo Royale.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('Modular Backlog Navigation & Feature Slots (Unit Suite)', () => {
  const clientDir = path.resolve(__dirname, '../../client');
  const indexHtml = fs.readFileSync(path.join(clientDir, 'index.html'), 'utf8');

  it('BN1: Feature 1 - Gadgets & Perks Dock must be anchored at viewport bottom', () => {
    assert.ok(indexHtml.includes('id="gadgets-perks-dock"'), 'Must contain #gadgets-perks-dock');
    assert.ok(
      indexHtml.includes('id="dock-toggle-perks"') || indexHtml.includes('id="btn-toggle-gadgets"'),
      'Must contain dock toggle anchor'
    );
  });

  it('BN2: Feature 2 - Openbare Marktplaats must have trigger button and modal container', () => {
    assert.ok(indexHtml.includes('id="btn-open-market"'), 'Must contain #btn-open-market trigger');
    assert.ok(indexHtml.includes('id="market-modal"'), 'Must contain #market-modal container');
  });

  it('BN3: Feature 3 - Aandelen & Crypto Exchange must have trigger button and modal container', () => {
    assert.ok(indexHtml.includes('id="btn-open-exchange"'), 'Must contain #btn-open-exchange trigger');
    assert.ok(indexHtml.includes('id="exchange-modal"'), 'Must contain #exchange-modal container');
  });

  it('BN4: Feature 4 - Casino Staatsloterij must have trigger button and modal container', () => {
    assert.ok(indexHtml.includes('id="btn-open-lottery"'), 'Must contain #btn-open-lottery trigger');
    assert.ok(indexHtml.includes('id="lottery-modal"'), 'Must contain #lottery-modal container');
  });

  it('BN5: Feature 5 - Gokkasten / Slots zaal must have navigation pill and game viewport pane', () => {
    assert.ok(indexHtml.includes('id="pill-slots"'), 'Must contain #pill-slots');
    assert.ok(indexHtml.includes('id="slots-view"'), 'Must contain #slots-view');
  });

  it('BN6: Feature 6 - Plinko must have navigation pill and game viewport pane', () => {
    assert.ok(indexHtml.includes('id="pill-plinko"'), 'Must contain #pill-plinko');
    assert.ok(indexHtml.includes('id="plinko-view"'), 'Must contain #plinko-view');
  });

  it('BN7: Feature 7 - Hi-Lo (Hoger of Lager) must have navigation pill and game viewport pane', () => {
    assert.ok(indexHtml.includes('id="pill-hilo"'), 'Must contain #pill-hilo');
    assert.ok(indexHtml.includes('id="hilo-view"'), 'Must contain #hilo-view');
  });

  it('BN8: Feature 8 - Horse Racing (Monaco Turf Club) must have navigation pill and viewport/modal', () => {
    assert.ok(indexHtml.includes('id="pill-racing"'), 'Must contain #pill-racing');
    assert.ok(
      indexHtml.includes('id="racing-view"') || indexHtml.includes('id="racing-modal"'),
      'Must contain #racing-view or modal'
    );
  });

  it('BN9: All 4 primary active games (Roulette, Blackjack, Poker, Crash) remain intact in header pills', () => {
    assert.ok(indexHtml.includes('id="pill-roulette"'), 'Must contain #pill-roulette');
    assert.ok(indexHtml.includes('id="pill-blackjack"'), 'Must contain #pill-blackjack');
    assert.ok(indexHtml.includes('id="pill-poker"'), 'Must contain #pill-poker');
    assert.ok(indexHtml.includes('id="pill-crash"'), 'Must contain #pill-crash');
  });

  it('BN10: Pure vector SVG iconography defs exist for all 8 backlog features', () => {
    const requiredSvgIds = [
      'icon-gadgets',
      'icon-market',
      'icon-exchange',
      'icon-lottery',
      'icon-slots',
      'icon-plinko',
      'icon-hilo',
      'icon-racing'
    ];
    for (const svgId of requiredSvgIds) {
      assert.ok(
        indexHtml.includes(`id="${svgId}"`),
        `index.html <defs> must include #${svgId}`
      );
    }
  });

  it('BN11: Left Command Dock (#dock-sidebar-left) exists for Obsidian VIP command layout', () => {
    assert.ok(indexHtml.includes('id="dock-sidebar-left"'), 'Must contain #dock-sidebar-left');
  });

  it('BN12: Obsidian Salle Blanche is permanently set for all players and Renzo preview dock is removed', () => {
    assert.ok(indexHtml.includes('data-theme="theme-obsidian"'), 'HTML must lock theme-obsidian');
    assert.ok(indexHtml.includes('data-layout="rail"'), 'HTML must lock rail command dock layout');
    assert.ok(!indexHtml.includes('id="renzo-preview-dock"'), 'Preview dock must be removed');
    assert.ok(!indexHtml.includes('id="theme-switcher-container"'), 'Theme switcher dropdown must be removed');
  });

  it('BN13: Bidirectional view switching hides inactive views and clears active pill states', () => {
    const CasinoUI = require('../../client/js/ui.js');
    const ui = Object.create(CasinoUI.prototype);
    ui.elements = {};

    const elementsMap = {};
    function mockElement(id, initialClasses = []) {
      const classSet = new Set(initialClasses);
      const el = {
        id,
        classList: {
          add: (c) => classSet.add(c),
          remove: (c) => classSet.delete(c),
          toggle: (c, force) => {
            if (force === undefined) {
              if (classSet.has(c)) classSet.delete(c); else classSet.add(c);
            } else if (force) {
              classSet.add(c);
            } else {
              classSet.delete(c);
            }
          },
          contains: (c) => classSet.has(c)
        },
        dataset: { game: id.replace('pill-', '').replace('-view', '') },
        style: {}
      };
      elementsMap[id] = el;
      return el;
    }

    // Create primary views and pills
    const vRoulette = mockElement('roulette-view', ['game-view-pane', 'active']);
    const vBlackjack = mockElement('blackjack-view', ['game-view-pane', 'hidden']);
    const vPoker = mockElement('poker-view', ['game-view-pane', 'hidden']);
    const vCrash = mockElement('crash-view', ['game-view-pane', 'hidden']);

    const pRoulette = mockElement('pill-roulette', ['game-pill', 'active']);
    const pBlackjack = mockElement('pill-blackjack', ['game-pill']);
    const pPoker = mockElement('pill-poker', ['game-pill']);
    const pCrash = mockElement('pill-crash', ['game-pill']);

    // Create backlog views and pills
    const vSlots = mockElement('slots-view', ['game-view-pane', 'hidden']);
    const vPlinko = mockElement('plinko-view', ['game-view-pane', 'hidden']);
    const vHilo = mockElement('hilo-view', ['game-view-pane', 'hidden']);
    const vRacing = mockElement('racing-view', ['game-view-pane', 'hidden']);

    const pSlots = mockElement('pill-slots', ['game-pill']);
    const pPlinko = mockElement('pill-plinko', ['game-pill']);
    const pHilo = mockElement('pill-hilo', ['game-pill']);
    const pRacing = mockElement('pill-racing', ['game-pill']);

    ui.elements.viewRoulette = vRoulette;
    ui.elements.viewBlackjack = vBlackjack;
    ui.elements.viewPoker = vPoker;
    ui.elements.viewCrash = vCrash;
    ui.elements.pillRoulette = pRoulette;
    ui.elements.pillBlackjack = pBlackjack;
    ui.elements.pillPoker = pPoker;
    ui.elements.pillCrash = pCrash;

    const originalDoc = global.document;
    global.document = {
      getElementById: (id) => elementsMap[id] || null,
      querySelectorAll: () => []
    };
    ui.updateChatTableFilter = () => {};
    ui.switchChatScope = () => {};

    try {
      // Step 1: Navigate from table game (Roulette) to Backlog game (Slots)
      ui.switchGameView('slots');
      assert.ok(vSlots.classList.contains('active'), 'slots-view must be active');
      assert.ok(!vSlots.classList.contains('hidden'), 'slots-view must not be hidden');
      assert.ok(vRoulette.classList.contains('hidden'), 'roulette-view must be hidden');
      assert.ok(!vRoulette.classList.contains('active'), 'roulette-view must not be active');
      assert.ok(pSlots.classList.contains('active'), 'pill-slots must be active');
      assert.ok(!pRoulette.classList.contains('active'), 'pill-roulette must not be active');

      // Step 2: Navigate back from Backlog game (Slots) to table game (Roulette)
      ui.switchGameView('roulette');
      assert.ok(vRoulette.classList.contains('active'), 'roulette-view must be active');
      assert.ok(!vRoulette.classList.contains('hidden'), 'roulette-view must not be hidden');
      assert.ok(pRoulette.classList.contains('active'), 'pill-roulette must be active');

      // Crucial assertion: Backlog views must be hidden and inactive! No dual-view stacking!
      assert.ok(vSlots.classList.contains('hidden'), 'slots-view must be hidden when switching to roulette');
      assert.ok(!vSlots.classList.contains('active'), 'slots-view must not be active when switching to roulette');
      assert.ok(vPlinko.classList.contains('hidden'), 'plinko-view must be hidden');
      assert.ok(vHilo.classList.contains('hidden'), 'hilo-view must be hidden');
      assert.ok(vRacing.classList.contains('hidden'), 'racing-view must be hidden');

      // Crucial assertion: Backlog pills must not be active!
      assert.ok(!pSlots.classList.contains('active'), 'pill-slots must not be active on table game');
      assert.ok(!pPlinko.classList.contains('active'), 'pill-plinko must not be active on table game');
      assert.ok(!pHilo.classList.contains('active'), 'pill-hilo must not be active on table game');
      assert.ok(!pRacing.classList.contains('active'), 'pill-racing must not be active on table game');

      // Step 3: Switch to Blackjack
      ui.switchGameView('blackjack');
      assert.ok(vBlackjack.classList.contains('active'), 'blackjack-view must be active');
      assert.ok(!vBlackjack.classList.contains('hidden'), 'blackjack-view must not be hidden');
      assert.ok(vRoulette.classList.contains('hidden'), 'roulette-view must be hidden');
      assert.ok(vSlots.classList.contains('hidden'), 'slots-view must remain hidden');
      assert.ok(!pSlots.classList.contains('active'), 'pill-slots must remain inactive');

      // Step 4: Switch to Racing
      ui.switchGameView('racing');
      assert.ok(vRacing.classList.contains('active'), 'racing-view must be active');
      assert.ok(!vRacing.classList.contains('hidden'), 'racing-view must not be hidden');
      assert.ok(pRacing.classList.contains('active'), 'pill-racing must be active');
      assert.ok(vBlackjack.classList.contains('hidden'), 'blackjack-view must be hidden');
      assert.ok(!pBlackjack.classList.contains('active'), 'pill-blackjack must not be active');
    } finally {
      global.document = originalDoc;
    }
  });
});
