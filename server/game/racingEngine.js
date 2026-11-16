/**
 * racingEngine.js
 * Autoritaire multiplayer race-engine voor Monaco Turf Club (Port Hercule Derby).
 *
 * Kenmerken:
 *  - Simpele, eerlijke opzet: 6 random paarden (1/6 gelijke winstkans, 0 verborgen stats).
 *  - Maximaal 1 inzet per speler per race (enkelvoudige WIN op #1 aan 5.5x).
 *  - Exact 91.67% RTP (8.33% huisvoordeel), geen 3x Gouden Kroon of gratis Jackpot-seed.
 *  - Slimme Multiplayer Klok: wacht rustig in WAITING_FOR_BETS tot de 1e inzet; telt dan af.
 *  - Puur cosmetische hype/cheer met 1500ms cooldown (nul P2W snelheidsvoordeel).
 *  - BankManager aflossingen & PlayerManager statistieken bij uitbetaling.
 */

const EventEmitter = require('events');
const {
  PHASES,
  VALID_BET_TYPES,
  MIN_BET,
  MAX_BET,
  MAX_TICKETS_PER_PLAYER,
  BASE_WIN_ODDS,
  WINNER_POT_LOSER_SHARE,
  WINNER_POT_ROLLOVER_CAP_MULT,
  FIXED_WIN_ODDS,
  BETTING_DURATION_SEC,
  STARTING_DURATION_MS,
  RACE_TARGET_DURATION_MS,
  FINISHED_DURATION_SEC,
  generateRaceCard,
  simulateFairRaceTimeline,
} = require('./racingConstants');

const HISTORY_LIMIT = 20;

class RacingEngine extends EventEmitter {
  /**
   * @param {{ playerManager: Object, bankManager?: Object|null, rng?: Function, bettingDuration?: number, startingDurationMs?: number, raceDurationMs?: number, finishedDuration?: number, tickIntervalMs?: number }} deps
   */
  constructor({
    playerManager,
    bankManager = null,
    rng = Math.random,
    bettingDuration = BETTING_DURATION_SEC,
    startingDurationMs = STARTING_DURATION_MS,
    raceDurationMs = RACE_TARGET_DURATION_MS,
    finishedDuration = FINISHED_DURATION_SEC,
    tickIntervalMs = 150,
    initialWinnerPot = 0,
  } = {}) {
    super();
    this.playerManager = playerManager;
    this.bankManager = bankManager;
    this.rng = typeof rng === 'function' ? rng : Math.random;

    this.bettingDuration = Math.max(1, Number(bettingDuration) || BETTING_DURATION_SEC);
    this.startingDurationMs = Math.max(50, Number(startingDurationMs) || STARTING_DURATION_MS);
    this.raceDurationMs = Math.max(100, Number(raceDurationMs) || RACE_TARGET_DURATION_MS);
    this.finishedDuration = Math.max(1, Number(finishedDuration) || FINISHED_DURATION_SEC);
    this.tickIntervalMs = Math.max(30, Number(tickIntervalMs) || 150);

    this.raceId = 0;
    this.currentPhase = PHASES.WAITING_FOR_BETS;
    this.timeLeft = this.bettingDuration;
    this.track = null;
    this.horses = [];
    this.turboZones = [];
    this.tickets = [];
    this.ticketSeq = 0;

    this.simulation = null;
    this.raceStartTime = 0;
    this.raceProgressPct = 0;
    this.livePositions = {};
    this.liveSpeeds = {};
    this.surgingIds = [];
    this.lastLeaderId = null;
    this.activeCommentary = '';
    this.emittedCommentaries = new Set();
    this.photoFinishActive = false;
    this.settled = false;
    this.lastResult = null;
    this.cheerCooldowns = new Map();
    this.history = [];
    this.winnerPot = Math.max(0, Math.floor(Number(initialWinnerPot) || 0));

    this.phaseTimer = null;
    this.startingTimer = null;
    this.raceTickTimer = null;

    this._prepareNextRace(false);
  }

