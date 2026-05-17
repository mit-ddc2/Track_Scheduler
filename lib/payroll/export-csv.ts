/**
 * Payroll CSV export (spec §8.12).
 *
 * Pure formatter: takes already-loaded attendance + staff + event data and
 * returns an RFC 4180 CSV string. The API route handler does the
 * authentication, audit logging, and Supabase fetching — keeping this module
 * pure makes it trivial to unit-test the formula-injection escape and quoting
 * rules (spec §19.5).
 */

export type AttendanceWithStaffAndEvent = {
  event: {
    id: string;
    title: string;
    starts_at: string;
    ends_at: string;
    timezone: string;
  };
  staff: {
    display_name: string;
    email: string | null;
    phone: string | null;
  };
  attendance: {
    status:
      | "scheduled"
      | "worked"
      | "no_show"
      | "cancelled_by_member"
      | "cancelled_by_manager"
      | "excused";
    scheduled_start: string | null;
    scheduled_end: string | null;
    actual_hours: number | null;
    pay_rate: number | null;
    notes: string | null;
  };
};

export const PAYROLL_CSV_HEADERS = [
  "event_date",
  "event_title",
  "staff_name",
  "email",
  "phone",
  "attendance_status",
  "scheduled_hours",
  "actual_hours",
  "pay_rate",
  "total_pay",
  "notes",
] as const;

/**
 * Characters that, when at the *start* of a cell, can trigger formula
 * evaluation in Excel/Numbers/Google Sheets. We prefix the cell with a
 * single quote to neutralise (the apostrophe is hidden by the spreadsheet
 * UI but still defangs the formula).
 *
 * Spec §19.5: "CSV import/export escapes spreadsheet formulas."
 */
const FORMULA_LEADERS = new Set(["=", "+", "-", "@", "\t", "\r", "\n"]);

/**
 * Escape a single CSV field per RFC 4180 with formula-injection mitigation:
 *   - prefix `'` to defang `=`, `+`, `-`, `@`, `\t`, `\r`, `\n` leaders
 *   - wrap in double quotes if the value contains `,`, `"`, `\r`, or `\n`
 *   - double any internal double quotes
 */
export function escapeCsvField(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  let s = typeof raw === "string" ? raw : String(raw);
  if (s.length > 0 && FORMULA_LEADERS.has(s[0]!)) {
    s = `'${s}`;
  }
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function isoToDate(iso: string | null | undefined): string {
  if (!iso) return "";
  // Use the ISO date prefix. Dates already normalised to YYYY-MM-DD avoid
  // the lurking timezone-shift bug when toISOString() lands across midnight.
  return iso.slice(0, 10);
}

function hoursBetween(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
): number | null {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }
  return (end - start) / 3_600_000;
}

function formatHours(value: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return value.toFixed(2);
}

function formatMoney(value: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return value.toFixed(2);
}

/** Compute total_pay = actual_hours * pay_rate (returns 0 if either nullish). */
export function computeTotalPay(
  actualHours: number | null,
  payRate: number | null,
): number {
  if (
    actualHours === null ||
    actualHours === undefined ||
    payRate === null ||
    payRate === undefined ||
    !Number.isFinite(actualHours) ||
    !Number.isFinite(payRate)
  ) {
    return 0;
  }
  return Number((actualHours * payRate).toFixed(2));
}

function toRow(record: AttendanceWithStaffAndEvent): string {
  const scheduledHours = hoursBetween(
    record.attendance.scheduled_start,
    record.attendance.scheduled_end,
  );
  const total = computeTotalPay(
    record.attendance.actual_hours,
    record.attendance.pay_rate,
  );

  const values = [
    isoToDate(record.event.starts_at),
    record.event.title,
    record.staff.display_name,
    record.staff.email ?? "",
    record.staff.phone ?? "",
    record.attendance.status,
    formatHours(scheduledHours),
    formatHours(record.attendance.actual_hours),
    formatMoney(record.attendance.pay_rate),
    formatMoney(total),
    record.attendance.notes ?? "",
  ];

  return values.map(escapeCsvField).join(",");
}

/**
 * Render the full payroll CSV. CRLF line endings per RFC 4180; a trailing
 * CRLF is intentionally omitted (RFC 4180 §2.2 — "the last record in the
 * file may or may not have an ending line break").
 */
export function buildPayrollCsv(
  records: AttendanceWithStaffAndEvent[],
): string {
  const lines = [PAYROLL_CSV_HEADERS.join(","), ...records.map(toRow)];
  return lines.join("\r\n");
}
