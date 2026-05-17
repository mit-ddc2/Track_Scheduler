import Link from "next/link";

import { Btn } from "@/components/ui/Btn";
import { Card } from "@/components/ui/Card";
import { requireOwner } from "@/lib/auth/require-owner";
import { createClient as createServerClient } from "@/lib/db/supabase-server";
import type { MockSentSmsRow } from "@/lib/db/types";

// Diagnostic page; should always reflect the latest writes from the outbox.
export const dynamic = "force-dynamic";

export default async function MockSmsLogPage() {
  await requireOwner();
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from("mock_sent_sms")
    .select("id, to_value, body, provider_message_id, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  const rows: MockSentSmsRow[] = (data ?? []) as MockSentSmsRow[];

  const mockEnv = process.env.MESSAGING_PROVIDER === "mock";
  const mockSid = (process.env.TWILIO_MESSAGING_SERVICE_SID ?? "").startsWith(
    "mock_",
  );
  const active = mockEnv || mockSid;

  return (
    <div
      style={{
        maxWidth: 960,
        margin: "0 auto",
        padding: "20px 16px 80px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <div>
          <span className="cs-eyebrow">Diagnostic · Dev</span>
          <h1 className="cs-h1" style={{ marginTop: 4 }}>
            Mock SMS log
          </h1>
          <div
            className="mono"
            style={{
              fontSize: 11,
              marginTop: 6,
              color: "var(--text-3)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            Mock provider: {active ? "active" : "inactive"}
            {mockEnv && " · MESSAGING_PROVIDER=mock"}
            {mockSid && " · MESSAGING_SERVICE_SID=mock_…"}
          </div>
        </div>
        <Link href="/dashboard/settings">
          <Btn variant="ghost">Back</Btn>
        </Link>
      </header>

      {error && (
        <div
          role="alert"
          className="mono"
          style={{
            padding: 12,
            border: "1px solid var(--bad)",
            borderRadius: 4,
            color: "var(--bad)",
            fontSize: 11,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          Failed to load mock SMS log: {error.message}
        </div>
      )}

      <Card>
        {rows.length === 0 ? (
          <div
            style={{
              padding: 24,
              color: "var(--text-3)",
              fontSize: 13,
              textAlign: "center",
            }}
          >
            No mock SMS messages yet.
          </div>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 12,
            }}
          >
            <thead>
              <tr
                style={{
                  textAlign: "left",
                  color: "var(--text-3)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  fontSize: 10,
                }}
              >
                <th style={{ padding: "10px 12px", width: 180 }}>Timestamp</th>
                <th style={{ padding: "10px 12px", width: 180 }}>To</th>
                <th style={{ padding: "10px 12px" }}>Body</th>
                <th style={{ padding: "10px 12px", width: 180 }}>
                  Provider ID
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={row.id}
                  style={{
                    borderTop: i === 0 ? undefined : "1px solid var(--hairline)",
                  }}
                >
                  <td
                    className="mono"
                    style={{
                      padding: "10px 12px",
                      verticalAlign: "top",
                      color: "var(--text-2)",
                      fontSize: 11,
                    }}
                  >
                    {formatTs(row.created_at)}
                  </td>
                  <td
                    className="mono"
                    style={{
                      padding: "10px 12px",
                      verticalAlign: "top",
                      color: "var(--text-2)",
                      fontSize: 11,
                    }}
                  >
                    {row.to_value}
                  </td>
                  <td
                    style={{
                      padding: "10px 12px",
                      verticalAlign: "top",
                      color: "var(--text-1)",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {row.body}
                  </td>
                  <td
                    className="mono"
                    style={{
                      padding: "10px 12px",
                      verticalAlign: "top",
                      color: "var(--text-3)",
                      fontSize: 10,
                      wordBreak: "break-all",
                    }}
                  >
                    {row.provider_message_id}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function formatTs(iso: string): string {
  // Stable, owner-readable timestamp; matches the rest of the dashboard tone
  // (no localisation, monospace).
  try {
    const d = new Date(iso);
    return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
  } catch {
    return iso;
  }
}
