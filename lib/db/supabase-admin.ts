// server-only: never import this from a Client Component or browser bundle.
import { createClient } from "@supabase/supabase-js";

import type { Database } from "./types";

if (typeof window !== "undefined") {
  throw new Error(
    "lib/db/supabase-admin.ts must never be imported in the browser.",
  );
}

/**
 * Privileged Supabase client using the secret key. Bypasses RLS — only call
 * from trusted server contexts (Route Handlers, Server Actions, cron jobs).
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY env vars.",
    );
  }

  return createClient<Database>(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
