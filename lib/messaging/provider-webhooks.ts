// server-only — processes parsed webhook payloads against the DB.
if (typeof window !== "undefined") {
  throw new Error("lib/messaging/provider-webhooks.ts is server-only");
}

import { parsePhoneNumberFromString } from "libphonenumber-js";

import { createAdminClient } from "@/lib/db/supabase-admin";
import type { OutboxStatus } from "@/lib/db/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type UntypedClient = { from: (table: string) => any };

// Test seam — loose admin shape so the in-memory mock satisfies it without
// having to mirror the full Supabase typed builder surface.
type AdminClient = UntypedClient;
let adminOverride: AdminClient | null = null;
export function __setAdminClientForTesting(client: AdminClient | null) {
  adminOverride = client;
}
function getAdmin(): AdminClient {
  return adminOverride ?? (createAdminClient() as unknown as AdminClient);
}

// ─── Helpers ────────────────────────────────────────────────────
function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = parsePhoneNumberFromString(raw, "CA");
    return parsed?.isValid() ? parsed.number : null; // E.164
  } catch {
    return null;
  }
}

// Map Twilio MessageStatus → our outbox_status.
function twilioStatusToOutbox(s: string | undefined): OutboxStatus | null {
  switch ((s ?? "").toLowerCase()) {
    case "delivered":
    case "sent":
      return "sent";
    case "failed":
    case "undelivered":
      return "failed";
    case "queued":
    case "accepted":
    case "sending":
    case "scheduled":
      return null; // no transition needed
    default:
      return null;
  }
}

// ─── Twilio status callback ────────────────────────────────────
export type TwilioStatusCallback = {
  MessageSid: string;
  MessageStatus?: string;
  SmsStatus?: string;
  ErrorCode?: string;
  ErrorMessage?: string;
  To?: string;
  From?: string;
};

export async function processTwilioStatusCallback(
  payload: TwilioStatusCallback,
): Promise<{ updated: boolean; outboxId: string | null }> {
  const admin = getAdmin();
  const status = payload.MessageStatus ?? payload.SmsStatus;
  const sid = payload.MessageSid;
  if (!sid) return { updated: false, outboxId: null };

  // Look up the outbox row by provider message id.
  const outbox = await admin
    .from("message_outbox")
    .select("id,status,attempt_count")
    .eq("provider", "twilio")
    .eq("provider_message_id", sid)
    .maybeSingle();
  if (outbox.error && outbox.error.code !== "PGRST116") {
    console.warn("[twilio-status] lookup error:", outbox.error.message);
  }
  const outboxId = outbox.data?.id ?? null;

  // Upsert message_events row. The unique index is on
  // (provider, provider_message_id, event_type); duplicate webhooks become
  // no-ops with ignoreDuplicates:true.
  await admin
    .from("message_events" as never)
    .upsert(
      {
        message_outbox_id: outboxId,
        provider: "twilio",
        provider_message_id: sid,
        event_type: `status.${(status ?? "unknown").toLowerCase()}`,
        payload: payload as unknown as Record<string, unknown>,
      } as never,
      {
        onConflict: "provider,provider_message_id,event_type",
        ignoreDuplicates: true,
      } as never,
    );

  // Update outbox status if it's a terminal transition.
  const mapped = twilioStatusToOutbox(status);
  let updated = false;
  if (outboxId && mapped) {
    const upd = await admin
      .from("message_outbox")
      .update({
        status: mapped,
        error_code: mapped === "failed" ? payload.ErrorCode ?? null : null,
        error_message:
          mapped === "failed" ? payload.ErrorMessage ?? null : null,
        sent_at: mapped === "sent" ? new Date().toISOString() : undefined,
      })
      .eq("id", outboxId);
    updated = !upd.error;
  }

  return { updated, outboxId };
}

// ─── Twilio inbound (STOP / START / HELP) ──────────────────────
export type TwilioInbound = {
  MessageSid: string;
  From: string; // E.164 phone
  To?: string;
  Body?: string;
};

const STOP_KEYWORDS = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
]);
const START_KEYWORDS = new Set(["START", "YES", "UNSTOP"]);
const HELP_KEYWORDS = new Set(["HELP", "INFO"]);

function classifyInbound(body: string | undefined): "stop" | "start" | "help" | "other" {
  const t = (body ?? "").trim().toUpperCase();
  if (!t) return "other";
  // Provider conventions: a single word in the message.
  const firstWord = t.split(/\s+/)[0];
  if (STOP_KEYWORDS.has(firstWord)) return "stop";
  if (START_KEYWORDS.has(firstWord)) return "start";
  if (HELP_KEYWORDS.has(firstWord)) return "help";
  return "other";
}

