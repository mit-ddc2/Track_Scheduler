import { requireOwner } from "@/lib/auth/require-owner";
import { writeAudit } from "@/lib/db/audit";
import { listStaff, type StaffListRow } from "@/lib/roster/queries";

const CSV_HEADERS = [
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

const FORMULA_LEADERS = new Set(["=", "+", "-", "@", "\t", "\r", "\n"]);

/**
 * Escape a field for CSV. Wraps in quotes when needed, doubles internal
 * quotes, and prefixes a leading single quote if the value would be
 * interpreted as a formula by Excel/Numbers/Sheets.
 */
function escapeField(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  let s = String(raw);
  if (s.length > 0 && FORMULA_LEADERS.has(s[0])) {
    s = `'${s}`;
  }
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowToCsv(row: StaffListRow): string {
  const sms = row.contact_methods.find((c) => c.channel === "sms");
  const email = row.contact_methods.find((c) => c.channel === "email");
  const primary = row.staff_roles.find((r) => r.is_primary);
  const otherRoles = row.staff_roles
    .filter((r) => !r.is_primary)
    .map((r) => r.crew_roles?.name)
    .filter(Boolean)
    .join(";");
  const quals = row.staff_qualifications
    .map((q) => q.qualifications?.name)
    .filter(Boolean)
    .join(";");
  const values = [
    row.first_name,
    row.last_name,
    row.display_name,
    email?.value ?? "",
    sms?.value ?? "",
    row.preferred_contact,
    primary?.crew_roles?.name ?? "",
    otherRoles,
    quals,
    row.notes ?? "",
    row.active ? "true" : "false",
  ];
  return values.map(escapeField).join(",");
}

export async function GET() {
  const session = await requireOwner();
  const rows = await listStaff();
  // RFC 4180 mandates CRLF line separators for CSV. Excel/Numbers tolerate
  // bare LF but some downstream parsers (and Outlook attachments) don't.
  const csv = [
    CSV_HEADERS.join(","),
    ...rows.map(rowToCsv),
  ].join("\r\n");

  await writeAudit({
    action: "roster.export_csv",
    entity_type: "roster",
    entity_id: session.user.id,
    summary: `Exported ${rows.length} roster rows`,
    actorId: session.user.id,
  });

  const fileName = `roster-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${fileName}"`,
      "cache-control": "no-store",
    },
  });
}
