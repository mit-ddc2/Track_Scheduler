"use client";

/**
 * v2 (Wave B2): step 2 of the invite wizard — pick which days to invite
 * the selected responders for. Skipped entirely for single-day events.
 */

import { formatInTimeZone } from "date-fns-tz";

import { Card } from "@/components/ui/Card";

export type InviteDaysStepProps = {
  /** All YYYY-MM-DD days in the event window. */
  days: string[];
  /** Currently checked day_dates. */
  selected: Set<string>;
  onToggle: (date: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  timezone: string;
};

function formatDay(date: string, tz: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return formatInTimeZone(d, tz, "EEE · MMM d");
}

export function InviteDaysStep({
  days,
  selected,
  onToggle,
  onSelectAll,
  onClear,
  timezone,
}: InviteDaysStepProps) {
  return (
    <div style={{ padding: "14px 16px 8px" }}>
      <div className="cs-label" style={{ marginBottom: 10 }}>
        EVENT DAYS · {selected.size} of {days.length} selected
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        <button
          type="button"
          onClick={onSelectAll}
          style={linkBtn}
        >
          SELECT ALL DAYS
        </button>
        <button type="button" onClick={onClear} style={linkBtn}>
          CLEAR
        </button>
      </div>

      <Card>
        {days.map((date, i) => {
          const on = selected.has(date);
          return (
            <div key={date}>
              {i > 0 && <div className="cs-divider" />}
              <button
                type="button"
                onClick={() => onToggle(date)}
                aria-pressed={on}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 14px",
                  cursor: "pointer",
                  background: on ? "var(--surface-2)" : "transparent",
                  border: 0,
                  textAlign: "left",
                  color: "inherit",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 3,
                    flexShrink: 0,
                    background: on ? "var(--accent)" : "transparent",
                    border: `1.5px solid ${
                      on
                        ? "var(--accent)"
                        : "var(--line-2, rgba(255,255,255,0.2))"
                    }`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--accent-ink)",
                    fontWeight: 700,
                    fontSize: 12,
                  }}
                >
                  {on ? "✓" : ""}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {formatDay(date, timezone)}
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 10,
                      color: "var(--text-3)",
                      marginTop: 2,
                      letterSpacing: "0.04em",
                    }}
                  >
                    {date}
                  </div>
                </div>
              </button>
            </div>
          );
        })}
      </Card>

      <p
        style={{
          marginTop: 12,
          fontSize: 12,
          color: "var(--text-3)",
          lineHeight: 1.5,
        }}
      >
        Each invited responder will see exactly the days you select here on
        their RSVP screen — they can still accept a subset of those days.
      </p>
    </div>
  );
}

const linkBtn: React.CSSProperties = {
  background: "transparent",
  border: 0,
  color: "var(--accent)",
  font: "600 10px/1 var(--font-jetbrains-mono), monospace",
  letterSpacing: "0.1em",
  cursor: "pointer",
  textTransform: "uppercase",
  padding: 0,
};
