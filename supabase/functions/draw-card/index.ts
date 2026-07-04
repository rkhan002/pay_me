import { drawFromDiscard, drawFromStock } from "../../../packages/rules-engine/src/handState.ts";
import { handleAction } from "../_shared/actionHandler.ts";

Deno.serve(
  handleAction("draw_stock", (state, playerId, body) => {
    if (body.source === "discard") return drawFromDiscard(state, playerId);
    if (body.source === "stock") return drawFromStock(state, playerId);
    return { ok: false, error: "source must be 'stock' or 'discard'" };
  }),
);
