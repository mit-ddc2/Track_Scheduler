/**
 * Replacement-candidate ranking (spec §8.11).
 *
 * The pure ranker + scorer live here so unit tests can import them with no
 * Supabase / "server-only" boundary in the way. The server-side data
 * fetcher `getReplacementCandidates` lives alongside in
 * `./replacement-candidates-fetch.ts` and re-composes this module.
 */

import type {
  ConsentStatus,
  ContactChannel,
  ContactStatus,
  PreferredContactMethod,
} from "@/lib/db/types";

// ─── Inputs ──────────────────────────────────────────────────────────────

export type CandidateContactMethod = {
  channel: ContactChannel;
  status: ContactStatus;
  consent: ConsentStatus;
  /** ISO timestamp (or null). Used for "last contacted older first" tiebreak. */
  last_delivery_at?: string | null;
};

export type CandidateStaff = {
  id: string;
  display_name: string;
  active: boolean;
  preferred_contact: PreferredContactMethod;
  /** Role IDs this staff holds (any). */
  role_ids: string[];
  /** Qualification IDs this staff holds (any). */
  qualification_ids: string[];
  contact_methods: CandidateContactMethod[];
};

export type CandidateRequirement = {
  /** Free-form label used for UI chips ("EXTR", "MED"). */
  label: string;
  role_id: string | null;
  qualification_id: string | null;
  required_count: number;
};

export type ExistingAssignment = {
  staff_member_id: string;
  /** Drop anyone whose assignment is in confirmed | waitlisted | completed. */
  status: "confirmed" | "waitlisted" | "cancelled" | "completed";
};

export type ExistingInvite = {
  staff_member_id: string;
  status:
    | "created"
    | "invited"
    | "accepted"
    | "declined"
    | "cancelled_by_member"
    | "cancelled_by_manager"
    | "availability_updated"
    | "expired"
    | "waitlisted";
};

export type AttendanceFact = {
  staff_member_id: string;
  /** ISO timestamp of the last completed/worked attendance for the staff member. */
  last_worked_at: string;
};

export type Contactability = "sms+email" | "sms" | "email" | "manual_only";

export type CandidateMatches = {
  role: boolean;
  /** Names of matched qualifications, ordered as supplied in `requirements`. */
  quals: string[];
  hasSms: boolean;
  hasEmail: boolean;
};

export type RankedCandidate = {
  staff: CandidateStaff;
  score: number;
  matches: CandidateMatches;
  /** Days since the last completed attendance, or `null` if never worked. */
  lastWorkedAgo: number | null;
  contactability: Contactability;
};

export type RankOptions = {
  /**
   * When true, declined invitees are still candidates (manager wants to
   * pester again). Default false.
   */
  includeDeclined?: boolean;
  /**
   * Channel the manager intends to use; opt-outs for that channel knock
   * the candidate out entirely. Default is "any" — only filter people who
   * have no usable channel at all.
   */
  channel?: ContactChannel | "any";
};

export type RankInput = {
  staff: CandidateStaff[];
  requirements: CandidateRequirement[];
  assignments: ExistingAssignment[];
  invites: ExistingInvite[];
  /** Last completed/worked attendance per staff_member_id. */
  recentAttendance: AttendanceFact[];
  /** Defaults to now(); injectable for stable tests. */
  now?: Date;
  options?: RankOptions;
};

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Apply the spec §8.11 filter rules and return the ranked candidate list.
 *
 * Pure — no Supabase, no Date.now (when `now` provided). Throws nothing;
 * malformed inputs are filtered out the same as "no usable contact".
 */
