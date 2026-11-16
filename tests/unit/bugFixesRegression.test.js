/**
 * bugFixesRegression.test.js
 * Regression test suite verifying all 7 bug fixes:
 *  1. Blackjack BETTING lock parity, bj_bet_placed lock, & navigation_blocked UI revert
 *  2. Hi-Lo Blitz spectator loss banner when table busts (never false win)
 *  3. game_switched / view-switch deactivates Hi-Lo and Poker controllers
 *  4. Poker bankManager.processWinRepayment settlement on cashout / disconnect
 *  5. Poker live HUD top phase bar & timer sync + Poker phaseMap entries in ui.js
 *  6. Bank UI updated copy ('casinowinst'), removal of dead bailout DOM refs, & Escape close
 *  7. Slots onViewDeactivated releases pendingPayoutHold cleanly
 */

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PlayerManager = require('../../server/game/playerManager');
const BankManager = require('../../server/game/bankManager');
const PokerEngine = require('../../server/game/pokerEngine');
const { PHASES: POKER_PHASES, ACTIONS: POKER_ACTIONS } = require('../../server/game/pokerConstants');
const CasinoPoker = require('../../client/js/poker');
const CasinoHilo = require('../../client/js/hilo');
const CasinoSlots = require('../../client/js/slots');
const CasinoBank = require('../../client/js/bank');

