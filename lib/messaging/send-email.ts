// server-only — wraps Resend.
if (typeof window !== "undefined") {
  throw new Error("lib/messaging/send-email.ts is server-only");
}

import type { SendResult } from "./provider-types";

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
};

const FALLBACK_FROM = "Calabogie Safety <safety@example.invalid>";

let warnedAboutFallback = false;
function pickFromAddress(): string {
  const configured = process.env.RESEND_FROM_EMAIL;
  if (configured && configured.length > 0) return configured;
  if (!warnedAboutFallback) {
    console.warn(
      "[email] RESEND_FROM_EMAIL not set; using placeholder sender. Email delivery will fail until configured.",
    );
    warnedAboutFallback = true;
  }
  return FALLBACK_FROM;
}

/**
 * Send a transactional email via Resend. Same gating behavior as
 * `sendSms` — missing RESEND_API_KEY returns a graceful failure object
 * rather than throwing, so the cron can continue draining.
 */
export async function sendEmail({
  to,
  subject,
  html,
  text,
  idempotencyKey,
}: SendEmailInput): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return {
      accepted: false,
      errorCode: "PROVIDER_NOT_CONFIGURED",
      errorMessage: "Resend not configured (missing RESEND_API_KEY)",
    };
  }

  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);

  try {
    const { data, error } = await resend.emails.send(
      {
        from: pickFromAddress(),
        to,
        subject,
        html,
        text,
        headers: {
          "X-Entity-Ref-ID": idempotencyKey,
        },
      },
      { idempotencyKey },
    );
    if (error) {
      return {
        accepted: false,
        errorCode: error.name ?? "RESEND_ERROR",
        errorMessage: error.message ?? "Unknown Resend error",
      };
    }
    if (!data?.id) {
      return {
        accepted: false,
        errorCode: "RESEND_NO_ID",
        errorMessage: "Resend accepted but returned no message id",
      };
    }
    return {
      accepted: true,
      providerMessageId: data.id,
    };
  } catch (err) {
    const e = err as { name?: string; message?: string };
    return {
      accepted: false,
      errorCode: e.name ?? "RESEND_EXCEPTION",
      errorMessage: e.message ?? "Unknown Resend exception",
    };
  }
}
