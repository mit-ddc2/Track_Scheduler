-- Demo reset helper. Truncates all demo data tables in FK-safe order without
-- touching `profiles`, `crew_roles`, `qualifications`, or `owner_emails`
-- (those are part of the schema / app config, not the seedable demo data).
--
-- Guarded behind the admin route in app/api/admin/reset-demo/route.ts which
-- requires both `requireOwner()` AND a constant-time CRON_SECRET key match,
-- and is hard-disabled in prod unless DEV_RESET_DEMO_ENABLED=true.
--
-- Restart identity isn't needed (all PKs are uuid gen_random_uuid()), but
-- CASCADE handles any future child-of-child FKs we forget.

create or replace function admin_reset_demo_tables()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Children with FKs to events / staff_members first.
  truncate
    attendance_records,
    invite_response_history,
    rsvp_tokens,
    consent_records,
    event_assignments,
    event_invites,
    invitation_campaigns,
    event_requirements,
    calendar_change_events,
    manager_notifications,
    message_outbox,
    message_events,
    mock_sent_sms,
    audit_log,
    events,
    staff_qualifications,
    staff_roles,
    staff_contact_methods,
    staff_members,
    calendar_sources,
    calendar_sync_runs
    restart identity cascade;
end;
$$;

-- service_role and authenticated owner profile both invoke this via the
-- admin route — restrict execute to those roles only.
revoke all on function admin_reset_demo_tables() from public;
grant execute on function admin_reset_demo_tables() to service_role;
