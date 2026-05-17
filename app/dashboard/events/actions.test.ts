import { afterEach, describe, expect, it, vi } from "vitest";

// `next/cache` is server-only in Next; vitest doesn't ship it.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
}));

// In-memory rows that the supabase mock can read/return.
const mockEventRow = {
  id: "ev-1",
  title: "Existing",
  description: null,
  event_type: null,
  starts_at: "2026-06-01T13:00:00Z",
  ends_at: "2026-06-01T21:00:00Z",
  timezone: "America/Toronto",
  location: null,
  required_headcount: 4,
  overbooking_policy: "allow_all",
  manager_notes: null,
  status: "scheduled" as const,
};

// Track every operation so tests can assert order + count.
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
  createClient: vi.fn(async () => ({
    from: (table: string) => {
      trace.push(`from:${table}`);
      const builder = {
        insert() {
          trace.push(`insert:${table}`);
          return {
            select() {
              return {
                single: async () => ({
                  data: { id: "new-event-id" },
                  error: null,
                }),
              };
            },
          };
        },
        update() {
          trace.push(`update:${table}`);
          return {
            eq: async () => ({ error: null }),
          };
        },
        delete() {
          trace.push(`delete:${table}`);
          return {
            eq: async () => ({ error: null }),
          };
        },
        select() {
          trace.push(`select:${table}`);
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: mockEventRow,
                  error: null,
                }),
              };
            },
          };
        },
      };
      return builder;
    },
  })),
}));

afterEach(() => {
  vi.clearAllMocks();
  trace.length = 0;
});

describe("createManualEvent", () => {
  it("requires an owner before running", async () => {
    requireOwnerMock.mockImplementationOnce(() => {
      throw new Error("__REDIRECT__:/login");
    });
    const { createManualEvent } = await import("./actions");
    await expect(
      createManualEvent({
        title: "Test",
        description: undefined,
        event_type: undefined,
        starts_at: "2026-06-01T13:00:00Z",
        ends_at: "2026-06-01T21:00:00Z",
        timezone: "America/Toronto",
        location: undefined,
        required_headcount: 1,
        overbooking_policy: "allow_all",
        manager_notes: undefined,
      }),
    ).rejects.toThrowError("__REDIRECT__:/login");
    expect(requireOwnerMock).toHaveBeenCalledTimes(1);
  });

  it("rejects payloads that fail Zod (end before start)", async () => {
    const { createManualEvent } = await import("./actions");
    const result = await createManualEvent({
      title: "Test",
      description: undefined,
      event_type: undefined,
      starts_at: "2026-06-01T21:00:00Z",
      ends_at: "2026-06-01T13:00:00Z",
      timezone: "America/Toronto",
      location: undefined,
      required_headcount: 1,
      overbooking_policy: "allow_all",
      manager_notes: undefined,
    });
    expect(result.error).toMatch(/end must be after start/i);
    // Should never have hit the DB.
    expect(trace).not.toContain("insert:events");
  });

  it("inserts + audits a valid event and returns its id", async () => {
    const { createManualEvent } = await import("./actions");
    const result = await createManualEvent({
      title: "Test",
      description: undefined,
      event_type: undefined,
      starts_at: "2026-06-01T13:00:00Z",
      ends_at: "2026-06-01T21:00:00Z",
      timezone: "America/Toronto",
      location: undefined,
      required_headcount: 4,
      overbooking_policy: "allow_all",
      manager_notes: undefined,
    });
    expect(result.id).toBe("new-event-id");
    // Owner check happened, then the insert, then an audit entry.
    expect(requireOwnerMock).toHaveBeenCalledTimes(1);
    expect(trace).toContain("insert:events");
    expect(trace).toContain("audit");
    const insertIdx = trace.indexOf("insert:events");
    const auditIdx = trace.indexOf("audit");
    expect(insertIdx).toBeLessThan(auditIdx);
  });
});

describe("cancelEvent", () => {
  it("requires an owner before running", async () => {
    requireOwnerMock.mockImplementationOnce(() => {
      throw new Error("__REDIRECT__:/login");
    });
    const { cancelEvent } = await import("./actions");
    await expect(
      cancelEvent("ev-1", { reason: "Snow" }),
    ).rejects.toThrowError("__REDIRECT__:/login");
  });

  it("rejects an empty reason", async () => {
    const { cancelEvent } = await import("./actions");
    const result = await cancelEvent("ev-1", { reason: "" });
    expect(result.error).toMatch(/reason/i);
  });
});

describe("setEventRequirements", () => {
  it("requires an owner before running", async () => {
    requireOwnerMock.mockImplementationOnce(() => {
      throw new Error("__REDIRECT__:/login");
    });
    const { setEventRequirements } = await import("./actions");
    await expect(
      setEventRequirements("ev-1", []),
    ).rejects.toThrowError("__REDIRECT__:/login");
  });

  it("rejects rows that fail Zod", async () => {
    const { setEventRequirements } = await import("./actions");
    const result = await setEventRequirements("ev-1", [
      { label: "", required_count: 1 },
    ]);
    expect(result.error).toMatch(/label/i);
  });
});
