import { describe, expect, it } from "vitest";
import { validateSet, validateRun } from "../src/melds";
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

  it("rejects duplicate suits among naturals (from a second deck)", () => {
    const result = validateSet([card("7", "S", 0), card("7", "S", 1), card("7", "H")], "9");
    expect(result.valid).toBe(false);
  });

  it("rejects mismatched ranks", () => {
    const result = validateSet([card("7", "S"), card("8", "H"), card("7", "D")], "9");
    expect(result.valid).toBe(false);
  });

  it("rejects sets larger than 4 or smaller than 3", () => {
    expect(validateSet([card("7", "S"), card("7", "H")], "9").valid).toBe(false);
    expect(
      validateSet([card("7", "S"), card("7", "H"), card("7", "D"), card("7", "C"), joker()], "9")
        .valid,
    ).toBe(false);
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
