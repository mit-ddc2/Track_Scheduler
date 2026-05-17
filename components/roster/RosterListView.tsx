"use client";

import { Plus, Search, Upload, Download } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Btn } from "@/components/ui/Btn";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";

import { RosterCard } from "./RosterCard";
import { RosterTable } from "./RosterTable";
import type { StaffSummary } from "@/lib/roster/queries";

type RosterListViewProps = {
  rows: StaffSummary[];
  roleNames: string[];
};

type Filter = "all" | "inactive" | "no_sms" | "no_email" | `role:${string}`;

export function RosterListView({ rows, roleNames }: RosterListViewProps) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "inactive" && r.active) return false;
      if (filter === "no_sms" && r.sms_present) return false;
      if (filter === "no_email" && r.email_present) return false;
      if (filter.startsWith("role:")) {
        const role = filter.slice("role:".length).toLowerCase();
        const hit = r.primary_role?.toLowerCase() === role;
        if (!hit) return false;
      }
      if (filter === "all" && !r.active) return false;
      if (!needle) return true;
      return (
        r.display_name.toLowerCase().includes(needle) ||
        (r.primary_role ?? "").toLowerCase().includes(needle) ||
        r.qualifications.some((qq) => qq.toLowerCase().includes(needle)) ||
        (r.email ?? "").toLowerCase().includes(needle) ||
        (r.phone ?? "").toLowerCase().includes(needle)
      );
    });
  }, [q, filter, rows]);

  return (
    <div
      style={{
        maxWidth: 1200,
        margin: "0 auto",
        padding: "16px 16px 80px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <span className="cs-eyebrow">Crew · {rows.length} responders</span>
          <h1 className="cs-h1" style={{ marginTop: 4 }}>
            Roster
          </h1>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/dashboard/roster/import">
            <Btn variant="ghost">
              <Upload size={14} strokeWidth={1.6} /> Import CSV
            </Btn>
          </Link>
          <a href="/api/exports/roster">
            <Btn variant="ghost">
              <Download size={14} strokeWidth={1.6} /> Export
            </Btn>
          </a>
          <Link href="/dashboard/roster/new">
            <Btn variant="primary">
              <Plus size={14} strokeWidth={1.6} /> Add staff
            </Btn>
          </Link>
        </div>
      </header>

      <div style={{ position: "relative" }}>
        <span
          style={{
            position: "absolute",
            left: 12,
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--text-3)",
          }}
        >
          <Search size={16} strokeWidth={1.6} />
        </span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, role, qual, phone, email…"
          aria-label="Search roster"
          style={{
            width: "100%",
            padding: "12px 12px 12px 38px",
            borderRadius: 4,
            border: "1px solid var(--line)",
            background: "var(--surface)",
            color: "var(--text)",
            font: "500 14px/1.2 inherit",
            minHeight: 44,
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          gap: 6,
          overflowX: "auto",
          paddingBottom: 4,
        }}
      >
        <FilterPill active={filter === "all"} onClick={() => setFilter("all")} label="ALL" />
        {roleNames.map((name) => {
          const key = `role:${name}` as Filter;
          return (
            <FilterPill
              key={name}
              active={filter === key}
              onClick={() => setFilter(key)}
              label={name.toUpperCase()}
            />
          );
        })}
        <FilterPill
          active={filter === "inactive"}
          onClick={() => setFilter("inactive")}
          label="INACTIVE"
        />
        <FilterPill
          active={filter === "no_sms"}
          onClick={() => setFilter("no_sms")}
          label="NO SMS"
        />
        <FilterPill
          active={filter === "no_email"}
          onClick={() => setFilter("no_email")}
          label="NO EMAIL"
        />
      </div>

      {filtered.length === 0 ? (
        <Card style={{ padding: 24, textAlign: "center" }}>
          {rows.length === 0 ? (
            <>
              <div className="cs-h3" style={{ marginBottom: 8 }}>
                No responders yet.
              </div>
              <p style={{ color: "var(--text-2)", marginBottom: 14 }}>
                Add your first responder, or bulk-import from a CSV export of
                your phone contacts.
              </p>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  justifyContent: "center",
                  flexWrap: "wrap",
                }}
              >
                <Link href="/dashboard/roster/new">
                  <Btn variant="primary">
                    <Plus size={14} strokeWidth={1.6} /> Add your first responder
                  </Btn>
                </Link>
                <Link href="/dashboard/roster/import">
                  <Btn variant="ghost">
                    <Upload size={14} strokeWidth={1.6} /> Import CSV
                  </Btn>
                </Link>
              </div>
            </>
          ) : (
            <div style={{ color: "var(--text-2)" }}>
              No responders match the current filters.
            </div>
          )}
        </Card>
      ) : (
        <>
          {/* Mobile cards */}
          <Card className="md:hidden">
            {filtered.map((r, i) => (
              <div key={r.id}>
                {i > 0 && <div className="cs-divider" />}
                <RosterCard staff={r} />
              </div>
            ))}
          </Card>
          {/* Desktop table */}
          <RosterTable rows={filtered} />
        </>
      )}
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flexShrink: 0,
        minHeight: 32,
        padding: "6px 12px",
        borderRadius: 3,
        border: "1px solid var(--line)",
        background: active ? "var(--accent)" : "var(--chip-bg)",
        color: active ? "var(--accent-ink)" : "var(--text-2)",
        font: "600 10px/1 var(--font-jetbrains-mono), monospace",
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

// Keep the import referenced for type usage clarity.
void Chip;
