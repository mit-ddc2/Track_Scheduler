import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NextRequest } from "next/server";

const requireOwnerMock = vi.fn();
vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: requireOwnerMock,
}));

const adminClientMock = vi.fn();
vi.mock("@/lib/db/supabase-admin", () => ({
  createAdminClient: adminClientMock,
}));

const resetSeedMock = vi.fn();
vi.mock("@/lib/dev/demo-seed", () => ({
  resetAndSeedDemoData: resetSeedMock,
}));

type AuditEntry = {
  action: string;
  actorType?: string;
  actorId?: string | null;
  summary: string;
  entity_type: string;
  entity_id: string;
  after?: unknown;
};
const writeAuditMock = vi.fn<(e: AuditEntry) => Promise<void>>(async () => {});
vi.mock("@/lib/db/audit", () => ({
  writeAudit: writeAuditMock,
}));

beforeEach(() => {
  requireOwnerMock.mockReset();
  adminClientMock.mockReset();
  resetSeedMock.mockReset();
  writeAuditMock.mockClear();
  process.env.CRON_SECRET = "unit-test-secret";
  process.env.DEV_RESET_DEMO_ENABLED = "true";

  // Default: owner is signed in.
  requireOwnerMock.mockResolvedValue({
    user: { id: "owner-uuid", email: "owner@example.com" },
    profile: { id: "owner-uuid", is_owner: true },
  });
  adminClientMock.mockReturnValue({}); // route doesn't use it directly
  resetSeedMock.mockResolvedValue({
    staff: 6,
    events: 3,
    contact_methods: 10,
    staff_roles: 6,
    staff_qualifications: 13,
    event_requirements: 8,
    event_invites: 11,
    event_assignments: 7,
  });
});

afterEach(() => {
  delete process.env.DEV_RESET_DEMO_ENABLED;
});

function makeRequest(query = "") {
  return new NextRequest(
    "https://app.example.com/api/admin/reset-demo" + (query ? `?${query}` : ""),
    { method: "POST" },
  );
}

describe("POST /api/admin/reset-demo", () => {
  it("returns 404 when DEV_RESET_DEMO_ENABLED is not 'true'", async () => {
    delete process.env.DEV_RESET_DEMO_ENABLED;
    const { POST } = await import("./route");
    const res = await POST(makeRequest("key=unit-test-secret"));
    expect(res.status).toBe(404);
    // Owner guard must not run when the env gate is closed.
    expect(requireOwnerMock).not.toHaveBeenCalled();
  });

  it("returns 500 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const { POST } = await import("./route");
    const res = await POST(makeRequest("key=anything"));
    expect(res.status).toBe(500);
    expect(resetSeedMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the key query param does not match", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest("key=wrong"));
    expect(res.status).toBe(403);
    expect(resetSeedMock).not.toHaveBeenCalled();
  });

  it("returns 403 when no key is provided at all", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
  });

  it("propagates requireOwner failure (non-owner blocked)", async () => {
    // requireOwner throws via next/navigation redirect — simulate.
    requireOwnerMock.mockImplementationOnce(async () => {
      throw new Error("__REDIRECT__:/login");
    });
    const { POST } = await import("./route");
    await expect(
      POST(makeRequest("key=unit-test-secret")),
    ).rejects.toThrow("__REDIRECT__:/login");
    expect(resetSeedMock).not.toHaveBeenCalled();
  });

  it("on success returns 200 with counts and writes audit log", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest("key=unit-test-secret"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      counts: { staff: number; events: number };
    };
    expect(body.ok).toBe(true);
    expect(body.counts.staff).toBe(6);
    expect(body.counts.events).toBe(3);
    expect(resetSeedMock).toHaveBeenCalledTimes(1);
    expect(writeAuditMock).toHaveBeenCalledTimes(1);
    const audit = writeAuditMock.mock.calls[0]?.[0];
    expect(audit?.action).toBe("demo.reset");
    expect(audit?.actorId).toBe("owner-uuid");
  });

  it("returns 500 with diagnostic message when seeding throws", async () => {
    resetSeedMock.mockRejectedValueOnce(new Error("seed exploded"));
    const { POST } = await import("./route");
    const res = await POST(makeRequest("key=unit-test-secret"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("reset_failed");
    expect(body.message).toContain("seed exploded");
    // No audit row when seeding fails — audit is for successful resets only.
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("rejects bad keys with constant-time comparison (length-mismatch path)", async () => {
    const { POST } = await import("./route");
    // Different length from the secret — exercises the length-mismatch
    // short-circuit in constantTimeEqual.
    const res = await POST(makeRequest("key=x"));
    expect(res.status).toBe(403);
  });
});
