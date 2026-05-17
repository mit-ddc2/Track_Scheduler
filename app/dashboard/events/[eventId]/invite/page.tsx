import { notFound } from "next/navigation";

import { InviteWizard } from "@/components/invite/InviteWizard";
import { requireOwner } from "@/lib/auth/require-owner";
import { createClient } from "@/lib/db/supabase-server";
import { getEvent } from "@/lib/events/queries";
import { listStaff, summarize } from "@/lib/roster/queries";

import { sendInvitationCampaign } from "./actions";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ eventId: string }>;
};

type ExistingInviteRow = {
  staff_member_id: string;
  status: string;
};

export default async function InvitePage({ params }: PageProps) {
  await requireOwner();
  const { eventId } = await params;
  const event = await getEvent(eventId);
  if (!event) notFound();

  // Pull roster + existing invites so the UI can flag "already invited"
  // and "already declined" candidates.
  const supabase = await createClient();
  const [{ data: existingInvites }, staffRows] = await Promise.all([
    supabase
      .from("event_invites")
      .select("staff_member_id, status")
      .eq("event_id", eventId),
    listStaff(),
  ]);

  const inviteByStaff = new Map<string, string>();
  for (const row of (existingInvites ?? []) as ExistingInviteRow[]) {
    inviteByStaff.set(row.staff_member_id, row.status);
  }

  const candidates = staffRows
    .filter((s) => !s.archived_at)
    .map((row) => {
      const s = summarize(row);
      const smsContact = row.contact_methods.find((c) => c.channel === "sms");
      const emailContact = row.contact_methods.find(
        (c) => c.channel === "email",
      );
      const existing = inviteByStaff.get(s.id) ?? null;
      return {
        id: s.id,
        display_name: s.display_name,
        active: s.active,
        preferred_contact: s.preferred_contact,
        primary_role: s.primary_role,
        qualifications: s.qualifications,
        sms_present: s.sms_present,
        email_present: s.email_present,
        sms_status: s.sms_status,
        email_status: s.email_status,
        sms_consent: smsContact?.consent ?? null,
        email_consent: emailContact?.consent ?? null,
        already_invited: existing === "invited" || existing === "accepted",
        already_declined:
          existing === "declined" ||
          existing === "cancelled_by_member" ||
          existing === "cancelled_by_manager",
      };
    });

  return (
    <InviteWizard
      eventId={eventId}
      event={{
        id: event.id,
        title: event.title,
        starts_at: event.starts_at,
        ends_at: event.ends_at,
        timezone: event.timezone,
        location: event.location,
        event_type: event.event_type,
      }}
      candidates={candidates}
      sendAction={sendInvitationCampaign}
    />
  );
}
