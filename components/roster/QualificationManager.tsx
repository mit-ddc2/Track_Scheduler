"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Btn } from "@/components/ui/Btn";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import {
  archiveQualification,
  createQualification,
  updateQualification,
} from "@/app/dashboard/roster/actions";
import type { Qualification } from "@/lib/db/types";

type Usage = Record<string, number>;

type QualificationManagerProps = {
  qualifications: Qualification[];
  usage: Usage;
};

export function QualificationManager({
  qualifications,
  usage,
}: QualificationManagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  function add() {
    if (!newName.trim()) return;
    startTransition(async () => {
      const r = await createQualification({ name: newName.trim() });
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setNewName("");
      router.refresh();
    });
  }

  function toggleActive(q: Qualification) {
    const used = (usage[q.id] ?? 0) > 0;
    if (q.active && used) {
      if (
        !window.confirm(
          `“${q.name}” is currently held by ${usage[q.id]} responder(s). Archive anyway? History is preserved.`,
        )
      ) {
        return;
      }
    }
    startTransition(async () => {
      if (q.active) {
        await archiveQualification(q.id);
      } else {
        await updateQualification(q.id, { active: true });
      }
      router.refresh();
    });
  }

  function rename(q: Qualification, name: string) {
    if (!name.trim() || name === q.name) return;
    startTransition(async () => {
      await updateQualification(q.id, { name: name.trim() });
      router.refresh();
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {error && (
        <Card style={{ padding: 12, color: "var(--bad)" }}>{error}</Card>
      )}

      <Card style={{ padding: 14 }}>
        <span className="cs-label">New qualification</span>
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Hazmat"
            style={inputStyle}
          />
          <Btn variant="primary" disabled={isPending} onClick={add}>
            Add
          </Btn>
        </div>
      </Card>

      <Card>
        {qualifications.length === 0 && (
          <div style={{ padding: 16, color: "var(--text-3)" }}>
            No qualifications yet.
          </div>
        )}
        {qualifications.map((q, i) => (
          <div key={q.id}>
            {i > 0 && <div className="cs-divider" />}
            <Row
              q={q}
              usage={usage[q.id] ?? 0}
              onRename={(name) => rename(q, name)}
              onToggle={() => toggleActive(q)}
              disabled={isPending}
            />
          </div>
        ))}
      </Card>
    </div>
  );
}

function Row({
  q,
  usage,
  onRename,
  onToggle,
  disabled,
}: {
  q: Qualification;
  usage: number;
  onRename: (name: string) => void;
  onToggle: () => void;
  disabled: boolean;
}) {
  const [name, setName] = useState(q.name);
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
      <Chip tone={q.active ? "ok" : "warn"}>
        {q.active ? "ACTIVE" : "ARCHIVED"}
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
        {usage} held
      </span>
      <Btn
        size="sm"
        variant={q.active ? "danger" : "default"}
        onClick={onToggle}
        disabled={disabled}
      >
        {q.active ? "Archive" : "Restore"}
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
  minHeight: 40,
};
