"use client";

import { useState, useTransition } from "react";

import { Btn } from "@/components/ui/Btn";
import type { AttendanceUpdateInput } from "@/lib/validation/schemas";

type FieldDefaults = {
  actual_start: string | null;
  actual_end: string | null;
  actual_hours: number | null;
  pay_rate: number | null;
  pay_code: string | null;
  notes: string | null;
};

export type AttendanceEditRowProps = {
  eventId: string;
  staffMemberId: string;
  defaults: FieldDefaults;
  action: (input: AttendanceUpdateInput) => Promise<{ ok?: true; error?: string }>;
  onSaved?: () => void;
  onCancel?: () => void;
};

function toLocalDtValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // datetime-local wants YYYY-MM-DDTHH:mm with no zone — we render the
  // browser-local representation; backend re-stores the resulting ISO.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dtLocalToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const FIELD_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 4,
  border: "1px solid var(--line)",
  background: "var(--surface)",
  color: "var(--text)",
  fontFamily: "inherit",
  fontSize: 12,
  outline: "none",
};

const LABEL_STYLE: React.CSSProperties = {
  display: "block",
  marginBottom: 4,
};

/**
 * Inline edit panel below an attendance row. Fields are optional —
 * blanks become null on the server.
 */
export function AttendanceEditRow({
  eventId,
  staffMemberId,
  defaults,
  action,
  onSaved,
  onCancel,
}: AttendanceEditRowProps) {
  const [actualStart, setActualStart] = useState<string>(
    toLocalDtValue(defaults.actual_start),
  );
  const [actualEnd, setActualEnd] = useState<string>(
    toLocalDtValue(defaults.actual_end),
  );
  const [actualHours, setActualHours] = useState<string>(
    defaults.actual_hours == null ? "" : String(defaults.actual_hours),
  );
  const [payRate, setPayRate] = useState<string>(
    defaults.pay_rate == null ? "" : String(defaults.pay_rate),
  );
  const [payCode, setPayCode] = useState<string>(defaults.pay_code ?? "");
  const [notes, setNotes] = useState<string>(defaults.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const numHours = actualHours.trim() === "" ? null : Number(actualHours);
    const numRate = payRate.trim() === "" ? null : Number(payRate);
    if (numHours != null && !Number.isFinite(numHours)) {
      setError("Hours must be a number");
      return;
    }
    if (numRate != null && !Number.isFinite(numRate)) {
      setError("Pay rate must be a number");
      return;
    }

    const payload: AttendanceUpdateInput = {
      eventId,
      staffMemberId,
      actual_start: dtLocalToIso(actualStart),
      actual_end: dtLocalToIso(actualEnd),
      actual_hours: numHours,
      pay_rate: numRate,
      pay_code: payCode.trim() === "" ? null : payCode.trim(),
      notes: notes.trim() === "" ? null : notes,
    };

    startTransition(async () => {
      const result = await action(payload);
      if (result.error) {
        setError(result.error);
        return;
      }
      onSaved?.();
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      style={{
        padding: "12px 14px",
        background: "var(--surface-2)",
        borderTop: "1px solid var(--line)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {error && (
        <div
          className="mono"
          role="alert"
          style={{
            color: "var(--bad)",
            fontSize: 11,
            letterSpacing: "0.04em",
          }}
        >
          {error}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label>
          <span className="cs-label" style={LABEL_STYLE}>
            Actual start
          </span>
          <input
            type="datetime-local"
            value={actualStart}
            onChange={(e) => setActualStart(e.target.value)}
            style={FIELD_STYLE}
          />
        </label>
        <label>
          <span className="cs-label" style={LABEL_STYLE}>
            Actual end
          </span>
          <input
            type="datetime-local"
            value={actualEnd}
            onChange={(e) => setActualEnd(e.target.value)}
            style={FIELD_STYLE}
          />
        </label>
        <label>
          <span className="cs-label" style={LABEL_STYLE}>
            Hours
          </span>
          <input
            type="number"
            min={0}
            max={24}
            step={0.25}
            value={actualHours}
            onChange={(e) => setActualHours(e.target.value)}
            style={FIELD_STYLE}
          />
        </label>
        <label>
          <span className="cs-label" style={LABEL_STYLE}>
            Pay rate ($/hr)
          </span>
          <input
            type="number"
            min={0}
            max={1000}
            step={0.01}
            value={payRate}
            onChange={(e) => setPayRate(e.target.value)}
            style={FIELD_STYLE}
          />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          <span className="cs-label" style={LABEL_STYLE}>
            Pay code
          </span>
          <input
            type="text"
            maxLength={40}
            value={payCode}
            onChange={(e) => setPayCode(e.target.value)}
            placeholder="e.g. REG, OT, FLAT"
            style={FIELD_STYLE}
          />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          <span className="cs-label" style={LABEL_STYLE}>
            Notes
          </span>
          <textarea
            rows={2}
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{ ...FIELD_STYLE, resize: "vertical" }}
          />
        </label>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        {onCancel && (
          <Btn type="button" size="sm" onClick={onCancel} disabled={pending}>
            CANCEL
          </Btn>
        )}
        <Btn type="submit" size="sm" variant="primary" disabled={pending}>
          {pending ? "SAVING…" : "SAVE"}
        </Btn>
      </div>
    </form>
  );
}
