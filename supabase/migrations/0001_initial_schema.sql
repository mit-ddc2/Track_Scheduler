-- Calabogie Safety — initial schema (spec §11)
-- All tables, enums, indexes for v1. RLS lives in 0002_rls.sql.

-- ─── Enums ─────────────────────────────────────────────────────
create type contact_channel as enum ('sms', 'email');
create type preferred_contact_method as enum ('sms', 'email', 'both', 'manual_only');
create type contact_status as enum ('unknown', 'valid', 'invalid', 'bounced', 'suppressed', 'opted_out');
create type consent_status as enum ('unknown', 'granted', 'denied', 'withdrawn');
create type event_status as enum ('draft', 'scheduled', 'inviting', 'underfilled', 'staffed', 'needs_review', 'locked', 'completed', 'cancelled');
create type event_source_type as enum ('manual', 'google_calendar', 'ics_feed');
create type calendar_sync_status as enum ('never_synced', 'syncing', 'healthy', 'failed', 'needs_reauth', 'disabled');
create type calendar_change_type as enum ('created', 'updated', 'cancelled', 'deleted', 'restored', 'source_missing');
create type campaign_status as enum ('draft', 'sending', 'sent', 'partially_failed', 'cancelled');
create type invite_status as enum ('created', 'invited', 'accepted', 'declined', 'cancelled_by_member', 'cancelled_by_manager', 'availability_updated', 'expired', 'waitlisted');
create type assignment_status as enum ('confirmed', 'waitlisted', 'cancelled', 'completed');
create type outbox_status as enum ('pending', 'sending', 'sent', 'failed', 'cancelled');
create type notification_severity as enum ('info', 'warning', 'urgent');
create type notification_status as enum ('unread', 'read', 'archived');
create type attendance_status as enum ('scheduled', 'worked', 'no_show', 'cancelled_by_member', 'cancelled_by_manager', 'excused');

-- ─── Owner profile ─────────────────────────────────────────────
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  email text not null unique,
  is_owner boolean not null default true,
  is_active boolean not null default true,
  phone_for_alerts text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── Roles & qualifications ────────────────────────────────────
