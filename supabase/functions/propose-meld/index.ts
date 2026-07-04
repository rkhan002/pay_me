import { proposeMeld } from "../../../packages/rules-engine/src/handState.ts";
import { handleAction } from "../_shared/actionHandler.ts";

Deno.serve(
  handleAction("propose_meld", (state, playerId, body) => {
    if (!Array.isArray(body.cards) || !body.meldType) {
      return { ok: false, error: "Missing cards or meldType" };
    }
    return proposeMeld(state, playerId, body.cards, body.meldType);
  }),
);
