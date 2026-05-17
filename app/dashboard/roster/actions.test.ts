import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
}));

const requireOwnerMock = vi.fn();
vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: () => requireOwnerMock(),
}));

const writeAuditMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/db/audit", () => ({
  writeAudit: writeAuditMock,
}));

// Build a chainable supabase fluent stub.
function buildSupabaseStub() {
  const responses: Record<string, unknown> = {
    insert: { data: { id: "new-staff-id" }, error: null },
    update: { data: null, error: null },
    delete: { data: null, error: null },
    select: { data: { id: "new-staff-id" }, error: null },
  };
  const chain = (): Record<string, unknown> => ({
    select: vi.fn(() => chain()),
    insert: vi.fn(() => chain()),
    update: vi.fn(() => chain()),
    delete: vi.fn(() => chain()),
    eq: vi.fn(() => chain()),
    single: vi.fn(async () => responses.insert),
    maybeSingle: vi.fn(async () => responses.insert),
    order: vi.fn(() => chain()),
    then: undefined,
  });
  return {
    from: vi.fn(() => chain()),
  };
}

const supabaseStub = buildSupabaseStub();

vi.mock("@/lib/db/supabase-server", () => ({
  createClient: vi.fn(async () => supabaseStub),
}));

afterEach(() => {
  vi.clearAllMocks();
  requireOwnerMock.mockReset();
});

describe("createStaffMember", () => {
  it("redirects (throws) when the caller is not authenticated", async () => {
    requireOwnerMock.mockImplementation(() => {
      throw new Error("__REDIRECT__:/login");
    });
    const { createStaffMember } = await import("./actions");
    await expect(
      createStaffMember({
        display_name: "Robert",
        role_ids: [],
        qualification_ids: [],
        preferred_contact: "both",
        active: true,
        consent_sms: false,
        consent_email: false,
      } as Parameters<typeof createStaffMember>[0]),
    ).rejects.toThrow("__REDIRECT__:/login");
  });

  it("returns a Zod error when display_name is missing", async () => {
    requireOwnerMock.mockResolvedValue({
      user: { id: "owner-id", email: "owner@x" },
      profile: { id: "owner-id", is_owner: true },
    });
    const { createStaffMember } = await import("./actions");
    const result = await createStaffMember({
      // intentionally missing display_name
      role_ids: [],
      qualification_ids: [],
      preferred_contact: "both",
      active: true,
      consent_sms: false,
      consent_email: false,
    } as unknown as Parameters<typeof createStaffMember>[0]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Zod surfaces either a required-message or an "expected string" message
      // depending on whether the field is missing vs. empty.
      expect(result.fieldErrors?.display_name?.[0]).toBeTruthy();
    }
  });
});

describe("archiveStaffMember", () => {
  it("requires owner before mutating", async () => {
    requireOwnerMock.mockImplementation(() => {
      throw new Error("__REDIRECT__:/login");
    });
    const { archiveStaffMember } = await import("./actions");
    await expect(archiveStaffMember("staff-1")).rejects.toThrow(
      "__REDIRECT__:/login",
    );
  });
});
