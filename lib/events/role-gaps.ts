/**
 * Compute how short each requirement on an event is, by role. Used by the
 * underfilled nudge on the event detail page.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/events/role-gaps.ts is server-only");
}

import { createClient as createServerClient } from "@/lib/db/supabase-server";

export type RoleGap = {
  /** Short display label — falls back to the role name when no short code. */
  label: string;
  shortBy: number;
};

type RoleRow = {
  id: string;
  name: string;
};

type RequirementRow = {
  id: string;
  label: string;
  required_count: number;
  role_id: string | null;
};

type AssignmentRow = {
  status: string;
  role_id: string | null;
  requirement_id: string | null;
};

/**
 * For each event_requirement, compare `required_count` to confirmed
 * assignments matching that requirement OR (if no explicit requirement_id on
 * the assignment) the requirement's role. Returns one `RoleGap` per
 * still-underfilled requirement.
 *
 * `label` is normalised to uppercase + condensed (so "Extrication" → "EXTR"
 * when role names follow the spec's short-code convention).
 */
export async function fetchRoleGaps(eventId: string): Promise<RoleGap[]> {
  const supabase = await createServerClient();
  const [reqRes, asgRes] = await Promise.all([
    supabase
      .from("event_requirements")
      .select("id, label, required_count, role_id")
      .eq("event_id", eventId),
    supabase
      .from("event_assignments")
      .select("status, role_id, requirement_id")
      .eq("event_id", eventId),
  ]);

  const requirements = (reqRes.data ?? []) as RequirementRow[];
  if (requirements.length === 0) return [];
  const assignments = (asgRes.data ?? []) as AssignmentRow[];

  // Pull role names so we can render short labels. Cheap — there are only
  // a handful of role rows in any realistic deployment.
  const roleIds = Array.from(
    new Set(
      requirements.map((r) => r.role_id).filter((id): id is string => Boolean(id)),
    ),
  );
  let roles: RoleRow[] = [];
  if (roleIds.length > 0) {
    const { data } = await supabase
      .from("crew_roles")
      .select("id, name")
      .in("id", roleIds);
    roles = (data ?? []) as RoleRow[];
  }
  const roleNameById = new Map(roles.map((r) => [r.id, r.name]));

  const confirmedAssignments = assignments.filter(
    (a) => a.status === "confirmed" || a.status === "completed",
  );

  const gaps: RoleGap[] = [];
  for (const req of requirements) {
    const filled = confirmedAssignments.filter((a) => {
      if (a.requirement_id && a.requirement_id === req.id) return true;
      if (!a.requirement_id && req.role_id && a.role_id === req.role_id)
        return true;
      return false;
    }).length;
    const shortBy = Math.max(0, req.required_count - filled);
    if (shortBy <= 0) continue;
    const roleName = req.role_id ? roleNameById.get(req.role_id) : undefined;
    const label = condenseRoleLabel(req.label, roleName);
    gaps.push({ label, shortBy });
  }
  return gaps;
}

/**
 * Pure helper exported for tests + reuse. Prefers the role name (which spec
 * §2.4 keeps short — "EXTR", "MED", "LEAD") over the verbose requirement
 * label when both are present.
 */
export function condenseRoleLabel(
  reqLabel: string,
  roleName: string | undefined,
): string {
  const source = roleName?.trim() || reqLabel.trim();
  // If the source is already short and looks like a code, return as-is.
  if (/^[A-Z]{2,5}$/.test(source)) return source;
  // Take the first word, drop non-letters, uppercase, truncate to 4 chars.
  const firstWord = source.split(/\s+/)[0]?.replace(/[^A-Za-z]/g, "") ?? source;
  return firstWord.slice(0, 4).toUpperCase();
}
