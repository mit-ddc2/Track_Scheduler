// server-only: seeds sample notifications for local development. Not invoked
// automatically — wire to an admin button or call from a script.
if (typeof window !== "undefined") {
  throw new Error("lib/notifications/seed-dev.ts is server-only");
}

import { createManagerNotification } from "./create-manager-notification";

export type SeededNotification = {
  eventType: string;
  title: string;
  body: string;
};

/**
 * Inserts six sample notifications spanning all three severities plus a few
 * representative event_types. Each one carries a unique dedupe_key suffixed
 * with the profileId so repeated calls are no-ops.
 */
export async function seedDevNotifications(profileId: string) {
  const samples = [
    {
      severity: "info" as const,
      eventType: "calendar.event_created",
      title: "New event from calendar",
      body: "Enduro Race Weekend on Saturday",
      dedupe: "seed-1",
    },
    {
      severity: "info" as const,
      eventType: "responder.accepted",
      title: "Marc Bélanger accepted",
      body: "AISA Driving School",
      dedupe: "seed-2",
    },
    {
      severity: "warning" as const,
      eventType: "event.underfilled",
      title: "Event underfilled",
      body: "Enduro Race Weekend — missing 2 medics",
      dedupe: "seed-3",
    },
    {
      severity: "urgent" as const,
      eventType: "responder.cancelled",
      title: "Sara Kovacs cancelled",
      body: "AISA Driving School — replacement needed",
      dedupe: "seed-4",
    },
    {
      severity: "urgent" as const,
      eventType: "event.urgent_underfilled",
      title: "Urgent: event critically underfilled",
      body: "Track Day — no Incident Lead, starts in 4h",
      dedupe: "seed-5",
    },
    {
      severity: "warning" as const,
      eventType: "message.delivery_failed",
      title: "Message delivery failed",
      body: "SMS to +1-613-555-0100 bounced",
      dedupe: "seed-6",
    },
  ];

  const results = [];
  for (const sample of samples) {
    const res = await createManagerNotification({
      profileId,
      severity: sample.severity,
      eventType: sample.eventType,
      title: sample.title,
      body: sample.body,
      dedupeKey: `${sample.dedupe}:${profileId}`,
    });
    results.push(res);
  }
  return results;
}
