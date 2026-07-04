import { describe, expect, it } from "vitest";
import type { HandState } from "../src/handState";
import { proposeMeld, discard, drawFromStock, passLayoff } from "../src/handState";
import { scoreHandForAllPlayers } from "../src/scoring";
import { card } from "./testHelpers";

function unwrap<T>(result: { ok: boolean; state?: T; error?: string }): T {
  if (!result.ok) throw new Error(`Expected ok result, got error: ${result.error}`);
  return result.state as T;
}

describe('going out ("Pay Me!")', () => {
  const initialState: HandState = {
    wildRank: "K",
    playerOrder: ["p1", "p2"],
    currentPlayerIndex: 0,
    hasDrawnThisTurn: true, // p1 has already drawn for this turn
    hands: {
      p1: [card("3", "S"), card("3", "H"), card("3", "D"), card("9", "C")],
      p2: [card("5", "S"), card("6", "S"), card("7", "S"), card("Q", "H")],
    },
    stock: [card("4", "D")],
    discardPile: [card("2", "D")],
    melds: [],
    phase: "playing",
    payMeCallerId: null,
    pendingFinalTurns: [],
    pendingLayoffs: [],
    connectedPlayers: new Set(["p1", "p2"]),
  };

  it("requires a discard even when the rest of the hand is melded - never hits zero cards mid-turn", () => {
    const afterMeld = unwrap(
      proposeMeld(initialState, "p1", [card("3", "S"), card("3", "H"), card("3", "D")], "SET"),
    );
    expect(afterMeld.hands.p1).toHaveLength(1); // still holds the 9C, not empty yet
    expect(afterMeld.phase).toBe("playing");
  });

  it("triggers final turns for everyone else once the caller discards their last card", () => {
    const afterMeld = unwrap(
      proposeMeld(initialState, "p1", [card("3", "S"), card("3", "H"), card("3", "D")], "SET"),
    );
    const afterDiscard = unwrap(discard(afterMeld, "p1", card("9", "C")));

    expect(afterDiscard.hands.p1).toHaveLength(0);
    expect(afterDiscard.phase).toBe("final_turns");
    expect(afterDiscard.payMeCallerId).toBe("p1");
    expect(afterDiscard.pendingFinalTurns).toEqual(["p2"]);
    expect(afterDiscard.playerOrder[afterDiscard.currentPlayerIndex]).toBe("p2");
  });

  it("moves to lay-off once every other player has taken their final turn, then to scoring", () => {
    const afterMeld = unwrap(
      proposeMeld(initialState, "p1", [card("3", "S"), card("3", "H"), card("3", "D")], "SET"),
    );
    const afterDiscard = unwrap(discard(afterMeld, "p1", card("9", "C")));

    const afterDraw = unwrap(drawFromStock(afterDiscard, "p2"));
    expect(afterDraw.hands.p2).toContainEqual(card("4", "D"));

    const afterFinalDiscard = unwrap(discard(afterDraw, "p2", card("Q", "H")));
    expect(afterFinalDiscard.phase).toBe("layoff");
    expect(afterFinalDiscard.pendingLayoffs).toEqual(["p2"]);

    const afterPass = unwrap(passLayoff(afterFinalDiscard, "p2"));
    expect(afterPass.phase).toBe("scoring");

    const scores = scoreHandForAllPlayers(afterPass.hands, afterPass.wildRank, "p1");
    const p1Score = scores.find((s) => s.playerId === "p1")!;
    const p2Score = scores.find((s) => s.playerId === "p2")!;

    expect(p1Score.score).toBe(0);
    expect(p1Score.isPayMeCaller).toBe(true);
    // remaining p2 hand: 5S + 6S + 7S + 4D = 22
    expect(p2Score.score).toBe(22);
    expect(p2Score.isPayMeCaller).toBe(false);
  });

  it("rejects a meld attempt out of turn", () => {
    const result = proposeMeld(
      initialState,
      "p2",
      [card("5", "S"), card("6", "S"), card("7", "S")],
      "RUN",
    );
    expect(result.ok).toBe(false);
  });

  it("rejects drawing twice in the same turn", () => {
    const oneDrawState: HandState = { ...initialState, hasDrawnThisTurn: false };
    const afterDraw = unwrap(drawFromStock(oneDrawState, "p1"));
    const secondDraw = drawFromStock(afterDraw, "p1");
    expect(secondDraw.ok).toBe(false);
  });
});
