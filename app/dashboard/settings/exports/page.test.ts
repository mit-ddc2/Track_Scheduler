import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
}));

const requireOwnerMock = vi.fn();
vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: requireOwnerMock,
}));

// supabase-server's createClient is called twice: once for the staff-count
// query, once for the recent-events query. Build a chainable mock that lets
// each call's last awaited result resolve with the value we queued.
const headSelectMock = vi.fn();
const eqMock = vi.fn();
const orderMock = vi.fn();
const limitMock = vi.fn();
const neqMock = vi.fn();
const gteMock = vi.fn();
const selectMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/db/supabase-server", () => ({
  createClient: vi.fn(async () => ({
    from: fromMock,
  })),
}));

const latestActionsMock = vi.fn();
vi.mock("@/lib/db/audit-queries", () => ({
  getLatestAuditTimestampForActions: latestActionsMock,
}));

beforeEach(() => {
  requireOwnerMock.mockReset();
  latestActionsMock.mockReset();
  fromMock.mockReset();

  // Build the chainable builder mock fresh per test.
  selectMock.mockReset();
  eqMock.mockReset();
  neqMock.mockReset();
  gteMock.mockReset();
  orderMock.mockReset();
  limitMock.mockReset();
  headSelectMock.mockReset();

  fromMock.mockImplementation((table: string) => {
    if (table === "staff_members") {
      // count: head + eq returns a promise resolving with { count }.
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn(() =>
          Promise.resolve({ count: 5, error: null }),
        ),
      };
      return builder;
    }
    if (table === "events") {
      const builder = {
        select: vi.fn(() => builder),
        gte: vi.fn(() => builder),
        neq: vi.fn(() => builder),
        order: vi.fn(() => builder),
        limit: vi.fn(() =>
          Promise.resolve({
            data: [
              {
                id: "ev1",
                title: "Race weekend",
                starts_at: "2026-04-01T12:00:00Z",
                ends_at: "2026-04-01T20:00:00Z",
                timezone: "America/Toronto",
                status: "completed",
                event_type: "race",
              },
            ],
            error: null,
          }),
        ),
      };
      return builder;
    }
    throw new Error(`unexpected table ${table}`);
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("exports settings page", () => {
  it("propagates redirect when caller is not an owner", async () => {
    requireOwnerMock.mockImplementationOnce(async () => {
      throw new Error("__REDIRECT__:/login");
    });
    const { default: ExportsPage } = await import("./page");
    await expect(ExportsPage()).rejects.toThrow("__REDIRECT__:/login");
  });

  it("renders successfully with active staff count + recent events", async () => {
    requireOwnerMock.mockResolvedValue({
      user: { id: "u1" },
      profile: { id: "u1", is_owner: true },
    });
    latestActionsMock.mockResolvedValue("2026-05-16T00:00:00Z");
    const { default: ExportsPage } = await import("./page");
    const out = await ExportsPage();
    expect(out).toBeTruthy();
    // One call for roster.export_csv/roster.export, one for payroll.export.
    expect(latestActionsMock).toHaveBeenCalledTimes(2);
  });

  it("falls back gracefully when no recent events exist", async () => {
    requireOwnerMock.mockResolvedValue({
      user: { id: "u1" },
      profile: { id: "u1", is_owner: true },
    });
    latestActionsMock.mockResolvedValue(null);
    // Reset the events branch to return zero rows.
    fromMock.mockImplementation((table: string) => {
      if (table === "staff_members") {
        const builder = {
          select: vi.fn(() => builder),
          eq: vi.fn(() => Promise.resolve({ count: 0, error: null })),
        };
        return builder;
      }
      if (table === "events") {
        const builder = {
          select: vi.fn(() => builder),
          gte: vi.fn(() => builder),
          neq: vi.fn(() => builder),
          order: vi.fn(() => builder),
          limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
        };
        return builder;
      }
      throw new Error(`unexpected table ${table}`);
    });
    const { default: ExportsPage } = await import("./page");
    const out = await ExportsPage();
    expect(out).toBeTruthy();
  });
});
