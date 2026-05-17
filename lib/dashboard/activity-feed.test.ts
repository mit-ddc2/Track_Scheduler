import { describe, expect, it } from "vitest";

import {
  ACTIVITY_FEED_LIMIT,
  mergeActivity,
  type ActivityFeedSources,
} from "./activity-feed";

function emptySources(): ActivityFeedSources {
  return { notifications: [], responses: [], audits: [] };
}

describe("mergeActivity", () => {
  it("returns an empty list when no sources have rows", () => {
    expect(mergeActivity(emptySources())).toEqual([]);
  });

  it("merges all three sources and sorts descending by createdAt", () => {
    const sources: ActivityFeedSources = {
      notifications: [
        {
          id: "n1",
          profile_id: "p",
          severity: "warning",
          status: "unread",
          event_type: "event.underfilled",
          title: "Event underfilled",
          body: "Race weekend — short 2",
          event_id: "e1",
          staff_member_id: null,
          related_entity_type: null,
          related_entity_id: null,
          dedupe_key: null,
          // Middle of the timeline.
          created_at: "2026-05-17T14:00:00Z",
          read_at: null,
        },
      ],
      responses: [
        {
          id: "r1",
          invite_id: "i1",
          event_id: "e1",
          staff_member_id: "s1",
          old_status: "invited",
          new_status: "accepted",
          actor_type: "member",
          response_note: null,
          // Most recent — should land first.
          created_at: "2026-05-17T15:00:00Z",
          staff_members: { display_name: "Marc Bélanger" },
          events: { title: "Enduro Race Weekend" },
        },
      ],
      audits: [
        {
          id: "a1",
          actor_type: "owner",
          actor_user_id: "owner-1",
          action: "campaign.sent",
          entity_type: "event",
          entity_id: "e1",
          summary: "Sent 12 invites",
          // Oldest.
          created_at: "2026-05-17T13:00:00Z",
          profiles: { display_name: "Robert" },
        },
      ],
    };

    const merged = mergeActivity(sources);

    expect(merged).toHaveLength(3);
    expect(merged.map((m) => m.source)).toEqual([
      "response",
      "notification",
      "audit",
    ]);
    expect(merged[0]?.actorLabel).toBe("Marc Bélanger");
    expect(merged[0]?.action).toBe("accepted");
    expect(merged[0]?.tone).toBe("ok");
    expect(merged[0]?.href).toBe("/dashboard/events/e1");
    expect(merged[1]?.action).toBe("Event underfilled");
    expect(merged[1]?.tone).toBe("warn");
    expect(merged[2]?.actorLabel).toBe("Robert");
    expect(merged[2]?.action).toBe("Sent 12 invites");
  });

  it("caps the merged list to the activity feed limit", () => {
    const responses = Array.from({ length: 30 }, (_, i) => ({
      id: `r${i}`,
      invite_id: `i${i}`,
      event_id: "e",
      staff_member_id: "s",
      old_status: "invited",
      new_status: "accepted",
      actor_type: "member",
      response_note: null,
      // Older rows get smaller timestamps so the newest 20 win.
      created_at: new Date(2026, 4, 1, 0, i).toISOString(),
      staff_members: { display_name: "Tester" },
      events: { title: "Event" },
    }));
    const merged = mergeActivity({ ...emptySources(), responses });
    expect(merged.length).toBe(ACTIVITY_FEED_LIMIT);
    // The 20 most-recent createdAt values should be the ones that survived.
    const newest = responses
      .slice()
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, ACTIVITY_FEED_LIMIT)
      .map((r) => r.id);
    expect(merged.map((m) => m.id.replace("response:", ""))).toEqual(newest);
  });

  it("falls back to safe labels when joined fields are missing", () => {
    const merged = mergeActivity({
      ...emptySources(),
      responses: [
        {
          id: "r1",
          invite_id: "i1",
          event_id: "e1",
          staff_member_id: "s1",
          old_status: null,
          new_status: "declined",
          actor_type: "member",
          response_note: null,
          created_at: "2026-05-17T10:00:00Z",
          // No joined staff_members / events.
          staff_members: null,
          events: null,
        },
      ],
      audits: [
        {
          id: "a1",
          actor_type: "system",
          actor_user_id: null,
          action: "calendar.sync",
          entity_type: "calendar_source",
          entity_id: null,
          summary: null,
          created_at: "2026-05-17T09:00:00Z",
          profiles: null,
        },
      ],
    });
    const response = merged.find((m) => m.source === "response");
    const audit = merged.find((m) => m.source === "audit");
    expect(response?.actorLabel).toBe("Responder");
    expect(response?.tone).toBe("bad");
    expect(audit?.actorLabel).toBe("System");
    // Action humanises the dotted action when no summary is provided.
    expect(audit?.action).toBe("calendar sync");
    // Without an entity_id, the row has no actionable link.
    expect(audit?.href).toBeNull();
  });

  it("maps notification severities to the right status-dot tone", () => {
    const base = {
      profile_id: "p",
      status: "unread" as const,
      event_type: "responder.accepted",
      title: "Test",
      body: null,
      event_id: null,
      staff_member_id: null,
      related_entity_type: null,
      related_entity_id: null,
      dedupe_key: null,
      created_at: "2026-05-17T00:00:00Z",
      read_at: null,
    };
    const merged = mergeActivity({
      ...emptySources(),
      notifications: [
        { ...base, id: "u", severity: "urgent" },
        { ...base, id: "w", severity: "warning" },
        { ...base, id: "i", severity: "info" },
      ],
    });
    const byId = Object.fromEntries(
      merged.map((m) => [m.id.replace("notification:", ""), m.tone] as const),
    );
    expect(byId.u).toBe("bad");
    expect(byId.w).toBe("warn");
    expect(byId.i).toBe("idle");
  });
});
