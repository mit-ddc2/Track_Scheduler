import { describe, expect, it } from "vitest";

import {
  buildPayrollPdf,
  computeTotals,
  formatIsoDateLong,
  formatIsoDateShort,
  STATUS_ICON,
  validateRange,
  type PdfRow,
} from "./export-pdf";

/**
 * Quick sanity helpers for parsing the rendered PDF bytes. @react-pdf emits a
 * binary PDF whose text is compressed; we don't try to round-trip the layout,
 * we just confirm the header marker + that the byte stream looks like a PDF
 * of a plausible size.
 */
function isPdfBuffer(buf: Buffer): boolean {
  return buf.length > 100 && buf.slice(0, 5).toString("utf8") === "%PDF-";
}

function countPages(buf: Buffer): number {
  // PDFs use the "/Type /Page" marker (with optional whitespace) for each
  // page object — but also `/Type /Pages` for the page-tree node. We want
  // the leaf pages, so match the negative-lookahead form.
  const matches = buf.toString("binary").match(/\/Type\s*\/Page(?!s)/g);
  return matches ? matches.length : 0;
}

function makeRow(overrides: Partial<PdfRow> = {}): PdfRow {
  return {
    eventId: "evt-1",
    eventTitle: "PORSCHE CLUB RACE",
    venue: "Calabogie Motorsports Park",
    eventStartDate: "2026-05-23",
    eventEndDate: "2026-05-23",
    days: [
      {
        date: "2026-05-23",
        staffEntries: [
          {
            displayName: "Robert Lavoie",
            status: "worked",
            actualHours: 8,
            payRate: 24,
            totalPay: 192,
          },
        ],
      },
    ],
    ...overrides,
  };
}

const GENERATED_AT = new Date("2026-05-18T12:00:00.000Z");

describe("validateRange", () => {
  it("accepts a valid range", () => {
    expect(validateRange("2026-05-01", "2026-05-31")).toEqual({ ok: true });
  });

  it("rejects an invalid 'from' format", () => {
    const result = validateRange("not-a-date", "2026-05-31");
    expect(result.ok).toBe(false);
  });

  it("rejects an invalid 'to' format", () => {
    const result = validateRange("2026-05-01", "2026/05/31");
    expect(result.ok).toBe(false);
  });

  it("rejects from > to", () => {
    const result = validateRange("2026-05-31", "2026-05-01");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/must be on or before/);
    }
  });

  it("accepts from === to (single-day range)", () => {
    expect(validateRange("2026-05-23", "2026-05-23")).toEqual({ ok: true });
  });
});

describe("formatIsoDateShort / formatIsoDateLong", () => {
  it("formats a known date in UTC without timezone drift", () => {
    // 2026-05-23 is a Saturday
    expect(formatIsoDateShort("2026-05-23")).toBe("Sat May 23");
    expect(formatIsoDateLong("2026-05-23")).toBe("Sat May 23, 2026");
  });

  it("passes invalid inputs through unchanged (defensive)", () => {
    expect(formatIsoDateShort("bogus")).toBe("bogus");
    expect(formatIsoDateLong("bogus")).toBe("bogus");
  });
});

describe("computeTotals", () => {
  it("aggregates staff-days worked, hours, and payroll across events", () => {
    const rows: PdfRow[] = [
      makeRow({
        eventId: "evt-1",
        days: [
          {
            date: "2026-05-23",
            staffEntries: [
              {
                displayName: "Robert Lavoie",
                status: "worked",
                actualHours: 8,
                payRate: 24,
                totalPay: 192,
              },
              {
                displayName: "Mit J",
                status: "no_show",
                actualHours: null,
                payRate: 24,
                totalPay: 0,
              },
            ],
          },
        ],
      }),
      makeRow({
        eventId: "evt-2",
        eventTitle: "Elite Enduro",
        eventStartDate: "2026-08-01",
        eventEndDate: "2026-08-02",
        days: [
          {
            date: "2026-08-01",
            staffEntries: [
              {
                displayName: "Robert Lavoie",
                status: "worked",
                actualHours: 9.5,
                payRate: 24,
                totalPay: 228,
              },
            ],
          },
          {
            date: "2026-08-02",
            staffEntries: [
              {
                displayName: "Robert Lavoie",
                status: "worked",
                actualHours: 7,
                payRate: 24,
                totalPay: 168,
              },
            ],
          },
        ],
      }),
    ];

    const totals = computeTotals(rows);
    expect(totals.eventCount).toBe(2);
    // Worked: 1 (evt-1/Robert) + 2 (evt-2/Robert both days) = 3
    expect(totals.staffDaysWorked).toBe(3);
    // Hours: 8 + 9.5 + 7 = 24.5 (no_show contributes nothing)
    expect(totals.totalActualHours).toBeCloseTo(24.5, 2);
    // Payroll: 192 + 228 + 168 = 588 (no_show row had totalPay 0)
    expect(totals.totalPayroll).toBeCloseTo(588, 2);
  });

  it("returns zeros for empty input", () => {
    const totals = computeTotals([]);
    expect(totals).toEqual({
      eventCount: 0,
      staffDaysWorked: 0,
      totalActualHours: 0,
      totalPayroll: 0,
    });
  });
});

