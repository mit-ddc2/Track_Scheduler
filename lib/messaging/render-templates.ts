/**
 * Pure template renderers for invite/calendar-change messages.
 *
 * Pure functions — no I/O. Keeping them in their own module makes it cheap to
 * preview rendered output in the UI and to unit-test the rules in spec §8.8
 * (single-segment-friendly SMS, plain-text email mirrors HTML, RSVP link
 * present, STOP/HELP language).
 */

import { format, formatInTimeZone } from "date-fns-tz";

export type TemplateEvent = {
  id: string;
  title: string;
  starts_at: string | Date;
  ends_at: string | Date;
  timezone?: string | null;
  location?: string | null;
  event_type?: string | null;
};

export type TemplateRecipient = {
  display_name: string;
  role_label?: string | null;
};

export type RenderInviteInput = {
  event: TemplateEvent;
  recipient: TemplateRecipient;
  rsvpUrl: string;
  /**
   * v2: optional list of YYYY-MM-DD strings for the specific days this
   * recipient is being invited for. When provided the templates list the
   * days explicitly (helpful for multi-day events where the responder may
   * only be wanted for a subset). When omitted the templates fall back to
   * the event's full window — preserving v1 behaviour.
   */
  days?: string[];
};

const DEFAULT_TZ = "America/Toronto";

