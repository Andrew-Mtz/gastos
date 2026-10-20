-- ADR-068: caller confirmation is evidence of an explicit request, not a bank transfer.
alter table public.transactions add column withdrawal_confirmed boolean not null default false;
alter table public.transactions add constraint transactions_withdrawal_confirmation
  check (type <> 'SAVINGS_WITHDRAWAL' or withdrawal_confirmed) not valid;
grant insert(withdrawal_confirmed) on public.transactions to authenticated;

-- Statement-level locks run before target row locks. All financial writers for
-- one owner serialize, even across different months and expense/contribution races.
create function public.lock_personal_finance()
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text, 115));
  end if;
end;
$$;
revoke all on function public.lock_personal_finance() from public, anon, authenticated;
grant execute on function public.lock_personal_finance() to authenticated;
create function public.lock_personal_finance_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform public.lock_personal_finance();
  return null;
end;
$$;
revoke all on function public.lock_personal_finance_write() from public, anon, authenticated;
create trigger transactions_lock_owner before insert or update on public.transactions
for each statement execute function public.lock_personal_finance_write();
create trigger budget_allocations_lock_owner before insert or update on public.budget_allocations
for each statement execute function public.lock_personal_finance_write();

create function public.get_savings_availability(p_budget_period_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  target public.budget_periods;
  period public.budget_periods;
  income numeric; contribution numeric; withdrawal numeric;
  allocated numeric; ordinary numeric; spent numeric := 0;
  reserve numeric := 0; opening numeric := 0;
  plan_count integer; plan_total bigint;
  maximum constant numeric := 9007199254740991;
begin
  select * into target from public.budget_periods
    where id = p_budget_period_id and profile_id = auth.uid();
  if not found then
    raise exception 'An owned budget period is required' using errcode = '42501';
  end if;
  for period in select * from public.budget_periods
    where profile_id = auth.uid() and base_currency = target.base_currency
      and starts_on <= target.starts_on order by starts_on, id
  loop
    if exists(select 1 from public.transactions where budget_period_id = period.id
      and deleted_at is null and type in ('INCOME','SAVINGS_CONTRIBUTION','SAVINGS_WITHDRAWAL')
      and (currency <> period.base_currency or (type <> 'INCOME' and category_id is not null)
        or (type = 'SAVINGS_WITHDRAWAL' and not withdrawal_confirmed))) then
      raise exception 'Incompatible historical savings or income requires correction' using errcode = '23514';
    end if;
    select coalesce(sum(amount_minor) filter(where type='INCOME'),0),
      coalesce(sum(amount_minor) filter(where type='SAVINGS_CONTRIBUTION'),0),
      coalesce(sum(amount_minor) filter(where type='SAVINGS_WITHDRAWAL'),0)
    into income,contribution,withdrawal from public.transactions
      where budget_period_id = period.id and deleted_at is null;
    if greatest(income,contribution,withdrawal) > maximum then
      raise exception 'Savings components exceed supported safe-integer range' using errcode = '22003';
    end if;
    select count(*),coalesce(sum(percentage_basis_points),0) into plan_count,plan_total
      from public.budget_allocations where budget_period_id=period.id and deleted_at is null;
    if (plan_count > 0 and plan_total <> 10000) or exists (
      select 1 from public.budget_allocations a left join public.budget_buckets b on b.id=a.budget_bucket_id
      where a.budget_period_id=period.id and a.deleted_at is null
        and (b.id is null or b.profile_id <> target.profile_id or b.type not in ('SPENDABLE','SAVINGS'))
    ) then
      raise exception 'A complete classified budget allocation is required' using errcode = '23514';
    end if;
    -- Round the complete month once, then partition, exactly as FIN-102/110/114.
    -- NUMERIC multiplication is exact; canonical UUID ordering breaks ties.
    with shares as (
      select a.budget_bucket_id,b.type,
        floor(income*a.percentage_basis_points/10000) as floor_minor,
        mod(income*a.percentage_basis_points,10000) as remainder
      from public.budget_allocations a join public.budget_buckets b on b.id=a.budget_bucket_id
      where a.budget_period_id=period.id and a.deleted_at is null
    ), ranked as (
      select *, row_number() over(order by remainder desc,budget_bucket_id) as rank,
        income-sum(floor_minor) over() as units from shares
    ) select coalesce(sum(floor_minor+case when rank<=units then 1 else 0 end)
      filter(where type='SAVINGS'),0),
      coalesce(sum(floor_minor+case when rank<=units then 1 else 0 end)
      filter(where type='SPENDABLE'),0) into allocated,ordinary from ranked;
    opening := reserve;
    reserve := reserve+allocated+contribution-withdrawal;
    if reserve < 0 then
      raise exception 'Savings withdrawal exceeds historical protected availability' using errcode = '23514';
    end if;
    if reserve > maximum or opening+allocated > maximum or opening+allocated+contribution > maximum then
      raise exception 'Protected savings exceeds supported safe-integer range' using errcode = '22003';
    end if;
  end loop;
  -- Reuse FIN-113 validation; malformed legacy expenses may not be hidden.
  select coalesce(sum((item->>'spent_minor')::numeric),0) into spent
    from pg_catalog.jsonb_array_elements(public.get_bucket_consumption(target.id)->'buckets') item;
  if abs(ordinary-contribution+withdrawal-spent) > maximum
    or ordinary+withdrawal > maximum then
    raise exception 'Ordinary remainder exceeds supported safe-integer range' using errcode = '22003';
  end if;
  return pg_catalog.jsonb_build_object('budget_period_id',target.id,'base_currency',target.base_currency,
    'opening_protected_minor',opening,'allocated_savings_minor',allocated,
    'contributions_minor',contribution,'withdrawals_minor',withdrawal,
    'spendable_allocated_minor',ordinary,'spent_minor',spent,'configured',plan_count>0);
end;
$$;
revoke all on function public.get_savings_availability(uuid) from public,anon,authenticated;
grant execute on function public.get_savings_availability(uuid) to authenticated;

create function public.validate_savings_movement()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare state jsonb; available numeric;
begin
  if new.type not in ('SAVINGS_CONTRIBUTION','SAVINGS_WITHDRAWAL') then return new; end if;
  if tg_op = 'INSERT' or (old.deleted_at is not null and new.deleted_at is null) then
    if new.currency is distinct from (select base_currency from public.budget_periods where id=new.budget_period_id)
      or new.category_id is not null then
      raise exception 'Savings require period currency and no expense category' using errcode = '23514';
    end if;
    if new.type='SAVINGS_WITHDRAWAL' and not new.withdrawal_confirmed then
      raise exception 'Explicit withdrawal confirmation is required' using errcode = '23514';
    end if;
    -- Identical INSERT ON CONFLICT replay has no new financial effect.
    if tg_op='INSERT' and exists(select 1 from public.transactions where id=new.id) then return new; end if;
    if new.type='SAVINGS_CONTRIBUTION' then
      state := public.get_savings_availability(new.budget_period_id);
      available := (state->>'spendable_allocated_minor')::numeric
        -(state->>'spent_minor')::numeric-(state->>'contributions_minor')::numeric
        +(state->>'withdrawals_minor')::numeric;
      if not (state->>'configured')::boolean or new.amount_minor > available then
        raise exception 'Contribution exceeds ordinary remainder before commitments' using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;
-- prepare_transaction_write acquires/validates the open period first.
create trigger transactions_validate_savings before insert or update on public.transactions
for each row execute function public.validate_savings_movement();
revoke all on function public.validate_savings_movement() from public,anon,authenticated;

create function public.check_savings_integrity()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare period_id uuid;
begin
  -- Existing non-savings workflows need not calculate an unused savings ledger.
  -- Once movements exist, all final month prefixes are checked after replacement.
  for period_id in select distinct on(p.base_currency) p.id from public.budget_periods p
    where p.profile_id=auth.uid() and exists(select 1 from public.transactions t
      join public.budget_periods source on source.id=t.budget_period_id
      where t.owner_profile_id=auth.uid() and t.type in ('SAVINGS_CONTRIBUTION','SAVINGS_WITHDRAWAL')
        and t.deleted_at is null and source.base_currency=p.base_currency)
    order by p.base_currency,p.starts_on desc,p.id
  loop
    perform public.get_savings_availability(period_id);
  end loop;
  return null;
end;
$$;
revoke all on function public.check_savings_integrity() from public,anon,authenticated;
create constraint trigger transactions_savings_integrity after insert or update on public.transactions
  deferrable initially deferred for each row execute function public.check_savings_integrity();
create constraint trigger allocations_savings_integrity after insert or update on public.budget_allocations
  deferrable initially deferred for each row execute function public.check_savings_integrity();

create function public.register_savings_movement(
  p_transaction_id uuid,p_budget_period_id uuid,p_type text,p_amount_minor bigint,
  p_currency text,p_transaction_date date,p_withdrawal_confirmed boolean default false,
  p_description text default null
) returns public.transactions language plpgsql security invoker set search_path = '' as $$
declare result public.transactions;
begin
  if auth.uid() is null or p_transaction_id is null then
    raise exception 'Authenticated operation identity is required' using errcode='42501';
  end if;
  if p_type not in ('SAVINGS_CONTRIBUTION','SAVINGS_WITHDRAWAL') or p_type is null
    or p_withdrawal_confirmed is null or (p_type='SAVINGS_WITHDRAWAL' and not p_withdrawal_confirmed) then
    raise exception 'Valid savings type and withdrawal confirmation are required' using errcode='23514';
  end if;
  perform public.lock_personal_finance();
  select * into result from public.transactions where id=p_transaction_id;
  if not found then
    insert into public.transactions(id,owner_profile_id,budget_period_id,type,amount_minor,currency,
      transaction_date,description,withdrawal_confirmed)
    values(p_transaction_id,auth.uid(),p_budget_period_id,p_type,p_amount_minor,p_currency,
      p_transaction_date,p_description,p_withdrawal_confirmed) on conflict(id) do nothing;
    select * into result from public.transactions where id=p_transaction_id;
    -- Validate before returning, not only at transaction commit.
    perform public.get_savings_availability(p_budget_period_id);
  end if;
  if result.id is null or result.owner_profile_id is distinct from auth.uid()
    or result.budget_period_id is distinct from p_budget_period_id or result.type is distinct from p_type
    or result.amount_minor is distinct from p_amount_minor or result.currency is distinct from p_currency
    or result.transaction_date is distinct from p_transaction_date or result.description is distinct from p_description
    or result.withdrawal_confirmed is distinct from p_withdrawal_confirmed
    or result.category_id is not null or result.deleted_at is not null then
    raise exception 'Operation identity conflicts with an existing registration' using errcode='23505';
  end if;
  return result;
end;
$$;
revoke all on function public.register_savings_movement(uuid,uuid,text,bigint,text,date,boolean,text) from public,anon,authenticated;
grant execute on function public.register_savings_movement(uuid,uuid,text,bigint,text,date,boolean,text) to authenticated;

-- Preserve lock order before existing period-level validation.
create or replace function public.save_budget_allocations(p_budget_period_id uuid, p_allocations jsonb)
returns setof public.budget_allocations
language plpgsql
security invoker
set search_path = ''
as $$
declare
  period_id uuid;
  input_count integer;
begin
  perform public.lock_personal_finance();
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

-- Preserve lock order before existing period-level validation.
create or replace function public.save_initial_budget(
  p_starts_on date, p_base_currency text, p_expected_income_minor bigint default null, p_allocations jsonb default null
)
returns public.budget_periods
language plpgsql security invoker set search_path = '' as $$
declare period public.budget_periods;
begin
  perform public.lock_personal_finance();
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
