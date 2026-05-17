// server-only: uses the admin (service-role) client so RLS doesn't drop writes.
if (typeof window !== "undefined") {
  throw new Error("lib/db/audit.ts is server-only");
}

import { createAdminClient } from "./supabase-admin";

export type AuditActorType = "owner" | "system" | "member";

export type AuditEntry = {
  action: string;
  entity_type: string;
  entity_id: string;
  summary: string;
  before?: unknown;
  after?: unknown;
  actorType?: AuditActorType;
  actorId?: string | null;
};

/**
 * Record an entry in the audit log. Best-effort: never throws to the caller
 * (audit failure should not break the parent action). If the admin client
 * isn't configured yet (e.g., SUPABASE_SECRET_KEY missing in early phases)
 * the attempt is logged to the server console and the call is a no-op.
 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  const actorType: AuditActorType = entry.actorType ?? "owner";

  try {
    const admin = createAdminClient();
    const { error } = await admin.from("audit_log").insert({
      action: entry.action,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id,
      summary: entry.summary,
      before: entry.before ?? null,
      after: entry.after ?? null,
      actor_type: actorType,
      // Column name per schema is actor_user_id — see
      // supabase/migrations/0001_initial_schema.sql.
      actor_user_id: entry.actorId ?? null,
    });
    if (error) {
      console.warn("[audit] insert failed:", error.message, entry);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Most common pre-Phase-5 failure: SUPABASE_SECRET_KEY not set.
    console.warn("[audit] skipped (admin client unavailable):", msg, {
      action: entry.action,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id,
    });
  }
}
