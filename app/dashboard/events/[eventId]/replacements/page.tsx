import Link from "next/link";
import { notFound } from "next/navigation";

import { ReplacementList, type ReplacementListItem } from "@/components/replacements/ReplacementList";
import { requireOwner } from "@/lib/auth/require-owner";
import { getEvent, listEventRequirements } from "@/lib/events/queries";
import { getReplacementCandidates } from "@/lib/roster/replacement-candidates-fetch";
import { shortCode } from "@/lib/events/format";

// Replacement candidate ranking depends on live invite/assignment state —
// always hit the database on each request.
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ eventId: string }>;
};

export default async function ReplacementsPage({ params }: PageProps) {
  await requireOwner();
  const { eventId } = await params;

  const event = await getEvent(eventId);
  if (!event) notFound();

  const requirements = await listEventRequirements(eventId);
  const candidates = await getReplacementCandidates({ eventId });

  // Headline summary line: "Short by N · Need: 2× EXTR, 1× MED".
  // Phase 3 doesn't surface live coverage yet (Phase 5b backfills), so we
  // fall back to the configured headcount + structured requirements.
  const requirementSummary =
    requirements.length > 0
      ? requirements
          .map((r) => `${r.required_count}× ${r.label.toUpperCase()}`)
          .join(", ")
      : null;

  // We don't have live coverage in Phase 3 outputs — derive a conservative
  // "short by" from event_headcount minus current assignments via the
  // candidate query is overkill. Show the headline differently when no
  // requirements are configured.
  const shortBy = Math.max(0, event.required_headcount);

  const items: ReplacementListItem[] = candidates.map((c) => ({
    staffId: c.staff.id,
    displayName: c.staff.display_name,
    primaryMatchLabel: c.matches.quals[0] ?? (c.matches.role ? "ROLE" : null),
    matchCount: c.matches.quals.length + (c.matches.role ? 1 : 0),
    lastWorkedAgo: c.lastWorkedAgo,
    contactability: c.contactability,
    score: c.score,
  }));

  return (
    <div style={{ position: "relative", paddingBottom: 120 }}>
      <div
        style={{
          padding: "20px 16px 0",
          maxWidth: 720,
          margin: "0 auto",
        }}
      >
        <header style={{ marginBottom: 14 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 6,
            }}
          >
            <Link
              href={`/dashboard/events/${event.id}`}
              className="cs-btn cs-btn--sm"
              style={{ textDecoration: "none" }}
            >
              ← BACK
            </Link>
            <span className="cs-eyebrow">{shortCode(event.id)}</span>
          </div>
          <span
            className="cs-eyebrow"
            style={{ color: "var(--accent)", display: "block" }}
          >
            Find Replacements
          </span>
          <h1 className="cs-h1" style={{ marginTop: 6 }}>
            {event.title}
          </h1>
          <div
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--text-2)",
              letterSpacing: "0.04em",
              marginTop: 6,
            }}
          >
            {requirementSummary
              ? `Short by ${shortBy} · Need: ${requirementSummary}`
              : `Short by ${shortBy} · Headcount target ${event.required_headcount}`}
          </div>
        </header>

        <div
          className="cs-stripes"
          style={{ height: 4, borderRadius: 2, marginBottom: 14 }}
          aria-hidden
        />

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 10,
          }}
        >
          <span className="cs-eyebrow">
            Suggested · ranked by fit + fairness
          </span>
          <span
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--text-3)",
              letterSpacing: "0.04em",
            }}
          >
            {items.length} CANDIDATE{items.length === 1 ? "" : "S"}
          </span>
        </div>

        <ReplacementList eventId={event.id} items={items} />
      </div>
    </div>
  );
}
