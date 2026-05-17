/**
 * Demo data seeder — re-creates the exact pre-RSVP-walkthrough state used in
 * the live demo (6 staff, 3 events, structured requirements, invites,
 * assignments). Called by the `/api/admin/reset-demo` route.
 *
 * The reset and seed run server-side via the admin (service-role) client so
 * RLS does not block writes. The route guards both `requireOwner()` and a
 * constant-time CRON_SECRET match, and is hard-disabled in prod unless
 * DEV_RESET_DEMO_ENABLED=true.
 *
 * Seed values are duplicated here verbatim from the SQL that was used to
 * pre-populate the live DB on 2026-05-17. Treat this file as the source of
 * truth — keep DEMO_SCRIPT.md in sync when adding new fixtures.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/types";

export type DemoSeedCounts = {
  staff: number;
  events: number;
  contact_methods: number;
  staff_roles: number;
  staff_qualifications: number;
  event_requirements: number;
  event_invites: number;
  event_assignments: number;
};

/**
 * Wipe + re-seed in one call. Uses the `admin_reset_demo_tables()` plpgsql
 * function for atomic truncation (FK-cascade safe) and then inserts the
 * fixture rows.
 */
export async function resetAndSeedDemoData(
  // Loose typing — admin operations touch event_invites / invitation_campaigns
  // / etc. which aren't in the hand-rolled Database type yet.
  admin: SupabaseClient<Database>,
): Promise<DemoSeedCounts> {
  // 1. Truncate everything seedable in one atomic call.
  const { error: truncErr } = await admin.rpc(
    // RPC name isn't in the typed Functions list yet; cast keeps it loose.
    "admin_reset_demo_tables" as never,
  );
  if (truncErr) {
    throw new Error(`admin_reset_demo_tables failed: ${truncErr.message}`);
  }

  // 2. Look up the canonical role + qualification IDs (these survive truncate
  //    because the function intentionally excludes them — they are app config,
  //    not demo data).
  const { data: roles, error: rolesErr } = await admin
    .from("crew_roles")
    .select("id, name");
  if (rolesErr) throw new Error(`load roles: ${rolesErr.message}`);
  const { data: quals, error: qualsErr } = await admin
    .from("qualifications")
    .select("id, name");
  if (qualsErr) throw new Error(`load quals: ${qualsErr.message}`);

  const role = (name: string): string => {
    const r = roles?.find((row) => row.name === name);
    if (!r) throw new Error(`Expected crew_role "${name}" — re-run 0003_seed.sql`);
    return r.id;
  };
  const qual = (name: string): string => {
    const q = quals?.find((row) => row.name === name);
    if (!q) throw new Error(`Expected qualification "${name}" — re-run 0003_seed.sql`);
    return q.id;
  };

  // 3. Staff members.
  const staffInsert = [
    { display_name: "Robert Lavoie", first_name: "Robert", last_name: "Lavoie", preferred_contact: "both" as const },
    { display_name: "Mithun Jothiravi", first_name: "Mithun", last_name: "Jothiravi", preferred_contact: "both" as const },
    { display_name: "Marc Belanger", first_name: "Marc", last_name: "Belanger", preferred_contact: "sms" as const },
    { display_name: "Sara Kovacs", first_name: "Sara", last_name: "Kovacs", preferred_contact: "both" as const },
    { display_name: "Devon Park", first_name: "Devon", last_name: "Park", preferred_contact: "email" as const },
    { display_name: "Aicha NDiaye", first_name: "Aicha", last_name: "NDiaye", preferred_contact: "both" as const },
  ];
  const { data: staff, error: staffErr } = await admin
    .from("staff_members")
    .insert(staffInsert)
    .select("id, display_name");
  if (staffErr || !staff) throw new Error(`insert staff: ${staffErr?.message}`);

  const staffByName = new Map(staff.map((s) => [s.display_name, s.id]));
  const staffId = (name: string): string => {
    const id = staffByName.get(name);
    if (!id) throw new Error(`Staff "${name}" not in seed`);
    return id;
  };

  // 4. Contact methods. All consent=granted (these are demo numbers/emails).
  const contactInserts = [
    // Robert — SMS + email
    { staff_member_id: staffId("Robert Lavoie"), channel: "sms" as const, value: "+15149479612", normalized_value: "+15149479612" },
    { staff_member_id: staffId("Robert Lavoie"), channel: "email" as const, value: "robert@calabogie-safety.local", normalized_value: "robert@calabogie-safety.local" },
    // Mithun — SMS + email (real owner email)
    { staff_member_id: staffId("Mithun Jothiravi"), channel: "sms" as const, value: "+16138831157", normalized_value: "+16138831157" },
    { staff_member_id: staffId("Mithun Jothiravi"), channel: "email" as const, value: "mit@ddc2.com", normalized_value: "mit@ddc2.com" },
    // Marc — SMS only
    { staff_member_id: staffId("Marc Belanger"), channel: "sms" as const, value: "+16135550103", normalized_value: "+16135550103" },
    // Sara — SMS + email
    { staff_member_id: staffId("Sara Kovacs"), channel: "sms" as const, value: "+16135550104", normalized_value: "+16135550104" },
    { staff_member_id: staffId("Sara Kovacs"), channel: "email" as const, value: "sara@calabogie-safety.local", normalized_value: "sara@calabogie-safety.local" },
    // Devon — email only
    { staff_member_id: staffId("Devon Park"), channel: "email" as const, value: "devon@calabogie-safety.local", normalized_value: "devon@calabogie-safety.local" },
    // Aicha — SMS + email
    { staff_member_id: staffId("Aicha NDiaye"), channel: "sms" as const, value: "+16135550106", normalized_value: "+16135550106" },
    { staff_member_id: staffId("Aicha NDiaye"), channel: "email" as const, value: "aicha@calabogie-safety.local", normalized_value: "aicha@calabogie-safety.local" },
  ].map((c) => ({ ...c, is_primary: true, consent: "granted" as const, consent_source: "demo_seed" }));

  const { error: cmErr } = await admin
    .from("staff_contact_methods")
    .insert(contactInserts);
  if (cmErr) throw new Error(`insert contact methods: ${cmErr.message}`);

  // 5. Staff roles (one primary each).
  const roleInserts = [
    { staff_member_id: staffId("Robert Lavoie"), role_id: role("Incident Lead"), is_primary: true },
    { staff_member_id: staffId("Mithun Jothiravi"), role_id: role("Rescue Crew"), is_primary: true },
    { staff_member_id: staffId("Marc Belanger"), role_id: role("Truck Driver"), is_primary: true },
    { staff_member_id: staffId("Sara Kovacs"), role_id: role("Medical/First Aid"), is_primary: true },
    { staff_member_id: staffId("Devon Park"), role_id: role("Rescue Crew"), is_primary: true },
    { staff_member_id: staffId("Aicha NDiaye"), role_id: role("Medical/First Aid"), is_primary: true },
  ];
  const { error: srErr } = await admin.from("staff_roles").insert(roleInserts);
  if (srErr) throw new Error(`insert staff_roles: ${srErr.message}`);

  // 6. Staff qualifications.
  const qualInserts = [
    // Robert — Fire Suppression + First Aid
    { staff_member_id: staffId("Robert Lavoie"), qualification_id: qual("Fire Suppression") },
    { staff_member_id: staffId("Robert Lavoie"), qualification_id: qual("First Aid") },
    // Mithun — Extrication + Medical + First Aid
    { staff_member_id: staffId("Mithun Jothiravi"), qualification_id: qual("Extrication") },
    { staff_member_id: staffId("Mithun Jothiravi"), qualification_id: qual("Medical") },
    { staff_member_id: staffId("Mithun Jothiravi"), qualification_id: qual("First Aid") },
    // Marc — Driver + Fire Suppression
    { staff_member_id: staffId("Marc Belanger"), qualification_id: qual("Driver") },
    { staff_member_id: staffId("Marc Belanger"), qualification_id: qual("Fire Suppression") },
    // Sara — Medical + First Aid + Extrication
    { staff_member_id: staffId("Sara Kovacs"), qualification_id: qual("Medical") },
    { staff_member_id: staffId("Sara Kovacs"), qualification_id: qual("First Aid") },
    { staff_member_id: staffId("Sara Kovacs"), qualification_id: qual("Extrication") },
    // Devon — Extrication
    { staff_member_id: staffId("Devon Park"), qualification_id: qual("Extrication") },
    // Aicha — Medical + First Aid
    { staff_member_id: staffId("Aicha NDiaye"), qualification_id: qual("Medical") },
    { staff_member_id: staffId("Aicha NDiaye"), qualification_id: qual("First Aid") },
  ];
  const { error: sqErr } = await admin
    .from("staff_qualifications")
    .insert(qualInserts);
  if (sqErr) throw new Error(`insert staff_qualifications: ${sqErr.message}`);

  // 7. Events. Times use UTC ISO; America/Toronto offsets at the relevant
  //    dates yield 7am-3pm-ish local for the existing fixtures.
  const eventInserts = [
    {
      title: "Multimatic Track Event",
      description: "Private OEM test day. Full course closed to public.",
      event_type: "Private test",
      starts_at: "2026-05-20T12:00:00Z",
      ends_at: "2026-05-20T20:00:00Z",
      timezone: "America/Toronto",
      location: "Full Course · Main Paddock",
      status: "staffed" as const,
      required_headcount: 6,
    },
    {
      title: "AISA Driving School",
      description: "Two-day intermediate driving school with classroom + on-track sessions.",
      event_type: "Driving school",
      starts_at: "2026-05-23T11:30:00Z",
      ends_at: "2026-05-24T21:00:00Z",
      timezone: "America/Toronto",
      location: "Long Course · Paddock 4",
      status: "underfilled" as const,
      required_headcount: 8,
    },
    {
      title: "Enduro Race Weekend",
      description: "Sat: practice/qual. Sun: 4hr enduro + sprint races.",
      event_type: "Race",
      starts_at: "2026-06-13T11:00:00Z",
      ends_at: "2026-06-14T22:00:00Z",
      timezone: "America/Toronto",
      location: "Long Course",
      status: "inviting" as const,
      required_headcount: 12,
    },
  ];
  const { data: events, error: eventsErr } = await admin
    .from("events")
    .insert(eventInserts)
    .select("id, title");
  if (eventsErr || !events) throw new Error(`insert events: ${eventsErr?.message}`);
  const eventByTitle = new Map(events.map((e) => [e.title, e.id]));
  const eventId = (title: string): string => {
    const id = eventByTitle.get(title);
    if (!id) throw new Error(`Event "${title}" not in seed`);
    return id;
  };

  // 8. Structured requirements (AISA + Enduro only — Multimatic is treated as
  //    a flat headcount of 6).
  const reqInserts = [
    // AISA: 1 Incident Lead, 4 Rescue Crew, 2 Truck Driver, 1 Medical
    { event_id: eventId("AISA Driving School"), label: "Incident Lead", required_count: 1, role_id: null, qualification_id: null, notes: null },
    { event_id: eventId("AISA Driving School"), label: "Rescue Crew", required_count: 4, role_id: null, qualification_id: null, notes: null },
    { event_id: eventId("AISA Driving School"), label: "Truck Driver", required_count: 2, role_id: null, qualification_id: null, notes: null },
    { event_id: eventId("AISA Driving School"), label: "Medical/First Aid", required_count: 1, role_id: null, qualification_id: null, notes: null },
    // Enduro: 1 Incident Lead, 6 Rescue Crew, 3 Truck Driver, 2 Medical
    { event_id: eventId("Enduro Race Weekend"), label: "Incident Lead", required_count: 1, role_id: null, qualification_id: null, notes: null },
    { event_id: eventId("Enduro Race Weekend"), label: "Rescue Crew", required_count: 6, role_id: null, qualification_id: null, notes: null },
    { event_id: eventId("Enduro Race Weekend"), label: "Truck Driver", required_count: 3, role_id: null, qualification_id: null, notes: null },
    { event_id: eventId("Enduro Race Weekend"), label: "Medical/First Aid", required_count: 2, role_id: null, qualification_id: null, notes: null },
  ];
  const { data: reqs, error: reqErr } = await admin
    .from("event_requirements")
    .insert(reqInserts)
    .select("id");
  if (reqErr || !reqs) throw new Error(`insert event_requirements: ${reqErr?.message}`);

  // 9. Invites. AISA: 5 accepted (Robert, Mithun, Marc, Devon, Aicha) + 1
  //    pending (Sara). Enduro: 2 accepted (Robert, Mithun) + 3 pending
  //    (Marc, Sara, Aicha). Multimatic has no invites (treated as offline
  //    pre-staffed).
  const inviteInserts = [
    // AISA accepted
    { event_id: eventId("AISA Driving School"), staff_member_id: staffId("Robert Lavoie"), status: "accepted", selected_channels: ["sms", "email"], responded_at: new Date().toISOString() },
    { event_id: eventId("AISA Driving School"), staff_member_id: staffId("Mithun Jothiravi"), status: "accepted", selected_channels: ["sms", "email"], responded_at: new Date().toISOString() },
    { event_id: eventId("AISA Driving School"), staff_member_id: staffId("Marc Belanger"), status: "accepted", selected_channels: ["sms"], responded_at: new Date().toISOString() },
    { event_id: eventId("AISA Driving School"), staff_member_id: staffId("Devon Park"), status: "accepted", selected_channels: ["email"], responded_at: new Date().toISOString() },
    { event_id: eventId("AISA Driving School"), staff_member_id: staffId("Aicha NDiaye"), status: "accepted", selected_channels: ["sms", "email"], responded_at: new Date().toISOString() },
    // AISA pending
    { event_id: eventId("AISA Driving School"), staff_member_id: staffId("Sara Kovacs"), status: "invited", selected_channels: ["sms", "email"] },
    // Enduro accepted
    { event_id: eventId("Enduro Race Weekend"), staff_member_id: staffId("Robert Lavoie"), status: "accepted", selected_channels: ["sms", "email"], responded_at: new Date().toISOString() },
    { event_id: eventId("Enduro Race Weekend"), staff_member_id: staffId("Mithun Jothiravi"), status: "accepted", selected_channels: ["sms", "email"], responded_at: new Date().toISOString() },
    // Enduro pending
    { event_id: eventId("Enduro Race Weekend"), staff_member_id: staffId("Marc Belanger"), status: "invited", selected_channels: ["sms"] },
    { event_id: eventId("Enduro Race Weekend"), staff_member_id: staffId("Sara Kovacs"), status: "invited", selected_channels: ["sms", "email"] },
    { event_id: eventId("Enduro Race Weekend"), staff_member_id: staffId("Aicha NDiaye"), status: "invited", selected_channels: ["sms", "email"] },
  ];
  const { data: invites, error: invErr } = await admin
    // event_invites isn't in the hand-rolled types yet — cast keeps inserts loose.
    .from("event_invites" as never)
    .insert(inviteInserts as never)
    .select("id, event_id, staff_member_id, status");
  if (invErr || !invites) throw new Error(`insert event_invites: ${invErr?.message}`);

  // 10. Assignments — one per accepted invite (counts toward headcount).
  type InviteRow = { id: string; event_id: string; staff_member_id: string; status: string };
  const acceptedInvites = (invites as unknown as InviteRow[]).filter(
    (i) => i.status === "accepted",
  );
  const assignmentInserts = acceptedInvites.map((i) => ({
    event_id: i.event_id,
    staff_member_id: i.staff_member_id,
    invite_id: i.id,
    status: "confirmed" as const,
    counts_toward_headcount: true,
    confirmed_at: new Date().toISOString(),
  }));
  const { error: asnErr } = await admin
    .from("event_assignments")
    .insert(assignmentInserts);
  if (asnErr) throw new Error(`insert event_assignments: ${asnErr.message}`);

  return {
    staff: staffInsert.length,
    events: eventInserts.length,
    contact_methods: contactInserts.length,
    staff_roles: roleInserts.length,
    staff_qualifications: qualInserts.length,
    event_requirements: reqInserts.length,
    event_invites: inviteInserts.length,
    event_assignments: assignmentInserts.length,
  };
}