  /**
   * Ruimt actieve timers netjes op bij shutdown of test-teardown.
   */
  stop() {
    if (this.phaseTimer) {
      clearInterval(this.phaseTimer);
      this.phaseTimer = null;
    }
    if (this.startingTimer) {
      clearTimeout(this.startingTimer);
      this.startingTimer = null;
    }
    if (this.raceTickTimer) {
      clearInterval(this.raceTickTimer);
      this.raceTickTimer = null;
    }
  }

  /**
   * Start een nieuwe racekaart in WAITING_FOR_BETS.
   * @private
   */
  _prepareNextRace(emitPhase = true) {
    this.stop();
    this.raceId += 1;
    const card = generateRaceCard(this.rng);
    this.track = card.track;
    this.horses = card.horses;
    this.turboZones = card.turboZones;

    this.currentPhase = PHASES.WAITING_FOR_BETS;
    this.timeLeft = this.bettingDuration;
    this.tickets = [];
    this.simulation = null;
    this.raceStartTime = 0;
    this.raceProgressPct = 0;
    this.livePositions = {};
    this.liveSpeeds = {};
    this.surgingIds = [];
    this.lastLeaderId = null;
    this.horses.forEach((h) => {
      this.livePositions[h.horseId] = 0;
      this.liveSpeeds[h.horseId] = 0;
    });
    this.emittedCommentaries.clear();
    this.activeCommentary = 'Kies 1 winnaar (3.38x basis + 50% Verliezers Winnaarspot). Klok start bij 1e inzet!';
    this.photoFinishActive = false;
    this.settled = false;
    this.lastResult = null;

    if (emitPhase) {
      this.emit('phase_change', {
        phase: this.currentPhase,
        timeLeft: this.timeLeft,
        state: this.getPublicState(),
      });
    }
  }

  _startBettingCountdown() {
    if (this.currentPhase !== PHASES.WAITING_FOR_BETS) return;
    this.currentPhase = PHASES.BETTING;
    this.timeLeft = this.bettingDuration;
    this.activeCommentary = 'Inzetten geopend! Pak 3.38x basis + 50% Verliezers Winnaarspot!';

    this.emit('phase_change', {
      phase: this.currentPhase,
      timeLeft: this.timeLeft,
      state: this.getPublicState(),
    });

    if (this.phaseTimer) clearInterval(this.phaseTimer);
    this.phaseTimer = setInterval(() => {
      this.timeLeft = Math.max(0, this.timeLeft - 1);
      this.emit('phase_tick', {
        phase: this.currentPhase,
        timeLeft: this.timeLeft,
        raceId: this.raceId,
      });

      if (this.timeLeft === 5) {
        this.activeCommentary = 'Laatste 5 seconden! Paarden stappen de startboxen binnen.';
      }

      if (this.timeLeft <= 0) {
        clearInterval(this.phaseTimer);
        this.phaseTimer = null;
        this._enterStartingPhase();
      }
    }, 1000);
    if (typeof this.phaseTimer.unref === 'function') {
      this.phaseTimer.unref();
    }
  }

  _enterStartingPhase() {
    if (this.phaseTimer) {
      clearInterval(this.phaseTimer);
      this.phaseTimer = null;
    }

    this.currentPhase = PHASES.STARTING;
    this.timeLeft = 0;
    this.simulation = simulateFairRaceTimeline(this.horses, this.rng);
    this.activeCommentary = 'Hekken gesloten! Alle 6 paarden staan klaar voor de start!';

    this.emit('phase_change', {
      phase: this.currentPhase,
      timeLeft: 0,
      state: this.getPublicState(),
    });

    if (this.startingTimer) clearTimeout(this.startingTimer);
    this.startingTimer = setTimeout(() => {
      this.startingTimer = null;
      this._enterRacingPhase();
    }, this.startingDurationMs);
    if (typeof this.startingTimer.unref === 'function') {
      this.startingTimer.unref();
    }
  }

