// Service-role client used by every Edge Function. This is the ONLY thing
// in the whole system allowed to bypass RLS - it is never exposed to the
// client. Each function still authenticates the calling player (see
// requireAuth.ts) and checks room/seat ownership before doing anything.
import { createClient } from "npm:@supabase/supabase-js@2";

export function supabaseAdmin() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
