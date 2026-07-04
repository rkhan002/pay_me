import { discard } from "../../../packages/rules-engine/src/handState.ts";
import { handleAction } from "../_shared/actionHandler.ts";

Deno.serve(
  handleAction("discard", (state, playerId, body) => {
    if (!body.card) return { ok: false, error: "Missing card" };
    return discard(state, playerId, body.card);
  }),
);
