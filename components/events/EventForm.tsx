"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Btn } from "@/components/ui/Btn";
import { Card } from "@/components/ui/Card";
import {
  OVERBOOKING_POLICIES,
  type OverbookingPolicy,
} from "@/lib/validation/schemas";

export type EventFormValues = {
  title: string;
  description: string;
  event_type: string;
  starts_at: string; // datetime-local string
  ends_at: string; // datetime-local string
  timezone: string;
  location: string;
  required_headcount: number;
  overbooking_policy: OverbookingPolicy;
  manager_notes: string;
};

export type EventFormProps = {
  mode: "create" | "edit";
  initial: EventFormValues;
  /**
   * Server action wrapper. Receives the validated form values and returns
   * either `{ id }` to redirect into the detail page or `{ error }` to show
   * an inline error banner.
   */
  action: (
    values: EventFormValues,
  ) => Promise<{ id?: string; error?: string }>;
  /** Where the cancel button should link to. */
  cancelHref: string;
};

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 4,
  border: "1px solid var(--line)",
  background: "var(--surface)",
  color: "var(--text)",
  fontFamily: "inherit",
  fontSize: 13,
};

export function EventForm({ mode, initial, action, cancelHref }: EventFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<EventFormValues>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof EventFormValues>(
    key: K,
    value: EventFormValues[K],
  ) => setValues((v) => ({ ...v, [key]: value }));

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await action(values);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.id) {
        router.push(`/dashboard/events/${result.id}`);
        router.refresh();
      }
    });
  };

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && (
        <Card style={{ padding: 12, borderColor: "var(--bad)" }}>
          <p
            className="mono"
            style={{
              margin: 0,
              color: "var(--bad)",
              fontSize: 12,
              letterSpacing: "0.04em",
            }}
          >
            {error}
          </p>
        </Card>
      )}

      <Card style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label className="cs-label" style={labelStyle} htmlFor="title">
            Title*
          </label>
          <input
            id="title"
            value={values.title}
            onChange={(e) => set("title", e.target.value)}
            required
            maxLength={200}
            style={inputStyle}
            placeholder="AISA Driving School"
          />
        </div>

        <div>
          <label className="cs-label" style={labelStyle} htmlFor="event_type">
            Event type
          </label>
          <input
            id="event_type"
            value={values.event_type}
            onChange={(e) => set("event_type", e.target.value)}
            maxLength={80}
            style={inputStyle}
            placeholder="race · school · lapping · private test · festival"
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label className="cs-label" style={labelStyle} htmlFor="starts_at">
              Starts*
            </label>
            <input
              id="starts_at"
              type="datetime-local"
              value={values.starts_at}
              onChange={(e) => set("starts_at", e.target.value)}
              required
              style={inputStyle}
            />
          </div>
          <div>
            <label className="cs-label" style={labelStyle} htmlFor="ends_at">
              Ends*
            </label>
            <input
              id="ends_at"
              type="datetime-local"
              value={values.ends_at}
              onChange={(e) => set("ends_at", e.target.value)}
              required
              style={inputStyle}
            />
          </div>
        </div>

        <div>
          <label className="cs-label" style={labelStyle} htmlFor="timezone">
            Timezone
          </label>
          <input
            id="timezone"
            value={values.timezone}
            onChange={(e) => set("timezone", e.target.value)}
            style={inputStyle}
            placeholder="America/Toronto"
          />
        </div>

        <div>
          <label className="cs-label" style={labelStyle} htmlFor="location">
            Location
          </label>
          <input
            id="location"
            value={values.location}
            onChange={(e) => set("location", e.target.value)}
            maxLength={200}
            style={inputStyle}
            placeholder="Calabogie Motorsports Park · Main paddock"
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label
              className="cs-label"
              style={labelStyle}
              htmlFor="required_headcount"
            >
              Required headcount
            </label>
            <input
              id="required_headcount"
              type="number"
              min={0}
              max={500}
              step={1}
              value={values.required_headcount}
              onChange={(e) =>
                set("required_headcount", Math.max(0, Number(e.target.value) || 0))
              }
              style={inputStyle}
            />
          </div>
          <div>
            <span className="cs-label" style={labelStyle}>
              Overbooking policy
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {OVERBOOKING_POLICIES.map((opt) => (
                <label
                  key={opt}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 12,
                  }}
                >
                  <input
                    type="radio"
                    name="overbooking_policy"
                    value={opt}
                    checked={values.overbooking_policy === opt}
                    onChange={() => set("overbooking_policy", opt)}
                  />
                  <span style={{ color: "var(--text-2)" }}>
                    {opt === "allow_all"
                      ? "Allow all responses"
                      : "Waitlist after requirement met"}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div>
          <label className="cs-label" style={labelStyle} htmlFor="description">
            Description
          </label>
          <textarea
            id="description"
            value={values.description}
            onChange={(e) => set("description", e.target.value)}
            maxLength={2000}
            rows={3}
            style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
          />
        </div>

        <div>
          <label
            className="cs-label"
            style={labelStyle}
            htmlFor="manager_notes"
          >
            Manager notes
          </label>
          <textarea
            id="manager_notes"
            value={values.manager_notes}
            onChange={(e) => set("manager_notes", e.target.value)}
            maxLength={2000}
            rows={3}
            style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
          />
        </div>
      </Card>

      <div style={{ display: "flex", gap: 8 }}>
        <Btn type="submit" variant="primary" disabled={pending} style={{ flex: 1 }}>
          {pending ? "SAVING…" : mode === "create" ? "CREATE EVENT" : "SAVE CHANGES"}
        </Btn>
        <Link href={cancelHref} className="cs-btn" style={{ textDecoration: "none" }}>
          CANCEL
        </Link>
      </div>
    </form>
  );
}
