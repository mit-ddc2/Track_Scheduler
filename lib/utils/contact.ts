/**
 * Shared helper for the safety-manager contact card on RSVP pages.
 *
 * Reads the optional `OWNER_CONTACT_PHONE` env var; if unset, falls back to a
 * generic "call the safety manager" message so the link still renders without
 * leaking a hard-coded placeholder number into production.
 *
 * Returns a pair of fields so the caller can format whichever variant it
 * needs (button label vs. anchor `tel:` href).
 */
export type OwnerContact = {
  /** E.164 phone string (or null when the env var is unset). */
  phone: string | null;
  /** Display label, e.g. "+1 613-555-0142" or fallback copy. */
  label: string;
  /** Value safe to embed in a `tel:` href (empty string when no phone). */
  href: string;
};

export function getOwnerContact(): OwnerContact {
  const raw = (process.env.OWNER_CONTACT_PHONE ?? "").trim();
  if (!raw) {
    return {
      phone: null,
      label: "Call the safety manager",
      href: "",
    };
  }
  // Strip any spaces/dashes for the tel: href but keep them in the label.
  const href = raw.replace(/[^\d+]/g, "");
  return { phone: raw, label: raw, href };
}
