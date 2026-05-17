import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NextRequest } from "next/server";

import { sanitizeNext } from "./route";

const exchangeMock = vi.fn(async () => ({ error: null }));

vi.mock("@/lib/db/supabase-server", () => ({
  createClient: vi.fn(async () => ({
    auth: { exchangeCodeForSession: exchangeMock },
  })),
}));

beforeEach(() => {
  exchangeMock.mockReset();
  exchangeMock.mockImplementation(async () => ({ error: null }));
});

afterEach(() => {
  vi.clearAllMocks();
});

function makeRequest(url: string) {
  return new NextRequest(url);
}

describe("sanitizeNext", () => {
  it("returns / for missing / empty / non-leading-slash inputs", () => {
    expect(sanitizeNext(null)).toBe("/");
    expect(sanitizeNext(undefined)).toBe("/");
    expect(sanitizeNext("")).toBe("/");
    expect(sanitizeNext("dashboard")).toBe("/");
    expect(sanitizeNext("   ")).toBe("/");
  });

  it("accepts a valid same-origin path", () => {
    expect(sanitizeNext("/dashboard")).toBe("/dashboard");
    expect(sanitizeNext("/dashboard/events/123")).toBe("/dashboard/events/123");
  });

  it("rejects protocol-relative URLs", () => {
    expect(sanitizeNext("//attacker.tld")).toBe("/");
    expect(sanitizeNext("//evil.example/anything")).toBe("/");
  });

  it("rejects backslash-prefix variants", () => {
    expect(sanitizeNext("/\\attacker.tld")).toBe("/");
  });

  it("rejects absolute URLs with explicit schemes", () => {
    expect(sanitizeNext("https://attacker.tld")).toBe("/");
    expect(sanitizeNext("http://attacker.tld")).toBe("/");
    expect(sanitizeNext("HTTPS://attacker.tld")).toBe("/");
    expect(sanitizeNext("javascript:alert(1)")).toBe("/");
  });

  it("rejects anything containing :// even with a leading slash", () => {
    expect(sanitizeNext("/redirect?to=https://attacker.tld")).toBe("/");
  });
});

describe("GET /auth/callback", () => {
  it("redirects to /login?error=callback when code is missing", async () => {
    const { GET } = await import("./route");
    const res = await GET(
      makeRequest("https://app.example.com/auth/callback?next=/dashboard"),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://app.example.com/login?error=callback",
    );
  });

  it("redirects to the validated relative next on success", async () => {
    const { GET } = await import("./route");
    const res = await GET(
      makeRequest(
        "https://app.example.com/auth/callback?code=abc&next=/dashboard/events",
      ),
    );
    expect(exchangeMock).toHaveBeenCalledWith("abc");
    expect(res.headers.get("location")).toBe(
      "https://app.example.com/dashboard/events",
    );
  });

  it("collapses a protocol-relative next to /", async () => {
    const { GET } = await import("./route");
    const res = await GET(
      makeRequest(
        "https://app.example.com/auth/callback?code=abc&next=//attacker.tld",
      ),
    );
    expect(res.headers.get("location")).toBe("https://app.example.com/");
  });

  it("collapses an absolute https next to /", async () => {
    const { GET } = await import("./route");
    const res = await GET(
      makeRequest(
        `https://app.example.com/auth/callback?code=abc&next=${encodeURIComponent("https://attacker.tld/x")}`,
      ),
    );
    expect(res.headers.get("location")).toBe("https://app.example.com/");
  });

  it("defaults to / when next is missing", async () => {
    const { GET } = await import("./route");
    const res = await GET(
      makeRequest("https://app.example.com/auth/callback?code=abc"),
    );
    expect(res.headers.get("location")).toBe("https://app.example.com/");
  });

  it("redirects to /login?error=callback when exchange fails", async () => {
    exchangeMock.mockImplementationOnce(async () => ({
      error: { message: "bad code" } as unknown as null,
    }));
    const { GET } = await import("./route");
    const res = await GET(
      makeRequest(
        "https://app.example.com/auth/callback?code=bad&next=/dashboard",
      ),
    );
    expect(res.headers.get("location")).toBe(
      "https://app.example.com/login?error=callback",
    );
  });
});
