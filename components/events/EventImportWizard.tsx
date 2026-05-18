"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Btn } from "@/components/ui/Btn";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import type { ParsedEvent } from "@/lib/events/import-xlsx";
import {
  importEventsFromParsedRows,
  parseBundledEventsXlsx,
  parseUploadedEventsXlsx,
  type ImportEventsSummary,
} from "@/app/dashboard/events/import/actions";

type Step = "source" | "preview" | "submitting" | "done";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MB safety cap

/**
 * Three-step wizard:
 *   1. SOURCE  — choose bundled file vs upload
 *   2. PREVIEW — checkboxes per parsed event (default: all checked)
 *   3. DONE    — summary + redirect back to /dashboard/events
 */
export function EventImportWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("source");
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<ParsedEvent[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<ImportEventsSummary | null>(null);
  const [isPending, startTransition] = useTransition();

  function loadEvents(parsed: ParsedEvent[]) {
    setEvents(parsed);
    setSelected(new Set(parsed.map(eventKey)));
    setStep("preview");
  }

  function useBundled() {
    setError(null);
    startTransition(async () => {
      const result = await parseBundledEventsXlsx();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (!result.events.length) {
        setError("The bundled file parsed to zero events. Check the file.");
        return;
      }
      loadEvents(result.events);
    });
  }

  async function onUpload(ev: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = ev.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("File too large (max 2 MB).");
      return;
    }
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
      setError("Please select a .xlsx file.");
      return;
    }
    const buf = await file.arrayBuffer();
    startTransition(async () => {
      const result = await parseUploadedEventsXlsx(buf);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (!result.events.length) {
        setError("File parsed to zero events. Are the month tabs present?");
        return;
      }
      loadEvents(result.events);
    });
  }

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function setAllSelected(all: boolean) {
    if (!all) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(events.map(eventKey)));
  }

  function submit() {
    setError(null);
    const chosen = events.filter((e) => selected.has(eventKey(e)));
    if (chosen.length === 0) {
      setError("Pick at least one event to import.");
      return;
    }
    setStep("submitting");
    startTransition(async () => {
      try {
        const result = await importEventsFromParsedRows(chosen);
        setSummary(result);
        setStep("done");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStep("preview");
      }
    });
  }

  if (step === "source") {
    return (
      <Card style={{ padding: 18 }}>
        <h2 className="cs-h3">Step 1 · Choose a source</h2>
        <p style={{ color: "var(--text-2)", marginTop: 8 }}>
          Pick the file that contains your bookings. The fast path uses the
          file already in the repo (
          <code className="mono" style={{ fontSize: 11 }}>
            data/Booking_2026_v05_17.xlsx
          </code>
          ).
        </p>

        <div
          style={{
            marginTop: 16,
            display: "grid",
            gap: 12,
            gridTemplateColumns: "1fr",
          }}
        >
          <Card style={{ padding: 14 }}>
            <h3 className="cs-h4" style={{ margin: 0 }}>
              Bundled file
            </h3>
            <p
              className="mono"
              style={{
                fontSize: 11,
                color: "var(--text-3)",
                marginTop: 4,
                letterSpacing: "0.04em",
              }}
            >
              data/Booking_2026_v05_17.xlsx
            </p>
            <p style={{ color: "var(--text-2)", fontSize: 13, marginTop: 6 }}>
              Robert&apos;s 2026 planning file. Parses May-Oct tabs.
            </p>
            <div style={{ marginTop: 12 }}>
              <Btn
                variant="primary"
                disabled={isPending}
                onClick={useBundled}
              >
                {isPending ? "Loading…" : "Use bundled file"}
              </Btn>
            </div>
          </Card>

          <Card style={{ padding: 14 }}>
            <h3 className="cs-h4" style={{ margin: 0 }}>
              Upload your own
            </h3>
            <p style={{ color: "var(--text-2)", fontSize: 13, marginTop: 6 }}>
              Same column layout: A=day, B=date, C=Venue, D=Event, E+=staff.
              July tab&apos;s offset layout (venue at E, event at F) is handled
              automatically.
            </p>
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={onUpload}
              disabled={isPending}
              style={{
                marginTop: 12,
                display: "block",
                padding: 10,
                background: "var(--bg-2)",
                border: "1px dashed var(--line)",
                borderRadius: 4,
                color: "var(--text)",
                width: "100%",
              }}
            />
          </Card>
        </div>

        {error && (
          <p style={{ color: "var(--bad)", marginTop: 12 }}>{error}</p>
        )}
      </Card>
    );
  }

  if (step === "preview") {
    return (
      <PreviewStep
        events={events}
        selected={selected}
        onToggle={toggle}
        onAll={setAllSelected}
        onBack={() => setStep("source")}
        onSubmit={submit}
        isPending={isPending}
        error={error}
      />
    );
  }

  if (step === "submitting") {
    return (
      <Card style={{ padding: 24, textAlign: "center" }}>
        <p style={{ color: "var(--text-2)" }}>Importing events…</p>
      </Card>
    );
  }

  return (
    <Card style={{ padding: 18 }}>
      <h2 className="cs-h3">Import complete</h2>
      {summary && (
        <ul
          style={{
            marginTop: 10,
            color: "var(--text-2)",
            lineHeight: 1.6,
            listStyle: "none",
            padding: 0,
          }}
        >
          <li>Created: {summary.created}</li>
          <li>Skipped (already exist): {summary.skipped}</li>
          <li>Errors: {summary.errors.length}</li>
        </ul>
      )}
      {summary?.errors && summary.errors.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", color: "var(--bad)" }}>
            Errors ({summary.errors.length})
          </summary>
          <ul
            className="mono"
            style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}
          >
            {summary.errors.map((e, i) => (
              <li key={`${e.row}-${i}`}>
                Row {e.row}: {e.message}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <Btn
          variant="primary"
          onClick={() => router.push("/dashboard/events")}
        >
          Back to events
        </Btn>
        <Btn
          variant="ghost"
          onClick={() => {
            setSummary(null);
            setEvents([]);
            setSelected(new Set());
            setStep("source");
          }}
        >
          Import another
        </Btn>
      </div>
    </Card>
  );
}

function PreviewStep({
  events,
  selected,
  onToggle,
  onAll,
  onBack,
  onSubmit,
  isPending,
  error,
}: {
  events: ParsedEvent[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  onAll: (all: boolean) => void;
  onBack: () => void;
  onSubmit: () => void;
  isPending: boolean;
  error: string | null;
}) {
  const groups = useMemo(() => groupByMonth(events), [events]);
  const totalSelected = selected.size;
  const reviewSelected = events.filter(
    (e) => selected.has(eventKey(e)) && e.needsReview,
  ).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Card
        style={{
          padding: 12,
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <Chip>{events.length} parsed</Chip>
        <Chip tone="info">{totalSelected} selected</Chip>
        {reviewSelected > 0 && (
          <Chip tone="warn">{reviewSelected} need review</Chip>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Btn size="sm" variant="ghost" onClick={() => onAll(true)}>
            Select all
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => onAll(false)}>
            Clear
          </Btn>
        </div>
      </Card>

      {groups.map((g) => (
        <Card key={g.month} style={{ padding: 0, overflow: "hidden" }}>
          <div
            style={{
              padding: "10px 14px",
              background: "var(--bg-2)",
              borderBottom: "1px solid var(--line)",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span className="cs-eyebrow">{g.month}</span>
            <span
              className="mono"
              style={{
                fontSize: 11,
                color: "var(--text-3)",
                letterSpacing: "0.04em",
              }}
            >
              {g.events.length} events
            </span>
          </div>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead>
              <tr style={{ background: "var(--bg-2)" }}>
                <Th style={{ width: 40 }}>
                  <input
                    type="checkbox"
                    aria-label={`Toggle all in ${g.month}`}
                    checked={g.events.every((e) =>
                      selected.has(eventKey(e)),
                    )}
                    onChange={(ev) => {
                      const want = ev.target.checked;
                      for (const e of g.events) {
                        const k = eventKey(e);
                        if (want && !selected.has(k)) onToggle(k);
                        if (!want && selected.has(k)) onToggle(k);
                      }
                    }}
                  />
                </Th>
                <Th>Dates</Th>
                <Th>Venue</Th>
                <Th>Title</Th>
                <Th style={{ textAlign: "right" }}>Headcount</Th>
                <Th>Flags</Th>
              </tr>
            </thead>
            <tbody>
              {g.events.map((e) => {
                const k = eventKey(e);
                const range =
                  e.startDate === e.endDate
                    ? formatDateShort(e.startDate)
                    : `${formatDateShort(e.startDate)} → ${formatDateShort(e.endDate)}`;
                return (
                  <tr
                    key={k}
                    style={{ borderTop: "1px solid var(--line)" }}
                  >
                    <Td>
                      <input
                        type="checkbox"
                        aria-label={`Include ${e.title}`}
                        checked={selected.has(k)}
                        onChange={() => onToggle(k)}
                      />
                    </Td>
                    <Td>
                      <span className="mono" style={{ fontSize: 12 }}>
                        {range}
                      </span>
                    </Td>
                    <Td>{e.venue}</Td>
                    <Td>
                      <span style={{ fontWeight: 600 }}>{e.title}</span>
                      {e.sourceStaffNames.length > 0 && (
                        <div
                          className="mono"
                          style={{
                            fontSize: 10,
                            color: "var(--text-3)",
                            marginTop: 2,
                          }}
                        >
                          {e.sourceStaffNames.slice(0, 4).join(", ")}
                          {e.sourceStaffNames.length > 4 ? "…" : ""}
                        </div>
                      )}
                    </Td>
                    <Td
                      style={{
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                      }}
                      className="mono"
                    >
                      {e.requiredHeadcount}
                    </Td>
                    <Td>
                      {e.needsReview && (
                        <Chip tone="warn">REVIEW</Chip>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      ))}

      {error && (
        <Card style={{ padding: 12, color: "var(--bad)" }}>{error}</Card>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn variant="ghost" onClick={onBack}>
          Back
        </Btn>
        <Btn
          variant="primary"
          onClick={onSubmit}
          disabled={isPending || totalSelected === 0}
        >
          {isPending ? "Importing…" : `Import ${totalSelected}`}
        </Btn>
      </div>
    </div>
  );
}

function Th({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
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
        ...style,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  style,
  className,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <td
      className={className}
      style={{
        padding: "10px",
        color: "var(--text)",
        verticalAlign: "top",
        ...style,
      }}
    >
      {children}
    </td>
  );
}

function eventKey(e: ParsedEvent): string {
  return `${e.sourceMonth}|${e.startDate}|${e.endDate}|${e.venue}|${e.title}`;
}

function groupByMonth(
  events: ParsedEvent[],
): Array<{ month: string; events: ParsedEvent[] }> {
  const byMonth = new Map<string, ParsedEvent[]>();
  for (const e of events) {
    const list = byMonth.get(e.sourceMonth) ?? [];
    list.push(e);
    byMonth.set(e.sourceMonth, list);
  }
  return Array.from(byMonth.entries()).map(([month, evts]) => ({
    month,
    events: evts,
  }));
}

function formatDateShort(iso: string): string {
  // iso = YYYY-MM-DD ; format civil (no TZ shift) as "MMM d".
  const [y, m, d] = iso.split("-").map((s) => Number(s));
  const dt = new Date(Date.UTC(y, m - 1, d));
  const formatter = new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return formatter.format(dt);
}
