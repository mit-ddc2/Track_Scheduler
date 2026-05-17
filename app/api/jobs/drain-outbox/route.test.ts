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

beforeEach(() => {
  process.env.CRON_SECRET = "unit-test-secret";
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
});
