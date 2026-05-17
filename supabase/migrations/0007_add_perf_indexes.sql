-- Calabogie Safety — performance indexes (perf audit Phase, P-MEDIUM).
--
-- `listAllEvents` (lib/events/queries.ts) filters with
--   .or("starts_at.gte.<lower>,ends_at.gte.<lower>")
-- which PostgREST translates to a Postgres OR. The planner can satisfy the
-- starts_at half from `idx_events_starts_at` (0001) but has no index on
-- ends_at, so the OR forces a seq scan. Add a matching index on ends_at to
-- let the planner do an index-OR (bitmap-or) plan instead.
--
-- Guarded with `if not exists` so the migration is idempotent for fresh
-- rebuilds that may already include the index.

create index if not exists idx_events_ends_at on events(ends_at);
