/**
 * aviaEngine.js
 * Server-authoritative Single-Player AviaMasters Engine for Monte Carlo Casino.
 *
 * Features:
 * - Cryptographically unbiased outcome selection via crypto.randomInt(0, TOTAL_WEIGHT) (~98.0% RTP).
 * - Coherent physics-ready waypoint flight choreography passing through every sky pickup & rocket.
 * - Full atomic accounting via PlayerManager and automatic BankManager win repayments.
 * - Zero audio, zero Unicode emojis, zero GTA branding.
 */

const crypto = require('crypto');
const {
  MIN_BET,
  MAX_BET,
  VALID_SPEEDS,
  RECENT_HISTORY_LIMIT,
  TOTAL_WEIGHT,
  CARRIER_NAMES,
  DECOY_TOKENS,
  AVIA_OUTCOME_TIERS,
  tok,
  evaluateSequenceMultiplier
} = require('./aviaConstants');

function defaultRandInt(min, maxExclusive) {
  return crypto.randomInt(min, maxExclusive);
}

class AviaEngine {
  /**
   * @param {Object} params
   * @param {import('./playerManager')} params.playerManager
   * @param {import('./bankManager')} [params.bankManager=null]
   * @param {Function} [params.randInt=crypto.randomInt] Deterministic hook for testing
   */
  constructor({ playerManager, bankManager = null, randInt = null } = {}) {
    this.playerManager = playerManager;
    this.bankManager = bankManager;
    this.randInt = typeof randInt === 'function' ? randInt : defaultRandInt;
    this.recentFlights = [];
    this.flightCounter = 0;
  }

  /**
   * Normalizes requested playback speed ('1x', '2x', '4x').
   * @param {string} rawSpeed
   * @returns {'1x'|'2x'|'4x'|null}
   */
  normalizeSpeed(rawSpeed) {
    if (rawSpeed === undefined || rawSpeed === null) return '1x';
    if (typeof rawSpeed !== 'string') return null;
    const clean = rawSpeed.trim().toLowerCase();
    return VALID_SPEEDS.includes(clean) ? clean : null;
  }

  /**
   * Picks a calibrated outcome tier using unbiased weighted draw over TOTAL_WEIGHT.
   * @returns {Object}
   */
  drawOutcomeTier() {
    const roll = this.randInt(0, TOTAL_WEIGHT);
    let cursor = 0;
    for (let i = 0; i < AVIA_OUTCOME_TIERS.length; i += 1) {
      cursor += AVIA_OUTCOME_TIERS[i].weight;
      if (roll < cursor) {
        return AVIA_OUTCOME_TIERS[i];
      }
    }
    return AVIA_OUTCOME_TIERS[0];
  }

  /**
   * Interpolates linear altitude along generated flight trajectory for placing decoys away from path.
   * @param {Array<{ x: number, y: number }>} pts
   * @param {number} worldX
   * @returns {number}
   */
  _samplePathAltitude(pts, worldX) {
    if (!pts || pts.length === 0) return 90;
    if (worldX <= pts[0].x) return pts[0].y;
    for (let i = 1; i < pts.length; i += 1) {
      if (worldX <= pts[i].x) {
        const prev = pts[i - 1];
        const curr = pts[i];
        const span = Math.max(1, curr.x - prev.x);
        const u = (worldX - prev.x) / span;
        return prev.y + (curr.y - prev.y) * u;
      }
    }
    return pts[pts.length - 1].y;
  }

