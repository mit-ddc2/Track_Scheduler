import Link from "next/link";
import { notFound } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";

import { Btn } from "@/components/ui/Btn";
import { Card } from "@/components/ui/Card";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import { requireOwner } from "@/lib/auth/require-owner";
import {
  isProblemRow,
  listConsentHistoryFor,
  listConsentRows,
  type ConsentMethodRow,
} from "@/lib/db/consent-queries";
import type {
  ConsentRecord,
  ConsentStatus,
  ContactStatus,
} from "@/lib/db/types";

export const dynamic = "force-dynamic";

const TZ = "America/Toronto";

type Tab = "per-staff" | "opt-outs";

const STATUS_FILTERS: Array<{
  key: string;
  label: string;
  match: (row: ConsentMethodRow) => boolean;
}> = [
  { key: "all", label: "ALL", match: () => true },
  { key: "opted_out", label: "OPTED-OUT", match: (r) => r.status === "opted_out" },
  { key: "bounced", label: "BOUNCED", match: (r) => r.status === "bounced" },
  { key: "suppressed", label: "SUPPRESSED", match: (r) => r.status === "suppressed" },
  { key: "withdrawn", label: "WITHDRAWN", match: (r) => r.consent === "withdrawn" },
  { key: "denied", label: "DENIED", match: (r) => r.consent === "denied" },
];

function statusTone(status: ContactStatus): ChipTone {
  switch (status) {
    case "valid":
      return "ok";
    case "unknown":
      return "default";
    case "invalid":
    case "bounced":
    case "suppressed":
    case "opted_out":
      return "bad";
    default:
      return "default";
  }
}

function consentTone(status: ConsentStatus): ChipTone {
  switch (status) {
    case "granted":
      return "ok";
    case "denied":
    case "withdrawn":
      return "bad";
    case "unknown":
    default:
      return "default";
  }
}

function fmtAbs(iso: string | null): string {
  if (!iso) return "—";
  return formatInTimeZone(new Date(iso), TZ, "yyyy-MM-dd HH:mm");
}

type PageProps = {
  searchParams: Promise<{ tab?: string; filter?: string; advanced?: string }>;
};

