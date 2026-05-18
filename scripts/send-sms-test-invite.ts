/**
 * One-shot: create a TEST event, send a SMS-only invite to Mit's number via
 * the real createInvitationCampaign pipeline, print the campaign result. The
 * prod cron (per-minute) picks the outbox row up and sends the real SMS via
 * Twilio. Used while Resend DNS verification is still in progress so we can
 * smoke the SMS+RSVP loop end-to-end today.
 *
 * Run: APP_BASE_URL=https://track-scheduler.vercel.app pnpm exec tsx scripts/send-sms-test-invite.ts
 */
import { createAdminClient } from "@/lib/db/supabase-admin";
import { createInvitationCampaign } from "@/lib/messaging/create-campaign";

const STAFF_MEMBER_ID = "367d27ca-0e86-4bc0-a768-532dec30c05c"; // Mithun Jothiravi

async function main() {
  const admin = createAdminClient();

  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const startsAt = new Date(tomorrow);
  startsAt.setUTCHours(13, 0, 0, 0); // 9am ET
  const endsAt = new Date(tomorrow);
  endsAt.setUTCHours(20, 0, 0, 0); // 4pm ET

  const eventInsert = await admin
    .from("events")
    .insert({
      title: "TEST · SMS RSVP smoke",
      description: "Auto-created to verify the SMS+RSVP loop end-to-end. Safe to delete after.",
      event_type: "test",
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      timezone: "America/Toronto",
      location: "Calabogie Motorsports Park",
      status: "inviting",
      required_headcount: 1,
      source_type: "manual",
    })
    .select("id, title")
    .single();
  if (eventInsert.error) throw new Error(`event insert: ${eventInsert.error.message}`);
  const eventId = eventInsert.data!.id as string;
  console.log(`✓ Created event ${eventId} — ${eventInsert.data!.title}`);

  const result = await createInvitationCampaign({
    eventId,
    staffMemberIds: [STAFF_MEMBER_ID],
    channels: ["sms"],
  });
  console.log("✓ Campaign result:", JSON.stringify(result, null, 2));
  console.log(`\nEvent: ${process.env.APP_BASE_URL}/dashboard/events/${eventId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
