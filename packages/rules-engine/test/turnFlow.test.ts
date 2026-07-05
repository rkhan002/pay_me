import { describe, expect, it } from "vitest";
import type { HandState } from "../src/handState";
import {
  discard,
  drawFromDiscard,
  drawFromStock,
  layOffDuringLayoffPhase,
  layOffDuringTurn,
  passLayoff,
  proposeMeld,
  skipStalePlayer,
} from "../src/handState";
import { cardKey } from "../src/deck";
import { card, joker } from "./testHelpers";

function unwrap<T>(result: { ok: boolean; state?: T; error?: string }): T {
  if (!result.ok) throw new Error(`Expected ok result, got error: ${result.error}`);
  return result.state as T;
}

function baseState(overrides: Partial<HandState> = {}): HandState {
  return {
    wildRank: "9",
    playerOrder: ["p1", "p2", "p3"],
    currentPlayerIndex: 0,
    hasDrawnThisTurn: false,
    hands: {
      p1: [card("4", "S"), card("5", "S"), card("6", "C")],
      p2: [card("K", "D"), card("Q", "D"), card("J", "D")],
      p3: [card("7", "C"), card("8", "C"), card("2", "H")],
    },
    stock: [card("3", "D")],
    discardPile: [card("2", "D")],
    melds: [
      {
        id: "meld_1",
        ownerId: "p2",
        type: "SET",
        cards: [card("6", "S"), card("6", "H"), card("6", "D")],
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

describe("drawFromDiscard", () => {
  it("moves the top discard card into the drawing player's hand", () => {
    const state = baseState();
    const result = unwrap(drawFromDiscard(state, "p1"));
    expect(result.hands.p1).toContainEqual(card("2", "D"));
    expect(result.discardPile).toHaveLength(0);
    expect(result.hasDrawnThisTurn).toBe(true);
  });

  it("rejects drawing from an empty discard pile", () => {
    const state = baseState({ discardPile: [] });
    expect(drawFromDiscard(state, "p1").ok).toBe(false);
  });
});

describe("lay-off during a normal turn", () => {
  it("lets the current player extend an existing meld after drawing", () => {
    const drawn = unwrap(drawFromStock(baseState(), "p1"));
    const result = unwrap(layOffDuringTurn(drawn, "p1", card("6", "C"), "meld_1"));
    const meld = result.melds.find((m) => m.id === "meld_1")!;
    expect(meld.cards).toHaveLength(4);
    expect(result.hands.p1).not.toContainEqual(card("6", "C"));
  });

  it("rejects a card that doesn't fit the meld", () => {
    const drawn = unwrap(drawFromStock(baseState(), "p1"));
    const result = layOffDuringTurn(drawn, "p1", card("4", "S"), "meld_1");
    expect(result.ok).toBe(false);
  });

  it("rejects laying off before drawing", () => {
    const result = layOffDuringTurn(baseState(), "p1", card("6", "C"), "meld_1");
    expect(result.ok).toBe(false);
  });

  it("rejects laying off onto a meld that doesn't exist", () => {
    const drawn = unwrap(drawFromStock(baseState(), "p1"));
    const result = layOffDuringTurn(drawn, "p1", card("6", "C"), "no-such-meld");
    expect(result.ok).toBe(false);
  });
});

describe("lay-off phase", () => {
  const layoffState = baseState({
    phase: "layoff",
    payMeCallerId: "p1",
    pendingLayoffs: ["p2", "p3"],
    currentPlayerIndex: 1, // p2's turn to lay off
  });

  it("only allows the player whose lay-off turn it is", () => {
    const result = layOffDuringLayoffPhase(layoffState, "p3", card("6", "C"), "meld_1");
    expect(result.ok).toBe(false);
  });

  it("rejects layOffDuringTurn helper once in the dedicated lay-off phase", () => {
    // The turn-based lay-off entry point is for the playing/final_turns
    // phases only; the lay-off phase has its own entry point.
    const result = layOffDuringTurn(layoffState, "p2", card("J", "D"), "meld_1");
    expect(result.ok).toBe(false);
  });

  it("advances to the next pending player on pass, then to scoring once empty", () => {
    const afterP2Pass = unwrap(passLayoff(layoffState, "p2"));
    expect(afterP2Pass.pendingLayoffs).toEqual(["p3"]);
    expect(afterP2Pass.phase).toBe("layoff");

    const afterP3Pass = unwrap(passLayoff(afterP2Pass, "p3"));
    expect(afterP3Pass.pendingLayoffs).toEqual([]);
    expect(afterP3Pass.phase).toBe("scoring");
  });

  it("rejects a pass from someone who isn't up", () => {
    const result = passLayoff(layoffState, "p3");
    expect(result.ok).toBe(false);
  });
});

describe("disconnected players are skipped in turn order", () => {
  it("advances past a disconnected player to the next connected one", () => {
    const state = baseState({
      hasDrawnThisTurn: true,
      connectedPlayers: new Set(["p1", "p3"]), // p2 disconnected
    });
    const afterDiscard = unwrap(discard(state, "p1", card("5", "S")));
    expect(afterDiscard.playerOrder[afterDiscard.currentPlayerIndex]).toBe("p3");
  });
});

describe("skipStalePlayer", () => {
  it("rejects skipping someone who isn't currently up", () => {
    const result = skipStalePlayer(baseState(), "p2");
    expect(result.ok).toBe(false);
  });

  it("rejects skipping outside playing/final_turns/layoff phases", () => {
    const result = skipStalePlayer(baseState({ phase: "scoring" }), "p1");
    expect(result.ok).toBe(false);
  });

  it("playing phase: behaves like advancing past a disconnected current player", () => {
    const state = baseState({ connectedPlayers: new Set(["p2", "p3"]) }); // p1 (current) stale
    const result = unwrap(skipStalePlayer(state, "p1"));
    expect(result.playerOrder[result.currentPlayerIndex]).toBe("p2");
    expect(result.hasDrawnThisTurn).toBe(false);
  });

  it("final_turns phase: removes the target and moves to the next pending player", () => {
    const state = baseState({
      phase: "final_turns",
      payMeCallerId: "p1",
      pendingFinalTurns: ["p2", "p3"],
      currentPlayerIndex: 1, // p2's final turn
    });
    const result = unwrap(skipStalePlayer(state, "p2"));
    expect(result.pendingFinalTurns).toEqual(["p3"]);
    expect(result.playerOrder[result.currentPlayerIndex]).toBe("p3");
    expect(result.phase).toBe("final_turns");
  });

  it("final_turns phase: cascades into layoff when the pending list empties", () => {
    const state = baseState({
      phase: "final_turns",
      payMeCallerId: "p1",
      pendingFinalTurns: ["p2"],
      currentPlayerIndex: 1,
    });
    const result = unwrap(skipStalePlayer(state, "p2"));
    expect(result.pendingFinalTurns).toEqual([]);
    expect(result.phase).toBe("layoff");
    // pendingLayoffs is built the same way discard()'s cascade builds it -
    // everyone but the caller, without re-filtering out whoever was just
    // skipped here. p2 (just skipped) still owes a lay-off turn and will
    // need its own skip click when that turn comes up - the two phases'
    // stale-checks are independent, same as they are for any other player.
    expect(result.pendingLayoffs).toEqual(["p2", "p3"]);
    expect(result.playerOrder[result.currentPlayerIndex]).toBe("p2");
  });


  it("layoff phase: removes the target and moves to the next pending player", () => {
    const state = baseState({
      phase: "layoff",
      payMeCallerId: "p1",
      pendingLayoffs: ["p2", "p3"],
      currentPlayerIndex: 1,
    });
    const result = unwrap(skipStalePlayer(state, "p2"));
    expect(result.pendingLayoffs).toEqual(["p3"]);
    expect(result.playerOrder[result.currentPlayerIndex]).toBe("p3");
    expect(result.phase).toBe("layoff");
  });

  it("layoff phase: cascades to scoring once the pending list empties", () => {
    const state = baseState({
      phase: "layoff",
      payMeCallerId: "p1",
      pendingLayoffs: ["p2"],
      currentPlayerIndex: 1,
    });
    const result = unwrap(skipStalePlayer(state, "p2"));
    expect(result.pendingLayoffs).toEqual([]);
    expect(result.phase).toBe("scoring");
  });
});

describe("proposeMeld with wild cards in a run", () => {
  it("requires a wild assignment for a run and stores the run sorted", () => {
    const wild = joker();
    const state = baseState({
      hands: {
        p1: [card("4", "S"), card("5", "S"), wild, card("2", "H")],
        p2: [],
        p3: [],
      },
      hasDrawnThisTurn: true,
    });

    const withoutAssignment = proposeMeld(
      state,
      "p1",
      [card("4", "S"), card("5", "S"), wild],
      "RUN",
    );
    expect(withoutAssignment.ok).toBe(false);

    const result = unwrap(
      proposeMeld(state, "p1", [card("4", "S"), card("5", "S"), wild], "RUN", {
        [cardKey(wild)]: "6",
      }),
    );
    const meld = result.melds.find((m) => m.id !== "meld_1")!;
    expect(meld.type).toBe("RUN");
    expect(meld.cards.map((c) => c.rank)).toEqual(["4", "5", "JOKER"]);
    expect(meld.cards[2].wildAs).toBe("6");
  });

  it("rejects an assignment that doesn't complete a valid run", () => {
    const wild = joker();
    const state = baseState({
      hands: { p1: [card("4", "S"), card("5", "S"), wild], p2: [], p3: [] },
      hasDrawnThisTurn: true,
    });
    const result = proposeMeld(state, "p1", [card("4", "S"), card("5", "S"), wild], "RUN", {
      [cardKey(wild)]: "K",
    });
    expect(result.ok).toBe(false);
  });
});

describe("laying off a wild card onto an existing run", () => {
  const runMeld = {
    id: "run_1",
    ownerId: "p2",
    type: "RUN" as const,
    cards: [card("4", "S"), card("5", "S"), card("6", "S")],
  };

  it("requires a wild rank assignment and extends the run", () => {
    const wild = joker();
    const state = baseState({
      hands: { p1: [wild], p2: [], p3: [] },
      melds: [runMeld],
      hasDrawnThisTurn: true,
    });

    const withoutAssignment = layOffDuringTurn(state, "p1", wild, "run_1");
    expect(withoutAssignment.ok).toBe(false);

    const result = unwrap(layOffDuringTurn(state, "p1", wild, "run_1", "7"));
    const meld = result.melds.find((m) => m.id === "run_1")!;
    expect(meld.cards.map((c) => c.rank)).toEqual(["4", "5", "6", "JOKER"]);
    expect(meld.cards[3].wildAs).toBe("7");
  });

  it("rejects a rank that doesn't extend the run", () => {
    const wild = joker();
    const state = baseState({
      hands: { p1: [wild], p2: [], p3: [] },
      melds: [runMeld],
      hasDrawnThisTurn: true,
    });
    const result = layOffDuringTurn(state, "p1", wild, "run_1", "K");
    expect(result.ok).toBe(false);
  });
});

describe("propose meld failure paths", () => {
  it("rejects a meld using cards the player doesn't hold", () => {
    const drawn = unwrap(drawFromStock(baseState(), "p1"));
    const result = proposeMeld(
      drawn,
      "p1",
      [card("A", "S"), card("A", "H"), card("A", "D")],
      "SET",
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an otherwise-valid meld shape if it fails wild/natural rules", () => {
    const drawn = unwrap(
      drawFromStock(
        baseState({ hands: { p1: [joker(), joker(), card("2", "H")], p2: [], p3: [] } }),
        "p1",
      ),
    );
    // Only 1 natural among these 4 cards (2H) once the drawn stock card is added -
    // depends on what was drawn, so just assert the meld with 2 jokers + 1 natural
    // (still short of the 2-natural floor) is rejected regardless of the 4th card.
    const result = proposeMeld(drawn, "p1", [joker(), joker(), card("2", "H")], "SET");
    expect(result.ok).toBe(false);
  });
});
