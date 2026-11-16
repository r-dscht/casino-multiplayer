const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { io: ioClient } = require('socket.io-client');

process.env.NODE_ENV = 'test';

const app = require('../../server/app');
const { setupSocket } = require('../../server/socket');

function makeMockElement(id = '') {
  const classes = new Set();
  const children = [];
  const style = {};
  const attrs = new Map();
  const listeners = new Map();
  const el = {
    id,
    textContent: '',
    innerHTML: '',
    value: '',
    disabled: false,
    dataset: {},
    style,
    children,
    options: [],
    width: 640,
    height: 320,
    parentNode: null,
    classList: {
      add: (...names) => names.forEach((n) => classes.add(n)),
      remove: (...names) => names.forEach((n) => classes.delete(n)),
      toggle: (name, force) => {
        if (force === true) classes.add(name);
        else if (force === false) classes.delete(name);
        else if (classes.has(name)) classes.delete(name);
        else classes.add(name);
      },
      contains: (name) => classes.has(name)
    },
    set className(val) {
      classes.clear();
      String(val || '').split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
    },
    get className() {
      return Array.from(classes).join(' ');
    },
    appendChild(child) {
      child.parentNode = el;
      children.push(child);
      return child;
    },
    removeChild(child) {
      const idx = children.indexOf(child);
      if (idx >= 0) children.splice(idx, 1);
      child.parentNode = null;
      return child;
    },
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener(evt, fn) {
      if (!listeners.has(evt)) listeners.set(evt, []);
      listeners.get(evt).push(fn);
    },
    getAttribute: (k) => attrs.get(k) || null,
    setAttribute: (k, v) => attrs.set(k, String(v)),
    getBoundingClientRect: () => ({ width: 640, height: 320, left: 0, top: 0 }),
    getContext: () => ({
      clearRect() {}, save() {}, restore() {}, beginPath() {}, closePath() {},
      moveTo() {}, lineTo() {}, arc() {}, fill() {}, stroke() {}, fillText() {},
      fillRect() {}, strokeRect() {}, scale() {}, translate() {}, createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }), roundRect() {}, rect() {}
    }),
    scrollTo() {},
    focus() {}
  };
  return el;
}

function createBrowserSandbox({ withLocalStorage = false } = {}) {
  const elements = new Map();
  const getEl = (id) => {
    if (!elements.has(id)) elements.set(id, makeMockElement(id));
    return elements.get(id);
  };

  const mockSockets = [];
  const emittedByClient = [];

  const mockIo = () => {
    const serverListeners = new Map();
    const sock = {
      id: `mock_sock_${mockSockets.length + 1}`,
      on(evt, fn) {
        if (!serverListeners.has(evt)) serverListeners.set(evt, []);
        serverListeners.get(evt).push(fn);
      },
      emit(evt, payload) {
        emittedByClient.push({ event: evt, payload });
      },
      disconnect() {},
      _trigger(evt, payload) {
        const list = serverListeners.get(evt) || [];
        list.forEach((fn) => fn(payload));
      }
    };
    mockSockets.push(sock);
    return sock;
  };

  const storageMap = new Map();
  const localStorageObj = withLocalStorage ? {
    getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: (k) => storageMap.delete(k)
  } : undefined;

  const sandboxWindow = {
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: 1,
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    io: mockIo,
    location: { protocol: 'http:', host: 'localhost:3000', origin: 'http://localhost:3000' }
  };
  if (withLocalStorage) {
    sandboxWindow.localStorage = localStorageObj;
  }
  sandboxWindow.window = sandboxWindow;

  const sandbox = {
    window: sandboxWindow,
    self: sandboxWindow,
    globalThis: sandboxWindow,
    io: mockIo,
    console,
    Date,
    Math,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    Promise,
    Error,
    performance: { now: () => Date.now() },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    document: {
      getElementById: (id) => getEl(id),
      querySelectorAll: () => [],
      querySelector: () => null,
      createElement: (tag) => makeMockElement(tag),
      addEventListener() {}
    }
  };
  if (withLocalStorage) {
    sandbox.localStorage = localStorageObj;
  }

  vm.createContext(sandbox);
  for (const rel of ['client/js/network.js', 'client/js/ui.js', 'client/js/racing.js', 'client/js/slots.js', 'client/js/plinko.js']) {
    const src = fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');
    vm.runInContext(src, sandbox, { filename: rel });
  }

  return { sandbox, sandboxWindow, elements, getEl, mockSockets, emittedByClient };
}

