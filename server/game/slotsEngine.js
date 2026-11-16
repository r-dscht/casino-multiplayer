/**
 * slotsEngine.js
 * Server-authoritative Multiplayer 5x3 Luxury Slots Engine.
 * Features:
 *  - 8 live multiplayer slot cabinets with real-time floor presence, streaks & cheers
 *  - Cryptographic RNG stop generation on 32-stop reel strips
 *  - 20 fixed paylines with Wild substitution, 3x Free Spins & Sticky Wilds
 *  - Bonus Buy (75x totalBet -> instant 3+ Scatters Free Spins entry)
 *  - Shared Progressive Grand Jackpot (seed 10,000 + 1% contribution per paid spin)
 *  - Shared Multiplayer "Golden Fever" Floor Meter (100% triggers 30s 2x floor multiplier + Golden Wilds)
 *  - BankManager loan win-repayment integration & career player statistics
 */

const EventEmitter = require('events');
const crypto = require('crypto');
const {
  PAYLINES,
  PAYTABLE,
  REEL_STRIPS,
  GOLDEN_FEVER_REEL_STRIPS,
  SCATTER_REWARDS,
  VALID_BETS,
  MIN_BET,
  MAX_BET,
  BONUS_BUY_MULTIPLIER,
  FREE_SPINS_MULTIPLIER,
  GOLDEN_FEVER_MULTIPLIER,
  GOLDEN_FEVER_DURATION_MS,
  JACKPOT_SEED,
  JACKPOT_CONTRIBUTION_RATE,
  NUM_MACHINES,
  MACHINE_NAMES,
  evaluatePayline,
  classifyWinTier,
} = require('./slotsConstants');

const RECENT_WINS_LIMIT = 20;

class SlotsEngine extends EventEmitter {
  /**
   * @param {{ playerManager: Object, bankManager?: Object }} deps
   */
  constructor({ playerManager, bankManager = null } = {}) {
    super();
    this.playerManager = playerManager;
    this.bankManager = bankManager;

    this.jackpotPool = JACKPOT_SEED;
    this.goldenFeverProgress = 0;
    this.goldenFeverEndsAt = 0;
    this.feverTimeout = null;
    this.goldenFeverCount = 0;

    this.spinCounter = 0;
    this.recentBigWins = [];

    /** @type {Array<Object>} 8 Slot floor cabinets (machineId 1..8) */
    this.machines = Array.from({ length: NUM_MACHINES }, (_, idx) => ({
      machineId: idx + 1,
      name: MACHINE_NAMES[idx] || `Kast ${idx + 1}`,
      occupiedBy: null,
      status: 'IDLE', // 'IDLE' | 'SPINNING' | 'FREE_SPINS'
      lastSpinAt: 0,
      lastBet: 0,
      lastWin: 0,
      lastMultiplier: 0,
      lastWinTier: 'NO_WIN',
      winStreak: 0,
      totalSpins: 0,
      lastGrid: null,
      cheersReceived: 0,
    }));

    /** @type {Map<string, number>} playerId -> machineId (1..8) */
    this.playerMachines = new Map();

    /** @type {Map<string, { remaining: number, bet: number, totalBonusWin: number, hasRetriggered: boolean }>} */
    this.playerFreeSpins = new Map();

    /** @type {Map<string, number>} fromPlayerId -> last cheer timestamp */
    this.cheerCooldowns = new Map();
  }

  /**
   * Cleans up timers for graceful server shutdown or test teardown.
   */
  stop() {
    if (this.feverTimeout) {
      clearTimeout(this.feverTimeout);
      this.feverTimeout = null;
    }
  }

  /**
   * Returns true if Golden Fever floor event is currently active.
   * Clears expired fever state lazily if timer hasn't fired yet.
   * @param {number} [now=Date.now()]
   * @returns {boolean}
   */
  isGoldenFeverActive(now = Date.now()) {
    if (this.goldenFeverEndsAt > 0 && now < this.goldenFeverEndsAt) {
      return true;
    }
    if (this.goldenFeverEndsAt > 0 && now >= this.goldenFeverEndsAt) {
      this._endGoldenFever();
    }
    return false;
  }

