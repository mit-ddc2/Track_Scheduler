"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";

import type { RsvpActionKind, RsvpSubmitInput } from "@/lib/validation/schemas";

import type { RsvpActionResult } from "@/app/r/[token]/actions";

export type RsvpDay = {
  /** YYYY-MM-DD */
  date: string;
  /** Current status of the responder's invite/assignment for this day. */
  status:
    | "invited"
    | "accepted"
    | "declined"
    | "cancelled_by_member"
    | "cancelled_by_manager"
    | null;
};

export type RsvpFormProps = {
  token: string;
  /** Current state of the invite as known at page render. */
  status: "invited" | "accepted" | "declined" | "cancelled_by_member";
  responderName: string;
  expiresAt: string;
  /** Server action injected as a prop to keep this component self-contained. */
  submitAction: (input: RsvpSubmitInput) => Promise<RsvpActionResult>;
  /**
   * Contact info for the "call the safety manager" footer link. Comes from
   * `OWNER_CONTACT_PHONE` via `getOwnerContact()`. When `href` is empty we
   * render plain text instead of a `tel:` link.
   */
  contact: {
    label: string;
    href: string;
  };
  /**
   * v2: when present (multi-day event), render per-day checkboxes instead of
   * the simple Accept/Decline buttons. Each entry carries the day's current
   * status so the UI can pre-check accepted days.
   */
  days?: RsvpDay[];
  /** IANA tz for rendering day labels. */
  timezone?: string;
};