function waitForEvent(socket, eventName, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${eventName}`)), timeoutMs);
    socket.once(eventName, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

test('Integration: multi-tab sockets stay authenticated and propagate session_required cleanly', async (t) => {
  const server = http.createServer(app);
  const socketHandler = setupSocket(server);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const url = `http://localhost:${port}`;
  const openSockets = [];

  t.after(async () => {
    openSockets.forEach((s) => {
      try { s.disconnect(); } catch (e) {}
    });
    if (socketHandler && typeof socketHandler.stop === 'function') {
      socketHandler.stop();
    }
    if (socketHandler && socketHandler.io) {
      await new Promise((resolve) => socketHandler.io.close(resolve));
    }
    await new Promise((resolve) => server.close(resolve));
  });

  // 1. Unauthenticated socket requesting player_set_game/location receives session_required (PLAYER_NOT_FOUND)
  const guestSocket = ioClient(url, { transports: ['websocket'] });
  openSockets.push(guestSocket);
  await waitForEvent(guestSocket, 'connect');

  const reqGamePromise = waitForEvent(guestSocket, 'session_required');
  guestSocket.emit('player_set_game', { game: 'SLOTS' });
  const reqGame = await reqGamePromise;
  assert.equal(reqGame.code, 'PLAYER_NOT_FOUND');

  const reqLocPromise = waitForEvent(guestSocket, 'session_required');
  guestSocket.emit('player_set_location', { location: 'LOBBY' });
  const reqLoc = await reqLocPromise;
  assert.equal(reqLoc.code, 'PLAYER_NOT_FOUND');

  const cheerRejPromise = waitForEvent(guestSocket, 'racing_cheer_rejected');
  guestSocket.emit('racing_cheer', { horseId: 1 });
  const cheerRej = await cheerRejPromise;
  assert.equal(cheerRej.code, 'PLAYER_NOT_FOUND');
  guestSocket.disconnect();

  // 2. Open Tab 1 and log in
  const tab1 = ioClient(url, { transports: ['websocket'] });
  openSockets.push(tab1);
  await waitForEvent(tab1, 'connect');

  const tab1AuthPromise = waitForEvent(tab1, 'auth_success');
  tab1.emit('join_table', { name: 'MultiTabAce', color: '#d4af37', password: 'secret' });
  const tab1Auth = await tab1AuthPromise;
  assert.ok(tab1Auth.sessionToken);
  const token = tab1Auth.sessionToken;
  const playerId = tab1Auth.player.id;

  // 3. Open Tab 2 using same sessionToken — must NOT evict Tab 1
  const tab2 = ioClient(url, { transports: ['websocket'] });
  openSockets.push(tab2);
  await waitForEvent(tab2, 'connect');

  const tab2AuthPromise = waitForEvent(tab2, 'auth_success');
  tab2.emit('auth_session', { sessionToken: token, name: 'MultiTabAce' });
  const tab2Auth = await tab2AuthPromise;
  assert.equal(tab2Auth.player.id, playerId);

  // 4. Both Tab 1 and Tab 2 can spin Slots and sync chips_update concurrently without PLAYER_NOT_FOUND
  let tab1Rejected = false;
  tab1.on('slots_spin_rejected', (err) => {
    if (err && err.code === 'PLAYER_NOT_FOUND') tab1Rejected = true;
  });
  let tab2Rejected = false;
  tab2.on('slots_spin_rejected', (err) => {
    if (err && err.code === 'PLAYER_NOT_FOUND') tab2Rejected = true;
  });

  const tab1SpinResult = waitForEvent(tab1, 'slots_spin_result');
  const tab2ChipsUpdate = waitForEvent(tab2, 'chips_update');
  tab1.emit('slots_spin', { bet: 20, machineId: 1 });
  const spinRes = await tab1SpinResult;
  const tab2Chips = await tab2ChipsUpdate;
  assert.equal(spinRes.ok, true);
  assert.equal(tab2Chips.chips, spinRes.newChips);
  assert.equal(tab1Rejected, false);

  const tab2PlinkoDrop = waitForEvent(tab2, 'plinko_ball_dropped');
  tab2.emit('plinko_drop', { amount: 10, rows: 12, risk: 'low', count: 1 });
  const plinkoRes = await tab2PlinkoDrop;
  assert.equal(plinkoRes.drops.length, 1);
  assert.equal(tab2Rejected, false);

  // 5. Close Tab 2; Tab 1 MUST remain connected & authenticated (disconnectPlayer only drops tab2)
  tab2.disconnect();
  await new Promise((r) => setTimeout(r, 80));
  const playerRecord = socketHandler.playerManager.getPlayerById(playerId);
  assert.equal(playerRecord.connected, true);

  const tab1PresenceUpdate = waitForEvent(tab1, 'game_switched');
  tab1.emit('player_set_game', { game: 'RACING' });
  const switched = await tab1PresenceUpdate;
  assert.equal(switched.game, 'Racing');

  const tab1SpinAfterTab2Close = waitForEvent(tab1, 'slots_spin_result');
  tab1.emit('slots_spin', { bet: 20, machineId: 1 });
  const spinAfter = await tab1SpinAfterTab2Close;
  assert.equal(spinAfter.ok, true);
});

