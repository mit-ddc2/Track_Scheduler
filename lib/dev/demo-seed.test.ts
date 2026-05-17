import { describe, expect, it, vi } from "vitest";

import { resetAndSeedDemoData } from "./demo-seed";

/**
 * In-memory Supabase mock — captures every insert/rpc call so the assertions
 * can verify the seed runs in the right order, references the right roles,
 * and produces the expected row counts. The mock returns synthetic UUIDs for
 * any `.select("id, ...")` so the chain wiring (events → invites → assignments)
 * stays type-correct.
 */
function makeAdmin() {
  const calls: Array<{ op: string; table?: string; rows?: unknown }> = [];

  const roles = [
    { id: "role-incident-lead", name: "Incident Lead" },
    { id: "role-rescue-crew", name: "Rescue Crew" },
    { id: "role-truck-driver", name: "Truck Driver" },
    { id: "role-medical", name: "Medical/First Aid" },
  ];
  const quals = [
    { id: "qual-fire", name: "Fire Suppression" },
    { id: "qual-extrication", name: "Extrication" },
    { id: "qual-first-aid", name: "First Aid" },
    { id: "qual-medical", name: "Medical" },
    { id: "qual-driver", name: "Driver" },
  ];

  // Each `from(table).insert(rows).select(cols)` returns a promise resolving
  // with synthetic IDs derived from the row index + table name.
  function fromMock(table: string) {
    return {
      select() {
        if (table === "crew_roles") {
          calls.push({ op: "select", table });
          return Promise.resolve({ data: roles, error: null });
        }
        if (table === "qualifications") {
          calls.push({ op: "select", table });
          return Promise.resolve({ data: quals, error: null });
        }
        throw new Error(`unexpected select on ${table}`);
      },
      insert(rows: unknown) {
        const arr = Array.isArray(rows) ? rows : [rows];
        calls.push({ op: "insert", table, rows: arr });
        return {
          select() {
            // Manufacture deterministic IDs so downstream inserts can FK to them.
            type Row = Record<string, unknown>;
            const data = arr.map((row, i) => {
              const base = row as Row;
              return {
                ...base,
                id: `${table}-id-${i}`,
              };
            });
            return Promise.resolve({ data, error: null });
          },
          then(onFulfilled: (val: { error: null }) => unknown) {
            // Plain insert (no select) — resolve with { error: null }.
            return Promise.resolve({ error: null }).then(onFulfilled);
          },
        };
      },
    };
  }

  type RpcResult = { error: null | { message: string } };
  return {
    client: {
      rpc: vi.fn<(name: string) => Promise<RpcResult>>(async () => ({
        error: null,
      })),
      from: vi.fn(fromMock),
    },
    calls,
  };
}

describe("resetAndSeedDemoData", () => {
  it("truncates first, then re-seeds in the right order with the expected row counts", async () => {
    const { client, calls } = makeAdmin();
    // SupabaseClient is generic; the seed module casts away from the
    // hand-rolled Database type where needed, so a structural mock is fine.
    const counts = await resetAndSeedDemoData(
      client as unknown as Parameters<typeof resetAndSeedDemoData>[0],
    );

    // RPC truncate runs exactly once and before any inserts.
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("admin_reset_demo_tables");
    // First DB call has to be the truncate.
    expect(calls[0]).toEqual({ op: "select", table: "crew_roles" });

    // Final counts match the spec.
    expect(counts).toEqual({
      staff: 6,
      events: 3,
      contact_methods: 10,
      staff_roles: 6,
      staff_qualifications: 13,
      event_requirements: 8,
      event_invites: 11,
      event_assignments: 7, // 5 AISA accepted + 2 Enduro accepted
    });

    // All required tables got at least one insert call.
    const insertedTables = calls
      .filter((c) => c.op === "insert")
      .map((c) => c.table);
    for (const t of [
      "staff_members",
      "staff_contact_methods",
      "staff_roles",
      "staff_qualifications",
      "events",
      "event_requirements",
      "event_invites",
      "event_assignments",
    ]) {
      expect(insertedTables).toContain(t);
    }
  });

  it("surfaces a clear error if the truncate RPC fails", async () => {
    const { client } = makeAdmin();
    client.rpc = vi.fn(async () => ({ error: { message: "permission denied" } }));
    await expect(
      resetAndSeedDemoData(
        client as unknown as Parameters<typeof resetAndSeedDemoData>[0],
      ),
    ).rejects.toThrow("admin_reset_demo_tables failed: permission denied");
  });
});
