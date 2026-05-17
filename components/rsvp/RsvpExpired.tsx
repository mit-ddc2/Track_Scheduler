export type RsvpExpiredProps = {
  reason: "invalid" | "expired" | "used";
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
};

/** Friendly catch-all for any unusable RSVP token (spec §16.11). */
export function RsvpExpired({ reason }: RsvpExpiredProps) {
  const c = COPY[reason];
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
      <a
        className="mono"
        href="tel:+16135550142"
        style={{
          fontSize: 12,
          color: "var(--accent)",
          letterSpacing: "0.06em",
        }}
      >
        CALL ROBERT · +1 613-555-0142
      </a>
    </div>
  );
}
