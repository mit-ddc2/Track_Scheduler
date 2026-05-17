import Link from "next/link";

import { Btn } from "@/components/ui/Btn";
import { StaffForm } from "@/components/roster/StaffForm";
import {
  listCrewRoles,
  listQualifications,
} from "@/lib/roster/queries";

export const dynamic = "force-dynamic";

export default async function NewStaffPage() {
  const [roles, qualifications] = await Promise.all([
    listCrewRoles(true),
    listQualifications(true),
  ]);

  return (
    <div>
      <div
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "16px 16px 0",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div>
          <span className="cs-eyebrow">New responder</span>
          <h1 className="cs-h1" style={{ marginTop: 4 }}>
            Add staff
          </h1>
        </div>
        <Link href="/dashboard/roster">
          <Btn variant="ghost">Back to roster</Btn>
        </Link>
      </div>
      <StaffForm
        mode="create"
        roles={roles}
        qualifications={qualifications}
      />
    </div>
  );
}