  _enterRacingPhase() {
    this.currentPhase = PHASES.RACING;
    this.timeLeft = 0;
    this.raceStartTime = Date.now();
    this.raceProgressPct = 0;
    this.emittedCommentaries.clear();
    this.lastLeaderId = null;
    this.activeCommentary = 'START! De hekken klappen open op Port Hercule!';

    this.emit('phase_change', {
      phase: this.currentPhase,
      timeLeft: 0,
      state: this.getPublicState(),
    });

    if (this.raceTickTimer) clearInterval(this.raceTickTimer);
    this.raceTickTimer = setInterval(() => {
      this._tickRace();
    }, this.tickIntervalMs);
    if (typeof this.raceTickTimer.unref === 'function') {
      this.raceTickTimer.unref();
    }
  }

  _tickRace() {
    if (this.currentPhase !== PHASES.RACING || !this.simulation) return;

    const elapsedReal = Math.max(0, Date.now() - this.raceStartTime);
    const progressRatio = Math.min(1, elapsedReal / Math.max(80, this.raceDurationMs));
    const simElapsedMs = progressRatio * this.simulation.durationMs;

    const frames = this.simulation.frames;
    let frame = frames[0];
    for (let i = 0; i < frames.length; i += 1) {
      if (frames[i].elapsedMs <= simElapsedMs) {
        frame = frames[i];
      } else {
        break;
      }
    }

    this.livePositions = { ...frame.positions };
    this.liveSpeeds = { ...frame.speeds };
    this.surgingIds = Array.isArray(frame.surgingIds) ? [...frame.surgingIds] : [];
    const sorted = this._getSortedLeaderboard(this.livePositions);
    const leader = sorted[0];
    const second = sorted[1];

    const leaderPct = leader ? Math.min(100, Math.round(leader.pos)) : 0;
    this.raceProgressPct = Math.max(leaderPct, Math.round(progressRatio * 100));

    if (leader && leader.pos >= 82 && second && (leader.pos - second.pos) <= 2.4) {
      this.photoFinishActive = true;
    }

    if (leader) {
      if (
        this.lastLeaderId &&
        this.lastLeaderId !== leader.horseId &&
        leader.pos >= 18 &&
        leader.pos <= 92 &&
        !this.emittedCommentaries.has(`lead_${leader.horseId}_${Math.floor(leader.pos / 25)}`)
      ) {
        this.emittedCommentaries.add(`lead_${leader.horseId}_${Math.floor(leader.pos / 25)}`);
        this.activeCommentary = `INHAALACTIE! #${leader.horseId} ${leader.name} pakt nu de leiding!`;
      } else if (leader.pos >= 34 && leader.pos < 52 && !this.emittedCommentaries.has('midsprint')) {
        this.emittedCommentaries.add('midsprint');
        const sprinter = this.horses.find((h) => this.surgingIds.includes(h.horseId)) || leader;
        this.activeCommentary = `MID-SPRINTPOORT! #${sprinter.horseId} ${sprinter.name} trekt keihard door!`;
      } else if (leader.pos >= 68 && !this.emittedCommentaries.has('eindsprint')) {
        this.emittedCommentaries.add('eindsprint');
        this.activeCommentary = `EINDSPRINT! #${leader.horseId} ${leader.name} leidt richting de finish!`;
      } else if (this.photoFinishActive && !this.emittedCommentaries.has('photo')) {
        this.emittedCommentaries.add('photo');
        this.activeCommentary = `NEK-AAN-NEK PHOTO FINISH! #${leader.horseId} en #${second.horseId} vliegen op de streep af!`;
      }
      this.lastLeaderId = leader.horseId;
    }

    this.emit('tick', {
      raceId: this.raceId,
      progressPct: this.raceProgressPct,
      positions: this.livePositions,
      speeds: this.liveSpeeds,
      surgingIds: this.surgingIds,
      photoFinishActive: this.photoFinishActive,
      commentary: this.activeCommentary,
    });

    if (progressRatio >= 1) {
      this._finishRace();
    }
  }

  _getSortedLeaderboard(positionsMap) {
    return this.horses
      .map((h) => ({
        horseId: h.horseId,
        name: h.name,
        silkColor: h.silkColor,
        pos: Number(positionsMap[h.horseId] || 0),
      }))
      .sort((a, b) => b.pos - a.pos);
  }