function formatExpiry(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatDayLabel(date: string, tz: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return formatInTimeZone(d, tz, "EEE · MMM d");
}

export function RsvpForm({
  token,
  status,
  responderName,
  expiresAt,
  submitAction,
  contact,
  days,
  timezone = "America/Toronto",
}: RsvpFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [localStatus, setLocalStatus] = useState(status);

  // v2 per-day state. Default = check every day that isn't already declined.
  const [checkedDays, setCheckedDays] = useState<Set<string>>(() => {
    if (!days) return new Set();
    const set = new Set<string>();
    for (const d of days) {
      if (
        d.status === "declined" ||
        d.status === "cancelled_by_member" ||
        d.status === "cancelled_by_manager"
      ) {
        continue;
      }
      set.add(d.date);
    }
    return set;
  });
  const [lastConfirmation, setLastConfirmation] = useState<{
    state: "accepted" | "declined" | "cancelled";
    days: string[];
  } | null>(null);

  const toggleDay = (date: string) => {
    setCheckedDays((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const callAction = (action: RsvpActionKind, payloadDays?: string[]) => {
    setError(null);
    startTransition(async () => {
      const res = await submitAction({ token, action, days: payloadDays });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (action === "accept") setLocalStatus("accepted");
      else if (action === "decline") setLocalStatus("declined");
      else if (action === "cancel") setLocalStatus("cancelled_by_member");
      if (payloadDays && payloadDays.length > 0) {
        setLastConfirmation({
          state:
            action === "accept"
              ? "accepted"
              : action === "decline"
                ? "declined"
                : "cancelled",
          days: payloadDays,
        });
      }
      router.refresh();
    });
  };

  // ─── Multi-day branch ──────────────────────────────────────────────
  if (days && days.length > 0) {
    const anyAccepted = days.some((d) => d.status === "accepted");
    const allDays = days.map((d) => d.date);
    const checkedList = Array.from(checkedDays).sort();

    // Once we've just submitted, surface the per-day confirmation. The
    // server refreshes the page (router.refresh) so subsequent renders
    // re-pull state, but this gives the responder an immediate readout.
    if (lastConfirmation) {
      const stateColor =
        lastConfirmation.state === "accepted"
          ? "var(--ok)"
          : "var(--text-3)";
      const summary =
        lastConfirmation.state === "accepted"
          ? "You're confirmed for"
          : lastConfirmation.state === "declined"
            ? "You declined"
            : "You cancelled";
      return (
        <div role="status" aria-live="polite" style={{ textAlign: "center" }}>
          <div
            className="cs-eyebrow"
            style={{ color: stateColor, marginBottom: 6 }}
          >
            ● {lastConfirmation.state.toUpperCase()}
          </div>
          <div className="cs-h2" style={{ marginBottom: 6 }}>
            {summary}{" "}
            {lastConfirmation.days
              .map((d) => formatDayLabel(d, timezone))
              .join(" + ")}
            .
          </div>
          <div
            className="mono"
            style={{
              fontSize: 11,
              color: "#888",
              marginBottom: 14,
              letterSpacing: "0.04em",
            }}
          >
            ROBERT WILL SEND DETAILS THE DAY BEFORE
          </div>
          {error && <ErrorBanner error={error} />}
          <button
            type="button"
            onClick={() => setLastConfirmation(null)}
            disabled={pending}
            style={ghostBtn}
          >
            CHANGE MY RESPONSE
          </button>
        </div>
      );
    }

    return (
      <div role="form" aria-label="Per-day availability">
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <span className="cs-eyebrow">YOU · {responderName.toUpperCase()}</span>
          <span className="mono" style={{ fontSize: 10, color: "#888" }}>
            EXPIRES {formatExpiry(expiresAt).toUpperCase()}
          </span>
        </div>
        <div className="cs-h2" style={{ marginBottom: 10, fontSize: 18 }}>
          Which days can you work?
        </div>
        <div style={{ marginBottom: 16 }}>
          {days.map((d) => {
            const on = checkedDays.has(d.date);
            const previouslyAccepted = d.status === "accepted";
            return (
              <label
                key={d.date}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 8px",
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggleDay(d.date)}
                  aria-label={`Available on ${formatDayLabel(d.date, timezone)}`}
                  style={{ width: 20, height: 20, accentColor: "var(--ok)" }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    {formatDayLabel(d.date, timezone)}
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 10,
                      color: "#888",
                      letterSpacing: "0.04em",
                      marginTop: 2,
                    }}
                  >
                    {d.date}
                    {previouslyAccepted ? " · CURRENTLY ACCEPTED" : ""}
                    {d.status === "declined" ? " · PREVIOUSLY DECLINED" : ""}
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        {error && <ErrorBanner error={error} />}

        <button
          type="button"
          onClick={() => {
            if (checkedDays.size === 0) {
              setError("Tick at least one day, or DECLINE ALL.");
              return;
            }
            callAction("accept", checkedList);
          }}
          disabled={pending}
          style={{
            width: "100%",
            padding: 18,
            marginBottom: 8,
            borderRadius: 4,
            border: 0,
            cursor: pending ? "wait" : "pointer",
            background: "var(--ok)",
            color: "#062a13",
            font: "800 16px/1 Inter, sans-serif",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          ✓ {pending ? "WORKING…" : `ACCEPT · ${checkedDays.size} day${checkedDays.size === 1 ? "" : "s"}`}
        </button>
        <button
          type="button"
          onClick={() => callAction("decline", allDays)}
          disabled={pending}
          style={{
            width: "100%",
            padding: 14,
            marginBottom: anyAccepted ? 8 : 14,
            borderRadius: 4,
            border: "1px solid rgba(255,255,255,0.15)",
            cursor: pending ? "wait" : "pointer",
            background: "transparent",
            color: "#ececec",
            font: "700 13px/1 Inter, sans-serif",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          DECLINE ALL DAYS
        </button>
        {anyAccepted && (
          <button
            type="button"
            onClick={() => callAction("cancel", allDays)}
            disabled={pending}
            style={{
              width: "100%",
              padding: 12,
              borderRadius: 4,
              border: "1px solid var(--bad)",
              cursor: pending ? "wait" : "pointer",
              background: "transparent",
              color: "var(--bad)",
              font: "700 12px/1 Inter, sans-serif",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: 14,
            }}
          >
            CANCEL MY SPOT
          </button>
        )}
        <div style={{ textAlign: "center", marginTop: 4 }}>
          {contact.href ? (
            <a
              className="mono"
              href={`tel:${contact.href}`}
              style={{
                fontSize: 11,
                color: "var(--accent)",
                letterSpacing: "0.06em",
              }}
            >
              CALL · {contact.label.toUpperCase()}
            </a>
          ) : (
            <span
              className="mono"
              style={{
                fontSize: 11,
                color: "var(--text-3)",
                letterSpacing: "0.06em",
              }}
            >
              {contact.label.toUpperCase()}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (localStatus === "accepted") {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{ textAlign: "center", padding: "8px 0" }}
      >
        <div
          className="cs-eyebrow"
          style={{ color: "var(--ok)", marginBottom: 6 }}
        >
          ● CONFIRMED
        </div>
        <div className="cs-h2" style={{ marginBottom: 6 }}>
          You&rsquo;re on the crew.
        </div>
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: "#888",
            marginBottom: 14,
            letterSpacing: "0.04em",
          }}
        >
          ROBERT WILL SEND DETAILS THE DAY BEFORE
        </div>
        {error && <ErrorBanner error={error} />}
        <button
          type="button"
          onClick={() => callAction("cancel")}
          disabled={pending}
          style={ghostBtn}
        >
          {pending ? "WORKING…" : "CANCEL MY SPOT"}
        </button>
      </div>
    );
  }

  if (localStatus === "declined" || localStatus === "cancelled_by_member") {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{ textAlign: "center", padding: "8px 0" }}
      >
        <div
          className="cs-eyebrow"
          style={{ color: "var(--text-3)", marginBottom: 6 }}
        >
          ○ {localStatus === "declined" ? "DECLINED" : "CANCELLED"}
        </div>
        <div className="cs-h2" style={{ marginBottom: 6 }}>
          No worries — thanks for replying.
        </div>
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: "#888",
            marginBottom: 14,
            letterSpacing: "0.04em",
          }}
        >
          CHANGE OF PLANS? RE-ACCEPT BELOW
        </div>
        {error && <ErrorBanner error={error} />}
        <button
          type="button"
          onClick={() => callAction("accept")}
          disabled={pending}
          style={okOutlineBtn}
        >
          {pending ? "WORKING…" : "I'M BACK IN"}
        </button>
      </div>
    );
  }

  // "invited" (default)
  return (
    <div role="status" aria-live="polite" aria-atomic="true">
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <span className="cs-eyebrow">YOU · {responderName.toUpperCase()}</span>
        <span className="mono" style={{ fontSize: 10, color: "#888" }}>
          EXPIRES {formatExpiry(expiresAt).toUpperCase()}
        </span>
      </div>
      {error && <ErrorBanner error={error} />}
      <button
        type="button"
        onClick={() => callAction("accept")}
        disabled={pending}
        style={{
          width: "100%",
          padding: 18,
          marginBottom: 8,
          borderRadius: 4,
          border: 0,
          cursor: pending ? "wait" : "pointer",
          background: "var(--ok)",
          color: "#062a13",
          font: "800 16px/1 Inter, sans-serif",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        ✓ {pending ? "WORKING…" : "Accept · I'm in"}
      </button>
      <button
        type="button"
        onClick={() => callAction("decline")}
        disabled={pending}
        style={{
          width: "100%",
          padding: 14,
          borderRadius: 4,
          border: "1px solid rgba(255,255,255,0.15)",
          cursor: pending ? "wait" : "pointer",
          background: "transparent",
          color: "#ececec",
          font: "700 13px/1 Inter, sans-serif",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        Decline · can&rsquo;t make it
      </button>
      <div style={{ textAlign: "center", marginTop: 14 }}>
        {contact.href ? (
          <a
            className="mono"
            href={`tel:${contact.href}`}
            style={{
              fontSize: 11,
              color: "var(--accent)",
              letterSpacing: "0.06em",
            }}
          >
            CALL · {contact.label.toUpperCase()}
          </a>
        ) : (
          <span
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--text-3)",
              letterSpacing: "0.06em",
            }}
          >
            {contact.label.toUpperCase()}
          </span>
        )}
      </div>
    </div>
  );
}

function ErrorBanner({ error }: { error: string }) {
  return (
    <div
      role="alert"
      style={{
        marginBottom: 12,
        padding: "8px 10px",
        background: "color-mix(in srgb, var(--bad) 14%, transparent)",
        color: "var(--bad)",
        border: "1px solid var(--bad)",
        borderRadius: 4,
        fontSize: 12,
        textAlign: "center",
      }}
    >
      {error}
    </div>
  );
}

const ghostBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid rgba(255,255,255,0.15)",
  color: "#ececec",
  padding: "10px 14px",
  borderRadius: 3,
  font: "600 11px/1 var(--font-jetbrains-mono), monospace",
  letterSpacing: "0.1em",
  cursor: "pointer",
  textTransform: "uppercase",
};

const okOutlineBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--ok)",
  color: "var(--ok)",
  padding: "10px 14px",
  borderRadius: 3,
  font: "600 11px/1 var(--font-jetbrains-mono), monospace",
  letterSpacing: "0.1em",
  cursor: "pointer",
  textTransform: "uppercase",
};
