/**
 * pokerPotManager.js
 * Authoritative Side Pot Calculation Engine, Dead Money Retention, Uncalled Bet Refunding,
 * and Clockwise Odd-Chip Allocation from Dealer Button.
 */

const { NUM_SEATS } = require('./pokerConstants');
const { compareHands } = require('./pokerRules');

/**
 * Calculates distance clockwise from dealer button.
 * The seat directly clockwise from button (button + 1) has priority 0 (first).
 * The button seat itself has priority numSeats - 1 (last).
 * @param {number} seatIndex
 * @param {number} dealerButtonSeat
 * @param {number} [numSeats=6]
 * @returns {number}
 */
function getClockwisePriority(seatIndex, dealerButtonSeat, numSeats = NUM_SEATS) {
  return (seatIndex - dealerButtonSeat - 1 + numSeats) % numSeats;
}

/**
 * Pure function: Partitions all player contributions into Main Pot and Side Pots.
 * Handles unequal all-ins, retains folded dead money, and identifies uncalled bet refunds.
 * @param {Array<{ id: string, seatIndex: number, totalCommitted: number, isFolded: boolean, isAllIn: boolean }>} players
 * @returns {Array<{ potId: number, amount: number, eligiblePlayerIds: string[], isRefund?: boolean }>}
 */
function calculateSidePots(players) {
  if (!Array.isArray(players) || players.length === 0) return [];

  // Filter players who contributed chips
  const contributors = players.filter(p => p && p.totalCommitted > 0);
  if (contributors.length === 0) return [];

  // Distinct all-in contribution levels for active (non-folded) players, ascending
  const allInLevels = Array.from(
    new Set(
      contributors
        .filter(p => p.isAllIn && !p.isFolded)
        .map(p => p.totalCommitted)
    )
  ).sort((a, b) => a - b);

  // Highest commitment made by any player
  const maxCommitment = Math.max(...contributors.map(p => p.totalCommitted));
  const tiers = [...allInLevels];
  if (!tiers.includes(maxCommitment)) {
    tiers.push(maxCommitment);
  }
  tiers.sort((a, b) => a - b);

  const rawPots = [];
  let previousTierLevel = 0;

  for (let i = 0; i < tiers.length; i++) {
    const currentTierLevel = tiers[i];
    const tierSpan = currentTierLevel - previousTierLevel;
    if (tierSpan <= 0) continue;

    let potAmount = 0;
    let contributorsInTier = 0;
    const eligiblePlayerIds = [];

    for (const player of contributors) {
      if (player.totalCommitted > previousTierLevel) {
        contributorsInTier++;
        const contributedToTier = Math.min(player.totalCommitted, currentTierLevel) - previousTierLevel;
        potAmount += contributedToTier;

        // Player is eligible if NOT folded and commitment reaches this tier
        if (!player.isFolded && player.totalCommitted >= currentTierLevel) {
          eligiblePlayerIds.push(player.id);
        }
      }
    }

    if (potAmount > 0) {
      const isSoleContributor = contributorsInTier === 1 && eligiblePlayerIds.length === 1;
      rawPots.push({
        potId: rawPots.length,
        amount: potAmount,
        eligiblePlayerIds,
        isRefund: isSoleContributor
      });
    }

    previousTierLevel = currentTierLevel;
  }

  // Merge consecutive pots with the exact same eligible players and same refund status
  const consolidatedPots = [];
  for (const pot of rawPots) {
    if (consolidatedPots.length === 0) {
      consolidatedPots.push({ ...pot, potId: 0 });
    } else {
      const last = consolidatedPots[consolidatedPots.length - 1];
      const sameEligible =
        last.eligiblePlayerIds.length === pot.eligiblePlayerIds.length &&
        last.isRefund === pot.isRefund &&
        last.eligiblePlayerIds.every(id => pot.eligiblePlayerIds.includes(id));

      if (sameEligible) {
        last.amount += pot.amount;
      } else {
        consolidatedPots.push({ ...pot, potId: consolidatedPots.length });
      }
    }
  }

  return consolidatedPots;
}

/**
 * Splits a pot amount evenly among eligible winners, distributing odd chips 1-by-1
 * to winners closest clockwise from the Dealer Button.
 * @param {number} amount Total pot amount to split.
 * @param {string[]} eligibleWinners Array of player IDs who tied for best hand.
 * @param {number} dealerButtonSeat Seat index of dealer button.
 * @param {Map<string, number>|Object} playerSeats Map or object of playerId -> seatIndex.
 * @param {number} [numSeats=6]
 * @returns {Map<string, number>} Map of playerId -> chips won.
 */
