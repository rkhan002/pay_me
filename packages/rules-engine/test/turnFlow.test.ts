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
  unmeld,
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
  // Owned by p1 (not the default fixture's p2) - during ordinary play,
  // before Pay Me, a player can only lay off onto their own meld (see the
  // "melds are private pre-reveal" describe block below), so these tests
  // extend a meld the acting player themselves owns.
  const ownMeld = () => baseState({ melds: [{ ...baseState().melds[0], ownerId: "p1" }] });

  it("lets the current player extend an existing meld after drawing", () => {
    const drawn = unwrap(drawFromStock(ownMeld(), "p1"));
    const result = unwrap(layOffDuringTurn(drawn, "p1", card("6", "C"), "meld_1"));
    const meld = result.melds.find((m) => m.id === "meld_1")!;
    expect(meld.cards).toHaveLength(4);
    expect(result.hands.p1).not.toContainEqual(card("6", "C"));
  });

  it("rejects a card that doesn't fit the meld", () => {
    const drawn = unwrap(drawFromStock(ownMeld(), "p1"));
    const result = layOffDuringTurn(drawn, "p1", card("4", "S"), "meld_1");
    expect(result.ok).toBe(false);
  });

  it("rejects laying off before drawing", () => {
    const result = layOffDuringTurn(ownMeld(), "p1", card("6", "C"), "meld_1");
    expect(result.ok).toBe(false);
  });

  it("rejects laying off onto a meld that doesn't exist", () => {
    const drawn = unwrap(drawFromStock(ownMeld(), "p1"));
    const result = layOffDuringTurn(drawn, "p1", card("6", "C"), "no-such-meld");
    expect(result.ok).toBe(false);
  });
});

