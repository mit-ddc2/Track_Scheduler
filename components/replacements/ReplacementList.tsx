"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Avatar } from "@/components/roster/Avatar";
import { Chip } from "@/components/ui/Chip";

export type ReplacementListItem = {
  staffId: string;
  displayName: string;
  primaryMatchLabel: string | null;
  matchCount: number;
  lastWorkedAgo: number | null;
  contactability: "sms+email" | "sms" | "email" | "manual_only";
  score: number;
};

export type ReplacementListProps = {
  eventId: string;
  items: ReplacementListItem[];
};

function formatLastWorked(days: number | null): string {
  if (days === null) return "NEVER";
  if (days === 0) return "TODAY";
  if (days === 1) return "1 DAY AGO";
  if (days < 30) return `${days} DAYS AGO`;
  if (days < 60) return `${Math.round(days / 7)} WEEKS AGO`;
  return `${Math.round(days / 30)} MONTHS AGO`;
}

function contactabilityLabel(c: ReplacementListItem["contactability"]): string {
  switch (c) {
    case "sms+email":
      return "SMS + EMAIL";
    case "sms":
      return "SMS";
    case "email":
      return "EMAIL";
    default:
      return "MANUAL";
  }
}

/**
 * Picker UI for the ranked replacement candidate list (mirrors
 * `ScreenReplacements` in the mockup). Sticky bottom action prefills the
 * Phase 5b invite flow with `?prefill=<comma-separated staff ids>` so the
 * already-built invite composer can take over.
 *
 * TODO(Phase 5b): wire into `sendInvitationCampaign` from
 * `app/dashboard/events/[eventId]/invite/actions.ts` once that server
 * action lands. Until then we route through the invite page with prefill.
 */
export function ReplacementList({ eventId, items }: ReplacementListProps) {
  const [picked, setPicked] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const count = picked.size;
  const ids = useMemo(() => Array.from(picked).join(","), [picked]);

  const inviteHref =
    count > 0
      ? `/dashboard/events/${eventId}/invite?prefill=${encodeURIComponent(ids)}&campaign_type=replacement`
      : "#";

  if (items.length === 0) {
    return (
      <div
        className="cs-card"
        style={{
          padding: 24,
          textAlign: "center",
          color: "var(--text-3)",
          fontSize: 13,
        }}
      >
        No replacement candidates available. Every active staff member is
        already invited, accepted, or has no usable contact channel.
      </div>
    );
  }

  return (
    <>
      <div className="cs-card">
        {items.map((p, i) => {
          const on = picked.has(p.staffId);
          return (
            <div key={p.staffId}>
              {i > 0 && <div className="cs-divider" />}
              <button
                type="button"
                onClick={() => toggle(p.staffId)}
                aria-pressed={on}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "12px 14px",
                  background: "transparent",
                  border: "none",
                  color: "inherit",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <div
                  className="mono"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 4,
                    background: on ? "var(--accent)" : "var(--surface-2)",
                    border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: on ? "var(--accent-ink)" : "var(--text-2)",
                    flexShrink: 0,
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                  aria-hidden
                >
                  {on ? "✓" : i + 1}
                </div>
                <Avatar name={p.displayName} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: 13 }}>
                      {p.displayName}
                    </span>
                    {p.primaryMatchLabel && (
                      <Chip tone="ok">{p.primaryMatchLabel} MATCH</Chip>
                    )}
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 10,
                      color: "var(--text-3)",
                      marginTop: 3,
                      letterSpacing: "0.04em",
                    }}
                  >
                    LAST WORKED · {formatLastWorked(p.lastWorkedAgo)} ·{" "}
                    {contactabilityLabel(p.contactability)}
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 4,
                    flexShrink: 0,
                  }}
                >
                  <span
                    className="mono tnum"
                    style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}
                  >
                    {p.score}
                  </span>
                  <span
                    className="cs-label"
                    style={{ color: "var(--text-3)" }}
                  >
                    FIT
                  </span>
                </div>
              </button>
            </div>
          );
        })}
      </div>

      <div className="cs-replace-actionbar-wrap">
        <div className="cs-replace-actionbar">
          {count === 0 ? (
            <button
              type="button"
              disabled
              className="cs-btn cs-btn--primary cs-btn--lg"
              style={{ width: "100%" }}
              aria-disabled
            >
              SELECT REPLACEMENTS TO SEND
            </button>
          ) : (
            <Link
              href={inviteHref}
              className="cs-btn cs-btn--primary cs-btn--lg"
              style={{ width: "100%", textDecoration: "none", textAlign: "center" }}
            >
              SEND TO {count} REPLACEMENT{count === 1 ? "" : "S"}
            </Link>
          )}
        </div>
      </div>
      <style>{`
        .cs-replace-actionbar-wrap {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 64px;
          display: flex;
          justify-content: center;
          pointer-events: none;
          padding: 0 16px;
          background: linear-gradient(to top, var(--bg) 60%, transparent);
        }
        .cs-replace-actionbar {
          pointer-events: auto;
          width: 100%;
          max-width: 720px;
          padding: 12px 0;
        }
        @media (min-width: 768px) {
          .cs-replace-actionbar-wrap { bottom: 0; }
        }
      `}</style>
    </>
  );
}
