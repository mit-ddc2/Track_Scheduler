"use client";

import { Download } from "lucide-react";
import { useState } from "react";

export type PayrollEventOption = {
  id: string;
  title: string;
  dateLabel: string;
  status: string;
};

type Props = {
  events: PayrollEventOption[];
};

/**
 * Lets the owner pick a recent event and open its payroll CSV in a new tab.
 * The actual export endpoint (`/api/exports/payroll/[eventId]`) handles
 * auth, audit, and CSV emission.
 */
export function PayrollEventPicker({ events }: Props) {
  const [eventId, setEventId] = useState(events[0]?.id ?? "");
  const downloadHref = eventId ? `/api/exports/payroll/${eventId}` : "#";
  const disabled = !eventId;

  return (
    <div
      style={{
        marginTop: 10,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <label
        className="cs-label"
        htmlFor="payroll-event"
        style={{ display: "block" }}
      >
        Event
      </label>
      <select
        id="payroll-event"
        value={eventId}
        onChange={(e) => setEventId(e.target.value)}
        style={{
          width: "100%",
          padding: "10px 12px",
          background: "var(--surface)",
          color: "var(--text)",
          border: "1px solid var(--line)",
          borderRadius: 4,
          fontSize: 13,
          fontFamily: "inherit",
        }}
      >
        {events.map((e) => (
          <option key={e.id} value={e.id}>
            {e.dateLabel} — {e.title} ({e.status})
          </option>
        ))}
      </select>

      <a
        href={downloadHref}
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled={disabled}
        className="cs-btn cs-btn--primary"
        style={{
          textDecoration: "none",
          alignSelf: "flex-start",
          opacity: disabled ? 0.5 : 1,
          pointerEvents: disabled ? "none" : "auto",
        }}
        onClick={(ev) => {
          if (disabled) ev.preventDefault();
        }}
      >
        <Download size={14} strokeWidth={1.8} /> DOWNLOAD PAYROLL CSV
      </a>
    </div>
  );
}
