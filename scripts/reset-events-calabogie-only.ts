/**
 * One-shot: wipe all existing events (TEST smoke + seed Multimatic/AISA/Enduro)
 * and re-import ONLY the Calabogie rows from data/Booking_2026_v05_17.xlsx.
 *
 * Filter: row.venue (case-insensitive, trimmed) must contain "calabogie".
 * Excludes CTMP, Shannonville, SH KART, and any other tracks.
 *
 * Run: pnpm exec tsx --env-file=.env.local scripts/reset-events-calabogie-only.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createAdminClient } from "@/lib/db/supabase-admin";
import { parseEventsXlsx } from "@/lib/events/import-xlsx";

const XLSX_PATH = "data/Booking_2026_v05_17.xlsx";
const TIMEZONE = "America/Toronto";

function venueIsCalabogie(venue: string): boolean {
  return venue.trim().toLowerCase().includes("calabogie");
}

// 9:00am-4:00pm ET → 13:00-20:00 UTC (EDT is UTC-4 in racing season).
// Keeps the existing v1 default the importer used. Robert can edit per-event.
function dayWindow(dateStr: string): { startsAt: string; endsAt: string } {
  return {
    startsAt: `${dateStr}T13:00:00.000Z`,
    endsAt: `${dateStr}T20:00:00.000Z`,
  };
}

async function wipeAllEvents(admin: ReturnType<typeof createAdminClient>) {
  // Cascade order: notifications → outbox → invite_response_history → rsvp_tokens
  // → event_assignments → event_invites → invitation_campaigns →
  // event_requirements → attendance_records → events.
  // Most FKs cascade, but we delete explicitly so the audit_log captures it.
  const events = await admin.from("events").select("id");
  if (events.error) throw new Error(`load events: ${events.error.message}`);
  const ids = (events.data ?? []).map((e) => e.id as string);
  if (ids.length === 0) {
    console.log("  (no events to wipe)");
    return 0;
  }

  // Fan-out delete. Each table is filtered by event_id (or by campaign/invite
  // joining to event_id).
  const campaigns = await admin
    .from("invitation_campaigns")
    .select("id")
    .in("event_id", ids);
  const campaignIds = ((campaigns.data ?? []) as Array<{ id: string }>).map((c) => c.id);

  const invites = await admin
    .from("event_invites")
    .select("id")
    .in("event_id", ids);
  const inviteIds = ((invites.data ?? []) as Array<{ id: string }>).map((i) => i.id);

  if (inviteIds.length > 0) {
    await admin.from("rsvp_tokens").delete().in("invite_id", inviteIds);
    await admin.from("invite_response_history").delete().in("invite_id", inviteIds);
  }
  if (campaignIds.length > 0) {
    await admin.from("message_outbox").delete().in("campaign_id", campaignIds);
  }
  await admin.from("manager_notifications").delete().in("event_id", ids);
  await admin.from("event_assignments").delete().in("event_id", ids);
  await admin.from("event_invites").delete().in("event_id", ids);
  await admin.from("invitation_campaigns").delete().in("event_id", ids);
  await admin.from("event_requirements").delete().in("event_id", ids);
  await admin.from("attendance_records").delete().in("event_id", ids);

  const del = await admin.from("events").delete().in("id", ids).select("id");
  if (del.error) throw new Error(`delete events: ${del.error.message}`);
  console.log(`  ✓ wiped ${(del.data ?? []).length} events (+ dependent rows)`);
  return (del.data ?? []).length;
}

async function main() {
  const admin = createAdminClient();

  console.log("▸ Wiping all existing events…");
  await wipeAllEvents(admin);

  console.log(`\n▸ Parsing ${XLSX_PATH}…`);
  const buf = readFileSync(resolve(XLSX_PATH));
  const parsed = parseEventsXlsx(buf, { year: 2026 });
  console.log(`  parsed ${parsed.length} total events`);

  const calabogie = parsed.filter((p) => venueIsCalabogie(p.venue));
  console.log(`\n▸ Filtered to Calabogie only: ${calabogie.length} events`);
  const venueBreakdown = new Map<string, number>();
  for (const p of parsed) venueBreakdown.set(p.venue, (venueBreakdown.get(p.venue) ?? 0) + 1);
  console.log("  venue breakdown across full xlsx:");
  for (const [v, n] of Array.from(venueBreakdown.entries()).sort((a, b) => b[1] - a[1])) {
    const keep = venueIsCalabogie(v) ? "✓" : "✗";
    console.log(`    ${keep} ${v.padEnd(20)} ${n}`);
  }

  console.log(`\n▸ Inserting ${calabogie.length} Calabogie events…`);
  let inserted = 0;
  for (const ev of calabogie) {
    const { startsAt } = dayWindow(ev.startDate);
    const { endsAt } = dayWindow(ev.endDate);

    const res = await admin
      .from("events")
      .insert({
        title: ev.title,
        description: null,
        event_type: ev.needsReview ? "tbd" : "race_event",
        starts_at: startsAt,
        ends_at: endsAt,
        timezone: TIMEZONE,
        location: "Calabogie Motorsports Park",
        status: "draft",
        required_headcount: Math.max(1, ev.requiredHeadcount),
        source_type: "manual",
        manager_notes: ev.sourceStaffNames.length
          ? `Source staff (from xlsx, not auto-assigned): ${ev.sourceStaffNames.join(", ")}`
          : null,
      })
      .select("id, title")
      .single();
    if (res.error) {
      console.warn(`  ⚠ ${ev.title} (${ev.startDate}–${ev.endDate}): ${res.error.message}`);
      continue;
    }
    inserted += 1;
    const span = ev.startDate === ev.endDate
      ? ev.startDate
      : `${ev.startDate}→${ev.endDate}`;
    console.log(`  ✓ ${ev.title.padEnd(38)} ${span}  req=${ev.requiredHeadcount}`);
  }

  console.log(`\n▸ Done. Inserted ${inserted} of ${calabogie.length} Calabogie events.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
