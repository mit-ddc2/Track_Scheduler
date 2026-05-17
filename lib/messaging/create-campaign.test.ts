import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MockSupabase } from "./__mocks__/admin-client";

type AdminLike = ReturnType<typeof import("@/lib/db/supabase-admin").createAdminClient>;

let db: MockSupabase;
let outbox: typeof import("./outbox");
let camp: typeof import("./create-campaign");

const EVENT_ID = "00000000-0000-0000-0000-000000000001";
const STAFF_A = "00000000-0000-0000-0000-00000000000a";
const STAFF_B = "00000000-0000-0000-0000-00000000000b";
const STAFF_C = "00000000-0000-0000-0000-00000000000c";
const STAFF_D = "00000000-0000-0000-0000-00000000000d";

function seedBaseFixtures(db: MockSupabase) {
  db.seed("events", [
    {
      id: EVENT_ID,
      title: "AISA Driving School",
      starts_at: "2026-06-15T11:00:00Z",
      ends_at: "2026-06-15T21:00:00Z",
      timezone: "America/Toronto",
      location: "Paddock 4",
      event_type: "driving_school",
      status: "scheduled",
    },
  ]);

  db.seed("staff_members", [
    {
      id: STAFF_A,
      display_name: "Alice Andersson",
      preferred_contact: "both",
      active: true,
    },
    {
      id: STAFF_B,
      display_name: "Bob Bouchard",
      preferred_contact: "manual_only",
      active: true,
    },
    {
      id: STAFF_C,
      display_name: "Cara Chen",
      preferred_contact: "both",
      active: true,
    },
    {
      id: STAFF_D,
      display_name: "Dan Dupuis",
      preferred_contact: "sms",
      active: true,
    },
  ]);

  db.seed("staff_contact_methods", [
    // Alice: valid SMS + email
    {
      staff_member_id: STAFF_A,
      channel: "sms",
      value: "+14165551001",
      normalized_value: "+14165551001",
      is_primary: true,
      status: "valid",
      consent: "granted",
    },
    {
      staff_member_id: STAFF_A,
      channel: "email",
      value: "alice@example.com",
      normalized_value: "alice@example.com",
      is_primary: true,
      status: "valid",
      consent: "granted",
    },
    // Bob: contact present but preferred_contact = manual_only -> always skipped.
    {
      staff_member_id: STAFF_B,
      channel: "sms",
      value: "+14165551002",
      normalized_value: "+14165551002",
      is_primary: true,
      status: "valid",
      consent: "granted",
    },
    // Cara: SMS opted out, email bounced -> skipped opt-out for both.
    {
      staff_member_id: STAFF_C,
      channel: "sms",
      value: "+14165551003",
      normalized_value: "+14165551003",
      is_primary: true,
      status: "opted_out",
      consent: "withdrawn",
    },
    {
      staff_member_id: STAFF_C,
      channel: "email",
      value: "cara@example.com",
      normalized_value: "cara@example.com",
      is_primary: true,
      status: "bounced",
      consent: "granted",
    },
    // Dan: SMS only (no email contact). preferred_contact=sms.
    {
      staff_member_id: STAFF_D,
      channel: "sms",
      value: "+14165551004",
      normalized_value: "+14165551004",
      is_primary: true,
      status: "valid",
      consent: "granted",
    },
  ]);

  db.seed("staff_roles", [
    {
      staff_member_id: STAFF_A,
      is_primary: true,
      role_id: "r-1",
      crew_roles: { id: "r-1", name: "Extrication" },
    },
  ]);
}

beforeEach(async () => {
  process.env.APP_SECRET_PEPPER ||= "test-pepper-please-rotate";
  process.env.APP_BASE_URL = "http://example.test";

  db = new MockSupabase();
  seedBaseFixtures(db);
  outbox = await import("./outbox");
  camp = await import("./create-campaign");
  outbox.__setAdminClientForTesting(db as unknown as AdminLike);
  camp.__setAdminClientForTesting(db as unknown as AdminLike);
});

afterEach(() => {
  outbox.__setAdminClientForTesting(null);
  camp.__setAdminClientForTesting(null);
});

