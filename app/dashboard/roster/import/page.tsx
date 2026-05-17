import Link from "next/link";

import { Btn } from "@/components/ui/Btn";
import { ImportWizard } from "@/components/roster/ImportWizard";
import { asContactSummaries, listStaff } from "@/lib/roster/queries";

export const dynamic = "force-dynamic";

export default async function ImportRosterPage() {
  const staff = await listStaff();
  const existingContacts = asContactSummaries(staff);

  return (
    <div
      style={{
        maxWidth: 980,
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
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div>
          <span className="cs-eyebrow">Roster</span>
          <h1 className="cs-h1" style={{ marginTop: 4 }}>
            Import CSV
          </h1>
        </div>
        <Link href="/dashboard/roster">
          <Btn variant="ghost">Back to roster</Btn>
        </Link>
      </header>

      <ImportWizard existingContacts={existingContacts} />
    </div>
  );
}
