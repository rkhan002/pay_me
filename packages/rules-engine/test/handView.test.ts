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

describe("meld visibility — hidden until the lay-off round", () => {
  it("during playing, a viewer sees only their own melds", () => {
    const v = handViewFor(baseState({ phase: "playing" }), "p1");
    expect(v.melds.map((m) => m.id)).toEqual(["m_p1"]);
  });

  it("during final_turns, opponents' melds are STILL hidden (even non-caller ones)", () => {
    const s = baseState({
      phase: "final_turns",
      payMeCallerId: "p3",
      pendingFinalTurns: ["p1", "p2"],
    });
    // p1 sees only their own; p2's (non-caller) and p3's (caller) stay hidden
    expect(handViewFor(s, "p1").melds.map((m) => m.id)).toEqual(["m_p1"]);
    expect(meldVisibleTo({ ownerId: "p2" }, s, "p1")).toBe(false);
    expect(meldVisibleTo({ ownerId: "p3" }, s, "p1")).toBe(false);
  });

  it("everyone's melds are revealed once the lay-off round begins", () => {
    for (const phase of ["layoff", "scoring", "complete"] as const) {
      const s = baseState({ phase, payMeCallerId: "p2" });
      expect(
        handViewFor(s, "p3")
          .melds.map((m) => m.id)
          .sort(),
      ).toEqual(["m_p1", "m_p2"]);
    }
  });

  it("the owner always sees their own meld, in every phase", () => {
    for (const phase of ["playing", "final_turns", "layoff", "scoring", "complete"] as const) {
      const s = baseState({ phase, payMeCallerId: "p2", pendingFinalTurns: ["p1"] });
      expect(meldVisibleTo({ ownerId: "p1" }, s, "p1")).toBe(true);
    }
  });
});
