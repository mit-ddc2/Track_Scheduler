"use server";

/**
 * Invite-flow server actions (Phase 5b).
 *
 * The UI is a 3-step client wizard. The final "Send" step posts here, which
 * calls into the campaign orchestrator (lib/messaging/create-campaign.ts).
 */

import { revalidatePath } from "next/cache";

import { requireOwner } from "@/lib/auth/require-owner";
import { writeAudit } from "@/lib/db/audit";
import { createInvitationCampaign } from "@/lib/messaging/create-campaign";
import {
  sendInvitationCampaignSchema,
  type SendInvitationCampaignInput,
} from "@/lib/validation/schemas";

export type SendInvitationCampaignResult =
  | {
      ok: true;
      campaignId: string;
      invited: number;
      sms_enqueued: number;
      email_enqueued: number;
      skipped_no_contact: number;
      skipped_opt_out: number;
      skipped_manual_only: number;
      deduped: number;
    }
  | { ok: false; error: string };

/**
 * Top-level invite-flow submission. Always requires the active owner — the
 * RSVP responder route is a separate, public entry point.
 */
export async function sendInvitationCampaign(
  rawInput: SendInvitationCampaignInput,
): Promise<SendInvitationCampaignResult> {
  const session = await requireOwner();

  const parsed = sendInvitationCampaignSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.issues[0]?.message ?? "Invalid invitation campaign input",
    };
  }
  const input = parsed.data;

  try {
    const result = await createInvitationCampaign({
      eventId: input.eventId,
      staffMemberIds: input.staffMemberIds,
      channels: input.channels,
      smsTemplate: input.smsTemplate ?? null,
      emailSubject: input.emailSubject ?? null,
      emailTemplate: input.emailTemplate ?? null,
      createdBy: session.profile.id,
      days: input.days,
    });

    await writeAudit({
      action: "campaign.sent",
      entity_type: "invitation_campaign",
      entity_id: result.campaignId,
      summary: `Sent invitation campaign for event ${input.eventId} (${result.invited} invited)`,
      after: result,
      actorType: "owner",
      actorId: session.profile.id,
    });

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/events");
    revalidatePath(`/dashboard/events/${input.eventId}`);

    return { ok: true, ...result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}
