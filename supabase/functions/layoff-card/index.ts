import { layOffDuringTurn, layOffDuringLayoffPhase } from "../_shared/rules-engine/handState.ts";
import { handleAction } from "../_shared/actionHandler.ts";

Deno.serve(
  handleAction("layoff", (state, playerId, body) => {
    if (!body.card || !body.meldId) return { ok: false, error: "Missing card or meldId" };
    const fn = state.phase === "layoff" ? layOffDuringLayoffPhase : layOffDuringTurn;
    return fn(state, playerId, body.card, body.meldId);
  }),
);
