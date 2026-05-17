import { redirect } from "next/navigation";

import { createClient } from "@/lib/db/supabase-server";

/**
 * Signs the current user out and bounces them back to /login. Used by the
 * sign-out button on the access-pending page (`app/page.tsx`) and from the
 * dashboard nav. Accepts both GET (link) and POST (form submit) so it works
 * regardless of how it's wired up.
 */
async function handle() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export const GET = handle;
export const POST = handle;
