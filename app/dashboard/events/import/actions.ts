"use server";

import { promises as fs } from "node:fs";
import path from "node:path";

import { revalidatePath } from "next/cache";

import { requireOwner } from "@/lib/auth/require-owner";
import { writeAudit } from "@/lib/db/audit";
import { createClient } from "@/lib/db/supabase-server";
import type { EventInsert } from "@/lib/db/types";
import { parseEventsXlsx, type ParsedEvent } from "@/lib/events/import-xlsx";
import { guessEventType } from "@/lib/events/import-xlsx-heuristics";

const DEFAULT_TZ = "America/Toronto";
const DEFAULT_START_HHMM = "08:00";
const DEFAULT_END_HHMM = "18:00";
// Toronto observes -04:00 between mid-March and early November (covers the
// May-Oct booking range). We render literal -04:00 offsets here so the inserted
// rows render cleanly in the local-civil format the rest of the app uses.
const SUMMER_OFFSET = "-04:00";

const BUNDLED_FILE_REL = "data/Booking_2026_v05_17.xlsx";

export type ImportEventsSummary = {
  created: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
};

export type ParseBundledFileResult =
  | { ok: true; events: ParsedEvent[] }
  | { ok: false; error: string };

/**
 * Read + parse the xlsx file bundled in the repo. Lets owners hit a single
 * "Import" button without re-uploading the same file.
 */
export async function parseBundledEventsXlsx(): Promise<ParseBundledFileResult> {
  try {
    await requireOwner();
  } catch (err) {
    // requireOwner redirects, but defensive in case it throws.
    return { ok: false, error: explain(err) };
  }

  try {
    const filePath = path.join(process.cwd(), BUNDLED_FILE_REL);
    const buf = await fs.readFile(filePath);
    const events = parseEventsXlsx(buf);
    return { ok: true, events };
  } catch (err) {
    return { ok: false, error: explain(err) };
  }
}

/**
 * Parse an uploaded xlsx file. The wizard converts the File to ArrayBuffer
 * client-side then forwards it here so the server doesn't need a FormData
 * route. SheetJS happily reads either Buffer or ArrayBuffer.
 */
export async function parseUploadedEventsXlsx(
  bytes: ArrayBuffer,
): Promise<ParseBundledFileResult> {
  try {
    await requireOwner();
  } catch (err) {
    return { ok: false, error: explain(err) };
  }
  try {
    const events = parseEventsXlsx(bytes);
    return { ok: true, events };
  } catch (err) {
    return { ok: false, error: explain(err) };
  }
}

/**
 * Insert a batch of parsed events into the `events` table.
 *
 * Idempotency: an event is skipped if there's already a row with the same
 * `title` + `starts_at`. Re-running the import on the same file is safe.
 *
 * Each call writes one audit row summarizing the batch.
 */
export async function importEventsFromParsedRows(
  rows: ParsedEvent[],
): Promise<ImportEventsSummary> {
  const session = await requireOwner();
  const supabase = await createClient();

  const summary: ImportEventsSummary = {
    created: 0,
    skipped: 0,
    errors: [],
  };

  for (const row of rows) {
    const sourceRowLabel = row.sourceRows[0] ?? 0;
    try {
      const insert = buildEventInsert(row, session.profile.id);

      // Idempotency: skip if (title, starts_at) already exists.
      const { data: existing, error: existingErr } = await supabase
        .from("events")
        .select("id")
        .eq("title", insert.title)
        .eq("starts_at", insert.starts_at)
        .maybeSingle();

      if (existingErr) {
        summary.errors.push({
          row: sourceRowLabel,
          message: `Lookup failed: ${existingErr.message}`,
        });
        continue;
      }
      if (existing) {
        summary.skipped++;
        continue;
      }

      const { error: insertErr } = await supabase
        .from("events")
        .insert(insert);
      if (insertErr) {
        summary.errors.push({
          row: sourceRowLabel,
          message: insertErr.message,
        });
        continue;
      }
      summary.created++;
    } catch (err) {
      summary.errors.push({
        row: sourceRowLabel,
        message: explain(err),
      });
    }
  }

  await writeAudit({
    action: "events.import_xlsx",
    entity_type: "event",
    entity_id: session.profile.id, // batch operation — not tied to a single event
    summary: `Imported xlsx events: ${summary.created} created · ${summary.skipped} skipped · ${summary.errors.length} errors`,
    after: {
      created: summary.created,
      skipped: summary.skipped,
      errorCount: summary.errors.length,
      sampleErrors: summary.errors.slice(0, 5),
    },
    actorType: "owner",
    actorId: session.profile.id,
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/events");
  return summary;
}

/** Build the EventInsert row for a single ParsedEvent. */
function buildEventInsert(
  ev: ParsedEvent,
  actorId: string,
): EventInsert & { created_by: string; updated_by: string } {
  const eventType = guessEventType(ev.title);
  const startsAt = `${ev.startDate}T${DEFAULT_START_HHMM}:00${SUMMER_OFFSET}`;
  const endsAt = `${ev.endDate}T${DEFAULT_END_HHMM}:00${SUMMER_OFFSET}`;
  const location = ev.venue;
  const sourceNote = `Imported from xlsx ${ev.sourceMonth} (rows: ${ev.sourceRows.join(", ")})`;
  const needsReviewNote = ev.needsReview
    ? "\nNeeds review: placeholder title from spreadsheet."
    : "";
  const staffNote = ev.sourceStaffNames.length
    ? `\nSpreadsheet staff names: ${ev.sourceStaffNames.join(", ")}`
    : "";

  return {
    title: ev.title || "Untitled",
    description: null,
    event_type: eventType,
    starts_at: startsAt,
    ends_at: endsAt,
    timezone: DEFAULT_TZ,
    location,
    status: "scheduled",
    source_type: "manual",
    required_headcount: ev.requiredHeadcount,
    overbooking_policy: "strict",
    manager_notes: `${sourceNote}${needsReviewNote}${staffNote}`.trim(),
    created_by: actorId,
    updated_by: actorId,
  };
}

function explain(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