test('Unit: CasinoNetwork auto-reauthenticates from _lastAuthPayload on PLAYER_NOT_FOUND without localStorage', () => {
  const { sandboxWindow, mockSockets, emittedByClient } = createBrowserSandbox({ withLocalStorage: false });
  const network = new sandboxWindow.CasinoNetwork();
  network.connect();
  const sock = mockSockets[0];

  // Authenticate once without localStorage
  network.joinTable({ name: 'MemOnly', color: '#e63946', password: 'pw1' });
  sock._trigger('connect');
  sock._trigger('auth_success', {
    sessionToken: 'tok_mem_123',
    player: { id: 'ply_mem', name: 'MemOnly', chips: 1000, color: '#e63946' }
  });
  assert.equal(network.isAuthenticated, true);

  emittedByClient.length = 0;

  // Simulate delayed PLAYER_NOT_FOUND rejection -> must emit auth_session from _lastAuthPayload
  sock._trigger('slots_spin_rejected', { code: 'PLAYER_NOT_FOUND', reason: 'Log eerst in' });
  const reauthEmit = emittedByClient.find((e) => e.event === 'auth_session');
  assert.ok(reauthEmit, 'Expected auth_session re-emit after PLAYER_NOT_FOUND');
  assert.equal(reauthEmit.payload.sessionToken, 'tok_mem_123');
  assert.equal(reauthEmit.payload.name, 'MemOnly');

  // Unauthenticated visitor without any token/name must trigger session_lost and NOT auth_session
  const { sandboxWindow: w2, mockSockets: m2, emittedByClient: e2 } = createBrowserSandbox({ withLocalStorage: false });
  const guestNet = new w2.CasinoNetwork();
  guestNet.connect();
  let lostFired = false;
  guestNet.on('session_lost', () => { lostFired = true; });
  m2[0]._trigger('connect');
  e2.length = 0;
  m2[0]._trigger('session_required', { code: 'PLAYER_NOT_FOUND' });
  assert.equal(lostFired, true);
  assert.equal(e2.some((e) => e.event === 'auth_session'), false);
});

