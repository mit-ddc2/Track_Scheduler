import { requireOwner } from "@/lib/auth/require-owner";
import { writeAudit } from "@/lib/db/audit";
import { getPayrollExportData } from "@/lib/attendance/queries";
import { buildPayrollCsv } from "@/lib/payroll/export-csv";

type RouteContext = {
  params: Promise<{ eventId: string }>;
};

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "event";
}

/**
 * GET /api/exports/payroll/[eventId]
 *
 * Returns the per-assignee payroll CSV for one event.
 *   - requireOwner() gate
 *   - audit-logs `payroll.export` with the event id + row count
 *   - RFC 4180 + formula-injection-safe CSV (see lib/payroll/export-csv.ts)
 */
export async function GET(_req: Request, ctx: RouteContext) {
  const session = await requireOwner();
  const { eventId } = await ctx.params;

  const { event, records } = await getPayrollExportData(eventId);

  if (!event) {
    return new Response("Event not found", { status: 404 });
  }

  const csv = buildPayrollCsv(records);

  await writeAudit({
    action: "payroll.export",
    entity_type: "event",
    entity_id: eventId,
    summary: `Exported payroll CSV (${records.length} rows) for "${event.title}"`,
    after: { event_id: eventId, count: records.length },
    actorType: "owner",
    actorId: session.profile.id,
  });

  const datePart = event.starts_at.slice(0, 10);
  const fileName = `payroll-${datePart}-${slugify(event.title)}.csv`;

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${fileName}"`,
      "cache-control": "no-store",
    },
  });
}
