"use client";

/**
 * Browser-side realtime subscription for the dashboard activity feed.
 *
 * Mirrors `lib/notifications/realtime.ts`: a single shared channel per topic
 * (`activity_feed:profile=<id>`) is opened on first mount and torn down when
 * the last subscriber unmounts. This prevents duplicate channels if the
 * activity feed renders in two slots (desktop sidebar + mobile section).
 *
 * Listens for INSERTs on `manager_notifications` (filtered to the current
 * owner) AND `audit_log` (unfiltered — RLS will still drop foreign rows in
 * realtime payloads). Each insert is fanned out to every subscriber.
 */

import { createClient as createBrowserClient } from "@/lib/db/supabase-browser";

export type ActivityRealtimeEvent =
  | { type: "notification_insert"; row: Record<string, unknown> }
  | { type: "audit_insert"; row: Record<string, unknown> }
  | { type: "response_insert"; row: Record<string, unknown> };

export type ActivitySubscribeOptions = {
  onEvent: (event: ActivityRealtimeEvent) => void;
};

type SharedChannelEntry = {
  channel: { unsubscribe?: () => void };
  listeners: Set<ActivitySubscribeOptions>;
};

const sharedChannels = new Map<string, SharedChannelEntry>();

export function subscribeToActivity(
  profileId: string,
  options: ActivitySubscribeOptions,
): () => void {
  const topic = `activity_feed:profile=${profileId}`;
  let entry = sharedChannels.get(topic);
  if (!entry) {
    entry = createSharedChannel(topic, profileId);
    sharedChannels.set(topic, entry);
  }
  entry.listeners.add(options);

  return () => {
    const current = sharedChannels.get(topic);
    if (!current) return;
    current.listeners.delete(options);
    if (current.listeners.size === 0) {
      sharedChannels.delete(topic);
      try {
        current.channel.unsubscribe?.();
      } catch {
        // best effort.
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
    listeners: new Set(),
  };

  const broadcast = (event: ActivityRealtimeEvent) => {
    for (const listener of Array.from(entry.listeners)) {
      try {
        listener.onEvent(event);
      } catch {
        // a misbehaving listener shouldn't poison the rest.
      }
    }
  };

  const channel = supabase
    .channel(topic)
    .on(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      "postgres_changes" as any,
      {
        event: "INSERT",
        schema: "public",
        table: "manager_notifications",
        filter: `profile_id=eq.${profileId}`,
      },
      (payload: { new: Record<string, unknown> }) => {
        broadcast({ type: "notification_insert", row: payload.new });
      },
    )
    .on(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      "postgres_changes" as any,
      {
        event: "INSERT",
        schema: "public",
        table: "audit_log",
      },
      (payload: { new: Record<string, unknown> }) => {
        broadcast({ type: "audit_insert", row: payload.new });
      },
    )
    .on(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      "postgres_changes" as any,
      {
        event: "INSERT",
        schema: "public",
        table: "invite_response_history",
      },
      (payload: { new: Record<string, unknown> }) => {
        broadcast({ type: "response_insert", row: payload.new });
      },
    )
    .subscribe();

  entry.channel = {
    unsubscribe: () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        // best effort.
      }
    },
  };

  return entry;
}
