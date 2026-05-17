import { RosterListView } from "@/components/roster/RosterListView";
import {
  listCrewRoles,
  listStaff,
  summarize,
} from "@/lib/roster/queries";

export const dynamic = "force-dynamic";

export default async function RosterPage() {
  const [staff, roles] = await Promise.all([
    listStaff(),
    listCrewRoles(true),
  ]);
  const rows = staff.map(summarize);
  const roleNames = roles.map((r) => r.name);
  return <RosterListView rows={rows} roleNames={roleNames} />;
}