test('Unit: Racing, Slots, Plinko, and UI phase headers & nav lock reflect live game status cleanly', () => {
  const { sandboxWindow, getEl } = createBrowserSandbox({ withLocalStorage: true });
  const ui = new sandboxWindow.CasinoUI();
  ui.elements.phaseTitle = getEl('phase-title');
  ui.elements.phaseTimer = getEl('phase-timer');
  ui.elements.toastContainer = getEl('toast-container');
  ui.elements.gamePills = [];

  const mockNet = {
    _handlers: new Map(),
    on(evt, fn) {
      if (!this._handlers.has(evt)) this._handlers.set(evt, []);
      this._handlers.get(evt).push(fn);
    },
    emitServer(evt, payload) {
      (this._handlers.get(evt) || []).forEach((fn) => fn(payload));
    },
    hasStoredCredentials: () => false
  };

  const racing = new sandboxWindow.CasinoRacing({ network: mockNet, ui });
  racing._bindNetworkEvents();

  // Apply WAITING_FOR_BETS (smart multiplayer clock pauses at KLAAR until 1st bet)
  racing.viewActive = true;
  racing.applyState({
    phase: 'WAITING_FOR_BETS',
    bettingDuration: 18,
    timeLeft: 18,
    horses: [{ horseId: 1, name: 'Comet', odds: 5.5, laneProgress: 0, cheers: 0 }],
    myTickets: []
  });
  assert.equal(ui.elements.phaseTitle.textContent, 'KLAAR VOOR RACE');
  assert.equal(ui.elements.phaseTimer.textContent, 'KLAAR');
  assert.equal(ui.isNavigationLocked, false);

  // Active BETTING phase shows INZETTEN + live remaining seconds (NOT frozen 18s)
  racing.applyState({
    phase: 'BETTING',
    bettingDuration: 18,
    timeLeft: 11,
    horses: [{ horseId: 1, name: 'Comet', odds: 5.5, laneProgress: 0, cheers: 0 }],
    myTickets: [{ ticketId: 't1', horseId: 1, amount: 50 }]
  });
  assert.equal(ui.elements.phaseTitle.textContent, 'INZETTEN');
  assert.equal(ui.elements.phaseTimer.textContent, '11s');
  assert.equal(ui.isNavigationLocked, true);

  // Ticking down must update phaseTimer to live seconds
  mockNet.emitServer('racing_phase_tick', { phase: 'BETTING', timeLeft: 7 });
  assert.equal(ui.elements.phaseTimer.textContent, '7s');

  // Race starts -> RACE BEZIG / LIVE
  mockNet.emitServer('racing_phase_change', { phase: 'RACING', timeLeft: 0 });
  assert.equal(ui.elements.phaseTitle.textContent, 'RACE BEZIG');
  assert.equal(ui.elements.phaseTimer.textContent, 'LIVE');

  // Race finishes -> UITSLAG & nav unlocks
  mockNet.emitServer('racing_finished', {
    raceId: 2,
    winnerHorseId: 1,
    winnerName: 'Comet',
    winnerSilk: '#d4af37',
    podium: [1],
    isPhotoFinish: false,
    marginMs: 120
  });
  assert.equal(ui.elements.phaseTitle.textContent, 'UITSLAG');
  assert.equal(ui.isNavigationLocked, false);

  // Slots live status transitions
  const slots = new sandboxWindow.CasinoSlots({ network: mockNet, ui });
  slots._bindNetworkEvents();
  slots.onViewActivated();
  assert.equal(ui.elements.phaseTitle.textContent, 'SLOTS ACTIEF');
  assert.equal(ui.elements.phaseTimer.textContent, 'LIVE');

  slots.freeSpins = { freeSpinsRemaining: 6, lockedBet: 100, totalBonusWin: 400 };
  slots._syncHeaderPhase();
  assert.equal(ui.elements.phaseTitle.textContent, 'GRATIS SPINS');
  assert.equal(ui.elements.phaseTimer.textContent, '6 SPINS');

  slots.goldenFever = { active: true, endsAt: Date.now() + 14200, durationMs: 30000, progress: 100 };
  slots._syncHeaderPhase();
  assert.equal(ui.elements.phaseTitle.textContent, 'GOLDEN FEVER');
  assert.equal(ui.elements.phaseTimer.textContent, '15s');

  // Plinko status header
  const plinko = new sandboxWindow.CasinoPlinko({ network: mockNet, ui });
  plinko.onViewActivated();
  assert.equal(ui.elements.phaseTitle.textContent, 'PLINKO KLAAR');
  assert.equal(ui.elements.phaseTimer.textContent, 'LIVE');
});
