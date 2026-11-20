/**
 * vaultsEngine.js
 * Server-authoritative Monte Carlo Kluizenroof multiplayer elimination engine.
 *
 * Rules:
 *  - Minimum 2 players join the same pot with an identical fixed stake.
 *  - Players start with 5 armored vault doors. Each round, players pick a door
 *    (`maxPerDoor = Math.max(1, aliveCount - 1)` so survivors never wipe out together).
 *  - 1 random vault door triggers the security trap; players inside are eliminated and
 *    that door is permanently sealed (`5 -> 4 -> 3 -> 2` doors remaining).
 *  - Last surviving player wins 98% of the total pot (`HOUSE_RAKE_RATE = 2%`).
 *  - Event-driven timers only run while a match is active (zero idle CPU).
 */

const EventEmitter = require('events');
const {
  STAKE_OPTIONS,
  DEFAULT_STAKE,
  MIN_PLAYERS,
  MAX_PLAYERS,
  HOUSE_RAKE_RATE,
  INITIAL_DOOR_COUNT,
  MIN_DOOR_COUNT,
  LOBBY_COUNTDOWN_MS,
  CHOOSE_DURATION_MS,
  REVEAL_DURATION_MS,
  COMPLETE_HOLD_MS,
  RECENT_WINS_LIMIT,
  PHASES,
  VAULT_DOOR_PROFILES,
  getVaultMonogram,
  isValidStake
} = require('./vaultsConstants');

class VaultsEngine extends EventEmitter {
  /**
   * @param {Object} [options={}]
   * @param {import('./playerManager')} options.playerManager
   * @param {import('./bankManager')|null} [options.bankManager=null]
   * @param {Function} [options.rng=Math.random]
   * @param {number} [options.lobbyCountdownMs=LOBBY_COUNTDOWN_MS]
   * @param {number} [options.chooseDurationMs=CHOOSE_DURATION_MS]
   * @param {number} [options.revealDurationMs=REVEAL_DURATION_MS]
   * @param {number} [options.completeHoldMs=COMPLETE_HOLD_MS]
   * @param {boolean} [options.disableTimers=false]
   */
  constructor(options = {}) {
    super();
    this.playerManager = options.playerManager || null;
    this.bankManager = options.bankManager || null;
    this.rng = typeof options.rng === 'function' ? options.rng : Math.random;

    this.lobbyCountdownMs = Math.max(20, Number(options.lobbyCountdownMs ?? LOBBY_COUNTDOWN_MS));
    this.chooseDurationMs = Math.max(20, Number(options.chooseDurationMs ?? CHOOSE_DURATION_MS));
    this.revealDurationMs = Math.max(20, Number(options.revealDurationMs ?? REVEAL_DURATION_MS));
    this.completeHoldMs = Math.max(20, Number(options.completeHoldMs ?? COMPLETE_HOLD_MS));
    this.disableTimers = Boolean(options.disableTimers);

    this.matchId = 1;
    this.phase = PHASES.WAITING;
    this.stakeAmount = DEFAULT_STAKE;
    this.roundNumber = 0;
    this.activeDoors = Array.from({ length: INITIAL_DOOR_COUNT }, (_, i) => i);
    this.sealedDoors = [];
    this.trappedDoor = null;
    this.phaseEndsAt = 0;

    /** @type {Map<string, Object>} */
    this.participants = new Map();
    /** @type {Map<string, Object>} */
    this.salonPlayers = new Map();

    this.lastRoundSummary = null;
    this.lastWinner = null;
    this.recentWins = [];

    this._phaseTimer = null;
    this._isRunning = false;
  }

  start() {
    this._isRunning = true;
  }

  stop() {
    this._isRunning = false;
    this._clearPhaseTimer();
  }

  _clearPhaseTimer() {
    if (this._phaseTimer) {
      clearTimeout(this._phaseTimer);
      this._phaseTimer = null;
    }
  }

  _schedulePhaseTimer(delayMs, fn) {
    this._clearPhaseTimer();
    if (this.disableTimers) return;
    this._phaseTimer = setTimeout(() => {
      this._phaseTimer = null;
      fn();
    }, Math.max(10, delayMs));
    if (typeof this._phaseTimer.unref === 'function') {
      this._phaseTimer.unref();
    }
  }

