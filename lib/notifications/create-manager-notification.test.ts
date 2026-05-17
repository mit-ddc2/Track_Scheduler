import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We isolate every test by re-importing the module after wiring fresh mocks.
// The admin client is invoked via createAdminClient; we mock that and the
// fallback server client.

const adminFromMock = vi.fn();
const serverFromMock = vi.fn();
const createAdminClientImpl = vi.fn();

vi.mock("@/lib/db/supabase-admin", () => ({
  createAdminClient: () => createAdminClientImpl(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createClient: vi.fn(async () => ({ from: serverFromMock })),
}));

beforeEach(() => {
  vi.resetModules();
  adminFromMock.mockReset();
  serverFromMock.mockReset();
  createAdminClientImpl.mockReset();
  createAdminClientImpl.mockReturnValue({ from: adminFromMock });
});

afterEach(() => {
  vi.clearAllMocks();
});

type InsertResult = {
  data: Record<string, unknown> | null;
  error: { code?: string; message: string } | null;
};

type OwnerLookupResult = {
  data: { id: string } | null;
  error: { message: string } | null;
};

function wireAdmin({
  insertResult,
  upsertResult,
  upsertSpy,
  ownerLookupResult,
}: {
  insertResult?: InsertResult;
  upsertResult?: InsertResult;
  upsertSpy?: (
    row: Record<string, unknown>,
    options: { onConflict: string; ignoreDuplicates?: boolean },
  ) => void;
  ownerLookupResult?: OwnerLookupResult;
}) {
  adminFromMock.mockImplementation((table: string) => {
    if (table === "manager_notifications") {
      return {
        insert: () => ({
          select: () => ({
            maybeSingle: vi
              .fn()
              .mockResolvedValue(
                insertResult ?? { data: null, error: null },
              ),
          }),
        }),
        upsert: (
          row: Record<string, unknown>,
          options: { onConflict: string; ignoreDuplicates?: boolean },
        ) => {
          upsertSpy?.(row, options);
          return {
            select: () => ({
              maybeSingle: vi
                .fn()
                .mockResolvedValue(
                  upsertResult ?? { data: null, error: null },
                ),
            }),
          };
        },
      };
    }
    if (table === "profiles") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              limit: () => ({
                maybeSingle: vi
                  .fn()
                  .mockResolvedValue(
                    ownerLookupResult ?? {
                      data: { id: "owner-uuid" },
                      error: null,
                    },
                  ),
              }),
            }),
          }),
        }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
}

