"use client";

import {
  Calendar,
  Inbox,
  MoreHorizontal,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  match: (pathname: string) => boolean;
};

const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Events",
    icon: Calendar,
    match: (p) => p === "/dashboard" || p.startsWith("/dashboard/events"),
  },
  {
    href: "/dashboard/roster",
    label: "Roster",
    icon: Users,
    match: (p) => p.startsWith("/dashboard/roster"),
  },
  {
    href: "/dashboard/notifications",
    label: "Activity",
    icon: Inbox,
    match: (p) => p.startsWith("/dashboard/notifications"),
  },
  {
    href: "/dashboard/settings",
    label: "More",
    icon: MoreHorizontal,
    match: (p) => p.startsWith("/dashboard/settings"),
  },
];

function NavIcon({ icon: Icon, size = 20 }: { icon: LucideIcon; size?: number }) {
  return <Icon size={size} strokeWidth={1.6} />;
}

/** Bottom tab bar — mobile only. Hidden at `md:` and up. */
export function BottomNav() {
  const pathname = usePathname() ?? "/dashboard";
  return (
    <nav
      aria-label="Primary"
      className="md:hidden"
      style={{
        flexShrink: 0,
        borderTop: "1px solid var(--line)",
        background: "var(--bg-2)",
        paddingBottom: 18,
        paddingTop: 4,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
        }}
      >
        {NAV_ITEMS.map((item) => {
          const active = item.match(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn("relative")}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                padding: "8px 0 6px",
                color: active ? "var(--text)" : "var(--text-3)",
                textDecoration: "none",
                position: "relative",
              }}
            >
              <NavIcon icon={item.icon} />
              <span
                className="mono"
                style={{
                  fontSize: 9,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  fontWeight: 700,
                }}
              >
                {item.label}
              </span>
              {active && (
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    top: 0,
                    left: "25%",
                    right: "25%",
                    height: 2,
                    background: "var(--accent)",
                  }}
                />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Left rail — desktop only. Visible from `md:` and up. */
export function DeskRail() {
  const pathname = usePathname() ?? "/dashboard";
  return (
    <aside
      aria-label="Primary"
      className="hidden md:flex"
      style={{
        width: 64,
        flexShrink: 0,
        borderRight: "1px solid var(--line)",
        background: "var(--bg-2)",
        flexDirection: "column",
        alignItems: "center",
        padding: "14px 0",
        gap: 4,
      }}
    >
      <div
        aria-hidden
        style={{
          width: 36,
          height: 36,
          borderRadius: 4,
          background: "var(--accent)",
          color: "var(--accent-ink)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 18,
        }}
      >
        <span
          className="mono"
          style={{ fontWeight: 800, fontSize: 14, letterSpacing: "-0.02em" }}
        >
          C
        </span>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          flex: 1,
        }}
      >
        {NAV_ITEMS.map((item) => {
          const active = item.match(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              style={{
                width: 40,
                height: 40,
                borderRadius: 4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: active ? "var(--surface)" : "transparent",
                color: active ? "var(--text)" : "var(--text-3)",
                position: "relative",
                textDecoration: "none",
              }}
            >
              <NavIcon icon={item.icon} size={18} />
              {active && (
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 8,
                    bottom: 8,
                    width: 2,
                    background: "var(--accent)",
                  }}
                />
              )}
            </Link>
          );
        })}
      </div>
    </aside>
  );
}
