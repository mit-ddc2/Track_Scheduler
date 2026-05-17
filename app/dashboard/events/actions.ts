"use server";

/**
 * Server actions for the events flow (Phase 3).
 *
 * Every mutation:
 *   1. asserts `requireOwner()` before touching anything,
 *   2. validates input with Zod,
 *   3. writes via the RLS-enforced server client,
 *   4. records an entry in `audit_log` (best-effort).
 */

import { revalidatePath } from "next/cache";
import { fromZonedTime } from "date-fns-tz";

import { requireOwner } from "@/lib/auth/require-owner";
import { writeAudit } from "@/lib/db/audit";
import { createClient } from "@/lib/db/supabase-server";
import type { EventUpdate } from "@/lib/db/types";
import {
  cancelEventSchema,
  eventCreateSchema,
  eventRequirementSchema,
  eventUpdateSchema,
  type EventCreateInput,
  type EventRequirementInput,
  type EventUpdateInput,
} from "@/lib/validation/schemas";

/**
 * Accepts a datetime-local value (no zone) and converts it to a UTC ISO
 * string interpreted in the supplied timezone. If the value already includes
 * an offset (`Z` or `+/-hh:mm`), it's returned as-is.
 */
function toUtcIso(value: string, tz: string): string {
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(value)) {
    return new Date(value).toISOString();
  }
  return fromZonedTime(value, tz).toISOString();
}

function normaliseInput<T extends EventCreateInput | EventUpdateInput>(
  input: T,
): T {
  const out = { ...input } as T;
  const tz = (out.timezone as string | undefined) || "America/Toronto";
  if (out.starts_at) {
    (out as EventCreateInput).starts_at = toUtcIso(out.starts_at as string, tz);
  }
  if (out.ends_at) {
    (out as EventCreateInput).ends_at = toUtcIso(out.ends_at as string, tz);
  }
  return out;
}

export type ActionResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

/**
 * Create a manual event. Returns the new row's id.
 */
