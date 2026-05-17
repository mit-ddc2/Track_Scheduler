import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js 16 `proxy.ts` (formerly middleware). Refreshes the Supabase
 * session on every matched request so server components see a fresh user.
 *
 * Always returns a `NextResponse.next()` (with refreshed cookies attached);
 * authn/authz decisions happen in `requireOwner()` per route, not here, so
 * we never accidentally block public callbacks or webhooks.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    // No Supabase config (e.g., CI build with placeholders) — skip refresh.
    return response;
  }

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // IMPORTANT: do not run code between createServerClient and getUser().
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     *  - /login                  (public sign-in)
     *  - /auth/*                 (Supabase callback)
     *  - /api/webhooks/*         (third-party webhooks — own auth)
     *  - /api/jobs/*             (cron jobs — CRON_SECRET auth)
     *  - /r/*                    (public RSVP links)
     *  - /_next/static, /_next/image, favicon, public assets
     */
    "/((?!login|auth|api/webhooks|api/jobs|r/|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
