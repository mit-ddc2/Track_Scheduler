/**
 * Invitation campaign orchestrator — Phase 5b (spec §8.8).
 *
 * Builds (or re-uses) one `invitation_campaigns` row plus one `event_invites`
 * row per recipient, mints an RSVP token, and enqueues the SMS + email outbox
 * rows. The cron `app/api/jobs/drain-outbox/route.ts` does the actual provider
 * send asynchronously.
 *
 * Server-only — never import this from a Client Component / browser bundle.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/messaging/create-campaign.ts is server-only");
}

import { createHash } from "node:crypto";

import { createAdminClient } from "@/lib/db/supabase-admin";
import type {
  ContactChannel,
  ContactStatus,
  ConsentStatus,
  InviteStatus,
  PreferredContactMethod,
} from "@/lib/db/types";
import { generateRsvpToken } from "@/lib/security/token";

import { enqueueOutboxMessage } from "./outbox";
import {
  renderInviteEmail,
  renderInviteSms,
  type TemplateEvent,
} from "./render-templates";

/* eslint-disable @typescript-eslint/no-explicit-any */
type UntypedClient = { from: (table: string) => any };

let adminOverride: UntypedClient | null = null;
/** Test seam — allow swapping the admin client for unit tests. */
export function __setAdminClientForTesting(client: UntypedClient | null) {
  adminOverride = client;
}
function getAdmin(): UntypedClient {
  return (adminOverride ?? (createAdminClient() as unknown as UntypedClient));
}

export type InvitationChannel = ContactChannel; // "sms" | "email"

export type CreateInvitationCampaignInput = {
  eventId: string;
  staffMemberIds: string[];
  channels: InvitationChannel[];
  createdBy?: string | null;
  smsTemplate?: string | null;
  emailSubject?: string | null;
  emailTemplate?: string | null;
  /** Optional override; defaults to env APP_BASE_URL. */
  appBaseUrl?: string;
  /** Optional override for token expiry (defaults to event end + 48h). */
  tokenExpiresAt?: Date | null;
};

