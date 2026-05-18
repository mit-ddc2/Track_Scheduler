import Link from "next/link";

import { RecentResponses } from "@/components/dashboard/RecentResponses";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { EventCardStrip } from "@/components/events/EventCardStrip";
import { EventSpotlight } from "@/components/events/EventSpotlight";
import { requireOwner } from "@/lib/auth/require-owner";
import {
  formatDashboardSubtitle,
  getDashboardCounts,
} from "@/lib/dashboard/counts";
import { createClient as createServerClient } from "@/lib/db/supabase-server";
import { listUpcomingEvents } from "@/lib/events/queries";
import { monthWeekEyebrow } from "@/lib/events/format";

// Dashboard reads cookies via the server-side Supabase client, so the
// route can't be statically rendered.
export const dynamic = "force-dynamic";

/**
 * Dashboard home / events overview.
 *
 * The header subtitle ("3 events · 1 underfilled · 8 pending") is computed
 * live from `events` + `event_invites` via `getDashboardCounts`. The right
 * pane on desktop hosts the realtime `ActivityFeed`; on mobile it renders
 * below the events list.
 *
 * Phase 6 surfaces urgent `event.urgent_underfilled` notifications in the
 * header: when there's any unread urgent-underfill notification we prefer
 * its `event_id` as the spotlight (it's the most pressing event), and we
 * show a small "URGENT" badge alongside the upcoming-events count.
 */
export default async function DashboardHome() {
  const session = await requireOwner();

  // listUpcomingEvents(), getDashboardCounts(), and the urgent notifications
  // query are all independent — fan them out via Promise.all to save DB
  // round-trips per dashboard load. We instantiate the server client once
  // and share it.
  const supabase = await createServerClient();
  const [events, counts, urgentRes] = await Promise.all([
    listUpcomingEvents(),
    getDashboardCounts(),
    supabase
      .from("manager_notifications")
      .select("event_id, status, event_type")
      .eq("profile_id", session.profile.id)
      .eq("event_type", "event.urgent_underfilled")
      .eq("status", "unread")
      .limit(20),
  ]);
  const { data: urgentRows } = urgentRes;

  const urgentEventIds = new Set(
    ((urgentRows ?? []) as Array<{ event_id: string | null }>)
      .map((r) => r.event_id)
      .filter((id): id is string => Boolean(id)),
  );
  const urgentCount = urgentEventIds.size;

  const now = new Date();
  // Prefer an urgent-underfilled event for the spotlight when available;
  // otherwise fall back to the first status === 'underfilled' event.
  const urgentEvent =
    urgentEventIds.size > 0
      ? events.find((e) => urgentEventIds.has(e.id))
      : null;
  const spotlight =
    urgentEvent ?? events.find((e) => e.status === "underfilled") ?? null;

  const subtitle = formatDashboardSubtitle(counts);

  return (
    <div
      style={{
        padding: "20px 16px 32px",
        maxWidth: 1120,
        margin: "0 auto",
      }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="cs-eyebrow">{monthWeekEyebrow(now)}</span>
        <h1 className="cs-h1">Calabogie Safety</h1>
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--text-2)",
            letterSpacing: "0.04em",
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <span>{subtitle}</span>
          {urgentCount > 0 && (
            <Chip tone="bad">
              {urgentCount} URGENT · NEEDS REPLACEMENTS
            </Chip>
          )}
        </div>
      </header>

      <div
        className="dashboard-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 24,
          marginTop: 20,
        }}
      >
        <section style={{ minWidth: 0 }}>
          {spotlight && (
            <EventSpotlight
              event={{
                id: spotlight.id,
                title: spotlight.title,
                starts_at: spotlight.starts_at,
                ends_at: spotlight.ends_at,
                timezone: spotlight.timezone,
                status: spotlight.status,
                required_headcount: spotlight.required_headcount,
                confirmed: spotlight.confirmed,
                pending: spotlight.pending,
                declined: spotlight.declined,
              }}
            />
          )}

          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: 10,
            }}
          >
            <span className="cs-eyebrow">Upcoming · 30 days</span>
            <Link
              href="/dashboard/events/new"
              className="cs-btn cs-btn--sm"
              style={{ textDecoration: "none" }}
            >
              + NEW
            </Link>
          </div>

          {events.length === 0 ? (
            <Card style={{ padding: 24, textAlign: "center" }}>
              <p
                style={{
                  margin: 0,
                  color: "var(--text-2)",
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                No upcoming events in the next 30 days.
              </p>
              <Link
                href="/dashboard/events/new"
                style={{ display: "inline-block", marginTop: 14 }}
                className="cs-btn cs-btn--primary"
              >
                CREATE FIRST EVENT
              </Link>
            </Card>
          ) : (
            <Card>
              {events.map((e, idx) => (
                <div key={e.id}>
                  {idx > 0 && <hr className="cs-divider" />}
                  <EventCardStrip
                    event={{
                      id: e.id,
                      title: e.title,
                      event_type: e.event_type,
                      starts_at: e.starts_at,
                      ends_at: e.ends_at,
                      timezone: e.timezone,
                      status: e.status,
                      required_headcount: e.required_headcount,
                      confirmed: e.confirmed,
                      pending: e.pending,
                    }}
                  />
                </div>
              ))}
            </Card>
          )}

          {/* Mobile-only: recent responses lives below the events list. The
              desktop sidebar above hides this on md+ via the <style> block.
              v2: trimmed from the full activity feed to a focused "Last 5
              RSVPs" card; other event types still surface via the bell. */}
          <div
            className="dashboard-feed-mobile"
            style={{ marginTop: 24 }}
          >
            <RecentResponses variant="section" />
          </div>
        </section>

        {/* Desktop sidebar — visible only on md+ via the <style> block. */}
        <aside
          className="dashboard-feed-sidebar"
          style={{
            minWidth: 0,
            display: "none",
          }}
        >
          <RecentResponses variant="sidebar" />
        </aside>
      </div>

      <style>{`
        @media (min-width: 768px) {
          .dashboard-grid { grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr) !important; }
          .dashboard-feed-sidebar { display: block !important; }
          .dashboard-feed-mobile { display: none !important; }
        }
      `}</style>
    </div>
  );
}
