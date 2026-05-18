/**
 * Heuristics shared by the xlsx event importer (server action) and any
 * tests / preview UI. Kept in a plain module (not a "use server" file) so we
 * can export pure synchronous helpers.
 */

/**
 * Map a free-form xlsx title to an `events.event_type` bucket. Ordered
 * keyword table — first match wins. The value is informational (used for
 * filters / icons) so a few mis-categorisations are fine; the owner can edit
 * per-event after import.
 */
export function guessEventType(title: string): string {
  const t = title.toLowerCase();
  if (/\brace\b|enduro|nascar|imsa|porsche/.test(t)) return "race";
  if (/school|hpde|libre|test\s*&\s*tune|t\s*&\s*t/.test(t)) return "school";
  if (/club|cc\b|pro6|pca|drive\s*teq|bmw|6th gear|6 gear/.test(t))
    return "track_day";
  if (/movie|camera|film|shoot/.test(t)) return "production";
  if (/music|concert|festival/.test(t)) return "event";
  if (/cancel/.test(t)) return "cancelled";
  return "other";
}
