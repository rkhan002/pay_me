// DISABLED. Players can no longer skip / time each other out - the feature was
// removed in favour of a server-side inactivity sweep (see migration
// 0010_auto_close_inactive_rooms.sql, which auto-closes any game with no action
// for more than a week). The endpoint is kept as a hard-off stub so any old
// client still holding the code path gets a clear, permanent rejection rather
// than silently skipping a player.
import { errorResponse, handleOptions } from "../_shared/http.ts";

Deno.serve((req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  return errorResponse("Skipping other players has been removed.", 410);
});
