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

// ─── Invite SMS ───────────────────────────────────────────────────
/**
 * Spec §8.8 example:
 *   "Calabogie Safety: Rescue crew request for {title}, {date}, {time-range}.
 *    RSVP: {url} Reply STOP to opt out."
 * Constraints: stay single-segment for typical inputs (~160 chars excluding
 * URL — caller is responsible for keeping the URL ≤ ~30 chars).
 */
export function renderInviteSms({
  event,
  rsvpUrl,
}: RenderInviteInput): string {
  const when = formatEventWhenShort(event);
  return (
    `Calabogie Safety: Rescue crew request for ${event.title}, ${when}.` +
    ` RSVP: ${rsvpUrl} Reply STOP to opt out.`
  );
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
}: RenderInviteInput): RenderedEmail {
  const when = formatEventWhenLong(event);
  const subject = `Rescue Team Request: ${event.title} — ${when}`;
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
    `Where: ${location}`,
  ];
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

  const html = `<!doctype html>
<html lang="en"><body style="font-family:system-ui,Arial,sans-serif;line-height:1.5;color:#0d0f1a;">
<p>Hi ${htmlEscape(greetingName)},</p>
<p>Robert is putting together the rescue crew for <strong>${htmlEscape(event.title)}</strong>.</p>
<p>
<strong>When:</strong> ${htmlEscape(when)} (${htmlEscape(tzOf(event))})<br>
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
