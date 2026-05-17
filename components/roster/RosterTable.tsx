"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Chip } from "@/components/ui/Chip";

import { ChannelBadge } from "./ChannelBadge";
import type { StaffSummary } from "@/lib/roster/queries";

type SortKey =
  | "name"
  | "primary_role"
  | "phone"
  | "email"
  | "preferred_contact"
  | "qualifications";

type RosterTableProps = {
  rows: Array<StaffSummary & { lastWorked?: string | null }>;
};

/**
 * Desktop-only data-dense table. Hidden under `md:`. Sort state is
 * client-side and stateless across navigations — fine for MVP scale.
 */
export function RosterTable({ rows }: RosterTableProps) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "name",
    dir: "asc",
  });

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = pick(a, sort.key);
      const bv = pick(b, sort.key);
      return sort.dir === "asc" ? cmp(av, bv) : cmp(bv, av);
    });
    return copy;
  }, [rows, sort]);

  function toggle(key: SortKey) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );
  }

  return (
    <div
      className="hidden md:block"
      style={{
        border: "1px solid var(--line)",
        borderRadius: 4,
        background: "var(--surface)",
        overflow: "hidden",
      }}
    >
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 13,
        }}
      >
        <thead>
          <tr style={{ background: "var(--bg-2)" }}>
            <Th onClick={() => toggle("name")} active={sort.key === "name"} dir={sort.dir}>
              Name
            </Th>
            <Th onClick={() => toggle("primary_role")} active={sort.key === "primary_role"} dir={sort.dir}>
              Primary role
            </Th>
            <Th onClick={() => toggle("qualifications")} active={sort.key === "qualifications"} dir={sort.dir}>
              Qualifications
            </Th>
            <Th onClick={() => toggle("phone")} active={sort.key === "phone"} dir={sort.dir}>
              Phone
            </Th>
            <Th onClick={() => toggle("email")} active={sort.key === "email"} dir={sort.dir}>
              Email
            </Th>
            <Th
              onClick={() => toggle("preferred_contact")}
              active={sort.key === "preferred_contact"}
              dir={sort.dir}
            >
              Preferred
            </Th>
            <Th sortable={false}>Last worked</Th>
            <Th sortable={false}>Channels</Th>
            <Th sortable={false}>Status</Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={r.id}
              style={{
                borderTop: "1px solid var(--line)",
              }}
            >
              <Td>
                <Link
                  href={`/dashboard/roster/${r.id}`}
                  style={{
                    color: "var(--text)",
                    textDecoration: "none",
                    fontWeight: 600,
                  }}
                >
                  {r.display_name}
                </Link>
              </Td>
              <Td muted={!r.primary_role}>{r.primary_role ?? "—"}</Td>
              <Td>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {r.qualifications.length === 0
                    ? <span style={{ color: "var(--text-3)" }}>—</span>
                    : r.qualifications.map((q) => (
                        <Chip key={q}>{q}</Chip>
                      ))}
                </div>
              </Td>
              <Td muted={!r.phone}>{r.phone ?? "—"}</Td>
              <Td muted={!r.email}>{r.email ?? "—"}</Td>
              <Td>
                <span
                  className="mono"
                  style={{
                    fontSize: 11,
                    color: "var(--text-2)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  {r.preferred_contact.replace("_", " ")}
                </span>
              </Td>
              <Td muted>{r.lastWorked ?? "—"}</Td>
              <Td>
                <div style={{ display: "flex", gap: 4 }}>
                  <ChannelBadge channel="sms" present={r.sms_present} status={r.sms_status ?? "unknown"} />
                  <ChannelBadge channel="email" present={r.email_present} status={r.email_status ?? "unknown"} />
                </div>
              </Td>
              <Td>
                <Chip tone={r.active ? "ok" : "warn"}>
                  {r.active ? "ACTIVE" : "INACTIVE"}
                </Chip>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  onClick,
  active,
  dir,
  sortable = true,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  dir?: "asc" | "desc";
  sortable?: boolean;
}) {
  return (
    <th
      onClick={sortable ? onClick : undefined}
      style={{
        textAlign: "left",
        padding: "10px 12px",
        cursor: sortable ? "pointer" : "default",
        color: "var(--text-3)",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        fontSize: 10,
        fontWeight: 700,
        userSelect: "none",
        whiteSpace: "nowrap",
      }}
    >
      {children}
      {active && sortable && (
        <span style={{ marginLeft: 6, color: "var(--accent)" }}>
          {dir === "asc" ? "▲" : "▼"}
        </span>
      )}
    </th>
  );
}

function Td({
  children,
  muted,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <td
      style={{
        padding: "10px 12px",
        color: muted ? "var(--text-3)" : "var(--text)",
        verticalAlign: "middle",
      }}
    >
      {children}
    </td>
  );
}

function pick(r: StaffSummary & { lastWorked?: string | null }, key: SortKey): string {
  switch (key) {
    case "name":
      return r.display_name?.toLowerCase() ?? "";
    case "primary_role":
      return r.primary_role?.toLowerCase() ?? "";
    case "phone":
      return r.phone ?? "";
    case "email":
      return r.email ?? "";
    case "preferred_contact":
      return r.preferred_contact;
    case "qualifications":
      return r.qualifications.join(",").toLowerCase();
    default:
      return "";
  }
}

function cmp(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
