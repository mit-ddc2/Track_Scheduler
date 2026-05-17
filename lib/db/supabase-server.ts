import { createServerClient as createSupabaseServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "./types";

/**
 * Server-side Supabase client bound to the current request's cookies.
 *
 * Uses the new publishable-key naming convention (spec §12.5). The cookies()
 * helper is async in Next.js 16 — callers must `await createClient()`.
 *
 * Writing cookies from a Server Component is a no-op; the request-scoped
 * proxy is responsible for refreshing and persisting auth cookies.
 */
export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY env vars.",
    );
  }

  const cookieStore = await cookies();

  return createSupabaseServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component — safe to ignore: the proxy
          // refreshes auth cookies on the request boundary.
        }
      },
    },
  });
}

/** @deprecated Use `createClient()`. Kept for legacy callers. */
export const createServerClient = createClient;
