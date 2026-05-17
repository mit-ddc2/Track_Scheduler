"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOwner } from "@/lib/auth/require-owner";
import { writeAudit } from "@/lib/db/audit";
import { createClient as createServerClient } from "@/lib/db/supabase-server";
import type { NotificationSeverity } from "@/lib/db/types";
import { upsertNotificationPreference } from "@/lib/notifications/preferences";

const uuidSchema = z.string().uuid();

export type ActionResult = { ok: true } | { ok: false; error: string };

const SEVERITY_VALUES = ["info", "warning", "urgent"] as const;

const preferenceSchema = z.object({
  eventType: z.string().min(1),
  in_app_enabled: z.boolean().optional(),
  email_enabled: z.boolean().optional(),
  sms_enabled: z.boolean().optional(),
  minimum_sms_severity: z.enum(SEVERITY_VALUES).optional(),
  minimum_email_severity: z.enum(SEVERITY_VALUES).optional(),
  // Times as HH:MM strings or null to clear.
  quiet_hours_start: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .nullable()
    .optional(),
  quiet_hours_end: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .nullable()
    .optional(),
});

export type PreferenceInput = z.infer<typeof preferenceSchema>;

/** Mark a single notification as read. Owner-only. */
export async function markNotificationRead(
  notificationId: string,
): Promise<ActionResult> {
  const session = await requireOwner();
  const parse = uuidSchema.safeParse(notificationId);
  if (!parse.success) {
    return { ok: false, error: "Invalid notification id." };
  }

  const supabase = await createServerClient();
  const { error } = await supabase
    .from("manager_notifications")
    .update({ status: "read", read_at: new Date().toISOString() })
    .eq("id", parse.data)
    .eq("profile_id", session.profile.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/notifications");
  return { ok: true };
}

/** Mark all of the current owner's unread notifications as read. */
export async function markAllRead(): Promise<ActionResult> {
  const session = await requireOwner();
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("manager_notifications")
    .update({ status: "read", read_at: new Date().toISOString() })
    .eq("profile_id", session.profile.id)
    .eq("status", "unread");

  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/notifications");
  revalidatePath("/dashboard");
  return { ok: true };
}

/** Archive a notification. Owner-only. */
export async function archiveNotification(
  notificationId: string,
): Promise<ActionResult> {
  const session = await requireOwner();
  const parse = uuidSchema.safeParse(notificationId);
  if (!parse.success) {
    return { ok: false, error: "Invalid notification id." };
  }

  const supabase = await createServerClient();
  const { error } = await supabase
    .from("manager_notifications")
    .update({ status: "archived" })
    .eq("id", parse.data)
    .eq("profile_id", session.profile.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/notifications");
  return { ok: true };
}

/**
 * Upsert one preference row. Pass partial fields; defaults handle the rest.
 * Writes an audit entry per change (best-effort; never throws).
 */
export async function updateNotificationPreferences(
  input: PreferenceInput,
): Promise<ActionResult> {
  const session = await requireOwner();
  const parse = preferenceSchema.safeParse(input);
  if (!parse.success) {
    return { ok: false, error: parse.error.message };
  }
  const { eventType, ...rest } = parse.data;

  try {
    const updated = await upsertNotificationPreference(
      session.profile.id,
      eventType,
      rest as {
        in_app_enabled?: boolean;
        email_enabled?: boolean;
        sms_enabled?: boolean;
        minimum_sms_severity?: NotificationSeverity;
        minimum_email_severity?: NotificationSeverity;
        quiet_hours_start?: string | null;
        quiet_hours_end?: string | null;
      },
    );

    await writeAudit({
      action: "notification_preference.updated",
      entity_type: "notification_preference",
      entity_id: updated.id,
      summary: `Updated preference for ${eventType}`,
      after: updated,
      actorId: session.profile.id,
    });

    revalidatePath("/dashboard/settings/notifications");
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
