import { z } from "zod";

import { requireOwner } from "@/lib/auth/require-owner";
import { writeAudit } from "@/lib/db/audit";
import { createClient } from "@/lib/db/supabase-server";
import {
  buildPayrollPdf,
  computeTotals,
  type PdfDay,
  type PdfRow,
  type PdfStaffEntry,
} from "@/lib/payroll/export-pdf";
import type {
  AttendanceRecordRow,
  AttendanceStatus,
  EventRow,
} from "@/lib/db/types";

// Force the Node runtime: @react-pdf/renderer pulls in pdfkit / fontkit /
// brotli decoders that don't exist on the Edge runtime.
export const runtime = "nodejs";
// PDFs are user-data-dependent; never cache.
export const dynamic = "force-dynamic";

// ─── Query-param schema ──────────────────────────────────────────────────

const ISO_DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const QuerySchema = z
  .object({
    from: ISO_DATE.optional(),
    to: ISO_DATE.optional(),
  })
  .refine(
    (v) => {
      if (v.from && v.to) return v.from <= v.to;
      return true;
    },
    { message: "'from' must be on or before 'to'" },
  );

/** First and last day (inclusive) of the month containing `now`, in UTC. */
function defaultRange(now: Date = new Date()): { from: string; to: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const first = new Date(Date.UTC(year, month, 1));
  const last = new Date(Date.UTC(year, month + 1, 0));
  return {
    from: first.toISOString().slice(0, 10),
    to: last.toISOString().slice(0, 10),
  };
}

/** Days the event window touches that fall inside [from, to]. */
function daysInRange(
  eventStartIso: string,
  eventEndIso: string,
  fromIso: string,
  toIso: string,
): string[] {
  const start = isoDateMax(eventStartIso, fromIso);
  const end = isoDateMin(eventEndIso, toIso);
  if (start > end) return [];

  const out: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    out.push(cursor);
    cursor = addOneDay(cursor);
  }
  return out;
}

function isoDateMax(a: string, b: string): string {
  return a > b ? a : b;
}

function isoDateMin(a: string, b: string): string {
  return a < b ? a : b;
}

function addOneDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function eventStartDate(ev: EventRow): string {
  return ev.starts_at.slice(0, 10);
}

function eventEndDate(ev: EventRow): string {
  return ev.ends_at.slice(0, 10);
}

