import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";

import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { EventCardStrip, shortCode } from "@/components/events/EventCardStrip";
import { EventStatusChip } from "@/components/events/EventStatusChip";
import { listAllEvents } from "@/lib/events/queries";
import { formatTimeRange } from "@/lib/events/format";
import type { EventStatus } from "@/lib/db/types";

const FILTER_CHIPS: Array<{ key: string; label: string; status?: EventStatus }> = [
  { key: "all", label: "ALL" },
  { key: "underfilled", label: "SHORT", status: "underfilled" },
  { key: "inviting", label: "INVITING", status: "inviting" },
  { key: "staffed", label: "STAFFED", status: "staffed" },
  { key: "scheduled", label: "SCHEDULED", status: "scheduled" },
  { key: "cancelled", label: "CANCELLED", status: "cancelled" },
];

type PageParams = {
  searchParams: Promise<{ status?: string; past?: string }>;
};

export default async function EventsIndexPage({ searchParams }: PageParams) {
  const params = await searchParams;
  const status = params.status ?? "all";
  const showPast = params.past === "1";
  const events = await listAllEvents({ status, showPast });

  return (
    <div
      style={{
        padding: "20px 16px 32px",
        maxWidth: 1120,
        margin: "0 auto",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div>
          <span className="cs-eyebrow">Crew</span>
          <h1 className="cs-h1" style={{ marginTop: 6 }}>
            Events
          </h1>
          <p
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--text-2)",
              letterSpacing: "0.04em",
              marginTop: 6,
            }}
          >
            {events.length} event{events.length === 1 ? "" : "s"} ·{" "}
            {showPast ? "incl. past 365 days" : "upcoming 365 days"}
          </p>
        </div>
        <Link
          href="/dashboard/events/new"
          className="cs-btn cs-btn--primary"
          style={{ textDecoration: "none" }}
        >
          + NEW EVENT
        </Link>
      </header>

      <div
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        {FILTER_CHIPS.map((c) => {
          const active = (status ?? "all") === c.key;
          const href = `/dashboard/events?status=${c.key}${showPast ? "&past=1" : ""}`;
          return (
            <Link
              key={c.key}
              href={href}
              style={{ textDecoration: "none" }}
            >
              <Chip tone={active ? "accent" : "default"}>{c.label}</Chip>
            </Link>
          );
        })}
        <Link
          href={`/dashboard/events?status=${status}${showPast ? "" : "&past=1"}`}
          style={{ textDecoration: "none", marginLeft: "auto" }}
        >
          <Chip tone={showPast ? "info" : "default"}>
            {showPast ? "HIDE PAST" : "SHOW PAST"}
          </Chip>
        </Link>
      </div>

      {events.length === 0 ? (
        <Card style={{ padding: 24, textAlign: "center" }}>
          <p style={{ margin: 0, color: "var(--text-2)", fontSize: 13 }}>
            No events match the current filters.
          </p>
        </Card>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="events-mobile">
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
          </div>

          {/* Desktop table */}
          <div className="events-desk">
            <Card style={{ padding: 0, overflow: "hidden" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr
                    style={{
                      background: "var(--bg-2)",
                      color: "var(--text-3)",
                    }}
                  >
                    {[
                      "Date",
                      "Title",
                      "Source",
                      "Status",
                      "Req",
                      "OK",
                      "Pend",
                      "Short",
                    ].map((h) => (
                      <th
                        key={h}
                        className="cs-label"
                        style={{
                          textAlign: "left",
                          padding: "10px 12px",
                          borderBottom: "1px solid var(--line)",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => {
                    const short = Math.max(
                      0,
                      e.required_headcount - e.confirmed - e.pending,
                    );
                    const dateLabel = formatInTimeZone(
                      new Date(e.starts_at),
                      e.timezone || "America/Toronto",
                      "EEE MMM d",
                    );
                    return (
                      <tr
                        key={e.id}
                        style={{ borderBottom: "1px solid var(--line)" }}
                      >
                        <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                          <div style={{ fontWeight: 600 }}>{dateLabel}</div>
                          <div
                            className="mono"
                            style={{
                              fontSize: 11,
                              color: "var(--text-3)",
                              marginTop: 2,
                              letterSpacing: "0.04em",
                            }}
                          >
                            {formatTimeRange(
                              e.starts_at,
                              e.ends_at,
                              e.timezone || "America/Toronto",
                            )}
                          </div>
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          <Link
                            href={`/dashboard/events/${e.id}`}
                            style={{
                              color: "var(--text)",
                              textDecoration: "none",
                              fontWeight: 600,
                            }}
                          >
                            {e.title}
                          </Link>
                          <div
                            className="mono"
                            style={{
                              fontSize: 10,
                              color: "var(--text-3)",
                              marginTop: 2,
                              letterSpacing: "0.04em",
                            }}
                          >
                            {shortCode(e.id)}
                          </div>
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          <Chip>{(e.source_type || "manual").toUpperCase()}</Chip>
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          <EventStatusChip status={e.status} />
                        </td>
                        <td
                          style={{
                            padding: "10px 12px",
                            textAlign: "right",
                            fontVariantNumeric: "tabular-nums",
                          }}
                          className="mono"
                        >
                          {e.required_headcount}
                        </td>
                        <td
                          style={{
                            padding: "10px 12px",
                            textAlign: "right",
                            color: "var(--ok)",
                            fontVariantNumeric: "tabular-nums",
                          }}
                          className="mono"
                        >
                          {e.confirmed}
                        </td>
                        <td
                          style={{
                            padding: "10px 12px",
                            textAlign: "right",
                            color: "var(--warn)",
                            fontVariantNumeric: "tabular-nums",
                          }}
                          className="mono"
                        >
                          {e.pending}
                        </td>
                        <td
                          style={{
                            padding: "10px 12px",
                            textAlign: "right",
                            color: short > 0 ? "var(--bad)" : "var(--text-3)",
                            fontVariantNumeric: "tabular-nums",
                          }}
                          className="mono"
                        >
                          {short > 0 ? `−${short}` : "0"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          </div>
        </>
      )}

      <style>{`
        .events-mobile { display: block; }
        .events-desk { display: none; }
        @media (min-width: 768px) {
          .events-mobile { display: none; }
          .events-desk { display: block; }
        }
      `}</style>
    </div>
  );
}
