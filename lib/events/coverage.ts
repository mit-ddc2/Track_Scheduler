/**
 * Pure coverage math. Mirrors §8.7 of the engineering spec.
 *
 * Counts are derived from invite + assignment summaries so the same function
 * can run in tests, server actions, and (later) realtime subscriptions.
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
