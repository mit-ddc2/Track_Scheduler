export default function NotificationsPage() {
  return (
    <div
      style={{
        padding: "20px 16px 32px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxWidth: 960,
        margin: "0 auto",
      }}
    >
      <span className="cs-eyebrow">Inbox</span>
      <h1 className="cs-h1">Activity</h1>
      <p
        className="mono"
        style={{
          color: "var(--text-3)",
          fontSize: 11,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          marginTop: 8,
        }}
      >
        Phase 4 — coming soon
      </p>
    </div>
  );
}
