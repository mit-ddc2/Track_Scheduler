"use client";

import { useState } from "react";

import { AttendanceEditRow } from "./AttendanceEditRow";
import { StatusCycleButton } from "./StatusCycleButton";
import type {
  AttendanceStatusEnum,
  AttendanceStatusUpdateInput,
  AttendanceUpdateInput,
} from "@/lib/validation/schemas";

export type AttendanceListRowProps = {
  staff_member_id: string;
  display_name: string;
  status: AttendanceStatusEnum;
  actual_hours: number | null;
  pay_rate: number | null;
  role_label: string | null;
  actual_start: string | null;
  actual_end: string | null;
  pay_code: string | null;
  notes: string | null;
};

export type AttendanceListProps = {
  eventId: string;
  rows: AttendanceListRowProps[];
  setStatus: (input: AttendanceStatusUpdateInput) => Promise<{ ok?: true; error?: string }>;
  updateDetails: (input: AttendanceUpdateInput) => Promise<{ ok?: true; error?: string }>;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
}

function formatHours(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(value % 1 === 0 ? 1 : 2)}h`;
}

function formatRate(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return `$${value.toFixed(0)}/hr`;
}

export function AttendanceList({
  eventId,
  rows,
  setStatus,
  updateDetails,
}: AttendanceListProps) {
  const [openId, setOpenId] = useState<string | null>(null);

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
      {rows.map((row, i) => {
        const open = openId === row.staff_member_id;
        return (
          <div key={row.staff_member_id}>
            {i > 0 && <hr className="cs-divider" />}
            <div
              style={{
                padding: "12px 14px",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div
                aria-hidden
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: "var(--surface-2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-2)",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                }}
              >
                {initials(row.display_name)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <button
                  type="button"
                  onClick={() =>
                    setOpenId(open ? null : row.staff_member_id)
                  }
                  aria-expanded={open}
                  aria-controls={`attendance-edit-${row.staff_member_id}`}
                  style={{
                    background: "transparent",
                    border: 0,
                    padding: 0,
                    margin: 0,
                    textAlign: "left",
                    cursor: "pointer",
                    color: "inherit",
                    width: "100%",
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {row.display_name}
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
                    {formatHours(row.actual_hours)} · {formatRate(row.pay_rate)} ·{" "}
                    {row.role_label ?? "—"}
                  </div>
                </button>
              </div>
              <StatusCycleButton
                current={row.status}
                onChange={(next) =>
                  setStatus({
                    eventId,
                    staffMemberId: row.staff_member_id,
                    status: next,
                  })
                }
              />
            </div>
            {open && (
              <div id={`attendance-edit-${row.staff_member_id}`}>
                <AttendanceEditRow
                  eventId={eventId}
                  staffMemberId={row.staff_member_id}
                  defaults={{
                    actual_start: row.actual_start,
                    actual_end: row.actual_end,
                    actual_hours: row.actual_hours,
                    pay_rate: row.pay_rate,
                    pay_code: row.pay_code,
                    notes: row.notes,
                  }}
                  action={updateDetails}
                  onSaved={() => setOpenId(null)}
                  onCancel={() => setOpenId(null)}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
