/**
 * Cookie helpers for the underfilled nudge. Split out from the server-action
 * file so non-action helpers (constants, sync reads) can be imported without
 * tripping the `"use server"` "async export only" rule.
 */

import { cookies } from "next/headers";

export const UNDERFILLED_NUDGE_COOKIE_PREFIX = "cs_nudge_dismissed_";

export function nudgeCookieName(eventId: string): string {
  return `${UNDERFILLED_NUDGE_COOKIE_PREFIX}${eventId}`;
}

export async function isUnderfilledNudgeDismissed(
  eventId: string,
): Promise<boolean> {
  const store = await cookies();
  return store.get(nudgeCookieName(eventId))?.value === "1";
}