describe("createManagerNotification", () => {
  it("inserts a notification row with provided profileId", async () => {
    wireAdmin({
      insertResult: {
        data: {
          id: "notif-1",
          profile_id: "p1",
          severity: "info",
          status: "unread",
          event_type: "responder.accepted",
          title: "Marc accepted",
          body: null,
          event_id: null,
          staff_member_id: null,
          related_entity_type: null,
          related_entity_id: null,
          dedupe_key: null,
          created_at: "2026-05-17T00:00:00Z",
          read_at: null,
        },
        error: null,
      },
    });

    const { createManagerNotification } = await import(
      "./create-manager-notification"
    );
    const result = await createManagerNotification({
      profileId: "p1",
      eventType: "responder.accepted",
      title: "Marc accepted",
    });

    expect(result.created).toBe(true);
    expect(result.notification?.id).toBe("notif-1");
    expect(adminFromMock).toHaveBeenCalledWith("manager_notifications");
  });

  it("returns created=false when the unique dedupe constraint fires", async () => {
    const upsertSpy = vi.fn();
    wireAdmin({
      // PostgREST returns `data: null` with no error when
      // `ignoreDuplicates: true` swallows an ON CONFLICT DO NOTHING row.
      upsertResult: { data: null, error: null },
      upsertSpy,
    });

    const { createManagerNotification } = await import(
      "./create-manager-notification"
    );
    const result = await createManagerNotification({
      profileId: "p1",
      eventType: "responder.accepted",
      title: "Marc accepted",
      dedupeKey: "responder:accept:abc",
    });

    expect(result.created).toBe(false);
    expect(result.notification).toBeNull();
    // The dedupe path must hit upsert with the narrow conflict target so
    // *only* duplicates on (profile_id, dedupe_key) are swallowed.
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        profile_id: "p1",
        dedupe_key: "responder:accept:abc",
      }),
      { onConflict: "profile_id,dedupe_key", ignoreDuplicates: true },
    );
  });

  it("surfaces unique-violation errors from constraints other than the dedupe target", async () => {
    // Simulate a hypothetical future unique constraint firing on something
    // OTHER than (profile_id, dedupe_key). Because `onConflict` is pinned to
    // the dedupe target, PostgREST will not swallow this — the error must
    // bubble out instead of being masked as `created: false`.
    wireAdmin({
      upsertResult: {
        data: null,
        error: {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "manager_notifications_some_other_unique_idx"',
        },
      },
    });

    const { createManagerNotification } = await import(
      "./create-manager-notification"
    );

    await expect(
      createManagerNotification({
        profileId: "p1",
        eventType: "responder.accepted",
        title: "Marc accepted",
        dedupeKey: "responder:accept:abc",
      }),
    ).rejects.toThrow(/insert failed/);
  });

  it("throws when eventType is missing", async () => {
    wireAdmin({
      insertResult: { data: null, error: null },
    });

    const { createManagerNotification } = await import(
      "./create-manager-notification"
    );

    await expect(
      createManagerNotification({
        eventType: "",
        profileId: "p1",
      }),
    ).rejects.toThrow(/eventType is required/);
  });

  it("resolves the owner profile when profileId is omitted", async () => {
    wireAdmin({
      insertResult: {
        data: {
          id: "notif-2",
          profile_id: "owner-uuid",
          severity: "warning",
          status: "unread",
          event_type: "event.underfilled",
          title: "Event underfilled",
          body: null,
          event_id: null,
          staff_member_id: null,
          related_entity_type: null,
          related_entity_id: null,
          dedupe_key: null,
          created_at: "2026-05-17T00:00:00Z",
          read_at: null,
        },
        error: null,
      },
      ownerLookupResult: { data: { id: "owner-uuid" }, error: null },
    });

    const { createManagerNotification } = await import(
      "./create-manager-notification"
    );

    const result = await createManagerNotification({
      eventType: "event.underfilled",
      severity: "warning",
      title: "Event underfilled",
    });

    expect(result.created).toBe(true);
    expect(result.notification?.profile_id).toBe("owner-uuid");
    expect(adminFromMock).toHaveBeenCalledWith("profiles");
  });

  it("falls back to the request-scoped server client when SUPABASE_SECRET_KEY is missing", async () => {
    createAdminClientImpl.mockImplementation(() => {
      throw new Error("Missing SUPABASE_SECRET_KEY env var");
    });

    serverFromMock.mockImplementation((table: string) => {
      if (table === "manager_notifications") {
        return {
          insert: () => ({
            select: () => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: "notif-3",
                  profile_id: "p1",
                  severity: "info",
                  status: "unread",
                  event_type: "responder.accepted",
                  title: "Fallback insert",
                  body: null,
                  event_id: null,
                  staff_member_id: null,
                  related_entity_type: null,
                  related_entity_id: null,
                  dedupe_key: null,
                  created_at: "2026-05-17T00:00:00Z",
                  read_at: null,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const { createManagerNotification } = await import(
      "./create-manager-notification"
    );

    const result = await createManagerNotification({
      profileId: "p1",
      eventType: "responder.accepted",
      title: "Fallback insert",
    });

    expect(result.created).toBe(true);
    expect(serverFromMock).toHaveBeenCalledWith("manager_notifications");
  });
});
