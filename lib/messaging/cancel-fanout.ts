/**
 * Cancellation fan-out (v2 Wave B3).
 *
 * After `cancelEvent()` flips `events.status='cancelled'`, this orchestrator
 * walks every still-active invite, groups by responder, looks up each
 * responder's preferred contact methods, and enqueues ONE outbox row per
 * (recipient, channel). Multi-day responders get ONE message that lists
 * every affected day — never one per day.
 *
 * Server-only.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/messaging/cancel-fanout.ts is server-only");
}

import { createHash } from "node:crypto";

import { createAdminClient } from "@/lib/db/supabase-admin";
import type {
  ContactChannel,
  ContactStatus,
  ConsentStatus,
  PreferredContactMethod,
} from "@/lib/db/types";

import { enqueueOutboxMessage } from "./outbox";
import {
  renderCancellationEmail,
  renderCancellationSms,
  type TemplateEvent,
} from "./render-templates";

/* eslint-disable @typescript-eslint/no-explicit-any */
type UntypedClient = { from: (table: string) => any };

let adminOverride: UntypedClient | null = null;
/** Test seam — swap the admin client. */
export function __setAdminClientForTesting(client: UntypedClient | null) {
  adminOverride = client;
}
function getAdmin(): UntypedClient {
  return adminOverride ?? (createAdminClient() as unknown as UntypedClient);
}

// Statuses we treat as "still owes the responder a heads-up". Anyone who has
// already declined / cancelled / expired / been replaced by manager doesn't
// need another nudge — they already know they aren't expected.
const NOTIFIABLE_INVITE_STATUSES: ReadonlySet<string> = new Set([
  "invited",
  "accepted",
  "availability_updated",
]);

const SUPPRESSED_CONTACT: ReadonlySet<ContactStatus> = new Set([
  "opted_out",
  "bounced",
  "suppressed",
  "invalid",
]);
const SUPPRESSED_CONSENT: ReadonlySet<ConsentStatus> = new Set([
  "withdrawn",
  "denied",
]);

export type CancellationFanoutInput = {
  eventId: string;
  /** Optional reason passed through to the email body. */
  reason?: string | null;
  /** Optional override for the env var, mostly for tests. */
  ownerContactPhone?: string | null;
};

export type CancellationFanoutResult = {
  recipients: number;
  sms_enqueued: number;
  email_enqueued: number;
  skipped_no_contact: number;
  skipped_opt_out: number;
  skipped_manual_only: number;
  invites_marked: number;
  assignments_marked: number;
};

type StaffRow = {
  id: string;
  display_name: string;
  preferred_contact: PreferredContactMethod;
  active: boolean;
};

type ContactRow = {
  staff_member_id: string;
  channel: ContactChannel;
  value: string;
  normalized_value: string;
  is_primary: boolean;
  status: ContactStatus;
  consent: ConsentStatus;
};

type InviteRow = {
  id: string;
  staff_member_id: string;
  status: string;
  day_date: string;
};

function pickContact(
  contacts: ContactRow[],
  staffId: string,
  channel: ContactChannel,
): ContactRow | undefined {
  const matches = contacts.filter(
    (c) => c.staff_member_id === staffId && c.channel === channel,
  );
  return (
    matches.find((c) => c.is_primary) ??
    matches.find((c) => !SUPPRESSED_CONTACT.has(c.status)) ??
    matches[0]
  );
}

function preferenceAllowsChannel(
  pref: PreferredContactMethod,
  channel: ContactChannel,
): boolean {
  if (pref === "manual_only") return false;
  if (pref === "both") return true;
  return pref === channel;
}

function templateHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}

/**
 * Send a cancellation notification to every responder still on the invite
 * list. Returns counts the caller can include in the audit log + UI summary.
 *
 * Idempotency: the outbox key includes the event id + recipient + channel +
 * template hash, so re-running this on the same event won't enqueue
 * duplicate messages (the outbox dedupes via unique idempotency_key).
 */
