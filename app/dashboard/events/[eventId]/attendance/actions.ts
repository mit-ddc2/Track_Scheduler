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
import type { AttendanceRecordInsert } from "@/lib/db/types";
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

  // Hydrate the assignment so we can carry the assignment_id and the event's
  // scheduled window into the attendance row on first write.
  const { data: assignment, error: aError } = await supabase
    .from("event_assignments")
    .select("id")
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
    },
    { onConflict: "event_id,staff_member_id" },
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
  if (!existing) {
    const { data: assignment } = await supabase
      .from("event_assignments")
      .select("id")
      .eq("event_id", eventId)
      .eq("staff_member_id", staffMemberId)
      .maybeSingle();
    assignmentId = assignment?.id ?? null;
    const { data: event } = await supabase
      .from("events")
      .select("starts_at, ends_at")
      .eq("id", eventId)
      .maybeSingle();
    scheduledStart = event?.starts_at ?? null;
    scheduledEnd = event?.ends_at ?? null;
  }

  const payload: AttendanceRecordInsert = {
    event_id: eventId,
    staff_member_id: staffMemberId,
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
    .upsert(payload, { onConflict: "event_id,staff_member_id" });
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

  const { data: event } = await supabase
    .from("events")
    .select("starts_at, ends_at, title")
    .eq("id", eventId)
    .maybeSingle();

  const { data: assignments, error: aError } = await supabase
    .from("event_assignments")
    .select("id, staff_member_id")
    .eq("event_id", eventId)
    .in("status", ["confirmed", "completed"]);
  if (aError) return { error: aError.message };

  const rows = assignments ?? [];
  if (rows.length === 0) {
    return { ok: true, count: 0 };
  }

  const now = new Date().toISOString();
  const upserts = rows.map((r) => ({
    event_id: eventId,
    staff_member_id: r.staff_member_id,
    assignment_id: r.id,
    status: "worked" as const,
    scheduled_start: event?.starts_at ?? null,
    scheduled_end: event?.ends_at ?? null,
    approved_by: session.profile.id,
    approved_at: now,
  }));

  const { error } = await supabase
    .from("attendance_records")
    .upsert(upserts, { onConflict: "event_id,staff_member_id" });
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
