/**
 * lotteryConstants.js
 * Shared configuration, payout math (0% house edge / 100% pot payout),
 * and weighted raffle reel helpers for Casino Staatsloterij.
 *
 * Strict Guardrails: Zero audio, zero Unicode emojis.
 */

const TICKET_PRICE = 2500;
const HOUSE_FEE_RATE = 0; // 100% of ticket revenue goes directly to the winner's pot
const MIN_PURCHASE_COUNT = 1;
const MAX_PURCHASE_PER_REQUEST = 10000;
const ROUND_DURATION_MS = 10 * 60 * 1000; // 10 minutes
const DRAW_REVEAL_MS = 12000; // 12 seconds dramatic 3-stage raffle reel showcase
const HISTORY_LIMIT = 20;

const PHASES = Object.freeze({
  OPEN: 'OPEN',
  DRAWING: 'DRAWING'
});

/**
 * Extracts crisp 1-2 character uppercase monogram for participant badges.
 * @param {string} name
 * @returns {string}
 */
function getLotteryMonogram(name) {
  const clean = String(name || '').trim();
  if (!clean) return '?';
  const parts = clean.split(/[\s_-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

/**
 * Computes share ratio (0..1) and percentage (0..100, 2 decimals) from ticket counts.
 * @param {number} playerTickets
 * @param {number} totalTickets
 * @returns {{ share: number, sharePct: number }}
 */
function computePlayerOdds(playerTickets, totalTickets) {
  const own = Math.max(0, Number(playerTickets) || 0);
  const total = Math.max(0, Number(totalTickets) || 0);
  if (total <= 0 || own <= 0) {
    return { share: 0, sharePct: 0 };
  }
  const share = own / total;
  const sharePct = Math.round(share * 10000) / 100;
  return { share, sharePct };
}

/**
 * Picks a weighted random range entry using binary search or cumulative ticket weights.
 * @param {Array<Object>} ranges Contiguous [{ startTicket, endTicket, ... }]
 * @param {number} ticketIdx 0-based ticket index in [0, totalTickets - 1]
 * @returns {Object|null}
 */
function findRangeForTicketIndex(ranges, ticketIdx) {
  if (!Array.isArray(ranges) || ranges.length === 0) return null;
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = ranges[mid];
    if (ticketIdx < r.startTicket) {
      hi = mid - 1;
    } else if (ticketIdx > r.endTicket) {
      lo = mid + 1;
    } else {
      return r;
    }
  }
  return null;
}

/**
 * Generates an animated raffle reel strip of `slotCount` tiles weighted by ticket count,
 * locking the exact winning ticket & owner onto `winnerSlot`.
 * @param {Array<Object>} ranges Contiguous purchase ranges
 * @param {Object} winningRange Range containing the drawn winning ticket
 * @param {number} winningTicketIdx 0-based winning ticket index
 * @param {number} totalTickets
 * @param {Function} [rng=Math.random]
 * @param {number} [slotCount=48]
 * @param {number} [winnerSlot=36]
 * @returns {Array<Object>}
 */
function buildRaffleReelEntries(
  ranges,
  winningRange,
  winningTicketIdx,
  totalTickets,
  rng = Math.random,
  slotCount = 64,
  winnerSlot = 52
) {
  if (!Array.isArray(ranges) || ranges.length === 0 || totalTickets <= 0 || !winningRange) {
    return [];
  }
  const safeSlots = Math.max(winnerSlot + 4, slotCount);
  const entries = new Array(safeSlots);

  for (let i = 0; i < safeSlots; i += 1) {
    if (i === winnerSlot) {
      entries[i] = {
        playerId: winningRange.playerId,
        playerName: winningRange.playerName,
        playerColor: winningRange.playerColor || '#D4AF37',
        monogram: getLotteryMonogram(winningRange.playerName),
        ticketNumber: winningTicketIdx + 1,
        isWinner: true
      };
      continue;
    }

    const rFloat = Math.min(0.999999999999, Math.max(0, Number(rng()) || 0));
    const sampleTicket = Math.floor(rFloat * totalTickets);
    const sampledRange = findRangeForTicketIndex(ranges, sampleTicket) || winningRange;
    entries[i] = {
      playerId: sampledRange.playerId,
      playerName: sampledRange.playerName,
      playerColor: sampledRange.playerColor || '#D4AF37',
      monogram: getLotteryMonogram(sampledRange.playerName),
      ticketNumber: sampleTicket + 1,
      isWinner: false
    };
  }

  return entries;
}

module.exports = {
  TICKET_PRICE,
  HOUSE_FEE_RATE,
  MIN_PURCHASE_COUNT,
  MAX_PURCHASE_PER_REQUEST,
  ROUND_DURATION_MS,
  DRAW_REVEAL_MS,
  HISTORY_LIMIT,
  PHASES,
  getLotteryMonogram,
  computePlayerOdds,
  findRangeForTicketIndex,
  buildRaffleReelEntries
};
