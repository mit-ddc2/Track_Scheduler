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
  const tokRes = await admin
    .from("rsvp_tokens")
    .select("id, invite_id, expires_at, used_at")
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
  };

  const inviteRes = await admin
    .from("event_invites")
    .select("id, event_id, staff_member_id, status")
    .eq("id", token.invite_id)
    .maybeSingle();
  if (inviteRes.error || !inviteRes.data) {
    return { ok: false, reason: "invalid" };
  }
  const invite = inviteRes.data as {
    id: string;
    event_id: string;
    staff_member_id: string;
    status: string;
  };

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

  const staffRes = await admin
    .from("staff_members")
    .select("id, display_name")
    .eq("id", invite.staff_member_id)
    .maybeSingle();
  const staffName =
    (staffRes.data?.display_name as string | undefined) ?? "Responder";

  const evRes = await admin
    .from("events")
    .select("id, title, required_headcount, status")
    .eq("id", invite.event_id)
    .maybeSingle();
  const eventTitle =
    (evRes.data?.title as string | undefined) ?? "(untitled event)";
  const requiredHeadcount =
    (evRes.data?.required_headcount as number | undefined) ?? 0;
  const currentEventStatus =
    (evRes.data?.status as string | undefined) ?? "scheduled";

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

  await admin.from("invite_response_history").insert({
    invite_id: invite.invite_id,
    event_id: invite.event_id,
    staff_member_id: invite.staff_member_id,
    old_status: oldStatus,
    new_status: newInviteStatus ?? oldStatus,
    response_note: note ?? null,
    actor_type: "responder_token",
  });

  if (action === "accept") {
    const existing = await admin
      .from("event_assignments")
      .select("id, status")
      .eq("event_id", invite.event_id)
      .eq("staff_member_id", invite.staff_member_id)
      .maybeSingle();
    if (existing.data?.id) {
      await admin
        .from("event_assignments")
        .update({
          status: "confirmed",
          confirmed_at: nowIso,
          cancelled_at: null,
          updated_at: nowIso,
        })
        .eq("id", existing.data.id);
    } else {
      const insErr = await admin.from("event_assignments").insert({
        event_id: invite.event_id,
        staff_member_id: invite.staff_member_id,
        invite_id: invite.invite_id,
        status: "confirmed",
        confirmed_at: nowIso,
      });
      if (insErr.error && insErr.error.code !== "23505") {
        console.warn(
          `[rsvp] assignment insert failed: ${insErr.error.message}`,
        );
      }
    }
  } else if (action === "cancel" || action === "decline") {
    const existing = await admin
      .from("event_assignments")
      .select("id")
      .eq("event_id", invite.event_id)
      .eq("staff_member_id", invite.staff_member_id)
      .maybeSingle();
    if (existing.data?.id) {
      await admin
        .from("event_assignments")
        .update({
          status: "cancelled",
          cancelled_at: nowIso,
          cancellation_reason:
            action === "cancel" ? "member_cancelled" : "member_declined",
          updated_at: nowIso,
        })
        .eq("id", existing.data.id);
    }
  }

  if (action !== "update_note") {
    await admin
      .from("rsvp_tokens")
      .update({ used_at: nowIso })
      .eq("id", invite.token_id);
  }

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
