"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/db/supabase-server";
import type {
  ConsentStatus,
  ContactChannel,
  ContactStatus,
  Database,
  PreferredContactMethod,
} from "@/lib/db/types";

type ContactMethodInsert =
  Database["public"]["Tables"]["staff_contact_methods"]["Insert"];
import { writeAudit } from "@/lib/db/audit";
import { requireOwner } from "@/lib/auth/require-owner";
import {
  contactDedupeKey,
  isValidEmail,
  normalizeEmail,
  normalizePhone,
} from "@/lib/roster/normalize-contact";
import {
  qualificationCreateSchema,
  qualificationUpdateSchema,
  roleCreateSchema,
  roleUpdateSchema,
  staffMemberCreateSchema,
  staffMemberUpdateSchema,
  type StaffMemberCreateInput,
  type StaffMemberUpdateInput,
} from "@/lib/validation/schemas";

export type ActionError = {
  ok: false;
  message: string;
  fieldErrors?: Record<string, string[]>;
};
export type ActionSuccess<T> = { ok: true; data: T };
export type ActionResult<T> = ActionSuccess<T> | ActionError;

function zodError(err: z.ZodError): ActionError {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_form";
    (fieldErrors[key] ||= []).push(issue.message);
  }
  return {
    ok: false,
    message: "Please correct the highlighted fields.",
    fieldErrors,
  };
}

