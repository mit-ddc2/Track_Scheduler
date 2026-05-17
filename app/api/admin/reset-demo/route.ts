import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { requireOwner } from "@/lib/auth/require-owner";
import { writeAudit } from "@/lib/db/audit";
import { createAdminClient } from "@/lib/db/supabase-admin";
import { resetAndSeedDemoData } from "@/lib/dev/demo-seed";

/**
 * Admin: wipe + re-seed the demo data.
 *
 *   POST /api/admin/reset-demo?key=<CRON_SECRET>
 *
 * Gates (defence in depth):
 *   1. DEV_RESET_DEMO_ENABLED must be "true" — otherwise 404.
 *   2. `requireOwner()` — caller must be the signed-in owner profile.
 *   3. Constant-time CRON_SECRET key match on the `?key=` query param.
 *
 * On success returns `{ ok: true, counts: { staff: 6, events: 3, ... } }`
 * and writes an audit_log row with `action="demo.reset"`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf-8");
  const bBuf = Buffer.from(b, "utf-8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export async function POST(request: NextRequest) {
  // 1. Hard env gate — 404 in production unless explicitly enabled.
  if (process.env.DEV_RESET_DEMO_ENABLED !== "true") {
    return new NextResponse("Not found", { status: 404 });
  }

  // 2. Owner auth — redirect happens inside requireOwner when not signed in.
  //    For a fetch POST that 302 -> /login redirect surfaces as a 302; clients
  //    should treat anything that isn't a JSON 2xx as failure.
  const session = await requireOwner();

  // 3. CRON_SECRET key check (constant-time).
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }
  const provided = request.nextUrl.searchParams.get("key") ?? "";
  if (!constantTimeEqual(provided, cronSecret)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // 4. Run the wipe + seed via service-role client.
  const admin = createAdminClient();
  let counts;
  try {
    counts = await resetAndSeedDemoData(admin);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[admin.reset-demo] failed:", message);
    return NextResponse.json(
      { error: "reset_failed", message },
      { status: 500 },
    );
  }

  // 5. Audit log — best-effort; resetAndSeedDemoData wiped the table so this
  //    will be the only row immediately after.
  await writeAudit({
    action: "demo.reset",
    entity_type: "system",
    entity_id: session.user.id,
    summary: `Demo data wiped + re-seeded (${counts.staff} staff, ${counts.events} events)`,
    actorId: session.user.id,
    after: counts,
  });

  return NextResponse.json({ ok: true, counts }, { status: 200 });
}
