import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireOwnerMock = vi.fn();
const updateMock = vi.fn();
const eqUpdateMock = vi.fn();
const eqUpdateStatusMock = vi.fn();
const upsertPreferenceMock = vi.fn();
const writeAuditMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: () => requireOwnerMock(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createClient: vi.fn(async () => ({
    from: () => ({
      update: updateMock,
    }),
  })),
}));

vi.mock("@/lib/db/audit", () => ({
  writeAudit: (...args: unknown[]) => writeAuditMock(...args),
}));

vi.mock("@/lib/notifications/preferences", () => ({
  upsertNotificationPreference: (...args: unknown[]) =>
    upsertPreferenceMock(...args),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

beforeEach(() => {
  requireOwnerMock.mockReset();
  updateMock.mockReset();
  eqUpdateMock.mockReset();
  eqUpdateStatusMock.mockReset();
  upsertPreferenceMock.mockReset();
  writeAuditMock.mockReset();
  revalidatePathMock.mockReset();

  // Default: an active owner.
  requireOwnerMock.mockResolvedValue({
    user: { id: "u1" },
    profile: {
      id: "11111111-1111-4111-8111-111111111111",
      is_owner: true,
      is_active: true,
      display_name: "Robert",
      email: "robert@example.com",
      phone_for_alerts: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  });

  // Default chainable update mock for status writes.
  updateMock.mockImplementation(() => ({
    eq: () => ({
      eq: () => Promise.resolve({ error: null }),
    }),
  }));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("markNotificationRead", () => {
  it("rejects non-uuid ids without touching the database", async () => {
    const { markNotificationRead } = await import("./actions");
    const result = await markNotificationRead("not-a-uuid");
    expect(result).toEqual({ ok: false, error: "Invalid notification id." });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("requires an owner session", async () => {
    requireOwnerMock.mockImplementationOnce(() => {
      throw new Error("__REDIRECT__:/login");
    });
    const { markNotificationRead } = await import("./actions");
    await expect(
      markNotificationRead("11111111-1111-4111-8111-111111111111"),
    ).rejects.toThrowError("__REDIRECT__:/login");
  });

  it("writes the update when input is valid", async () => {
    const { markNotificationRead } = await import("./actions");
    const result = await markNotificationRead(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "read" }),
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/notifications");
  });
});

describe("archiveNotification", () => {
  it("rejects non-uuid ids", async () => {
    const { archiveNotification } = await import("./actions");
    const result = await archiveNotification("oops");
    expect(result).toEqual({ ok: false, error: "Invalid notification id." });
  });

  it("requires an owner", async () => {
    requireOwnerMock.mockImplementationOnce(() => {
      throw new Error("__REDIRECT__:/login");
    });
    const { archiveNotification } = await import("./actions");
    await expect(
      archiveNotification("11111111-1111-4111-8111-111111111111"),
    ).rejects.toThrowError("__REDIRECT__:/login");
  });
});

describe("markAllRead", () => {
  it("requires an owner", async () => {
    requireOwnerMock.mockImplementationOnce(() => {
      throw new Error("__REDIRECT__:/login");
    });
    const { markAllRead } = await import("./actions");
    await expect(markAllRead()).rejects.toThrowError("__REDIRECT__:/login");
  });
});

describe("updateNotificationPreferences", () => {
  it("rejects schema-invalid input", async () => {
    const { updateNotificationPreferences } = await import("./actions");
    const result = await updateNotificationPreferences({
      eventType: "",
    });
    expect(result.ok).toBe(false);
    expect(upsertPreferenceMock).not.toHaveBeenCalled();
  });

  it("passes validated input to the upsert helper and writes an audit row", async () => {
    upsertPreferenceMock.mockResolvedValue({
      id: "pref-1",
      profile_id: "11111111-1111-4111-8111-111111111111",
      event_type: "responder.cancelled",
      in_app_enabled: true,
      email_enabled: true,
      sms_enabled: true,
      minimum_sms_severity: "urgent",
      minimum_email_severity: "warning",
      quiet_hours_start: null,
      quiet_hours_end: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-05-17T00:00:00Z",
    });

    const { updateNotificationPreferences } = await import("./actions");
    const result = await updateNotificationPreferences({
      eventType: "responder.cancelled",
      in_app_enabled: true,
      email_enabled: true,
      sms_enabled: true,
    });

    expect(result).toEqual({ ok: true });
    expect(upsertPreferenceMock).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      "responder.cancelled",
      expect.objectContaining({ email_enabled: true }),
    );
    expect(writeAuditMock).toHaveBeenCalled();
  });
});
