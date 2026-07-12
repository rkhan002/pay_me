import { dealCards, dealFromDeck, buildCarryOverDeck } from "../_shared/rules-engine/deal.ts";
import { decksForPlayerCount, type Card } from "../_shared/rules-engine/deck.ts";
import {
  configForHand,
  startingSeatIndex,
  TOTAL_HANDS,
} from "../_shared/rules-engine/handConfig.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { HttpError, errorResponse, handleOptions, json, requireUserId } from "../_shared/http.ts";

const CARDS_PER_DECK = 54; // 52 ranked + 2 jokers

// deno-lint-ignore no-explicit-any
type SupabaseAdmin = any;

// Project a stored card back to a plain deck card, dropping any run-only wild
// designation (wildAs) or stray fields so reclaimed cards re-enter the deck clean.
// deno-lint-ignore no-explicit-any
function baseCard(c: any): Card {
  return { rank: c.rank, suit: c.suit ?? null, deckIndex: c.deckIndex };
}

/**
 * Builds the next hand's deal by carrying the deck over from the previous
 * (completed) hand instead of shuffling a fresh deck: the cards never drawn
 * last hand stay in their order on top, and everything reclaimed from the
 * finished hand - the discard pile, players' leftover hand cards, and every
 * melded card (wild-in-a-run designations stripped) - is shuffled underneath.
 * Falls back to a fresh shuffle if the reclaimed cards don't add back up to a
 * full deck, so a data hiccup can never deal a short or duplicated hand.
 */