export function rankCandidates(input: RankInput): RankedCandidate[] {
  const now = input.now ?? new Date();
  const channel = input.options?.channel ?? "any";
  const includeDeclined = input.options?.includeDeclined === true;

  const assignedOut = new Set<string>();
  for (const a of input.assignments) {
    if (
      a.status === "confirmed" ||
      a.status === "waitlisted" ||
      a.status === "completed"
    ) {
      assignedOut.add(a.staff_member_id);
    }
  }

  const acceptedFromInvite = new Set<string>();
  const declinedSet = new Set<string>();
  for (const inv of input.invites) {
    if (inv.status === "accepted") acceptedFromInvite.add(inv.staff_member_id);
    if (inv.status === "declined") declinedSet.add(inv.staff_member_id);
  }

  const attendanceById = new Map<string, string>();
  for (const a of input.recentAttendance) {
    const existing = attendanceById.get(a.staff_member_id);
    if (!existing || existing < a.last_worked_at) {
      attendanceById.set(a.staff_member_id, a.last_worked_at);
    }
  }

  const ranked: RankedCandidate[] = [];
  const lastContactedByStaff = new Map<string, string | null>();

  for (const staff of input.staff) {
    if (!staff.active) continue;
    if (assignedOut.has(staff.id)) continue;
    if (acceptedFromInvite.has(staff.id)) continue;
    if (!includeDeclined && declinedSet.has(staff.id)) continue;

    const sms = pickUsable(staff.contact_methods, "sms");
    const email = pickUsable(staff.contact_methods, "email");
    const hasSms = Boolean(sms);
    const hasEmail = Boolean(email);

    // Has at least one usable channel?
    if (!hasSms && !hasEmail) continue;

    // Honour explicit channel preference (e.g. campaign is SMS-only).
    if (channel === "sms" && !hasSms) continue;
    if (channel === "email" && !hasEmail) continue;

    const contactability = contactabilityFor(
      hasSms,
      hasEmail,
      staff.preferred_contact,
    );

    const matches = computeMatches(staff, input.requirements, hasSms, hasEmail);

    const lastWorkedIso = attendanceById.get(staff.id) ?? null;
    const lastWorkedAgo =
      lastWorkedIso !== null ? daysBetween(lastWorkedIso, now) : null;

    const lastContactedIso = newestDeliveryIso(staff.contact_methods);

    const score = scoreCandidate({
      staff,
      requirements: input.requirements,
      matches,
      lastWorkedAgo,
      contactability,
    });

    ranked.push({
      staff,
      score,
      matches,
      lastWorkedAgo,
      contactability,
    });

    lastContactedByStaff.set(staff.id, lastContactedIso);
  }

  return ranked.sort((a, b) => compareCandidates(a, b, lastContactedByStaff));
}

/**
 * 0–99 fit score. Display-only; the sort comparator is authoritative.
 * Mirrors §8.11's order: role/qual > contactability > fairness.
 */
export function scoreCandidate({
  requirements,
  matches,
  lastWorkedAgo,
  contactability,
}: {
  staff: CandidateStaff;
  requirements: CandidateRequirement[];
  matches: CandidateMatches;
  lastWorkedAgo: number | null;
  contactability: Contactability;
}): number {
  let s = 0;

  // Role match (only counts if event has structured requirements).
  const hasReqs = requirements.length > 0;
  if (hasReqs) {
    if (matches.role) s += 35;
    s += Math.min(matches.quals.length * 10, 20);
  } else {
    // No structured reqs: baseline so unranked events still distribute scores.
    s += 20;
  }

  // Contactability.
  s +=
    contactability === "sms+email"
      ? 25
      : contactability === "sms"
        ? 18
        : contactability === "email"
          ? 12
          : 4;

  // Fairness — never-worked beats freshly-worked, with a soft ceiling at 60 d.
  if (lastWorkedAgo === null) {
    s += 18;
  } else {
    s += Math.min(Math.round((lastWorkedAgo / 60) * 18), 18);
  }

  return Math.max(0, Math.min(99, Math.round(s)));
}

// ─── Sort comparator ─────────────────────────────────────────────────────

