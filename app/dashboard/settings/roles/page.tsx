import Link from "next/link";

import { Btn } from "@/components/ui/Btn";
import { RoleManager } from "@/components/roster/RoleManager";
import { createClient } from "@/lib/db/supabase-server";
import { listCrewRoles } from "@/lib/roster/queries";

export const dynamic = "force-dynamic";

export default async function RolesSettingsPage() {
  const roles = await listCrewRoles(false);
  const supabase = await createClient();
  const { data: staffRoles } = await supabase
    .from("staff_roles")
    .select("role_id");
  const usage: Record<string, number> = {};
  for (const sr of (staffRoles ?? []) as Array<{ role_id: string }>) {
    usage[sr.role_id] = (usage[sr.role_id] ?? 0) + 1;
  }

  return (
    <div
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "16px 16px 80px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <div>
          <span className="cs-eyebrow">Settings</span>
          <h1 className="cs-h1" style={{ marginTop: 4 }}>
            Crew roles
          </h1>
        </div>
        <Link href="/dashboard/settings">
          <Btn variant="ghost">Back</Btn>
        </Link>
      </header>
      <RoleManager roles={roles} usage={usage} />
    </div>
  );
}
