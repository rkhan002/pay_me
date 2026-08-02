// Refresh / reconnect + shareable-room-links support.
//
// The Supabase anonymous session already persists across refreshes, so the
// player's identity (userId) survives - what's lost is only the in-memory
// "which room am I in". This module restores that:
//   1. server lookup by identity (authoritative): find the active room this
//      user is a member of and drop them straight back onto the table;
//   2. a localStorage hint for an instant fast-path (no lookup round-trip);
//   3. the room CODE in the URL (?room=CODE) so a link is shareable and a
//      refresh keeps the room even before anything else resolves.
// No backend changes are needed: RLS ("is_room_member") already lets a user
// read their own player rows and their rooms.
import { supabase } from "./supabaseClient.js";
import { getState, setState } from "../state/store.js";
import { loadRoom } from "./queries.js";
import { subscribeToRoom } from "./realtime.js";

const LAST_ROOM_KEY = "payme:lastRoom";
const NAME_KEY = "payme:displayName";

export function persistRoom(roomId, playerId, code) {
  try {
    localStorage.setItem(LAST_ROOM_KEY, JSON.stringify({ roomId, playerId, code: code ?? null }));
  } catch {
    /* localStorage unavailable - reconnect just falls back to the server lookup */
  }
}
export function clearPersistedRoom() {
  try {
    localStorage.removeItem(LAST_ROOM_KEY);
  } catch {
    /* ignore */
  }
}
function readPersistedRoom() {
  try {
    return JSON.parse(localStorage.getItem(LAST_ROOM_KEY) || "null");
  } catch {
    return null;
  }
}

export function persistDisplayName(name) {
  try {
    if (name) localStorage.setItem(NAME_KEY, name);
  } catch {
    /* ignore */
  }
}
export function readDisplayName() {
  try {
    return localStorage.getItem(NAME_KEY) || "";
  } catch {
    return "";
  }
}

// --- Shareable invite links: the room CODE lives in the ?room= query param.
export function roomCodeFromUrl() {
  try {
    return new URLSearchParams(location.search).get("room")?.trim().toUpperCase() || null;
  } catch {
    return null;
  }
}
export function setRoomInUrl(code) {
  try {
    const url = new URL(location.href);
    if (code) url.searchParams.set("room", code);
    else url.searchParams.delete("room");
    // replaceState (not push) so refresh/back isn't cluttered with entries.
    history.replaceState(null, "", url);
  } catch {
    /* ignore */
  }
}
// The full link to share for the current room.
export function inviteLink(code) {
  return `${location.origin}${location.pathname}?room=${encodeURIComponent(code)}`;
}

// The active (non-complete) room this user is currently a member of, if any.
// RLS lets a user read their own player rows + those rooms, so this is a plain
// client query rather than a dedicated edge function.
async function findActiveRoom(userId) {
  const { data } = await supabase
    .from("players")
    .select("id, room_id, joined_at, rooms(status)")
    .eq("user_id", userId)
    .order("joined_at", { ascending: false });
  const row = (data || []).find((r) => r.rooms && r.rooms.status !== "complete");
  return row ? { roomId: row.room_id } : null;
}

// Restore a room onto the table if it's real, unfinished, and this identity is
// actually a member of it. Validates against the freshly-loaded truth (matches
// by userId, not a possibly-stale stored playerId).
async function tryRoom(roomId, userId) {
  await loadRoom(roomId);
  const st = getState();
  if (!st.room || st.room.status === "complete") return false;
  const me = st.players.find((p) => p.userId === userId);
  if (!me) return false;
  setState({ myPlayerId: me.id, screen: "table" });
  subscribeToRoom(roomId);
  persistRoom(st.room.id, me.id, st.room.code);
  setRoomInUrl(st.room.code);
  return true;
}

// Drop the player straight back onto the table after a refresh. Returns true if
// it restored a table, false if they should see the lobby.
export async function attemptReconnect() {
  const { userId } = getState();
  if (!userId) return false;

  // 1) local fast-path (instant roomId, no lookup query)
  const hint = readPersistedRoom();
  if (hint?.roomId && (await tryRoom(hint.roomId, userId))) return true;

  // 2) authoritative server lookup by identity
  const found = await findActiveRoom(userId);
  if (found && (await tryRoom(found.roomId, userId))) return true;

  // Nothing to restore - drop the stale local hint. Keep any ?room= param
  // though: for a non-member it's likely a shared invite code, which the
  // lobby will prefill into the join field.
  clearPersistedRoom();
  return false;
}
