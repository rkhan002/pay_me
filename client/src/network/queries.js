// Read-only queries the client makes directly against Postgres (through
// PostgREST), gated entirely by the RLS policies in
// supabase/migrations/0001_init.sql. No writes happen here - see intents.js
// for the only way this client ever changes game state.
import { supabase } from "./supabaseClient.js";
import { getState, setState } from "../state/store.js";
import { playSfx } from "../audio/audioManager.js";
import { orderCards } from "../ui/handOrder.js";

// Mirrors STALE_MS in supabase/functions/_shared/handRepo.ts - this copy is
// purely cosmetic (whether an avatar looks dimmed), so it doesn't need to
// match exactly, but keeping the same number means the client's idea of
// "looks disconnected" lines up with the server's idea of "skippable."
const STALE_MS = 45_000;

function isConnected(lastSeenAt) {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < STALE_MS;
}

export async function loadRoom(roomId) {
  const { getState } = await import("../state/store.js");
  const prevRoomStatus = getState().room?.status;

  // room and players are independent reads - fire them together instead of
  // waiting on one before starting the other.
  const [{ data: room }, { data: players }] = await Promise.all([
    supabase.from("rooms").select("*").eq("id", roomId).single(),
    supabase
      .from("players")
      .select("*")
      .eq("room_id", roomId)
      .order("seat_index", { ascending: true }),
  ]);

  // Only fires on an actual observed transition into "complete" (never on
  // the very first load, where prevRoomStatus is undefined) - the game's
  // 11th and final hand has just been scored.
  if (prevRoomStatus && prevRoomStatus !== "complete" && room?.status === "complete") {
    playSfx("win");
    // Announce the champion. Dynamic import keeps this off the module's
    // static dependency graph (winnerCelebration imports loadStandings from
    // here), avoiding an import cycle.
    import("../ui/winnerCelebration.js").then((m) => m.showWinnerCelebration(roomId));
  }

  setState({
    room: room
      ? {
          id: room.id,
          code: room.code,
          status: room.status,
          maxPlayers: room.max_players,
          currentHandNumber: room.current_hand_number,
          totalHands: room.total_hands ?? 11,
        }
      : null,
    players: (players ?? []).map((p) => ({
      id: p.id,
      seatIndex: p.seat_index,
      displayName: p.display_name,
      connected: isConnected(p.last_seen_at),
      userId: p.user_id,
      avatar: p.avatar ?? null,
    })),
  });

  if (room && room.current_hand_number > 0) {
    const { data: hand } = await supabase
      .from("hands")
      .select("*")
      .eq("room_id", roomId)
      .eq("hand_number", room.current_hand_number)
      .single();
    if (hand) await loadHand(hand.id);
  }
}

/**
 * Cumulative standings across every hand played so far in this room -
 * separate from publicHandInfo (which only ever holds the CURRENT hand's
 * per-hand scores). Players can't read other players' hand_players rows
 * directly (owner-only RLS), so this goes through the same
 * hand_player_public view loadHand() uses, just across every completed
 * hand instead of one.
 */
export async function loadStandings(roomId) {
  const [{ data: players }, { data: completedHands }] = await Promise.all([
    supabase
      .from("players")
      .select("id, display_name")
      .eq("room_id", roomId)
      .order("seat_index", { ascending: true }),
    supabase
      .from("hands")
      .select("id, hand_number, pay_me_caller_id")
      .eq("room_id", roomId)
      .eq("phase", "complete"),
  ]);

  const totals = new Map(
    (players ?? []).map((p) => [
      p.id,
      { playerId: p.id, displayName: p.display_name, cumulativeScore: 0, payMeWins: 0 },
    ]),
  );

  if (completedHands?.length) {
    const { data: scores } = await supabase
      .from("hand_player_public")
      .select("hand_id, player_id, score")
      .in(
        "hand_id",
        completedHands.map((h) => h.id),
      );
    for (const row of scores ?? []) {
      const entry = totals.get(row.player_id);
      if (entry) entry.cumulativeScore += row.score ?? 0;
    }
    for (const hand of completedHands) {
      const entry = hand.pay_me_caller_id && totals.get(hand.pay_me_caller_id);
      if (entry) entry.payMeWins += 1;
    }
  }

  setState({
    standings: [...totals.values()].sort(
      (a, b) => a.cumulativeScore - b.cumulativeScore || b.payMeWins - a.payMeWins,
    ),
    standingsHandsPlayed: completedHands?.length ?? 0,
  });
}

