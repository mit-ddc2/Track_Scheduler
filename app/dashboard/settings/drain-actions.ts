"use server";

/**
 * "Drain queued messages now" server action (v2 Wave B3).
 *
 * Vercel Hobby cron only runs once per day, but Robert wants to be able to
 * shake the outbox loose right after he hits "Send invites" or "Cancel
 * event". The action POSTs to the existing `/api/jobs/drain-outbox` route
 * with the server-side `CRON_SECRET` so the same auth/rate-limit/re-entrancy
 * guard logic in the route handler applies.
 *
 * Owner-only — `requireOwner()` throws/redirects for everyone else.
 */

import { requireOwner } from "@/lib/auth/require-owner";

export type DrainNowResult = {
  ok: true;
  attempted: number;
  sent: number;
  failed: number;
  suppressed: number;
} | {
  ok: false;
  error: string;
};

function resolveBaseUrl(): string {
  // Prefer the canonical app base URL. Vercel sets VERCEL_URL on every env.
  const explicit = process.env.APP_BASE_URL;
  if (explicit && explicit.length > 0) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_URL;
  if (vercel && vercel.length > 0) {
    return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  }
  // Local dev fallback.
  return "http://localhost:3000";
}

export async function triggerDrainNow(): Promise<DrainNowResult> {
  await requireOwner();

  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length === 0) {
    return {
      ok: false,
      error: "CRON_SECRET is not configured on the server.",
    };
  }

  const base = resolveBaseUrl();
  const url = `${base}/api/jobs/drain-outbox`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secret}`,
      },
      cache: "no-store",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Drain request failed: ${msg}` };
  }

  type DrainBody = {
    attempted?: number;
    sent?: number;
    failed?: number;
    suppressed?: number;
    error?: string;
    message?: string;
  };
  const body = (await res.json().catch(() => ({}))) as DrainBody;

  if (!res.ok) {
    const detail = body.message ?? body.error ?? `HTTP ${res.status}`;
    return { ok: false, error: detail };
  }

  return {
    ok: true,
    attempted: typeof body.attempted === "number" ? body.attempted : 0,
    sent: typeof body.sent === "number" ? body.sent : 0,
    failed: typeof body.failed === "number" ? body.failed : 0,
    suppressed: typeof body.suppressed === "number" ? body.suppressed : 0,
  };
}
