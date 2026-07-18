// Every one of these is a plain "send an intent, render whatever the server
// decides" call - this file contains zero game logic. A rejected intent
// (bad move, out of turn, invalid meld) comes back as { ok: false, error }
// and the UI just surfaces the message; it never second-guesses the server.
import { supabase, ensureSession } from "./supabaseClient.js";
import { FUNCTIONS_URL } from "../config.js";

async function callFunction(name, body) {
  const session = await ensureSession();
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: supabase.supabaseKey,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  // propose-meld/layoff-card can come back { ok: false, needsWildDesignation:
  // true, ... } - that's not a rejected move, it's a request for more
  // information, so it's handed back to the caller instead of thrown.
  if ((!res.ok || json.ok === false) && !json.needsWildDesignation) {
    const err = new Error(json.error || `${name} failed`);
    // Some rejections carry a hint that the same cards would be valid as the
    // other meld type (see propose-meld); pass it through so the UI can nudge.
    if (json.couldBe) err.couldBe = json.couldBe;
    throw err;
  }
  return json;
}

export const createRoom = (displayName, mode = "full", avatar = null, maxPlayers = 6) =>
  callFunction("create-room", { displayName, mode, avatar, maxPlayers });

export const joinRoom = (code, displayName, avatar = null) =>
  callFunction("join-room", { code, displayName, avatar });

export const startHand = (roomId) => callFunction("start-hand", { roomId });

export const drawStock = (handId) => callFunction("draw-card", { handId, source: "stock" });

export const drawDiscard = (handId) => callFunction("draw-card", { handId, source: "discard" });

export const discardCard = (handId, card) => callFunction("discard-card", { handId, card });

export const proposeMeld = (handId, cards, meldType, wildAssignments) =>
  callFunction("propose-meld", { handId, cards, meldType, wildAssignments });

export const layOffCard = (handId, card, meldId, wildAssignedRank) =>
  callFunction("layoff-card", { handId, card, meldId, wildAssignedRank });

export const passLayoff = (handId) => callFunction("pass-layoff", { handId });

export const stealWild = (handId, meldId, card) =>
  callFunction("steal-wild", { handId, meldId, card });

export const unmeld = (handId, meldId) => callFunction("unmeld", { handId, meldId });

export const heartbeat = (roomId) => callFunction("heartbeat", { roomId });

export const skipStalePlayer = (handId, targetPlayerId) =>
  callFunction("skip-stale-player", { handId, targetPlayerId });
