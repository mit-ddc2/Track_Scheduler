/**
 * One-shot: import Robert's 29-staff roster (Google Sheet
 * 1vvXCElJ44oicJxsDPwi6SJ_OpL9fi311MALIGVi2kXE) into the live DB.
 *
 * Behaviour:
 *  - Ensures Fire + EMS crew_roles exist (creates if missing).
 *  - Archives the 4 placeholder seed staff (Aicha/Devon/Marc/Sara) — they have
 *    fake @calabogie-safety.local emails and 555-numbers and would only
 *    confuse Robert. Robert + Mit stay (they are real).
 *  - For each sheet row: dedupes against existing staff by E.164 phone, then
 *    by email; skips if a match is found.
 *  - Inserts staff_members + staff_contact_methods + staff_roles with the
 *    correct preferred_contact ('sms' | 'email' | 'both'), is_primary, and
 *    consent='opt_in' (Robert maintains this roster deliberately).
 *
 * Run: pnpm exec tsx --env-file=.env.local scripts/import-roster-from-sheet.ts
 */
import { createAdminClient } from "@/lib/db/supabase-admin";

type RawRow = {
  first: string;
  last: string;
  phone10: string | null;
  email: string | null;
  role: "Fire" | "EMS" | "Fire/EMS" | "Medical";
  notes?: string;
};

// Hand-keyed from Google Sheet (markdown escapes stripped, "None" → null).
const ROWS: RawRow[] = [
  { first: "Alan", last: "Newby", phone10: "6132864614", email: "alannewby@gmail.com", role: "Fire" },
  { first: "Carter", last: "Forbes", phone10: "6132190933", email: "carterwforbes@gmail.com", role: "EMS" },
  { first: "Chris", last: "Gardner", phone10: "6135852337", email: "cgardner@bell.net", role: "Fire/EMS" },
  { first: "Chris", last: "Parr", phone10: "6135852958", email: "c.parr92@icloud.com", role: "Fire" },
  { first: "Dan", last: "Shannon", phone10: "6134985102", email: "dshannon@sl.on.ca", role: "EMS" },
  { first: "David", last: "Hostettler", phone10: "6139865397", email: "fire62@live.ca", role: "Fire" },
  { first: "Eric", last: "Gagnon", phone10: null, email: "mr.rix@hotmail.com", role: "Fire" },
  { first: "Graham", last: "Christie", phone10: "6133287075", email: "christie@kingston.net", role: "EMS" },
  { first: "Guy", last: "Longtin", phone10: "6132810342", email: "chieflong@gmail.com", role: "Fire" },
  { first: "Isaiah", last: "Skebo", phone10: "6132945996", email: "skeboisaiah@gmail.com", role: "Fire" },
  { first: "Jacobe", last: "Labre", phone10: "6135853615", email: "labre_racing@hotmail.com", role: "EMS" },
  { first: "Jerret", last: "Steele", phone10: "6136399758", email: null, role: "Fire" },
  { first: "Jody", last: "O'Connor", phone10: "6139850107", email: "jodyoconnor@protonmail.com", role: "Fire" },
  { first: "Julie", last: "Parr", phone10: "6135852959", email: "juliethier4@gmail.com", role: "Fire" },
  { first: "Karen", last: "Beltran", phone10: "6132928925", email: "kkarbeltran@gmail.com", role: "EMS" },
  { first: "Katie", last: "Nolan", phone10: "6135135156", email: null, role: "EMS" },
  { first: "Katie", last: "Zabarylo", phone10: "6135012154", email: "kate.zab14@gmail.com", role: "EMS" },
  { first: "Lyanne", last: "Cornwall", phone10: "6136626323", email: "lyanne1210@hotmail.com", role: "EMS" },
  { first: "Mit", last: "Jothiravi", phone10: "6138831157", email: "mit@jothiravi.com", role: "Fire" },
  {
    first: "Paul",
    last: "Simons",
    phone10: "6137976212",
    email: "paul2mar@hotmail.coms",
    role: "Fire",
    notes: "Email in source sheet has likely typo (.coms) — verify with Robert before sending.",
  },
  { first: "Reece", last: "Robillard", phone10: "6138999741", email: "rrobillard87@gmail.com", role: "Fire" },
  { first: "Robert", last: "Blackwell", phone10: "6133127414", email: null, role: "EMS" },
  { first: "Robin", last: "Villeneuve", phone10: "6132408156", email: null, role: "EMS" },
  { first: "Ron", last: "Paguette", phone10: null, email: "ron.p989@gmail.com", role: "EMS" },
  { first: "Sebastien", last: "Dubois", phone10: "3435580242", email: "sebastiend6261@gmail.com", role: "Fire" },
  { first: "Xavier", last: "Lascelle", phone10: "6134829521", email: "xavier_lascelle@hotmail.com", role: "Fire" },
  { first: "Zack", last: "", phone10: "4163206388", email: null, role: "Fire" },
  { first: "Hugo", last: "Brisson", phone10: "3432622598", email: "brisshugo@gmail.com", role: "Fire" },
  { first: "Diane", last: "Harrison", phone10: "5144449612", email: "calabogiesafety@gmail.com", role: "Medical" },
];

