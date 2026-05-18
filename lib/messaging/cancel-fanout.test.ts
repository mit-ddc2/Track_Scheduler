import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MockSupabase } from "./__mocks__/admin-client";

type AdminLike = ReturnType<typeof import("@/lib/db/supabase-admin").createAdminClient>;

let db: MockSupabase;
let outbox: typeof import("./outbox");
let fanout: typeof import("./cancel-fanout");

const EVENT_ID = "00000000-0000-0000-0000-000000000001";
const STAFF_A = "00000000-0000-0000-0000-00000000000a";
const STAFF_B = "00000000-0000-0000-0000-00000000000b";
const STAFF_C = "00000000-0000-0000-0000-00000000000c";
const STAFF_D = "00000000-0000-0000-0000-00000000000d";

function seedEvent() {
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
}

function seedStaffAndContacts() {
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
      preferred_contact: "sms",
      active: true,
    },
    {
      id: STAFF_C,
      display_name: "Cara Chen",
      preferred_contact: "email",
      active: true,
    },
    {
      id: STAFF_D,
      display_name: "Dan Dupuis",
      preferred_contact: "manual_only",
      active: true,
    },
  ]);

  db.seed("staff_contact_methods", [
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
    {
      staff_member_id: STAFF_B,
      channel: "sms",
      value: "+14165551002",
      normalized_value: "+14165551002",
      is_primary: true,
      status: "valid",
      consent: "granted",
    },
    {
      staff_member_id: STAFF_C,
      channel: "email",
      value: "cara@example.com",
      normalized_value: "cara@example.com",
      is_primary: true,
      status: "valid",
      consent: "granted",
    },
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
}

beforeEach(async () => {
  db = new MockSupabase();
  seedEvent();
  outbox = await import("./outbox");
  fanout = await import("./cancel-fanout");
  outbox.__setAdminClientForTesting(db as unknown as AdminLike);
  fanout.__setAdminClientForTesting(db as unknown as AdminLike);
});

afterEach(() => {
  outbox.__setAdminClientForTesting(null);
  fanout.__setAdminClientForTesting(null);
});

describe("sendCancellationFanout", () => {
  it("enqueues nothing when there are zero notifiable invites", async () => {
    seedStaffAndContacts();
    const res = await fanout.sendCancellationFanout({ eventId: EVENT_ID });
    expect(res.recipients).toBe(0);
    expect(res.sms_enqueued).toBe(0);
    expect(res.email_enqueued).toBe(0);
    expect(db.tables.message_outbox ?? []).toHaveLength(0);
  });

  it("fans out one message per recipient per allowed channel for 3 invitees", async () => {
    seedStaffAndContacts();
    // Three accepted responders. Alice = both channels, Bob = sms, Cara =
    // email. Dan is manual_only (skipped).
    db.seed("event_invites", [
      {
        event_id: EVENT_ID,
        staff_member_id: STAFF_A,
        status: "accepted",
        day_date: "2026-06-15",
      },
      {
        event_id: EVENT_ID,
        staff_member_id: STAFF_B,
        status: "accepted",
        day_date: "2026-06-15",
      },
      {
        event_id: EVENT_ID,
        staff_member_id: STAFF_C,
        status: "accepted",
        day_date: "2026-06-15",
      },
    ]);

    const res = await fanout.sendCancellationFanout({
      eventId: EVENT_ID,
      reason: "Weather — track closed.",
    });

    expect(res.recipients).toBe(3);
    // Alice = 1 SMS + 1 email, Bob = 1 SMS, Cara = 1 email.
    expect(res.sms_enqueued).toBe(2);
    expect(res.email_enqueued).toBe(2);
    expect(db.tables.message_outbox).toHaveLength(4);

    // Invite statuses got rolled forward.
    const stillNotifiable = db.tables.event_invites.filter((r) =>
      ["invited", "accepted", "availability_updated"].includes(
        r.status as string,
      ),
    );
    expect(stillNotifiable).toHaveLength(0);
    const cancelled = db.tables.event_invites.filter(
      (r) => r.status === "cancelled_by_manager",
    );
    expect(cancelled).toHaveLength(3);
  });

  it("produces a single SMS body listing every affected day for multi-day responders", async () => {
    seedStaffAndContacts();
    // Bob is invited for THREE days. We expect ONE outbox row (not three)
    // whose body lists all three days.
    db.seed("event_invites", [
      {
        event_id: EVENT_ID,
        staff_member_id: STAFF_B,
        status: "accepted",
        day_date: "2026-06-13",
      },
      {
        event_id: EVENT_ID,
        staff_member_id: STAFF_B,
        status: "accepted",
        day_date: "2026-06-14",
      },
      {
        event_id: EVENT_ID,
        staff_member_id: STAFF_B,
        status: "accepted",
        day_date: "2026-06-15",
      },
    ]);

    const res = await fanout.sendCancellationFanout({ eventId: EVENT_ID });
    expect(res.recipients).toBe(1);
    expect(res.sms_enqueued).toBe(1);
    expect(res.email_enqueued).toBe(0);
    expect(db.tables.message_outbox).toHaveLength(1);

    const body = db.tables.message_outbox[0].body_text as string;
    expect(body).toContain("Sat Jun 13");
    expect(body).toContain("Sun Jun 14");
    expect(body).toContain("Mon Jun 15");
    expect(body).toContain("has been CANCELLED");
  });

  it("uses the recipient's preferred_contact to split SMS vs email", async () => {
    seedStaffAndContacts();
    // Two responders: Bob (sms only), Cara (email only).
    db.seed("event_invites", [
      {
        event_id: EVENT_ID,
        staff_member_id: STAFF_B,
        status: "accepted",
        day_date: "2026-06-15",
      },
      {
        event_id: EVENT_ID,
        staff_member_id: STAFF_C,
        status: "invited",
        day_date: "2026-06-15",
      },
    ]);

    const res = await fanout.sendCancellationFanout({ eventId: EVENT_ID });
    expect(res.recipients).toBe(2);
    expect(res.sms_enqueued).toBe(1);
    expect(res.email_enqueued).toBe(1);

    const channels = db.tables.message_outbox.map((r) => r.channel as string);
    expect(channels.sort()).toEqual(["email", "sms"]);
  });

  it("idempotency_keys collide on re-run so a second invocation does not double-enqueue", async () => {
    seedStaffAndContacts();
    db.seed("event_invites", [
      {
        event_id: EVENT_ID,
        staff_member_id: STAFF_A,
        status: "accepted",
        day_date: "2026-06-15",
      },
    ]);

    await fanout.sendCancellationFanout({ eventId: EVENT_ID });
    const firstCount = db.tables.message_outbox.length;
    expect(firstCount).toBe(2); // 1 SMS + 1 email

    // Re-run (e.g. owner clicks cancel a second time). The invite rows
    // already got rolled to cancelled_by_manager so the fan-out short-
    // circuits, but even if we re-seed them, the idempotency_key check
    // would dedupe.
    db.seed("event_invites", [
      {
        event_id: EVENT_ID,
        staff_member_id: STAFF_A,
        status: "accepted",
        day_date: "2026-06-15",
      },
    ]);
    await fanout.sendCancellationFanout({ eventId: EVENT_ID });
    expect(db.tables.message_outbox).toHaveLength(firstCount);
  });

  it("skips manual_only recipients without enqueuing anything", async () => {
    seedStaffAndContacts();
    db.seed("event_invites", [
      {
        event_id: EVENT_ID,
        staff_member_id: STAFF_D,
        status: "accepted",
        day_date: "2026-06-15",
      },
    ]);

    const res = await fanout.sendCancellationFanout({ eventId: EVENT_ID });
    expect(res.recipients).toBe(0);
    expect(res.skipped_manual_only).toBe(1);
    expect(db.tables.message_outbox ?? []).toHaveLength(0);
  });

  it("ignores invites that already moved past the notifiable window", async () => {
    seedStaffAndContacts();
    db.seed("event_invites", [
      {
        event_id: EVENT_ID,
        staff_member_id: STAFF_A,
        status: "declined",
        day_date: "2026-06-15",
      },
      {
        event_id: EVENT_ID,
        staff_member_id: STAFF_B,
        status: "cancelled_by_member",
        day_date: "2026-06-15",
      },
      {
        event_id: EVENT_ID,
        staff_member_id: STAFF_C,
        status: "expired",
        day_date: "2026-06-15",
      },
    ]);

    const res = await fanout.sendCancellationFanout({ eventId: EVENT_ID });
    expect(res.recipients).toBe(0);
    expect(db.tables.message_outbox ?? []).toHaveLength(0);
  });
});

describe("previewCancellationFanout", () => {
  it("returns all-zeros when there are no notifiable invites", async () => {
    seedStaffAndContacts();
    const preview = await fanout.previewCancellationFanout(EVENT_ID);
    expect(preview).toEqual({
      recipients: 0,
      sms: 0,
      email: 0,
      manual_only: 0,
      no_contact: 0,
    });
  });

  it("counts per-channel recipients correctly across mixed preferences", async () => {
    seedStaffAndContacts();
    db.seed("event_invites", [
      {
        event_id: EVENT_ID,
        staff_member_id: STAFF_A,
        status: "accepted",
        day_date: "2026-06-15",
      },
      {
        event_id: EVENT_ID,
        staff_member_id: STAFF_B,
        status: "accepted",
        day_date: "2026-06-15",
      },
      {
        event_id: EVENT_ID,
        staff_member_id: STAFF_C,
        status: "accepted",
        day_date: "2026-06-15",
      },
      {
        event_id: EVENT_ID,
        staff_member_id: STAFF_D,
        status: "accepted",
        day_date: "2026-06-15",
      },
    ]);

    const preview = await fanout.previewCancellationFanout(EVENT_ID);
    expect(preview.recipients).toBe(3); // Alice, Bob, Cara
    expect(preview.sms).toBe(2); // Alice + Bob
    expect(preview.email).toBe(2); // Alice + Cara
    expect(preview.manual_only).toBe(1); // Dan
  });
});
