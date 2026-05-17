-- Transactional helper for updateStaffMember.
-- The previous approach (delete + insert per relation table) was non-atomic:
-- if the insert failed mid-way, the staff member ended up with no contacts,
-- roles, or qualifications. Wrapping the swap in a single function makes
-- the whole thing succeed or fail together (Postgres runs each function in
-- an implicit transaction).
--
-- Parameters:
--   p_staff_id            staff_members.id
--   p_contact_methods     jsonb array of:
--     { channel, value, normalized_value, is_primary, status,
--       consent, consent_source, consented_at }
--   p_role_ids            uuid[] of crew_roles to attach. The primary role is
--                         encoded in p_primary_role_id (NULL = no primary).
--   p_primary_role_id     uuid | NULL
--   p_qualification_ids   jsonb array of:
--     { qualification_id, notes, expires_at }
--
-- Owner-only (callers must be owners; we keep the same check the table-level
-- RLS uses so this RPC can't be used to escalate).

create or replace function public.update_staff_relations_tx(
  p_staff_id uuid,
  p_contact_methods jsonb,
  p_role_ids uuid[],
  p_primary_role_id uuid,
  p_qualification_ids jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_owner boolean;
begin
  -- Defence in depth: even though RLS protects the underlying tables,
  -- security-definer functions bypass RLS so we re-check ownership.
  select coalesce(p.is_owner, false)
    into v_is_owner
    from public.profiles p
   where p.id = auth.uid();

  if not coalesce(v_is_owner, false) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_staff_id is null then
    raise exception 'p_staff_id required';
  end if;

  -- Swap contact methods.
  delete from public.staff_contact_methods
   where staff_member_id = p_staff_id;

  if p_contact_methods is not null and jsonb_typeof(p_contact_methods) = 'array' then
    insert into public.staff_contact_methods (
      staff_member_id, channel, value, normalized_value,
      is_primary, status, consent, consent_source, consented_at
    )
    select
      p_staff_id,
      (elem->>'channel')::public.contact_channel,
      elem->>'value',
      elem->>'normalized_value',
      coalesce((elem->>'is_primary')::boolean, false),
      coalesce((elem->>'status')::public.contact_status, 'unknown'),
      coalesce((elem->>'consent')::public.consent_status, 'unknown'),
      elem->>'consent_source',
      nullif(elem->>'consented_at', '')::timestamptz
      from jsonb_array_elements(p_contact_methods) as elem;
  end if;

  -- Swap roles.
  delete from public.staff_roles
   where staff_member_id = p_staff_id;

  if p_role_ids is not null and array_length(p_role_ids, 1) is not null then
    insert into public.staff_roles (staff_member_id, role_id, is_primary)
    select p_staff_id, role_id, role_id = p_primary_role_id
      from unnest(p_role_ids) as role_id;
  end if;

  -- Swap qualifications.
  delete from public.staff_qualifications
   where staff_member_id = p_staff_id;

  if p_qualification_ids is not null
     and jsonb_typeof(p_qualification_ids) = 'array' then
    insert into public.staff_qualifications (
      staff_member_id, qualification_id, notes, expires_at
    )
    select
      p_staff_id,
      (elem->>'qualification_id')::uuid,
      elem->>'notes',
      nullif(elem->>'expires_at', '')::timestamptz
      from jsonb_array_elements(p_qualification_ids) as elem;
  end if;
end;
$$;

revoke all on function public.update_staff_relations_tx(uuid, jsonb, uuid[], uuid, jsonb) from public;
grant execute on function public.update_staff_relations_tx(uuid, jsonb, uuid[], uuid, jsonb) to authenticated;
