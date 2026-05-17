/**
 * Server-side composer for replacement candidates.
 *
 * Pulls roster + event requirements + assignments + invites + attendance
 * from Supabase, then defers to the pure `rankCandidates` ranker in
 * `./replacement-candidates.ts`. Kept separate so the pure ranker can be
 * imported into the unit-test runner without dragging in `server-only`.
 */

import "server-only";

import { createClient } from "@/lib/db/supabase-server";
import type {
  ConsentStatus,
  ContactChannel,
  ContactStatus,
  PreferredContactMethod,
} from "@/lib/db/types";

import {
  rankCandidates,
  type AttendanceFact,
  type CandidateRequirement,
  type CandidateStaff,
  type ExistingAssignment,
  type ExistingInvite,
  type RankOptions,
  type RankedCandidate,
} from "./replacement-candidates";

export type GetCandidatesInput = {
  eventId: string;
  options?: RankOptions;
};

export async function getReplacementCandidates({
  eventId,
  options,
}: GetCandidatesInput): Promise<RankedCandidate[]> {
  const supabase = await createClient();

  // 1. Event requirements.
  const { data: reqRows } = await supabase
    .from("event_requirements")
    .select("id, label, required_count, role_id, qualification_id")
    .eq("event_id", eventId);

  const requirements: CandidateRequirement[] = (reqRows ?? []).map((r) => ({
    label: r.label,
    role_id: r.role_id,
    qualification_id: r.qualification_id,
    required_count: r.required_count,
  }));

  // 2. Roster — active staff with contact methods, roles, qualifications.
  const { data: staffRows } = await supabase
    .from("staff_members")
    .select(
      `
      id, display_name, active, preferred_contact,
      contact_methods:staff_contact_methods(channel, status, consent, last_delivery_at),
      staff_roles(role_id),
      staff_qualifications(qualification_id)
      `,
    )
    .eq("active", true);

  type RawStaff = {
    id: string;
    display_name: string;
    active: boolean;
    preferred_contact: PreferredContactMethod;
    contact_methods: Array<{
      channel: ContactChannel;
      status: ContactStatus;
      consent: ConsentStatus;
      last_delivery_at: string | null;
    }>;
    staff_roles: Array<{ role_id: string }>;
    staff_qualifications: Array<{ qualification_id: string }>;
  };

  const staff: CandidateStaff[] = ((staffRows ?? []) as unknown as RawStaff[]).map(
    (r) => ({
      id: r.id,
      display_name: r.display_name,
      active: r.active,
      preferred_contact: r.preferred_contact,
      role_ids: r.staff_roles.map((x) => x.role_id),
      qualification_ids: r.staff_qualifications.map((x) => x.qualification_id),
      contact_methods: r.contact_methods.map((c) => ({
        channel: c.channel,
        status: c.status,
        consent: c.consent,
        last_delivery_at: c.last_delivery_at,
      })),
    }),
  );

  // 3. Existing assignments + invites for this event.
  const { data: assignmentRows } = await supabase
    .from("event_assignments" as never)
    .select("staff_member_id, status")
    .eq("event_id", eventId);

  const { data: inviteRows } = await supabase
    .from("event_invites" as never)
    .select("staff_member_id, status")
    .eq("event_id", eventId);

  const assignments: ExistingAssignment[] = (
    (assignmentRows ?? []) as unknown as Array<{
      staff_member_id: string;
      status: ExistingAssignment["status"];
    }>
  ).map((a) => ({
    staff_member_id: a.staff_member_id,
    status: a.status,
  }));

  const invites: ExistingInvite[] = (
    (inviteRows ?? []) as unknown as Array<{
      staff_member_id: string;
      status: ExistingInvite["status"];
    }>
  ).map((i) => ({
    staff_member_id: i.staff_member_id,
    status: i.status,
  }));

  // 4. Last completed attendance per staff member — fairness signal.
  const staffIds = staff.map((s) => s.id);
  const recentAttendance: AttendanceFact[] = [];
  if (staffIds.length > 0) {
    const { data: attRows } = await supabase
      .from("attendance_records" as never)
      .select("staff_member_id, actual_end, scheduled_end, status")
      .in("staff_member_id", staffIds)
      .eq("status", "worked")
      .order("actual_end", { ascending: false })
      .limit(staffIds.length * 4);

    const seen = new Set<string>();
    for (const row of (attRows ?? []) as unknown as Array<{
      staff_member_id: string;
      actual_end: string | null;
      scheduled_end: string | null;
      status: string;
    }>) {
      if (seen.has(row.staff_member_id)) continue;
      const when = row.actual_end ?? row.scheduled_end;
      if (!when) continue;
      seen.add(row.staff_member_id);
      recentAttendance.push({
        staff_member_id: row.staff_member_id,
        last_worked_at: when,
      });
    }
  }

  return rankCandidates({
    staff,
    requirements,
    assignments,
    invites,
    recentAttendance,
    options,
  });
}
