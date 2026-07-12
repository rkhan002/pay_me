import { describe, expect, it } from "vitest";
import {
  validateSet,
  validateRun,
  canLayOff,
  runArrangements,
  validateWildAssignments,
  sortRunCards,
  layoffWildCandidates,
} from "../src/melds";
import { cardKey } from "../src/deck";
import { card, joker } from "./testHelpers";

describe("validateSet", () => {
  it("accepts 3 naturals of the same rank, different suits", () => {
    const result = validateSet([card("7", "S"), card("7", "H"), card("7", "D")], "9");
    expect(result.valid).toBe(true);
  });

  it("accepts 4 naturals, different suits", () => {
    const result = validateSet(
      [card("K", "S"), card("K", "H"), card("K", "D"), card("K", "C")],
      "9",
    );
    expect(result.valid).toBe(true);
  });

  it("accepts naturals + wilds as long as at least 2 naturals", () => {
    const result = validateSet([card("7", "S"), card("7", "H"), joker()], "9");
    expect(result.valid).toBe(true);
  });

  it("rejects only 1 natural even with wilds filling the rest", () => {
    const result = validateSet([card("7", "S"), joker(), card("9", "C")], "9");
    expect(result.valid).toBe(false);
  });

  it("accepts duplicate suits among naturals (from a second deck)", () => {
    const result = validateSet([card("7", "S", 0), card("7", "S", 1), card("7", "H")], "9");
    expect(result.valid).toBe(true);
  });

  it("rejects mismatched ranks", () => {
    const result = validateSet([card("7", "S"), card("8", "H"), card("7", "D")], "9");
    expect(result.valid).toBe(false);
  });

  it("rejects sets smaller than 3", () => {
    expect(validateSet([card("7", "S"), card("7", "H")], "9").valid).toBe(false);
  });

  it("has no upper size limit - 5+ card sets are fine", () => {
    const result = validateSet(
      [card("7", "S"), card("7", "H"), card("7", "D"), card("7", "C"), joker()],
      "9",
    );
    expect(result.valid).toBe(true);
  });

  it("accepts 3 naturals of the same rank plus 2 wilds (5-card set)", () => {
    // The exact case reported as broken: three natural 9s plus two wild
    // cards, with no suit constraint and no 4-card ceiling in the way.
    const result = validateSet(
      [card("9", "H"), card("9", "S"), card("9", "D"), joker(0), joker(1)],
      "5",
    );
    expect(result.valid).toBe(true);
  });

  it("accepts a set OF the wild rank - wild-rank cards used at face value", () => {
    // Three 3s while 3 is wild: the 3s are used as natural 3s, not wilds.
    const result = validateSet([card("3", "H"), card("3", "S", 0), card("3", "S", 1)], "3");
    expect(result.valid).toBe(true);
  });

  it("a set of the wild rank still needs 2 of them (1 wild-rank card + jokers is not enough)", () => {
    const result = validateSet([card("3", "H"), joker(0), joker(1)], "3");
    expect(result.valid).toBe(false);
  });

  it("wild-rank card acts as a wild filler when the set is a different rank", () => {
    // Two natural 8s + a 3 (wild rank) -> the 3 is the wild, valid set of 8s.
    const result = validateSet([card("8", "S"), card("8", "H"), card("3", "D")], "3");
    expect(result.valid).toBe(true);
  });
});

describe("validateRun", () => {
  it("accepts a natural low-anchored ace run (A-2-3)", () => {
    const result = validateRun([card("A", "S"), card("2", "S"), card("3", "S")], "9");
    expect(result.valid).toBe(true);
  });

  it("accepts a natural high-anchored ace run (Q-K-A)", () => {
    const result = validateRun([card("Q", "H"), card("K", "H"), card("A", "H")], "9");
    expect(result.valid).toBe(true);
  });

  it("rejects a king-ace-2 wraparound run", () => {
    const result = validateRun([card("K", "D"), card("A", "D"), card("2", "D")], "9");
    expect(result.valid).toBe(false);
  });

  it("fills internal gaps with wilds", () => {
    // 4S _ 6S with a wild standing in for 5S
    const result = validateRun([card("4", "S"), joker(), card("6", "S")], "9");
    expect(result.valid).toBe(true);
  });

  it("allows wilds to outnumber naturals with no proportion cap", () => {
    // Only 2 naturals (4S, 5S) plus three wilds extending the run to length 5 -
    // still valid as long as the 2-natural floor is met; there is no
    // wild-majority cap on runs longer than 4 cards.
    const result = validateRun([card("4", "S"), card("5", "S"), joker(0), joker(1), joker(2)], "K");
    expect(result.valid).toBe(true);
  });

  it("rejects fewer than 2 naturals", () => {
    const result = validateRun([card("4", "S"), joker(0), joker(1)], "9");
    expect(result.valid).toBe(false);
  });

  it("rejects naturals from different suits", () => {
    const result = validateRun([card("4", "S"), card("5", "H"), card("6", "S")], "9");
    expect(result.valid).toBe(false);
  });

  it("rejects duplicate-rank naturals from a second deck in the same run", () => {
    const result = validateRun([card("4", "S", 0), card("4", "S", 1), card("5", "S")], "9");
    expect(result.valid).toBe(false);
  });

  it("rejects a run shorter than 3 cards", () => {
    const result = validateRun([card("4", "S"), card("5", "S")], "9");
    expect(result.valid).toBe(false);
  });
});

