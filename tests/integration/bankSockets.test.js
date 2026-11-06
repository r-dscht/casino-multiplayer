/**
 * bankSockets.test.js
 * Integration tests for Casino Bank & Loans WebSocket events.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { io: Client } = require('socket.io-client');

const app = require('../../server/app');
const { setupSocket } = require('../../server/socket');

describe('Casino Bank & Loans Socket Integration', () => {
  let server;
  let socketHandler;
  let serverPort;
  let client1;
  let client2;
  let p1Data;
  let p2Data;

  before(async () => {
    server = http.createServer(app);
    socketHandler = setupSocket(server);

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port;
        resolve();
      });
    });

    // Connect Client 1
    client1 = Client(`http://127.0.0.1:${serverPort}`, {
      transports: ['websocket'],
      forceNew: true
    });
    await new Promise(r => client1.on('connect', r));

    // Connect Client 2
    client2 = Client(`http://127.0.0.1:${serverPort}`, {
      transports: ['websocket'],
      forceNew: true
    });
    await new Promise(r => client2.on('connect', r));

    // Join table Client 1
    const p1Join = new Promise(resolve => client1.once('table_state', resolve));
    client1.emit('join_table', { name: 'PlayerOne', color: '#10b981' });
    const s1 = await p1Join;
    p1Data = s1.players.find(p => p.name === 'PlayerOne');

    // Join table Client 2
    const p2Join = new Promise(resolve => client2.once('table_state', resolve));
    client2.emit('join_table', { name: 'PlayerTwo', color: '#3b82f6' });
    const s2 = await p2Join;
    p2Data = s2.players.find(p => p.name === 'PlayerTwo');
  });

  after(async () => {
    if (client1 && client1.connected) client1.disconnect();
    if (client2 && client2.connected) client2.disconnect();

    if (socketHandler && socketHandler.engine) {
      socketHandler.engine.stop();
    }
    if (socketHandler && socketHandler.io) {
      await new Promise(resolve => socketHandler.io.close(resolve));
    }
    await new Promise(resolve => server.close(resolve));
  });

  it('should transfer chips directly between players via bank_transfer', async () => {
    const p2ChipsUpdatePromise = new Promise(resolve => {
      client2.once('chips_update', resolve);
    });
    const p1SuccessPromise = new Promise(resolve => {
      client1.once('bank_success', resolve);
    });

    client1.emit('bank_transfer', {
      toPlayerId: p2Data.id,
      amount: 1200
    });

    const [p2Chips, p1Success] = await Promise.all([p2ChipsUpdatePromise, p1SuccessPromise]);
    assert.equal(p2Chips.chips, 11200);
    assert.match(p1Success.message, /1.?200 fiches overgemaakt/i);
  });

  it('should negotiate and accept a loan proposal over WebSocket', async () => {
    // Player 1 proposes a borrow request to Player 2 for 2,000 chips with 10% interest
    const p2BankUpdatePromise = new Promise(resolve => {
      client2.once('bank_update', resolve);
    });

    client1.emit('bank_loan_propose', {
      toPlayerId: p2Data.id,
      type: 'borrow',
      amount: 2000,
      interestPct: 10,
      winDeductionPct: 15
    });

    const p2BankData = await p2BankUpdatePromise;
    assert.ok(p2BankData.incomingProposals.length >= 1);
    const prop = p2BankData.incomingProposals[0];
    assert.equal(prop.amount, 2000);
    assert.equal(prop.totalOwed, 2200);

    // Player 2 accepts the loan proposal
    const p1LoanReceivedPromise = new Promise(resolve => {
      client1.once('bank_update', resolve);
    });

    client2.emit('bank_loan_respond', {
      proposalId: prop.id,
      action: 'accept'
    });

    const p1NewBankData = await p1LoanReceivedPromise;
    assert.ok(p1NewBankData.activeDebts.length >= 1);
    const debt = p1NewBankData.activeDebts[0];
    assert.equal(debt.totalOwed, 2200);
    assert.equal(debt.amountRepaid, 0);
  });

  it('should repay part of an active debt via bank_repay_debt', async () => {
    // Player 1 gets active debts
    const getBank = new Promise(resolve => client1.once('bank_update', resolve));
    client1.emit('bank_get_state');
    const bankState = await getBank;

    assert.ok(bankState.activeDebts.length > 0);
    const loanId = bankState.activeDebts[0].id;

    const repayPromise = new Promise(resolve => {
      client1.once('bank_success', resolve);
    });

    client1.emit('bank_repay_debt', {
      loanId,
      amount: 500
    });

    const repayRes = await repayPromise;
    assert.match(repayRes.message, /500 fiches afgelost/i);
  });

  it('should claim emergency bailout when chips drop below 10', async () => {
    // Reset Player 1 chips to 0 for test
    const p1 = socketHandler.playerManager.getPlayerById(p1Data.id);
    p1.chips = 0;

    const claimPromise = new Promise(resolve => {
      client1.once('bank_bailout_claimed', resolve);
    });

    client1.emit('bank_claim_bailout');
    const claimRes = await claimPromise;
    assert.equal(claimRes.amount, 100);
    assert.equal(claimRes.chips, 100);
  });
});
