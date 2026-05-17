import { NextResponse, type NextRequest } from "next/server";

import {
  processTwilioInbound,
  processTwilioStatusCallback,
} from "@/lib/messaging/provider-webhooks";
import { verifyTwilioSignature } from "@/lib/security/signatures";
import {
  twilioInboundSchema,
  twilioStatusCallbackSchema,
} from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Twilio webhook entry. One endpoint handles both delivery callbacks (the
 * MessageStatus webhook configured per Messaging Service) and inbound SMS
 * (STOP/HELP/START). We distinguish by payload shape: inbound has a `Body`
 * field; status callbacks have `MessageStatus`/`SmsStatus`.
 */
export async function POST(request: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = request.headers.get("x-twilio-signature");

  // Pull raw text so we can re-build the form params for signature checks.
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return new NextResponse("bad request", { status: 400 });
  }

  const params = new URLSearchParams(rawBody);
  const paramObj: Record<string, string> = {};
  for (const [k, v] of params.entries()) paramObj[k] = v;

  // Twilio signs the absolute URL it called. Behind Vercel's proxy the host
  // header is correct but the protocol must be reconstructed.
  const url = absoluteUrl(request);

  if (!authToken) {
    console.error("[twilio-webhook] TWILIO_AUTH_TOKEN missing");
    return new NextResponse("forbidden", { status: 403 });
  }
  if (
    !signature ||
    !verifyTwilioSignature({ signature, url, params: paramObj, authToken })
  ) {
    return new NextResponse("forbidden", { status: 403 });
  }

  // Try inbound shape first.
  const inbound = twilioInboundSchema.safeParse({
    ...paramObj,
  });
  if (inbound.success && typeof paramObj.Body === "string") {
    try {
      await processTwilioInbound(inbound.data);
    } catch (err) {
      console.error("[twilio-webhook] inbound error:", err);
    }
    return new NextResponse("ok", { status: 200 });
  }

  const status = twilioStatusCallbackSchema.safeParse(paramObj);
  if (status.success) {
    try {
      await processTwilioStatusCallback(status.data);
    } catch (err) {
      console.error("[twilio-webhook] status error:", err);
    }
    return new NextResponse("ok", { status: 200 });
  }

  // We accepted+verified the signature but couldn't parse — still 200 so
  // Twilio doesn't retry endlessly. Log loudly for triage.
  console.warn("[twilio-webhook] unparseable payload:", paramObj);
  return new NextResponse("ok", { status: 200 });
}

function absoluteUrl(request: NextRequest): string {
  // NextRequest.url is the full request URL Vercel saw; that's exactly
  // what Twilio signs against.
  return request.url;
}
