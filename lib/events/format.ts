/**
 * Date + time formatters tuned to America/Toronto by default. Uses
 * date-fns-tz so we render every UI string in the event's timezone, not the
 * server/browser locale.
 */

import { formatInTimeZone } from "date-fns-tz";

const DEFAULT_TZ = "America/Toronto";

function toDate(input: Date | string): Date {
  return input instanceof Date ? input : new Date(input);
}

/**
 * Render a (possibly multi-day) event date range.
 *   single day  → "Sat · May 23"
 *   same month  → "Sat-Sun · May 23-24"
 *   cross month → "Sat May 31 – Sun Jun 1"
 */
export function formatEventDate(
  start: Date | string,
  end: Date | string,
  tz: string = DEFAULT_TZ,
): string {
  const s = toDate(start);
  const e = toDate(end);

  const sameYear =
    formatInTimeZone(s, tz, "yyyy") === formatInTimeZone(e, tz, "yyyy");
  const sameMonth =
    sameYear && formatInTimeZone(s, tz, "MM") === formatInTimeZone(e, tz, "MM");
  const sameDay =
    sameMonth && formatInTimeZone(s, tz, "dd") === formatInTimeZone(e, tz, "dd");

  if (sameDay) {
    return formatInTimeZone(s, tz, "EEE · MMM d");
  }

  if (sameMonth) {
    const dow = `${formatInTimeZone(s, tz, "EEE")}-${formatInTimeZone(e, tz, "EEE")}`;
    const month = formatInTimeZone(s, tz, "MMM");
    const days = `${formatInTimeZone(s, tz, "d")}-${formatInTimeZone(e, tz, "d")}`;
    return `${dow} · ${month} ${days}`;
  }

  const left = formatInTimeZone(s, tz, "EEE MMM d");
  const right = sameYear
    ? formatInTimeZone(e, tz, "EEE MMM d")
    : formatInTimeZone(e, tz, "EEE MMM d, yyyy");
  return `${left} – ${right}`;
}

/** "07:30 – 17:00" — 24h, always in the event's tz. */
export function formatTimeRange(
  start: Date | string,
  end: Date | string,
  tz: string = DEFAULT_TZ,
): string {
  const s = toDate(start);
  const e = toDate(end);
  return `${formatInTimeZone(s, tz, "HH:mm")} – ${formatInTimeZone(e, tz, "HH:mm")}`;
}

/**
 * Calendar days between `now` and event start, evaluated in the event tz.
 * Negative numbers mean the event already started/ended.
 *
 * We compare on the calendar date string (yyyy-MM-dd) in `tz` rather than
 * normalising the moments to "midnight in tz" — date-fns-tz reports the
 * offset of the supplied instant, not of midnight that day, which produces
 * off-by-one diffs across DST transitions (spring-forward/fall-back) and
 * around the year boundary.
 */
export function daysOut(
  start: Date | string,
  now: Date = new Date(),
  tz: string = DEFAULT_TZ,
): number {
  const s = toDate(start);
  // UTC midnight for the calendar date as seen in `tz`. Subtracting two
  // such moments and dividing by ms-per-day gives the calendar-day delta
  // safely across DST + year boundaries.
  const startMs = Date.UTC(
    Number(formatInTimeZone(s, tz, "yyyy")),
    Number(formatInTimeZone(s, tz, "MM")) - 1,
    Number(formatInTimeZone(s, tz, "dd")),
  );
  const nowMs = Date.UTC(
    Number(formatInTimeZone(now, tz, "yyyy")),
    Number(formatInTimeZone(now, tz, "MM")) - 1,
    Number(formatInTimeZone(now, tz, "dd")),
  );
  return Math.round((startMs - nowMs) / 86_400_000);
}

/** Short month + week-of-year eyebrow ("May · Week 21"). */
export function monthWeekEyebrow(
  date: Date = new Date(),
  tz: string = DEFAULT_TZ,
): string {
  const month = formatInTimeZone(date, tz, "MMMM");
  const week = formatInTimeZone(date, tz, "w");
  return `${month} · Week ${week}`;
}

/** ISO date suitable for the <input type="datetime-local"> value attribute. */
export function toDateTimeLocal(
  input: Date | string,
  tz: string = DEFAULT_TZ,
): string {
  const d = toDate(input);
  return formatInTimeZone(d, tz, "yyyy-MM-dd'T'HH:mm");
}

/**
 * Short, human-scannable code derived from an event id. Used in lists and
 * detail headers so an event can be referenced verbally / over text.
 * Example: `7f3d…` → `EV-7F3D`.
 */
export function shortCode(id: string): string {
  return `EV-${id.slice(0, 4).toUpperCase()}`;
}