function splitPot(amount, eligibleWinners, dealerButtonSeat, playerSeats, numSeats = NUM_SEATS) {
  const payouts = new Map();
  if (!eligibleWinners || eligibleWinners.length === 0 || amount <= 0) {
    return payouts;
  }

  const wCount = eligibleWinners.length;
  const basePayout = Math.floor(amount / wCount);
  let oddChips = amount % wCount;

  for (const id of eligibleWinners) {
    payouts.set(id, basePayout);
  }

  if (oddChips > 0) {
    const getSeat = id => {
      if (playerSeats instanceof Map) return playerSeats.get(id);
      return playerSeats[id] !== undefined ? playerSeats[id] : 0;
    };

    // Sort winners clockwise from button
    const sortedWinners = [...eligibleWinners].sort((a, b) => {
      const prioA = getClockwisePriority(getSeat(a), dealerButtonSeat, numSeats);
      const prioB = getClockwisePriority(getSeat(b), dealerButtonSeat, numSeats);
      return prioA - prioB;
    });

    for (let i = 0; i < oddChips; i++) {
      const winnerId = sortedWinners[i % sortedWinners.length];
      payouts.set(winnerId, (payouts.get(winnerId) || 0) + 1);
    }
  }

  return payouts;
}

class PokerPotManager {
  /**
   * @param {number} [maxSeats=6]
   */
  constructor(maxSeats = NUM_SEATS) {
    this.maxSeats = maxSeats;
    /** @type {Map<string, { id: string, seatIndex: number, totalCommitted: number, isFolded: boolean, isAllIn: boolean }>} */
    this.players = new Map();
  }

  /**
   * Resets all pot records for a new hand.
   */
  reset() {
    this.players.clear();
  }

  /**
   * Registers a player seat in the pot manager.
   * @param {string} playerId
   * @param {number} seatIndex
   */
  registerPlayer(playerId, seatIndex) {
    if (!this.players.has(playerId)) {
      this.players.set(playerId, {
        id: playerId,
        seatIndex,
        totalCommitted: 0,
        isFolded: false,
        isAllIn: false
      });
    } else {
      this.players.get(playerId).seatIndex = seatIndex;
    }
  }

  /**
   * Records a bet / call / blind chip contribution.
   * @param {string} playerId
   * @param {number} amount
   * @param {number} [seatIndex]
   */
  recordContribution(playerId, amount, seatIndex = null) {
    if (amount <= 0) return;
    if (!this.players.has(playerId)) {
      this.players.set(playerId, {
        id: playerId,
        seatIndex: seatIndex !== null ? seatIndex : 0,
        totalCommitted: 0,
        isFolded: false,
        isAllIn: false
      });
    }
    const p = this.players.get(playerId);
    p.totalCommitted += amount;
    if (seatIndex !== null) {
      p.seatIndex = seatIndex;
    }
  }

  /**
   * Marks player as folded. Folded chips remain in pot, but player becomes ineligible.
   * @param {string} playerId
   * @param {boolean} [isFolded=true]
   */
  setPlayerFolded(playerId, isFolded = true) {
    if (this.players.has(playerId)) {
      this.players.get(playerId).isFolded = isFolded;
    }
  }

  /**
   * Marks player as all-in.
   * @param {string} playerId
   * @param {boolean} [isAllIn=true]
   */
  setPlayerAllIn(playerId, isAllIn = true) {
    if (this.players.has(playerId)) {
      this.players.get(playerId).isAllIn = isAllIn;
    }
  }

  /**
   * Sets player seat index.
   * @param {string} playerId
   * @param {number} seatIndex
   */
  setPlayerSeat(playerId, seatIndex) {
    if (this.players.has(playerId)) {
      this.players.get(playerId).seatIndex = seatIndex;
    }
  }

  /**
   * Calculates side pots and uncalled bet refunds.
   * @returns {Array<{ potId: number, amount: number, eligiblePlayerIds: string[], isRefund?: boolean }>}
   */
  getPots() {
    return calculateSidePots(Array.from(this.players.values()));
  }

  /**
   * Total chips currently in play across all pots (including uncalled bets before refund).
   * @returns {number}
   */
  getTotalPot() {
    let sum = 0;
    for (const p of this.players.values()) {
      sum += p.totalCommitted;
    }
    return sum;
  }

  /**
   * Amount in the Main Pot (first non-refund pot).
   * @returns {number}
   */
  getMainPot() {
    const pots = this.getPots().filter(p => !p.isRefund);
    return pots.length > 0 ? pots[0].amount : 0;
  }

  /**
   * Side pots (excluding main pot and refunds).
   * @returns {Array<{ potId: number, amount: number, eligiblePlayerIds: string[] }>}
   */
  getSidePots() {
    const pots = this.getPots().filter(p => !p.isRefund);
    return pots.slice(1);
  }

