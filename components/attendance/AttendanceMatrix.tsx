"use client";

/**
 * Per-day attendance matrix (v2 Wave B2).
 *
 * Rows = staff member, columns = day. Each cell is an editable status pill
 * that cycles through the attendance enum on click (worked → no_show →
 * cancel_member → cancel_mgr → excused). Cells without an assignment render
 * as inert dashes so the manager can see which days a person isn't scheduled.
 *
 * The matrix collapses into a vertical stack of cards on phones.
 */

import { formatInTimeZone } from "date-fns-tz";
import { Fragment, useState, useTransition } from "react";

import type {
  AttendanceStatusEnum,
  AttendanceStatusUpdateInput,
} from "@/lib/validation/schemas";

export type MatrixCell = {
  day_date: string;
  /** Assignment status — null when this staff member isn't scheduled that day. */
  status: "confirmed" | "waitlisted" | "cancelled" | "completed" | null;
  attendance: { status: AttendanceStatusEnum } | null;
};

export type MatrixRow = {
  staff_member_id: string;
  staff_display_name: string;
  role_label: string | null;
  cells: MatrixCell[];
};

export type AttendanceMatrixProps = {
  eventId: string;
  days: string[];
  rows: MatrixRow[];
  timezone?: string;
  setStatus: (
    input: AttendanceStatusUpdateInput,
  ) => Promise<{ ok?: true; error?: string }>;
};

const CYCLE: ReadonlyArray<AttendanceStatusEnum> = [
  "worked",
  "no_show",
  "cancelled_by_member",
  "cancelled_by_manager",
  "excused",
];

const LABEL: Record<AttendanceStatusEnum, string> = {
  scheduled: "SCH",
  worked: "WORK",
  no_show: "NO-SHOW",
  cancelled_by_member: "CAN-MEM",
  cancelled_by_manager: "CAN-MGR",
  excused: "EXC",
};

const TONE: Record<AttendanceStatusEnum, "ok" | "warn" | "bad" | "idle"> = {
  scheduled: "idle",
  worked: "ok",
  no_show: "bad",
  cancelled_by_member: "warn",
  cancelled_by_manager: "warn",
  excused: "idle",
};

function formatDayShort(date: string, tz: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return formatInTimeZone(d, tz, "EEE d");
}

function CellButton({
  cell,
  onChange,
}: {
  cell: MatrixCell;
  onChange: (next: AttendanceStatusEnum) => Promise<{ error?: string } | void>;
}) {
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<AttendanceStatusEnum>(
    cell.attendance?.status ?? "scheduled",
  );
  const [error, setError] = useState<string | null>(null);

  // Inert placeholder when there's no assignment for this (staff, day) cell.
  if (cell.status === null) {
    return (
      <span
        aria-label="Not scheduled"
        style={{
          display: "inline-block",
          minWidth: 56,
          padding: "6px 8px",
          textAlign: "center",
          color: "var(--text-3)",
          font: "700 10px/1 var(--font-jetbrains-mono), monospace",
          letterSpacing: "0.06em",
        }}
      >
        —
      </span>
    );
  }

  const tone = TONE[optimistic];
  const label = LABEL[optimistic];

  const handleClick = () => {
    if (pending) return;
    const baseIdx = CYCLE.indexOf(optimistic);
    const next =
      baseIdx === -1 ? CYCLE[0]! : CYCLE[(baseIdx + 1) % CYCLE.length]!;
    const previous = optimistic;
    setOptimistic(next);
    setError(null);
    startTransition(async () => {
      const result = await onChange(next);
      if (result && "error" in result && result.error) {
        setOptimistic(previous);
        setError(result.error);
      }
    });
  };

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center" }}>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        aria-label={`Status ${label} on ${cell.day_date}. Click to cycle.`}
        style={{
          minWidth: 64,
          padding: "6px 8px",
          borderRadius: 3,
          cursor: pending ? "wait" : "pointer",
          background: `color-mix(in srgb, var(--${tone}) 12%, transparent)`,
          color: tone === "idle" ? "var(--text-2)" : `var(--${tone})`,
          border: `1px solid color-mix(in srgb, var(--${tone}) 30%, transparent)`,
          font: "700 10px/1 var(--font-jetbrains-mono), monospace",
          letterSpacing: "0.06em",
          opacity: pending ? 0.7 : 1,
        }}
      >
        {label}
      </button>
      {error && (
        <span
          className="mono"
          style={{ fontSize: 9, color: "var(--bad)", marginTop: 2 }}
        >
          {error}
        </span>
      )}
    </span>
  );
}

