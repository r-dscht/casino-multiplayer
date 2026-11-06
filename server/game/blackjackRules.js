/**
 * blackjackRules.js
 * Pure mathematical functions for Blackjack hand evaluation, action eligibility,
 * dealer S17 AI decisions, and payout calculations.
 * Zero side-effects.
 */

const {
  RANK_VALUES,
  PAYOUT_RATIOS,
  DEALER_RULES
} = require('./blackjackConstants');

/**
 * Normalizes input into an array of card objects with rank and suit.
 * @param {Array|Object} cardsOrHand 
 * @returns {Array<Object>}
 */
function extractCards(cardsOrHand) {
  if (!cardsOrHand) return [];
  if (Array.isArray(cardsOrHand)) return cardsOrHand;
  if (Array.isArray(cardsOrHand.cards)) return cardsOrHand.cards;
  return [];
}

/**
 * Calculates authoritative hand value, dynamic Ace soft/hard status,
 * bust status, and natural Blackjack status.
 * @param {Array<Object>|Object} cardsOrHand 
 * @returns {{ value: number, isSoft: boolean, isBust: boolean, isBlackjack: boolean }}
 */
function calculateHandValue(cardsOrHand) {
  const cards = extractCards(cardsOrHand);
  if (cards.length === 0) {
    return { value: 0, isSoft: false, isBust: false, isBlackjack: false };
  }

  let total = 0;
  let softAces = 0;

  for (const card of cards) {
    if (!card) continue;
    if (card.rank === 'A') {
      total += 11;
      softAces++;
    } else {
      total += (RANK_VALUES[card.rank] !== undefined ? RANK_VALUES[card.rank] : 0);
    }
  }

  // Convert Aces from 11 to 1 as needed to avoid busting
  while (total > 21 && softAces > 0) {
    total -= 10;
    softAces--;
  }

  const isBust = total > 21;
  const isSoft = softAces > 0;
  const isBlackjack = cards.length === 2 && total === 21;

  return {
    value: total,
    isSoft,
    isBust,
    isBlackjack
  };
}

/**
 * Determines whether a player hand is eligible to Hit.
 * @param {Object} hand 
 * @returns {boolean}
 */
function canHit(hand) {
  if (!hand) return false;
  const cards = extractCards(hand);
  if (cards.length === 0) return false;
  if (hand.status === 'stood' || hand.status === 'busted' || hand.status === 'blackjack') {
    return false;
  }
  if (hand.isSplitAces) {
    return false; // Split Aces receive exactly 1 card and cannot hit
  }
  const score = calculateHandValue(cards);
  return !score.isBust && score.value < 21;
}

/**
 * Determines whether a player hand is eligible to Stand.
 * @param {Object} hand 
 * @returns {boolean}
 */
function canStand(hand) {
  if (!hand) return false;
  const cards = extractCards(hand);
  if (cards.length === 0) return false;
  if (hand.status === 'stood' || hand.status === 'busted') {
    return false;
  }
  const score = calculateHandValue(cards);
  return !score.isBust;
}

/**
 * Determines whether a player hand is eligible to Double Down.
 * Rule: First 2 cards only, sufficient balance, not already doubled, not split Aces.
 * @param {Object} hand 
 * @param {number} playerChips 
 * @returns {boolean}
 */
function canDouble(hand, playerChips) {
  if (!hand) return false;
  const cards = extractCards(hand);
  if (cards.length !== 2) return false;
  if (hand.doubled || hand.isSplitAces) return false;
  if (hand.status === 'stood' || hand.status === 'busted' || hand.status === 'blackjack') {
    return false;
  }
  const bet = hand.bet || 0;
  if (bet <= 0 || (typeof playerChips === 'number' && playerChips < bet)) {
    return false;
  }
  const score = calculateHandValue(cards);
  return !score.isBust && score.value < 21;
}

/**
 * Determines whether a player hand is eligible to Split.
 * Rule: First 2 cards of equal rank or equal 10-value, max 1 split per seat, sufficient balance.
 * @param {Object} hand 
 * @param {number} playerChips 
 * @param {number} [existingHandsCount=1] 
 * @returns {boolean}
 */
function canSplit(hand, playerChips, existingHandsCount = 1) {
  if (!hand) return false;
  const cards = extractCards(hand);
  if (cards.length !== 2) return false;
  if (existingHandsCount >= 2 || hand.isSplitHand) return false;
  if (hand.status === 'stood' || hand.status === 'busted') return false;

  const card1 = cards[0];
  const card2 = cards[1];
  if (!card1 || !card2) return false;

  const sameRank = card1.rank === card2.rank;
  const same10Value = (RANK_VALUES[card1.rank] === 10 && RANK_VALUES[card2.rank] === 10);
  if (!sameRank && !same10Value) return false;

  const bet = hand.bet || 0;
  if (bet <= 0 || (typeof playerChips === 'number' && playerChips < bet)) {
    return false;
  }

  return true;
}

