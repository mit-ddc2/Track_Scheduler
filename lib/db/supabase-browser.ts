"use client";

import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "./types";

/**
 * Browser-side Supabase client. Use inside `'use client'` components for
 * auth flows (magic links) and realtime subscriptions. Server-rendered
 * code should always use `createClient()` from `./supabase-server`.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY env vars.",
    );
  }

  return createBrowserClient<Database>(url, publishableKey);
}
