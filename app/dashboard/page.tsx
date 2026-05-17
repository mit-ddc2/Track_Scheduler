import Link from "next/link";

import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { EventCardStrip } from "@/components/events/EventCardStrip";
import { EventSpotlight } from "@/components/events/EventSpotlight";
import { requireOwner } from "@/lib/auth/require-owner";
import { createClient as createServerClient } from "@/lib/db/supabase-server";
import { listUpcomingEvents } from "@/lib/events/queries";
import { monthWeekEyebrow } from "@/lib/events/format";

// Dashboard reads cookies via the server-side Supabase client, so the
// route can't be statically rendered.
export const dynamic = "force-dynamic";

/**
 * Dashboard home / events overview.
 *
 * Phase 3 reads real `events` rows but reports placeholder coverage counts
 * (confirmed/pending = 0). Phase 5 will swap the zero-counts for an aggregate
 * over `event_invites` + `event_assignments`.
 *
 * Phase 6 surfaces urgent `event.urgent_underfilled` notifications in the
 * header: when there's any unread urgent-underfill notification we prefer
 * its `event_id` as the spotlight (it's the most pressing event), and we
 * show a small "URGENT" badge alongside the upcoming-events count.
 */
export default async function DashboardHome() {
  const session = await requireOwner();
  const events = await listUpcomingEvents();

  // Pull unread urgent_underfilled notifications so we can prefer them as
  // the spotlight + show a header badge. Cheap query — capped at 20 rows.
  const supabase = await createServerClient();
  const { data: urgentRows } = await supabase
    .from("manager_notifications")
    .select("event_id, status, event_type")
    .eq("profile_id", session.profile.id)
    .eq("event_type", "event.urgent_underfilled")
    .eq("status", "unread")
    .limit(20);

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

  const underfilledCount = events.filter(
    (e) => e.status === "underfilled",
  ).length;
  const pendingCount = events.reduce((acc, e) => acc + e.pending, 0);

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
          <span>
            {events.length} event{events.length === 1 ? "" : "s"} ·{" "}
            {underfilledCount} underfilled · {pendingCount} pending
          </span>
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
        </section>

        {/* Right pane — laptop only. Activity feed lands in Phase 4. */}
        {/* Visibility is controlled by the `<style>` block below; the project
            does not use Tailwind utility classes so `hidden md:block` would be
            a no-op. */}
        <aside
          style={{
            minWidth: 0,
            display: "none",
          }}
        >
          <Card style={{ padding: 16 }}>
            <span className="cs-eyebrow">Today · 0 events</span>
            <h2 className="cs-h3" style={{ marginTop: 10 }}>
              Activity feed
            </h2>
            <p
              style={{
                marginTop: 8,
                color: "var(--text-2)",
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              Live message + RSVP events arrive here in Phase 4.
            </p>
            <hr className="cs-divider" style={{ margin: "12px 0" }} />
            <span className="cs-eyebrow">Calendar sync</span>
            <p
              style={{
                marginTop: 8,
                color: "var(--text-2)",
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              Manual entry only — Google + ICS sync ships in v1.1.
            </p>
            <button
              type="button"
              className="cs-btn cs-btn--sm"
              style={{ marginTop: 12, opacity: 0.5, cursor: "not-allowed" }}
              disabled
            >
              SYNC NOW
            </button>
          </Card>
        </aside>
      </div>

      <style>{`
        @media (min-width: 768px) {
          .dashboard-grid { grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr) !important; }
          .dashboard-grid aside { display: block !important; }
        }
      `}</style>
    </div>
  );
}
