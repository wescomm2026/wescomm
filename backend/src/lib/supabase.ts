import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";
import { createSupabaseFetchWithErrorStatus } from "../utils/supabase-fetch.js";

export const supabaseAdmin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    global: {
      fetch: createSupabaseFetchWithErrorStatus()
    },
    db: {
      // Prevent a stalled Data API request from consuming an entire serverless
      // invocation. supabase-js 2.102+ already retries transient idempotent
      // PostgREST reads with bounded exponential backoff.
      timeout: 15_000
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);
