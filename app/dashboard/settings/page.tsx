export default function SettingsPage() {
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
      <span className="cs-eyebrow">Owner</span>
      <h1 className="cs-h1">Settings</h1>
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
        Phase 6 — coming soon
      </p>
    </div>
  );
}
