import { describe, expect, it } from "vitest";

import { guessEventType } from "./import-xlsx-heuristics";

describe("guessEventType", () => {
  it("classifies known race titles", () => {
    expect(guessEventType("PORSCHE CLUB RACE")).toBe("race");
    expect(guessEventType("Elite Enduro")).toBe("race");
    expect(guessEventType("NASCAR Glen")).toBe("race");
  });

  it("classifies schools and HPDE-style events", () => {
    expect(guessEventType("Pro6 school")).toBe("school");
    expect(guessEventType("HPDE")).toBe("school");
    expect(guessEventType("TEST & TUNE miata")).toBe("school");
  });

  it("classifies club-day style entries", () => {
    expect(guessEventType("DRIVE TEQ")).toBe("track_day");
    expect(guessEventType("BMW")).toBe("track_day");
    expect(guessEventType("6th Gear")).toBe("track_day");
  });

  it("classifies production / camera-car shoots", () => {
    expect(guessEventType("CAMERA CAR")).toBe("production");
    expect(guessEventType("Movie shoot — Quebec")).toBe("production");
  });

  it("falls back to 'other' for unknown labels", () => {
    expect(guessEventType("Untitled")).toBe("other");
    expect(guessEventType("random gibberish")).toBe("other");
  });

  it("returns 'cancelled' when the title flags a cancellation", () => {
    // 'cancel' regex fires after other heuristics, but a bare 'cancelled'
    // string with no race-keyword fallthrough should still land here.
    expect(guessEventType("cancelled")).toBe("cancelled");
  });
});
