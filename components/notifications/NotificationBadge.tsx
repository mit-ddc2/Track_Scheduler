"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { createClient as createBrowserClient } from "@/lib/db/supabase-browser";
import { subscribeToNotifications } from "@/lib/notifications/realtime";

export type NotificationBadgeProps = {
  profileId: string;
  initialCount: number;
};

/**
 * Bell + unread count badge. Seeded with a server-rendered count, then kept
 * fresh via Realtime. The link target is the activity center.
 */
export function NotificationBadge({
  profileId,
  initialCount,
}: NotificationBadgeProps) {
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    let cancelled = false;

    // Recompute the count when realtime events fire — cheaper than tracking
    // per-row diffs and survives missed events on reconnect.
    async function refreshCount() {
      try {
        const supabase = createBrowserClient();
        const { count: nextCount, error } = await supabase
          .from("manager_notifications")
          .select("id", { count: "exact", head: true })
          .eq("profile_id", profileId)
          .eq("status", "unread");
        if (!cancelled && !error && typeof nextCount === "number") {
          setCount(nextCount);
        }
      } catch {
        // Network blip — keep the last good count.
      }
    }

    const unsubscribe = subscribeToNotifications(profileId, {
      onEvent: () => {
        void refreshCount();
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
