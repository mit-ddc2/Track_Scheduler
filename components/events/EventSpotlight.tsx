import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";

import type { EventRow } from "@/lib/db/types";
import { formatTimeRange, shortCode } from "@/lib/events/format";

import { CoverageBar } from "./CoverageBar";
import { EventStatusChip } from "./EventStatusChip";

export type EventSpotlightData = Pick<
  EventRow,
  | "id"
  | "title"
  | "starts_at"
  | "ends_at"
  | "timezone"
  | "status"
  | "required_headcount"
> & {
  confirmed: number;
  pending: number;
  declined: number;
};

/**
 * Underfilled-event spotlight card. Mirrors the `ScreenEvents` spotlight in
 * /tmp/design_extracted/calabogie-track/project/mobile-screens.jsx — stripe
 * header, big confirmed/needed numbers, coverage bar + CTA buttons.
 */
export function EventSpotlight({ event }: { event: EventSpotlightData }) {
  const tz = event.timezone || "America/Toronto";
  const start = new Date(event.starts_at);
  const end = new Date(event.ends_at);
  const dateLabel = formatInTimeZone(start, tz, "EEE · MMM d").toUpperCase();
  const time = formatTimeRange(start, end, tz);
  const needed = event.required_headcount;
  const short = Math.max(0, needed - event.confirmed - event.pending);

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 4,
        overflow: "hidden",
        marginBottom: 20,
      }}
    >
      <div style={{ display: "flex", height: 6 }}>
        <div className="cs-stripes" style={{ width: 56 }} />
        <div style={{ flex: 1, background: "var(--accent)" }} />
      </div>
      <div style={{ padding: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 12,
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              className="cs-eyebrow"
              style={{ color: "var(--accent)", marginBottom: 4 }}
            >
              ● Needs Attention
            </div>
            <div className="cs-h2">{event.title}</div>
            <div
              className="mono"
              style={{
                fontSize: 11,
                color: "var(--text-2)",
                marginTop: 4,
                letterSpacing: "0.04em",
              }}
            >
              {dateLabel} · {time} · {shortCode(event.id)}
            </div>
          </div>
          <EventStatusChip status={event.status} />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 12,
            marginBottom: 14,
          }}
        >
          <span className="cs-data-xl" style={{ color: "var(--text)" }}>
            {event.confirmed}
            <span style={{ color: "var(--text-3)", fontSize: 18 }}>
              /{needed}
            </span>
          </span>
          <div style={{ flex: 1, paddingBottom: 6 }}>
            <CoverageBar
              confirmed={event.confirmed}
              pending={event.pending}
              needed={Math.max(needed, 1)}
              height={8}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 6,
              }}
            >
              <span className="cs-label">
                {event.pending} PENDING · {event.declined} DECLINED
              </span>
              {short > 0 && (
                <span className="cs-label" style={{ color: "var(--bad)" }}>
                  −{short} SHORT
                </span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {/* Phase 5 wires /invite — until then this link 404s, intentionally. */}
          <Link
            href={`/dashboard/events/${event.id}/invite`}
            className="cs-btn cs-btn--primary"
            style={{ flex: 1, textDecoration: "none" }}
          >
            FIND REPLACEMENTS
          </Link>
          <Link
            href={`/dashboard/events/${event.id}`}
            className="cs-btn"
            style={{ textDecoration: "none" }}
          >
            OPEN
          </Link>
        </div>
      </div>
    </div>
  );
}
