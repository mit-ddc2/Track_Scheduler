/**
 * Pure parser for Robert's "Booking_<year>_v<MM_DD>.xlsx" planning file.
 *
 * The workbook has one sheet per month (case-inconsistent: `MAY`, `June`,
 * `July`, `Aug`, `Sept`, `OCT`). Each per-month sheet has a header row 1, a
 * month-label row 2, and data rows starting at row 3 with columns:
 *
 *   A = day-of-week ("Friday")  - blank on continuation rows
 *   B = day-of-month (1-31)
 *   C = Venue (e.g. "CTMP", "Calabogie", "SH KART", "SHANNONVILLE")
 *   D = Event name (e.g. "PORSCHE CLUB RACE")
 *   E/F/G/H = Staff names (informational; counted for required_headcount)
 *
 * The July tab is offset by two columns (venue at E, event at F, staff at
 * G+). We detect that by inspecting the header row.
 *
 * Multi-day grouping: consecutive dates with the same (venue, eventName) on
 * the same month sheet collapse into one event whose `requiredHeadcount` is
 * the MAX number of filled staff cells across the days.
 *
 * Continuation rows (no day-of-week in col A) belong to the previously seen
 * date on the sheet — they introduce a separate event entry on that same day.
 *
 * Rows with no event name are dropped. Rows whose event name normalizes to a
 * placeholder ("TBC", "cancelled", "?", etc.) are kept but flagged
 * `needsReview = true`.
 */

import * as XLSX from "xlsx";

export type ParsedEvent = {
  /** Cleaned event name (or "Untitled" for placeholder rows). */
  title: string;
  venue: string;
  /** YYYY-MM-DD (local-civil, no timezone). */
  startDate: string;
  /** YYYY-MM-DD (local-civil, no timezone). */
  endDate: string;
  /** Distinct, trimmed staff names seen across all days (for future matching). */
  sourceStaffNames: string[];
  /** Max count of non-empty staff cells across the event's days. */
  requiredHeadcount: number;
  /** Sheet name this event was parsed from (e.g. "MAY"). */
  sourceMonth: string;
  /** 1-indexed row numbers in the source sheet (matches Excel's row labels). */
  sourceRows: number[];
  /** Empty / placeholder titles get this flag for the preview UI. */
  needsReview: boolean;
};

export type ParseEventsOptions = {
  /**
   * Override sheet names to scan. By default we look for the canonical
   * May–Oct tabs in any casing. Pass an array of exact sheet names to limit.
   */
  months?: string[];
  /**
   * Calendar year for the dates. The xlsx itself only carries day-of-month
   * in column B, so we need a year hint. Defaults to 2026 (the current
   * booking file).
   */
  year?: number;
};

/** Canonical month name → JS month index (0-11) and # of days in 2026. */
const MONTH_BY_TAB_PREFIX: Record<string, { monthIndex: number; days: number }> = {
  JAN: { monthIndex: 0, days: 31 },
  FEB: { monthIndex: 1, days: 28 },
  MAR: { monthIndex: 2, days: 31 },
  APR: { monthIndex: 3, days: 30 },
  MAY: { monthIndex: 4, days: 31 },
  JUN: { monthIndex: 5, days: 30 },
  JUL: { monthIndex: 6, days: 31 },
  AUG: { monthIndex: 7, days: 31 },
  SEP: { monthIndex: 8, days: 30 },
  OCT: { monthIndex: 9, days: 31 },
  NOV: { monthIndex: 10, days: 30 },
  DEC: { monthIndex: 11, days: 31 },
};

const DEFAULT_MONTHS = ["MAY", "June", "July", "Aug", "Sept", "OCT"];

/** Placeholder event names that should set `needsReview`. */
const REVIEW_TITLE_PATTERN = /^(tbc|tba|tbd|cancelled|\?+|x+|n\/a)$/i;

type SheetLayout = {
  venueCol: number;
  eventCol: number;
  /** First column index where staff names start. */
  staffStartCol: number;
  /** Last (inclusive) column index for staff names. Defaults to row length. */
  staffEndCol?: number;
};

type RowBundle = {
  rowNumber: number; // 1-indexed source row
  date: string; // YYYY-MM-DD
  venue: string;
  title: string;
  rawTitle: string;
  staff: string[]; // non-empty trimmed staff strings
};

