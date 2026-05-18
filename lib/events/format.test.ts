import { describe, expect, it } from "vitest";

import {
  daysOut,
  formatEventDate,
  formatTimeRange,
  isMultiDayEvent,
  monthWeekEyebrow,
  shortCode,
  toDateTimeLocal,
} from "./format";

const TZ = "America/Toronto";

describe("formatEventDate", () => {
  it("renders a same-day event as a single dot-separated label", () => {
    // 2026-05-23 09:00 → 17:00 Toronto
    const s = "2026-05-23T13:00:00Z"; // 09:00 EDT
    const e = "2026-05-23T21:00:00Z"; // 17:00 EDT
    expect(formatEventDate(s, e, TZ)).toBe("Sat · May 23");
  });

  it("renders a multi-day same-month event with both weekdays", () => {
    const s = "2026-05-23T13:00:00Z"; // Sat
    const e = "2026-05-24T21:00:00Z"; // Sun
    expect(formatEventDate(s, e, TZ)).toBe("Sat-Sun · May 23-24");
  });

  it("renders a multi-month event with the full date on both sides", () => {
    const s = "2026-05-31T13:00:00Z"; // Sun May 31
    const e = "2026-06-01T01:00:00Z"; // Sun May 31 21:00 EDT
    // 01:00Z on Jun 1 is still 21:00 May 31 in Toronto — keep as same day.
    expect(formatEventDate(s, e, TZ)).toBe("Sun · May 31");
  });

  it("renders a true cross-month event spanning multiple days", () => {
    const s = "2026-05-30T13:00:00Z";
    const e = "2026-06-02T21:00:00Z";
    expect(formatEventDate(s, e, TZ)).toBe("Sat May 30 – Tue Jun 2");
  });

  it("renders a different-timezone event in the supplied zone", () => {
    // Same UTC moment in two zones reads differently.
    const s = "2026-05-23T01:00:00Z"; // 21:00 May 22 EDT, 11:00 May 23 AEST
    const e = "2026-05-23T09:00:00Z";
    expect(formatEventDate(s, e, "Australia/Sydney")).toBe("Sat · May 23");
    expect(formatEventDate(s, e, "America/Toronto")).toBe("Fri-Sat · May 22-23");
  });
});

describe("formatTimeRange", () => {
  it("formats a basic range in 24h", () => {
    const s = "2026-05-23T11:30:00Z"; // 07:30 EDT
    const e = "2026-05-23T21:00:00Z"; // 17:00 EDT
    expect(formatTimeRange(s, e, TZ)).toBe("07:30 – 17:00");
  });
});

describe("daysOut", () => {
  it("returns 0 for an event starting today", () => {
    const now = new Date("2026-05-17T12:00:00-04:00");
    expect(daysOut("2026-05-17T20:00:00-04:00", now, TZ)).toBe(0);
  });

  it("returns negative values for past events", () => {
    const now = new Date("2026-05-17T12:00:00-04:00");
    expect(daysOut("2026-05-10T12:00:00-04:00", now, TZ)).toBe(-7);
  });

  it("returns positive values for future events", () => {
    const now = new Date("2026-05-17T12:00:00-04:00");
    expect(daysOut("2026-05-24T12:00:00-04:00", now, TZ)).toBe(7);
  });

  it("stays correct across the spring-forward DST boundary", () => {
    // 2026 spring-forward in Toronto: 02:00 EST on Sun Mar 8 → 03:00 EDT.
    // Use offset-anchored inputs so the test does not depend on which side
    // of the discontinuity the parsed UTC instant falls on.
    const now = new Date("2026-03-07T09:00:00-05:00"); // Sat 09:00 EST
    const start = "2026-03-08T09:00:00-04:00"; // Sun 09:00 EDT
    expect(daysOut(start, now, TZ)).toBe(1);
  });

  it("stays correct across the fall-back DST boundary", () => {
    // 2026 fall-back in Toronto: 02:00 EDT on Sun Nov 1 → 01:00 EST.
    // 25 wall-clock hours separate 09:00 Oct 31 and 09:00 Nov 1.
    const now = new Date("2026-10-31T09:00:00-04:00"); // Sat 09:00 EDT
    const start = "2026-11-01T09:00:00-05:00"; // Sun 09:00 EST
    expect(daysOut(start, now, TZ)).toBe(1);
  });

  it("crosses the year boundary cleanly", () => {
    // Dec 31 23:30 local → Jan 1 00:30 local is still "1 day out" by
    // calendar date, even though the wall-clock delta is 1 hour.
    const now = new Date("2026-12-31T23:30:00-05:00");
    const start = "2027-01-01T00:30:00-05:00";
    expect(daysOut(start, now, TZ)).toBe(1);
  });
});

describe("monthWeekEyebrow", () => {
  it("formats month + ISO week", () => {
    const out = monthWeekEyebrow(new Date("2026-05-17T12:00:00-04:00"), TZ);
    expect(out).toMatch(/^May · Week \d+$/);
  });
});

describe("toDateTimeLocal", () => {
  it("formats a timestamp into the value shape for <input type=datetime-local>", () => {
    expect(toDateTimeLocal("2026-05-23T13:00:00Z", TZ)).toBe(
      "2026-05-23T09:00",
    );
  });
});

describe("shortCode", () => {
  it("derives an uppercase EV-XXXX code from the first four id chars", () => {
    expect(shortCode("7f3d1abc-1111-2222-3333-444455556666")).toBe("EV-7F3D");
  });

  it("handles ids shorter than 4 characters", () => {
    expect(shortCode("ab")).toBe("EV-AB");
  });
});

describe("isMultiDayEvent", () => {
  it("returns false for a same-day event in tz", () => {
    expect(
      isMultiDayEvent(
        "2026-05-23T13:00:00Z", // 09:00 EDT
        "2026-05-23T21:00:00Z", // 17:00 EDT
        TZ,
      ),
    ).toBe(false);
  });

  it("returns true for a multi-day event in tz", () => {
    expect(
      isMultiDayEvent("2026-05-23T13:00:00Z", "2026-05-24T21:00:00Z", TZ),
    ).toBe(true);
  });

  it("uses the event timezone to bucket calendar dates, not UTC", () => {
    // Midnight UTC on May 23 is still May 22 in Toronto, so an event that
    // straddles UTC midnight but stays inside the same Toronto calendar day
    // counts as single-day.
    expect(
      isMultiDayEvent("2026-05-23T01:00:00Z", "2026-05-23T03:00:00Z", TZ),
    ).toBe(false);
  });
});
