import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MockSupabase } from "./__mocks__/admin-client";

// We mock the admin-client module so the mock-SMS path writes into our
// in-memory MockSupabase instead of attempting a real Supabase call.
const db = new MockSupabase();

vi.mock("@/lib/db/supabase-admin", () => ({
  createAdminClient: () => db,
}));

// Reset env between tests so mock-mode detection is deterministic.
const ORIGINAL_ENV: Record<string, string | undefined> = {
  MESSAGING_PROVIDER: process.env.MESSAGING_PROVIDER,
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_SERVICE_SID: process.env.TWILIO_MESSAGING_SERVICE_SID,
};

beforeEach(() => {
  db.tables = {};
  delete process.env.MESSAGING_PROVIDER;
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_MESSAGING_SERVICE_SID;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("sendSms — mock provider", () => {
  it("returns an accepted result with a mock provider_message_id when MESSAGING_PROVIDER=mock", async () => {
    process.env.MESSAGING_PROVIDER = "mock";
    const { sendSms } = await import("./send-sms");

    const result = await sendSms({
      to: "+14165550001",
      body: "Hello from the mock",
      idempotencyKey: "key-1",
    });

    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error("unreachable");
    expect(result.providerMessageId).toMatch(/^mock_[a-z0-9]+_[a-f0-9]{6}$/);
  });

  it("writes a row to mock_sent_sms when mock mode is active", async () => {
    process.env.TWILIO_MESSAGING_SERVICE_SID = "mock_sid_abc";
    const { sendSms } = await import("./send-sms");

    const result = await sendSms({
      to: "+14165550002",
      body: "Body here",
      idempotencyKey: "key-2",
    });
    expect(result.accepted).toBe(true);

    const rows = db.tables.mock_sent_sms ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      to_value: "+14165550002",
      body: "Body here",
    });
    if (!result.accepted) throw new Error("unreachable");
    expect(rows[0].provider_message_id).toBe(result.providerMessageId);
  });

  it("real Twilio path is unaffected by mock detection when env is non-mock", async () => {
    // No MESSAGING_PROVIDER, no `mock_` prefix → should fall through to the
    // Twilio code path. Without credentials it returns PROVIDER_NOT_CONFIGURED,
    // which is the precise gate we want to assert is still reachable.
    const { sendSms } = await import("./send-sms");

    const result = await sendSms({
      to: "+14165550003",
      body: "Hi",
      idempotencyKey: "key-3",
    });

    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error("unreachable");
    expect(result.errorCode).toBe("PROVIDER_NOT_CONFIGURED");
    // No mock row should have been written.
    expect(db.tables.mock_sent_sms ?? []).toHaveLength(0);
  });
});
