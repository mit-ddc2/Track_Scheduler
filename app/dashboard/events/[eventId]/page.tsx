import Link from "next/link";
import { notFound } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";

import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { CoverageBar } from "@/components/events/CoverageBar";
import { EventInvitesLive } from "@/components/events/EventInvitesLive";
import { EventStatusChip } from "@/components/events/EventStatusChip";
import { MiniStat } from "@/components/events/MiniStat";
import { requireOwner } from "@/lib/auth/require-owner";
import { createClient } from "@/lib/db/supabase-server";
import { computeCoverage } from "@/lib/events/coverage";
import {
  daysOut,
  formatEventDate,
  formatTimeRange,
  shortCode,
} from "@/lib/events/format";
import {
  getEvent,
  getEventCoverageRows,
  listEventRequirements,
} from "@/lib/events/queries";

type PageProps = {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ tab?: string }>;
};

type Tab = { id: string; label: string; disabled?: boolean };

const TABS: ReadonlyArray<Tab> = [
  { id: "overview", label: "Overview" },
  { id: "requirements", label: "Requirements" },
  { id: "roster", label: "Roster" },
  { id: "messages", label: "Messages" },
];

export default async function EventDetailPage({ params, searchParams }: PageProps) {
  await requireOwner();
  const { eventId } = await params;
  const { tab: tabParam } = await searchParams;
  const tab = tabParam ?? "overview";

  const event = await getEvent(eventId);
  if (!event) notFound();

  const supabase = await createClient();
  const [requirements, coverageRows, rosterRows, messagesRows] = await Promise.all([
    listEventRequirements(eventId),
    getEventCoverageRows(eventId),
    tab === "roster"
      ? supabase
          .from("event_invites")
          .select(
            "id, status, response_note, responded_at, selected_channels, staff_members(id, display_name)",
          )
          .eq("event_id", eventId)
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [] as unknown[], error: null }),
    tab === "messages"
      ? supabase
          .from("message_outbox")
          .select(
            "id, channel, to_value, status, sent_at, error_code, error_message, created_at",
          )
          .order("created_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ]);
  const coverage = computeCoverage(
    coverageRows.invites,
    coverageRows.assignments,
    event.required_headcount,
  );
  const hasInvites = coverageRows.invites.length > 0;
  type RosterRow = {
    id: string;
    status: string;
    response_note: string | null;
    selected_channels: string[] | null;
    staff_members: { id: string; display_name: string } | null;
  };
  type MessageRow = {
    id: string;
    channel: string;
    to_value: string;
    status: string;
    sent_at: string | null;
    error_code: string | null;
    error_message: string | null;
    created_at: string;
  };
  const rosterList = (rosterRows.data ?? []) as RosterRow[];
  const messageList = (messagesRows.data ?? []) as MessageRow[];
  const days = daysOut(event.starts_at, new Date(), event.timezone);
  const tz = event.timezone || "America/Toronto";

  return (
    <div style={{ position: "relative", paddingBottom: 96 }}>
      <EventInvitesLive eventId={event.id} />
      <div
        style={{
          padding: "20px 16px 0",
          maxWidth: 720,
          margin: "0 auto",
        }}
      >
        <header style={{ marginBottom: 16 }}>
          <span className="cs-eyebrow">{shortCode(event.id)}</span>
          <h1 className="cs-h1" style={{ marginTop: 6 }}>
            {event.title}
          </h1>
          <div
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--text-2)",
              letterSpacing: "0.04em",
              marginTop: 6,
            }}
          >
            {formatEventDate(event.starts_at, event.ends_at, tz).toUpperCase()} ·{" "}
            {formatTimeRange(event.starts_at, event.ends_at, tz)}
          </div>
        </header>

        {/* Big number block */}
        <Card style={{ padding: 16, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
            <div>
              <div className="cs-label" style={{ marginBottom: 8 }}>
                Confirmed / Needed
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                <span
                  className="cs-data-xl"
                  style={{
                    fontSize: 48,
                    color:
                      coverage.short > 0
                        ? "var(--bad)"
                        : event.required_headcount === 0
                          ? "var(--text-3)"
                          : "var(--ok)",
                  }}
                >
                  {coverage.confirmed}
                </span>
                <span
                  className="cs-data-xl"
                  style={{ fontSize: 28, color: "var(--text-3)" }}
                >
                  /{event.required_headcount}
                </span>
              </div>
            </div>
            <div style={{ flex: 1, paddingBottom: 8 }}>
              <CoverageBar
                confirmed={coverage.confirmed}
                pending={coverage.pending}
                needed={Math.max(event.required_headcount, 1)}
                height={10}
              />
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 0,
              marginTop: 14,
              paddingTop: 14,
              borderTop: "1px solid var(--line)",
            }}
          >
            <MiniStat n={coverage.confirmed} label="OK" tone="ok" />
            <MiniStat n={coverage.pending} label="PEND" tone="warn" />
            <MiniStat n={coverage.declined} label="DECL" tone="bad" />
            <MiniStat
              n={coverage.short}
              label="SHORT"
              tone={coverage.short > 0 ? "bad" : "idle"}
            />
          </div>
          {!hasInvites && (
            <p
              style={{
                marginTop: 14,
                padding: 10,
                border: "1px dashed var(--line)",
                borderRadius: 4,
                color: "var(--text-3)",
                fontSize: 12,
                textAlign: "center",
              }}
            >
              No invitations sent yet — use SEND INVITES below to get started.
            </p>
          )}
        </Card>

        {/* Meta chips */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 16,
          }}
        >
          {event.location && <Chip>{event.location}</Chip>}
          {event.event_type && (
            <Chip>{event.event_type.toUpperCase()}</Chip>
          )}
          <Chip tone={days < 0 ? "default" : "info"}>
            {days >= 0 ? `T-${days}D` : `${Math.abs(days)}D AGO`}
          </Chip>
          <EventStatusChip status={event.status} />
        </div>

        {/* Tabs */}
        <div
          role="tablist"
          aria-label="Event detail sections"
          style={{
            display: "flex",
            gap: 0,
            borderBottom: "1px solid var(--line)",
            marginBottom: 16,
          }}
        >
          {TABS.map((t) => {
            const active = tab === t.id;
            const href = t.disabled
              ? "#"
              : `/dashboard/events/${event.id}?tab=${t.id}`;
            return (
              <Link
                key={t.id}
                id={`event-tab-${t.id}`}
                href={href}
                role="tab"
                aria-selected={active}
                aria-disabled={t.disabled || undefined}
                aria-controls={active ? `event-tabpanel-${t.id}` : undefined}
                tabIndex={active ? 0 : -1}
                style={{
                  flex: 1,
                  padding: "12px 0",
                  textAlign: "center",
                  font: "600 11px/1 Inter, sans-serif",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: t.disabled
                    ? "var(--text-3)"
                    : active
                      ? "var(--text)"
                      : "var(--text-3)",
                  textDecoration: "none",
                  borderBottom: `2px solid ${active ? "var(--accent)" : "transparent"}`,
                  marginBottom: -1,
                  pointerEvents: t.disabled ? "none" : "auto",
                  opacity: t.disabled ? 0.5 : 1,
                }}
              >
                {t.label}
              </Link>
            );
          })}
        </div>

        {tab === "overview" && (
          <div
            id="event-tabpanel-overview"
            role="tabpanel"
            aria-labelledby="event-tab-overview"
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            <Card style={{ padding: 16 }}>
              <span className="cs-label">Description</span>
              <p
                style={{
                  marginTop: 8,
                  color: "var(--text-2)",
                  fontSize: 13,
                  lineHeight: 1.55,
                  whiteSpace: "pre-wrap",
                }}
              >
                {event.description?.trim() || "—"}
              </p>
            </Card>
            <Card style={{ padding: 16 }}>
              <span className="cs-label">Manager notes</span>
              <p
                style={{
                  marginTop: 8,
                  color: "var(--text-2)",
                  fontSize: 13,
                  lineHeight: 1.55,
                  whiteSpace: "pre-wrap",
                }}
              >
                {event.manager_notes?.trim() || "—"}
              </p>
            </Card>
            <Card style={{ padding: 16 }}>
              <span className="cs-label">Source</span>
              <p
                className="mono"
                style={{
                  marginTop: 8,
                  fontSize: 12,
                  color: "var(--text-2)",
                  letterSpacing: "0.04em",
                }}
              >
                {(event.source_type || "manual").toUpperCase()} ·{" "}
                {formatInTimeZone(
                  new Date(event.created_at),
                  tz,
                  "MMM d, yyyy HH:mm",
                )}
              </p>
            </Card>
            <div style={{ display: "flex", gap: 8 }}>
              <Link
                href={`/dashboard/events/${event.id}/edit`}
                className="cs-btn"
                style={{ flex: 1, textDecoration: "none" }}
              >
                EDIT
              </Link>
              <Link
                href={`/dashboard/events/${event.id}/cancel`}
                className="cs-btn cs-btn--danger"
                style={{ textDecoration: "none" }}
              >
                CANCEL EVENT
              </Link>
            </div>
          </div>
        )}

        {tab === "requirements" && (
          <Card
            id="event-tabpanel-requirements"
            role="tabpanel"
            aria-labelledby="event-tab-requirements"
          >
            {requirements.length === 0 ? (
              <div
                style={{
                  padding: 24,
                  textAlign: "center",
                  color: "var(--text-3)",
                  fontSize: 12,
                }}
              >
                No structured requirements set. The headcount of{" "}
                {event.required_headcount} is the simple-mode requirement.
              </div>
            ) : (
              requirements.map((r, idx) => (
                <div key={r.id}>
                  {idx > 0 && <hr className="cs-divider" />}
                  <div
                    style={{
                      padding: 14,
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <div
                      style={{
                        width: 4,
                        alignSelf: "stretch",
                        background: "var(--bad)",
                        borderRadius: 2,
                      }}
                    />
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <span style={{ fontWeight: 600, fontSize: 14 }}>
                          {r.label}
                        </span>
                        <span
                          className="cs-data-lg mono tnum"
                          style={{ fontSize: 16, color: "var(--bad)" }}
                        >
                          0/{r.required_count}
                        </span>
                      </div>
                      {r.notes && (
                        <div
                          className="cs-label"
                          style={{ marginTop: 4, color: "var(--text-3)" }}
                        >
                          {r.notes}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </Card>
        )}

        {tab === "roster" && (
          <Card
            id="event-tabpanel-roster"
            role="tabpanel"
            aria-labelledby="event-tab-roster"
          >
            {rosterList.length === 0 ? (
              <div
                style={{
                  padding: 24,
                  textAlign: "center",
                  color: "var(--text-3)",
                  fontSize: 12,
                }}
              >
                No invitations sent yet for this event.
              </div>
            ) : (
              rosterList.map((r, idx) => (
                <div key={r.id}>
                  {idx > 0 && <hr className="cs-divider" />}
                  <div
                    style={{
                      padding: 14,
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>
                        {r.staff_members?.display_name ?? "(unknown)"}
                      </div>
                      {r.response_note && (
                        <div
                          style={{
                            marginTop: 4,
                            fontSize: 12,
                            color: "var(--text-3)",
                          }}
                        >
                          “{r.response_note}”
                        </div>
                      )}
                    </div>
                    <Chip
                      tone={
                        r.status === "accepted"
                          ? "ok"
                          : r.status === "declined" ||
                              r.status === "cancelled_by_member" ||
                              r.status === "cancelled_by_manager"
                            ? "bad"
                            : r.status === "invited"
                              ? "warn"
                              : "default"
                      }
                    >
                      {r.status.replace(/_/g, " ").toUpperCase()}
                    </Chip>
                  </div>
                </div>
              ))
            )}
          </Card>
        )}

        {tab === "messages" && (
          <Card
            id="event-tabpanel-messages"
            role="tabpanel"
            aria-labelledby="event-tab-messages"
          >
            {messageList.length === 0 ? (
              <div
                style={{
                  padding: 24,
                  textAlign: "center",
                  color: "var(--text-3)",
                  fontSize: 12,
                }}
              >
                No outbound messages yet. After SEND INVITES the cron job
                drains the outbox every minute.
              </div>
            ) : (
              messageList.map((m, idx) => (
                <div key={m.id}>
                  {idx > 0 && <hr className="cs-divider" />}
                  <div
                    style={{
                      padding: 14,
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <Chip>{m.channel.toUpperCase()}</Chip>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        className="mono"
                        style={{
                          fontSize: 12,
                          color: "var(--text)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {m.to_value}
                      </div>
                      {m.error_message && (
                        <div
                          style={{
                            marginTop: 4,
                            fontSize: 11,
                            color: "var(--bad)",
                          }}
                        >
                          {m.error_code ?? "ERROR"}: {m.error_message}
                        </div>
                      )}
                    </div>
                    <Chip
                      tone={
                        m.status === "sent"
                          ? "ok"
                          : m.status === "failed" || m.status === "cancelled"
                            ? "bad"
                            : "warn"
                      }
                    >
                      {m.status.toUpperCase()}
                    </Chip>
                  </div>
                </div>
              ))
            )}
          </Card>
        )}
      </div>

      {/*
        Sticky bottom action bar. Phase 5 wires both buttons:
        /invite ships the invite flow, /attendance ships post-event check-in.

        Centering note: a `position: fixed` element with `left:0 right:0`
        cannot be centred by `margin: 0 auto`. We use a fixed full-width
        outer wrapper as a flex container (so `justify-content: center`
        actually centres the inner bar) and constrain max-width on the
        inner bar instead. On desktop (>=768px) the bottom nav rail is
        gone, so bottom offset drops from 64 to 0.
      */}
      <div className="cs-event-actionbar-wrap">
        <div className="cs-event-actionbar">
          <Link
            href={`/dashboard/events/${event.id}/invite`}
            className="cs-btn cs-btn--primary cs-btn--lg"
            style={{ flex: 1, textDecoration: "none" }}
          >
            SEND INVITES
          </Link>
          <Link
            href={`/dashboard/events/${event.id}/attendance`}
            className="cs-btn cs-btn--lg"
            style={{ textDecoration: "none" }}
          >
            ATTENDANCE
          </Link>
        </div>
      </div>
      <style>{`
        .cs-event-actionbar-wrap {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 64px;
          display: flex;
          justify-content: center;
          pointer-events: none;
          padding: 0 16px;
          background: linear-gradient(to top, var(--bg) 60%, transparent);
        }
        .cs-event-actionbar {
          pointer-events: auto;
          width: 100%;
          max-width: 720px;
          display: flex;
          gap: 8px;
          padding: 12px 0;
        }
        @media (min-width: 768px) {
          .cs-event-actionbar-wrap { bottom: 0; }
        }
      `}</style>
    </div>
  );
}
