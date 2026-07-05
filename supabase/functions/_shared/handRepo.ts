// Loads a rules-engine HandState out of Postgres, and persists the result of
// a rules-engine transition back. This is the ONLY place that translates
// between "rows in several tables" and the pure in-memory HandState the
// shared rules-engine package operates on - keeping every function's body
// down to "load -> call rules-engine -> save".
import type { HandState, TableMeld } from "./rules-engine/handState.ts";
import type { Card } from "./rules-engine/deck.ts";
import { HttpError } from "./http.ts";

// deno-lint-ignore no-explicit-any
type SupabaseAdmin = any;

// A player counts as connected if we've heard from them (via the heartbeat
// endpoint) within this window. Generous enough to tolerate a missed ping or
// two over a flaky connection, short enough that a genuinely closed tab
// becomes skippable well within the same minute.
export const STALE_MS = 45_000;

export async function loadHandState(admin: SupabaseAdmin, handId: string): Promise<HandState> {
  const { data: hand, error: handError } = await admin
    .from("hands")
    .select("*")
    .eq("id", handId)
    .single();
  if (handError || !hand) throw new HttpError("Hand not found", 404);

  // These four only depend on hand.room_id / handId, both already known, so
  // there's no reason to make the caller wait on them one at a time - every
  // sequential round trip here was pure added latency on every single
  // action (draw, discard, meld, layoff).
  const [
    { data: players, error: playersError },
    { data: stockRow, error: stockError },
    { data: handPlayers, error: hpError },
    { data: melds, error: meldsError },
  ] = await Promise.all([
    admin
      .from("players")
      .select("id, seat_index, last_seen_at")
      .eq("room_id", hand.room_id)
      .order("seat_index", { ascending: true }),
    admin.from("hand_stock").select("stock").eq("hand_id", handId).single(),
    admin.from("hand_players").select("player_id, hand_cards").eq("hand_id", handId),
    admin
      .from("melds")
      .select(
        "id, owner_player_id, meld_type, meld_cards(rank, suit, deck_index, position, wild_as_rank)",
      )
      .eq("hand_id", handId),
  ]);
  if (playersError || !players?.length) throw new HttpError("Room has no players", 500);
  if (stockError || !stockRow) throw new HttpError("Hand stock not found", 500);
  if (hpError) throw new HttpError("Failed to load hands", 500);
  if (meldsError) throw new HttpError("Failed to load melds", 500);

  const hands: Record<string, Card[]> = {};
  for (const hp of handPlayers ?? []) {
    hands[hp.player_id] = (hp.hand_cards as Card[]) ?? [];
  }

  const tableMelds: TableMeld[] = (melds ?? []).map((m: any) => ({
    id: m.id,
    ownerId: m.owner_player_id,
    type: m.meld_type,
    cards: [...m.meld_cards]
      .sort((a: any, b: any) => a.position - b.position)
      .map((c: any) => ({
        rank: c.rank,
        suit: c.suit,
        deckIndex: c.deck_index,
        wildAs: c.wild_as_rank ?? undefined,
      })),
  }));

  const playerOrder: string[] = players.map((p: any) => p.id as string);
  const now = Date.now();
  const connectedPlayers = new Set<string>(
    players
      .filter((p: any) => now - new Date(p.last_seen_at).getTime() < STALE_MS)
      .map((p: any) => p.id as string),
  );

  return {
    wildRank: hand.wild_rank,
    playerOrder,
    currentPlayerIndex: hand.turn_player_id ? playerOrder.indexOf(hand.turn_player_id) : 0,
    hasDrawnThisTurn: hand.has_drawn_this_turn,
    hands,
    stock: stockRow.stock as Card[],
    discardPile: hand.discard_pile as Card[],
    melds: tableMelds,
    phase: hand.phase,
    payMeCallerId: hand.pay_me_caller_id,
    pendingFinalTurns: hand.pending_final_turns ?? [],
    pendingLayoffs: hand.pending_layoffs ?? [],
    connectedPlayers,
  };
}

/**
 * Persists every field of HandState that can change as a result of a single
 * intent. Melds are reconciled by diffing meld ids already in the DB against
 * the ids present in `next.melds` (new ids are inserted; growing card lists
 * on existing melds - i.e. lay-offs - are appended, never rewritten, so
 * added_by/added_at stay accurate history).
 */
