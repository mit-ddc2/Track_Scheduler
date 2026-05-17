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

/** Generic interface so we can plug either the admin or RLS-scoped client. */
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
 * - When `dedupeKey` is supplied, relies on the unique index
 *   `(profile_id, dedupe_key)` to swallow the second write. We detect that
 *   case by checking error code `23505` and return `created: false`.
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

  const { data, error } = await client
    .from("manager_notifications")
    .insert(row)
    .select(
      "id, profile_id, severity, status, event_type, title, body, event_id, staff_member_id, related_entity_type, related_entity_id, dedupe_key, created_at, read_at",
    )
    .maybeSingle();

  if (error) {
    // Postgres unique_violation — dedupe hit.
    if (error.code === "23505" && input.dedupeKey) {
      return { created: false, notification: null };
    }
    throw new Error(
      `createManagerNotification: insert failed — ${error.message}`,
    );
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
