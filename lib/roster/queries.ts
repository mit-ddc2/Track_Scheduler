import "server-only";

import { createClient } from "@/lib/db/supabase-server";
import type {
  ContactChannel,
  ContactStatus,
  ConsentStatus,
  CrewRole,
  PreferredContactMethod,
  Qualification,
  StaffContactMethod,
  StaffMember,
} from "@/lib/db/types";

export type StaffListRow = {
  id: string;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  active: boolean;
  preferred_contact: PreferredContactMethod;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  contact_methods: Array<{
    id: string;
    channel: ContactChannel;
    value: string;
    normalized_value: string;
    is_primary: boolean;
    status: ContactStatus;
    consent: ConsentStatus;
    consent_source: string | null;
    consented_at: string | null;
  }>;
  staff_roles: Array<{
    role_id: string;
    is_primary: boolean;
    crew_roles: { id: string; name: string } | null;
  }>;
  staff_qualifications: Array<{
    qualification_id: string;
    expires_at: string | null;
    qualifications: { id: string; name: string } | null;
  }>;
};

/**
 * Fetch all roster rows with related contact methods, roles, and quals
 * embedded. Caller filters/sorts in memory — Phase 2's volumes are tiny
 * (low hundreds of rows) and one round-trip beats RLS-aware joins.
 */
export async function listStaff(): Promise<StaffListRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff_members")
    .select(
      `
      id, display_name, first_name, last_name, active, preferred_contact, notes, archived_at, created_at, updated_at,
      contact_methods:staff_contact_methods(id, channel, value, normalized_value, is_primary, status, consent, consent_source, consented_at),
      staff_roles(role_id, is_primary, crew_roles(id, name)),
      staff_qualifications(qualification_id, expires_at, qualifications(id, name))
    `,
    )
    .order("display_name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as StaffListRow[];
}

export async function getStaffById(id: string): Promise<StaffListRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff_members")
    .select(
      `
      id, display_name, first_name, last_name, active, preferred_contact, notes, archived_at, created_at, updated_at,
      contact_methods:staff_contact_methods(id, channel, value, normalized_value, is_primary, status, consent, consent_source, consented_at),
      staff_roles(role_id, is_primary, crew_roles(id, name)),
      staff_qualifications(qualification_id, expires_at, qualifications(id, name))
    `,
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as StaffListRow | null;
}

export async function listCrewRoles(activeOnly = false): Promise<CrewRole[]> {
  const supabase = await createClient();
  const query = supabase
    .from("crew_roles")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  const { data, error } = activeOnly ? await query.eq("active", true) : await query;
  if (error) throw error;
  return (data ?? []) as CrewRole[];
}

export async function listQualifications(
  activeOnly = false,
): Promise<Qualification[]> {
  const supabase = await createClient();
  const query = supabase
    .from("qualifications")
    .select("*")
    .order("name", { ascending: true });
  const { data, error } = activeOnly ? await query.eq("active", true) : await query;
  if (error) throw error;
  return (data ?? []) as Qualification[];
}

export type StaffSummary = Pick<
  StaffMember,
  "id" | "display_name" | "active"
> & {
  primary_role: string | null;
  qualifications: string[];
  phone: string | null;
  email: string | null;
  preferred_contact: PreferredContactMethod;
  sms_present: boolean;
  email_present: boolean;
  sms_status: ContactStatus | null;
  email_status: ContactStatus | null;
};

export function summarize(row: StaffListRow): StaffSummary {
  const sms = row.contact_methods.find((c) => c.channel === "sms");
  const email = row.contact_methods.find((c) => c.channel === "email");
  const primaryRole = row.staff_roles.find((r) => r.is_primary);
  const fallbackRole = row.staff_roles[0];
  return {
    id: row.id,
    display_name: row.display_name,
    active: row.active,
    primary_role: primaryRole?.crew_roles?.name ?? fallbackRole?.crew_roles?.name ?? null,
    qualifications: row.staff_qualifications
      .map((q) => q.qualifications?.name)
      .filter((n): n is string => Boolean(n)),
    phone: sms?.value ?? null,
    email: email?.value ?? null,
    preferred_contact: row.preferred_contact,
    sms_present: Boolean(sms),
    email_present: Boolean(email),
    sms_status: sms?.status ?? null,
    email_status: email?.status ?? null,
  };
}

export function asContactSummaries(
  rows: StaffListRow[],
): Array<{
  staff_member_id: string;
  display_name: string;
  contact_keys: string[];
}> {
  return rows.map((r) => ({
    staff_member_id: r.id,
    display_name: r.display_name,
    contact_keys: r.contact_methods
      .map((c) =>
        c.normalized_value
          ? `${c.channel}:${c.normalized_value.trim().toLowerCase()}`
          : "",
      )
      .filter(Boolean),
  }));
}

/** Treats `StaffContactMethod` as the canonical insert shape downstream. */
export type StaffContactMethodInsert = Pick<
  StaffContactMethod,
  "channel" | "value" | "normalized_value" | "is_primary"
> & {
  status?: ContactStatus;
  consent?: ConsentStatus;
  consent_source?: string | null;
};
