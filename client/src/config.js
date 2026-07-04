// Fill these in from your Supabase project settings (Project Settings ->
// API). The anon key is safe to ship to the client - it can only do what
// RLS policies allow, and every game-changing action goes through Edge
// Functions anyway.
export const SUPABASE_URL = "https://zyvxibowrftsxjmetero.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp5dnhpYm93cmZ0c3hqbWV0ZXJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2MTgzNzIsImV4cCI6MjA4OTE5NDM3Mn0.4SELs5G7XHyfMbLxVBJ2Q9wap12lXTT3rl80law2ARE";

// Base URL Edge Functions are served from for this project.
export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;
