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
