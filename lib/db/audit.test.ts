import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The `audit_log` table uses `actor_user_id` (not `actor_id`). The original
 * code shipped a typo masked by an `as never` cast; this test exists to
 * prevent that regression — once SUPABASE_SECRET_KEY is set in Phase 5 the
 * insert would have thrown `column "actor_id" does not exist` on every call.
 */

type InsertPayload = Record<string, unknown>;
const inserts: { table: string; payload: InsertPayload }[] = [];

const insertMock = vi.fn((payload: InsertPayload) => {
  inserts[inserts.length - 1].payload = payload;
  return Promise.resolve({ error: null });
});

const fromMock = vi.fn((table: string) => {
  inserts.push({ table, payload: {} });
  return {
    insert: insertMock,
  };
});

vi.mock("./supabase-admin", () => ({
  createAdminClient: () => ({
    from: fromMock,
  }),
}));

beforeEach(() => {
  inserts.length = 0;
  insertMock.mockClear();
  fromMock.mockClear();
});

afterEach(() => {
  vi.resetModules();
});

describe("writeAudit", () => {
  it("writes to the audit_log table using actor_user_id, not actor_id", async () => {
    const { writeAudit } = await import("./audit");
    await writeAudit({
      action: "event.create",
      entity_type: "event",
      entity_id: "ev-1",
      summary: "Created event",
      after: { foo: "bar" },
      actorId: "user-1",
    });

    expect(fromMock).toHaveBeenCalledWith("audit_log");
    expect(insertMock).toHaveBeenCalledTimes(1);
    const payload = inserts[0]?.payload ?? {};
    expect(payload).toHaveProperty("actor_user_id", "user-1");
    expect(payload).not.toHaveProperty("actor_id");
    expect(payload).toMatchObject({
      action: "event.create",
      entity_type: "event",
      entity_id: "ev-1",
      summary: "Created event",
      actor_type: "owner",
    });
  });

  it("defaults actor_type to owner and actor_user_id to null when omitted", async () => {
    const { writeAudit } = await import("./audit");
    await writeAudit({
      action: "event.update",
      entity_type: "event",
      entity_id: "ev-2",
      summary: "Updated event",
    });
    const payload = inserts[0]?.payload ?? {};
    expect(payload).toHaveProperty("actor_user_id", null);
    expect(payload).toHaveProperty("actor_type", "owner");
  });
});
