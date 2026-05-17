import { NotificationsLive } from "@/components/notifications/NotificationsLive";
import { requireOwner } from "@/lib/auth/require-owner";
import { createClient as createServerClient } from "@/lib/db/supabase-server";
import type { ManagerNotification } from "@/lib/db/types";

import { markAllRead, markNotificationRead } from "./actions";

// Activity Center is realtime — don't cache the SSR snapshot.
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const session = await requireOwner();
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from("manager_notifications")
    .select(
      "id, profile_id, severity, status, event_type, title, body, event_id, staff_member_id, related_entity_type, related_entity_id, dedupe_key, created_at, read_at",
    )
    .eq("profile_id", session.profile.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const notifications: ManagerNotification[] = (data ??
    []) as ManagerNotification[];

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
        <span className="cs-eyebrow">Inbox</span>
        <h1 className="cs-h1">Activity</h1>
      </div>

      {error && (
        <div
          role="alert"
          className="mono"
          style={{
            padding: 12,
            border: "1px solid var(--bad)",
            borderRadius: 4,
            color: "var(--bad)",
            fontSize: 11,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          Failed to load notifications: {error.message}
        </div>
      )}

      <NotificationsLive
        profileId={session.profile.id}
        initialNotifications={notifications}
        onMarkRead={markNotificationRead}
        onMarkAllRead={markAllRead}
      />
    </div>
  );
}
