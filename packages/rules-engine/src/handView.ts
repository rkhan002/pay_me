// Projects the authoritative (service-role) HandState down to exactly what a
// single viewer is allowed to see - the same shape the client builds in
// loadHand(), so an edge function can return it directly and the client can
// apply it WITHOUT a second read round trip.
//
// Crucially this reproduces the row-level-security visibility rules the client
// would otherwise get for free from Postgres (see migration 0006): the edge
// function runs as service_role and can see everything, so we must gate here
// what a normal RLS-scoped read would hide. Getting this wrong would leak an
// opponent's hidden melds, so the meld filter mirrors that policy exactly and
// is covered by unit tests.
import type { Card, Rank } from "./deck";
import type { HandState, HandPhase } from "./handState";
import type { MeldType } from "./melds";

/** A single meld as the client consumes it (camelCase, sorted cards). */
export interface MeldView {
  id: string;
  ownerPlayerId: string;
  meldType: MeldType;
  cards: Card[];
}

/** Per-player public info: card counts always, score only once scored. */
export interface PublicHandInfoView {
  playerId: string;
  cardCount: number;
  score: number | null;
  hasTakenFinalTurn: boolean;
}

/**
 * The dynamic hand fields that change during play. Static id/handNumber/
 * dealSize are intentionally omitted - they never change mid-hand, so the
 * client keeps its existing values and overlays these.
 */
export interface HandFieldsView {
  wildRank: Rank;
  discardPile: Card[];
  turnPlayerId: string | null;
  hasDrawnThisTurn: boolean;
  phase: HandPhase;
  payMeCallerId: string | null;
  pendingFinalTurns: string[];
  pendingLayoffs: string[];
}

export interface HandView {
  hand: HandFieldsView;
  myCards: Card[];
  publicHandInfo: PublicHandInfoView[];
  melds: MeldView[];
}

/**
 * Can `viewer` see `meld`? Mirrors the RLS SELECT policy on melds/meld_cards
 * (migration 0009) exactly: the owner always sees their own meld; everyone
 * else sees a meld only once the lay-off round has begun (phase is
 * layoff/scoring/complete). Nothing is revealed during playing or final_turns.
 */
export function meldVisibleTo(
  meld: { ownerId: string },
  state: HandState,
  viewerPlayerId: string,
): boolean {
  if (meld.ownerId === viewerPlayerId) return true;

  // No meld is revealed to opponents until the lay-off round begins - i.e.
  // once every player has finished their final turn and the hand has moved
  // past "final_turns". Before then, you only ever see your own melds.
  return state.phase === "layoff" || state.phase === "scoring" || state.phase === "complete";
}

/**
 * Builds the viewer-scoped snapshot. `scores` (playerId -> points) is supplied
 * only when a hand has just been scored, so the completed-hand recap shows the
 * right numbers; otherwise score is null (as it is mid-hand in the DB).
 */
export function handViewFor(
  state: HandState,
  viewerPlayerId: string,
  scores?: Record<string, number>,
): HandView {
  return {
    hand: {
      wildRank: state.wildRank,
      discardPile: state.discardPile,
      turnPlayerId: state.playerOrder[state.currentPlayerIndex] ?? null,
      hasDrawnThisTurn: state.hasDrawnThisTurn,
      phase: state.phase,
      payMeCallerId: state.payMeCallerId,
      pendingFinalTurns: state.pendingFinalTurns,
      pendingLayoffs: state.pendingLayoffs,
    },
    myCards: state.hands[viewerPlayerId] ?? [],
    publicHandInfo: state.playerOrder.map((pid) => ({
      playerId: pid,
      cardCount: (state.hands[pid] ?? []).length,
      score: scores ? (scores[pid] ?? null) : null,
      hasTakenFinalTurn: false,
    })),
    melds: state.melds
      .filter((m) => meldVisibleTo(m, state, viewerPlayerId))
      .map((m) => ({
        id: m.id,
        ownerPlayerId: m.ownerId,
        meldType: m.type,
        cards: m.cards,
      })),
  };
}
