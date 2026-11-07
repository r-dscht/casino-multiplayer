/**
 * pokerRules.js
 * Authoritative Texas Hold'em 7-Card Hand Evaluator, Tie-Breakers, and Showdown Math.
 * Evaluates C(7,5)=21 combinations, 10 hand categories (High Card to Royal Flush),
 * Ace-high broadway and Ace-low wheel straights, and 6-tuple lexicographical tie-breakers.
 */

const {
  HAND_RANKS,
  HAND_RANK_NAMES,
  SUIT_CODES,
  RANK_VALUES,
  RANKS
} = require('./pokerConstants');

/**
 * Normalizes any card representation (object or string) into a standard Card object.
 * Supported formats:
 * - { suit: 'spades', rank: 'A', value: 14 }
 * - { suit: 's', rank: 'A' }
 * - String format: 'As', '10h', 'Kd', '2c'
 * @param {Object|string} card
 * @returns {{ id: string, suit: string, suitCode: string, rank: string, value: number }}
 */
function normalizeCard(card) {
  if (!card) {
    throw new Error('Invalid card: card is null or undefined');
  }

  if (typeof card === 'string') {
    const trimmed = card.trim();
    const rankPart = trimmed.slice(0, trimmed.length - 1).toUpperCase();
    const suitChar = trimmed.slice(-1).toLowerCase();

    const suit = SUIT_CODES[suitChar];
    if (!suit) {
      throw new Error(`Invalid card suit in string "${card}"`);
    }

    const value = RANK_VALUES[rankPart];
    if (value === undefined) {
      throw new Error(`Invalid card rank in string "${card}"`);
    }

    return {
      id: `${suitChar}_${value}`,
      suit,
      suitCode: suitChar,
      rank: rankPart,
      value
    };
  }

  let suit = card.suit;
  let suitCode = card.suitCode;
  if (!suit && suitCode) {
    suit = SUIT_CODES[suitCode];
  } else if (suit && !suitCode) {
    const match = Object.entries(SUIT_CODES).find(([, full]) => full === suit.toLowerCase());
    suitCode = match ? match[0] : suit[0].toLowerCase();
    suit = suit.toLowerCase();
  }

  let rank = card.rank ? String(card.rank).toUpperCase() : null;
  let value = typeof card.value === 'number' ? card.value : (rank ? RANK_VALUES[rank] : undefined);

  if (rank === null && typeof value === 'number') {
    const entry = Object.entries(RANK_VALUES).find(([, val]) => val === value);
    rank = entry ? entry[0] : String(value);
  }

  if (value === undefined || !suit) {
    throw new Error(`Invalid card object: ${JSON.stringify(card)}`);
  }

  return {
    id: card.id || `${suitCode}_${value}`,
    suit,
    suitCode,
    rank,
    value
  };
}

/**
 * Checks for a 5-card straight given descending sorted unique rank numbers.
 * Supports Broadway (14 high) and Wheel (5 high, A-2-3-4-5).
 * Rejects non-straights and invalid wraparounds (e.g. Q-K-A-2-3).
 * @param {number[]} uniqueRanksDesc
 * @returns {number} High rank of the straight, or 0 if not a straight.
 */
function getStraightHighRank(uniqueRanksDesc) {
  if (uniqueRanksDesc.length < 5) return 0;

  for (let i = 0; i <= uniqueRanksDesc.length - 5; i++) {
    const r = uniqueRanksDesc[i];
    if (
      uniqueRanksDesc[i + 1] === r - 1 &&
      uniqueRanksDesc[i + 2] === r - 2 &&
      uniqueRanksDesc[i + 3] === r - 3 &&
      uniqueRanksDesc[i + 4] === r - 4
    ) {
      return r;
    }
  }

  // Check Ace-low wheel straight: A (14), 5, 4, 3, 2
  if (
    uniqueRanksDesc.includes(14) &&
    uniqueRanksDesc.includes(5) &&
    uniqueRanksDesc.includes(4) &&
    uniqueRanksDesc.includes(3) &&
    uniqueRanksDesc.includes(2)
  ) {
    return 5; // 5-high straight
  }

  return 0;
}

/**
 * Lexicographically compares two 6-element score vectors.
 * Returns > 0 if A beats B, < 0 if B beats A, 0 if exact tie.
 * @param {number[]} vA
 * @param {number[]} vB
 * @returns {number}
 */
