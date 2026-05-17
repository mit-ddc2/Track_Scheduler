import Link from "next/link";

import { Chip } from "@/components/ui/Chip";

import { Avatar } from "./Avatar";
import { ChannelBadge } from "./ChannelBadge";
import type { StaffSummary } from "@/lib/roster/queries";

type RosterCardProps = {
  staff: StaffSummary;
  lastWorked?: string | null;
};

/**
 * Mobile card view of a roster row. Tap target is the full card; quick
 * status chips + channel icons live on the right.
 */
export function RosterCard({ staff, lastWorked }: RosterCardProps) {
  return (
    <Link
      href={`/dashboard/roster/${staff.id}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "14px 16px",
        textDecoration: "none",
        color: "inherit",
        minHeight: 64,
      }}
    >
      <Avatar name={staff.display_name} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: 14,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {staff.display_name}
          {!staff.active && (
            <Chip tone="warn" style={{ marginLeft: 8 }}>
              INACTIVE
            </Chip>
          )}
        </div>
        <div
          style={{
            display: "flex",
            gap: 6,
            marginTop: 3,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          {staff.primary_role && (
            <>
              <span
                className="cs-label"
                style={{
                  letterSpacing: "0.04em",
                  textTransform: "none",
                  color: "var(--text-2)",
                }}
              >
                {staff.primary_role}
              </span>
              {staff.qualifications.length > 0 && (
                <span style={{ color: "var(--text-3)" }}>·</span>
              )}
            </>
          )}
          {staff.qualifications.slice(0, 2).map((q) => (
            <Chip key={q}>{q}</Chip>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {lastWorked && (
          <div style={{ textAlign: "right" }}>
            <div
              className="mono tnum"
              style={{ fontSize: 11, color: "var(--text-2)" }}
            >
              {lastWorked}
            </div>
            <div className="cs-label" style={{ color: "var(--text-3)" }}>
              LAST
            </div>
          </div>
        )}
        <div style={{ display: "flex", gap: 4 }}>
          <ChannelBadge
            channel="sms"
            present={staff.sms_present}
            status={staff.sms_status ?? "unknown"}
          />
          <ChannelBadge
            channel="email"
            present={staff.email_present}
            status={staff.email_status ?? "unknown"}
          />
        </div>
      </div>
    </Link>
  );
}
