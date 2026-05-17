import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MockSupabase } from "./__mocks__/admin-client";

type AdminLike = ReturnType<typeof import("@/lib/db/supabase-admin").createAdminClient>;

let db: MockSupabase;
let mod: typeof import("./provider-webhooks");

beforeEach(async () => {
  db = new MockSupabase();
  mod = await import("./provider-webhooks");
  mod.__setAdminClientForTesting(db as unknown as AdminLike);
});

afterEach(() => {
  mod.__setAdminClientForTesting(null);
});

describe("processTwilioInbound", () => {
  it("on STOP, marks the contact opted_out and writes a consent_records row", async () => {
    db.seed("staff_contact_methods", [
      {
        id: "cm1",
        staff_member_id: "sm1",
        channel: "sms",
        value: "+14165550001",
        normalized_value: "+14165550001",
        is_primary: true,
        status: "valid",
        consent: "granted",
      },
    ]);

    const out = await mod.processTwilioInbound({
      MessageSid: "SMabc",
      From: "+14165550001",
      Body: "STOP",
    });
    expect(out.action).toBe("stop");
    expect(out.touched).toBe(1);
    expect(db.tables.staff_contact_methods[0].status).toBe("opted_out");
    expect(db.tables.staff_contact_methods[0].consent).toBe("withdrawn");
    expect(db.tables.staff_contact_methods[0].opted_out_at).toBeTruthy();
    expect(db.tables.consent_records).toHaveLength(1);
    expect(db.tables.consent_records[0].status).toBe("withdrawn");
  });

  it("on START, restores consent to granted", async () => {
    db.seed("staff_contact_methods", [
      {
        id: "cm1",
        staff_member_id: "sm1",
        channel: "sms",
        value: "+14165550001",
        normalized_value: "+14165550001",
        is_primary: true,
        status: "opted_out",
        consent: "withdrawn",
        opted_out_at: "2026-01-01T00:00:00Z",
      },
    ]);
    const out = await mod.processTwilioInbound({
      MessageSid: "SMabc",
      From: "+14165550001",
      Body: "START",
    });
    expect(out.action).toBe("start");
    expect(db.tables.staff_contact_methods[0].status).toBe("valid");
    expect(db.tables.staff_contact_methods[0].consent).toBe("granted");
    expect(db.tables.staff_contact_methods[0].opted_out_at).toBeNull();
  });

  it("on HELP, does not modify contact methods", async () => {
    db.seed("staff_contact_methods", [
      {
        id: "cm1",
        staff_member_id: "sm1",
        channel: "sms",
        value: "+14165550001",
        normalized_value: "+14165550001",
        is_primary: true,
        status: "valid",
        consent: "granted",
      },
    ]);
    const out = await mod.processTwilioInbound({
      MessageSid: "SMabc",
      From: "+14165550001",
      Body: "HELP",
    });
    expect(out.action).toBe("help");
    expect(db.tables.staff_contact_methods[0].status).toBe("valid");
  });
});

describe("processTwilioStatusCallback", () => {
  it("marks the matching outbox row sent on delivered", async () => {
    db.seed("message_outbox", [
      {
        id: "o1",
        channel: "sms",
        to_value: "+1",
        body_text: "x",
        provider: "twilio",
        provider_message_id: "SMxyz",
        idempotency_key: "k1",
        status: "sending",
        attempt_count: 1,
      },
    ]);
    const r = await mod.processTwilioStatusCallback({
      MessageSid: "SMxyz",
      MessageStatus: "delivered",
    });
    expect(r.updated).toBe(true);
    expect(db.tables.message_outbox[0].status).toBe("sent");
  });

  it("records a message_events row on duplicate delivery (idempotent insert)", async () => {
    db.seed("message_outbox", [
      {
        id: "o1",
        channel: "sms",
        to_value: "+1",
        body_text: "x",
        provider: "twilio",
        provider_message_id: "SMxyz",
        idempotency_key: "k1",
        status: "sending",
        attempt_count: 1,
      },
    ]);
    await mod.processTwilioStatusCallback({
      MessageSid: "SMxyz",
      MessageStatus: "delivered",
    });
    await mod.processTwilioStatusCallback({
      MessageSid: "SMxyz",
      MessageStatus: "delivered",
    });
    // Two callbacks → two event rows recorded; outbox stays 'sent'.
    expect(db.tables.message_events.length).toBe(2);
    expect(db.tables.message_outbox[0].status).toBe("sent");
  });
});

describe("processResendEvent", () => {
  it("marks contact as bounced on email.bounced", async () => {
    db.seed("staff_contact_methods", [
      {
        id: "cm1",
        staff_member_id: "sm1",
        channel: "email",
        value: "x@example.com",
        normalized_value: "x@example.com",
        is_primary: true,
        status: "valid",
        consent: "granted",
      },
    ]);
    db.seed("message_outbox", [
      {
        id: "o1",
        channel: "email",
        to_value: "x@example.com",
        body_text: "x",
        provider: "resend",
        provider_message_id: "em_1",
        idempotency_key: "k1",
        status: "sending",
        attempt_count: 1,
      },
    ]);

    const r = await mod.processResendEvent({
      type: "email.bounced",
      data: { email_id: "em_1", to: "x@example.com" },
    });
    expect(r.updated).toBe(true);
    expect(db.tables.message_outbox[0].status).toBe("failed");
    expect(db.tables.staff_contact_methods[0].status).toBe("bounced");
  });

  it("marks contact as suppressed on email.complained", async () => {
    db.seed("staff_contact_methods", [
      {
        id: "cm1",
        staff_member_id: "sm1",
        channel: "email",
        value: "x@example.com",
        normalized_value: "x@example.com",
        is_primary: true,
        status: "valid",
        consent: "granted",
      },
    ]);
    await mod.processResendEvent({
      type: "email.complained",
      data: { email_id: "em_2", to: "x@example.com" },
    });
    expect(db.tables.staff_contact_methods[0].status).toBe("suppressed");
  });
});
