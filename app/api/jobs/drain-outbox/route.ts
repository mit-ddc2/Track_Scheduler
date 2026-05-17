import { NextResponse, type NextRequest } from "next/server";

import { drainOutbox } from "@/lib/messaging/outbox";
import { verifyCronSecret } from "@/lib/security/signatures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH_LIMIT = 50;

/**
 * Cron entry point — invoked every minute by Vercel Cron (see vercel.json).
 * Auth: must present `Authorization: Bearer ${CRON_SECRET}`.
 *
 * Returns a small JSON summary so Vercel runtime logs are usable.
 *
 * Hardening (SECURITY_AUDIT.md H4):
 *   - Re-entrancy guard: a second concurrent call returns 423 immediately.
 *   - Per-IP rate limit: 30 calls/minute. Above that → 429.
 *   - Internal exceptions return 500 so Vercel cron monitoring catches them
 *     (per-row provider failures are still tracked in the outbox itself).
 */

// Re-entrancy guard — module-scoped boolean.
let isDraining = false;

// In-memory token bucket: 30 calls per IP per minute.
type Bucket = { count: number; resetAt: number };
const ipBuckets = new Map<string, Bucket>();
const MAX_CALLS_PER_MIN = 30;
const WINDOW_MS = 60_000;

export function __resetDrainGuardsForTesting() {
  isDraining = false;
  ipBuckets.clear();
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const bucket = ipBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    ipBuckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (bucket.count >= MAX_CALLS_PER_MIN) return false;
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

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!verifyCronSecret(auth)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  // Re-entrancy guard — a second concurrent invocation must NOT run another
  // drainOutbox loop at the same time. Returns 423 Locked.
  if (isDraining) {
    return NextResponse.json(
      { error: "locked", message: "drain already in progress" },
      { status: 423 },
    );
  }
  isDraining = true;

  try {
    const result = await drainOutbox({ limit: BATCH_LIMIT });
    console.log("[cron:drain-outbox]", result);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron:drain-outbox] error:", message);
    // Return 500 so Vercel cron health surfaces the failure — masking it as
    // 200 hides broken jobs from monitoring (per SECURITY_AUDIT.md H4).
    return NextResponse.json(
      { error: "drain_failed", message },
      { status: 500 },
    );
  } finally {
    isDraining = false;
  }
}
