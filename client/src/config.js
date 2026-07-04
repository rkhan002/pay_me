// Fill these in from your Supabase project settings (Project Settings ->
// API). The anon key is safe to ship to the client - it can only do what
// RLS policies allow, and every game-changing action goes through Edge
// Functions anyway.
export const SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
export const SUPABASE_ANON_KEY = "YOUR-ANON-KEY";

// Base URL Edge Functions are served from for this project.
export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;
