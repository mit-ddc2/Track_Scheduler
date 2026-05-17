import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
}));

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const STAFF_ID = "22222222-2222-4222-8222-222222222222";

const trace: string[] = [];

const requireOwnerMock = vi.fn(async () => ({
  user: { id: "u1" },
  profile: { id: "u1", is_owner: true, display_name: "Owner" },
}));

vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: () => requireOwnerMock(),
}));

vi.mock("@/lib/db/audit", () => ({
  writeAudit: vi.fn(async () => {
    trace.push("audit");
  }),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createClient: vi.fn(async () => {
    function fromBuilder(table: string) {
      trace.push(`from:${table}`);
      const builder: Record<string, unknown> = {
        upsert(rows: unknown) {
          const count = Array.isArray(rows) ? rows.length : 1;
          trace.push(`upsert:${table}:${count}`);
          return Promise.resolve({ data: null, error: null });
        },
        update() {
          trace.push(`update:${table}`);
          return {
            eq: async () => ({ data: null, error: null }),
          };
        },
        select() {
          trace.push(`select:${table}`);
          const single = {
            maybeSingle: async () => {
              if (table === "events") {
                return {
                  data: {
                    id: EVENT_ID,
                    title: "Test Event",
                    status: "scheduled",
                    starts_at: "2026-06-01T13:00:00Z",
                    ends_at: "2026-06-01T21:00:00Z",
                    completed_at: null,
                  },
                  error: null,
                };
              }
              if (table === "event_assignments") {
                return {
                  data: { id: "assignment-1" },
                  error: null,
                };
              }
              if (table === "attendance_records") {
                return { data: null, error: null };
              }
              return { data: null, error: null };
            },
          };
          return {
            eq: () => ({
              eq: () => single,
              in: async () => ({
                data: [
                  { id: "assignment-1", staff_member_id: STAFF_ID },
                ],
                error: null,
              }),
              maybeSingle: single.maybeSingle,
            }),
            in: async () => ({
              data: [{ id: "assignment-1", staff_member_id: STAFF_ID }],
              error: null,
            }),
          };
        },
      };
      return builder;
    }
    return {
      from: (table: string) => fromBuilder(table),
    };
  }),
}));

afterEach(() => {
  vi.clearAllMocks();
  trace.length = 0;
});

describe("setAttendanceStatus", () => {
  it("requires an owner before running", async () => {
    requireOwnerMock.mockImplementationOnce(() => {
      throw new Error("__REDIRECT__:/login");
    });
    const { setAttendanceStatus } = await import("./actions");
    await expect(
      setAttendanceStatus({
        eventId: EVENT_ID,
        staffMemberId: STAFF_ID,
        status: "worked",
      }),
    ).rejects.toThrowError("__REDIRECT__:/login");
  });

  it("rejects an invalid status via Zod", async () => {
    const { setAttendanceStatus } = await import("./actions");
    const result = await setAttendanceStatus({
      eventId: EVENT_ID,
      staffMemberId: STAFF_ID,
      status: "lunch" as unknown as "worked",
    });
    expect(result.error).toBeDefined();
    expect(trace).not.toContain("upsert:attendance_records:1");
  });

  it("rejects a non-UUID eventId", async () => {
    const { setAttendanceStatus } = await import("./actions");
    const result = await setAttendanceStatus({
      eventId: "not-a-uuid",
      staffMemberId: STAFF_ID,
      status: "worked",
    });
    expect(result.error).toBeDefined();
  });

  it("upserts attendance + audits on a valid input", async () => {
    const { setAttendanceStatus } = await import("./actions");
    const result = await setAttendanceStatus({
      eventId: EVENT_ID,
      staffMemberId: STAFF_ID,
      status: "worked",
    });
    expect(result.ok).toBe(true);
    expect(trace).toContain("upsert:attendance_records:1");
    expect(trace).toContain("audit");
  });
});

