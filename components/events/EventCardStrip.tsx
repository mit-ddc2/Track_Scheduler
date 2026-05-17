import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";

import { Chip } from "@/components/ui/Chip";
import type { EventRow } from "@/lib/db/types";
import { formatTimeRange, shortCode } from "@/lib/events/format";

import { CoverageBar } from "./CoverageBar";
import { EventStatusChip } from "./EventStatusChip";

export type EventStripData = Pick<
  EventRow,
  | "id"
  | "title"
  | "event_type"
  | "starts_at"
  | "ends_at"
  | "timezone"
  | "status"
  | "required_headcount"
> & {
  confirmed: number;
  pending: number;
  code?: string | null;
};

export type EventCardStripProps = {
  event: EventStripData;
};

/**
 * Strip-style event row: date stack | title + meta + coverage bar.
 * Mirrors EventRow in mobile-screens.jsx — the committed look per spec.
 */
export function EventCardStrip({ event }: EventCardStripProps) {
  const tz = event.timezone || "America/Toronto";
  const start = new Date(event.starts_at);
  const end = new Date(event.ends_at);
  const dow = formatInTimeZone(start, tz, "EEE").toUpperCase();
  const day = formatInTimeZone(start, tz, "d");
  const mon = formatInTimeZone(start, tz, "MMM").toUpperCase();
  const code = event.code ?? shortCode(event.id);
  const time = formatTimeRange(start, end, tz);
  const needed = event.required_headcount;
  const short = Math.max(0, needed - event.confirmed - event.pending);

  return (
    <Link
      href={`/dashboard/events/${event.id}`}
      style={{
        padding: 14,
        display: "flex",
        gap: 12,
        alignItems: "stretch",
        textDecoration: "none",
        color: "var(--text)",
      }}
    >
      <div
        style={{
          width: 52,
          borderRight: "1px solid var(--line)",
          paddingRight: 12,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          className="mono"
          style={{ fontSize: 9, color: "var(--text-3)", letterSpacing: "0.08em" }}
        >
          {dow}
        </div>
        <div className="cs-data-lg" style={{ marginTop: 2 }}>
          {day}
        </div>
        <div
          className="mono"
          style={{
            fontSize: 9,
            color: "var(--text-3)",
            letterSpacing: "0.08em",
            marginTop: 2,
          }}
        >
          {mon}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 8,
            marginBottom: 4,
          }}
        >
          <div
            style={{
              fontWeight: 600,
              fontSize: 14,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            {event.title}
          </div>
          <EventStatusChip status={event.status} />
        </div>
        <div
          className="mono"
          style={{
            fontSize: 10,
            color: "var(--text-3)",
            letterSpacing: "0.04em",
            marginBottom: 8,
          }}
        >
          {code} · {time}
          {event.event_type ? ` · ${event.event_type.toUpperCase()}` : ""}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <CoverageBar
              confirmed={event.confirmed}
              pending={event.pending}
              needed={Math.max(needed, 1)}
            />
          </div>
          <span
            className="mono tnum"
            style={{
              fontSize: 11,
              color: "var(--text-2)",
              fontWeight: 700,
            }}
          >
            {event.confirmed}
            <span style={{ color: "var(--text-3)" }}>/{needed}</span>
          </span>
          {short > 0 && (
            <Chip tone="bad" style={{ padding: "2px 5px", fontSize: 9 }}>
              −{short}
            </Chip>
          )}
        </div>
      </div>
    </Link>
  );
}

// `shortCode` has moved to `@/lib/events/format`. Re-exported here for
// backward compatibility with the dashboard and event detail pages until
// callers migrate to the new import path.
export { shortCode } from "@/lib/events/format";
