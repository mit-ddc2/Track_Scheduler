-- Mock SMS provider log (dev / E2E testing).
--
-- When MESSAGING_PROVIDER=mock or TWILIO_MESSAGING_SERVICE_SID starts with
-- "mock_", lib/messaging/send-sms.ts inserts a row here instead of calling
-- Twilio. The dashboard route /dashboard/mock-sms reads from this table for
-- an owner-only diagnostic view.

create table if not exists public.mock_sent_sms (
  id uuid primary key default gen_random_uuid(),
  to_value text not null,
  body text not null,
  provider_message_id text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists mock_sent_sms_created_at_idx
  on public.mock_sent_sms (created_at desc);

alter table public.mock_sent_sms enable row level security;

-- Owner-only SELECT; inserts/updates only happen server-side via the service
-- role client (which bypasses RLS). No policies for insert/update => no
-- anon/auth writes possible.
create policy mock_sent_sms_owner_select on public.mock_sent_sms
  for select using (public.is_owner());
