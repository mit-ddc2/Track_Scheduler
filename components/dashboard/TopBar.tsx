import { Bell } from "lucide-react";

type TopBarProps = {
  displayName: string;
};

/** Persistent header bar across all dashboard routes. */
export function TopBar({ displayName }: TopBarProps) {
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 5,
        background: "var(--bg)",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div className="cs-h2" style={{ whiteSpace: "nowrap" }}>
            Calabogie Safety
          </div>
          <div
            className="cs-eyebrow"
            style={{
              marginTop: 4,
              color: "var(--text-3)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            Owner · {displayName}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button
            type="button"
            aria-label="Notifications"
            style={{
              width: 36,
              height: 36,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 4,
              background: "transparent",
              border: "1px solid var(--line)",
              color: "var(--text)",
              cursor: "pointer",
              position: "relative",
            }}
          >
            <Bell size={16} strokeWidth={1.6} />
          </button>
        </div>
      </div>
    </header>
  );
}
