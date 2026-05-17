import { afterEach, describe, expect, it, vi } from "vitest";

// Mock next/navigation: `redirect()` throws a tagged error so test code can
// assert it was called, mirroring how Next.js bails out of server rendering.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
}));

// Mock the supabase server client used by getSession. Each test overrides
// what `auth.getUser()` and the profiles query return.
const getUserMock = vi.fn();
const maybeSingleMock = vi.fn();

vi.mock("@/lib/db/supabase-server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: maybeSingleMock,
        }),
      }),
    }),
  })),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("requireOwner", () => {
  it("redirects to /login when there is no session", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null } });
    const { requireOwner } = await import("./require-owner");

    await expect(requireOwner()).rejects.toThrowError(
      "__REDIRECT__:/login",
    );
  });

  it("redirects to /login when signed in but profile is missing", async () => {
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u1", email: "a@b.c" } },
    });
    maybeSingleMock.mockResolvedValueOnce({ data: null });
    const { requireOwner } = await import("./require-owner");

    await expect(requireOwner()).rejects.toThrowError(
      "__REDIRECT__:/login",
    );
  });

  it("redirects to /login when signed in but not flagged as owner", async () => {
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u1", email: "a@b.c" } },
    });
    maybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "u1",
        display_name: "Casual",
        email: "a@b.c",
        is_owner: false,
        is_active: true,
        phone_for_alerts: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    });
    const { requireOwner } = await import("./require-owner");

    await expect(requireOwner()).rejects.toThrowError(
      "__REDIRECT__:/login",
    );
  });

  it("returns the session when the caller is an active owner", async () => {
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u1", email: "owner@calabogie" } },
    });
    maybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "u1",
        display_name: "Owner",
        email: "owner@calabogie",
        is_owner: true,
        is_active: true,
        phone_for_alerts: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    });
    const { requireOwner } = await import("./require-owner");

    const session = await requireOwner();
    expect(session.profile.is_owner).toBe(true);
    expect(session.user.email).toBe("owner@calabogie");
  });
});
