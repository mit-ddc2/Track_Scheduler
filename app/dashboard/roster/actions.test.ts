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

describe("updateStaffMember", () => {
  it("requires owner before mutating", async () => {
    requireOwnerMock.mockImplementation(() => {
      throw new Error("__REDIRECT__:/login");
    });
    const { updateStaffMember } = await import("./actions");
    await expect(
      updateStaffMember("staff-1", {
        display_name: "x",
        role_ids: [],
        qualification_ids: [],
        preferred_contact: "both",
        active: true,
        consent_sms: false,
        consent_email: false,
      } as Parameters<typeof updateStaffMember>[1]),
    ).rejects.toThrow("__REDIRECT__:/login");
  });

  it("returns Zod error when payload primary_role_id is not in role_ids", async () => {
    requireOwnerMock.mockResolvedValue({
      user: { id: "owner-id", email: "owner@x" },
      profile: { id: "owner-id", is_owner: true },
    });
    const { updateStaffMember } = await import("./actions");
    const result = await updateStaffMember("staff-1", {
      display_name: "Jane",
      role_ids: ["11111111-1111-1111-1111-111111111111"],
      // Different uuid — not in role_ids, should fail refine.
      primary_role_id: "22222222-2222-2222-2222-222222222222",
      qualification_ids: [],
      preferred_contact: "both",
      active: true,
      consent_sms: false,
      consent_email: false,
    } as Parameters<typeof updateStaffMember>[1]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors?.primary_role_id?.[0]).toBeTruthy();
    }
  });
});

describe("importRosterCsv", () => {
  it("requires owner before mutating", async () => {
    requireOwnerMock.mockImplementation(() => {
      throw new Error("__REDIRECT__:/login");
    });
    const { importRosterCsv } = await import("./actions");
    await expect(importRosterCsv([])).rejects.toThrow("__REDIRECT__:/login");
  });

  it("rejects payloads larger than the 5000-row cap", async () => {
    requireOwnerMock.mockResolvedValue({
      user: { id: "owner-id", email: "owner@x" },
      profile: { id: "owner-id", is_owner: true },
    });
    const { importRosterCsv } = await import("./actions");
    const { IMPORT_ROW_LIMIT } = await import("@/lib/roster/import-limits");
    expect(IMPORT_ROW_LIMIT).toBe(5000);
    // 5001 minimal stubs.
    const big = Array.from({ length: IMPORT_ROW_LIMIT + 1 }, (_, i) => ({
      rowNumber: i + 2,
      decision: "create" as const,
      matchedStaffMemberId: null,
      displayName: `Row ${i}`,
      firstName: "",
      lastName: "",
      emailNormalized: "",
      phoneE164: "",
      preferredContact: "manual_only" as const,
      primaryRole: "",
      roles: [],
      qualifications: [],
      notes: "",
      active: true,
    }));
    const result = await importRosterCsv(big);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/5000/);
    }
  });
});

describe("importRosterCsv UPDATE behavior", () => {
  it("never deletes existing contact_methods/roles/quals on update (preserves consent)", async () => {
    // Replace `from()` on the shared stub with a tracker that records every
    // table-op pair so we can assert the absence of a destructive call.
    const opLog: Array<{ table: string; op: string }> = [];
    function buildTrackingChain(table: string): Record<string, unknown> {
      const chain: Record<string, unknown> = {};
      const record = (op: string) => {
        opLog.push({ table, op });
        return chain;
      };
      chain.select = vi.fn(() => record("select"));
      chain.insert = vi.fn(() => record("insert"));
      chain.update = vi.fn(() => record("update"));
      chain.upsert = vi.fn(() => record("upsert"));
      chain.delete = vi.fn(() => record("delete"));
      chain.eq = vi.fn(() => chain);
      chain.order = vi.fn(() => chain);
      chain.single = vi.fn(async () => ({ data: { id: "matched-id" }, error: null }));
      chain.maybeSingle = vi.fn(async () => ({ data: { id: "matched-id" }, error: null }));
      chain.then = undefined;
      return chain;
    }
    const originalFrom = supabaseStub.from;
    // Override with a tracker that accepts the table name.
    (supabaseStub as { from: unknown }).from = vi.fn((table: string) =>
      buildTrackingChain(table),
    );

    requireOwnerMock.mockResolvedValue({
      user: { id: "owner-id", email: "owner@x" },
      profile: { id: "owner-id", is_owner: true },
    });

    try {
      const { importRosterCsv } = await import("./actions");
      await importRosterCsv([
        {
          rowNumber: 2,
          decision: "update",
          matchedStaffMemberId: "matched-id",
          displayName: "Existing",
          firstName: "",
          lastName: "",
          emailNormalized: "new@example.com",
          phoneE164: "+16135550199",
          preferredContact: "both",
          primaryRole: "",
          roles: [],
          qualifications: [],
          notes: "",
          active: true,
        },
      ]);

      // Critical assertion: on UPDATE we MUST NOT delete from these tables.
      const contactDeletes = opLog.filter(
        (o) => o.table === "staff_contact_methods" && o.op === "delete",
      );
      const roleDeletes = opLog.filter(
        (o) => o.table === "staff_roles" && o.op === "delete",
      );
      const qualDeletes = opLog.filter(
        (o) => o.table === "staff_qualifications" && o.op === "delete",
      );
      expect(contactDeletes).toHaveLength(0);
      expect(roleDeletes).toHaveLength(0);
      expect(qualDeletes).toHaveLength(0);
      // And we should be using upsert (merge) for contacts.
      const contactUpserts = opLog.filter(
        (o) => o.table === "staff_contact_methods" && o.op === "upsert",
      );
      expect(contactUpserts.length).toBeGreaterThan(0);
    } finally {
      (supabaseStub as { from: unknown }).from = originalFrom;
    }
  });
});

describe("archiveRole / archiveQualification auth guards", () => {
  it("archiveRole requires owner", async () => {
    requireOwnerMock.mockImplementation(() => {
      throw new Error("__REDIRECT__:/login");
    });
    const { archiveRole } = await import("./actions");
    await expect(archiveRole("role-1")).rejects.toThrow("__REDIRECT__:/login");
  });

  it("archiveQualification requires owner", async () => {
    requireOwnerMock.mockImplementation(() => {
      throw new Error("__REDIRECT__:/login");
    });
    const { archiveQualification } = await import("./actions");
    await expect(archiveQualification("qual-1")).rejects.toThrow(
      "__REDIRECT__:/login",
    );
  });
});
