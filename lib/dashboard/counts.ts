/**
 * Dashboard subtitle counts.
 *
 * The header on `/dashboard` shows three numbers:
 *   {eventsUpcoming} events · {eventsUnderfilled} underfilled · {pendingResponders} pending
 *
 * Until this phase those numbers were hardcoded — this module computes them
 * directly from the database so the dashboard reflects real state.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/dashboard/counts.ts is server-only");
}

import { createClient as createServerClient } from "@/lib/db/supabase-server";

export type DashboardCounts = {
  eventsUpcoming: number;
  eventsUnderfilled: number;
  pendingResponders: number;
};

/**
 * Pending invite statuses considered "awaiting a responder action". The list
 * mirrors §8.7 of the spec — these are invites that haven't been resolved
 * (accepted/declined/cancelled/expired) yet.
 */
export const PENDING_INVITE_STATUSES = [
  "created",
  "invited",
  "availability_updated",
] as const;

const HORIZON_DAYS = 30;

export async function getDashboardCounts(): Promise<DashboardCounts> {
  const supabase = await createServerClient();
  const now = new Date();
  const fromIso = now.toISOString();
  const toIso = new Date(
    now.getTime() + HORIZON_DAYS * 24 * 3600 * 1000,
  ).toISOString();

  // Step 1: pull upcoming events (id + status only) so we can both count and
  // pivot pending invites against the same set.
  const { data: events, error: eventsError } = await supabase
    .from("events")
    .select("id, status")
    .gte("starts_at", fromIso)
    .lte("starts_at", toIso)
    .neq("status", "cancelled");

  if (eventsError) {
    console.warn(
      "[dashboard.counts] events query failed:",
      eventsError.message,
    );
    return { eventsUpcoming: 0, eventsUnderfilled: 0, pendingResponders: 0 };
  }

  type EventRow = { id: string; status: string };
  const eventRows: EventRow[] = (events ?? []) as EventRow[];
  const eventsUpcoming = eventRows.length;
  const eventsUnderfilled = eventRows.filter(
    (e) => e.status === "underfilled",
  ).length;

  if (eventRows.length === 0) {
    return { eventsUpcoming, eventsUnderfilled, pendingResponders: 0 };
  }

  const eventIds = eventRows.map((e) => e.id);
  const { count: pendingCount, error: invitesError } = await supabase
    .from("event_invites")
    .select("id", { count: "exact", head: true })
    .in("event_id", eventIds)
    .in(
      "status",
      PENDING_INVITE_STATUSES as unknown as ReadonlyArray<
        "created" | "invited" | "availability_updated"
      >,
    );

  if (invitesError) {
    console.warn(
      "[dashboard.counts] invites query failed:",
      invitesError.message,
    );
    return { eventsUpcoming, eventsUnderfilled, pendingResponders: 0 };
  }

  return {
    eventsUpcoming,
    eventsUnderfilled,
    pendingResponders: pendingCount ?? 0,
  };
}

/**
 * Pure formatter — splits out so the dashboard can render placeholders during
 * SSR errors and so unit tests can exercise pluralisation without touching
 * Supabase.
 */
export function formatDashboardSubtitle(counts: DashboardCounts): string {
  const { eventsUpcoming, eventsUnderfilled, pendingResponders } = counts;
  const eventsWord = eventsUpcoming === 1 ? "event" : "events";
  return `${eventsUpcoming} ${eventsWord} · ${eventsUnderfilled} underfilled · ${pendingResponders} pending`;
}
