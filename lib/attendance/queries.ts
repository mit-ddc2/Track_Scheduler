/**
 * Server-side queries for attendance + payroll (Phase 7).
 *
 * Joins event_assignments + staff_members + (optional) attendance_records
 * for one event, so the UI can render one row per confirmed/completed
 * assignee and the API route can render the payroll CSV in one round-trip.
 */

import "server-only";

import { createClient } from "@/lib/db/supabase-server";
import type {
  AssignmentStatus,
  AttendanceRecordRow,
  ContactChannel,
} from "@/lib/db/types";
import type { AttendanceWithStaffAndEvent } from "@/lib/payroll/export-csv";

export type AttendanceListRow = {
  assignment_id: string;
  staff_member_id: string;
  staff_display_name: string;
  staff_email: string | null;
  staff_phone: string | null;
  role_label: string | null;
  role_name: string | null;
  primary_qualification_name: string | null;
  assignment_status: AssignmentStatus;
  attendance: AttendanceRecordRow | null;
};

type AssignmentJoinRow = {
  id: string;
  staff_member_id: string;
  status: AssignmentStatus;
  role_id: string | null;
  role_label: string | null;
  staff_members: {
    id: string;
    display_name: string;
    contact_methods:
      | Array<{
          channel: ContactChannel;
          value: string;
          is_primary: boolean;
        }>
      | null;
    staff_roles:
      | Array<{
          is_primary: boolean;
          crew_roles: { name: string } | null;
        }>
      | null;
    staff_qualifications:
      | Array<{
          qualifications: { name: string } | null;
        }>
      | null;
  } | null;
};

function pickPrimaryContact(
  methods: AssignmentJoinRow["staff_members"] extends infer T
    ? T extends { contact_methods: infer C }
      ? C
      : never
    : never,
  channel: ContactChannel,
): string | null {
  if (!methods) return null;
  const list = methods.filter((m) => m.channel === channel);
  if (list.length === 0) return null;
  const primary = list.find((m) => m.is_primary) ?? list[0];
  return primary?.value ?? null;
}

/**
 * v2 (Wave B2): per-day attendance matrix row. One entry per
 * (staff_member, day) pair so multi-day events can be edited by day.
 */
export type AttendanceMatrixCell = {
  day_date: string;
  status: AssignmentStatus | null;
  attendance:
    | (Pick<
        AttendanceRecordRow,
        "status" | "actual_hours" | "pay_rate" | "actual_start" | "actual_end" | "notes" | "pay_code"
      > & { day_date: string })
    | null;
};

export type AttendanceMatrixRow = {
  staff_member_id: string;
  staff_display_name: string;
  role_label: string | null;
  cells: AttendanceMatrixCell[];
};

/**
 * Per-day attendance matrix for the multi-day attendance UI. Each staff
 * member becomes one row; each day in the event window becomes a column.
 * Cells without an assignment render as inert "not assigned" placeholders
 * so the manager can see the gap.
 */
export async function listEventAttendanceMatrix(
  eventId: string,
  days: string[],
): Promise<AttendanceMatrixRow[]> {
  const supabase = await createClient();

  const { data: assignments, error: aError } = await supabase
    .from("event_assignments")
    .select(
      `
      id, staff_member_id, status, role_id, role_label, day_date,
      staff_members:staff_member_id(
        id, display_name,
        staff_roles(is_primary, crew_roles(name)),
        staff_qualifications(qualifications(name))
      )
    `,
    )
    .eq("event_id", eventId)
    .in("status", ["confirmed", "completed"]);
  if (aError) {
    console.warn(
      "[attendance] listEventAttendanceMatrix assignments:",
      aError.message,
    );
    return [];
  }

  type Row = AssignmentJoinRow & { day_date: string | null };
  const rows = (assignments ?? []) as unknown as Row[];

  const { data: attRows, error: attError } = await supabase
    .from("attendance_records")
    .select(
      "staff_member_id, day_date, status, actual_hours, pay_rate, actual_start, actual_end, notes, pay_code",
    )
    .eq("event_id", eventId);
  if (attError) {
    console.warn(
      "[attendance] listEventAttendanceMatrix attendance:",
      attError.message,
    );
  }
  const attByKey = new Map<
    string,
    AttendanceMatrixCell["attendance"]
  >();
  type AttRow = {
    staff_member_id: string;
    day_date: string;
    status: AttendanceRecordRow["status"];
    actual_hours: number | null;
    pay_rate: number | null;
    actual_start: string | null;
    actual_end: string | null;
    notes: string | null;
    pay_code: string | null;
  };
  for (const a of (attRows ?? []) as AttRow[]) {
    attByKey.set(`${a.staff_member_id}|${a.day_date}`, {
      day_date: a.day_date,
      status: a.status,
      actual_hours: a.actual_hours,
      pay_rate: a.pay_rate,
      actual_start: a.actual_start,
      actual_end: a.actual_end,
      notes: a.notes,
      pay_code: a.pay_code,
    });
  }

  // Group assignments by staff so each staff member becomes one row even when
  // they're assigned to multiple days.
  const byStaff = new Map<
    string,
    {
      display_name: string;
      role_label: string | null;
      byDay: Map<string, AssignmentStatus>;
    }
  >();
  for (const row of rows) {
    const sm = row.staff_members;
    if (!sm || !row.day_date) continue;
    if (!byStaff.has(row.staff_member_id)) {
      const primaryRole =
        sm.staff_roles?.find((r) => r.is_primary)?.crew_roles?.name ?? null;
      const firstQual =
        sm.staff_qualifications?.[0]?.qualifications?.name ?? null;
      byStaff.set(row.staff_member_id, {
        display_name: sm.display_name,
        role_label: row.role_label ?? primaryRole ?? firstQual,
        byDay: new Map(),
      });
    }
    byStaff.get(row.staff_member_id)!.byDay.set(row.day_date, row.status);
  }

  const result: AttendanceMatrixRow[] = [];
  for (const [staffId, info] of byStaff.entries()) {
    const cells: AttendanceMatrixCell[] = days.map((d) => ({
      day_date: d,
      status: info.byDay.get(d) ?? null,
      attendance: attByKey.get(`${staffId}|${d}`) ?? null,
    }));
    result.push({
      staff_member_id: staffId,
      staff_display_name: info.display_name,
      role_label: info.role_label,
      cells,
    });
  }
  // Stable ordering by display name.
  result.sort((a, b) => a.staff_display_name.localeCompare(b.staff_display_name));
  return result;
}

