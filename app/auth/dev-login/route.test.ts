import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NextRequest } from "next/server";

const listUsersMock = vi.fn<
  (...args: unknown[]) => Promise<{ data: { users: Array<{ email: string }> } }>
>(async () => ({ data: { users: [] } }));
const createUserMock = vi.fn(async () => ({ error: null }));
const generateLinkMock = vi.fn(async () => ({
  data: { properties: { hashed_token: "hashed-xyz" } },
  error: null,
}));
const verifyOtpMock = vi.fn(async () => ({ error: null }));
type AuditCall = {
  action: string;
  actorType: string;
  summary: string;
  entity_type: string;
  entity_id: string;
};
const writeAuditMock = vi.fn<(entry: AuditCall) => Promise<void>>(
  async () => {},
);

vi.mock("@/lib/db/supabase-admin", () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        listUsers: listUsersMock,
        createUser: createUserMock,
        generateLink: generateLinkMock,
      },
    },
  }),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createClient: async () => ({
    auth: { verifyOtp: verifyOtpMock },
  }),
}));

vi.mock("@/lib/db/audit", () => ({
  writeAudit: writeAuditMock,
}));

beforeEach(async () => {
  listUsersMock.mockClear();
  createUserMock.mockClear();
  generateLinkMock.mockClear();
  verifyOtpMock.mockClear();
  writeAuditMock.mockClear();
  process.env.CRON_SECRET = "unit-test-secret";
  process.env.DEV_LOGIN_ENABLED = "true";
  process.env.DEV_LOGIN_EMAIL = "owner@example.com";
  const { __resetRateLimitForTesting } = await import("./route");
  __resetRateLimitForTesting();
});

afterEach(() => {
  delete process.env.DEV_LOGIN_ENABLED;
  delete process.env.DEV_LOGIN_EMAIL;
});

function makeRequest(query = "", headers: Record<string, string> = {}) {
  return new NextRequest(
    "https://app.example.com/auth/dev-login" + (query ? `?${query}` : ""),
    { headers },
  );
}

describe("GET /auth/dev-login", () => {
  it("returns 404 unless DEV_LOGIN_ENABLED=true", async () => {
    delete process.env.DEV_LOGIN_ENABLED;
    const { GET } = await import("./route");
    const res = await GET(makeRequest(`key=unit-test-secret`));
    expect(res.status).toBe(404);
  });

  it("returns 500 when DEV_LOGIN_EMAIL is unset (no hardcoded fallback)", async () => {
    delete process.env.DEV_LOGIN_EMAIL;
    const { GET } = await import("./route");
    const res = await GET(makeRequest(`key=unit-test-secret`));
    expect(res.status).toBe(500);
  });

  it("returns 403 when the key does not match", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest(`key=wrong`));
    expect(res.status).toBe(403);
  });

  it("rate-limits to 5 attempts per IP per minute", async () => {
    const { GET } = await import("./route");
    const headers = { "x-forwarded-for": "203.0.113.5" };
    for (let i = 0; i < 5; i++) {
      const res = await GET(makeRequest(`key=wrong`, headers));
      // Forbidden is still a "used attempt" from the bucket's POV.
      expect([403, 429]).toContain(res.status);
    }
    const sixth = await GET(makeRequest(`key=wrong`, headers));
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get("Retry-After")).toBe("60");
  });

  it("redirects to /dashboard and writes an audit log on success", async () => {
    const { GET } = await import("./route");
    const res = await GET(
      makeRequest(`key=unit-test-secret`, { "x-forwarded-for": "1.2.3.4" }),
    );
    expect([302, 307]).toContain(res.status);
    expect(res.headers.get("location")).toContain("/dashboard");
    expect(writeAuditMock).toHaveBeenCalledTimes(1);
    const audit = writeAuditMock.mock.calls[0]?.[0];
    expect(audit).toBeDefined();
    expect(audit?.action).toBe("auth.dev_login");
    expect(audit?.actorType).toBe("owner");
    expect(audit?.summary).toContain("dev-login bypass used");
  });
});