function explain(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/* ─────────────────── Staff members ─────────────────── */

export async function createStaffMember(
  input: StaffMemberCreateInput,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireOwner();

  const parsed = staffMemberCreateSchema.safeParse(input);
  if (!parsed.success) return zodError(parsed.error);
  const data = parsed.data;

  const phone = data.phone ? normalizePhone(data.phone) : null;
  const email = data.email ? normalizeEmail(data.email) : "";
  if (email && !isValidEmail(email)) {
    return {
      ok: false,
      message: "Email format looks invalid.",
      fieldErrors: { email: ["Invalid email"] },
    };
  }
  if (phone && data.phone && !phone.valid) {
    return {
      ok: false,
      message: "Phone format looks invalid.",
      fieldErrors: { phone: ["Invalid phone number"] },
    };
  }

  const supabase = await createClient();

  // 1. Insert staff_members row.
  const { data: created, error: insertErr } = await supabase
    .from("staff_members")
    .insert({
      display_name: data.display_name,
      first_name: data.first_name || null,
      last_name: data.last_name || null,
      preferred_contact: derivePreferredContact(
        data.preferred_contact,
        Boolean(phone?.valid),
        Boolean(email),
      ),
      active: data.active,
      notes: data.notes || null,
      created_by: session.user.id,
      updated_by: session.user.id,
    })
    .select("id")
    .single();
  if (insertErr || !created) {
    return { ok: false, message: `Could not create staff: ${explain(insertErr)}` };
  }
  const staffId = created.id as string;

  // 2. Contact methods.
  const contactInserts: Array<{
    staff_member_id: string;
    channel: ContactChannel;
    value: string;
    normalized_value: string;
    is_primary: boolean;
    status: ContactStatus;
    consent: ConsentStatus;
    consent_source: string | null;
    consented_at: string | null;
  }> = [];
  if (phone?.e164 && phone.valid) {
    contactInserts.push({
      staff_member_id: staffId,
      channel: "sms",
      value: phone.formatted || phone.e164,
      normalized_value: phone.e164,
      is_primary: true,
      status: "unknown",
      consent: data.consent_sms ? "granted" : "unknown",
      consent_source: data.consent_sms ? data.consent_sms_source ?? "manual" : null,
      consented_at: data.consent_sms ? new Date().toISOString() : null,
    });
  }
  if (email) {
    contactInserts.push({
      staff_member_id: staffId,
      channel: "email",
      value: email,
      normalized_value: email,
      is_primary: true,
      status: "unknown",
      consent: data.consent_email ? "granted" : "unknown",
      consent_source: data.consent_email
        ? data.consent_email_source ?? "manual"
        : null,
      consented_at: data.consent_email ? new Date().toISOString() : null,
    });
  }
  if (contactInserts.length) {
    const { error: cmErr } = await supabase
      .from("staff_contact_methods")
      .insert(contactInserts);
    if (cmErr) {
      return {
        ok: false,
        message: `Staff created but contacts failed: ${explain(cmErr)}`,
      };
    }
  }

  // 3. Roles.
  if (data.role_ids.length) {
    const roleRows = data.role_ids.map((role_id) => ({
      staff_member_id: staffId,
      role_id,
      is_primary: data.primary_role_id === role_id,
    }));
    const { error: rErr } = await supabase
      .from("staff_roles")
      .insert(roleRows);
    if (rErr) {
      return {
        ok: false,
        message: `Staff created but roles failed: ${explain(rErr)}`,
      };
    }
  }

  // 4. Qualifications.
  if (data.qualification_ids.length) {
    const qualRows = data.qualification_ids.map((qualification_id) => ({
      staff_member_id: staffId,
      qualification_id,
    }));
    const { error: qErr } = await supabase
      .from("staff_qualifications")
      .insert(qualRows);
    if (qErr) {
      return {
        ok: false,
        message: `Staff created but qualifications failed: ${explain(qErr)}`,
      };
    }
  }

  // 5. Consent records (audit trail beyond per-method state).
  const consentRows: Array<{
    staff_member_id: string;
    channel: ContactChannel;
    status: ConsentStatus;
    source: string;
    captured_by: string;
  }> = [];
  if (data.consent_sms && phone?.valid) {
    consentRows.push({
      staff_member_id: staffId,
      channel: "sms",
      status: "granted",
      source: data.consent_sms_source ?? "manual",
      captured_by: session.user.id,
    });
  }
  if (data.consent_email && email) {
    consentRows.push({
      staff_member_id: staffId,
      channel: "email",
      status: "granted",
      source: data.consent_email_source ?? "manual",
      captured_by: session.user.id,
    });
  }
  if (consentRows.length) {
    await supabase.from("consent_records").insert(consentRows);
  }

  await writeAudit({
    action: "staff.create",
    entity_type: "staff_member",
    entity_id: staffId,
    summary: `Created staff member ${data.display_name}`,
    after: { display_name: data.display_name },
    actorId: session.user.id,
  });

  revalidatePath("/dashboard/roster");
  return { ok: true, data: { id: staffId } };
}

export async function updateStaffMember(
  staffId: string,
  input: StaffMemberUpdateInput,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireOwner();

  const parsed = staffMemberUpdateSchema.safeParse(input);
  if (!parsed.success) return zodError(parsed.error);
  const data = parsed.data;

  const phone = data.phone ? normalizePhone(data.phone) : null;
  const email = data.email ? normalizeEmail(data.email) : "";
  if (email && !isValidEmail(email)) {
    return {
      ok: false,
      message: "Email format looks invalid.",
      fieldErrors: { email: ["Invalid email"] },
    };
  }
  if (phone && data.phone && !phone.valid) {
    return {
      ok: false,
      message: "Phone format looks invalid.",
      fieldErrors: { phone: ["Invalid phone number"] },
    };
  }

  const supabase = await createClient();

  const preferredContact = derivePreferredContact(
    data.preferred_contact,
    Boolean(phone?.valid),
    Boolean(email),
  );

  const { error: updErr } = await supabase
    .from("staff_members")
    .update({
      display_name: data.display_name,
      first_name: data.first_name || null,
      last_name: data.last_name || null,
      preferred_contact: preferredContact,
      active: data.active,
      notes: data.notes || null,
      updated_by: session.user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", staffId);
  if (updErr) {
    return { ok: false, message: `Could not update staff: ${explain(updErr)}` };
  }

  // Replace contact methods (simple strategy for MVP — delete + reinsert).
  await supabase
    .from("staff_contact_methods")
    .delete()
    .eq("staff_member_id", staffId);

  const contactInserts: ContactMethodInsert[] = [];
  if (phone?.e164 && phone.valid) {
    contactInserts.push({
      staff_member_id: staffId,
      channel: "sms",
      value: phone.formatted || phone.e164,
      normalized_value: phone.e164,
      is_primary: true,
      status: "unknown",
      consent: data.consent_sms ? "granted" : "unknown",
      consent_source: data.consent_sms ? data.consent_sms_source ?? "manual" : null,
      consented_at: data.consent_sms ? new Date().toISOString() : null,
    });
  }
  if (email) {
    contactInserts.push({
      staff_member_id: staffId,
      channel: "email",
      value: email,
      normalized_value: email,
      is_primary: true,
      status: "unknown",
      consent: data.consent_email ? "granted" : "unknown",
      consent_source: data.consent_email
        ? data.consent_email_source ?? "manual"
        : null,
      consented_at: data.consent_email ? new Date().toISOString() : null,
    });
  }
  if (contactInserts.length) {
    const { error: cmErr } = await supabase
      .from("staff_contact_methods")
      .insert(contactInserts);
    if (cmErr) {
      return {
        ok: false,
        message: `Staff updated but contacts failed: ${explain(cmErr)}`,
      };
    }
  }

  // Replace roles.
  await supabase.from("staff_roles").delete().eq("staff_member_id", staffId);
  if (data.role_ids.length) {
    const rows = data.role_ids.map((role_id) => ({
      staff_member_id: staffId,
      role_id,
      is_primary: data.primary_role_id === role_id,
    }));
    await supabase.from("staff_roles").insert(rows);
  }

  // Replace qualifications.
  await supabase
    .from("staff_qualifications")
    .delete()
    .eq("staff_member_id", staffId);
  if (data.qualification_ids.length) {
    const rows = data.qualification_ids.map((qualification_id) => ({
      staff_member_id: staffId,
      qualification_id,
    }));
    await supabase.from("staff_qualifications").insert(rows);
  }

  await writeAudit({
    action: "staff.update",
    entity_type: "staff_member",
    entity_id: staffId,
    summary: `Updated staff member ${data.display_name}`,
    after: { display_name: data.display_name },
    actorId: session.user.id,
  });

  revalidatePath("/dashboard/roster");
  revalidatePath(`/dashboard/roster/${staffId}`);
  return { ok: true, data: { id: staffId } };
}

export async function archiveStaffMember(
  staffId: string,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireOwner();
  const supabase = await createClient();
  const { error } = await supabase
    .from("staff_members")
    .update({
      active: false,
      archived_at: new Date().toISOString(),
      updated_by: session.user.id,
    })
    .eq("id", staffId);
  if (error) return { ok: false, message: explain(error) };

  await writeAudit({
    action: "staff.archive",
    entity_type: "staff_member",
    entity_id: staffId,
    summary: `Archived staff member ${staffId}`,
    actorId: session.user.id,
  });

  revalidatePath("/dashboard/roster");
  revalidatePath(`/dashboard/roster/${staffId}`);
  return { ok: true, data: { id: staffId } };
}

export async function restoreStaffMember(
  staffId: string,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireOwner();
  const supabase = await createClient();
  const { error } = await supabase
    .from("staff_members")
    .update({
      active: true,
      archived_at: null,
      updated_by: session.user.id,
    })
    .eq("id", staffId);
  if (error) return { ok: false, message: explain(error) };

  await writeAudit({
    action: "staff.restore",
    entity_type: "staff_member",
    entity_id: staffId,
    summary: `Restored staff member ${staffId}`,
    actorId: session.user.id,
  });

  revalidatePath("/dashboard/roster");
  revalidatePath(`/dashboard/roster/${staffId}`);
  return { ok: true, data: { id: staffId } };
}

/* ─────────────────── CSV import ─────────────────── */

export type ImportDecision = "create" | "update" | "skip";

export type ImportRowInput = {
  rowNumber: number;
  decision: ImportDecision;
  matchedStaffMemberId: string | null;
  displayName: string;
  firstName: string;
  lastName: string;
  emailNormalized: string;
  phoneE164: string;
  preferredContact: PreferredContactMethod;
  primaryRole: string; // role name
  roles: string[]; // role names
  qualifications: string[]; // qualification names
  notes: string;
  active: boolean;
};

export type ImportSummary = {
  created: number;
  updated: number;
  skipped: number;
  invalid: number;
  errors: Array<{ rowNumber: number; message: string }>;
};

export async function importRosterCsv(
  rows: ImportRowInput[],
): Promise<ActionResult<ImportSummary>> {
  const session = await requireOwner();
  const supabase = await createClient();

  // Resolve role / qualification name → id lookups in bulk.
  const { data: roles } = await supabase
    .from("crew_roles")
    .select("id, name");
  const { data: quals } = await supabase
    .from("qualifications")
    .select("id, name");
  const roleByName = new Map<string, string>();
  for (const r of roles ?? []) {
    roleByName.set(((r as { name: string }).name).trim().toLowerCase(), (r as { id: string }).id);
  }
  const qualByName = new Map<string, string>();
  for (const q of quals ?? []) {
    qualByName.set(((q as { name: string }).name).trim().toLowerCase(), (q as { id: string }).id);
  }

  const summary: ImportSummary = {
    created: 0,
    updated: 0,
    skipped: 0,
    invalid: 0,
    errors: [],
  };

  for (const row of rows) {
    if (row.decision === "skip") {
      summary.skipped++;
      continue;
    }
    if (!row.displayName) {
      summary.invalid++;
      summary.errors.push({
        rowNumber: row.rowNumber,
        message: "Missing display name",
      });
      continue;
    }
    try {
      const staffId =
        row.decision === "update" && row.matchedStaffMemberId
          ? row.matchedStaffMemberId
          : await insertStaff(supabase, row, session.user.id);
      if (row.decision === "update") {
        await supabase
          .from("staff_members")
          .update({
            display_name: row.displayName,
            first_name: row.firstName || null,
            last_name: row.lastName || null,
            preferred_contact: row.preferredContact,
            notes: row.notes || null,
            active: row.active,
            updated_by: session.user.id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", staffId);
        summary.updated++;
      } else {
        summary.created++;
      }

      // Replace contacts.
      await supabase
        .from("staff_contact_methods")
        .delete()
        .eq("staff_member_id", staffId);
      const contactInserts: ContactMethodInsert[] = [];
      if (row.phoneE164) {
        contactInserts.push({
          staff_member_id: staffId,
          channel: "sms",
          value: row.phoneE164,
          normalized_value: row.phoneE164,
          is_primary: true,
          status: "unknown",
          consent: "unknown",
        });
      }
      if (row.emailNormalized) {
        contactInserts.push({
          staff_member_id: staffId,
          channel: "email",
          value: row.emailNormalized,
          normalized_value: row.emailNormalized,
          is_primary: true,
          status: "unknown",
          consent: "unknown",
        });
      }
      if (contactInserts.length) {
        await supabase.from("staff_contact_methods").insert(contactInserts);
      }

      // Roles.
      const roleIds: string[] = [];
      for (const name of [row.primaryRole, ...row.roles]) {
        if (!name) continue;
        const id = roleByName.get(name.trim().toLowerCase());
        if (id && !roleIds.includes(id)) roleIds.push(id);
      }
      if (roleIds.length) {
        await supabase
          .from("staff_roles")
          .delete()
          .eq("staff_member_id", staffId);
        const primaryId =
          row.primaryRole &&
          roleByName.get(row.primaryRole.trim().toLowerCase());
        await supabase.from("staff_roles").insert(
          roleIds.map((role_id) => ({
            staff_member_id: staffId,
            role_id,
            is_primary: role_id === primaryId,
          })),
        );
      }

      // Quals.
      const qualIds: string[] = [];
      for (const name of row.qualifications) {
        const id = qualByName.get(name.trim().toLowerCase());
        if (id && !qualIds.includes(id)) qualIds.push(id);
      }
      if (qualIds.length) {
        await supabase
          .from("staff_qualifications")
          .delete()
          .eq("staff_member_id", staffId);
        await supabase.from("staff_qualifications").insert(
          qualIds.map((qualification_id) => ({
            staff_member_id: staffId,
            qualification_id,
          })),
        );
      }
    } catch (err) {
      summary.invalid++;
      summary.errors.push({
        rowNumber: row.rowNumber,
        message: explain(err),
      });
    }
  }

  await writeAudit({
    action: "roster.import_csv",
    entity_type: "roster",
    entity_id: session.user.id, // import isn't tied to one entity
    summary: `Imported CSV: ${summary.created} created · ${summary.updated} updated · ${summary.skipped} skipped · ${summary.invalid} invalid`,
    after: summary,
    actorId: session.user.id,
  });

  revalidatePath("/dashboard/roster");
  return { ok: true, data: summary };
}

async function insertStaff(
  supabase: Awaited<ReturnType<typeof createClient>>,
  row: ImportRowInput,
  userId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("staff_members")
    .insert({
      display_name: row.displayName,
      first_name: row.firstName || null,
      last_name: row.lastName || null,
      preferred_contact: row.preferredContact,
      notes: row.notes || null,
      active: row.active,
      imported_source: "csv",
      created_by: userId,
      updated_by: userId,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(explain(error));
  return (data as { id: string }).id;
}

/* ─────────────────── Roles ─────────────────── */

export async function createRole(
  input: z.input<typeof roleCreateSchema>,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireOwner();
  const parsed = roleCreateSchema.safeParse(input);
  if (!parsed.success) return zodError(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crew_roles")
    .insert({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      sort_order: parsed.data.sort_order ?? 100,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, message: explain(error) };
  await writeAudit({
    action: "role.create",
    entity_type: "crew_role",
    entity_id: (data as { id: string }).id,
    summary: `Created role ${parsed.data.name}`,
    actorId: session.user.id,
  });
  revalidatePath("/dashboard/settings/roles");
  return { ok: true, data: data as { id: string } };
}

export async function updateRole(
  id: string,
  input: z.input<typeof roleUpdateSchema>,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireOwner();
  const parsed = roleUpdateSchema.safeParse(input);
  if (!parsed.success) return zodError(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase
    .from("crew_roles")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, message: explain(error) };
  await writeAudit({
    action: "role.update",
    entity_type: "crew_role",
    entity_id: id,
    summary: `Updated role ${id}`,
    after: parsed.data,
    actorId: session.user.id,
  });
  revalidatePath("/dashboard/settings/roles");
  return { ok: true, data: { id } };
}

export async function archiveRole(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireOwner();
  const supabase = await createClient();
  const { error } = await supabase
    .from("crew_roles")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, message: explain(error) };
  await writeAudit({
    action: "role.archive",
    entity_type: "crew_role",
    entity_id: id,
    summary: `Archived role ${id}`,
    actorId: session.user.id,
  });
  revalidatePath("/dashboard/settings/roles");
  return { ok: true, data: { id } };
}

/* ─────────────────── Qualifications ─────────────────── */

export async function createQualification(
  input: z.input<typeof qualificationCreateSchema>,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireOwner();
  const parsed = qualificationCreateSchema.safeParse(input);
  if (!parsed.success) return zodError(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("qualifications")
    .insert({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, message: explain(error) };
  await writeAudit({
    action: "qualification.create",
    entity_type: "qualification",
    entity_id: (data as { id: string }).id,
    summary: `Created qualification ${parsed.data.name}`,
    actorId: session.user.id,
  });
  revalidatePath("/dashboard/settings/qualifications");
  return { ok: true, data: data as { id: string } };
}

export async function updateQualification(
  id: string,
  input: z.input<typeof qualificationUpdateSchema>,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireOwner();
  const parsed = qualificationUpdateSchema.safeParse(input);
  if (!parsed.success) return zodError(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase
    .from("qualifications")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, message: explain(error) };
  await writeAudit({
    action: "qualification.update",
    entity_type: "qualification",
    entity_id: id,
    summary: `Updated qualification ${id}`,
    after: parsed.data,
    actorId: session.user.id,
  });
  revalidatePath("/dashboard/settings/qualifications");
  return { ok: true, data: { id } };
}

export async function archiveQualification(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireOwner();
  const supabase = await createClient();
  const { error } = await supabase
    .from("qualifications")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, message: explain(error) };
  await writeAudit({
    action: "qualification.archive",
    entity_type: "qualification",
    entity_id: id,
    summary: `Archived qualification ${id}`,
    actorId: session.user.id,
  });
  revalidatePath("/dashboard/settings/qualifications");
  return { ok: true, data: { id } };
}

/* ─────────────────── helpers ─────────────────── */

function derivePreferredContact(
  preferred: PreferredContactMethod,
  hasPhone: boolean,
  hasEmail: boolean,
): PreferredContactMethod {
  if (!hasPhone && !hasEmail) return "manual_only";
  if (preferred === "sms" && !hasPhone) return hasEmail ? "email" : "manual_only";
  if (preferred === "email" && !hasEmail) return hasPhone ? "sms" : "manual_only";
  if (preferred === "both" && !(hasPhone && hasEmail)) {
    return hasPhone ? "sms" : "email";
  }
  return preferred;
}

// re-export for client consumers that need the matched key shape
export { contactDedupeKey };
