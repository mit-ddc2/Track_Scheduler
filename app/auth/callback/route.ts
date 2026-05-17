import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/db/supabase-server";

/**
 * Magic-link callback. Supabase redirects here with `?code=...`; we exchange
 * it for a session (which sets auth cookies via the server client) and then
 * bounce to `next` (validated) — the root layout decides where the user
 * actually lands.
 */

/**
 * Validate a `next` param to defeat open-redirect chains. Accepts only
 * same-origin relative paths starting with a single `/`. Rejects:
 *   - protocol-relative `//attacker.tld`
 *   - backslash variant `/\\attacker.tld`
 *   - absolute URLs (`http:`, `https:`, anything with `://`)
 *   - missing / empty values (falls back to `/`)
 */
export function sanitizeNext(raw: string | null | undefined): string {
  if (!raw) return "/";
  const candidate = raw.trim();
  if (candidate.length === 0) return "/";
  if (!candidate.startsWith("/")) return "/";
  if (candidate.startsWith("//")) return "/";
  if (candidate.startsWith("/\\")) return "/";
  if (candidate.includes("://")) return "/";
  // Defence-in-depth: reject any explicit scheme prefix.
  const lower = candidate.toLowerCase();
  if (lower.startsWith("http:") || lower.startsWith("https:")) return "/";
  return candidate;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next");
  const next = sanitizeNext(rawNext);
  if (rawNext && next !== rawNext) {
    console.warn(
      `[auth/callback] rejected unsafe next param: ${JSON.stringify(rawNext)}`,
    );
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=callback`);
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(`${origin}/login?error=callback`);
    }
  } catch {
    return NextResponse.redirect(`${origin}/login?error=callback`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
