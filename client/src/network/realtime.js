// Every game-state change flows: Edge Function validates + writes Postgres
// -> Supabase Realtime's "Postgres Changes" replication -> this listener
// -> a plain re-fetch of the relevant rows -> re-render. We don't try to
// apply the change payload directly to the store; a full re-fetch is
// simpler to get right and cheap enough at this table size.
//
// Note: melds/meld_cards/hand_players subscriptions below have no `filter`
// (Realtime filters can only match a column on the table itself, not a
// join), so we rely entirely on each table's RLS SELECT policy to make sure
// we only ever actually receive events we're allowed to see - in
// particular, hand_players' owner-only policy means we never receive an
// opponent's hand_cards, only our own.
import { supabase } from "./supabaseClient.js";
import { getState } from "../state/store.js";
import { loadRoom, loadHand } from "./queries.js";

export function subscribeToRoom(roomId) {
  const refreshRoom = () => loadRoom(roomId);
  const refreshHand = () => {
    const { hand } = getState();
    if (hand) loadHand(hand.id);
  };

  const channel = supabase
    .channel(`room-${roomId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
      refreshRoom,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "players", filter: `room_id=eq.${roomId}` },
      refreshRoom,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "hands", filter: `room_id=eq.${roomId}` },
      refreshHand,
    )
    .on("postgres_changes", { event: "*", schema: "public", table: "hand_players" }, refreshHand)
    .on("postgres_changes", { event: "*", schema: "public", table: "melds" }, refreshHand)
    .on("postgres_changes", { event: "*", schema: "public", table: "meld_cards" }, refreshHand)
    .subscribe();

  return () => supabase.removeChannel(channel);
}