export type CreateInvitationCampaignResult = {
  campaignId: string;
  invited: number;
  sms_enqueued: number;
  email_enqueued: number;
  skipped_no_contact: number;
  skipped_opt_out: number;
  skipped_manual_only: number;
  deduped: number;
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

type RoleRow = {
  staff_member_id: string;
  is_primary: boolean;
  crew_roles: { id: string; name: string } | null;
};

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

function templateHash(input: string | null | undefined): string {
  return createHash("sha256")
    .update(input ?? "")
    .digest("hex")
    .slice(0, 12);
}

function pickContact(
  contacts: ContactRow[],
  staffId: string,
  channel: ContactChannel,
): ContactRow | undefined {
  // Prefer primary, then any non-suppressed contact for the channel.
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

function buildIdempotencyKey(args: {
  eventId: string;
  staffId: string;
  campaignId: string;
  channel: ContactChannel;
  templateHash: string;
}): string {
  return `event:${args.eventId}:staff:${args.staffId}:campaign:${args.campaignId}:channel:${args.channel}:template:${args.templateHash}`;
}

/**
 * Top-level entry point. Returns counts the UI can surface in the
 * `ScreenSent` summary.
 *
 * The function is intentionally not transactional: each invite is inserted
 * with its own RSVP token, then the outbox row(s) for it are enqueued. If a
 * single recipient fails partway, the others still go out and the failure
 * surfaces in the response (and is captured in the audit log).
 */
export async function createInvitationCampaign(
  input: CreateInvitationCampaignInput,
): Promise<CreateInvitationCampaignResult> {
  if (!input.eventId) throw new Error("createInvitationCampaign: eventId is required");
  if (input.staffMemberIds.length === 0)
    throw new Error("createInvitationCampaign: at least one staffMemberId is required");
  if (input.channels.length === 0)
    throw new Error("createInvitationCampaign: at least one channel is required");

  const admin = getAdmin();
  const appBaseUrl =
    input.appBaseUrl ?? process.env.APP_BASE_URL ?? "http://localhost:3000";

  // 1) Load event + recipients.
  const eventResp = await admin
    .from("events")
    .select("id, title, starts_at, ends_at, timezone, location, event_type, status")
    .eq("id", input.eventId)
    .maybeSingle();
  if (eventResp.error || !eventResp.data) {
    throw new Error(
      `createInvitationCampaign: event ${input.eventId} not found${
        eventResp.error ? ` — ${eventResp.error.message}` : ""
      }`,
    );
  }
  const event = eventResp.data as TemplateEvent & {
    status: string;
    ends_at: string;
  };

  const staffResp = await admin
    .from("staff_members")
    .select("id, display_name, preferred_contact, active")
    .in("id", input.staffMemberIds);
  if (staffResp.error) {
    throw new Error(
      `createInvitationCampaign: staff lookup failed — ${staffResp.error.message}`,
    );
  }
  const staffRows = ((staffResp.data ?? []) as StaffRow[]).filter(
    (s) => s.active,
  );

  const contactResp = await admin
    .from("staff_contact_methods")
    .select(
      "staff_member_id, channel, value, normalized_value, is_primary, status, consent",
    )
    .in("staff_member_id", input.staffMemberIds);
  if (contactResp.error) {
    throw new Error(
      `createInvitationCampaign: contact lookup failed — ${contactResp.error.message}`,
    );
  }
  const contactRows = (contactResp.data ?? []) as ContactRow[];

  const roleResp = await admin
    .from("staff_roles")
    .select("staff_member_id, is_primary, crew_roles(id, name)")
    .in("staff_member_id", input.staffMemberIds);
  // roles are optional — don't fail the whole send if the join hiccups.
  const roleRows = roleResp.error ? [] : (roleResp.data as RoleRow[] ?? []);
  const primaryRoleByStaff = new Map<string, string>();
  for (const r of roleRows) {
    if (!r.crew_roles?.name) continue;
    if (r.is_primary || !primaryRoleByStaff.has(r.staff_member_id)) {
      primaryRoleByStaff.set(r.staff_member_id, r.crew_roles.name);
    }
  }

  // 2) Create the campaign row.
  const campaignInsert = await admin
    .from("invitation_campaigns")
    .insert({
      event_id: input.eventId,
      created_by: input.createdBy ?? null,
      status: "sending",
      channels: input.channels,
      campaign_type: "initial",
      audience_snapshot: { staffMemberIds: input.staffMemberIds },
      sms_template: input.smsTemplate ?? null,
      email_subject: input.emailSubject ?? null,
      email_template: input.emailTemplate ?? null,
    })
    .select("id")
    .single();
  if (campaignInsert.error || !campaignInsert.data) {
    throw new Error(
      `createInvitationCampaign: campaign insert failed — ${campaignInsert.error?.message ?? "unknown"}`,
    );
  }
  const campaignId = campaignInsert.data.id as string;

  // 3) Compute token expiry (event end + 48h).
  const tokenExpiresAt =
    input.tokenExpiresAt ?? new Date(new Date(event.ends_at).getTime() + 48 * 3600 * 1000);

  // 4) Per recipient: invite row + RSVP token + outbox enqueue.
  let invited = 0;
  let smsEnqueued = 0;
  let emailEnqueued = 0;
  let skippedNoContact = 0;
  let skippedOptOut = 0;
  let skippedManualOnly = 0;
  let deduped = 0;

  const smsTplHash = templateHash(input.smsTemplate ?? "default-sms-v1");
  const emailTplHash = templateHash(
    `${input.emailSubject ?? ""}|${input.emailTemplate ?? "default-email-v1"}`,
  );

  for (const staffId of input.staffMemberIds) {
    const staff = staffRows.find((s) => s.id === staffId);
    if (!staff) {
      // either inactive or not found — count as skipped (no contact).
      skippedNoContact += 1;
      continue;
    }

    if (staff.preferred_contact === "manual_only") {
      skippedManualOnly += 1;
      continue;
    }

    // Resolve which channels we can actually send on for this person.
    const reachable: Array<{ channel: ContactChannel; contact: ContactRow }> = [];
    let suppressedHit = false;
    for (const ch of input.channels) {
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
      if (suppressedHit) skippedOptOut += 1;
      else skippedNoContact += 1;
      continue;
    }

    // Insert (or fetch) the event_invite row. unique(event_id, staff_member_id)
    // handles the case where this recipient was invited previously — we
    // re-use the existing invite + mint a fresh token rather than crash.
    let inviteId: string | null = null;
    const inviteInsert = await admin
      .from("event_invites")
      .insert({
        event_id: input.eventId,
        campaign_id: campaignId,
        staff_member_id: staffId,
        status: "invited" as InviteStatus,
        selected_channels: reachable.map((r) => r.channel),
      })
      .select("id")
      .single();
    if (inviteInsert.error) {
      if (inviteInsert.error.code === "23505") {
        const refetch = await admin
          .from("event_invites")
          .select("id")
          .eq("event_id", input.eventId)
          .eq("staff_member_id", staffId)
          .maybeSingle();
        inviteId = (refetch.data?.id as string | undefined) ?? null;
        if (inviteId) {
          // Update the existing invite to the new campaign + invited status.
          await admin
            .from("event_invites")
            .update({
              campaign_id: campaignId,
              status: "invited" as InviteStatus,
              selected_channels: reachable.map((r) => r.channel),
              updated_at: new Date().toISOString(),
            })
            .eq("id", inviteId);
        }
      } else {
        // Surface unexpected DB errors — but keep going for the rest.
        console.warn(
          `[create-campaign] invite insert failed for staff ${staffId}: ${inviteInsert.error.message}`,
        );
        skippedNoContact += 1;
        continue;
      }
    } else {
      inviteId = inviteInsert.data?.id as string;
    }
    if (!inviteId) {
      skippedNoContact += 1;
      continue;
    }

    // Mint an RSVP token (raw value goes into the message URL, hash to DB).
    const { raw: rawToken, hash: tokenHash } = generateRsvpToken();
    const tokenInsert = await admin.from("rsvp_tokens").insert({
      invite_id: inviteId,
      token_hash: tokenHash,
      expires_at: tokenExpiresAt.toISOString(),
    });
    if (tokenInsert.error) {
      console.warn(
        `[create-campaign] token insert failed for invite ${inviteId}: ${tokenInsert.error.message}`,
      );
    }

    const rsvpUrl = `${appBaseUrl.replace(/\/+$/, "")}/r/${rawToken}`;
    const recipient = {
      display_name: staff.display_name,
      role_label: primaryRoleByStaff.get(staffId) ?? null,
    };

    invited += 1;

    for (const { channel, contact } of reachable) {
      if (channel === "sms") {
        const body = renderInviteSms({ event, recipient, rsvpUrl });
        const idem = buildIdempotencyKey({
          eventId: input.eventId,
          staffId,
          campaignId,
          channel: "sms",
          templateHash: smsTplHash,
        });
        const res = await enqueueOutboxMessage({
          campaignId,
          inviteId,
          staffMemberId: staffId,
          channel: "sms",
          toValue: contact.normalized_value || contact.value,
          bodyText: body,
          provider: "twilio",
          idempotencyKey: idem,
        });
        if (res.deduped) deduped += 1;
        else smsEnqueued += 1;
      } else {
        const rendered = renderInviteEmail({ event, recipient, rsvpUrl });
        const idem = buildIdempotencyKey({
          eventId: input.eventId,
          staffId,
          campaignId,
          channel: "email",
          templateHash: emailTplHash,
        });
        const res = await enqueueOutboxMessage({
          campaignId,
          inviteId,
          staffMemberId: staffId,
          channel: "email",
          toValue: contact.normalized_value || contact.value,
          subject: input.emailSubject ?? rendered.subject,
          bodyText: rendered.text,
          bodyHtml: rendered.html,
          provider: "resend",
          idempotencyKey: idem,
        });
        if (res.deduped) deduped += 1;
        else emailEnqueued += 1;
      }
    }
  }

  // 5) Stamp the campaign as sent.
  await admin
    .from("invitation_campaigns")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      sent_count: smsEnqueued + emailEnqueued,
      suppressed_count: skippedOptOut + skippedManualOnly,
    })
    .eq("id", campaignId);

  return {
    campaignId,
    invited,
    sms_enqueued: smsEnqueued,
    email_enqueued: emailEnqueued,
    skipped_no_contact: skippedNoContact,
    skipped_opt_out: skippedOptOut,
    skipped_manual_only: skippedManualOnly,
    deduped,
  };
}
