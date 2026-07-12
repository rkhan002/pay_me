// Special-cased like pass-layoff/skip-stale-player rather than routed
// through the generic action handler: a RUN meld containing a wild card
// has no single correct arrangement (see melds.ts's runArrangements) until
// the player says what each wild stands for. Rather than guess, or
// duplicate the arrangement math in client JS, this responds with a
// distinguishable "needsWildDesignation" payload so the client can show a
// picker and resubmit the same request with wildAssignments filled in.
import { proposeMeld } from "../_shared/rules-engine/handState.ts";
import { runArrangements, validateSet } from "../_shared/rules-engine/melds.ts";
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
    const { handId, cards, meldType, wildAssignments } = body;
    if (!handId) throw new HttpError("Missing handId", 400);
    if (!Array.isArray(cards) || !meldType) {
      return errorResponse("Missing cards or meldType", 400);
    }

    const admin = supabaseAdmin();
    const { playerId } = await resolvePlayerIdForHand(admin, handId, userId);
    const prevState = await loadHandState(admin, handId);

    if (meldType === "RUN" && cards.some((c: any) => isWildCard(c, prevState.wildRank))) {
      if (!wildAssignments) {
        const arrangements = runArrangements(cards, prevState.wildRank);
        if (arrangements.length === 0) {
          return errorResponse("Cards don't form a valid run", 422);
        }
        return json({ ok: false, needsWildDesignation: true, arrangements });
      }
    }

    const result = proposeMeld(prevState, playerId, cards, meldType, wildAssignments);
    if (!result.ok) {
      // A common mix-up is submitting run-shaped cards via "Meld as set" (or
      // vice versa). When the same cards WOULD be valid as the other meld
      // type, tell the client so it can nudge the player toward the right
      // button instead of just echoing the raw validation error.
      let couldBe: "SET" | "RUN" | undefined;
      if (meldType === "SET") {
        if (runArrangements(cards, prevState.wildRank).length > 0) couldBe = "RUN";
      } else if (validateSet(cards, prevState.wildRank).valid) {
        couldBe = "SET";
      }
      return json({ ok: false, error: result.error, ...(couldBe ? { couldBe } : {}) }, 422);
    }

    await saveHandState(admin, handId, prevState, result.state, playerId);
    await logMove(admin, handId, playerId, "propose_meld", body);

    return json({ ok: true });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    console.error(e);
    return errorResponse("Internal error", 500);
  }
});
