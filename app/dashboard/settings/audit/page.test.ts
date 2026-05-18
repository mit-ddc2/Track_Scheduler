import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Validates the audit log viewer:
 *   1. Pages call requireOwner() so unauthorised callers are redirected.
 *   2. The happy-path render produces a React element tree without throwing
 *      and forwards filter params to listAuditLog().
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("__NOT_FOUND__");
  }),
}));

const requireOwnerMock = vi.fn();
vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: requireOwnerMock,
}));

const listAuditLogMock = vi.fn();
vi.mock("@/lib/db/audit-queries", () => ({
  listAuditLog: listAuditLogMock,
  // Stubbed out — exports page imports it but the audit page does not.
  getLatestAuditTimestampForActions: vi.fn(),
}));

beforeEach(() => {
  requireOwnerMock.mockReset();
  listAuditLogMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("audit settings page", () => {
  it("propagates the redirect thrown by requireOwner", async () => {
    requireOwnerMock.mockImplementationOnce(async () => {
      throw new Error("__REDIRECT__:/login");
    });
    const { default: AuditPage } = await import("./page");
    await expect(
      AuditPage({ searchParams: Promise.resolve({ advanced: "1" }) }),
    ).rejects.toThrow("__REDIRECT__:/login");
  });

  it("returns notFound() unless ?advanced=1 is supplied", async () => {
    requireOwnerMock.mockResolvedValue({
      user: { id: "u1" },
      profile: { id: "u1", is_owner: true },
    });
    const { default: AuditPage } = await import("./page");
    await expect(
      AuditPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("__NOT_FOUND__");
  });

  it("forwards filters from the URL to listAuditLog and renders rows", async () => {
    requireOwnerMock.mockResolvedValue({
      user: { id: "u1" },
      profile: { id: "u1", is_owner: true },
    });
    listAuditLogMock.mockResolvedValueOnce([
      {
        id: "e1",
        actor_user_id: "u1",
        actor_type: "owner",
        action: "staff.create",
        entity_type: "staff",
        entity_id: "s1",
        summary: "Created Joe",
        before: null,
        after: { name: "Joe" },
        request_id: null,
        created_at: "2026-05-17T10:00:00Z",
        actor: { id: "u1", display_name: "Owner", email: "o@x.com" },
      },
    ]);
    const { default: AuditPage } = await import("./page");
    const out = await AuditPage({
      searchParams: Promise.resolve({
        action: "staff",
        range: "7d",
        advanced: "1",
      }),
    });
    expect(out).toBeTruthy();
    expect(listAuditLogMock).toHaveBeenCalledTimes(1);
    expect(listAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionPrefix: "staff",
        range: "7d",
        limit: 50,
        offset: 0,
      }),
    );
  });

  it("renders an empty state when there are no audit entries", async () => {
    requireOwnerMock.mockResolvedValue({
      user: { id: "u1" },
      profile: { id: "u1", is_owner: true },
    });
    listAuditLogMock.mockResolvedValueOnce([]);
    const { default: AuditPage } = await import("./page");
    const out = await AuditPage({
      searchParams: Promise.resolve({ advanced: "1" }),
    });
    expect(out).toBeTruthy();
    expect(listAuditLogMock).toHaveBeenCalledTimes(1);
  });
});
