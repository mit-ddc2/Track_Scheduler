import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";

import { Btn } from "@/components/ui/Btn";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { requireOwner } from "@/lib/auth/require-owner";
import {
  listAuditLog,
  type AuditLogEntry,
  type AuditQueryFilters,
} from "@/lib/db/audit-queries";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const TZ = "America/Toronto";

const ACTION_FILTERS: Array<{ key: string; label: string }> = [
  { key: "all", label: "ALL" },
  { key: "staff", label: "STAFF" },
  { key: "event", label: "EVENT" },
  { key: "campaign", label: "CAMPAIGN" },
  { key: "payroll", label: "PAYROLL" },
  { key: "rsvp", label: "RSVP" },
  { key: "system", label: "SYSTEM" },
];

const RANGE_FILTERS: Array<{ key: NonNullable<AuditQueryFilters["range"]>; label: string }> = [
  { key: "today", label: "TODAY" },
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "all", label: "ALL" },
];

type PageProps = {
  searchParams: Promise<{ action?: string; range?: string; offset?: string }>;
};

function shortId(id: string | null | undefined): string {
  if (!id) return "";
  return id.slice(0, 8);
}

function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diffSec = Math.round((now.getTime() - then.getTime()) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMo = Math.round(diffDay / 30);
  return `${diffMo}mo ago`;
}

function actorLabel(entry: AuditLogEntry): string {
  if (entry.actor) return entry.actor.email;
  if (entry.actor_type === "responder_token") return "responder_token";
  if (entry.actor_type === "system") return "system";
  if (entry.actor_user_id) return shortId(entry.actor_user_id);
  return entry.actor_type;
}

function hasJsonPayload(entry: AuditLogEntry): boolean {
  return Boolean(entry.before) || Boolean(entry.after);
}