  joinSalon(player) {
    if (!player || !player.id) return;
    this.salonPlayers.set(player.id, {
      id: player.id,
      name: player.name,
      color: player.color || '#D4AF37',
      monogram: getVaultMonogram(player.name)
    });
  }

  leaveSalon(playerId) {
    if (!playerId) return;
    this.salonPlayers.delete(playerId);
  }

  handleDisconnect(playerId) {
    if (!playerId) return;
    this.leaveSalon(playerId);
    const entry = this.participants.get(playerId);
    if (!entry) return;

    if (this.phase === PHASES.WAITING || (this.phase === PHASES.LOBBY_COUNTDOWN && this.participants.size <= MIN_PLAYERS)) {
      if (this.playerManager && entry.stake > 0) {
        this.playerManager.addChips(playerId, entry.stake);
      }
      this.participants.delete(playerId);
      if (this.phase === PHASES.LOBBY_COUNTDOWN && this.participants.size < MIN_PLAYERS) {
        this._clearPhaseTimer();
        this.phase = PHASES.WAITING;
        this.phaseEndsAt = 0;
      }
      this.emit('state', this.getPublicState(null));
    }
  }

  getAliveParticipants() {
    return Array.from(this.participants.values()).filter((p) => p.status === 'ALIVE');
  }

  getMaxPerDoor(aliveCount = this.getAliveParticipants().length) {
    return Math.max(1, aliveCount - 1);
  }

  hasActiveBets(playerId) {
    const entry = this.participants.get(playerId);
    if (!entry) return false;
    if (this.phase === PHASES.LOBBY_COUNTDOWN) return true;
    if (this.phase === PHASES.CHOOSING || this.phase === PHASES.REVEALING) {
      return entry.status === 'ALIVE';
    }
    return false;
  }

  getActiveBetTotal(playerId) {
    if (!this.hasActiveBets(playerId)) return 0;
    const entry = this.participants.get(playerId);
    return entry ? entry.stake : 0;
  }

  setStake(playerId, stake) {
    if (this.phase !== PHASES.WAITING) {
      return {
        ok: false,
        code: 'STAKE_LOCKED',
        message: 'De inzet ligt vast zodra de kluizenroof aftelt of bezig is.'
      };
    }
    if (!isValidStake(stake)) {
      return {
        ok: false,
        code: 'INVALID_STAKE',
        message: 'Kies een geldige inzet tussen 100 F en 100.000 F.'
      };
    }
    const cleanStake = Math.floor(Number(stake));
    if (this.participants.size > 1 || (this.participants.size === 1 && !this.participants.has(playerId))) {
      return {
        ok: false,
        code: 'STAKE_LOCKED',
        message: `De inzet staat vast op ${this.stakeAmount.toLocaleString()} F omdat een speler al in de pot zit.`
      };
    }

    const soleEntry = this.participants.get(playerId);
    if (soleEntry && this.playerManager) {
      const diff = cleanStake - soleEntry.stake;
      if (diff > 0) {
        const ded = this.playerManager.deductChips(playerId, diff);
        if (!ded || !ded.success) {
          return {
            ok: false,
            code: 'INSUFFICIENT_CHIPS',
            message: ded && ded.reason ? ded.reason : 'Onvoldoende fiches om de inzet te verhogen.'
          };
        }
      } else if (diff < 0) {
        this.playerManager.addChips(playerId, -diff);
      }
      soleEntry.stake = cleanStake;
    }

    this.stakeAmount = cleanStake;
    const state = this.getPublicState(playerId);
    const updatedPlayer = this.playerManager ? this.playerManager.getPlayerById(playerId) : null;
    this.emit('state', this.getPublicState(null));
    return {
      ok: true,
      stakeAmount: this.stakeAmount,
      remainingChips: updatedPlayer ? updatedPlayer.chips : undefined,
      state
    };
  }