  /**
   * Settles all pots given evaluated player hands and dealer button seat.
   * Awards refunds for uncalled bets, divides main & side pots among winners,
   * and allocates odd chips clockwise from button.
   * @param {Array<{ playerId: string, seatIndex: number, hand: Object }>} playerHands Evaluated hands for showdown players.
   * @param {number} dealerButtonSeat Dealer button seat index.
   * @returns {{
   *   payouts: Array<{ playerId: string, seatIndex: number, amount: number, potId: number }>,
   *   refunds: Array<{ playerId: string, seatIndex: number, amount: number }>,
   *   potSummaries: Array<{ potId: number, amount: number, isRefund: boolean, winners: Array<{ playerId: string, seatIndex: number, amount: number, hand?: Object }> }>,
   *   totalAwarded: number
   * }}
   */
  settle(playerHands, dealerButtonSeat) {
    const pots = this.getPots();
    const payouts = [];
    const refunds = [];
    const potSummaries = [];
    let totalAwarded = 0;

    const seatMap = new Map();
    for (const p of this.players.values()) {
      seatMap.set(p.id, p.seatIndex);
    }
    for (const ph of playerHands) {
      seatMap.set(ph.playerId, ph.seatIndex);
    }

    const handMap = new Map();
    for (const ph of playerHands) {
      handMap.set(ph.playerId, ph.hand);
    }

    for (const pot of pots) {
      if (pot.isRefund) {
        // Uncalled excess bet refund
        const refundPlayerId = pot.eligiblePlayerIds[0];
        const seat = seatMap.get(refundPlayerId) || 0;
        refunds.push({
          playerId: refundPlayerId,
          seatIndex: seat,
          amount: pot.amount
        });
        potSummaries.push({
          potId: pot.potId,
          amount: pot.amount,
          isRefund: true,
          winners: [{ playerId: refundPlayerId, seatIndex: seat, amount: pot.amount }]
        });
        totalAwarded += pot.amount;
        continue;
      }

      // Filter showdown players who are eligible for this pot
      const eligibleShowdown = playerHands.filter(ph => pot.eligiblePlayerIds.includes(ph.playerId));

      let winningPlayers = [];
      if (eligibleShowdown.length === 0) {
        // If no showdown players are eligible (e.g. all contenders folded):
        // First try pot.eligiblePlayerIds for an active non-folded player
        const fallbackId = pot.eligiblePlayerIds.find(id => {
          const p = this.players.get(id);
          return p && !p.isFolded;
        }) || pot.eligiblePlayerIds[0];

        const fallbackPlayer = fallbackId ? this.players.get(fallbackId) : null;
        if (fallbackId && fallbackPlayer && !fallbackPlayer.isFolded) {
          winningPlayers = [{ playerId: fallbackId, seatIndex: seatMap.get(fallbackId) || 0 }];
        } else if (playerHands.length > 0) {
          // If pot.eligiblePlayerIds is empty or all have folded, fallback to all remaining active showdown contenders
          winningPlayers = playerHands.map(ph => ({ playerId: ph.playerId, seatIndex: seatMap.get(ph.playerId) || 0 }));
        } else if (fallbackId) {
          winningPlayers = [{ playerId: fallbackId, seatIndex: seatMap.get(fallbackId) || 0 }];
        }
      } else if (eligibleShowdown.length === 1) {
        winningPlayers = [eligibleShowdown[0]];
      } else {
        // Compare hands of all eligible showdown players to find best score vector
        eligibleShowdown.sort((a, b) => compareHands(b.hand, a.hand));
        const bestHand = eligibleShowdown[0].hand;
        winningPlayers = eligibleShowdown.filter(ph => compareHands(ph.hand, bestHand) === 0);
      }

      const winnerIds = winningPlayers.map(w => w.playerId);
      const potPayouts = splitPot(pot.amount, winnerIds, dealerButtonSeat, seatMap, this.maxSeats);

      const potWinnersSummary = [];
      for (const [wId, amountWon] of potPayouts.entries()) {
        const seat = seatMap.get(wId) || 0;
        payouts.push({
          playerId: wId,
          seatIndex: seat,
          amount: amountWon,
          potId: pot.potId
        });
        potWinnersSummary.push({
          playerId: wId,
          seatIndex: seat,
          amount: amountWon,
          hand: handMap.get(wId) || null
        });
        totalAwarded += amountWon;
      }

      potSummaries.push({
        potId: pot.potId,
        amount: pot.amount,
        isRefund: false,
        winners: potWinnersSummary
      });
    }

    return {
      payouts,
      refunds,
      potSummaries,
      totalAwarded
    };
  }

  /**
   * Settles uncontested hand when all players except one fold.
   * Awards entire pot to the single survivor (with any uncalled bets refunded).
   * @param {string} survivorPlayerId
   * @returns {{
   *   payouts: Array<{ playerId: string, seatIndex: number, amount: number, potId: number }>,
   *   refunds: Array<{ playerId: string, seatIndex: number, amount: number }>,
   *   potSummaries: Array<Object>,
   *   totalAwarded: number
   * }}
   */
  settleUncontested(survivorPlayerId) {
    const seat = this.players.has(survivorPlayerId) ? this.players.get(survivorPlayerId).seatIndex : 0;
    const total = this.getTotalPot();

    const potSummaries = [
      {
        potId: 0,
        amount: total,
        isRefund: false,
        winners: [{ playerId: survivorPlayerId, seatIndex: seat, amount: total }]
      }
    ];

    return {
      payouts: [{ playerId: survivorPlayerId, seatIndex: seat, amount: total, potId: 0 }],
      refunds: [],
      potSummaries,
      totalAwarded: total
    };
  }
}

module.exports = {
  PokerPotManager,
  calculateSidePots,
  splitPot,
  getClockwisePriority
};