describe("melds are private pre-reveal", () => {
  it("rejects laying off onto another player's meld before Pay Me is declared", () => {
    // Default fixture: meld_1 is owned by p2, phase is "playing" (Pay Me
    // not yet declared) - p1 can't see or touch it.
    const drawn = unwrap(drawFromStock(baseState(), "p1"));
    const result = layOffDuringTurn(drawn, "p1", card("6", "C"), "meld_1");
    expect(result.ok).toBe(false);
  });

  it("still rejects laying off onto another player's meld during final turns (own melds only until the lay-off round)", () => {
    const state = baseState({
      phase: "final_turns",
      payMeCallerId: "p3",
      pendingFinalTurns: ["p1", "p2"],
      currentPlayerIndex: 0,
      hasDrawnThisTurn: true,
    });
    // meld_1 is p2's; before the lay-off round a player may only touch their own.
    const result = layOffDuringTurn(state, "p1", card("6", "C"), "meld_1");
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

describe("proposing a brand-new meld during the layoff phase", () => {
  // p2's whole hand (K-D, Q-D, J-D) is a valid run - lets this exercise the
  // real "form a new meld" path, not just a single lay-off onto meld_1.
  const layoffState = baseState({
    phase: "layoff",
    payMeCallerId: "p1",
    pendingLayoffs: ["p2", "p3"],
    currentPlayerIndex: 1, // p2's turn to lay off
    hasDrawnThisTurn: false,
  });

  it("allows the player up in the layoff round to form a new meld without having drawn", () => {
    const result = unwrap(
      proposeMeld(layoffState, "p2", [card("K", "D"), card("Q", "D"), card("J", "D")], "RUN"),
    );
    expect(result.hands.p2).toEqual([]);
    expect(result.melds).toHaveLength(2);
  });

  it("still rejects a meld from a player who isn't up in the layoff round", () => {
    const result = proposeMeld(
      layoffState,
      "p3",
      [card("7", "C"), card("8", "C"), card("2", "H")],
      "SET",
    );
    expect(result.ok).toBe(false);
  });
});

describe("runs with a dual-use wild-rank card", () => {
  it("stores a run with the wild-rank card as a natural (no wildAs)", () => {
    // wild 3: hand has 3H, 4H, a joker. Meld 3-4-5 (3 natural, joker = 5).
    const jk = joker();
    const state = baseState({
      wildRank: "3",
      hasDrawnThisTurn: true,
      hands: { p1: [card("3", "H"), card("4", "H"), jk], p2: [], p3: [] },
    });
    const result = unwrap(
      proposeMeld(state, "p1", [card("3", "H"), card("4", "H"), jk], "RUN", {
        [`JOKER#0`]: "5",
      }),
    );
    const meld = result.melds[result.melds.length - 1];
    expect(meld.type).toBe("RUN");
    // sorted 3,4,5; the natural 3H has no wildAs, the joker carries wildAs 5.
    expect(meld.cards.map((c) => c.rank)).toEqual(["3", "4", "JOKER"]);
    const threeH = meld.cards.find((c) => c.rank === "3");
    const jokerCard = meld.cards.find((c) => c.rank === "JOKER");
    expect(threeH.wildAs).toBeUndefined();
    expect(jokerCard.wildAs).toBe("5");
  });
});

describe("post-Pay-Me order starts from the seat after the caller", () => {
  // Regression for the CECBT bug: with seat order [p1, p2, p3] and p2 calling
  // Pay Me, the final turns (and the lay-off round) must run p3 -> p1, not the
  // old seat-order p1 -> p3.
  it("runs the final turns from the seat after the caller, wrapping around", () => {
    const state = baseState({
      currentPlayerIndex: 1, // p2's turn
      hasDrawnThisTurn: true,
      hands: {
        p1: [card("4", "S")],
        p2: [card("5", "S")], // p2 discards its last card -> goes out
        p3: [card("7", "C")],
      },
    });
    const result = unwrap(discard(state, "p2", card("5", "S")));
    expect(result.phase).toBe("final_turns");
    expect(result.payMeCallerId).toBe("p2");
    expect(result.pendingFinalTurns).toEqual(["p3", "p1"]);
    expect(result.playerOrder[result.currentPlayerIndex]).toBe("p3");
  });

  it("runs the lay-off round from the seat after the caller too", () => {
    // p2 called Pay Me; p1 is taking the last final turn. When it ends the
    // lay-off round should run p3 -> p1 (same rotation), not seat order.
    const state = baseState({
      phase: "final_turns",
      payMeCallerId: "p2",
      pendingFinalTurns: ["p1"],
      currentPlayerIndex: 0,
      hasDrawnThisTurn: true,
      hands: { p1: [card("4", "S"), card("5", "S")], p2: [], p3: [card("7", "C")] },
    });
    const result = unwrap(discard(state, "p1", card("5", "S")));
    expect(result.phase).toBe("layoff");
    expect(result.pendingLayoffs).toEqual(["p3", "p1"]);
    expect(result.playerOrder[result.currentPlayerIndex]).toBe("p3");
  });
});

describe("turn order waits for disconnected players (no auto-skip)", () => {
  it("advances to the very next player even if they're disconnected", () => {
    const state = baseState({
      hasDrawnThisTurn: true,
      connectedPlayers: new Set(["p1", "p3"]), // p2 disconnected - no longer skipped
    });
    const afterDiscard = unwrap(discard(state, "p1", card("5", "S")));
    expect(afterDiscard.playerOrder[afterDiscard.currentPlayerIndex]).toBe("p2");
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
  // Owned by p1, the acting player in these tests - melds are private
  // pre-reveal (see "melds are private pre-reveal" above), so a lay-off
  // during ordinary play only works on your own meld.
  const runMeld = {
    id: "run_1",
    ownerId: "p1",
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

describe("unmeld", () => {
  it("returns every card in the meld to the owner's hand and removes it", () => {
    const state = baseState({ melds: [{ ...baseState().melds[0], ownerId: "p1" }] });
    const result = unwrap(unmeld(state, "p1", "meld_1"));
    expect(result.melds).toHaveLength(0);
    expect(result.hands.p1).toEqual(
      expect.arrayContaining([card("6", "S"), card("6", "H"), card("6", "D")]),
    );
    expect(result.hands.p1).toHaveLength(state.hands.p1.length + 3);
  });

  it("strips a resolved run's wildAs designation off before returning it to hand", () => {
    const wild = { ...joker(), wildAs: "7" as const };
    const state = baseState({
      melds: [
        {
          id: "run_1",
          ownerId: "p1",
          type: "RUN",
          cards: [card("4", "S"), card("5", "S"), card("6", "S"), wild],
        },
      ],
    });
    const result = unwrap(unmeld(state, "p1", "run_1"));
    const returnedWild = result.hands.p1.find((c) => c.rank === "JOKER")!;
    expect(returnedWild.wildAs).toBeUndefined();
  });

  it("rejects unmelding another player's meld", () => {
    // Default fixture: meld_1 is owned by p2.
    const result = unmeld(baseState(), "p1", "meld_1");
    expect(result.ok).toBe(false);
  });

  it("rejects unmelding a meld that doesn't exist", () => {
    const result = unmeld(baseState(), "p2", "no-such-meld");
    expect(result.ok).toBe(false);
  });

  it("rejects unmelding once Pay Me has been declared", () => {
    const state = baseState({
      melds: [{ ...baseState().melds[0], ownerId: "p2" }],
      phase: "final_turns",
      payMeCallerId: "p1",
      pendingFinalTurns: ["p2", "p3"],
    });
    const result = unmeld(state, "p2", "meld_1");
    expect(result.ok).toBe(false);
  });
});
