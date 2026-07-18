import { describe, expect, it } from "vitest";
import type { HandState } from "../src/handState";
import { layOffDuringLayoffPhase, layOffDuringTurn, stealWildFromRun } from "../src/handState";
import { cardKey } from "../src/deck";
import { card, joker } from "./testHelpers";

// Seat order [p1, p2, p3]. p2 called Pay Me (the "winner"). p1 owns a set,
// p2 (winner) owns a run "7-8-9 of Hearts" with a joker standing in for the 8.
function baseState(overrides: Partial<HandState> = {}): HandState {
  return {
    wildRank: "3",
    playerOrder: ["p1", "p2", "p3"],
    currentPlayerIndex: 0,
    hasDrawnThisTurn: true,
    hands: {
      p1: [card("7", "H", 1), card("K", "C")],
      p2: [],
      p3: [card("9", "S")],
    },
    stock: [card("A", "C")],
    discardPile: [card("2", "D")],
    melds: [
      {
        id: "m_p1",
        ownerId: "p1",
        type: "SET",
        cards: [card("Q", "S"), card("Q", "H"), card("Q", "D")],
      },
      {
        id: "m_win",
        ownerId: "p2",
        type: "RUN",
        cards: [card("7", "H"), { ...joker(), wildAs: "8" }, card("9", "H")],
      },
    ],
    phase: "layoff",
    payMeCallerId: "p2",
    pendingFinalTurns: [],
    pendingLayoffs: ["p1", "p3"],
    connectedPlayers: new Set(["p1", "p2", "p3"]),
    ...overrides,
  };
}

describe("lay-off targets by phase", () => {
  it("during the lay-off round you may only lay off onto the winner's meld", () => {
    const s = baseState();
    // p1 tries to lay a Q onto their OWN set during the lay-off round -> rejected
    const ownMeld = layOffDuringLayoffPhase(s, "p1", card("Q", "C"), "m_p1");
    expect(ownMeld.ok).toBe(false);
    expect(!ownMeld.ok && ownMeld.error).toMatch(/winner's meld/);
  });

  it("laying off onto the winner's meld is allowed in the lay-off round", () => {
    const s = baseState({ hands: { p1: [card("6", "H")], p2: [], p3: [] } });
    const r = layOffDuringLayoffPhase(s, "p1", card("6", "H"), "m_win");
    expect(r.ok).toBe(true);
  });

  it("during final_turns a player may only extend their OWN melds", () => {
    const s = baseState({
      phase: "final_turns",
      pendingFinalTurns: ["p1"],
      currentPlayerIndex: 0,
    });
    const ontoWinner = layOffDuringTurn(s, "p1", card("6", "H"), "m_win");
    expect(ontoWinner.ok).toBe(false);
    expect(!ontoWinner.ok && ontoWinner.error).toMatch(/your own melds/);
  });
});

describe("wild steal (runs only, lay-off round)", () => {
  it("steals the joker from the winner's run by substituting the natural 8H", () => {
    const s = baseState({ hands: { p1: [card("8", "H"), card("K", "C")], p2: [], p3: [] } });
    const r = stealWildFromRun(s, "p1", "m_win", card("8", "H"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // the joker is now in p1's hand (its run designation stripped)
    const p1Keys = r.state.hands["p1"].map(cardKey);
    expect(p1Keys).toContain(cardKey(joker()));
    expect(p1Keys).not.toContain(cardKey(card("8", "H"))); // gave up the natural
    // the run now holds the natural 8H (no wild), still 7-8-9 of Hearts
    const run = r.state.melds.find((m) => m.id === "m_win")!;
    expect(run.cards.some((c) => c.rank === "JOKER")).toBe(false);
    expect(run.cards.map((c) => c.rank)).toEqual(["7", "8", "9"]);
    expect(run.cards.every((c) => c.suit === "H")).toBe(true);
  });

  it("rejects stealing from a SET", () => {
    const s = baseState({ hands: { p1: [card("Q", "C")], p2: [], p3: [] } });
    const r = stealWildFromRun(s, "p1", "m_p1", card("Q", "C"));
    // m_p1 is a set AND not the winner's meld - either way rejected
    expect(r.ok).toBe(false);
  });

  it("rejects a substitute of the wrong suit", () => {
    const s = baseState({ hands: { p1: [card("8", "S")], p2: [], p3: [] } });
    const r = stealWildFromRun(s, "p1", "m_win", card("8", "S"));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/suit/);
  });

  it("rejects when no wild in the run stands for that card's rank", () => {
    const s = baseState({ hands: { p1: [card("7", "H", 1)], p2: [], p3: [] } });
    const r = stealWildFromRun(s, "p1", "m_win", card("7", "H", 1));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/standing in for/);
  });

  it("only works during the lay-off round", () => {
    const s = baseState({ phase: "final_turns", pendingFinalTurns: ["p1"] });
    const r = stealWildFromRun(s, "p1", "m_win", card("8", "H"));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/lay-off round/);
  });
});