  /**
   * @private
   */
  _endGoldenFever() {
    this.goldenFeverEndsAt = 0;
    this.goldenFeverProgress = 0;
    if (this.feverTimeout) {
      clearTimeout(this.feverTimeout);
      this.feverTimeout = null;
    }
    this.emit('golden_fever_ended', this.getGoldenFeverState());
  }

  /**
   * Starts Golden Fever for all players on the floor (30s duration).
   * @private
   */
  _triggerGoldenFever(triggeredByPlayer = null) {
    const now = Date.now();
    this.goldenFeverProgress = 100;
    this.goldenFeverEndsAt = now + GOLDEN_FEVER_DURATION_MS;
    this.goldenFeverCount += 1;

    if (this.feverTimeout) {
      clearTimeout(this.feverTimeout);
    }
    this.feverTimeout = setTimeout(() => {
      this._endGoldenFever();
    }, GOLDEN_FEVER_DURATION_MS);
    if (typeof this.feverTimeout.unref === 'function') {
      this.feverTimeout.unref();
    }

    const payload = {
      ...this.getGoldenFeverState(now),
      triggeredBy: triggeredByPlayer ? triggeredByPlayer.name : null,
      feverNumber: this.goldenFeverCount,
    };
    this.emit('golden_fever_started', payload);
  }

  /**
   * Adds charge to the shared Golden Fever meter and activates the floor event at 100%.
   * @private
   */
  _advanceFeverMeter(delta, triggeredByPlayer = null) {
    const now = Date.now();
    if (this.isGoldenFeverActive(now)) return false;
    if (!Number.isFinite(delta) || delta <= 0) return false;

    this.goldenFeverProgress = Math.min(100, Math.round((this.goldenFeverProgress + delta) * 10) / 10);
    if (this.goldenFeverProgress >= 100) {
      this._triggerGoldenFever(triggeredByPlayer);
      return true;
    }
    return false;
  }

  /**
   * Returns snapshot of Golden Fever state.
   * @param {number} [now=Date.now()]
   */
  getGoldenFeverState(now = Date.now()) {
    const active = this.isGoldenFeverActive(now);
    const remainingMs = active ? Math.max(0, this.goldenFeverEndsAt - now) : 0;
    return {
      active,
      progress: active ? 100 : Math.min(100, Math.max(0, this.goldenFeverProgress)),
      multiplier: active ? GOLDEN_FEVER_MULTIPLIER : 1,
      remainingMs,
      endsAt: active ? this.goldenFeverEndsAt : 0,
      durationMs: GOLDEN_FEVER_DURATION_MS,
      feverCount: this.goldenFeverCount,
    };
  }

  /**
   * Assigns or moves a player to a specific slot cabinet (1..8).
   * @param {string} playerId
   * @param {number} machineId
   * @returns {{ ok: boolean, code?: string, error?: string, machineId?: number, machines?: Array<Object> }}
   */
  selectMachine(playerId, machineId) {
    const player = this.playerManager && this.playerManager.getPlayerById(playerId);
    if (!player) {
      return { ok: false, code: 'PLAYER_NOT_FOUND', error: 'Speler niet gevonden.' };
    }

    const idNum = Number(machineId);
    if (!Number.isInteger(idNum) || idNum < 1 || idNum > NUM_MACHINES) {
      return { ok: false, code: 'INVALID_MACHINE', error: `Kies een gokkast tussen 1 en ${NUM_MACHINES}.` };
    }

    const target = this.machines[idNum - 1];
    if (target.occupiedBy && target.occupiedBy.playerId !== playerId) {
      return {
        ok: false,
        code: 'MACHINE_OCCUPIED',
        error: `Kast #${idNum} wordt al bespeeld door ${target.occupiedBy.playerName}.`,
      };
    }

    // Vacate previous machine if switching
    const prevId = this.playerMachines.get(playerId);
    if (prevId && prevId !== idNum) {
      const prev = this.machines[prevId - 1];
      if (prev && prev.occupiedBy && prev.occupiedBy.playerId === playerId) {
        prev.occupiedBy = null;
        prev.status = 'IDLE';
      }
    }

    const freeSpins = this.playerFreeSpins.get(playerId);
    target.occupiedBy = {
      playerId: player.id,
      playerName: player.name,
      playerColor: player.color || '#D4AF37',
      monogram: this._getMonogram(player.name),
    };
    target.status = (freeSpins && freeSpins.remaining > 0) ? 'FREE_SPINS' : 'IDLE';
    this.playerMachines.set(playerId, idNum);

    return {
      ok: true,
      machineId: idNum,
      machines: this.getPublicMachines(),
    };
  }