/** Public entrypoint. */
export function parseEventsXlsx(
  source: ArrayBuffer | Buffer | Uint8Array,
  opts: ParseEventsOptions = {},
): ParsedEvent[] {
  const year = opts.year ?? 2026;
  const wb = readWorkbook(source);

  const wantMonths = (opts.months ?? DEFAULT_MONTHS).map((m) => m.toLowerCase());
  const sheetNames = wb.SheetNames.filter((n) =>
    wantMonths.includes(n.toLowerCase()),
  );

  const all: ParsedEvent[] = [];
  for (const sheetName of sheetNames) {
    const monthInfo = lookupMonthMeta(sheetName);
    if (!monthInfo) continue;
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: "",
      blankrows: false,
    });
    const layout = detectLayout(rows);
    const bundles = extractRowBundles(rows, layout, year, monthInfo, sheetName);
    const grouped = groupBundles(bundles, sheetName);
    all.push(...grouped);
  }

  return all;
}

function readWorkbook(source: ArrayBuffer | Buffer | Uint8Array): XLSX.WorkBook {
  if (source instanceof ArrayBuffer) {
    return XLSX.read(new Uint8Array(source), { type: "array" });
  }
  if (source instanceof Uint8Array) {
    return XLSX.read(source, { type: "array" });
  }
  return XLSX.read(source, { type: "buffer" });
}

function lookupMonthMeta(sheetName: string): { monthIndex: number; days: number } | null {
  const key = sheetName.slice(0, 3).toUpperCase();
  return MONTH_BY_TAB_PREFIX[key] ?? null;
}

/**
 * Look at the header row(s) to find which columns hold Venue / Event. Most
 * tabs put them at C/D (indexes 2/3); July offsets them to E/F (indexes 4/5).
 */
function detectLayout(rows: unknown[][]): SheetLayout {
  const header = (rows[0] ?? []).map((c) => stringify(c).toLowerCase());
  let venueCol = -1;
  let eventCol = -1;
  for (let i = 0; i < header.length; i++) {
    const h = header[i];
    if (venueCol === -1 && h === "venue") venueCol = i;
    if (eventCol === -1 && h === "event") eventCol = i;
  }
  if (venueCol === -1 || eventCol === -1) {
    // Fall back to the canonical layout used by May/Aug/etc.
    venueCol = 2;
    eventCol = 3;
  }
  // Staff columns start one cell after the event column and run to the end.
  const staffStartCol = eventCol + 1;
  return { venueCol, eventCol, staffStartCol };
}

function extractRowBundles(
  rows: unknown[][],
  layout: SheetLayout,
  year: number,
  monthInfo: { monthIndex: number; days: number },
  sheetName: string,
): RowBundle[] {
  const bundles: RowBundle[] = [];
  let lastDate: string | null = null;
  let lastDayOfMonth: number | null = null;

  // Skip the header row (0) and the month-label row (1).
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const dayCell = row[1];
    const dayOfMonth = parseDayOfMonth(dayCell);
    if (dayOfMonth !== null) {
      // Guard against stray values: must be 1..days_in_month.
      if (dayOfMonth >= 1 && dayOfMonth <= monthInfo.days) {
        lastDate = toIsoDate(year, monthInfo.monthIndex, dayOfMonth);
        lastDayOfMonth = dayOfMonth;
      }
    }

    const venue = stringify(row[layout.venueCol]).trim();
    const rawTitle = stringify(row[layout.eventCol]).trim();
    const cleanTitle = rawTitle.replace(/\s+/g, " ");

    if (!cleanTitle) continue; // no event on this row
    if (!lastDate || lastDayOfMonth == null) continue; // event before any date

    // Skip rows where the venue label is also blank — without a venue we can't
    // dedupe / group multi-day events.
    if (!venue) {
      // Only allow titled events without venue if the title looks meaningful.
      // We still skip these because they can't be merged across days reliably.
      continue;
    }

    const staffCells = row.slice(layout.staffStartCol);
    const staff = collectStaff(staffCells);

    bundles.push({
      rowNumber: i + 1, // Excel rows are 1-indexed
      date: lastDate,
      venue,
      title: cleanTitle,
      rawTitle,
      staff,
    });
  }
  void sheetName; // reserved for future per-month overrides
  return bundles;
}

