import Link from "next/link";

import { Btn } from "@/components/ui/Btn";
import { QualificationManager } from "@/components/roster/QualificationManager";
import { createClient } from "@/lib/db/supabase-server";
import { listQualifications } from "@/lib/roster/queries";

export const dynamic = "force-dynamic";

export default async function QualificationsSettingsPage() {
  const qualifications = await listQualifications(false);
  const supabase = await createClient();
  const { data: staffQuals } = await supabase
    .from("staff_qualifications")
    .select("qualification_id");
  const usage: Record<string, number> = {};
  for (const sq of (staffQuals ?? []) as Array<{ qualification_id: string }>) {
    usage[sq.qualification_id] = (usage[sq.qualification_id] ?? 0) + 1;
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
            Qualifications
          </h1>
        </div>
        <Link href="/dashboard/settings">
          <Btn variant="ghost">Back</Btn>
        </Link>
      </header>
      <QualificationManager qualifications={qualifications} usage={usage} />
    </div>
  );
}
