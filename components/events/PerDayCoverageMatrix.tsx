/**
 * Per-day staffing matrix for multi-day events (v2 — Wave B2).
 *
 * Renders one row per day in the event window. On wide viewports the rows
 * are stacked as a horizontally scrolling table-like grid; on phones each
 * row becomes a stacked card.
 *
 * Pure presentation — no data fetching here. Coverage data is computed by
 * `computeCoverageByDay()` upstream.
 */

import { formatInTimeZone } from "date-fns-tz";

import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import type { CoverageByDay, DayCoverage } from "@/lib/events/coverage";

export type PerDayCoverageMatrixProps = {
  coverage: CoverageByDay;
  /** Timezone the dates should render in. Defaults to America/Toronto. */
  timezone?: string;
  /** Whether anyone has been invited at all — drives the empty-state copy. */
  hasInvites: boolean;
};

function dayStatus(d: DayCoverage, hasInvites: boolean): {
  label: string;
  tone: "ok" | "warn" | "bad" | "default";
} {
  if (!hasInvites) return { label: "NOT INVITED", tone: "default" };
  if (d.confirmed === 0 && d.pending === 0 && d.declined === 0) {
    return { label: "NOT INVITED", tone: "default" };
  }
  if (d.needed > 0 && d.confirmed >= d.needed) return { label: "STAFFED", tone: "ok" };
  return { label: "SHORT", tone: "bad" };
}

function formatDay(date: string, tz: string): string {
  // `date` is YYYY-MM-DD — anchor as UTC noon so the date doesn't flip in any tz.
  const d = new Date(`${date}T12:00:00Z`);
  return formatInTimeZone(d, tz, "EEE MMM d");
}

export function PerDayCoverageMatrix({
  coverage,
  timezone = "America/Toronto",
  hasInvites,
}: PerDayCoverageMatrixProps) {
  const fullyStaffed = coverage.days.filter(
    (d) => d.needed > 0 && d.confirmed >= d.needed,
  ).length;
  const totalDays = coverage.days.length;

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 8,
        }}
      >
        <span className="cs-label">PER-DAY STAFFING</span>
        <span
          className="mono"
          style={{
            fontSize: 11,
            color: fullyStaffed === totalDays && totalDays > 0
              ? "var(--ok)"
              : "var(--text-2)",
            letterSpacing: "0.04em",
          }}
        >
          {fullyStaffed} OF {totalDays} {totalDays === 1 ? "DAY" : "DAYS"} FULLY STAFFED
        </span>
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        {/* Desktop / wide table. Hidden on phones via CSS. */}
        <div className="cs-perday-table" style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 12,
              minWidth: 480,
            }}
          >
            <thead>
              <tr
                style={{
                  textAlign: "left",
                  color: "var(--text-3)",
                  fontSize: 10,
                  letterSpacing: "0.08em",
                }}
              >
                <th style={th}>DAY</th>
                <th style={thNum}>CONFIRMED</th>
                <th style={thNum}>PENDING</th>
                <th style={thNum}>DECLINED</th>
                <th style={th}>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {coverage.days.map((d) => {
                const status = dayStatus(d, hasInvites);
                return (
                  <tr
                    key={d.date}
                    style={{ borderTop: "1px solid var(--line)" }}
                  >
                    <td style={tdDate}>{formatDay(d.date, timezone)}</td>
                    <td style={tdNum}>
                      <span
                        className="mono tnum"
                        style={{
                          color:
                            d.needed > 0 && d.confirmed >= d.needed
                              ? "var(--ok)"
                              : d.confirmed > 0
                                ? "var(--text)"
                                : "var(--text-3)",
                        }}
                      >
                        {d.confirmed}/{d.needed}
                      </span>
                    </td>
                    <td style={tdNum}>
                      <span
                        className="mono tnum"
                        style={{
                          color: d.pending > 0 ? "var(--warn)" : "var(--text-3)",
                        }}
                      >
                        {d.pending}
                      </span>
                    </td>
                    <td style={tdNum}>
                      <span
                        className="mono tnum"
                        style={{
                          color: d.declined > 0 ? "var(--bad)" : "var(--text-3)",
                        }}
                      >
                        {d.declined}
                      </span>
                    </td>
                    <td style={td}>
                      <Chip tone={status.tone}>{status.label}</Chip>
                    </td>
                  </tr>
                );
              })}
              <tr style={{ borderTop: "2px solid var(--line)" }}>
                <td style={{ ...tdDate, color: "var(--text-3)" }}>TOTAL</td>
                <td style={tdNum}>
                  <span className="mono tnum">
                    {coverage.total.confirmed}/{coverage.total.needed}
                  </span>
                </td>
                <td style={tdNum}>
                  <span className="mono tnum">{coverage.total.pending}</span>
                </td>
                <td style={tdNum}>
                  <span className="mono tnum">{coverage.total.declined}</span>
                </td>
                <td style={td}>&nbsp;</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Mobile-first: stacked cards. */}
        <div className="cs-perday-stack">
          {coverage.days.map((d, i) => {
            const status = dayStatus(d, hasInvites);
            return (
              <div
                key={d.date}
                style={{
                  padding: "12px 14px",
                  borderTop: i > 0 ? "1px solid var(--line)" : 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {formatDay(d.date, timezone)}
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 10,
                      color: "var(--text-3)",
                      marginTop: 3,
                      letterSpacing: "0.04em",
                    }}
                  >
                    <span
                      style={{
                        color:
                          d.needed > 0 && d.confirmed >= d.needed
                            ? "var(--ok)"
                            : "var(--text-2)",
                      }}
                    >
                      {d.confirmed}/{d.needed} OK
                    </span>
                    {" · "}
                    <span
                      style={{
                        color: d.pending > 0 ? "var(--warn)" : "var(--text-3)",
                      }}
                    >
                      {d.pending} PEND
                    </span>
                    {" · "}
                    <span
                      style={{
                        color: d.declined > 0 ? "var(--bad)" : "var(--text-3)",
                      }}
                    >
                      {d.declined} DECL
                    </span>
                  </div>
                </div>
                <Chip tone={status.tone}>{status.label}</Chip>
              </div>
            );
          })}
          <div
            style={{
              padding: "12px 14px",
              borderTop: "2px solid var(--line)",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div style={{ flex: 1 }}>
              <div
                className="cs-label"
                style={{ fontSize: 10, color: "var(--text-3)" }}
              >
                TOTAL
              </div>
              <div
                className="mono"
                style={{
                  fontSize: 11,
                  color: "var(--text-2)",
                  marginTop: 3,
                  letterSpacing: "0.04em",
                }}
              >
                {coverage.total.confirmed}/{coverage.total.needed} OK ·{" "}
                {coverage.total.pending} PEND · {coverage.total.declined} DECL
              </div>
            </div>
          </div>
        </div>
      </Card>

      <style>{`
        .cs-perday-stack { display: none; }
        @media (max-width: 540px) {
          .cs-perday-table { display: none; }
          .cs-perday-stack { display: block; }
        }
      `}</style>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: "10px 14px",
  fontWeight: 600,
};
const thNum: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = {
  padding: "10px 14px",
  verticalAlign: "middle",
};
const tdNum: React.CSSProperties = { ...td, textAlign: "right" };
const tdDate: React.CSSProperties = {
  padding: "10px 14px",
  fontWeight: 600,
  fontSize: 12,
};
