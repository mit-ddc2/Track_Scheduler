"use client";

import { useMemo, useState } from "react";

import { Avatar } from "@/components/roster/Avatar";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import type {
  PreferredContactMethod,
  ContactStatus,
  ConsentStatus,
} from "@/lib/db/types";

export type InviteCandidate = {
  id: string;
  display_name: string;
  active: boolean;
  preferred_contact: PreferredContactMethod;
  primary_role: string | null;
  qualifications: string[];
  sms_present: boolean;
  email_present: boolean;
  sms_status: ContactStatus | null;
  email_status: ContactStatus | null;
  sms_consent: ConsentStatus | null;
  email_consent: ConsentStatus | null;
  already_invited: boolean;
  already_declined: boolean;
};

export type InviteSelectStepProps = {
  candidates: InviteCandidate[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
};

type FilterKey =
  | "all"
  | "active"
  | "has_sms"
  | "has_email"
  | "not_invited"
  | "not_declined";

const FILTERS: ReadonlyArray<{ key: FilterKey; label: string }> = [
  { key: "all", label: "ALL" },
  { key: "active", label: "ACTIVE" },
  { key: "has_sms", label: "HAS SMS" },
  { key: "has_email", label: "HAS EMAIL" },
  { key: "not_invited", label: "NOT INVITED" },
  { key: "not_declined", label: "NOT DECLINED" },
];

function applyFilter(c: InviteCandidate, filter: FilterKey): boolean {
  switch (filter) {
    case "all":
      return true;
    case "active":
      return c.active;
    case "has_sms":
      return c.sms_present;
    case "has_email":
      return c.email_present;
    case "not_invited":
      return !c.already_invited;
    case "not_declined":
      return !c.already_declined;
  }
}

export function InviteSelectStep({
  candidates,
  selected,
  onToggle,
  onSelectAll,
}: InviteSelectStepProps) {
  const [filter, setFilter] = useState<FilterKey>("active");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [qualFilter, setQualFilter] = useState<string | null>(null);

  // Build chip lists for distinct roles + quals across the visible pool.
  const allRoles = useMemo(() => {
    const set = new Set<string>();
    for (const c of candidates) if (c.primary_role) set.add(c.primary_role);
    return Array.from(set).sort();
  }, [candidates]);
  const allQuals = useMemo(() => {
    const set = new Set<string>();
    for (const c of candidates) c.qualifications.forEach((q) => set.add(q));
    return Array.from(set).sort();
  }, [candidates]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return candidates.filter((c) => {
      if (!applyFilter(c, filter)) return false;
      if (roleFilter && c.primary_role !== roleFilter) return false;
      if (qualFilter && !c.qualifications.includes(qualFilter)) return false;
      if (q && !c.display_name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [candidates, filter, query, roleFilter, qualFilter]);

  return (
    <div style={{ padding: "14px 0 8px" }}>
      {/* Filter chips */}
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "0 16px",
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            style={{
              background: "transparent",
              border: 0,
              padding: 0,
              cursor: "pointer",
            }}
          >
            <Chip tone={filter === f.key ? "accent" : "default"}>{f.label}</Chip>
          </button>
        ))}
        {allRoles.map((r) => (
          <button
            key={`role-${r}`}
            type="button"
            onClick={() => setRoleFilter(roleFilter === r ? null : r)}
            style={{
              background: "transparent",
              border: 0,
              padding: 0,
              cursor: "pointer",
            }}
          >
            <Chip tone={roleFilter === r ? "accent" : "default"}>
              ROLE · {r.toUpperCase()}
            </Chip>
          </button>
        ))}
        {allQuals.map((q) => (
          <button
            key={`qual-${q}`}
            type="button"
            onClick={() => setQualFilter(qualFilter === q ? null : q)}
            style={{
              background: "transparent",
              border: 0,
              padding: 0,
              cursor: "pointer",
            }}
          >
            <Chip tone={qualFilter === q ? "accent" : "default"}>{q}</Chip>
          </button>
        ))}
      </div>

      {/* Search */}
      <div style={{ padding: "0 16px", marginBottom: 12 }}>
        <input
          type="search"
          placeholder="Search responders…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search responders"
          style={{
            width: "100%",
            padding: "10px 12px",
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 4,
            color: "var(--text)",
            font: "400 13px/1.2 Inter, sans-serif",
          }}
        />
      </div>

      {/* Counter + select-all */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          padding: "0 16px",
          marginBottom: 12,
        }}
      >
        <span className="cs-eyebrow">
          {visible.length} CANDIDATES · {selected.size} SELECTED
        </span>
        <button
          type="button"
          onClick={onSelectAll}
          style={{
            background: "transparent",
            border: 0,
            color: "var(--accent)",
            font: "600 10px/1 var(--font-jetbrains-mono), monospace",
            letterSpacing: "0.1em",
            cursor: "pointer",
            textTransform: "uppercase",
          }}
        >
          SELECT ALL
        </button>
      </div>

      <Card style={{ marginInline: 16 }}>
        {visible.length === 0 && (
          <div
            style={{
              padding: 24,
              textAlign: "center",
              color: "var(--text-3)",
              fontSize: 12,
            }}
          >
            No matching responders.
          </div>
        )}
        {visible.map((c, i) => {
          const on = selected.has(c.id);
          return (
            <div key={c.id}>
              {i > 0 && <div className="cs-divider" />}
              <button
                type="button"
                onClick={() => onToggle(c.id)}
                aria-pressed={on}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 14px",
                  cursor: "pointer",
                  background: on ? "var(--surface-2)" : "transparent",
                  border: 0,
                  textAlign: "left",
                  color: "inherit",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 3,
                    flexShrink: 0,
                    background: on ? "var(--accent)" : "transparent",
                    border: `1.5px solid ${on ? "var(--accent)" : "var(--line-2, rgba(255,255,255,0.2))"}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--accent-ink)",
                    fontWeight: 700,
                    fontSize: 12,
                  }}
                >
                  {on ? "✓" : ""}
                </span>
                <Avatar name={c.display_name} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {c.display_name}
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 10,
                      color: "var(--text-3)",
                      marginTop: 2,
                      letterSpacing: "0.04em",
                    }}
                  >
                    {(c.primary_role ?? "—").toUpperCase()}
                    {c.qualifications.length > 0
                      ? ` · ${c.qualifications.join("·")}`
                      : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {c.sms_present && (
                    <Chip
                      tone={c.sms_status === "opted_out" ? "bad" : "default"}
                    >
                      SMS
                    </Chip>
                  )}
                  {c.email_present && (
                    <Chip
                      tone={c.email_status === "bounced" ? "bad" : "default"}
                    >
                      EMAIL
                    </Chip>
                  )}
                </div>
              </button>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
