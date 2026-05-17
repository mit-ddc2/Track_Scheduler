/**
 * Server-side queries + merge logic for the dashboard "Live feed".
 *
 * Pulls recent rows from three sources — `manager_notifications`,
 * `invite_response_history`, and `audit_log` — and folds them into a single
 * descending-timestamp timeline of `ActivityItem`s. The list is intentionally
 * capped at 20 items so the dashboard sidebar stays scan-able.
 *
 * Pure (`mergeActivity`) and impure (`fetchActivityFeed`) halves are split so
 * the merge logic is testable without any Supabase wiring.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/dashboard/activity-feed.ts is server-only");
}

import { createClient as createServerClient } from "@/lib/db/supabase-server";
import type { ManagerNotification } from "@/lib/db/types";

export type ActivityTone = "ok" | "warn" | "bad" | "idle";
export type ActivityActor = "owner" | "responder" | "system";

export type ActivityItem = {
  /** Stable id — prefixed by source so cross-source collisions are impossible. */
  id: string;
  source: "notification" | "response" | "audit";
  /** ISO timestamp the underlying row was created at. */
  createdAt: string;
  actor: ActivityActor;
  /** Display name of the actor (e.g. "Marc Bélanger", "You", "System"). */
  actorLabel: string;
  /** Action description ("accepted", "declined", "sent 12 invites"). */
  action: string;
  /** Short caption — typically the related event title or "Calendar". */
  caption: string | null;
  /** Pit Wall status tone for the bullet dot. */
  tone: ActivityTone;
  /** Internal href the row activates (event detail, roster, etc.). */
  href: string | null;
};

export const ACTIVITY_FEED_LIMIT = 20;
const RECENT_HOURS = 24;
const QUERY_LIMIT = 40;

type RawResponseHistory = {
  id: string;
  invite_id: string;
  event_id: string;
  staff_member_id: string;
  old_status: string | null;
  new_status: string;
  actor_type: string;
  response_note: string | null;
  created_at: string;
  staff_members?: { display_name: string } | null;
  events?: { title: string } | null;
};

type RawAuditRow = {
  id: string;
  actor_type: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string | null;
  created_at: string;
  profiles?: { display_name: string } | null;
};

export type ActivityFeedSources = {
  notifications: ManagerNotification[];
  responses: RawResponseHistory[];
  audits: RawAuditRow[];
};

/** Pure: merge + sort + cap the three timelines. */
export function mergeActivity(
  sources: ActivityFeedSources,
  limit: number = ACTIVITY_FEED_LIMIT,
): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const n of sources.notifications) {
    items.push(fromNotification(n));
  }
  for (const r of sources.responses) {
    items.push(fromResponse(r));
  }
  for (const a of sources.audits) {
    items.push(fromAudit(a));
  }
  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return items.slice(0, limit);
}

function fromNotification(n: ManagerNotification): ActivityItem {
  const tone: ActivityTone =
    n.severity === "urgent"
      ? "bad"
      : n.severity === "warning"
        ? "warn"
        : "idle";
  const href = n.event_id
    ? `/dashboard/events/${n.event_id}`
    : n.staff_member_id
      ? `/dashboard/roster/${n.staff_member_id}`
      : "/dashboard/notifications";
  return {
    id: `notification:${n.id}`,
    source: "notification",
    createdAt: n.created_at,
    actor: "system",
    actorLabel: "System",
    action: n.title,
    caption: n.body ?? null,
    tone,
    href,
  };
}

