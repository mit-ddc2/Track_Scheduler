import { notFound } from "next/navigation";

import { requireOwner } from "@/lib/auth/require-owner";
import {
  EVENT_TYPES,
  EVENT_TYPE_KEYS,
  type NotificationEventType,
} from "@/lib/notifications/event-types";
import { getNotificationPreferences } from "@/lib/notifications/preferences";
import type { NotificationPreference } from "@/lib/db/types";

import { updateNotificationPreferences } from "../../notifications/actions";
import { PreferencesForm } from "./PreferencesForm";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<{ advanced?: string }>;
};

export default async function NotificationsSettingsPage({
  searchParams,
}: PageProps = {}) {
  const session = await requireOwner();
  // v2: hidden from simplified settings nav; ?advanced=1 unlocks it.
  const params = searchParams ? await searchParams : {};
  if (params.advanced !== "1") {
    notFound();
  }
  const existing = await getNotificationPreferences(session.profile.id);

  const byEventType = new Map<string, NotificationPreference>();
  for (const pref of existing) byEventType.set(pref.event_type, pref);

  // Materialise a row per known event_type so the UI is complete even before
  // any preference rows exist for the owner.
  const rows = EVENT_TYPE_KEYS.map((eventType: NotificationEventType) => {
    const pref = byEventType.get(eventType);
    return {
      eventType,
      label: EVENT_TYPES[eventType].label,
      description: EVENT_TYPES[eventType].description,
      in_app_enabled: pref?.in_app_enabled ?? true,
      email_enabled: pref?.email_enabled ?? false,
      sms_enabled: pref?.sms_enabled ?? false,
      minimum_sms_severity: pref?.minimum_sms_severity ?? "urgent",
      minimum_email_severity: pref?.minimum_email_severity ?? "warning",
      quiet_hours_start: pref?.quiet_hours_start ?? null,
      quiet_hours_end: pref?.quiet_hours_end ?? null,
    };
  });

  return (
    <div
      style={{
        padding: "20px 16px 32px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        maxWidth: 960,
        margin: "0 auto",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="cs-eyebrow">Owner · Settings</span>
        <h1 className="cs-h1">Notifications</h1>
        <p style={{ color: "var(--text-2)", fontSize: 13, margin: 0 }}>
          Choose how you hear about each kind of event. In-app messages always
          appear in the Activity center; email and SMS are best for urgent
          issues only.
        </p>
      </div>

      <PreferencesForm
        rows={rows}
        action={updateNotificationPreferences}
      />
    </div>
  );
}
