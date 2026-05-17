import type { ReactNode } from "react";

import { BottomNav, DeskRail } from "@/components/dashboard/DashboardNav";
import { TopBar } from "@/components/dashboard/TopBar";
import { requireOwner } from "@/lib/auth/require-owner";
import { createClient as createServerClient } from "@/lib/db/supabase-server";

// The unread count is mildly stale-tolerant — the client-side
// NotificationBadge re-fetches and subscribes to Realtime, so the SSR value
// only needs to be roughly correct on first paint. Re-render every 30s for
// users without a live socket.
export const revalidate = 30;

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