function jsonPretty(value: unknown): string {
  if (value === null || value === undefined) return "null";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default async function AuditLogPage({ searchParams }: PageProps) {
  await requireOwner();
  const params = await searchParams;
  const actionPrefix = params.action ?? "all";
  const rangeRaw = (params.range ?? "30d") as AuditQueryFilters["range"];
  const offset = Math.max(0, Number.parseInt(params.offset ?? "0", 10) || 0);

  const entries = await listAuditLog({
    actionPrefix,
    range: rangeRaw,
    limit: PAGE_SIZE,
    offset,
  });

  const hasMore = entries.length === PAGE_SIZE;
  const nextOffset = offset + PAGE_SIZE;
  const baseQueryParts: string[] = [];
  if (actionPrefix !== "all") baseQueryParts.push(`action=${actionPrefix}`);
  if (rangeRaw && rangeRaw !== "30d") baseQueryParts.push(`range=${rangeRaw}`);
  const olderHref = `?${[...baseQueryParts, `offset=${nextOffset}`].join("&")}`;
  const newerHref = `?${baseQueryParts.join("&")}`;
  const now = new Date();

  return (
    <div
      style={{
        padding: "20px 16px 80px",
        maxWidth: 1120,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <span className="cs-eyebrow">Settings</span>
          <h1 className="cs-h1" style={{ marginTop: 4 }}>
            Audit log
          </h1>
          <p
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--text-2)",
              letterSpacing: "0.04em",
              marginTop: 6,
            }}
          >
            {entries.length} row{entries.length === 1 ? "" : "s"} ·{" "}
            offset {offset}
          </p>
        </div>
        <Link href="/dashboard/settings">
          <Btn variant="ghost">Back</Btn>
        </Link>
      </header>

      {/* Action prefix chips */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {ACTION_FILTERS.map((f) => {
          const active = (actionPrefix ?? "all") === f.key;
          const qs = new URLSearchParams();
          if (f.key !== "all") qs.set("action", f.key);
          if (rangeRaw && rangeRaw !== "30d") qs.set("range", rangeRaw);
          const href = qs.toString().length > 0 ? `?${qs.toString()}` : "?";
          return (
            <Link key={f.key} href={href} style={{ textDecoration: "none" }}>
              <Chip tone={active ? "accent" : "default"}>{f.label}</Chip>
            </Link>
          );
        })}
      </div>

      {/* Range chips */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {RANGE_FILTERS.map((r) => {
          const active = (rangeRaw ?? "30d") === r.key;
          const qs = new URLSearchParams();
          if (actionPrefix !== "all") qs.set("action", actionPrefix);
          if (r.key !== "30d") qs.set("range", r.key);
          const href = qs.toString().length > 0 ? `?${qs.toString()}` : "?";
          return (
            <Link key={r.key} href={href} style={{ textDecoration: "none" }}>
              <Chip tone={active ? "info" : "default"}>{r.label}</Chip>
            </Link>
          );
        })}
      </div>

      {entries.length === 0 ? (
        <Card style={{ padding: 28, textAlign: "center" }}>
          <p style={{ margin: 0, color: "var(--text-2)", fontSize: 13 }}>
            No audit entries match the current filters.
          </p>
          <p
            style={{
              margin: "6px 0 0",
              color: "var(--text-3)",
              fontSize: 12,
            }}
          >
            Every owner action — staff edits, event lifecycle changes,
            campaigns, RSVPs, payroll exports — lands here once it happens.
          </p>
        </Card>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="audit-mobile">
            <Card>
              {entries.map((e, idx) => (
                <div key={e.id}>
                  {idx > 0 && <hr className="cs-divider" />}
                  <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <Chip tone="info">{e.action}</Chip>
                      <span
                        className="mono"
                        style={{ fontSize: 10, color: "var(--text-3)" }}
                        title={formatInTimeZone(new Date(e.created_at), TZ, "yyyy-MM-dd HH:mm:ss zzz")}
                      >
                        {relativeTime(e.created_at, now)}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: "var(--text)" }}>
                      {e.summary ?? "(no summary)"}
                    </div>
                    <div
                      className="mono"
                      style={{ fontSize: 11, color: "var(--text-3)", display: "flex", flexWrap: "wrap", gap: 8 }}
                    >
                      <span>{actorLabel(e)}</span>
                      <span>·</span>
                      <span>
                        {e.entity_type}:{shortId(e.entity_id)}
                      </span>
                    </div>
                    {hasJsonPayload(e) && (
                      <details style={{ marginTop: 4 }}>
                        <summary
                          className="mono"
                          style={{
                            fontSize: 10,
                            color: "var(--text-3)",
                            cursor: "pointer",
                            letterSpacing: "0.06em",
                            textTransform: "uppercase",
                          }}
                        >
                          before / after
                        </summary>
                        <pre
                          className="mono"
                          style={{
                            fontSize: 11,
                            color: "var(--text-2)",
                            background: "var(--bg-2)",
                            padding: 8,
                            borderRadius: 3,
                            marginTop: 6,
                            overflow: "auto",
                          }}
                        >
                          {`before:\n${jsonPretty(e.before)}\n\nafter:\n${jsonPretty(e.after)}`}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              ))}
            </Card>
          </div>

          {/* Desktop table */}
          <div className="audit-desk">
            <Card style={{ padding: 0, overflow: "hidden" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr style={{ background: "var(--bg-2)", color: "var(--text-3)" }}>
                    {["When", "Actor", "Action", "Entity", "Summary"].map((h) => (
                      <th
                        key={h}
                        className="cs-label"
                        style={{
                          textAlign: "left",
                          padding: "10px 12px",
                          borderBottom: "1px solid var(--line)",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id} style={{ borderBottom: "1px solid var(--line)", verticalAlign: "top" }}>
                      <td
                        style={{ padding: "10px 12px", whiteSpace: "nowrap" }}
                        className="mono"
                      >
                        <span
                          title={formatInTimeZone(new Date(e.created_at), TZ, "yyyy-MM-dd HH:mm:ss zzz")}
                          style={{ color: "var(--text-2)" }}
                        >
                          {relativeTime(e.created_at, now)}
                        </span>
                      </td>
                      <td style={{ padding: "10px 12px" }} className="mono">
                        {actorLabel(e)}
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        <Chip tone="info">{e.action}</Chip>
                      </td>
                      <td style={{ padding: "10px 12px" }} className="mono">
                        {e.entity_type}:{shortId(e.entity_id)}
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        <div>{e.summary ?? "(no summary)"}</div>
                        {hasJsonPayload(e) && (
                          <details style={{ marginTop: 6 }}>
                            <summary
                              className="mono"
                              style={{
                                fontSize: 10,
                                color: "var(--text-3)",
                                cursor: "pointer",
                                letterSpacing: "0.06em",
                                textTransform: "uppercase",
                              }}
                            >
                              before / after
                            </summary>
                            <pre
                              className="mono"
                              style={{
                                fontSize: 11,
                                color: "var(--text-2)",
                                background: "var(--bg-2)",
                                padding: 8,
                                borderRadius: 3,
                                marginTop: 6,
                                overflow: "auto",
                                maxWidth: 560,
                              }}
                            >
                              {`before:\n${jsonPretty(e.before)}\n\nafter:\n${jsonPretty(e.after)}`}
                            </pre>
                          </details>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        </>
      )}

      {/* Pagination */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        {offset > 0 ? (
          <Link href={newerHref} style={{ textDecoration: "none" }}>
            <Btn variant="ghost">← Newer</Btn>
          </Link>
        ) : (
          <span />
        )}
        {hasMore ? (
          <Link href={olderHref} style={{ textDecoration: "none" }}>
            <Btn variant="ghost">Older →</Btn>
          </Link>
        ) : (
          <span
            className="mono"
            style={{ fontSize: 11, color: "var(--text-3)", alignSelf: "center" }}
          >
            End of log
          </span>
        )}
      </div>

      <style>{`
        .audit-mobile { display: block; }
        .audit-desk { display: none; }
        @media (min-width: 768px) {
          .audit-mobile { display: none; }
          .audit-desk { display: block; }
        }
      `}</style>
    </div>
  );
}
