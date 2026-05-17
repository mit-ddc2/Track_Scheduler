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

  it("rejects an expired token", async () => {
    const raw = seedTokenAndInvite({
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const res = await mod.submitRsvpResponseImpl({ token: raw, action: "accept" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/expired/i);
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
});
