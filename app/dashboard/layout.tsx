import type { ReactNode } from "react";

import { BottomNav, DeskRail } from "@/components/dashboard/DashboardNav";
import { TopBar } from "@/components/dashboard/TopBar";
import { requireOwner } from "@/lib/auth/require-owner";
import { createClient as createServerClient } from "@/lib/db/supabase-server";

// `requireOwner()` reads cookies, which forces dynamic rendering for every
// request — fresh unread counts on each navigation come from that path, and
// live updates come from the client-side Realtime subscription in
// `NotificationBadge`. A `revalidate` value would be a no-op here, so we
// don't set one.
export const dynamic = "force-dynamic";

// Reads request cookies via Supabase Auth — cannot be prerendered.
export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requireOwner();
  const supabase = await createServerClient();
  const { count } = await supabase
    .from("manager_notifications")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", session.profile.id)
    .eq("status", "unread");

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100dvh",
        background: "var(--bg)",
        color: "var(--text)",
      }}
    >
      <DeskRail />
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <TopBar
          displayName={session.profile.display_name}
          profileId={session.profile.id}
          unreadCount={count ?? 0}
        />
        <main
          style={{
            flex: 1,
            overflowY: "auto",
            minHeight: 0,
          }}
        >
          {children}
        </main>
        <BottomNav />
      </div>
    </div>
  );
}
