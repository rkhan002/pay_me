// Special-cased like propose-meld: a wild card laid off onto an existing
// RUN needs a rank pinned (which end of the run it's extending) before it
// can be appended - see melds.ts's layoffWildCandidates. Responds with
// needsWildDesignation + the (at most 2) legal ranks so the client can show
// a picker and resubmit with wildAssignedRank filled in.
import { layOffDuringTurn, layOffDuringLayoffPhase } from "../_shared/rules-engine/handState.ts";
import { layoffWildCandidates } from "../_shared/rules-engine/melds.ts";
import { isWildCard } from "../_shared/rules-engine/deck.ts";
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
    const { handId, card, meldId, wildAssignedRank } = body;
    if (!handId) throw new HttpError("Missing handId", 400);
    if (!card || !meldId) return errorResponse("Missing card or meldId", 400);

    const admin = supabaseAdmin();
    const { playerId } = await resolvePlayerIdForHand(admin, handId, userId);
    const prevState = await loadHandState(admin, handId);

    const meld = prevState.melds.find((m) => m.id === meldId);
    if (!meld) return errorResponse("No such meld on the table", 422);

    if (meld.type === "RUN" && isWildCard(card, prevState.wildRank) && !wildAssignedRank) {
      const candidateRanks = layoffWildCandidates(meld.cards, prevState.wildRank);
      if (candidateRanks.length === 0) {
        return errorResponse("That card can't be added to this meld", 422);
      }
      return json({ ok: false, needsWildDesignation: true, candidateRanks });
    }

    const fn = prevState.phase === "layoff" ? layOffDuringLayoffPhase : layOffDuringTurn;
    const result = fn(prevState, playerId, card, meldId, wildAssignedRank);
    if (!result.ok) return errorResponse(result.error, 422);

    await saveHandState(admin, handId, prevState, result.state, playerId);
    await logMove(admin, handId, playerId, "layoff", body);

    return json({ ok: true });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    console.error(e);
    return errorResponse("Internal error", 500);
  }
});
