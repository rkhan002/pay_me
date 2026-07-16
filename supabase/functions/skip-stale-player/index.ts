// Lets any OTHER seated player force the game past whoever's current turn/
// final-turn/lay-off is stuck on, once that player has gone stale (stopped
// heartbeating). Special-cased like pass-layoff rather than routed through
// the generic action handler, because a skip that empties pendingLayoffs
// also needs to finalize scoring exactly the way a normal pass would.
//
// Staleness is re-checked here against the live last_seen_at, server-side -
// never trust a client's claim that someone else is disconnected. This is
// also why skipStalePlayer() itself (the rules-engine function) takes the
// staleness check as a given rather than computing it: that function stays
// a pure, deterministic state transition, and this is the one place that
// bridges "wall-clock time has passed" into that pure world.
import { skipStalePlayer } from "../_shared/rules-engine/handState.ts";
import { scoreHandForAllPlayers } from "../_shared/rules-engine/scoring.ts";
import { TOTAL_HANDS } from "../_shared/rules-engine/handConfig.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { HttpError, errorResponse, handleOptions, json, requireUserId } from "../_shared/http.ts";
import { resolvePlayerIdForHand } from "../_shared/playerLookup.ts";
import { loadHandState, saveHandState, logMove, STALE_MS } from "../_shared/handRepo.ts";
import { handViewFor } from "../_shared/rules-engine/handView.ts";

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    if (req.method !== "POST") throw new HttpError("POST only", 405);
    const userId = await requireUserId(req);
    const body = await req.json();
    const { handId, targetPlayerId } = body;
    if (!handId || !targetPlayerId) throw new HttpError("Missing handId or targetPlayerId", 400);

    const admin = supabaseAdmin();
    // Confirms the caller is actually seated in this room (throws otherwise).
    // The caller's own playerId isn't used beyond that membership check -
    // anyone at the table may call the skip, not just whoever's "next".
    const { playerId: callerId, roomId } = await resolvePlayerIdForHand(admin, handId, userId);

    const { data: target, error: targetError } = await admin
      .from("players")
      .select("id, last_seen_at")
      .eq("id", targetPlayerId)
      .eq("room_id", roomId)
      .single();
    if (targetError || !target) throw new HttpError("No such player in this room", 404);

    const staleForMs = Date.now() - new Date(target.last_seen_at).getTime();
    if (staleForMs < STALE_MS) {
      throw new HttpError("That player is still connected", 409);
    }

    const prevState = await loadHandState(admin, handId);
    const result = skipStalePlayer(prevState, targetPlayerId);
    if (!result.ok) return errorResponse(result.error, 422);

    await saveHandState(admin, handId, prevState, result.state, callerId);
    await logMove(admin, handId, callerId, "skip_stale_player", body);

    let scoreMap: Record<string, number> | undefined;
    if (result.state.phase === "scoring" && result.state.payMeCallerId) {
      const scores = scoreHandForAllPlayers(
        result.state.hands,
        result.state.wildRank,
        result.state.payMeCallerId,
      );
      for (const entry of scores) {
        await admin
          .from("hand_players")
          .update({ score: entry.score })
          .eq("hand_id", handId)
          .eq("player_id", entry.playerId);
      }
      await admin.from("hands").update({ phase: "complete" }).eq("id", handId);
      scoreMap = Object.fromEntries(scores.map((e) => [e.playerId, e.score]));

      const { data: hand } = await admin
        .from("hands")
        .select("hand_number")
        .eq("id", handId)
        .single();
      if (hand?.hand_number >= TOTAL_HANDS) {
        await admin.from("rooms").update({ status: "complete" }).eq("id", roomId);
      }
    }

    const view = scoreMap
      ? handViewFor({ ...result.state, phase: "complete" }, callerId, scoreMap)
      : handViewFor(result.state, callerId);
    return json({ ok: true, view });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    console.error(e);
    return errorResponse("Internal error", 500);
  }
});
