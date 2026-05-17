// server-only — interacts with message_outbox using the admin client.
if (typeof window !== "undefined") {
  throw new Error("lib/messaging/outbox.ts is server-only");
}

import { createAdminClient } from "@/lib/db/supabase-admin";
import type { ContactChannel, MessageOutboxRow, OutboxStatus } from "@/lib/db/types";

import { sendEmail } from "./send-email";
import { sendSms } from "./send-sms";
import type { SendResult } from "./provider-types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type UntypedClient = { from: (table: string) => any };

// ─── Types ──────────────────────────────────────────────────────
export type EnqueueMessageInput = {
  campaignId?: string | null;
  inviteId?: string | null;
  staffMemberId?: string | null;
  managerNotificationId?: string | null;
  channel: ContactChannel;
  toValue: string;
  subject?: string | null;
  bodyText: string;
  bodyHtml?: string | null;
  provider: string;
  idempotencyKey: string;
};

export type EnqueueResult = {
  outboxId: string;
  deduped: boolean;
};

export type DrainResult = {
  attempted: number;
  sent: number;
  failed: number;
  suppressed: number;
};

// Suppression-aware drain (spec §14.3). Reasons we will refuse to send a
// queued row even if its retry window is up:
//   * the recipient's contact method is opted_out / bounced / suppressed /
//     invalid for the channel,
//   * the recipient's consent for the channel is withdrawn / denied,
//   * the event has been cancelled and the campaign is NOT a cancellation
//     notice (those still need to go out).
type SuppressionReason =
  | "contact_opted_out"
  | "contact_bounced"
  | "contact_suppressed"
  | "contact_invalid"
  | "consent_withdrawn"
  | "consent_denied"
  | "event_cancelled";

const SUPPRESSED_CONTACT_STATUSES = new Set([
  "opted_out",
  "bounced",
  "suppressed",
  "invalid",
]);
const SUPPRESSED_CONSENT_STATUSES = new Set(["withdrawn", "denied"]);

// ─── Retry policy (spec §14.3) ──────────────────────────────────
// Attempt 1 immediate (no delay set), 2 → +2m, 3 → +10m, 4 → +1h,
// then fail. Returned values are minutes to delay from now.
const RETRY_DELAYS_MINUTES = [2, 10, 60] as const;
export const MAX_ATTEMPTS = 4;

