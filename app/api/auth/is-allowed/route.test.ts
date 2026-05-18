import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Validates the login allowlist preflight route. Mocks the admin Supabase
 * client so each test controls what `owner_emails` returns; in particular
 * we exercise:
 *   - allowed=true for an email that lives in owner_emails
 *   - allowed=false for one that doesn't
 *   - fail-closed when the DB lookup throws or errors
 *   - 400 on malformed bodies (no email, bad shape)
 *   - 429 after the per-IP limit is hit
 */

const maybeSingleMock = vi.fn();
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));
const createAdminClientMock = vi.fn(() => ({ from: fromMock }));

vi.mock("@/lib/db/supabase-admin", () => ({
  createAdminClient: createAdminClientMock,
}));

beforeEach(async () => {
  maybeSingleMock.mockReset();
  eqMock.mockClear();
  selectMock.mockClear();
  fromMock.mockClear();
  createAdminClientMock.mockClear();
  const mod = await import("./route");
  mod.__resetRateLimitForTesting();
});

afterEach(() => {
  vi.clearAllMocks();
});

function makeRequest(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request("https://app.example.com/api/auth/is-allowed", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function post(body: unknown, headers: Record<string, string> = {}) {
  const { POST } = await import("./route");
  return POST(makeRequest(body, headers));
}

describe("POST /api/auth/is-allowed", () => {
  it("returns allowed=true when the email is in owner_emails", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { email: "mit@ddc2.com" },
      error: null,
    });
    const res = await post(
      { email: "mit@ddc2.com" },
      { "x-forwarded-for": "10.1.1.1" },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { allowed: boolean };
    expect(body).toEqual({ allowed: true });
    expect(fromMock).toHaveBeenCalledWith("owner_emails");
    expect(eqMock).toHaveBeenCalledWith("email", "mit@ddc2.com");
  });

  it("returns allowed=false for an email not in owner_emails", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const res = await post(
      { email: "stranger@example.com" },
      { "x-forwarded-for": "10.1.1.2" },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { allowed: boolean };
    expect(body).toEqual({ allowed: false });
  });

  it("lowercases + trims the email before lookup", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { email: "rhplus1@hotmail.com" },
      error: null,
    });
    const res = await post(
      { email: "  RHplus1@HOTMAIL.com  " },
      { "x-forwarded-for": "10.1.1.3" },
    );
    expect(res.status).toBe(200);
    expect(eqMock).toHaveBeenCalledWith("email", "rhplus1@hotmail.com");
  });

  it("fails closed (allowed=false) when the admin client throws", async () => {
    createAdminClientMock.mockImplementationOnce(() => {
      throw new Error("missing SUPABASE_SECRET_KEY");
    });
    const res = await post(
      { email: "mit@ddc2.com" },
      { "x-forwarded-for": "10.1.1.4" },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { allowed: boolean };
    expect(body).toEqual({ allowed: false });
  });

  it("fails closed (allowed=false) when the DB query returns an error", async () => {
    maybeSingleMock.mockResolvedValue({
      data: null,
      error: { message: "boom" },
    });
    const res = await post(
      { email: "mit@ddc2.com" },
      { "x-forwarded-for": "10.1.1.5" },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { allowed: boolean };
    expect(body).toEqual({ allowed: false });
  });

  it("returns 400 for a missing or malformed email field", async () => {
    const res1 = await post(
      { email: "" },
      { "x-forwarded-for": "10.1.1.6" },
    );
    expect(res1.status).toBe(400);

    const res2 = await post(
      { email: "not-an-email" },
      { "x-forwarded-for": "10.1.1.7" },
    );
    expect(res2.status).toBe(400);

    const res3 = await post({}, { "x-forwarded-for": "10.1.1.8" });
    expect(res3.status).toBe(400);
  });

  it("returns 400 on an unparseable body", async () => {
    const { POST } = await import("./route");
    const req = new Request("https://app.example.com/api/auth/is-allowed", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "10.1.1.9",
      },
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rate-limits to 10 calls per IP per minute", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const ip = "10.99.99.99";
    for (let i = 0; i < 10; i++) {
      const r = await post(
        { email: `user${i}@example.com` },
        { "x-forwarded-for": ip },
      );
      expect(r.status).toBe(200);
    }
    const overflow = await post(
      { email: "user10@example.com" },
      { "x-forwarded-for": ip },
    );
    expect(overflow.status).toBe(429);
    expect(overflow.headers.get("Retry-After")).toBe("60");
  });
});