export async function saveHandState(
  admin: SupabaseAdmin,
  handId: string,
  prev: HandState,
  next: HandState,
  playerId: string,
): Promise<void> {
  const nextTurnPlayerId = next.playerOrder[next.currentPlayerIndex] ?? null;

  const { error: handUpdateError } = await admin
    .from("hands")
    .update({
      discard_pile: next.discardPile,
      turn_player_id: nextTurnPlayerId,
      has_drawn_this_turn: next.hasDrawnThisTurn,
      phase: next.phase,
      pay_me_caller_id: next.payMeCallerId,
      pending_final_turns: next.pendingFinalTurns,
      pending_layoffs: next.pendingLayoffs,
    })
    .eq("id", handId);
  if (handUpdateError) throw new HttpError("Failed to save hand", 500);

  if (JSON.stringify(prev.stock) !== JSON.stringify(next.stock)) {
    const { error } = await admin
      .from("hand_stock")
      .update({ stock: next.stock })
      .eq("hand_id", handId);
    if (error) throw new HttpError("Failed to save stock", 500);
  }

  for (const pid of next.playerOrder) {
    if (JSON.stringify(prev.hands[pid]) === JSON.stringify(next.hands[pid])) continue;
    const { error } = await admin
      .from("hand_players")
      .update({ hand_cards: next.hands[pid] })
      .eq("hand_id", handId)
      .eq("player_id", pid);
    if (error) throw new HttpError("Failed to save hand cards", 500);
  }

  // unmeld() removes a meld from state entirely - delete its row (meld_cards
  // cascades via its FK) so it doesn't keep coming back on the next load.
  const nextMeldIds = new Set(next.melds.map((m) => m.id));
  for (const meld of prev.melds) {
    if (nextMeldIds.has(meld.id)) continue;
    const { error } = await admin.from("melds").delete().eq("id", meld.id);
    if (error) throw new HttpError("Failed to remove meld", 500);
  }

  const prevMeldIds = new Set(prev.melds.map((m) => m.id));
  for (const meld of next.melds) {
    if (!prevMeldIds.has(meld.id)) {
      const { error: meldError } = await admin
        .from("melds")
        .insert({
          id: meld.id,
          hand_id: handId,
          owner_player_id: meld.ownerId,
          meld_type: meld.type,
        });
      if (meldError) throw new HttpError("Failed to save meld", 500);

      const rows = meld.cards.map((card, position) => ({
        meld_id: meld.id,
        rank: card.rank,
        suit: card.suit,
        deck_index: card.deckIndex,
        position,
        wild_as_rank: card.wildAs ?? null,
        added_by_player_id: meld.ownerId,
      }));
      const { error: cardsError } = await admin.from("meld_cards").insert(rows);
      if (cardsError) throw new HttpError("Failed to save meld cards", 500);
    } else {
      const prevMeld = prev.melds.find((m) => m.id === meld.id)!;
      if (JSON.stringify(prevMeld.cards) === JSON.stringify(meld.cards)) continue;

      // A lay-off onto a RUN can land at either end (see sortRunCards), so
      // the new card isn't always a tail append - existing cards can shift
      // position too. Rather than trust a length-based diff (which breaks
      // the moment anything reorders), rewrite every row for this meld:
      // fetch what's there now to preserve added_by/added_at for cards that
      // already existed, then delete and reinsert in the final order.
      const { data: existingRows, error: fetchError } = await admin
        .from("meld_cards")
        .select("rank, suit, deck_index, added_by_player_id, added_at")
        .eq("meld_id", meld.id);
      if (fetchError) throw new HttpError("Failed to load meld cards", 500);

      const existingByKey = new Map<string, { added_by_player_id: string; added_at: string }>();
      for (const row of existingRows ?? []) {
        existingByKey.set(`${row.rank}|${row.suit ?? ""}|${row.deck_index}`, row);
      }

      const rows = meld.cards.map((card, position) => {
        const key = `${card.rank}|${card.suit ?? ""}|${card.deckIndex}`;
        const existing = existingByKey.get(key);
        return {
          meld_id: meld.id,
          rank: card.rank,
          suit: card.suit,
          deck_index: card.deckIndex,
          position,
          wild_as_rank: card.wildAs ?? null,
          added_by_player_id: existing?.added_by_player_id ?? playerId,
          added_at: existing?.added_at ?? new Date().toISOString(),
        };
      });

      const { error: deleteError } = await admin
        .from("meld_cards")
        .delete()
        .eq("meld_id", meld.id);
      if (deleteError) throw new HttpError("Failed to save lay-off", 500);
      const { error: insertError } = await admin.from("meld_cards").insert(rows);
      if (insertError) throw new HttpError("Failed to save lay-off", 500);
    }
  }
}

export async function logMove(
  admin: SupabaseAdmin,
  handId: string,
  playerId: string,
  action: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await admin.from("moves").insert({ hand_id: handId, player_id: playerId, action, payload });
}
