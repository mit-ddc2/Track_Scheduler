import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MockSupabase } from "./__mocks__/admin-client";
import type { SendResult } from "./provider-types";

// Cast helper: the outbox module accepts the real admin client type, but our
// in-memory mock implements only the surface we touch. The override is for
// unit tests only.
type AdminLike = ReturnType<typeof import("@/lib/db/supabase-admin").createAdminClient>;

let db: MockSupabase;
let mod: typeof import("./outbox");

beforeEach(async () => {
  db = new MockSupabase();
  mod = await import("./outbox");
  mod.__setAdminClientForTesting(db as unknown as AdminLike);
});

afterEach(() => {
  mod.__setAdminClientForTesting(null);
  mod.__setProvidersForTesting(null);
});

describe("enqueueOutboxMessage", () => {
  it("inserts a new outbox row on first call", async () => {
    const r = await mod.enqueueOutboxMessage({
      channel: "sms",
      toValue: "+14165551212",
      bodyText: "Hello",
      provider: "twilio",
      idempotencyKey: "event:1:staff:2:campaign:3:channel:sms:template:abc",
    });
    expect(r.deduped).toBe(false);
    expect(r.outboxId).toBeTruthy();
    expect(db.tables.message_outbox).toHaveLength(1);
    expect(db.tables.message_outbox[0].status).toBe("pending");
  });

  it("dedupes when the same idempotency_key is enqueued twice", async () => {
    const key = "event:1:staff:2:campaign:3:channel:sms:template:abc";
    const a = await mod.enqueueOutboxMessage({
      channel: "sms",
      toValue: "+14165551212",
      bodyText: "Hello",
      provider: "twilio",
      idempotencyKey: key,
    });
    const b = await mod.enqueueOutboxMessage({
      channel: "sms",
      toValue: "+14165551212",
      bodyText: "Hello",
      provider: "twilio",
      idempotencyKey: key,
    });
    expect(b.deduped).toBe(true);
    expect(b.outboxId).toBe(a.outboxId);
    expect(db.tables.message_outbox).toHaveLength(1);
  });
});