  /**
   * Rondt de race af, betaalt winnende WIN tickets uit (3.38x + Winnaarspot) en start volgende ronde.
   * @private
   */
  _finishRace() {
    if (this.settled) return;
    this.settled = true;

    if (this.raceTickTimer) {
      clearInterval(this.raceTickTimer);
      this.raceTickTimer = null;
    }

    const sim = this.simulation || simulateFairRaceTimeline(this.horses, this.rng);
    const finishingOrder = sim.finishingOrder;
    const winnerId = finishingOrder[0];
    const winnerHorse = this.horses.find((h) => h.horseId === winnerId) || this.horses[0];

    const lastFrame = sim.frames[sim.frames.length - 1];
    if (lastFrame) {
      this.livePositions = { ...lastFrame.positions };
    }
    this.surgingIds = [];
    this.raceProgressPct = 100;

    const podium = finishingOrder.slice(0, 3).map((horseId, idx) => {
      const h = this.horses.find((x) => x.horseId === horseId);
      return {
        rank: idx + 1,
        horseId,
        name: h ? h.name : `Paard #${horseId}`,
        jockey: h ? h.jockey : '',
        silkColor: h ? h.silkColor : '#d4af37',
        silkAccent: h ? h.silkAccent : '#ffffff',
        silkPattern: h ? h.silkPattern : 'sash',
        coatColor: h ? h.coatColor : '#7c3f1d',
        winOdds: BASE_WIN_ODDS,
        finishTimeMs: sim.finishTimes ? sim.finishTimes[horseId] : 0,
      };
    });

    const totalWagered = this.tickets.reduce((sum, t) => sum + t.amount, 0);
    const winningTickets = this.tickets.filter((t) => t.horseId === winnerId);
    const winningTotal = winningTickets.reduce((sum, t) => sum + t.amount, 0);
    const losingTotal = totalWagered - winningTotal;
    const inRacePotAddition = Math.floor(losingTotal * WINNER_POT_LOSER_SHARE);
    const casinoCut = losingTotal - inRacePotAddition;
    const winnerPotBefore = this.winnerPot;

    let rolloverUsed = 0;
    let potDistributed = 0;
    const potShareByTicketId = new Map();

    if (winningTotal === 0) {
      this.winnerPot += inRacePotAddition;
    } else {
      rolloverUsed = Math.min(this.winnerPot, Math.floor(winningTotal * WINNER_POT_ROLLOVER_CAP_MULT));
      this.winnerPot -= rolloverUsed;
      const availablePot = inRacePotAddition + rolloverUsed;

      if (availablePot > 0 && winningTickets.length > 0) {
        const shares = winningTickets.map((t, index) => {
          const exact = (availablePot * t.amount) / winningTotal;
          const floored = Math.floor(exact);
          return { ticketId: t.ticketId, floored, frac: exact - floored, index };
        });
        const assigned = shares.reduce((acc, s) => acc + s.floored, 0);
        let remainder = availablePot - assigned;
        const sortedByFrac = [...shares].sort((a, b) => (b.frac - a.frac) || (a.index - b.index));
        for (let k = 0; k < sortedByFrac.length && remainder > 0; k += 1) {
          sortedByFrac[k].floored += 1;
          remainder -= 1;
        }
        shares.forEach((s) => {
          potShareByTicketId.set(s.ticketId, s.floored);
          potDistributed += s.floored;
        });
      }
    }

    const effectiveWinOdds = winningTotal > 0
      ? Math.round(((Math.floor(winningTotal * BASE_WIN_ODDS) + potDistributed) / winningTotal) * 100) / 100
      : BASE_WIN_ODDS;

    const settledByPlayer = new Map();
    const ticketSettlements = this.tickets.map((tkt) => {
      const isWin = tkt.horseId === winnerId;
      const baseReturn = isWin ? Math.floor(tkt.amount * BASE_WIN_ODDS) : 0;
      const potBonus = isWin ? (potShareByTicketId.get(tkt.ticketId) || 0) : 0;
      const grossReturn = baseReturn + potBonus;
      const ticketEffOdds = isWin && tkt.amount > 0
        ? Math.round((grossReturn / tkt.amount) * 100) / 100
        : 0;

      if (!settledByPlayer.has(tkt.playerId)) {
        settledByPlayer.set(tkt.playerId, {
          playerId: tkt.playerId,
          playerName: tkt.playerName,
          tickets: [],
          totalStaked: 0,
          totalReturned: 0,
          baseReturnTotal: 0,
          potBonusTotal: 0,
          bestMultiplier: 0,
        });
      }

      const agg = settledByPlayer.get(tkt.playerId);
      agg.totalStaked += tkt.amount;
      agg.totalReturned += grossReturn;
      agg.baseReturnTotal += baseReturn;
      agg.potBonusTotal += potBonus;
      if (isWin && ticketEffOdds > agg.bestMultiplier) {
        agg.bestMultiplier = ticketEffOdds;
      }

      const item = {
        ...tkt,
        won: isWin,
        baseReturn,
        potBonus,
        effectiveOdds: ticketEffOdds,
        payout: grossReturn,
      };
      agg.tickets.push(item);
      return item;
    });

    const settlements = [];
    settledByPlayer.forEach((pAgg) => {
      const netProfit = Math.max(0, pAgg.totalReturned - pAgg.totalStaked);
      if (pAgg.totalReturned > 0 && this.playerManager && typeof this.playerManager.addChips === 'function') {
        this.playerManager.addChips(pAgg.playerId, pAgg.totalReturned);
      }

      let repayments = [];
      if (netProfit > 0 && this.bankManager && typeof this.bankManager.processWinRepayment === 'function') {
        repayments = this.bankManager.processWinRepayment(pAgg.playerId, netProfit) || [];
      }

      let stats = null;
      if (this.playerManager && typeof this.playerManager.updatePlayerStats === 'function') {
        stats = this.playerManager.updatePlayerStats(pAgg.playerId, { wonAmount: netProfit });
      }

      const playerObj = this.playerManager && this.playerManager.getPlayerById(pAgg.playerId);
      if (playerObj && typeof this.playerManager._persistPlayer === 'function') {
        this.playerManager._persistPlayer(playerObj);
      }

      settlements.push({
        playerId: pAgg.playerId,
        playerName: pAgg.playerName,
        totalStaked: pAgg.totalStaked,
        totalReturned: pAgg.totalReturned,
        baseReturnTotal: pAgg.baseReturnTotal,
        potBonusTotal: pAgg.potBonusTotal,
        netProfit,
        bestMultiplier: Math.round(pAgg.bestMultiplier * 100) / 100,
        tickets: pAgg.tickets,
        repayments,
        newChips: playerObj ? playerObj.chips : null,
        stats,
      });
    });

    this.photoFinishActive = sim.isPhotoFinish;
    let potNote = `(${BASE_WIN_ODDS.toFixed(1)}x basis)`;
    if (winningTickets.length > 0 && potDistributed > 0) {
      potNote = `(${effectiveWinOdds.toFixed(2)}x incl. +${potDistributed.toLocaleString()} F Winnaarspot over ${winningTickets.length} winnaar${winningTickets.length > 1 ? 's' : ''}!)`;
    } else if (totalWagered > 0 && winningTickets.length === 0) {
      potNote = `(0 winnaars: +${inRacePotAddition.toLocaleString()} F naar Winnaarspot -> ${this.winnerPot.toLocaleString()} F!)`;
    }

    this.activeCommentary = sim.isPhotoFinish
      ? `PHOTO FINISH! #${winnerHorse.horseId} ${winnerHorse.name} wint met ${(sim.marginMs / 1000).toFixed(3)}s verschil ${potNote}`
      : `FINISH! #${winnerHorse.horseId} ${winnerHorse.name} wint ${potNote}`;

    this.currentPhase = PHASES.FINISHED;
    this.timeLeft = this.finishedDuration;

    this.lastResult = {
      raceId: this.raceId,
      track: this.track,
      finishingOrder,
      finishTimes: sim.finishTimes,
      marginMs: sim.marginMs,
      isPhotoFinish: sim.isPhotoFinish,
      podium,
      winnerHorseId: winnerHorse.horseId,
      winnerName: winnerHorse.name,
      winnerSilk: winnerHorse.silkColor,
      winOdds: effectiveWinOdds,
      baseWinOdds: BASE_WIN_ODDS,
      totalWagered,
      winningTotal,
      losingTotal,
      winnerCount: winningTickets.length,
      inRacePotAddition,
      rolloverUsed,
      potDistributed,
      casinoCut,
      winnerPotBefore,
      winnerPotAfter: this.winnerPot,
      ticketSettlements,
      settlements,
    };

    this.history.unshift({
      raceId: this.raceId,
      winnerHorseId: winnerHorse.horseId,
      winnerName: winnerHorse.name,
      winnerSilk: winnerHorse.silkColor,
      winOdds: effectiveWinOdds,
      potDistributed,
      winnerCount: winningTickets.length,
      isPhotoFinish: sim.isPhotoFinish,
      marginMs: sim.marginMs,
      trackLabel: this.track.label,
    });
    if (this.history.length > HISTORY_LIMIT) {
      this.history.length = HISTORY_LIMIT;
    }

    this.emit('race_finished', this.lastResult);
    this.emit('phase_change', {
      phase: this.currentPhase,
      timeLeft: this.timeLeft,
      state: this.getPublicState(),
    });

    if (this.phaseTimer) clearInterval(this.phaseTimer);
    this.phaseTimer = setInterval(() => {
      this.timeLeft = Math.max(0, this.timeLeft - 1);
      this.emit('phase_tick', {
        phase: this.currentPhase,
        timeLeft: this.timeLeft,
        raceId: this.raceId,
      });

      if (this.timeLeft <= 0) {
        clearInterval(this.phaseTimer);
        this.phaseTimer = null;
        this._prepareNextRace(true);
      }
    }, 1000);
    if (typeof this.phaseTimer.unref === 'function') {
      this.phaseTimer.unref();
    }
  }

