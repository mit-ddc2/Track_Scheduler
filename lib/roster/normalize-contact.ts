import {
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

export type NormalizedPhone = {
  /** E.164 form like `+16135550142`, or the raw input if invalid. */
  e164: string;
  /** Human-readable national/international format, falls back to raw on failure. */
  formatted: string;
  /** Whether libphonenumber-js considers the input a possible/valid number. */
  valid: boolean;
};

/**
 * Normalize a phone number string into E.164 form.
 *
 * Behavior:
 * - Empty / whitespace-only input → `{ e164: "", formatted: "", valid: false }`.
 * - Input starting with `+` is parsed as an international number regardless of `countryDefault`.
 * - Otherwise `countryDefault` (defaults to `CA`) is used for national-format inputs.
 * - Common formatting (spaces, dashes, parens, dots) is tolerated.
 * - If parsing fails, returns the trimmed input verbatim with `valid: false` so the
 *   caller can preserve the user's text while flagging the problem.
 */
export function normalizePhone(
  raw: string,
  countryDefault: CountryCode = "CA",
): NormalizedPhone {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    return { e164: "", formatted: "", valid: false };
  }

  try {
    const parsed = parsePhoneNumberFromString(trimmed, countryDefault);
    if (!parsed) {
      return { e164: trimmed, formatted: trimmed, valid: false };
    }
    const valid = parsed.isValid();
    return {
      e164: parsed.number,
      formatted: parsed.formatInternational(),
      valid,
    };
  } catch {
    return { e164: trimmed, formatted: trimmed, valid: false };
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Lowercase + trim an email address. Returns empty string for empty input.
 * Validation is not performed here — callers should pair this with `isValidEmail`
 * or a Zod schema if they need to reject malformed values.
 */
export function normalizeEmail(raw: string): string {
  return (raw ?? "").trim().toLowerCase();
}

export function isValidEmail(raw: string): boolean {
  const normalized = normalizeEmail(raw);
  if (!normalized) return false;
  return EMAIL_RE.test(normalized);
}

/**
 * Deterministic dedupe key combining channel + the normalized value.
 * Keys are case-insensitive and whitespace-stripped so two inputs that
 * normalize to the same logical address collide.
 */
export function contactDedupeKey(
  channel: "sms" | "email",
  normalized: string,
): string {
  return `${channel}:${(normalized ?? "").trim().toLowerCase()}`;
}