function collectStaff(cells: unknown[]): string[] {
  const out: string[] = [];
  for (const c of cells) {
    const s = stringify(c).trim();
    if (!s) continue;
    // Filter out obvious sentinels in staff columns ("x", "?", placeholders).
    if (/^[x?\-—]+$/i.test(s)) continue;
    out.push(s);
  }
  return out;
}

/**
 * Collapse consecutive same-(venue,title) rows on consecutive dates into a
 * single ParsedEvent. Comparison is normalized (case + whitespace
 * insensitive). Returned events preserve sheet order.
 */
function groupBundles(bundles: RowBundle[], sourceMonth: string): ParsedEvent[] {
  type Pending = {
    title: string;
    venue: string;
    startDate: string;
    endDate: string;
    rowNumbers: number[];
    headcountByDate: Map<string, number>;
    staffNames: Set<string>;
    needsReview: boolean;
  };

  /** Most recent open group per (venue|title) key. */
  const openByKey = new Map<string, Pending>();
  /** Completed groups, ordered by first appearance. */
  const finalized: Pending[] = [];
  /** Stack of all groups (open + finalized) in insertion order, for re-keying. */

  const finalize = (key: string) => {
    const grp = openByKey.get(key);
    if (grp) {
      finalized.push(grp);
      openByKey.delete(key);
    }
  };

  for (const b of bundles) {
    const key = `${normalize(b.venue)}|${normalize(b.title)}`;
    const needsReview = REVIEW_TITLE_PATTERN.test(b.title.trim());
    const open = openByKey.get(key);

    if (open && (b.date === open.endDate || isNextDay(open.endDate, b.date))) {
      // Same-day duplicate row OR next consecutive day — extend.
      if (b.date !== open.endDate) open.endDate = b.date;
      open.rowNumbers.push(b.rowNumber);
      open.headcountByDate.set(
        b.date,
        Math.max(open.headcountByDate.get(b.date) ?? 0, b.staff.length),
      );
      for (const n of b.staff) open.staffNames.add(n);
      if (needsReview) open.needsReview = true;
      continue;
    }

    // Gap or new key — finalize any prior open group for this key.
    if (open) finalize(key);

    openByKey.set(key, {
      title: b.title,
      venue: b.venue,
      startDate: b.date,
      endDate: b.date,
      rowNumbers: [b.rowNumber],
      headcountByDate: new Map([[b.date, b.staff.length]]),
      staffNames: new Set(b.staff),
      needsReview,
    });
  }

  // Finalize any remaining open groups.
  for (const key of Array.from(openByKey.keys())) finalize(key);

  // Sort by first source row so output mirrors the sheet order.
  finalized.sort((a, b) => a.rowNumbers[0] - b.rowNumbers[0]);

  return finalized.map((cur) => {
    let max = 0;
    for (const v of cur.headcountByDate.values()) {
      if (v > max) max = v;
    }
    return {
      title: cur.title || "Untitled",
      venue: cur.venue,
      startDate: cur.startDate,
      endDate: cur.endDate,
      sourceStaffNames: Array.from(cur.staffNames),
      requiredHeadcount: max,
      sourceMonth,
      sourceRows: cur.rowNumbers,
      needsReview: cur.needsReview,
    } satisfies ParsedEvent;
  });
}

// ─── helpers ─────────────────────────────────────────────────────────────

function stringify(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "true" : "";
  return String(v);
}

function parseDayOfMonth(v: unknown): number | null {
  if (typeof v === "number") {
    return Number.isInteger(v) ? v : null;
  }
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isInteger(n) ? n : null;
  }
  return null;
}

function toIsoDate(year: number, monthIndex: number, day: number): string {
  const mm = String(monthIndex + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function isNextDay(prev: string, next: string): boolean {
  // Compare as Date in UTC to avoid TZ skew.
  const pd = isoDateToUtc(prev);
  const nd = isoDateToUtc(next);
  if (!pd || !nd) return false;
  const diff = (nd - pd) / 86_400_000;
  return diff === 0 || diff === 1;
}

function isoDateToUtc(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}
