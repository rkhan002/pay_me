// Called periodically by every connected client while it's on the table
// screen. Bumps last_seen_at for the caller's player row - the only signal
// the server has that a given player is actually still around. Nothing else
// ever writes this column back down; a stopped heartbeat is exactly what
// "disconnected" means here (see handRepo.ts's STALE_MS staleness check).
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
    const { data: player, error: playerError } = await admin
      .from("players")
      .select("id")
      .eq("room_id", roomId)
      .eq("user_id", userId)
      .single();
    if (playerError || !player) throw new HttpError("You're not seated in this room", 403);

    const { error: updateError } = await admin
      .from("players")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", player.id);
    if (updateError) throw new HttpError("Failed to record heartbeat", 500);

    return json({ ok: true });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    console.error(e);
    return errorResponse("Internal error", 500);
  }
});
