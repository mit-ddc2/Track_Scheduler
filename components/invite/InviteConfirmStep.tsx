"use client";

import { Card } from "@/components/ui/Card";

export type InviteConfirmStepProps = {
  eventTitle: string;
  eventWhen: string;
  recipients: number;
  smsCount: number;
  emailCount: number;
  skippedOptOut: number;
  skippedManualOnly: number;
  skippedNoContact: number;
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function InviteConfirmStep({
  eventTitle,
  eventWhen,
  recipients,
  smsCount,
  emailCount,
  skippedOptOut,
  skippedManualOnly,
  skippedNoContact,
}: InviteConfirmStepProps) {
  const totalSkipped = skippedOptOut + skippedManualOnly + skippedNoContact;
  return (
    <div style={{ padding: "20px 16px 8px" }}>
      <Card style={{ padding: 18 }}>
        <div className="cs-eyebrow" style={{ marginBottom: 14 }}>
          READY TO SEND
        </div>
        <div className="cs-h1" style={{ fontSize: 22, marginBottom: 4 }}>
          {eventTitle}
        </div>
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--text-2)",
            letterSpacing: "0.04em",
            marginBottom: 20,
          }}
        >
          {eventWhen.toUpperCase()}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 14,
            padding: "14px 0",
            borderTop: "1px solid var(--line)",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <Stat label="Recipients" value={pad(recipients)} />
          <Stat
            label="Messages"
            value={pad(smsCount + emailCount)}
            sub={`${smsCount} SMS · ${emailCount} email`}
          />
        </div>

        <div
          style={{
            marginTop: 14,
            fontSize: 12,
            color: "var(--text-2)",
            lineHeight: 1.5,
          }}
        >
          {totalSkipped === 0 ? (
            <span>No recipients skipped.</span>
          ) : (
            <>
              Skipped:{" "}
              {skippedOptOut > 0 && (
                <span style={{ color: "var(--bad)" }}>
                  {skippedOptOut} opted-out
                </span>
              )}
              {skippedOptOut > 0 && (skippedManualOnly + skippedNoContact > 0)
                ? ", "
                : null}
              {skippedManualOnly > 0 && (
                <span style={{ color: "var(--warn)" }}>
                  {skippedManualOnly} manual-only
                </span>
              )}
              {skippedManualOnly > 0 && skippedNoContact > 0 ? ", " : null}
              {skippedNoContact > 0 && (
                <span style={{ color: "var(--text-3)" }}>
                  {skippedNoContact} no contact
                </span>
              )}
              .
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <div className="cs-label">{label}</div>
      <div
        className="cs-data-lg mono tnum"
        style={{ fontSize: 28, marginTop: 4 }}
      >
        {value}
      </div>
      {sub && (
        <div
          className="mono"
          style={{
            fontSize: 10,
            color: "var(--text-3)",
            marginTop: 3,
            letterSpacing: "0.04em",
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}
