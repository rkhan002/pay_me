import { unmeld } from "../_shared/rules-engine/handState.ts";
import { handleAction } from "../_shared/actionHandler.ts";

Deno.serve(
  handleAction("unmeld", (state, playerId, body) => {
    if (!body.meldId) return { ok: false, error: "Missing meldId" };
    return unmeld(state, playerId, body.meldId);
  }),
);
