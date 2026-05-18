/**
 * Non-"use server" module that holds the actual RSVP logic plus the test
 * seam for the admin client. Co-locating it next to the server action keeps
 * the imports tight; `actions.ts` is the thin wrapper required so Next.js
 * recognises the symbols as server actions.
 *
 * Server-only — admin client + node:crypto.
 */

if (typeof window !== "undefined") {
  throw new Error("app/r/[token]/rsvp-handler.ts is server-only");
}

import { writeAudit } from "@/lib/db/audit";
import { createAdminClient } from "@/lib/db/supabase-admin";
import type {
  CoverageByDay,
  DayAssignmentSummary,
  DayInviteSummary,
} from "@/lib/events/coverage";
import {
  computeCoverageByDay,
  enumerateEventDays,
  flattenCoverage,
  isAnyDayShort,
  statusForCoverage,
} from "@/lib/events/coverage";
import { createManagerNotification } from "@/lib/notifications/create-manager-notification";
import { hashRsvpToken } from "@/lib/security/token";
import {
  rsvpSubmitSchema,
  type RsvpActionKind,
  type RsvpSubmitInput,
} from "@/lib/validation/schemas";

export type RsvpActionResult =
  | {
      ok: true;
      state: "accepted" | "declined" | "cancelled" | "note_saved";
    }
  | { ok: false; error: string };

/* eslint-disable @typescript-eslint/no-explicit-any */
type UntypedClient = { from: (table: string) => any };

let adminOverride: UntypedClient | null = null;
export function __setAdminClientForTesting(client: UntypedClient | null) {
  adminOverride = client;
}
function getAdmin(): UntypedClient {
  return adminOverride ?? (createAdminClient() as unknown as UntypedClient);
}

export type LoadedInvite = {
  invite_id: string;
  event_id: string;
  staff_member_id: string;
  status: string;
  token_id: string;
  expires_at: string;
  used_at: string | null;
  // P-H2: hydrate event + staff in the token join so the submit path can
  // skip two follow-up SELECTs.
  event_title?: string;
  event_required_headcount?: number;
  event_status?: string;
  event_starts_at?: string;
  event_ends_at?: string;
  staff_display_name?: string;
};

/**
 * Internal load result — distinguishes specific failure reasons so the
 * server-side can log them. The PUBLIC callers (page + submit route) must
 * collapse these into a single generic "unavailable" state via
 * {@link loadInviteByTokenImpl} — see M3/H3-c in SECURITY_AUDIT.md.
 */
export type InternalInviteLoadResult =
  | { ok: true; invite: LoadedInvite }
  | { ok: false; reason: "invalid" | "expired" | "used" };

/**
 * Public-surface result. Collapses every "can't sign in" reason to a single
 * generic state so the public RSVP page does not leak a token-state oracle to
 * fuzzers. The internal reason is still logged server-side.
 */
export type PublicInviteLoadResult =
  | { ok: true; invite: LoadedInvite }
  | { ok: false; reason: "unavailable" };

const REUSE_GRACE_MS = 24 * 60 * 60 * 1000; // 24h
const LOCKED_EVENT_STATUSES = new Set([
  "cancelled",
  "locked",
  "completed",
  "closed",
]);

/**
 * Internal — returns specific reason codes. Use {@link loadInviteByTokenImpl}
 * for any caller exposed to the public; that wrapper collapses the reason.
 */
