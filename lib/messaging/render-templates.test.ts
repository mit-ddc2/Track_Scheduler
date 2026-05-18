import { describe, expect, it } from "vitest";

import {
  estimateSmsSegments,
  formatCancellationDays,
  formatDaysShort,
  renderCampaignChangeNoticeEmail,
  renderCampaignChangeNoticeSms,
  renderCancellationEmail,
  renderCancellationSms,
  renderInviteEmail,
  renderInviteSms,
  type TemplateEvent,
  type TemplateRecipient,
} from "./render-templates";

const sampleEvent: TemplateEvent = {
  id: "evt_1",
  title: "AISA Driving School",
  starts_at: "2026-05-23T11:30:00Z", // 7:30 ET
  ends_at: "2026-05-23T21:00:00Z", // 5:00 PM ET
  timezone: "America/Toronto",
  location: "Calabogie Motorsports Park",
};

const sampleRecipient: TemplateRecipient = {
  display_name: "Alex Driver",
  role_label: "Rescue Lead",
};

describe("renderInviteSms", () => {
  it("matches the spec §8.8 example shape", () => {
    const out = renderInviteSms({
      event: sampleEvent,
      recipient: sampleRecipient,
      rsvpUrl: "https://app.example.com/r/abc123",
    });
    expect(out).toContain("Calabogie Safety");
    expect(out).toContain("AISA Driving School");
    expect(out).toContain("RSVP: https://app.example.com/r/abc123");
    expect(out.toUpperCase()).toContain("STOP");
  });

  it("fits in a single SMS segment for a typical event", () => {
    const out = renderInviteSms({
      event: sampleEvent,
      recipient: sampleRecipient,
      rsvpUrl: "https://cs.app/r/abc123def456",
    });
    expect(estimateSmsSegments(out)).toBe(1);
  });
});

describe("renderInviteEmail", () => {
  it("renders subject per §8.8 example", () => {
    const out = renderInviteEmail({
      event: sampleEvent,
      recipient: sampleRecipient,
      rsvpUrl: "https://app.example.com/r/abc123",
    });
    expect(out.subject).toMatch(/^Rescue Team Request: AISA Driving School —/);
  });

  it("includes RSVP link in plain text and html bodies", () => {
    const url = "https://app.example.com/r/zzz";
    const out = renderInviteEmail({
      event: sampleEvent,
      recipient: sampleRecipient,
      rsvpUrl: url,
    });
    expect(out.text).toContain(url);
    expect(out.html).toContain(url);
  });

  it("escapes html-significant chars in user-supplied fields", () => {
    const evil: TemplateEvent = {
      ...sampleEvent,
      title: 'Trackday <script>alert(1)</script>',
    };
    const out = renderInviteEmail({
      event: evil,
      recipient: sampleRecipient,
      rsvpUrl: "https://x.test/r/1",
    });
    expect(out.html).not.toContain("<script>alert(1)</script>");
    expect(out.html).toContain("&lt;script&gt;");
  });

  it("does not leak other responders' names", () => {
    const out = renderInviteEmail({
      event: sampleEvent,
      recipient: sampleRecipient,
      rsvpUrl: "https://x.test/r/1",
    });
    // Pure-render test: no other-staff data ever flows in.
    expect(out.text).not.toContain("Other Staff");
    expect(out.html).not.toContain("Other Staff");
  });
});

describe("v2: per-day rendering", () => {
  it("formatDaysShort returns single label for one day (literal calendar day)", () => {
    expect(formatDaysShort(["2026-05-23"], "America/Toronto")).toBe(
      "Sat May 23",
    );
  });

  it("formatDaysShort joins two days with a comma", () => {
    expect(
      formatDaysShort(["2026-05-23", "2026-05-24"], "America/Toronto"),
    ).toMatch(/,/);
  });

  it("formatDaysShort collapses 3+ consecutive days into a range", () => {
    const out = formatDaysShort(
      ["2026-05-23", "2026-05-24", "2026-05-25"],
      "America/Toronto",
    );
    expect(out).toContain("–");
  });

  it("renderInviteSms with multiple days mentions the day count and list", () => {
    const out = renderInviteSms({
      event: sampleEvent,
      recipient: sampleRecipient,
      rsvpUrl: "https://x.test/r/1",
      days: ["2026-05-23", "2026-05-24"],
    });
    expect(out).toContain("2 days");
    expect(out).toContain("Calabogie Safety");
    expect(out.toUpperCase()).toContain("STOP");
  });

  it("renderInviteSms with a single-day list uses singular phrasing", () => {
    const out = renderInviteSms({
      event: sampleEvent,
      recipient: sampleRecipient,
      rsvpUrl: "https://x.test/r/1",
      days: ["2026-05-23"],
    });
    expect(out).toContain("1 day");
    expect(out).not.toContain("1 days");
  });

  it("renderInviteEmail subject + body call out the requested days", () => {
    const out = renderInviteEmail({
      event: sampleEvent,
      recipient: sampleRecipient,
      rsvpUrl: "https://x.test/r/1",
      days: ["2026-05-23", "2026-05-24"],
    });
    expect(out.subject).toMatch(/2 days/);
    expect(out.text).toContain("Days requested:");
    expect(out.html).toContain("Days requested:");
  });

  it("renderInviteEmail without days behaves like v1", () => {
    const out = renderInviteEmail({
      event: sampleEvent,
      recipient: sampleRecipient,
      rsvpUrl: "https://x.test/r/1",
    });
    expect(out.subject).toMatch(/^Rescue Team Request: AISA Driving School —/);
    expect(out.text).not.toContain("Days requested:");
  });
});