create table crew_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table qualifications (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── Staff ─────────────────────────────────────────────────────
create table staff_members (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  first_name text,
  last_name text,
  preferred_contact preferred_contact_method not null default 'both',
  active boolean not null default true,
  notes text,
  imported_source text,
  created_by uuid references profiles(id),
  updated_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table staff_contact_methods (
  id uuid primary key default gen_random_uuid(),
  staff_member_id uuid not null references staff_members(id) on delete cascade,
  channel contact_channel not null,
  value text not null,
  normalized_value text not null,
  is_primary boolean not null default true,
  status contact_status not null default 'unknown',
  consent consent_status not null default 'unknown',
  consent_source text,
  consented_at timestamptz,
  opted_out_at timestamptz,
  last_verified_at timestamptz,
  last_delivery_status text,
  last_delivery_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(channel, normalized_value)
);

create table staff_roles (
  staff_member_id uuid not null references staff_members(id) on delete cascade,
  role_id uuid not null references crew_roles(id) on delete cascade,
  is_primary boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  primary key (staff_member_id, role_id)
);

create table staff_qualifications (
  staff_member_id uuid not null references staff_members(id) on delete cascade,
  qualification_id uuid not null references qualifications(id) on delete cascade,
  notes text,
  expires_at date,
  created_at timestamptz not null default now(),
  primary key (staff_member_id, qualification_id)
);

-- ─── Calendar (schema present for v1.1; UI deferred) ──────────
create table calendar_sources (
  id uuid primary key default gen_random_uuid(),
  source_type event_source_type not null check (source_type in ('google_calendar', 'ics_feed')),
  name text not null,
  google_calendar_id text,
  google_account_email text,
  ics_url_encrypted text,
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  sync_token text,
  watch_channel_id text,
  watch_resource_id text,
  watch_expires_at timestamptz,
  status calendar_sync_status not null default 'never_synced',
  last_synced_at timestamptz,
  last_sync_error text,
  active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table calendar_sync_runs (
  id uuid primary key default gen_random_uuid(),
  calendar_source_id uuid not null references calendar_sources(id) on delete cascade,
  trigger_type text not null,
  status text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  cancelled_count integer not null default 0,
  error_message text
);

-- ─── Events ────────────────────────────────────────────────────
create table events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  event_type text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'America/Toronto',
  location text,
  status event_status not null default 'draft',
  source_type event_source_type not null default 'manual',
  calendar_source_id uuid references calendar_sources(id) on delete set null,
  source_event_id text,
  source_etag text,
  source_updated_at timestamptz,
  last_source_seen_at timestamptz,
  source_hash text,
  review_required boolean not null default false,
  required_headcount integer not null default 0 check (required_headcount >= 0),
  overbooking_policy text not null default 'allow_all',
  manager_notes text,
  created_by uuid references profiles(id),
  updated_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  completed_at timestamptz,
  constraint valid_event_time check (ends_at > starts_at)
);

create table calendar_change_events (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  calendar_source_id uuid references calendar_sources(id) on delete set null,
  source_event_id text,
  change_type calendar_change_type not null,
  changed_fields jsonb not null default '{}',
  before_snapshot jsonb,
  after_snapshot jsonb,
  requires_review boolean not null default false,
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table event_requirements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  label text not null,
  required_count integer not null check (required_count >= 0),
  role_id uuid references crew_roles(id),
  qualification_id uuid references qualifications(id),
  notes text,
  created_at timestamptz not null default now()
);

-- ─── Campaigns, invites, assignments ──────────────────────────
create table invitation_campaigns (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  created_by uuid references profiles(id),
  status campaign_status not null default 'draft',
  channels contact_channel[] not null,
  campaign_type text not null default 'initial',
  audience_snapshot jsonb not null default '{}',
  sms_template text,
  email_subject text,
  email_template text,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  suppressed_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);

create table event_invites (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  campaign_id uuid references invitation_campaigns(id) on delete set null,
  staff_member_id uuid not null references staff_members(id),
  status invite_status not null default 'created',
  selected_channels contact_channel[] not null,
  available_start_at timestamptz,
  available_end_at timestamptz,
  response_note text,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id, staff_member_id)
);

create table invite_response_history (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references event_invites(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  staff_member_id uuid not null references staff_members(id),
  old_status invite_status,
  new_status invite_status not null,
  available_start_at timestamptz,
  available_end_at timestamptz,
  response_note text,
  actor_type text not null,
  created_at timestamptz not null default now()
);

create table rsvp_tokens (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references event_invites(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table event_assignments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  staff_member_id uuid not null references staff_members(id),
  invite_id uuid references event_invites(id),
  status assignment_status not null default 'confirmed',
  role_id uuid references crew_roles(id),
  role_label text,
  requirement_id uuid references event_requirements(id),
  counts_toward_headcount boolean not null default true,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id, staff_member_id)
);

-- ─── Notifications & preferences ──────────────────────────────
create table manager_notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  severity notification_severity not null default 'info',
  status notification_status not null default 'unread',
  event_type text not null,
  title text not null,
  body text,
  event_id uuid references events(id) on delete cascade,
  staff_member_id uuid references staff_members(id) on delete set null,
  related_entity_type text,
  related_entity_id uuid,
  dedupe_key text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique(profile_id, dedupe_key)
);

create table notification_preferences (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  event_type text not null,
  in_app_enabled boolean not null default true,
  email_enabled boolean not null default false,
  sms_enabled boolean not null default false,
  minimum_sms_severity notification_severity not null default 'urgent',
  minimum_email_severity notification_severity not null default 'warning',
  quiet_hours_start time,
  quiet_hours_end time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(profile_id, event_type)
);

-- ─── Message outbox & provider events ─────────────────────────
create table message_outbox (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references invitation_campaigns(id) on delete set null,
  invite_id uuid references event_invites(id) on delete set null,
  manager_notification_id uuid references manager_notifications(id) on delete set null,
  staff_member_id uuid references staff_members(id),
  channel contact_channel not null,
  to_value text not null,
  subject text,
  body_text text not null,
  body_html text,
  provider text not null,
  provider_message_id text,
  idempotency_key text not null unique,
  status outbox_status not null default 'pending',
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table message_events (
  id uuid primary key default gen_random_uuid(),
  message_outbox_id uuid references message_outbox(id) on delete set null,
  provider text not null,
  provider_message_id text,
  event_type text not null,
  payload jsonb not null default '{}',
  received_at timestamptz not null default now(),
  unique(provider, provider_message_id, event_type, received_at)
);

-- ─── Attendance & consent ─────────────────────────────────────
create table attendance_records (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  staff_member_id uuid not null references staff_members(id),
  assignment_id uuid references event_assignments(id) on delete set null,
  status attendance_status not null default 'scheduled',
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  actual_start timestamptz,
  actual_end timestamptz,
  actual_hours numeric(6,2),
  pay_rate numeric(10,2),
  pay_code text,
  notes text,
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id, staff_member_id)
);

create table consent_records (
  id uuid primary key default gen_random_uuid(),
  staff_member_id uuid not null references staff_members(id) on delete cascade,
  contact_method_id uuid references staff_contact_methods(id) on delete set null,
  channel contact_channel not null,
  status consent_status not null,
  source text not null,
  captured_by uuid references profiles(id),
  captured_at timestamptz not null default now(),
  notes text,
  evidence jsonb not null default '{}'
);

-- ─── Audit log ────────────────────────────────────────────────
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references profiles(id),
  actor_type text not null default 'owner',
  action text not null,
  entity_type text not null,
  entity_id uuid,
  summary text,
  before jsonb,
  after jsonb,
  request_id text,
  created_at timestamptz not null default now()
);

