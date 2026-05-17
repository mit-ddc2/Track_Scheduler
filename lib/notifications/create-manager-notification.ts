// server-only: writes notifications using either the admin client (preferred
// for webhook/cron contexts) or the request-scoped server client as a
// fallback while SUPABASE_SECRET_KEY is not yet wired.
if (typeof window !== "undefined") {
  throw new Error(
    "lib/notifications/create-manager-notification.ts is server-only",
  );
}

import { createAdminClient } from "@/lib/db/supabase-admin";
import { createClient as createServerClient } from "@/lib/db/supabase-server";
import type {
  ManagerNotification,
  NotificationSeverity,
} from "@/lib/db/types";

import { getEventTypeDefinition } from "./event-types";

/**
 * Generic interface so we can plug either the admin or RLS-scoped client.
 *
 * NOTE: This hand-rolled shape will be replaced with
 * `SupabaseClient<Database>` once `audit_log` and the other Phase 3 tables
 * are added to `lib/db/types.ts`. Until then, casting the real client into
 * this minimal surface keeps the writer typed without requiring `as never`
 * on every call site.
 */
type WriterClient = {
  from: (table: "manager_notifications" | "profiles") => {
    insert: (row: Record<string, unknown>) => {
      select: (columns?: string) => {
        maybeSingle: () => Promise<{
          data: ManagerNotification | null;
          error: { code?: string; message: string } | null;
        }>;
      };
    };
    upsert: (
      row: Record<string, unknown>,
      options: { onConflict: string; ignoreDuplicates?: boolean },
    ) => {
      select: (columns?: string) => {
        maybeSingle: () => Promise<{
          data: ManagerNotification | null;
          error: { code?: string; message: string } | null;
        }>;
      };
    };
    select: (columns: string) => {
      eq: (column: string, value: unknown) => {
        eq: (column: string, value: unknown) => {
          limit: (count: number) => {
            maybeSingle: () => Promise<{
              data: { id: string } | null;
              error: { message: string } | null;
            }>;
          };
        };
        limit: (count: number) => {
          maybeSingle: () => Promise<{
            data: { id: string } | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  };
};

export type CreateManagerNotificationInput = {
  /** Defaults to the single owner when omitted. */
  profileId?: string;
  severity?: NotificationSeverity;
  eventType: string;
  title?: string;
  body?: string | null;
  eventId?: string | null;
  staffMemberId?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  /**
   * If supplied, the insert is conditional on `(profile_id, dedupe_key)` being
   * absent. Duplicate calls return `{ created: false }`.
   */
  dedupeKey?: string | null;
};

export type CreateManagerNotificationResult = {
  created: boolean;
  notification: ManagerNotification | null;
};

/**
 * Insert a notification row for the manager (Robert).
 *
 * Behaviour:
 * - Prefers the admin (service-role) client so callers without a session
 *   (Twilio/Google webhooks, cron jobs) can write. Falls back to the
 *   request-scoped server client when SUPABASE_SECRET_KEY is unset — only
 *   useful while an owner session is present (RLS allows owner inserts).
 * - When `dedupeKey` is supplied, the write is performed as a PostgREST
 *   `upsert` with `onConflict: "profile_id,dedupe_key"` and
 *   `ignoreDuplicates: true`. PostgREST translates this to
 *   `INSERT ... ON CONFLICT (profile_id, dedupe_key) DO NOTHING`. On a
 *   duplicate the server returns no row, so we surface `created: false`.
 *   This narrows the swallowed-conflict surface to the dedupe constraint
 *   only — unique violations on any other column will surface as errors.
 * - When `profileId` is omitted, looks up the single active owner.
 *
 * Throws `Error` for programmer mistakes (missing severity, missing event
 * type, no resolvable owner) so they fail loudly in dev.
 */
export async function createManagerNotification(
  input: CreateManagerNotificationInput,
): Promise<CreateManagerNotificationResult> {
  if (!input.eventType) {
    throw new Error("createManagerNotification: eventType is required");
  }

  const definition = getEventTypeDefinition(input.eventType);

  const severity: NotificationSeverity =
    input.severity ?? definition.defaultSeverity;

  if (severity !== "info" && severity !== "warning" && severity !== "urgent") {
    throw new Error(
      `createManagerNotification: invalid severity ${String(severity)}`,
    );
  }

  const title = input.title ?? definition.title;
  if (!title) {
    throw new Error(
      `createManagerNotification: no title for event_type ${input.eventType}`,
    );
  }

  const client = await resolveWriterClient();

  const profileId = input.profileId ?? (await resolveOwnerProfileId(client));
  if (!profileId) {
    throw new Error(
      "createManagerNotification: could not resolve a target profile id (no active owner found)",
    );
  }

  const row = {
    profile_id: profileId,
    severity,
    event_type: input.eventType,
    title,
    body: input.body ?? null,
    event_id: input.eventId ?? null,
    staff_member_id: input.staffMemberId ?? null,
    related_entity_type: input.relatedEntityType ?? null,
    related_entity_id: input.relatedEntityId ?? null,
    dedupe_key: input.dedupeKey ?? null,
  };

  const columns =
    "id, profile_id, severity, status, event_type, title, body, event_id, staff_member_id, related_entity_type, related_entity_id, dedupe_key, created_at, read_at";

  // When a dedupeKey is supplied we route through `upsert` with
  // `ignoreDuplicates: true` and `onConflict` pinned to the
  // `(profile_id, dedupe_key)` unique index. PostgREST emits
  // `INSERT ... ON CONFLICT (profile_id, dedupe_key) DO NOTHING` so the
  // server *only* swallows conflicts on that exact target — any other
  // unique-violation (e.g. a future constraint we add) will still surface
  // as a normal Supabase error and bubble out below.
  //
  // On a swallowed duplicate Supabase returns `data === null` with no
  // error; we translate that into `{ created: false }`.
  const builder = input.dedupeKey
    ? client.from("manager_notifications").upsert(row, {
        onConflict: "profile_id,dedupe_key",
        ignoreDuplicates: true,
      })
    : client.from("manager_notifications").insert(row);

  const { data, error } = await builder.select(columns).maybeSingle();

  if (error) {
    throw new Error(
      `createManagerNotification: insert failed — ${error.message}`,
    );
  }

  // Upsert with ignoreDuplicates returns `null` on dedupe hit.
  if (input.dedupeKey && !data) {
    return { created: false, notification: null };
  }

  return { created: true, notification: data ?? null };
}

async function resolveWriterClient(): Promise<WriterClient> {
  try {
    return createAdminClient() as unknown as WriterClient;
  } catch {
    // Admin client unavailable (SUPABASE_SECRET_KEY not set) — fall back to
    // the request-scoped server client. Only works when an owner session is
    // present so RLS allows the insert.
    return (await createServerClient()) as unknown as WriterClient;
  }
}

async function resolveOwnerProfileId(
  client: WriterClient,
): Promise<string | null> {
  const { data, error } = await client
    .from("profiles")
    .select("id")
    .eq("is_owner", true)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `createManagerNotification: failed to look up owner — ${error.message}`,
    );
  }

  return data?.id ?? null;
}
