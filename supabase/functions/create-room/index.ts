import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { HttpError, errorResponse, handleOptions, json, requireUserId } from "../_shared/http.ts";
import { generateRoomCode } from "../_shared/roomCode.ts";

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    if (req.method !== "POST") throw new HttpError("POST only", 405);
    const userId = await requireUserId(req);
    const { displayName, maxPlayers = 6, mode = "full" } = await req.json();
    if (!displayName || typeof displayName !== "string") {
      throw new HttpError("Missing displayName", 400);
    }
    if (maxPlayers < 2 || maxPlayers > 6) throw new HttpError("maxPlayers must be 2-6", 400);
    // Quick Mode plays hands 1-8 (wild 3-10); Full Game plays all 11 (3-K).
    // Stored as total_hands so a DB trigger can end the game at the right hand.
    if (mode !== "quick" && mode !== "full") throw new HttpError("Invalid game mode", 400);
    const totalHands = mode === "quick" ? 8 : 11;

    const admin = supabaseAdmin();

    let code = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateRoomCode();
      const { data } = await admin.from("rooms").select("id").eq("code", candidate).maybeSingle();
      if (!data) {
        code = candidate;
        break;
      }
    }
    if (!code) throw new HttpError("Could not generate a unique room code, try again", 500);

    const { data: room, error: roomError } = await admin
      .from("rooms")
      .insert({ code, max_players: maxPlayers, created_by: userId, total_hands: totalHands })
      .select()
      .single();
    if (roomError || !room) throw new HttpError("Failed to create room", 500);

    const { data: player, error: playerError } = await admin
      .from("players")
      .insert({ room_id: room.id, user_id: userId, seat_index: 0, display_name: displayName })
      .select()
      .single();
    if (playerError || !player) throw new HttpError("Failed to seat the host", 500);

    return json({ ok: true, roomId: room.id, code: room.code, playerId: player.id });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    console.error(e);
    return errorResponse("Internal error", 500);
  }
});
