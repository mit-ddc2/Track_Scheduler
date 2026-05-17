import { beforeEach, describe, expect, it } from "vitest";

describe("lib/security/token", () => {
  beforeEach(() => {
    process.env.APP_SECRET_PEPPER = "unit-test-pepper-please-keep-secret";
  });

  it("generates a 32-byte URL-safe raw token", async () => {
    const { generateRsvpToken, RSVP_TOKEN_BYTES } = await import("./token");
    const { raw } = generateRsvpToken();
    // URL-safe base64 of 32 bytes is 43 characters (no padding).
    expect(raw.length).toBe(Math.ceil((RSVP_TOKEN_BYTES * 4) / 3));
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("produces a deterministic hash for the same raw token", async () => {
    const { hashRsvpToken } = await import("./token");
    const a = hashRsvpToken("hello-world");
    const b = hashRsvpToken("hello-world");
    expect(a).toBe(b);
    expect(a).toHaveLength(64); // sha256 hex
  });

  it("produces a different hash for different inputs", async () => {
    const { hashRsvpToken } = await import("./token");
    expect(hashRsvpToken("a")).not.toBe(hashRsvpToken("b"));
  });

  it("verifyRsvpToken returns true for matching raw+hash", async () => {
    const { generateRsvpToken, verifyRsvpToken } = await import("./token");
    const { raw, hash } = generateRsvpToken();
    expect(verifyRsvpToken(raw, hash)).toBe(true);
  });

  it("verifyRsvpToken returns false for a tampered raw token", async () => {
    const { generateRsvpToken, verifyRsvpToken } = await import("./token");
    const { raw, hash } = generateRsvpToken();
    const tampered = raw.slice(0, -1) + (raw.endsWith("A") ? "B" : "A");
    expect(verifyRsvpToken(tampered, hash)).toBe(false);
  });

  it("verifyRsvpToken returns false on length mismatch (constant-time)", async () => {
    const { verifyRsvpToken } = await import("./token");
    expect(verifyRsvpToken("anything", "short")).toBe(false);
  });

  it("throws if APP_SECRET_PEPPER is missing", async () => {
    delete process.env.APP_SECRET_PEPPER;
    // Re-import to pick up the new env (the function reads env at call time
    // so a fresh import isn't strictly needed, but it makes the failure
    // surface deterministic regardless of module-eval timing).
    const { hashRsvpToken } = await import("./token");
    expect(() => hashRsvpToken("x")).toThrow(/APP_SECRET_PEPPER/);
  });
});
