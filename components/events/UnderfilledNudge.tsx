import Link from "next/link";

import { Card } from "@/components/ui/Card";

import { UnderfilledNudgeDismiss } from "./UnderfilledNudgeDismiss";

export type RoleGap = {
  /** Display label — short code preferred (e.g. "EXTR", "MED"). */
  label: string;
  shortBy: number;
};

export type UnderfilledNudgeProps = {
  eventId: string;
  shortCount: number;
  /** Optional per-role breakdown — rendered as "{N} EXTR / {N} MED". */
  roleGaps?: RoleGap[];
};

/**
 * Pit Wall "Needs attention" banner shown on the event detail page when the
 * event becomes underfilled after invites are sent. Two actions:
 *   - FIND REPLACEMENTS → opens the replacement-candidate page for the event
 *   - DISMISS           → server action sets a session cookie so this banner
 *                         doesn't re-appear for this event in this session
 *
 * Visibility logic (cookie read + computed underfill) lives in the parent
 * page so this component stays pure.
 */
export function UnderfilledNudge({
  eventId,
  shortCount,
  roleGaps,
}: UnderfilledNudgeProps) {
  const roleSummary =
    roleGaps && roleGaps.length > 0
      ? roleGaps.map((g) => `${g.shortBy} ${g.label}`).join(" / ")
      : null;

  return (
    <Card
      style={{
        padding: 16,
        marginBottom: 12,
        borderColor: "color-mix(in srgb, var(--bad) 40%, var(--line))",
        background:
          "color-mix(in srgb, var(--bad) 4%, var(--surface))",
      }}
      aria-live="polite"
    >
      <div
        className="cs-eyebrow"
        style={{ color: "var(--bad)", marginBottom: 6 }}
      >
        ● Needs attention
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: "var(--text)",
          lineHeight: 1.45,
        }}
      >
        Short by {shortCount}
        {roleSummary ? (
          <span style={{ color: "var(--text-2)" }}>
            {" — "}
            {roleSummary} {roleSummary.includes("/") ? "roles" : "role"} still
            needed
          </span>
        ) : (
          <span style={{ color: "var(--text-2)" }}>
            {" — "}
            {shortCount === 1 ? "spot" : "spots"} still need to be filled
          </span>
        )}
      </p>
      <div
        style={{
          display: "flex",
          gap: 8,
          marginTop: 12,
          flexWrap: "wrap",
        }}
      >
        <Link
          href={`/dashboard/events/${eventId}/replacements`}
          className="cs-btn cs-btn--primary"
          style={{ textDecoration: "none", flex: "1 1 auto" }}
        >
          FIND REPLACEMENTS
        </Link>
        <UnderfilledNudgeDismiss eventId={eventId} />
      </div>
    </Card>
  );
}
