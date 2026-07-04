// Shared boilerplate for every "intent" function (draw, discard, propose
// meld, lay off, pass lay-off): auth -> resolve seat -> load HandState ->
// run the rules-engine transition -> persist -> log -> respond. Every
// function file becomes a one-line call into this, keeping the actual game
// logic entirely inside packages/rules-engine.
import type { HandState, Result } from "./rules-engine/handState.ts";
import { supabaseAdmin } from "./supabaseAdmin.ts";
import {
  CORS_HEADERS,
  HttpError,
  errorResponse,
  handleOptions,
  json,
  requireUserId,
} from "./http.ts";
import { resolvePlayerIdForHand } from "./playerLookup.ts";
import { loadHandState, saveHandState, logMove } from "./handRepo.ts";

export function handleAction(
  action: string,
  transition: (state: HandState, playerId: string, body: any) => Result<HandState>,
) {
  return async (req: Request): Promise<Response> => {
    const preflight = handleOptions(req);
    if (preflight) return preflight;

    try {
      if (req.method !== "POST") throw new HttpError("POST only", 405);
      const userId = await requireUserId(req);
      const body = await req.json();
      const { handId } = body;
      if (!handId) throw new HttpError("Missing handId", 400);

      const admin = supabaseAdmin();
      const { playerId } = await resolvePlayerIdForHand(admin, handId, userId);
      const prevState = await loadHandState(admin, handId);

      const result = transition(prevState, playerId, body);
      if (!result.ok) return errorResponse(result.error, 422);

      await saveHandState(admin, handId, prevState, result.state, playerId);
      await logMove(admin, handId, playerId, action, body);

      return json({ ok: true });
    } catch (e) {
      if (e instanceof HttpError) return errorResponse(e.message, e.status);
      console.error(e);
      return errorResponse("Internal error", 500);
    }
  };
}

export { CORS_HEADERS };
