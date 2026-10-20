-- Stable identity is independent of translated display names. Existing custom
-- and legacy system rows are not silently reclassified as setup defaults.
alter table public.budget_buckets add column system_key text;
alter table public.budget_buckets add constraint budget_buckets_system_key_check check (
  system_key is null or (
    is_system and archived_at is null
    and ((system_key in ('NEEDS', 'LEISURE') and type = 'SPENDABLE')
      or (system_key = 'SAVINGS' and type = 'SAVINGS'))
  )
);
create unique index budget_buckets_profile_system_key
on public.budget_buckets (profile_id, system_key) where system_key is not null;

-- The only elevated capability is provisioning three immutable system buckets
-- for auth.uid(). No owner, name, type, or arbitrary data is accepted from callers.
create function public.prepare_initial_budget_buckets()
returns setof public.budget_buckets
language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := auth.uid();
begin
  if owner_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  perform 1 from public.profiles where id = owner_id for update;
  if not found then
    raise exception 'An owned profile is required' using errcode = '42501';
  end if;
  insert into public.budget_buckets (profile_id, name, type, is_system, system_key)
  values (owner_id, 'Needs', 'SPENDABLE', true, 'NEEDS'),
    (owner_id, 'Leisure', 'SPENDABLE', true, 'LEISURE'),
    (owner_id, 'Savings', 'SAVINGS', true, 'SAVINGS')
  on conflict (profile_id, system_key) where system_key is not null do nothing;
  return query select * from public.budget_buckets
    where profile_id = owner_id and system_key is not null order by system_key;
end;
$$;
revoke all on function public.prepare_initial_budget_buckets() from public, anon, authenticated;
grant execute on function public.prepare_initial_budget_buckets() to authenticated;

-- Initial setup never replaces an existing plan. Identical retries recover a
-- lost response; a competing different setup is a conflict, not an overwrite.
create function public.save_initial_budget(
  p_starts_on date, p_base_currency text, p_expected_income_minor bigint, p_allocations jsonb
)
returns public.budget_periods
language plpgsql security invoker set search_path = '' as $$
declare period public.budget_periods;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Budget setup requires READ COMMITTED isolation' using errcode = '0A000';
  end if;
  if p_starts_on is null or extract(day from p_starts_on) <> 1 then
    raise exception 'A calendar month is required' using errcode = '22023';
  end if;
  -- Validate the complete default set even on the idempotent retry path.
  if p_allocations is null or pg_catalog.jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'Three default allocations are required' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(p_allocations) <> 3 or exists (
    select 1 from pg_catalog.jsonb_array_elements(p_allocations) entry
    where pg_catalog.jsonb_typeof(entry) <> 'object'
      or pg_catalog.jsonb_typeof(entry -> 'budget_bucket_id') is distinct from 'string'
      or pg_catalog.jsonb_typeof(entry -> 'percentage_basis_points') is distinct from 'number'
      or (entry ->> 'percentage_basis_points') !~ '^[0-9]+$'
  ) then
    raise exception 'Three default allocations are required' using errcode = '22023';
  end if;
  if (select count(distinct (entry ->> 'budget_bucket_id')::uuid)
    from pg_catalog.jsonb_array_elements(p_allocations) entry) <> 3
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_allocations) entry
      where not exists (select 1 from public.budget_buckets b
        where b.id = (entry ->> 'budget_bucket_id')::uuid and b.profile_id = auth.uid()
          and b.system_key is not null and b.archived_at is null)) then
    raise exception 'Owned default buckets are required' using errcode = '42501';
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_allocations) entry
    where (entry ->> 'percentage_basis_points')::numeric > 10000)
    or (select sum((entry ->> 'percentage_basis_points')::numeric)
      from pg_catalog.jsonb_array_elements(p_allocations) entry) <> 10000 then
    raise exception 'Allocations must total 10000 basis points' using errcode = '23514';
  end if;
  insert into public.budget_periods (profile_id, starts_on, ends_on, base_currency, expected_income_minor)
  values (auth.uid(), p_starts_on, (p_starts_on + interval '1 month' - interval '1 day')::date,
    p_base_currency, p_expected_income_minor)
  on conflict (profile_id, starts_on) do nothing;
  select * into period from public.budget_periods
    where profile_id = auth.uid() and starts_on = p_starts_on for update;
  if not found or period.status <> 'OPEN' then
    raise exception 'An owned open period is required' using errcode = '42501';
  end if;
  if period.base_currency is distinct from p_base_currency then
    raise exception 'Period currency differs from preview' using errcode = '23514';
  end if;
  if exists (select 1 from public.budget_allocations where budget_period_id = period.id) then
    if period.expected_income_minor is not distinct from p_expected_income_minor
      and (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'budget_bucket_id', budget_bucket_id, 'percentage_basis_points', percentage_basis_points)
        order by budget_bucket_id) from public.budget_allocations
        where budget_period_id = period.id and deleted_at is null)
      = (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'budget_bucket_id', (entry ->> 'budget_bucket_id')::uuid,
        'percentage_basis_points', (entry ->> 'percentage_basis_points')::integer)
        order by (entry ->> 'budget_bucket_id')::uuid)
        from pg_catalog.jsonb_array_elements(p_allocations) entry) then
      return period;
    end if;
    raise exception 'The period already has a budget' using errcode = '23505';
  end if;
  update public.budget_periods set expected_income_minor = p_expected_income_minor
    where id = period.id returning * into period;
  perform public.save_budget_allocations(period.id, p_allocations);
  return period;
end;
$$;
revoke all on function public.save_initial_budget(date, text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.save_initial_budget(date, text, bigint, jsonb) to authenticated;
