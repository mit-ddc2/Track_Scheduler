-- Transactional replacement of an event's requirement set.
--
-- Replaces the prior client-side delete-then-insert pattern in
-- app/dashboard/events/actions.ts. Both operations now run in a single
-- transaction, so a failed insert cannot leave the event with zero rows.

create or replace function public.set_event_requirements_tx(
  p_event_id uuid,
  p_requirements jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row jsonb;
  v_label text;
  v_required_count integer;
  v_role_id uuid;
  v_qualification_id uuid;
  v_notes text;
begin
  if p_event_id is null then
    raise exception 'event id is required';
  end if;
  if p_requirements is null or jsonb_typeof(p_requirements) <> 'array' then
    raise exception 'requirements must be a JSON array';
  end if;

  -- Confirm the event exists; RLS still applies because the function runs
  -- as the invoker.
  if not exists (select 1 from events where id = p_event_id) then
    raise exception 'event % not found', p_event_id;
  end if;

  delete from event_requirements where event_id = p_event_id;

  for v_row in select * from jsonb_array_elements(p_requirements)
  loop
    v_label := nullif(btrim(coalesce(v_row->>'label', '')), '');
    if v_label is null then
      raise exception 'requirement label is required';
    end if;

    v_required_count := coalesce((v_row->>'required_count')::integer, 0);
    if v_required_count < 0 then
      raise exception 'required_count cannot be negative';
    end if;

    v_role_id := nullif(v_row->>'role_id', '')::uuid;
    v_qualification_id := nullif(v_row->>'qualification_id', '')::uuid;
    v_notes := nullif(v_row->>'notes', '');

    insert into event_requirements (
      event_id, label, required_count, role_id, qualification_id, notes
    ) values (
      p_event_id, v_label, v_required_count, v_role_id, v_qualification_id, v_notes
    );
  end loop;
end;
$$;

comment on function public.set_event_requirements_tx(uuid, jsonb)
  is 'Atomically replace an event''s requirements (delete + insert in one tx).';
