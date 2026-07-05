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
  if (!res.ok || json.ok === false) {
    throw new Error(json.error || `${name} failed`);
  }
  return json;
}

export const createRoom = (displayName, maxPlayers = 8) =>
  callFunction("create-room", { displayName, maxPlayers });

export const joinRoom = (code, displayName) => callFunction("join-room", { code, displayName });

export const startHand = (roomId) => callFunction("start-hand", { roomId });

export const drawStock = (handId) => callFunction("draw-card", { handId, source: "stock" });

export const drawDiscard = (handId) => callFunction("draw-card", { handId, source: "discard" });

export const discardCard = (handId, card) => callFunction("discard-card", { handId, card });

export const proposeMeld = (handId, cards, meldType) =>
  callFunction("propose-meld", { handId, cards, meldType });

export const layOffCard = (handId, card, meldId) =>
  callFunction("layoff-card", { handId, card, meldId });

export const passLayoff = (handId) => callFunction("pass-layoff", { handId });

export const heartbeat = (roomId) => callFunction("heartbeat", { roomId });

export const skipStalePlayer = (handId, targetPlayerId) =>
  callFunction("skip-stale-player", { handId, targetPlayerId });