export function AttendanceMatrix({
  eventId,
  days,
  rows,
  timezone = "America/Toronto",
  setStatus,
}: AttendanceMatrixProps) {
  if (rows.length === 0) {
    return (
      <div
        style={{
          padding: 28,
          textAlign: "center",
          color: "var(--text-3)",
          fontSize: 12,
        }}
      >
        No confirmed assignees yet.
      </div>
    );
  }

  return (
    <div>
      {/* Wide layout: table-like matrix. */}
      <div className="cs-att-matrix" style={{ overflowX: "auto" }}>
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
              <th style={th}>STAFF</th>
              {days.map((d) => (
                <th key={d} style={thCenter}>
                  {formatDayShort(d, timezone)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.staff_member_id}
                style={{
                  borderTop: i > 0 ? "1px solid var(--line)" : undefined,
                }}
              >
                <td style={tdStaff}>
                  <div style={{ fontWeight: 600, fontSize: 12 }}>
                    {row.staff_display_name}
                  </div>
                  {row.role_label && (
                    <div
                      className="mono"
                      style={{
                        fontSize: 9,
                        color: "var(--text-3)",
                        marginTop: 2,
                        letterSpacing: "0.04em",
                      }}
                    >
                      {row.role_label.toUpperCase()}
                    </div>
                  )}
                </td>
                {row.cells.map((cell) => (
                  <td key={cell.day_date} style={tdCell}>
                    <CellButton
                      cell={cell}
                      onChange={(next) =>
                        setStatus({
                          eventId,
                          staffMemberId: row.staff_member_id,
                          status: next,
                          day_date: cell.day_date,
                        })
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone layout: each staff member becomes a card with stacked days. */}
      <div className="cs-att-stack">
        {rows.map((row, i) => (
          <div
            key={row.staff_member_id}
            style={{
              padding: "12px 14px",
              borderTop: i > 0 ? "1px solid var(--line)" : 0,
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 13 }}>
              {row.staff_display_name}
            </div>
            {row.role_label && (
              <div
                className="mono"
                style={{
                  fontSize: 10,
                  color: "var(--text-3)",
                  marginTop: 2,
                  letterSpacing: "0.04em",
                }}
              >
                {row.role_label.toUpperCase()}
              </div>
            )}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 8,
                marginTop: 10,
              }}
            >
              {row.cells.map((cell) => (
                <Fragment key={cell.day_date}>
                  <span
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: "var(--text-2)",
                      letterSpacing: "0.04em",
                      alignSelf: "center",
                    }}
                  >
                    {formatDayShort(cell.day_date, timezone)}
                  </span>
                  <CellButton
                    cell={cell}
                    onChange={(next) =>
                      setStatus({
                        eventId,
                        staffMemberId: row.staff_member_id,
                        status: next,
                        day_date: cell.day_date,
                      })
                    }
                  />
                </Fragment>
              ))}
            </div>
          </div>
        ))}
      </div>

      <style>{`
        .cs-att-stack { display: none; }
        @media (max-width: 540px) {
          .cs-att-matrix { display: none; }
          .cs-att-stack { display: block; }
        }
      `}</style>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: "10px 14px",
  fontWeight: 600,
};
const thCenter: React.CSSProperties = { ...th, textAlign: "center" };
const tdStaff: React.CSSProperties = {
  padding: "10px 14px",
  verticalAlign: "middle",
};
const tdCell: React.CSSProperties = {
  padding: "8px 6px",
  verticalAlign: "middle",
  textAlign: "center",
};
