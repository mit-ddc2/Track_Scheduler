"use server";

/**
 * Server actions for the post-event attendance flow (Phase 7).
 *
 * Every mutation:
 *   1. asserts `requireOwner()` (owner-only).
 *   2. validates input with Zod.
 *   3. writes via the RLS-enforced server client.
 *   4. records an entry in `audit_log` (best-effort).
 */

import { revalidatePath } from "next/cache";

import { requireOwner } from "@/lib/auth/require-owner";
import { writeAudit } from "@/lib/db/audit";
import { createClient } from "@/lib/db/supabase-server";
import type { AttendanceRecordInsert, EventStatus } from "@/lib/db/types";
import {
  attendanceStatusUpdateSchema,
  attendanceUpdateSchema,
  eventLifecycleSchema,
  markAllWorkedSchema,
  type AttendanceStatusUpdateInput,
  type AttendanceUpdateInput,
  type EventLifecycleInput,
  type MarkAllWorkedInput,
} from "@/lib/validation/schemas";

export type ActionResult = { ok?: true; error?: string };

/**
 * Minimal structural shape accepted by `assertEventEditable`. We declare it
 * with `unknown`-typed methods so a real `SupabaseClient<Database>` is
 * assignable (its return chain is much richer than what we need here) AND
 * lightweight unit-test mocks fit without the test file having to import the
 * full Supabase typings.
 */
type EventEditableClient = {
  // Intentionally `unknown` return — we read it via a narrow `as` cast below.
  from: (table: "events") => unknown;
};

type EventStatusRow = { status: EventStatus | null };

/**
 * Guards attendance mutations against frozen-event states. Throws an `Error`
 * whose message is shown to the caller verbatim (server actions surface it
 * via the standard error boundary; the cycle button surfaces it via its
 * `error` return). Call AFTER `requireOwner()` and BEFORE any DB writes.
 */
