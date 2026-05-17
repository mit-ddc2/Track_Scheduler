import { Card } from "@/components/ui/Card";
import { requireOwner } from "@/lib/auth/require-owner";
import {
  ACTIVITY_FEED_LIMIT,
  fetchActivityFeed,
  type ActivityItem,
} from "@/lib/dashboard/activity-feed";

import { ActivityFeedLive } from "./ActivityFeedLive";

export type ActivityFeedProps = {
  /**
   * Tweaks the surrounding shell so the same component can render in the
   * desktop right pane (`sidebar`) or as a section below the events list
   * on mobile (`section`).
   */
  variant?: "sidebar" | "section";
};

/**
 * Server-rendered shell for the dashboard "Live feed". Pulls the initial
 * 20-item timeline from `audit_log` + `manager_notifications` +
 * `invite_response_history`, then hands off to the client `ActivityFeedLive`
 * for realtime prepends.
 */
export async function ActivityFeed({ variant = "sidebar" }: ActivityFeedProps) {
  const session = await requireOwner();
  let initialItems: ActivityItem[] = [];
  try {
    initialItems = await fetchActivityFeed(session.profile.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[ActivityFeed] fetch failed:", msg);
  }

  const todayLabel = formatTodayLabel(initialItems);

  return (
    <Card style={{ padding: 0 }}>
      <div style={{ padding: "12px 14px 8px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span className="cs-eyebrow">{todayLabel}</span>
          <span
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--text-3)",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            auto-updating
          </span>
        </div>
        <h2
          className="cs-h3"
          style={{ marginTop: 6, fontSize: variant === "section" ? 16 : 14 }}
        >
          Live feed
        </h2>
      </div>
      <ActivityFeedLive
        profileId={session.profile.id}
        initialItems={initialItems}
        limit={ACTIVITY_FEED_LIMIT}
      />
    </Card>
  );
}

function formatTodayLabel(items: ActivityItem[]): string {
  const today = new Date();
  const sameDay = items.filter((it) => {
    const d = new Date(it.createdAt);
    return (
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    );
  }).length;
  return `Today · ${sameDay} event${sameDay === 1 ? "" : "s"}`;
}
