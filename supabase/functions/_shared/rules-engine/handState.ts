// AUTO-GENERATED from packages/rules-engine/src/handState.ts — DO NOT EDIT.
// Edit the source there, then run: npm run rules:sync
import { cardKey, isWildCard, type Card, type Rank } from "./deck.ts";
import { reshuffleDiscardIntoStock as reshuffle, dealCards } from "./deal.ts";
import {
  validateMeld,
  canLayOff,
  validateWildAssignments,
  sortRunCards,
  layoffWildCandidates,
  type MeldType,
} from "./melds.ts";

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

/**
 * Advances to the very next player in seat order. Disconnected players are no
 * longer auto-skipped - a turn simply waits for whoever is up (games that go a
 * full week with no action are ended by the server-side inactivity sweep
 * instead). This keeps "don't time players out" consistent: there's neither a
 * manual skip nor an automatic one, so no one ever gets two turns in a row.
 */
function advanceTurn(state: HandState): HandState {
  return { ...state, currentPlayerIndex: nextIndex(state), hasDrawnThisTurn: false };
}

/**
 * Turn order starting immediately AFTER `playerId` and wrapping around the
 * table, excluding `playerId` itself. The post-Pay-Me final turns and the
 * lay-off round both use this so play continues from the seat after whoever
 * called Pay Me - not from seat 0. (Building these with playerOrder.filter()
 * instead started every post-Pay-Me sequence at seat 0 regardless of where
 * the caller sat, so e.g. a caller in seat 1 of [A, B, C] handed the next
 * final turn to A instead of C.)
 */
function rotationAfter(playerOrder: string[], playerId: string): string[] {
  const start = playerOrder.indexOf(playerId);
  const order: string[] = [];
  for (let i = 1; i < playerOrder.length; i++) {
    order.push(playerOrder[(start + i) % playerOrder.length]);
  }
  return order;
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
  return crypto.randomUUID();
}

export function proposeMeld(
  state: HandState,
  playerId: string,
  cards: Card[],
  meldType: MeldType,
  wildAssignments?: Record<string, Rank>,
): Result<HandState> {
  if (state.phase !== "playing" && state.phase !== "final_turns" && state.phase !== "layoff") {
    return { ok: false, error: "Melding isn't allowed right now" };
  }
  if (currentPlayer(state) !== playerId) return { ok: false, error: "Not your turn" };
  // The layoff phase never involves drawing - it's a card-dump round after
  // everyone's had their real final turn - so the "drew this turn" gate
  // only applies to the phases where drawing is actually part of the turn.
  if (state.phase !== "layoff" && !state.hasDrawnThisTurn) {
    return { ok: false, error: "Draw a card before melding" };
  }

  const validation = validateMeld(cards, meldType, state.wildRank);
  if (!validation.valid) return { ok: false, error: validation.reason ?? "Invalid meld" };

  // A run's wild card(s) need to be pinned to a specific rank before the
  // meld can be stored - see melds.ts's runArrangements/validateWildAssignments.
  // A set never needs this: every natural in a set already shares one rank,
  // so a wild in a set has nothing ambiguous to resolve.
  if (meldType === "RUN") {
    const wildCheck = validateWildAssignments(cards, state.wildRank, wildAssignments ?? {});
    if (!wildCheck.valid) {
      return { ok: false, error: wildCheck.reason ?? "Invalid wild card assignment" };
    }
  }

  const remainingHand = removeCardsFromHand(state.hands[playerId], cards);
  if (!remainingHand) return { ok: false, error: "You don't hold all of those cards" };

  const resolvedCards = cards.map((c) =>
    meldType === "RUN" && isWildCard(c, state.wildRank) && wildAssignments?.[cardKey(c)]
      ? { ...c, wildAs: wildAssignments[cardKey(c)] }
      : c,
  );
  const finalCards =
    meldType === "RUN" ? sortRunCards(resolvedCards, state.wildRank) : resolvedCards;

  const meld: TableMeld = {
    id: nextMeldId(),
    type: meldType,
    ownerId: playerId,
    cards: finalCards,
  };
  return {
    ok: true,
    state: {
      ...state,
      hands: { ...state.hands, [playerId]: remainingHand },
      melds: [...state.melds, meld],
    },
  };
}

/**
 * Undoes a meld the player changed their mind about, returning every card
 * in it to their hand. Only available before anyone has called Pay Me
 * (state.payMeCallerId is still null) - melds are private to their owner
 * up to that point (see the RLS policies in supabase/migrations), so
 * there's no cross-player lay-off to unwind: nobody else could have
 * touched a meld they couldn't see. Once Pay Me is declared, melds are
 * revealed and locked for good, mirroring a real Rummy hand where you
 * can't take a card back off the table once everyone's seen it.
 */
