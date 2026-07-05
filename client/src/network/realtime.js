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

// saveHandState() (in the edge functions) writes to `hands`, `hand_players`,
// and sometimes `melds`/`meld_cards` as separate, non-transactional
// statements - a known gap, not a full rewrite we've taken on here. Each
// write commits and replicates to Realtime independently, so a single
// discard/meld can fire several postgres_changes events within
// milliseconds of each other, with the underlying writes still landing in
// between them. Refetching on the very first event risks reading state
// from partway through that sequence (e.g. `hands` already updated but
// `hand_players` not yet) - which is exactly what testing saw: an
// opponent's card count updating before their card list did, settling
// only once a later, unrelated event happened to trigger another refetch.
// Debouncing collapses a burst of events for one action into a single
// refetch fired shortly after the burst goes quiet, by which point the
// whole sequence has almost always already landed.
function debounce(fn, delayMs = 200) {
  let timer;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, delayMs);
  };
}

export function subscribeToRoom(roomId) {
  const refreshRoom = debounce(() => loadRoom(roomId));
  const refreshHand = debounce(() => {
    // If we don't have a hand loaded yet (e.g. this is the very first hand
    // dealt in the room, or we joined mid-game before our own load
    // finished), fall back to a full room refresh - loadRoom already knows
    // how to find and load whichever hand is current.
    const { hand } = getState();
    if (hand) loadHand(hand.id);
    else loadRoom(roomId);
  });

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
