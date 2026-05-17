// server-only: never import from a Client Component / browser bundle.
if (typeof window !== "undefined") {
  throw new Error("lib/security/token.ts is server-only");
}

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Length (in raw bytes) of the random token component. Spec §12.3. */
export const RSVP_TOKEN_BYTES = 32;

/**
 * Read APP_SECRET_PEPPER. Throws if missing — RSVP tokens MUST be peppered
 * before hashing so a database leak cannot be used to forge tokens.
 */
function readPepper(): string {
  const pepper = process.env.APP_SECRET_PEPPER;
  if (!pepper || pepper.length === 0) {
    throw new Error(
      "Missing APP_SECRET_PEPPER env var — required for RSVP token security.",
    );
  }
  return pepper;
}

/** URL-safe base64: replace `+/` with `-_` and strip padding. */
function toUrlSafeBase64(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/**
 * Generate a fresh RSVP token. The `raw` half goes into the SMS/email link
 * the responder receives. The `hash` half is what gets stored in
 * `rsvp_tokens.token_hash` — we never persist the raw value.
 */
export function generateRsvpToken(): { raw: string; hash: string } {
  const raw = toUrlSafeBase64(randomBytes(RSVP_TOKEN_BYTES));
  const hash = hashRsvpToken(raw);
  return { raw, hash };
}

/** Deterministic salted SHA-256 used both at issue time and at verification. */
export function hashRsvpToken(raw: string): string {
  const pepper = readPepper();
  return createHash("sha256").update(raw).update(pepper).digest("hex");
}

/**
 * Constant-time comparison of a raw token against a stored hash. Returns
 * false if lengths differ or if the timing-safe compare disagrees.
 */
export function verifyRsvpToken(raw: string, storedHash: string): boolean {
  if (typeof raw !== "string" || typeof storedHash !== "string") return false;
  let candidate: string;
  try {
    candidate = hashRsvpToken(raw);
  } catch {
    return false;
  }
  if (candidate.length !== storedHash.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(candidate, "utf8"),
      Buffer.from(storedHash, "utf8"),
    );
  } catch {
    return false;
  }
}