/**
 * S17 Dealer AI: Dealer hits on 16 or less; stands on ALL 17s (including soft 17).
 * @param {Array<Object>|Object} dealerCardsOrHand 
 * @returns {boolean} True if dealer must hit, false if dealer must stand.
 */
function shouldDealerHit(dealerCardsOrHand) {
  const score = calculateHandValue(dealerCardsOrHand);
  if (score.isBust) return false;
  if (DEALER_RULES.STANDS_ON_SOFT_17) {
    return score.value < DEALER_RULES.MIN_STAND_VALUE; // < 17
  }
  // If H17 rule were active, soft 17 would hit:
  return score.value < 17 || (score.value === 17 && score.isSoft);
}

/**
 * Evaluates outcome, payout multiplier, gross chips returned, and net profit
 * for a player hand compared to the dealer hand.
 * @param {Object|Array} playerHand 
 * @param {Object|Array} dealerHand 
 * @param {number} bet 
 * @param {boolean} [isSplitHand=false] 
 * @returns {{ outcome: string, result: string, gross: number, profit: number, multiplier: number, playerScore: Object, dealerScore: Object }}
 */
function evaluateHandResult(playerHand, dealerHand, bet, isSplitHand = false) {
  const pCards = extractCards(playerHand);
  const dCards = extractCards(dealerHand);
  const safeBet = Math.max(0, parseInt(bet, 10) || (playerHand && playerHand.bet) || 0);

  const pScore = calculateHandValue(pCards);
  const dScore = calculateHandValue(dCards);

  const splitHand = isSplitHand || !!(playerHand && playerHand.isSplitHand);
  const pNatural = !splitHand && pScore.isBlackjack;
  const dNatural = dScore.isBlackjack;

  // 1. Player Busted
  if (pScore.isBust) {
    return {
      outcome: 'LOSE',
      result: 'LOSE',
      multiplier: 0,
      gross: 0,
      profit: -safeBet,
      playerScore: pScore,
      dealerScore: dScore
    };
  }

  // 2. Both Natural Blackjack -> Push
  if (pNatural && dNatural) {
    return {
      outcome: 'PUSH',
      result: 'PUSH',
      multiplier: 1.0,
      gross: safeBet,
      profit: 0,
      playerScore: pScore,
      dealerScore: dScore
    };
  }

  // 3. Player Natural Blackjack -> 3:2 payout (+1.5x profit, 2.5x gross)
  if (pNatural && !dNatural) {
    const gross = Math.floor(safeBet * 2.5);
    const profit = Math.floor(safeBet * PAYOUT_RATIOS.NATURAL_BLACKJACK);
    return {
      outcome: 'BLACKJACK',
      result: 'BLACKJACK',
      multiplier: 2.5,
      gross,
      profit,
      playerScore: pScore,
      dealerScore: dScore
    };
  }

  // 4. Dealer Natural Blackjack against regular player hand -> Lose
  if (!pNatural && dNatural) {
    return {
      outcome: 'LOSE',
      result: 'LOSE',
      multiplier: 0,
      gross: 0,
      profit: -safeBet,
      playerScore: pScore,
      dealerScore: dScore
    };
  }

  // 5. Dealer Busted -> Player Wins 1:1
  if (dScore.isBust) {
    return {
      outcome: 'WIN',
      result: 'WIN',
      multiplier: 2.0,
      gross: safeBet * 2,
      profit: safeBet,
      playerScore: pScore,
      dealerScore: dScore
    };
  }

  // 6. Non-busted comparisons
  if (pScore.value > dScore.value) {
    return {
      outcome: 'WIN',
      result: 'WIN',
      multiplier: 2.0,
      gross: safeBet * 2,
      profit: safeBet,
      playerScore: pScore,
      dealerScore: dScore
    };
  } else if (pScore.value < dScore.value) {
    return {
      outcome: 'LOSE',
      result: 'LOSE',
      multiplier: 0,
      gross: 0,
      profit: -safeBet,
      playerScore: pScore,
      dealerScore: dScore
    };
  } else {
    // Equal hand totals -> Push (stake returned)
    return {
      outcome: 'PUSH',
      result: 'PUSH',
      multiplier: 1.0,
      gross: safeBet,
      profit: 0,
      playerScore: pScore,
      dealerScore: dScore
    };
  }
}

module.exports = {
  extractCards,
  calculateHandValue,
  scoreHand: calculateHandValue, // alias for testing convenience
  canHit,
  canStand,
  canDouble,
  canSplit,
  shouldDealerHit,
  evaluateHandResult,
  evaluateHand: evaluateHandResult // alias for testing convenience
};