function tzOf(event: TemplateEvent): string {
  return event.timezone && event.timezone.length > 0 ? event.timezone : DEFAULT_TZ;
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Short, human format used in SMS — "Sat May 23, 7:30am-5pm".
 * Spec §8.8 example.
 */
export function formatEventWhenShort(event: TemplateEvent): string {
  const tz = tzOf(event);
  const start = toDate(event.starts_at);
  const end = toDate(event.ends_at);
  const date = formatInTimeZone(start, tz, "EEE MMM d");
  const startTime = formatInTimeZone(start, tz, "h:mma").toLowerCase();
  const endTime = formatInTimeZone(end, tz, "h:mma").toLowerCase();
  return `${date}, ${startTime}-${endTime}`;
}

/**
 * Longer human format used in email subjects/bodies. Drops the year for
 * brevity (in-season scheduling is week-scale).
 */
export function formatEventWhenLong(event: TemplateEvent): string {
  const tz = tzOf(event);
  const start = toDate(event.starts_at);
  const end = toDate(event.ends_at);
  const date = formatInTimeZone(start, tz, "EEE MMM d");
  const startTime = formatInTimeZone(start, tz, "h:mm a");
  const endTime = formatInTimeZone(end, tz, "h:mm a");
  return `${date} ${startTime}–${endTime}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * Format one YYYY-MM-DD string as "EEE MMM d" without ever crossing a
 * timezone boundary. The `day_date` column is a plain DATE so we want the
 * literal calendar day — converting through `new Date('YYYY-MM-DDTxx:xx')`
 * and then back would shift the day in any TZ with a non-zero UTC offset.
 */
function formatIsoDayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map((v) => Number.parseInt(v, 10));
  if (!y || !m || !d) return iso;
  // Build a Date in UTC so day-of-week math is deterministic regardless of
  // the runtime locale.
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[dt.getUTCDay()]} ${MONTHS[m - 1]} ${d}`;
}

/**
 * Format a list of YYYY-MM-DD day strings as a short, human-friendly run
 * for SMS bodies. Example output:
 *   ["2026-05-23"]                          → "Sat May 23"
 *   ["2026-05-23","2026-05-24"]            → "Sat May 23, Sun May 24"
 *   ["2026-05-23","2026-05-24","2026-05-25"] → "Sat May 23–Mon May 25"
 *
 * Returns empty string when the list is empty.
 */
export function formatDaysShort(
  days: string[] | undefined,
  // _tz is accepted for API symmetry but intentionally unused — `day_date`
  // is a plain DATE so we format the literal calendar day. The eslint
  // underscore prefix convention suppresses the unused-arg warning.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _tz: string = "America/Toronto",
): string {
  if (!days || days.length === 0) return "";
  const sorted = days.slice().sort();
  if (sorted.length === 1) return formatIsoDayLabel(sorted[0]);

  // Detect consecutive runs by comparing UTC midnights.
  const utcMillis = sorted.map((s) => {
    const [y, m, d] = s.split("-").map((v) => Number.parseInt(v, 10));
    return Date.UTC(y, m - 1, d);
  });
  const consecutive = utcMillis.every(
    (t, i) => i === 0 || t - utcMillis[i - 1] === 86_400_000,
  );
  if (consecutive && sorted.length > 2) {
    return `${formatIsoDayLabel(sorted[0])}–${formatIsoDayLabel(sorted[sorted.length - 1])}`;
  }
  return sorted.map(formatIsoDayLabel).join(", ");
}

/** Same as {@link formatDaysShort} but uses the event's timezone. */
export function formatDaysShortForEvent(
  event: TemplateEvent,
  days: string[] | undefined,
): string {
  return formatDaysShort(days, tzOf(event));
}

// ─── Invite SMS ───────────────────────────────────────────────────
/**
 * Multi-line layout for clarity on a phone. Carriers concatenate segments
 * fine; we prioritise readability over a single-segment fit.
 *
 *   Calabogie Safety — Robert here.
 *
 *   Rescue crew request:
 *   {title}
 *   {when, or day list for multi-day}
 *
 *   RSVP here:
 *   {url}
 *
 *   Reply STOP to opt out.
 */
export function renderInviteSms({
  event,
  rsvpUrl,
  days,
}: RenderInviteInput): string {
  // Multi-day (2+) → list days + count. Single-day or no days[] → show the
  // date + time range, which is what the responder actually needs to plan.
  const isMultiDay = !!days && days.length > 1;
  const whenLine = isMultiDay
    ? `${formatDaysShortForEvent(event, days)} (${days!.length} days)`
    : formatEventWhenShort(event);

  return [
    "Calabogie Safety — Robert here.",
    "",
    "Rescue crew request:",
    event.title,
    whenLine,
    "",
    "RSVP here:",
    rsvpUrl,
    "",
    "Reply STOP to opt out.",
  ].join("\n");
}

// ─── Invite email ─────────────────────────────────────────────────
export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderInviteEmail({
  event,
  recipient,
  rsvpUrl,
  days,
}: RenderInviteInput): RenderedEmail {
  const when = formatEventWhenLong(event);
  const hasDays = !!days && days.length > 0;
  const daysList = hasDays ? formatDaysShortForEvent(event, days) : "";
  const dayCount = hasDays ? days!.length : 0;
  const dayCountWord = dayCount === 1 ? "day" : "days";
  const subject = hasDays
    ? `Rescue Team Request: ${event.title} — ${dayCount} ${dayCountWord} (${daysList})`
    : `Rescue Team Request: ${event.title} — ${when}`;
  const greetingName = recipient.display_name;
  const location = event.location ?? "Calabogie Motorsports Park";
  const roleLine = recipient.role_label
    ? `Role: ${recipient.role_label}\n`
    : "";

  const textLines: string[] = [
    `Hi ${greetingName},`,
    "",
    `Robert is putting together the rescue crew for ${event.title}.`,
    `When: ${when} (${tzOf(event)})`,
  ];
  if (hasDays) {
    textLines.push(`Days requested: ${daysList} (${dayCount} ${dayCountWord})`);
  }
  textLines.push(`Where: ${location}`);
  if (roleLine) textLines.push(roleLine.trimEnd());
  textLines.push(
    "",
    `Please RSVP here: ${rsvpUrl}`,
    "",
    "If the link does not work, contact Robert directly.",
    "",
    "— Calabogie Safety",
    "You are receiving this because you are on the Calabogie rescue roster.",
  );
  const text = textLines.join("\n");

  const daysLine = hasDays
    ? `<br><strong>Days requested:</strong> ${htmlEscape(daysList)} (${dayCount} ${dayCountWord})`
    : "";
  const html = `<!doctype html>
<html lang="en"><body style="font-family:system-ui,Arial,sans-serif;line-height:1.5;color:#0d0f1a;">
<p>Hi ${htmlEscape(greetingName)},</p>
<p>Robert is putting together the rescue crew for <strong>${htmlEscape(event.title)}</strong>.</p>
<p>
<strong>When:</strong> ${htmlEscape(when)} (${htmlEscape(tzOf(event))})${daysLine}<br>
<strong>Where:</strong> ${htmlEscape(location)}${
    recipient.role_label
      ? `<br><strong>Role:</strong> ${htmlEscape(recipient.role_label)}`
      : ""
  }
</p>
<p><a href="${htmlEscape(rsvpUrl)}" style="display:inline-block;background:#e63946;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;">Respond to invitation</a></p>
<p style="font-size:12px;color:#555;">Or paste this link in your browser: <br><code>${htmlEscape(rsvpUrl)}</code></p>
<hr style="border:none;border-top:1px solid #ddd;margin:24px 0;">
<p style="font-size:11px;color:#777;">You are receiving this because you are on the Calabogie rescue roster. To stop receiving these emails, contact Robert.</p>
</body></html>`;

  return { subject, html, text };
}

// ─── Calendar-change campaign templates ──────────────────────────
export type ChangeNoticeInput = RenderInviteInput & {
  changeSummary: string; // e.g. "Start time moved to 8:00 AM"
};

export function renderCampaignChangeNoticeSms({
  event,
  rsvpUrl,
  changeSummary,
}: ChangeNoticeInput): string {
  const when = formatEventWhenShort(event);
  return (
    `Calabogie Safety: Update for ${event.title} (${when}).` +
    ` ${changeSummary}. Confirm: ${rsvpUrl} Reply STOP to opt out.`
  );
}

export function renderCampaignChangeNoticeEmail({
  event,
  recipient,
  rsvpUrl,
  changeSummary,
}: ChangeNoticeInput): RenderedEmail {
  const when = formatEventWhenLong(event);
  const subject = `Schedule change: ${event.title} — ${when}`;
  const greetingName = recipient.display_name;
  const location = event.location ?? "Calabogie Motorsports Park";

  const text = [
    `Hi ${greetingName},`,
    "",
    `Heads up — the schedule for ${event.title} has changed:`,
    `  ${changeSummary}`,
    "",
    `Updated when: ${when} (${tzOf(event)})`,
    `Where: ${location}`,
    "",
    `Please re-confirm here: ${rsvpUrl}`,
    "",
    "— Calabogie Safety",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en"><body style="font-family:system-ui,Arial,sans-serif;line-height:1.5;color:#0d0f1a;">
<p>Hi ${htmlEscape(greetingName)},</p>
<p>Heads up — the schedule for <strong>${htmlEscape(event.title)}</strong> has changed:</p>
<p style="background:#fff8e1;padding:8px 12px;border-left:3px solid #f3c623;">${htmlEscape(changeSummary)}</p>
<p><strong>Updated when:</strong> ${htmlEscape(when)} (${htmlEscape(tzOf(event))})<br>
<strong>Where:</strong> ${htmlEscape(location)}</p>
<p><a href="${htmlEscape(rsvpUrl)}" style="display:inline-block;background:#e63946;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;">Re-confirm</a></p>
<hr style="border:none;border-top:1px solid #ddd;margin:24px 0;">
<p style="font-size:11px;color:#777;">— Calabogie Safety</p>
</body></html>`;

  return { subject, html, text };
}

// ─── Cancellation templates (v2 Wave B3) ─────────────────────────
/**
 * Per-spec §8 cancellation fan-out: ONE message per recipient regardless of
 * how many days they were on. Body lists every affected day.
 *
 * Day list formatting differs slightly from the invite/change-notice helpers
 * — the cancellation copy is a definitive statement (no RSVP/action needed),
 * so we use a comma-separated list with " + " before the last entry to read
 * naturally in English ("Sat May 23 + Sun May 24" rather than the en-dash
 * range used for invites).
 */
export type CancellationInput = {
  event: TemplateEvent;
  recipient: TemplateRecipient;
  /** YYYY-MM-DD strings for every day this recipient was on. */
  dayDates: string[];
  /** Optional reason from the cancel form — surfaced in the email body. */
  reason?: string | null;
  /** Optional owner contact phone — defaults to OWNER_CONTACT_PHONE env. */
  ownerContactPhone?: string | null;
};

/**
 * Format the day list in the human-friendly "A, B + C" style. Empty input
 * collapses to an empty string. Single entry returns just that entry.
 */
export function formatCancellationDays(days: string[] | undefined): string {
  if (!days || days.length === 0) return "";
  const sorted = Array.from(new Set(days)).sort();
  const labels = sorted.map(formatIsoDayLabel);
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} + ${labels[1]}`;
  const head = labels.slice(0, -1).join(", ");
  const last = labels[labels.length - 1];
  return `${head} + ${last}`;
}

function resolveOwnerPhone(input: CancellationInput): string | null {
  const explicit = input.ownerContactPhone?.trim();
  if (explicit) return explicit;
  const envValue = process.env.OWNER_CONTACT_PHONE?.trim();
  return envValue && envValue.length > 0 ? envValue : null;
}

export function renderCancellationSms(input: CancellationInput): string {
  const { event, dayDates } = input;
  const when = formatCancellationDays(dayDates);
  const suffix = when ? ` on ${when}` : "";
  return (
    `Calabogie Safety: ${event.title}${suffix} has been CANCELLED.` +
    ` No need to come in. Thanks. - Robert` +
    ` Reply STOP to opt out.`
  );
}

export function renderCancellationEmail(
  input: CancellationInput,
): RenderedEmail {
  const { event, recipient, dayDates, reason } = input;
  const daysList = formatCancellationDays(dayDates);
  const subject = daysList
    ? `CANCELLED: ${event.title} — ${daysList}`
    : `CANCELLED: ${event.title}`;
  const ownerPhone = resolveOwnerPhone(input);
  const greetingName = recipient.display_name;
  const trimmedReason = reason?.trim() ?? "";

  const textLines: string[] = [
    `Hi ${greetingName},`,
    "",
    daysList
      ? `${event.title} on ${daysList} has been cancelled. You do not need to come in.`
      : `${event.title} has been cancelled. You do not need to come in.`,
  ];
  if (trimmedReason.length > 0) {
    textLines.push("", `Reason: ${trimmedReason}`);
  }
  textLines.push(
    "",
    ownerPhone
      ? `Questions? Reach Robert at ${ownerPhone}.`
      : "Questions? Reach out to Robert directly.",
    "",
    "Thanks for being on the crew.",
    "",
    "— Calabogie Safety",
  );
  const text = textLines.join("\n");

  const reasonBlock =
    trimmedReason.length > 0
      ? `<p style="background:#fff8e1;padding:8px 12px;border-left:3px solid #f3c623;"><strong>Reason:</strong> ${htmlEscape(trimmedReason)}</p>`
      : "";
  const contactLine = ownerPhone
    ? `Questions? Reach Robert at <a href="tel:${htmlEscape(ownerPhone.replace(/\s+/g, ""))}">${htmlEscape(ownerPhone)}</a>.`
    : "Questions? Reach out to Robert directly.";

  const html = `<!doctype html>
<html lang="en"><body style="font-family:system-ui,Arial,sans-serif;line-height:1.5;color:#0d0f1a;">
<p>Hi ${htmlEscape(greetingName)},</p>
<p><strong>${htmlEscape(event.title)}</strong>${
    daysList ? ` on <strong>${htmlEscape(daysList)}</strong>` : ""
  } has been <strong>cancelled</strong>. You do not need to come in.</p>
${reasonBlock}
<p>${contactLine}</p>
<p>Thanks for being on the crew.</p>
<hr style="border:none;border-top:1px solid #ddd;margin:24px 0;">
<p style="font-size:11px;color:#777;">— Calabogie Safety</p>
</body></html>`;

  return { subject, html, text };
}

// ─── Helpers exported for tests / outbox ────────────────────────
/**
 * Estimate the GSM-7 segment count for an SMS body. A single GSM-7 segment
 * fits 160 chars; messages with extended chars use 153-char segments.
 * We do not need exact precision — the unit test asserts "fits in one
 * segment" for typical inputs, and the outbox metadata is informational.
 */
export function estimateSmsSegments(body: string): number {
  // 160 char single-segment budget — any longer triggers concatenation on
  // most carriers, which costs more and arrives out-of-order occasionally.
  const len = [...body].length;
  if (len <= 160) return 1;
  return Math.ceil(len / 153);
}

// Re-export under helper name used in spec.
export { format };
