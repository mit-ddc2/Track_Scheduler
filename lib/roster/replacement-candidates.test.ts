import { describe, expect, it } from "vitest";

import {
  rankCandidates,
  scoreCandidate,
  type CandidateRequirement,
  type CandidateStaff,
  type ExistingAssignment,
  type ExistingInvite,
  type AttendanceFact,
} from "./replacement-candidates";

// ─── Fixtures ────────────────────────────────────────────────────────────

const ROLE_EXTR = "role-extr";
const ROLE_MED = "role-med";
const QUAL_EXTR = "qual-extr";
const QUAL_MED = "qual-med";

const NOW = new Date("2026-05-17T12:00:00Z");

function days(n: number): string {
  return new Date(NOW.getTime() - n * 24 * 3600 * 1000).toISOString();
}

function staff(over: Partial<CandidateStaff> & { id: string; display_name: string }): CandidateStaff {
  return {
    active: true,
    preferred_contact: "both",
    role_ids: [],
    qualification_ids: [],
    contact_methods: [
      {
        channel: "sms",
        status: "valid",
        consent: "granted",
        last_delivery_at: days(30),
      },
      {
        channel: "email",
        status: "valid",
        consent: "granted",
        last_delivery_at: days(30),
      },
    ],
    ...over,
  };
}

const NO_REQS: CandidateRequirement[] = [];
const EXTR_REQ: CandidateRequirement[] = [
  {
    label: "EXTR",
    role_id: ROLE_EXTR,
    qualification_id: QUAL_EXTR,
    required_count: 2,
  },
];

