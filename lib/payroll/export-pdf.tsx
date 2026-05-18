/**
 * Date-range payroll PDF export (Wave A3 / spec §7).
 *
 * Robert prints these and hands them to payroll, so the layout is tuned for
 * black-and-white letter paper rather than dashboard pixel density: portrait
 * orientation, monospace tabular numbers, Pit Wall accent red only for headers
 * (it still photocopies as a dark grey when the printer is monochrome).
 *
 * The function is intentionally pure: it accepts already-loaded `PdfRow`s and
 * returns the PDF bytes. The route handler does auth, audit logging, and
 * Supabase fetches — keeps this module trivial to unit-test.
 */

import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";

import type { AttendanceStatus } from "@/lib/db/types";

// ─── Public shape ────────────────────────────────────────────────────────

export type PdfStaffEntry = {
  displayName: string;
  status: AttendanceStatus;
  actualHours: number | null;
  payRate: number | null;
  totalPay: number;
};

export type PdfDay = {
  /** ISO date (`YYYY-MM-DD`) for this column. */
  date: string;
  staffEntries: PdfStaffEntry[];
};

export type PdfRow = {
  eventId: string;
  eventTitle: string;
  venue: string | null;
  /** ISO date (`YYYY-MM-DD`) for the first day of the event. */
  eventStartDate: string;
  /** ISO date (`YYYY-MM-DD`) for the last day of the event. */
  eventEndDate: string;
  days: PdfDay[];
};

export type BuildPdfOptions = {
  /** ISO date (`YYYY-MM-DD`). */
  from: string;
  /** ISO date (`YYYY-MM-DD`). */
  to: string;
  /** Defaults to `new Date()`. Injectable for deterministic tests. */
  generatedAt?: Date;
};

// ─── Status iconography ──────────────────────────────────────────────────
// Plain ASCII so any printer renders the glyphs without font fallback drama.

export const STATUS_ICON: Record<AttendanceStatus, string> = {
  worked: "Y",
  scheduled: "-",
  no_show: "X",
  cancelled_by_member: "C",
  cancelled_by_manager: "C",
  excused: "E",
};

export const STATUS_LABEL: Record<AttendanceStatus, string> = {
  worked: "Worked",
  scheduled: "Scheduled",
  no_show: "No-show",
  cancelled_by_member: "Cancelled (member)",
  cancelled_by_manager: "Cancelled (manager)",
  excused: "Excused",
};

const WORKED_STATUSES: ReadonlySet<AttendanceStatus> = new Set(["worked"]);

// ─── Style sheet ─────────────────────────────────────────────────────────
// Pit Wall day-theme palette tuned for paper: white bg, near-black text,
// accent red only on headers/eyebrows. Keep colours dark enough to survive
// a B/W laser print.

const PIT_WALL_RED = "#cf2031";
const INK = "#111111";
const MUTED = "#555555";
const HAIRLINE = "#bbbbbb";

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 48,
    paddingHorizontal: 36,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: INK,
    backgroundColor: "#ffffff",
  },
  reportHeader: {
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: PIT_WALL_RED,
    paddingBottom: 6,
  },
  reportTitle: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: PIT_WALL_RED,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  reportMeta: {
    fontSize: 9,
    color: MUTED,
    marginTop: 4,
    fontFamily: "Courier",
  },
  eventBlock: {
    marginBottom: 18,
  },
  eventTitle: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: INK,
  },
  eventMeta: {
    fontSize: 10,
    color: MUTED,
    marginTop: 2,
    marginBottom: 8,
    fontFamily: "Helvetica",
  },
  table: {
    borderWidth: 1,
    borderColor: HAIRLINE,
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
  },
  rowLast: {
    flexDirection: "row",
  },
  headerCell: {
    paddingVertical: 4,
    paddingHorizontal: 6,
    backgroundColor: "#f4f4f4",
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: INK,
    borderRightWidth: 1,
    borderRightColor: HAIRLINE,
  },
  headerCellLast: {
    paddingVertical: 4,
    paddingHorizontal: 6,
    backgroundColor: "#f4f4f4",
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: INK,
  },
  cell: {
    paddingVertical: 4,
    paddingHorizontal: 6,
    fontSize: 9,
    fontFamily: "Courier",
    borderRightWidth: 1,
    borderRightColor: HAIRLINE,
  },
  cellLast: {
    paddingVertical: 4,
    paddingHorizontal: 6,
    fontSize: 9,
    fontFamily: "Courier",
  },
  staffCell: {
    fontFamily: "Helvetica",
  },
  footerCell: {
    paddingVertical: 4,
    paddingHorizontal: 6,
    backgroundColor: "#f4f4f4",
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: INK,
    borderRightWidth: 1,
    borderRightColor: HAIRLINE,
  },
  footerCellLast: {
    paddingVertical: 4,
    paddingHorizontal: 6,
    backgroundColor: "#f4f4f4",
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: INK,
  },
  emptyNote: {
    fontSize: 11,
    color: MUTED,
    marginTop: 24,
    textAlign: "center",
    fontFamily: "Helvetica",
  },
  summaryTitle: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: PIT_WALL_RED,
    marginBottom: 8,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
  },
  summaryLabel: {
    fontSize: 10,
    fontFamily: "Helvetica",
    color: INK,
  },
  summaryValue: {
    fontSize: 10,
    fontFamily: "Courier",
    color: INK,
  },
  pageFooter: {
    position: "absolute",
    bottom: 20,
    left: 36,
    right: 36,
    fontSize: 8,
    color: MUTED,
    fontFamily: "Courier",
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
    paddingTop: 6,
  },
  legend: {
    fontSize: 8,
    color: MUTED,
    marginTop: 8,
    fontFamily: "Courier",
  },
});

