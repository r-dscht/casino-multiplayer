/**
 * bankManager.js
 * P2P Casino Bank, Loans and Emergency Bailout manager.
 * Supports direct transfers, peer-to-peer loan agreements with interest and
 * automatic payout deductions from roulette wins, and a 10-minute emergency chip reload.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BAILOUT_AMOUNT = 100;
const BAILOUT_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
const BAILOUT_THRESHOLD = 10; // Balance must be < 10 chips

const WHEEL_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes (900,000 ms)

/**
 * 12 physical segments on the Monte Carlo Rad van Fortuin (30° per slice).
 * Every slice guarantees a positive chip payout (minimum 250 chips, zero "0" slices).
 * Total weight = 1000; Expected Value (EV) = 1,815 chips per spin.
 */
const WHEEL_SEGMENTS = [
  { index: 0, amount: 50000, label: '50.000', tier: 'jackpot', weight: 5, color: '#d4af37', textColor: '#071a12' },
  { index: 1, amount: 250, label: '250', tier: 'standard', weight: 120, color: '#0a2e20', textColor: '#f8fafc' },
  { index: 2, amount: 1500, label: '1.500', tier: 'medium', weight: 90, color: '#114b34', textColor: '#fde68a' },
  { index: 3, amount: 500, label: '500', tier: 'standard', weight: 110, color: '#071f15', textColor: '#e2e8f0' },
  { index: 4, amount: 5000, label: '5.000', tier: 'high', weight: 45, color: '#14532d', textColor: '#fcd34d' },
  { index: 5, amount: 750, label: '750', tier: 'common', weight: 160, color: '#0a2e20', textColor: '#f8fafc' },
  { index: 6, amount: 25000, label: '25.000', tier: 'mega', weight: 15, color: '#991b1b', textColor: '#fef08a' },
  { index: 7, amount: 250, label: '250', tier: 'standard', weight: 120, color: '#071f15', textColor: '#e2e8f0' },
  { index: 8, amount: 2500, label: '2.500', tier: 'medium', weight: 60, color: '#114b34', textColor: '#fde68a' },
  { index: 9, amount: 1000, label: '1.000', tier: 'common', weight: 140, color: '#0a2e20', textColor: '#fde68a' },
  { index: 10, amount: 10000, label: '10.000', tier: 'vip', weight: 25, color: '#78350f', textColor: '#fde047' },
  { index: 11, amount: 500, label: '500', tier: 'standard', weight: 110, color: '#071f15', textColor: '#e2e8f0' }
];

const TOTAL_WHEEL_WEIGHT = WHEEL_SEGMENTS.reduce((sum, s) => sum + s.weight, 0);

class BankManager {
  /**
   * @param {import('./playerManager')} playerManager 
   * @param {Object} [config]
   * @param {string|false} [config.storagePath]
   */
  constructor(playerManager, config = {}) {
    this.playerManager = playerManager;

    const isTestEnv = process.env.NODE_ENV === 'test' ||
                      process.execArgv.includes('--test') ||
                      process.argv.some(arg => arg.includes('--test') || arg.includes('.test.js'));

    /** @type {string|false} */
    this.storagePath = (config && config.storagePath !== undefined)
      ? config.storagePath
      : (isTestEnv ? false : path.join(__dirname, '..', 'data', 'bank.json'));

    /** @type {Map<string, Object>} proposalId -> Proposal */
    this.proposals = new Map();

    /** @type {Map<string, Object>} loanId -> Loan */
    this.loans = new Map();

    /** @type {Set<string>} Tombstone set of repaid/forgiven loan IDs */
    this.repaidLoanIds = new Set();

    /** @type {Map<string, number>} playerId/usernameKey -> lastBailoutTimestamp */
    this.bailouts = new Map();

    /** @type {Map<string, number>} playerId/usernameKey -> lastWheelSpinTimestamp */
    this.wheelSpins = new Map();

    /** @type {Set<string>} Active spin mutex locks */
    this.spinningLocks = new Set();

    /** @type {Map<string, Array<Object>>} playerKey/id -> unread inbox notifications */
    this.inboxNotifications = new Map();

    /** @type {Set<string>} Tombstones of dismissed notification IDs */
    this.dismissedNotificationIds = new Set();

    /** @type {Array<Object>} Recent bank transactions */
    this.transactions = [];

    this.loadState();
  }

  loadState() {
    if (this.storagePath) {
      try {
        if (fs.existsSync(this.storagePath)) {
          const raw = fs.readFileSync(this.storagePath, 'utf8');
          const data = JSON.parse(raw);
          if (data && typeof data === 'object') {
            if (Array.isArray(data.repaidLoanIds)) {
              data.repaidLoanIds.forEach(id => {
                if (typeof id === 'string') this.repaidLoanIds.add(id);
              });
            }
            if (Array.isArray(data.loans)) {
              data.loans.forEach(loan => {
                if (loan && loan.id) {
                  if (!loan.borrowerKey && loan.borrowerName) {
                    loan.borrowerKey = loan.borrowerName.trim().toLowerCase();
                  }
                  if (!loan.lenderKey && loan.lenderName) {
                    loan.lenderKey = loan.lenderName.trim().toLowerCase();
                  }
                  if (loan.status === 'repaid' || this.repaidLoanIds.has(loan.id)) {
                    loan.status = 'repaid';
                    this.repaidLoanIds.add(loan.id);
                  }
                  this.loans.set(loan.id, loan);
                }
              });
            }
            if (data.bailouts && typeof data.bailouts === 'object') {
              for (const [k, v] of Object.entries(data.bailouts)) {
                this.bailouts.set(k, v);
              }
            }
            if (data.wheelSpins && typeof data.wheelSpins === 'object') {
              for (const [k, v] of Object.entries(data.wheelSpins)) {
                if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
                  this.wheelSpins.set(k, Math.min(Date.now(), v));
                }
              }
            }
            if (Array.isArray(data.dismissedNotificationIds)) {
              data.dismissedNotificationIds.forEach(id => {
                if (typeof id === 'string') this.dismissedNotificationIds.add(id);
              });
            }
            if (data.inboxNotifications && typeof data.inboxNotifications === 'object') {
              for (const [k, list] of Object.entries(data.inboxNotifications)) {
                if (Array.isArray(list)) {
                  const filtered = list.filter(n => n && n.id && !this.dismissedNotificationIds.has(n.id)).slice(-30);
                  if (filtered.length > 0) {
                    this.inboxNotifications.set(k, filtered);
                  }
                }
              }
            }
            if (Array.isArray(data.transactions)) {
              this.transactions = data.transactions.slice(-50);
            }
          }
        }
      } catch (err) {
        console.error('Failed to load bank state:', err.message);
      }
    }

