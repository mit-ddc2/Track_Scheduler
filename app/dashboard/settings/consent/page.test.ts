import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
}));

const requireOwnerMock = vi.fn();
vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: requireOwnerMock,
}));

const listConsentRowsMock = vi.fn();
const listConsentHistoryForMock = vi.fn();
vi.mock("@/lib/db/consent-queries", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/db/consent-queries")
  >("@/lib/db/consent-queries");
  return {
    ...actual,
    listConsentRows: listConsentRowsMock,
    listConsentHistoryFor: listConsentHistoryForMock,
  };
});

beforeEach(() => {
  requireOwnerMock.mockReset();
  listConsentRowsMock.mockReset();
  listConsentHistoryForMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("consent settings page", () => {
  it("propagates redirect when caller is not an owner", async () => {
    requireOwnerMock.mockImplementationOnce(async () => {
      throw new Error("__REDIRECT__:/login");
    });
    const { default: ConsentPage } = await import("./page");
    await expect(
      ConsentPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("__REDIRECT__:/login");
  });

  it("renders per-staff tab with consent + status rows", async () => {
    requireOwnerMock.mockResolvedValue({
      user: { id: "u1" },
      profile: { id: "u1", is_owner: true },
    });
    listConsentRowsMock.mockResolvedValueOnce([
      {
        staff_member_id: "s1",
        staff_display_name: "Alice",
        staff_active: true,
        contact_method_id: "cm1",
        channel: "sms",
        value: "+16135551234",
        status: "valid",
        consent: "granted",
        consent_source: "rsvp",
        consented_at: "2026-04-01T00:00:00Z",
        opted_out_at: null,
      },
    ]);
    listConsentHistoryForMock.mockResolvedValueOnce(new Map());
    const { default: ConsentPage } = await import("./page");
    const out = await ConsentPage({ searchParams: Promise.resolve({}) });
    expect(out).toBeTruthy();
    expect(listConsentRowsMock).toHaveBeenCalledTimes(1);
    expect(listConsentHistoryForMock).toHaveBeenCalledWith(["s1"]);
  });

  it("only shows opt-outs in the opt-outs tab", async () => {
    requireOwnerMock.mockResolvedValue({
      user: { id: "u1" },
      profile: { id: "u1", is_owner: true },
    });
    listConsentRowsMock.mockResolvedValueOnce([
      {
        staff_member_id: "s1",
        staff_display_name: "Alice",
        staff_active: true,
        contact_method_id: "cm1",
        channel: "sms",
        value: "+16135551234",
        status: "valid",
        consent: "granted",
        consent_source: null,
        consented_at: null,
        opted_out_at: null,
      },
      {
        staff_member_id: "s2",
        staff_display_name: "Bob",
        staff_active: true,
        contact_method_id: "cm2",
        channel: "email",
        value: "bob@x.com",
        status: "bounced",
        consent: "granted",
        consent_source: null,
        consented_at: null,
        opted_out_at: null,
      },
    ]);
    listConsentHistoryForMock.mockResolvedValueOnce(new Map());
    const { default: ConsentPage } = await import("./page");
    const out = await ConsentPage({
      searchParams: Promise.resolve({ tab: "opt-outs" }),
    });
    expect(out).toBeTruthy();
  });
});
