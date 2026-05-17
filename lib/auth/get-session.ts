import { createServerClient } from "@/lib/db/supabase-server";

export type SessionProfile = {
  id: string;
  role: "owner" | "viewer";
} | null;

export type Session = {
  user: { id: string; email: string | null };
  profile: SessionProfile;
};

/**
 * Returns the current authenticated session, or `null` if no user is signed in.
 * Profile lookup is stubbed until the `profiles` table lands in Phase 1.
 */
export async function getSession(): Promise<Session | null> {
  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // TODO(phase-1): join with profiles table to load role + display info.
  const profile: SessionProfile = null;

  return {
    user: { id: user.id, email: user.email ?? null },
    profile,
  };
}