export async function sendCancellationFanout(
  input: CancellationFanoutInput,
): Promise<CancellationFanoutResult> {
  const admin = getAdmin();

  // 1) Pull the event row so the templates can render real copy. We look it
  //    up here (rather than trust the caller to pass it) so the function
  //    can be invoked from anywhere the eventId is known.
  const eventResp = await admin
    .from("events")
    .select(
      "id, title, starts_at, ends_at, timezone, location, event_type, status",
    )
    .eq("id", input.eventId)
    .maybeSingle();
  if (eventResp.error || !eventResp.data) {
    throw new Error(
      `cancel-fanout: event ${input.eventId} not found${
        eventResp.error ? ` — ${eventResp.error.message}` : ""
      }`,
    );
  }
  const event = eventResp.data as TemplateEvent;

  // 2) Pull every invite that isn't already terminal. We need the day_date
  //    so the template can list every affected day per recipient.
  const inviteResp = await admin
    .from("event_invites")
    .select("id, staff_member_id, status, day_date")
    .eq("event_id", input.eventId)
    .in("status", Array.from(NOTIFIABLE_INVITE_STATUSES));
  if (inviteResp.error) {
    throw new Error(
      `cancel-fanout: invite lookup failed — ${inviteResp.error.message}`,
    );
  }
  const invites = (inviteResp.data ?? []) as InviteRow[];

  // Group by staff member.
  const daysByStaff = new Map<string, Set<string>>();
  const inviteIdsByStaff = new Map<string, string[]>();
  for (const inv of invites) {
    if (!inv.staff_member_id) continue;
    if (!daysByStaff.has(inv.staff_member_id)) {
      daysByStaff.set(inv.staff_member_id, new Set());
    }
    daysByStaff.get(inv.staff_member_id)!.add(inv.day_date);
    if (!inviteIdsByStaff.has(inv.staff_member_id)) {
      inviteIdsByStaff.set(inv.staff_member_id, []);
    }
    inviteIdsByStaff.get(inv.staff_member_id)!.push(inv.id);
  }

  const result: CancellationFanoutResult = {
    recipients: 0,
    sms_enqueued: 0,
    email_enqueued: 0,
    skipped_no_contact: 0,
    skipped_opt_out: 0,
    skipped_manual_only: 0,
    invites_marked: 0,
    assignments_marked: 0,
  };

  if (daysByStaff.size === 0) {
    // Nothing to fan out, but still flip any stale assignments to cancelled
    // so the per-day matrix stays accurate.
    const asgnUpdate = await admin
      .from("event_assignments")
      .update({
        status: "cancelled",
        cancellation_reason: input.reason ?? "Event cancelled by manager",
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("event_id", input.eventId)
      .in("status", ["confirmed", "waitlisted"])
      .select("id");
    if (!asgnUpdate.error) {
      result.assignments_marked = (asgnUpdate.data ?? []).length;
    }
    return result;
  }

  const staffIds = Array.from(daysByStaff.keys());

  // 3) Resolve staff + contact methods in two list queries.
  const staffResp = await admin
    .from("staff_members")
    .select("id, display_name, preferred_contact, active")
    .in("id", staffIds);
  if (staffResp.error) {
    throw new Error(
      `cancel-fanout: staff lookup failed — ${staffResp.error.message}`,
    );
  }
  const staffRows = (staffResp.data ?? []) as StaffRow[];

  const contactResp = await admin
    .from("staff_contact_methods")
    .select(
      "staff_member_id, channel, value, normalized_value, is_primary, status, consent",
    )
    .in("staff_member_id", staffIds);
  if (contactResp.error) {
    throw new Error(
      `cancel-fanout: contact lookup failed — ${contactResp.error.message}`,
    );
  }
  const contactRows = (contactResp.data ?? []) as ContactRow[];

  const smsTplHash = templateHash("cancellation-sms-v1");
  const emailTplHash = templateHash("cancellation-email-v1");

  // 4) For each recipient, enqueue at most one row per allowed channel.
  for (const staffId of staffIds) {
    const dayDates = Array.from(daysByStaff.get(staffId) ?? []).sort();
    const staff = staffRows.find((s) => s.id === staffId);
    if (!staff || !staff.active) {
      result.skipped_no_contact += 1;
      continue;
    }

    if (staff.preferred_contact === "manual_only") {
      result.skipped_manual_only += 1;
      continue;
    }

    // Build the channel list from the recipient's preference. "both" → both;
    // "sms"/"email" → just that one.
    const desiredChannels: ContactChannel[] =
      staff.preferred_contact === "both"
        ? ["sms", "email"]
        : [staff.preferred_contact as ContactChannel];

    const reachable: Array<{ channel: ContactChannel; contact: ContactRow }> = [];
    let suppressedHit = false;
    for (const ch of desiredChannels) {
      if (!preferenceAllowsChannel(staff.preferred_contact, ch)) continue;
      const contact = pickContact(contactRows, staffId, ch);
      if (!contact) continue;
      if (SUPPRESSED_CONTACT.has(contact.status)) {
        suppressedHit = true;
        continue;
      }
      if (SUPPRESSED_CONSENT.has(contact.consent)) {
        suppressedHit = true;
        continue;
      }
      reachable.push({ channel: ch, contact });
    }

    if (reachable.length === 0) {
      if (suppressedHit) result.skipped_opt_out += 1;
      else result.skipped_no_contact += 1;
      continue;
    }

    const recipient = { display_name: staff.display_name };
    result.recipients += 1;

    for (const { channel, contact } of reachable) {
      if (channel === "sms") {
        const body = renderCancellationSms({
          event,
          recipient,
          dayDates,
        });
        try {
          await enqueueOutboxMessage({
            channel: "sms",
            toValue: contact.normalized_value || contact.value,
            bodyText: body,
            provider: "twilio",
            staffMemberId: staffId,
            idempotencyKey: `cancellation:${input.eventId}:${staffId}:sms:${smsTplHash}`,
          });
          result.sms_enqueued += 1;
        } catch (err) {
          console.warn(
            "[cancel-fanout] sms enqueue failed for",
            staffId,
            err instanceof Error ? err.message : err,
          );
        }
      } else {
        const rendered = renderCancellationEmail({
          event,
          recipient,
          dayDates,
          reason: input.reason ?? null,
          ownerContactPhone: input.ownerContactPhone ?? null,
        });
        try {
          await enqueueOutboxMessage({
            channel: "email",
            toValue: contact.normalized_value || contact.value,
            subject: rendered.subject,
            bodyText: rendered.text,
            bodyHtml: rendered.html,
            provider: "resend",
            staffMemberId: staffId,
            idempotencyKey: `cancellation:${input.eventId}:${staffId}:email:${emailTplHash}`,
          });
          result.email_enqueued += 1;
        } catch (err) {
          console.warn(
            "[cancel-fanout] email enqueue failed for",
            staffId,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }
  }

  // 5) Mark invites + assignments as manager-cancelled. We do this after
  //    enqueuing so a transient enqueue failure doesn't poison the audit
  //    trail (the user can re-run the cancel which is idempotent).
  const stampIso = new Date().toISOString();
  const inviteUpdate = await admin
    .from("event_invites")
    .update({
      status: "cancelled_by_manager",
      updated_at: stampIso,
    })
    .eq("event_id", input.eventId)
    .in("status", Array.from(NOTIFIABLE_INVITE_STATUSES))
    .select("id");
  if (!inviteUpdate.error) {
    result.invites_marked = (inviteUpdate.data ?? []).length;
  } else {
    console.warn(
      "[cancel-fanout] invite status update failed:",
      inviteUpdate.error.message,
    );
  }

  const asgnUpdate = await admin
    .from("event_assignments")
    .update({
      status: "cancelled",
      cancellation_reason: input.reason ?? "Event cancelled by manager",
      cancelled_at: stampIso,
      updated_at: stampIso,
    })
    .eq("event_id", input.eventId)
    .in("status", ["confirmed", "waitlisted"])
    .select("id");
  if (!asgnUpdate.error) {
    result.assignments_marked = (asgnUpdate.data ?? []).length;
  } else {
    console.warn(
      "[cancel-fanout] assignment status update failed:",
      asgnUpdate.error.message,
    );
  }

  return result;
}

/**
 * Counts how many recipients + per-channel messages a cancellation would
 * fan out to, without actually writing to the outbox. Used by the cancel
 * confirmation UI ("Will notify N responders (X SMS + Y email)").
 */
export type CancellationPreview = {
  recipients: number;
  sms: number;
  email: number;
  manual_only: number;
  no_contact: number;
};

export async function previewCancellationFanout(
  eventId: string,
): Promise<CancellationPreview> {
  const admin = getAdmin();

  const inviteResp = await admin
    .from("event_invites")
    .select("staff_member_id, status, day_date")
    .eq("event_id", eventId)
    .in("status", Array.from(NOTIFIABLE_INVITE_STATUSES));
  if (inviteResp.error) {
    return { recipients: 0, sms: 0, email: 0, manual_only: 0, no_contact: 0 };
  }
  const invites = (inviteResp.data ?? []) as InviteRow[];

  const staffIds = Array.from(
    new Set(invites.map((i) => i.staff_member_id).filter(Boolean)),
  );

  const result: CancellationPreview = {
    recipients: 0,
    sms: 0,
    email: 0,
    manual_only: 0,
    no_contact: 0,
  };

  if (staffIds.length === 0) return result;

  const [staffResp, contactResp] = await Promise.all([
    admin
      .from("staff_members")
      .select("id, display_name, preferred_contact, active")
      .in("id", staffIds),
    admin
      .from("staff_contact_methods")
      .select(
        "staff_member_id, channel, value, normalized_value, is_primary, status, consent",
      )
      .in("staff_member_id", staffIds),
  ]);

  const staffRows = (staffResp.data ?? []) as StaffRow[];
  const contactRows = (contactResp.data ?? []) as ContactRow[];

  for (const staffId of staffIds) {
    const staff = staffRows.find((s) => s.id === staffId);
    if (!staff || !staff.active) {
      result.no_contact += 1;
      continue;
    }
    if (staff.preferred_contact === "manual_only") {
      result.manual_only += 1;
      continue;
    }

    const desired: ContactChannel[] =
      staff.preferred_contact === "both"
        ? ["sms", "email"]
        : [staff.preferred_contact as ContactChannel];

    let reachable = 0;
    for (const ch of desired) {
      const contact = pickContact(contactRows, staffId, ch);
      if (!contact) continue;
      if (SUPPRESSED_CONTACT.has(contact.status)) continue;
      if (SUPPRESSED_CONSENT.has(contact.consent)) continue;
      reachable += 1;
      if (ch === "sms") result.sms += 1;
      else result.email += 1;
    }
    if (reachable > 0) result.recipients += 1;
    else result.no_contact += 1;
  }

  return result;
}
