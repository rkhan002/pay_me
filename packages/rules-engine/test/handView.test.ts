import { describe, expect, it } from "vitest";
import type { HandState } from "../src/handState";
import { handViewFor, meldVisibleTo } from "../src/handView";
import { card } from "./testHelpers";

function baseState(overrides: Partial<HandState> = {}): HandState {
  return {
    wildRank: "9",
    playerOrder: ["p1", "p2", "p3"],
    currentPlayerIndex: 0,
    hasDrawnThisTurn: true,
    hands: {
      p1: [card("4", "S"), card("5", "S")],
      p2: [card("K", "D"), card("Q", "D"), card("J", "D")],
      p3: [card("7", "C")],
    },
    stock: [card("3", "D"), card("3", "S")],
    discardPile: [card("2", "D")],
    melds: [
      {
        id: "m_p1",
        ownerId: "p1",
        type: "SET",
        cards: [card("6", "S"), card("6", "H"), card("6", "D")],
      },
      {
        id: "m_p2",
        ownerId: "p2",
        type: "SET",
        cards: [card("8", "S"), card("8", "H"), card("8", "D")],
      },
    ],
    phase: "playing",
    payMeCallerId: null,
    pendingFinalTurns: [],
    pendingLayoffs: [],
    connectedPlayers: new Set(["p1", "p2", "p3"]),
    ...overrides,
  };
}

describe("handViewFor - caller-scoped snapshot", () => {
  it("returns only the viewer's own hand as myCards, and card counts for all", () => {
    const v = handViewFor(baseState(), "p1");
    expect(v.myCards).toHaveLength(2);
    expect(v.publicHandInfo).toEqual([
      { playerId: "p1", cardCount: 2, score: null, hasTakenFinalTurn: false },
      { playerId: "p2", cardCount: 3, score: null, hasTakenFinalTurn: false },
      { playerId: "p3", cardCount: 1, score: null, hasTakenFinalTurn: false },
    ]);
    // never leaks other players' actual cards
    expect(JSON.stringify(v)).not.toContain('"K"');
  });

  it("maps hand fields and never includes the stock", () => {
    const v = handViewFor(baseState({ currentPlayerIndex: 1 }), "p1");
    expect(v.hand.turnPlayerId).toBe("p2");
    expect(v.hand.phase).toBe("playing");
    expect(v.hand.discardPile).toHaveLength(1);
    expect(JSON.stringify(v)).not.toContain('"stock"');
  });

  it("includes scores only when supplied", () => {
    const scored = handViewFor(baseState({ phase: "scoring" }), "p1", { p1: 0, p2: 30, p3: 7 });
    expect(scored.publicHandInfo.map((p) => p.score)).toEqual([0, 30, 7]);
  });
});

describe("meld visibility mirrors the RLS policy", () => {
  it("during playing, a viewer sees only their own melds", () => {
    const v = handViewFor(baseState({ phase: "playing" }), "p1");
    expect(v.melds.map((m) => m.id)).toEqual(["m_p1"]);
  });

  it("non-caller melds are revealed to everyone once the hand leaves playing", () => {
    const s = baseState({
      phase: "final_turns",
      payMeCallerId: "p3",
      pendingFinalTurns: ["p1", "p2"],
    });
    const v = handViewFor(s, "p1");
    // p2's meld (non-caller) is visible; p1 always sees own
    expect(v.melds.map((m) => m.id).sort()).toEqual(["m_p1", "m_p2"]);
  });

  it("the Pay Me caller's melds stay hidden from a viewer who still owes a final turn", () => {
    const s = baseState({
      phase: "final_turns",
      payMeCallerId: "p2",
      pendingFinalTurns: ["p1", "p3"],
    });
    // p1 still owes final turn -> cannot see caller p2's meld
    expect(meldVisibleTo({ ownerId: "p2" }, s, "p1")).toBe(false);
    expect(handViewFor(s, "p1").melds.map((m) => m.id)).toEqual(["m_p1"]);
  });

  it("the caller's melds become visible to a viewer who has taken their final turn", () => {
    const s = baseState({
      phase: "final_turns",
      payMeCallerId: "p2",
      pendingFinalTurns: ["p3"], // p1 already went
    });
    expect(meldVisibleTo({ ownerId: "p2" }, s, "p1")).toBe(true);
    expect(
      handViewFor(s, "p1")
        .melds.map((m) => m.id)
        .sort(),
    ).toEqual(["m_p1", "m_p2"]);
  });

  it("everything is visible in layoff/scoring/complete", () => {
    for (const phase of ["layoff", "scoring", "complete"] as const) {
      const s = baseState({ phase, payMeCallerId: "p2" });
      expect(
        handViewFor(s, "p3")
          .melds.map((m) => m.id)
          .sort(),
      ).toEqual(["m_p1", "m_p2"]);
    }
  });

  it("the caller always sees their own melds even mid-final-turns", () => {
    const s = baseState({
      phase: "final_turns",
      payMeCallerId: "p2",
      pendingFinalTurns: ["p1", "p3"],
    });
    expect(
      handViewFor(s, "p2")
        .melds.map((m) => m.id)
        .sort(),
    ).toEqual(["m_p1", "m_p2"]);
  });
});
