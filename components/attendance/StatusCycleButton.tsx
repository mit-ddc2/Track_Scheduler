"use client";

import { useState, useTransition } from "react";

import type { AttendanceStatusEnum } from "@/lib/validation/schemas";

/** Order matches the design ref (`mobile-screens.jsx` → `cycle`). */
const CYCLE: ReadonlyArray<AttendanceStatusEnum> = [
  "worked",
  "no_show",
  "cancelled_by_manager",
  "excused",
];

const LABEL: Record<AttendanceStatusEnum, string> = {
  scheduled: "SCHEDULED",
  worked: "WORKED",
  no_show: "NO-SHOW",
  cancelled_by_member: "CANCEL",
  cancelled_by_manager: "CANCEL",
  excused: "EXCUSED",
};

const TONE: Record<AttendanceStatusEnum, "ok" | "warn" | "bad" | "idle"> = {
  scheduled: "idle",
  worked: "ok",
  no_show: "bad",
  cancelled_by_member: "warn",
  cancelled_by_manager: "warn",
  excused: "idle",
};

export type StatusCycleButtonProps = {
  current: AttendanceStatusEnum;
  onChange: (next: AttendanceStatusEnum) => Promise<{ error?: string } | void>;
};

/**
 * Pit Wall status pill. Tap cycles through worked → no_show →
 * cancelled_by_manager → excused (matches the design ref). The first tap
 * from `scheduled` lands on `worked`.
 */
export function StatusCycleButton({ current, onChange }: StatusCycleButtonProps) {
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<AttendanceStatusEnum>(current);
  const [error, setError] = useState<string | null>(null);

  const tone = TONE[optimistic];
  const label = LABEL[optimistic];

  const handleClick = () => {
    if (pending) return;
    const baseIdx = CYCLE.indexOf(optimistic);
    const next = baseIdx === -1 ? CYCLE[0]! : CYCLE[(baseIdx + 1) % CYCLE.length]!;
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
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        aria-label={`Attendance status: ${label}. Click to cycle.`}
        style={{
          padding: "6px 10px",
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
          style={{ fontSize: 10, color: "var(--bad)", letterSpacing: "0.04em" }}
        >
          {error}
        </span>
      )}
    </div>
  );
}