async function dealCarriedOver(
  admin: SupabaseAdmin,
  roomId: string,
  prevHandNumber: number,
  playerIds: string[],
  dealSize: number,
) {
  const { data: prevHand } = await admin
    .from("hands")
    .select("id, discard_pile")
    .eq("room_id", roomId)
    .eq("hand_number", prevHandNumber)
    .single();
  if (!prevHand) return dealCards(playerIds, dealSize);

  const [{ data: stockRow }, { data: handPlayers }, { data: melds }] = await Promise.all([
    admin.from("hand_stock").select("stock").eq("hand_id", prevHand.id).single(),
    admin.from("hand_players").select("hand_cards").eq("hand_id", prevHand.id),
    admin.from("melds").select("meld_cards(rank, suit, deck_index)").eq("hand_id", prevHand.id),
  ]);

  const remainingStock: Card[] = (((stockRow?.stock as Card[]) ?? []) as Card[]).map(baseCard);

  const reclaimed: Card[] = [];
  for (const c of (prevHand.discard_pile as Card[]) ?? []) reclaimed.push(baseCard(c));
  for (const hp of handPlayers ?? []) {
    for (const c of (hp.hand_cards as Card[]) ?? []) reclaimed.push(baseCard(c));
  }
  for (const m of melds ?? []) {
    for (const c of m.meld_cards ?? []) {
      reclaimed.push({ rank: c.rank, suit: c.suit ?? null, deckIndex: c.deck_index });
    }
  }

  const deck = buildCarryOverDeck(remainingStock, reclaimed);
  const expected = decksForPlayerCount(playerIds.length) * CARDS_PER_DECK;
  if (deck.length !== expected) {
    console.warn(
      `Carry-over deck had ${deck.length} cards, expected ${expected}; dealing a fresh shuffle instead.`,
    );
    return dealCards(playerIds, dealSize);
  }
  return dealFromDeck(playerIds, dealSize, deck);
}

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    if (req.method !== "POST") throw new HttpError("POST only", 405);
    const userId = await requireUserId(req);
    const { roomId } = await req.json();
    if (!roomId) throw new HttpError("Missing roomId", 400);

    const admin = supabaseAdmin();
    const { data: room, error: roomError } = await admin
      .from("rooms")
      .select("*")
      .eq("id", roomId)
      .single();
    if (roomError || !room) throw new HttpError("Room not found", 404);
    if (room.status === "complete") throw new HttpError("This game is already over", 409);

    const { data: seat } = await admin
      .from("players")
      .select("id")
      .eq("room_id", roomId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!seat) throw new HttpError("You're not seated in this room", 403);

    const { data: players, error: playersError } = await admin
      .from("players")
      .select("id")
      .eq("room_id", roomId)
      .order("seat_index", { ascending: true });
    if (playersError || !players?.length) throw new HttpError("No players in room", 500);
    if (players.length < 2) throw new HttpError("Need at least 2 players to start", 400);

    // A brief client-side render race (right after a page reload, before the
    // real hand state has loaded) can show the "Deal next hand" button as
    // clickable even while the room's current hand is still being played.
    // The client gates on this too, but that gate is only advisory - it's
    // exactly the kind of thing a real click during that window would slip
    // past. Confirm server-side that the current hand (if any) has actually
    // finished before dealing the next one.
    if (room.current_hand_number > 0) {
      const { data: currentHand, error: currentHandError } = await admin
        .from("hands")
        .select("phase")
        .eq("room_id", roomId)
        .eq("hand_number", room.current_hand_number)
        .single();
      if (currentHandError || !currentHand) throw new HttpError("Current hand not found", 500);
      if (currentHand.phase !== "complete") {
        throw new HttpError("The current hand hasn't finished yet", 409);
      }
    }

    const nextHandNumber = room.current_hand_number + 1;
    if (nextHandNumber > TOTAL_HANDS) throw new HttpError("All 11 hands have been played", 409);

    const config = configForHand(nextHandNumber);
    const playerIds: string[] = players.map((p: any) => p.id as string);

    // First hand of a game is a fresh shuffle; every later hand carries the
    // deck over from the just-completed hand (see dealCarriedOver).
    const { hands, stock, discardPile } =
      room.current_hand_number === 0
        ? dealCards(playerIds, config.dealSize)
        : await dealCarriedOver(
            admin,
            roomId,
            room.current_hand_number,
            playerIds,
            config.dealSize,
          );

    // Who leads rotates every hand instead of always being whoever's in
    // seat 0 - round-robin for 3+ players, which for exactly 2 players
    // is the same thing as strict alternation.
    const leadPlayerId = playerIds[startingSeatIndex(nextHandNumber, playerIds.length)];

    const { data: hand, error: handError } = await admin
      .from("hands")
      .insert({
        room_id: roomId,
        hand_number: nextHandNumber,
        wild_rank: config.wildRank,
        deal_size: config.dealSize,
        discard_pile: discardPile,
        turn_player_id: leadPlayerId,
      })
      .select()
      .single();

    // Any seated player can trigger "deal next hand", so two players
    // clicking around the same time both land here concurrently. One
    // insert wins; the other hits hands_room_id_hand_number_key. Treat
    // that race as success and hand back the hand the winner created,
    // rather than surfacing a 500 to the loser.
    if (handError?.code === "23505") {
      const { data: existingHand, error: existingHandError } = await admin
        .from("hands")
        .select("id")
        .eq("room_id", roomId)
        .eq("hand_number", nextHandNumber)
        .single();
      if (existingHandError || !existingHand) throw new HttpError("Failed to create hand", 500);
      return json({ ok: true, handId: existingHand.id, handNumber: nextHandNumber });
    }
    if (handError || !hand) throw new HttpError("Failed to create hand", 500);

    const { error: stockError } = await admin
      .from("hand_stock")
      .insert({ hand_id: hand.id, stock });
    if (stockError) throw new HttpError("Failed to save stock", 500);

    const handPlayerRows = playerIds.map((pid) => ({
      hand_id: hand.id,
      player_id: pid,
      hand_cards: hands[pid],
    }));
    const { error: hpError } = await admin.from("hand_players").insert(handPlayerRows);
    if (hpError) throw new HttpError("Failed to deal hands", 500);

    await admin
      .from("rooms")
      .update({ status: "in_progress", current_hand_number: nextHandNumber })
      .eq("id", roomId);

    return json({ ok: true, handId: hand.id, handNumber: nextHandNumber });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    console.error(e);
    return errorResponse("Internal error", 500);
  }
});
