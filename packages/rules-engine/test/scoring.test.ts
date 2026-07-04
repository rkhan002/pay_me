import { describe, expect, it } from "vitest";
import { cardValue, scoreRemainingHand, computeStandings, mostPayMeCalls } from "../src/scoring";
import { card, joker } from "./testHelpers";

describe("cardValue", () => {
  it("scores wild cards (joker or hand rank) as 0", () => {
    expect(cardValue(joker(), "9")).toBe(0);
    expect(cardValue(card("9", "S"), "9")).toBe(0);
  });
  it("scores an ace as 15", () => {
    expect(cardValue(card("A", "S"), "9")).toBe(15);
  });
  it("scores king/queen/jack/10 as 10", () => {
    for (const rank of ["K", "Q", "J", "10"] as const) {
      expect(cardValue(card(rank, "S"), "2")).toBe(10);
    }
  });
  it("scores 2 through 9 as face value", () => {
    expect(cardValue(card("2", "S"), "K")).toBe(2);
    expect(cardValue(card("7", "S"), "K")).toBe(7);
  });
});

describe("scoreRemainingHand", () => {
  it("sums card values, ignoring wild rank cards", () => {
    const hand = [card("A", "S"), card("K", "H"), card("2", "D"), joker()];
    expect(scoreRemainingHand(hand, "2")).toBe(15 + 10 + 0 + 0);
  });
});

describe("computeStandings / mostPayMeCalls", () => {
  const results = [
    [
      { playerId: "p1", score: 0, isPayMeCaller: true },
      { playerId: "p2", score: 42, isPayMeCaller: false },
    ],
    [
      { playerId: "p1", score: 12, isPayMeCaller: false },
      { playerId: "p2", score: 0, isPayMeCaller: true },
    ],
    [
      { playerId: "p1", score: 0, isPayMeCaller: true },
      { playerId: "p2", score: 8, isPayMeCaller: false },
    ],
  ];

  it("ranks players by lowest cumulative score", () => {
    const standings = computeStandings(results);
    // p1: 0+12+0=12, p2: 42+0+8=50
    expect(standings[0].playerId).toBe("p1");
    expect(standings[0].cumulativeScore).toBe(12);
    expect(standings[1].cumulativeScore).toBe(50);
  });

  it("tracks Pay Me wins as a separate, non-tiebreaking tally", () => {
    const top = mostPayMeCalls(results);
    expect(top).toHaveLength(1);
    expect(top[0].playerId).toBe("p1");
    expect(top[0].payMeWins).toBe(2);
  });
});
