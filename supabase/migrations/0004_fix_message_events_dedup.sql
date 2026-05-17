-- Calabogie Safety — fix message_events dedup constraint.
--
-- The original 0001 schema declared the unique constraint as
-- (provider, provider_message_id, event_type, received_at). That bypasses
-- dedup because received_at defaults to now() on insert — every duplicate
-- webhook gets a different timestamp and slips through.
--
-- This migration drops the 4-column unique and replaces it with a
-- 3-column unique index on (provider, provider_message_id, event_type) so
-- our `.upsert(..., { onConflict, ignoreDuplicates: true })` calls in
-- `lib/messaging/provider-webhooks.ts` actually de-dupe.
--
-- Note: 0001_initial_schema.sql has already been rewritten to use the
-- 3-column index directly for fresh rebuilds. This migration is the
-- forward path for environments already running the 4-column constraint.

alter table message_events
  drop constraint if exists message_events_provider_provider_message_id_event_type_rece_key;

-- guarded creation in case 0001 was re-run after the rewrite
create unique index if not exists message_events_dedupe
  on message_events (provider, provider_message_id, event_type);