  /**
   * Plaatst maximaal 1 WIN-inzet (3.38x basis + Winnaarspot) voor de huidige race.
   * @param {string} playerId
   * @param {{ horseId: number, betType?: string, amount: number }} payload
   */
  placeBet(playerId, { horseId, betType = 'WIN', amount } = {}) {
    const player = this.playerManager && this.playerManager.getPlayerById(playerId);
    if (!player) {
      return { ok: false, code: 'PLAYER_NOT_FOUND', error: 'Speler niet gevonden.' };
    }

    if (![PHASES.WAITING_FOR_BETS, PHASES.BETTING].includes(this.currentPhase)) {
      return { ok: false, code: 'BETTING_CLOSED', error: 'Inzetten zijn gesloten voor deze race.' };
    }

    const normalizedType = String(betType || 'WIN').toUpperCase().trim();
    const mappedType = normalizedType === 'WINNAAR' ? 'WIN' : normalizedType;
    if (!VALID_BET_TYPES.includes(mappedType)) {
      return {
        ok: false,
        code: 'INVALID_BET_TYPE',
        error: `Alleen enkelvoudige WIN-inzet (${BASE_WIN_ODDS.toFixed(2)}x basis + 50% Winnaarspot) is beschikbaar.`,
      };
    }

    const horseIdNum = Number(horseId);
    const horse = this.horses.find((h) => h.horseId === horseIdNum);
    if (!horse) {
      return { ok: false, code: 'INVALID_HORSE', error: 'Ongeldig gekozen paard.' };
    }

    const cleanAmount = Number(amount);
    if (!Number.isInteger(cleanAmount) || cleanAmount < MIN_BET || cleanAmount > MAX_BET) {
      return { ok: false, code: 'INVALID_BET', error: `Inzet moet tussen ${MIN_BET} en ${MAX_BET.toLocaleString()} fiches liggen.` };
    }

    const playerTickets = this.tickets.filter((t) => t.playerId === playerId);
    if (playerTickets.length >= MAX_TICKETS_PER_PLAYER) {
      return { ok: false, code: 'TICKET_LIMIT_REACHED', error: `Maximaal ${MAX_TICKETS_PER_PLAYER} inzet per race.` };
    }

    if (player.chips < cleanAmount) {
      return { ok: false, code: 'INSUFFICIENT_FUNDS', error: 'Onvoldoende fiches voor deze inzet.' };
    }

    const deductRes = this.playerManager.deductChips(playerId, cleanAmount);
    if (!deductRes || !deductRes.success) {
      return { ok: false, code: 'DEDUCT_FAILED', error: 'Kon inzet niet afschrijven.' };
    }

    this.ticketSeq += 1;
    const potentialPayout = Math.floor(cleanAmount * BASE_WIN_ODDS);

    const ticket = {
      ticketId: `tkt_${this.raceId}_${this.ticketSeq}`,
      raceId: this.raceId,
      playerId: player.id,
      playerName: player.name,
      playerColor: player.color || '#d4af37',
      monogram: this._getMonogram(player.name),
      horseId: horse.horseId,
      horseName: horse.name,
      silkColor: horse.silkColor,
      betType: 'WIN',
      lockedOdds: BASE_WIN_ODDS,
      potentialPayout,
      amount: cleanAmount,
      createdAt: Date.now(),
    };

    this.tickets.push(ticket);

    if (typeof this.playerManager._persistPlayer === 'function') {
      this.playerManager._persistPlayer(player);
    }

    const startedCountdown = this.currentPhase === PHASES.WAITING_FOR_BETS;
    if (startedCountdown) {
      this._startBettingCountdown();
    }

    const totalRacePool = this._getTotalRacePool();
    this.emit('bet_placed', {
      ticket,
      tickets: this.getPublicTickets(),
      phase: this.currentPhase,
      timeLeft: this.timeLeft,
      startedCountdown,
      winnerPot: this.winnerPot,
      totalRacePool,
    });

    return {
      ok: true,
      ticket,
      newChips: player.chips,
      tickets: this.getPublicTickets(),
      phase: this.currentPhase,
      timeLeft: this.timeLeft,
      startedCountdown,
      winnerPot: this.winnerPot,
      totalRacePool,
    };
  }