  /**
   * Builds synchronized trajectory waypoints, carriers, collectible events, and visual decoys.
   * @param {Object} params
   * @returns {Object}
   */
  /**
   * Simulates genuine 2D Newtonian flight physics (lift, gravity, deck touch-and-go bounces,
   * carrier landing braking, and open-ocean water splash drag) across multiple carriers.
   * @param {Object} params
   * @returns {Object}
   */
  buildFlightChoreography({ amount, tier, variantKeys, speed }) {
    const tokens = variantKeys.map(tok);
    const DECK_Y = 18;
    const GRAVITY = 38;
    const DT = 0.05; // 20Hz deterministic physics steps (~120–240 smooth points)

    const carriers = [
      {
        index: 0,
        role: 'departure',
        name: CARRIER_NAMES[0],
        deckStart: -45,
        deckEnd: 225,
        centerX: 90
      }
    ];

    const addNonOverlappingCarrier = (deckStart, length, role) => {
      const deckEnd = deckStart + length;
      const minGap = 115;
      for (let c = 0; c < carriers.length; c += 1) {
        const existing = carriers[c];
        if (deckStart < existing.deckEnd + minGap && deckEnd > existing.deckStart - minGap) {
          return null;
        }
      }
      const idx = carriers.length;
      const carrier = {
        index: idx,
        role,
        name: `${CARRIER_NAMES[idx % CARRIER_NAMES.length]}`,
        deckStart: Math.round(deckStart),
        deckEnd: Math.round(deckEnd),
        centerX: Math.round((deckStart + deckEnd) * 0.5)
      };
      carriers.push(carrier);
      return carrier;
    };

    const rawStates = [];
    const events = [];
    let runningMult = 1.0;

    let x = 25;
    let y = DECK_Y;
    let vx = 68;
    let vy = 0;
    let elapsed = 0;
    let nextTokenIdx = 0;
    let airborneTime = 0;
    let nextTokenAirTime = 1.15;
    let touchGoCooldown = 0;
    let phase = 'takeoff';
    let lastTouchCarrierName = CARRIER_NAMES[0];

    const pushState = (p, cName = null, evIdx = -1) => {
      const pitchDeg = p === 'landed' || p === 'takeoff'
        ? (p === 'takeoff' && x > 185 ? -5 : 0)
        : Math.max(-34, Math.min(42, Math.round(-Math.atan2(vy, Math.max(20, vx)) * (180 / Math.PI) * 1.15 * 10) / 10));
      const rx = Math.round(x * 100) / 100;
      const ry = Math.round(y * 100) / 100;
      if (rawStates.length > 0 && (elapsed <= rawStates[rawStates.length - 1].time || rx <= rawStates[rawStates.length - 1].x)) {
        rawStates[rawStates.length - 1] = {
          time: elapsed,
          x: Math.max(rx, rawStates[rawStates.length - 1].x),
          y: ry,
          vx: Math.round(vx),
          pitchDeg,
          phase: p,
          eventIdx: rawStates[rawStates.length - 1].eventIdx !== -1 ? rawStates[rawStates.length - 1].eventIdx : evIdx,
          carrierName: cName || rawStates[rawStates.length - 1].carrierName
        };
        return;
      }
      rawStates.push({
        time: elapsed,
        x: rx,
        y: ry,
        vx: Math.round(vx),
        pitchDeg,
        phase: p,
        eventIdx: evIdx,
        carrierName: cName
      });
    };

    pushState('takeoff', CARRIER_NAMES[0]);

    // Phase 1: Calm horizontal deck acceleration roll -> shallow ski-free liftoff at deck bow
    while (x < carriers[0].deckEnd && rawStates.length < 400) {
      elapsed += DT;
      vx = Math.min(186, vx + 135 * DT);
      x += vx * DT;
      y = DECK_Y;
      pushState('takeoff', CARRIER_NAMES[0]);
    }

    // Smooth liftoff velocity (~16 deg climb angle, gentle arc instead of steep rocket launch)
    vy = 54;
    vx = 188;
    phase = 'climb';

    // Phase 2: Airborne physics across tokens & intermediate touch-and-go carriers
    let maxGuardSteps = 600;
    while (maxGuardSteps > 0) {
      maxGuardSteps -= 1;
      elapsed += DT;
      airborneTime += DT;
      if (touchGoCooldown > 0) touchGoCooldown -= DT;

      vy -= GRAVITY * DT;
      vy = Math.max(-118, Math.min(110, vy));
      x += vx * DT;
      y += vy * DT;

      let triggeredEv = -1;

      // Trigger next token naturally along the aerodynamic trajectory
      if (nextTokenIdx < tokens.length && airborneTime >= nextTokenAirTime && y >= 40) {
        const tk = tokens[nextTokenIdx];
        const multBefore = runningMult;
        if (tk.kind === 'add') {
          runningMult = Math.round((runningMult + tk.value) * 100) / 100;
        } else if (tk.kind === 'mult') {
          runningMult = Math.round((runningMult * tk.value) * 100) / 100;
        } else if (tk.kind === 'rocket') {
          runningMult = Math.round((runningMult * 0.5) * 100) / 100;
        }

        events.push({
          step: nextTokenIdx,
          id: `ev_${nextTokenIdx}`,
          worldX: Math.round(x),
          worldY: Math.round(y),
          kind: tk.kind,
          value: tk.value,
          label: tk.label,
          multBefore,
          multAfter: runningMult,
          counterBefore: Math.round(amount * multBefore),
          counterAfter: Math.round(amount * runningMult)
        });

        triggeredEv = nextTokenIdx;

        // Genuine velocity impulse matching BGaming Aviamasters dynamics
        if (tk.kind === 'add') {
          vy = Math.max(vy + 34, 48);
          vx = Math.min(220, vx + 10);
          phase = 'climb';
        } else if (tk.kind === 'mult') {
          vy = Math.max(vy + 46, 62);
          vx = Math.min(240, vx + 18);
          phase = 'climb';
        } else if (tk.kind === 'rocket') {
          vy = Math.min(vy - 52, -44);
          vx = Math.max(162, vx - 14);
          phase = 'dive';
        }

        nextTokenIdx += 1;
        nextTokenAirTime = airborneTime + 1.05 + (this.randInt(0, 35) / 100);
      }

      // If still collecting tokens and plane glides near sea, bounce cleanly off a Touch & Go carrier
      if (nextTokenIdx < tokens.length && y <= DECK_Y + 4 && vy < 0 && touchGoCooldown <= 0) {
        const tcStart = x - 55;
        const tcShip = addNonOverlappingCarrier(tcStart, 220, 'touchgo');
        if (tcShip) {
          y = DECK_Y;
          lastTouchCarrierName = tcShip.name;
          pushState('touchgo', tcShip.name, triggeredEv);
          // Smooth quick deck skim then catapult off bow
          const skimTargetX = tcShip.deckEnd - 15;
          while (x < skimTargetX && maxGuardSteps > 0) {
            maxGuardSteps -= 1;
            elapsed += DT;
            x += vx * DT;
            y = DECK_Y;
            pushState('touchgo', tcShip.name);
          }
          vy = 60;
          vx = Math.max(190, vx);
          phase = 'climb';
          touchGoCooldown = 1.6;
          continue;
        }
        // If sea already occupied nearby, apply gentle aerodynamic wave-skimming updraft
        y = DECK_Y + 6;
        vy = 52;
        phase = 'climb';
      }

      // Gentle flare on winning flights right before deck touchdown
      if (nextTokenIdx >= tokens.length && tier.landed && y < 44 && vy < -22) {
        vy = Math.min(-14, vy + 78 * DT);
      }

      phase = vy >= 0 ? 'climb' : 'dive';
      pushState(phase, null, triggeredEv);

      // End condition after all tokens have been collected
      if (nextTokenIdx >= tokens.length && airborneTime >= nextTokenAirTime - 0.35) {
        if (tier.landed && y <= DECK_Y) {
          y = DECK_Y;
          let dest = carriers.find(c => c.role === 'destination');
          if (!dest) {
            // Position destination carrier cleanly beneath touchdown point (shifted forward slightly if tight)
            const lastC = carriers[carriers.length - 1];
            const minAllowedStart = lastC.deckEnd + 115;
            const idealStart = Math.max(minAllowedStart, x - 65);
            while (x < idealStart + 55 && maxGuardSteps > 0) {
              maxGuardSteps -= 1;
              elapsed += DT;
              x += vx * DT;
              y = DECK_Y + Math.max(2, (idealStart + 55 - x) * 0.08);
              pushState('approach');
            }
            dest = addNonOverlappingCarrier(idealStart, 250, 'destination');
            if (!dest) {
              dest = {
                index: carriers.length,
                role: 'destination',
                name: CARRIER_NAMES[carriers.length % CARRIER_NAMES.length],
                deckStart: Math.round(x - 50),
                deckEnd: Math.round(x + 205),
                centerX: Math.round(x + 77)
              };
              carriers.push(dest);
            }
          }

          // Smooth arresting-wire brake rollout on destination deck
          y = DECK_Y;
          pushState('landed', dest.name);
          const stopLimitX = dest.deckEnd - 22;
          while (vx > 6 && x < stopLimitX && maxGuardSteps > 0) {
            maxGuardSteps -= 1;
            elapsed += DT;
            vx = Math.max(0, vx * 0.88 - 10 * DT);
            x += vx * DT;
            y = DECK_Y;
            pushState('landed', dest.name);
          }
          break;
        }

        if (!tier.landed && y <= 0) {
          // Ensure splash point happens strictly in open water (avoid overlapping any earlier ship)
          const lastC = carriers[carriers.length - 1];
          if (x < lastC.deckEnd + 65) {
            y = 14;
            vy = Math.max(vy, 28);
            continue;
          }

          // Water surface impact + realistic underwater deceleration & sinking
          y = 0;
          pushState('splash');
          for (let sub = 0; sub < 18; sub += 1) {
            elapsed += DT;
            vx *= 0.87;
            vy = Math.min(-6, vy * 0.82);
            x += vx * DT;
            y = Math.max(-22, y + vy * DT * 0.35);
            pushState('splash');
          }
          break;
        }
      }
    }

    // Add background / ongoing ships across the ocean so sea feels endless ("meerdere boten, er is geen einde")
    const splashX = !tier.landed ? rawStates[rawStates.length - 1].x : null;
    const horizonMaxX = rawStates[rawStates.length - 1].x + 1900;
    const shipStep = 640;
    for (let sx = 540; sx < horizonMaxX; sx += shipStep) {
      const candidateStart = sx + this.randInt(-55, 56);
      // Never place a horizon carrier overlapping an actual open-water splash zone
      if (splashX !== null && candidateStart < splashX + 55 && candidateStart + 220 > splashX - 135) {
        continue;
      }
      addNonOverlappingCarrier(candidateStart, 220, 'horizon');
    }

    carriers.sort((a, b) => a.deckStart - b.deckStart);
    carriers.forEach((c, idx) => {
      c.index = idx;
    });

    const totalTime = Math.max(0.1, rawStates[rawStates.length - 1].time);
    const waypoints = rawStates.map((st) => ({
      t: Math.round((st.time / totalTime) * 10000) / 10000,
      x: st.x,
      y: st.y,
      pitchDeg: st.pitchDeg,
      phase: st.phase,
      eventIdx: st.eventIdx,
      carrierName: st.carrierName || null
    }));

    for (let i = 0; i < events.length; i += 1) {
      const wp = waypoints.find(w => w.eventIdx === events[i].step);
      events[i].progress = wp ? wp.t : (i + 1) / (events.length + 2);
    }

    const lastX = rawStates[rawStates.length - 1].x;
    const decoyCount = 9 + tokens.length * 2;
    const decoys = [];
    for (let d = 0; d < decoyCount; d += 1) {
      const wx = Math.round(280 + ((d + 0.5) / decoyCount) * Math.max(350, lastX - 300) + this.randInt(-28, 29));
      const pathY = this._samplePathAltitude(waypoints, wx);
      const goAbove = pathY < 130 ? (this.randInt(0, 100) < 62) : false;
      const offsetY = goAbove ? this.randInt(55, 118) : -this.randInt(50, Math.max(58, Math.min(100, Math.round(pathY - 22))));
      const wy = Math.max(30, Math.min(245, Math.round(pathY + offsetY)));
      if (Math.abs(wy - pathY) < 42) continue;

      const tkKey = DECOY_TOKENS[this.randInt(0, DECOY_TOKENS.length)];
      const tk = tok(tkKey);
      decoys.push({
        id: `decoy_${d}`,
        worldX: wx,
        worldY: wy,
        kind: tk.kind,
        value: tk.value,
        label: tk.label
      });
    }

    // Play duration directly scaled from true physics flight time (smooth calm pacing)
    const baseDurationMs = Math.round(totalTime * 1120);
    const speedDivisor = speed === '4x' ? 3.0 : (speed === '2x' ? 1.8 : 1);
    const durationMs = Math.max(1500, Math.min(11500, Math.round(baseDurationMs / speedDivisor)));

    return {
      totalDistance: lastX,
      durationMs,
      carriers,
      events,
      decoys,
      waypoints,
      maxAltitudeReached: Math.max(...waypoints.map(w => w.y))
    };
  }