  joinMatch(playerId, requestedStake = null) {
    if (!this.playerManager) {
      return { ok: false, code: 'NO_PLAYER_MANAGER', message: 'Spelerbeheer ontbreekt.' };
    }
    if (this.phase !== PHASES.WAITING && this.phase !== PHASES.LOBBY_COUNTDOWN) {
      return {
        ok: false,
        code: 'MATCH_IN_PROGRESS',
        message: 'Deze ronde is al bezig. Wacht even tot de volgende Kluizenroof start!'
      };
    }
    if (this.participants.has(playerId)) {
      return {
        ok: false,
        code: 'ALREADY_JOINED',
        message: 'Je zit al in deze Kluizenroof pot.'
      };
    }
    if (this.participants.size >= MAX_PLAYERS) {
      return {
        ok: false,
        code: 'MATCH_FULL',
        message: `Maximaal ${MAX_PLAYERS} spelers per kluizenroof.`
      };
    }

    const player = this.playerManager.getPlayerById(playerId);
    if (!player) {
      return { ok: false, code: 'PLAYER_NOT_FOUND', message: 'Speler niet gevonden.' };
    }

    if (this.participants.size === 0 && this.phase === PHASES.WAITING && requestedStake !== null && requestedStake !== undefined) {
      if (!isValidStake(requestedStake)) {
        return { ok: false, code: 'INVALID_STAKE', message: 'Ongeldige inzet gekozen.' };
      }
      this.stakeAmount = Math.floor(Number(requestedStake));
    }

    const ded = this.playerManager.deductChips(playerId, this.stakeAmount);
    if (!ded || !ded.success) {
      return {
        ok: false,
        code: 'INSUFFICIENT_CHIPS',
        message: ded && ded.reason ? ded.reason : `Je hebt minimaal ${this.stakeAmount.toLocaleString()} F nodig om mee te doen.`
      };
    }

    this.participants.set(playerId, {
      playerId,
      name: player.name,
      color: player.color || '#D4AF37',
      monogram: getVaultMonogram(player.name),
      stake: this.stakeAmount,
      status: 'ALIVE',
      chosenDoor: null,
      ready: false,
      eliminatedRound: null
    });

    if (this.participants.size >= MIN_PLAYERS && this.phase === PHASES.WAITING) {
      this.phase = PHASES.LOBBY_COUNTDOWN;
      this.phaseEndsAt = Date.now() + this.lobbyCountdownMs;
      this._schedulePhaseTimer(this.lobbyCountdownMs, () => this._startMatch());
    }

    const updated = this.playerManager.getPlayerById(playerId) || player;
    const state = this.getPublicState(playerId);
    this.emit('state', this.getPublicState(null));
    return {
      ok: true,
      stake: this.stakeAmount,
      remainingChips: updated.chips,
      state
    };
  }

  leaveMatch(playerId) {
    const entry = this.participants.get(playerId);
    if (!entry) {
      return { ok: false, code: 'NOT_IN_MATCH', message: 'Je zit niet in de pot.' };
    }
    if (this.phase !== PHASES.WAITING) {
      return {
        ok: false,
        code: 'CANNOT_LEAVE_STARTED',
        message: 'Je kunt de pot niet verlaten zodra de roof aftelt of gestart is.'
      };
    }
    if (this.playerManager && entry.stake > 0) {
      this.playerManager.addChips(playerId, entry.stake);
    }
    this.participants.delete(playerId);
    const updated = this.playerManager ? this.playerManager.getPlayerById(playerId) : null;
    this.emit('state', this.getPublicState(null));
    return {
      ok: true,
      refunded: entry.stake,
      remainingChips: updated ? updated.chips : undefined,
      state: this.getPublicState(playerId)
    };
  }

  markReady(playerId) {
    if (this.phase !== PHASES.LOBBY_COUNTDOWN) {
      return { ok: false, code: 'WRONG_PHASE', message: 'Starten is alleen mogelijk tijdens de lobby-countdown.' };
    }
    const entry = this.participants.get(playerId);
    if (!entry) {
      return { ok: false, code: 'NOT_IN_MATCH', message: 'Neem eerst deel aan de pot.' };
    }
    entry.ready = true;
    const allReady = this.participants.size >= MIN_PLAYERS &&
      Array.from(this.participants.values()).every((p) => p.ready);
    if (allReady) {
      this._startMatch();
    } else {
      this.emit('state', this.getPublicState(null));
    }
    return { ok: true, startedImmediately: allReady, state: this.getPublicState(playerId) };
  }

  _startMatch() {
    this._clearPhaseTimer();
    if (this.participants.size < MIN_PLAYERS) {
      this.phase = PHASES.WAITING;
      this.phaseEndsAt = 0;
      this.emit('state', this.getPublicState(null));
      return;
    }

    this.phase = PHASES.CHOOSING;
    this.roundNumber = 1;
    this.activeDoors = Array.from({ length: INITIAL_DOOR_COUNT }, (_, i) => i);
    this.sealedDoors = [];
    this.trappedDoor = null;
    this.lastRoundSummary = null;

    for (const p of this.participants.values()) {
      p.status = 'ALIVE';
      p.chosenDoor = null;
      p.eliminatedRound = null;
    }

    this.phaseEndsAt = Date.now() + this.chooseDurationMs;
    this._schedulePhaseTimer(this.chooseDurationMs, () => this._resolveCurrentRound());
    this.emit('state', this.getPublicState(null));
  }

