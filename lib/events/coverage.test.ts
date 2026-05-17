import { describe, expect, it } from "vitest";

import {
  computeCoverage,
  isUnderfilled,
  statusForCoverage,
  type AssignmentSummary,
  type InviteSummary,
} from "./coverage";

const inv = (status: InviteSummary["status"]): InviteSummary => ({ status });
const ass = (status: AssignmentSummary["status"]): AssignmentSummary => ({ status });

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
