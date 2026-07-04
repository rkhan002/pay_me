import { proposeMeld } from "../_shared/rules-engine/handState.ts";
import { handleAction } from "../_shared/actionHandler.ts";

Deno.serve(
  handleAction("propose_meld", (state, playerId, body) => {
    if (!Array.isArray(body.cards) || !body.meldType) {
      return { ok: false, error: "Missing cards or meldType" };
    }
    return proposeMeld(state, playerId, body.cards, body.meldType);
  }),
);
