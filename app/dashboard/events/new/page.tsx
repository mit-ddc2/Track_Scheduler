import { requireOwner } from "@/lib/auth/require-owner";

import { EventForm, type EventFormValues } from "@/components/events/EventForm";
import { createManualEvent } from "../actions";

function defaultValues(): EventFormValues {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const start = new Date(tomorrow);
  start.setHours(9, 0, 0, 0);
  const end = new Date(tomorrow);
  end.setHours(17, 0, 0, 0);

  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
      d.getHours(),
    )}:${pad(d.getMinutes())}`;

  return {
    title: "",
    description: "",
    event_type: "",
    starts_at: fmt(start),
    ends_at: fmt(end),
    timezone: "America/Toronto",
    location: "",
    required_headcount: 0,
    overbooking_policy: "allow_all",
    manager_notes: "",
  };
}

export default async function NewEventPage() {
  await requireOwner();

  async function submit(values: EventFormValues) {
    "use server";
    return await createManualEvent({
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
        <span className="cs-eyebrow">New event</span>
        <h1 className="cs-h1" style={{ marginTop: 6 }}>
          Create event
        </h1>
        <p
          style={{
            marginTop: 8,
            color: "var(--text-2)",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          Manual events are local-only. Calendar sync (Google + ICS) ships in v1.1.
        </p>
      </header>

      <EventForm
        mode="create"
        initial={defaultValues()}
        action={submit}
        cancelHref="/dashboard/events"
      />
    </div>
  );
}