function cardIdentity(c) {
  return `${c.rank}|${c.suit ?? ""}|${c.deckIndex}`;
}

/**
 * Fires the right SFX for whatever changed between the previously-loaded
 * hand snapshot and this one - covers both this client's own actions and
 * ones a realtime update just delivered from another player, since both
 * paths funnel through loadHand(). Deliberately conservative: only ever
 * compares two snapshots of the SAME hand (never fires anything on the
 * very first load of a hand, where there's nothing to diff against, which
 * is what keeps a page reload or reconnect from replaying every sound
 * that already happened).
 */
function fireHandSfx(
  prevHand,
  prevMyCards,
  prevMelds,
  nextHand,
  nextMyCards,
  nextMelds,
  myPlayerId,
) {
  if (!prevHand || prevHand.id !== nextHand.id) return;

  // Draw: only ever observable for this client's own hand - an opponent's
  // cards aren't visible to us at all, before or after.
  if (nextMyCards.length > prevMyCards.length) playSfx("draw");

  // Discard: the shared pile grew (drawing FROM it shrinks it instead, so
  // that alone can't trigger this).
  if (nextHand.discardPile.length > prevHand.discardPile.length) playSfx("discard");

  // Melds: matched by id. A new id is a fresh meld; a growing card count
  // on an existing id is a lay-off; an id that vanished was unmelded.
  // Comparing card *identity* (not array position) for "what's new" is
  // required here, not just an appended-tail assumption - a wild landing
  // on the low end of a RUN re-sorts the whole array (see sortRunCards
  // server-side), so the newest card isn't always last.
  const prevMeldsById = new Map(prevMelds.map((m) => [m.id, m]));
  const nextMeldsById = new Map(nextMelds.map((m) => [m.id, m]));

  for (const meld of nextMelds) {
    const prevMeld = prevMeldsById.get(meld.id);
    if (!prevMeld) {
      playSfx(meld.cards.some((c) => c.wildAs) ? "wild" : "meld");
    } else if (meld.cards.length > prevMeld.cards.length) {
      const prevKeys = new Set(prevMeld.cards.map(cardIdentity));
      const newCards = meld.cards.filter((c) => !prevKeys.has(cardIdentity(c)));
      playSfx(newCards.some((c) => c.wildAs) ? "wild" : "layoff");
    }
  }
  for (const meld of prevMelds) {
    if (!nextMeldsById.has(meld.id)) playSfx("unmeld");
  }

  // Pay Me: someone just went out.
  if (!prevHand.payMeCallerId && nextHand.payMeCallerId) playSfx("payme");

  // Turn: it just became this player's turn (covers the "playing",
  // "final_turns", and "layoff" phases alike, since turnPlayerId tracks
  // whoever's action is expected in all three - see handRepo.ts).
  if (nextHand.turnPlayerId === myPlayerId && prevHand.turnPlayerId !== myPlayerId) {
    playSfx("turn");
  }
}

