import { drawFromDiscard, drawFromStock } from "../_shared/rules-engine/handState.ts";
import { handleAction } from "../_shared/actionHandler.ts";

Deno.serve(
  handleAction("draw_stock", (state, playerId, body) => {
    if (body.source === "discard") return drawFromDiscard(state, playerId);
    if (body.source === "stock") return drawFromStock(state, playerId);
    return { ok: false, error: "source must be 'stock' or 'discard'" };
  }),
);
