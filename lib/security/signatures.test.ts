import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  computeTwilioSignature,
  verifyCronSecret,
  verifyResendSignature,
  verifyTwilioSignature,
} from "./signatures";

describe("verifyTwilioSignature", () => {
  // Reference fixture taken from Twilio docs:
  //   https://www.twilio.com/docs/usage/security#validating-requests
  const authToken = "12345";
  const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
  const params = {
    CallSid: "CA1234567890ABCDE",
    Caller: "+14158675309",
    Digits: "1234",
    From: "+14158675309",
    To: "+18005551212",
  };
  // Computed using the same algorithm — sanity-check by recomputing here.
  const goodSignature = computeTwilioSignature({ url, params, authToken });

  it("validates a correctly-signed request", () => {
    expect(
      verifyTwilioSignature({
        signature: goodSignature,
        url,
        params,
        authToken,
      }),
    ).toBe(true);
  });

  it("rejects a tampered signature", () => {
    expect(
      verifyTwilioSignature({
        signature: "thisisnotvalid==",
        url,
        params,
        authToken,
      }),
    ).toBe(false);
  });

  it("rejects when the URL differs", () => {
    expect(
      verifyTwilioSignature({
        signature: goodSignature,
        url: url + "&extra=1",
        params,
        authToken,
      }),
    ).toBe(false);
  });

  it("rejects when a param value differs", () => {
    expect(
      verifyTwilioSignature({
        signature: goodSignature,
        url,
        params: { ...params, Digits: "9999" },
        authToken,
      }),
    ).toBe(false);
  });

  it("rejects empty / missing signatures", () => {
    expect(
      verifyTwilioSignature({
        signature: "",
        url,
        params,
        authToken,
      }),
    ).toBe(false);
    expect(
      verifyTwilioSignature({
        signature: null,
        url,
        params,
        authToken,
      }),
    ).toBe(false);
  });
});

describe("verifyResendSignature", () => {
  // Svix-style: key is base64 with optional "whsec_" prefix.
  const rawKeyBytes = Buffer.from("super-secret-key", "utf8");
  const secret = "whsec_" + rawKeyBytes.toString("base64");
  const svixId = "msg_2abc";
  const svixTimestamp = String(Math.floor(Date.now() / 1000));
  const payload = JSON.stringify({ type: "email.delivered", data: {} });
  const signedString = `${svixId}.${svixTimestamp}.${payload}`;
  const goodSig =
    "v1," +
    createHmac("sha256", rawKeyBytes).update(signedString).digest("base64");

  it("validates a correctly-signed event", () => {
    expect(
      verifyResendSignature({
        signature: goodSig,
        svixId,
        svixTimestamp,
        payload,
        secret,
      }),
    ).toBe(true);
  });

  it("rejects a wrong signature", () => {
    expect(
      verifyResendSignature({
        signature: "v1,not-a-real-sig",
        svixId,
        svixTimestamp,
        payload,
        secret,
      }),
    ).toBe(false);
  });

  it("rejects stale timestamps outside the tolerance", () => {
    const old = String(Math.floor(Date.now() / 1000) - 60 * 60);
    expect(
      verifyResendSignature({
        signature: goodSig,
        svixId,
        svixTimestamp: old,
        payload,
        secret,
      }),
    ).toBe(false);
  });

  it("rejects when any required header is missing", () => {
    expect(
      verifyResendSignature({
        signature: null,
        svixId,
        svixTimestamp,
        payload,
        secret,
      }),
    ).toBe(false);
  });
});

describe("verifyCronSecret", () => {
  const original = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = "abc-123-shhhhh";
  });
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it("accepts a matching bearer token", () => {
    expect(verifyCronSecret("Bearer abc-123-shhhhh")).toBe(true);
  });

  it("rejects a wrong token", () => {
    expect(verifyCronSecret("Bearer wrong-value")).toBe(false);
  });

  it("rejects empty / missing headers", () => {
    expect(verifyCronSecret(null)).toBe(false);
    expect(verifyCronSecret("")).toBe(false);
    expect(verifyCronSecret("Basic abc")).toBe(false);
  });

  it("rejects when CRON_SECRET is unset (fail-closed)", () => {
    delete process.env.CRON_SECRET;
    expect(verifyCronSecret("Bearer anything")).toBe(false);
  });
});