export async function loadInviteByTokenInternal(
  rawToken: string,
): Promise<InternalInviteLoadResult> {
  if (!rawToken || rawToken.length < 8 || rawToken.length > 200) {
    return { ok: false, reason: "invalid" };
  }
  let hash: string;
  try {
    hash = hashRsvpToken(rawToken);
  } catch {
    return { ok: false, reason: "invalid" };
  }

  const admin = getAdmin();
  // P-H2: pull token + invite + event + staff in a single SELECT via
  // PostgREST embeds (was 2-4 round-trips). The unit-test MockSupabase
  // doesn't model joined selects, so we fall back to the 2-query path
  // when the embed isn't populated.
  let tokRes: { data: unknown; error: unknown };
  try {
    tokRes = await admin
      .from("rsvp_tokens")
      .select(
        "id, invite_id, expires_at, used_at, event_invites(id, event_id, staff_member_id, status, events(id, title, required_headcount, status, starts_at, ends_at), staff_members(id, display_name))",
      )
      .eq("token_hash", hash)
      .maybeSingle();
  } catch (err) {
    console.error("[rsvp] token lookup threw:", err);
    return { ok: false, reason: "invalid" };
  }
  if (tokRes.error || !tokRes.data) {
    return { ok: false, reason: "invalid" };
  }
  const token = tokRes.data as {
    id: string;
    invite_id: string;
    expires_at: string;
    used_at: string | null;
    event_invites?: {
      id: string;
      event_id: string;
      staff_member_id: string;
      status: string;
      events?: {
        id: string;
        title: string;
        required_headcount: number;
        status: string;
        starts_at: string;
        ends_at: string;
      } | null;
      staff_members?: { id: string; display_name: string } | null;
    } | null;
  };

  let invite: {
    id: string;
    event_id: string;
    staff_member_id: string;
    status: string;
  };
  let eventHydrated:
    | {
        title: string;
        required_headcount: number;
        status: string;
        starts_at: string;
        ends_at: string;
      }
    | null = null;
  let staffHydrated: { display_name: string } | null = null;

  if (token.event_invites) {
    invite = {
      id: token.event_invites.id,
      event_id: token.event_invites.event_id,
      staff_member_id: token.event_invites.staff_member_id,
      status: token.event_invites.status,
    };
    if (token.event_invites.events) {
      eventHydrated = {
        title: token.event_invites.events.title,
        required_headcount: token.event_invites.events.required_headcount,
        status: token.event_invites.events.status,
        starts_at: token.event_invites.events.starts_at,
        ends_at: token.event_invites.events.ends_at,
      };
    }
    if (token.event_invites.staff_members) {
      staffHydrated = {
        display_name: token.event_invites.staff_members.display_name,
      };
    }
  } else {
    // Embed not populated (mock client / older code path): fall back to
    // the legacy invite lookup. Production PostgREST will always populate
    // the embed, so this branch is dead in production.
    let inviteRes: { data: unknown; error: unknown };
    try {
      inviteRes = await admin
        .from("event_invites")
        .select("id, event_id, staff_member_id, status")
        .eq("id", token.invite_id)
        .maybeSingle();
    } catch (err) {
      console.error("[rsvp] invite lookup threw:", err);
      return { ok: false, reason: "invalid" };
    }
    if (inviteRes.error || !inviteRes.data) {
      return { ok: false, reason: "invalid" };
    }
    invite = inviteRes.data as typeof invite;
  }

  if (new Date(token.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }

  // Enforce used_at. Spec allows re-acceptance from declined → accepted while
  // the event is still open, so we permit re-use only when:
  //   (a) the token was used <= REUSE_GRACE_MS ago, AND
  //   (b) the event is not locked / cancelled / completed.
  // Otherwise the token is considered exhausted.
  if (token.used_at) {
    const usedAgeMs = Date.now() - new Date(token.used_at).getTime();
    // Prefer the hydrated event status from the joined SELECT (perf path);
    // fall back to a separate SELECT only when the embed isn't populated
    // (mock client / non-PostgREST path).
    let eventStatus: string = eventHydrated?.status ?? "scheduled";
    if (!eventHydrated) {
      try {
        const evRes = await admin
          .from("events")
          .select("status")
          .eq("id", invite.event_id)
          .maybeSingle();
        eventStatus =
          (evRes.data?.status as string | undefined) ?? "scheduled";
      } catch (err) {
        console.error("[rsvp] event status lookup threw:", err);
      }
    }
    const eventLocked = LOCKED_EVENT_STATUSES.has(eventStatus);
    const inviteFinalised = new Set([
      "accepted",
      "declined",
      "cancelled_by_member",
    ]).has(invite.status);

    if (eventLocked) {
      return { ok: false, reason: "used" };
    }
    if (usedAgeMs > REUSE_GRACE_MS) {
      return { ok: false, reason: "used" };
    }
    // Token was used recently AND event is still open AND the invite is in
    // a finalised state — allow the responder to flip their answer.
    if (!inviteFinalised) {
      // Token was used but invite isn't in a finalised state; treat as used
      // (this shouldn't normally happen but defends against odd states).
      return { ok: false, reason: "used" };
    }
  }

  return {
    ok: true,
    invite: {
      invite_id: invite.id,
      event_id: invite.event_id,
      staff_member_id: invite.staff_member_id,
      status: invite.status,
      token_id: token.id,
      expires_at: token.expires_at,
      used_at: token.used_at,
      event_title: eventHydrated?.title,
      event_required_headcount: eventHydrated?.required_headcount,
      event_status: eventHydrated?.status,
      event_starts_at: eventHydrated?.starts_at,
      event_ends_at: eventHydrated?.ends_at,
      staff_display_name: staffHydrated?.display_name,
    },
  };
}

/**
 * Public wrapper — collapses all failure reasons into a single generic
 * `unavailable` so attackers cannot use the response surface as a
 * token-state oracle (see SECURITY_AUDIT.md H3 / M3).
 *
 * The specific reason is logged server-side for ops debugging.
 */
export async function loadInviteByTokenImpl(
  rawToken: string,
): Promise<PublicInviteLoadResult> {
  const res = await loadInviteByTokenInternal(rawToken);
  if (res.ok) return res;
  // Log the specific reason for ops, but never return it to the caller.
  console.warn(`[rsvp] token load failed: reason=${res.reason}`);
  return { ok: false, reason: "unavailable" };
}

function mapActionToInviteStatus(
  action: RsvpActionKind,
  currentStatus: string,
):
  | "accepted"
  | "declined"
  | "cancelled_by_member"
  | "invited"
  | null {
  switch (action) {
    case "accept":
      return "accepted";
    case "decline":
      return "declined";
    case "cancel":
      if (currentStatus === "accepted") return "cancelled_by_member";
      return null;
    case "update_note":
      return null;
  }
}

const PUBLIC_SAVE_ERROR =
  "Could not process your response. Please try again.";

export async function submitRsvpResponseImpl(
  rawInput: RsvpSubmitInput,
): Promise<RsvpActionResult> {
  const parsed = rsvpSubmitSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid submission",
    };
  }
  const { token, action, note, days: requestedDays } = parsed.data;

  // We need the internal reason for accurate user-facing copy (expired vs
  // unavailable), but we explicitly do NOT leak which one to the public:
  // the form copy reads "no longer valid" for all states except a soft
  // "already-finalised" hint elsewhere in the UI.
  const loaded = await loadInviteByTokenInternal(token);
  if (!loaded.ok) {
    return { ok: false, error: "This invitation link is no longer valid." };
  }

  const { invite } = loaded;
  const admin = getAdmin();

  // P-H2: prefer the hydrated values from loadInviteByTokenInternal's joined
  // SELECT. Only fall back to extra SELECTs when the embed is missing
  // (e.g., in-memory test mocks that don't model joins).
  let staffName: string = invite.staff_display_name ?? "Responder";
  if (!invite.staff_display_name) {
    let staffRes: { data: unknown };
    try {
      staffRes = await admin
        .from("staff_members")
        .select("id, display_name")
        .eq("id", invite.staff_member_id)
        .maybeSingle();
    } catch (err) {
      console.error("[rsvp] staff lookup threw:", err);
      return { ok: false, error: PUBLIC_SAVE_ERROR };
    }
    staffName =
      ((staffRes.data as { display_name?: string } | null)?.display_name as
        | string
        | undefined) ?? "Responder";
  }

  let eventTitle: string = invite.event_title ?? "(untitled event)";
  let requiredHeadcount: number = invite.event_required_headcount ?? 0;
  let currentEventStatus: string = invite.event_status ?? "scheduled";
  let eventStartsAt: string | undefined = invite.event_starts_at;
  let eventEndsAt: string | undefined = invite.event_ends_at;
  if (
    invite.event_title === undefined ||
    invite.event_required_headcount === undefined ||
    invite.event_status === undefined ||
    invite.event_starts_at === undefined ||
    invite.event_ends_at === undefined
  ) {
    let evRes: { data: unknown };
    try {
      evRes = await admin
        .from("events")
        .select("id, title, required_headcount, status, starts_at, ends_at")
        .eq("id", invite.event_id)
        .maybeSingle();
    } catch (err) {
      console.error("[rsvp] event lookup threw:", err);
      return { ok: false, error: PUBLIC_SAVE_ERROR };
    }
    const evData = evRes.data as
      | {
          title?: string;
          required_headcount?: number;
          status?: string;
          starts_at?: string;
          ends_at?: string;
        }
      | null;
    eventTitle = (evData?.title as string | undefined) ?? "(untitled event)";
    requiredHeadcount =
      (evData?.required_headcount as number | undefined) ?? 0;
    currentEventStatus =
      (evData?.status as string | undefined) ?? "scheduled";
    eventStartsAt = evData?.starts_at ?? eventStartsAt;
    eventEndsAt = evData?.ends_at ?? eventEndsAt;
  }

  // v2: resolve which days this submission targets. Falls back to the
  // event's start date when the payload omits it (v1 single-day clients).
  const eventDayList =
    eventStartsAt && eventEndsAt
      ? enumerateEventDays(eventStartsAt, eventEndsAt)
      : [];
  const validDays = new Set(eventDayList);
  const days =
    requestedDays && requestedDays.length > 0
      ? Array.from(new Set(requestedDays)).sort()
      : eventStartsAt
        ? [eventStartsAt.slice(0, 10)]
        : [];

  if (days.length === 0) {
    return { ok: false, error: "invalid_days" };
  }
  if (validDays.size > 0) {
    const outOfRange = days.filter((d) => !validDays.has(d));
    if (outOfRange.length > 0) {
      return { ok: false, error: "invalid_days" };
    }
  }

  const newInviteStatus = mapActionToInviteStatus(action, invite.status);
  if (action === "cancel" && newInviteStatus === null) {
    return {
      ok: false,
      error: "Cancellation is only available after you've accepted.",
    };
  }

  const nowIso = new Date().toISOString();
  const oldStatus = invite.status;

  // v2: load every existing invite row for (event, staff) so we can apply
  // the action per-day. The token-bound invite row remains the audit
  // anchor but the writes fan out across each requested day.
  let existingInvitesByDay = new Map<
    string,
    { id: string; status: string }
  >();
  try {
    const existingRes = await admin
      .from("event_invites")
      .select("id, day_date, status")
      .eq("event_id", invite.event_id)
      .eq("staff_member_id", invite.staff_member_id);
    const existing =
      ((existingRes.data ?? []) as Array<{
        id: string;
        day_date: string;
        status: string;
      }>) ?? [];
    existingInvitesByDay = new Map(
      existing.map((r) => [r.day_date, { id: r.id, status: r.status }]),
    );
  } catch (err) {
    console.warn("[rsvp] existing-invite lookup failed:", err);
  }

  type DayResult = "accepted" | "declined" | "cancelled" | "noop";
  const dayResults: Record<string, DayResult> = {};

  try {
    for (const dayDate of days) {
      const existing = existingInvitesByDay.get(dayDate);
      // Resolve or create the invite row for this day.
      let inviteRowId: string | null = existing?.id ?? null;
      const dayOldStatus = existing?.status ?? "invited";

      if (newInviteStatus) {
        if (inviteRowId) {
          const upd = await admin
            .from("event_invites")
            .update({
              status: newInviteStatus,
              response_note: note ?? null,
              responded_at: nowIso,
              updated_at: nowIso,
            })
            .eq("id", inviteRowId);
          if (upd.error) {
            console.error("[rsvp] invite update error:", upd.error.message);
            return { ok: false, error: PUBLIC_SAVE_ERROR };
          }
        } else {
          // First-time write for this day — happens when the responder
          // accepts a day they weren't explicitly invited to via the link
          // (e.g., a multi-day event where the campaign was scoped to a
          // subset). Insert a fresh invite row tied to this campaign.
          const ins = await admin
            .from("event_invites")
            .insert({
              event_id: invite.event_id,
              staff_member_id: invite.staff_member_id,
              status: newInviteStatus,
              selected_channels: [],
              response_note: note ?? null,
              responded_at: nowIso,
              day_date: dayDate,
            })
            .select("id")
            .single();
          if (ins.error || !ins.data) {
            console.error(
              "[rsvp] invite insert error:",
              ins.error?.message ?? "unknown",
            );
            return { ok: false, error: PUBLIC_SAVE_ERROR };
          }
          inviteRowId = ins.data.id as string;
        }
      } else if (note !== undefined && note !== null && inviteRowId) {
        const upd = await admin
          .from("event_invites")
          .update({
            response_note: note,
            updated_at: nowIso,
          })
          .eq("id", inviteRowId);
        if (upd.error) {
          console.error(
            "[rsvp] invite note update error:",
            upd.error.message,
          );
          return { ok: false, error: PUBLIC_SAVE_ERROR };
        }
      }

      if (!inviteRowId) {
        // Pure note-save with no existing invite for this day — nothing to do.
        dayResults[dayDate] = "noop";
        continue;
      }

      // Per-day response history entry.
      await admin.from("invite_response_history").insert({
        invite_id: inviteRowId,
        event_id: invite.event_id,
        staff_member_id: invite.staff_member_id,
        old_status: dayOldStatus,
        new_status: newInviteStatus ?? dayOldStatus,
        response_note: note ?? null,
        actor_type: "responder_token",
      });

      // Per-day assignment write.
      if (action === "accept") {
        await admin.from("event_assignments").upsert(
          {
            event_id: invite.event_id,
            staff_member_id: invite.staff_member_id,
            invite_id: inviteRowId,
            status: "confirmed",
            confirmed_at: nowIso,
            cancelled_at: null,
            updated_at: nowIso,
            day_date: dayDate,
          },
          { onConflict: "event_id,staff_member_id,day_date" },
        );
        dayResults[dayDate] = "accepted";
      } else if (action === "cancel" || action === "decline") {
        await admin
          .from("event_assignments")
          .update({
            status: "cancelled",
            cancelled_at: nowIso,
            cancellation_reason:
              action === "cancel" ? "member_cancelled" : "member_declined",
            updated_at: nowIso,
          })
          .eq("event_id", invite.event_id)
          .eq("staff_member_id", invite.staff_member_id)
          .eq("day_date", dayDate);
        dayResults[dayDate] = action === "cancel" ? "cancelled" : "declined";
      } else {
        dayResults[dayDate] = "noop";
      }
    }

    if (action !== "update_note") {
      await admin
        .from("rsvp_tokens")
        .update({ used_at: nowIso })
        .eq("id", invite.token_id);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[rsvp] submit DB error:", msg);
    return { ok: false, error: PUBLIC_SAVE_ERROR };
  }

  let coverage: CoverageByDay;
  try {
    coverage = await recomputeCoverageByDay(
      admin,
      invite.event_id,
      eventStartsAt ?? new Date().toISOString(),
      eventEndsAt ?? new Date().toISOString(),
      requiredHeadcount,
    );
  } catch (err) {
    console.error("[rsvp] coverage recompute threw:", err);
    coverage = {
      days: [],
      total: {
        confirmed: 0,
        pending: 0,
        declined: 0,
        cancelled: 0,
        partial: 0,
        needed: requiredHeadcount,
        short: requiredHeadcount,
        surplus: 0,
      },
    };
  }

  try {
    // Event status: derive from the aggregate, but a multi-day event is
    // `underfilled` as long as ANY day is short.
    const flat = flattenCoverage(coverage);
    let nextStatus = statusForCoverage(
      currentEventStatus as Parameters<typeof statusForCoverage>[0],
      flat,
      true,
    );
    if (isAnyDayShort(coverage)) {
      // Override "staffed"/"inviting" to "underfilled" when at least one day
      // hasn't met its headcount yet.
      if (nextStatus === "staffed" || nextStatus === "inviting") {
        nextStatus = "underfilled";
      }
    }
    if (nextStatus !== currentEventStatus) {
      await admin
        .from("events")
        .update({ status: nextStatus, updated_at: nowIso })
        .eq("id", invite.event_id);
    }
  } catch (err) {
    console.error("[rsvp] event status update threw:", err);
  }

  // v2: single notification summarising the per-day outcome.
  const acceptedCount = Object.values(dayResults).filter(
    (r) => r === "accepted",
  ).length;
  const declinedCount = Object.values(dayResults).filter(
    (r) => r === "declined",
  ).length;
  const cancelledCount = Object.values(dayResults).filter(
    (r) => r === "cancelled",
  ).length;
  try {
    await emitManagerNotification({
      action,
      coverage,
      eventId: invite.event_id,
      eventTitle,
      staffName,
      staffMemberId: invite.staff_member_id,
      acceptedDays: acceptedCount,
      declinedDays: declinedCount,
      cancelledDays: cancelledCount,
      totalDays: days.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[rsvp] manager notification skipped: ${msg}`);
  }

  await writeAudit({
    action: `rsvp.${action}`,
    entity_type: "event_invite",
    entity_id: invite.invite_id,
    summary: `${staffName} ${action}ed invitation for "${eventTitle}" (${days.length} day${days.length === 1 ? "" : "s"})`,
    before: { status: oldStatus, days },
    after: {
      status: newInviteStatus ?? oldStatus,
      note: note ?? null,
      days,
      perDay: dayResults,
    },
    actorType: "responder_token",
    actorId: null,
  });

  const resultState =
    action === "accept"
      ? "accepted"
      : action === "decline"
        ? "declined"
        : action === "cancel"
          ? "cancelled"
          : "note_saved";
  return { ok: true, state: resultState };
}

async function recomputeCoverageByDay(
  admin: UntypedClient,
  eventId: string,
  eventStartsAt: string,
  eventEndsAt: string,
  requiredHeadcount: number,
): Promise<CoverageByDay> {
  const [invitesRes, assignmentsRes] = await Promise.all([
    admin
      .from("event_invites")
      .select("status, day_date")
      .eq("event_id", eventId),
    admin
      .from("event_assignments")
      .select("status, day_date")
      .eq("event_id", eventId),
  ]);
  const invites = ((invitesRes.data ?? []) as DayInviteSummary[]) ?? [];
  const assignments =
    ((assignmentsRes.data ?? []) as DayAssignmentSummary[]) ?? [];
  return computeCoverageByDay(
    invites,
    assignments,
    eventStartsAt,
    eventEndsAt,
    requiredHeadcount,
  );
}

async function emitManagerNotification(args: {
  action: RsvpActionKind;
  coverage: CoverageByDay;
  eventId: string;
  eventTitle: string;
  staffName: string;
  staffMemberId: string;
  acceptedDays: number;
  declinedDays: number;
  cancelledDays: number;
  totalDays: number;
}) {
  const {
    action,
    coverage,
    eventId,
    eventTitle,
    staffName,
    staffMemberId,
    acceptedDays,
    declinedDays,
    cancelledDays,
    totalDays,
  } = args;
  const summaryParts: string[] = [];
  if (acceptedDays > 0) summaryParts.push(`${acceptedDays} day(s) accepted`);
  if (declinedDays > 0) summaryParts.push(`${declinedDays} day(s) declined`);
  if (cancelledDays > 0)
    summaryParts.push(`${cancelledDays} day(s) cancelled`);
  if (summaryParts.length === 0) summaryParts.push(`${totalDays} day(s)`);
  const summary = `${eventTitle} — ${summaryParts.join(", ")}`;

  if (action === "accept") {
    await createManagerNotification({
      eventType: "responder.accepted",
      title: `${staffName} accepted`,
      body: summary,
      eventId,
      staffMemberId,
      dedupeKey: `rsvp:accept:${eventId}:${staffMemberId}`,
    });
  } else if (action === "decline") {
    await createManagerNotification({
      eventType: "responder.declined",
      title: `${staffName} declined`,
      body: summary,
      eventId,
      staffMemberId,
      dedupeKey: `rsvp:decline:${eventId}:${staffMemberId}`,
    });
  } else if (action === "cancel") {
    await createManagerNotification({
      eventType: "responder.cancelled",
      title: `${staffName} cancelled`,
      body: summary,
      eventId,
      staffMemberId,
      dedupeKey: `rsvp:cancel:${eventId}:${staffMemberId}:${Date.now()}`,
    });
  }

  if (
    (action === "decline" || action === "cancel") &&
    isAnyDayShort(coverage)
  ) {
    await createManagerNotification({
      eventType: "event.underfilled",
      title: "Event underfilled",
      body: `${eventTitle} — short ${coverage.total.short}`,
      eventId,
      dedupeKey: `event.underfilled:${eventId}:${coverage.total.short}`,
    });
  }
}
