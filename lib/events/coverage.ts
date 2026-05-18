/**
 * Pure coverage math. Mirrors §8.7 of the engineering spec, extended in v2
 * with a per-day breakdown for multi-day events.
 *
 * Counts are derived from invite + assignment summaries so the same function
 * can run in tests, server actions, and (later) realtime subscriptions.
 *
 * Backwards compatibility:
 *   - `computeCoverage(invites, assignments, requiredHeadcount)` keeps the
 *     v1 single-counter shape so existing UI callers (event detail page,
 *     public RSVP page) keep working until Wave B2 migrates them.
 *   - `legacyCoverage` is exported as an alias for explicit naming.
 *   - The new per-day shape lives in `computeCoverageByDay` which takes the
 *     event window so it can enumerate every day, even ones with no invites.
 */

import type { EventStatus } from "@/lib/db/types";

export type InviteSummary = {
  /**
   * Snapshot of the invite's status. Matches the `invite_status` enum in
   * migration 0001, but Phase 3 only inserts summaries — Phase 5 wires
   * actual invite rows.
   */
  status:
    | "created"
    | "invited"
    | "accepted"
    | "declined"
    | "cancelled_by_member"
    | "cancelled_by_manager"
    | "availability_updated"
    | "expired"
    | "waitlisted";
};

export type AssignmentSummary = {
  status: "confirmed" | "waitlisted" | "cancelled" | "completed";
};

export type Coverage = {
  confirmed: number;
  pending: number;
  declined: number;
  cancelled: number;
  partial: number;
  short: number;
  surplus: number;
  needed: number;
};

/**
 * Derive coverage counts for an event. Confirmed = assignments in `confirmed`
 * or `completed`; assignments authoritatively override invite acceptance so
 * the manager's manual moves always win.
 *
 * `pending` is invitations awaiting a response (status: `invited`).
 * `partial` covers responders who replied with partial availability.
 */
export function computeCoverage(
  invites: InviteSummary[],
  assignments: AssignmentSummary[],
  requiredHeadcount: number,
): Coverage {
  const needed = Math.max(0, requiredHeadcount | 0);

  let confirmed = 0;
  let cancelled = 0;
  for (const a of assignments) {
    if (a.status === "confirmed" || a.status === "completed") confirmed += 1;
    else if (a.status === "cancelled") cancelled += 1;
  }

  let pending = 0;
  let declined = 0;
  let partial = 0;
  for (const inv of invites) {
    if (inv.status === "invited") pending += 1;
    else if (inv.status === "declined") declined += 1;
    else if (inv.status === "availability_updated") partial += 1;
    else if (
      inv.status === "cancelled_by_member" ||
      inv.status === "cancelled_by_manager"
    ) {
      cancelled += 1;
    }
  }

  const short = Math.max(0, needed - confirmed);
  const surplus = Math.max(0, confirmed - needed);

  return {
    confirmed,
    pending,
    declined,
    cancelled,
    partial,
    short,
    surplus,
    needed,
  };
}

/**
 * v1 alias — same signature and shape as {@link computeCoverage}. Provided
 * so callers that want explicit "I'm using the flat v1 shape" naming can
 * import it without ambiguity.
 */
export const legacyCoverage = computeCoverage;

/** Convenience predicate for status math. */
export function isUnderfilled(coverage: Coverage): boolean {
  return coverage.short > 0;
}

/** Used by EventStatusChip + state machine. */
export function statusForCoverage(
  current: EventStatus,
  coverage: Coverage,
  hasInvites: boolean,
): EventStatus {
  if (current === "cancelled" || current === "completed" || current === "locked") {
    return current;
  }
  if (current === "needs_review") return current;
  if (!hasInvites) return current === "draft" ? "draft" : "scheduled";
  if (coverage.confirmed >= coverage.needed && coverage.needed > 0) {
    return "staffed";
  }
  if (coverage.confirmed + coverage.pending < coverage.needed) {
    return "underfilled";
  }
  return "inviting";
}

// ─── v2: per-day coverage ────────────────────────────────────────────────

export type DayInviteSummary = InviteSummary & { day_date: string };
export type DayAssignmentSummary = AssignmentSummary & { day_date: string };

export type DayCoverage = {
  /** YYYY-MM-DD */
  date: string;
  confirmed: number;
  pending: number;
  declined: number;
  cancelled: number;
  partial: number;
  short: number;
  surplus: number;
  needed: number;
};