export default async function ConsentPage({ searchParams }: PageProps) {
  await requireOwner();
  const params = await searchParams;
  // v2: hidden from simplified settings nav; ?advanced=1 unlocks it.
  if (params.advanced !== "1") {
    notFound();
  }
  const tab: Tab = params.tab === "opt-outs" ? "opt-outs" : "per-staff";
  const filterKey = params.filter ?? "all";

  const rows = await listConsentRows();
  const histories = await listConsentHistoryFor(
    Array.from(new Set(rows.map((r) => r.staff_member_id))),
  );

  // Tab-level filter first…
  const tabFiltered = tab === "opt-outs" ? rows.filter(isProblemRow) : rows;
  // …then chip-level filter on top.
  const activeFilter =
    STATUS_FILTERS.find((f) => f.key === filterKey) ?? STATUS_FILTERS[0];
  const filtered = tabFiltered.filter(activeFilter.match);

  // Group rows by staff for the per-staff table.
  const byStaff = new Map<
    string,
    { display_name: string; active: boolean; methods: ConsentMethodRow[] }
  >();
  for (const r of filtered) {
    const entry = byStaff.get(r.staff_member_id);
    if (entry) {
      entry.methods.push(r);
    } else {
      byStaff.set(r.staff_member_id, {
        display_name: r.staff_display_name,
        active: r.staff_active,
        methods: [r],
      });
    }
  }
  const staffGroups = Array.from(byStaff.entries())
    .map(([staffId, info]) => ({ staffId, ...info }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  const optOutCount = rows.filter(isProblemRow).length;

  return (
    <div
      style={{
        padding: "20px 16px 80px",
        maxWidth: 960,
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
            Consent & opt-outs
          </h1>
          <p
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--text-2)",
              letterSpacing: "0.04em",
              marginTop: 6,
            }}
          >
            {rows.length} channel{rows.length === 1 ? "" : "s"} ·{" "}
            {optOutCount} problem{optOutCount === 1 ? "" : "s"}
          </p>
        </div>
        <Link href="/dashboard/settings">
          <Btn variant="ghost">Back</Btn>
        </Link>
      </header>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6 }}>
        <Link
          href={`?tab=per-staff${filterKey !== "all" ? `&filter=${filterKey}` : ""}`}
          style={{ textDecoration: "none" }}
        >
          <Chip tone={tab === "per-staff" ? "accent" : "default"}>
            PER-STAFF
          </Chip>
        </Link>
        <Link
          href={`?tab=opt-outs${filterKey !== "all" ? `&filter=${filterKey}` : ""}`}
          style={{ textDecoration: "none" }}
        >
          <Chip tone={tab === "opt-outs" ? "accent" : "default"}>
            OPT-OUTS ({optOutCount})
          </Chip>
        </Link>
      </div>

      {/* Status filter chips */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {STATUS_FILTERS.map((f) => {
          const active = filterKey === f.key;
          const qs = new URLSearchParams();
          qs.set("tab", tab);
          if (f.key !== "all") qs.set("filter", f.key);
          return (
            <Link key={f.key} href={`?${qs.toString()}`} style={{ textDecoration: "none" }}>
              <Chip tone={active ? "info" : "default"}>{f.label}</Chip>
            </Link>
          );
        })}
      </div>

      {staffGroups.length === 0 ? (
        <Card style={{ padding: 28, textAlign: "center" }}>
          <p style={{ margin: 0, color: "var(--text-2)", fontSize: 13 }}>
            {tab === "opt-outs"
              ? "No opt-outs, bounces, or withdrawn consents — nice work."
              : "No contact methods on file yet."}
          </p>
        </Card>
      ) : (
        <Card style={{ padding: 0 }}>
          {staffGroups.map((g, gi) => (
            <div key={g.staffId}>
              {gi > 0 && <hr className="cs-divider" />}
              <div style={{ padding: "14px 16px" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <Link
                    href={`/dashboard/roster/${g.staffId}`}
                    style={{
                      color: "var(--text)",
                      textDecoration: "none",
                      fontWeight: 600,
                      fontSize: 14,
                    }}
                  >
                    {g.display_name}
                  </Link>
                  {!g.active && <Chip tone="warn">INACTIVE</Chip>}
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    marginTop: 10,
                  }}
                >
                  {g.methods.map((m) => {
                    const history = histories.get(`${m.staff_member_id}:${m.channel}`) ?? [];
                    return (
                      <details
                        key={m.contact_method_id}
                        style={{
                          background: "var(--bg-2)",
                          borderRadius: 4,
                          padding: 0,
                        }}
                      >
                        <summary
                          style={{
                            cursor: "pointer",
                            padding: "10px 12px",
                            display: "flex",
                            flexWrap: "wrap",
                            alignItems: "center",
                            gap: 8,
                            fontSize: 12,
                          }}
                        >
                          <Chip>{m.channel.toUpperCase()}</Chip>
                          <span
                            className="mono"
                            style={{ color: "var(--text-2)", flex: "1 1 140px" }}
                          >
                            {m.value}
                          </span>
                          <Chip tone={statusTone(m.status)}>{m.status.toUpperCase()}</Chip>
                          <Chip tone={consentTone(m.consent)}>{m.consent.toUpperCase()}</Chip>
                          <span
                            className="mono"
                            style={{
                              fontSize: 10,
                              color: "var(--text-3)",
                              marginLeft: "auto",
                            }}
                          >
                            {m.consented_at ? fmtAbs(m.consented_at) : "—"}
                          </span>
                        </summary>
                        <div
                          style={{
                            padding: "0 12px 12px",
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                          }}
                        >
                          <span className="cs-label">Consent history</span>
                          {history.length === 0 ? (
                            <p style={{ margin: 0, color: "var(--text-3)", fontSize: 12 }}>
                              No consent records logged yet.
                            </p>
                          ) : (
                            <ul
                              style={{
                                listStyle: "none",
                                padding: 0,
                                margin: 0,
                                display: "flex",
                                flexDirection: "column",
                                gap: 6,
                              }}
                            >
                              {history.map((rec: ConsentRecord) => (
                                <li
                                  key={rec.id}
                                  style={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    alignItems: "center",
                                    gap: 8,
                                    fontSize: 12,
                                  }}
                                >
                                  <span
                                    className="mono"
                                    style={{ color: "var(--text-3)", fontSize: 10 }}
                                  >
                                    {fmtAbs(rec.captured_at)}
                                  </span>
                                  <Chip tone={consentTone(rec.status)}>
                                    {rec.status.toUpperCase()}
                                  </Chip>
                                  <span
                                    className="mono"
                                    style={{ color: "var(--text-2)", fontSize: 10 }}
                                  >
                                    src: {rec.source}
                                  </span>
                                  {rec.notes && (
                                    <span style={{ color: "var(--text-2)" }}>
                                      {rec.notes}
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </details>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
