"use server";

/**
 * RSVP server actions — public flow, NO auth required.
 *
 * This module is a thin wrapper around `./rsvp-handler.ts`. Files marked
 * `"use server"` may only export async functions, so the test seam and the
 * heavyweight implementation live next door; here we just re-export the
 * functions Next.js needs to wire up, with cache invalidation tacked on.
 *
 * All public-facing errors are scrubbed to a generic string before being
 * returned to the client — see SECURITY_AUDIT.md M6.
 */

import { revalidatePath } from "next/cache";

import type { RsvpSubmitInput } from "@/lib/validation/schemas";

import {
  loadInviteByTokenImpl,
  submitRsvpResponseImpl,
} from "./rsvp-handler";

export type { RsvpActionResult } from "./rsvp-handler";

const PUBLIC_ERROR = "Could not process your response. Please try again.";

/** Used by the RSVP page (server) to load + render the invite. */
export async function loadInviteByToken(rawToken: string) {
  return loadInviteByTokenImpl(rawToken);
}

/** Process an accept/decline/cancel/note submission. */
export async function submitRsvpResponse(input: RsvpSubmitInput) {
  let res: Awaited<ReturnType<typeof submitRsvpResponseImpl>>;
  try {
    res = await submitRsvpResponseImpl(input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[rsvp:action] uncaught error:", msg);
    return { ok: false as const, error: PUBLIC_ERROR };
  }
  if (res.ok) {
    // The dashboard subscribes to event_invites realtime in Phase 5b, but we
    // still bust the App Router cache so a manager who is already on the
    // event detail page sees the change on next navigation/refresh.
    // (Token may not directly give us the eventId — load it cheap.)
    try {
      const loaded = await loadInviteByTokenImpl(input.token);
      if (loaded.ok) {
        revalidatePath(`/dashboard/events/${loaded.invite.event_id}`);
      }
    } catch {
      // best effort.
    }
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/events");
  }
  return res;
}
