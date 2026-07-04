// Special-cased (not the generic handleAction) because a pass that empties
// pendingLayoffs also needs to finalize scoring: compute each player's
// score, persist it, and mark the room ready for the next hand (or
// complete, if this was hand 11).
import { passLayoff } from "../_shared/rules-engine/handState.ts";
import { scoreHandForAllPlayers } from "../_shared/rules-engine/scoring.ts";
import { TOTAL_HANDS } from "../_shared/rules-engine/handConfig.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { HttpError, errorResponse, handleOptions, json, requireUserId } from "../_shared/http.ts";
import { resolvePlayerIdForHand } from "../_shared/playerLookup.ts";
import { loadHandState, saveHandState, logMove } from "../_shared/handRepo.ts";

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    if (req.method !== "POST") throw new HttpError("POST only", 405);
    const userId = await requireUserId(req);
    const body = await req.json();
    const { handId } = body;
    if (!handId) throw new HttpError("Missing handId", 400);

    const admin = supabaseAdmin();
    const { playerId, roomId } = await resolvePlayerIdForHand(admin, handId, userId);
    const prevState = await loadHandState(admin, handId);

    const result = passLayoff(prevState, playerId);
    if (!result.ok) return errorResponse(result.error, 422);

    await saveHandState(admin, handId, prevState, result.state, playerId);
    await logMove(admin, handId, playerId, "pass_layoff", body);

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

      const { data: hand } = await admin
        .from("hands")
        .select("hand_number")
        .eq("id", handId)
        .single();
      if (hand?.hand_number >= TOTAL_HANDS) {
        await admin.from("rooms").update({ status: "complete" }).eq("id", roomId);
      }
    }

    return json({ ok: true });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    console.error(e);
    return errorResponse("Internal error", 500);
  }
});
