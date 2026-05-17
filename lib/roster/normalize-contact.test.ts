import { describe, expect, it } from "vitest";

import {
  contactDedupeKey,
  isValidEmail,
  normalizeEmail,
  normalizePhone,
} from "./normalize-contact";

describe("normalizePhone", () => {
  it("normalizes a plain Canadian number with country default", () => {
    const r = normalizePhone("613-555-0142");
    expect(r.e164).toBe("+16135550142");
    expect(r.valid).toBe(true);
  });

  it("normalizes a US number with country default CA (falls back to NANP)", () => {
    const r = normalizePhone("(415) 555-2671", "US");
    expect(r.e164).toBe("+14155552671");
    expect(r.valid).toBe(true);
  });

  it("accepts E.164 input verbatim regardless of country default", () => {
    const r = normalizePhone("+442071838750", "CA");
    expect(r.e164).toBe("+442071838750");
    expect(r.valid).toBe(true);
  });

  it("strips spaces, dashes, parens, dots", () => {
    const r = normalizePhone("(613) 555.0142");
    expect(r.e164).toBe("+16135550142");
    expect(r.valid).toBe(true);
  });

  it("handles leading 0 by treating as national-format invalid for CA", () => {
    const r = normalizePhone("0613-555-0142");
    // libphonenumber-js is forgiving but treats this as invalid for NANP
    expect(r.valid).toBe(false);
  });

  it("returns invalid for letters / junk", () => {
    const r = normalizePhone("not-a-phone");
    expect(r.valid).toBe(false);
    expect(r.e164).toBe("not-a-phone");
  });

  it("returns empty for empty input", () => {
    const r = normalizePhone("");
    expect(r).toEqual({ e164: "", formatted: "", valid: false });
  });

  it("returns empty for whitespace-only input", () => {
    const r = normalizePhone("   ");
    expect(r).toEqual({ e164: "", formatted: "", valid: false });
  });

  it("treats a 7-digit number as invalid for CA", () => {
    const r = normalizePhone("5550142");
    expect(r.valid).toBe(false);
  });

  it("returns invalid for excessively long digit strings", () => {
    const r = normalizePhone("1".repeat(40));
    expect(r.valid).toBe(false);
  });
});

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Foo.Bar@Example.COM  ")).toBe(
      "foo.bar@example.com",
    );
  });

  it("returns empty string for empty input", () => {
    expect(normalizeEmail("")).toBe("");
    expect(normalizeEmail("   ")).toBe("");
  });

  it("preserves plus-addressing", () => {
    expect(normalizeEmail("Robert+Track@gmail.com")).toBe(
      "robert+track@gmail.com",
    );
  });
});

describe("isValidEmail", () => {
  it("accepts simple emails", () => {
    expect(isValidEmail("robert@calabogie.com")).toBe(true);
  });

  it("rejects strings without an @", () => {
    expect(isValidEmail("robert.calabogie.com")).toBe(false);
  });

  it("rejects strings without a TLD", () => {
    expect(isValidEmail("robert@localhost")).toBe(false);
  });

  it("rejects empty / whitespace", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("   ")).toBe(false);
  });
});

describe("contactDedupeKey", () => {
  it("produces stable keys", () => {
    expect(contactDedupeKey("email", "robert@calabogie.com")).toBe(
      "email:robert@calabogie.com",
    );
    expect(contactDedupeKey("sms", "+16135550142")).toBe("sms:+16135550142");
  });

  it("is case-insensitive on the value side", () => {
    expect(contactDedupeKey("email", " ROBERT@calabogie.com ")).toBe(
      "email:robert@calabogie.com",
    );
  });
});
