/**
 * Server-only queries for the consent & opt-outs viewer. We materialise one
 * row per (staff_member, contact_method) so the per-staff table can show
 * status + consent + last consent timestamp side-by-side, then surface a
 * filtered "opt-outs" cut for the same data.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/db/consent-queries.ts is server-only");
}

import { createClient } from "@/lib/db/supabase-server";
import type {
  ConsentRecord,
  ContactChannel,
  ContactStatus,
  ConsentStatus,
} from "@/lib/db/types";

export type ConsentMethodRow = {
  staff_member_id: string;
  staff_display_name: string;
  staff_active: boolean;
  contact_method_id: string;
  channel: ContactChannel;
  value: string;
  status: ContactStatus;
  consent: ConsentStatus;
  consent_source: string | null;
  consented_at: string | null;
  opted_out_at: string | null;
};

export async function listConsentRows(): Promise<ConsentMethodRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff_contact_methods")
    .select(
      `
      id, staff_member_id, channel, value, status, consent, consent_source, consented_at, opted_out_at,
      staff_members(id, display_name, active, archived_at)
    `,
    )
    .order("channel", { ascending: true });
  if (error) {
    console.warn("[consent-queries] listConsentRows failed:", error.message);
    return [];
  }

  type Joined = {
    id: string;
    staff_member_id: string;
    channel: ContactChannel;
    value: string;
    status: ContactStatus;
    consent: ConsentStatus;
    consent_source: string | null;
    consented_at: string | null;
    opted_out_at: string | null;
    staff_members:
      | {
          id: string;
          display_name: string;
          active: boolean;
          archived_at: string | null;
        }
      | null;
  };

  return ((data ?? []) as unknown as Joined[])
    .filter((row) => row.staff_members !== null && row.staff_members.archived_at === null)
    .map((row) => ({
      staff_member_id: row.staff_member_id,
      staff_display_name: row.staff_members?.display_name ?? "(unknown)",
      staff_active: row.staff_members?.active ?? false,
      contact_method_id: row.id,
      channel: row.channel,
      value: row.value,
      status: row.status,
      consent: row.consent,
      consent_source: row.consent_source,
      consented_at: row.consented_at,
      opted_out_at: row.opted_out_at,
    }))
    .sort((a, b) =>
      a.staff_display_name.localeCompare(b.staff_display_name) ||
      a.channel.localeCompare(b.channel),
    );
}

/** All consent_records for a (staff, channel) pair, newest first. */
export async function listConsentHistory(
  staffMemberId: string,
  channel: ContactChannel,
): Promise<ConsentRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("consent_records")
    .select(
      "id, staff_member_id, contact_method_id, channel, status, source, captured_by, captured_at, notes, evidence",
    )
    .eq("staff_member_id", staffMemberId)
    .eq("channel", channel)
    .order("captured_at", { ascending: false });
  if (error) {
    console.warn("[consent-queries] listConsentHistory failed:", error.message);
    return [];
  }
  return (data ?? []) as ConsentRecord[];
}

/** Pre-fetch consent history for every (staff, channel) in one round-trip. */
export async function listConsentHistoryFor(
  staffIds: string[],
): Promise<Map<string, ConsentRecord[]>> {
  if (staffIds.length === 0) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("consent_records")
    .select(
      "id, staff_member_id, contact_method_id, channel, status, source, captured_by, captured_at, notes, evidence",
    )
    .in("staff_member_id", staffIds)
    .order("captured_at", { ascending: false });
  if (error) {
    console.warn("[consent-queries] listConsentHistoryFor failed:", error.message);
    return new Map();
  }
  const grouped = new Map<string, ConsentRecord[]>();
  for (const row of (data ?? []) as ConsentRecord[]) {
    const key = `${row.staff_member_id}:${row.channel}`;
    const arr = grouped.get(key) ?? [];
    arr.push(row);
    grouped.set(key, arr);
  }
  return grouped;
}

/**
 * Heuristic used by the "opt-outs" tab + filter chips. Anything where the
 * channel is unhealthy or consent isn't (currently) granted shows up.
 */
export function isProblemRow(row: ConsentMethodRow): boolean {
  return (
    row.status === "opted_out" ||
    row.status === "bounced" ||
    row.status === "suppressed" ||
    row.status === "invalid" ||
    row.consent === "withdrawn" ||
    row.consent === "denied"
  );
}
