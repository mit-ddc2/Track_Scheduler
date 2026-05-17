import { describe, expect, it } from "vitest";

import {
  buildPayrollCsv,
  computeTotalPay,
  escapeCsvField,
  PAYROLL_CSV_HEADERS,
  type AttendanceWithStaffAndEvent,
} from "./export-csv";

function record(
  overrides: Partial<AttendanceWithStaffAndEvent> = {},
): AttendanceWithStaffAndEvent {
  return {
    event: {
      id: "ev-1",
      title: "Multimatic Test Day",
      starts_at: "2026-05-20T13:00:00Z",
      ends_at: "2026-05-20T21:00:00Z",
      timezone: "America/Toronto",
      ...overrides.event,
    },
    staff: {
      display_name: "Robert Lavoie",
      email: "robert@example.com",
      phone: "+16135551234",
      ...overrides.staff,
    },
    attendance: {
      status: "worked",
      scheduled_start: "2026-05-20T13:00:00Z",
      scheduled_end: "2026-05-20T21:00:00Z",
      actual_hours: 8,
      pay_rate: 24,
      notes: null,
      ...overrides.attendance,
    },
  };
}

describe("escapeCsvField", () => {
  it("escapes leading = (formula injection)", () => {
    expect(escapeCsvField("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
  });

  it("escapes leading + (formula injection)", () => {
    expect(escapeCsvField("+1234567890")).toBe("'+1234567890");
  });

  it("escapes leading - including negative-looking values", () => {
    expect(escapeCsvField("-cmd|calc")).toBe("'-cmd|calc");
    expect(escapeCsvField("-12.5")).toBe("'-12.5");
  });

  it("escapes leading @ (formula injection)", () => {
    // Comma in payload forces RFC 4180 quoting on top of the formula defang.
    expect(escapeCsvField("@SUM(1,2)")).toBe('"\'@SUM(1,2)"');
    // No comma → defanged but no quoting required.
    expect(escapeCsvField("@admin")).toBe("'@admin");
  });

  it("escapes leading tab/CR/LF (CR/LF additionally force quoting)", () => {
    // Tab gets defanged but RFC 4180 doesn't require quoting it.
    expect(escapeCsvField("\tfoo")).toBe("'\tfoo");
    // CR and LF require RFC 4180 quoting.
    expect(escapeCsvField("\rfoo")).toBe('"\'\rfoo"');
    expect(escapeCsvField("\nfoo")).toBe('"\'\nfoo"');
  });

  it("quotes values containing commas", () => {
    expect(escapeCsvField("Lavoie, Robert")).toBe('"Lavoie, Robert"');
  });

  it("doubles internal double quotes per RFC 4180", () => {
    expect(escapeCsvField('Said "hi" to crew')).toBe('"Said ""hi"" to crew"');
  });

  it("quotes values containing newlines", () => {
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
  });

  it("returns empty string for null/undefined", () => {
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(undefined)).toBe("");
  });
});

describe("computeTotalPay", () => {
  it("returns 0 when actual_hours is null", () => {
    expect(computeTotalPay(null, 24)).toBe(0);
  });
  it("returns 0 when pay_rate is null", () => {
    expect(computeTotalPay(8, null)).toBe(0);
  });
  it("multiplies hours by rate with 2-decimal precision", () => {
    expect(computeTotalPay(8, 24)).toBe(192);
    expect(computeTotalPay(7.5, 21.25)).toBe(159.38);
  });
});

describe("buildPayrollCsv", () => {
  it("emits the spec'd header row first", () => {
    const csv = buildPayrollCsv([]);
    expect(csv).toBe(PAYROLL_CSV_HEADERS.join(","));
  });

  it("encodes a standard row with comma-containing title quoted", () => {
    const csv = buildPayrollCsv([
      record({
        event: {
          id: "ev-1",
          title: "Spring Test, Group A",
          starts_at: "2026-05-20T13:00:00Z",
          ends_at: "2026-05-20T21:00:00Z",
          timezone: "America/Toronto",
        },
      }),
    ]);
    const [header, row] = csv.split("\r\n");
    expect(header).toBe(PAYROLL_CSV_HEADERS.join(","));
    expect(row).toContain('"Spring Test, Group A"');
    expect(row).toContain("2026-05-20");
    expect(row).toContain("Robert Lavoie");
    expect(row).toContain("worked");
    expect(row).toContain("8.00"); // scheduled hours
    expect(row).toContain("24.00"); // pay_rate
    expect(row).toContain("192.00"); // total_pay
  });

  it("escapes leading = inside an event title", () => {
    const csv = buildPayrollCsv([
      record({
        event: {
          id: "ev-2",
          title: "=cmd|calc",
          starts_at: "2026-05-20T13:00:00Z",
          ends_at: "2026-05-20T21:00:00Z",
          timezone: "America/Toronto",
        },
      }),
    ]);
    const row = csv.split("\r\n")[1] ?? "";
    expect(row).toContain("'=cmd|calc");
  });

  it("escapes leading + inside a phone number", () => {
    const csv = buildPayrollCsv([
      record({
        staff: {
          display_name: "Mit",
          email: "mit@example.com",
          phone: "+16135550100",
        },
      }),
    ]);
    const row = csv.split("\r\n")[1] ?? "";
    expect(row).toContain("'+16135550100");
  });

  it("escapes leading - in a name", () => {
    const csv = buildPayrollCsv([
      record({
        staff: { display_name: "-evil", email: null, phone: null },
      }),
    ]);
    const row = csv.split("\r\n")[1] ?? "";
    expect(row).toContain("'-evil");
  });

  it("escapes leading @ in a notes field", () => {
    const csv = buildPayrollCsv([
      record({
        attendance: {
          status: "worked",
          scheduled_start: "2026-05-20T13:00:00Z",
          scheduled_end: "2026-05-20T21:00:00Z",
          actual_hours: 8,
          pay_rate: 24,
          notes: "@admin look",
        },
      }),
    ]);
    const row = csv.split("\r\n")[1] ?? "";
    expect(row).toContain("'@admin look");
  });

  it("quotes notes containing newlines", () => {
    const csv = buildPayrollCsv([
      record({
        attendance: {
          status: "worked",
          scheduled_start: "2026-05-20T13:00:00Z",
          scheduled_end: "2026-05-20T21:00:00Z",
          actual_hours: 8,
          pay_rate: 24,
          notes: "line1\nline2",
        },
      }),
    ]);
    const row = csv.split("\r\n")[1] ?? "";
    expect(row).toContain('"line1\nline2"');
  });

  it("doubles double-quotes inside notes per RFC 4180", () => {
    const csv = buildPayrollCsv([
      record({
        attendance: {
          status: "worked",
          scheduled_start: "2026-05-20T13:00:00Z",
          scheduled_end: "2026-05-20T21:00:00Z",
          actual_hours: 8,
          pay_rate: 24,
          notes: 'said "ok"',
        },
      }),
    ]);
    const row = csv.split("\r\n")[1] ?? "";
    expect(row).toContain('"said ""ok"""');
  });

  it("uses CRLF line endings (RFC 4180)", () => {
    const csv = buildPayrollCsv([record(), record()]);
    // 1 header + 2 data lines → 2 CRLFs
    expect(csv.split("\r\n")).toHaveLength(3);
    expect(csv.includes("\r\n")).toBe(true);
    // No bare LFs from our joiner (notes-only quoted LFs are fine).
    const withoutQuoted = csv.replace(/"[^"]*"/g, "");
    expect(withoutQuoted.includes("\n") && !withoutQuoted.includes("\r\n")).toBe(false);
  });

  it("emits total_pay = actual_hours * pay_rate (0 when either null)", () => {
    const csv = buildPayrollCsv([
      record({
        attendance: {
          status: "worked",
          scheduled_start: "2026-05-20T13:00:00Z",
          scheduled_end: "2026-05-20T21:00:00Z",
          actual_hours: null,
          pay_rate: 24,
          notes: null,
        },
      }),
      record({
        attendance: {
          status: "worked",
          scheduled_start: "2026-05-20T13:00:00Z",
          scheduled_end: "2026-05-20T21:00:00Z",
          actual_hours: 7.5,
          pay_rate: 20,
          notes: null,
        },
      }),
    ]);
    const [, row1, row2] = csv.split("\r\n");
    // Row 1: actual_hours null → total_pay column should be 0.00
    expect(row1?.split(",").slice(-2)[0]).toBe("0.00");
    // Row 2: 7.5 * 20 = 150.00
    expect(row2?.split(",").slice(-2)[0]).toBe("150.00");
  });
});
