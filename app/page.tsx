export default function Home() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "flex-start",
        gap: 24,
        padding: "48px 32px",
        maxWidth: 720,
        margin: "0 auto",
      }}
    >
      <div
        aria-hidden
        className="cs-stripes"
        style={{ width: 72, height: 8, borderRadius: 2 }}
      />
      <h1 className="cs-h1" style={{ color: "var(--accent)" }}>
        Calabogie Safety — coming online
      </h1>
      <p className="mono uc" style={{ color: "var(--text-2)", fontSize: 11 }}>
        Pit Wall theme active
      </p>
    </main>
  );
}
