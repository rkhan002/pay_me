import { isWildCard, cardKey, type Card, type Rank } from "./deck.ts";

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
 * Set: 3+ cards, same rank, no upper limit (house ruling) - with multiple
 * decks in play there's no reason to cap out at 4 once duplicate suits are
 * allowed among naturals (see below), so e.g. three natural 9s plus two
 * wild cards is a perfectly good 5-card set. At least 2 natural cards.
 * Naturals do not need distinct suits either - with multiple decks in
 * play, two 8 of Hearts (one from each deck) are legitimate duplicates and
 * can sit in the same set (also house ruling).
 */
export function validateSet(cards: Card[], wildRank: Rank): MeldValidationResult {
  if (cards.length < 3) {
    return { valid: false, reason: "A set must have at least 3 cards" };
  }
  const { naturals } = partition(cards, wildRank);
  if (naturals.length < MIN_NATURALS) {
    return { valid: false, reason: "A meld needs at least 2 natural cards" };
  }
  const rank = naturals[0].rank;
  if (!naturals.every((c) => c.rank === rank)) {
    return { valid: false, reason: "All natural cards in a set must share a rank" };
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

// ---- Wild-card rank designation for runs ----
//
// A run's wild card(s) don't have an inherent position in the sequence -
// validateRun only confirms *some* contiguous window fits the naturals,
// without saying which one. Everything below exists to pin that down: what
// rank does this specific wild represent, so the run can be stored and
// displayed in order (10, J, Q, K instead of 10, J, K, star-somewhere).

function valueToRank(value: number, table: Record<Exclude<Rank, "JOKER">, number>): Rank {
  for (const rank of Object.keys(table) as Exclude<Rank, "JOKER">[]) {
    if (table[rank] === value) return rank;
  }
  throw new Error(`No rank maps to value ${value} in this domain`);
}

export interface RunArrangement {
  /** Every rank in the run, ascending, once every wild is resolved - e.g. ["9","10","J","Q"]. */
  orderedRanks: Rank[];
  /** What the run's wild card(s) would represent under this arrangement, ascending. */
  wildRanks: Rank[];
}

/**
 * Every valid way to complete a RUN's shape given its naturals: one entry
 * per distinct contiguous window (low-ace and high-ace domains, and every
 * position the naturals' slack allows within each). Usually just one
 * arrangement, but a run with slack - e.g. naturals 10,J,Q plus one wild,
 * for a 4-card run - has two (9-10-J-Q or 10-J-Q-K), which is exactly the
 * case a player needs to be asked about rather than have guessed for them.
 */
export function runArrangements(cards: Card[], wildRank: Rank): RunArrangement[] {
  const { naturals, wilds } = partition(cards, wildRank);
  if (naturals.length < MIN_NATURALS) return [];
  const suit = naturals[0].suit;
  if (!naturals.every((c) => c.suit === suit)) return [];

  const totalLength = cards.length;
  const results: RunArrangement[] = [];
  const seen = new Set<string>();

  for (const [table, domainMin, domainMax] of [
    [RANK_LOW, 1, 13],
    [RANK_HIGH, 2, 14],
  ] as const) {
    const naturalValues = naturals.map((c) => table[c.rank as Exclude<Rank, "JOKER">]);
    if (new Set(naturalValues).size !== naturalValues.length) continue;
    const min = Math.min(...naturalValues);
    const max = Math.max(...naturalValues);
    const span = max - min + 1;
    if (span > totalLength) continue;
    const slack = totalLength - span;
    for (let shiftStart = 0; shiftStart <= slack; shiftStart++) {
      const windowStart = min - shiftStart;
      const windowEnd = windowStart + totalLength - 1;
      if (windowStart < domainMin || windowEnd > domainMax) continue;
      const windowValues: number[] = [];
      for (let v = windowStart; v <= windowEnd; v++) windowValues.push(v);
      const gapValues = windowValues.filter((v) => !naturalValues.includes(v));
      if (gapValues.length !== wilds.length) continue; // safety - should always match
      const orderedRanks = windowValues.map((v) => valueToRank(v, table));
      const key = orderedRanks.join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ orderedRanks, wildRanks: gapValues.map((v) => valueToRank(v, table)) });
    }
  }
  return results;
}

