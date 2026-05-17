"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Btn } from "@/components/ui/Btn";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import {
  archiveRole,
  createRole,
  updateRole,
} from "@/app/dashboard/roster/actions";
import type { CrewRole } from "@/lib/db/types";

type Usage = Record<string, number>;

type RoleManagerProps = {
  roles: CrewRole[];
  usage: Usage;
};

export function RoleManager({ roles, usage }: RoleManagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  function add() {
    if (!newName.trim()) return;
    startTransition(async () => {
      const r = await createRole({ name: newName.trim() });
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setNewName("");
      router.refresh();
    });
  }

  function toggleActive(role: CrewRole) {
    const used = (usage[role.id] ?? 0) > 0;
    if (role.active && used) {
      if (
        !window.confirm(
          `“${role.name}” is currently assigned to ${usage[role.id]} responder(s). Archive anyway? History is preserved.`,
        )
      ) {
        return;
      }
    }
    startTransition(async () => {
      if (role.active) {
        await archiveRole(role.id);
      } else {
        await updateRole(role.id, { active: true });
      }
      router.refresh();
    });
  }

  function rename(role: CrewRole, name: string) {
    if (!name.trim() || name === role.name) return;
    startTransition(async () => {
      await updateRole(role.id, { name: name.trim() });
      router.refresh();
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {error && (
        <Card style={{ padding: 12, color: "var(--bad)" }}>{error}</Card>
      )}

      <Card style={{ padding: 14 }}>
        <span className="cs-label">New role</span>
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Tow & Recovery"
            style={inputStyle}
          />
          <Btn variant="primary" disabled={isPending} onClick={add}>
            Add
          </Btn>
        </div>
      </Card>

      <Card>
        {roles.length === 0 && (
          <div style={{ padding: 16, color: "var(--text-3)" }}>
            No roles yet.
          </div>
        )}
        {roles.map((r, i) => (
          <div key={r.id}>
            {i > 0 && <div className="cs-divider" />}
            <RoleRow
              role={r}
              usage={usage[r.id] ?? 0}
              onRename={(name) => rename(r, name)}
              onToggle={() => toggleActive(r)}
              disabled={isPending}
            />
          </div>
        ))}
      </Card>
    </div>
  );
}

function RoleRow({
  role,
  usage,
  onRename,
  onToggle,
  disabled,
}: {
  role: CrewRole;
  usage: number;
  onRename: (name: string) => void;
  onToggle: () => void;
  disabled: boolean;
}) {
  const [name, setName] = useState(role.name);
  return (
    <div
      style={{
        padding: "12px 14px",
        display: "flex",
        gap: 10,
        alignItems: "center",
        minHeight: 56,
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => onRename(name)}
        style={{ ...inputStyle, flex: 1 }}
      />
      <Chip tone={role.active ? "ok" : "warn"}>
        {role.active ? "ACTIVE" : "ARCHIVED"}
      </Chip>
      <span
        className="mono"
        style={{
          color: "var(--text-3)",
          fontSize: 11,
          minWidth: 60,
          textAlign: "right",
        }}
      >
        {usage} used
      </span>
      <Btn
        size="sm"
        variant={role.active ? "danger" : "default"}
        onClick={onToggle}
        disabled={disabled}
      >
        {role.active ? "Archive" : "Restore"}
      </Btn>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 4,
  border: "1px solid var(--line)",
  background: "var(--bg-2)",
  color: "var(--text)",
  font: "500 14px/1.2 inherit",
  outline: "none",
  minHeight: 40,
};