// ─── Helpers ─────────────────────────────────────────────────────────────

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Strict ISO date check — we want to fail loud rather than silently format `Invalid Date`. */
function isIsoDate(value: string): boolean {
  return ISO_DATE_RE.test(value);
}

/**
 * Format `YYYY-MM-DD` as `Sat May 23` without spinning up an Intl formatter
 * per cell. We treat the date as floating (no timezone) — payroll prints them
 * in the operator's local calendar, the same way the operator scheduled them.
 */
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function formatIsoDateShort(iso: string): string {
  if (!isIsoDate(iso)) return iso;
  // Parse as UTC so JS doesn't shift across timezones — we only display
  // the date label, no time arithmetic happens.
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const dow = DOW[d.getUTCDay()];
  const mon = MON[d.getUTCMonth()];
  const day = d.getUTCDate();
  return `${dow} ${mon} ${day}`;
}

export function formatIsoDateLong(iso: string): string {
  if (!isIsoDate(iso)) return iso;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const dow = DOW[d.getUTCDay()];
  const mon = MON[d.getUTCMonth()];
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  return `${dow} ${mon} ${day}, ${year}`;
}

function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatHours(value: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return value.toFixed(1) + "h";
}

/**
 * Validate the requested range. We do this in both the schema (route handler)
 * and here so direct callers (tests, scripts) can't sneak past it.
 */
export function validateRange(from: string, to: string): { ok: true } | { ok: false; error: string } {
  if (!isIsoDate(from)) return { ok: false, error: `Invalid 'from' date: ${from}` };
  if (!isIsoDate(to)) return { ok: false, error: `Invalid 'to' date: ${to}` };
  if (from > to) return { ok: false, error: `'from' (${from}) must be on or before 'to' (${to})` };
  return { ok: true };
}

// ─── Totals ──────────────────────────────────────────────────────────────

export type PdfTotals = {
  eventCount: number;
  staffDaysWorked: number;
  totalActualHours: number;
  totalPayroll: number;
};

export function computeTotals(rows: PdfRow[]): PdfTotals {
  let staffDaysWorked = 0;
  let totalActualHours = 0;
  let totalPayroll = 0;

  for (const row of rows) {
    for (const day of row.days) {
      for (const entry of day.staffEntries) {
        if (WORKED_STATUSES.has(entry.status)) {
          staffDaysWorked += 1;
          if (entry.actualHours !== null && Number.isFinite(entry.actualHours)) {
            totalActualHours += entry.actualHours;
          }
        }
        if (Number.isFinite(entry.totalPay)) {
          totalPayroll += entry.totalPay;
        }
      }
    }
  }

  return {
    eventCount: rows.length,
    staffDaysWorked,
    totalActualHours: Number(totalActualHours.toFixed(2)),
    totalPayroll: Number(totalPayroll.toFixed(2)),
  };
}

// ─── Per-event sub-components ────────────────────────────────────────────

type EventTableProps = {
  row: PdfRow;
};

