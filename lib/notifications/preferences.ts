// server-only: reads/writes via the request-scoped server client so RLS
// stays in force. Used by the preferences page (Server Components + actions).
if (typeof window !== "undefined") {
  throw new Error("lib/notifications/preferences.ts is server-only");
}

import { createClient as createServerClient } from "@/lib/db/supabase-server";
import type {
  NotificationPreference,
  NotificationPreferenceUpdate,
} from "@/lib/db/types";

/**
 * Fetch every per-event preference for a profile. Missing rows aren't filled
 * in here — callers should treat absence as "use defaults" (the schema already
 * encodes sane defaults in the column definitions).
 */
export async function getNotificationPreferences(
  profileId: string,
): Promise<NotificationPreference[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("notification_preferences")
    .select(
      "id, profile_id, event_type, in_app_enabled, email_enabled, sms_enabled, minimum_sms_severity, minimum_email_severity, quiet_hours_start, quiet_hours_end, created_at, updated_at",
    )
    .eq("profile_id", profileId)
    .order("event_type", { ascending: true });

  if (error) {
    throw new Error(
      `getNotificationPreferences: failed — ${error.message}`,
    );
  }

  return (data ?? []) as NotificationPreference[];
}

/**
 * Upsert a single (profile_id, event_type) preference row. Partial input is
 * merged on top of database defaults.
 */
export async function upsertNotificationPreference(
  profileId: string,
  eventType: string,
  partial: NotificationPreferenceUpdate,
): Promise<NotificationPreference> {
  const supabase = await createServerClient();

  const row = {
    profile_id: profileId,
    event_type: eventType,
    ...partial,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("notification_preferences")
    .upsert(row, { onConflict: "profile_id,event_type" })
    .select(
      "id, profile_id, event_type, in_app_enabled, email_enabled, sms_enabled, minimum_sms_severity, minimum_email_severity, quiet_hours_start, quiet_hours_end, created_at, updated_at",
    )
    .single();

  if (error) {
    throw new Error(
      `upsertNotificationPreference: failed — ${error.message}`,
    );
  }

  return data as NotificationPreference;
}
