import { notFound, redirect } from "next/navigation";

import { EventForm, type EventFormValues } from "@/components/events/EventForm";
import { requireOwner } from "@/lib/auth/require-owner";
import { toDateTimeLocal } from "@/lib/events/format";
import { getEvent } from "@/lib/events/queries";
import type { OverbookingPolicy } from "@/lib/validation/schemas";
import { updateEvent } from "../../actions";

type PageProps = {
  params: Promise<{ eventId: string }>;
};

export default async function EditEventPage({ params }: PageProps) {
  await requireOwner();
  const { eventId } = await params;

  const event = await getEvent(eventId);
  if (!event) notFound();

  if (
    event.status === "locked" ||
    event.status === "completed" ||
    event.status === "cancelled"
  ) {
    // Frozen — bounce back to detail with a status-aware message.
    redirect(`/dashboard/events/${eventId}`);
  }

  const tz = event.timezone || "America/Toronto";
  const initial: EventFormValues = {
    title: event.title,
    description: event.description ?? "",
    event_type: event.event_type ?? "",
    starts_at: toDateTimeLocal(event.starts_at, tz),
    ends_at: toDateTimeLocal(event.ends_at, tz),
    timezone: tz,
    location: event.location ?? "",
    required_headcount: event.required_headcount,
    overbooking_policy:
      (event.overbooking_policy as OverbookingPolicy) === "waitlist_after_requirement"
        ? "waitlist_after_requirement"
        : "allow_all",
    manager_notes: event.manager_notes ?? "",
  };

  async function submit(values: EventFormValues) {
    "use server";
    return await updateEvent(eventId, {
      title: values.title,
      description: values.description || undefined,
      event_type: values.event_type || undefined,
      starts_at: values.starts_at,
      ends_at: values.ends_at,
      timezone: values.timezone || "America/Toronto",
      location: values.location || undefined,
      required_headcount: values.required_headcount,
      overbooking_policy: values.overbooking_policy,
      manager_notes: values.manager_notes || undefined,
    });
  }

  return (
    <div
      style={{
        padding: "20px 16px 32px",
        maxWidth: 720,
        margin: "0 auto",
      }}
    >
      <header style={{ marginBottom: 16 }}>
        <span className="cs-eyebrow">Edit event</span>
        <h1 className="cs-h1" style={{ marginTop: 6 }}>
          {event.title}
        </h1>
      </header>

      <EventForm
        mode="edit"
        initial={initial}
        action={submit}
        cancelHref={`/dashboard/events/${eventId}`}
      />
    </div>
  );
}