  /**
   * Ensures a player occupies a machine if one is available on the floor.
   * @param {string} playerId
   * @param {number} [preferredMachineId]
   * @returns {{ ok: boolean, code?: string, error?: string, machineId?: number }}
   */
  ensureMachine(playerId, preferredMachineId = null) {
    const existing = this.playerMachines.get(playerId);
    if (existing) {
      const m = this.machines[existing - 1];
      if (m && m.occupiedBy && m.occupiedBy.playerId === playerId) {
        const p = this.playerManager.getPlayerById(playerId);
        if (p) {
          m.occupiedBy.playerName = p.name;
          m.occupiedBy.playerColor = p.color || '#D4AF37';
          m.occupiedBy.monogram = this._getMonogram(p.name);
        }
        return { ok: true, machineId: existing };
      }
    }

    if (preferredMachineId !== null && preferredMachineId !== undefined) {
      return this.selectMachine(playerId, preferredMachineId);
    }

    const openMachine = this.machines.find((m) => !m.occupiedBy);
    if (!openMachine) {
      return { ok: false, code: 'FLOOR_FULL', error: 'Alle 8 gokkasten zijn momenteel bezet.' };
    }
    return this.selectMachine(playerId, openMachine.machineId);
  }

  /**
   * Releases any slot cabinet currently occupied by the player.
   * @param {string} playerId
   * @returns {boolean}
   */
  leaveMachine(playerId) {
    const machineId = this.playerMachines.get(playerId);
    if (!machineId) return false;
    const machine = this.machines[machineId - 1];
    if (machine && machine.occupiedBy && machine.occupiedBy.playerId === playerId) {
      machine.occupiedBy = null;
      machine.status = 'IDLE';
    }
    this.playerMachines.delete(playerId);
    return true;
  }

  /**
   * Lets a player cheer/hype an occupied cabinet, slightly charging Golden Fever.
   * Rate-limited to once per 2000ms per sender.
   * @param {string} fromPlayerId
   * @param {number} machineId
   */
  cheerMachine(fromPlayerId, machineId) {
    const sender = this.playerManager && this.playerManager.getPlayerById(fromPlayerId);
    if (!sender) {
      return { ok: false, code: 'PLAYER_NOT_FOUND', error: 'Speler niet gevonden.' };
    }

    const idNum = Number(machineId);
    if (!Number.isInteger(idNum) || idNum < 1 || idNum > NUM_MACHINES) {
      return { ok: false, code: 'INVALID_MACHINE', error: 'Ongeldige gokkast.' };
    }

    const target = this.machines[idNum - 1];
    if (!target.occupiedBy) {
      return { ok: false, code: 'EMPTY_MACHINE', error: 'Er zit niemand op deze kast om toe te juichen.' };
    }

    const now = Date.now();
    const lastCheer = this.cheerCooldowns.get(fromPlayerId) || 0;
    if (now - lastCheer < 2000) {
      return { ok: false, code: 'CHEER_COOLDOWN', error: 'Wacht even voor je volgende hype-boost.' };
    }
    this.cheerCooldowns.set(fromPlayerId, now);

    target.cheersReceived += 1;
    const feverTriggered = this._advanceFeverMeter(2.5, sender);

    const payload = {
      machineId: idNum,
      fromPlayerId: sender.id,
      fromPlayerName: sender.name,
      fromPlayerColor: sender.color || '#D4AF37',
      targetPlayerId: target.occupiedBy.playerId,
      targetPlayerName: target.occupiedBy.playerName,
      cheersReceived: target.cheersReceived,
      feverTriggered,
      goldenFever: this.getGoldenFeverState(),
      machines: this.getPublicMachines(),
    };
    this.emit('machine_cheered', payload);

    return { ok: true, ...payload };
  }