describe("runArrangements", () => {
  it("offers both valid completions when the naturals leave slack at either end", () => {
    // 10H JH QH + one wild, wild rank 3 - matches the actual ambiguous
    // case: the wild could be a 9 (9-10-J-Q) or a K (10-J-Q-K).
    const cards = [card("Q", "H"), card("10", "H"), joker(), card("J", "H")];
    const arrangements = runArrangements(cards, "3");
    const summarized = arrangements.map((a) => a.orderedRanks.join(",")).sort();
    expect(summarized).toEqual(["10,J,Q,K", "9,10,J,Q"].sort());
    for (const arrangement of arrangements) {
      expect(arrangement.wildRanks).toHaveLength(1);
    }
  });

  it("offers exactly one completion when there's no slack", () => {
    // 4S _ 6S with a single wild - the only possible gap is 5S.
    const cards = [card("4", "S"), joker(), card("6", "S")];
    const arrangements = runArrangements(cards, "9");
    expect(arrangements).toHaveLength(1);
    expect(arrangements[0].orderedRanks).toEqual(["4", "5", "6"]);
    expect(arrangements[0].wildRanks).toEqual(["5"]);
  });

  it("handles multiple, non-adjacent gaps filled by multiple wilds", () => {
    // 5S 7S 10S + 3 wilds, span 5-10 exactly fits 6 cards with no slack -
    // gaps are 6 (alone) and 8,9 (a separate cluster).
    const cards = [card("5", "S"), card("7", "S"), card("10", "S"), joker(0), joker(1), joker(2)];
    const arrangements = runArrangements(cards, "K");
    expect(arrangements).toHaveLength(1);
    expect(arrangements[0].orderedRanks).toEqual(["5", "6", "7", "8", "9", "10"]);
    expect(arrangements[0].wildRanks).toEqual(["6", "8", "9"]);
  });

  it("returns nothing for naturals that can't form a run at all", () => {
    const cards = [card("4", "S"), card("4", "H"), joker()];
    expect(runArrangements(cards, "9")).toEqual([]);
  });
});

describe("validateWildAssignments", () => {
  const cards = [card("Q", "H"), card("10", "H"), joker(), card("J", "H")];

  it("accepts an assignment matching a valid arrangement", () => {
    const wild = cards.find((c) => c.rank === "JOKER")!;
    const result = validateWildAssignments(cards, "3", { [cardKey(wild)]: "K" });
    expect(result.valid).toBe(true);
  });

  it("rejects a missing assignment", () => {
    const result = validateWildAssignments(cards, "3", {});
    expect(result.valid).toBe(false);
  });

  it("rejects an assignment that doesn't complete a valid run", () => {
    const wild = cards.find((c) => c.rank === "JOKER")!;
    const result = validateWildAssignments(cards, "3", { [cardKey(wild)]: "2" });
    expect(result.valid).toBe(false);
  });

  it("passes trivially when there are no wild cards", () => {
    const naturalsOnly = [card("4", "S"), card("5", "S"), card("6", "S")];
    expect(validateWildAssignments(naturalsOnly, "9", {}).valid).toBe(true);
  });
});

describe("sortRunCards", () => {
  it("sorts a fully-resolved run into ascending order", () => {
    const wild = { ...joker(), wildAs: "K" as const };
    const scrambled = [card("Q", "H"), card("10", "H"), wild, card("J", "H")];
    const sorted = sortRunCards(scrambled, "3");
    expect(sorted.map((c) => c.rank)).toEqual(["10", "J", "Q", "JOKER"]);
  });

  it("leaves cards untouched if a wild hasn't been resolved yet", () => {
    const scrambled = [card("Q", "H"), card("10", "H"), joker(), card("J", "H")];
    expect(sortRunCards(scrambled, "3")).toEqual(scrambled);
  });
});

describe("layoffWildCandidates", () => {
  it("offers both ends when the run is in the middle of the domain", () => {
    const meld = [card("4", "S"), card("5", "S"), card("6", "S")];
    expect(layoffWildCandidates(meld, "9").sort()).toEqual(["3", "7"].sort());
  });

  it("only offers the low end once the run is already at the top of its domain", () => {
    const meld = [
      card("10", "H"),
      card("J", "H"),
      card("Q", "H"),
      { ...joker(), wildAs: "K" as const },
    ];
    expect(layoffWildCandidates(meld, "3")).toEqual(["9"]);
  });
});

describe("canLayOff", () => {
  it("allows extending a set with a matching natural of a new suit", () => {
    const existing = [card("6", "S"), card("6", "H"), card("6", "D")];
    expect(canLayOff(existing, "SET", card("6", "C"), "9")).toBe(true);
  });

  it("rejects extending a set with a mismatched rank", () => {
    const existing = [card("6", "S"), card("6", "H"), card("6", "D")];
    expect(canLayOff(existing, "SET", card("7", "C"), "9")).toBe(false);
  });

  it("allows extending a run at either end", () => {
    const existing = [card("4", "S"), card("5", "S"), card("6", "S")];
    expect(canLayOff(existing, "RUN", card("7", "S"), "9")).toBe(true);
    expect(canLayOff(existing, "RUN", card("3", "S"), "9")).toBe(true);
  });

  it("rejects extending a run with a wrong suit", () => {
    const existing = [card("4", "S"), card("5", "S"), card("6", "S")];
    expect(canLayOff(existing, "RUN", card("7", "H"), "9")).toBe(false);
  });
});