function EventTable({ row }: EventTableProps) {
  // Collect a stable list of staff who appear in any day of the event,
  // sorted alphabetically. We render one row per staff member; the cell
  // value depends on whether they appear in that day's `staffEntries`.
  const staffNames = new Set<string>();
  for (const day of row.days) {
    for (const entry of day.staffEntries) {
      staffNames.add(entry.displayName);
    }
  }
  const orderedStaff = Array.from(staffNames).sort((a, b) =>
    a.localeCompare(b, "en"),
  );

  // Column widths: the staff column is wider than each day column.
  const dayCount = row.days.length;
  const staffWidthPct = Math.max(28, 40 - dayCount * 2);
  const dayWidthPct = (100 - staffWidthPct) / Math.max(1, dayCount);

  return (
    <View style={styles.eventBlock} wrap={false}>
      <Text style={styles.eventTitle}>{row.eventTitle}</Text>
      <Text style={styles.eventMeta}>
        {row.eventStartDate === row.eventEndDate
          ? formatIsoDateLong(row.eventStartDate)
          : `${formatIsoDateLong(row.eventStartDate)} – ${formatIsoDateLong(row.eventEndDate)}`}
        {row.venue ? `  ·  ${row.venue}` : ""}
      </Text>

      <View style={styles.table}>
        {/* Header row */}
        <View style={styles.row}>
          <Text style={[styles.headerCell, { width: `${staffWidthPct}%` }]}>Staff</Text>
          {row.days.map((day, idx) => {
            const isLast = idx === row.days.length - 1;
            return (
              <Text
                key={day.date}
                style={[
                  isLast ? styles.headerCellLast : styles.headerCell,
                  { width: `${dayWidthPct}%`, textAlign: "center" },
                ]}
              >
                {formatIsoDateShort(day.date)}
              </Text>
            );
          })}
        </View>

        {/* Body rows */}
        {orderedStaff.length === 0 ? (
          <View style={styles.rowLast}>
            <Text style={[styles.cellLast, { width: "100%", color: MUTED }]}>
              No staff assigned.
            </Text>
          </View>
        ) : (
          orderedStaff.map((name, rowIdx) => {
            const isLastRow = rowIdx === orderedStaff.length - 1;
            return (
              <View
                key={name}
                style={isLastRow ? styles.rowLast : styles.row}
              >
                <Text
                  style={[
                    styles.cell,
                    styles.staffCell,
                    { width: `${staffWidthPct}%` },
                  ]}
                >
                  {name}
                </Text>
                {row.days.map((day, idx) => {
                  const isLast = idx === row.days.length - 1;
                  const entry = day.staffEntries.find(
                    (e) => e.displayName === name,
                  );
                  let label = "";
                  if (entry) {
                    const icon = STATUS_ICON[entry.status];
                    const hrs = formatHours(entry.actualHours);
                    label = hrs ? `${icon} ${hrs}` : icon;
                  }
                  return (
                    <Text
                      key={day.date}
                      style={[
                        isLast ? styles.cellLast : styles.cell,
                        { width: `${dayWidthPct}%`, textAlign: "center" },
                      ]}
                    >
                      {label}
                    </Text>
                  );
                })}
              </View>
            );
          })
        )}

        {/* Footer row: per-day worked count */}
        <View
          style={[
            styles.rowLast,
            { borderTopWidth: 1, borderTopColor: HAIRLINE },
          ]}
        >
          <Text style={[styles.footerCell, { width: `${staffWidthPct}%` }]}>
            Worked
          </Text>
          {row.days.map((day, idx) => {
            const isLast = idx === row.days.length - 1;
            const workedCount = day.staffEntries.filter((e) =>
              WORKED_STATUSES.has(e.status),
            ).length;
            return (
              <Text
                key={day.date}
                style={[
                  isLast ? styles.footerCellLast : styles.footerCell,
                  { width: `${dayWidthPct}%`, textAlign: "center" },
                ]}
              >
                {workedCount}
              </Text>
            );
          })}
        </View>
      </View>
    </View>
  );
}

type SummaryPageProps = {
  rows: PdfRow[];
  totals: PdfTotals;
  from: string;
  to: string;
};

