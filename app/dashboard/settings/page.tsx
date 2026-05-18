import {
  Award,
  Bell,
  CalendarClock,
  ChevronRight,
  Download,
  FileSpreadsheet,
  History,
  LogOut,
  MessageSquare,
  ShieldCheck,
  Users,
} from "lucide-react";
import Link from "next/link";

import { Card } from "@/components/ui/Card";

import { DrainNowButton } from "./DrainNowButton";
import { triggerDrainNow } from "./drain-actions";
import { ResetDemoButton } from "./ResetDemoButton";

type SettingsLink = {
  href: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  badge?: string;
  /**
   * "always" — visible in both simplified and advanced views (Robert needs this)
   * "advanced" — hidden by default; only rendered when `?advanced=1` is set
   */
  visibility: "always" | "advanced";
};

const LINKS: SettingsLink[] = [
  {
    href: "/dashboard/settings/roles",
    title: "Crew roles",
    description: "Manage operational role categories (Incident Lead, Rescue Crew…)",
    icon: Users,
    visibility: "always",
  },
  {
    href: "/dashboard/settings/qualifications",
    title: "Qualifications",
    description: "Manage capability tags (Fire Suppression, Extrication, First Aid…)",
    icon: Award,
    visibility: "always",
  },
  {
    href: "/dashboard/events/import",
    title: "Import events",
    description:
      "Bulk-import events from Robert's planning spreadsheet (xlsx).",
    icon: FileSpreadsheet,
    visibility: "always",
  },
  {
    href: "/dashboard/settings/notifications",
    title: "Notification preferences",
    description: "Choose how you hear about each kind of event (in-app, email, SMS).",
    icon: Bell,
    visibility: "advanced",
  },
  {
    href: "/dashboard/settings/calendar",
    title: "Calendar",
    description: "Google Calendar / ICS feed connections.",
    icon: CalendarClock,
    badge: "v1.1",
    visibility: "advanced",
  },
  {
    href: "/dashboard/settings/exports",
    title: "Exports",
    description:
      "Download roster + per-event payroll CSV files. Formula-injection-safe.",
    icon: Download,
    badge: "LIVE",
    visibility: "advanced",
  },
  {
    href: "/dashboard/settings/consent",
    title: "Consent & opt-outs",
    description:
      "Per-channel consent + suppression status, with full consent history.",
    icon: ShieldCheck,
    badge: "LIVE",
    visibility: "advanced",
  },
  {
    href: "/dashboard/settings/audit",
    title: "Audit log",
    description:
      "Filterable activity log of every owner, system, and responder action.",
    icon: History,
    badge: "LIVE",
    visibility: "advanced",
  },
  {
    href: "/dashboard/mock-sms",
    title: "Mock SMS log (dev)",
    description: "Outgoing SMS captured by the mock provider for E2E + dev.",
    icon: MessageSquare,
    badge: "DEV",
    visibility: "advanced",
  },
];

type PageProps = {
  searchParams?: Promise<{ advanced?: string }>;
};

export default async function SettingsPage({ searchParams }: PageProps) {
  // Server-side env read — `cronSecret` is only forwarded to the Client
  // Component when the reset flow is enabled, so it never enters the bundle
  // in production.
  const resetEnabled = process.env.DEV_RESET_DEMO_ENABLED === "true";
  const cronSecret = resetEnabled ? (process.env.CRON_SECRET ?? "") : "";

  const params = searchParams ? await searchParams : {};
  const advanced = params.advanced === "1";

  // Default view: only the two entries Robert actually uses, plus a sign-out
  // action card at the bottom. Advanced view: every entry as before.
  const visibleLinks = advanced
    ? LINKS
    : LINKS.filter((l) => l.visibility === "always");

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
        {visibleLinks.map((link, i) => (
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

      {/* Sign-out as its own primary action card so it stands apart from
          navigation entries — Robert always sees this, advanced or not. */}
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <form action="/auth/sign-out" method="post">
          <button
            type="submit"
            style={{
              all: "unset",
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "14px 16px",
              width: "100%",
              minHeight: 64,
              cursor: "pointer",
              boxSizing: "border-box",
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
              <LogOut size={16} strokeWidth={1.6} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Sign out</div>
              <div
                style={{
                  color: "var(--text-3)",
                  fontSize: 12,
                  marginTop: 3,
                }}
              >
                End this session and return to the sign-in page.
              </div>
            </div>
          </button>
        </form>
      </Card>

      {/* "Drain now" — needed because Vercel Hobby cron only runs once per
          day. After Robert hits "Send invites" or "Cancel event" he can hit
          this to shake the outbox loose immediately. Owner-only via the
          server action's requireOwner() guard. */}
      <Card style={{ padding: 16, marginTop: 4 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 8,
          }}
        >
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
            OUTBOX
          </span>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Send queued messages</div>
        </div>
        <div
          style={{
            color: "var(--text-3)",
            fontSize: 12,
            marginBottom: 12,
            lineHeight: 1.5,
          }}
        >
          Triggers the message drain immediately instead of waiting for the
          daily cron. Use this right after sending invites or cancelling an
          event so notifications go out within seconds.
        </div>
        <DrainNowButton action={triggerDrainNow} />
      </Card>

      {resetEnabled && cronSecret && (
        <Card style={{ padding: 16, marginTop: 4 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 8,
            }}
          >
            <span
              className="mono"
              style={{
                fontSize: 9,
                background: "color-mix(in srgb, var(--ok) 12%, transparent)",
                color: "var(--ok)",
                padding: "2px 6px",
                borderRadius: 3,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              LIVE
            </span>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Demo data</div>
          </div>
          <div
            style={{
              color: "var(--text-3)",
              fontSize: 12,
              marginBottom: 12,
              lineHeight: 1.5,
            }}
          >
            Wipe + re-seed the canonical 6-staff / 3-event fixture set. Use
            after a customer demo to leave a clean trail.
          </div>
          <ResetDemoButton cronSecret={cronSecret} />
        </Card>
      )}

      {!advanced && (
        <p
          className="mono"
          style={{
            fontSize: 10,
            color: "var(--text-3)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            margin: "8px 4px 0",
            opacity: 0.7,
          }}
        >
          More settings: append <code>?advanced=1</code> to this URL
        </p>
      )}
    </div>
  );
}
