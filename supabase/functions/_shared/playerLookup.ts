import { HttpError } from "./http.ts";

// deno-lint-ignore no-explicit-any
type SupabaseAdmin = any;

/** Resolves the calling user's player row for the room that owns `handId`. */
export async function resolvePlayerIdForHand(
  admin: SupabaseAdmin,
  handId: string,
  userId: string,
): Promise<{ playerId: string; roomId: string }> {
  const { data: hand, error: handError } = await admin
    .from("hands")
    .select("room_id")
    .eq("id", handId)
    .single();
  if (handError || !hand) throw new HttpError("Hand not found", 404);

  const { data: player, error: playerError } = await admin
    .from("players")
    .select("id")
    .eq("room_id", hand.room_id)
    .eq("user_id", userId)
    .single();
  if (playerError || !player) throw new HttpError("You're not seated in this room", 403);

  return { playerId: player.id, roomId: hand.room_id };
}