  /**
   * Executes one spin (Paid spin, Free Spin, or Bonus Buy) authoritatively on the server.
   * @param {string} playerId
   * @param {{ bet?: number, isBonusBuy?: boolean, machineId?: number }} [payload={}]
   */
  spin(playerId, payload = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, code: 'INVALID_PAYLOAD', error: 'Ongeldig spinverzoek.' };
    }

    const player = this.playerManager && this.playerManager.getPlayerById(playerId);
    if (!player) {
      return { ok: false, code: 'PLAYER_NOT_FOUND', error: 'Speler niet gevonden.' };
    }

    const existingFs = this.playerFreeSpins.get(playerId);
    const inFreeSpins = !!(existingFs && existingFs.remaining > 0);
    const isBonusBuy = !!payload.isBonusBuy;

    if (inFreeSpins && isBonusBuy) {
      return { ok: false, code: 'BONUS_ACTIVE', error: 'Je bent al bezig met een Gratis Spins ronde.' };
    }

    const requestedBet = Number(payload.bet);
    const effectiveBet = inFreeSpins ? existingFs.bet : requestedBet;

    if (!inFreeSpins && (!Number.isInteger(effectiveBet) || !VALID_BETS.includes(effectiveBet))) {
      return {
        ok: false,
        code: 'INVALID_BET',
        error: `Kies een geldige totale inzet tussen ${MIN_BET} en ${MAX_BET.toLocaleString()} fiches.`,
      };
    }

    // Ensure player is seated at a floor machine before deducting chips
    const seatRes = this.ensureMachine(playerId, payload.machineId);
    if (!seatRes.ok) {
      return seatRes;
    }
    const machineId = seatRes.machineId;
    const machine = this.machines[machineId - 1];

    const wager = inFreeSpins ? 0 : (isBonusBuy ? effectiveBet * BONUS_BUY_MULTIPLIER : effectiveBet);

    if (wager > 0) {
      if (player.chips < wager) {
        return {
          ok: false,
          code: 'INSUFFICIENT_FUNDS',
          error: isBonusBuy
            ? `Onvoldoende fiches voor Bonus Buy (${wager.toLocaleString()} nodig).`
            : 'Onvoldoende fiches voor deze draai.',
        };
      }
      const deductRes = this.playerManager.deductChips(playerId, wager);
      if (!deductRes.success) {
        return {
          ok: false,
          code: 'DEDUCT_FAILED',
          error: deductRes.reason || 'Kon inzet niet afschrijven.',
        };
      }

      // 1% of paid bets feed the shared Progressive Grand Jackpot
      this.jackpotPool = Math.round((this.jackpotPool + wager * JACKPOT_CONTRIBUTION_RATE) * 100) / 100;
    }

    const feverActiveBeforeSpin = this.isGoldenFeverActive();
    const strips = feverActiveBeforeSpin ? GOLDEN_FEVER_REEL_STRIPS : REEL_STRIPS;

    // Generate stops & 5x3 grid (every spin lands fresh reels with zero sticky tile locks)
    const { stops, grid } = isBonusBuy
      ? this._generateBonusBuySpin(strips)
      : this._generateRandomSpin(strips);

    const newlyLockedWilds = [];

    // Evaluate all 20 paylines
    const lineBet = effectiveBet / PAYLINES.length;
    const fsMultiplier = inFreeSpins ? FREE_SPINS_MULTIPLIER : 1;
    const feverMultiplier = feverActiveBeforeSpin ? GOLDEN_FEVER_MULTIPLIER : 1;
    const combinedWinMultiplier = fsMultiplier * feverMultiplier;

    const lineWins = [];
    let baseLinePayoutSum = 0;
    let jackpotWon = 0;

    for (let i = 0; i < PAYLINES.length; i++) {
      const pattern = PAYLINES[i];
      const lineSymbols = pattern.map((row, col) => grid[col][row]);
      const evalWin = evaluatePayline(lineSymbols, PAYTABLE);

      if (evalWin.payout > 0) {
        const rawAmount = lineBet * evalWin.payout;
        const boostedAmount = Math.round(rawAmount * combinedWinMultiplier);
        baseLinePayoutSum += boostedAmount;

        lineWins.push({
          lineIndex: i,
          lineNumber: i + 1,
          pattern,
          positions: pattern.slice(0, evalWin.count).map((row, col) => ({ col, row })),
          symbol: evalWin.symbol,
          count: evalWin.count,
          lineMultiplier: evalWin.payout,
          amount: boostedAmount,
          payout: boostedAmount,
        });

        // Progressive Jackpot triggers on Payline 1 (index 0) with 5 CREST or 5 WILD symbols
        if (i === 0 && evalWin.count === 5 && (evalWin.symbol === 'CREST' || evalWin.symbol === 'WILD')) {
          jackpotWon = Math.floor(this.jackpotPool);
          this.jackpotPool = JACKPOT_SEED;
        }
      }
    }

    // Evaluate Scatter triggers (Wilds never substitute for Scatters)
    const scatterPositions = [];
    for (let col = 0; col < 5; col++) {
      for (let row = 0; row < 3; row++) {
        if (grid[col][row] === 'SCATTER') {
          scatterPositions.push({ col, row });
        }
      }
    }
    const scatterCount = scatterPositions.length;
    let freeSpinsAwarded = 0;
    let scatterPayout = 0;
    if (scatterCount >= 3) {
      const rewardKey = Math.min(5, scatterCount);
      const reward = SCATTER_REWARDS[rewardKey];
      if (reward) {
        freeSpinsAwarded = reward.freeSpins;
        scatterPayout = Math.round(effectiveBet * reward.multiplier * feverMultiplier);
      }
    }

    const totalPayout = Math.round(baseLinePayoutSum + scatterPayout + jackpotWon);
    if (totalPayout > 0) {
      this.playerManager.addChips(playerId, totalPayout);
    }

    // Update Free Spins session state (zero sticky wild persistence; max 1 retrigger of +3 spins)
    let nextRemainingFs = inFreeSpins ? existingFs.remaining - 1 : 0;
    const nextStickyWilds = [];
    let hasRetriggered = inFreeSpins ? !!existingFs.hasRetriggered : false;
    let totalBonusWin = inFreeSpins ? existingFs.totalBonusWin + totalPayout : totalPayout;
    let freeSpinsEnded = false;
    let finalBonusSummary = null;

    if (freeSpinsAwarded > 0) {
      if (inFreeSpins) {
        if (!hasRetriggered) {
          nextRemainingFs += 3;
          hasRetriggered = true;
        }
      } else {
        nextRemainingFs = freeSpinsAwarded;
        hasRetriggered = false;
        totalBonusWin = scatterPayout + baseLinePayoutSum;
      }
    }

    if (nextRemainingFs > 0) {
      this.playerFreeSpins.set(playerId, {
        remaining: nextRemainingFs,
        bet: effectiveBet,
        totalBonusWin,
        hasRetriggered,
      });
    } else {
      if (inFreeSpins) {
        freeSpinsEnded = true;
        finalBonusSummary = {
          totalWon: totalBonusWin,
          totalBonusWin,
          lockedWildsCount: 0,
          bet: effectiveBet,
          multiplier: Math.round((totalBonusWin / Math.max(1, effectiveBet)) * 100) / 100,
        };
      }
      this.playerFreeSpins.delete(playerId);
    }

    // Loan auto-repayment when net gain > 0
    const netProfit = Math.max(0, totalPayout - wager);
    let repayments = [];
    if (netProfit > 0 && this.bankManager && typeof this.bankManager.processWinRepayment === 'function') {
      repayments = this.bankManager.processWinRepayment(playerId, netProfit) || [];
    }

    // Career statistics
    let stats = null;
    if (typeof this.playerManager.updatePlayerStats === 'function') {
      stats = this.playerManager.updatePlayerStats(playerId, { wonAmount: netProfit });
    }

    const payoutMultiplier = Math.round((totalPayout / Math.max(1, effectiveBet)) * 100) / 100;
    const winTier = classifyWinTier(totalPayout, effectiveBet, jackpotWon > 0);

    // Update cabinet state on multiplayer floor
    machine.lastSpinAt = Date.now();
    machine.lastBet = effectiveBet;
    machine.lastWin = totalPayout;
    machine.lastMultiplier = payoutMultiplier;
    machine.lastWinTier = winTier;
    machine.totalSpins += 1;
    machine.lastGrid = grid.map((col) => [...col]);
    machine.status = nextRemainingFs > 0 ? 'FREE_SPINS' : 'IDLE';
    machine.winStreak = totalPayout >= effectiveBet ? machine.winStreak + 1 : 0;

    // Anticipation tease reels (slow-motion electric frame on cols 2..4 when 2+ Scatters or 2+ CREST/WILD on line 1 appeared early)
    const anticipationReels = this._computeAnticipationReels(grid);

    // Advance shared Golden Fever floor meter at a steady, bounded pace per spin
    let feverTriggered = false;
    if (!feverActiveBeforeSpin) {
      const feverCharge = isBonusBuy ? 2.5 : (inFreeSpins ? 0.3 : 1);
      feverTriggered = this._advanceFeverMeter(feverCharge, player);
    }

    this.spinCounter += 1;
    const spinId = `slt_${this.spinCounter}_${Date.now()}`;

    // Track recent big wins (>= 10x or jackpot or scatter bonus trigger)
    if (payoutMultiplier >= 10 || jackpotWon > 0 || totalPayout >= 2500) {
      const entry = {
        id: spinId,
        playerId: player.id,
        playerName: player.name,
        playerColor: player.color || '#D4AF37',
        machineId,
        bet: effectiveBet,
        winAmount: totalPayout,
        multiplier: payoutMultiplier,
        winTier,
        jackpotWon,
        timestamp: Date.now(),
      };
      this.recentBigWins.unshift(entry);
      if (this.recentBigWins.length > RECENT_WINS_LIMIT) {
        this.recentBigWins.length = RECENT_WINS_LIMIT;
      }
    }

    if (typeof this.playerManager._persistPlayer === 'function') {
      this.playerManager._persistPlayer(player);
    } else if (typeof this.playerManager.scheduleSave === 'function') {
      this.playerManager.scheduleSave();
    }

    const updatedPlayer = this.playerManager.getPlayerById(playerId) || player;

    return {
      ok: true,
      spinId,
      playerId: player.id,
      playerName: player.name,
      playerColor: player.color || '#D4AF37',
      machineId,
      wager,
      bet: effectiveBet,
      lineBet,
      isBonusBuy,
      wasFreeSpin: inFreeSpins,
      stops,
      grid,
      lineWins,
      scatterPositions,
      scatterCount,
      scatterPayout,
      freeSpinsAwarded,
      freeSpinsRemaining: nextRemainingFs,
      freeSpinsEnded,
      finalBonusSummary,
      totalBonusWin: nextRemainingFs > 0 ? totalBonusWin : (freeSpinsEnded ? totalBonusWin : 0),
      stickyWilds: nextStickyWilds,
      newlyLockedWilds,
      multiplier: combinedWinMultiplier,
      payoutMultiplier,
      winTier,
      jackpotWon,
      jackpotPool: Math.floor(this.jackpotPool),
      totalPayout,
      netProfit,
      newChips: updatedPlayer.chips,
      stats: stats || updatedPlayer.stats || null,
      repayments,
      anticipationReels,
      feverTriggered,
      goldenFever: this.getGoldenFeverState(),
      machines: this.getPublicMachines(),
      recentBigWins: this.getRecentBigWins(),
    };
  }

  /**
   * Computes which reels (2..4) deserve dramatic slow-motion anticipation tease.
   * Triggers when reels 0..k already contain >= 2 SCATTER symbols, OR >= 3 matching CREST/WILD on center row.
   * @private
   */
  _computeAnticipationReels(grid) {
    const tease = [];
    let scattersSoFar = 0;
    let jackpotChain = true;

    for (let col = 0; col < 5; col++) {
      if (col >= 2) {
        if (scattersSoFar >= 2 || (jackpotChain && col >= 3)) {
          tease.push(col);
        }
      }
      if (grid[col].includes('SCATTER')) {
        scattersSoFar += 1;
      }
      const mid = grid[col][1];
      if (mid !== 'CREST' && mid !== 'WILD') {
        jackpotChain = false;
      }
    }
    return tease;
  }

  /**
   * Generates cryptographically uniform stop positions across 5 reels.
   * @private
   */
  _generateRandomSpin(strips) {
    const stops = [];
    const grid = [];
    for (let col = 0; col < 5; col++) {
      const strip = strips[col];
      const topIndex = crypto.randomInt(0, strip.length);
      stops.push(topIndex);
      grid.push([
        strip[topIndex % strip.length],
        strip[(topIndex + 1) % strip.length],
        strip[(topIndex + 2) % strip.length],
      ]);
    }
    return { stops, grid };
  }

  /**
   * Generates stops that land at least 3 SCATTER symbols across distinct columns (for Bonus Buy).
   * @private
   */
  _generateBonusBuySpin(strips) {
    // 85% 3 scatters, 12% 4 scatters, 3% 5 scatters
    const roll = crypto.randomInt(0, 100);
    const scatterColsTarget = roll < 3 ? 5 : (roll < 15 ? 4 : 3);

    const colIndices = [0, 1, 2, 3, 4];
    for (let i = colIndices.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      [colIndices[i], colIndices[j]] = [colIndices[j], colIndices[i]];
    }
    const forcedCols = new Set(colIndices.slice(0, scatterColsTarget));

    const stops = [];
    const grid = [];
    for (let col = 0; col < 5; col++) {
      const strip = strips[col];
      let topIndex;
      if (forcedCols.has(col)) {
        const scatterStops = [];
        for (let idx = 0; idx < strip.length; idx++) {
          const symWindow = [
            strip[idx % strip.length],
            strip[(idx + 1) % strip.length],
            strip[(idx + 2) % strip.length],
          ];
          if (symWindow.includes('SCATTER')) {
            scatterStops.push(idx);
          }
        }
        topIndex = scatterStops[crypto.randomInt(0, scatterStops.length)];
      } else {
        topIndex = crypto.randomInt(0, strip.length);
      }
      stops.push(topIndex);
      grid.push([
        strip[topIndex % strip.length],
        strip[(topIndex + 1) % strip.length],
        strip[(topIndex + 2) % strip.length],
      ]);
    }
    return { stops, grid };
  }

  /**
   * @private
   */
  _getMonogram(name) {
    if (!name || typeof name !== 'string') return '?';
    const clean = name.trim();
    if (!clean) return '?';
    const parts = clean.split(/[\s_\-]+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return clean.slice(0, 2).toUpperCase();
  }

  getPublicMachines() {
    return this.machines.map((m) => ({
      machineId: m.machineId,
      name: m.name,
      occupiedBy: m.occupiedBy ? { ...m.occupiedBy } : null,
      status: m.status,
      lastBet: m.lastBet,
      lastWin: m.lastWin,
      lastMultiplier: m.lastMultiplier,
      lastWinTier: m.lastWinTier,
      winStreak: m.winStreak,
      totalSpins: m.totalSpins,
      lastSpinAt: m.lastSpinAt,
      lastGrid: m.lastGrid ? m.lastGrid.map((c) => [...c]) : null,
      cheersReceived: m.cheersReceived,
    }));
  }

  getRecentBigWins() {
    return this.recentBigWins.slice(0, RECENT_WINS_LIMIT);
  }

  getPlayerBonusState(playerId) {
    const fs = playerId ? this.playerFreeSpins.get(playerId) : null;
    if (!fs || fs.remaining <= 0) {
      return {
        freeSpinsRemaining: 0,
        lockedBet: null,
        stickyWilds: [],
        totalBonusWin: 0,
      };
    }
    return {
      freeSpinsRemaining: fs.remaining,
      lockedBet: fs.bet,
      stickyWilds: [],
      totalBonusWin: fs.totalBonusWin,
    };
  }

  getFloorState(forPlayerId = null) {
    return {
      jackpotPool: Math.floor(this.jackpotPool),
      validBets: [...VALID_BETS],
      minBet: MIN_BET,
      maxBet: MAX_BET,
      bonusBuyMultiplier: BONUS_BUY_MULTIPLIER,
      freeSpinsMultiplier: FREE_SPINS_MULTIPLIER,
      goldenFeverMultiplier: GOLDEN_FEVER_MULTIPLIER,
      paytable: PAYTABLE,
      paylines: PAYLINES,
      reelStrips: REEL_STRIPS,
      goldenFever: this.getGoldenFeverState(),
      machines: this.getPublicMachines(),
      recentBigWins: this.getRecentBigWins(),
      myMachineId: forPlayerId ? (this.playerMachines.get(forPlayerId) || null) : null,
      myBonus: this.getPlayerBonusState(forPlayerId),
    };
  }
}

SlotsEngine.VALID_BETS = VALID_BETS;
SlotsEngine.MIN_BET = MIN_BET;
SlotsEngine.MAX_BET = MAX_BET;
SlotsEngine.BONUS_BUY_MULTIPLIER = BONUS_BUY_MULTIPLIER;
SlotsEngine.NUM_MACHINES = NUM_MACHINES;
SlotsEngine.evaluatePayline = evaluatePayline;

module.exports = SlotsEngine;
