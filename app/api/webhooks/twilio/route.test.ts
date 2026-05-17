import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NextRequest } from "next/server";

import { computeTwilioSignature } from "@/lib/security/signatures";

vi.mock("@/lib/messaging/provider-webhooks", () => ({
  processTwilioInbound: vi.fn(async () => ({ action: "stop", touched: 0 })),
  processTwilioStatusCallback: vi.fn(async () => ({
    updated: true,
    outboxId: "o1",
  })),
}));

const AUTH_TOKEN = "test-auth-token";
const URL = "https://app.example.com/api/webhooks/twilio";

beforeEach(() => {
  process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
});

afterEach(() => {
  vi.clearAllMocks();
});

function makeFormBody(params: Record<string, string>): {
  body: string;
  signature: string;
} {
  const body = new URLSearchParams(params).toString();
  const signature = computeTwilioSignature({
    url: URL,
    params,
    authToken: AUTH_TOKEN,
  });
  return { body, signature };
}

function makeRequest(body: string, headers: Record<string, string>) {
  return new NextRequest(URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body,
  });
}

describe("POST /api/webhooks/twilio", () => {
  it("returns 403 on missing signature", async () => {
    const { body } = makeFormBody({ MessageSid: "SM1", MessageStatus: "delivered" });
    const { POST } = await import("./route");
    const res = await POST(makeRequest(body, {}));
    expect(res.status).toBe(403);
  });

  it("returns 403 on a wrong signature", async () => {
    const { body } = makeFormBody({ MessageSid: "SM1", MessageStatus: "delivered" });
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest(body, { "x-twilio-signature": "nope" }),
    );
    expect(res.status).toBe(403);
  });

  it("accepts a valid status callback and returns 200", async () => {
    const { body, signature } = makeFormBody({
      MessageSid: "SM1",
      MessageStatus: "delivered",
    });
    const { POST } = await import("./route");
    const wh = await import("@/lib/messaging/provider-webhooks");
    const res = await POST(makeRequest(body, { "x-twilio-signature": signature }));
    expect(res.status).toBe(200);
    expect(wh.processTwilioStatusCallback).toHaveBeenCalledTimes(1);
  });

  it("routes inbound (Body present) to processTwilioInbound", async () => {
    const { body, signature } = makeFormBody({
      MessageSid: "SM2",
      From: "+14165550001",
      Body: "STOP",
    });
    const { POST } = await import("./route");
    const wh = await import("@/lib/messaging/provider-webhooks");
    const res = await POST(makeRequest(body, { "x-twilio-signature": signature }));
    expect(res.status).toBe(200);
    expect(wh.processTwilioInbound).toHaveBeenCalledTimes(1);
  });
});
