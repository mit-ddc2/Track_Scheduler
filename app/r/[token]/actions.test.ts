import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MockSupabase } from "@/lib/messaging/__mocks__/admin-client";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/db/audit", () => ({
  writeAudit: vi.fn(async () => {}),
}));

vi.mock("@/lib/notifications/create-manager-notification", () => ({
  createManagerNotification: vi.fn(async () => ({ created: true, notification: null })),
}));

type AdminLike = ReturnType<typeof import("@/lib/db/supabase-admin").createAdminClient>;

let db: MockSupabase;
let mod: typeof import("./rsvp-handler");
let token: typeof import("@/lib/security/token");

const EVENT_ID = "00000000-0000-0000-0000-000000000010";
const STAFF_ID = "00000000-0000-0000-0000-00000000001a";
const INVITE_ID = "00000000-0000-0000-0000-00000000001b";
const TOKEN_ID = "00000000-0000-0000-0000-00000000001c";

function seedTokenAndInvite(opts?: {
  expiresAt?: string;
  usedAt?: string | null;
  status?: string;
}) {
  const expires = opts?.expiresAt ?? new Date(Date.now() + 3600_000).toISOString();
  db.seed("events", [
    {
      id: EVENT_ID,
      title: "AISA Driving School",
      starts_at: "2026-06-15T11:00:00Z",
      ends_at: "2026-06-15T21:00:00Z",
      timezone: "America/Toronto",
      required_headcount: 8,
      status: "inviting",
    },
  ]);
  db.seed("staff_members", [
    { id: STAFF_ID, display_name: "Test Responder", active: true },
  ]);
  db.seed("event_invites", [
    {
      id: INVITE_ID,
      event_id: EVENT_ID,
      staff_member_id: STAFF_ID,
      status: opts?.status ?? "invited",
      selected_channels: ["sms"],
      // v2 (migration 0009): every invite is per-day now. Default to the
      // event's start date so the existing single-day tests still pass.
      day_date: "2026-06-15",
    },
  ]);
  const { hash } = token.generateRsvpToken();
  // Override the hash by re-using the same raw value through tests; we
  // generate a separate token below and seed the matching hash.
  const fresh = token.generateRsvpToken();
  db.seed("rsvp_tokens", [
    {
      id: TOKEN_ID,
      invite_id: INVITE_ID,
      token_hash: fresh.hash,
      expires_at: expires,
      used_at: opts?.usedAt ?? null,
    },
  ]);
  // The hash variable from the destructured call above is unused; silence
  // the lint with a void expression.
  void hash;
  return fresh.raw;
}

beforeEach(async () => {
  process.env.APP_SECRET_PEPPER = "test-pepper-please-rotate";
  process.env.APP_BASE_URL = "http://example.test";

  db = new MockSupabase();
  mod = await import("./rsvp-handler");
  token = await import("@/lib/security/token");
  mod.__setAdminClientForTesting(db as unknown as AdminLike);
});

afterEach(() => {
  mod.__setAdminClientForTesting(null);
});

