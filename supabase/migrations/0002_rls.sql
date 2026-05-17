-- Row-Level Security policies (spec §12.2)
-- Single-user MVP: any authenticated owner can read/write business tables.
-- Service tables (outbox, message_events, calendar_sources, audit_log) are
-- server-only for writes; owner can read.

-- ─── Helper: is_owner() ───────────────────────────────────────
create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select is_owner and is_active
     from public.profiles
     where id = auth.uid()),
    false
  );
$$;

-- ─── Enable RLS on every public table ─────────────────────────
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ─── profiles: owner reads/updates own row ────────────────────
create policy profiles_owner_select on profiles for select using (auth.uid() = id);
create policy profiles_owner_update on profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- ─── Business tables: full owner access ───────────────────────
-- crew_roles, qualifications, staff_*, events, event_*, invitation_campaigns,
-- event_invites, invite_response_history, event_assignments, attendance_records,
-- consent_records, manager_notifications, notification_preferences

create policy crew_roles_owner_all on crew_roles for all using (is_owner()) with check (is_owner());
create policy qualifications_owner_all on qualifications for all using (is_owner()) with check (is_owner());
create policy staff_members_owner_all on staff_members for all using (is_owner()) with check (is_owner());
create policy staff_contact_methods_owner_all on staff_contact_methods for all using (is_owner()) with check (is_owner());
create policy staff_roles_owner_all on staff_roles for all using (is_owner()) with check (is_owner());
create policy staff_qualifications_owner_all on staff_qualifications for all using (is_owner()) with check (is_owner());
create policy events_owner_all on events for all using (is_owner()) with check (is_owner());
create policy event_requirements_owner_all on event_requirements for all using (is_owner()) with check (is_owner());
create policy invitation_campaigns_owner_all on invitation_campaigns for all using (is_owner()) with check (is_owner());
create policy event_invites_owner_all on event_invites for all using (is_owner()) with check (is_owner());
create policy invite_response_history_owner_select on invite_response_history for select using (is_owner());
create policy event_assignments_owner_all on event_assignments for all using (is_owner()) with check (is_owner());
create policy attendance_records_owner_all on attendance_records for all using (is_owner()) with check (is_owner());
create policy consent_records_owner_all on consent_records for all using (is_owner()) with check (is_owner());
create policy manager_notifications_owner_all on manager_notifications for all using (is_owner()) with check (is_owner());
create policy notification_preferences_owner_all on notification_preferences for all using (is_owner()) with check (is_owner());
create policy calendar_sources_owner_select on calendar_sources for select using (is_owner());
create policy calendar_sync_runs_owner_select on calendar_sync_runs for select using (is_owner());
create policy calendar_change_events_owner_select on calendar_change_events for select using (is_owner());

-- ─── Server-only writes (no policies = no anon/auth writes; service role bypasses RLS) ───
-- message_outbox, message_events, rsvp_tokens, audit_log: owner can SELECT for visibility,
-- inserts/updates happen server-side via service-role client.

create policy message_outbox_owner_select on message_outbox for select using (is_owner());
create policy message_events_owner_select on message_events for select using (is_owner());
create policy rsvp_tokens_owner_select on rsvp_tokens for select using (is_owner());
create policy audit_log_owner_select on audit_log for select using (is_owner());