function compareVectors(vA, vB) {
  for (let i = 0; i < 6; i++) {
    const valA = vA[i] || 0;
    const valB = vB[i] || 0;
    const diff = valA - valB;
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Evaluates exactly 5 cards into category 0..9 and 6-tuple score vector.
 * @param {Array<Object|string>} rawCards Array of 5 cards.
 * @returns {{
 *   category: number,
 *   rank: number,
 *   scoreVector: number[],
 *   tieBreakers: number[],
 *   rankName: string,
 *   name: string,
 *   description: string,
 *   cards: Array<Object>
 * }}
 */
function evaluate5CardHand(rawCards) {
  if (!Array.isArray(rawCards) || rawCards.length !== 5) {
    throw new Error(`evaluate5CardHand requires exactly 5 cards, received ${rawCards ? rawCards.length : 0}`);
  }

  const cards = rawCards.map(normalizeCard);

  // Histograms for ranks and suits
  const rankCounts = {};
  const suitCounts = {};
  for (const card of cards) {
    rankCounts[card.value] = (rankCounts[card.value] || 0) + 1;
    suitCounts[card.suit] = (suitCounts[card.suit] || 0) + 1;
  }

  const isFlush = Object.values(suitCounts).some(c => c === 5);

  // Group ranks by frequency descending, then value descending
  const groups = Object.entries(rankCounts).map(([val, count]) => ({
    value: Number(val),
    count
  }));

  groups.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.value - a.value;
  });

  const sortedUniqueRanks = Object.keys(rankCounts)
    .map(Number)
    .sort((a, b) => b - a);

  const straightHigh = getStraightHighRank(sortedUniqueRanks);
  const isStraight = straightHigh > 0;

  // Rank name lookup helper
  const getRankStr = val => {
    const entry = Object.entries(RANK_VALUES).find(([, v]) => v === val);
    return entry ? entry[0] : String(val);
  };

  // 1. Royal Flush & Straight Flush
  if (isFlush && isStraight) {
    if (straightHigh === 14) {
      return {
        category: HAND_RANKS.ROYAL_FLUSH,
        rank: HAND_RANKS.ROYAL_FLUSH,
        scoreVector: [HAND_RANKS.ROYAL_FLUSH, 14, 0, 0, 0, 0],
        tieBreakers: [14, 0, 0, 0, 0],
        rankName: 'ROYAL_FLUSH',
        name: HAND_RANK_NAMES[HAND_RANKS.ROYAL_FLUSH],
        description: 'Royal Flush',
        cards
      };
    }

    const highName = straightHigh === 5 ? '5 High, The Wheel' : `${getRankStr(straightHigh)} High`;
    return {
      category: HAND_RANKS.STRAIGHT_FLUSH,
      rank: HAND_RANKS.STRAIGHT_FLUSH,
      scoreVector: [HAND_RANKS.STRAIGHT_FLUSH, straightHigh, 0, 0, 0, 0],
      tieBreakers: [straightHigh, 0, 0, 0, 0],
      rankName: 'STRAIGHT_FLUSH',
      name: HAND_RANK_NAMES[HAND_RANKS.STRAIGHT_FLUSH],
      description: `Straight Flush (${highName})`,
      cards
    };
  }

  // 2. Four of a Kind
  if (groups[0].count === 4) {
    const quadRank = groups[0].value;
    const kicker = groups[1].value;
    return {
      category: HAND_RANKS.FOUR_OF_A_KIND,
      rank: HAND_RANKS.FOUR_OF_A_KIND,
      scoreVector: [HAND_RANKS.FOUR_OF_A_KIND, quadRank, kicker, 0, 0, 0],
      tieBreakers: [quadRank, kicker, 0, 0, 0],
      rankName: 'FOUR_OF_A_KIND',
      name: HAND_RANK_NAMES[HAND_RANKS.FOUR_OF_A_KIND],
      description: `Four of a Kind (${getRankStr(quadRank)}s)`,
      cards
    };
  }

  // 3. Full House
  if (groups[0].count === 3 && groups[1].count === 2) {
    const tripsRank = groups[0].value;
    const pairRank = groups[1].value;
    return {
      category: HAND_RANKS.FULL_HOUSE,
      rank: HAND_RANKS.FULL_HOUSE,
      scoreVector: [HAND_RANKS.FULL_HOUSE, tripsRank, pairRank, 0, 0, 0],
      tieBreakers: [tripsRank, pairRank, 0, 0, 0],
      rankName: 'FULL_HOUSE',
      name: HAND_RANK_NAMES[HAND_RANKS.FULL_HOUSE],
      description: `Full House (${getRankStr(tripsRank)}s full of ${getRankStr(pairRank)}s)`,
      cards
    };
  }

  // 4. Flush
  if (isFlush) {
    const ranksDesc = [...cards].map(c => c.value).sort((a, b) => b - a);
    return {
      category: HAND_RANKS.FLUSH,
      rank: HAND_RANKS.FLUSH,
      scoreVector: [HAND_RANKS.FLUSH, ...ranksDesc],
      tieBreakers: [...ranksDesc],
      rankName: 'FLUSH',
      name: HAND_RANK_NAMES[HAND_RANKS.FLUSH],
      description: `Flush (${getRankStr(ranksDesc[0])} High)`,
      cards
    };
  }

  // 5. Straight
  if (isStraight) {
    const highName = straightHigh === 5 ? '5 High, The Wheel' : `${getRankStr(straightHigh)} High`;
    return {
      category: HAND_RANKS.STRAIGHT,
      rank: HAND_RANKS.STRAIGHT,
      scoreVector: [HAND_RANKS.STRAIGHT, straightHigh, 0, 0, 0, 0],
      tieBreakers: [straightHigh, 0, 0, 0, 0],
      rankName: 'STRAIGHT',
      name: HAND_RANK_NAMES[HAND_RANKS.STRAIGHT],
      description: `Straight (${highName})`,
      cards
    };
  }

  // 6. Three of a Kind
  if (groups[0].count === 3) {
    const tripsRank = groups[0].value;
    const kickers = [groups[1].value, groups[2].value].sort((a, b) => b - a);
    return {
      category: HAND_RANKS.THREE_OF_A_KIND,
      rank: HAND_RANKS.THREE_OF_A_KIND,
      scoreVector: [HAND_RANKS.THREE_OF_A_KIND, tripsRank, kickers[0], kickers[1], 0, 0],
      tieBreakers: [tripsRank, kickers[0], kickers[1], 0, 0],
      rankName: 'THREE_OF_A_KIND',
      name: HAND_RANK_NAMES[HAND_RANKS.THREE_OF_A_KIND],
      description: `Three of a Kind (${getRankStr(tripsRank)}s)`,
      cards
    };
  }

  // 7. Two Pair
  if (groups[0].count === 2 && groups[1].count === 2) {
    const pair1 = Math.max(groups[0].value, groups[1].value);
    const pair2 = Math.min(groups[0].value, groups[1].value);
    const kicker = groups[2].value;
    return {
      category: HAND_RANKS.TWO_PAIR,
      rank: HAND_RANKS.TWO_PAIR,
      scoreVector: [HAND_RANKS.TWO_PAIR, pair1, pair2, kicker, 0, 0],
      tieBreakers: [pair1, pair2, kicker, 0, 0],
      rankName: 'TWO_PAIR',
      name: HAND_RANK_NAMES[HAND_RANKS.TWO_PAIR],
      description: `Two Pair (${getRankStr(pair1)}s and ${getRankStr(pair2)}s)`,
      cards
    };
  }

  // 8. One Pair
  if (groups[0].count === 2) {
    const pairRank = groups[0].value;
    const kickers = [groups[1].value, groups[2].value, groups[3].value].sort((a, b) => b - a);
    return {
      category: HAND_RANKS.ONE_PAIR,
      rank: HAND_RANKS.ONE_PAIR,
      scoreVector: [HAND_RANKS.ONE_PAIR, pairRank, kickers[0], kickers[1], kickers[2], 0],
      tieBreakers: [pairRank, kickers[0], kickers[1], kickers[2], 0],
      rankName: 'ONE_PAIR',
      name: HAND_RANK_NAMES[HAND_RANKS.ONE_PAIR],
      description: `Pair of ${getRankStr(pairRank)}s`,
      cards
    };
  }

  // 9. High Card
  const ranksDesc = [...cards].map(c => c.value).sort((a, b) => b - a);
  return {
    category: HAND_RANKS.HIGH_CARD,
    rank: HAND_RANKS.HIGH_CARD,
    scoreVector: [HAND_RANKS.HIGH_CARD, ...ranksDesc],
    tieBreakers: [...ranksDesc],
    rankName: 'HIGH_CARD',
    name: HAND_RANK_NAMES[HAND_RANKS.HIGH_CARD],
    description: `High Card (${getRankStr(ranksDesc[0])})`,
    cards
  };
}

