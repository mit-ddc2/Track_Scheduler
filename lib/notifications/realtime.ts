"use client";

import { createClient as createBrowserClient } from "@/lib/db/supabase-browser";
import type { ManagerNotification } from "@/lib/db/types";

export type NotificationEvent =
  | { type: "INSERT"; notification: ManagerNotification }
  | { type: "UPDATE"; notification: ManagerNotification }
  | { type: "DELETE"; notification: { id: string } };

export type SubscriptionStatus =
  | "connecting"
  | "subscribed"
  | "closed"
  | "error";

export type SubscribeOptions = {
  onEvent: (event: NotificationEvent) => void;
  onStatus?: (status: SubscriptionStatus) => void;
};

type SharedChannelEntry = {
  /** The underlying Supabase channel (typed loosely; see `.on` cast below). */
  channel: { unsubscribe?: () => void };
  /** Last status from `.subscribe()` so late joiners can be notified. */
  lastStatus: SubscriptionStatus;
  /** All currently-mounted subscribers for this topic. */
  listeners: Set<SubscribeOptions>;
};

// Module-level cache: every browser-side caller asking for the same
// `profileId` topic now joins the same realtime channel and shares its
// websocket broadcast. The first subscriber opens the channel; the last
// subscriber to leave tears it down. This prevents the two-channel
// duplication that `NotificationBadge` + `NotificationsLive` were causing.
const sharedChannels = new Map<string, SharedChannelEntry>();

/**
 * Subscribe to realtime changes on `manager_notifications` for the given
 * owner profile_id. The publication is already RLS-filtered server-side so
 * passing an arbitrary id here would still drop foreign rows, but we filter
 * on the channel as well to minimise broadcast volume.
 *
 * Returns an unsubscribe function. Always call it on component unmount or you
 * will leak websocket channels.
 */
export function subscribeToNotifications(
  profileId: string,
  options: SubscribeOptions,
): () => void {
  const topic = `manager_notifications:profile=${profileId}`;
  const { onStatus } = options;

  let entry = sharedChannels.get(topic);

  if (!entry) {
    entry = createSharedChannel(topic, profileId);
    sharedChannels.set(topic, entry);
  }

  entry.listeners.add(options);

  // Surface the current status immediately so late joiners don't sit in
  // `connecting` forever after the channel has already settled.
  onStatus?.(entry.lastStatus);

  return () => {
    const current = sharedChannels.get(topic);
    if (!current) return;
    current.listeners.delete(options);
    if (current.listeners.size === 0) {
      sharedChannels.delete(topic);
      try {
        current.channel.unsubscribe?.();
      } catch {
        // Best effort — already torn down.
      }
    }
  };
}

function createSharedChannel(
  topic: string,
  profileId: string,
): SharedChannelEntry {
  const supabase = createBrowserClient();

  const entry: SharedChannelEntry = {
    channel: { unsubscribe: undefined },
    lastStatus: "connecting",
    listeners: new Set(),
  };

  const broadcastEvent = (event: NotificationEvent) => {
    // Iterate over a snapshot so listeners removing themselves mid-callback
    // doesn't perturb the iteration order.
    for (const listener of Array.from(entry.listeners)) {
      try {
        listener.onEvent(event);
      } catch {
        // A misbehaving listener shouldn't poison the rest of the fanout.
      }
    }
  };

  const broadcastStatus = (status: SubscriptionStatus) => {
    entry.lastStatus = status;
    for (const listener of Array.from(entry.listeners)) {
      try {
        listener.onStatus?.(status);
      } catch {
        // Same defence as above.
      }
    }
  };

  const channel = supabase
    .channel(topic)
    .on(
      // @ts-expect-error — postgres_changes is typed via realtime-js, the
      // SSR client re-exports a narrower surface but the helper is supported.
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "manager_notifications",
        filter: `profile_id=eq.${profileId}`,
      },
      (payload: {
        eventType: "INSERT" | "UPDATE" | "DELETE";
        new: ManagerNotification | Record<string, never>;
        old: ManagerNotification | Record<string, never>;
      }) => {
        if (payload.eventType === "INSERT") {
          broadcastEvent({
            type: "INSERT",
            notification: payload.new as ManagerNotification,
          });
          return;
        }
        if (payload.eventType === "UPDATE") {
          broadcastEvent({
            type: "UPDATE",
            notification: payload.new as ManagerNotification,
          });
          return;
        }
        if (payload.eventType === "DELETE") {
          const id =
            (payload.old as ManagerNotification | undefined)?.id ?? "";
          if (id) broadcastEvent({ type: "DELETE", notification: { id } });
        }
      },
    )
    .subscribe((status: string) => {
      // Supabase realtime status values: SUBSCRIBED | TIMED_OUT | CLOSED | CHANNEL_ERROR
      if (status === "SUBSCRIBED") broadcastStatus("subscribed");
      else if (status === "CLOSED") broadcastStatus("closed");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
        broadcastStatus("error");
    });

  entry.channel = {
    unsubscribe: () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        // Best effort.
      }
    },
  };

  return entry;
}
