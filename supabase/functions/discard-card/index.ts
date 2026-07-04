import { discard } from "../_shared/rules-engine/handState.ts";
import { handleAction } from "../_shared/actionHandler.ts";

Deno.serve(
  handleAction("discard", (state, playerId, body) => {
    if (!body.card) return { ok: false, error: "Missing card" };
    return discard(state, playerId, body.card);
  }),
);
