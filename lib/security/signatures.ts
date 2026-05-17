// server-only: webhook + cron signature verification.
if (typeof window !== "undefined") {
  throw new Error("lib/security/signatures.ts is server-only");
}

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison of two strings. Handles unequal lengths safely.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    // still consume time on a same-length compare so attackers can't time
    // the length check meaningfully.
    timingSafeEqual(aBuf, Buffer.alloc(aBuf.length));
    return false;
  }
  try {
    return timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

// ─── Twilio ──────────────────────────────────────────────────────
// Algorithm: HMAC-SHA1 over (url + sortedKey1value1 + sortedKey2value2 + …),
// base64-encoded. See https://www.twilio.com/docs/usage/security
// We implement it ourselves so the verifier works in any runtime.
//
// REPLAY-WINDOW LIMITATION (SECURITY_AUDIT.md M2):
// Twilio's v1 signature scheme does NOT include a timestamp header, so we
// have no signed `iat`/`exp` to validate freshness against. As a result, a
// captured signed request can be replayed indefinitely against this verifier.
// Mitigations that DO live elsewhere in the codebase:
//   - status-callback events are upserted into `message_events` keyed on
//     (provider, provider_message_id, event_type) so duplicates are no-ops.
//   - inbound STOP/HELP/START side-effects in `processTwilioInbound` are
//     NOT yet idempotent — see provider-webhooks.ts. The recommended hard
//     fix is a UNIQUE INDEX on (provider, provider_message_id) for inbound
//     events so a replayed POST trips a 23505 in `message_events`.
//   - If a Twilio webhook replay is suspected (or `TWILIO_AUTH_TOKEN` is
//     ever exposed in logs, a bug report, a cached deploy URL, etc.):
//     ROTATE `TWILIO_AUTH_TOKEN` in the Twilio console immediately and
//     update the Vercel env var. Old signatures become invalid the moment
//     the auth token is rotated.

type VerifyTwilioInput = {
  signature: string | null | undefined;
  url: string;
  params: Record<string, string> | URLSearchParams | null | undefined;
  authToken: string;
};

export function computeTwilioSignature({
  url,
  params,
  authToken,
}: Omit<VerifyTwilioInput, "signature">): string {
  const entries = paramEntries(params);
  // Sort keys alphabetically, concatenate "key" + "value" with no separator.
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  let data = url;
  for (const [k, v] of entries) data += k + v;
  return createHmac("sha1", authToken).update(data).digest("base64");
}

export function verifyTwilioSignature(input: VerifyTwilioInput): boolean {
  if (!input.signature || !input.authToken) return false;
  const expected = computeTwilioSignature(input);
  return constantTimeEqual(expected, input.signature);
}

function paramEntries(
  params: Record<string, string> | URLSearchParams | null | undefined,
): Array<[string, string]> {
  if (!params) return [];
  if (params instanceof URLSearchParams) {
    const out: Array<[string, string]> = [];
    for (const [k, v] of params.entries()) out.push([k, v]);
    return out;
  }
  return Object.entries(params).map(([k, v]) => [k, String(v ?? "")]);
}

// ─── Resend (Svix-format webhooks) ───────────────────────────────
// Resend uses Svix for webhook signing:
//   svix-id, svix-timestamp, svix-signature headers
//   signed string = `${id}.${timestamp}.${payload}`
//   secret format = "whsec_<base64>"; HMAC-SHA256, base64 of the digest.
//   svix-signature is space-separated list of "v1,<b64>" entries.

type VerifyResendInput = {
  signature: string | null | undefined; // raw svix-signature header
  svixId: string | null | undefined;
  svixTimestamp: string | null | undefined;
  payload: string; // exact raw body
  secret: string; // e.g. whsec_xxx (or raw base64)
  toleranceSeconds?: number; // default 5 minutes
};

export function verifyResendSignature(input: VerifyResendInput): boolean {
  if (!input.signature || !input.svixId || !input.svixTimestamp) return false;
  if (!input.secret) return false;

  // Reject stale/future timestamps to limit replay risk.
  const tolerance = input.toleranceSeconds ?? 5 * 60;
  const ts = Number(input.svixTimestamp);
  if (!Number.isFinite(ts)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > tolerance) return false;

  // Strip optional "whsec_" prefix, then decode base64 to get the key bytes.
  const rawSecret = input.secret.startsWith("whsec_")
    ? input.secret.slice("whsec_".length)
    : input.secret;
  let keyBytes: Buffer;
  try {
    keyBytes = Buffer.from(rawSecret, "base64");
  } catch {
    return false;
  }
  if (keyBytes.length === 0) return false;

  const signedString = `${input.svixId}.${input.svixTimestamp}.${input.payload}`;
  const expected = createHmac("sha256", keyBytes)
    .update(signedString)
    .digest("base64");

  // Header is "v1,<b64> v1,<b64> v2,<b64>" — accept any v1 entry that matches.
  const parts = input.signature.split(" ");
  for (const part of parts) {
    const [version, candidate] = part.split(",", 2);
    if (version !== "v1" || !candidate) continue;
    if (constantTimeEqual(expected, candidate)) return true;
  }
  return false;
}

// ─── Cron secret ─────────────────────────────────────────────────
export function verifyCronSecret(authHeader: string | null | undefined): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // Refuse to run if CRON_SECRET is missing — fail closed.
    return false;
  }
  if (!authHeader) return false;
  const prefix = "Bearer ";
  if (!authHeader.startsWith(prefix)) return false;
  const presented = authHeader.slice(prefix.length).trim();
  return constantTimeEqual(presented, expected);
}
