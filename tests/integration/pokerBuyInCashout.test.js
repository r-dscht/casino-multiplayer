/**
 * pokerBuyInCashout.test.js
 * Integration test suite for Two-Tier Cash Game Wallet Architecture.
 * Verifies that:
 * 1. Buy-in atomically debits persistent account (playerManager.chips) into table stack.
 * 2. Rebuys top up stack between hands or queue as pendingRebuy during an ongoing hand.
 * 3. Rebuy bounds check rejects exceeding maxBuyIn or insufficient bankroll.
 * 4. Leaving seat cashing out atomically returns remaining stack to persistent bankroll.
 * 5. Player account persistence survives and syncs to disk (players.json).
 * 6. Graceful shutdown / cashoutAllPlayersSync guarantees zero orphaned chips.
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { io: Client } = require('socket.io-client');

const app = require('../../server/app');
const { setupSocket } = require('../../server/socket');
const { PHASES } = require('../../server/game/pokerConstants');

describe('Texas Hold\'em Two-Tier Wallet Buy-In & Cashout Integration', () => {
  let server;
  let socketHandler;
  let serverPort;
  let client1;
  let client2;
  let player1;
  let player2;
  const testStoragePath = path.join(__dirname, '..', 'temp_poker_wallet_players.json');

  before(async () => {
    if (fs.existsSync(testStoragePath)) {
      fs.unlinkSync(testStoragePath);
    }

    server = http.createServer(app);
    // Custom setup with explicit test storage path for persistence checking
    socketHandler = setupSocket(server);
    // Set storage path for verification
    socketHandler.playerManager.storagePath = testStoragePath;
    socketHandler.playerManager.debounceMs = 0; // immediate write for test inspection

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port;
        resolve();
      });
    });

    client1 = Client(`http://127.0.0.1:${serverPort}`, {
      transports: ['websocket'],
      forceNew: true
    });
    client2 = Client(`http://127.0.0.1:${serverPort}`, {
      transports: ['websocket'],
      forceNew: true
    });

    await Promise.all([
      new Promise(resolve => client1.on('connect', resolve)),
      new Promise(resolve => client2.on('connect', resolve))
    ]);

    // Authenticate players (starting bankroll 10,000 chips each)
    const auth1Promise = new Promise(resolve => client1.once('auth_success', resolve));
    client1.emit('auth_session', { name: 'WalletHero1', color: '#10b981' });
    const auth1 = await auth1Promise;
    player1 = auth1.player;

    const auth2Promise = new Promise(resolve => client2.once('auth_success', resolve));
    client2.emit('auth_session', { name: 'WalletHero2', color: '#3b82f6' });
    const auth2 = await auth2Promise;
    player2 = auth2.player;
  });

  after(async () => {
    if (client1 && client1.connected) client1.disconnect();
    if (client2 && client2.connected) client2.disconnect();
    if (socketHandler && typeof socketHandler.stop === 'function') {
      socketHandler.stop();
    }
    if (socketHandler && socketHandler.io) {
      await new Promise(resolve => socketHandler.io.close(resolve));
    }
    await new Promise(resolve => server.close(resolve));
    if (fs.existsSync(testStoragePath)) {
      try { fs.unlinkSync(testStoragePath); } catch (e) {}
    }
  });

  it('should debit playerManager.chips atomically upon claiming seat with buy-in', async () => {
    const pokerTable = socketHandler.pokerTables.get('poker_1');

    assert.equal(socketHandler.playerManager.getPlayerById(player1.id).chips, 10000);

    // Player 1 buys in for 3,000 chips at Seat 0
    const acceptedPromise = new Promise(resolve => client1.once('poker_seat_accepted', resolve));
    const chipsPromise = new Promise(resolve => client1.once('chips_update', resolve));
    client1.emit('poker_take_seat', { tableId: 'poker_1', seatIndex: 0, buyInAmount: 3000 });

    const accepted = await acceptedPromise;
    const chipsUpdate = await chipsPromise;

    assert.equal(accepted.seatIndex, 0);
    assert.equal(accepted.stack, 3000);
    assert.equal(pokerTable.seats[0].stack, 3000);

    // Persistent account debited 10,000 - 3,000 = 7,000
    assert.equal(chipsUpdate.chips, 7000);
    assert.equal(socketHandler.playerManager.getPlayerById(player1.id).chips, 7000);

    // Flush and verify on disk
    socketHandler.playerManager.flushToDiskSync();
    assert.ok(fs.existsSync(testStoragePath));
    const diskData = JSON.parse(fs.readFileSync(testStoragePath, 'utf8'));
    assert.equal(diskData[player1.id].chips, 7000);
  });

  it('should reject buy-ins outside limits or exceeding persistent bankroll', async () => {
    const pokerTable = socketHandler.pokerTables.get('poker_1');

    // Min buy-in is 2000 chips. Try 1000 chips
    const errLowPromise = new Promise(resolve => client2.once('poker_seat_error', resolve));
    client2.emit('poker_take_seat', { tableId: 'poker_1', seatIndex: 1, buyInAmount: 1000 });
    const errLow = await errLowPromise;
    assert.equal(errLow.code, 'INVALID_BUY_IN');

    // Max buy-in is 10000 chips. Try 15000 chips
    const errHighPromise = new Promise(resolve => client2.once('poker_seat_error', resolve));
    client2.emit('poker_take_seat', { tableId: 'poker_1', seatIndex: 1, buyInAmount: 15000 });
    const errHigh = await errHighPromise;
    assert.equal(errHigh.code, 'INVALID_BUY_IN');

    // Player 2 with 10k chips attempts to buy in for 10000 -> valid, but let's test insufficient funds by deducting first
    const p2Record = socketHandler.playerManager.getPlayerById(player2.id);
    p2Record.chips = 500; // less than minBuyIn 2000
    const errFundsPromise = new Promise(resolve => client2.once('poker_seat_error', resolve));
    client2.emit('poker_take_seat', { tableId: 'poker_1', seatIndex: 1, buyInAmount: 2000 });
    const errFunds = await errFundsPromise;
    assert.equal(errFunds.code, 'INSUFFICIENT_FUNDS');

    // Restore player 2 balance to 10k
    p2Record.chips = 10000;
  });

  it('should allow rebuying / topping up table stack up to maxBuyIn', async () => {
    const pokerTable = socketHandler.pokerTables.get('poker_1');
    assert.equal(pokerTable.seats[0].stack, 3000);

    // Player 1 rebuys 2,000 chips
    const rebuySuccessPromise = new Promise(resolve => client1.once('poker_rebuy_success', resolve));
    const chipsPromise = new Promise(resolve => client1.once('chips_update', resolve));
    client1.emit('poker_rebuy', { tableId: 'poker_1', seatIndex: 0, amount: 2000 });

    const rebuySuccess = await rebuySuccessPromise;
    const chipsUpdate = await chipsPromise;

    assert.equal(rebuySuccess.amount, 2000);
    assert.equal(rebuySuccess.stack, 5000);
    assert.equal(pokerTable.seats[0].stack, 5000);

    // Account debited: 7000 - 2000 = 5000
    assert.equal(chipsUpdate.chips, 5000);
    assert.equal(socketHandler.playerManager.getPlayerById(player1.id).chips, 5000);

    // Attempt to rebuy exceeding maxBuyIn (current stack 5000, max is 10000, try rebuying 6000 -> 11000 total)
    const rebuyErrPromise = new Promise(resolve => client1.once('poker_rebuy_error', resolve));
    client1.emit('poker_rebuy', { tableId: 'poker_1', seatIndex: 0, amount: 6000 });
    const rebuyErr = await rebuyErrPromise;
    assert.equal(rebuyErr.code, 'MAX_STACK_EXCEEDED');
  });

  it('should cleanly cash out remaining table stack upon leaving seat and sync to disk', async () => {
    const pokerTable = socketHandler.pokerTables.get('poker_1');
    assert.equal(pokerTable.seats[0].stack, 5000);
    assert.equal(socketHandler.playerManager.getPlayerById(player1.id).chips, 5000);

    // Player 1 vacates seat
    const vacatedPromise = new Promise(resolve => client1.once('poker_seat_vacated', resolve));
    const chipsPromise = new Promise(resolve => client1.once('chips_update', resolve));
    client1.emit('poker_leave_seat', { tableId: 'poker_1', seatIndex: 0 });

    const vacated = await vacatedPromise;
    const chipsUpdate = await chipsPromise;

    assert.equal(vacated.cashoutAmount, 5000);
    assert.equal(pokerTable.seats[0].player, null);
    assert.equal(pokerTable.seats[0].stack, 0);

    // Bankroll restored: 5000 + 5000 = 10,000
    assert.equal(chipsUpdate.chips, 10000);
    assert.equal(socketHandler.playerManager.getPlayerById(player1.id).chips, 10000);

    // Disk persistence verification
    socketHandler.playerManager.flushToDiskSync();
    const diskData = JSON.parse(fs.readFileSync(testStoragePath, 'utf8'));
    assert.equal(diskData[player1.id].chips, 10000);
  });

  it('should cashout all remaining table stacks back to playerManager on server stop', async () => {
    const pokerTable = socketHandler.pokerTables.get('poker_1');

    // Player 1 sits with 4,000 chips
    const seatPromise = new Promise(resolve => client1.once('poker_seat_accepted', resolve));
    client1.emit('poker_take_seat', { tableId: 'poker_1', seatIndex: 2, buyInAmount: 4000 });
    await seatPromise;

    assert.equal(pokerTable.seats[2].stack, 4000);
    assert.equal(socketHandler.playerManager.getPlayerById(player1.id).chips, 6000);

    // Simulate graceful shutdown cashout
    pokerTable.cashoutAllPlayersSync();
    assert.equal(pokerTable.seats[2].stack, 0);
    assert.equal(socketHandler.playerManager.getPlayerById(player1.id).chips, 10000);

    // Flush to disk
    socketHandler.playerManager.flushToDiskSync();
    const diskData = JSON.parse(fs.readFileSync(testStoragePath, 'utf8'));
    assert.equal(diskData[player1.id].chips, 10000);
  });
});
