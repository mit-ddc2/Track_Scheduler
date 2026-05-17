"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Btn } from "@/components/ui/Btn";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import {
  dedupeAgainstExisting,
  parseRosterCsv,
  type ContactSummary,
  type RowDecision,
  type RowWithStatus,
} from "@/lib/roster/import-csv";
import { IMPORT_MAX_BYTES } from "@/lib/roster/import-limits";
import {
  importRosterCsv,
  type ImportRowInput,
  type ImportSummary,
} from "@/app/dashboard/roster/actions";

type ImportWizardProps = {
  existingContacts: ContactSummary[];
};

type Step = "upload" | "review" | "done";

export function ImportWizard({ existingContacts }: ImportWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("upload");
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<RowWithStatus[]>([]);
  const [decisions, setDecisions] = useState<Record<number, RowDecision>>({});
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [isPending, startTransition] = useTransition();

  async function onFile(ev: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = ev.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Please select a .csv file.");
      return;
    }
    // Safari sometimes reports empty file.type for CSVs; allow "" or "text/csv".
    if (file.type && file.type !== "text/csv" && file.type !== "application/vnd.ms-excel") {
      setError("Please select a .csv file.");
      return;
    }
    if (file.size > IMPORT_MAX_BYTES) {
      setError("CSV must be under 1 MB.");
      return;
    }
    try {
      const parsed = await parseRosterCsv(file);
      if (parsed.rows.length === 0) {
        setError("No rows found. Check your headers and try again.");
        return;
      }
      const merged = dedupeAgainstExisting(parsed.rows, existingContacts);
      setRows(merged);
      setDecisions(
        Object.fromEntries(merged.map((r) => [r.rowNumber, r.defaultDecision])),
      );
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function decide(rowNumber: number, decision: RowDecision) {
    setDecisions((d) => ({ ...d, [rowNumber]: decision }));
  }

  function submit() {
    const payload: ImportRowInput[] = rows.map((r) => ({
      rowNumber: r.rowNumber,
      decision: decisions[r.rowNumber] ?? r.defaultDecision,
      matchedStaffMemberId: r.matchedStaffMemberId,
      displayName: r.displayName,
      firstName: r.firstName,
      lastName: r.lastName,
      emailNormalized: r.emailNormalized,
      phoneE164: r.phoneE164,
      preferredContact: r.preferredContact,
      primaryRole: r.primaryRole,
      roles: r.roles,
      qualifications: r.qualifications,
      notes: r.notes,
      active: r.active,
    }));
    startTransition(async () => {
      const result = await importRosterCsv(payload);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSummary(result.data);
      setStep("done");
      router.refresh();
    });
  }

  if (step === "upload") {
    return (
      <Card style={{ padding: 16 }}>
        <h2 className="cs-h3">Step 1 · Upload CSV</h2>
        <p style={{ color: "var(--text-2)", marginTop: 8 }}>
          Expected columns:{" "}
          <code className="mono" style={{ fontSize: 11 }}>
            first_name, last_name, display_name, email, phone, preferred_contact,
            primary_role, roles, qualifications, notes, active
          </code>
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={onFile}
          style={{
            marginTop: 14,
            display: "block",
            padding: 12,
            background: "var(--bg-2)",
            border: "1px dashed var(--line)",
            borderRadius: 4,
            color: "var(--text)",
            width: "100%",
          }}
        />
        {error && (
          <p style={{ color: "var(--bad)", marginTop: 12 }}>{error}</p>
        )}
      </Card>
    );
  }

  if (step === "review") {
    const counts = countStatuses(rows);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Card style={{ padding: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Chip>{rows.length} rows</Chip>
          <Chip tone="info">{counts.new} new</Chip>
          <Chip tone="warn">{counts.duplicate} dup</Chip>
          <Chip tone="warn">{counts.warning} warning</Chip>
          <Chip tone="bad">{counts.invalid} invalid</Chip>
        </Card>

        <Card style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--bg-2)" }}>
                <Th>#</Th>
                <Th>Name</Th>
                <Th>Phone</Th>
                <Th>Email</Th>
                <Th>Status</Th>
                <Th>Decision</Th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((r) => (
                <tr key={r.rowNumber} style={{ borderTop: "1px solid var(--line)" }}>
                  <Td>{r.rowNumber}</Td>
                  <Td>
                    {r.displayName || (
                      <span style={{ color: "var(--bad)" }}>(missing)</span>
                    )}
                  </Td>
                  <Td muted={!r.phoneE164}>{r.phoneE164 || r.phone || "—"}</Td>
                  <Td muted={!r.emailNormalized}>{r.emailNormalized || "—"}</Td>
                  <Td>
                    <Chip
                      tone={
                        r.status === "invalid"
                          ? "bad"
                          : r.status === "duplicate" || r.status === "warning"
                            ? "warn"
                            : "info"
                      }
                    >
                      {r.status.toUpperCase()}
                    </Chip>
                    {r.errors.length > 0 && (
                      <div
                        className="mono"
                        style={{
                          fontSize: 10,
                          color: "var(--bad)",
                          marginTop: 4,
                        }}
                      >
                        {r.errors.join(" · ")}
                      </div>
                    )}
                    {r.warnings.length > 0 && (
                      <div
                        className="mono"
                        style={{
                          fontSize: 10,
                          color: "var(--warn)",
                          marginTop: 4,
                        }}
                      >
                        {r.warnings.join(" · ")}
                      </div>
                    )}
                    {r.matchedDisplayName && (
                      <div
                        className="mono"
                        style={{
                          fontSize: 10,
                          color: "var(--text-3)",
                          marginTop: 4,
                        }}
                      >
                        matches “{r.matchedDisplayName}”
                      </div>
                    )}
                  </Td>
                  <Td>
                    <select
                      value={decisions[r.rowNumber] ?? r.defaultDecision}
                      onChange={(e) =>
                        decide(r.rowNumber, e.target.value as RowDecision)
                      }
                      style={selectStyle}
                    >
                      <option value="create" disabled={r.status === "duplicate"}>
                        Create
                      </option>
                      <option value="update" disabled={r.status !== "duplicate"}>
                        Update
                      </option>
                      <option value="skip">Skip</option>
                    </select>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 200 && (
            <div style={{ padding: 10, color: "var(--text-3)", fontSize: 12 }}>
              Showing first 200 rows.
            </div>
          )}
        </Card>

        {error && (
          <Card style={{ padding: 12, color: "var(--bad)" }}>{error}</Card>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn variant="ghost" onClick={() => setStep("upload")}>
            Back
          </Btn>
          <Btn variant="primary" disabled={isPending} onClick={submit}>
            {isPending ? "Importing…" : "Import"}
          </Btn>
        </div>
      </div>
    );
  }

  // done
  return (
    <Card style={{ padding: 18 }}>
      <h2 className="cs-h3">Import complete</h2>
      {summary && (
        <ul style={{ marginTop: 10, color: "var(--text-2)", lineHeight: 1.6 }}>
          <li>Created: {summary.created}</li>
          <li>Updated: {summary.updated}</li>
          <li>Skipped: {summary.skipped}</li>
          <li>Invalid: {summary.invalid}</li>
        </ul>
      )}
      {summary?.errors && summary.errors.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", color: "var(--bad)" }}>
            Errors ({summary.errors.length})
          </summary>
          <ul
            className="mono"
            style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}
          >
            {summary.errors.map((e) => (
              <li key={e.rowNumber}>
                Row {e.rowNumber}: {e.message}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <Btn variant="primary" onClick={() => router.push("/dashboard/roster")}>
          Back to roster
        </Btn>
        <Btn variant="ghost" onClick={() => setStep("upload")}>
          Import another
        </Btn>
      </div>
    </Card>
  );
}

const selectStyle: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: 4,
  border: "1px solid var(--line)",
  background: "var(--bg-2)",
  color: "var(--text)",
  fontSize: 12,
};

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "10px 10px",
        color: "var(--text-3)",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        fontSize: 10,
        fontWeight: 700,
      }}
    >
      {children}
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
        padding: "10px",
        color: muted ? "var(--text-3)" : "var(--text)",
        verticalAlign: "top",
      }}
    >
      {children}
    </td>
  );
}

function countStatuses(rows: RowWithStatus[]) {
  let n = 0,
    d = 0,
    w = 0,
    i = 0;
  for (const r of rows) {
    if (r.status === "new") n++;
    else if (r.status === "duplicate") d++;
    else if (r.status === "warning") w++;
    else i++;
  }
  return { new: n, duplicate: d, warning: w, invalid: i };
}
