// server-only — wraps Twilio.
if (typeof window !== "undefined") {
  throw new Error("lib/messaging/send-sms.ts is server-only");
}

import type { SendResult } from "./provider-types";

export type SendSmsInput = {
  to: string;
  body: string;
  idempotencyKey: string;
};

/**
 * Send an SMS via Twilio Messaging Service.
 *
 * Configuration is read from env. If any of TWILIO_ACCOUNT_SID,
 * TWILIO_AUTH_TOKEN, or TWILIO_MESSAGING_SERVICE_SID is missing, we return a
 * graceful `{ accepted: false, errorCode: 'PROVIDER_NOT_CONFIGURED' }` so the
 * outbox can mark the row failed without crashing the cron. This matches
 * the Phase 5a contract — Phase 5b/operations can flip provider credentials
 * on later without code changes.
 */
export async function sendSms({
  to,
  body,
  idempotencyKey,
}: SendSmsInput): Promise<SendResult> {
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
