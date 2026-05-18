import { NextResponse } from "next/server";

import {
  rsvpSubmitSchema,
  type RsvpSubmitInput,
} from "@/lib/validation/schemas";

import { submitRsvpResponseImpl as submitRsvpResponse } from "../rsvp-handler";

export const dynamic = "force-dynamic";

/**
 * POST /r/[token]/submit — fallback transport for the RSVP form.
 *
 * The React form uses a server action directly, but having a plain Route
 * Handler means the same flow works from curl, a basic HTML <form>, or any
 * non-JS client. The token from the URL `[token]` segment is authoritative;
 * the body's `token` field (if any) is ignored.
 *
 * Accepts JSON or `application/x-www-form-urlencoded`.
 *
 * Rate-limited per-token (10 POST/min) and per-IP (60 POST/min) to slow
 * down brute force of leaked tokens and abuse of the public surface.
 */

// In-memory token buckets. Process-local — sufficient as a first-line guard
// because Vercel functions typically pin warm instances. Real durable rate
// limiting (Upstash etc.) is tracked separately.
type Bucket = { count: number; resetAt: number };
const tokenBuckets = new Map<string, Bucket>();
const ipBuckets = new Map<string, Bucket>();
const PER_TOKEN_LIMIT = 10;
const PER_IP_LIMIT = 60;
const WINDOW_MS = 60_000;

export function __resetRsvpRateLimitForTesting() {
  tokenBuckets.clear();
  ipBuckets.clear();
}

function checkBucket(map: Map<string, Bucket>, key: string, limit: number): boolean {
  const now = Date.now();
  const bucket = map.get(key);
  if (!bucket || bucket.resetAt <= now) {
    map.set(key, { count: 1, resetAt: now + WINDOW_MS });
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

function rateLimited() {
  return NextResponse.json(
    { ok: false, error: "Too many requests" },
    { status: 429, headers: { "Retry-After": "60" } },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // Rate limit BEFORE doing any DB work or schema parsing — both buckets
  // must allow this request.
  const ip = getClientIp(request);
  if (!checkBucket(ipBuckets, ip, PER_IP_LIMIT)) {
    return rateLimited();
  }
  if (!checkBucket(tokenBuckets, token, PER_TOKEN_LIMIT)) {
    return rateLimited();
  }

  let payload: unknown;
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      payload = await request.json();
    } else {
      const form = await request.formData();
      payload = Object.fromEntries(form.entries());
    }
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body" },
      { status: 400 },
    );
  }

  const obj = (payload ?? {}) as Record<string, unknown>;
  // `days` may arrive as a JSON array, a comma-separated string (form-encoded),
  // or as repeated `days=` keys (FormData collapses those into the last one
  // unless we read getAll, but Object.fromEntries already won't catch the
  // repeated case — JSON is the supported path for arrays).
  let days: string[] | undefined;
  const rawDays = obj.days;
  if (Array.isArray(rawDays)) {
    days = rawDays.filter((s): s is string => typeof s === "string");
  } else if (typeof rawDays === "string" && rawDays.length > 0) {
    days = rawDays.split(",").map((s) => s.trim()).filter(Boolean);
  }
  const candidate: RsvpSubmitInput = {
    token,
    action: (obj.action as RsvpSubmitInput["action"]) ?? "accept",
    note:
      typeof obj.note === "string" && obj.note.length > 0
        ? (obj.note as string)
        : null,
    days,
  };

  const parsed = rsvpSubmitSchema.safeParse(candidate);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid submission",
      },
      { status: 400 },
    );
  }

  // Catch any uncaught exception from the implementation so we never leak a
  // raw Postgres/Supabase message to the public consumer (M6).
  try {
    const result = await submitRsvpResponse(parsed.data);
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[rsvp:submit] uncaught error:", msg);
    return NextResponse.json(
      { ok: false, error: "Could not process your response. Please try again." },
      { status: 500 },
    );
  }
}