function fromResponse(r: RawResponseHistory): ActivityItem {
  const name = r.staff_members?.display_name ?? "Responder";
  const tone: ActivityTone =
    r.new_status === "accepted"
      ? "ok"
      : r.new_status === "declined" ||
          r.new_status === "cancelled_by_member" ||
          r.new_status === "cancelled_by_manager"
        ? "bad"
        : r.new_status === "availability_updated"
          ? "warn"
          : "idle";
  const verb =
    r.new_status === "accepted"
      ? "accepted"
      : r.new_status === "declined"
        ? "declined"
        : r.new_status === "cancelled_by_member"
          ? "cancelled"
          : r.new_status === "cancelled_by_manager"
            ? "removed by manager"
            : r.new_status === "availability_updated"
              ? "updated availability"
              : r.new_status === "invited"
                ? "was invited"
                : r.new_status === "expired"
                  ? "invite expired"
                  : r.new_status.replace(/_/g, " ");
  return {
    id: `response:${r.id}`,
    source: "response",
    createdAt: r.created_at,
    actor: "responder",
    actorLabel: name,
    action: verb,
    caption: r.events?.title ?? null,
    tone,
    href: `/dashboard/events/${r.event_id}`,
  };
}

function fromAudit(a: RawAuditRow): ActivityItem {
  const actor: ActivityActor =
    a.actor_type === "owner"
      ? "owner"
      : a.actor_type === "system"
        ? "system"
        : "responder";
  const actorLabel =
    a.actor_type === "owner"
      ? (a.profiles?.display_name ?? "You")
      : a.actor_type === "system"
        ? "System"
        : (a.profiles?.display_name ?? "Responder");
  const tone: ActivityTone = toneForAction(a.action);
  const href = hrefForAudit(a);
  return {
    id: `audit:${a.id}`,
    source: "audit",
    createdAt: a.created_at,
    actor,
    actorLabel,
    action: a.summary ?? humanizeAction(a.action),
    caption: a.entity_type ? a.entity_type.replace(/_/g, " ") : null,
    tone,
    href,
  };
}

function toneForAction(action: string): ActivityTone {
  if (action.includes("cancel") || action.includes("delete")) return "bad";
  if (action.includes("fail")) return "bad";
  if (action.includes("send") || action.includes("invite")) return "warn";
  if (action.includes("create") || action.includes("update")) return "idle";
  return "idle";
}

function humanizeAction(action: string): string {
  return action.replace(/[._]/g, " ");
}

function hrefForAudit(a: RawAuditRow): string | null {
  if (!a.entity_id) return null;
  switch (a.entity_type) {
    case "event":
    case "events":
      return `/dashboard/events/${a.entity_id}`;
    case "staff_member":
    case "staff_members":
      return `/dashboard/roster/${a.entity_id}`;
    default:
      return null;
  }
}

/**
 * Server-side: pull the three source tables and merge them. RLS already
 * confines `manager_notifications` to the current owner; `audit_log` and
 * `invite_response_history` are owner-readable per RLS migration 0002.
 */
export async function fetchActivityFeed(
  profileId: string,
): Promise<ActivityItem[]> {
  const supabase = await createServerClient();
  const sinceIso = new Date(
    Date.now() - RECENT_HOURS * 3600 * 1000,
  ).toISOString();

  const [{ data: notifData }, { data: respData }, { data: auditData }] =
    await Promise.all([
      supabase
        .from("manager_notifications")
        .select(
          "id, profile_id, severity, status, event_type, title, body, event_id, staff_member_id, related_entity_type, related_entity_id, dedupe_key, created_at, read_at",
        )
        .eq("profile_id", profileId)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(QUERY_LIMIT),
      supabase
        .from("invite_response_history")
        .select(
          "id, invite_id, event_id, staff_member_id, old_status, new_status, actor_type, response_note, created_at, staff_members(display_name), events(title)",
        )
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(QUERY_LIMIT),
      supabase
        .from("audit_log")
        .select(
          "id, actor_type, actor_user_id, action, entity_type, entity_id, summary, created_at, profiles(display_name)",
        )
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(QUERY_LIMIT),
    ]);

  return mergeActivity({
    notifications: (notifData ?? []) as ManagerNotification[],
    responses: (respData ?? []) as unknown as RawResponseHistory[],
    audits: (auditData ?? []) as unknown as RawAuditRow[],
  });
}
