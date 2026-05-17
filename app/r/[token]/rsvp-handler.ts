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
  AssignmentSummary,
  Coverage,
  InviteSummary,
} from "@/lib/events/coverage";
import { computeCoverage, statusForCoverage } from "@/lib/events/coverage";
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
  staff_display_name?: string;
};

export async function loadInviteByTokenImpl(rawToken: string): Promise<
  | { ok: true; invite: LoadedInvite }
  | { ok: false; reason: "invalid" | "expired" | "used" }
> {
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
  const tokRes = await admin
    .from("rsvp_tokens")
    .select(
      "id, invite_id, expires_at, used_at, event_invites(id, event_id, staff_member_id, status, events(id, title, required_headcount, status), staff_members(id, display_name))",
    )
    .eq("token_hash", hash)
    .maybeSingle();
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
    | { title: string; required_headcount: number; status: string }
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
    const inviteRes = await admin
      .from("event_invites")
      .select("id, event_id, staff_member_id, status")
      .eq("id", token.invite_id)
      .maybeSingle();
    if (inviteRes.error || !inviteRes.data) {
      return { ok: false, reason: "invalid" };
    }
    invite = inviteRes.data as typeof invite;
  }

  if (new Date(token.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
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
      staff_display_name: staffHydrated?.display_name,
    },
  };
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
  const { token, action, note } = parsed.data;

  const loaded = await loadInviteByTokenImpl(token);
  if (!loaded.ok) {
    if (loaded.reason === "expired") {
      return { ok: false, error: "This invitation link has expired." };
    }
    if (loaded.reason === "used") {
      return { ok: false, error: "This invitation link has already been used." };
    }
    return { ok: false, error: "This invitation link is no longer valid." };
  }

  const { invite } = loaded;
  const admin = getAdmin();

  // P-H2: prefer the hydrated values from loadInviteByTokenImpl's joined
  // SELECT. Only fall back to extra SELECTs when the embed is missing
  // (e.g., in-memory test mocks that don't model joins).
  let staffName = invite.staff_display_name ?? null;
  if (!staffName) {
    const staffRes = await admin
      .from("staff_members")
      .select("id, display_name")
      .eq("id", invite.staff_member_id)
      .maybeSingle();
    staffName =
      (staffRes.data?.display_name as string | undefined) ?? "Responder";
  }

  let eventTitle = invite.event_title ?? null;
  let requiredHeadcount = invite.event_required_headcount;
  let currentEventStatus = invite.event_status ?? null;
  if (!eventTitle || requiredHeadcount === undefined || !currentEventStatus) {
    const evRes = await admin
      .from("events")
      .select("id, title, required_headcount, status")
      .eq("id", invite.event_id)
      .maybeSingle();
    eventTitle =
      (evRes.data?.title as string | undefined) ?? "(untitled event)";
    requiredHeadcount =
      (evRes.data?.required_headcount as number | undefined) ?? 0;
    currentEventStatus =
      (evRes.data?.status as string | undefined) ?? "scheduled";
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

  if (newInviteStatus) {
    const upd = await admin
      .from("event_invites")
      .update({
        status: newInviteStatus,
        response_note: note ?? null,
        responded_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", invite.invite_id);
    if (upd.error) {
      return {
        ok: false,
        error: `Could not save your response: ${upd.error.message}`,
      };
    }
  } else if (note !== undefined && note !== null) {
    const upd = await admin
      .from("event_invites")
      .update({
        response_note: note,
        updated_at: nowIso,
      })
      .eq("id", invite.invite_id);
    if (upd.error) {
      return { ok: false, error: `Could not save your note: ${upd.error.message}` };
    }
  }

  // P-H2: response history insert, assignment write, and rsvp_tokens
  // update are all independent — fan them out via Promise.all instead of
  // running serially. The assignment write is a single upsert on the
  // (event_id, staff_member_id) unique key instead of select-then-
  // update-or-insert (cuts 1 round-trip).
  const writes: Array<Promise<unknown>> = [];

  writes.push(
    admin.from("invite_response_history").insert({
      invite_id: invite.invite_id,
      event_id: invite.event_id,
      staff_member_id: invite.staff_member_id,
      old_status: oldStatus,
      new_status: newInviteStatus ?? oldStatus,
      response_note: note ?? null,
      actor_type: "responder_token",
    }),
  );

  if (action === "accept") {
    writes.push(
      admin
        .from("event_assignments")
        .upsert(
          {
            event_id: invite.event_id,
            staff_member_id: invite.staff_member_id,
            invite_id: invite.invite_id,
            status: "confirmed",
            confirmed_at: nowIso,
            cancelled_at: null,
            updated_at: nowIso,
          },
          { onConflict: "event_id,staff_member_id" },
        ),
    );
  } else if (action === "cancel" || action === "decline") {
    // For cancel/decline we only update existing assignments (no insert).
    // .update().eq().eq() is a single round-trip — no need to SELECT first.
    writes.push(
      admin
        .from("event_assignments")
        .update({
          status: "cancelled",
          cancelled_at: nowIso,
          cancellation_reason:
            action === "cancel" ? "member_cancelled" : "member_declined",
          updated_at: nowIso,
        })
        .eq("event_id", invite.event_id)
        .eq("staff_member_id", invite.staff_member_id),
    );
  }

  if (action !== "update_note") {
    writes.push(
      admin
        .from("rsvp_tokens")
        .update({ used_at: nowIso })
        .eq("id", invite.token_id),
    );
  }

  await Promise.all(writes);

  const coverage = await recomputeCoverage(admin, invite.event_id, requiredHeadcount);
  const nextStatus = statusForCoverage(
    currentEventStatus as Parameters<typeof statusForCoverage>[0],
    coverage,
    true,
  );
  if (nextStatus !== currentEventStatus) {
    await admin
      .from("events")
      .update({ status: nextStatus, updated_at: nowIso })
      .eq("id", invite.event_id);
  }

  try {
    await emitManagerNotification({
      action,
      coverage,
      eventId: invite.event_id,
      eventTitle,
      staffName,
      staffMemberId: invite.staff_member_id,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[rsvp] manager notification skipped: ${msg}`);
  }

  await writeAudit({
    action: `rsvp.${action}`,
    entity_type: "event_invite",
    entity_id: invite.invite_id,
    summary: `${staffName} ${action}ed invitation for "${eventTitle}"`,
    before: { status: oldStatus },
    after: {
      status: newInviteStatus ?? oldStatus,
      note: note ?? null,
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

async function recomputeCoverage(
  admin: UntypedClient,
  eventId: string,
  requiredHeadcount: number,
): Promise<Coverage> {
  const [invitesRes, assignmentsRes] = await Promise.all([
    admin.from("event_invites").select("status").eq("event_id", eventId),
    admin.from("event_assignments").select("status").eq("event_id", eventId),
  ]);
  const invites = ((invitesRes.data ?? []) as InviteSummary[]) ?? [];
  const assignments =
    ((assignmentsRes.data ?? []) as AssignmentSummary[]) ?? [];
  return computeCoverage(invites, assignments, requiredHeadcount);
}

async function emitManagerNotification(args: {
  action: RsvpActionKind;
  coverage: Coverage;
  eventId: string;
  eventTitle: string;
  staffName: string;
  staffMemberId: string;
}) {
  const { action, coverage, eventId, eventTitle, staffName, staffMemberId } =
    args;
  if (action === "accept") {
    await createManagerNotification({
      eventType: "responder.accepted",
      title: `${staffName} accepted`,
      body: eventTitle,
      eventId,
      staffMemberId,
      dedupeKey: `rsvp:accept:${eventId}:${staffMemberId}`,
    });
  } else if (action === "decline") {
    await createManagerNotification({
      eventType: "responder.declined",
      title: `${staffName} declined`,
      body: eventTitle,
      eventId,
      staffMemberId,
      dedupeKey: `rsvp:decline:${eventId}:${staffMemberId}`,
    });
  } else if (action === "cancel") {
    await createManagerNotification({
      eventType: "responder.cancelled",
      title: `${staffName} cancelled`,
      body: eventTitle,
      eventId,
      staffMemberId,
      dedupeKey: `rsvp:cancel:${eventId}:${staffMemberId}:${Date.now()}`,
    });
  }

  if ((action === "decline" || action === "cancel") && coverage.short > 0) {
    await createManagerNotification({
      eventType: "event.underfilled",
      title: "Event underfilled",
      body: `${eventTitle} — short ${coverage.short}`,
      eventId,
      dedupeKey: `event.underfilled:${eventId}:${coverage.short}`,
    });
  }
}
