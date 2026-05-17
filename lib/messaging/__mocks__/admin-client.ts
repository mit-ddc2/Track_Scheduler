/**
 * Tiny in-memory stand-in for the Supabase admin client, just enough to
 * exercise outbox + provider-webhooks code paths. Supports the chains we
 * actually use:
 *
 *   admin.from(table).select(...)[.eq(...)].maybeSingle()
 *   admin.from(table).select("*").eq(...).or(...).order(...).limit(...)
 *   admin.from(table).insert({...}).select(...).single()
 *   admin.from(table).insert({...})                          (no select)
 *   admin.from(table).update({...}).eq(...).select(...)?
 *   admin.from(table).update({...}).eq(...).eq(...)?
 *   admin.from(table).update({...}).in(field, [ids]).eq(...).select(...)?
 *
 * Filters are composable; the final terminator resolves into a Promise of
 * `{ data, error }`.
 */

type Row = Record<string, unknown>;

type FilterFn = (row: Row) => boolean;

type Query = {
  table: string;
  filters: FilterFn[];
  selectCols?: string;
  orderBy?: { col: string; ascending: boolean };
  limitN?: number;
};

export class MockSupabase {
  tables: Record<string, Row[]> = {};
  inserts: Array<{ table: string; row: Row }> = [];

  // Useful for some tests: pre-seed rows.
  seed(table: string, rows: Row[]) {
    if (!this.tables[table]) this.tables[table] = [];
    for (const r of rows) {
      const copy = { ...r };
      if (!copy.id) copy.id = cryptoId();
      this.tables[table].push(copy);
    }
  }

  from(table: string) {
    if (!this.tables[table]) this.tables[table] = [];
    return new MockTable(this, table);
  }
}

function cryptoId() {
  return "id_" + Math.random().toString(36).slice(2, 10);
}

class MockTable {
  constructor(
    private db: MockSupabase,
    private table: string,
  ) {}

  select(cols = "*") {
    const q: Query = { table: this.table, filters: [], selectCols: cols };
    return new MockSelect(this.db, q);
  }

  insert(row: Row | Row[]) {
    return new MockInsert(this.db, this.table, row);
  }

  upsert(
    row: Row | Row[],
    opts?: { onConflict?: string; ignoreDuplicates?: boolean },
  ) {
    return new MockUpsert(this.db, this.table, row, opts);
  }

  update(patch: Row) {
    return new MockUpdate(this.db, this.table, patch);
  }
}

class MockSelect {
  constructor(
    private db: MockSupabase,
    private q: Query,
  ) {}

  eq(col: string, val: unknown) {
    this.q.filters.push((r) => r[col] === val);
    return this;
  }

  in(col: string, vals: unknown[]) {
    this.q.filters.push((r) => vals.includes(r[col] as unknown));
    return this;
  }

  or(expr: string) {
    // Supports the two patterns we use:
    //   "next_attempt_at.is.null,next_attempt_at.lte.<iso>"
    const parts = expr.split(",");
    this.q.filters.push((r) => {
      for (const p of parts) {
        const [col, op, ...rest] = p.split(".");
        const v = rest.join(".");
        const cell = r[col];
        if (op === "is" && v === "null" && (cell === null || cell === undefined)) return true;
        if (op === "lte" && typeof cell === "string" && cell <= v) return true;
        if (op === "eq" && cell === v) return true;
      }
      return false;
    });
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }) {
    this.q.orderBy = { col, ascending: opts?.ascending ?? true };
    return this;
  }

  limit(n: number) {
    this.q.limitN = n;
    return this;
  }

  private resolveRows(): Row[] {
    const all = this.db.tables[this.q.table] ?? [];
    let out = all.filter((r) => this.q.filters.every((f) => f(r)));
    if (this.q.orderBy) {
      const { col, ascending } = this.q.orderBy;
      out = out
        .slice()
        .sort((a, b) => {
          const av = a[col] as string;
          const bv = b[col] as string;
          if (av === bv) return 0;
          return (av < bv ? -1 : 1) * (ascending ? 1 : -1);
        });
    }
    if (typeof this.q.limitN === "number") out = out.slice(0, this.q.limitN);
    return out;
  }

  async maybeSingle() {
    const rows = this.resolveRows();
    if (rows.length === 0) return { data: null, error: null };
    return { data: rows[0], error: null };
  }

  async single() {
    const rows = this.resolveRows();
    if (rows.length === 0)
      return { data: null, error: { code: "PGRST116", message: "no rows" } };
    return { data: rows[0], error: null };
  }

  // Treat the select itself as awaitable for "list" queries.
  then<TResult>(onFulfilled: (v: { data: Row[]; error: null }) => TResult) {
    return Promise.resolve({ data: this.resolveRows(), error: null }).then(
      onFulfilled,
    );
  }
}