export async function assertEventEditable(
  supabase: EventEditableClient,
  eventId: string,
): Promise<void> {
  // Cast to a structural shape with `.select(...).eq(...).maybeSingle()` so
  // we can support both the real Supabase client and the lightweight test
  // mocks in `actions.test.ts`. We deliberately do NOT depend on
  // `SupabaseClient<Database>` here — that pulls the table's full schema
  // type, which TS reports as "excessively deep" when inferred from a
  // generic helper.
  const builder = supabase.from("events") as {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{
          data: EventStatusRow | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
  const { data, error } = await builder
    .select("status")
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Event not found");
  switch (data.status) {
    case "locked":
      throw new Error("Event is locked");
    case "completed":
      throw new Error("Event is completed");
    case "cancelled":
      throw new Error("Event is cancelled");
    default:
      return;
  }
}

/** Catch frozen-event errors thrown by `assertEventEditable` and surface
 * them as a normal action error string (so the UI's optimistic update can
 * roll back gracefully). Anything else re-throws. */
function handleEditableError(err: unknown): ActionResult {
  if (err instanceof Error && /^Event (is|not)/.test(err.message)) {
    return { error: err.message };
  }
  throw err;
}

/**
 * Set just the attendance status for one assignee. Upserts on
 * (event_id, staff_member_id) so the cycle button "creates if missing".
 */
export async function setAttendanceStatus(
  raw: AttendanceStatusUpdateInput,
): Promise<ActionResult> {
  const session = await requireOwner();

  const parsed = attendanceStatusUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid attendance update" };
  }
  const { eventId, staffMemberId, status } = parsed.data;

  const supabase = await createClient();

  try {
    await assertEventEditable(supabase, eventId);
  } catch (err) {
    return handleEditableError(err);
  }

  // Hydrate the assignment so we can carry the assignment_id and the event's
  // scheduled window into the attendance row on first write.
  const { data: assignment, error: aError } = await supabase
    .from("event_assignments")
    .select("id, day_date")
    .eq("event_id", eventId)
    .eq("staff_member_id", staffMemberId)
    .maybeSingle();
  if (aError) return { error: aError.message };

  const { data: event } = await supabase
    .from("events")
    .select("starts_at, ends_at")
    .eq("id", eventId)
    .maybeSingle();

  const approvedAt = status === "worked" ? new Date().toISOString() : null;
  // v2: attendance is per-day. Until the attendance UI lifts to a per-day
  // matrix (Wave B2), default to either the assignment's day_date or the
  // event's start date so the v1 single-day cycle button keeps working.
  const dayDate =
    (assignment as { day_date?: string } | null)?.day_date ??
    (event?.starts_at ? event.starts_at.slice(0, 10) : null);
  if (!dayDate) return { error: "Could not resolve event day for attendance" };

  const { error } = await supabase.from("attendance_records").upsert(
    {
      event_id: eventId,
      staff_member_id: staffMemberId,
      assignment_id: assignment?.id ?? null,
      status,
      scheduled_start: event?.starts_at ?? null,
      scheduled_end: event?.ends_at ?? null,
      approved_by: status === "worked" ? session.profile.id : null,
      approved_at: approvedAt,
      day_date: dayDate,
    },
    { onConflict: "event_id,staff_member_id,day_date" },
  );

  if (error) return { error: error.message };

  await writeAudit({
    action: "attendance.set_status",
    entity_type: "attendance",
    entity_id: eventId,
    summary: `Set attendance to ${status}`,
    after: { event_id: eventId, staff_member_id: staffMemberId, status },
    actorType: "owner",
    actorId: session.profile.id,
  });

  revalidatePath(`/dashboard/events/${eventId}/attendance`);
  revalidatePath(`/dashboard/events/${eventId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * Per-row edit of hours, rate, pay code, notes, actual start/end. Optional
 * fields are applied verbatim; undefined keys are left alone.
 */
export async function updateAttendanceDetails(
  raw: AttendanceUpdateInput,
): Promise<ActionResult> {
  const session = await requireOwner();

  const parsed = attendanceUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid attendance update" };
  }
  const { eventId, staffMemberId, ...patch } = parsed.data;

  const supabase = await createClient();

  try {
    await assertEventEditable(supabase, eventId);
  } catch (err) {
    return handleEditableError(err);
  }

  // We need an assignment_id + scheduled window only when there is no
  // existing attendance row yet (so the upsert defaults are sensible).
  const { data: existing } = await supabase
    .from("attendance_records")
    .select("id")
    .eq("event_id", eventId)
    .eq("staff_member_id", staffMemberId)
    .maybeSingle();

  let assignmentId: string | null = null;
  let scheduledStart: string | null = null;
  let scheduledEnd: string | null = null;
  let assignmentDayDate: string | null = null;
  let eventStartDayDate: string | null = null;
  // Always need a day_date for the v2 schema. Pull either the existing
  // attendance row's day, the assignment's day, or fall back to event start.
  const existingDay = (existing as { day_date?: string } | null)?.day_date ?? null;
  if (!existing || !existingDay) {
    const { data: assignment } = await supabase
      .from("event_assignments")
      .select("id, day_date")
      .eq("event_id", eventId)
      .eq("staff_member_id", staffMemberId)
      .maybeSingle();
    assignmentId = assignment?.id ?? null;
    assignmentDayDate =
      (assignment as { day_date?: string } | null)?.day_date ?? null;
    const { data: event } = await supabase
      .from("events")
      .select("starts_at, ends_at")
      .eq("id", eventId)
      .maybeSingle();
    scheduledStart = event?.starts_at ?? null;
    scheduledEnd = event?.ends_at ?? null;
    eventStartDayDate = event?.starts_at
      ? event.starts_at.slice(0, 10)
      : null;
  }
  const dayDate = existingDay ?? assignmentDayDate ?? eventStartDayDate;
  if (!dayDate) return { error: "Could not resolve event day for attendance" };

  const payload: AttendanceRecordInsert = {
    event_id: eventId,
    staff_member_id: staffMemberId,
    day_date: dayDate,
  };
  if (!existing) {
    payload.assignment_id = assignmentId;
    payload.scheduled_start = scheduledStart;
    payload.scheduled_end = scheduledEnd;
  }
  if (patch.actual_start !== undefined) payload.actual_start = patch.actual_start;
  if (patch.actual_end !== undefined) payload.actual_end = patch.actual_end;
  if (patch.actual_hours !== undefined) payload.actual_hours = patch.actual_hours;
  if (patch.pay_rate !== undefined) payload.pay_rate = patch.pay_rate;
  if (patch.pay_code !== undefined) payload.pay_code = patch.pay_code;
  if (patch.notes !== undefined) payload.notes = patch.notes;

  const { error } = await supabase
    .from("attendance_records")
    .upsert(payload, { onConflict: "event_id,staff_member_id,day_date" });
  if (error) return { error: error.message };

  await writeAudit({
    action: "attendance.update_details",
    entity_type: "attendance",
    entity_id: eventId,
    summary: `Updated attendance details`,
    after: { event_id: eventId, staff_member_id: staffMemberId, ...patch },
    actorType: "owner",
    actorId: session.profile.id,
  });

  revalidatePath(`/dashboard/events/${eventId}/attendance`);
  revalidatePath(`/dashboard/events/${eventId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * Mark every confirmed assignment as `worked`. Idempotent — re-running sets
 * the same status. Records ONE audit log entry covering the batch.
 */
export async function markAllWorked(
  raw: MarkAllWorkedInput,
): Promise<ActionResult & { count?: number }> {
  const session = await requireOwner();

  const parsed = markAllWorkedSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { eventId } = parsed.data;

  const supabase = await createClient();

  try {
    await assertEventEditable(supabase, eventId);
  } catch (err) {
    return handleEditableError(err);
  }

  const { data: event } = await supabase
    .from("events")
    .select("starts_at, ends_at, title")
    .eq("id", eventId)
    .maybeSingle();

  const { data: assignments, error: aError } = await supabase
    .from("event_assignments")
    .select("id, staff_member_id, day_date")
    .eq("event_id", eventId)
    .in("status", ["confirmed", "completed"]);
  if (aError) return { error: aError.message };

  const rows = assignments ?? [];
  if (rows.length === 0) {
    return { ok: true, count: 0 };
  }

  const now = new Date().toISOString();
  const fallbackDay = event?.starts_at ? event.starts_at.slice(0, 10) : null;
  const upserts = rows.map((r) => ({
    event_id: eventId,
    staff_member_id: r.staff_member_id,
    assignment_id: r.id,
    status: "worked" as const,
    scheduled_start: event?.starts_at ?? null,
    scheduled_end: event?.ends_at ?? null,
    approved_by: session.profile.id,
    approved_at: now,
    day_date:
      ((r as { day_date?: string }).day_date as string | undefined) ??
      fallbackDay ??
      "1970-01-01",
  }));

  const { error } = await supabase
    .from("attendance_records")
    .upsert(upserts, { onConflict: "event_id,staff_member_id,day_date" });
  if (error) return { error: error.message };

  await writeAudit({
    action: "attendance.mark_all_worked",
    entity_type: "event",
    entity_id: eventId,
    summary: `Marked ${rows.length} assignees as worked for "${event?.title ?? eventId}"`,
    after: { event_id: eventId, count: rows.length },
    actorType: "owner",
    actorId: session.profile.id,
  });

  revalidatePath(`/dashboard/events/${eventId}/attendance`);
  revalidatePath(`/dashboard/events/${eventId}`);
  revalidatePath("/dashboard");
  return { ok: true, count: rows.length };
}

/** Lock the event (status=locked). Audit-logged. */
export async function lockEvent(
  raw: EventLifecycleInput,
): Promise<ActionResult> {
  const session = await requireOwner();
  const parsed = eventLifecycleSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { eventId } = parsed.data;

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("events")
    .select("status, title")
    .eq("id", eventId)
    .maybeSingle();
  if (!existing) return { error: "Event not found" };

  const { error } = await supabase
    .from("events")
    .update({ status: "locked", updated_by: session.profile.id })
    .eq("id", eventId);
  if (error) return { error: error.message };

  await writeAudit({
    action: "event.lock",
    entity_type: "event",
    entity_id: eventId,
    summary: `Locked event "${existing.title}"`,
    before: { status: existing.status },
    after: { status: "locked" },
    actorType: "owner",
    actorId: session.profile.id,
  });

  revalidatePath(`/dashboard/events/${eventId}`);
  revalidatePath(`/dashboard/events/${eventId}/attendance`);
  return { ok: true };
}

/** Mark the event completed + stamp completed_at. Audit-logged. */
export async function completeEvent(
  raw: EventLifecycleInput,
): Promise<ActionResult> {
  const session = await requireOwner();
  const parsed = eventLifecycleSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { eventId } = parsed.data;

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("events")
    .select("status, title, completed_at")
    .eq("id", eventId)
    .maybeSingle();
  if (!existing) return { error: "Event not found" };
  if (existing.status === "completed") return { ok: true };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("events")
    .update({
      status: "completed",
      completed_at: now,
      updated_by: session.profile.id,
    })
    .eq("id", eventId);
  if (error) return { error: error.message };

  await writeAudit({
    action: "event.complete",
    entity_type: "event",
    entity_id: eventId,
    summary: `Completed event "${existing.title}"`,
    before: { status: existing.status },
    after: { status: "completed", completed_at: now },
    actorType: "owner",
    actorId: session.profile.id,
  });

  revalidatePath(`/dashboard/events/${eventId}`);
  revalidatePath(`/dashboard/events/${eventId}/attendance`);
  return { ok: true };
}
