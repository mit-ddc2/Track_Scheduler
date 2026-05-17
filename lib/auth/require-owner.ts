import { redirect } from "next/navigation";

import { getSession, type Session } from "./get-session";

/**
 * Guard for owner-only pages and Route Handlers. Redirects to `/login` if
 * the caller is unauthenticated OR not flagged as an owner in `profiles`.
 *
 * Returns a `Session` whose `profile` is guaranteed non-null with
 * `is_owner === true`.
 */
export async function requireOwner(): Promise<
  Session & { profile: NonNullable<Session["profile"]> }
> {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  if (!session.profile || session.profile.is_owner !== true) {
    redirect("/login");
  }

  return session as Session & { profile: NonNullable<Session["profile"]> };
}