function compareCandidates(
  a: RankedCandidate,
  b: RankedCandidate,
  lastContactedByStaff: Map<string, string | null>,
): number {
  // 1. Role/qual match: role first, then quals count.
  if (a.matches.role !== b.matches.role) return a.matches.role ? -1 : 1;
  if (a.matches.quals.length !== b.matches.quals.length) {
    return b.matches.quals.length - a.matches.quals.length;
  }

  // 2. Contactability tier.
  const ca = CONTACTABILITY_RANK[a.contactability];
  const cb = CONTACTABILITY_RANK[b.contactability];
  if (ca !== cb) return ca - cb;

  // 3. Fairness — null (never worked) is "infinity" days ago, ranks first.
  const aw = a.lastWorkedAgo === null ? Number.POSITIVE_INFINITY : a.lastWorkedAgo;
  const bw = b.lastWorkedAgo === null ? Number.POSITIVE_INFINITY : b.lastWorkedAgo;
  if (aw !== bw) return bw - aw;

  // 4. Last contacted older first (older = lower ISO string).
  const ac = lastContactedByStaff.get(a.staff.id) ?? null;
  const bc = lastContactedByStaff.get(b.staff.id) ?? null;
  if (ac !== bc) {
    if (ac === null) return -1;
    if (bc === null) return 1;
    if (ac < bc) return -1;
    if (ac > bc) return 1;
  }

  // 5. Name alphabetical.
  return a.staff.display_name.localeCompare(b.staff.display_name);
}

const CONTACTABILITY_RANK: Record<Contactability, number> = {
  "sms+email": 0,
  sms: 1,
  email: 2,
  manual_only: 3,
};

// ─── Internals ───────────────────────────────────────────────────────────

const UNUSABLE_STATUSES = new Set<ContactStatus>([
  "opted_out",
  "bounced",
  "invalid",
  "suppressed",
]);

const WITHDRAWN_CONSENT = new Set<ConsentStatus>(["withdrawn", "denied"]);

function pickUsable(
  methods: CandidateContactMethod[],
  channel: ContactChannel,
): CandidateContactMethod | null {
  for (const m of methods) {
    if (m.channel !== channel) continue;
    if (UNUSABLE_STATUSES.has(m.status)) continue;
    if (WITHDRAWN_CONSENT.has(m.consent)) continue;
    return m;
  }
  return null;
}

function contactabilityFor(
  hasSms: boolean,
  hasEmail: boolean,
  preferred: PreferredContactMethod,
): Contactability {
  if (preferred === "manual_only") return "manual_only";
  if (hasSms && hasEmail) return "sms+email";
  if (hasSms) return "sms";
  if (hasEmail) return "email";
  return "manual_only";
}

function computeMatches(
  staff: CandidateStaff,
  requirements: CandidateRequirement[],
  hasSms: boolean,
  hasEmail: boolean,
): CandidateMatches {
  let role = false;
  const quals: string[] = [];

  if (requirements.length === 0) {
    return { role: false, quals, hasSms, hasEmail };
  }

  const staffRoleSet = new Set(staff.role_ids);
  const staffQualSet = new Set(staff.qualification_ids);

  for (const req of requirements) {
    if (req.role_id && staffRoleSet.has(req.role_id)) role = true;
    if (req.qualification_id && staffQualSet.has(req.qualification_id)) {
      if (!quals.includes(req.label)) quals.push(req.label);
    }
  }

  return { role, quals, hasSms, hasEmail };
}

function newestDeliveryIso(methods: CandidateContactMethod[]): string | null {
  let newest: string | null = null;
  for (const m of methods) {
    const v = m.last_delivery_at ?? null;
    if (!v) continue;
    if (newest === null || v > newest) newest = v;
  }
  return newest;
}

function daysBetween(iso: string, now: Date): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  const ms = now.getTime() - then;
  return Math.max(0, Math.floor(ms / (24 * 3600 * 1000)));
}