export async function loadHand(handId) {
  const { getState } = await import("../state/store.js");
  const { myPlayerId, hand: prevHand, myCards: prevMyCards, melds: prevMelds } = getState();

  // All four only need handId (and myPlayerId, already known) - none
  // depends on another's result, so run them concurrently rather than
  // one after another.
  const [{ data: hand }, { data: myHandPlayer }, { data: publicInfo }, { data: melds }] =
    await Promise.all([
      supabase.from("hands").select("*").eq("id", handId).single(),
      supabase
        .from("hand_players")
        .select("hand_cards")
        .eq("hand_id", handId)
        .eq("player_id", myPlayerId)
        .maybeSingle(),
      supabase.from("hand_player_public").select("*").eq("hand_id", handId),
      supabase
        .from("melds")
        .select(
          "id, owner_player_id, meld_type, meld_cards(rank, suit, deck_index, position, added_by_player_id, wild_as_rank)",
        )
        .eq("hand_id", handId),
    ]);
  if (!hand) return;

  const nextHand = {
    id: hand.id,
    handNumber: hand.hand_number,
    wildRank: hand.wild_rank,
    dealSize: hand.deal_size,
    discardPile: hand.discard_pile,
    turnPlayerId: hand.turn_player_id,
    hasDrawnThisTurn: hand.has_drawn_this_turn,
    phase: hand.phase,
    payMeCallerId: hand.pay_me_caller_id,
    pendingFinalTurns: hand.pending_final_turns ?? [],
    pendingLayoffs: hand.pending_layoffs ?? [],
  };
  // Arrange the player's own hand by their saved drag/sort preference for
  // this hand (purely local; see ui/handOrder.js). Deal order if none.
  const nextMyCards = orderCards(hand.id, myHandPlayer?.hand_cards ?? []);
  const nextMelds = (melds ?? []).map((m) => ({
    id: m.id,
    ownerPlayerId: m.owner_player_id,
    meldType: m.meld_type,
    cards: [...m.meld_cards]
      .sort((a, b) => a.position - b.position)
      .map((c) => ({
        rank: c.rank,
        suit: c.suit,
        deckIndex: c.deck_index,
        addedByPlayerId: c.added_by_player_id,
        wildAs: c.wild_as_rank ?? undefined,
      })),
  }));

  fireHandSfx(prevHand, prevMyCards, prevMelds, nextHand, nextMyCards, nextMelds, myPlayerId);

  setState({
    hand: nextHand,
    myCards: nextMyCards,
    publicHandInfo: (publicInfo ?? []).map((p) => ({
      playerId: p.player_id,
      cardCount: p.card_count,
      score: p.score,
      hasTakenFinalTurn: p.has_taken_final_turn,
    })),
    melds: nextMelds,
    // The authoritative hand is now in state (real drawn card included), so
    // drop the optimistic stock-draw placeholder in the same paint - no flash.
    pendingDraw: false,
  });
}

/**
 * Applies a viewer-scoped snapshot returned by an action edge function (see
 * handViewFor / the edge functions' { ok, view } response), instead of doing a
 * second read round trip via loadHand. The server already computed exactly what
 * this player is allowed to see - including the RLS meld gating - so we just
 * overlay it. Static hand fields (id, handNumber, dealSize) never change during
 * a hand, so we keep the ones already in state and overlay only the dynamic
 * fields the server sent. Runs the same SFX diff loadHand does.
 */
export function applyHandView(view) {
  const { myPlayerId, hand: prevHand, myCards: prevMyCards, melds: prevMelds } = getState();
  // No current hand to overlay onto (shouldn't happen for an in-hand action);
  // ignore rather than build a half-populated hand object.
  if (!prevHand) return;

  const nextHand = { ...prevHand, ...view.hand };
  const nextMyCards = orderCards(nextHand.id, view.myCards ?? []);
  const nextMelds = (view.melds ?? []).map((m) => ({
    id: m.id,
    ownerPlayerId: m.ownerPlayerId,
    meldType: m.meldType,
    cards: (m.cards ?? []).map((c) => ({
      rank: c.rank,
      suit: c.suit,
      deckIndex: c.deckIndex,
      wildAs: c.wildAs ?? undefined,
    })),
  }));

  fireHandSfx(prevHand, prevMyCards, prevMelds, nextHand, nextMyCards, nextMelds, myPlayerId);

  setState({
    hand: nextHand,
    myCards: nextMyCards,
    // publicHandInfo already arrives in client shape from handViewFor.
    publicHandInfo: (view.publicHandInfo ?? []).map((p) => ({
      playerId: p.playerId,
      cardCount: p.cardCount,
      score: p.score,
      hasTakenFinalTurn: p.hasTakenFinalTurn,
    })),
    melds: nextMelds,
    // The authoritative hand is now in state (real drawn card included), so
    // drop the optimistic stock-draw placeholder in the same paint - no flash.
    pendingDraw: false,
  });
}
