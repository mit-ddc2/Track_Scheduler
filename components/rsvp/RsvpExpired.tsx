import { getOwnerContact } from "@/lib/utils/contact";

export type RsvpExpiredProps = {
  /**
   * Reason for the empty/error state. `unavailable` is the public default —
   * all other reasons are collapsed into it so the response surface cannot
   * be used as a token-state oracle (see SECURITY_AUDIT.md M3 / H3).
   * `used`, `invalid`, `expired` remain in the type for internal /
   * admin-facing surfaces that already know more context.
   */
  reason: "invalid" | "expired" | "used" | "unavailable";
};

const COPY: Record<
  RsvpExpiredProps["reason"],
  { title: string; body: string; eyebrow: string }
> = {
  invalid: {
    eyebrow: "● LINK NOT FOUND",
    title: "This RSVP link is not valid.",
    body: "Double-check the message Robert sent — the link might have been copied incompletely.",
  },
  expired: {
    eyebrow: "● LINK EXPIRED",
    title: "This invitation has expired.",
    body: "RSVP links stop working after the event has passed. Get in touch with Robert if you still need to update your status.",
  },
  used: {
    eyebrow: "● LINK ALREADY USED",
    title: "This RSVP link was already used.",
    body: "Each link can only be used once. If you need to change your response, ask Robert to send a fresh invite.",
  },
  unavailable: {
    eyebrow: "● LINK NOT AVAILABLE",
    title: "This RSVP link isn't available.",
    body: "This invitation link is no longer valid. If you still need to update your status, get in touch with Robert.",
  },
};

/** Friendly catch-all for any unusable RSVP token (spec §16.11). */
export function RsvpExpired({ reason }: RsvpExpiredProps) {
  const c = COPY[reason];
  const contact = getOwnerContact();
  return (
    <div
      style={{
        position: "relative",
        height: "100%",
        background: "#0a0a0a",
        color: "#ececec",
        padding: "40px 20px",
        textAlign: "center",
      }}
    >
      <div className="cs-stripes" style={{ height: 6, marginBottom: 36 }} />
      <div
        className="cs-eyebrow"
        style={{ color: "var(--bad)", marginBottom: 8 }}
      >
        {c.eyebrow}
      </div>
      <div className="cs-h1" style={{ fontSize: 24, marginBottom: 12 }}>
        {c.title}
      </div>
      <p
        style={{
          fontSize: 14,
          color: "#aaa",
          lineHeight: 1.5,
          maxWidth: 320,
          margin: "0 auto 24px",
        }}
      >
        {c.body}
      </p>
      {contact.href ? (
        <a
          className="mono"
          href={`tel:${contact.href}`}
          style={{
            fontSize: 12,
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
            fontSize: 12,
            color: "#888",
            letterSpacing: "0.06em",
          }}
        >
          {contact.label.toUpperCase()}
        </span>
      )}
    </div>
  );
}
