import { describe, expect, it } from "vitest";

import {
  computeCoverage,
  computeCoverageByDay,
  enumerateEventDays,
  flattenCoverage,
  isAnyDayShort,
  isUnderfilled,
  legacyCoverage,
  statusForCoverage,
  type AssignmentSummary,
  type DayAssignmentSummary,
  type DayInviteSummary,
  type InviteSummary,
} from "./coverage";

const inv = (status: InviteSummary["status"]): InviteSummary => ({ status });
const ass = (status: AssignmentSummary["status"]): AssignmentSummary => ({ status });

const dayInv = (
  day_date: string,
  status: InviteSummary["status"],
): DayInviteSummary => ({ day_date, status });
const dayAss = (
  day_date: string,
  status: AssignmentSummary["status"],
): DayAssignmentSummary => ({ day_date, status });

describe("computeCoverage", () => {
  it("returns zeros when there are no invites or assignments", () => {
    const c = computeCoverage([], [], 4);
    expect(c).toEqual({
      confirmed: 0,
      pending: 0,
      declined: 0,
      cancelled: 0,
      partial: 0,
      short: 4,
      surplus: 0,
      needed: 4,
    });
  });

  it("counts confirmed assignments against the requirement", () => {
    const c = computeCoverage(
      [],
      [ass("confirmed"), ass("confirmed"), ass("confirmed")],
      4,
    );
    expect(c.confirmed).toBe(3);
    expect(c.short).toBe(1);
    expect(c.surplus).toBe(0);
  });

  it("treats every accepted-but-not-yet-assigned invite as pending until promoted", () => {
    const c = computeCoverage(
      [inv("invited"), inv("invited"), inv("accepted")],
      [],
      4,
    );
    // accepted invites without a matching assignment row don't bump confirmed —
    // assignments are the source of truth for confirmation.
    expect(c.confirmed).toBe(0);
    expect(c.pending).toBe(2);
    expect(c.short).toBe(4);
  });

  it("reports surplus when confirmed > needed", () => {
    const c = computeCoverage(
      [],
      [ass("confirmed"), ass("confirmed"), ass("confirmed"), ass("confirmed"), ass("confirmed")],
      3,
    );
    expect(c.surplus).toBe(2);
    expect(c.short).toBe(0);
  });

  it("ignores declined invites for the headcount", () => {
    const c = computeCoverage(
      [inv("declined"), inv("declined"), inv("declined")],
      [],
      2,
    );
    expect(c.declined).toBe(3);
    expect(c.confirmed).toBe(0);
    expect(c.pending).toBe(0);
    expect(c.short).toBe(2);
  });

  it("counts cancellations from both invites and assignments", () => {
    const c = computeCoverage(
      [inv("cancelled_by_member"), inv("cancelled_by_manager")],
      [ass("cancelled"), ass("confirmed")],
      3,
    );
    expect(c.cancelled).toBe(3);
    expect(c.confirmed).toBe(1);
    expect(c.short).toBe(2);
  });

  it("hits short=0 when accepted equals needed", () => {
    const c = computeCoverage([], [ass("confirmed"), ass("confirmed")], 2);
    expect(c.short).toBe(0);
    expect(c.surplus).toBe(0);
    expect(isUnderfilled(c)).toBe(false);
  });

  it("counts partial availability separately from pending", () => {
    const c = computeCoverage(
      [inv("availability_updated"), inv("invited")],
      [],
      3,
    );
    expect(c.partial).toBe(1);
    expect(c.pending).toBe(1);
  });

  it("returns needed=0 when the required headcount is unset", () => {
    const c = computeCoverage([inv("invited")], [], 0);
    expect(c.needed).toBe(0);
    expect(c.short).toBe(0);
    expect(c.surplus).toBe(0);
  });
});

describe("legacyCoverage alias", () => {
  it("is the same function as computeCoverage", () => {
    expect(legacyCoverage).toBe(computeCoverage);
  });
});

