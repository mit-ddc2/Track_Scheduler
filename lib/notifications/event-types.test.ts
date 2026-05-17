import { describe, expect, it } from "vitest";

import {
  EVENT_TYPES,
  EVENT_TYPE_KEYS,
  formatBody,
  formatTitle,
  getEventTypeDefinition,
  interpolate,
  isKnownEventType,
} from "./event-types";

describe("event-types map", () => {
  it("registers every event_type with a severity, title, label", () => {
    expect(EVENT_TYPE_KEYS.length).toBeGreaterThan(0);
    for (const key of EVENT_TYPE_KEYS) {
      const def = EVENT_TYPES[key];
      expect(def, `${key} missing definition`).toBeDefined();
      expect(["info", "warning", "urgent"]).toContain(def.defaultSeverity);
      expect(def.title.length).toBeGreaterThan(0);
      expect(def.label.length).toBeGreaterThan(0);
    }
  });

  it("includes core triggers from the spec", () => {
    const required = [
      "calendar.event_created",
      "calendar.event_updated",
      "calendar.event_cancelled",
      "calendar.sync_failed",
      "responder.accepted",
      "responder.declined",
      "responder.cancelled",
      "responder.availability_updated",
      "event.underfilled",
      "event.urgent_underfilled",
      "message.send_failed",
      "message.delivery_failed",
      "message.opt_out",
    ];
    for (const key of required) {
      expect(EVENT_TYPE_KEYS, `${key} missing`).toContain(key);
    }
  });
});

describe("isKnownEventType", () => {
  it("returns true for registered keys", () => {
    expect(isKnownEventType("responder.accepted")).toBe(true);
  });
  it("returns false for foreign strings", () => {
    expect(isKnownEventType("not.a.real.event")).toBe(false);
  });
});

describe("getEventTypeDefinition", () => {
  it("returns the registered definition when known", () => {
    expect(getEventTypeDefinition("calendar.event_created").defaultSeverity).toBe(
      "info",
    );
  });
  it("falls back to an info-severity stub for unknown strings", () => {
    const def = getEventTypeDefinition("custom.thing");
    expect(def.defaultSeverity).toBe("info");
    expect(def.title).toBe("custom.thing");
  });
});

describe("interpolate", () => {
  it("substitutes simple tokens", () => {
    expect(interpolate("{name} accepted", { name: "Marc" })).toBe(
      "Marc accepted",
    );
  });
  it("leaves missing tokens visible rather than rendering undefined", () => {
    expect(interpolate("{name} accepted", {})).toBe("{name} accepted");
  });
  it("accepts numeric tokens", () => {
    expect(interpolate("{count} pending", { count: 3 })).toBe("3 pending");
  });
});

describe("format helpers", () => {
  it("formatTitle pipes through interpolate", () => {
    expect(
      formatTitle("responder.accepted", { name: "Aïcha" }),
    ).toBe("Aïcha accepted");
  });
  it("formatBody pipes through interpolate", () => {
    expect(
      formatBody("responder.accepted", { eventTitle: "AISA Driving School" }),
    ).toBe("AISA Driving School");
  });
});
