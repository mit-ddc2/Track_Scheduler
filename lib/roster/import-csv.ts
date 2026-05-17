import Papa from "papaparse";

import { csvRowSchema, type PreferredContact } from "@/lib/validation/schemas";

import {
  contactDedupeKey,
  isValidEmail,
  normalizeEmail,
  normalizePhone,
} from "./normalize-contact";

/** Canonical CSV columns the import wizard understands. */
export const ROSTER_CSV_COLUMNS = [
  "first_name",
  "last_name",
  "display_name",
  "email",
  "phone",
  "preferred_contact",
  "primary_role",
  "roles",
  "qualifications",
  "notes",
  "active",
] as const;

export type ParsedRow = {
  rowNumber: number;
  raw: Record<string, string>;
  displayName: string;
  firstName: string;
  lastName: string;
  email: string;
  emailNormalized: string;
  phone: string;
  phoneE164: string;
  phoneValid: boolean;
  preferredContact: PreferredContact;
  primaryRole: string;
  roles: string[];
  qualifications: string[];
  notes: string;
  active: boolean;
  errors: string[];
};

export type ContactSummary = {
  staff_member_id: string;
  display_name: string;
  contact_keys: string[]; // dedupe keys: e.g. "email:foo@bar.com", "sms:+16135550142"
};

export type RowStatus = "new" | "duplicate" | "invalid" | "warning";
export type RowDecision = "create" | "update" | "skip";

export type RowWithStatus = ParsedRow & {
  status: RowStatus;
  matchedStaffMemberId: string | null;
  matchedDisplayName: string | null;
  defaultDecision: RowDecision;
  errors: string[];
  /** Owner-facing notes (e.g. "no contact info — will be manual_only"). */
  warnings: string[];
};

/**
 * Parse a CSV File on the client. Returns `rows` (typed/validated) and a
 * list of file-level errors (header issues, completely malformed lines).
 *
 * Header matching is case-insensitive. Unknown columns are kept in `raw`
 * but ignored for typed extraction.
 */
export async function parseRosterCsv(file: File): Promise<{
  rows: ParsedRow[];
  errors: string[];
}> {
  const text = await file.text();
  return parseRosterCsvText(text);
}

/** Pure-string variant for tests / server-side usage. */
export function parseRosterCsvText(text: string): {
  rows: ParsedRow[];
  errors: string[];
} {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  const errors: string[] = [];
  if (parsed.errors.length) {
    for (const err of parsed.errors) {
      errors.push(`Row ${err.row ?? "?"}: ${err.message}`);
    }
  }

  const rows: ParsedRow[] = [];
  const dataRows = parsed.data ?? [];
  for (let i = 0; i < dataRows.length; i++) {
    const raw = dataRows[i] ?? {};
    const result = csvRowSchema.safeParse(raw);
    const rowErrors: string[] = [];
    if (!result.success) {
      for (const issue of result.error.issues) {
        rowErrors.push(`${issue.path.join(".") || "row"}: ${issue.message}`);
      }
    }
    const data = result.success ? result.data : csvRowSchema.parse({});

    const emailNormalized = normalizeEmail(data.email);
    const emailValid = emailNormalized ? isValidEmail(emailNormalized) : true;
    if (emailNormalized && !emailValid) {
      rowErrors.push("email: invalid format");
    }

    const phone = normalizePhone(data.phone);

    const displayName =
      data.display_name ||
      [data.first_name, data.last_name].filter(Boolean).join(" ").trim();

    if (!displayName) {
      rowErrors.push("display_name: required (or provide first/last name)");
    }

    const hasPhone = Boolean(phone.e164 && phone.valid);
    const hasEmail = Boolean(emailNormalized && emailValid);

    let preferredContact: PreferredContact = "both";
    const pcRaw = data.preferred_contact;
    if (pcRaw === "sms" || pcRaw === "email" || pcRaw === "both" || pcRaw === "manual_only") {
      preferredContact = pcRaw;
    }
    if (!hasPhone && !hasEmail) {
      preferredContact = "manual_only";
    } else if (preferredContact === "sms" && !hasPhone) {
      preferredContact = hasEmail ? "email" : "manual_only";
    } else if (preferredContact === "email" && !hasEmail) {
      preferredContact = hasPhone ? "sms" : "manual_only";
    }

    const active = parseActiveFlag(data.active);

    rows.push({
      rowNumber: i + 2, // 1-indexed + header row
      raw,
      displayName,
      firstName: data.first_name,
      lastName: data.last_name,
      email: data.email,
      emailNormalized,
      phone: data.phone,
      phoneE164: phone.valid ? phone.e164 : "",
      phoneValid: phone.valid,
      preferredContact,
      primaryRole: data.primary_role,
      roles: splitMulti(data.roles),
      qualifications: splitMulti(data.qualifications),
      notes: data.notes,
      active,
      errors: rowErrors,
    });
  }

  return { rows, errors };
}

/**
 * Match parsed rows against existing roster contacts (already normalized).
 * Sets per-row status: `invalid` if missing both contact methods *and* has
 * any validation errors; `duplicate` if any normalized contact collides with
 * an existing staff member; `new` otherwise.
 */
export function dedupeAgainstExisting(
  parsed: ParsedRow[],
  existing: ContactSummary[],
): RowWithStatus[] {
  const byKey = new Map<string, ContactSummary>();
  for (const c of existing) {
    for (const key of c.contact_keys) {
      if (key) byKey.set(key, c);
    }
  }

  return parsed.map((row) => {
    const keys: string[] = [];
    if (row.emailNormalized && row.errors.every((e) => !e.startsWith("email:"))) {
      keys.push(contactDedupeKey("email", row.emailNormalized));
    }
    if (row.phoneE164) {
      keys.push(contactDedupeKey("sms", row.phoneE164));
    }
    let match: ContactSummary | undefined;
    for (const key of keys) {
      const found = byKey.get(key);
      if (found) {
        match = found;
        break;
      }
    }

    const hasContact = keys.length > 0;
    const fatalErrors = row.errors.filter((e) =>
      e.startsWith("display_name:") || e.startsWith("email:"),
    );
    // INVALID = truly unusable: no name AND no contact (and any explicit
    // fatal error like an unparseable email). The row can't become a
    // useful staff member, so it's skipped by default.
    const isInvalid =
      fatalErrors.length > 0 || (!hasContact && !row.displayName);
    // WARNING = has a name but no usable contact. We can still create the
    // record (preferred_contact will fall back to manual_only with
    // consent='unknown'), but the owner should know it's a stub.
    const warnings: string[] = [];
    if (!isInvalid && !hasContact && row.displayName) {
      warnings.push(
        "no phone or email — will be created as manual_only (consent unknown)",
      );
    }

    let status: RowStatus;
    if (isInvalid) status = "invalid";
    else if (match) status = "duplicate";
    else if (warnings.length > 0) status = "warning";
    else status = "new";

    const defaultDecision: RowDecision =
      status === "invalid"
        ? "skip"
        : status === "duplicate"
          ? "update"
          : "create";

    return {
      ...row,
      status,
      matchedStaffMemberId: match?.staff_member_id ?? null,
      matchedDisplayName: match?.display_name ?? null,
      defaultDecision,
      errors: row.errors,
      warnings,
    };
  });
}

function splitMulti(value: string): string[] {
  if (!value) return [];
  return value
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseActiveFlag(raw: string): boolean {
  if (!raw) return true;
  const v = raw.trim().toLowerCase();
  if (v === "false" || v === "no" || v === "0" || v === "inactive") return false;
  return true;
}