describe('Bug Fixes Regression Suite', () => {
  const clientDir = path.join(__dirname, '..', '..', 'client');
  const serverDir = path.join(__dirname, '..', '..', 'server');

  let activePokerEngine = null;

  afterEach(() => {
    if (activePokerEngine) {
      activePokerEngine.stop();
      activePokerEngine = null;
    }
    delete global.document;
    delete global.window;
  });

  describe('1 & 3. Navigation Lock Parity, View Deactivation & navigation_blocked Revert', () => {
    it('app.js enforces Blackjack BETTING lock, bj_bet_placed lock, HiLo/Poker deactivation, and navigation_blocked view restore', () => {
      const appJs = fs.readFileSync(path.join(clientDir, 'js', 'app.js'), 'utf8');
      const socketJs = fs.readFileSync(path.join(serverDir, 'socket.js'), 'utf8');

      // Blackjack BETTING phase checked client-side and on bj_bet_placed
      assert.match(appJs, /\['BETTING',\s*'DEALING',\s*'PLAYER_TURNS',\s*'DEALER_TURN'\]\.includes\(currentBjTableState\.phase\)/);
      const bjBetPlacedIdx = appJs.indexOf("network.on('bj_bet_placed'");
      assert.ok(bjBetPlacedIdx !== -1);
      const bjBetPlacedSlice = appJs.slice(bjBetPlacedIdx, appJs.indexOf("network.on('bj_bet_cleared'"));
      assert.ok(bjBetPlacedSlice.includes('ui.setNavigationLocked(hasUnsettledBets())'));

      // Shared deactivation includes Hi-Lo & Poker
      assert.ok(appJs.includes('hilo.onViewDeactivated()'));
      assert.ok(appJs.includes('poker.onViewDeactivated()'));

      // game_switched invokes shared switcher (which calls deactivateInactiveViews)
      const gameSwitchedIdx = appJs.indexOf("network.on('game_switched'");
      assert.ok(gameSwitchedIdx !== -1);
      const gameSwitchedSlice = appJs.slice(gameSwitchedIdx, gameSwitchedIdx + 400);
      assert.ok(gameSwitchedSlice.includes('activateGameView('));

      // navigation_blocked reverts UI view when currentGame differs from local view
      const navBlockedIdx = appJs.indexOf("network.on('navigation_blocked'");
      assert.ok(navBlockedIdx !== -1);
      const navBlockedSlice = appJs.slice(navBlockedIdx, navBlockedIdx + 500);
      assert.ok(navBlockedSlice.includes('activateGameView('));

      // Server navigation_blocked emits currentGame and location
      assert.ok(socketJs.includes('currentGame: player.currentGame'));
      assert.ok(socketJs.includes('location: player.location'));
    });
  });

  describe('2. Hi-Lo Blitz Spectator Reveal Logic', () => {
    it('shows loss banner to spectator when Blitz players bust and win banner to winners', () => {
      const listeners = {};
      const mockNetwork = {
        on: (ev, cb) => { listeners[ev] = cb; },
        emit: () => {},
        hiloJoin: () => {},
        hiloAction: () => {}
      };
      const mockUi = {
        myPlayer: { id: 'p_spec', name: 'Toeschouwer', chips: 5000 },
        updatePhase: () => {},
        updateTimer: () => {},
        updatePlayerHUD: () => {},
        setNavigationLocked: () => {},
        showToast: () => {}
      };

      const hilo = new CasinoHilo({ network: mockNetwork, ui: mockUi });
      hilo.mode = 'blitz';
      hilo.el = {};

      const banners = [];
      const particleBursts = [];
      hilo._showBanner = (text, tone) => banners.push({ text, tone });
      hilo._spawnParticles = (color, count) => particleBursts.push({ color, count });
      hilo._resetFlipCardVisual = () => {};
      hilo._playFlipReset = () => {};
      hilo.render = () => {};
      hilo._triggerPromoteAnim = () => {};
      hilo._syncNavLock = () => {};
      hilo._syncTopPhase = () => {};

      // Intercept timeouts briefly so reveal callback executes immediately
      const origSetTimeout = global.setTimeout;
      global.setTimeout = (fn) => { fn(); return 0; };
      try {
        hilo.bindNetworkEvents();

        // Case A: Spectator watches all Blitz players bust (winners = [])
        listeners.hilo_blitz_reveal({
          previousCard: { rank: '9', suit: 'spades', value: 9 },
          nextCard: { rank: '2', suit: 'clubs', value: 2 },
          winners: [],
          busted: [{ playerId: 'p_other', playerName: 'Speler1' }],
          blitz: { phase: 'BLITZ_REVEAL', participants: [] }
        });

        assert.equal(banners.length, 1);
        assert.equal(banners[0].tone, 'loss');
        assert.equal(banners[0].text, 'TAFEL MIS!');
        assert.equal(particleBursts[0].color, 'crimson');

        // Case B: Active participant wins -> GOED! <mult> win banner
        mockUi.myPlayer.id = 'p_winner';
        listeners.hilo_blitz_reveal({
          previousCard: { rank: '4', suit: 'hearts', value: 4 },
          nextCard: { rank: 'K', suit: 'diamonds', value: 13 },
          winners: [{ playerId: 'p_winner', multiplier: 1.55, newPot: 310 }],
          busted: [],
          blitz: { phase: 'BLITZ_REVEAL', participants: [] }
        });

        assert.equal(banners.length, 2);
        assert.equal(banners[1].tone, 'win');
        assert.equal(banners[1].text, 'GOED! 1.55x');
      } finally {
        global.setTimeout = origSetTimeout;
      }
    });
  });

  describe('4. Poker BankManager Loan Repayment on Cashout', () => {
    it('passes bankManager in socket.js and automatically repays loan from realized Poker net profit on leaveSeat', () => {
      const socketJs = fs.readFileSync(path.join(serverDir, 'socket.js'), 'utf8');
      assert.match(socketJs, /defaultPokerEngine\s*=\s*new PokerEngine\(playerManager,\s*\{[\s\S]*bankManager,/);
      assert.match(socketJs, /highRollerPokerEngine\s*=\s*new PokerEngine\(playerManager,\s*\{[\s\S]*bankManager,/);

      const pm = new PlayerManager({ storagePath: false });
      const bm = new BankManager(pm, { storagePath: false });

      const alice = pm.registerPlayer('sock_a', { name: 'Alice' });
      const bob = pm.registerPlayer('sock_b', { name: 'Bob' });
      pm.resetBankroll(alice.id, 10000);
      pm.resetBankroll(bob.id, 10000);

      // Alice borrows 2000 from Bob with 25% win deduction (total owed: 2000)
      const prop = bm.createLoanProposal({
        fromId: alice.id,
        toId: bob.id,
        type: 'borrow',
        amount: 2000,
        interestPct: 0,
        winDeductionPct: 25
      });
      assert.equal(prop.success, true);
      const accepted = bm.acceptProposal(prop.proposal.id, bob.id);
      assert.equal(accepted.success, true);
      const bobChipsAfterLend = bob.chips; // 8000

      activePokerEngine = new PokerEngine(pm, {
        bankManager: bm,
        tableId: 'poker_repay_test',
        smallBlind: 50,
        bigBlind: 100,
        minBuyIn: 2000,
        maxBuyIn: 10000,
        autoStart: false,
        allInInterval: 0
      });

      const sAlice = activePokerEngine.takeSeat(0, alice.id, 2000, { name: 'Alice' });
      const sBob = activePokerEngine.takeSeat(1, bob.id, 2000, { name: 'Bob' });
      assert.equal(sAlice.success, true);
      assert.equal(sBob.success, true);

      activePokerEngine.startNewHand();
      const firstSeat = activePokerEngine.activeTurn.seatIndex;
      const firstPlayerId = activePokerEngine.activeTurn.playerId;

      if (firstPlayerId === bob.id) {
        activePokerEngine.handleAction(firstSeat, bob.id, POKER_ACTIONS.FOLD);
      } else {
        activePokerEngine.handleAction(firstSeat, alice.id, POKER_ACTIONS.CALL);
        const nextSeat = activePokerEngine.activeTurn.seatIndex;
        activePokerEngine.handleAction(nextSeat, bob.id, POKER_ACTIONS.FOLD);
      }

      assert.equal(activePokerEngine.currentPhase, POKER_PHASES.HAND_END);
      const aliceStack = activePokerEngine.seats[0].stack;
      assert.ok(aliceStack > 2000, 'Alice must have net profit on her Poker stack');
      const netProfit = aliceStack - 2000;
      const expectedDeduction = Math.max(1, Math.floor(netProfit * 0.25));

      const vacatedEvents = [];
      activePokerEngine.on('seat_vacated', (ev) => vacatedEvents.push(ev));

      const aliceWalletBeforeLeave = alice.chips;
      const leaveRes = activePokerEngine.leaveSeat(0, alice.id);
      assert.equal(leaveRes.success, true);
      assert.equal(activePokerEngine.currentPhase, POKER_PHASES.WAITING_FOR_PLAYERS);
      assert.equal(leaveRes.cashoutAmount, aliceStack);
      assert.equal(leaveRes.repayments.length, 1);
      assert.equal(leaveRes.repayments[0].amount, expectedDeduction);
      assert.equal(vacatedEvents[0].repayments.length, 1);
      assert.equal(alice.chips, aliceWalletBeforeLeave + aliceStack - expectedDeduction);
      assert.equal(bob.chips, bobChipsAfterLend - 2000 + expectedDeduction);
    });
  });

  describe('5. Poker HUD Sync & ui.js Phase Mapping', () => {
    it('syncs Poker phase and timer to global UI HUD and maps every Poker phase in ui.js', () => {
      const uiJs = fs.readFileSync(path.join(clientDir, 'js', 'ui.js'), 'utf8');
      const pokerPhases = [
        'PRE_FLOP', 'FLOP_DEAL', 'FLOP', 'TURN_DEAL', 'TURN',
        'RIVER_DEAL', 'RIVER', 'SHOWDOWN', 'SETTLEMENT', 'HAND_END'
      ];
      for (const ph of pokerPhases) {
        assert.ok(uiJs.includes(`${ph}:`), `ui.js phaseMap must include ${ph}`);
      }

      global.document = {
        getElementById: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {}
      };

      const listeners = {};
      const phaseUpdates = [];
      const timerUpdates = [];
      let navLockCalls = 0;

      const poker = new CasinoPoker({
        network: {
          on: (ev, cb) => { listeners[ev] = cb; },
          emit: () => {}
        },
        ui: {
          myPlayer: { id: 'hero', chips: 5000 },
          updatePhase: (phase, dur, left) => phaseUpdates.push({ phase, dur, left }),
          updateTimer: (left) => timerUpdates.push(left),
          setNavigationLocked: () => {},
          showToast: () => {}
        },
        onBetStateChange: () => { navLockCalls += 1; }
      });

      // Mock active DOM viewPoker without full DOM
      poker.elements.viewPoker = { classList: { contains: () => false } };
      poker.elements.communitySlots = [];
      poker.renderCommunityCards = () => {};
      poker.renderSeat = () => {};
      poker.renderActionControls = () => {};

      poker.onViewActivated();
      assert.ok(phaseUpdates.some((u) => u.phase === 'WAITING_FOR_PLAYERS'));
      assert.ok(navLockCalls >= 1);

      poker.onTableState({
        tableId: 'poker_1',
        currentPhase: 'PRE_FLOP',
        turnDuration: 30,
        pot: 150,
        seats: []
      });
      assert.equal(phaseUpdates[phaseUpdates.length - 1].phase, 'PRE_FLOP');

      poker.onPhaseChange({ tableId: 'poker_1', phase: 'FLOP', pot: 300, communityCards: [] });
      assert.equal(phaseUpdates[phaseUpdates.length - 1].phase, 'FLOP');

      poker.onPhaseTick({ tableId: 'poker_1', turnTimeLeft: 17 });
      assert.equal(timerUpdates[timerUpdates.length - 1], 17);
    });
  });

  describe('6. Bank UI Text, Dead Refs Cleanup & Escape Key', () => {
    it('updates debt copy to casinowinst, drops dead bailout DOM refs, and closes modal on Escape', () => {
      const bankJs = fs.readFileSync(path.join(clientDir, 'js', 'bank.js'), 'utf8');
      assert.ok(!bankJs.includes('roulettewinst'));
      assert.ok(!bankJs.includes('bailout-timer-val'));
      assert.ok(!bankJs.includes('bailout-reason-text'));
      assert.ok(!bankJs.includes('btn-claim-bailout'));
      assert.ok(bankJs.includes('van elke casinowinst.'));

      // Simulate minimal DOM + Escape key press closing Bank modal
      const docListeners = {};
      const modalSet = new Set(); // empty => open (no 'hidden')
      const modalClassList = {
        contains: (cls) => modalSet.has(cls),
        add: (cls) => modalSet.add(cls),
        remove: (cls) => modalSet.delete(cls)
      };
      global.document = {
        getElementById: (id) => (id === 'bank-modal' ? { classList: modalClassList, addEventListener: () => {} } : null),
        querySelectorAll: () => [],
        addEventListener: (ev, cb) => { docListeners[ev] = cb; }
      };

      const bank = new CasinoBank({
        network: { myPlayerId: 'p1', getBankState: () => {}, saveClientBackup: () => {} },
        ui: { myPlayer: { id: 'p1', chips: 5000 } }
      });

      assert.equal(typeof docListeners.keydown, 'function');
      docListeners.keydown({ key: 'Escape' });
      assert.equal(modalSet.has('hidden'), true);
    });
  });

  describe('7. Slots onViewDeactivated Hold Flush', () => {
    it('releases pendingPayoutHold and updates HUD when switching away mid-spin', () => {
      let hudAnimatedArg = null;
      let hudCalls = 0;
      const slots = new CasinoSlots({
        network: { on: () => {} },
        ui: {
          updatePlayerHUD: (anim) => {
            hudCalls += 1;
            hudAnimatedArg = anim;
          },
          updatePhase: () => {}
        }
      });

      slots.viewActive = true;
      slots.pendingPayoutHold = 2500;
      slots.payoutReleases = [{ id: 'spin_1', amount: 2500, released: false }];

      slots.onViewDeactivated();

      assert.equal(slots.viewActive, false);
      assert.equal(slots.pendingPayoutHold, 0);
      assert.equal(slots.payoutReleases.length, 0);
      assert.equal(hudCalls, 1);
      assert.equal(hudAnimatedArg, false);
    });
  });

  describe('8. CasinoUI / CasinoNetwork Method Contract Completeness', () => {
    it('defines hideBlackjackBanner and getMonogram on CasinoUI with zero dangling ui.* or network.* method calls', () => {
      const jsDir = path.join(clientDir, 'js');
      const getMethods = (file) => {
        const src = fs.readFileSync(path.join(jsDir, file), 'utf8');
        const set = new Set();
        for (const m of src.matchAll(/^\s{4}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/gm)) {
          set.add(m[1]);
        }
        return set;
      };

      const uiMethods = getMethods('ui.js');
      const netMethods = getMethods('network.js');

      assert.equal(uiMethods.has('hideBlackjackBanner'), true);
      assert.equal(uiMethods.has('getMonogram'), true);

      const files = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js'));
      const missingUi = [];
      const missingNet = [];
      for (const f of files) {
        const src = fs.readFileSync(path.join(jsDir, f), 'utf8');
        for (const m of src.matchAll(/\b(?:this\.)?ui\.([A-Za-z_$][\w$]*)\s*\(/g)) {
          if (!uiMethods.has(m[1])) missingUi.push(`${f}:${m[1]}`);
        }
        for (const m of src.matchAll(/\b(?:this\.)?network\.([A-Za-z_$][\w$]*)\s*\(/g)) {
          if (!netMethods.has(m[1])) missingNet.push(`${f}:${m[1]}`);
        }
      }

      assert.deepEqual(missingUi, []);
      assert.deepEqual(missingNet, []);
    });
  });
});