describe("cancellation templates", () => {
  it("formatCancellationDays single-day returns one label", () => {
    expect(formatCancellationDays(["2026-05-23"])).toBe("Sat May 23");
  });

  it("formatCancellationDays multi-day uses ' + ' before the last entry", () => {
    expect(formatCancellationDays(["2026-05-23", "2026-05-24"])).toBe(
      "Sat May 23 + Sun May 24",
    );
    expect(
      formatCancellationDays(["2026-05-23", "2026-05-24", "2026-05-25"]),
    ).toBe("Sat May 23, Sun May 24 + Mon May 25");
  });

  it("renderCancellationSms single-day matches the spec shape", () => {
    const out = renderCancellationSms({
      event: sampleEvent,
      recipient: sampleRecipient,
      dayDates: ["2026-05-23"],
    });
    expect(out).toContain("Calabogie Safety:");
    expect(out).toContain("AISA Driving School");
    expect(out).toContain("on Sat May 23");
    expect(out).toContain("has been CANCELLED");
    expect(out).toContain("No need to come in");
    expect(out).toContain("- Robert");
    expect(out.toUpperCase()).toContain("STOP");
  });

  it("renderCancellationSms multi-day lists the days with ' + ' separator", () => {
    const out = renderCancellationSms({
      event: sampleEvent,
      recipient: sampleRecipient,
      dayDates: ["2026-05-23", "2026-05-24"],
    });
    expect(out).toContain("on Sat May 23 + Sun May 24");
    expect(out).toContain("has been CANCELLED");
    expect(out.toUpperCase()).toContain("STOP");
  });

  it("renderCancellationEmail multi-day subject lists every affected day", () => {
    const out = renderCancellationEmail({
      event: sampleEvent,
      recipient: sampleRecipient,
      dayDates: ["2026-05-23", "2026-05-24"],
    });
    expect(out.subject).toBe(
      "CANCELLED: AISA Driving School — Sat May 23 + Sun May 24",
    );
    expect(out.text).toContain("Sat May 23 + Sun May 24");
    expect(out.html).toContain("Sat May 23 + Sun May 24");
  });

  it("renderCancellationEmail surfaces reason + owner contact phone when provided", () => {
    const out = renderCancellationEmail({
      event: sampleEvent,
      recipient: sampleRecipient,
      dayDates: ["2026-05-23"],
      reason: "Weather — track closed.",
      ownerContactPhone: "+1 613 555 0199",
    });
    expect(out.text).toContain("Reason: Weather — track closed.");
    expect(out.text).toContain("+1 613 555 0199");
    expect(out.html).toContain("Weather");
    expect(out.html).toContain("+1 613 555 0199");
  });

  it("renderCancellationEmail escapes html-significant chars in title + reason", () => {
    const evil: TemplateEvent = {
      ...sampleEvent,
      title: 'Trackday <script>alert(1)</script>',
    };
    const out = renderCancellationEmail({
      event: evil,
      recipient: sampleRecipient,
      dayDates: ["2026-05-23"],
      reason: '<img src=x onerror=alert(1)>',
    });
    expect(out.html).not.toContain("<script>alert(1)</script>");
    expect(out.html).not.toContain("<img src=x onerror=alert(1)>");
    expect(out.html).toContain("&lt;script&gt;");
    expect(out.html).toContain("&lt;img");
  });
});

describe("change notice templates", () => {
  it("SMS variant includes the change summary and RSVP link", () => {
    const out = renderCampaignChangeNoticeSms({
      event: sampleEvent,
      recipient: sampleRecipient,
      rsvpUrl: "https://x.test/r/1",
      changeSummary: "Start moved to 8:00 AM",
    });
    expect(out).toContain("Start moved to 8:00 AM");
    expect(out).toContain("https://x.test/r/1");
    expect(out.toUpperCase()).toContain("STOP");
  });

  it("email variant subject mentions schedule change", () => {
    const out = renderCampaignChangeNoticeEmail({
      event: sampleEvent,
      recipient: sampleRecipient,
      rsvpUrl: "https://x.test/r/1",
      changeSummary: "Start moved to 8:00 AM",
    });
    expect(out.subject).toMatch(/^Schedule change:/);
    expect(out.text).toContain("Start moved to 8:00 AM");
    expect(out.html).toContain("Start moved to 8:00 AM");
  });
});
