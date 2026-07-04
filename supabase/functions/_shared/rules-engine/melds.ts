import { isWildCard, type Card, type Rank } from "./deck.ts";

export type MeldType = "SET" | "RUN";

export interface MeldValidationResult {
  valid: boolean;
  reason?: string;
}

const RANK_LOW: Record<Exclude<Rank, "JOKER">, number> = {
  A: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 7,
  8: 8,
  9: 9,
  10: 10,
  J: 11,
  Q: 12,
  K: 13,
};

const RANK_HIGH: Record<Exclude<Rank, "JOKER">, number> = {
  ...RANK_LOW,
  A: 14,
};

const MIN_NATURALS = 2;

function partition(cards: Card[], wildRank: Rank) {
  const naturals = cards.filter((c) => !isWildCard(c, wildRank));
  const wilds = cards.filter((c) => isWildCard(c, wildRank));
  return { naturals, wilds };
}

/**
 * Set: 3-4 cards, same rank, different suits. At least 2 natural cards.
 * No maximum-wild-proportion cap (house ruling) - the only wild limit is
 * the shared "at least 2 naturals" floor, which a 4-card set already
 * satisfies at up to 2 wilds.
 */
export function validateSet(cards: Card[], wildRank: Rank): MeldValidationResult {
  if (cards.length < 3 || cards.length > 4) {
    return { valid: false, reason: "A set must have 3 or 4 cards" };
  }
  const { naturals, wilds } = partition(cards, wildRank);
  if (naturals.length < MIN_NATURALS) {
    return { valid: false, reason: "A meld needs at least 2 natural cards" };
  }
  if (wilds.length > cards.length - MIN_NATURALS) {
    // Cannot happen given the length check above, kept for clarity/safety.
    return { valid: false, reason: "Too many wild cards for this meld size" };
  }
  const rank = naturals[0].rank;
  if (!naturals.every((c) => c.rank === rank)) {
    return { valid: false, reason: "All natural cards in a set must share a rank" };
  }
  const suits = naturals.map((c) => c.suit);
  if (new Set(suits).size !== suits.length) {
    return { valid: false, reason: "Natural cards in a set must have different suits" };
  }
  return { valid: true };
}

function tryRunWindow(
  naturalValues: number[],
  totalLength: number,
  domainMin: number,
  domainMax: number,
): boolean {
  const uniqueValues = new Set(naturalValues);
  if (uniqueValues.size !== naturalValues.length) return false; // duplicate rank in one run
  const min = Math.min(...naturalValues);
  const max = Math.max(...naturalValues);
  const span = max - min + 1;
  if (span > totalLength) return false;
  const slack = totalLength - span;
  for (let shiftStart = 0; shiftStart <= slack; shiftStart++) {
    const windowStart = min - shiftStart;
    const windowEnd = windowStart + totalLength - 1;
    if (windowStart >= domainMin && windowEnd <= domainMax) return true;
  }
  return false;
}

/**
 * Run: 3+ consecutive cards, same suit. At least 2 natural cards.
 * Ace may anchor low (A-2-3...) or high (...Q-K-A) but K-A-2 wraparound
 * is not allowed - enforced by requiring every natural to fit a single
 * consistent low-domain (A=1..K=13) or high-domain (2..K=13, A=14) window.
 */
export function validateRun(cards: Card[], wildRank: Rank): MeldValidationResult {
  if (cards.length < 3) {
    return { valid: false, reason: "A run must have at least 3 cards" };
  }
  const { naturals, wilds } = partition(cards, wildRank);
  if (naturals.length < MIN_NATURALS) {
    return { valid: false, reason: "A meld needs at least 2 natural cards" };
  }
  const suit = naturals[0].suit;
  if (!naturals.every((c) => c.suit === suit)) {
    return { valid: false, reason: "Natural cards in a run must share a suit" };
  }
  void wilds;
  const lowValues = naturals.map((c) => RANK_LOW[c.rank as Exclude<Rank, "JOKER">]);
  const highValues = naturals.map((c) => RANK_HIGH[c.rank as Exclude<Rank, "JOKER">]);
  const fitsLow = tryRunWindow(lowValues, cards.length, 1, 13);
  const fitsHigh = tryRunWindow(highValues, cards.length, 2, 14);
  if (!fitsLow && !fitsHigh) {
    return {
      valid: false,
      reason: "Cards don't form a contiguous run (ace can't wrap from king to 2)",
    };
  }
  return { valid: true };
}

export function validateMeld(
  cards: Card[],
  meldType: MeldType,
  wildRank: Rank,
): MeldValidationResult {
  return meldType === "SET" ? validateSet(cards, wildRank) : validateRun(cards, wildRank);
}

/**
 * Can `card` be legally laid off onto an existing, already-valid meld?
 * Re-validates the meld's full card list plus the candidate card.
 */
export function canLayOff(
  existingMeldCards: Card[],
  meldType: MeldType,
  candidate: Card,
  wildRank: Rank,
): boolean {
  const result = validateMeld([...existingMeldCards, candidate], meldType, wildRank);
  return result.valid;
}
