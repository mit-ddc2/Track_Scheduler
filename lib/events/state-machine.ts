/**
 * Pure event status transitions. Spec §8.5 / §8.7 plus the design's status
 * chip mapping. The state machine is *pure*: server actions compute the next
 * status from the current row + coverage snapshot and write the result.
 *
 * Terminal states: `cancelled`, `completed`.
 * `needs_review` is set externally by the calendar-sync code paths (deferred
 * to v1.1) — we accept it as a current state but never transition *into* it
 * from this function.
 */

import type { EventStatus } from "@/lib/db/types";

export type StateContext = {
  confirmed: number;
  pending: number;
  needed: number;
  hasInvites: boolean;
  hasReview: boolean;
  cancelled: boolean;
  completed?: boolean;
};

export function nextStatus(
  current: EventStatus,
  ctx: StateContext,
): EventStatus {
  // Terminal states never leave.
  if (current === "cancelled") return "cancelled";
  if (current === "completed") return "completed";

  // External signals override coverage-derived status.
  if (ctx.cancelled) return "cancelled";
  if (ctx.completed) return "completed";

  // `locked` is operator-set and only relaxes via explicit unlock (out of scope here).
  if (current === "locked") return "locked";

  // `needs_review` waits for the operator to clear it (calendar-sync flow).
  if (ctx.hasReview) return "needs_review";
  if (current === "needs_review") return current;

  // From `draft`: become `scheduled` once we have a real start/end (caller
  // responsibility) — once invites go out we move to inviting/underfilled/staffed.
  if (!ctx.hasInvites) {
    return current === "draft" ? "draft" : "scheduled";
  }

  // Invites have been sent — derive from coverage.
  if (ctx.needed > 0 && ctx.confirmed >= ctx.needed) return "staffed";
  if (ctx.confirmed + ctx.pending < ctx.needed) return "underfilled";
  return "inviting";
}
