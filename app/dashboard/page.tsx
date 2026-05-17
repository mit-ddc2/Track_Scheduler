import { Card } from "@/components/ui/Card";

export default function DashboardHome() {
  return (
    <div
      style={{
        padding: "20px 16px 32px",
        display: "flex",
        flexDirection: "column",
        gap: 18,
        maxWidth: 960,
        margin: "0 auto",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="cs-eyebrow">May · Week 21</span>
        <h1 className="cs-h1">Calabogie Safety</h1>
      </div>
      <Card style={{ padding: 16 }}>
        <p
          style={{
            margin: 0,
            color: "var(--text-2)",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          Phase 1 shell — events list lands in Phase 3.
        </p>
      </Card>
    </div>
  );
}
