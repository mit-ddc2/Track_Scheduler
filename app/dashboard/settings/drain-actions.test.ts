import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireOwnerMock = vi.fn(async () => ({
  user: { id: "u1" },
  profile: { id: "u1", is_owner: true, display_name: "Owner" },
}));

vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: () => requireOwnerMock(),
}));

type FetchCall = { url: string; init?: RequestInit };
const fetchCalls: FetchCall[] = [];
let fetchImpl: (
  url: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response> = async () => new Response("{}", { status: 200 });

beforeEach(() => {
  vi.resetModules();
  fetchCalls.length = 0;
  // jsdom doesn't ship fetch by default in vitest; we install our own stub.
  globalThis.fetch = ((url: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    return fetchImpl(url, init);
  }) as typeof fetch;
  requireOwnerMock.mockClear();
  requireOwnerMock.mockImplementation(async () => ({
    user: { id: "u1" },
    profile: { id: "u1", is_owner: true, display_name: "Owner" },
  }));
});

afterEach(() => {
  delete (process.env as Record<string, string | undefined>).CRON_SECRET;
  delete (process.env as Record<string, string | undefined>).APP_BASE_URL;
});

describe("triggerDrainNow", () => {
  it("requires an owner before attempting any drain", async () => {
    process.env.CRON_SECRET = "shhh";
    requireOwnerMock.mockImplementationOnce(() => {
      throw new Error("__REDIRECT__:/login");
    });
    const { triggerDrainNow } = await import("./drain-actions");
    await expect(triggerDrainNow()).rejects.toThrowError("__REDIRECT__:/login");
    expect(fetchCalls).toHaveLength(0);
  });

  it("returns an error when CRON_SECRET is missing — never fires fetch", async () => {
    delete (process.env as Record<string, string | undefined>).CRON_SECRET;
    const { triggerDrainNow } = await import("./drain-actions");
    const res = await triggerDrainNow();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/CRON_SECRET/);
    }
    expect(fetchCalls).toHaveLength(0);
  });

  it("forwards the secret as a Bearer token and parses the drain summary", async () => {
    process.env.CRON_SECRET = "supersecret";
    process.env.APP_BASE_URL = "https://example.test";
    fetchImpl = async () =>
      new Response(
        JSON.stringify({
          attempted: 5,
          sent: 4,
          failed: 1,
          suppressed: 0,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const { triggerDrainNow } = await import("./drain-actions");
    const res = await triggerDrainNow();

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe(
      "https://example.test/api/jobs/drain-outbox",
    );
    const headers = fetchCalls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer supersecret");

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.attempted).toBe(5);
      expect(res.sent).toBe(4);
      expect(res.failed).toBe(1);
      expect(res.suppressed).toBe(0);
    }
  });

  it("surfaces non-2xx responses as an error", async () => {
    process.env.CRON_SECRET = "supersecret";
    fetchImpl = async () =>
      new Response(
        JSON.stringify({ error: "drain_failed", message: "boom" }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    const { triggerDrainNow } = await import("./drain-actions");
    const res = await triggerDrainNow();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("boom");
    }
  });
});
