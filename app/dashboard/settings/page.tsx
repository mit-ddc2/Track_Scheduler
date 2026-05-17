import {
  Award,
  Bell,
  CalendarClock,
  ChevronRight,
  Download,
  History,
  ShieldCheck,
  Users,
} from "lucide-react";
import Link from "next/link";

import { Card } from "@/components/ui/Card";

type SettingsLink = {
  href: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  badge?: string;
};

const LINKS: SettingsLink[] = [
  {
    href: "/dashboard/settings/roles",
    title: "Crew roles",
    description: "Manage operational role categories (Incident Lead, Rescue Crew…)",
    icon: Users,
  },
  {
    href: "/dashboard/settings/qualifications",
    title: "Qualifications",
    description: "Manage capability tags (Fire Suppression, Extrication, First Aid…)",
    icon: Award,
  },
  {
    href: "/dashboard/settings/notifications",
    title: "Notification preferences",
    description: "Choose how you hear about each kind of event (in-app, email, SMS).",
    icon: Bell,
  },
  {
    href: "/dashboard/settings/calendar",
    title: "Calendar",
    description: "Google Calendar / ICS feed connections.",
    icon: CalendarClock,
    badge: "v1.1",
  },
  {
    href: "/dashboard/settings/exports",
    title: "Exports",
    description:
      "Download roster + per-event payroll CSV files. Formula-injection-safe.",
    icon: Download,
    badge: "LIVE",
  },
  {
    href: "/dashboard/settings/consent",
    title: "Consent & opt-outs",
    description:
      "Per-channel consent + suppression status, with full consent history.",
    icon: ShieldCheck,
    badge: "LIVE",
  },
  {
    href: "/dashboard/settings/audit",
    title: "Audit log",
    description:
      "Filterable activity log of every owner, system, and responder action.",
    icon: History,
    badge: "LIVE",
  },
];

export default function SettingsPage() {
  return (
    <div
      style={{
        padding: "20px 16px 80px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        maxWidth: 720,
        margin: "0 auto",
      }}
    >
      <div>
        <span className="cs-eyebrow">Owner</span>
        <h1 className="cs-h1" style={{ marginTop: 4 }}>
          Settings
        </h1>
      </div>
      <Card>
        {LINKS.map((link, i) => (
          <div key={link.href}>
            {i > 0 && <div className="cs-divider" />}
            <Link
              href={link.href}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "14px 16px",
                color: "inherit",
                textDecoration: "none",
                minHeight: 64,
              }}
            >
              <span
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 4,
                  background: "var(--surface-2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-2)",
                  flexShrink: 0,
                }}
              >
                <link.icon size={16} strokeWidth={1.6} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 14,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  {link.title}
                  {link.badge && (
                    <span
                      className="mono"
                      style={{
                        fontSize: 9,
                        background: "var(--chip-bg)",
                        color: "var(--text-3)",
                        padding: "2px 6px",
                        borderRadius: 3,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                      }}
                    >
                      {link.badge}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    color: "var(--text-3)",
                    fontSize: 12,
                    marginTop: 3,
                  }}
                >
                  {link.description}
                </div>
              </div>
              <ChevronRight size={16} strokeWidth={1.6} color="var(--text-3)" />
            </Link>
          </div>
        ))}
      </Card>
    </div>
  );
}