export async function processTwilioInbound(
  payload: TwilioInbound,
): Promise<{ action: "stop" | "start" | "help" | "other"; touched: number }> {
  const admin = getAdmin();
  const action = classifyInbound(payload.Body);

  // Always log the inbound to message_events for the audit trail.
  await admin
    .from("message_events" as never)
    .insert({
      message_outbox_id: null,
      provider: "twilio",
      provider_message_id: payload.MessageSid ?? null,
      event_type: `inbound.${action}`,
      payload: payload as unknown as Record<string, unknown>,
    } as never);

  if (action === "help" || action === "other") {
    return { action, touched: 0 };
  }

  const normalized = normalizePhone(payload.From);
  if (!normalized) return { action, touched: 0 };

  // Find any contact methods matching this phone.
  const found = await admin
    .from("staff_contact_methods")
    .select("id,staff_member_id")
    .eq("channel", "sms")
    .eq("normalized_value", normalized);
  if (found.error) {
    console.warn("[twilio-inbound] lookup error:", found.error.message);
    return { action, touched: 0 };
  }
  const matches = (found.data ?? []) as Array<{ id: string; staff_member_id: string }>;
  if (matches.length === 0) return { action, touched: 0 };

  const nowIso = new Date().toISOString();
  let touched = 0;
  for (const m of matches) {
    if (action === "stop") {
      const upd = await admin
        .from("staff_contact_methods")
        .update({
          status: "opted_out",
          consent: "withdrawn",
          opted_out_at: nowIso,
        })
        .eq("id", m.id);
      if (!upd.error) touched += 1;

      await admin
        .from("consent_records" as never)
        .insert({
          staff_member_id: m.staff_member_id,
          contact_method_id: m.id,
          channel: "sms",
          status: "withdrawn",
          source: "twilio_stop",
          captured_at: nowIso,
          evidence: { sid: payload.MessageSid, from: payload.From },
        } as never);
    } else if (action === "start") {
      const upd = await admin
        .from("staff_contact_methods")
        .update({
          status: "valid",
          consent: "granted",
          opted_out_at: null,
        })
        .eq("id", m.id);
      if (!upd.error) touched += 1;

      await admin
        .from("consent_records" as never)
        .insert({
          staff_member_id: m.staff_member_id,
          contact_method_id: m.id,
          channel: "sms",
          status: "granted",
          source: "twilio_start",
          captured_at: nowIso,
          evidence: { sid: payload.MessageSid, from: payload.From },
        } as never);
    }
  }
  return { action, touched };
}

// ─── Resend webhook ────────────────────────────────────────────
export type ResendEvent = {
  type: string; // e.g. "email.delivered" | "email.bounced" | "email.complained"
  data: {
    email_id?: string;
    to?: string | string[];
    [k: string]: unknown;
  };
  created_at?: string;
};

function resendTypeToOutboxStatus(t: string): OutboxStatus | null {
  switch (t) {
    case "email.delivered":
      return "sent";
    case "email.bounced":
    case "email.failed":
      return "failed";
    default:
      return null;
  }
}

function resendTypeToContactStatus(t: string):
  | "bounced"
  | "suppressed"
  | "valid"
  | null {
  switch (t) {
    case "email.bounced":
      return "bounced";
    case "email.complained":
      return "suppressed";
    case "email.delivered":
      return "valid";
    default:
      return null;
  }
}

function firstEmail(v: string | string[] | undefined): string | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

export async function processResendEvent(
  payload: ResendEvent,
): Promise<{ updated: boolean; outboxId: string | null }> {
  const admin = getAdmin();
  const emailId = payload.data?.email_id;
  let outboxId: string | null = null;

  if (emailId) {
    const outbox = await admin
      .from("message_outbox")
      .select("id")
      .eq("provider", "resend")
      .eq("provider_message_id", emailId)
      .maybeSingle();
    outboxId = outbox.data?.id ?? null;
  }

  await admin
    .from("message_events" as never)
    .upsert(
      {
        message_outbox_id: outboxId,
        provider: "resend",
        provider_message_id: emailId ?? null,
        event_type: payload.type,
        payload: payload as unknown as Record<string, unknown>,
      } as never,
      {
        onConflict: "provider,provider_message_id,event_type",
        ignoreDuplicates: true,
      } as never,
    );

  const mapped = resendTypeToOutboxStatus(payload.type);
  let updated = false;
  if (outboxId && mapped) {
    const upd = await admin
      .from("message_outbox")
      .update({
        status: mapped,
        sent_at: mapped === "sent" ? new Date().toISOString() : undefined,
        error_code:
          mapped === "failed"
            ? (payload.data?.error_code as string | undefined) ?? "bounced"
            : null,
        error_message:
          mapped === "failed"
            ? (payload.data?.message as string | undefined) ?? null
            : null,
      })
      .eq("id", outboxId);
    updated = !upd.error;
  }

  // Update contact status for bounces/complaints/delivered confirmations.
  const contactStatus = resendTypeToContactStatus(payload.type);
  const email = firstEmail(payload.data?.to as string | string[] | undefined);
  if (contactStatus && email) {
    await admin
      .from("staff_contact_methods")
      .update({
        status: contactStatus,
        last_delivery_status: payload.type,
        last_delivery_at: new Date().toISOString(),
      })
      .eq("channel", "email")
      .eq("normalized_value", email.toLowerCase());
  }

  return { updated, outboxId };
}