class MockInsert {
  constructor(
    private db: MockSupabase,
    private table: string,
    private rowOrRows: Row | Row[],
  ) {}

  private selectCols?: string;
  select(cols = "*") {
    this.selectCols = cols;
    return this;
  }

  private async commit(): Promise<{ data: Row[]; error: null | { code: string; message: string } }> {
    const list = this.db.tables[this.table] ?? (this.db.tables[this.table] = []);
    const toInsert = Array.isArray(this.rowOrRows)
      ? this.rowOrRows
      : [this.rowOrRows];
    const inserted: Row[] = [];
    for (const r of toInsert) {
      // Unique constraint emulation for message_outbox.idempotency_key.
      if (this.table === "message_outbox" && r.idempotency_key) {
        const dup = list.find(
          (x) => x.idempotency_key === r.idempotency_key,
        );
        if (dup) {
          return {
            data: [],
            error: { code: "23505", message: "duplicate idempotency_key" },
          };
        }
      }
      const row = { id: cryptoId(), created_at: new Date().toISOString(), ...r };
      list.push(row);
      inserted.push(row);
      this.db.inserts.push({ table: this.table, row });
    }
    return { data: inserted, error: null };
  }

  async single() {
    const res = await this.commit();
    if (res.error) return { data: null, error: res.error };
    return { data: res.data[0] ?? null, error: null };
  }

  then<TResult>(onFulfilled: (v: { data: Row[] | null; error: unknown }) => TResult) {
    return this.commit().then(onFulfilled);
  }
}

class MockUpsert {
  constructor(
    private db: MockSupabase,
    private table: string,
    private rowOrRows: Row | Row[],
    private opts?: { onConflict?: string; ignoreDuplicates?: boolean },
  ) {}

  private selectCols?: string;
  select(cols = "*") {
    this.selectCols = cols;
    return this;
  }

  private async commit(): Promise<{
    data: Row[];
    error: null | { code: string; message: string };
  }> {
    const list = this.db.tables[this.table] ?? (this.db.tables[this.table] = []);
    const toInsert = Array.isArray(this.rowOrRows)
      ? this.rowOrRows
      : [this.rowOrRows];
    const conflictCols = (this.opts?.onConflict ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const ignoreDuplicates = this.opts?.ignoreDuplicates === true;

    const inserted: Row[] = [];
    for (const r of toInsert) {
      // Conflict detection on the configured columns.
      let dupIndex = -1;
      if (conflictCols.length > 0) {
        dupIndex = list.findIndex((x) =>
          conflictCols.every((c) => x[c] === r[c]),
        );
      }
      if (dupIndex >= 0) {
        if (ignoreDuplicates) {
          // No-op: keep existing row, do not return it.
          continue;
        }
        // Update existing row in-place.
        const existing = list[dupIndex];
        for (const k of Object.keys(r)) {
          if (r[k] !== undefined) existing[k] = r[k] as unknown as never;
        }
        inserted.push(existing);
        continue;
      }
      const row = { id: cryptoId(), created_at: new Date().toISOString(), ...r };
      list.push(row);
      inserted.push(row);
      this.db.inserts.push({ table: this.table, row });
    }
    return { data: inserted, error: null };
  }

  async single() {
    const res = await this.commit();
    if (res.error) return { data: null, error: res.error };
    return { data: res.data[0] ?? null, error: null };
  }

  then<TResult>(onFulfilled: (v: { data: Row[] | null; error: unknown }) => TResult) {
    return this.commit().then(onFulfilled);
  }
}

class MockUpdate {
  constructor(
    private db: MockSupabase,
    private table: string,
    private patch: Row,
  ) {}

  private filters: FilterFn[] = [];
  private selectCols?: string;

  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  select(cols = "*") {
    this.selectCols = cols;
    return this;
  }

  private async commit(): Promise<{
    data: Row[];
    error: null | { code: string; message: string };
  }> {
    const list = this.db.tables[this.table] ?? (this.db.tables[this.table] = []);
    const matched = list.filter((r) => this.filters.every((f) => f(r)));
    for (const r of matched) {
      for (const k of Object.keys(this.patch)) {
        if (this.patch[k] !== undefined) r[k] = this.patch[k] as unknown as never;
      }
    }
    return { data: matched, error: null };
  }

  then<TResult>(onFulfilled: (v: { data: Row[]; error: unknown }) => TResult) {
    return this.commit().then(onFulfilled);
  }
}
