import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { HttpError, errorResponse, handleOptions, json, requireUserId } from "../_shared/http.ts";

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    if (req.method !== "POST") throw new HttpError("POST only", 405);
    const userId = await requireUserId(req);
    const { code, displayName, avatar = null } = await req.json();
    if (!code || !displayName) throw new HttpError("Missing code or displayName", 400);
    // Optional character-icon id (see create-room); null keeps the initials circle.
    const avatarId = typeof avatar === "string" && avatar.length <= 32 ? avatar : null;

    const admin = supabaseAdmin();
    const { data: room, error: roomError } = await admin
      .from("rooms")
      .select("*")
      .eq("code", String(code).toUpperCase())
      .single();
    if (roomError || !room) throw new HttpError("No room with that code", 404);

    // Rejoin: same browser/session (anonymous auth.uid) reconnecting to a
    // seat it already holds - e.g. after a refresh.
    const { data: existing } = await admin
      .from("players")
      .select("*")
      .eq("room_id", room.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (existing) {
      await admin
        .from("players")
        .update({ last_seen_at: new Date().toISOString(), avatar: avatarId })
        .eq("id", existing.id);
      return json({ ok: true, roomId: room.id, playerId: existing.id, rejoined: true });
    }

    if (room.status !== "lobby") {
      throw new HttpError("This game has already started", 409);
    }

    const { count } = await admin
      .from("players")
      .select("id", { count: "exact", head: true })
      .eq("room_id", room.id);
    if ((count ?? 0) >= room.max_players) throw new HttpError("Room is full", 409);

    const { data: player, error: playerError } = await admin
      .from("players")
      .insert({
        room_id: room.id,
        user_id: userId,
        seat_index: count ?? 0,
        display_name: displayName,
        avatar: avatarId,
      })
      .select()
      .single();
    if (playerError || !player) throw new HttpError("Failed to join room", 500);

    return json({ ok: true, roomId: room.id, playerId: player.id, rejoined: false });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    console.error(e);
    return errorResponse("Internal error", 500);
  }
});