describe("STATUS_ICON", () => {
  it("provides a glyph for every attendance status (worked, no_show, etc.)", () => {
    expect(STATUS_ICON.worked).toBeTruthy();
    expect(STATUS_ICON.scheduled).toBeTruthy();
    expect(STATUS_ICON.no_show).toBeTruthy();
    expect(STATUS_ICON.cancelled_by_member).toBeTruthy();
    expect(STATUS_ICON.cancelled_by_manager).toBeTruthy();
    expect(STATUS_ICON.excused).toBeTruthy();
  });
});

describe("buildPayrollPdf — single event single day", () => {
  it("generates a PDF buffer and one or more pages", async () => {
    const buf = await buildPayrollPdf([makeRow()], {
      from: "2026-05-01",
      to: "2026-05-31",
      generatedAt: GENERATED_AT,
    });
    expect(isPdfBuffer(buf)).toBe(true);
    expect(countPages(buf)).toBeGreaterThanOrEqual(1);
    // PDF metadata exposes the document title in plaintext via the /Title
    // entry — @react-pdf writes it as a hex- or paren-encoded literal.
    const asString = buf.toString("binary");
    expect(asString).toMatch(/\/Title/);
  }, 30_000);
});

describe("buildPayrollPdf — multi-event range", () => {
  it("renders one page per event plus a summary page", async () => {
    const rows: PdfRow[] = [
      makeRow({ eventId: "evt-1", eventTitle: "Race A" }),
      makeRow({
        eventId: "evt-2",
        eventTitle: "Race B",
        eventStartDate: "2026-05-30",
        eventEndDate: "2026-05-31",
        days: [
          {
            date: "2026-05-30",
            staffEntries: [
              {
                displayName: "A. Worker",
                status: "worked",
                actualHours: 8,
                payRate: 20,
                totalPay: 160,
              },
            ],
          },
          {
            date: "2026-05-31",
            staffEntries: [
              {
                displayName: "A. Worker",
                status: "worked",
                actualHours: 8,
                payRate: 20,
                totalPay: 160,
              },
            ],
          },
        ],
      }),
    ];

    const buf = await buildPayrollPdf(rows, {
      from: "2026-05-01",
      to: "2026-05-31",
      generatedAt: GENERATED_AT,
    });

    expect(isPdfBuffer(buf)).toBe(true);
    // 2 event pages + 1 summary page minimum = 3 pages
    expect(countPages(buf)).toBeGreaterThanOrEqual(3);
  }, 30_000);
});

describe("buildPayrollPdf — empty range", () => {
  it("renders a single 'No events' page without crashing", async () => {
    const buf = await buildPayrollPdf([], {
      from: "2026-05-01",
      to: "2026-05-31",
      generatedAt: GENERATED_AT,
    });
    expect(isPdfBuffer(buf)).toBe(true);
    expect(countPages(buf)).toBe(1);
  }, 30_000);
});

describe("buildPayrollPdf — status icon coverage", () => {
  it("renders a row with each of worked / no_show / scheduled / excused / cancelled", async () => {
    const row: PdfRow = {
      eventId: "evt-mix",
      eventTitle: "Mixed Status Day",
      venue: "Track",
      eventStartDate: "2026-06-01",
      eventEndDate: "2026-06-01",
      days: [
        {
          date: "2026-06-01",
          staffEntries: [
            { displayName: "Alice", status: "worked", actualHours: 8, payRate: 20, totalPay: 160 },
            { displayName: "Bob", status: "no_show", actualHours: null, payRate: 20, totalPay: 0 },
            { displayName: "Carol", status: "scheduled", actualHours: null, payRate: 20, totalPay: 0 },
            { displayName: "Dave", status: "excused", actualHours: null, payRate: 20, totalPay: 0 },
            {
              displayName: "Eve",
              status: "cancelled_by_member",
              actualHours: null,
              payRate: 20,
              totalPay: 0,
            },
          ],
        },
      ],
    };
    const buf = await buildPayrollPdf([row], {
      from: "2026-06-01",
      to: "2026-06-30",
      generatedAt: GENERATED_AT,
    });
    expect(isPdfBuffer(buf)).toBe(true);
  }, 30_000);
});

describe("buildPayrollPdf — validation", () => {
  it("throws when from > to", async () => {
    await expect(
      buildPayrollPdf([], {
        from: "2026-05-31",
        to: "2026-05-01",
        generatedAt: GENERATED_AT,
      }),
    ).rejects.toThrow(/must be on or before/);
  });

  it("throws on a malformed date", async () => {
    await expect(
      buildPayrollPdf([], {
        from: "not-a-date",
        to: "2026-05-01",
        generatedAt: GENERATED_AT,
      }),
    ).rejects.toThrow();
  });
});
