"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Btn } from "@/components/ui/Btn";
import type {
  ManagerNotification,
  NotificationSeverity,
} from "@/lib/db/types";
import {
  subscribeToNotifications,
  type SubscriptionStatus,
} from "@/lib/notifications/realtime";

import { NotificationCard } from "./NotificationCard";

type FilterValue = "all" | "unread" | "urgent" | "warning" | "info";

const FILTERS: Array<{ value: FilterValue; label: string }> = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "urgent", label: "Urgent" },
  { value: "warning", label: "Warning" },
  { value: "info", label: "Info" },
];

export type NotificationsLiveProps = {
  profileId: string;
  initialNotifications: ManagerNotification[];
  onMarkRead: (
    notificationId: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  onMarkAllRead: () => Promise<{ ok: boolean; error?: string }>;
};

export function NotificationsLive({
  profileId,
  initialNotifications,
  onMarkRead,
  onMarkAllRead,
}: NotificationsLiveProps) {
  const router = useRouter();
  const [notifications, setNotifications] = useState(initialNotifications);
  const [filter, setFilter] = useState<FilterValue>("all");
  const [status, setStatus] = useState<SubscriptionStatus>("connecting");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const unsubscribe = subscribeToNotifications(profileId, {
      onStatus: setStatus,
      onEvent: (event) => {
        if (event.type === "INSERT") {
          setNotifications((prev) => {
            if (prev.some((n) => n.id === event.notification.id)) return prev;
            return [event.notification, ...prev].slice(0, 200);
          });
        } else if (event.type === "UPDATE") {
          setNotifications((prev) =>
            prev.map((n) =>
              n.id === event.notification.id ? event.notification : n,
            ),
          );
        } else if (event.type === "DELETE") {
          setNotifications((prev) =>
            prev.filter((n) => n.id !== event.notification.id),
          );
        }
      },
    });
    return unsubscribe;
  }, [profileId]);

  const filtered = useMemo(() => {
    if (filter === "all") return notifications;
    if (filter === "unread") {
      return notifications.filter((n) => n.status === "unread");
    }
    return notifications.filter(
      (n) => n.severity === (filter as NotificationSeverity),
    );
  }, [notifications, filter]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => n.status === "unread").length,
    [notifications],
  );

  const todayCount = useMemo(() => {
    const today = new Date();
    return notifications.filter((n) => {
      const created = new Date(n.created_at);
      return (
        created.getFullYear() === today.getFullYear() &&
        created.getMonth() === today.getMonth() &&
        created.getDate() === today.getDate()
      );
    }).length;
  }, [notifications]);

  const handleActivate = (notification: ManagerNotification) => {
    // Optimistic mark-read.
    if (notification.status === "unread") {
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notification.id
            ? { ...n, status: "read", read_at: new Date().toISOString() }
            : n,
        ),
      );
      void onMarkRead(notification.id);
    }
    const href = buildHref(notification);
    if (href) router.push(href);
  };

  const handleMarkAll = () => {
    startTransition(() => {
      setNotifications((prev) =>
        prev.map((n) =>
          n.status === "unread"
            ? { ...n, status: "read", read_at: new Date().toISOString() }
            : n,
        ),
      );
      void onMarkAllRead();
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div
          className="mono"
          style={{
            color: "var(--text-3)",
            fontSize: 11,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          {unreadCount} unread · today {todayCount}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <LiveIndicator status={status} />
          {unreadCount > 0 && (
            <Btn size="sm" onClick={handleMarkAll} disabled={pending}>
              Mark all read
            </Btn>
          )}
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Filter notifications"
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        {FILTERS.map((f) => {
          const active = filter === f.value;
          return (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setFilter(f.value)}
              className="cs-chip mono"
              style={{
                cursor: "pointer",
                border: "1px solid",
                borderColor: active ? "var(--accent)" : "var(--line)",
                background: active
                  ? "color-mix(in srgb, var(--accent) 12%, transparent)"
                  : "var(--chip-bg)",
                color: active ? "var(--accent)" : "var(--text-2)",
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map((notification) => (
            <NotificationCard
              key={notification.id}
              notification={notification}
              onActivate={handleActivate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LiveIndicator({ status }: { status: SubscriptionStatus }) {
  const tone =
    status === "subscribed"
      ? "var(--ok)"
      : status === "error" || status === "closed"
        ? "var(--bad)"
        : "var(--warn)";
  const label =
    status === "subscribed"
      ? "LIVE"
      : status === "connecting"
        ? "CONNECTING"
        : status === "closed"
          ? "OFFLINE"
          : "ERROR";
  return (
    <span
      className="mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 10,
        letterSpacing: "0.06em",
        color: "var(--text-3)",
        textTransform: "uppercase",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: tone,
          boxShadow: `0 0 0 3px color-mix(in srgb, ${tone} 20%, transparent)`,
        }}
      />
      {label}
    </span>
  );
}

function EmptyState({ filter }: { filter: FilterValue }) {
  const copy =
    filter === "unread"
      ? "No unread notifications."
      : filter === "all"
        ? "No activity yet."
        : `No ${filter} notifications.`;
  return (
    <div
      style={{
        padding: "32px 16px",
        textAlign: "center",
        border: "1px dashed var(--line)",
        borderRadius: 4,
        color: "var(--text-3)",
      }}
    >
      <span className="mono" style={{ fontSize: 11, letterSpacing: "0.04em" }}>
        {copy}
      </span>
    </div>
  );
}

function buildHref(notification: ManagerNotification): string | null {
  if (notification.event_id) return `/dashboard/events/${notification.event_id}`;
  if (notification.staff_member_id)
    return `/dashboard/roster/${notification.staff_member_id}`;
  return null;
}
