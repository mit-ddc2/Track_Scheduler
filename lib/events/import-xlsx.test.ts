import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseEventsXlsx } from "./import-xlsx";

const FIXTURE_PATH = join(
  process.cwd(),
  "data",
  "Booking_2026_v05_17.xlsx",
);

function loadFixture(): Buffer {
  return readFileSync(FIXTURE_PATH);
}

describe("parseEventsXlsx", () => {
  it("parses the bundled Booking_2026_v05_17.xlsx file end-to-end", () => {
    const events = parseEventsXlsx(loadFixture());
    expect(events.length).toBeGreaterThanOrEqual(80);
    expect(events.length).toBeLessThanOrEqual(200);

    // Every event has well-formed core fields.
    for (const ev of events) {
      expect(ev.title).toBeTruthy();
      expect(ev.venue).toBeTruthy();
      expect(ev.startDate).toMatch(/^2026-(0[5-9]|10)-\d{2}$/);
      expect(ev.endDate).toMatch(/^2026-(0[5-9]|10)-\d{2}$/);
      expect(ev.startDate <= ev.endDate).toBe(true);
      expect(ev.sourceMonth).toBeTruthy();
      expect(ev.requiredHeadcount).toBeGreaterThanOrEqual(0);
      expect(ev.sourceRows.length).toBeGreaterThan(0);
    }
  });

  it("collapses PORSCHE CLUB RACE on May 1-3 into one multi-day event", () => {
    const events = parseEventsXlsx(loadFixture());
    const porsche = events.find(
      (e) => e.title === "PORSCHE CLUB RACE" && e.sourceMonth === "MAY",
    );
    expect(porsche).toBeDefined();
    expect(porsche?.startDate).toBe("2026-05-01");
    expect(porsche?.endDate).toBe("2026-05-03");
    expect(porsche?.requiredHeadcount).toBeGreaterThanOrEqual(3);
    expect(porsche?.venue).toBe("CTMP");
    expect(porsche?.sourceRows).toEqual([3, 4, 5]);
    expect(porsche?.needsReview).toBe(false);
  });

  it("collapses Elite Enduro at SHANNONVILLE on Aug 1-2 into one multi-day event", () => {
    const events = parseEventsXlsx(loadFixture());
    const enduro = events.find(
      (e) =>
        e.sourceMonth === "Aug" &&
        e.venue.toUpperCase() === "SHANNONVILLE" &&
        e.title.toLowerCase().includes("elite"),
    );
    expect(enduro).toBeDefined();
    expect(enduro?.startDate).toBe("2026-08-01");
    expect(enduro?.endDate).toBe("2026-08-02");
    expect(enduro?.endDate).not.toBe(enduro?.startDate);
  });

  it("groups continuation rows (no day-of-week) with the previous date", () => {
    // May 8: row 9 has Friday + nascar glen at "" venue (dropped — no venue);
    // row 10 is a continuation row (blank col A) for date 8 with SH KART/CM1.
    // The CM1 event must be assigned to 2026-05-08, not the previous day.
    const events = parseEventsXlsx(loadFixture());
    const cm1 = events.find(
      (e) =>
        e.sourceMonth === "MAY" &&
        e.venue.toUpperCase() === "SH KART" &&
        e.title === "CM1",
    );
    expect(cm1).toBeDefined();
    expect(cm1?.startDate).toBe("2026-05-08");
    // CM1 continues May 9 + May 10 → 3-day event.
    expect(cm1?.endDate).toBe("2026-05-10");
  });

  it("flags placeholder titles (TBC, cancelled) with needsReview", () => {
    const events = parseEventsXlsx(loadFixture());
    const review = events.filter((e) => e.needsReview);
    expect(review.length).toBeGreaterThan(0);
    expect(review.some((e) => /tbc/i.test(e.title))).toBe(true);
  });

  it("returns events split per source month sheet", () => {
    const events = parseEventsXlsx(loadFixture());
    const months = new Set(events.map((e) => e.sourceMonth));
    expect(months.has("MAY")).toBe(true);
    expect(months.has("June")).toBe(true);
    expect(months.has("July")).toBe(true);
    expect(months.has("Aug")).toBe(true);
    expect(months.has("Sept")).toBe(true);
    expect(months.has("OCT")).toBe(true);
  });

  it("honors a months filter to limit which sheets are scanned", () => {
    const onlyMay = parseEventsXlsx(loadFixture(), { months: ["MAY"] });
    expect(onlyMay.length).toBeGreaterThan(0);
    expect(onlyMay.every((e) => e.sourceMonth === "MAY")).toBe(true);
  });

  it("requiredHeadcount is the max filled staff cells across the event's days", () => {
    // PORSCHE CLUB RACE rows have 6 filled E-J columns each day → headcount 6.
    const events = parseEventsXlsx(loadFixture());
    const porsche = events.find(
      (e) => e.title === "PORSCHE CLUB RACE" && e.sourceMonth === "MAY",
    );
    expect(porsche?.requiredHeadcount).toBe(6);
  });

  it("works with ArrayBuffer input as well as Buffer", () => {
    const buf = loadFixture();
    const ab = new ArrayBuffer(buf.byteLength);
    new Uint8Array(ab).set(buf);
    const a = parseEventsXlsx(buf);
    const b = parseEventsXlsx(ab);
    expect(b.length).toBe(a.length);
  });
});
