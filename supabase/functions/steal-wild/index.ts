// Lay-off-round wild steal: a player pulls a wild card out of a RUN in the
// winner's meld by substituting the exact natural card it stands in for (same
// rank AND suit) from their hand, and takes the freed wild. Runs only - see
// stealWildFromRun in the rules engine, which does all the validation.
import { stealWildFromRun } from "../_shared/rules-engine/handState.ts";
import { handViewFor } from "../_shared/rules-engine/handView.ts";
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
    const { handId, meldId, card } = body;
    if (!handId) throw new HttpError("Missing handId", 400);
    if (!meldId || !card) return errorResponse("Missing meldId or card", 400);

    const admin = supabaseAdmin();
    const { playerId } = await resolvePlayerIdForHand(admin, handId, userId);
    const prevState = await loadHandState(admin, handId);

    const result = stealWildFromRun(prevState, playerId, meldId, card);
    if (!result.ok) return errorResponse(result.error, 422);

    await saveHandState(admin, handId, prevState, result.state, playerId);
    await logMove(admin, handId, playerId, "steal_wild", body);

    return json({ ok: true, view: handViewFor(result.state, playerId) });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    console.error(e);
    return errorResponse("Internal error", 500);
  }
});
