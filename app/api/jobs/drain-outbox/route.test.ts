import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NextRequest } from "next/server";

vi.mock("@/lib/messaging/outbox", () => ({
  drainOutbox: vi.fn(async () => ({
    attempted: 3,
    sent: 2,
    failed: 1,
    suppressed: 0,
  })),
}));

beforeEach(async () => {
  process.env.CRON_SECRET = "unit-test-secret";
  // Reset module-scoped guards between tests.
  const mod = await import("./route");
  mod.__resetDrainGuardsForTesting();
});

afterEach(() => {
  vi.clearAllMocks();
});

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest("https://app.example.com/api/jobs/drain-outbox", {
    headers,
  });
}

describe("GET /api/jobs/drain-outbox", () => {
  it("returns 401 when CRON_SECRET is missing from env", async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import("./route");
    const res = await GET(makeRequest({ authorization: "Bearer anything" }));
    expect(res.status).toBe(401);
  });

  it("returns 401 when bearer token does not match", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest({ authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
  });

  it("returns 200 and calls drainOutbox with the configured limit", async () => {
    const outbox = await import("@/lib/messaging/outbox");
    const { GET } = await import("./route");
    const res = await GET(
      makeRequest({ authorization: "Bearer unit-test-secret" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, number>;
    expect(body).toMatchObject({ attempted: 3, sent: 2, failed: 1 });
    expect(outbox.drainOutbox).toHaveBeenCalledWith({ limit: 50 });
  });

  it("returns 500 (not 200) when drainOutbox throws", async () => {
    const outbox = await import("@/lib/messaging/outbox");
    vi.mocked(outbox.drainOutbox).mockRejectedValueOnce(
      new Error("boom"),
    );
    const { GET } = await import("./route");
    const res = await GET(
      makeRequest({ authorization: "Bearer unit-test-secret" }),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("drain_failed");
  });

  it("rate-limits to 30 calls per IP per minute", async () => {
    const { GET } = await import("./route");
    const headers = {
      authorization: "Bearer unit-test-secret",
      "x-forwarded-for": "198.51.100.7",
    };
    for (let i = 0; i < 30; i++) {
      const res = await GET(makeRequest(headers));
      expect(res.status).toBe(200);
    }
    const overflow = await GET(makeRequest(headers));
    expect(overflow.status).toBe(429);
    expect(overflow.headers.get("Retry-After")).toBe("60");
  });

  it("returns 423 Locked while a drain is already in progress", async () => {
    // Make the drain hang so we can issue a concurrent request.
    const outbox = await import("@/lib/messaging/outbox");
    let release!: (v: {
      attempted: number;
      sent: number;
      failed: number;
      suppressed: number;
    }) => void;
    vi.mocked(outbox.drainOutbox).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    const { GET } = await import("./route");
    const first = GET(
      makeRequest({
        authorization: "Bearer unit-test-secret",
        "x-forwarded-for": "1.1.1.1",
      }),
    );
    // Issue a second call while the first is in-flight (different IP so the
    // rate limiter is not the source of the response).
    const second = await GET(
      makeRequest({
        authorization: "Bearer unit-test-secret",
        "x-forwarded-for": "2.2.2.2",
      }),
    );
    expect(second.status).toBe(423);
    release({ attempted: 0, sent: 0, failed: 0, suppressed: 0 });
    const firstRes = await first;
    expect(firstRes.status).toBe(200);
  });
});
