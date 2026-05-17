import type { NotificationSeverity } from "@/lib/db/types";

/**
 * Centralised registry of every notification `event_type` the app emits.
 *
 * Phases 3, 5 and 7 call `createManagerNotification({ eventType: "..." })`;
 * by routing every emitter through this map we guarantee:
 *   1. event_type strings stay typo-free
 *   2. default severities are consistent across call sites
 *   3. user-facing copy can be reviewed in one place
 *
 * The `title` template supports `{token}` interpolation — pass values via
 * `formatTitle(eventType, { token: "value" })`. Tokens that are missing fall
 * through to their literal placeholder so we never render `undefined`.
 */
export type NotificationEventType =
  | "calendar.event_created"
  | "calendar.event_updated"
  | "calendar.event_cancelled"
  | "calendar.sync_failed"
  | "responder.accepted"
  | "responder.declined"
  | "responder.cancelled"
  | "responder.availability_updated"
  | "event.underfilled"
  | "event.urgent_underfilled"
  | "message.send_failed"
  | "message.delivery_failed"
  | "message.opt_out";

export type EventTypeDefinition = {
  defaultSeverity: NotificationSeverity;
  title: string;
  body: string;
  /** Human-readable label for preference UI. */
  label: string;
  /** Short description shown under the toggle in the preference UI. */
  description: string;
};

export const EVENT_TYPES: Record<NotificationEventType, EventTypeDefinition> = {
  "calendar.event_created": {
    defaultSeverity: "info",
    title: "New event from calendar",
    body: "{summary}",
    label: "Calendar event created",
    description: "A new event was imported from a connected calendar.",
  },
  "calendar.event_updated": {
    defaultSeverity: "warning",
    title: "Calendar event updated",
    body: "{summary}",
    label: "Calendar event updated",
    description: "An existing calendar event changed time, title, or details.",
  },
  "calendar.event_cancelled": {
    defaultSeverity: "urgent",
    title: "Calendar event cancelled",
    body: "{summary}",
    label: "Calendar event cancelled",
    description: "A scheduled event was cancelled in the source calendar.",
  },
  "calendar.sync_failed": {
    defaultSeverity: "warning",
    title: "Calendar sync failed",
    body: "{reason}",
    label: "Calendar sync failure",
    description: "Sync with a connected calendar could not complete.",
  },
  "responder.accepted": {
    defaultSeverity: "info",
    title: "{name} accepted",
    body: "{eventTitle}",
    label: "Responder accepted",
    description: "Someone confirmed they can work an event.",
  },
  "responder.declined": {
    defaultSeverity: "info",
    title: "{name} declined",
    body: "{eventTitle}",
    label: "Responder declined",
    description: "Someone declined an invitation.",
  },
  "responder.cancelled": {
    defaultSeverity: "urgent",
    title: "{name} cancelled",
    body: "{eventTitle}",
    label: "Responder cancellation",
    description: "Someone withdrew after previously accepting.",
  },
  "responder.availability_updated": {
    defaultSeverity: "info",
    title: "{name} updated availability",
    body: "{note}",
    label: "Availability updated",
    description: "Someone changed their general availability or notes.",
  },
  "event.underfilled": {
    defaultSeverity: "warning",
    title: "Event underfilled",
    body: "{eventTitle} — {shortage}",
    label: "Event underfilled",
    description: "An event no longer has enough confirmed responders.",
  },
  "event.urgent_underfilled": {
    defaultSeverity: "urgent",
    title: "Urgent: event critically underfilled",
    body: "{eventTitle} — {shortage}",
    label: "Event critically underfilled",
    description:
      "An event is missing a required role and starts soon.",
  },
  "message.send_failed": {
    defaultSeverity: "warning",
    title: "Message failed to send",
    body: "{reason}",
    label: "Outbound send failure",
    description: "A message could not be handed to the provider.",
  },
  "message.delivery_failed": {
    defaultSeverity: "warning",
    title: "Message delivery failed",
    body: "{reason}",
    label: "Delivery failure",
    description: "The provider reported a permanent delivery failure.",
  },
  "message.opt_out": {
    defaultSeverity: "info",
    title: "{name} opted out",
    body: "{channel}",
    label: "Opt-out received",
    description: "A responder asked to stop receiving messages.",
  },
};

export const EVENT_TYPE_KEYS = Object.keys(EVENT_TYPES) as NotificationEventType[];

/** Type guard for runtime values coming from the database. */
export function isKnownEventType(
  value: string,
): value is NotificationEventType {
  return Object.prototype.hasOwnProperty.call(EVENT_TYPES, value);
}

/** Look up the definition for any event_type, with safe fallback. */
export function getEventTypeDefinition(
  eventType: string,
): EventTypeDefinition {
  if (isKnownEventType(eventType)) return EVENT_TYPES[eventType];
  return {
    defaultSeverity: "info",
    title: eventType,
    body: "",
    label: eventType,
    description: "",
  };
}

/** Substitute `{tokens}` in a template; preserves unknown tokens literally. */
export function interpolate(
  template: string,
  tokens: Record<string, string | number | undefined | null> = {},
): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = tokens[key];
    if (value === undefined || value === null) return `{${key}}`;
    return String(value);
  });
}

export function formatTitle(
  eventType: string,
  tokens?: Record<string, string | number | undefined | null>,
): string {
  return interpolate(getEventTypeDefinition(eventType).title, tokens);
}

export function formatBody(
  eventType: string,
  tokens?: Record<string, string | number | undefined | null>,
): string {
  return interpolate(getEventTypeDefinition(eventType).body, tokens);
}
