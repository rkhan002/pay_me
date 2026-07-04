import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Every player is anonymous - no signup, no login screen. Supabase's
 * anonymous auth gives each browser a stable auth.uid() that RLS uses to
 * scope private hand data and that lets a refreshed tab rejoin its own seat.
 * The session persists in local storage, so refreshing keeps the same
 * identity; a different browser/device is a different identity (and a new
 * seat) even with the same display name.
 */
export async function ensureSession() {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;

  const { data: signInData, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return signInData.session;
}

export async function currentUserId() {
  const session = await ensureSession();
  return session.user.id;
}
