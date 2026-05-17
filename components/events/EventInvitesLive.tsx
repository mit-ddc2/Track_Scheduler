"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { createClient as createBrowserClient } from "@/lib/db/supabase-browser";

export type EventInvitesLiveProps = {
  eventId: string;
};

/**
 * Subscribes to realtime changes on `event_invites` for the given event so
 * the dashboard refreshes within seconds of a responder accepting or
 * declining (spec §8.9 "manager dashboards update within seconds").
 *
 * Renders nothing.
 */
export function EventInvitesLive({ eventId }: EventInvitesLiveProps) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createBrowserClient();
    const channel = supabase
      .channel(`event_invites:${eventId}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table: "event_invites",
          filter: `event_id=eq.${eventId}`,
        },
        () => {
          router.refresh();
        },
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        // best effort.
      }
    };
  }, [eventId, router]);

  return null;
}
