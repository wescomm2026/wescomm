import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

let browserClient: SupabaseClient | null = null;

export function hasSupabaseBrowserConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLIC_KEY);
}

export function getSupabaseBrowserClient() {
  if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY) {
    throw new Error("Missing frontend Supabase environment variables.");
  }

  browserClient ??= createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: true,
      persistSession: false
    }
  });

  return browserClient;
}
