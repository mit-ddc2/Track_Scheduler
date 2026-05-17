import Link from "next/link";
import { notFound } from "next/navigation";

import { Btn } from "@/components/ui/Btn";
import { StaffForm, type StaffFormInitial } from "@/components/roster/StaffForm";
import {
  getStaffById,
  listCrewRoles,
  listQualifications,
} from "@/lib/roster/queries";

export const dynamic = "force-dynamic";

type Params = Promise<{ staffId: string }>;

export default async function EditStaffPage({ params }: { params: Params }) {
  const { staffId } = await params;
  const [staff, roles, qualifications] = await Promise.all([
    getStaffById(staffId),
    listCrewRoles(true),
    listQualifications(true),
  ]);
  if (!staff) notFound();

  const sms = staff.contact_methods.find((c) => c.channel === "sms");
  const email = staff.contact_methods.find((c) => c.channel === "email");
  const primaryRole = staff.staff_roles.find((r) => r.is_primary);

  const initial: StaffFormInitial = {
    id: staff.id,
    display_name: staff.display_name,
    first_name: staff.first_name,
    last_name: staff.last_name,
    phone: sms?.value ?? "",
    email: email?.value ?? "",
    preferred_contact: staff.preferred_contact,
    notes: staff.notes,
    active: staff.active,
    role_ids: staff.staff_roles.map((r) => r.role_id),
    primary_role_id: primaryRole?.role_id ?? null,
    qualification_ids: staff.staff_qualifications.map((q) => q.qualification_id),
    consent_sms: sms?.consent === "granted",
    consent_email: email?.consent === "granted",
  };

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
          <span className="cs-eyebrow">Edit responder</span>
          <h1 className="cs-h1" style={{ marginTop: 4 }}>
            {staff.display_name}
          </h1>
        </div>
        <Link href={`/dashboard/roster/${staff.id}`}>
          <Btn variant="ghost">Back</Btn>
        </Link>
      </div>
      <StaffForm
        mode="edit"
        initial={initial}
        roles={roles}
        qualifications={qualifications}
      />
    </div>
  );
}
