/**
 * Server-only queries for the audit log viewer. Joins the actor_user_id back
 * to the profiles table so the UI can render an email instead of a bare UUID.
 *
 * The total `audit_log` table can grow large — every query is bounded by
 * `limit` (page size) and a starting `offset` cursor for simple paging. For
 * very large logs we'd swap this for a created_at + id keyset, but a
 * 50-row page + numeric offset is plenty for the v1.1 owner-only viewer.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/db/audit-queries.ts is server-only");
}

import { createClient } from "@/lib/db/supabase-server";
import type { AuditLogRow, Profile } from "@/lib/db/types";

export type AuditLogEntry = AuditLogRow & {
  actor: Pick<Profile, "id" | "display_name" | "email"> | null;
};

export type AuditQueryFilters = {
  /** Action prefix filter: "staff", "event", "campaign", "payroll", "rsvp", "system", or undefined for all. */
  actionPrefix?: string;
  /** "today" | "7d" | "30d" | "all" */
  range?: "today" | "7d" | "30d" | "all";
  /** Page size (default 50). */
  limit?: number;
  /** Starting offset (default 0). */
  offset?: number;
};

function rangeStartIso(range: AuditQueryFilters["range"]): string | null {
  const now = new Date();
  switch (range) {
    case "today": {
      const startOfDay = new Date(now);
      startOfDay.setUTCHours(0, 0, 0, 0);
      return startOfDay.toISOString();
    }
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();
    case "all":
    default:
      return null;
  }
}

export async function listAuditLog(
  filters: AuditQueryFilters = {},
): Promise<AuditLogEntry[]> {
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const supabase = await createClient();
  let query = supabase
    .from("audit_log")
    .select(
      "id, actor_user_id, actor_type, action, entity_type, entity_id, summary, before, after, request_id, created_at",
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.actionPrefix && filters.actionPrefix !== "all") {
    // Match either an exact "system" action_type, or any "<prefix>.*" action.
    if (filters.actionPrefix === "system") {
      query = query.eq("actor_type", "system");
    } else {
      query = query.like("action", `${filters.actionPrefix}.%`);
    }
  }

  const startIso = rangeStartIso(filters.range);
  if (startIso) {
    query = query.gte("created_at", startIso);
  }

  const { data: rows, error } = await query;
  if (error) {
    console.warn("[audit-queries] listAuditLog failed:", error.message);
    return [];
  }

  const auditRows = (rows ?? []) as AuditLogRow[];

  // Resolve actor profiles in one round-trip for any actor_user_id values.
  const actorIds = Array.from(
    new Set(
      auditRows
        .map((r) => r.actor_user_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  );

  const actorById = new Map<string, Pick<Profile, "id" | "display_name" | "email">>();
  if (actorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name, email")
      .in("id", actorIds);
    for (const p of (profiles ?? []) as Array<
      Pick<Profile, "id" | "display_name" | "email">
    >) {
      actorById.set(p.id, p);
    }
  }

  return auditRows.map((r) => ({
    ...r,
    actor: r.actor_user_id ? (actorById.get(r.actor_user_id) ?? null) : null,
  }));
}

/**
 * Return the most-recent audit entry timestamp for one of the listed actions,
 * scoped to the caller. Used by the exports hub to render "last exported …"
 * for the roster + payroll CSV links.
 */
export async function getLatestAuditTimestampForActions(
  actions: string[],
): Promise<string | null> {
  if (actions.length === 0) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_log")
    .select("created_at, action")
    .in("action", actions)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[audit-queries] getLatestAuditTimestampForActions failed:", error.message);
    return null;
  }
  return (data?.created_at as string | undefined) ?? null;
}
