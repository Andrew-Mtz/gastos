-- ADR-079: a bounded first-household operation, not a membership lifecycle.
-- The helper bypasses only membership RLS to avoid self-recursive policies. Its
-- actor is always auth.uid(); callers cannot probe another Profile's membership.
create function public.is_active_household_member(p_household_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.household_members m
    where m.household_id = p_household_id
      and m.profile_id = auth.uid() and m.left_at is null
  );
$$;
revoke all on function public.is_active_household_member(uuid)
  from public, anon, authenticated;
grant execute on function public.is_active_household_member(uuid) to authenticated;

-- Preserve the direct-write denial independently of the absence of write
-- policies. Column grants intentionally exclude creator/audit/lifecycle fields.
revoke all on table public.households from public, anon, authenticated;
revoke all on table public.household_members from public, anon, authenticated;
grant select(id, name, default_currency) on public.households to authenticated;
grant select(id, household_id, profile_id, role) on public.household_members to authenticated;

create policy households_select_active_member
on public.households for select to authenticated
using (public.is_active_household_member(id));

create policy household_members_select_active_member
on public.household_members for select to authenticated
using (left_at is null and public.is_active_household_member(household_id));

-- Definer capability is needed only for the explicitly projected display_name;
-- Profile RLS/grants remain unchanged. STABLE gives every part of the response
-- the calling statement's snapshot, including authorization and eligibility.
create function public.get_my_household_memberships()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  with actor as (
    select p.id from public.profiles p where p.id = auth.uid()
  ), authorized_households as (
    select h.id, h.name, h.default_currency
    from public.households h
    where exists (
      select 1 from public.household_members mine
      where mine.household_id = h.id and mine.profile_id = auth.uid()
        and mine.left_at is null
    )
  )
  select pg_catalog.jsonb_build_object(
    'profile_id', actor.id,
    'creation_status', case
      when exists (select 1 from authorized_households) then 'ACTIVE_MEMBERSHIP'
      when exists (
        select 1 from public.household_members history
        where history.profile_id = actor.id
      ) then 'PREVIOUS_MEMBERSHIP'
      else 'ELIGIBLE'
    end,
    'households', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', h.id, 'name', h.name, 'default_currency', h.default_currency,
        'members', (
          select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id', m.id, 'profile_id', m.profile_id,
            'display_name', p.display_name, 'role', m.role
          ) order by m.id), '[]'::jsonb)
          from public.household_members m
          join public.profiles p on p.id = m.profile_id
          where m.household_id = h.id and m.left_at is null
        )
      ) order by h.id)
      from authorized_households h
    ), '[]'::jsonb)
  ) into result from actor;
  if result is null then
    raise exception 'An owned profile is required' using errcode = '42501';
  end if;
  return result;
end;
$$;
revoke all on function public.get_my_household_memberships()
  from public, anon, authenticated;
grant execute on function public.get_my_household_memberships() to authenticated;

-- Clients cannot insert either table directly. This elevated operation supplies
-- both actor references and the OWNER label, and commits both rows or neither.
-- It touches no personal finance sources and uses a separate actor lock namespace.
create function public.create_first_household(
  p_household_id uuid, p_name text, p_default_currency text
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  existing public.households;
  inserted_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Household creation requires READ COMMITTED isolation'
      using errcode = '25001';
  end if;
  if p_household_id is null or p_name is null
    or char_length(p_name) > 100 or p_name !~ '[^[:space:]]'
    or p_default_currency is null or p_default_currency !~ '^[A-Z]{3}$' then
    raise exception 'A valid household identity, name and currency are required'
      using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('household-first:' || actor_id::text, 0)
  );
  if not exists (select 1 from public.profiles where id = actor_id) then
    raise exception 'An owned profile is required' using errcode = '42501';
  end if;

  select * into existing from public.households where id = p_household_id;
  if found then
    if existing.created_by = actor_id and existing.name = p_name
      and existing.default_currency = p_default_currency then
      -- A concurrent trusted revocation cannot be ignored after waiting on its
      -- row lock: READ COMMITTED rechecks the updated active-membership predicate.
      perform 1 from public.household_members
      where household_id = p_household_id and profile_id = actor_id
        and left_at is null
      for share;
      if found then
        return pg_catalog.jsonb_build_object('household_id', p_household_id);
      end if;
      raise exception 'Active household membership is required' using errcode = '42501';
    end if;
    raise exception 'Household request conflicts with current membership or an existing identity'
      using errcode = '23505';
  end if;

  if exists (select 1 from public.household_members where profile_id = actor_id) then
    raise exception 'Household request conflicts with current membership or an existing identity'
      using errcode = '23505';
  end if;
  insert into public.households(id, name, default_currency, created_by)
  values (p_household_id, p_name, p_default_currency, actor_id)
  on conflict (id) do nothing
  returning id into inserted_id;
  if inserted_id is null then
    -- Another actor can race this UUID without sharing the actor lock. The
    -- unique index settles that race without revealing their row or creating an
    -- orphan membership. Never treat their household as this actor's replay.
    raise exception 'Household request conflicts with current membership or an existing identity'
      using errcode = '23505';
  end if;
  insert into public.household_members(household_id, profile_id, role)
  values (inserted_id, actor_id, 'OWNER');
  return pg_catalog.jsonb_build_object('household_id', inserted_id);
end;
$$;
revoke all on function public.create_first_household(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.create_first_household(uuid, text, text) to authenticated;
