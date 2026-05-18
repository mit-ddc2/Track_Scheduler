-- Calabogie Safety v2 — per-day RSVP schema (additive, v1-safe).
--
-- Goal: let one event span multiple days where invites, assignments, and
-- attendance records are tracked per (event, staff, day) rather than per
-- (event, staff). Existing v1 rows all map to the event's start date.
--
-- Strategy (no destructive ops):
--   1. Add `day_date date` column nullable to the three relation tables.
--   2. Backfill from `events.starts_at::date` so existing rows are correct.
--   3. Promote the column to NOT NULL.
--   4. Drop the v1 UNIQUE(event_id, staff_member_id) constraints.
--   5. Add v2 UNIQUE(event_id, staff_member_id, day_date) constraints.
--   6. Add `events.ends_on_date` (generated stored) for fast date-range queries.
--   7. Add indexes on (event_id, day_date) for the new per-day queries.
--
-- Safe to run on a populated v1 database: every existing invite/assignment/
-- attendance row gets `day_date = starts_at::date` (always single-day in v1).

-- ─── 1. Add day_date columns (nullable for the backfill) ──────────────────
alter table public.event_invites
  add column if not exists day_date date;
alter table public.event_assignments
  add column if not exists day_date date;
alter table public.attendance_records
  add column if not exists day_date date;

-- ─── 2. Backfill from events.starts_at::date ─────────────────────────────
update public.event_invites ei
  set day_date = (select e.starts_at::date
                  from public.events e
                  where e.id = ei.event_id)
  where ei.day_date is null;

update public.event_assignments ea
  set day_date = (select e.starts_at::date
                  from public.events e
                  where e.id = ea.event_id)
  where ea.day_date is null;

update public.attendance_records ar
  set day_date = (select e.starts_at::date
                  from public.events e
                  where e.id = ar.event_id)
  where ar.day_date is null;

-- ─── 3. Lock the column down ─────────────────────────────────────────────
alter table public.event_invites
  alter column day_date set not null;
alter table public.event_assignments
  alter column day_date set not null;
alter table public.attendance_records
  alter column day_date set not null;

-- ─── 4. Drop v1 per-event unique constraints ─────────────────────────────
alter table public.event_invites
  drop constraint if exists event_invites_event_id_staff_member_id_key;
alter table public.event_assignments
  drop constraint if exists event_assignments_event_id_staff_member_id_key;
alter table public.attendance_records
  drop constraint if exists attendance_records_event_id_staff_member_id_key;

-- ─── 5. Add v2 per-day unique constraints ────────────────────────────────
alter table public.event_invites
  add constraint event_invites_event_staff_day_key
  unique (event_id, staff_member_id, day_date);
alter table public.event_assignments
  add constraint event_assignments_event_staff_day_key
  unique (event_id, staff_member_id, day_date);
alter table public.attendance_records
  add constraint attendance_records_event_staff_day_key
  unique (event_id, staff_member_id, day_date);

-- ─── 6. events.ends_on_date for fast date-range queries ──────────────────
-- Use a STORED GENERATED column derived from `ends_at AT TIME ZONE timezone`
-- so per-day matrix queries can hit "is this event active on day D?" with a
-- single index scan instead of computing the timezone shift per row.
alter table public.events
  add column if not exists ends_on_date date
  generated always as (((ends_at at time zone timezone))::date) stored;

-- ─── 7. Indexes to back per-day queries ──────────────────────────────────
create index if not exists idx_event_invites_event_day
  on public.event_invites (event_id, day_date);
create index if not exists idx_event_assignments_event_day
  on public.event_assignments (event_id, day_date);
create index if not exists idx_attendance_records_event_day
  on public.attendance_records (event_id, day_date);
create index if not exists idx_events_ends_on_date
  on public.events (ends_on_date);