describe("drainOutbox", () => {
  it("marks rows sent on a successful provider response", async () => {
    db.seed("message_outbox", [
      {
        id: "row1",
        channel: "sms",
        to_value: "+14165550001",
        body_text: "hi",
        provider: "twilio",
        idempotency_key: "k1",
        status: "pending",
        attempt_count: 0,
        next_attempt_at: null,
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);
    const sms = vi.fn<(_: unknown) => Promise<SendResult>>(async () => ({
      accepted: true,
      providerMessageId: "SM123",
    }));
    mod.__setProvidersForTesting({
      sendSms: sms as never,
      sendEmail: vi.fn() as never,
    });

    const result = await mod.drainOutbox({ limit: 10 });
    expect(result).toMatchObject({ attempted: 1, sent: 1, failed: 0 });
    expect(sms).toHaveBeenCalledTimes(1);
    expect(db.tables.message_outbox[0].status).toBe("sent");
    expect(db.tables.message_outbox[0].provider_message_id).toBe("SM123");
  });

  it("schedules a retry after attempt 1 with ~2 minute delay", async () => {
    db.seed("message_outbox", [
      {
        id: "row1",
        channel: "sms",
        to_value: "+14165550001",
        body_text: "hi",
        provider: "twilio",
        idempotency_key: "k1",
        status: "pending",
        attempt_count: 0,
        next_attempt_at: null,
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);
    mod.__setProvidersForTesting({
      sendSms: (async () => ({
        accepted: false,
        errorCode: "TWILIO_500",
        errorMessage: "transient",
      })) as never,
      sendEmail: vi.fn() as never,
    });

    const fixedNow = new Date("2026-01-01T00:00:00Z");
    const r = await mod.drainOutbox({ limit: 10, now: fixedNow });
    expect(r).toMatchObject({ attempted: 1, sent: 0, failed: 0 });

    const row = db.tables.message_outbox[0];
    expect(row.status).toBe("pending");
    expect(row.attempt_count).toBe(1);
    expect(row.error_code).toBe("TWILIO_500");
    const next = new Date(row.next_attempt_at as string);
    const deltaMs = next.getTime() - fixedNow.getTime();
    expect(deltaMs).toBeGreaterThanOrEqual(2 * 60_000 - 5);
    expect(deltaMs).toBeLessThanOrEqual(2 * 60_000 + 5);
  });

  it("marks failed after MAX_ATTEMPTS consecutive failures", async () => {
    db.seed("message_outbox", [
      {
        id: "row1",
        channel: "email",
        to_value: "x@example.com",
        body_text: "hi",
        provider: "resend",
        idempotency_key: "k1",
        status: "pending",
        // already had 3 prior attempts → next failure should be terminal
        attempt_count: 3,
        next_attempt_at: null,
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);
    mod.__setProvidersForTesting({
      sendSms: vi.fn() as never,
      sendEmail: (async () => ({
        accepted: false,
        errorCode: "RESEND_BOUNCE",
        errorMessage: "permanent",
      })) as never,
    });

    const r = await mod.drainOutbox({ limit: 10 });
    expect(r).toMatchObject({ attempted: 1, sent: 0, failed: 1 });
    expect(db.tables.message_outbox[0].status).toBe("failed");
    expect(db.tables.message_outbox[0].attempt_count).toBe(4);
  });

  it("only one drainer sends when two run concurrently on the same row", async () => {
    db.seed("message_outbox", [
      {
        id: "row1",
        channel: "sms",
        to_value: "+14165550001",
        body_text: "hi",
        provider: "twilio",
        idempotency_key: "k1",
        status: "pending",
        attempt_count: 0,
        next_attempt_at: null,
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);
    const sms = vi.fn<(_: unknown) => Promise<SendResult>>(async () => ({
      accepted: true,
      providerMessageId: "SM999",
    }));
    mod.__setProvidersForTesting({
      sendSms: sms as never,
      sendEmail: vi.fn() as never,
    });

    // Two drains see the same pending row in their initial SELECT, then
    // race on the claim UPDATE. The second one's WHERE status='pending'
    // filter must fail (rowcount=0) and skip the row.
    const [a, b] = await Promise.all([
      mod.drainOutbox({ limit: 10 }),
      mod.drainOutbox({ limit: 10 }),
    ]);

    // Exactly one provider call total.
    expect(sms).toHaveBeenCalledTimes(1);
    // Sum of sent across both runs is 1; the other run sees 0 sent.
    expect(a.sent + b.sent).toBe(1);
    expect(db.tables.message_outbox[0].status).toBe("sent");
    expect(db.tables.message_outbox[0].provider_message_id).toBe("SM999");
  });

  describe("suppression (spec §14.3)", () => {
    function seedOutboxFor(opts: {
      staffMemberId?: string;
      campaignId?: string;
      channel?: "sms" | "email";
      toValue?: string;
    } = {}) {
      db.seed("message_outbox", [
        {
          id: "row_supp",
          staff_member_id: opts.staffMemberId ?? "sm1",
          campaign_id: opts.campaignId ?? null,
          channel: opts.channel ?? "sms",
          to_value: opts.toValue ?? "+14165550001",
          body_text: "hi",
          provider: "twilio",
          idempotency_key: "k_supp",
          status: "pending",
          attempt_count: 0,
          next_attempt_at: null,
          created_at: "2026-01-01T00:00:00Z",
        },
      ]);
    }

    function withNoProviderCalls() {
      const sms = vi.fn();
      const email = vi.fn();
      mod.__setProvidersForTesting({
        sendSms: sms as never,
        sendEmail: email as never,
      });
      return { sms, email };
    }

    it("skips when contact_status is opted_out", async () => {
      seedOutboxFor();
      db.seed("staff_contact_methods", [
        {
          staff_member_id: "sm1",
          channel: "sms",
          normalized_value: "+14165550001",
          value: "+14165550001",
          status: "opted_out",
          consent: "withdrawn",
          is_primary: true,
        },
      ]);
      const { sms } = withNoProviderCalls();
      const r = await mod.drainOutbox({ limit: 10 });
      expect(sms).not.toHaveBeenCalled();
      expect(r).toMatchObject({ attempted: 1, suppressed: 1, sent: 0 });
      const row = db.tables.message_outbox[0];
      expect(row.status).toBe("cancelled");
      expect(row.error_code).toBe("SUPPRESSED");
    });

    it("skips when contact_status is bounced", async () => {
      seedOutboxFor();
      db.seed("staff_contact_methods", [
        {
          staff_member_id: "sm1",
          channel: "sms",
          normalized_value: "+14165550001",
          value: "+14165550001",
          status: "bounced",
          consent: "granted",
          is_primary: true,
        },
      ]);
      const { sms } = withNoProviderCalls();
      const r = await mod.drainOutbox({ limit: 10 });
      expect(sms).not.toHaveBeenCalled();
      expect(r.suppressed).toBe(1);
    });

    it("skips when contact_status is suppressed", async () => {
      seedOutboxFor();
      db.seed("staff_contact_methods", [
        {
          staff_member_id: "sm1",
          channel: "sms",
          normalized_value: "+14165550001",
          value: "+14165550001",
          status: "suppressed",
          consent: "granted",
          is_primary: true,
        },
      ]);
      const { sms } = withNoProviderCalls();
      const r = await mod.drainOutbox({ limit: 10 });
      expect(sms).not.toHaveBeenCalled();
      expect(r.suppressed).toBe(1);
    });

    it("skips when contact_status is invalid", async () => {
      seedOutboxFor();
      db.seed("staff_contact_methods", [
        {
          staff_member_id: "sm1",
          channel: "sms",
          normalized_value: "+14165550001",
          value: "+14165550001",
          status: "invalid",
          consent: "granted",
          is_primary: true,
        },
      ]);
      const { sms } = withNoProviderCalls();
      const r = await mod.drainOutbox({ limit: 10 });
      expect(sms).not.toHaveBeenCalled();
      expect(r.suppressed).toBe(1);
    });

    it("skips when consent is withdrawn", async () => {
      seedOutboxFor();
      db.seed("staff_contact_methods", [
        {
          staff_member_id: "sm1",
          channel: "sms",
          normalized_value: "+14165550001",
          value: "+14165550001",
          status: "valid",
          consent: "withdrawn",
          is_primary: true,
        },
      ]);
      const { sms } = withNoProviderCalls();
      const r = await mod.drainOutbox({ limit: 10 });
      expect(sms).not.toHaveBeenCalled();
      expect(r.suppressed).toBe(1);
    });

    it("skips when consent is denied", async () => {
      seedOutboxFor();
      db.seed("staff_contact_methods", [
        {
          staff_member_id: "sm1",
          channel: "sms",
          normalized_value: "+14165550001",
          value: "+14165550001",
          status: "valid",
          consent: "denied",
          is_primary: true,
        },
      ]);
      const { sms } = withNoProviderCalls();
      const r = await mod.drainOutbox({ limit: 10 });
      expect(sms).not.toHaveBeenCalled();
      expect(r.suppressed).toBe(1);
    });

    it("skips when the event is cancelled (non-cancellation campaign)", async () => {
      seedOutboxFor({ campaignId: "camp1" });
      db.seed("staff_contact_methods", [
        {
          staff_member_id: "sm1",
          channel: "sms",
          normalized_value: "+14165550001",
          value: "+14165550001",
          status: "valid",
          consent: "granted",
          is_primary: true,
        },
      ]);
      db.seed("invitation_campaigns", [
        { id: "camp1", event_id: "evt1", campaign_type: "initial" },
      ]);
      db.seed("events", [{ id: "evt1", status: "cancelled" }]);
      const { sms } = withNoProviderCalls();
      const r = await mod.drainOutbox({ limit: 10 });
      expect(sms).not.toHaveBeenCalled();
      expect(r.suppressed).toBe(1);
      expect(db.tables.message_outbox[0].error_message).toBe("event_cancelled");
    });

    it("sends a cancellation_notice even when the event is cancelled", async () => {
      seedOutboxFor({ campaignId: "camp2" });
      db.seed("staff_contact_methods", [
        {
          staff_member_id: "sm1",
          channel: "sms",
          normalized_value: "+14165550001",
          value: "+14165550001",
          status: "valid",
          consent: "granted",
          is_primary: true,
        },
      ]);
      db.seed("invitation_campaigns", [
        {
          id: "camp2",
          event_id: "evt2",
          campaign_type: "cancellation_notice",
        },
      ]);
      db.seed("events", [{ id: "evt2", status: "cancelled" }]);
      const sms = vi.fn<(_: unknown) => Promise<SendResult>>(async () => ({
        accepted: true,
        providerMessageId: "SMcancel",
      }));
      mod.__setProvidersForTesting({
        sendSms: sms as never,
        sendEmail: vi.fn() as never,
      });
      const r = await mod.drainOutbox({ limit: 10 });
      expect(sms).toHaveBeenCalledTimes(1);
      expect(r.sent).toBe(1);
    });
  });

  describe("P-H1: batched suppression context", () => {
    it("issues a constant number of select queries per drain regardless of batch size", async () => {
      // Seed 25 pending rows across 25 staff members + 5 campaigns + 5
      // events. The legacy per-row checkSuppression would issue 1-3
      // selects PER ROW (25-75 selects across these tables); the batched
      // path issues at most 3 selects total (contact_methods / campaigns
      // / events), regardless of batch size.
      const N = 25;
      const rows = Array.from({ length: N }, (_, i) => ({
        id: `row${i}`,
        staff_member_id: `staff${i}`,
        campaign_id: `camp${i % 5}`,
        channel: "sms",
        to_value: `+1416555${String(i).padStart(4, "0")}`,
        body_text: "hi",
        provider: "twilio",
        idempotency_key: `k${i}`,
        status: "pending",
        attempt_count: 0,
        next_attempt_at: null,
        created_at: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z`,
      }));
      db.seed("message_outbox", rows);
      db.seed(
        "staff_contact_methods",
        Array.from({ length: N }, (_, i) => ({
          staff_member_id: `staff${i}`,
          channel: "sms",
          normalized_value: `+1416555${String(i).padStart(4, "0")}`,
          value: `+1416555${String(i).padStart(4, "0")}`,
          status: "valid",
          consent: "granted",
          is_primary: true,
        })),
      );
      db.seed(
        "invitation_campaigns",
        Array.from({ length: 5 }, (_, i) => ({
          id: `camp${i}`,
          event_id: `evt${i}`,
          campaign_type: "initial",
        })),
      );
      db.seed(
        "events",
        Array.from({ length: 5 }, (_, i) => ({
          id: `evt${i}`,
          status: "scheduled",
        })),
      );
      mod.__setProvidersForTesting({
        sendSms: (async () => ({
          accepted: true,
          providerMessageId: "SM1",
        })) as never,
        sendEmail: vi.fn() as never,
      });

      db.ops.length = 0;
      const result = await mod.drainOutbox({ limit: N });
      expect(result.attempted).toBe(N);
      expect(result.sent).toBe(N);

      // The drain itself issues exactly 1 SELECT on message_outbox to
      // pull the batch. The batched suppression context then issues at
      // most 1 SELECT on each of staff_contact_methods, invitation_
      // campaigns, and events (3 SELECTs). Total selects across the
      // entire drain: at most 4, independent of N.
      const selects = db.ops.filter((o) => o.kind === "select");
      const selectsByTable = selects.reduce<Record<string, number>>(
        (acc, o) => {
          acc[o.table] = (acc[o.table] ?? 0) + 1;
          return acc;
        },
        {},
      );
      expect(selectsByTable.message_outbox).toBe(1);
      expect(selectsByTable.staff_contact_methods).toBe(1);
      expect(selectsByTable.invitation_campaigns).toBe(1);
      expect(selectsByTable.events).toBe(1);
    });
  });

  it("ignores rows whose next_attempt_at is in the future", async () => {
    db.seed("message_outbox", [
      {
        id: "row1",
        channel: "sms",
        to_value: "+1",
        body_text: "x",
        provider: "twilio",
        idempotency_key: "k1",
        status: "pending",
        attempt_count: 1,
        next_attempt_at: "2099-01-01T00:00:00Z",
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);
    const sms = vi.fn();
    mod.__setProvidersForTesting({
      sendSms: sms as never,
      sendEmail: vi.fn() as never,
    });
    const r = await mod.drainOutbox({ limit: 10 });
    expect(r.attempted).toBe(0);
    expect(sms).not.toHaveBeenCalled();
  });
});
