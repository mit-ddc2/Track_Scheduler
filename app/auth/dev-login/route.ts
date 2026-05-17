import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { createClient } from "@/lib/db/supabase-server";
import { createAdminClient } from "@/lib/db/supabase-admin";

/**
 * Temporary dev-login bypass — auto-signs the owner in without the
 * magic-link email round-trip. Gated by the CRON_SECRET so the URL isn't
 * publicly exploitable.
 *
 *   GET /auth/dev-login?key=<CRON_SECRET>
 *
 * Mints a sign-in session for the owner email directly on the server (via
 * verifyOtp using the admin-generated token), so cookies are set on this
 * domain without an implicit-flow URL fragment round-trip.
 *
 * Intended for review-mode access only — delete before public launch.
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

  // Ensure the auth user exists (idempotent).
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

  // Generate a magic-link token via admin (no email sent).
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: OWNER_EMAIL,
  });
  if (linkError || !linkData?.properties?.hashed_token) {
    return NextResponse.json(
      { error: "generateLink failed", detail: linkError?.message ?? "no hashed_token" },
      { status: 500 },
    );
  }

  // Verify the token server-side using the request-scoped client so the
  // session cookies are set on THIS domain.
  const supabase = await createClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyError) {
    return NextResponse.json(
      { error: "verifyOtp failed", detail: verifyError.message },
      { status: 500 },
    );
  }

  return NextResponse.redirect(new URL("/dashboard", request.url), { status: 302 });
}
