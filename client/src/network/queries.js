// Read-only queries the client makes directly against Postgres (through
// PostgREST), gated entirely by the RLS policies in
// supabase/migrations/0001_init.sql. No writes happen here - see intents.js
// for the only way this client ever changes game state.
import { supabase } from "./supabaseClient.js";
import { setState } from "../state/store.js";

export async function loadRoom(roomId) {
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

  setState({
    room: room
      ? {
          id: room.id,
          code: room.code,
          status: room.status,
          maxPlayers: room.max_players,
          currentHandNumber: room.current_hand_number,
        }
      : null,
    players: (players ?? []).map((p) => ({
      id: p.id,
      seatIndex: p.seat_index,
      displayName: p.display_name,
      connected: p.connected,
      userId: p.user_id,
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

export async function loadHand(handId) {
  const { getState } = await import("../state/store.js");
  const { myPlayerId } = getState();

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
          "id, owner_player_id, meld_type, meld_cards(rank, suit, deck_index, position, added_by_player_id)",
        )
        .eq("hand_id", handId),
    ]);
  if (!hand) return;

  setState({
    hand: {
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
    },
    myCards: myHandPlayer?.hand_cards ?? [],
    publicHandInfo: (publicInfo ?? []).map((p) => ({
      playerId: p.player_id,
      cardCount: p.card_count,
      score: p.score,
      hasTakenFinalTurn: p.has_taken_final_turn,
    })),
    melds: (melds ?? []).map((m) => ({
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
        })),
    })),
  });
}
