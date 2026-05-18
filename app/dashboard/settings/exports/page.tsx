import Link from "next/link";
import { notFound } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { Download } from "lucide-react";

import { Btn } from "@/components/ui/Btn";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { requireOwner } from "@/lib/auth/require-owner";
import { createClient } from "@/lib/db/supabase-server";
import { getLatestAuditTimestampForActions } from "@/lib/db/audit-queries";
import type { EventRow } from "@/lib/db/types";

import { PayrollEventPicker } from "./PayrollEventPicker";

export const dynamic = "force-dynamic";

const TZ = "America/Toronto";

async function fetchActiveStaffCount(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("staff_members")
    .select("id", { count: "exact", head: true })
    .eq("active", true);
  if (error) {
    console.warn("[exports] fetchActiveStaffCount failed:", error.message);
    return 0;
  }
  return count ?? 0;
}

async function fetchRecentEvents(days: number): Promise<EventRow[]> {
  const supabase = await createClient();
  const sinceIso = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from("events")
    .select(
      "id, title, starts_at, ends_at, timezone, status, event_type",
    )
    .gte("starts_at", sinceIso)
    .neq("status", "cancelled")
    .order("starts_at", { ascending: false })
    .limit(60);
  if (error) {
    console.warn("[exports] fetchRecentEvents failed:", error.message);
    return [];
  }
  return (data ?? []) as unknown as EventRow[];
}

function fmtRelative(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "Never";
  const then = new Date(iso);
  const diffSec = Math.round((now.getTime() - then.getTime()) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

type PageProps = {
  searchParams?: Promise<{ advanced?: string }>;
};

export default async function ExportsPage({ searchParams }: PageProps = {}) {
  await requireOwner();
  // v2: hidden from simplified settings nav; ?advanced=1 unlocks it.
  const params = searchParams ? await searchParams : {};
  if (params.advanced !== "1") {
    notFound();
  }
  const [staffCount, events, lastRosterExport, lastPayrollExport] =
    await Promise.all([
      fetchActiveStaffCount(),
      fetchRecentEvents(90),
      getLatestAuditTimestampForActions(["roster.export_csv", "roster.export"]),
      getLatestAuditTimestampForActions(["payroll.export"]),
    ]);

  const now = new Date();

  return (
    <div
      style={{
        padding: "20px 16px 100px",
        maxWidth: 720,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <span className="cs-eyebrow">Settings</span>
          <h1 className="cs-h1" style={{ marginTop: 4 }}>
            Exports
          </h1>
          <p
            style={{
              color: "var(--text-2)",
              fontSize: 13,
              margin: "6px 0 0",
              maxWidth: 520,
            }}
          >
            Download CSVs for roster + per-event payroll. Each file is
            formula-injection-safe, UTF-8 encoded, and opens in Excel, Sheets,
            or Numbers without extra setup.
          </p>
        </div>
        <Link href="/dashboard/settings">
          <Btn variant="ghost">Back</Btn>
        </Link>
      </header>

      {/* Roster export */}
      <Card style={{ padding: 16 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 8,
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
            <Download size={16} strokeWidth={1.6} />
          </span>
          <div>
            <h2 className="cs-h3">Active roster CSV</h2>
            <div
              className="mono"
              style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}
            >
              {staffCount} active staff member{staffCount === 1 ? "" : "s"}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            marginTop: 10,
          }}
        >
          <span
            className="mono"
            style={{ fontSize: 11, color: "var(--text-3)" }}
          >
            Last export:{" "}
            <span style={{ color: "var(--text-2)" }}>
              {fmtRelative(lastRosterExport, now)}
            </span>
          </span>
          <a
            href="/api/exports/roster"
            className="cs-btn cs-btn--primary"
            style={{ textDecoration: "none" }}
            target="_blank"
            rel="noopener noreferrer"
            download
          >
            <Download size={14} strokeWidth={1.8} /> DOWNLOAD CSV
          </a>
        </div>
      </Card>

      {/* Payroll export */}
      <Card style={{ padding: 16 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 8,
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
            <Download size={16} strokeWidth={1.6} />
          </span>
          <div>
            <h2 className="cs-h3">Per-event payroll CSV</h2>
            <div
              className="mono"
              style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}
            >
              {events.length} event{events.length === 1 ? "" : "s"} in the last 90 days
            </div>
          </div>
        </div>

        {events.length === 0 ? (
          <p
            style={{
              color: "var(--text-3)",
              fontSize: 12,
              margin: "10px 0 0",
            }}
          >
            No events in the last 90 days. Create or complete an event first.
          </p>
        ) : (
          <PayrollEventPicker
            events={events.map((e) => ({
              id: e.id,
              title: e.title,
              dateLabel: formatInTimeZone(
                new Date(e.starts_at),
                e.timezone || TZ,
                "EEE MMM d",
              ),
              status: e.status,
            }))}
          />
        )}

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
            marginTop: 10,
          }}
        >
          <span
            className="mono"
            style={{ fontSize: 11, color: "var(--text-3)" }}
          >
            Last export:{" "}
            <span style={{ color: "var(--text-2)" }}>
              {fmtRelative(lastPayrollExport, now)}
            </span>
          </span>
        </div>
      </Card>

      {/* Info block */}
      <Card style={{ padding: 16 }}>
        <span className="cs-label">About these files</span>
        <ul
          style={{
            margin: "8px 0 0 16px",
            color: "var(--text-2)",
            fontSize: 13,
            lineHeight: 1.55,
          }}
        >
          <li>UTF-8 with CRLF line endings (RFC 4180).</li>
          <li>
            Formula-injection-safe: any value starting with{" "}
            <span className="mono">= + - @</span> is prefixed with a single
            quote so spreadsheet apps never auto-execute it.
          </li>
          <li>Opens cleanly in Excel, Google Sheets, and Apple Numbers.</li>
          <li>
            Every download is recorded in the audit log as{" "}
            <Chip>ROSTER.EXPORT_CSV</Chip> or <Chip>PAYROLL.EXPORT</Chip>.
          </li>
        </ul>
      </Card>

      {/* Sticky footer help link */}
      <div
        style={{
          position: "sticky",
          bottom: 0,
          marginTop: 16,
          padding: "10px 12px",
          background: "color-mix(in srgb, var(--bg) 92%, transparent)",
          borderTop: "1px solid var(--line)",
          backdropFilter: "blur(6px)",
          textAlign: "center",
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--text-3)",
            letterSpacing: "0.04em",
          }}
        >
          Need help? Open <span style={{ color: "var(--text-2)" }}>OPERATIONS.md</span> in the repo →
        </span>
      </div>
    </div>
  );
}
