"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { createClient as createBrowserClient } from "@/lib/db/supabase-browser";
import {
  subscribeToNotifications,
  type SubscriptionStatus,
} from "@/lib/notifications/realtime";

export type NotificationBadgeProps = {
  profileId: string;
  initialCount: number;
};

/**
 * Bell + unread count badge. Seeded with a server-rendered count, then kept
 * fresh via Realtime.
 *
 * To minimise DB round-trips we track the count locally from Realtime
 * deltas: INSERTs of unread rows increment, UPDATEs that transition status
 * `unread -> read|archived` decrement (and vice-versa), DELETEs of unread
 * rows decrement. A full re-fetch only happens on connection
 * (re-)establish, which is the only window where we might have missed
 * events. The link target is the activity center.
 */
export function NotificationBadge({
  profileId,
  initialCount,
}: NotificationBadgeProps) {
  const [count, setCount] = useState(initialCount);
  // Track which rows we currently treat as "unread" so UPDATE/DELETE events
  // can adjust the count correctly even when the row's prior status isn't
  // in the realtime payload (RLS strips `old` columns by default).
  const unreadIdsRef = useRef<Set<string>>(new Set());
  // Toggle every time we reconnect so the effect knows when to re-baseline.
  const lastStatusRef = useRef<SubscriptionStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const unreadIds = unreadIdsRef.current;

    async function reseedCount() {
      try {
        const supabase = createBrowserClient();
        const { data, count: nextCount, error } = await supabase
          .from("manager_notifications")
          .select("id", { count: "exact" })
          .eq("profile_id", profileId)
          .eq("status", "unread");
        if (cancelled || error) return;
        unreadIds.clear();
        if (Array.isArray(data)) {
          for (const row of data) {
            if (row && typeof row.id === "string") unreadIds.add(row.id);
          }
        }
        if (typeof nextCount === "number") {
          setCount(nextCount);
        } else {
          setCount(unreadIds.size);
        }
      } catch {
        // Network blip — keep the last good count.
      }
    }

    const unsubscribe = subscribeToNotifications(profileId, {
      onStatus: (status) => {
        const previous = lastStatusRef.current;
        lastStatusRef.current = status;
        // Re-baseline on first establish and on every recovery so any
        // events that fired while the socket was down are reconciled.
        if (
          status === "subscribed" &&
          (previous === null ||
            previous === "closed" ||
            previous === "error" ||
            previous === "connecting")
        ) {
          void reseedCount();
        }
      },
      onEvent: (event) => {
        if (event.type === "INSERT") {
          const { id, status } = event.notification;
          if (status === "unread" && !unreadIds.has(id)) {
            unreadIds.add(id);
            setCount((prev) => prev + 1);
          }
          return;
        }
        if (event.type === "UPDATE") {
          const { id, status } = event.notification;
          const wasUnread = unreadIds.has(id);
          const isUnread = status === "unread";
          if (wasUnread && !isUnread) {
            unreadIds.delete(id);
            setCount((prev) => Math.max(0, prev - 1));
          } else if (!wasUnread && isUnread) {
            unreadIds.add(id);
            setCount((prev) => prev + 1);
          }
          return;
        }
        if (event.type === "DELETE") {
          const { id } = event.notification;
          if (unreadIds.has(id)) {
            unreadIds.delete(id);
            setCount((prev) => Math.max(0, prev - 1));
          }
        }
      },
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [profileId]);

  const display = count > 99 ? "99+" : String(count);
  const hasUnread = count > 0;

  return (
    <Link
      href="/dashboard/notifications"
      aria-label={
        hasUnread
          ? `Notifications, ${display} unread`
          : "Notifications, none unread"
      }
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
        textDecoration: "none",
      }}
    >
      <Bell size={16} strokeWidth={1.6} />
      {hasUnread && (
        <span
          aria-hidden
          className="mono"
          style={{
            position: "absolute",
            top: -4,
            right: -4,
            minWidth: 16,
            height: 16,
            padding: "0 4px",
            borderRadius: 8,
            background: "var(--accent)",
            color: "var(--accent-ink)",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
          }}
        >
          {display}
        </span>
      )}
    </Link>
  );
}