/**
 * List one row per assignee for the attendance grid. Includes assignment
 * statuses `confirmed` and `completed` (per Phase 7 spec) and merges in any
 * existing `attendance_records` row for that (event, staff) pair.
 */
export async function listEventAttendance(
  eventId: string,
): Promise<AttendanceListRow[]> {
  const supabase = await createClient();

  const { data: assignments, error: aError } = await supabase
    .from("event_assignments")
    .select(
      `
      id, staff_member_id, status, role_id, role_label,
      staff_members:staff_member_id(
        id, display_name,
        contact_methods:staff_contact_methods(channel, value, is_primary),
        staff_roles(is_primary, crew_roles(name)),
        staff_qualifications(qualifications(name))
      )
    `,
    )
    .eq("event_id", eventId)
    .in("status", ["confirmed", "completed"]);

  if (aError) {
    console.warn("[attendance] listEventAttendance assignments:", aError.message);
    return [];
  }

  const rows = (assignments ?? []) as unknown as AssignmentJoinRow[];

  const { data: attRows, error: attError } = await supabase
    .from("attendance_records")
    .select("*")
    .eq("event_id", eventId);

  if (attError) {
    console.warn("[attendance] listEventAttendance attendance:", attError.message);
  }

  const byStaff = new Map<string, AttendanceRecordRow>();
  for (const r of (attRows ?? []) as AttendanceRecordRow[]) {
    byStaff.set(r.staff_member_id, r);
  }

  return rows.map((row) => {
    const sm = row.staff_members;
    const primaryRole = sm?.staff_roles?.find((r) => r.is_primary)?.crew_roles
      ?.name ?? null;
    const firstQual = sm?.staff_qualifications?.[0]?.qualifications?.name ?? null;
    return {
      assignment_id: row.id,
      staff_member_id: row.staff_member_id,
      staff_display_name: sm?.display_name ?? "Unknown",
      staff_email: pickPrimaryContact(sm?.contact_methods ?? null, "email"),
      staff_phone: pickPrimaryContact(sm?.contact_methods ?? null, "sms"),
      role_label: row.role_label,
      role_name: primaryRole,
      primary_qualification_name: firstQual,
      assignment_status: row.status,
      attendance: byStaff.get(row.staff_member_id) ?? null,
    };
  });
}

/**
 * Reshape attendance rows for `buildPayrollCsv`. Each assignment becomes a
 * single CSV row regardless of whether the manager has marked attendance
 * yet — `attendance_records` defaults stand in.
 */
export async function getPayrollExportData(eventId: string): Promise<{
  event: {
    id: string;
    title: string;
    starts_at: string;
    ends_at: string;
    timezone: string;
  } | null;
  records: AttendanceWithStaffAndEvent[];
}> {
  const supabase = await createClient();

  const { data: event } = await supabase
    .from("events")
    .select("id, title, starts_at, ends_at, timezone")
    .eq("id", eventId)
    .maybeSingle();

  if (!event) return { event: null, records: [] };

  const rows = await listEventAttendance(eventId);

  const records: AttendanceWithStaffAndEvent[] = rows.map((row) => {
    const a = row.attendance;
    return {
      event,
      staff: {
        display_name: row.staff_display_name,
        email: row.staff_email,
        phone: row.staff_phone,
      },
      attendance: {
        status: a?.status ?? "scheduled",
        scheduled_start: a?.scheduled_start ?? event.starts_at,
        scheduled_end: a?.scheduled_end ?? event.ends_at,
        actual_hours: a?.actual_hours ?? null,
        pay_rate: a?.pay_rate ?? null,
        notes: a?.notes ?? null,
      },
    };
  });

  return { event, records };
}