  /**
   * Annuleert het actieve ticket tijdens de inzetfase en stort de fiches terug.
   * @param {string} playerId
   * @param {string} ticketId
   */
  cancelBet(playerId, ticketId) {
    const player = this.playerManager && this.playerManager.getPlayerById(playerId);
    if (!player) {
      return { ok: false, code: 'PLAYER_NOT_FOUND', error: 'Speler niet gevonden.' };
    }

    if (![PHASES.WAITING_FOR_BETS, PHASES.BETTING].includes(this.currentPhase)) {
      return { ok: false, code: 'BETTING_CLOSED', error: 'Hekken gaan sluiten; ticket kan niet meer geannuleerd worden.' };
    }

    const idx = this.tickets.findIndex((t) => t.ticketId === ticketId && t.playerId === playerId);
    if (idx === -1) {
      return { ok: false, code: 'TICKET_NOT_FOUND', error: 'Ticket niet gevonden.' };
    }

    const [removed] = this.tickets.splice(idx, 1);
    this.playerManager.addChips(playerId, removed.amount);

    if (typeof this.playerManager._persistPlayer === 'function') {
      this.playerManager._persistPlayer(player);
    }

    const totalRacePoolAfterCancel = this._getTotalRacePool();
    this.emit('bet_cancelled', {
      ticket: removed,
      tickets: this.getPublicTickets(),
      winnerPot: this.winnerPot,
      totalRacePool: totalRacePoolAfterCancel,
    });

    if (this.tickets.length === 0 && this.currentPhase === PHASES.BETTING) {
      if (this.phaseTimer) {
        clearInterval(this.phaseTimer);
        this.phaseTimer = null;
      }
      this.currentPhase = PHASES.WAITING_FOR_BETS;
      this.timeLeft = this.bettingDuration;
      this.activeCommentary = 'Kies 1 winnaar (3.38x basis + 50% Verliezers Winnaarspot). Klok start bij 1e inzet!';
      this.emit('phase_change', {
        phase: this.currentPhase,
        timeLeft: this.timeLeft,
        state: this.getPublicState(),
      });
    }

    return {
      ok: true,
      cancelledTicket: removed,
      newChips: player.chips,
      tickets: this.getPublicTickets(),
      phase: this.currentPhase,
      timeLeft: this.timeLeft,
    };
  }

