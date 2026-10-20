create table public.budget_allocations (
  id uuid primary key default gen_random_uuid(),
  budget_period_id uuid not null,
  budget_bucket_id uuid not null,
  percentage_basis_points integer not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  deleted_at timestamptz,
  constraint budget_allocations_period_fkey foreign key (budget_period_id)
    references public.budget_periods(id) on delete restrict,
  constraint budget_allocations_bucket_fkey foreign key (budget_bucket_id)
    references public.budget_buckets(id) on delete restrict,
  constraint budget_allocations_period_bucket_key unique (budget_period_id, budget_bucket_id),
  constraint budget_allocations_percentage_check check (percentage_basis_points between 0 and 10000)
);

create index budget_allocations_bucket_id_idx on public.budget_allocations (budget_bucket_id);

-- Lock the parent before every mutation. Concurrent saves and closing the same
-- period serialize on one row instead of validating independent partial totals.
create function public.prepare_budget_allocation_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  period_owner uuid;
  period_status text;
begin
  -- A parent lock serializes commands only when subsequent reads can see the
  -- preceding writer. Snapshot-isolated writes require a different contract.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Budget allocation writes require READ COMMITTED isolation' using errcode = '0A000';
  end if;
  if tg_op = 'UPDATE' and (
    new.id <> old.id or new.budget_period_id <> old.budget_period_id
    or new.budget_bucket_id <> old.budget_bucket_id
  ) then
    raise exception 'Allocation identity and scope are immutable' using errcode = '23514';
  end if;

  select profile_id, status into period_owner, period_status
  from public.budget_periods where id = new.budget_period_id for update;
  if not found or period_status <> 'OPEN' then
    raise exception 'An owned open budget period is required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.budget_buckets
    where id = new.budget_bucket_id and profile_id = period_owner
  ) then
    raise exception 'Bucket must belong to the period owner' using errcode = '42501';
  end if;
  -- Archival must not erase past allocations. Only adding/restoring an
  -- allocation requires an active bucket; an existing reference stays valid.
  if tg_op = 'INSERT' or (old.deleted_at is not null and new.deleted_at is null) then
    if exists (select 1 from public.budget_buckets where id = new.budget_bucket_id and archived_at is not null) then
      raise exception 'New allocations require an active bucket' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    if new.deleted_at is not null then
      new.deleted_at := coalesce(old.deleted_at, pg_catalog.statement_timestamp());
    end if;
  elsif new.deleted_at is not null then
    new.deleted_at := pg_catalog.statement_timestamp();
  end if;
  new.updated_at := pg_catalog.statement_timestamp();
  return new;
end;
$$;

create trigger budget_allocations_prepare_write
before insert or update on public.budget_allocations
for each row execute function public.prepare_budget_allocation_write();

create function public.check_budget_allocation_total()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select coalesce(sum(percentage_basis_points), 0)
      from public.budget_allocations
      where budget_period_id = new.budget_period_id and deleted_at is null) <> 10000 then
    raise exception 'Active budget allocations must total 10000 basis points' using errcode = '23514';
  end if;
  return null;
end;
$$;

-- Empty periods may await setup. Once allocations are written, the committed
-- active set must always be complete, including after a soft deletion.
create constraint trigger budget_allocations_total_check
after insert or update on public.budget_allocations
deferrable initially deferred
for each row execute function public.check_budget_allocation_total();

revoke all on function public.prepare_budget_allocation_write() from public, anon, authenticated;
revoke all on function public.check_budget_allocation_total() from public, anon, authenticated;

alter table public.budget_allocations enable row level security;
revoke all on table public.budget_allocations from public, anon, authenticated;
grant select on table public.budget_allocations to authenticated;
grant insert (budget_period_id, budget_bucket_id, percentage_basis_points)
on public.budget_allocations to authenticated;
grant update (percentage_basis_points, deleted_at)
on public.budget_allocations to authenticated;

