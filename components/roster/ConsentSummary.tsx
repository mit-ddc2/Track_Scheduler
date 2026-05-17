import type { ConsentStatus } from "@/lib/db/types";

type ConsentSummaryProps = {
  status: ConsentStatus;
  source?: string | null;
  capturedAt?: string | null;
};

const STATUS_LABEL: Record<ConsentStatus, string> = {
  granted: "Granted",
  denied: "Denied",
  withdrawn: "Withdrawn",
  unknown: "Unknown",
};

const SOURCE_LABEL: Record<string, string> = {
  verbal: "verbal",
  web_form: "web form",
  import: "import",
  manual: "manual",
};

function fmtDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

/**
 * One-liner consent summary: "Granted · verbal · 2026-01-15". Renders an
 * em-dash when no source/date info is available.
 */
export function ConsentSummary({
  status,
  source,
  capturedAt,
}: ConsentSummaryProps) {
  const bits: string[] = [STATUS_LABEL[status]];
  if (source) {
    bits.push(SOURCE_LABEL[source] ?? source);
  }
  const d = fmtDate(capturedAt);
  if (d) bits.push(d);
  return (
    <span
      className="mono"
      style={{
        fontSize: 11,
        color: "var(--text-3)",
        letterSpacing: "0.02em",
      }}
    >
      {bits.join(" · ")}
    </span>
  );
}