function computeNextAttemptAt(
  attemptNumberJustMade: number,
  now: Date = new Date(),
): string | null {
  // Index into the delays: attempt 1 finished → use delays[0]; attempt 4
  // finished → no more retries.
  const idx = attemptNumberJustMade - 1;
  if (idx >= RETRY_DELAYS_MINUTES.length) return null;
  const minutes = RETRY_DELAYS_MINUTES[idx];
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

// ─── Test seam ──────────────────────────────────────────────────
// Override providers (e.g., in tests) so we don't have to mock node_modules.
type Providers = {
  sendSms: typeof sendSms;
  sendEmail: typeof sendEmail;
};
let providersOverride: Providers | null = null;
export function __setProvidersForTesting(p: Providers | null) {
  providersOverride = p;
}
function getProviders(): Providers {
  return providersOverride ?? { sendSms, sendEmail };
}

// Allow swapping the admin client for unit tests without spinning up Supabase.
// We deliberately use a loose type here — the Supabase typed builder enforces
// a per-table Update shape that's noisy to mirror by hand, and Phase 1 only
// types `profiles` strictly. We re-narrow at insert/update call sites instead.
type AdminClient = UntypedClient;
let adminOverride: AdminClient | null = null;
export function __setAdminClientForTesting(client: AdminClient | null) {
  adminOverride = client;
}
function getAdmin(): AdminClient {
  return adminOverride ?? (createAdminClient() as unknown as AdminClient);
}

// ─── enqueueOutboxMessage ───────────────────────────────────────
/**
 * Inserts a pending outbox row. Idempotency: if a row already exists with the
 * same idempotency_key, we DO NOT insert a duplicate — we return the existing
 * row id with `deduped: true`. Callers can short-circuit safely.
 */
export async function enqueueOutboxMessage(
  input: EnqueueMessageInput,
): Promise<EnqueueResult> {
  const admin = getAdmin();

  // Check first (cheap; idempotency_key has a unique index).
  const existing = await admin
    .from("message_outbox")
    .select("id")
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();

  if (existing.error && existing.error.code !== "PGRST116") {
    throw new Error(
      `[outbox] lookup failed: ${existing.error.message ?? "unknown"}`,
    );
  }
  if (existing.data?.id) {
    return { outboxId: existing.data.id, deduped: true };
  }

  const inserted = await admin
    .from("message_outbox")
    .insert({
      campaign_id: input.campaignId ?? null,
      invite_id: input.inviteId ?? null,
      staff_member_id: input.staffMemberId ?? null,
      manager_notification_id: input.managerNotificationId ?? null,
      channel: input.channel,
      to_value: input.toValue,
      subject: input.subject ?? null,
      body_text: input.bodyText,
      body_html: input.bodyHtml ?? null,
      provider: input.provider,
      idempotency_key: input.idempotencyKey,
      status: "pending" as OutboxStatus,
      attempt_count: 0,
    })
    .select("id")
    .single();

  if (inserted.error) {
    // Unique-violation: another writer inserted between our SELECT and INSERT
    // — re-fetch and return as a dedupe so the caller treats it as success.
    if (inserted.error.code === "23505") {
      const refetch = await admin
        .from("message_outbox")
        .select("id")
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle();
      if (refetch.data?.id) {
        return { outboxId: refetch.data.id, deduped: true };
      }
    }
    throw new Error(
      `[outbox] insert failed: ${inserted.error.message ?? "unknown"}`,
    );
  }

  return { outboxId: inserted.data!.id, deduped: false };
}

// ─── drainOutbox ────────────────────────────────────────────────
export type DrainOptions = {
  limit?: number;
  now?: Date; // for tests
};

/**
 * Pull a batch of due outbox rows, send each through its provider, and
 * persist the result. Designed to run from a cron route once per minute.
 *
 * Semantics:
 *  - Selects rows where status='pending' and (next_attempt_at IS NULL OR <= now).
 *  - Marks each as 'sending' before calling the provider so a concurrent run
 *    won't double-send (best-effort; final guard is the provider idempotency
 *    key).
 *  - On success: status='sent', sent_at=now, provider_message_id set.
 *  - On failure with retries remaining: status='pending', next_attempt_at set
 *    per the §14.3 schedule, error_code/message recorded.
 *  - On failure after MAX_ATTEMPTS: status='failed'.
 */
export async function drainOutbox(
  options: DrainOptions = {},
): Promise<DrainResult> {
  const limit = options.limit ?? 25;
  const admin = getAdmin();
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();

  const due = await admin
    .from("message_outbox")
    .select("*")
    .eq("status", "pending")
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (due.error) {
    throw new Error(`[outbox] drain query failed: ${due.error.message}`);
  }
  const rows = (due.data ?? []) as MessageOutboxRow[];

  // P-H1: batch the suppression-check lookups. Instead of 1-3 round-trips
  // per row inside `checkSuppression`, we fetch all relevant
  // contact-method / campaign / event rows for the whole batch in 3
  // queries total (one .in() per table). The per-row check then becomes a
  // pure in-memory lookup against three Maps.
  const suppressionCtx = await buildSuppressionContext(admin, rows);

  let sent = 0;
  let failed = 0;
  let suppressed = 0;

  const providers = getProviders();

  for (const row of rows) {
    // Try to claim it: pending → sending. We return the affected rows and
    // check the length so a concurrent drainer can't double-send: the second
    // claimer will get an empty array back (the WHERE status='pending' no
    // longer matches) and skip the row.
    const claim = await admin
      .from("message_outbox")
      .update({
        status: "sending" as OutboxStatus,
        last_attempt_at: nowIso,
      })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id");
    if (claim.error) continue;
    const claimed = (claim.data ?? []) as Array<{ id: string }>;
    if (claimed.length === 0) continue;

    // Suppression check (spec §14.3). Pure in-memory check against the
    // pre-fetched batch context — no DB round-trips here.
    const reason = checkSuppressionFromContext(row, suppressionCtx);
    if (reason) {
      await admin
        .from("message_outbox")
        .update({
          status: "cancelled" as OutboxStatus,
          next_attempt_at: null,
          error_code: "SUPPRESSED",
          error_message: reason,
        })
        .eq("id", row.id);
      suppressed += 1;
      continue;
    }

    const attemptCount = row.attempt_count + 1;
    let result: SendResult;
    try {
      if (row.channel === "sms") {
        result = await providers.sendSms({
          to: row.to_value,
          body: row.body_text,
          idempotencyKey: row.idempotency_key,
        });
      } else {
        result = await providers.sendEmail({
          to: row.to_value,
          subject: row.subject ?? "",
          html: row.body_html ?? row.body_text,
          text: row.body_text,
          idempotencyKey: row.idempotency_key,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result = {
        accepted: false,
        errorCode: "PROVIDER_EXCEPTION",
        errorMessage: msg,
      };
    }

    if (result.accepted) {
      await admin
        .from("message_outbox")
        .update({
          status: "sent" as OutboxStatus,
          sent_at: nowIso,
          provider_message_id: result.providerMessageId,
          attempt_count: attemptCount,
          error_code: null,
          error_message: null,
          next_attempt_at: null,
        })
        .eq("id", row.id);
      sent += 1;
      continue;
    }

    const nextAt = computeNextAttemptAt(attemptCount, now);
    if (nextAt && attemptCount < MAX_ATTEMPTS) {
      await admin
        .from("message_outbox")
        .update({
          status: "pending" as OutboxStatus,
          attempt_count: attemptCount,
          next_attempt_at: nextAt,
          error_code: result.errorCode,
          error_message: result.errorMessage,
        })
        .eq("id", row.id);
    } else {
      await admin
        .from("message_outbox")
        .update({
          status: "failed" as OutboxStatus,
          attempt_count: attemptCount,
          next_attempt_at: null,
          error_code: result.errorCode,
          error_message: result.errorMessage,
        })
        .eq("id", row.id);
      failed += 1;
    }
  }

  return {
    attempted: rows.length,
    sent,
    failed,
    suppressed,
  };
}

// ─── Suppression check (batched, spec §14.3) ───────────────────
/**
 * Per-batch context populated by a fixed number of round-trips up front so
 * the per-row check can run entirely in memory. Replaces the legacy
 * per-row `checkSuppression` (which did 1-3 round-trips per row).
 */
type SuppressionContext = {
  // (staff_member_id|channel|normalized_value) → { status, consent }
  contactByKey: Map<string, { status: string; consent: string }>;
  // campaign_id → { event_id, campaign_type }
  campaignsById: Map<string, { event_id: string | null; campaign_type: string }>;
  // event_id → status
  eventStatusById: Map<string, string>;
};

function contactKey(
  staffMemberId: string,
  channel: string,
  normalizedValue: string,
): string {
  return `${staffMemberId}|${channel}|${normalizedValue}`;
}

async function buildSuppressionContext(
  admin: AdminClient,
  rows: MessageOutboxRow[],
): Promise<SuppressionContext> {
  const ctx: SuppressionContext = {
    contactByKey: new Map(),
    campaignsById: new Map(),
    eventStatusById: new Map(),
  };
  if (rows.length === 0) return ctx;

  const staffIds = Array.from(
    new Set(
      rows
        .map((r) => r.staff_member_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const campaignIds = Array.from(
    new Set(
      rows
        .map((r) => r.campaign_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  // 1) Pull all contact methods for the staff in the batch in ONE query.
  //    We filter precisely on the (staff, channel, value) tuple in memory.
  if (staffIds.length > 0) {
    const cmRes = await admin
      .from("staff_contact_methods")
      .select("staff_member_id, channel, normalized_value, status, consent")
      .in("staff_member_id", staffIds);
    if (!cmRes.error) {
      type CmRow = {
        staff_member_id: string;
        channel: string;
        normalized_value: string;
        status?: string;
        consent?: string;
      };
      for (const r of (cmRes.data ?? []) as CmRow[]) {
        ctx.contactByKey.set(
          contactKey(r.staff_member_id, r.channel, r.normalized_value),
          { status: r.status ?? "", consent: r.consent ?? "" },
        );
      }
    }
  }

  // 2) Pull all campaigns referenced by the batch in ONE query.
  if (campaignIds.length > 0) {
    const campaignsRes = await admin
      .from("invitation_campaigns" as never)
      .select("id, event_id, campaign_type")
      .in("id", campaignIds);
    if (!campaignsRes.error) {
      type CRow = { id: string; event_id: string | null; campaign_type: string };
      const eventIds = new Set<string>();
      for (const r of (campaignsRes.data ?? []) as CRow[]) {
        ctx.campaignsById.set(r.id, {
          event_id: r.event_id,
          campaign_type: r.campaign_type ?? "",
        });
        if (r.event_id) eventIds.add(r.event_id);
      }

      // 3) Pull statuses for all referenced events in ONE query.
      if (eventIds.size > 0) {
        const evRes = await admin
          .from("events")
          .select("id, status")
          .in("id", Array.from(eventIds));
        if (!evRes.error) {
          type ERow = { id: string; status?: string };
          for (const r of (evRes.data ?? []) as ERow[]) {
            ctx.eventStatusById.set(r.id, r.status ?? "");
          }
        }
      }
    }
  }

  return ctx;
}

/** Pure in-memory suppression check against the pre-built batch context. */
function checkSuppressionFromContext(
  row: MessageOutboxRow,
  ctx: SuppressionContext,
): SuppressionReason | null {
  // 1) Contact method check.
  if (row.staff_member_id) {
    const cm = ctx.contactByKey.get(
      contactKey(row.staff_member_id, row.channel, row.to_value),
    );
    if (cm) {
      if (SUPPRESSED_CONTACT_STATUSES.has(cm.status)) {
        return `contact_${cm.status}` as SuppressionReason;
      }
      if (SUPPRESSED_CONSENT_STATUSES.has(cm.consent)) {
        return `consent_${cm.consent}` as SuppressionReason;
      }
    }
  }

  // 2) Event-cancelled check. Cancellation notices still go out.
  if (row.campaign_id) {
    const c = ctx.campaignsById.get(row.campaign_id);
    if (c) {
      const isCancellationNotice = c.campaign_type
        .toLowerCase()
        .includes("cancellation");
      if (c.event_id && !isCancellationNotice) {
        const status = ctx.eventStatusById.get(c.event_id);
        if (status === "cancelled") return "event_cancelled";
      }
    }
  }

  return null;
}

// ─── cancelOutboxForEvent ───────────────────────────────────────
/**
 * Marks any still-pending outbox rows for a given event's campaigns as
 * cancelled. Used when an event is cancelled by Robert — we want to stop
 * the queue from sending stale invites without throwing away the audit
 * trail of what was queued.
 */
export async function cancelOutboxForEvent(eventId: string): Promise<{
  cancelled: number;
}> {
  const admin = getAdmin();

  // Find campaigns for the event.
  const campaigns = await admin
    .from("invitation_campaigns" as never)
    .select("id")
    .eq("event_id", eventId);
  if (campaigns.error) {
    throw new Error(
      `[outbox] campaign lookup failed: ${campaigns.error.message}`,
    );
  }
  const campaignIds = ((campaigns.data ?? []) as Array<{ id: string }>).map(
    (c) => c.id,
  );
  if (campaignIds.length === 0) return { cancelled: 0 };

  const upd = await admin
    .from("message_outbox")
    .update({ status: "cancelled" as OutboxStatus, next_attempt_at: null })
    .in("campaign_id", campaignIds)
    .eq("status", "pending")
    .select("id");
  if (upd.error) {
    throw new Error(`[outbox] cancel failed: ${upd.error.message}`);
  }
  return { cancelled: (upd.data ?? []).length };
}