describe("submitRsvpResponse", () => {
  it("rejects an invalid token", async () => {
    seedTokenAndInvite();
    const res = await mod.submitRsvpResponseImpl({
      token: "not-a-real-token",
      action: "accept",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/no longer valid|invalid/i);
    }
  });

  it("rejects an expired token (collapsed to generic public error)", async () => {
    const raw = seedTokenAndInvite({
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const res = await mod.submitRsvpResponseImpl({ token: raw, action: "accept" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      // Per SECURITY_AUDIT.md M3/H3-c, the public surface must not leak
      // the specific reason — collapsed to "no longer valid".
      expect(res.error).toMatch(/no longer valid/i);
    }
  });

  it("accepts an invitation and creates a confirmed assignment", async () => {
    const raw = seedTokenAndInvite();
    const res = await mod.submitRsvpResponseImpl({ token: raw, action: "accept" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.state).toBe("accepted");

    const invite = db.tables.event_invites[0];
    expect(invite.status).toBe("accepted");

    const assignments = db.tables.event_assignments ?? [];
    expect(assignments).toHaveLength(1);
    expect(assignments[0].status).toBe("confirmed");

    const history = db.tables.invite_response_history ?? [];
    expect(history).toHaveLength(1);
    expect(history[0].new_status).toBe("accepted");
    expect(history[0].actor_type).toBe("responder_token");

    // Token should be marked used.
    expect(db.tables.rsvp_tokens[0].used_at).toBeTruthy();
  });

  it("declines an invitation", async () => {
    const raw = seedTokenAndInvite();
    const res = await mod.submitRsvpResponseImpl({ token: raw, action: "decline" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.state).toBe("declined");
    expect(db.tables.event_invites[0].status).toBe("declined");
    expect(db.tables.event_assignments ?? []).toHaveLength(0);
  });

  it("cancels after accept and updates the assignment to cancelled", async () => {
    const raw = seedTokenAndInvite();
    // First accept.
    await mod.submitRsvpResponseImpl({ token: raw, action: "accept" });
    // Re-issue a fresh token because the previous one is now used.
    const fresh = token.generateRsvpToken();
    db.tables.rsvp_tokens[0].token_hash = fresh.hash;
    db.tables.rsvp_tokens[0].used_at = null;
    db.tables.rsvp_tokens[0].expires_at = new Date(Date.now() + 3600_000).toISOString();

    const res = await mod.submitRsvpResponseImpl({
      token: fresh.raw,
      action: "cancel",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.state).toBe("cancelled");

    expect(db.tables.event_invites[0].status).toBe("cancelled_by_member");
    expect(db.tables.event_assignments[0].status).toBe("cancelled");
  });

  it("refuses to cancel when the responder has not accepted yet", async () => {
    const raw = seedTokenAndInvite({ status: "invited" });
    const res = await mod.submitRsvpResponseImpl({ token: raw, action: "cancel" });
    expect(res.ok).toBe(false);
  });

  it("treats a stale used_at (> 24h ago) as exhausted", async () => {
    const longAgo = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    const raw = seedTokenAndInvite({
      usedAt: longAgo,
      status: "accepted",
    });
    const res = await mod.submitRsvpResponseImpl({
      token: raw,
      action: "cancel",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      // Public surface must use the collapsed generic message.
      expect(res.error).toMatch(/no longer valid/i);
    }
  });

  it("allows a recently-used token to flip declined → accepted while event is open", async () => {
    const raw = seedTokenAndInvite({
      usedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      status: "declined",
    });
    const res = await mod.submitRsvpResponseImpl({
      token: raw,
      action: "accept",
    });
    expect(res.ok).toBe(true);
    expect(db.tables.event_invites[0].status).toBe("accepted");
  });

  it("rejects a recently-used token when the event is locked / cancelled", async () => {
    const raw = seedTokenAndInvite({
      usedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      status: "accepted",
    });
    // Force the event into a locked state.
    db.tables.events[0].status = "cancelled";

    const res = await mod.submitRsvpResponseImpl({
      token: raw,
      action: "cancel",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/no longer valid/i);
    }
  });
});

describe("submitRsvpResponse — v2 per-day", () => {
  // Seed a multi-day event with one invite per day.
  const MULTI_EVENT_ID = "00000000-0000-0000-0000-00000000010a";
  const MULTI_STAFF_ID = "00000000-0000-0000-0000-00000000020a";
  const MULTI_TOKEN_ID = "00000000-0000-0000-0000-00000000030a";
  const MULTI_INVITE_D1 = "00000000-0000-0000-0000-00000000040a";
  const MULTI_INVITE_D2 = "00000000-0000-0000-0000-00000000050a";
  const MULTI_INVITE_D3 = "00000000-0000-0000-0000-00000000060a";

  function seedMultiDay() {
    db.seed("events", [
      {
        id: MULTI_EVENT_ID,
        title: "Porsche Club Race",
        starts_at: "2026-05-23T11:00:00Z",
        ends_at: "2026-05-25T21:00:00Z",
        timezone: "America/Toronto",
        required_headcount: 2,
        status: "inviting",
      },
    ]);
    db.seed("staff_members", [
      { id: MULTI_STAFF_ID, display_name: "Multi Responder", active: true },
    ]);
    db.seed("event_invites", [
      {
        id: MULTI_INVITE_D1,
        event_id: MULTI_EVENT_ID,
        staff_member_id: MULTI_STAFF_ID,
        status: "invited",
        selected_channels: ["email"],
        day_date: "2026-05-23",
      },
      {
        id: MULTI_INVITE_D2,
        event_id: MULTI_EVENT_ID,
        staff_member_id: MULTI_STAFF_ID,
        status: "invited",
        selected_channels: ["email"],
        day_date: "2026-05-24",
      },
      {
        id: MULTI_INVITE_D3,
        event_id: MULTI_EVENT_ID,
        staff_member_id: MULTI_STAFF_ID,
        status: "invited",
        selected_channels: ["email"],
        day_date: "2026-05-25",
      },
    ]);
    const fresh = token.generateRsvpToken();
    db.seed("rsvp_tokens", [
      {
        id: MULTI_TOKEN_ID,
        invite_id: MULTI_INVITE_D1,
        token_hash: fresh.hash,
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        used_at: null,
      },
    ]);
    return fresh.raw;
  }

  it("accepts a subset of days and writes one row per day", async () => {
    const raw = seedMultiDay();
    const res = await mod.submitRsvpResponseImpl({
      token: raw,
      action: "accept",
      days: ["2026-05-23", "2026-05-25"],
    });
    expect(res.ok).toBe(true);

    // Two of three invite rows flipped to accepted; D24 untouched.
    const flipped = db.tables.event_invites.filter(
      (i) => i.status === "accepted",
    );
    expect(flipped).toHaveLength(2);
    const flippedDays = new Set(flipped.map((i) => i.day_date as string));
    expect(flippedDays.has("2026-05-23")).toBe(true);
    expect(flippedDays.has("2026-05-25")).toBe(true);

    // Assignments: one per accepted day.
    const assignments = db.tables.event_assignments ?? [];
    expect(assignments).toHaveLength(2);
    expect(assignments.every((a) => a.status === "confirmed")).toBe(true);
    const assignedDays = new Set(assignments.map((a) => a.day_date as string));
    expect(assignedDays.has("2026-05-23")).toBe(true);
    expect(assignedDays.has("2026-05-25")).toBe(true);

    // History: two entries (one per accepted day).
    const history = db.tables.invite_response_history ?? [];
    expect(history.filter((h) => h.new_status === "accepted")).toHaveLength(2);

    // Token marked used.
    expect(db.tables.rsvp_tokens[0].used_at).toBeTruthy();
  });

  it("rejects when a requested day is outside the event window", async () => {
    const raw = seedMultiDay();
    const res = await mod.submitRsvpResponseImpl({
      token: raw,
      action: "accept",
      days: ["2026-05-23", "2026-06-01"], // June 1 is outside May 23-25
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("invalid_days");

    // No invite flipped, no assignment written.
    expect(
      db.tables.event_invites.every((i) => i.status === "invited"),
    ).toBe(true);
    expect(db.tables.event_assignments ?? []).toHaveLength(0);
  });

  it("declines specific days while leaving others as invited", async () => {
    const raw = seedMultiDay();
    const res = await mod.submitRsvpResponseImpl({
      token: raw,
      action: "decline",
      days: ["2026-05-24"],
    });
    expect(res.ok).toBe(true);

    const d24 = db.tables.event_invites.find(
      (i) => i.day_date === "2026-05-24",
    );
    expect(d24?.status).toBe("declined");
    const d23 = db.tables.event_invites.find(
      (i) => i.day_date === "2026-05-23",
    );
    expect(d23?.status).toBe("invited");
  });

  it("defaults to event.starts_at::date when days is omitted (v1 fallback)", async () => {
    const raw = seedMultiDay();
    const res = await mod.submitRsvpResponseImpl({
      token: raw,
      action: "accept",
      // no days payload
    });
    expect(res.ok).toBe(true);
    // Only the first day's invite is accepted.
    const accepted = db.tables.event_invites.filter(
      (i) => i.status === "accepted",
    );
    expect(accepted).toHaveLength(1);
    expect(accepted[0].day_date).toBe("2026-05-23");
  });
});

describe("loadInviteByTokenImpl (public surface)", () => {
  it("collapses all reason codes to 'unavailable' for public callers", async () => {
    // Invalid token (no hash match).
    seedTokenAndInvite();
    const bogus = await mod.loadInviteByTokenImpl("definitely-not-real");
    expect(bogus.ok).toBe(false);
    if (!bogus.ok) {
      expect(bogus.reason).toBe("unavailable");
    }
  });

  it("returns 'unavailable' for expired tokens (does not leak 'expired')", async () => {
    const raw = seedTokenAndInvite({
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const res = await mod.loadInviteByTokenImpl(raw);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("unavailable");
    }
  });

  it("returns 'unavailable' for stale-used tokens (does not leak 'used')", async () => {
    const raw = seedTokenAndInvite({
      usedAt: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
      status: "accepted",
    });
    const res = await mod.loadInviteByTokenImpl(raw);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("unavailable");
    }
  });
});
