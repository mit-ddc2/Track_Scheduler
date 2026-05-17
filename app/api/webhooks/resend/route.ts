import { NextResponse, type NextRequest } from "next/server";

import { processResendEvent } from "@/lib/messaging/provider-webhooks";
import { verifyResendSignature } from "@/lib/security/signatures";
import { resendEventSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resend webhook endpoint. Validates the Svix-format signature header set
 * (svix-id, svix-timestamp, svix-signature). Returns 200 on success or
 * benign error so Resend does not retry indefinitely; 403 on signature
 * mismatch so misconfigured webhooks are visible.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[resend-webhook] RESEND_WEBHOOK_SECRET missing");
    return new NextResponse("forbidden", { status: 403 });
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return new NextResponse("bad request", { status: 400 });
  }

  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");

  const sigOk = verifyResendSignature({
    signature: svixSignature,
    svixId,
    svixTimestamp,
    payload: rawBody,
    secret,
  });
  if (!sigOk) {
    return new NextResponse("forbidden", { status: 403 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return new NextResponse("bad request", { status: 400 });
  }

  const parsed = resendEventSchema.safeParse(json);
  if (!parsed.success) {
    console.warn("[resend-webhook] unparseable payload:", parsed.error.message);
    return new NextResponse("ok", { status: 200 });
  }

  try {
    await processResendEvent(parsed.data);
  } catch (err) {
    console.error("[resend-webhook] processing error:", err);
  }
  return new NextResponse("ok", { status: 200 });
}