const SEED_PLACEHOLDER_NAMES = [
  "Aicha NDiaye",
  "Devon Park",
  "Marc Belanger",
  "Sara Kovacs",
];

function toE164(phone10: string | null): string | null {
  if (!phone10) return null;
  const digits = phone10.replace(/\D/g, "");
  if (digits.length !== 10) {
    console.warn(`  ⚠ phone "${phone10}" is not 10 digits — skipping phone`);
    return null;
  }
  return `+1${digits}`;
}

type RoleMap = Map<string, string>; // name → id

async function ensureRoles(admin: ReturnType<typeof createAdminClient>): Promise<RoleMap> {
  const map: RoleMap = new Map();
  const existing = await admin.from("crew_roles").select("id, name");
  if (existing.error) throw new Error(`load crew_roles: ${existing.error.message}`);
  for (const r of existing.data ?? []) map.set(r.name as string, r.id as string);

  for (const name of ["Fire", "EMS"]) {
    if (map.has(name)) continue;
    const inserted = await admin
      .from("crew_roles")
      .insert({ name, description: name === "Fire" ? "Fire / rescue responder" : "Emergency Medical Services responder" })
      .select("id")
      .single();
    if (inserted.error) throw new Error(`create ${name} role: ${inserted.error.message}`);
    map.set(name, inserted.data!.id as string);
    console.log(`  ✓ created crew_role "${name}"`);
  }
  return map;
}

function roleAssignments(role: RawRow["role"], roleMap: RoleMap): Array<{ id: string; is_primary: boolean }> {
  switch (role) {
    case "Fire":
      return [{ id: roleMap.get("Fire")!, is_primary: true }];
    case "EMS":
      return [{ id: roleMap.get("EMS")!, is_primary: true }];
    case "Fire/EMS":
      return [
        { id: roleMap.get("Fire")!, is_primary: true },
        { id: roleMap.get("EMS")!, is_primary: false },
      ];
    case "Medical":
      return [{ id: roleMap.get("Medical/First Aid")!, is_primary: true }];
  }
}

async function archiveSeedStaff(admin: ReturnType<typeof createAdminClient>) {
  const res = await admin
    .from("staff_members")
    .update({ active: false, archived_at: new Date().toISOString() })
    .in("display_name", SEED_PLACEHOLDER_NAMES)
    .eq("active", true)
    .select("display_name");
  if (res.error) throw new Error(`archive seed staff: ${res.error.message}`);
  for (const r of res.data ?? []) console.log(`  ▸ archived seed staff "${r.display_name}"`);
}

async function loadExistingContacts(admin: ReturnType<typeof createAdminClient>): Promise<{ phones: Set<string>; emails: Set<string> }> {
  const res = await admin
    .from("staff_contact_methods")
    .select("channel, normalized_value, staff_members(active)");
  if (res.error) throw new Error(`load contacts: ${res.error.message}`);
  const phones = new Set<string>();
  const emails = new Set<string>();
  for (const row of (res.data ?? []) as Array<{ channel: string; normalized_value: string; staff_members: { active: boolean } | null }>) {
    if (!row.staff_members?.active) continue; // archived → don't dedupe against
    if (row.channel === "sms") phones.add(row.normalized_value);
    else if (row.channel === "email") emails.add(row.normalized_value.toLowerCase());
  }
  return { phones, emails };
}

