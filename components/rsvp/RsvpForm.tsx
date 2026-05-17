"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { RsvpActionKind, RsvpSubmitInput } from "@/lib/validation/schemas";

import type { RsvpActionResult } from "@/app/r/[token]/actions";

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

export function RsvpForm({
  token,
  status,
  responderName,
  expiresAt,
  submitAction,
  contact,
}: RsvpFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [localStatus, setLocalStatus] = useState(status);

  const callAction = (action: RsvpActionKind) => {
    setError(null);
    startTransition(async () => {
      const res = await submitAction({ token, action });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (action === "accept") setLocalStatus("accepted");
      else if (action === "decline") setLocalStatus("declined");
      else if (action === "cancel") setLocalStatus("cancelled_by_member");
      router.refresh();
    });
  };

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