describe("createInvitationCampaign", () => {
  it("happy path: inserts campaign, invite, token, and SMS+email outbox rows", async () => {
    const result = await camp.createInvitationCampaign({
      eventId: EVENT_ID,
      staffMemberIds: [STAFF_A],
      channels: ["sms", "email"],
    });

    expect(result.invited).toBe(1);
    expect(result.sms_enqueued).toBe(1);
    expect(result.email_enqueued).toBe(1);
    expect(result.skipped_no_contact).toBe(0);
    expect(result.skipped_opt_out).toBe(0);

    expect(db.tables.invitation_campaigns).toHaveLength(1);
    expect(db.tables.invitation_campaigns[0].status).toBe("sent");
    expect(db.tables.event_invites).toHaveLength(1);
    expect(db.tables.event_invites[0].status).toBe("invited");
    expect(db.tables.rsvp_tokens).toHaveLength(1);
    expect(db.tables.message_outbox).toHaveLength(2);

    const channels = new Set(
      db.tables.message_outbox.map((r) => r.channel as string),
    );
    expect(channels.has("sms")).toBe(true);
    expect(channels.has("email")).toBe(true);
  });

  it("skips manual_only recipients without enqueuing anything", async () => {
    const result = await camp.createInvitationCampaign({
      eventId: EVENT_ID,
      staffMemberIds: [STAFF_B],
      channels: ["sms", "email"],
    });

    expect(result.invited).toBe(0);
    expect(result.skipped_manual_only).toBe(1);
    expect(db.tables.event_invites ?? []).toHaveLength(0);
    expect(db.tables.message_outbox ?? []).toHaveLength(0);
  });

  it("skips opt-out / bounced contacts and marks them as opt-out skip", async () => {
    const result = await camp.createInvitationCampaign({
      eventId: EVENT_ID,
      staffMemberIds: [STAFF_C],
      channels: ["sms", "email"],
    });

    expect(result.invited).toBe(0);
    expect(result.skipped_opt_out).toBe(1);
    expect(db.tables.message_outbox ?? []).toHaveLength(0);
  });

  it("skips recipients with no contact for requested channel", async () => {
    // Dan has SMS only — requesting EMAIL alone should skip him as no contact.
    const result = await camp.createInvitationCampaign({
      eventId: EVENT_ID,
      staffMemberIds: [STAFF_D],
      channels: ["email"],
    });

    expect(result.invited).toBe(0);
    expect(result.skipped_no_contact).toBe(1);
    expect(db.tables.message_outbox ?? []).toHaveLength(0);
  });

  it("dedupes outbox rows when the same campaign is re-run for the same recipient", async () => {
    // First campaign — should enqueue 1 SMS for Dan.
    const first = await camp.createInvitationCampaign({
      eventId: EVENT_ID,
      staffMemberIds: [STAFF_D],
      channels: ["sms"],
    });
    expect(first.sms_enqueued).toBe(1);
    expect(db.tables.message_outbox).toHaveLength(1);

    // Re-running with the *same* campaign id would dedupe, but our orchestrator
    // creates a new campaign id each call. To exercise dedupe explicitly we
    // manually call enqueueOutboxMessage with the same idempotency key.
    const dupe = await outbox.enqueueOutboxMessage({
      campaignId: first.campaignId,
      staffMemberId: STAFF_D,
      channel: "sms",
      toValue: "+14165551004",
      bodyText: "anything",
      provider: "twilio",
      idempotencyKey: db.tables.message_outbox[0].idempotency_key as string,
    });
    expect(dupe.deduped).toBe(true);
    expect(db.tables.message_outbox).toHaveLength(1);
  });

  it("returns counts that the UI summary can render directly", async () => {
    const result = await camp.createInvitationCampaign({
      eventId: EVENT_ID,
      staffMemberIds: [STAFF_A, STAFF_B, STAFF_C, STAFF_D],
      channels: ["sms", "email"],
    });

    // Alice (sms+email), Bob skipped manual_only, Cara skipped opt-out,
    // Dan (sms only, preferred=sms).
    expect(result.invited).toBe(2);
    expect(result.sms_enqueued).toBe(2);
    expect(result.email_enqueued).toBe(1);
    expect(result.skipped_manual_only).toBe(1);
    expect(result.skipped_opt_out).toBe(1);
    expect(result.skipped_no_contact).toBe(0);
  });
});