export async function createManualEvent(
  rawInput: EventCreateInput,
): Promise<{ id?: string; error?: string }> {
  const session = await requireOwner();

  const parsed = eventCreateSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid event data" };
  }

  const input = normaliseInput(parsed.data);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("events")
    .insert({
      title: input.title.trim(),
      description: input.description ?? null,
      event_type: input.event_type ?? null,
      starts_at: input.starts_at,
      ends_at: input.ends_at,
      timezone: input.timezone,
      location: input.location ?? null,
      status: "scheduled",
      source_type: "manual",
      required_headcount: input.required_headcount,
      overbooking_policy: input.overbooking_policy,
      manager_notes: input.manager_notes ?? null,
      created_by: session.profile.id,
      updated_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { error: error?.message ?? "Could not create event" };
  }

  await writeAudit({
    action: "event.create",
    entity_type: "event",
    entity_id: data.id,
    summary: `Created event "${input.title}"`,
    after: { ...input, id: data.id },
    actorType: "owner",
    actorId: session.profile.id,
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/events");

  return { id: data.id };
}

/**
 * Diff-aware update for manual edits. Status changes go through a separate
 * helper (state machine + invite/assignment side effects).
 */
export async function updateEvent(
  eventId: string,
  rawInput: EventUpdateInput,
): Promise<{ id?: string; error?: string }> {
  const session = await requireOwner();

  const parsed = eventUpdateSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid event data" };
  }

  const supabase = await createClient();

  // Fetch existing row to diff and to enforce the lock/cancel rule.
  const { data: existing, error: fetchError } = await supabase
    .from("events")
    .select(
      "id, title, description, event_type, starts_at, ends_at, timezone, location, required_headcount, overbooking_policy, manager_notes, status",
    )
    .eq("id", eventId)
    .maybeSingle();

  if (fetchError || !existing) {
    return { error: "Event not found" };
  }

  if (
    existing.status === "locked" ||
    existing.status === "completed" ||
    existing.status === "cancelled"
  ) {
    return {
      error: `Cannot edit a ${existing.status} event`,
    };
  }

  const input = normaliseInput(parsed.data);
  const patch: EventUpdate = {};
  const diff: Record<string, { before: unknown; after: unknown }> = {};

  const assign = <K extends keyof EventUpdate>(
    key: K,
    transformed: EventUpdate[K] | undefined,
  ) => {
    const before = (existing as Record<string, unknown>)[key as string];
    if (transformed === undefined) return;
    if (transformed === before) return;
    patch[key] = transformed;
    diff[key as string] = { before, after: transformed };
  };

  assign("title", input.title?.trim());
  assign("description", input.description ?? null);
  assign("event_type", input.event_type ?? null);
  assign("starts_at", input.starts_at);
  assign("ends_at", input.ends_at);
  assign("timezone", input.timezone);
  assign("location", input.location ?? null);
  assign("required_headcount", input.required_headcount);
  assign("overbooking_policy", input.overbooking_policy);
  assign("manager_notes", input.manager_notes ?? null);

  if (Object.keys(patch).length === 0) {
    return { id: eventId };
  }

  patch.updated_by = session.profile.id;

  const { error: updateError } = await supabase
    .from("events")
    .update(patch)
    .eq("id", eventId);

  if (updateError) {
    return { error: updateError.message };
  }

  await writeAudit({
    action: "event.update",
    entity_type: "event",
    entity_id: eventId,
    summary: `Updated event "${existing.title}"`,
    before: diff,
    after: patch,
    actorType: "owner",
    actorId: session.profile.id,
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/events");
  revalidatePath(`/dashboard/events/${eventId}`);

  return { id: eventId };
}

/**
 * Cancel an event. Appends the reason to manager_notes and stamps
 * cancelled_at; Phase 5 will fan out notifications to invitees.
 */
export async function cancelEvent(
  eventId: string,
  rawInput: { reason: string },
): Promise<{ id?: string; error?: string }> {
  const session = await requireOwner();

  const parsed = cancelEventSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Reason required" };
  }

  const supabase = await createClient();
  const { data: existing, error: fetchError } = await supabase
    .from("events")
    .select("id, title, status, manager_notes")
    .eq("id", eventId)
    .maybeSingle();

  if (fetchError || !existing) {
    return { error: "Event not found" };
  }
  if (existing.status === "cancelled") {
    return { id: eventId };
  }
  if (existing.status === "completed") {
    return { error: "Cannot cancel a completed event" };
  }

  const stamp = new Date().toISOString();
  const reasonBlock = `\n\n[cancelled ${stamp}]\n${parsed.data.reason.trim()}`;
  const nextNotes = `${existing.manager_notes ?? ""}${reasonBlock}`.trim();

  const { error: updateError } = await supabase
    .from("events")
    .update({
      status: "cancelled",
      cancelled_at: stamp,
      manager_notes: nextNotes,
      updated_by: session.profile.id,
    })
    .eq("id", eventId);

  if (updateError) {
    return { error: updateError.message };
  }

  await writeAudit({
    action: "event.cancel",
    entity_type: "event",
    entity_id: eventId,
    summary: `Cancelled event "${existing.title}"`,
    before: { status: existing.status },
    after: { status: "cancelled", reason: parsed.data.reason },
    actorType: "owner",
    actorId: session.profile.id,
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/events");
  revalidatePath(`/dashboard/events/${eventId}`);

  return { id: eventId };
}

/**
 * Replace the entire requirement set for an event. Uses delete+reinsert
 * because requirement rows have no stable client-side identity yet.
 */
export async function setEventRequirements(
  eventId: string,
  rawRequirements: EventRequirementInput[],
): Promise<{ ok?: true; error?: string }> {
  const session = await requireOwner();

  const requirements: EventRequirementInput[] = [];
  for (const r of rawRequirements) {
    const parsed = eventRequirementSchema.safeParse(r);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid requirement" };
    }
    requirements.push(parsed.data);
  }

  const supabase = await createClient();

  // Confirm the event exists and the caller can touch it.
  const { data: existing, error: fetchError } = await supabase
    .from("events")
    .select("id, title")
    .eq("id", eventId)
    .maybeSingle();
  if (fetchError || !existing) {
    return { error: "Event not found" };
  }

  // Delete-then-insert; both are RLS-checked.
  const { error: delError } = await supabase
    .from("event_requirements")
    .delete()
    .eq("event_id", eventId);
  if (delError) {
    return { error: delError.message };
  }

  if (requirements.length > 0) {
    const { error: insError } = await supabase
      .from("event_requirements")
      .insert(
        requirements.map((r) => ({
          event_id: eventId,
          label: r.label.trim(),
          required_count: r.required_count,
          role_id: r.role_id ?? null,
          qualification_id: r.qualification_id ?? null,
          notes: r.notes ?? null,
        })),
      );
    if (insError) {
      return { error: insError.message };
    }
  }

  await writeAudit({
    action: "event.requirements.set",
    entity_type: "event",
    entity_id: eventId,
    summary: `Replaced requirements for "${existing.title}" (${requirements.length} rows)`,
    after: { requirements },
    actorType: "owner",
    actorId: session.profile.id,
  });

  revalidatePath(`/dashboard/events/${eventId}`);

  return { ok: true };
}
