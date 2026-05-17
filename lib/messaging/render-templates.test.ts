import { describe, expect, it } from "vitest";

import {
  estimateSmsSegments,
  renderCampaignChangeNoticeEmail,
  renderCampaignChangeNoticeSms,
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