export function unmeld(state: HandState, playerId: string, meldId: string): Result<HandState> {
  if (state.payMeCallerId !== null) {
    return { ok: false, error: "Melds are locked in once Pay Me has been declared" };
  }
  const meld = state.melds.find((m) => m.id === meldId);
  if (!meld) return { ok: false, error: "No such meld on the table" };
  if (meld.ownerId !== playerId) return { ok: false, error: "You can only unmeld your own meld" };

  // wildAs only means anything while the card is sitting in a RUN meld -
  // strip it back off before it returns to the hand.
  const returnedCards = meld.cards.map(({ wildAs: _wildAs, ...rest }) => rest as Card);
  const hands = { ...state.hands, [playerId]: [...state.hands[playerId], ...returnedCards] };
  const melds = state.melds.filter((m) => m.id !== meldId);

  return { ok: true, state: { ...state, hands, melds } };
}

export function layOffDuringTurn(
  state: HandState,
  playerId: string,
  card: Card,
  meldId: string,
  wildAssignedRank?: Rank,
): Result<HandState> {
  if (state.phase !== "playing" && state.phase !== "final_turns") {
    return { ok: false, error: "Lay-off isn't allowed right now" };
  }
  if (currentPlayer(state) !== playerId) return { ok: false, error: "Not your turn" };
  if (!state.hasDrawnThisTurn) return { ok: false, error: "Draw a card before laying off" };
  return applyLayoff(state, playerId, card, meldId, wildAssignedRank);
}

function applyLayoff(
  state: HandState,
  playerId: string,
  card: Card,
  meldId: string,
  wildAssignedRank?: Rank,
): Result<HandState> {
  const meldIndex = state.melds.findIndex((m) => m.id === meldId);
  if (meldIndex === -1) return { ok: false, error: "No such meld on the table" };
  const meld = state.melds[meldIndex];

  // Which melds you may lay off onto depends on the phase:
  //  - playing / final_turns: only your OWN melds. No one else's melds are
  //    revealed until the lay-off round (see handView / migration 0009), so
  //    you can only ever build onto your own before then.
  //  - layoff (the lay-off round): only the Pay Me caller's ("winner's") meld.
  //    That single revealed pile is the shared dumping ground; every other
  //    player's melds stay off-limits.
  if ((state.phase === "playing" || state.phase === "final_turns") && meld.ownerId !== playerId) {
    return {
      ok: false,
      error: "You can only add to your own melds before the lay-off round",
    };
  }
  if (state.phase === "layoff" && meld.ownerId !== state.payMeCallerId) {
    return {
      ok: false,
      error: "During the lay-off round you can only lay off onto the winner's meld",
    };
  }

  if (!canLayOff(meld.cards, meld.type, card, state.wildRank)) {
    return { ok: false, error: "That card can't be added to this meld" };
  }

  let resolvedCard = card;
  // Same reasoning as proposeMeld: a wild going onto a RUN needs its rank
  // pinned before it can be appended and the run re-sorted. A wild onto a
  // SET has nothing ambiguous - it just represents the set's one shared rank.
  if (meld.type === "RUN" && isWildCard(card, state.wildRank)) {
    if (!wildAssignedRank) {
      return { ok: false, error: "This wild card needs a rank assigned to join the run" };
    }
    const candidates = layoffWildCandidates(meld.cards, state.wildRank);
    if (!candidates.includes(wildAssignedRank)) {
      return { ok: false, error: "That rank doesn't extend this run" };
    }
    resolvedCard = { ...card, wildAs: wildAssignedRank };
  }

  const remainingHand = removeCardsFromHand(state.hands[playerId], [card]);
  if (!remainingHand) return { ok: false, error: "You don't hold that card" };

  const updatedCards = [...meld.cards, resolvedCard];
  const finalCards =
    meld.type === "RUN" ? sortRunCards(updatedCards, state.wildRank) : updatedCards;
  const updatedMeld: TableMeld = { ...meld, cards: finalCards };
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
      const others = rotationAfter(state.playerOrder, playerId);
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
    const pendingLayoffs = rotationAfter(state.playerOrder, state.payMeCallerId ?? playerId);
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
  wildAssignedRank?: Rank,
): Result<HandState> {
  if (state.phase !== "layoff") return { ok: false, error: "Not in the lay-off phase" };
  if (currentPlayer(state) !== playerId) return { ok: false, error: "Not your lay-off turn" };
  return applyLayoff(state, playerId, card, meldId, wildAssignedRank);
}

/**
 * Wild steal (lay-off round only). A player may pull a wild card out of a RUN
 * in the winner's (Pay Me caller's) meld by substituting, from their own hand,
 * the exact natural card that wild is standing in for - same rank AND suit -
 * and taking the freed wild into their hand. Runs only: a wild in a SET is not
 * pinned to a suit, so it can't be stolen. The run stays the same sequence of
 * ranks, so it remains valid (a natural replaces the wild it represented).
 */
