"use client";

import { Card } from "@/components/ui/Card";
import type { ContactChannel } from "@/lib/db/types";
import type { RenderedEmail } from "@/lib/messaging/render-templates";
import { estimateSmsSegments } from "@/lib/messaging/render-templates";

export type InviteComposeStepProps = {
  channels: Record<ContactChannel, boolean>;
  smsReachable: number;
  emailReachable: number;
  smsPreview: string;
  emailPreview: RenderedEmail;
  onToggleChannel: (channel: ContactChannel) => void;
};

export function InviteComposeStep({
  channels,
  smsReachable,
  emailReachable,
  smsPreview,
  emailPreview,
  onToggleChannel,
}: InviteComposeStepProps) {
  const segments = estimateSmsSegments(smsPreview);
  const charCount = [...smsPreview].length;

  return (
    <div style={{ padding: "14px 16px 8px" }}>
      <div className="cs-label" style={{ marginBottom: 10 }}>
        CHANNELS
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {(["sms", "email"] as const).map((c) => {
          const on = channels[c];
          const reachable = c === "sms" ? smsReachable : emailReachable;
          return (
            <button
              key={c}
              type="button"
              onClick={() => onToggleChannel(c)}
              aria-pressed={on}
              style={{
                flex: 1,
                padding: 14,
                borderRadius: 4,
                cursor: "pointer",
                background: on
                  ? "color-mix(in srgb, var(--accent) 12%, transparent)"
                  : "var(--surface)",
                border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`,
                color: on ? "var(--text)" : "var(--text-2)",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 6,
                textAlign: "left",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  width: "100%",
                }}
              >
                <span
                  className="cs-label"
                  style={{ color: "inherit", letterSpacing: "0.08em" }}
                >
                  {c === "sms" ? "SMS" : "EMAIL"}
                </span>
                {on && <span aria-hidden>✓</span>}
              </div>
              <span
                className="mono"
                style={{ fontSize: 10, color: "var(--text-3)" }}
              >
                {reachable} reachable
              </span>
            </button>
          );
        })}
      </div>

      <div className="cs-label" style={{ marginBottom: 10 }}>
        SMS PREVIEW · {charCount} CHARS · {segments} SEGMENT{segments === 1 ? "" : "S"}
      </div>
      <Card
        style={{
          padding: 14,
          marginBottom: 18,
          background: "var(--bg-2, var(--surface))",
        }}
      >
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          {smsPreview}
        </div>
      </Card>

      <div className="cs-label" style={{ marginBottom: 10 }}>
        EMAIL PREVIEW
      </div>
      <Card style={{ overflow: "hidden", marginBottom: 24 }}>
        <div
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid var(--line)",
            background: "var(--bg-2, var(--surface))",
          }}
        >
          <div className="cs-label">SUBJECT</div>
          <div style={{ fontSize: 13, marginTop: 4, fontWeight: 600 }}>
            {emailPreview.subject}
          </div>
        </div>
        <div
          style={{
            padding: 14,
            fontSize: 12.5,
            lineHeight: 1.6,
            color: "var(--text-2)",
            whiteSpace: "pre-wrap",
          }}
        >
          {emailPreview.text}
        </div>
      </Card>
    </div>
  );
}