/**
 * Generates all 21 combinations of 5 cards out of 7 total cards.
 * @param {Array<Object|string>} cards7 Array of 7 cards.
 * @returns {Array<Array<Object>>}
 */
function combinations7choose5(cards7) {
  const result = [];
  const n = cards7.length;
  for (let i = 0; i < n - 4; i++) {
    for (let j = i + 1; j < n - 3; j++) {
      for (let k = j + 1; k < n - 2; k++) {
        for (let l = k + 1; l < n - 1; l++) {
          for (let m = l + 1; m < n; m++) {
            result.push([cards7[i], cards7[j], cards7[k], cards7[l], cards7[m]]);
          }
        }
      }
    }
  }
  return result;
}

/**
 * Evaluates the best 5-card poker hand out of 7 total cards.
 * Can be called with (holeCards, communityCards) or (all7Cards).
 * @param {Array<Object|string>} holeCardsOrAll7 (2 hole cards or all 7 cards)
 * @param {Array<Object|string>} [maybeCommunityCards] (5 community cards if 1st arg is hole cards)
 * @returns {{
 *   category: number,
 *   rank: number,
 *   scoreVector: number[],
 *   tieBreakers: number[],
 *   rankName: string,
 *   name: string,
 *   description: string,
 *   best5Cards: Array<Object>,
 *   best5: Array<Object>
 * }}
 */
