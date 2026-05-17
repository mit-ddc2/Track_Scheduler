"use server";

import { cookies } from "next/headers";

import {
  isUnderfilledNudgeDismissed as readDismissed,
  nudgeCookieName,
} from "./underfilled-nudge-cookie";

/**
 * Server action that sets a session cookie marking the underfilled nudge as
 * dismissed for a single event. Uses session-scoped cookies (no `expires`)
 * so the banner re-appears in a new browser session.
 */
export async function dismissUnderfilledNudge(eventId: string): Promise<void> {
  const store = await cookies();
  store.set(nudgeCookieName(eventId), "1", {
    httpOnly: false,
    sameSite: "lax",
    path: "/dashboard",
    // No expires → session cookie.
  });
}

/**
 * Server-side read used by the event detail page to decide whether to render
 * the nudge. Re-exported as an async wrapper so it can sit alongside the
 * server action in this `"use server"` module.
 */
export async function isUnderfilledNudgeDismissed(
  eventId: string,
): Promise<boolean> {
  return readDismissed(eventId);
}