function SummaryPage({ rows, totals, from, to }: SummaryPageProps) {
  return (
    <Page size="LETTER" orientation="portrait" style={styles.page} wrap>
      <View style={styles.reportHeader} fixed>
        <Text style={styles.reportTitle}>Payroll Summary</Text>
        <Text style={styles.reportMeta}>
          {formatIsoDateLong(from)} → {formatIsoDateLong(to)}
        </Text>
      </View>

      <View>
        <Text style={styles.summaryTitle}>Totals</Text>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Events in range</Text>
          <Text style={styles.summaryValue}>{totals.eventCount}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Staff-days worked</Text>
          <Text style={styles.summaryValue}>{totals.staffDaysWorked}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Total actual hours</Text>
          <Text style={styles.summaryValue}>{totals.totalActualHours.toFixed(2)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Total payroll (worked × rate)</Text>
          <Text style={styles.summaryValue}>{formatMoney(totals.totalPayroll)}</Text>
        </View>
      </View>

      {rows.length > 0 ? (
        <View style={{ marginTop: 18 }}>
          <Text style={styles.summaryTitle}>By event</Text>
          {rows.map((row) => {
            const evWorked = row.days.reduce(
              (n, d) =>
                n +
                d.staffEntries.filter((e) => WORKED_STATUSES.has(e.status)).length,
              0,
            );
            const evPay = row.days.reduce(
              (sum, d) =>
                sum +
                d.staffEntries.reduce(
                  (s, e) => s + (Number.isFinite(e.totalPay) ? e.totalPay : 0),
                  0,
                ),
              0,
            );
            return (
              <View key={row.eventId} style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>
                  {row.eventTitle}
                  {row.venue ? ` · ${row.venue}` : ""}
                </Text>
                <Text style={styles.summaryValue}>
                  {evWorked} worked · {formatMoney(evPay)}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}

      <Text style={styles.legend}>
        Legend: Y worked · - scheduled · X no-show · C cancelled · E excused
      </Text>

      <View style={styles.pageFooter} fixed>
        <Text>Calabogie Safety · Payroll Export</Text>
        <Text
          render={({ pageNumber, totalPages }) =>
            `Page ${pageNumber} / ${totalPages}`
          }
        />
      </View>
    </Page>
  );
}

// ─── Root document ───────────────────────────────────────────────────────

type RootDocProps = {
  rows: PdfRow[];
  from: string;
  to: string;
  generatedAt: Date;
  totals: PdfTotals;
};

function RootDocument({ rows, from, to, generatedAt, totals }: RootDocProps) {
  const generatedLabel = generatedAt.toISOString().replace("T", " ").slice(0, 19) + " UTC";

  return (
    <Document
      title={`Calabogie Payroll ${from} to ${to}`}
      author="Calabogie Safety"
      creator="Calabogie Safety v2"
      producer="@react-pdf/renderer"
    >
      {rows.length === 0 ? (
        <Page size="LETTER" orientation="portrait" style={styles.page}>
          <View style={styles.reportHeader} fixed>
            <Text style={styles.reportTitle}>Payroll Export</Text>
            <Text style={styles.reportMeta}>
              {formatIsoDateLong(from)} → {formatIsoDateLong(to)}
            </Text>
          </View>
          <Text style={styles.emptyNote}>
            No events scheduled in this date range.
          </Text>
          <View style={styles.pageFooter} fixed>
            <Text>Calabogie Safety · Payroll Export · Generated {generatedLabel}</Text>
            <Text
              render={({ pageNumber, totalPages }) =>
                `Page ${pageNumber} / ${totalPages}`
              }
            />
          </View>
        </Page>
      ) : (
        <>
          {rows.map((row, idx) => (
            <Page
              key={row.eventId}
              size="LETTER"
              orientation="portrait"
              style={styles.page}
              wrap
            >
              <View style={styles.reportHeader} fixed>
                <Text style={styles.reportTitle}>
                  Payroll · Event {idx + 1} of {rows.length}
                </Text>
                <Text style={styles.reportMeta}>
                  {formatIsoDateLong(from)} → {formatIsoDateLong(to)}
                </Text>
              </View>

              <EventTable row={row} />

              <Text style={styles.legend}>
                Legend: Y worked · - scheduled · X no-show · C cancelled · E excused
              </Text>

              <View style={styles.pageFooter} fixed>
                <Text>Calabogie Safety · Generated {generatedLabel}</Text>
                <Text
                  render={({ pageNumber, totalPages }) =>
                    `Page ${pageNumber} / ${totalPages}`
                  }
                />
              </View>
            </Page>
          ))}
          <SummaryPage rows={rows} totals={totals} from={from} to={to} />
        </>
      )}
    </Document>
  );
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Render the date-range payroll PDF and return the bytes.
 *
 * Throws if `from` or `to` is not a valid `YYYY-MM-DD` string, or if the
 * range is inverted. Empty `rows` is allowed (renders the "No events" page).
 */
export async function buildPayrollPdf(
  rows: PdfRow[],
  opts: BuildPdfOptions,
): Promise<Buffer> {
  const check = validateRange(opts.from, opts.to);
  if (!check.ok) {
    throw new Error(check.error);
  }

  const generatedAt = opts.generatedAt ?? new Date();
  const totals = computeTotals(rows);

  // `renderToBuffer` expects a `<Document>` element directly, so we build the
  // tree inline rather than wrap it in a parent component. The Node runtime
  // is required (the route handler sets `runtime = 'nodejs'`).
  const element = (
    <RootDocument
      rows={rows}
      from={opts.from}
      to={opts.to}
      generatedAt={generatedAt}
      totals={totals}
    />
  );
  const buffer = await renderToBuffer(
    element as unknown as React.ReactElement<
      React.ComponentProps<typeof Document>
    >,
  );
  return buffer;
}
