import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const submitMock = vi.fn(
  async (): Promise<{ ok: boolean; state?: string; error?: string }> => ({
    ok: true,
    state: "accepted",
  }),
);

vi.mock("../rsvp-handler", () => ({
  submitRsvpResponseImpl: submitMock,
}));

beforeEach(async () => {
  submitMock.mockReset();
  submitMock.mockResolvedValue({ ok: true, state: "accepted" });
  const mod = await import("./route");
  mod.__resetRsvpRateLimitForTesting();
});

afterEach(() => {
  vi.clearAllMocks();
});

const TOKEN = "abcdefghij"; // >= 8 chars to pass zod validation

function makeRequest(
  body: Record<string, unknown> | null,
  headers: Record<string, string> = {},
) {
  const init: RequestInit = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  };
  if (body !== null) {
    init.body = JSON.stringify(body);
  }
  return new Request(`https://app.example.com/r/${TOKEN}/submit`, init);
}

async function post(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
  token = TOKEN,
) {
  const { POST } = await import("./route");
  return POST(makeRequest(body, headers), {
    params: Promise.resolve({ token }),
  });
}

describe("POST /r/[token]/submit", () => {
  it("returns 200 with the action result on success", async () => {
    const res = await post({ action: "accept" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, state: "accepted" });
  });

  it("returns 429 + Retry-After when per-token limit is exceeded", async () => {
    // 10 per token allowed; 11th should be limited.
    for (let i = 0; i < 10; i++) {
      const res = await post(
        { action: "accept" },
        { "x-forwarded-for": `10.0.0.${i + 1}` }, // unique IPs avoid IP bucket
      );
      expect(res.status).toBe(200);
    }
    const overflow = await post(
      { action: "accept" },
      { "x-forwarded-for": "10.0.0.99" },
    );
    expect(overflow.status).toBe(429);
    expect(overflow.headers.get("Retry-After")).toBe("60");
  });

  it("returns 429 when per-IP limit is exceeded across tokens", async () => {
    const ip = { "x-forwarded-for": "192.0.2.55" };
    for (let i = 0; i < 60; i++) {
      const token = `tok${String(i).padStart(8, "0")}`;
      const res = await post({ action: "accept" }, ip, token);
      expect(res.status).toBe(200);
    }
    const overflow = await post(
      { action: "accept" },
      ip,
      "another-unique-tok",
    );
    expect(overflow.status).toBe(429);
  });

  it("scrubs raw errors to a generic public message (M6)", async () => {
    submitMock.mockRejectedValueOnce(
      new Error('duplicate key value violates unique constraint "secret_table_pkey"'),
    );
    const res = await post(
      { action: "accept" },
      { "x-forwarded-for": "203.0.113.99" },
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe(
      "Could not process your response. Please try again.",
    );
    expect(JSON.stringify(body)).not.toContain("secret_table_pkey");
    expect(JSON.stringify(body)).not.toContain("duplicate key");
  });
});
