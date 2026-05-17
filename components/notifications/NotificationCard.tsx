"use client";

import { useTransition } from "react";

import { Chip } from "@/components/ui/Chip";
import type { ManagerNotification } from "@/lib/db/types";

import { SeverityDot } from "./SeverityDot";

export type NotificationCardProps = {
  notification: ManagerNotification;
  /**
   * Called when the user taps the card. Receives the notification so callers
   * can mark it read AND navigate to the related entity in a single
   * transition. Implementation lives on the page (it has the router + the
   * server action available).
   */
  onActivate?: (notification: ManagerNotification) => void | Promise<void>;
};

function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    const today = new Date();
    const sameDay =
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate();
    if (sameDay) {
      return date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    }
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function NotificationCard({
  notification,
  onActivate,
}: NotificationCardProps) {
  const [pending, startTransition] = useTransition();
  const isUnread = notification.status === "unread";

  const handleClick = () => {
    if (!onActivate) return;
    startTransition(() => {
      void onActivate(notification);
    });
  };

  const relatedLabel = buildRelatedLabel(notification);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      aria-label={`${notification.title}${isUnread ? " (unread)" : ""}`}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "12px 14px",
        background: isUnread
          ? "color-mix(in srgb, var(--accent) 4%, var(--surface))"
          : "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 4,
        color: "var(--text)",
        cursor: onActivate ? "pointer" : "default",
        opacity: pending ? 0.7 : 1,
        transition:
          "border-color 100ms ease, background 100ms ease, opacity 100ms ease",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.borderColor = "var(--line-2)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.borderColor = "var(--line)";
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
        }}
      >
        <div
          className="mono"
          style={{
            width: 48,
            fontSize: 10,
            color: "var(--text-3)",
            letterSpacing: "0.04em",
            paddingTop: 3,
            flexShrink: 0,
          }}
        >
          {formatTimestamp(notification.created_at)}
        </div>
        <div style={{ paddingTop: 5, flexShrink: 0 }}>
          <SeverityDot severity={notification.severity} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 700 }}>
              {notification.title}
            </span>
            {isUnread && <Chip tone="accent">UNREAD</Chip>}
            {notification.status === "archived" && (
              <Chip tone="default">ARCHIVED</Chip>
            )}
          </div>
          {notification.body && (
            <div
              style={{
                marginTop: 4,
                fontSize: 12,
                color: "var(--text-2)",
                lineHeight: 1.4,
              }}
            >
              {notification.body}
            </div>
          )}
          <div
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--text-3)",
              marginTop: 6,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <span>{notification.event_type}</span>
            {relatedLabel && <span>· {relatedLabel}</span>}
          </div>
        </div>
      </div>
    </button>
  );
}

function buildRelatedLabel(notification: ManagerNotification): string | null {
  if (notification.event_id) return "Open event";
  if (notification.staff_member_id) return "Open staff member";
  if (notification.related_entity_type)
    return `Open ${notification.related_entity_type}`;
  return null;
}