  pickDoor(playerId, doorIndex) {
    if (this.phase !== PHASES.CHOOSING) {
      return { ok: false, code: 'NOT_CHOOSING', message: 'Je kunt nu geen kluisdeur kiezen.' };
    }
    const entry = this.participants.get(playerId);
    if (!entry || entry.status !== 'ALIVE') {
      return { ok: false, code: 'NOT_ALIVE', message: 'Alleen overlevende spelers mogen een kluis kiezen.' };
    }
    const cleanDoor = Number(doorIndex);
    if (!this.activeDoors.includes(cleanDoor)) {
      return { ok: false, code: 'INVALID_DOOR', message: 'Deze kluisdeur is al weggevallen.' };
    }

    const alive = this.getAliveParticipants();
    const maxPerDoor = this.getMaxPerDoor(alive.length);
    const othersInDoor = alive.filter((p) => p.playerId !== playerId && p.chosenDoor === cleanDoor).length;
    if (othersInDoor >= maxPerDoor) {
      return {
        ok: false,
        code: 'DOOR_FULL',
        message: `Deze kluis is vol (max ${maxPerDoor} per kluis zodat er altijd minimaal 1 overleeft). Kies een andere kluis!`
      };
    }

    entry.chosenDoor = cleanDoor;

    const allPicked = alive.every((p) => p.chosenDoor !== null);
    if (allPicked) {
      this._resolveCurrentRound();
    } else {
      this.emit('state', this.getPublicState(null));
    }

    return { ok: true, doorIndex: cleanDoor, state: this.getPublicState(playerId) };
  }

  _assignUndecidedPlayers() {
    const alive = this.getAliveParticipants();
    const maxPerDoor = this.getMaxPerDoor(alive.length);
    for (const p of alive) {
      if (p.chosenDoor !== null && this.activeDoors.includes(p.chosenDoor)) continue;
      const available = this.activeDoors.filter((doorIdx) => {
        const count = alive.filter((o) => o.chosenDoor === doorIdx).length;
        return count < maxPerDoor;
      });
      const pool = available.length > 0 ? available : this.activeDoors;
      const pick = pool[Math.floor(this.rng() * pool.length)];
      p.chosenDoor = pick;
    }
  }

  _resolveCurrentRound() {
    if (this.phase !== PHASES.CHOOSING) return;
    this._clearPhaseTimer();
    this._assignUndecidedPlayers();

    const alive = this.getAliveParticipants();
    if (alive.length <= 1) {
      if (alive.length === 1) {
        this._settleMatchWinner(alive[0]);
      } else {
        this._resetToWaiting();
      }
      return;
    }

    const trappedDoor = this.activeDoors[Math.floor(this.rng() * this.activeDoors.length)];
    const eliminated = alive.filter((p) => p.chosenDoor === trappedDoor);
    const survivors = alive.filter((p) => p.chosenDoor !== trappedDoor);

    for (const loser of eliminated) {
      loser.status = 'ELIMINATED';
      loser.eliminatedRound = this.roundNumber;
      if (this.playerManager && typeof this.playerManager.updatePlayerStats === 'function') {
        this.playerManager.updatePlayerStats(loser.playerId, { wonAmount: 0, lostAmount: loser.stake });
      }
    }

    const trapProfile = VAULT_DOOR_PROFILES[trappedDoor] || { code: `KLUIS ${trappedDoor + 1}`, name: 'Kluis' };
    this.lastRoundSummary = {
      roundNumber: this.roundNumber,
      trappedDoor,
      trappedDoorCode: trapProfile.code,
      trappedDoorName: trapProfile.name,
      eliminatedNames: eliminated.map((e) => e.name),
      survivorCount: survivors.length,
      suddenDeathReplay: eliminated.length === 0
    };

    this.phase = PHASES.REVEALING;
    this.trappedDoor = trappedDoor;
    this.phaseEndsAt = Date.now() + this.revealDurationMs;

    this.emit('round_reveal', {
      matchId: this.matchId,
      ...this.lastRoundSummary,
      state: this.getPublicState(null)
    });
    this.emit('state', this.getPublicState(null));

    this._schedulePhaseTimer(this.revealDurationMs, () => this._advanceAfterReveal());
  }

