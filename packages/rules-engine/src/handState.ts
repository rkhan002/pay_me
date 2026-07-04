import { randomUUID } from "node:crypto";
import { cardKey, type Card, type Rank } from "./deck";
import { reshuffleDiscardIntoStock as reshuffle, dealCards } from "./deal";
import { validateMeld, canLayOff, type MeldType } from "./melds";

export type HandPhase = "playing" | "final_turns" | "layoff" | "scoring" | "complete";

export interface TableMeld {
  id: string;
  type: MeldType;
  ownerId: string;
  cards: Card[];
}

export interface HandState {
  wildRank: Rank;
  playerOrder: string[];
  currentPlayerIndex: number;
  /** True once the current player has drawn and is free to meld/lay off/discard. */
  hasDrawnThisTurn: boolean;
  hands: Record<string, Card[]>;
  stock: Card[];
  discardPile: Card[];
  melds: TableMeld[];
  phase: HandPhase;
  payMeCallerId: string | null;
  /** Players (other than the caller) who still owe their final turn. */
  pendingFinalTurns: string[];
  /** Players (other than the caller) who still owe a lay-off turn. */
  pendingLayoffs: string[];
  connectedPlayers: Set<string>;
}

export type Result<T> = { ok: true; state: T } | { ok: false; error: string };

function currentPlayer(state: HandState): string {
  return state.playerOrder[state.currentPlayerIndex];
}

function nextIndex(state: HandState): number {
  return (state.currentPlayerIndex + 1) % state.playerOrder.length;
}

/** Advances turn order, auto-skipping disconnected players' turns. */
function advanceTurn(state: HandState): HandState {
  let idx = nextIndex(state);
  let guard = 0;
  while (!state.connectedPlayers.has(state.playerOrder[idx]) && guard < state.playerOrder.length) {
    idx = (idx + 1) % state.playerOrder.length;
    guard++;
  }
  return { ...state, currentPlayerIndex: idx, hasDrawnThisTurn: false };
}

export function drawFromStock(state: HandState, playerId: string): Result<HandState> {
  if (state.phase !== "playing" && state.phase !== "final_turns") {
    return { ok: false, error: "Not in a drawing phase" };
  }
  if (currentPlayer(state) !== playerId) return { ok: false, error: "Not your turn" };
  if (state.hasDrawnThisTurn) return { ok: false, error: "Already drew this turn" };

  let stock = state.stock;
  let discardPile = state.discardPile;
  if (stock.length === 0) {
    const reshuffled = reshuffle(discardPile);
    stock = reshuffled.stock;
    discardPile = reshuffled.discardPile;
    if (stock.length === 0) return { ok: false, error: "No cards left to draw" };
  }

  const [drawn, ...rest] = stock;
  const hands = { ...state.hands, [playerId]: [...state.hands[playerId], drawn] };
  return {
    ok: true,
    state: { ...state, stock: rest, discardPile, hands, hasDrawnThisTurn: true },
  };
}

export function drawFromDiscard(state: HandState, playerId: string): Result<HandState> {
  if (state.phase !== "playing" && state.phase !== "final_turns") {
    return { ok: false, error: "Not in a drawing phase" };
  }
  if (currentPlayer(state) !== playerId) return { ok: false, error: "Not your turn" };
  if (state.hasDrawnThisTurn) return { ok: false, error: "Already drew this turn" };
  if (state.discardPile.length === 0) return { ok: false, error: "Discard pile is empty" };

  const [top, ...restDiscard] = state.discardPile;
  const hands = { ...state.hands, [playerId]: [...state.hands[playerId], top] };
  return {
    ok: true,
    state: { ...state, discardPile: restDiscard, hands, hasDrawnThisTurn: true },
  };
}

function removeCardsFromHand(hand: Card[], cards: Card[]): Card[] | null {
  const remaining = [...hand];
  for (const card of cards) {
    const idx = remaining.findIndex((c) => cardKey(c) === cardKey(card));
    if (idx === -1) return null;
    remaining.splice(idx, 1);
  }
  return remaining;
}

function nextMeldId(): string {
  // melds.id is a uuid column in Postgres. A counter-based string like
  // "meld_1" passes every check the rules-engine itself does (it never
  // touches the DB) but fails the real insert with "invalid input syntax
  // for type uuid" - by which point other writes in the same request had
  // already committed, so the meld silently vanished instead of saving.
  return randomUUID();
}

export function proposeMeld(
  state: HandState,
  playerId: string,
  cards: Card[],
  meldType: MeldType,
): Result<HandState> {
  if (state.phase !== "playing" && state.phase !== "final_turns") {
    return { ok: false, error: "Melding isn't allowed right now" };
  }
  if (currentPlayer(state) !== playerId) return { ok: false, error: "Not your turn" };
  if (!state.hasDrawnThisTurn) return { ok: false, error: "Draw a card before melding" };

  const validation = validateMeld(cards, meldType, state.wildRank);
  if (!validation.valid) return { ok: false, error: validation.reason ?? "Invalid meld" };

  const remainingHand = removeCardsFromHand(state.hands[playerId], cards);
  if (!remainingHand) return { ok: false, error: "You don't hold all of those cards" };

  const meld: TableMeld = { id: nextMeldId(), type: meldType, ownerId: playerId, cards };
  return {
    ok: true,
    state: {
      ...state,
      hands: { ...state.hands, [playerId]: remainingHand },
      melds: [...state.melds, meld],
    },
  };
}