function rank(
  staffList: CandidateStaff[],
  opts: {
    requirements?: CandidateRequirement[];
    assignments?: ExistingAssignment[];
    invites?: ExistingInvite[];
    recentAttendance?: AttendanceFact[];
    options?: Parameters<typeof rankCandidates>[0]["options"];
  } = {},
) {
  return rankCandidates({
    staff: staffList,
    requirements: opts.requirements ?? NO_REQS,
    assignments: opts.assignments ?? [],
    invites: opts.invites ?? [],
    recentAttendance: opts.recentAttendance ?? [],
    now: NOW,
    options: opts.options,
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("rankCandidates", () => {
  it("returns empty when every active staff is already assigned", () => {
    const a = staff({ id: "a", display_name: "Anna" });
    const b = staff({ id: "b", display_name: "Bob" });
    const result = rank([a, b], {
      assignments: [
        { staff_member_id: "a", status: "confirmed" },
        { staff_member_id: "b", status: "waitlisted" },
      ],
    });
    expect(result).toHaveLength(0);
  });

  it("filters out staff whose only contact channel is opted_out", () => {
    const optedOut = staff({
      id: "a",
      display_name: "Anna",
      contact_methods: [
        {
          channel: "sms",
          status: "opted_out",
          consent: "granted",
          last_delivery_at: null,
        },
      ],
    });
    const ok = staff({ id: "b", display_name: "Bob" });
    const result = rank([optedOut, ok]);
    expect(result.map((r) => r.staff.id)).toEqual(["b"]);
  });

  it("filters out staff with only bounced contact methods", () => {
    const bounced = staff({
      id: "a",
      display_name: "Anna",
      contact_methods: [
        {
          channel: "email",
          status: "bounced",
          consent: "granted",
          last_delivery_at: null,
        },
        {
          channel: "sms",
          status: "invalid",
          consent: "granted",
          last_delivery_at: null,
        },
      ],
    });
    const ok = staff({ id: "b", display_name: "Bob" });
    const result = rank([bounced, ok]);
    expect(result.map((r) => r.staff.id)).toEqual(["b"]);
  });

  it("sorts role/qualification matches ahead of non-matches", () => {
    const matcher = staff({
      id: "a",
      display_name: "Zed Matcher",
      role_ids: [ROLE_EXTR],
      qualification_ids: [QUAL_EXTR],
    });
    const nonMatcher = staff({ id: "b", display_name: "Alpha NoMatch" });
    const result = rank([nonMatcher, matcher], { requirements: EXTR_REQ });
    expect(result[0].staff.id).toBe("a");
    expect(result[0].matches.role).toBe(true);
    expect(result[0].matches.quals).toEqual(["EXTR"]);
  });

  it("ranks sms+email candidates above sms-only when role match is equal", () => {
    const dual = staff({ id: "dual", display_name: "Aa Dual" });
    const smsOnly = staff({
      id: "sms",
      display_name: "Bb SmsOnly",
      contact_methods: [
        {
          channel: "sms",
          status: "valid",
          consent: "granted",
          last_delivery_at: days(30),
        },
      ],
    });
    const result = rank([smsOnly, dual]);
    expect(result[0].staff.id).toBe("dual");
    expect(result[0].contactability).toBe("sms+email");
    expect(result[1].contactability).toBe("sms");
  });

  it("fairness: 60-days-out ranks above 5-days-out when otherwise equal", () => {
    const stale = staff({ id: "stale", display_name: "Aa Stale" });
    const fresh = staff({ id: "fresh", display_name: "Bb Fresh" });
    const result = rank([fresh, stale], {
      recentAttendance: [
        { staff_member_id: "stale", last_worked_at: days(60) },
        { staff_member_id: "fresh", last_worked_at: days(5) },
      ],
    });
    expect(result[0].staff.id).toBe("stale");
    expect(result[0].lastWorkedAgo).toBe(60);
    expect(result[1].lastWorkedAgo).toBe(5);
  });

  it("last contacted older first when all higher tiers tie", () => {
    const olderContact = staff({
      id: "old",
      display_name: "Aa Older",
      contact_methods: [
        {
          channel: "sms",
          status: "valid",
          consent: "granted",
          last_delivery_at: days(120),
        },
        {
          channel: "email",
          status: "valid",
          consent: "granted",
          last_delivery_at: days(120),
        },
      ],
    });
    const newerContact = staff({
      id: "new",
      display_name: "Bb Newer",
      contact_methods: [
        {
          channel: "sms",
          status: "valid",
          consent: "granted",
          last_delivery_at: days(2),
        },
        {
          channel: "email",
          status: "valid",
          consent: "granted",
          last_delivery_at: days(2),
        },
      ],
    });
    // Both never worked → fairness ties.
    const result = rank([newerContact, olderContact]);
    expect(result[0].staff.id).toBe("old");
    expect(result[1].staff.id).toBe("new");
  });

  it("respects includeDeclined: excludes by default, includes when flag is true", () => {
    const declined = staff({ id: "d", display_name: "Declined" });
    const fresh = staff({ id: "f", display_name: "Fresh" });

    const without = rank([declined, fresh], {
      invites: [{ staff_member_id: "d", status: "declined" }],
    });
    expect(without.map((r) => r.staff.id)).toEqual(["f"]);

    const withFlag = rank([declined, fresh], {
      invites: [{ staff_member_id: "d", status: "declined" }],
      options: { includeDeclined: true },
    });
    expect(withFlag.map((r) => r.staff.id).sort()).toEqual(["d", "f"]);
  });

  it("filters out inactive staff", () => {
    const inactive = staff({ id: "i", display_name: "Ina", active: false });
    const active = staff({ id: "a", display_name: "Ada" });
    const result = rank([inactive, active]);
    expect(result.map((r) => r.staff.id)).toEqual(["a"]);
  });

  it("filters out already-accepted invitees", () => {
    const accepted = staff({ id: "y", display_name: "Yep" });
    const other = staff({ id: "n", display_name: "Nope" });
    const result = rank([accepted, other], {
      invites: [{ staff_member_id: "y", status: "accepted" }],
    });
    expect(result.map((r) => r.staff.id)).toEqual(["n"]);
  });

  it("treats withdrawn consent as opted-out", () => {
    const withdrawn = staff({
      id: "w",
      display_name: "Withdrawn",
      contact_methods: [
        {
          channel: "sms",
          status: "valid",
          consent: "withdrawn",
          last_delivery_at: days(30),
        },
        {
          channel: "email",
          status: "valid",
          consent: "denied",
          last_delivery_at: days(30),
        },
      ],
    });
    const result = rank([withdrawn]);
    expect(result).toHaveLength(0);
  });

  it("respects the channel option: sms-only campaigns skip email-only staff", () => {
    const emailOnly = staff({
      id: "e",
      display_name: "Eve",
      contact_methods: [
        {
          channel: "email",
          status: "valid",
          consent: "granted",
          last_delivery_at: days(30),
        },
      ],
    });
    const smsOk = staff({ id: "s", display_name: "Sam" });
    const result = rank([emailOnly, smsOk], {
      options: { channel: "sms" },
    });
    expect(result.map((r) => r.staff.id)).toEqual(["s"]);
  });
});

describe("scoreCandidate", () => {
  it("clamps to 0–99", () => {
    const s = staff({
      id: "x",
      display_name: "Max",
      role_ids: [ROLE_EXTR, ROLE_MED],
      qualification_ids: [QUAL_EXTR, QUAL_MED],
    });
    const score = scoreCandidate({
      staff: s,
      requirements: [
        { label: "EXTR", role_id: ROLE_EXTR, qualification_id: QUAL_EXTR, required_count: 1 },
        { label: "MED", role_id: ROLE_MED, qualification_id: QUAL_MED, required_count: 1 },
      ],
      matches: { role: true, quals: ["EXTR", "MED"], hasSms: true, hasEmail: true },
      lastWorkedAgo: 120,
      contactability: "sms+email",
    });
    expect(score).toBeGreaterThan(80);
    expect(score).toBeLessThanOrEqual(99);
  });

  it("scores never-worked candidates above freshly-worked ones", () => {
    const base = {
      staff: staff({ id: "x", display_name: "X" }),
      requirements: EXTR_REQ,
      matches: { role: false, quals: [], hasSms: true, hasEmail: true },
      contactability: "sms+email" as const,
    };
    const never = scoreCandidate({ ...base, lastWorkedAgo: null });
    const fresh = scoreCandidate({ ...base, lastWorkedAgo: 3 });
    expect(never).toBeGreaterThan(fresh);
  });
});