  /**
   * Puur cosmetische aanmoediging (1500ms cooldown, nul snelheidseffect).
   * @param {string} playerId
   * @param {number} horseId
   */
  cheerHorse(playerId, horseId) {
    const player = this.playerManager && this.playerManager.getPlayerById(playerId);
    if (!player) {
      return { ok: false, code: 'PLAYER_NOT_FOUND', error: 'Speler niet gevonden.' };
    }

    const idNum = Number(horseId);
    const horse = this.horses.find((h) => h.horseId === idNum);
    if (!horse) {
      return { ok: false, code: 'INVALID_HORSE', error: 'Ongeldig paard.' };
    }

    const now = Date.now();
    const last = this.cheerCooldowns.get(playerId) || 0;
    if (now - last < 1500) {
      return { ok: false, code: 'CHEER_COOLDOWN', error: 'Wacht even voor je volgende aanmoediging.' };
    }
    this.cheerCooldowns.set(playerId, now);

    horse.cheers += 1;

    const evt = {
      raceId: this.raceId,
      horseId: horse.horseId,
      horseName: horse.name,
      fromPlayerId: player.id,
      fromPlayerName: player.name,
      fromPlayerColor: player.color || '#d4af37',
      monogram: this._getMonogram(player.name),
      cheers: horse.cheers,
      timestamp: now,
    };
    this.emit('horse_cheered', evt);
    return { ok: true, ...evt };
  }

