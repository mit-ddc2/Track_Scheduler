/**
 * Three-segment coverage bar. Mirrors `CoverageBar` in
 * /tmp/design_extracted/calabogie-track/project/lib.jsx.
 *
 * Green = confirmed, amber = pending, accent = surplus over the requirement.
 * Pure presentation — no data fetching.
 */

export type CoverageBarProps = {
  confirmed: number;
  pending: number;
  needed: number;
  height?: number;
  className?: string;
};

export function CoverageBar({
  confirmed,
  pending,
  needed,
  height = 6,
  className,
}: CoverageBarProps) {
  // When needed=0 we still render a hairline track so empty events look
  // intentional rather than broken.
  const denom = Math.max(needed, 1);
  const c = Math.min(confirmed, needed);
  const p = Math.max(0, Math.min(pending, needed - c));
  const over = Math.max(0, confirmed - needed);
  const cPct = needed === 0 ? 0 : (c / denom) * 100;
  const pPct = needed === 0 ? 0 : (p / denom) * 100;
  const oPct = over > 0 ? Math.min((over / denom) * 100, 30) : 0;

  return (
    <div className={`cs-bar ${className ?? ""}`.trim()} style={{ height }}>
      <span style={{ width: `${cPct}%`, background: "var(--ok)" }} />
      <span style={{ width: `${pPct}%`, background: "var(--warn)" }} />
      {over > 0 && (
        <span style={{ width: `${oPct}%`, background: "var(--accent)" }} />
      )}
    </div>
  );
}
