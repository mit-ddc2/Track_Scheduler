import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { writeAudit } from "@/lib/db/audit";
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
 * PRODUCTION-DISABLE: set DEV_LOGIN_ENABLED=false in production once magic
 * link is in regular use. The route returns 404 unless DEV_LOGIN_ENABLED=true.
 *
 * Also requires DEV_LOGIN_EMAIL to be explicitly set — there is no fallback.
 */

// In-memory token bucket: 5 attempts per IP per minute. Resets per process,
// which is fine for a single-deploy dev-login bypass; the goal is to slow
// down credential-stuffing, not provide bulletproof rate limiting.
type Bucket = { count: number; resetAt: number };
const ipBuckets = new Map<string, Bucket>();
const MAX_ATTEMPTS_PER_MIN = 5;
const WINDOW_MS = 60_000;

export function __resetRateLimitForTesting() {
  ipBuckets.clear();
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const bucket = ipBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    ipBuckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (bucket.count >= MAX_ATTEMPTS_PER_MIN) {
    return false;
  }
  bucket.count += 1;
  return true;
}

function getClientIp(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() ?? "unknown";
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf-8");
  const bBuf = Buffer.from(b, "utf-8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export async function GET(request: NextRequest) {
  // Hard environment gate: route is 404 unless explicitly enabled.
  if (process.env.DEV_LOGIN_ENABLED !== "true") {
    return new NextResponse("Not found", { status: 404 });
  }

  // Require the owner email to be set explicitly — no hardcoded fallback.
  const ownerEmail = process.env.DEV_LOGIN_EMAIL;
  if (!ownerEmail) {
    return NextResponse.json(
      { error: "dev-login unavailable: DEV_LOGIN_EMAIL not configured" },
      { status: 500 },
    );
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "dev-login unavailable: CRON_SECRET not configured" },
      { status: 500 },
    );
  }

  // Rate limit by IP.
  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const provided = request.nextUrl.searchParams.get("key") ?? "";
  if (!constantTimeEqual(provided, cronSecret)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Ensure the auth user exists (idempotent).
  const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const found = existing?.users.find((u) => u.email === ownerEmail);
  if (!found) {
    const { error: createError } = await admin.auth.admin.createUser({
      email: ownerEmail,
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
    email: ownerEmail,
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

  // Audit every successful dev-login so any use is visible after the fact.
  // Best-effort — writeAudit catches its own errors.
  await writeAudit({
    action: "auth.dev_login",
    entity_type: "auth_user",
    entity_id: ownerEmail,
    summary: "dev-login bypass used",
    actorType: "owner",
    actorId: null,
    after: { ip },
  });

  return NextResponse.redirect(new URL("/dashboard", request.url), { status: 302 });
}