async function main() {
  const admin = createAdminClient();

  console.log("▸ Ensuring crew_roles…");
  const roleMap = await ensureRoles(admin);

  console.log("\n▸ Archiving placeholder seed staff…");
  await archiveSeedStaff(admin);

  console.log("\n▸ Loading existing active contact methods for dedupe…");
  const existing = await loadExistingContacts(admin);
  console.log(`  ${existing.phones.size} phones, ${existing.emails.size} emails currently in roster`);

  console.log("\n▸ Importing rows from sheet…");
  let inserted = 0;
  let skipped = 0;
  const skips: string[] = [];

  for (const row of ROWS) {
    const phoneE164 = toE164(row.phone10);
    const emailLower = row.email?.trim().toLowerCase() ?? null;

    // Dedupe: skip if phone or email already in roster (active).
    if (phoneE164 && existing.phones.has(phoneE164)) {
      skips.push(`${row.first} ${row.last} (phone ${phoneE164} already in roster)`);
      skipped += 1;
      continue;
    }
    if (emailLower && existing.emails.has(emailLower)) {
      skips.push(`${row.first} ${row.last} (email ${emailLower} already in roster)`);
      skipped += 1;
      continue;
    }

    const displayName = [row.first.trim(), row.last.trim()].filter(Boolean).join(" ").trim();
    if (!displayName) {
      skips.push(`<no name>`);
      skipped += 1;
      continue;
    }

    const preferred: "sms" | "email" | "both" =
      phoneE164 && emailLower ? "both" : phoneE164 ? "sms" : "email";

    // Reuse an existing same-name row with no contacts (re-run after a
    // partial failure) instead of inserting a duplicate.
    const orphan = await admin
      .from("staff_members")
      .select("id, staff_contact_methods(id)")
      .eq("display_name", displayName)
      .eq("active", true);
    let staffId: string | null = null;
    for (const r of (orphan.data ?? []) as Array<{ id: string; staff_contact_methods: unknown[] }>) {
      if (!r.staff_contact_methods || r.staff_contact_methods.length === 0) {
        staffId = r.id;
        console.log(`  ↻ reusing orphan ${displayName} (${staffId})`);
        break;
      }
    }
    if (!staffId) {
      const sm = await admin
        .from("staff_members")
        .insert({
          display_name: displayName,
          first_name: row.first.trim() || null,
          last_name: row.last.trim() || null,
          preferred_contact: preferred,
          active: true,
          notes: row.notes ?? null,
          imported_source: "google_sheet:1vvXCElJ44oicJxsDPwi6SJ_OpL9fi311MALIGVi2kXE",
        })
        .select("id")
        .single();
      if (sm.error) throw new Error(`insert ${displayName}: ${sm.error.message}`);
      staffId = sm.data!.id as string;
    }

    const contactRows: Array<Record<string, unknown>> = [];
    if (phoneE164) {
      contactRows.push({
        staff_member_id: staffId,
        channel: "sms",
        value: phoneE164,
        normalized_value: phoneE164,
        is_primary: true,
        status: "valid",
        consent: "granted",
        consent_source: "imported_from_owner_roster",
        consented_at: new Date().toISOString(),
      });
      existing.phones.add(phoneE164);
    }
    if (emailLower) {
      contactRows.push({
        staff_member_id: staffId,
        channel: "email",
        value: row.email!,
        normalized_value: emailLower,
        is_primary: true,
        status: "valid",
        consent: "granted",
        consent_source: "imported_from_owner_roster",
        consented_at: new Date().toISOString(),
      });
      existing.emails.add(emailLower);
    }
    if (contactRows.length > 0) {
      const cm = await admin.from("staff_contact_methods").insert(contactRows);
      if (cm.error) throw new Error(`contacts for ${displayName}: ${cm.error.message}`);
    }

    const roles = roleAssignments(row.role, roleMap);
    const sr = await admin
      .from("staff_roles")
      .insert(roles.map((r) => ({ staff_member_id: staffId, role_id: r.id, is_primary: r.is_primary })));
    if (sr.error) throw new Error(`roles for ${displayName}: ${sr.error.message}`);

    inserted += 1;
    console.log(`  ✓ ${displayName} (${row.role}, ${preferred})`);
  }

  console.log(`\n▸ Done. Inserted ${inserted}, skipped ${skipped}.`);
  if (skips.length) {
    console.log("  Skipped:");
    for (const s of skips) console.log(`    - ${s}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
