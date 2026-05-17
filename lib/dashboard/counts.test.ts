import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Module-level mock state — re-imported per test so `vi.resetModules()` gives
// each case a clean slate. Matches the pattern in
// `lib/notifications/create-manager-notification.test.ts`.
const serverFromMock = vi.fn();

vi.mock("@/lib/db/supabase-server", () => ({
  createClient: vi.fn(async () => ({ from: serverFromMock })),
}));

beforeEach(() => {
  vi.resetModules();
  serverFromMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

type EventsRow = { id: string; status: string };

/**
 * Build a Supabase-chain mock that returns the supplied event rows for the
 * `events` table and the supplied count for the `event_invites` table.
 */
function wireMocks({
  eventRows,
  pendingCount = 0,
  eventsError,
  invitesError,
}: {
  eventRows: EventsRow[];
  pendingCount?: number;
  eventsError?: { message: string };
  invitesError?: { message: string };
}) {
  serverFromMock.mockImplementation((table: string) => {
    if (table === "events") {
      return {
        select: () => ({
          gte: () => ({
            lte: () => ({
              neq: () =>
                Promise.resolve({
                  data: eventsError ? null : eventRows,
                  error: eventsError ?? null,
                }),
            }),
          }),
        }),
      };
    }
    if (table === "event_invites") {
      return {
        select: () => ({
          in: () => ({
            in: () =>
              Promise.resolve({
                count: invitesError ? null : pendingCount,
                error: invitesError ?? null,
              }),
          }),
        }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
}

describe("getDashboardCounts", () => {
  it("counts upcoming events, underfilled ones, and pending invites", async () => {
    wireMocks({
      eventRows: [
        { id: "e1", status: "scheduled" },
        { id: "e2", status: "underfilled" },
        { id: "e3", status: "inviting" },
      ],
      pendingCount: 7,
    });
    const { getDashboardCounts } = await import("./counts");
    const counts = await getDashboardCounts();
    expect(counts).toEqual({
      eventsUpcoming: 3,
      eventsUnderfilled: 1,
      pendingResponders: 7,
    });
  });

  it("skips the invites query when there are no upcoming events", async () => {
    wireMocks({ eventRows: [], pendingCount: 99 });
    const { getDashboardCounts } = await import("./counts");
    const counts = await getDashboardCounts();
    expect(counts).toEqual({
      eventsUpcoming: 0,
      eventsUnderfilled: 0,
      pendingResponders: 0,
    });
    // event_invites should never be queried when the event list is empty.
    expect(serverFromMock).toHaveBeenCalledTimes(1);
    expect(serverFromMock).toHaveBeenCalledWith("events");
  });

  it("returns zeros and swallows the failure when the events query errors", async () => {
    wireMocks({
      eventRows: [],
      eventsError: { message: "boom" },
    });
    const { getDashboardCounts } = await import("./counts");
    const counts = await getDashboardCounts();
    expect(counts).toEqual({
      eventsUpcoming: 0,
      eventsUnderfilled: 0,
      pendingResponders: 0,
    });
  });

  it("returns zero pending invites (but keeps event counts) when the invites query errors", async () => {
    wireMocks({
      eventRows: [
        { id: "e1", status: "underfilled" },
        { id: "e2", status: "underfilled" },
      ],
      invitesError: { message: "rls dropped"} ,
    });
    const { getDashboardCounts } = await import("./counts");
    const counts = await getDashboardCounts();
    expect(counts).toEqual({
      eventsUpcoming: 2,
      eventsUnderfilled: 2,
      pendingResponders: 0,
    });
  });
});

describe("formatDashboardSubtitle", () => {
  it("uses singular when there's exactly one upcoming event", async () => {
    const { formatDashboardSubtitle } = await import("./counts");
    expect(
      formatDashboardSubtitle({
        eventsUpcoming: 1,
        eventsUnderfilled: 0,
        pendingResponders: 0,
      }),
    ).toBe("1 event · 0 underfilled · 0 pending");
  });

  it("uses plural when there's zero or multiple upcoming events", async () => {
    const { formatDashboardSubtitle } = await import("./counts");
    expect(
      formatDashboardSubtitle({
        eventsUpcoming: 3,
        eventsUnderfilled: 1,
        pendingResponders: 8,
      }),
    ).toBe("3 events · 1 underfilled · 8 pending");
    expect(
      formatDashboardSubtitle({
        eventsUpcoming: 0,
        eventsUnderfilled: 0,
        pendingResponders: 0,
      }),
    ).toBe("0 events · 0 underfilled · 0 pending");
  });
});
