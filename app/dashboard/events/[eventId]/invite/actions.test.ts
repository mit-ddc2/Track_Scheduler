import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
}));

vi.mock("@/lib/db/audit", () => ({
  writeAudit: vi.fn(async () => {}),
}));

const requireOwnerMock = vi.fn();
vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: () => requireOwnerMock(),
}));

const createInvitationCampaignMock = vi.fn();
vi.mock("@/lib/messaging/create-campaign", () => ({
  createInvitationCampaign: (...args: unknown[]) =>
    createInvitationCampaignMock(...args),
}));

let mod: typeof import("./actions");

// Zod v4 .uuid() defaults to RFC 4122 which requires variant nibble in
// 8-b; using a v4-shaped UUID below.
const VALID_INPUT = {
  eventId: "11111111-1111-4111-8111-111111111111",
  staffMemberIds: ["22222222-2222-4222-8222-222222222222"],
  channels: ["sms" as const, "email" as const],
};

beforeEach(async () => {
  requireOwnerMock.mockResolvedValue({
    user: { id: "u1" },
    profile: { id: "u1", is_owner: true, display_name: "Owner" },
  });
  createInvitationCampaignMock.mockResolvedValue({
    campaignId: "camp-1",
    invited: 1,
    sms_enqueued: 1,
    email_enqueued: 1,
    skipped_no_contact: 0,
    skipped_opt_out: 0,
    skipped_manual_only: 0,
    deduped: 0,
  });
  mod = await import("./actions");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("sendInvitationCampaign", () => {
  it("requires the owner and surfaces redirect attempts", async () => {
    requireOwnerMock.mockImplementationOnce(async () => {
      throw new Error("__REDIRECT__:/login");
    });
    await expect(mod.sendInvitationCampaign(VALID_INPUT)).rejects.toThrow(
      /__REDIRECT__/,
    );
    expect(createInvitationCampaignMock).not.toHaveBeenCalled();
  });

  it("rejects invalid input (no recipients) without calling the orchestrator", async () => {
    const res = await mod.sendInvitationCampaign({
      ...VALID_INPUT,
      staffMemberIds: [],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/at least one/i);
    expect(createInvitationCampaignMock).not.toHaveBeenCalled();
  });

  it("forwards a valid payload to the orchestrator and returns its counts", async () => {
    const res = await mod.sendInvitationCampaign(VALID_INPUT);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.invited).toBe(1);
      expect(res.sms_enqueued).toBe(1);
      expect(res.email_enqueued).toBe(1);
    }
    expect(createInvitationCampaignMock).toHaveBeenCalledTimes(1);
    expect(createInvitationCampaignMock.mock.calls[0][0]).toMatchObject({
      eventId: VALID_INPUT.eventId,
      staffMemberIds: VALID_INPUT.staffMemberIds,
      channels: VALID_INPUT.channels,
      createdBy: "u1",
    });
  });
});
