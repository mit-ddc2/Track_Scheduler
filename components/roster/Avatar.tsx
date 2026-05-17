type AvatarProps = {
  name: string;
  size?: number;
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Hash-tinted monogram block used in roster lists. Matches the prototype
 * Avatar; hue is stable per pair of initials so rendering is deterministic.
 */
export function Avatar({ name, size = 36 }: AvatarProps) {
  const initials = initialsOf(name);
  const hue =
    (initials.charCodeAt(0) * 37 +
      initials.charCodeAt(initials.length - 1) * 53) %
    360;
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: 4,
        flexShrink: 0,
        background: `linear-gradient(135deg, oklch(0.45 0.06 ${hue}), oklch(0.28 0.06 ${hue}))`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--font-jetbrains-mono), ui-monospace, monospace",
        fontWeight: 700,
        fontSize: size * 0.36,
        color: "#fff",
        border: "1px solid var(--line)",
        letterSpacing: "0.02em",
      }}
    >
      {initials}
    </div>
  );
}