create policy budget_allocations_select_own on public.budget_allocations
for select to authenticated using (
  exists (select 1 from public.budget_periods
    where id = budget_period_id and profile_id = (select auth.uid()))
);
create policy budget_allocations_insert_open_own on public.budget_allocations
for insert to authenticated with check (
  exists (select 1 from public.budget_periods
    where id = budget_period_id and profile_id = (select auth.uid()) and status = 'OPEN')
  and exists (select 1 from public.budget_buckets
    where id = budget_bucket_id and profile_id = (select auth.uid()) and archived_at is null)
);
create policy budget_allocations_update_open_own on public.budget_allocations
for update to authenticated using (
  exists (select 1 from public.budget_periods
    where id = budget_period_id and profile_id = (select auth.uid()) and status = 'OPEN')
) with check (
  exists (select 1 from public.budget_periods
    where id = budget_period_id and profile_id = (select auth.uid()) and status = 'OPEN')
  and exists (select 1 from public.budget_buckets
    where id = budget_bucket_id and profile_id = (select auth.uid()))
);

-- One complete configuration per call: callers cannot leave half a plan saved.
-- Invoker security uses the same grants, RLS and triggers as direct table access.
create function public.save_budget_allocations(p_budget_period_id uuid, p_allocations jsonb)
returns setof public.budget_allocations
language plpgsql
security invoker
set search_path = ''
as $$
declare
  period_id uuid;
  input_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  -- A parent lock serializes commands only when subsequent reads can see the
  -- preceding writer. Snapshot-isolated writes require a different contract.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Budget allocation writes require READ COMMITTED isolation' using errcode = '0A000';
  end if;

  select id into period_id from public.budget_periods
  where id = p_budget_period_id and profile_id = auth.uid() and status = 'OPEN'
  for update;
  if not found then
    raise exception 'An owned open budget period is required' using errcode = '42501';
  end if;
  if p_allocations is null or pg_catalog.jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'Allocations must be an array' using errcode = '22023';
  end if;
  input_count := pg_catalog.jsonb_array_length(p_allocations);
  if input_count = 0 or exists (
    select 1 from pg_catalog.jsonb_array_elements(p_allocations) as entry
    where pg_catalog.jsonb_typeof(entry) <> 'object'
      or pg_catalog.jsonb_typeof(entry -> 'budget_bucket_id') is distinct from 'string'
      or pg_catalog.jsonb_typeof(entry -> 'percentage_basis_points') is distinct from 'number'
      or (entry ->> 'percentage_basis_points') !~ '^[0-9]+$'
  ) then
    raise exception 'Allocations require bucket ids and integer basis points' using errcode = '22023';
  end if;
  if (select count(distinct (entry ->> 'budget_bucket_id')::uuid)
      from pg_catalog.jsonb_array_elements(p_allocations) as entry) <> input_count then
    raise exception 'Duplicate allocation bucket' using errcode = '22023';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_allocations) as entry
    where (entry ->> 'percentage_basis_points')::numeric > 10000
  ) or (select sum((entry ->> 'percentage_basis_points')::numeric)
        from pg_catalog.jsonb_array_elements(p_allocations) as entry) <> 10000 then
    raise exception 'Active budget allocations must total 10000 basis points' using errcode = '23514';
  end if;

  update public.budget_allocations set deleted_at = pg_catalog.statement_timestamp()
  where budget_period_id = period_id and deleted_at is null
    and budget_bucket_id not in (
      select (entry ->> 'budget_bucket_id')::uuid
      from pg_catalog.jsonb_array_elements(p_allocations) as entry
    );

  -- Update existing identities separately from INSERT, so archived buckets can
  -- retain historical references without weakening new-allocation validation.
  update public.budget_allocations as allocation
  set percentage_basis_points = (entry ->> 'percentage_basis_points')::integer, deleted_at = null
  from pg_catalog.jsonb_array_elements(p_allocations) as entry
  where allocation.budget_period_id = period_id
    and allocation.budget_bucket_id = (entry ->> 'budget_bucket_id')::uuid;

  insert into public.budget_allocations (budget_period_id, budget_bucket_id, percentage_basis_points)
  select period_id, (entry ->> 'budget_bucket_id')::uuid, (entry ->> 'percentage_basis_points')::integer
  from pg_catalog.jsonb_array_elements(p_allocations) as entry
  where not exists (
    select 1 from public.budget_allocations
    where budget_period_id = period_id and budget_bucket_id = (entry ->> 'budget_bucket_id')::uuid
  );

  return query select * from public.budget_allocations
  where budget_period_id = period_id and deleted_at is null order by budget_bucket_id;
end;
$$;

revoke all on function public.save_budget_allocations(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_budget_allocations(uuid, jsonb) to authenticated;
