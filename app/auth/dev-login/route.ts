import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { createAdminClient } from "@/lib/db/supabase-admin";

/**
 * Temporary dev-login bypass — auto-signs the owner in without the
 * magic-link email round-trip. Gated by the CRON_SECRET so the URL isn't
 * publicly exploitable.
 *
 *   GET /auth/dev-login?key=<CRON_SECRET>
 *
 * On success, mints a sign-in session for the owner email (defaults to the
 * one seeded in `public.owner_emails`) and redirects to /dashboard. Intended
 * for review-mode access only — delete this file before public launch.
 */

const OWNER_EMAIL = process.env.DEV_LOGIN_EMAIL ?? "mit@ddc2.com";

function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf-8");
  const bBuf = Buffer.from(b, "utf-8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "dev-login unavailable: CRON_SECRET not configured" },
      { status: 500 },
    );
  }
  const provided = request.nextUrl.searchParams.get("key") ?? "";
  if (!constantTimeEqual(provided, cronSecret)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Ensure the auth user exists (idempotent via auto-confirm).
  const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const found = existing?.users.find((u) => u.email === OWNER_EMAIL);
  if (!found) {
    const { error: createError } = await admin.auth.admin.createUser({
      email: OWNER_EMAIL,
      email_confirm: true,
    });
    if (createError) {
      return NextResponse.json(
        { error: "createUser failed", detail: createError.message },
        { status: 500 },
      );
    }
  }

  // Generate a magic-link action_link the user can be redirected to. We use
  // the admin client so no email is sent — we just consume the link directly.
  const origin = request.nextUrl.origin;
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: OWNER_EMAIL,
    options: { redirectTo: `${origin}/auth/callback` },
  });
  if (linkError || !linkData?.properties?.action_link) {
    return NextResponse.json(
      { error: "generateLink failed", detail: linkError?.message ?? "no action_link" },
      { status: 500 },
    );
  }

  return NextResponse.redirect(linkData.properties.action_link, { status: 302 });
}
