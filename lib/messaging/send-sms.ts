// server-only — wraps Twilio.
if (typeof window !== "undefined") {
  throw new Error("lib/messaging/send-sms.ts is server-only");
}

import { randomBytes } from "node:crypto";

import type { SendResult } from "./provider-types";

export type SendSmsInput = {
  to: string;
  body: string;
  idempotencyKey: string;
};

/**
 * Returns true when SMS sending should go through the in-process mock
 * provider (writes a row to `mock_sent_sms`, never contacts Twilio). Triggers
 * when either:
 *   - MESSAGING_PROVIDER=mock is set
 *   - TWILIO_MESSAGING_SERVICE_SID starts with "mock_"
 *
 * The second form lets you flip a single Vercel env var to a placeholder
 * without coordinating provider switches.
 */
function isMockMode(): boolean {
  if (process.env.MESSAGING_PROVIDER === "mock") return true;
  const sid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (sid && sid.startsWith("mock_")) return true;
  return false;
}

/**
 * Send an SMS via Twilio Messaging Service.
 *
 * Configuration is read from env. If any of TWILIO_ACCOUNT_SID,
 * TWILIO_AUTH_TOKEN, or TWILIO_MESSAGING_SERVICE_SID is missing, we return a
 * graceful `{ accepted: false, errorCode: 'PROVIDER_NOT_CONFIGURED' }` so the
 * outbox can mark the row failed without crashing the cron. This matches
 * the Phase 5a contract — Phase 5b/operations can flip provider credentials
 * on later without code changes.
 *
 * When mock mode is active (see `isMockMode`), the message is recorded in
 * the `mock_sent_sms` table and logged to console — no Twilio call is made.
 */
export async function sendSms({
  to,
  body,
  idempotencyKey,
}: SendSmsInput): Promise<SendResult> {
  if (isMockMode()) {
    return sendMockSms({ to, body, idempotencyKey });
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

  if (!accountSid || !authToken || !messagingServiceSid) {
    return {
      accepted: false,
      errorCode: "PROVIDER_NOT_CONFIGURED",
      errorMessage: "Twilio not configured (missing account SID / token / messaging service SID)",
    };
  }

  // Lazy import so the SDK doesn't load when credentials are absent.
  const twilioMod = (await import("twilio")).default;
  const client = twilioMod(accountSid, authToken);

  try {
    // Twilio's helper SDK doesn't expose a request-options arg for the
    // `Idempotency-Key` HTTP header; outbox-level dedupe (via the unique
    // idempotency_key column) provides our safety net. The `idempotencyKey`
    // parameter is kept on the signature so it can be threaded through to a
    // raw HTTP client if/when we replace the SDK.
    void idempotencyKey;
    const msg = await client.messages.create({
      to,
      body,
      messagingServiceSid,
    });
    return {
      accepted: true,
      providerMessageId: msg.sid,
    };
  } catch (err) {
    const e = err as { code?: string | number; status?: number; message?: string };
    return {
      accepted: false,
      errorCode: e.code ? String(e.code) : "TWILIO_ERROR",
      errorMessage: e.message ?? "Unknown Twilio error",
    };
  }
}

// ─── Mock provider ────────────────────────────────────────────────────────

async function sendMockSms({
  to,
  body,
  idempotencyKey,
}: SendSmsInput): Promise<SendResult> {
  void idempotencyKey;
  const providerMessageId =
    "mock_" + Date.now().toString(36) + "_" + randomBytes(3).toString("hex");

  // Best-effort log + persist. Failures should not stop the outbox from
  // marking the row as sent — the row in `message_outbox` already captures
  // the outgoing payload.
  try {
    const { createAdminClient } = await import("@/lib/db/supabase-admin");
    const admin = createAdminClient();
    const { error } = await admin.from("mock_sent_sms").insert({
      to_value: to,
      body,
      provider_message_id: providerMessageId,
    });
    if (error) {
      console.warn("[mock-sms] insert failed:", error.message);
    }
  } catch (err) {
    console.warn(
      "[mock-sms] could not write to mock_sent_sms:",
      (err as Error).message,
    );
  }

  console.log(
    `[mock-sms] to=${to} body="${body.replace(/\n/g, "\\n")}" id=${providerMessageId}`,
  );

  return { accepted: true, providerMessageId };
}
