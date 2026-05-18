import Link from "next/link";
import { notFound } from "next/navigation";

import { Card } from "@/components/ui/Card";
import { requireOwner } from "@/lib/auth/require-owner";

type PageProps = {
  searchParams?: Promise<{ advanced?: string }>;
};

export default async function CalendarSettingsPage({
  searchParams,
}: PageProps = {}) {
  await requireOwner();
  // v2: hidden from simplified settings nav; ?advanced=1 unlocks it.
  const params = searchParams ? await searchParams : {};
  if (params.advanced !== "1") {
    notFound();
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
        <span className="cs-eyebrow">Settings · Calendar</span>
        <h1 className="cs-h1" style={{ marginTop: 6 }}>
          Calendar sync
        </h1>
      </header>

      <Card style={{ padding: 0, overflow: "hidden", marginBottom: 16 }}>
        <div className="cs-stripes--muted" style={{ height: 6 }} />
        <div style={{ padding: 16 }}>
          <span className="cs-eyebrow" style={{ color: "var(--accent)" }}>
            Coming in v1.1
          </span>
          <p
            style={{
              marginTop: 10,
              color: "var(--text-2)",
              fontSize: 13,
              lineHeight: 1.55,
            }}
          >
            Google Calendar OAuth, ICS polling, and the calendar-change review
            banner ship in v1.1. For now, every event is created manually from
            the Events page.
          </p>
          <Link
            href="/dashboard/events/new"
            className="cs-btn cs-btn--primary"
            style={{ marginTop: 14, textDecoration: "none", display: "inline-flex" }}
          >
            + NEW EVENT
          </Link>
        </div>
      </Card>

      <Card style={{ padding: 16 }}>
        <span className="cs-label">Why two paths?</span>
        <p
          style={{
            marginTop: 10,
            color: "var(--text-2)",
            fontSize: 13,
            lineHeight: 1.55,
          }}
        >
          Most race weekends already live in the track&apos;s central calendar.
          v1.1 will pull those in automatically and let Robert add private
          placeholders by hand. Until then, manual entry is the only path —
          your existing scheduling workflow keeps working.
        </p>
      </Card>
    </div>
  );
}
