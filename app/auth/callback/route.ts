import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/db/supabase-server";

/**
 * Magic-link callback. Supabase redirects here with `?code=...`; we exchange
 * it for a session (which sets auth cookies via the server client) and then
 * bounce to `/` — the root layout decides where the user actually lands.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

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