describe("updateAttendanceDetails", () => {
  it("requires an owner before running", async () => {
    requireOwnerMock.mockImplementationOnce(() => {
      throw new Error("__REDIRECT__:/login");
    });
    const { updateAttendanceDetails } = await import("./actions");
    await expect(
      updateAttendanceDetails({
        eventId: EVENT_ID,
        staffMemberId: STAFF_ID,
      }),
    ).rejects.toThrowError("__REDIRECT__:/login");
  });

  it("rejects hours over 24", async () => {
    const { updateAttendanceDetails } = await import("./actions");
    const result = await updateAttendanceDetails({
      eventId: EVENT_ID,
      staffMemberId: STAFF_ID,
      actual_hours: 99,
    });
    expect(result.error).toMatch(/hours/i);
  });

  it("rejects negative pay rate", async () => {
    const { updateAttendanceDetails } = await import("./actions");
    const result = await updateAttendanceDetails({
      eventId: EVENT_ID,
      staffMemberId: STAFF_ID,
      pay_rate: -1,
    });
    expect(result.error).toMatch(/pay rate/i);
  });

  it("upserts + audits on a valid patch", async () => {
    const { updateAttendanceDetails } = await import("./actions");
    const result = await updateAttendanceDetails({
      eventId: EVENT_ID,
      staffMemberId: STAFF_ID,
      actual_hours: 7.5,
      pay_rate: 22,
      notes: "Stayed for cleanup",
    });
    expect(result.ok).toBe(true);
    expect(trace).toContain("upsert:attendance_records:1");
    expect(trace).toContain("audit");
  });
});

describe("markAllWorked", () => {
  it("requires an owner before running", async () => {
    requireOwnerMock.mockImplementationOnce(() => {
      throw new Error("__REDIRECT__:/login");
    });
    const { markAllWorked } = await import("./actions");
    await expect(
      markAllWorked({ eventId: EVENT_ID }),
    ).rejects.toThrowError("__REDIRECT__:/login");
  });

  it("rejects non-UUID event id", async () => {
    const { markAllWorked } = await import("./actions");
    const result = await markAllWorked({ eventId: "nope" });
    expect(result.error).toBeDefined();
  });

  it("performs a single batch upsert + a single audit row", async () => {
    const { markAllWorked } = await import("./actions");
    const result = await markAllWorked({ eventId: EVENT_ID });
    expect(result.ok).toBe(true);
    expect(result.count).toBe(1);
    // A single batched upsert (length=1 in the mock).
    expect(trace.filter((t) => t.startsWith("upsert:attendance_records"))).toHaveLength(1);
    expect(trace.filter((t) => t === "audit")).toHaveLength(1);
  });
});

describe("lockEvent + completeEvent", () => {
  it("lockEvent requires an owner", async () => {
    requireOwnerMock.mockImplementationOnce(() => {
      throw new Error("__REDIRECT__:/login");
    });
    const { lockEvent } = await import("./actions");
    await expect(
      lockEvent({ eventId: EVENT_ID }),
    ).rejects.toThrowError("__REDIRECT__:/login");
  });

  it("completeEvent requires an owner", async () => {
    requireOwnerMock.mockImplementationOnce(() => {
      throw new Error("__REDIRECT__:/login");
    });
    const { completeEvent } = await import("./actions");
    await expect(
      completeEvent({ eventId: EVENT_ID }),
    ).rejects.toThrowError("__REDIRECT__:/login");
  });

  it("lockEvent updates events + writes audit", async () => {
    const { lockEvent } = await import("./actions");
    const result = await lockEvent({ eventId: EVENT_ID });
    expect(result.ok).toBe(true);
    expect(trace).toContain("update:events");
    expect(trace).toContain("audit");
  });

  it("completeEvent updates events + writes audit", async () => {
    const { completeEvent } = await import("./actions");
    const result = await completeEvent({ eventId: EVENT_ID });
    expect(result.ok).toBe(true);
    expect(trace).toContain("update:events");
    expect(trace).toContain("audit");
  });

  it("lockEvent + completeEvent both reject bad uuids", async () => {
    const { lockEvent, completeEvent } = await import("./actions");
    const a = await lockEvent({ eventId: "nope" });
    const b = await completeEvent({ eventId: "nope" });
    expect(a.error).toBeDefined();
    expect(b.error).toBeDefined();
  });
});
