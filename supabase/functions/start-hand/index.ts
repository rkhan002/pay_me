import { dealCards } from "../_shared/rules-engine/deal.ts";
import { configForHand, TOTAL_HANDS } from "../_shared/rules-engine/handConfig.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { HttpError, errorResponse, handleOptions, json, requireUserId } from "../_shared/http.ts";

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

    const nextHandNumber = room.current_hand_number + 1;
    if (nextHandNumber > TOTAL_HANDS) throw new HttpError("All 11 hands have been played", 409);

    const config = configForHand(nextHandNumber);
    const playerIds: string[] = players.map((p: any) => p.id as string);
    const { hands, stock, discardPile } = dealCards(playerIds, config.dealSize);

    const { data: hand, error: handError } = await admin
      .from("hands")
      .insert({
        room_id: roomId,
        hand_number: nextHandNumber,
        wild_rank: config.wildRank,
        deal_size: config.dealSize,
        discard_pile: discardPile,
        turn_player_id: playerIds[0],
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