  _advanceAfterReveal() {
    if (this.phase !== PHASES.REVEALING) return;
    this._clearPhaseTimer();

    const survivors = this.getAliveParticipants();
    if (survivors.length <= 1) {
      if (survivors.length === 1) {
        this._settleMatchWinner(survivors[0]);
      } else {
        this._resetToWaiting();
      }
      return;
    }

    if (this.activeDoors.length > MIN_DOOR_COUNT && this.trappedDoor !== null) {
      const idx = this.activeDoors.indexOf(this.trappedDoor);
      if (idx !== -1) {
        this.activeDoors.splice(idx, 1);
        this.sealedDoors.push({
          doorIndex: this.trappedDoor,
          roundNumber: this.roundNumber
        });
      }
    }

    this.roundNumber += 1;
    this.trappedDoor = null;
    for (const s of survivors) {
      s.chosenDoor = null;
    }

    this.phase = PHASES.CHOOSING;
    this.phaseEndsAt = Date.now() + this.chooseDurationMs;
    this._schedulePhaseTimer(this.chooseDurationMs, () => this._resolveCurrentRound());
    this.emit('state', this.getPublicState(null));
  }

  _settleMatchWinner(winnerEntry) {
    this._clearPhaseTimer();
    winnerEntry.status = 'WINNER';

    const grossPot = Array.from(this.participants.values()).reduce((sum, p) => sum + p.stake, 0);
    const houseRake = Math.floor(grossPot * HOUSE_RAKE_RATE);
    const netPrize = Math.max(0, grossPot - houseRake);
    const netProfit = Math.max(0, netPrize - winnerEntry.stake);

    if (this.playerManager) {
      this.playerManager.addChips(winnerEntry.playerId, netPrize);
    }

    let repayments = [];
    if (netProfit > 0 && this.bankManager && typeof this.bankManager.processWinRepayment === 'function') {
      const repRes = this.bankManager.processWinRepayment(winnerEntry.playerId, netProfit);
      if (Array.isArray(repRes)) {
        repayments = repRes;
      }
    }

    if (this.playerManager && typeof this.playerManager.updatePlayerStats === 'function') {
      this.playerManager.updatePlayerStats(winnerEntry.playerId, { wonAmount: netProfit, lostAmount: 0 });
    }

    const updatedWinner = this.playerManager ? this.playerManager.getPlayerById(winnerEntry.playerId) : null;
    const winRecord = {
      matchId: this.matchId,
      playerId: winnerEntry.playerId,
      playerName: winnerEntry.name,
      playerColor: winnerEntry.color,
      monogram: winnerEntry.monogram,
      stake: winnerEntry.stake,
      grossPot,
      houseRake,
      netPrize,
      participantCount: this.participants.size,
      roundsSurvived: Math.max(1, this.roundNumber),
      timestamp: Date.now()
    };

    this.lastWinner = winRecord;
    this.recentWins.unshift(winRecord);
    if (this.recentWins.length > RECENT_WINS_LIMIT) {
      this.recentWins.length = RECENT_WINS_LIMIT;
    }

    this.phase = PHASES.COMPLETE;
    this.phaseEndsAt = Date.now() + this.completeHoldMs;

    this.emit('match_won', {
      ...winRecord,
      repayments,
      remainingChips: updatedWinner ? updatedWinner.chips : null
    });
    this.emit('state', this.getPublicState(null));

    this._schedulePhaseTimer(this.completeHoldMs, () => this._resetToWaiting());
  }

  _resetToWaiting() {
    this._clearPhaseTimer();
    this.matchId += 1;
    this.phase = PHASES.WAITING;
    this.roundNumber = 0;
    this.activeDoors = Array.from({ length: INITIAL_DOOR_COUNT }, (_, i) => i);
    this.sealedDoors = [];
    this.trappedDoor = null;
    this.lastRoundSummary = null;
    this.phaseEndsAt = 0;
    this.participants.clear();
    this.emit('state', this.getPublicState(null));
  }

