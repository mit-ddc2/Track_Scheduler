import { notFound } from "next/navigation";

import { Card } from "@/components/ui/Card";
import { requireOwner } from "@/lib/auth/require-owner";
import { getEvent } from "@/lib/events/queries";
import { cancelEvent } from "../../actions";

import { CancelEventForm } from "./CancelEventForm";

type PageProps = {
  params: Promise<{ eventId: string }>;
};

export default async function CancelEventPage({ params }: PageProps) {
  await requireOwner();
  const { eventId } = await params;

  const event = await getEvent(eventId);
  if (!event) notFound();

  async function submit(reason: string) {
    "use server";
    return await cancelEvent(eventId, { reason });
  }

  return (
    <div
      style={{
        padding: "20px 16px 32px",
        maxWidth: 560,
        margin: "0 auto",
      }}
    >
      <header style={{ marginBottom: 16 }}>
        <span className="cs-eyebrow">Cancel event</span>
        <h1 className="cs-h1" style={{ marginTop: 6 }}>
          {event.title}
        </h1>
        <p
          style={{
            marginTop: 8,
            color: "var(--text-2)",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          Cancellation is permanent. The event stays in history for audit and
          payroll purposes. Phase 5 will send opt-in cancellation notifications
          to invited responders.
        </p>
      </header>

      {event.status === "cancelled" ? (
        <Card style={{ padding: 16 }}>
          <p style={{ margin: 0, color: "var(--text-2)", fontSize: 13 }}>
            This event was already cancelled
            {event.cancelled_at
              ? ` on ${new Date(event.cancelled_at).toLocaleString()}`
              : ""}
            .
          </p>
        </Card>
      ) : event.status === "completed" ? (
        <Card style={{ padding: 16 }}>
          <p style={{ margin: 0, color: "var(--text-2)", fontSize: 13 }}>
            Completed events cannot be cancelled.
          </p>
        </Card>
      ) : (
        <CancelEventForm
          action={submit}
          backHref={`/dashboard/events/${eventId}`}
        />
      )}
    </div>
  );
}
