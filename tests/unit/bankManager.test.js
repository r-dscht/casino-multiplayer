/**
 * bankManager.test.js
 * Unit tests for P2P Casino Bank, Loans and Bailout system.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const PlayerManager = require('../../server/game/playerManager');
const BankManager = require('../../server/game/bankManager');

describe('BankManager Unit Tests', () => {
  let playerManager;
  let bankManager;
  let player1;
  let player2;

  beforeEach(() => {
    playerManager = new PlayerManager({ storagePath: false });
    bankManager = new BankManager(playerManager, { storagePath: false });

    player1 = playerManager.registerPlayer('socket_1', { name: 'Alice', color: '#10b981' });
    player2 = playerManager.registerPlayer('socket_2', { name: 'Bob', color: '#3b82f6' });

    // Ensure known starting balances
    playerManager.resetBankroll(player1.id, 10000);
    playerManager.resetBankroll(player2.id, 10000);
  });

  describe('Direct Chip Transfers', () => {
    it('should successfully transfer chips from player1 to player2', () => {
      const res = bankManager.directTransfer(player1.id, player2.id, 1500);
      assert.equal(res.success, true);
      assert.equal(player1.chips, 8500);
      assert.equal(player2.chips, 11500);
      assert.equal(res.transaction.amount, 1500);
      assert.equal(res.transaction.fromName, 'Alice');
      assert.equal(res.transaction.toName, 'Bob');
    });

    it('should reject transferring chips to oneself', () => {
      const res = bankManager.directTransfer(player1.id, player1.id, 500);
      assert.equal(res.success, false);
      assert.match(res.reason, /jezelf/i);
    });

    it('should reject transfer when sender has insufficient chips', () => {
      const res = bankManager.directTransfer(player1.id, player2.id, 15000);
      assert.equal(res.success, false);
      assert.match(res.reason, /Onvoldoende/i);
      assert.equal(player1.chips, 10000);
      assert.equal(player2.chips, 10000);
    });

    it('should reject non-positive or non-integer amounts', () => {
      assert.equal(bankManager.directTransfer(player1.id, player2.id, 0).success, false);
      assert.equal(bankManager.directTransfer(player1.id, player2.id, -100).success, false);
      assert.equal(bankManager.directTransfer(player1.id, player2.id, 'abc').success, false);
    });
  });

  describe('Loan Proposals (Borrow & Lend)', () => {
    it('should create a borrow proposal where Alice asks to borrow from Bob', () => {
      const res = bankManager.createLoanProposal({
        fromId: player1.id,
        toId: player2.id,
        type: 'borrow',
        amount: 2000,
        interestPct: 15,
        winDeductionPct: 20
      });

      assert.equal(res.success, true);
      assert.ok(res.proposal);
      assert.equal(res.proposal.amount, 2000);
      assert.equal(res.proposal.interestPct, 15);
      assert.equal(res.proposal.winDeductionPct, 20);
      assert.equal(res.proposal.totalOwed, 2300); // 2000 + 15% = 2300
    });

    it('should reject loan proposals under 10 chips', () => {
      const res = bankManager.createLoanProposal({
        fromId: player1.id,
        toId: player2.id,
        amount: 5
      });
      assert.equal(res.success, false);
    });

    it('should reject loan offers if the offering lender has insufficient chips', () => {
      playerManager.resetBankroll(player1.id, 500);
      const res = bankManager.createLoanProposal({
        fromId: player1.id,
        toId: player2.id,
        type: 'lend',
        amount: 2000
      });
      assert.equal(res.success, false);
      assert.match(res.reason, /onvoldoende fiches/i);
    });

    it('should allow Bob to accept Alice’s borrow request and transfer chips', () => {
      const propRes = bankManager.createLoanProposal({
        fromId: player1.id,
        toId: player2.id,
        type: 'borrow',
        amount: 3000,
        interestPct: 10,
        winDeductionPct: 25
      });

      const acceptRes = bankManager.acceptProposal(propRes.proposal.id, player2.id);
      assert.equal(acceptRes.success, true);
      assert.ok(acceptRes.loan);
      assert.equal(acceptRes.loan.amount, 3000);
      assert.equal(acceptRes.loan.totalOwed, 3300);
      assert.equal(acceptRes.loan.lenderId, player2.id);
      assert.equal(acceptRes.loan.borrowerId, player1.id);

      // Verify chip movement: Bob lost 3000, Alice gained 3000
      assert.equal(player2.chips, 7000);
      assert.equal(player1.chips, 13000);
    });

    it('should reject non-target player from accepting proposal', () => {
      const propRes = bankManager.createLoanProposal({
        fromId: player1.id,
        toId: player2.id,
        type: 'borrow',
        amount: 1000
      });

      const acceptRes = bankManager.acceptProposal(propRes.proposal.id, player1.id);
      assert.equal(acceptRes.success, false);
    });

    it('should allow declining a proposal', () => {
      const propRes = bankManager.createLoanProposal({
        fromId: player1.id,
        toId: player2.id,
        type: 'borrow',
        amount: 1000
      });

      const declineRes = bankManager.declineProposal(propRes.proposal.id, player2.id);
      assert.equal(declineRes.success, true);
      assert.equal(bankManager.proposals.has(propRes.proposal.id), false);
    });
  });

  describe('Loan Repayment & Win Deductions', () => {
    let activeLoan;

    beforeEach(() => {
      // Bob lends 2,000 chips to Alice at 10% interest (total 2,200) with 20% win deduction
      const prop = bankManager.createLoanProposal({
        fromId: player2.id,
        toId: player1.id,
        type: 'lend',
        amount: 2000,
        interestPct: 10,
        winDeductionPct: 20
      });
      const accepted = bankManager.acceptProposal(prop.proposal.id, player1.id);
      activeLoan = accepted.loan;
    });

    it('should correctly process automatic win deductions on roulette profits', () => {
      // Alice wins 1,000 net profit on roulette
      // Deduction = 20% of 1,000 = 200 chips
      const aliceStarting = player1.chips;
      const bobStarting = player2.chips;

      const deductions = bankManager.processWinRepayment(player1.id, 1000);
      assert.equal(deductions.length, 1);
      assert.equal(deductions[0].amount, 200);
      assert.equal(deductions[0].remaining, 2000); // 2200 - 200 = 2000
      assert.equal(deductions[0].isFullyRepaid, false);

      // Verify chip balance updates
      assert.equal(player1.chips, aliceStarting - 200);
      assert.equal(player2.chips, bobStarting + 200);
    });

    it('should fully repay loan and change status when accumulated repayments reach total owed', () => {
      // Alice wins 20,000 net -> 20% = 4,000, but cap at remaining debt 2,200
      const deductions = bankManager.processWinRepayment(player1.id, 20000);
      assert.equal(deductions.length, 1);
      assert.equal(deductions[0].amount, 2200);
      assert.equal(deductions[0].remaining, 0);
      assert.equal(deductions[0].isFullyRepaid, true);
      assert.equal(activeLoan.status, 'repaid');

      // Subsequent wins should not trigger any deductions
      const secondRound = bankManager.processWinRepayment(player1.id, 5000);
      assert.equal(secondRound.length, 0);
    });

    it('should allow manual repayment of debt', () => {
      const repayRes = bankManager.repayLoan(activeLoan.id, player1.id, 500);
      assert.equal(repayRes.success, true);
      assert.equal(repayRes.amountRepaid, 500);
      assert.equal(activeLoan.amountRepaid, 500);
      assert.equal(activeLoan.status, 'active');

      // Repay remainder
      const finishRes = bankManager.repayLoan(activeLoan.id, player1.id);
      assert.equal(finishRes.success, true);
      assert.equal(finishRes.amountRepaid, 1700);
      assert.equal(finishRes.isFullyRepaid, true);
      assert.equal(activeLoan.status, 'repaid');
    });

    it('should allow lender to forgive loan', () => {
      const forgiveRes = bankManager.forgiveLoan(activeLoan.id, player2.id);
      assert.equal(forgiveRes.success, true);
      assert.equal(activeLoan.status, 'repaid');
    });
  });

  describe('Emergency Bailout (100 chips every 10 min when < 10)', () => {
    it('should deny bailout when player balance is 10 chips or higher', () => {
      playerManager.resetBankroll(player1.id, 100);
      const status = bankManager.getBailoutStatus(player1.id);
      assert.equal(status.eligibleByChips, false);
      assert.equal(status.canClaim, false);

      const claimRes = bankManager.claimEmergencyBailout(player1.id);
      assert.equal(claimRes.success, false);
      assert.match(claimRes.reason, /minder dan 10/i);
    });

    it('should grant 100 chips when balance drops below 10 chips', () => {
      playerManager.resetBankroll(player1.id, 5);
      const status = bankManager.getBailoutStatus(player1.id);
      assert.equal(status.eligibleByChips, true);
      assert.equal(status.canClaim, true);

      const claimRes = bankManager.claimEmergencyBailout(player1.id);
      assert.equal(claimRes.success, true);
      assert.equal(claimRes.amount, 100);
      assert.equal(player1.chips, 105);
    });

    it('should enforce 10-minute cooldown on emergency bailout', () => {
      playerManager.resetBankroll(player1.id, 0);
      // First claim succeeds
      const first = bankManager.claimEmergencyBailout(player1.id);
      assert.equal(first.success, true);

      // Drop chips back to 0 immediately
      playerManager.resetBankroll(player1.id, 0);

      // Second claim immediately should fail due to cooldown
      const second = bankManager.claimEmergencyBailout(player1.id);
      assert.equal(second.success, false);
      assert.match(second.reason, /beschikbaar over/i);
      assert.ok(second.status.timeLeftMs > 0);
    });
  });

  describe('Debt Persistence & Session Reconnection', () => {
    it('should match debts across reconnecting player IDs using usernameKey', () => {
      // Bob lends 1000 to Alice
      const prop = bankManager.createLoanProposal({
        fromId: player2.id,
        toId: player1.id,
        type: 'lend',
        amount: 1000,
        interestPct: 10,
        winDeductionPct: 15
      });
      const accepted = bankManager.acceptProposal(prop.proposal.id, player1.id);
      assert.equal(accepted.success, true);

      // Simulate Alice reconnecting with a fresh socket / new playerId
      const reconnectedAlice = {
        id: 'ply_reconnected_999',
        name: 'Alice',
        usernameKey: 'alice',
        chips: 5000
      };
      playerManager.players.set(reconnectedAlice.id, reconnectedAlice);

      // Bank data should recognize active debts for the reconnected Alice
      const bankData = bankManager.getPlayerBankData(reconnectedAlice.id);
      assert.ok(bankData.activeDebts.length >= 1);
      assert.equal(bankData.activeDebts[0].id, accepted.loan.id);

      // Processing win deductions with reconnected Alice ID should deduct debt
      const deductions = bankManager.processWinRepayment(reconnectedAlice.id, 2000);
      assert.ok(deductions.length >= 1);
      assert.equal(deductions[0].loanId, accepted.loan.id);
    });

    it('should restore loans from client backup when server state was cleared', () => {
      const backupData = {
        activeDebts: [{
          id: 'loan_backup_test_1',
          borrowerId: player1.id,
          borrowerName: 'Alice',
          lenderId: player2.id,
          lenderName: 'Bob',
          amount: 500,
          totalOwed: 550,
          amountRepaid: 0,
          interestPct: 10,
          winDeductionPct: 15,
          status: 'active'
        }]
      };

      const restored = bankManager.restoreFromBackup(player1.id, backupData);
      assert.equal(restored, true);
      assert.ok(bankManager.loans.has('loan_backup_test_1'));

      const data = bankManager.getPlayerBankData(player1.id);
      const found = data.activeDebts.find(d => d.id === 'loan_backup_test_1');
      assert.ok(found);
      assert.equal(found.totalOwed, 550);
    });
  });
});
