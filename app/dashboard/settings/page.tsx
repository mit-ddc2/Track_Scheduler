import Link from "next/link";

import { Card } from "@/components/ui/Card";

export default function SettingsPage() {
  return (
    <div
      style={{
        padding: "20px 16px 32px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        maxWidth: 960,
        margin: "0 auto",
      }}
    >
      <span className="cs-eyebrow">Owner</span>
      <h1 className="cs-h1">Settings</h1>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Link
          href="/dashboard/settings/notifications"
          style={{ textDecoration: "none", color: "inherit" }}
        >
          <Card hover>
            <div style={{ padding: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Notifications</div>
              <div
                style={{
                  marginTop: 4,
                  color: "var(--text-2)",
                  fontSize: 12,
                }}
              >
                Choose how you hear about each kind of event.
              </div>
            </div>
          </Card>
        </Link>
      </div>
    </div>
  );
}
