-- ADR-069: a goal is a private objective; its funding is a subset of protected savings.
create table public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references public.profiles(id) on delete restrict,
  scope text not null default 'PERSONAL' check (scope = 'PERSONAL'),
  name text not null check (name = btrim(name) and char_length(name) between 1 and 120),
  target_amount_minor bigint not null check (target_amount_minor between 1 and 9007199254740991),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  target_date date check (target_date between date '0001-01-01' and date '9999-12-31'),
  created_at timestamptz not null default statement_timestamp(),
  unique(id, owner_profile_id)
);
create index savings_goals_owner_idx on public.savings_goals(owner_profile_id, created_at, id);
alter table public.savings_goals enable row level security;
revoke all on public.savings_goals from public, anon, authenticated;
grant select on public.savings_goals to authenticated;
grant insert(id, owner_profile_id, name, target_amount_minor, currency, target_date)
  on public.savings_goals to authenticated;
create policy savings_goals_select_own on public.savings_goals for select to authenticated
  using (owner_profile_id = (select auth.uid()));
create policy savings_goals_insert_own on public.savings_goals for insert to authenticated
  with check (owner_profile_id = (select auth.uid()));
create trigger savings_goals_lock_owner before insert on public.savings_goals
  for each statement execute function public.lock_personal_finance_write();

alter table public.transactions add column savings_goal_id uuid;
alter table public.transactions add constraint transactions_goal_owner_fkey
  foreign key (savings_goal_id, owner_profile_id) references public.savings_goals(id, owner_profile_id) on delete restrict;
alter table public.transactions add constraint transactions_goal_savings_only
  check (savings_goal_id is null or type in ('SAVINGS_CONTRIBUTION','SAVINGS_WITHDRAWAL'));
create index transactions_goal_idx on public.transactions(savings_goal_id, transaction_date, id);
grant insert(savings_goal_id) on public.transactions to authenticated;
create function public.validate_savings_goal_movement()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.savings_goal_id is not null and (tg_op='INSERT' or (old.deleted_at is not null and new.deleted_at is null)) then
    if not exists(select 1 from public.savings_goals where id=new.savings_goal_id
      and owner_profile_id=auth.uid() and owner_profile_id=new.owner_profile_id and currency=new.currency) then
      raise exception 'An owned same-currency savings goal is required' using errcode='42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.validate_savings_goal_movement() from public, anon, authenticated;
create trigger transactions_validate_savings_goal before insert or update on public.transactions
  for each row execute function public.validate_savings_goal_movement();

create function public.create_personal_savings_goal(
  p_goal_id uuid, p_name text, p_target_amount_minor bigint, p_currency text, p_target_date date default null
) returns public.savings_goals language plpgsql security invoker set search_path = '' as $$
declare result public.savings_goals;
begin
  if auth.uid() is null or p_goal_id is null then
    raise exception 'Authenticated goal identity is required' using errcode='42501';
  end if;
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Goal creation requires READ COMMITTED isolation' using errcode='0A000';
  end if;
  perform public.lock_personal_finance();
  select * into result from public.savings_goals where id=p_goal_id;
  if not found then
    insert into public.savings_goals(id,owner_profile_id,name,target_amount_minor,currency,target_date)
      values(p_goal_id,auth.uid(),p_name,p_target_amount_minor,p_currency,p_target_date)
      on conflict(id) do nothing;
    select * into result from public.savings_goals where id=p_goal_id;
  end if;
  if result.id is null or result.owner_profile_id is distinct from auth.uid()
    or result.name is distinct from p_name or result.target_amount_minor is distinct from p_target_amount_minor
    or result.currency is distinct from p_currency or result.target_date is distinct from p_target_date then
    raise exception 'Goal identity conflicts with an existing registration' using errcode='23505';
  end if;
  return result;
end;
$$;
revoke all on function public.create_personal_savings_goal(uuid,text,bigint,text,date) from public, anon, authenticated;
grant execute on function public.create_personal_savings_goal(uuid,text,bigint,text,date) to authenticated;

