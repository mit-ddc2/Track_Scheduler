import { NextResponse, type NextRequest } from "next/server";

import { drainOutbox } from "@/lib/messaging/outbox";
import { verifyCronSecret } from "@/lib/security/signatures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH_LIMIT = 50;

/**
 * Cron entry point — invoked every minute by Vercel Cron (see vercel.json).
 * Auth: must present `Authorization: Bearer ${CRON_SECRET}`.
 *
 * Returns a small JSON summary so Vercel runtime logs are usable. The route
 * is wrapped in try/catch — provider/database errors must not surface as 5xx
 * to the cron runner because that triggers retry storms.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!verifyCronSecret(auth)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await drainOutbox({ limit: BATCH_LIMIT });
    console.log("[cron:drain-outbox]", result);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron:drain-outbox] error:", message);
    return NextResponse.json(
      { error: "drain_failed", message },
      { status: 200 },
    );
  }
}