  tick(now = Date.now()) {
    if (this.phaseEndsAt <= 0 || now < this.phaseEndsAt) return;
    if (this.phase === PHASES.LOBBY_COUNTDOWN) {
      this._startMatch();
    } else if (this.phase === PHASES.CHOOSING) {
      this._resolveCurrentRound();
    } else if (this.phase === PHASES.REVEALING) {
      this._advanceAfterReveal();
    } else if (this.phase === PHASES.COMPLETE) {
      this._resetToWaiting();
    }
  }

  getPublicState(playerId = null) {
    const alive = this.getAliveParticipants();
    const maxPerDoor = this.getMaxPerDoor(alive.length);
    const allParticipants = Array.from(this.participants.values());
    const grossPot = allParticipants.reduce((sum, p) => sum + p.stake, 0);
    const houseRake = Math.floor(grossPot * HOUSE_RAKE_RATE);
    const netPot = Math.max(0, grossPot - houseRake);
    const sealedMap = new Map(this.sealedDoors.map((s) => [s.doorIndex, s.roundNumber]));

    const showDoorOutcome = this.phase === PHASES.REVEALING || this.phase === PHASES.COMPLETE;
    const doors = VAULT_DOOR_PROFILES.map((profile) => {
      const idx = profile.index;
      const isSealed = sealedMap.has(idx);
      const isActive = this.activeDoors.includes(idx);
      const isTrapped = showDoorOutcome && this.trappedDoor === idx;
      const isSafe = showDoorOutcome && isActive && this.trappedDoor !== null && this.trappedDoor !== idx;

      const occupants = allParticipants
        .filter((p) => p.chosenDoor === idx && (p.status === 'ALIVE' || p.status === 'WINNER' || (p.status === 'ELIMINATED' && p.eliminatedRound === this.roundNumber)))
        .map((p) => ({
          playerId: p.playerId,
          name: p.name,
          color: p.color,
          monogram: p.monogram,
          status: p.status
        }));

      return {
        index: idx,
        code: profile.code,
        name: profile.name,
        accent: profile.accent,
        isActive,
        isSealed,
        sealedAtRound: sealedMap.get(idx) || null,
        isTrapped,
        isSafe,
        occupants,
        capacity: maxPerDoor
      };
    });

    const myEntry = playerId ? this.participants.get(playerId) : null;
    const stakeLocked = !(this.phase === PHASES.WAITING && (this.participants.size === 0 || (this.participants.size === 1 && Boolean(myEntry))));

    return {
      matchId: this.matchId,
      phase: this.phase,
      stakeAmount: this.stakeAmount,
      stakeOptions: STAKE_OPTIONS,
      stakeLocked,
      houseRakeRate: HOUSE_RAKE_RATE,
      grossPot,
      houseRake,
      netPot,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      participantCount: allParticipants.length,
      aliveCount: alive.length,
      maxPerDoor,
      roundNumber: this.roundNumber,
      doorCount: this.activeDoors.length,
      activeDoors: [...this.activeDoors],
      sealedDoors: this.sealedDoors.map((s) => ({ ...s })),
      trappedDoor: showDoorOutcome ? this.trappedDoor : null,
      phaseEndsAt: this.phaseEndsAt,
      secondsRemaining: this.phaseEndsAt > 0 ? Math.max(0, Math.ceil((this.phaseEndsAt - Date.now()) / 1000)) : 0,
      doors,
      participants: allParticipants.map((p) => ({
        playerId: p.playerId,
        name: p.name,
        color: p.color,
        monogram: p.monogram,
        stake: p.stake,
        status: p.status,
        ready: p.ready,
        chosenDoor: p.chosenDoor,
        eliminatedRound: p.eliminatedRound
      })),
      myState: myEntry ? {
        inPot: true,
        status: myEntry.status,
        ready: myEntry.ready,
        chosenDoor: myEntry.chosenDoor,
        stake: myEntry.stake,
        canLeave: this.phase === PHASES.WAITING
      } : {
        inPot: false,
        status: 'SPECTATOR',
        ready: false,
        chosenDoor: null,
        stake: 0,
        canLeave: false
      },
      lastRoundSummary: this.lastRoundSummary,
      lastWinner: this.lastWinner,
      recentWins: this.recentWins.slice(0, RECENT_WINS_LIMIT),
      salonCount: this.salonPlayers.size
    };
  }
}

module.exports = VaultsEngine;
module.exports.VaultsEngine = VaultsEngine;
