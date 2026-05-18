import Link from "next/link";

import { Card } from "@/components/ui/Card";
import { createClient as createServerClient } from "@/lib/db/supabase-server";

type ResponseRow = {
  id: string;
  event_id: string;
  staff_member_id: string;
  old_status: string | null;
  new_status: string;
  actor_type: string;
  created_at: string;
  staff_members?: { display_name: string } | null;
  events?: { title: string } | null;
};

type Variant = "sidebar" | "section";

const RECENT_LIMIT = 5;

/**
 * Trimmed dashboard footer card — last `RECENT_LIMIT` RSVP responses pulled
 * from `invite_response_history`. v2 replaced the full activity feed sidebar
 * with this so Robert sees just "who responded recently" without the noise
 * of audit-log entries and manager notifications.
 *
 * The bell in the TopBar (and the full /dashboard/notifications page it
 * links to) still surfaces every other event type.
 */
export async function RecentResponses({
  variant = "sidebar",
}: {
  variant?: Variant;
}) {
  const supabase = await createServerClient();
  let rows: ResponseRow[] = [];
  try {
    const { data, error } = await supabase
      .from("invite_response_history")
      .select(
        "id, event_id, staff_member_id, old_status, new_status, actor_type, created_at, staff_members(display_name), events(title)",
      )
      .order("created_at", { ascending: false })
      .limit(RECENT_LIMIT);
    if (error) {
      console.warn("[RecentResponses] fetch failed:", error.message);
    } else {
      rows = (data ?? []) as unknown as ResponseRow[];
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[RecentResponses] fetch threw:", msg);
  }

  return (
    <Card style={{ padding: 0 }}>
      <div style={{ padding: "12px 14px 8px" }}>
        <span className="cs-eyebrow">Recent responses</span>
        <h2
          className="cs-h3"
          style={{ marginTop: 6, fontSize: variant === "section" ? 16 : 14 }}
        >
          Last {RECENT_LIMIT} RSVPs
        </h2>
      </div>
      {rows.length === 0 ? (
        <div
          style={{
            padding: "16px",
            color: "var(--text-3)",
            fontSize: 12,
            textAlign: "center",
            borderTop: "1px solid var(--hairline)",
          }}
        >
          No RSVP responses yet.
        </div>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            borderTop: "1px solid var(--hairline)",
          }}
        >
          {rows.map((row, i) => {
            const staffName = row.staff_members?.display_name ?? "Responder";
            const eventTitle = row.events?.title ?? "(event)";
            const tone = toneFor(row.new_status);
            return (
              <li
                key={row.id}
                style={{
                  borderTop: i === 0 ? undefined : "1px solid var(--hairline)",
                }}
              >
                <Link
                  href={`/dashboard/events/${row.event_id}`}
                  style={{
                    display: "flex",
                    gap: 10,
                    padding: "10px 14px",
                    color: "inherit",
                    textDecoration: "none",
                    alignItems: "flex-start",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      marginTop: 7,
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      flexShrink: 0,
                      background: `var(--${tone})`,
                    }}
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontSize: 13,
                        color: "var(--text)",
                        lineHeight: 1.35,
                      }}
                    >
                      <strong style={{ fontWeight: 600 }}>{staffName}</strong>{" "}
                      <span style={{ color: "var(--text-2)" }}>
                        {humanStatus(row.new_status)}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-3)",
                        marginTop: 2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {eventTitle}
                    </div>
                  </div>
                  <span
                    className="mono"
                    style={{
                      fontSize: 10,
                      color: "var(--text-3)",
                      letterSpacing: "0.04em",
                      flexShrink: 0,
                      marginTop: 3,
                    }}
                  >
                    {relativeShort(row.created_at)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function toneFor(status: string): "ok" | "warn" | "bad" | "text-3" {
  switch (status) {
    case "accepted":
      return "ok";
    case "declined":
    case "cancelled_by_member":
      return "bad";
    case "invited":
      return "warn";
    default:
      // CSS var `--text-3` exists in the Pit Wall token set; safe fallback.
      return "text-3";
  }
}

function humanStatus(status: string): string {
  switch (status) {
    case "accepted":
      return "accepted";
    case "declined":
      return "declined";
    case "cancelled_by_member":
      return "cancelled";
    case "invited":
      return "was invited";
    default:
      return status.replace(/_/g, " ");
  }
}

function relativeShort(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diffSec = Math.round((now.getTime() - then.getTime()) / 1000);
  if (diffSec < 60) return `${Math.max(diffSec, 0)}s`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 48) return `${diffHr}h`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d`;
}
