// server-only: never import this from a Client Component or browser bundle.
if (typeof window !== "undefined") {
  throw new Error("lib/db/supabase-admin.ts is server-only");
}

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./types";

/**
 * Privileged Supabase client using the service-role secret key. Bypasses RLS,
 * so only call from trusted server contexts (Route Handlers, Server Actions,
 * cron jobs). The secret key isn't required until Phase 5+; calling this
 * before then will throw a clear error so misconfiguration is obvious.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL env var (required for admin client).",
    );
  }
  if (!secretKey) {
    throw new Error(
      "Missing SUPABASE_SECRET_KEY env var (required for admin client; needed Phase 5+).",
    );
  }

  return createSupabaseClient<Database>(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
