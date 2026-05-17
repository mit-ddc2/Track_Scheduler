import type { ReactNode } from "react";

import { BottomNav, DeskRail } from "@/components/dashboard/DashboardNav";
import { TopBar } from "@/components/dashboard/TopBar";
import { requireOwner } from "@/lib/auth/require-owner";

// Reads request cookies via Supabase Auth — cannot be prerendered.
export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requireOwner();

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
        <TopBar displayName={session.profile.display_name} />
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