    // Restore active loans and wheel spin timestamps from player storage across restarts
    this.syncFromPlayerStorage();
  }

  syncFromPlayerStorage() {
    if (!this.playerManager) return;
    const records = [];
    if (this.playerManager.accounts) {
      records.push(...this.playerManager.accounts.values());
    }
    if (this.playerManager.players) {
      records.push(...this.playerManager.players.values());
    }

    for (const record of records) {
      if (!record) continue;
      if (Array.isArray(record.repaidLoanIds)) {
        for (const id of record.repaidLoanIds) {
          if (typeof id === 'string') {
            this.repaidLoanIds.add(id);
            const existing = this.loans.get(id);
            if (existing) existing.status = 'repaid';
          }
        }
      }
      if (typeof record.lastWheelSpin === 'number' && Number.isFinite(record.lastWheelSpin) && record.lastWheelSpin > 0) {
        const clamped = Math.min(Date.now(), record.lastWheelSpin);
        const uKey = (record.usernameKey || record.name || '').trim().toLowerCase();
        if (uKey) {
          this.wheelSpins.set(uKey, Math.max(this.wheelSpins.get(uKey) || 0, clamped));
        }
        if (record.id) {
          this.wheelSpins.set(record.id, Math.max(this.wheelSpins.get(record.id) || 0, clamped));
        }
      }
    }

    for (const record of records) {
      if (!record) continue;
      const ingestStoredLoan = (loan) => {
        if (!loan || !loan.id) return;
        if (loan.status === 'repaid' || this.repaidLoanIds.has(loan.id)) {
          this.repaidLoanIds.add(loan.id);
          return;
        }
        if (!this.loans.has(loan.id)) {
          if (!loan.borrowerKey && loan.borrowerName) loan.borrowerKey = loan.borrowerName.trim().toLowerCase();
          if (!loan.lenderKey && loan.lenderName) loan.lenderKey = loan.lenderName.trim().toLowerCase();
          this.loans.set(loan.id, { ...loan, status: 'active' });
        } else {
          const existing = this.loans.get(loan.id);
          if (existing && existing.status === 'active' && typeof loan.amountRepaid === 'number') {
            existing.amountRepaid = Math.max(existing.amountRepaid || 0, loan.amountRepaid);
            if (existing.amountRepaid >= existing.totalOwed) {
              existing.status = 'repaid';
              this.repaidLoanIds.add(existing.id);
            }
          }
        }
      };

      if (Array.isArray(record.activeDebts)) {
        for (const loan of record.activeDebts) ingestStoredLoan(loan);
      }
      if (Array.isArray(record.activeLoansGiven)) {
        for (const loan of record.activeLoansGiven) ingestStoredLoan(loan);
      }
    }
  }

  syncPlayerDebts(loan) {
    if (!loan || !this.playerManager) return;
    if (loan.status === 'repaid') {
      this.repaidLoanIds.add(loan.id);
    }
    const borrowerKey = (loan.borrowerKey || loan.borrowerName || '').trim().toLowerCase();
    const lenderKey = (loan.lenderKey || loan.lenderName || '').trim().toLowerCase();

    const updateAccountLoans = (key, id, listProp, isAdd) => {
      const targets = new Set();
      if (id && this.playerManager.players.has(id)) {
        targets.add(this.playerManager.players.get(id));
      }
      if (key && this.playerManager.accounts.has(key)) {
        targets.add(this.playerManager.accounts.get(key));
      }
      for (const p of this.playerManager.players.values()) {
        if ((p.id && p.id === id) || ((p.usernameKey || p.name || '').trim().toLowerCase() === key)) {
          targets.add(p);
        }
      }

      for (const target of targets) {
        if (!Array.isArray(target[listProp])) {
          target[listProp] = [];
        }
        target[listProp] = target[listProp].filter(l => l.id !== loan.id);
        if (isAdd && loan.status === 'active') {
          target[listProp].push({ ...loan });
        }
        if (loan.status === 'repaid') {
          if (!Array.isArray(target.repaidLoanIds)) {
            target.repaidLoanIds = [];
          }
          if (!target.repaidLoanIds.includes(loan.id)) {
            target.repaidLoanIds.push(loan.id);
            if (target.repaidLoanIds.length > 200) {
              target.repaidLoanIds = target.repaidLoanIds.slice(-200);
            }
          }
        }
      }
    };

    updateAccountLoans(borrowerKey, loan.borrowerId, 'activeDebts', loan.status === 'active');
    updateAccountLoans(lenderKey, loan.lenderId, 'activeLoansGiven', loan.status === 'active');

    if (typeof this.playerManager.scheduleSave === 'function') {
      this.playerManager.scheduleSave();
    }
  }

  restoreFromBackup(playerId, backup) {
    if (!backup || typeof backup !== 'object') return false;
    let restoredAny = false;
    const player = this.playerManager ? this.playerManager.getPlayerById(playerId) : null;

    // 1. Reconcile wheel spin timestamp from client backup (anti-reload cooldown bypass protection)
    const rawSpinTs = Number(backup.lastWheelSpin || (backup.wheelStatus && backup.wheelStatus.lastSpinTime) || 0);
    if (Number.isFinite(rawSpinTs) && rawSpinTs > 0) {
      const clampedSpin = Math.min(Date.now(), rawSpinTs);
      const uKey = player ? (player.usernameKey || player.name || '').trim().toLowerCase() : '';
      if (uKey) {
        const prev = this.wheelSpins.get(uKey) || 0;
        if (clampedSpin > prev) {
          this.wheelSpins.set(uKey, clampedSpin);
          restoredAny = true;
        }
      }
      if (playerId) {
        const prevId = this.wheelSpins.get(playerId) || 0;
        if (clampedSpin > prevId) {
          this.wheelSpins.set(playerId, clampedSpin);
          restoredAny = true;
        }
      }
      if (player && clampedSpin > (player.lastWheelSpin || 0)) {
        player.lastWheelSpin = clampedSpin;
        if (uKey && this.playerManager.accounts.has(uKey)) {
          this.playerManager.accounts.get(uKey).lastWheelSpin = clampedSpin;
        }
        if (typeof this.playerManager.scheduleSave === 'function') {
          this.playerManager.scheduleSave();
        }
      }
    }

    // 2. Reconcile repaidLoanIds tombstones so repaid loans never resurrect
    if (Array.isArray(backup.repaidLoanIds)) {
      for (const repaidId of backup.repaidLoanIds) {
        if (typeof repaidId === 'string' && repaidId.startsWith('loan_')) {
          if (!this.repaidLoanIds.has(repaidId)) {
            this.repaidLoanIds.add(repaidId);
            restoredAny = true;
          }
          const existing = this.loans.get(repaidId);
          if (existing && existing.status === 'active') {
            if (!player || this._isBorrowerMatch(existing, player) || this._isLenderMatch(existing, player)) {
              existing.status = 'repaid';
              this.syncPlayerDebts(existing);
              restoredAny = true;
            }
          }
        }
      }
    }

    // 3. Restore active loans with strict anti-cheat validation
    const checkLoan = (loan) => {
      if (!loan || !loan.id || typeof loan.id !== 'string' || !loan.id.startsWith('loan_')) return;
      if (loan.status === 'repaid' || this.repaidLoanIds.has(loan.id)) {
        this.repaidLoanIds.add(loan.id);
        return;
      }

      const amount = Math.floor(Number(loan.amount) || 0);
      if (amount < 10 || amount > 1000000000) return;

      const interestPct = Math.max(0, Math.min(100, Math.floor(Number(loan.interestPct) || 0)));
      const winDeductionPct = Math.max(5, Math.min(50, Math.floor(Number(loan.winDeductionPct) || 15)));
      const totalOwed = Math.max(amount, Math.floor(Number(loan.totalOwed) || Math.round(amount * (1 + interestPct / 100))));
      const amountRepaid = Math.max(0, Math.floor(Number(loan.amountRepaid) || 0));

      if (amountRepaid >= totalOwed) {
        this.repaidLoanIds.add(loan.id);
        return;
      }

      const borrowerName = typeof loan.borrowerName === 'string' ? loan.borrowerName.trim() : '';
      const lenderName = typeof loan.lenderName === 'string' ? loan.lenderName.trim() : '';
      const borrowerKey = (loan.borrowerKey || borrowerName).trim().toLowerCase();
      const lenderKey = (loan.lenderKey || lenderName).trim().toLowerCase();
      if (!borrowerKey && !loan.borrowerId) return;
      if (!lenderKey && !loan.lenderId) return;

      const candidate = {
        id: loan.id,
        lenderId: loan.lenderId || '',
        lenderName: lenderName || lenderKey,
        lenderKey,
        borrowerId: loan.borrowerId || '',
        borrowerName: borrowerName || borrowerKey,
        borrowerKey,
        amount,
        interestPct,
        winDeductionPct,
        totalOwed,
        amountRepaid,
        createdAt: Number.isInteger(loan.createdAt) ? loan.createdAt : Date.now(),
        status: 'active'
      };

      // Anti-cheat ownership check: restoring player must be either borrower or lender
      if (player && !this._isBorrowerMatch(candidate, player) && !this._isLenderMatch(candidate, player)) {
        return;
      }

      if (this.loans.has(candidate.id)) {
        const existing = this.loans.get(candidate.id);
        if (existing.status === 'repaid') {
          this.repaidLoanIds.add(existing.id);
          return;
        }
        if (candidate.amountRepaid > (existing.amountRepaid || 0)) {
          existing.amountRepaid = candidate.amountRepaid;
          if (existing.amountRepaid >= existing.totalOwed) {
            existing.status = 'repaid';
            this.repaidLoanIds.add(existing.id);
          }
          this.syncPlayerDebts(existing);
          restoredAny = true;
        }
      } else {
        this.loans.set(candidate.id, candidate);
        this.syncPlayerDebts(candidate);
        restoredAny = true;
      }
    };

    if (Array.isArray(backup.activeDebts)) {
      backup.activeDebts.forEach(checkLoan);
    }
    if (Array.isArray(backup.activeLoansGiven)) {
      backup.activeLoansGiven.forEach(checkLoan);
    }

    if (restoredAny) {
      this.saveState();
    }
    return restoredAny;
  }

  _isBorrowerMatch(loan, player) {
    if (!loan || !player) return false;
    if (loan.borrowerId && player.id && loan.borrowerId === player.id) return true;
    const pKey = (player.usernameKey || player.name || '').trim().toLowerCase();
    const bKey = (loan.borrowerKey || loan.borrowerName || '').trim().toLowerCase();
    return !!(pKey && bKey && pKey === bKey);
  }

  _isLenderMatch(loan, player) {
    if (!loan || !player) return false;
    if (loan.lenderId && player.id && loan.lenderId === player.id) return true;
    const pKey = (player.usernameKey || player.name || '').trim().toLowerCase();
    const lKey = (loan.lenderKey || loan.lenderName || '').trim().toLowerCase();
    return !!(pKey && lKey && pKey === lKey);
  }

  _isProposalToMatch(prop, player) {
    if (!prop || !player) return false;
    if (prop.toId && player.id && prop.toId === player.id) return true;
    const pKey = (player.usernameKey || player.name || '').trim().toLowerCase();
    const tKey = (prop.toKey || prop.toName || '').trim().toLowerCase();
    return !!(pKey && tKey && pKey === tKey);
  }

  _isProposalFromMatch(prop, player) {
    if (!prop || !player) return false;
    if (prop.fromId && player.id && prop.fromId === player.id) return true;
    const pKey = (player.usernameKey || player.name || '').trim().toLowerCase();
    const fKey = (prop.fromKey || prop.fromName || '').trim().toLowerCase();
    return !!(pKey && fKey && pKey === fKey);
  }

  saveState() {
    if (!this.storagePath) return;
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = {
        loans: Array.from(this.loans.values()),
        repaidLoanIds: Array.from(this.repaidLoanIds),
        bailouts: Object.fromEntries(this.bailouts.entries()),
        wheelSpins: Object.fromEntries(this.wheelSpins.entries()),
        inboxNotifications: Object.fromEntries(this.inboxNotifications.entries()),
        dismissedNotificationIds: Array.from(this.dismissedNotificationIds).slice(-300),
        transactions: this.transactions.slice(-50)
      };
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to save bank state:', err.message);
    }
  }

  _recordTransaction(type, fromName, toName, amount, details = '') {
    const tx = {
      id: `tx_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      type,
      fromName,
      toName,
      amount,
      details,
      timestamp: Date.now()
    };
    this.transactions.push(tx);
    if (this.transactions.length > 50) this.transactions.shift();
    this.saveState();
    return tx;
  }

  /**
   * Direct transfer / gift of chips from one player to another.
   * @param {string} fromPlayerId 
   * @param {string} toPlayerId 
   * @param {number} amount 
   * @returns {{ success: boolean, reason?: string, fromChips?: number, toChips?: number, transaction?: Object }}
   */
  directTransfer(fromPlayerId, toPlayerId, amount) {
    if (fromPlayerId === toPlayerId) {
      return { success: false, reason: 'Je kunt geen fiches naar jezelf overmaken.' };
    }
    const cleanAmount = parseInt(amount, 10);
    if (!Number.isInteger(cleanAmount) || cleanAmount <= 0) {
      return { success: false, reason: 'Ongeldig overboekingsbedrag.' };
    }

    const fromPlayer = this.playerManager.getPlayerById(fromPlayerId);
    const toPlayer = this.playerManager.getPlayerById(toPlayerId);

    if (!fromPlayer || !toPlayer) {
      return { success: false, reason: 'Speler niet gevonden of niet verbonden.' };
    }

    if (fromPlayer.chips < cleanAmount) {
      return { success: false, reason: 'Onvoldoende fiches om dit bedrag over te maken.' };
    }

    const deductRes = this.playerManager.deductChips(fromPlayerId, cleanAmount);
    if (!deductRes.success) {
      return { success: false, reason: deductRes.reason };
    }

    this.playerManager.addChips(toPlayerId, cleanAmount);

    const tx = this._recordTransaction('transfer', fromPlayer.name, toPlayer.name, cleanAmount, 'Directe overboeking');

    const notification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      type: 'donation',
      fromId: fromPlayer.id,
      fromName: fromPlayer.name,
      toId: toPlayer.id,
      toName: toPlayer.name,
      toKey: (toPlayer.usernameKey || toPlayer.name || '').trim().toLowerCase(),
      amount: cleanAmount,
      message: `${fromPlayer.name} heeft je ${cleanAmount.toLocaleString()} fiches gedoneerd!`,
      timestamp: Date.now()
    };
    this._addInboxNotification(toPlayer, notification);

    return {
      success: true,
      fromPlayer,
      toPlayer,
      fromChips: fromPlayer.chips,
      toChips: toPlayer.chips,
      transaction: tx,
      notification
    };
  }

  /**
   * Stores an unread inbox notification for a recipient player.
   * @param {Object} toPlayer
   * @param {Object} notif
   */
  _addInboxNotification(toPlayer, notif) {
    if (!toPlayer || !notif || !notif.id) return;
    const uKey = (toPlayer.usernameKey || toPlayer.name || '').trim().toLowerCase();
    const key = uKey || toPlayer.id;
    const list = this.inboxNotifications.get(key) || [];
    if (!list.some(n => n.id === notif.id)) {
      list.unshift(notif);
      if (list.length > 25) list.length = 25;
      this.inboxNotifications.set(key, list);
    }
    this.saveState();
  }

  /**
   * Returns unread inbox notifications for a player.
   * @param {Object} player
   * @returns {Array<Object>}
   */
  getPlayerNotifications(player) {
    if (!player) return [];
    const uKey = (player.usernameKey || player.name || '').trim().toLowerCase();
    const byKey = uKey ? (this.inboxNotifications.get(uKey) || []) : [];
    const byId = player.id ? (this.inboxNotifications.get(player.id) || []) : [];
    const merged = new Map();
    for (const n of [...byKey, ...byId]) {
      if (n && n.id && !this.dismissedNotificationIds.has(n.id)) {
        merged.set(n.id, n);
      }
    }
    return Array.from(merged.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }

  /**
   * Dismisses a single inbox notification or all notifications for a player.
   * @param {string} playerId
   * @param {string} [notificationId='all']
   * @returns {{ success: boolean }}
   */
  dismissNotification(playerId, notificationId = 'all') {
    const player = this.playerManager ? this.playerManager.getPlayerById(playerId) : null;
    if (!player) return { success: false };
    const uKey = (player.usernameKey || player.name || '').trim().toLowerCase();
    const keys = [uKey, player.id].filter(Boolean);

    for (const k of keys) {
      const list = this.inboxNotifications.get(k);
      if (!Array.isArray(list)) continue;
      if (!notificationId || notificationId === 'all') {
        list.forEach(n => {
          if (n && n.id) this.dismissedNotificationIds.add(n.id);
        });
        this.inboxNotifications.delete(k);
      } else {
        this.dismissedNotificationIds.add(notificationId);
        const remaining = list.filter(n => n && n.id !== notificationId);
        if (remaining.length > 0) {
          this.inboxNotifications.set(k, remaining);
        } else {
          this.inboxNotifications.delete(k);
        }
      }
    }
    this.saveState();
    return { success: true };
  }

  /**
   * Propose a loan agreement (either borrow request or lending offer).
   * @param {Object} params
   * @param {string} params.fromId Initiating player ID
   * @param {string} params.toId Target player ID
   * @param {'borrow'|'lend'} [params.type='borrow'] 'borrow' = fromId asks to borrow from toId; 'lend' = fromId offers to lend to toId
   * @param {number} params.amount Principal chip amount
   * @param {number} [params.interestPct=10] Interest rate (0-100%)
   * @param {number} [params.winDeductionPct=15] Automatic deduction % on roulette win (5-50%)
   * @returns {{ success: boolean, reason?: string, proposal?: Object }}
   */
  createLoanProposal({ fromId, toId, type = 'borrow', amount, interestPct = 10, winDeductionPct = 15 }) {
    if (fromId === toId) {
      return { success: false, reason: 'Je kunt geen lening met jezelf afsluiten.' };
    }

    const fromPlayer = this.playerManager.getPlayerById(fromId);
    const toPlayer = this.playerManager.getPlayerById(toId);

    if (!fromPlayer || !toPlayer) {
      return { success: false, reason: 'Speler niet online of niet gevonden.' };
    }

    const cleanAmount = parseInt(amount, 10);
    if (!Number.isInteger(cleanAmount) || cleanAmount < 10) {
      return { success: false, reason: 'Leningbedrag moet minimaal 10 fiches zijn.' };
    }

    const cleanInterest = Math.max(0, Math.min(100, parseInt(interestPct, 10) || 0));
    const cleanDeduction = Math.max(5, Math.min(50, parseInt(winDeductionPct, 10) || 15));

    // If offering a loan, verify lender has enough chips
    if (type === 'lend' && fromPlayer.chips < cleanAmount) {
      return { success: false, reason: 'Je hebt onvoldoende fiches om deze lening aan te bieden.' };
    }

    const totalOwed = Math.round(cleanAmount * (1 + cleanInterest / 100));

    const proposalId = `prop_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const proposal = {
      id: proposalId,
      fromId,
      fromName: fromPlayer.name,
      fromKey: (fromPlayer.usernameKey || fromPlayer.name || '').trim().toLowerCase(),
      toId,
      toName: toPlayer.name,
      toKey: (toPlayer.usernameKey || toPlayer.name || '').trim().toLowerCase(),
      type, // 'borrow' or 'lend'
      amount: cleanAmount,
      interestPct: cleanInterest,
      winDeductionPct: cleanDeduction,
      totalOwed,
      createdAt: Date.now()
    };

    this.proposals.set(proposalId, proposal);
    return { success: true, proposal };
  }

  /**
   * Accept an incoming loan proposal.
   * @param {string} proposalId 
   * @param {string} acceptingPlayerId 
   * @returns {{ success: boolean, reason?: string, loan?: Object, lender?: Object, borrower?: Object }}
   */
  acceptProposal(proposalId, acceptingPlayerId) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      return { success: false, reason: 'Voorstel niet gevonden of verlopen.' };
    }

    const acceptingPlayer = this.playerManager.getPlayerById(acceptingPlayerId);
    if (!acceptingPlayer) {
      return { success: false, reason: 'Speler niet gevonden of niet verbonden.' };
    }

    if (proposal.toId !== acceptingPlayerId && !this._isProposalToMatch(proposal, acceptingPlayer)) {
      return { success: false, reason: 'Alleen de genodigde speler kan dit voorstel accepteren.' };
    }

    // Determine lender & borrower
    let lenderId, borrowerId;
    if (proposal.type === 'borrow') {
      // fromId wants to borrow; acceptingPlayer (toId) is the lender
      lenderId = acceptingPlayerId;
      borrowerId = proposal.fromId;
    } else {
      // fromId offered to lend; acceptingPlayer (toId) is the borrower
      lenderId = proposal.fromId;
      borrowerId = acceptingPlayerId;
    }

    const lender = this.playerManager.getPlayerById(lenderId);
    const borrower = this.playerManager.getPlayerById(borrowerId);

    if (!lender || !borrower) {
      return { success: false, reason: 'Eén van de spelers is niet langer online.' };
    }

    if (lender.chips < proposal.amount) {
      return { success: false, reason: `${lender.name} heeft onvoldoende fiches om de lening te verstrekken.` };
    }

    // Transfer principal
    const deductRes = this.playerManager.deductChips(lenderId, proposal.amount);
    if (!deductRes.success) {
      return { success: false, reason: deductRes.reason };
    }
    this.playerManager.addChips(borrowerId, proposal.amount);

    // Create active loan
    const loanId = `loan_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const loan = {
      id: loanId,
      lenderId: lender.id,
      lenderName: lender.name,
      lenderKey: (lender.usernameKey || lender.name || '').trim().toLowerCase(),
      borrowerId: borrower.id,
      borrowerName: borrower.name,
      borrowerKey: (borrower.usernameKey || borrower.name || '').trim().toLowerCase(),
      amount: proposal.amount,
      interestPct: proposal.interestPct,
      winDeductionPct: proposal.winDeductionPct,
      totalOwed: proposal.totalOwed,
      amountRepaid: 0,
      createdAt: Date.now(),
      status: 'active'
    };

    this.loans.set(loanId, loan);
    this.proposals.delete(proposalId);
    this.syncPlayerDebts(loan);

    this._recordTransaction(
      'loan_started',
      lender.name,
      borrower.name,
      proposal.amount,
      `Lening gestart: ${proposal.totalOwed} terug te betalen (${proposal.interestPct}% rente, ${proposal.winDeductionPct}% winstinhouding)`
    );

    this.saveState();

    return {
      success: true,
      loan,
      lender,
      borrower
    };
  }

  /**
   * Decline or cancel a loan proposal.
   * @param {string} proposalId 
   * @param {string} playerId 
   * @returns {{ success: boolean, reason?: string, proposal?: Object }}
   */
  declineProposal(proposalId, playerId) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      return { success: false, reason: 'Voorstel niet gevonden.' };
    }

    const player = this.playerManager.getPlayerById(playerId);
    if (!player) {
      return { success: false, reason: 'Speler niet gevonden.' };
    }

    if (proposal.toId !== playerId && proposal.fromId !== playerId &&
        !this._isProposalToMatch(proposal, player) && !this._isProposalFromMatch(proposal, player)) {
      return { success: false, reason: 'Geen bevoegdheid om dit voorstel af te wijzen.' };
    }

    this.proposals.delete(proposalId);
    return { success: true, proposal };
  }

  /**
   * Manually repay part or all of an active debt.
   * @param {string} loanId 
   * @param {string} borrowerPlayerId 
   * @param {number} [amount] Optional amount; defaults to full remaining debt
   * @returns {{ success: boolean, reason?: string, loan?: Object, amountRepaid?: number, isFullyRepaid?: boolean }}
   */
  repayLoan(loanId, borrowerPlayerId, amount) {
    const loan = this.loans.get(loanId);
    if (!loan || loan.status !== 'active') {
      return { success: false, reason: 'Lening niet gevonden of reeds afgelost.' };
    }

    const borrower = this.playerManager.getPlayerById(borrowerPlayerId);
    if (!borrower) {
      return { success: false, reason: 'Lener niet online.' };
    }

    if (loan.borrowerId !== borrowerPlayerId && !this._isBorrowerMatch(loan, borrower)) {
      return { success: false, reason: 'Alleen de lener kan deze schuld aflossen.' };
    }
    loan.borrowerId = borrower.id;

    const remaining = loan.totalOwed - loan.amountRepaid;
    const cleanAmount = (typeof amount === 'number' && amount > 0)
      ? Math.min(remaining, Math.floor(amount))
      : remaining;

    if (cleanAmount <= 0) {
      return { success: false, reason: 'Schuld is reeds volledig afgelost.' };
    }

    if (borrower.chips < cleanAmount) {
      return { success: false, reason: 'Onvoldoende fiches om dit bedrag af te lossen.' };
    }

    const deductRes = this.playerManager.deductChips(borrowerPlayerId, cleanAmount);
    if (!deductRes.success) {
      return { success: false, reason: deductRes.reason };
    }

    // Credit lender (even if lender is offline, credit their account balance)
    let lender = this.playerManager.getPlayerById(loan.lenderId);
    if (!lender && loan.lenderKey) {
      for (const p of this.playerManager.players.values()) {
        if ((p.usernameKey || p.name || '').trim().toLowerCase() === loan.lenderKey) {
          lender = p;
          loan.lenderId = p.id;
          break;
        }
      }
    }

    if (lender) {
      this.playerManager.addChips(lender.id, cleanAmount);
    } else {
      // Find persistent account of lender if offline
      for (const account of this.playerManager.accounts.values()) {
        if (account.name.toLowerCase() === loan.lenderName.toLowerCase() ||
            (account.usernameKey && account.usernameKey === loan.lenderKey)) {
          account.chips = (account.chips || 0) + cleanAmount;
          this.playerManager.saveAccounts();
          break;
        }
      }
    }

    loan.amountRepaid += cleanAmount;
    const isFullyRepaid = loan.amountRepaid >= loan.totalOwed;
    if (isFullyRepaid) {
      loan.status = 'repaid';
    }

    this.syncPlayerDebts(loan);

    this._recordTransaction(
      'repayment',
      borrower.name,
      loan.lenderName,
      cleanAmount,
      isFullyRepaid ? 'Lening volledig afgelost' : `Deelaflossing (${loan.totalOwed - loan.amountRepaid} openstaand)`
    );

    this.saveState();

    return {
      success: true,
      loan,
      amountRepaid: cleanAmount,
      isFullyRepaid
    };
  }

  /**
   * Forgive/cancel a loan (as a lender).
   * @param {string} loanId 
   * @param {string} lenderPlayerId 
   */
  forgiveLoan(loanId, lenderPlayerId) {
    const loan = this.loans.get(loanId);
    if (!loan || loan.status !== 'active') {
      return { success: false, reason: 'Lening niet gevonden of niet actief.' };
    }
    const lender = this.playerManager.getPlayerById(lenderPlayerId);
    if (!lender) {
      return { success: false, reason: 'Geldschieter niet online.' };
    }
    if (loan.lenderId !== lenderPlayerId && !this._isLenderMatch(loan, lender)) {
      return { success: false, reason: 'Alleen de geldschieter kan een lening kwijtschelden.' };
    }
    loan.lenderId = lender.id;

    loan.status = 'repaid';
    this.syncPlayerDebts(loan);
    this._recordTransaction('forgiven', loan.lenderName, loan.borrowerName, loan.totalOwed - loan.amountRepaid, 'Schuld kwijtgescholden');
    this.saveState();
    return { success: true, loan };
  }

  /**
   * Automatically process win repayments on net roulette profits.
   * @param {string} borrowerPlayerId 
   * @param {number} netWin Net profit from round (totalWon - totalBet)
   * @returns {Array<{ loanId: string, lenderId: string, lenderName: string, amount: number, remaining: number, isFullyRepaid: boolean }>}
   */
  processWinRepayment(borrowerPlayerId, netWin) {
    if (!netWin || netWin <= 0) return [];

    const borrower = this.playerManager.getPlayerById(borrowerPlayerId);
    if (!borrower) return [];

    const activeLoans = Array.from(this.loans.values())
      .filter(l => (l.borrowerId === borrowerPlayerId || this._isBorrowerMatch(l, borrower)) && l.status === 'active')
      .sort((a, b) => a.createdAt - b.createdAt);

    if (activeLoans.length === 0) return [];

    const repayments = [];

    for (const loan of activeLoans) {
      loan.borrowerId = borrower.id;
      const remaining = loan.totalOwed - loan.amountRepaid;
      if (remaining <= 0) {
        loan.status = 'repaid';
        this.syncPlayerDebts(loan);
        continue;
      }

      // Calculate deduction based on loan percentage
      const deduction = Math.min(remaining, Math.max(1, Math.floor(netWin * (loan.winDeductionPct / 100))));
      if (deduction <= 0) continue;

      if (borrower.chips >= deduction) {
        this.playerManager.deductChips(borrowerPlayerId, deduction);

        let lender = this.playerManager.getPlayerById(loan.lenderId);
        if (!lender && loan.lenderKey) {
          for (const p of this.playerManager.players.values()) {
            if ((p.usernameKey || p.name || '').trim().toLowerCase() === loan.lenderKey) {
              lender = p;
              loan.lenderId = p.id;
              break;
            }
          }
        }

        if (lender) {
          this.playerManager.addChips(lender.id, deduction);
        } else {
          for (const account of this.playerManager.accounts.values()) {
            if (account.name.toLowerCase() === loan.lenderName.toLowerCase() ||
                (account.usernameKey && account.usernameKey === loan.lenderKey)) {
              account.chips = (account.chips || 0) + deduction;
              this.playerManager.saveAccounts();
              break;
            }
          }
        }

        loan.amountRepaid += deduction;
        const isFullyRepaid = loan.amountRepaid >= loan.totalOwed;
        if (isFullyRepaid) {
          loan.status = 'repaid';
        }
        this.syncPlayerDebts(loan);

        this._recordTransaction(
          'win_repayment',
          borrower.name,
          loan.lenderName,
          deduction,
          `Automatische winstafhouding (${loan.winDeductionPct}%)`
        );

        repayments.push({
          loanId: loan.id,
          lenderId: loan.lenderId,
          lenderName: loan.lenderName,
          amount: deduction,
          remaining: Math.max(0, loan.totalOwed - loan.amountRepaid),
          isFullyRepaid
        });
      }
    }

    if (repayments.length > 0) {
      this.saveState();
    }

    return repayments;
  }

  /**
   * Checks bailout timer and balance eligibility for a player.
   * @param {string} playerId 
   * @returns {{ canClaim: boolean, timeLeftMs: number, eligibleByChips: boolean, cooldownMs: number, nextAvailableTime: number }}
   */
  getBailoutStatus(playerId) {
    const player = this.playerManager.getPlayerById(playerId);
    const key = (player && player.usernameKey) ? player.usernameKey : playerId;
    const lastBailout = this.bailouts.get(key) || 0;
    const now = Date.now();
    const elapsed = now - lastBailout;
    const timeLeftMs = Math.max(0, BAILOUT_COOLDOWN_MS - elapsed);
    const eligibleByChips = player ? (player.chips < BAILOUT_THRESHOLD) : false;
    const canClaim = (timeLeftMs === 0) && eligibleByChips;

    return {
      canClaim,
      timeLeftMs,
      eligibleByChips,
      cooldownMs: BAILOUT_COOLDOWN_MS,
      nextAvailableTime: lastBailout + BAILOUT_COOLDOWN_MS
    };
  }

  /**
   * Claim 100 free bailout chips every 10 minutes when chips < 10.
   * @param {string} playerId 
   * @returns {{ success: boolean, reason?: string, chips?: number, status?: Object }}
   */
  claimEmergencyBailout(playerId) {
    const player = this.playerManager.getPlayerById(playerId);
    if (!player) {
      return { success: false, reason: 'Speler niet gevonden.' };
    }

    const status = this.getBailoutStatus(playerId);
    if (!status.eligibleByChips) {
      return {
        success: false,
        reason: `Noodfiches zijn enkel beschikbaar wanneer je saldo minder dan ${BAILOUT_THRESHOLD} fiches bedraagt.`
      };
    }

    if (status.timeLeftMs > 0) {
      const minutesLeft = Math.ceil(status.timeLeftMs / 60000);
      return {
        success: false,
        reason: `Noodfiches zijn pas weer beschikbaar over ${minutesLeft} minuut/minuten.`,
        status
      };
    }

    const key = player.usernameKey || playerId;
    this.bailouts.set(key, Date.now());
    this.playerManager.addChips(playerId, BAILOUT_AMOUNT);

    this._recordTransaction('bailout', 'Casino Noodfonds', player.name, BAILOUT_AMOUNT, '10-minuten noodgift');
    this.saveState();

    return {
      success: true,
      chips: player.chips,
      amount: BAILOUT_AMOUNT,
      status: this.getBailoutStatus(playerId)
    };
  }

  /**
   * Returns 15-minute Lucky Wheel ("Rad van Fortuin") status and segments for a player.
   * Reconciles server and client timestamps so page reloads or container restarts cannot reset cooldown.
   * @param {string} playerId 
   * @param {number} [clientLastSpin=0]
   * @returns {{ canSpin: boolean, timeLeftMs: number, cooldownMs: number, lastSpinTime: number, nextAvailableTime: number, segments: Array<Object> }}
   */
  getWheelStatus(playerId, clientLastSpin = 0) {
    const player = this.playerManager ? this.playerManager.getPlayerById(playerId) : null;
    const uKey = player ? (player.usernameKey || player.name || '').trim().toLowerCase() : '';
    const key = uKey || playerId;
    const now = Date.now();

    const safeClientSpin = (typeof clientLastSpin === 'number' && Number.isFinite(clientLastSpin) && clientLastSpin > 0)
      ? Math.min(now, clientLastSpin)
      : 0;

    const lastSpinTime = Math.max(
      this.wheelSpins.get(key) || 0,
      this.wheelSpins.get(playerId) || 0,
      (player && typeof player.lastWheelSpin === 'number' ? player.lastWheelSpin : 0),
      safeClientSpin
    );

    if (lastSpinTime > 0) {
      this.wheelSpins.set(key, lastSpinTime);
      if (playerId) this.wheelSpins.set(playerId, lastSpinTime);
      if (player && lastSpinTime > (player.lastWheelSpin || 0)) {
        player.lastWheelSpin = lastSpinTime;
        if (uKey && this.playerManager.accounts && this.playerManager.accounts.has(uKey)) {
          this.playerManager.accounts.get(uKey).lastWheelSpin = lastSpinTime;
        }
      }
    }

    const elapsed = now - lastSpinTime;
    const timeLeftMs = lastSpinTime > 0 ? Math.max(0, WHEEL_COOLDOWN_MS - elapsed) : 0;
    const canSpin = timeLeftMs === 0;

    return {
      canSpin,
      timeLeftMs,
      cooldownMs: WHEEL_COOLDOWN_MS,
      lastSpinTime,
      nextAvailableTime: lastSpinTime > 0 ? (lastSpinTime + WHEEL_COOLDOWN_MS) : now,
      segments: WHEEL_SEGMENTS.map(s => ({
        index: s.index,
        amount: s.amount,
        label: s.label,
        tier: s.tier,
        color: s.color,
        textColor: s.textColor
      }))
    };
  }

  /**
   * Executes a server-authoritative spin on the 15-minute Rad van Fortuin.
   * Uses crypto.randomInt weighted RNG, mutex lock against rapid clicks, and multi-layer timestamp persistence.
   * @param {string} playerId 
   * @param {number} [clientLastSpin=0]
   * @returns {{ success: boolean, code?: string, reason?: string, segmentIndex?: number, amount?: number, label?: string, tier?: string, chips?: number, lastSpinTime?: number, wheelStatus?: Object }}
   */
  spinWheel(playerId, clientLastSpin = 0) {
    const player = this.playerManager ? this.playerManager.getPlayerById(playerId) : null;
    if (!player) {
      return { success: false, code: 'PLAYER_NOT_FOUND', reason: 'Speler niet gevonden.' };
    }

    const uKey = (player.usernameKey || player.name || '').trim().toLowerCase();
    const lockKey = uKey || playerId;

    if (this.spinningLocks.has(lockKey)) {
      return {
        success: false,
        code: 'SPIN_IN_PROGRESS',
        reason: 'Het rad draait al. Wacht tot het rad stilstaat.'
      };
    }

    this.spinningLocks.add(lockKey);
    try {
      const status = this.getWheelStatus(playerId, clientLastSpin);
      if (!status.canSpin || status.timeLeftMs > 0) {
        const mins = Math.floor(status.timeLeftMs / 60000);
        const secs = Math.ceil((status.timeLeftMs % 60000) / 1000);
        return {
          success: false,
          code: 'WHEEL_COOLDOWN',
          reason: `Je kunt het Rad van Fortuin weer draaien over ${mins}m ${secs}s.`,
          wheelStatus: status
        };
      }

      // Cryptographically secure weighted selection
      const roll = crypto.randomInt(0, TOTAL_WHEEL_WEIGHT);
      let cumulative = 0;
      let chosenSegment = WHEEL_SEGMENTS[1]; // Fallback to 250 chips
      for (const seg of WHEEL_SEGMENTS) {
        cumulative += seg.weight;
        if (roll < cumulative) {
          chosenSegment = seg;
          break;
        }
      }

      const now = Date.now();
      this.wheelSpins.set(lockKey, now);
      this.wheelSpins.set(playerId, now);
      player.lastWheelSpin = now;
      if (uKey && this.playerManager.accounts && this.playerManager.accounts.has(uKey)) {
        this.playerManager.accounts.get(uKey).lastWheelSpin = now;
      }

      this.playerManager.addChips(playerId, chosenSegment.amount);
      if (typeof this.playerManager.scheduleSave === 'function') {
        this.playerManager.scheduleSave();
      }

      this._recordTransaction(
        'wheel_spin',
        'Rad van Fortuin',
        player.name,
        chosenSegment.amount,
        `Kwartier-Rad prijs: +${chosenSegment.amount.toLocaleString()} fiches`
      );
      this.saveState();

      return {
        success: true,
        segmentIndex: chosenSegment.index,
        amount: chosenSegment.amount,
        label: chosenSegment.label,
        tier: chosenSegment.tier,
        chips: player.chips,
        lastSpinTime: now,
        wheelStatus: this.getWheelStatus(playerId, now)
      };
    } finally {
      this.spinningLocks.delete(lockKey);
    }
  }

  /**
   * Returns complete banking state for a player (proposals, active loans, debts, wheel status).
   * @param {string} playerId 
   * @returns {Object}
   */
  getPlayerBankData(playerId) {
    const player = this.playerManager.getPlayerById(playerId);
    if (!player) return null;

    // First ensure memory loans are synced from persistent player storage
    this.syncFromPlayerStorage();

    const incomingProposals = [];
    const outgoingProposals = [];

    for (const prop of this.proposals.values()) {
      if (prop.toId === playerId || this._isProposalToMatch(prop, player)) {
        incomingProposals.push(prop);
      } else if (prop.fromId === playerId || this._isProposalFromMatch(prop, player)) {
        outgoingProposals.push(prop);
      }
    }

    const activeDebts = [];
    const activeLoansGiven = [];

    for (const loan of this.loans.values()) {
      if (loan.status === 'active' && !this.repaidLoanIds.has(loan.id)) {
        if (loan.borrowerId === playerId || this._isBorrowerMatch(loan, player)) {
          loan.borrowerId = player.id;
          activeDebts.push(loan);
        } else if (loan.lenderId === playerId || this._isLenderMatch(loan, player)) {
          loan.lenderId = player.id;
          activeLoansGiven.push(loan);
        }
      }
    }

    return {
      incomingProposals,
      outgoingProposals,
      inboxNotifications: this.getPlayerNotifications(player),
      activeDebts,
      activeLoansGiven,
      repaidLoanIds: Array.from(this.repaidLoanIds),
      bailoutStatus: this.getBailoutStatus(playerId),
      wheelStatus: this.getWheelStatus(playerId),
      recentTransactions: this.transactions.filter(t => 
        (t.fromName && t.fromName.toLowerCase() === player.name.toLowerCase()) || 
        (t.toName && t.toName.toLowerCase() === player.name.toLowerCase())
      ).slice(-10)
    };
  }
}

BankManager.WHEEL_SEGMENTS = WHEEL_SEGMENTS;
BankManager.WHEEL_COOLDOWN_MS = WHEEL_COOLDOWN_MS;

module.exports = BankManager;