create or replace function public.get_savings_availability(p_budget_period_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  target public.budget_periods;
  period public.budget_periods;
  income numeric; contribution numeric; withdrawal numeric;
  allocated numeric; ordinary numeric; spent numeric := 0;
  reserve numeric := 0; opening numeric := 0; reserved numeric := 0; minimum_goal numeric := 0;
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
        or (type = 'SAVINGS_WITHDRAWAL' and not withdrawal_confirmed)
        or (type <> 'INCOME' and not savings_validated))) then
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
    -- Every goal is an explicitly funded sub-reserve. General withdrawals cannot
    -- consume it, and a goal cannot borrow from another goal or a future month.
    select coalesce(sum(balance),0),coalesce(min(balance),0) into reserved,minimum_goal from (
      select sum(case when t.type='SAVINGS_CONTRIBUTION' then t.amount_minor::numeric else -t.amount_minor::numeric end) balance
      from public.transactions t join public.budget_periods p on p.id=t.budget_period_id
      where t.owner_profile_id=auth.uid() and t.savings_goal_id is not null
        and t.deleted_at is null and p.base_currency=target.base_currency and p.starts_on<=period.starts_on
      group by t.savings_goal_id
    ) goals;
    if minimum_goal < 0 or reserve < reserved then
      raise exception 'Withdrawal or correction exceeds goal or unassigned savings availability' using errcode='23514';
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
    'spendable_allocated_minor',ordinary,'spent_minor',spent,'configured',plan_count>0,
    'goal_reserved_minor',reserved,'unassigned_savings_minor',reserve-reserved);
end;
$$;
revoke all on function public.get_savings_availability(uuid) from public,anon,authenticated;
grant execute on function public.get_savings_availability(uuid) to authenticated;

drop function public.register_savings_movement(uuid,uuid,text,bigint,text,date,boolean,text);
create function public.register_savings_movement(
  p_transaction_id uuid,p_budget_period_id uuid,p_type text,p_amount_minor bigint,
  p_currency text,p_transaction_date date,p_withdrawal_confirmed boolean default false,
  p_description text default null,p_savings_goal_id uuid default null
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
      transaction_date,description,withdrawal_confirmed,savings_goal_id)
    values(p_transaction_id,auth.uid(),p_budget_period_id,p_type,p_amount_minor,p_currency,
      p_transaction_date,p_description,p_withdrawal_confirmed,p_savings_goal_id) on conflict(id) do nothing;
    select * into result from public.transactions where id=p_transaction_id;
    -- Validate before returning, not only at transaction commit.
    perform public.get_savings_availability(p_budget_period_id);
  end if;
  if result.id is null or result.owner_profile_id is distinct from auth.uid()
    or result.budget_period_id is distinct from p_budget_period_id or result.type is distinct from p_type
    or result.amount_minor is distinct from p_amount_minor or result.currency is distinct from p_currency
    or result.transaction_date is distinct from p_transaction_date or result.description is distinct from p_description
    or result.withdrawal_confirmed is distinct from p_withdrawal_confirmed
    or result.savings_goal_id is distinct from p_savings_goal_id
    or result.category_id is not null or result.deleted_at is not null or not result.savings_validated then
    raise exception 'Operation identity conflicts with an existing registration' using errcode='23505';
  end if;
  return result;
end;
$$;
revoke all on function public.register_savings_movement(uuid,uuid,text,bigint,text,date,boolean,text,uuid) from public,anon,authenticated;
grant execute on function public.register_savings_movement(uuid,uuid,text,bigint,text,date,boolean,text,uuid) to authenticated;

create function public.get_personal_savings_goals(p_through_month date)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare period_id uuid; result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication is required' using errcode='42501'; end if;
  if p_through_month is null or extract(day from p_through_month) <> 1
    or p_through_month not between date '0001-01-01' and date '9999-12-01' then
    raise exception 'A valid calendar month is required' using errcode='22023';
  end if;
  -- Verify the same authoritative reserve before presenting any funded progress.
  for period_id in select distinct on(base_currency) id from public.budget_periods
    where profile_id=auth.uid() and starts_on<=p_through_month
    order by base_currency,starts_on desc,id
  loop
    perform public.get_savings_availability(period_id);
  end loop;
  select coalesce(jsonb_agg(to_jsonb(g) || jsonb_build_object('balance_minor',coalesce(m.balance,0))
    order by g.created_at,g.id),'[]'::jsonb) into result
  from public.savings_goals g left join lateral (
    select sum(case when t.type='SAVINGS_CONTRIBUTION' then t.amount_minor::numeric else -t.amount_minor::numeric end) balance
    from public.transactions t join public.budget_periods p on p.id=t.budget_period_id
    where t.savings_goal_id=g.id and t.deleted_at is null and p.starts_on<=p_through_month
  ) m on true where g.owner_profile_id=auth.uid();
  return jsonb_build_object('owner_profile_id',auth.uid(),'through_month',p_through_month,'goals',result);
end;
$$;
revoke all on function public.get_personal_savings_goals(date) from public,anon,authenticated;
grant execute on function public.get_personal_savings_goals(date) to authenticated;
