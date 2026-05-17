import { redirect } from "next/navigation";

import { getSession, type Session } from "./get-session";

/**
 * Guard for owner-only pages and route handlers. Redirects to `/login` if the
 * caller is unauthenticated. Owner-role enforcement is stubbed until the
 * profiles table is in place (Phase 1).
 */
export async function requireOwner(): Promise<Session> {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  // TODO(phase-1): verify session.profile?.role === "owner" and redirect
  // unauthorized users to a 403 page.

  return session;
}