-- ─── Indexes (spec §11.4) ─────────────────────────────────────
create index idx_staff_members_active on staff_members(active);
create index idx_staff_contact_staff on staff_contact_methods(staff_member_id);
create index idx_staff_contact_channel_status on staff_contact_methods(channel, status, consent);
create index idx_staff_roles_role on staff_roles(role_id);
create index idx_staff_qualifications_qualification on staff_qualifications(qualification_id);
create index idx_calendar_sources_active on calendar_sources(active);
create index idx_calendar_sync_runs_source_started on calendar_sync_runs(calendar_source_id, started_at desc);
create index idx_events_starts_at on events(starts_at);
create index idx_events_status on events(status);
create index idx_events_source_event on events(calendar_source_id, source_event_id);
create index idx_calendar_change_events_event on calendar_change_events(event_id, created_at desc);
create index idx_event_invites_event_status on event_invites(event_id, status);
create index idx_invite_response_history_event on invite_response_history(event_id, created_at desc);
create index idx_event_assignments_event_status on event_assignments(event_id, status);
create index idx_manager_notifications_unread on manager_notifications(profile_id, status, created_at desc);
create index idx_outbox_status_next_attempt on message_outbox(status, next_attempt_at);
create index idx_attendance_event on attendance_records(event_id);
create index idx_audit_log_entity on audit_log(entity_type, entity_id);

-- ─── Auto-update updated_at trigger ───────────────────────────
create or replace function tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t record;
begin
  for t in
    select c.relname as table_name
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and a.attname = 'updated_at'
      and c.relkind = 'r'
  loop
    execute format(
      'create trigger %I_set_updated_at before update on public.%I for each row execute function tg_set_updated_at()',
      t.table_name, t.table_name
    );
  end loop;
end $$;

-- ─── Profile auto-create on auth.user signup ──────────────────
-- Mirrors auth.users into public.profiles. is_owner is true only for the
-- bootstrap email list (single-user MVP per spec §8.1). Update this list
-- by inserting into public.owner_emails — keeps the trigger declarative.
create table owner_emails (
  email text primary key
);
insert into owner_emails (email) values ('mit@ddc2.com') on conflict do nothing;

create or replace function tg_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_is_owner boolean := exists (select 1 from public.owner_emails where email = new.email);
begin
  insert into public.profiles (id, display_name, email, is_owner, is_active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    new.email,
    v_is_owner,
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function tg_handle_new_user();