  hasActiveBets(playerId) {
    if (!playerId) return false;
    if (this.currentPhase === PHASES.FINISHED) return false;
    return this.tickets.some((t) => t.playerId === playerId);
  }

  getActiveBetTotal(playerId) {
    if (!playerId || this.currentPhase === PHASES.FINISHED) return 0;
    return this.tickets
      .filter((t) => t.playerId === playerId)
      .reduce((sum, t) => sum + t.amount, 0);
  }

  getPublicTickets() {
    return this.tickets.map((t) => ({ ...t }));
  }

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

  /** @private */
  _getTotalRacePool() {
    return this.tickets.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  }

  getPublicState(forPlayerId = null) {
    return {
      raceId: this.raceId,
      phase: this.currentPhase,
      timeLeft: this.timeLeft,
      bettingDuration: this.bettingDuration,
      minBet: MIN_BET,
      maxBet: MAX_BET,
      maxTicketsPerPlayer: MAX_TICKETS_PER_PLAYER,
      baseWinOdds: BASE_WIN_ODDS,
      winnerLoserShare: WINNER_POT_LOSER_SHARE,
      winnerRolloverCapMult: WINNER_POT_ROLLOVER_CAP_MULT,
      fixedWinOdds: BASE_WIN_ODDS,
      winnerPot: this.winnerPot,
      totalRacePool: this._getTotalRacePool(),
      track: this.track,
      horses: this.horses.map((h) => ({ ...h })),
      turboZones: this.turboZones,
      tickets: this.getPublicTickets(),
      myTickets: forPlayerId ? this.tickets.filter((t) => t.playerId === forPlayerId).map((t) => ({ ...t })) : [],
      livePositions: { ...this.livePositions },
      liveSpeeds: { ...this.liveSpeeds },
      surgingIds: [...this.surgingIds],
      progressPct: this.raceProgressPct,
      photoFinishActive: this.photoFinishActive,
      commentary: this.activeCommentary,
      result: this.currentPhase === PHASES.FINISHED ? this.lastResult : null,
      history: this.history.slice(0, HISTORY_LIMIT),
    };
  }
}

RacingEngine.PHASES = PHASES;
RacingEngine.MIN_BET = MIN_BET;
RacingEngine.MAX_BET = MAX_BET;
RacingEngine.MAX_TICKETS_PER_PLAYER = MAX_TICKETS_PER_PLAYER;
RacingEngine.BASE_WIN_ODDS = BASE_WIN_ODDS;
RacingEngine.WINNER_POT_LOSER_SHARE = WINNER_POT_LOSER_SHARE;
RacingEngine.FIXED_WIN_ODDS = FIXED_WIN_ODDS;

module.exports = RacingEngine;