export function stealWildFromRun(
  state: HandState,
  playerId: string,
  meldId: string,
  naturalCard: Card,
): Result<HandState> {
  if (state.phase !== "layoff") {
    return { ok: false, error: "Wild-stealing is only allowed in the lay-off round" };
  }
  if (currentPlayer(state) !== playerId) return { ok: false, error: "Not your lay-off turn" };

  const meldIndex = state.melds.findIndex((m) => m.id === meldId);
  if (meldIndex === -1) return { ok: false, error: "No such meld on the table" };
  const meld = state.melds[meldIndex];

  if (meld.ownerId !== state.payMeCallerId) {
    return { ok: false, error: "You can only steal from the winner's meld" };
  }
  if (meld.type !== "RUN") {
    return { ok: false, error: "You can only steal a wild from a run, not a set" };
  }
  if (isWildCard(naturalCard, state.wildRank)) {
    return { ok: false, error: "You must substitute a natural card, not a wild" };
  }

  // A run is a single suit; the substitute must match that suit and stand in
  // exactly for the rank the target wild currently represents.
  const runSuit = meld.cards.find((c) => !isWildCard(c, state.wildRank))?.suit ?? null;
  if (naturalCard.suit !== runSuit) {
    return { ok: false, error: "That card isn't the right suit for this run" };
  }
  const targetIndex = meld.cards.findIndex(
    (c) => isWildCard(c, state.wildRank) && c.wildAs === naturalCard.rank,
  );
  if (targetIndex === -1) {
    return { ok: false, error: "No wild in this run is standing in for that card" };
  }

  const remainingHand = removeCardsFromHand(state.hands[playerId], [naturalCard]);
  if (!remainingHand) return { ok: false, error: "You don't hold that card" };

  // Free the wild (drop its run designation) and hand it to the stealer.
  const { wildAs: _dropped, ...stolenWild } = meld.cards[targetIndex];

  const newMeldCards = [...meld.cards];
  newMeldCards[targetIndex] = { ...naturalCard };
  const finalCards = sortRunCards(newMeldCards, state.wildRank);
  if (!validateMeld(finalCards, "RUN", state.wildRank).valid) {
    return { ok: false, error: "That swap would break the run" };
  }

  const melds = [...state.melds];
  melds[meldIndex] = { ...meld, cards: finalCards };

  return {
    ok: true,
    state: {
      ...state,
      hands: { ...state.hands, [playerId]: [...remainingHand, stolenWild as Card] },
      melds,
    },
  };
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

/**
 * Skips the current actor's pending action because they've gone stale
 * (disconnected past the heartbeat threshold). Unlike advanceTurn - which is
 * folded into the normal flow of ending a turn - nothing else re-evaluates
 * whoever's currently up once they've gone stale mid-turn, so this only
 * ever runs when another player explicitly triggers it. Staleness itself
 * isn't checked here: the caller (the edge function) has already confirmed
 * targetPlayerId's last_seen_at is past the threshold. Keeping this a pure
 * state transition (like every other function here) keeps it deterministic
 * and unit-testable.
 */
export function skipStalePlayer(state: HandState, targetPlayerId: string): Result<HandState> {
  if (state.phase !== "playing" && state.phase !== "final_turns" && state.phase !== "layoff") {
    return { ok: false, error: "No one's turn to skip right now" };
  }
  if (currentPlayer(state) !== targetPlayerId) {
    return { ok: false, error: "That player isn't who we're waiting on" };
  }

  if (state.phase === "playing") {
    return { ok: true, state: advanceTurn(state) };
  }

  if (state.phase === "final_turns") {
    const pendingFinalTurns = state.pendingFinalTurns.filter((id) => id !== targetPlayerId);
    if (pendingFinalTurns.length === 0) {
      const pendingLayoffs = rotationAfter(
        state.playerOrder,
        state.payMeCallerId ?? targetPlayerId,
      );
      if (pendingLayoffs.length === 0) {
        return { ok: true, state: { ...state, pendingFinalTurns, phase: "scoring" } };
      }
      return {
        ok: true,
        state: {
          ...state,
          pendingFinalTurns,
          phase: "layoff",
          pendingLayoffs,
          currentPlayerIndex: state.playerOrder.indexOf(pendingLayoffs[0]),
        },
      };
    }
    const nextPlayerId = pendingFinalTurns[0];
    return {
      ok: true,
      state: {
        ...state,
        pendingFinalTurns,
        currentPlayerIndex: state.playerOrder.indexOf(nextPlayerId),
        hasDrawnThisTurn: false,
      },
    };
  }

  // layoff phase
  const pendingLayoffs = state.pendingLayoffs.filter((id) => id !== targetPlayerId);
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