  /**
   * Launches and atomically settles a single-player AviaMasters flight.
   * @param {string} playerId
   * @param {Object} [options={}]
   * @param {number} options.amount
   * @param {'1x'|'2x'|'4x'} [options.speed='1x']
   * @returns {Object}
   */
  startFlight(playerId, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      return { ok: false, code: 'INVALID_PAYLOAD', error: 'Ongeldige vluchtgegevens.' };
    }

    const player = this.playerManager && typeof this.playerManager.getPlayerById === 'function'
      ? this.playerManager.getPlayerById(playerId)
      : null;
    if (!player) {
      return { ok: false, code: 'PLAYER_NOT_FOUND', error: 'Speler niet gevonden. Log eerst in.' };
    }

    const amount = options.amount;
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < MIN_BET || amount > MAX_BET) {
      return {
        ok: false,
        code: 'INVALID_BET',
        error: `Inzet moet een geheel getal zijn tussen ${MIN_BET} en ${MAX_BET.toLocaleString()} fiches.`
      };
    }

    const normalizedSpeed = this.normalizeSpeed(options.speed);
    if (!normalizedSpeed) {
      return {
        ok: false,
        code: 'INVALID_SPEED',
        error: `Ongeldige vluchtsnelheid (kies ${VALID_SPEEDS.join(', ')}).`
      };
    }

    if (player.chips < amount) {
      return {
        ok: false,
        code: 'INSUFFICIENT_FUNDS',
        error: `Onvoldoende fiches (nodig: ${amount.toLocaleString()}, saldo: ${player.chips.toLocaleString()}).`
      };
    }

    const deductRes = this.playerManager.deductChips(playerId, amount);
    if (!deductRes || !deductRes.success) {
      return {
        ok: false,
        code: 'DEDUCT_FAILED',
        error: (deductRes && deductRes.reason) || 'Kon inzet niet afschrijven.'
      };
    }

    const tier = this.drawOutcomeTier();
    const variantIdx = this.randInt(0, tier.variants.length);
    const variantKeys = tier.variants[variantIdx];

    // Cross-check non-splash arithmetic invariant cleanly
    const seqTokens = variantKeys.map(tok);
    const sequenceMult = evaluateSequenceMultiplier(seqTokens);
    const finalMultiplier = tier.landed ? sequenceMult : 0;
    const payout = tier.landed ? Math.round(amount * finalMultiplier) : 0;
    const profit = Math.max(0, payout - amount);

    if (payout > 0) {
      this.playerManager.addChips(playerId, payout);
    }

    const repayments = [];
    if (profit > 0 && this.bankManager && typeof this.bankManager.processWinRepayment === 'function') {
      const reps = this.bankManager.processWinRepayment(playerId, profit) || [];
      if (Array.isArray(reps) && reps.length > 0) {
        repayments.push(...reps);
      }
    }

    if (typeof this.playerManager.updatePlayerStats === 'function') {
      this.playerManager.updatePlayerStats(playerId, { wonAmount: profit });
    } else {
      if (!player.stats) {
        player.stats = { roundsPlayed: 0, totalWon: 0, biggestWin: 0 };
      }
      player.stats.roundsPlayed += 1;
      if (profit > 0) {
        player.stats.totalWon += profit;
        if (profit > (player.stats.biggestWin || 0)) {
          player.stats.biggestWin = profit;
        }
      }
    }

    const choreography = this.buildFlightChoreography({
      amount,
      tier,
      variantKeys,
      speed: normalizedSpeed
    });

    this.flightCounter += 1;
    const flight = {
      id: `avia_${this.flightCounter}_${Date.now()}`,
      playerId: player.id,
      playerName: player.name,
      playerColor: player.color || '#d4af37',
      amount,
      speed: normalizedSpeed,
      tierId: tier.id,
      tierLabel: tier.label,
      badgeClass: tier.badgeClass,
      landed: tier.landed,
      finalMultiplier,
      payout,
      profit,
      netProfit: payout - amount,
      tokens: variantKeys,
      timestamp: Date.now(),
      ...choreography
    };

    const summary = {
      id: flight.id,
      playerId: flight.playerId,
      playerName: flight.playerName,
      playerColor: flight.playerColor,
      amount: flight.amount,
      landed: flight.landed,
      finalMultiplier: flight.finalMultiplier,
      payout: flight.payout,
      tierLabel: flight.tierLabel,
      badgeClass: flight.badgeClass,
      timestamp: flight.timestamp
    };

    this.recentFlights.unshift(summary);
    if (this.recentFlights.length > RECENT_HISTORY_LIMIT) {
      this.recentFlights.length = RECENT_HISTORY_LIMIT;
    }

    if (typeof this.playerManager._persistPlayer === 'function') {
      this.playerManager._persistPlayer(player);
    } else if (typeof this.playerManager.scheduleSave === 'function') {
      this.playerManager.scheduleSave();
    }

    const updatedPlayer = this.playerManager.getPlayerById(playerId) || player;

    return {
      ok: true,
      flight,
      newChips: updatedPlayer.chips,
      stats: updatedPlayer.stats ? { ...updatedPlayer.stats } : null,
      repayments,
      recentFlights: this.getRecentFlights()
    };
  }

  /**
   * Returns shallow copy of recent AviaMasters flights.
   * @returns {Array<Object>}
   */
  getRecentFlights() {
    return this.recentFlights.slice(0, RECENT_HISTORY_LIMIT);
  }

  /**
   * Returns initial public configuration & recent flight history for AviaMasters.
   * @returns {Object}
   */
  getState() {
    return {
      minBet: MIN_BET,
      maxBet: MAX_BET,
      validSpeeds: [...VALID_SPEEDS],
      maxMultiplier: 150,
      recentFlights: this.getRecentFlights()
    };
  }
}

module.exports = AviaEngine;
module.exports.AviaEngine = AviaEngine;
module.exports.MIN_BET = MIN_BET;
module.exports.MAX_BET = MAX_BET;
module.exports.VALID_SPEEDS = VALID_SPEEDS;
