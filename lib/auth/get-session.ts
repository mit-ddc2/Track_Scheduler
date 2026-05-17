import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/db/supabase-server";
import type { Profile } from "@/lib/db/types";

export type Session = {
  user: User;
  profile: Profile | null;
};

/**
 * Returns the current authenticated session plus the matching profile row,
 * or `null` if no user is signed in. Profile may be `null` for a brief
 * window right after first sign-in if the `on_auth_user_created` trigger
 * hasn't fired yet — callers should treat that as "not yet authorized".
 */
export async function getSession(): Promise<Session | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "id, display_name, email, is_owner, is_active, phone_for_alerts, created_at, updated_at",
    )
    .eq("id", user.id)
    .maybeSingle();

  return {
    user,
    profile: (profile as Profile | null) ?? null,
  };
}
