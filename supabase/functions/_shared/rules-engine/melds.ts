// AUTO-GENERATED from packages/rules-engine/src/melds.ts — DO NOT EDIT.
// Edit the source there, then run: npm run rules:sync
import { cardKey, type Card, type Rank } from "./deck.ts";

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
  // A card of the wild rank is dual-use: it counts as a NATURAL of its own
  // rank when the set is of that rank (e.g. three 3s while 3 is wild), and as
  // a wild filler otherwise. Jokers are always wild. So the set's rank is
  // pinned by the non-wild-rank naturals if there are any; if there are none,
  // the only possible set is one OF the wild rank, with those cards natural.
  const hardNaturals = cards.filter((c) => c.rank !== "JOKER" && c.rank !== wildRank);
  const wildRankCards = cards.filter((c) => c.rank === wildRank);

  let naturalCount: number;
  if (hardNaturals.length > 0) {
    const rank = hardNaturals[0].rank;
    if (!hardNaturals.every((c) => c.rank === rank)) {
      return { valid: false, reason: "All natural cards in a set must share a rank" };
    }
    naturalCount = hardNaturals.length; // wild-rank cards + jokers are wild fillers
  } else {
    naturalCount = wildRankCards.length; // a set OF the wild rank; jokers are wild
  }

  if (naturalCount < MIN_NATURALS) {
    return { valid: false, reason: "A meld needs at least 2 natural cards" };
  }
  return { valid: true };
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
  // A run is valid if there's any way to resolve its wilds (and dual-use
  // wild-rank cards) into a contiguous same-suit sequence - see runArrangements.
  if (runArrangements(cards, wildRank).length > 0) return { valid: true };

  // No valid arrangement: give the most useful reason. A wild-rank card can
  // count as one natural (its own rank), so include one in the capacity check.
  const naturalCapacity =
    cards.filter((c) => c.rank !== "JOKER" && c.rank !== wildRank).length +
    (cards.some((c) => c.rank === wildRank) ? 1 : 0);
  if (naturalCapacity < MIN_NATURALS) {
    return { valid: false, reason: "A meld needs at least 2 natural cards" };
  }
  return {
    valid: false,
    reason: "Cards don't form a contiguous run (ace can't wrap from king to 2)",
  };
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
  /**
   * cardKey -> rank for each card acting as a WILD filler in this arrangement.
   * A wild-rank card sitting at its own rank (a natural) is deliberately NOT
   * included - the client sends this map straight back as the resolution.
   */
  wildAssignments: Record<string, Rank>;
  /** The filler ranks, ascending - kept for display and back-compat. */
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
  const hardNaturals = cards.filter((c) => c.rank !== "JOKER" && c.rank !== wildRank);
  const wildRankCards = cards.filter((c) => c.rank === wildRank);
  const jokers = cards.filter((c) => c.rank === "JOKER");
  const totalLength = cards.length;

  // A card of the wild rank is dual-use in a run: it can sit at its OWN rank as
  // a natural (counting toward the 2-natural floor), or act as a wild filler.
  // At most one wild-rank card can be natural (two would duplicate the wild
  // rank within one run), so we try "none natural" plus "each single one
  // natural" and keep whichever interpretations form a valid run.
  const naturalOptions: (Card | null)[] = [null, ...wildRankCards];

  // Dedupe by the resulting ordered ranks, preferring the interpretation with
  // the FEWEST wild fillers (i.e. more cards acting as their own natural), so
  // e.g. 3-4-5 with a natural 3 wins over the same run with the 3 used as a
  // wild standing for 3.
  const best = new Map<string, RunArrangement>();

  for (const naturalWild of naturalOptions) {
    const naturals = naturalWild ? [...hardNaturals, naturalWild] : hardNaturals;
    if (naturals.length < MIN_NATURALS) continue;
    const suit = naturals[0].suit;
    if (!naturals.every((c) => c.suit === suit)) continue;
    const wilds = [...jokers, ...wildRankCards.filter((c) => c !== naturalWild)];

    for (const [table, domainMin, domainMax] of [
      [RANK_LOW, 1, 13],
      [RANK_HIGH, 2, 14],
    ] as const) {
      const naturalValues = naturals.map(
        (c) => table[(c === naturalWild ? wildRank : c.rank) as Exclude<Rank, "JOKER">],
      );
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
        const wildRanks = gapValues.map((v) => valueToRank(v, table));
        const wildAssignments: Record<string, Rank> = {};
        wilds.forEach((w, i) => {
          wildAssignments[cardKey(w)] = wildRanks[i];
        });
        const key = orderedRanks.join(",");
        const existing = best.get(key);
        if (!existing || wildRanks.length < existing.wildRanks.length) {
          best.set(key, { orderedRanks, wildAssignments, wildRanks });
        }
      }
    }
  }
  return [...best.values()];
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
  const arrangements = runArrangements(cards, wildRank);
  if (arrangements.length === 0) {
    return { valid: false, reason: "That assignment doesn't form a valid run with these cards" };
  }
  // The provided map must exactly match one arrangement's filler map: every
  // wild (joker, or wild-rank card used AS a wild) assigned the right rank and
  // nothing extra. A wild-rank card left unassigned is acting as its natural.
  const providedKeys = Object.keys(wildAssignments);
  const matches = arrangements.some((arr) => {
    const keys = Object.keys(arr.wildAssignments);
    return (
      keys.length === providedKeys.length &&
      keys.every((k) => arr.wildAssignments[k] === wildAssignments[k])
    );
  });
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
  // A wild-rank card with no wildAs is acting as a natural of its OWN rank; a
  // wildAs (on a joker, or a wild-rank card being used AS a wild) says which
  // rank it stands for. A joker with no wildAs is still unresolved.
  const rank = card.wildAs ?? (card.rank === "JOKER" ? undefined : card.rank);
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
