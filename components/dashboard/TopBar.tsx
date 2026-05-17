import { NotificationBadge } from "@/components/notifications/NotificationBadge";

type TopBarProps = {
  displayName: string;
  profileId: string;
  unreadCount: number;
};

/** Persistent header bar across all dashboard routes. */
export function TopBar({ displayName, profileId, unreadCount }: TopBarProps) {
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
          <NotificationBadge
            profileId={profileId}
            initialCount={unreadCount}
          />
        </div>
      </div>
    </header>
  );
}
