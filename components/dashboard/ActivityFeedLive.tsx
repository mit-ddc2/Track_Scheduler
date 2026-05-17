"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { StatusDot } from "@/components/ui/StatusDot";
import type { ActivityItem } from "@/lib/dashboard/activity-feed";
import {
  subscribeToActivity,
  type ActivityRealtimeEvent,
} from "@/lib/dashboard/activity-realtime";

export type ActivityFeedLiveProps = {
  profileId: string;
  initialItems: ActivityItem[];
  limit?: number;
};

/**
 * Client-side renderer + realtime subscriber for the dashboard activity feed.
 *
 * Strategy: we don't try to materialise full `ActivityItem`s in the browser
 * (joins for staff_member / event title are server-side). Instead, when we
 * see a relevant INSERT we `router.refresh()` so the server re-fetches and
 * passes a fresh `initialItems` prop. This keeps client logic minimal while
 * the manager dashboard still updates within seconds (spec §8.9).
 */
export function ActivityFeedLive({
  profileId,
  initialItems,
  limit = 20,
}: ActivityFeedLiveProps) {
  const router = useRouter();
  const [items] = useState(initialItems);

  useEffect(() => {
    const unsubscribe = subscribeToActivity(profileId, {
      onEvent: (event: ActivityRealtimeEvent) => {
        // Realtime payloads don't carry the joined display_name / event title,
        // and re-querying client-side would duplicate the server merge. The
        // cheapest correct path is to refresh — the server component re-runs
        // `fetchActivityFeed` and the new row appears at the top of the list.
        if (
          event.type === "notification_insert" ||
          event.type === "audit_insert" ||
          event.type === "response_insert"
        ) {
          router.refresh();
        }
      },
    });
    return unsubscribe;
  }, [profileId, router]);

  const visible = items.slice(0, limit);

  if (visible.length === 0) {
    return (
      <div
        style={{
          padding: "20px 14px 18px",
          textAlign: "center",
          color: "var(--text-3)",
        }}
      >
        <span
          className="mono"
          style={{ fontSize: 11, letterSpacing: "0.04em" }}
        >
          No activity in the last 24 hours.
        </span>
      </div>
    );
  }

  return (
    <div role="list" aria-label="Recent activity">
      {visible.map((item, idx) => (
        <div key={item.id} role="listitem">
          {idx > 0 && <hr className="cs-divider" />}
          <ActivityRow item={item} />
        </div>
      ))}
    </div>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const time = formatActivityTimestamp(item.createdAt);
  const body = (
    <div
      style={{
        padding: "12px 14px",
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        minWidth: 0,
      }}
    >
      <div
        className="mono"
        style={{
          width: 44,
          fontSize: 10,
          color: "var(--text-3)",
          letterSpacing: "0.04em",
          paddingTop: 3,
          textTransform: "uppercase",
          flexShrink: 0,
        }}
      >
        {time}
      </div>
      <div style={{ paddingTop: 6, flexShrink: 0 }}>
        <StatusDot tone={item.tone} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, lineHeight: 1.35 }}>
          <b>{item.actorLabel}</b>{" "}
          <span style={{ color: "var(--text-2)" }}>{item.action}</span>
        </div>
        {item.caption && (
          <div
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--text-3)",
              marginTop: 3,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {item.caption}
          </div>
        )}
      </div>
    </div>
  );

  if (!item.href) return body;
  return (
    <Link
      href={item.href}
      style={{
        display: "block",
        color: "inherit",
        textDecoration: "none",
      }}
    >
      {body}
    </Link>
  );
}

function formatActivityTimestamp(iso: string): string {
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
    const oneDay = 24 * 3600 * 1000;
    const diff = today.getTime() - date.getTime();
    if (diff < 2 * oneDay) return "Yest";
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
