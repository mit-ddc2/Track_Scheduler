import Link from "next/link";

import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";

type Entry = {
  href: string;
  label: string;
  sub: string;
  status?: "live" | "soon";
};

const ENTRIES: Entry[] = [
  {
    href: "/dashboard/settings/notifications",
    label: "Notifications",
    sub: "Choose how you hear about each kind of event.",
    status: "live",
  },
  {
    href: "/dashboard/settings/calendar",
    label: "Calendar sync",
    sub: "Manual entry only · Google + ICS in v1.1",
    status: "soon",
  },
  {
    href: "#",
    label: "Message templates",
    sub: "Phase 5 — SMS + email defaults",
    status: "soon",
  },
  {
    href: "#",
    label: "Consent & opt-outs",
    sub: "Phase 5 — STOP/HELP audit trail",
    status: "soon",
  },
  {
    href: "#",
    label: "Audit log",
    sub: "Phase 6 — mutation history viewer",
    status: "soon",
  },
];

export default function SettingsPage() {
  return (
    <div
      style={{
        padding: "20px 16px 32px",
        maxWidth: 720,
        margin: "0 auto",
      }}
    >
      <span className="cs-eyebrow">Owner</span>
      <h1 className="cs-h1" style={{ marginTop: 6 }}>
        Settings
      </h1>

      <Card style={{ marginTop: 16 }}>
        {ENTRIES.map((it, idx) => (
          <div key={it.href + idx}>
            {idx > 0 && <hr className="cs-divider" />}
            <Link
              href={it.href}
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                padding: 14,
                color: "var(--text)",
                textDecoration: "none",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{it.label}</div>
                <div
                  className="cs-label"
                  style={{
                    marginTop: 3,
                    color: "var(--text-3)",
                    letterSpacing: "0.04em",
                    textTransform: "none",
                  }}
                >
                  {it.sub}
                </div>
              </div>
              {it.status === "soon" ? (
                <Chip tone="warn">SOON</Chip>
              ) : (
                <Chip tone="ok">LIVE</Chip>
              )}
            </Link>
          </div>
        ))}
      </Card>
    </div>
  );
}
