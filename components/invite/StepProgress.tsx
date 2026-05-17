/**
 * Three-bar step indicator used at the top of the invite wizard.
 * Mirrors the `ScreenInvite` progress strip from the design ref.
 */

export type StepProgressProps = {
  step: number; // 0-indexed current step
  steps?: number; // defaults to 3
};

export function StepProgress({ step, steps = 3 }: StepProgressProps) {
  return (
    <div
      aria-hidden
      style={{
        display: "flex",
        gap: 2,
        padding: "0 16px",
        marginTop: -1,
      }}
    >
      {Array.from({ length: steps }).map((_, i) => (
        <span
          key={i}
          style={{
            flex: 1,
            height: 2,
            background:
              i <= step ? "var(--accent)" : "var(--line-2, rgba(255,255,255,0.08))",
          }}
        />
      ))}
    </div>
  );
}