function evaluate7CardHand(holeCardsOrAll7, maybeCommunityCards) {
  let allCards;
  if (Array.isArray(maybeCommunityCards)) {
    allCards = [...holeCardsOrAll7, ...maybeCommunityCards];
  } else {
    allCards = holeCardsOrAll7;
  }

  if (!Array.isArray(allCards) || allCards.length !== 7) {
    throw new Error(`evaluate7CardHand expects exactly 7 cards, received ${allCards ? allCards.length : 0}`);
  }

  const normalizedCards = allCards.map(normalizeCard);
  const combos = combinations7choose5(normalizedCards);
  let bestHand = null;

  for (const combo of combos) {
    const hand = evaluate5CardHand(combo);
    if (!bestHand || compareVectors(hand.scoreVector, bestHand.scoreVector) > 0) {
      bestHand = {
        ...hand,
        best5Cards: combo,
        best5: combo
      };
    }
  }

  return bestHand;
}

/**
 * Compares two evaluated hands or card sets.
 * Returns > 0 if A wins, < 0 if B wins, 0 if exact tie.
 * @param {Object|Array} handOrCardsA
 * @param {Object|Array} handOrCardsB
 * @returns {number}
 */
function compareHands(handOrCardsA, handOrCardsB) {
  const getVector = item => {
    if (item && Array.isArray(item.scoreVector)) {
      return item.scoreVector;
    }
    if (Array.isArray(item)) {
      if (item.length === 5) return evaluate5CardHand(item).scoreVector;
      if (item.length === 7) return evaluate7CardHand(item).scoreVector;
    }
    throw new Error('Invalid hand or cards passed to compareHands');
  };

  const vA = getVector(handOrCardsA);
  const vB = getVector(handOrCardsB);
  return compareVectors(vA, vB);
}

/**
 * Determines winning player(s) given players with hole cards and community cards.
 * @param {Array<{ playerId?: string, id?: string, seatIndex: number, holeCards?: Array, cards?: Array }>} playersWithHoleCards
 * @param {Array<Object|string>} communityCards
 * @returns {{
 *   winners: Array<{ playerId: string, seatIndex: number, hand: Object }>,
 *   winningHand: Object,
 *   allHands: Array<{ playerId: string, seatIndex: number, hand: Object }>
 * }}
 */
function determineWinners(playersWithHoleCards, communityCards) {
  if (!Array.isArray(playersWithHoleCards) || playersWithHoleCards.length === 0) {
    return { winners: [], winningHand: null, allHands: [] };
  }

  const evaluatedPlayers = playersWithHoleCards.map(p => {
    const playerId = p.playerId || p.id;
    const holeCards = p.holeCards || p.cards;
    const hand = evaluate7CardHand(holeCards, communityCards);
    return {
      playerId,
      seatIndex: p.seatIndex,
      hand
    };
  });

  // Sort players descending by hand strength
  evaluatedPlayers.sort((a, b) => compareVectors(b.hand.scoreVector, a.hand.scoreVector));

  const bestScore = evaluatedPlayers[0].hand.scoreVector;
  const winners = evaluatedPlayers.filter(p => compareVectors(p.hand.scoreVector, bestScore) === 0);

  return {
    winners,
    winningHand: evaluatedPlayers[0].hand,
    allHands: evaluatedPlayers
  };
}

module.exports = {
  normalizeCard,
  getStraightHighRank,
  compareVectors,
  evaluate5CardHand,
  combinations7choose5,
  evaluate7CardHand,
  compareHands,
  determineWinners,
  HAND_RANKS,
  HAND_RANK_NAMES
};
