"use client";

import { useState, useTransition } from "react";

import { Btn } from "@/components/ui/Btn";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import type { NotificationSeverity } from "@/lib/db/types";

import type { PreferenceInput } from "../../notifications/actions";

type ActionResult = { ok: true } | { ok: false; error: string };

export type PreferenceRow = {
  eventType: string;
  label: string;
  description: string;
  in_app_enabled: boolean;
  email_enabled: boolean;
  sms_enabled: boolean;
  minimum_sms_severity: NotificationSeverity;
  minimum_email_severity: NotificationSeverity;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
};

export type PreferencesFormProps = {
  rows: PreferenceRow[];
  action: (input: PreferenceInput) => Promise<ActionResult>;
};

const SEVERITY_OPTIONS: { value: NotificationSeverity; label: string }[] = [
  { value: "info", label: "Info" },
  { value: "warning", label: "Warning" },
  { value: "urgent", label: "Urgent" },
];

/**
 * Local-state form. Each row is independently dirty-tracked so the user can
 * "Save" a single row without touching others — keeps the audit log readable.
 */
export function PreferencesForm({ rows: initialRows, action }: PreferencesFormProps) {
  const [rows, setRows] = useState(initialRows);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const updateRow = (eventType: string, patch: Partial<PreferenceRow>) => {
    setRows((prev) =>
      prev.map((row) =>
        row.eventType === eventType ? { ...row, ...patch } : row,
      ),
    );
    setDirty((prev) => ({ ...prev, [eventType]: true }));
  };

  const save = (row: PreferenceRow) => {
    setSaving((prev) => ({ ...prev, [row.eventType]: true }));
    setErrors((prev) => ({ ...prev, [row.eventType]: "" }));
    startTransition(async () => {
      const result = await action({
        eventType: row.eventType,
        in_app_enabled: row.in_app_enabled,
        email_enabled: row.email_enabled,
        sms_enabled: row.sms_enabled,
        minimum_sms_severity: row.minimum_sms_severity,
        minimum_email_severity: row.minimum_email_severity,
        quiet_hours_start: row.quiet_hours_start,
        quiet_hours_end: row.quiet_hours_end,
      });
      setSaving((prev) => ({ ...prev, [row.eventType]: false }));
      if (result.ok) {
        setDirty((prev) => ({ ...prev, [row.eventType]: false }));
      } else {
        setErrors((prev) => ({ ...prev, [row.eventType]: result.error }));
      }
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {rows.map((row) => (
        <Card key={row.eventType} hover>
          <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <h2
                    className="cs-h3"
                    style={{ margin: 0, fontSize: 14, fontWeight: 700 }}
                  >
                    {row.label}
                  </h2>
                  <Chip>{row.eventType}</Chip>
                </div>
                {row.description && (
                  <p
                    style={{
                      margin: "4px 0 0",
                      color: "var(--text-2)",
                      fontSize: 12,
                    }}
                  >
                    {row.description}
                  </p>
                )}
              </div>
              <Btn
                variant="primary"
                size="sm"
                onClick={() => save(row)}
                disabled={!dirty[row.eventType] || saving[row.eventType] || pending}
              >
                {saving[row.eventType] ? "Saving…" : "Save"}
              </Btn>
            </div>

            <div
              style={{
                display: "flex",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              <ToggleField
                label="In-app"
                checked={row.in_app_enabled}
                onChange={(v) => updateRow(row.eventType, { in_app_enabled: v })}
              />
              <ToggleField
                label="Email"
                checked={row.email_enabled}
                onChange={(v) => updateRow(row.eventType, { email_enabled: v })}
              />
              <ToggleField
                label="SMS"
                checked={row.sms_enabled}
                onChange={(v) => updateRow(row.eventType, { sms_enabled: v })}
              />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 12,
              }}
            >
              <SeveritySelect
                label="Min SMS severity"
                value={row.minimum_sms_severity}
                onChange={(v) =>
                  updateRow(row.eventType, { minimum_sms_severity: v })
                }
              />
              <SeveritySelect
                label="Min email severity"
                value={row.minimum_email_severity}
                onChange={(v) =>
                  updateRow(row.eventType, { minimum_email_severity: v })
                }
              />
              <TimeField
                label="Quiet hours start"
                value={row.quiet_hours_start}
                onChange={(v) =>
                  updateRow(row.eventType, { quiet_hours_start: v })
                }
              />
              <TimeField
                label="Quiet hours end"
                value={row.quiet_hours_end}
                onChange={(v) =>
                  updateRow(row.eventType, { quiet_hours_end: v })
                }
              />
            </div>

            {errors[row.eventType] && (
              <div
                role="alert"
                style={{ color: "var(--bad)", fontSize: 12 }}
                className="mono"
              >
                {errors[row.eventType]}
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        cursor: "pointer",
        fontSize: 12,
        color: "var(--text)",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: "var(--accent)" }}
      />
      {label}
    </label>
  );
}

function SeveritySelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: NotificationSeverity;
  onChange: (next: NotificationSeverity) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        fontSize: 11,
        color: "var(--text-3)",
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}
      className="mono"
    >
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as NotificationSeverity)}
        style={{
          background: "var(--surface)",
          color: "var(--text)",
          border: "1px solid var(--line)",
          borderRadius: 4,
          padding: "8px 10px",
          fontSize: 12,
        }}
      >
        {SEVERITY_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        fontSize: 11,
        color: "var(--text-3)",
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}
      className="mono"
    >
      {label}
      <input
        type="time"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? e.target.value : null)}
        style={{
          background: "var(--surface)",
          color: "var(--text)",
          border: "1px solid var(--line)",
          borderRadius: 4,
          padding: "8px 10px",
          fontSize: 12,
        }}
      />
    </label>
  );
}