/**
 * Validates a full set of {wild card -> represented rank} assignments for
 * a proposed RUN meld: every wild must be assigned, and the assigned ranks
 * (as a set, not tied to which physical wild got which) must match one of
 * runArrangements()'s valid completions.
 */
export function validateWildAssignments(
  cards: Card[],
  wildRank: Rank,
  wildAssignments: Record<string, Rank>,
): MeldValidationResult {
  const { wilds } = partition(cards, wildRank);
  if (wilds.length === 0) return { valid: true };

  const assignedRanks: Rank[] = [];
  for (const wildCard of wilds) {
    const assigned = wildAssignments[cardKey(wildCard)];
    if (!assigned) {
      return { valid: false, reason: "Every wild card in this run needs a rank assigned" };
    }
    assignedRanks.push(assigned);
  }

  const assignedMultiset = [...assignedRanks].sort().join(",");
  const matches = runArrangements(cards, wildRank).some(
    (arr) => [...arr.wildRanks].sort().join(",") === assignedMultiset,
  );
  if (!matches) {
    return { valid: false, reason: "That assignment doesn't form a valid run with these cards" };
  }
  return { valid: true };
}

function effectiveRankValue(
  card: Card,
  wildRank: Rank,
  table: Record<Exclude<Rank, "JOKER">, number>,
): number | undefined {
  const rank = isWildCard(card, wildRank) ? card.wildAs : card.rank;
  if (!rank) return undefined;
  return table[rank as Exclude<Rank, "JOKER">];
}

/**
 * A RUN meld's cards are only "resolved" once every wild has a wildAs
 * assigned - at that point the whole thing reduces to one, unambiguous
 * domain (low or high ace) and a contiguous min..max range, which is what
 * both display sorting and lay-off extension need.
 */
function resolvedRunRange(
  cards: Card[],
  wildRank: Rank,
): { table: Record<Exclude<Rank, "JOKER">, number>; min: number; max: number } | null {
  for (const table of [RANK_LOW, RANK_HIGH]) {
    const values = cards.map((c) => effectiveRankValue(c, wildRank, table));
    if (values.some((v) => v === undefined)) continue;
    const nums = values as number[];
    if (new Set(nums).size !== nums.length) continue;
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    if (max - min + 1 !== nums.length) continue;
    return { table, min, max };
  }
  return null;
}

/**
 * Sorts a RUN meld's cards into ascending sequence once every wild is
 * resolved. Cards with an unresolved wild (no wildAs yet) fall back to
 * whatever order they were given in - shouldn't happen in practice, since
 * proposeMeld/applyLayoff require full resolution before storing a run.
 */
export function sortRunCards(cards: Card[], wildRank: Rank): Card[] {
  const range = resolvedRunRange(cards, wildRank);
  if (!range) return cards;
  const { table } = range;
  return cards
    .map((c) => ({ c, v: effectiveRankValue(c, wildRank, table)! }))
    .sort((a, b) => a.v - b.v)
    .map(({ c }) => c);
}

/**
 * Which ranks would actually extend an already-resolved RUN with one more
 * wild card - at most the rank just below its current low end or just
 * above its current high end (a resolved run has no internal gaps left).
 */
export function layoffWildCandidates(meldCards: Card[], wildRank: Rank): Rank[] {
  const range = resolvedRunRange(meldCards, wildRank);
  if (!range) return [];
  const { table, min, max } = range;
  const domainMin = table === RANK_LOW ? 1 : 2;
  const domainMax = table === RANK_LOW ? 13 : 14;
  const candidates: Rank[] = [];
  if (min - 1 >= domainMin) candidates.push(valueToRank(min - 1, table));
  if (max + 1 <= domainMax) candidates.push(valueToRank(max + 1, table));
  return candidates;
}
