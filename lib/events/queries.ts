/**
 * Server-side event queries. Phase 3 returns rows with placeholder
 * confirmed/pending counts (always 0) — Phase 5 wires actual invite +
 * assignment aggregates.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/events/queries.ts is server-only");
}

import { createClient } from "@/lib/db/supabase-server";
import type { EventRow, EventStatus } from "@/lib/db/types";

const STATUSES: ReadonlySet<EventStatus> = new Set([
  "draft",
  "scheduled",
  "inviting",
  "underfilled",
  "staffed",
  "needs_review",
  "locked",
  "completed",
  "cancelled",
]);

export type EventWithCoverage = EventRow & {
  confirmed: number;
  pending: number;
  declined: number;
};

function withZeroCoverage(row: EventRow): EventWithCoverage {
  return { ...row, confirmed: 0, pending: 0, declined: 0 };
}

/**
 * Events starting between `from` and `to` (inclusive), excluding cancelled
 * unless `includeCancelled` is true. Default: upcoming 30 days.
 */
export async function listUpcomingEvents(opts?: {
  fromIso?: string;
  toIso?: string;
  includeCancelled?: boolean;
}): Promise<EventWithCoverage[]> {
  const now = new Date();
  const fromIso = opts?.fromIso ?? now.toISOString();
  const toIso =
    opts?.toIso ?? new Date(now.getTime() + 30 * 24 * 3600 * 1000).toISOString();

  const supabase = await createClient();
  let query = supabase
    .from("events")
    .select("*")
    .gte("starts_at", fromIso)
    .lte("starts_at", toIso)
    .order("starts_at", { ascending: true });
  if (!opts?.includeCancelled) {
    query = query.neq("status", "cancelled");
  }

  const { data, error } = await query;
  if (error) {
    console.warn("[events] listUpcomingEvents failed:", error.message);
    return [];
  }
  return (data ?? []).map((row) => withZeroCoverage(row as EventRow));
}

/**
 * Full events index used by /dashboard/events. Accepts optional status filter
 * and a date range; defaults to events from 90 days ago through 365 days out.
 */
export async function listAllEvents(opts?: {
  status?: string;
  showPast?: boolean;
}): Promise<EventWithCoverage[]> {
  const supabase = await createClient();
  const now = new Date();
  const lower = opts?.showPast
    ? new Date(now.getTime() - 365 * 24 * 3600 * 1000)
    : now;
  const upper = new Date(now.getTime() + 365 * 24 * 3600 * 1000);

  let query = supabase
    .from("events")
    .select("*")
    .gte("starts_at", lower.toISOString())
    .lte("starts_at", upper.toISOString())
    .order("starts_at", { ascending: true });

  if (opts?.status && opts.status !== "all" && STATUSES.has(opts.status as EventStatus)) {
    query = query.eq("status", opts.status as EventStatus);
  }

  const { data, error } = await query;
  if (error) {
    console.warn("[events] listAllEvents failed:", error.message);
    return [];
  }
  return (data ?? []).map((row) => withZeroCoverage(row as EventRow));
}

export async function getEvent(eventId: string): Promise<EventRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("id", eventId)
    .maybeSingle();
  if (error) {
    console.warn("[events] getEvent failed:", error.message);
    return null;
  }
  return (data as EventRow | null) ?? null;
}

export type EventRequirement = {
  id: string;
  label: string;
  required_count: number;
  role_id: string | null;
  qualification_id: string | null;
  notes: string | null;
};

export async function listEventRequirements(
  eventId: string,
): Promise<EventRequirement[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("event_requirements")
    .select("id, label, required_count, role_id, qualification_id, notes")
    .eq("event_id", eventId);
  if (error) {
    console.warn("[events] listEventRequirements failed:", error.message);
    return [];
  }
  return (data as EventRequirement[] | null) ?? [];
}
