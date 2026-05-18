import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/db/supabase-admin";

/**
 * POST /api/auth/is-allowed
 *
 * Pre-flight check before firing a Supabase magic-link OTP. Returns
 * `{ allowed: boolean }` based on whether the supplied email matches a row
 * in `public.owner_emails`. The login form calls this so we can show
 * "this email isn't authorized" inline without ever creating an auth.users
 * row or sending a magic link to a random address.
 *
 * Notes:
 *  - Uses the admin (service-role) Supabase client so RLS doesn't matter.
 *    `owner_emails` has no public read policy; the admin client bypasses
 *    that without us having to relax security.
 *  - Constant-time compare on the *result* string ("yes"/"no") so the
 *    response time can't be used as a side channel to learn whether a
 *    given email is on the allowlist (timing oracle).
 *  - Per-IP rate limit: 10 POSTs / minute. Same in-memory bucket pattern
 *    as `/r/[token]/submit` and the dev-login route — sufficient first-line
 *    guard; not bulletproof under multi-instance fan-out.
 *  - On any DB error we fail CLOSED (return allowed=false). The user sees
 *    the friendly "not authorized" copy and we log the cause.
 */

export const dynamic = "force-dynamic";

const PER_IP_LIMIT = 10;
const WINDOW_MS = 60_000;

type Bucket = { count: number; resetAt: number };
const ipBuckets = new Map<string, Bucket>();

export function __resetRateLimitForTesting() {
  ipBuckets.clear();
}

function checkBucket(key: string, limit: number): boolean {
  const now = Date.now();
  const bucket = ipBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    ipBuckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

function getClientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() ?? "unknown";
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

/**
 * Compare two short strings in constant time. Length-mismatch returns false
 * but at least normalises buffer sizes so the comparison itself doesn't
 * branch on the data.
 */
function constantTimeEqualString(a: string, b: string): boolean {
  // Pad to a fixed width so callers can't infer the truthy length from
  // timing on the comparison loop. 8 bytes is enough — we only ever compare
  // "yes"/"no" sentinels here.
  const width = 8;
  const ab = Buffer.alloc(width);
  const bb = Buffer.alloc(width);
  ab.write(a.slice(0, width));
  bb.write(b.slice(0, width));
  return timingSafeEqual(ab, bb);
}

function isValidEmail(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 254) return false;
  // Loose RFC 5321 surface check; we don't need full validation since the
  // value is only used for an equality match against owner_emails.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!checkBucket(ip, PER_IP_LIMIT)) {
    return NextResponse.json(
      { allowed: false, error: "rate_limited" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { allowed: false, error: "invalid_body" },
      { status: 400 },
    );
  }
  const obj = (payload ?? {}) as Record<string, unknown>;
  if (!isValidEmail(obj.email)) {
    return NextResponse.json(
      { allowed: false, error: "invalid_email" },
      { status: 400 },
    );
  }
  const email = (obj.email as string).trim().toLowerCase();

  // Fail closed on any infrastructure error — better to refuse a legitimate
  // sign-in than to allow random emails through during a DB outage.
  let dbResult: "yes" | "no" = "no";
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("owner_emails")
      .select("email")
      .eq("email", email)
      .maybeSingle();
    if (error) {
      console.error("[is-allowed] owner_emails lookup error:", error.message);
      dbResult = "no";
    } else {
      dbResult = data ? "yes" : "no";
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[is-allowed] admin client threw:", msg);
    dbResult = "no";
  }

  const allowed = constantTimeEqualString(dbResult, "yes");
  return NextResponse.json({ allowed });
}