describe("enumerateEventDays", () => {
  it("returns a single day for single-day events", () => {
    expect(
      enumerateEventDays("2026-05-23T11:00:00Z", "2026-05-23T21:00:00Z"),
    ).toEqual(["2026-05-23"]);
  });

  it("expands a multi-day event into an inclusive list of dates", () => {
    expect(
      enumerateEventDays("2026-05-23T11:00:00Z", "2026-05-25T21:00:00Z"),
    ).toEqual(["2026-05-23", "2026-05-24", "2026-05-25"]);
  });

  it("returns [] when end precedes start", () => {
    expect(
      enumerateEventDays("2026-05-25T11:00:00Z", "2026-05-23T21:00:00Z"),
    ).toEqual([]);
  });

  it("returns [] for invalid timestamps", () => {
    expect(enumerateEventDays("not-a-date", "also-not-a-date")).toEqual([]);
  });
});

describe("computeCoverageByDay", () => {
  it("returns a single day with zero counts for an empty single-day event", () => {
    const r = computeCoverageByDay(
      [],
      [],
      "2026-05-23T11:00:00Z",
      "2026-05-23T21:00:00Z",
      4,
    );
    expect(r.days).toHaveLength(1);
    expect(r.days[0]).toEqual({
      date: "2026-05-23",
      confirmed: 0,
      pending: 0,
      declined: 0,
      cancelled: 0,
      partial: 0,
      short: 4,
      surplus: 0,
      needed: 4,
    });
    expect(r.total.needed).toBe(4);
    expect(r.total.short).toBe(4);
    expect(isAnyDayShort(r)).toBe(true);
  });

  it("returns one entry per day even when a day has no invites", () => {
    const r = computeCoverageByDay(
      [dayInv("2026-05-23", "invited"), dayInv("2026-05-25", "accepted")],
      [dayAss("2026-05-23", "confirmed")],
      "2026-05-23T11:00:00Z",
      "2026-05-25T21:00:00Z",
      2,
    );
    expect(r.days.map((d) => d.date)).toEqual([
      "2026-05-23",
      "2026-05-24",
      "2026-05-25",
    ]);
    expect(r.days[0].confirmed).toBe(1);
    expect(r.days[0].pending).toBe(1); // the "invited" invite on D23
    expect(r.days[1].confirmed).toBe(0);
    expect(r.days[1].short).toBe(2);
    expect(r.days[2].confirmed).toBe(0);
    expect(r.days[2].short).toBe(2);
  });

  it("multi-day mixed RSVPs roll up to correct totals", () => {
    const r = computeCoverageByDay(
      [
        dayInv("2026-06-15", "invited"),
        dayInv("2026-06-15", "declined"),
        dayInv("2026-06-16", "invited"),
        dayInv("2026-06-17", "availability_updated"),
        dayInv("2026-06-17", "cancelled_by_member"),
      ],
      [
        dayAss("2026-06-15", "confirmed"),
        dayAss("2026-06-15", "confirmed"),
        dayAss("2026-06-16", "confirmed"),
        dayAss("2026-06-17", "cancelled"),
      ],
      "2026-06-15T11:00:00Z",
      "2026-06-17T21:00:00Z",
      3,
    );

    expect(r.days).toHaveLength(3);
    const [d15, d16, d17] = r.days;
    expect(d15.confirmed).toBe(2);
    expect(d15.pending).toBe(1);
    expect(d15.declined).toBe(1);
    expect(d15.short).toBe(1);

    expect(d16.confirmed).toBe(1);
    expect(d16.pending).toBe(1);
    expect(d16.short).toBe(2);

    expect(d17.partial).toBe(1);
    expect(d17.cancelled).toBe(2); // invite + assignment
    expect(d17.short).toBe(3);

    expect(r.total.confirmed).toBe(3); // 2 on D15 + 1 on D16 + 0 on D17
    expect(r.total.needed).toBe(9); // 3 needed * 3 days
    expect(r.total.short).toBe(6);
  });

  it("marks ALL days satisfied when each day independently meets headcount", () => {
    const r = computeCoverageByDay(
      [],
      [
        dayAss("2026-07-01", "confirmed"),
        dayAss("2026-07-01", "confirmed"),
        dayAss("2026-07-02", "confirmed"),
        dayAss("2026-07-02", "confirmed"),
      ],
      "2026-07-01T11:00:00Z",
      "2026-07-02T21:00:00Z",
      2,
    );
    expect(r.days.every((d) => d.short === 0)).toBe(true);
    expect(isAnyDayShort(r)).toBe(false);
    expect(r.total.surplus).toBe(0);
  });

  it("treats a day with all declines as completely short", () => {
    const r = computeCoverageByDay(
      [
        dayInv("2026-08-01", "declined"),
        dayInv("2026-08-01", "declined"),
        dayInv("2026-08-01", "declined"),
      ],
      [],
      "2026-08-01T11:00:00Z",
      "2026-08-01T21:00:00Z",
      2,
    );
    expect(r.days[0].declined).toBe(3);
    expect(r.days[0].confirmed).toBe(0);
    expect(r.days[0].short).toBe(2);
    expect(isAnyDayShort(r)).toBe(true);
  });

  it("partial day fill (one day staffed, another not) still reports any-short", () => {
    const r = computeCoverageByDay(
      [dayInv("2026-09-12", "invited")],
      [
        dayAss("2026-09-11", "confirmed"),
        dayAss("2026-09-11", "confirmed"),
        dayAss("2026-09-12", "confirmed"),
      ],
      "2026-09-11T11:00:00Z",
      "2026-09-12T21:00:00Z",
      2,
    );
    expect(r.days[0].short).toBe(0); // 2/2 on Sep 11
    expect(r.days[1].short).toBe(1); // 1/2 on Sep 12
    expect(isAnyDayShort(r)).toBe(true);
  });

  it("ignores invite/assignment rows that fall outside the event window", () => {
    const r = computeCoverageByDay(
      [dayInv("2026-10-05", "invited"), dayInv("2026-09-30", "accepted")],
      [dayAss("2026-09-30", "confirmed")],
      "2026-10-05T11:00:00Z",
      "2026-10-05T21:00:00Z",
      1,
    );
    expect(r.days).toHaveLength(1);
    expect(r.days[0].pending).toBe(1);
    expect(r.days[0].confirmed).toBe(0);
  });

  it("flattenCoverage rolls per-day into legacy shape", () => {
    const r = computeCoverageByDay(
      [dayInv("2026-05-23", "invited")],
      [dayAss("2026-05-23", "confirmed")],
      "2026-05-23T11:00:00Z",
      "2026-05-24T21:00:00Z",
      2,
    );
    const flat = flattenCoverage(r);
    expect(flat.confirmed).toBe(1);
    expect(flat.pending).toBe(1);
    expect(flat.needed).toBe(4); // 2 days * 2 needed
    expect(flat.short).toBe(3);
  });
});

describe("statusForCoverage", () => {
  it("freezes terminal states", () => {
    const c = computeCoverage([], [], 4);
    expect(statusForCoverage("cancelled", c, false)).toBe("cancelled");
    expect(statusForCoverage("completed", c, false)).toBe("completed");
    expect(statusForCoverage("locked", c, false)).toBe("locked");
  });

  it("treats no-invites as scheduled (or draft if still drafting)", () => {
    const c = computeCoverage([], [], 4);
    expect(statusForCoverage("draft", c, false)).toBe("draft");
    expect(statusForCoverage("scheduled", c, false)).toBe("scheduled");
  });

  it("derives staffed/inviting/underfilled once invites exist", () => {
    const staffed = computeCoverage(
      [],
      [ass("confirmed"), ass("confirmed")],
      2,
    );
    expect(statusForCoverage("inviting", staffed, true)).toBe("staffed");

    const underfilled = computeCoverage([inv("declined")], [], 4);
    expect(statusForCoverage("inviting", underfilled, true)).toBe("underfilled");
  });
});
