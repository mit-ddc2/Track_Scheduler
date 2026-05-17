export type MiniStatTone = "ok" | "warn" | "bad" | "info" | "accent" | "idle";

export type MiniStatProps = {
  n: number | string;
  label: string;
  tone?: MiniStatTone;
};

/** Compact labelled-number block. Mirrors `MiniStat` in mobile-screens.jsx. */
export function MiniStat({ n, label, tone = "idle" }: MiniStatProps) {
  const colorVar = tone === "idle" ? "var(--text-3)" : `var(--${tone})`;
  const display = typeof n === "number" ? String(n).padStart(2, "0") : n;
  return (
    <div style={{ textAlign: "left" }}>
      <div className="cs-data-lg" style={{ fontSize: 20, color: colorVar }}>
        {display}
      </div>
      <div className="cs-label" style={{ marginTop: 2, color: "var(--text-3)" }}>
        {label}
      </div>
    </div>
  );
}