export function layOffDuringTurn(
  state: HandState,
  playerId: string,
  card: Card,
  meldId: string,
): Result<HandState> {
  if (state.phase !== "playing" && state.phase !== "final_turns") {
    return { ok: false, error: "Lay-off isn't allowed right now" };
  }
  if (currentPlayer(state) !== playerId) return { ok: false, error: "Not your turn" };
  if (!state.hasDrawnThisTurn) return { ok: false, error: "Draw a card before laying off" };
  return applyLayoff(state, playerId, card, meldId);
}

function applyLayoff(
  state: HandState,
  playerId: string,
  card: Card,
  meldId: string,
): Result<HandState> {
  const meldIndex = state.melds.findIndex((m) => m.id === meldId);
  if (meldIndex === -1) return { ok: false, error: "No such meld on the table" };
  const meld = state.melds[meldIndex];
  if (!canLayOff(meld.cards, meld.type, card, state.wildRank)) {
    return { ok: false, error: "That card can't be added to this meld" };
  }
  const remainingHand = removeCardsFromHand(state.hands[playerId], [card]);
  if (!remainingHand) return { ok: false, error: "You don't hold that card" };

  const updatedMeld: TableMeld = { ...meld, cards: [...meld.cards, card] };
  const melds = [...state.melds];
  melds[meldIndex] = updatedMeld;

  return {
    ok: true,
    state: { ...state, hands: { ...state.hands, [playerId]: remainingHand }, melds },
  };
}

/**
 * Ends the current turn by discarding. Going out ("Pay Me!") is triggered
 * here: the player must still discard even when melding everything else,
 * so a hand never sits at zero cards mid-turn. If this discard empties
 * their hand, every other player gets one final turn, then a lay-off phase.
 */
export function discard(state: HandState, playerId: string, card: Card): Result<HandState> {
  if (state.phase !== "playing" && state.phase !== "final_turns") {
    return { ok: false, error: "Discarding isn't allowed right now" };
  }
  if (currentPlayer(state) !== playerId) return { ok: false, error: "Not your turn" };
  if (!state.hasDrawnThisTurn) return { ok: false, error: "Draw a card before discarding" };

  const remainingHand = removeCardsFromHand(state.hands[playerId], [card]);
  if (!remainingHand) return { ok: false, error: "You don't hold that card" };

  const hands = { ...state.hands, [playerId]: remainingHand };
  const discardPile = [card, ...state.discardPile];
  const wentOut = remainingHand.length === 0;

  if (state.phase === "playing") {
    if (wentOut) {
      const others = state.playerOrder.filter((id) => id !== playerId);
      return {
        ok: true,
        state: {
          ...state,
          hands,
          discardPile,
          phase: "final_turns",
          payMeCallerId: playerId,
          pendingFinalTurns: others,
          currentPlayerIndex: state.playerOrder.indexOf(others[0]),
          hasDrawnThisTurn: false,
        },
      };
    }
    return { ok: true, state: advanceTurn({ ...state, hands, discardPile }) };
  }

  // final_turns phase: this player has now taken their one last turn.
  const pendingFinalTurns = state.pendingFinalTurns.filter((id) => id !== playerId);
  if (pendingFinalTurns.length === 0) {
    const pendingLayoffs = state.playerOrder.filter((id) => id !== state.payMeCallerId);
    return {
      ok: true,
      state: {
        ...state,
        hands,
        discardPile,
        pendingFinalTurns,
        phase: "layoff",
        pendingLayoffs,
        currentPlayerIndex: state.playerOrder.indexOf(pendingLayoffs[0] ?? playerId),
      },
    };
  }
  const nextPlayerId = pendingFinalTurns[0];
  return {
    ok: true,
    state: {
      ...state,
      hands,
      discardPile,
      pendingFinalTurns,
      currentPlayerIndex: state.playerOrder.indexOf(nextPlayerId),
      hasDrawnThisTurn: false,
    },
  };
}

/** Lay-off phase: each remaining player, in turn order, may add cards, then passes. */
export function layOffDuringLayoffPhase(
  state: HandState,
  playerId: string,
  card: Card,
  meldId: string,
): Result<HandState> {
  if (state.phase !== "layoff") return { ok: false, error: "Not in the lay-off phase" };
  if (currentPlayer(state) !== playerId) return { ok: false, error: "Not your lay-off turn" };
  return applyLayoff(state, playerId, card, meldId);
}

export function passLayoff(state: HandState, playerId: string): Result<HandState> {
  if (state.phase !== "layoff") return { ok: false, error: "Not in the lay-off phase" };
  if (currentPlayer(state) !== playerId) return { ok: false, error: "Not your lay-off turn" };

  const pendingLayoffs = state.pendingLayoffs.filter((id) => id !== playerId);
  if (pendingLayoffs.length === 0) {
    return { ok: true, state: { ...state, pendingLayoffs, phase: "scoring" } };
  }
  const nextPlayerId = pendingLayoffs[0];
  return {
    ok: true,
    state: {
      ...state,
      pendingLayoffs,
      currentPlayerIndex: state.playerOrder.indexOf(nextPlayerId),
    },
  };
}

export function isHandComplete(state: HandState): boolean {
  return state.phase === "scoring" || state.phase === "complete";
}

/** Builds the starting HandState for a new hand: deals, flips the upcard, seats player 1 first. */
export function initHandState(
  playerOrder: string[],
  wildRank: Rank,
  dealSize: number,
  rng?: () => number,
): HandState {
  const { hands, stock, discardPile } = dealCards(playerOrder, dealSize, rng);
  return {
    wildRank,
    playerOrder,
    currentPlayerIndex: 0,
    hasDrawnThisTurn: false,
    hands,
    stock,
    discardPile,
    melds: [],
    phase: "playing",
    payMeCallerId: null,
    pendingFinalTurns: [],
    pendingLayoffs: [],
    connectedPlayers: new Set(playerOrder),
  };
}
