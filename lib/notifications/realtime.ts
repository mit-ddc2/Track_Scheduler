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
  const supabase = createBrowserClient();
  const { onEvent, onStatus } = options;

  onStatus?.("connecting");

  const channel = supabase
    .channel(`manager_notifications:profile=${profileId}`)
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
          onEvent({
            type: "INSERT",
            notification: payload.new as ManagerNotification,
          });
          return;
        }
        if (payload.eventType === "UPDATE") {
          onEvent({
            type: "UPDATE",
            notification: payload.new as ManagerNotification,
          });
          return;
        }
        if (payload.eventType === "DELETE") {
          const id =
            (payload.old as ManagerNotification | undefined)?.id ?? "";
          if (id) onEvent({ type: "DELETE", notification: { id } });
        }
      },
    )
    .subscribe((status: string) => {
      // Supabase realtime status values: SUBSCRIBED | TIMED_OUT | CLOSED | CHANNEL_ERROR
      if (status === "SUBSCRIBED") onStatus?.("subscribed");
      else if (status === "CLOSED") onStatus?.("closed");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
        onStatus?.("error");
    });

  return () => {
    try {
      supabase.removeChannel(channel);
    } catch {
      // Best effort — already torn down.
    }
  };
}