export type CoverageByDay = {
  /** One entry per day in `[startsAt..endsAt]` (inclusive), sorted ascending. */
  days: DayCoverage[];
  /** Aggregate totals across every day. */
  total: {
    confirmed: number;
    pending: number;
    declined: number;
    cancelled: number;
    partial: number;
    needed: number;
    short: number;
    surplus: number;
  };
};

/**
 * Enumerate every calendar day touched by `[startsAt..endsAt]` (inclusive)
 * in UTC. We deliberately treat the window as UTC because the day_date
 * column is stored as a plain `date` (no timezone). Callers that want
 * Toronto-local days should pass already-shifted boundaries.
 *
 * Tolerates Date or ISO-string inputs. Returns YYYY-MM-DD strings.
 */
export function enumerateEventDays(
  startsAt: string | Date,
  endsAt: string | Date,
): string[] {
  const start = typeof startsAt === "string" ? new Date(startsAt) : startsAt;
  const end = typeof endsAt === "string" ? new Date(endsAt) : endsAt;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  if (end.getTime() < start.getTime()) return [];

  const startDay = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
  );
  const endDay = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()),
  );
  const out: string[] = [];
  for (
    let cursor = startDay.getTime();
    cursor <= endDay.getTime();
    cursor += 86_400_000
  ) {
    out.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return out;
}

function emptyDayCoverage(date: string, needed: number): DayCoverage {
  return {
    date,
    confirmed: 0,
    pending: 0,
    declined: 0,
    cancelled: 0,
    partial: 0,
    short: Math.max(0, needed),
    surplus: 0,
    needed,
  };
}

/**
 * Per-day coverage. Each day in `[startsAt..endsAt]` gets its own row even
 * if no one was invited yet — that's important for the matrix UI which
 * needs a column per day regardless of fill state.
 *
 * `requiredHeadcount` applies uniformly to every day (matches the v2 spec —
 * Robert's events have the same crew need each day).
 */
export function computeCoverageByDay(
  invites: DayInviteSummary[],
  assignments: DayAssignmentSummary[],
  startsAt: string | Date,
  endsAt: string | Date,
  requiredHeadcount: number,
): CoverageByDay {
  const needed = Math.max(0, requiredHeadcount | 0);
  const dayKeys = enumerateEventDays(startsAt, endsAt);
  const byDay = new Map<string, DayCoverage>(
    dayKeys.map((d) => [d, emptyDayCoverage(d, needed)]),
  );

  for (const a of assignments) {
    const d = byDay.get(a.day_date);
    if (!d) continue; // outside the event window — ignored defensively
    if (a.status === "confirmed" || a.status === "completed") d.confirmed += 1;
    else if (a.status === "cancelled") d.cancelled += 1;
  }
  for (const inv of invites) {
    const d = byDay.get(inv.day_date);
    if (!d) continue;
    if (inv.status === "invited") d.pending += 1;
    else if (inv.status === "declined") d.declined += 1;
    else if (inv.status === "availability_updated") d.partial += 1;
    else if (
      inv.status === "cancelled_by_member" ||
      inv.status === "cancelled_by_manager"
    ) {
      d.cancelled += 1;
    }
  }

  const total = {
    confirmed: 0,
    pending: 0,
    declined: 0,
    cancelled: 0,
    partial: 0,
    needed: 0,
    short: 0,
    surplus: 0,
  };
  for (const d of byDay.values()) {
    d.short = Math.max(0, needed - d.confirmed);
    d.surplus = Math.max(0, d.confirmed - needed);
    total.confirmed += d.confirmed;
    total.pending += d.pending;
    total.declined += d.declined;
    total.cancelled += d.cancelled;
    total.partial += d.partial;
    total.needed += d.needed;
    total.short += d.short;
    total.surplus += d.surplus;
  }

  return {
    days: Array.from(byDay.values()).sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
    ),
    total,
  };
}

/**
 * Convenience: collapse a per-day coverage into a flat v1-shape `Coverage`.
 * Useful when feeding into existing helpers like {@link statusForCoverage}
 * during the v1 → v2 migration window.
 */
export function flattenCoverage(byDay: CoverageByDay): Coverage {
  return {
    confirmed: byDay.total.confirmed,
    pending: byDay.total.pending,
    declined: byDay.total.declined,
    cancelled: byDay.total.cancelled,
    partial: byDay.total.partial,
    short: byDay.total.short,
    surplus: byDay.total.surplus,
    needed: byDay.total.needed,
  };
}

/** True if ANY day is short. */
export function isAnyDayShort(byDay: CoverageByDay): boolean {
  return byDay.days.some((d) => d.short > 0);
}