function computeTotalPay(
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

// ─── Row shapes returned by Supabase ─────────────────────────────────────

type AssignmentJoinRow = {
  id: string;
  event_id: string;
  staff_member_id: string;
  status: "confirmed" | "waitlisted" | "cancelled" | "completed";
  staff_members: { id: string; display_name: string } | null;
};

type RawAttendanceRow = AttendanceRecordRow & {
  day_date?: string | null; // present once Wave A1 ships
};

// ─── Builder ─────────────────────────────────────────────────────────────

function buildPdfRows(
  events: EventRow[],
  assignments: AssignmentJoinRow[],
  attendance: RawAttendanceRow[],
  from: string,
  to: string,
): PdfRow[] {
  // Group helpers
  const assignmentsByEvent = new Map<string, AssignmentJoinRow[]>();
  for (const a of assignments) {
    const list = assignmentsByEvent.get(a.event_id) ?? [];
    list.push(a);
    assignmentsByEvent.set(a.event_id, list);
  }

  // Attendance keyed by event_id, then by `day_date` (or "*" if column not
  // populated yet — graceful fallback for the pre-Wave-A1 schema), then by
  // staff_member_id.
  const attendanceByEvent = new Map<
    string,
    Map<string, Map<string, RawAttendanceRow>>
  >();
  for (const r of attendance) {
    const dayKey = r.day_date ?? "*";
    let evMap = attendanceByEvent.get(r.event_id);
    if (!evMap) {
      evMap = new Map();
      attendanceByEvent.set(r.event_id, evMap);
    }
    let dayMap = evMap.get(dayKey);
    if (!dayMap) {
      dayMap = new Map();
      evMap.set(dayKey, dayMap);
    }
    dayMap.set(r.staff_member_id, r);
  }

  // Stable chronological order: events by start, then id.
  const sortedEvents = [...events].sort((a, b) => {
    if (a.starts_at !== b.starts_at) {
      return a.starts_at < b.starts_at ? -1 : 1;
    }
    return a.id.localeCompare(b.id);
  });

  const rows: PdfRow[] = [];
  for (const ev of sortedEvents) {
    const evStart = eventStartDate(ev);
    const evEnd = eventEndDate(ev);
    const days = daysInRange(evStart, evEnd, from, to);
    if (days.length === 0) continue;

    const evAssignments = assignmentsByEvent.get(ev.id) ?? [];
    const evAttendance = attendanceByEvent.get(ev.id) ?? new Map();

    const pdfDays: PdfDay[] = days.map((dayIso) => {
      // Prefer per-day attendance rows (when day_date populated); fall back
      // to the single "*" bucket if Wave A1 hasn't landed yet — in that
      // case every day inherits the same attendance snapshot.
      const dayAttendanceMap: Map<string, RawAttendanceRow> =
        evAttendance.get(dayIso) ?? evAttendance.get("*") ?? new Map();

      const staffEntries: PdfStaffEntry[] = evAssignments.map((a) => {
        const att = dayAttendanceMap.get(a.staff_member_id);
        const status: AttendanceStatus = att?.status ?? "scheduled";
        const actualHours = att?.actual_hours ?? null;
        const payRate = att?.pay_rate ?? null;
        return {
          displayName: a.staff_members?.display_name ?? "Unknown",
          status,
          actualHours,
          payRate,
          totalPay: computeTotalPay(actualHours, payRate),
        };
      });

      return { date: dayIso, staffEntries };
    });

    rows.push({
      eventId: ev.id,
      eventTitle: ev.title,
      venue: ev.location,
      eventStartDate: evStart,
      eventEndDate: evEnd,
      days: pdfDays,
    });
  }

  return rows;
}

// ─── GET handler ─────────────────────────────────────────────────────────

/**
 * GET /api/exports/payroll-pdf?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Owner-only. Returns a date-range chronological payroll PDF. If `from`/`to`
 * are omitted, defaults to the current calendar month (UTC).
 *
 * Schema fallback: when Wave A1's `attendance_records.day_date` column hasn't
 * landed, every day in a multi-day event inherits the same attendance row —
 * acceptable for single-day events (the v1 default) and graceful for
 * multi-day events until the migration lands.
 */
export async function GET(req: Request) {
  const session = await requireOwner();

  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "Invalid query", details: parsed.error.flatten() }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  const defaults = defaultRange();
  const from = parsed.data.from ?? defaults.from;
  const to = parsed.data.to ?? defaults.to;

  const supabase = await createClient();

  // Events whose window intersects [from, to]: starts_at <= toEnd AND ends_at >= fromStart.
  const fromStartIso = `${from}T00:00:00Z`;
  const toEndIso = `${to}T23:59:59.999Z`;

  const { data: eventsRaw, error: evErr } = await supabase
    .from("events")
    .select("*")
    .lte("starts_at", toEndIso)
    .gte("ends_at", fromStartIso)
    .neq("status", "cancelled")
    .order("starts_at", { ascending: true });

  if (evErr) {
    console.warn("[payroll-pdf] events query failed:", evErr.message);
    return new Response("Failed to load events", { status: 500 });
  }

  const events = (eventsRaw ?? []) as EventRow[];
  const eventIds = events.map((e) => e.id);

  let assignments: AssignmentJoinRow[] = [];
  let attendance: RawAttendanceRow[] = [];

  if (eventIds.length > 0) {
    const { data: aData, error: aErr } = await supabase
      .from("event_assignments")
      .select(
        `
        id, event_id, staff_member_id, status,
        staff_members:staff_member_id(id, display_name)
      `,
      )
      .in("event_id", eventIds)
      .in("status", ["confirmed", "completed"]);

    if (aErr) {
      console.warn("[payroll-pdf] assignments query failed:", aErr.message);
    } else {
      assignments = (aData ?? []) as unknown as AssignmentJoinRow[];
    }

    const { data: attData, error: attErr } = await supabase
      .from("attendance_records")
      .select("*")
      .in("event_id", eventIds);

    if (attErr) {
      console.warn("[payroll-pdf] attendance query failed:", attErr.message);
    } else {
      attendance = (attData ?? []) as unknown as RawAttendanceRow[];
    }
  }

  const rows = buildPdfRows(events, assignments, attendance, from, to);
  const totals = computeTotals(rows);

  let pdf: Buffer;
  try {
    pdf = await buildPayrollPdf(rows, { from, to });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[payroll-pdf] render failed:", msg);
    return new Response("Failed to render PDF", { status: 500 });
  }

  await writeAudit({
    action: "payroll.export_pdf",
    entity_type: "payroll",
    entity_id: `${from}_${to}`,
    summary: `Exported payroll PDF for ${from} → ${to} (${rows.length} events, ${totals.staffDaysWorked} staff-days worked)`,
    after: {
      from,
      to,
      event_count: rows.length,
      staff_days_worked: totals.staffDaysWorked,
      total_payroll: totals.totalPayroll,
    },
    actorType: "owner",
    actorId: session.profile.id,
  });

  const fileName = `calabogie-payroll-${from}-to-${to}.pdf`;
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${fileName}"`,
      "cache-control": "no-store",
      "content-length": String(pdf.length),
    },
  });
}
