-- ADR-077: explicit net remainder, not income or a second savings allocation.
-- These records are append-only to clients. Internal writes are one atomic action.
create table public.budget_period_dispositions (
  id uuid primary key,
  owner_profile_id uuid not null,
  source_period_id uuid not null,
  closure_id uuid not null unique references public.budget_period_closures(id) on delete restrict deferrable initially deferred,
  action text not null check(action in ('SAVINGS','CARRY_BUCKET','CARRY_UNALLOCATED')),
  amount_minor bigint not null check(amount_minor between 1 and 9007199254740991),
  currency text not null check(currency ~ '^[A-Z]{3}$'),
  destination_period_id uuid,
  destination_bucket_id uuid references public.budget_buckets(id) on delete restrict,
  destination_bucket_name text,
  savings_transaction_id uuid references public.transactions(id) on delete restrict,
  request_payload jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key(source_period_id,owner_profile_id) references public.budget_periods(id,profile_id) on delete restrict,
  foreign key(destination_period_id,owner_profile_id) references public.budget_periods(id,profile_id) on delete restrict,
  check((action='SAVINGS' and destination_period_id is null and destination_bucket_id is null and savings_transaction_id is not null)
    or (action='CARRY_BUCKET' and destination_period_id is not null and destination_bucket_id is not null and savings_transaction_id is null)
    or (action='CARRY_UNALLOCATED' and destination_period_id is not null and destination_bucket_id is null and savings_transaction_id is null)),
  check(source_period_id is distinct from destination_period_id)
);
create index budget_period_dispositions_source_idx on public.budget_period_dispositions(source_period_id);
create index budget_period_dispositions_destination_idx on public.budget_period_dispositions(destination_period_id);
create table public.budget_period_carry_reversals (
  id uuid primary key,
  owner_profile_id uuid not null references public.profiles(id) on delete restrict,
  disposition_id uuid not null unique references public.budget_period_dispositions(id) on delete restrict,
  reopening_id uuid not null unique references public.budget_period_reopenings(id) on delete restrict deferrable initially deferred,
  request_payload jsonb not null,
  reversed_at timestamptz not null default clock_timestamp()
);
alter table public.budget_period_dispositions enable row level security;
alter table public.budget_period_carry_reversals enable row level security;
revoke all on public.budget_period_dispositions,public.budget_period_carry_reversals from public,anon,authenticated;
grant select on public.budget_period_dispositions,public.budget_period_carry_reversals to authenticated;
create policy budget_period_dispositions_select_own on public.budget_period_dispositions
  for select to authenticated using(owner_profile_id=(select auth.uid()));
create policy budget_period_carry_reversals_select_own on public.budget_period_carry_reversals
  for select to authenticated using(owner_profile_id=(select auth.uid()));

-- v1 evidence is never rewritten. Every new dashboard/close uses v2 carry fields.
alter table public.budget_period_closures drop constraint budget_period_closures_snapshot_version_check;
alter table public.budget_period_closures add constraint budget_period_closures_snapshot_version_check check(snapshot_version in (1,2));
alter table public.budget_period_closures alter column snapshot_version set default 2;

create function public.get_personal_carry(p_budget_period_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_period public.budget_periods; v_in numeric; v_out numeric; v_unallocated numeric; v_buckets jsonb;
begin
  select * into v_period from public.budget_periods where id=p_budget_period_id and profile_id=auth.uid();
  if not found then raise exception 'An owned budget period is required' using errcode='42501'; end if;
  if exists(select 1 from public.budget_period_dispositions d
    join public.budget_periods s on s.id=d.source_period_id
    join public.budget_periods t on t.id=d.destination_period_id
    left join public.budget_buckets b on b.id=d.destination_bucket_id
    where d.owner_profile_id=auth.uid() and (d.source_period_id=v_period.id or d.destination_period_id=v_period.id)
      and d.action<>'SAVINGS' and not exists(select 1 from public.budget_period_carry_reversals r where r.disposition_id=d.id)
      and (s.profile_id<>auth.uid() or t.profile_id<>auth.uid() or s.base_currency<>d.currency or t.base_currency<>d.currency
        or t.starts_on<>(s.starts_on+interval '1 month')::date
        or (d.action='CARRY_BUCKET' and (b.profile_id is distinct from auth.uid() or b.type is distinct from 'SPENDABLE')))) then
    raise exception 'Incompatible carry requires explicit correction' using errcode='23514';
  end if;
  select coalesce(sum(amount_minor) filter(where destination_period_id=v_period.id),0),
    coalesce(sum(amount_minor) filter(where source_period_id=v_period.id),0),
    coalesce(sum(amount_minor) filter(where destination_period_id=v_period.id and action='CARRY_UNALLOCATED'),0)
    into v_in,v_out,v_unallocated from public.budget_period_dispositions d
    where d.owner_profile_id=auth.uid() and d.action<>'SAVINGS'
      and not exists(select 1 from public.budget_period_carry_reversals r where r.disposition_id=d.id);
  if greatest(v_in,v_out)>9007199254740991 then raise exception 'Carry exceeds supported safe-integer range' using errcode='22003'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.budget_bucket_id),'[]'::jsonb) into v_buckets from (
    select d.destination_bucket_id as budget_bucket_id,sum(d.amount_minor) as amount_minor
    from public.budget_period_dispositions d where d.owner_profile_id=auth.uid()
      and d.destination_period_id=v_period.id and d.action='CARRY_BUCKET'
      and not exists(select 1 from public.budget_period_carry_reversals r where r.disposition_id=d.id)
    group by d.destination_bucket_id) x;
  return jsonb_build_object('incoming_minor',v_in,'outgoing_minor',v_out,'unallocated_minor',v_unallocated,'buckets',v_buckets);
end;
$$;
revoke all on function public.get_personal_carry(uuid) from public,anon,authenticated;
grant execute on function public.get_personal_carry(uuid) to authenticated;

create or replace function public.get_savings_availability(p_budget_period_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_carry jsonb; v_carry_in numeric; v_carry_out numeric;
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
  v_carry := public.get_personal_carry(target.id);
  v_carry_in := (v_carry->>'incoming_minor')::numeric;
  v_carry_out := (v_carry->>'outgoing_minor')::numeric;
  if abs(ordinary+v_carry_in-contribution+withdrawal-spent-v_carry_out) > maximum
    or ordinary+v_carry_in > maximum or ordinary+v_carry_in+withdrawal > maximum then
    raise exception 'Ordinary remainder exceeds supported safe-integer range' using errcode = '22003';
  end if;
  return pg_catalog.jsonb_build_object('snapshot_version',2,'carry',v_carry,'budget_period_id',target.id,'base_currency',target.base_currency,
    'opening_protected_minor',opening,'allocated_savings_minor',allocated,
    'contributions_minor',contribution,'withdrawals_minor',withdrawal,
    'spendable_allocated_minor',ordinary,'spent_minor',spent,'configured',plan_count>0,
    'goal_reserved_minor',reserved,'unassigned_savings_minor',reserve-reserved);
end;
$$;
revoke all on function public.get_savings_availability(uuid) from public,anon,authenticated;
grant execute on function public.get_savings_availability(uuid) to authenticated;


create or replace function public.validate_savings_movement()
returns trigger language plpgsql security invoker set search_path='' as $$
declare state jsonb; available numeric; additional numeric;
begin
  if new.type not in ('SAVINGS_CONTRIBUTION','SAVINGS_WITHDRAWAL') then return new; end if;
  if tg_op='INSERT' or (old.deleted_at is not null and new.deleted_at is null) then
    if new.currency is distinct from (select base_currency from public.budget_periods where id=new.budget_period_id)
      or new.category_id is not null then
      raise exception 'Savings require period currency and no expense category' using errcode='23514';
    end if;
    if new.type='SAVINGS_WITHDRAWAL' and not new.withdrawal_confirmed then
      raise exception 'Explicit withdrawal confirmation is required' using errcode='23514';
    end if;
    if tg_op='INSERT' and exists(select 1 from public.transactions where id=new.id) then return new; end if;
    additional := new.amount_minor;
    new.savings_validated := true;
  elsif new.deleted_at is null and (new.amount_minor is distinct from old.amount_minor
    or new.transaction_date is distinct from old.transaction_date) then
    if not old.savings_validated then
      raise exception 'Legacy savings require explicit funded restoration, not monetary editing' using errcode='23514';
    end if;
    additional := greatest(new.amount_minor-old.amount_minor,0);
  else return new;
  end if;
  if new.type='SAVINGS_CONTRIBUTION' and additional > 0 then
    state := public.get_savings_availability(new.budget_period_id);
    available := (state->>'spendable_allocated_minor')::numeric-(state->>'spent_minor')::numeric
      -(state->>'contributions_minor')::numeric+(state->>'withdrawals_minor')::numeric
      +(state#>>'{carry,incoming_minor}')::numeric-(state#>>'{carry,outgoing_minor}')::numeric;
    if not (state->>'configured')::boolean or additional > available then
      raise exception 'Contribution exceeds ordinary remainder before commitments' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;


-- ADR-073: a single STABLE call fixes one MVCC statement snapshot for both
-- existing STABLE invoker helpers, even when a concurrent financial write commits.
-- Do not replace with independent client reads or VOLATILE nested reads.
create or replace function public.get_personal_safe_to_spend(p_budget_period_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  savings jsonb;
  commitments jsonb;
  confirmed numeric;
  estimated numeric;
  margin numeric;
begin
  -- Both helpers require auth.uid() ownership and retain RLS/complete validation.
  savings := public.get_savings_availability(p_budget_period_id);
  commitments := public.get_personal_committed_money(p_budget_period_id);
  select coalesce(sum((b->>'confirmed_minor')::numeric),0),
    coalesce(sum((b->>'estimated_minor')::numeric),0)
    into confirmed,estimated from pg_catalog.jsonb_array_elements(commitments->'buckets') b;
  margin := (savings->>'spendable_allocated_minor')::numeric
    +(savings->>'withdrawals_minor')::numeric
    -(savings->>'contributions_minor')::numeric
    -(savings->>'spent_minor')::numeric-confirmed
    +(savings#>>'{carry,incoming_minor}')::numeric-(savings#>>'{carry,outgoing_minor}')::numeric;
  if abs(margin)>9007199254740991 or abs(margin-estimated)>9007199254740991 then
    raise exception 'Monthly availability exceeds supported safe-integer range' using errcode='22003';
  end if;
  return jsonb_build_object('savings',savings,'commitments',commitments);
end;
$$;
revoke all on function public.get_personal_safe_to_spend(uuid) from public,anon,authenticated;
grant execute on function public.get_personal_safe_to_spend(uuid) to authenticated;

-- One read snapshot, aggregated by bucket rather than a paginated history page.
-- A scalar JSON response avoids the Data API's row limit truncating bucket totals.
create or replace function public.get_bucket_consumption(p_budget_period_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare
  currency_code text;
  total numeric;
  bucket_rows jsonb;
begin
  select base_currency into currency_code from public.budget_periods
  where id = p_budget_period_id and profile_id = auth.uid();
  if not found then
    raise exception 'An owned budget period is required' using errcode = '42501';
  end if;
  -- Left joins intentionally retain invalid legacy expenses for explicit failure.
  -- Archived classifications are historical references, not invalid references.
  if exists (
    select 1 from public.transactions t
    left join public.categories c on c.id = t.category_id and c.profile_id = auth.uid()
    left join public.budget_buckets b on b.id = c.budget_bucket_id and b.profile_id = auth.uid()
    where t.budget_period_id = p_budget_period_id and t.owner_profile_id = auth.uid()
      and t.type = 'EXPENSE' and t.deleted_at is null
      and (t.currency <> currency_code or b.type is distinct from 'SPENDABLE')
  ) then
    raise exception 'Expense consumption requires period currency and spendable bucket mappings'
      using errcode = '23514';
  end if;
  select coalesce(sum(t.amount_minor),0) into total from public.transactions t
  where t.budget_period_id = p_budget_period_id and t.owner_profile_id = auth.uid()
    and t.type = 'EXPENSE' and t.deleted_at is null;
  if total > 9007199254740991 then
    raise exception 'Expense consumption exceeds supported safe-integer range' using errcode = '22003';
  end if;
  with spent as (
    select c.budget_bucket_id, sum(t.amount_minor) as amount_minor
    from public.transactions t join public.categories c on c.id = t.category_id
    where t.budget_period_id = p_budget_period_id and t.owner_profile_id = auth.uid()
      and t.type = 'EXPENSE' and t.deleted_at is null
    group by c.budget_bucket_id
  ), relevant as (
    select (c->>'budget_bucket_id')::uuid as budget_bucket_id from jsonb_array_elements(public.get_personal_carry(p_budget_period_id)->'buckets') c
    union
    select budget_bucket_id from spent
    union
    select a.budget_bucket_id from public.budget_allocations a
    where a.budget_period_id = p_budget_period_id and a.deleted_at is null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'budget_bucket_id', b.id, 'name', b.name, 'system_key', b.system_key,
    'spent_minor', coalesce(s.amount_minor,0)
  ) order by b.id),'[]'::jsonb) into bucket_rows
  from relevant r join public.budget_buckets b on b.id = r.budget_bucket_id
  left join spent s on s.budget_bucket_id = b.id
  where b.profile_id = auth.uid() and b.type = 'SPENDABLE';
  return jsonb_build_object('budget_period_id',p_budget_period_id,
    'base_currency',currency_code,'buckets',bucket_rows);
end;
$$;
revoke all on function public.get_bucket_consumption(uuid) from public, anon, authenticated;
grant execute on function public.get_bucket_consumption(uuid) to authenticated;

-- FIN-121: read composition only. Every financial fact and the preview share
-- the calling statement's MVCC snapshot; no client-side joining of racing reads.
create or replace function public.get_personal_dashboard(p_month date)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  period public.budget_periods;
  availability jsonb;
  consumption jsonb;
  allocation_rows jsonb;
  bucket_rows jsonb;
  upcoming_rows jsonb;
  received numeric;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode='42501';
  end if;
  if p_month is null or extract(day from p_month)<>1
    or p_month not between date '0001-01-01' and date '9999-12-01' then
    raise exception 'A valid calendar month is required' using errcode='22023';
  end if;
  select * into period from public.budget_periods
    where profile_id=auth.uid() and starts_on=p_month;
  if not found then
    return jsonb_build_object('snapshot_version',2,'owner_profile_id',auth.uid(),'month',p_month,'period',null);
  end if;
  -- These existing helpers retain all historical validation, complete aggregates,
  -- goal partitioning and uncertainty counts; an error fails the entire response.
  availability := public.get_personal_safe_to_spend(period.id);
  consumption := public.get_bucket_consumption(period.id);
  received := public.get_received_income(period.id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'budget_period_id',a.budget_period_id,'budget_bucket_id',a.budget_bucket_id,
    'percentage_basis_points',a.percentage_basis_points
  ) order by a.budget_bucket_id),'[]'::jsonb) into allocation_rows
  from public.budget_allocations a where a.budget_period_id=period.id and a.deleted_at is null;
  select coalesce(jsonb_agg(to_jsonb(b) order by b.id),'[]'::jsonb) into bucket_rows
  from public.budget_buckets b where b.profile_id=auth.uid() and (
    exists(select 1 from public.budget_allocations a where a.budget_period_id=period.id
      and a.budget_bucket_id=b.id and a.deleted_at is null)
    or exists(select 1 from pg_catalog.jsonb_array_elements(consumption->'buckets') c
      where (c->>'budget_bucket_id')::uuid=b.id));
  -- Same pending identity as ADR-071/072: ANY linked actual, including a
  -- tombstone, excludes the obligation. Archives do not erase commitments.
  select coalesce(jsonb_agg(to_jsonb(u) order by u.due_date,u.template_id),'[]'::jsonb)
    into upcoming_rows from (
      select r.id as template_id,r.name,r.amount_mode,r.default_amount_minor,r.currency,
        (p_month+least(r.due_day,extract(day from period.ends_on)::integer)-1) as due_date
      from public.recurring_expenses r where r.owner_profile_id=auth.uid()
        and r.active_from<=p_month and (r.active_until is null or r.active_until>=p_month)
        and (r.stopped_from is null or r.stopped_from>p_month)
        and not exists(select 1 from public.transactions t where t.owner_profile_id=auth.uid()
          and t.recurring_template_id=r.id and t.recurring_month=p_month)
      order by due_date,r.id limit 5
    ) u;
  return jsonb_build_object('snapshot_version',2,'owner_profile_id',auth.uid(),'month',p_month,
    'period',to_jsonb(period),'received_income_minor',received,'availability',availability,
    'consumption',consumption,'allocations',allocation_rows,'buckets',bucket_rows,
    'upcoming',upcoming_rows);
end;
$$;
revoke all on function public.get_personal_dashboard(date) from public,anon,authenticated;
grant execute on function public.get_personal_dashboard(date) to authenticated;

create or replace function public.reopen_personal_budget_period(
  p_id uuid,p_budget_period_id uuid,p_expected_lifecycle_version bigint,
  p_closed_state_hash text,p_confirmed boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_period public.budget_periods;
  v_existing public.budget_period_reopenings;
  v_context jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication is required' using errcode='42501'; end if;
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'Period lifecycle writes require READ COMMITTED' using errcode='25001';
  end if;
  if p_id is null or p_budget_period_id is null or p_expected_lifecycle_version is null
    or p_expected_lifecycle_version not between 0 and 9007199254740990
    or p_closed_state_hash is null or p_closed_state_hash !~ '^[a-f0-9]{32}$'
    or p_confirmed is distinct from true then
    raise exception 'A complete explicitly confirmed reopen request is required' using errcode='22023';
  end if;
  perform public.lock_personal_finance();
  select * into v_existing from public.budget_period_reopenings where id=p_id and owner_profile_id=auth.uid();
  if found then
    if v_existing.budget_period_id<>p_budget_period_id
      or v_existing.expected_lifecycle_version<>p_expected_lifecycle_version
      or v_existing.closed_state_hash<>p_closed_state_hash then
      raise exception 'Reopen request identity conflicts' using errcode='23505';
    end if;
    return to_jsonb(v_existing);
  end if;
  select * into v_period from public.budget_periods
    where id=p_budget_period_id and profile_id=auth.uid() for update;
  if not found then raise exception 'An owned budget period is required' using errcode='42501'; end if;
  if v_period.status<>'CLOSED' or v_period.lifecycle_version<>p_expected_lifecycle_version then
    raise exception 'Period lifecycle changed; review again' using errcode='40001';
  end if;
  if exists(select 1 from public.budget_period_dispositions d where d.source_period_id=v_period.id
    and d.owner_profile_id=auth.uid() and d.action<>'SAVINGS'
    and not exists(select 1 from public.budget_period_carry_reversals r where r.disposition_id=d.id)) then
    raise exception 'Reverse active carry and reopen explicitly; source funds cannot be reused' using errcode='23514';
  end if;
  v_context := public.get_personal_period_close_context(v_period.starts_on);
  if v_context->>'reopen_hash' is distinct from p_closed_state_hash then
    raise exception 'Reopen preview changed; review again' using errcode='40001';
  end if;
  insert into public.budget_period_reopenings(id,owner_profile_id,budget_period_id,closure_id,
    expected_lifecycle_version,lifecycle_version,closed_state_hash,previous_closed_at,reopened_at)
  values(p_id,auth.uid(),v_period.id,(v_context#>>'{closure,id}')::uuid,
    p_expected_lifecycle_version,p_expected_lifecycle_version+1,p_closed_state_hash,v_period.closed_at,clock_timestamp())
  returning * into v_existing;
  update public.budget_periods set status='OPEN',closed_at=null,lifecycle_version=p_expected_lifecycle_version+1
    where id=v_period.id and profile_id=auth.uid();
  return to_jsonb(v_existing);
end;
$$;
revoke all on function public.reopen_personal_budget_period(uuid,uuid,bigint,text,boolean) from public,anon,authenticated;
grant execute on function public.reopen_personal_budget_period(uuid,uuid,bigint,text,boolean) to authenticated;

create or replace function public.get_personal_period_close_context(p_month date)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  v_period public.budget_periods;
  v_close public.budget_period_closures;
  v_timezone text;
  v_current_month date;
  v_summary jsonb;
  v_pending numeric;
  v_prior numeric;
  v_history jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication is required' using errcode='42501'; end if;
  if p_month is null or extract(day from p_month)<>1
    or p_month not between date '0001-01-01' and date '9999-12-01' then
    raise exception 'A valid calendar month is required' using errcode='22023';
  end if;
  select timezone into v_timezone from public.profiles where id=auth.uid();
  if v_timezone is null then raise exception 'An owned profile is required' using errcode='42501'; end if;
  v_current_month := date_trunc('month',statement_timestamp() at time zone v_timezone)::date;
  select * into v_period from public.budget_periods where profile_id=auth.uid() and starts_on=p_month;
  if not found then
    return jsonb_build_object('owner_profile_id',auth.uid(),'month',p_month,'period',null,
      'financial_month',v_current_month,'financial_timezone',v_timezone);
  end if;
  select jsonb_build_object(
    'closures',coalesce((select jsonb_agg(to_jsonb(c) order by c.lifecycle_version)
      from public.budget_period_closures c where c.budget_period_id=v_period.id and c.owner_profile_id=auth.uid()),'[]'::jsonb),
    'dispositions',coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at,d.id)
      from public.budget_period_dispositions d where d.source_period_id=v_period.id and d.owner_profile_id=auth.uid()),'[]'::jsonb),
    'reversals',coalesce((select jsonb_agg(to_jsonb(r) order by r.reversed_at,r.id)
      from public.budget_period_carry_reversals r where r.owner_profile_id=auth.uid() and exists(
        select 1 from public.budget_period_dispositions d where d.id=r.disposition_id and d.source_period_id=v_period.id)),'[]'::jsonb),
    'reopenings',coalesce((select jsonb_agg(to_jsonb(r) order by r.lifecycle_version)
      from public.budget_period_reopenings r where r.budget_period_id=v_period.id and r.owner_profile_id=auth.uid()),'[]'::jsonb)) into v_history;
  if v_period.status='CLOSED' then
    select * into v_close from public.budget_period_closures
      where owner_profile_id=auth.uid() and budget_period_id=v_period.id and lifecycle_version=v_period.lifecycle_version;
    -- Never silently recompute historical evidence, including legacy closed rows.
    return jsonb_build_object('owner_profile_id',auth.uid(),'month',p_month,'period',to_jsonb(v_period),
      'financial_month',v_current_month,'financial_timezone',v_timezone,
      'closure',case when v_close.id is null then null else to_jsonb(v_close) end,
      'summary',v_close.summary,'snapshot_hash',v_close.snapshot_hash,'can_close',false,
      'history',v_history,'reopen_hash',md5(jsonb_build_object('period_id',v_period.id,
        'owner',v_period.profile_id,'status',v_period.status,'version',v_period.lifecycle_version,
        'closed_at',v_period.closed_at,'closure_id',v_close.id)::text));
  end if;
  v_summary := public.get_personal_dashboard(p_month);
  select coalesce(sum((b->>'confirmed_count')::numeric+(b->>'estimated_count')::numeric+(b->>'unknown_count')::numeric),0)
    into v_pending from jsonb_array_elements(v_summary->'availability'->'commitments'->'buckets') b;
  v_prior := (v_summary->'availability'->'commitments'->>'prior_unresolved_count')::numeric;
  return jsonb_build_object('owner_profile_id',auth.uid(),'month',p_month,'period',to_jsonb(v_period),
    'financial_month',v_current_month,'financial_timezone',v_timezone,'closure',null,'summary',v_summary,
    'snapshot_hash',md5(jsonb_build_object('summary',v_summary,'timezone',v_timezone)::text),
    'can_close',p_month<v_current_month and v_pending=0 and v_prior=0,'history',v_history,'reopen_hash',null);
end;
$$;


-- The close summary is historical when CLOSED; only an OPEN source can dispose.
-- Destination metadata is not a spendable balance. Reversal has a separate live read.
create function public.get_personal_remainder_context(p_month date)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_close jsonb; v_destination public.budget_periods; v_result jsonb; v_buckets jsonb; v_dispositions jsonb; v_reversals jsonb; v_configured boolean;
begin
  v_close := public.get_personal_period_close_context(p_month);
  if v_close->'period'='null'::jsonb then return jsonb_build_object('close',v_close); end if;
  if p_month<date '9999-12-01' then
    select * into v_destination from public.budget_periods where profile_id=auth.uid()
      and starts_on=(p_month+interval '1 month')::date;
  end if;
  select count(*)>0 and coalesce(sum(percentage_basis_points),0)=10000 into v_configured
    from public.budget_allocations where budget_period_id=v_destination.id and deleted_at is null;
  select coalesce(jsonb_agg(to_jsonb(b) order by b.id),'[]'::jsonb) into v_buckets
    from public.budget_buckets b where b.profile_id=auth.uid() and b.type='SPENDABLE' and b.archived_at is null;
  select coalesce(jsonb_agg(to_jsonb(d) order by d.created_at,d.id),'[]'::jsonb) into v_dispositions
    from public.budget_period_dispositions d where d.owner_profile_id=auth.uid() and d.source_period_id=(v_close#>>'{period,id}')::uuid;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.reversed_at,r.id),'[]'::jsonb) into v_reversals
    from public.budget_period_carry_reversals r where r.owner_profile_id=auth.uid()
      and exists(select 1 from public.budget_period_dispositions d where d.id=r.disposition_id and d.source_period_id=(v_close#>>'{period,id}')::uuid);
  v_result := jsonb_build_object('close',v_close,'destination',case when v_destination.id is null then null else to_jsonb(v_destination) end,
    'destination_configured',v_configured,'destination_buckets',v_buckets,'dispositions',v_dispositions,'reversals',v_reversals);
  return v_result||jsonb_build_object('preview_hash',md5(v_result::text));
end;
$$;
revoke all on function public.get_personal_remainder_context(date) from public,anon,authenticated;
grant execute on function public.get_personal_remainder_context(date) to authenticated;

create function public.close_and_dispose_personal_remainder(
  p_id uuid,p_budget_period_id uuid,p_expected_lifecycle_version bigint,p_preview_hash text,
  p_action text,p_amount_minor bigint,p_destination_period_id uuid default null,p_destination_bucket_id uuid default null,p_confirmed boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_source public.budget_periods; v_destination public.budget_periods; v_existing public.budget_period_dispositions;
  v_payload jsonb; v_context jsonb; v_savings jsonb; v_cap numeric; v_closure jsonb; v_bucket public.budget_buckets;
begin
  if auth.uid() is null then raise exception 'Authentication is required' using errcode='42501'; end if;
  if current_setting('transaction_isolation')<>'read committed' then raise exception 'Remainder writes require READ COMMITTED' using errcode='25001'; end if;
  if p_id is null or p_budget_period_id is null or p_expected_lifecycle_version is null
    or p_expected_lifecycle_version not between 0 and 9007199254740990 or p_preview_hash is null or p_preview_hash !~ '^[a-f0-9]{32}$'
    or p_action is null or p_action not in ('SAVINGS','CARRY_BUCKET','CARRY_UNALLOCATED')
    or p_amount_minor is null or p_amount_minor not between 1 and 9007199254740991 or p_confirmed is distinct from true
    or (p_action='SAVINGS' and (p_destination_period_id is not null or p_destination_bucket_id is not null))
    or (p_action='CARRY_BUCKET' and (p_destination_period_id is null or p_destination_bucket_id is null))
    or (p_action='CARRY_UNALLOCATED' and (p_destination_period_id is null or p_destination_bucket_id is not null)) then
    raise exception 'A complete explicitly confirmed remainder request is required' using errcode='22023';
  end if;
  v_payload := jsonb_build_object('period_id',p_budget_period_id,'version',p_expected_lifecycle_version,'preview_hash',p_preview_hash,
    'action',p_action,'amount_minor',p_amount_minor,'destination_period_id',p_destination_period_id,'destination_bucket_id',p_destination_bucket_id);
  perform public.lock_personal_finance();
  select * into v_existing from public.budget_period_dispositions where id=p_id and owner_profile_id=auth.uid();
  if found then
    if v_existing.request_payload is distinct from v_payload then raise exception 'Disposition request identity conflicts' using errcode='23505'; end if;
    return jsonb_build_object('disposition',to_jsonb(v_existing),'closure',(select to_jsonb(c) from public.budget_period_closures c where c.id=v_existing.closure_id and c.owner_profile_id=auth.uid()));
  end if;
  select * into v_source from public.budget_periods where id=p_budget_period_id and profile_id=auth.uid() for update;
  if not found then raise exception 'An owned source period is required' using errcode='42501'; end if;
  if v_source.status<>'OPEN' or v_source.lifecycle_version<>p_expected_lifecycle_version then raise exception 'Period lifecycle changed; review again' using errcode='40001'; end if;
  v_context := public.get_personal_remainder_context(v_source.starts_on);
  if v_context->>'preview_hash' is distinct from p_preview_hash then raise exception 'Remainder preview changed; review again' using errcode='40001'; end if;
  v_savings := v_context#>'{close,summary,availability,savings}';
  if (v_context#>>'{close,can_close}')::boolean is distinct from true or (v_savings->>'configured')::boolean is distinct from true then
    raise exception 'A completed configured month without unresolved obligations is required' using errcode='23514';
  end if;
  v_cap := (v_savings->>'spendable_allocated_minor')::numeric+(v_savings->>'withdrawals_minor')::numeric
    -(v_savings->>'contributions_minor')::numeric-(v_savings->>'spent_minor')::numeric
    +(v_savings#>>'{carry,incoming_minor}')::numeric-(v_savings#>>'{carry,outgoing_minor}')::numeric;
  if p_amount_minor>v_cap then raise exception 'Disposition exceeds net ordinary remainder' using errcode='23514'; end if;
  if exists(select 1 from public.budget_period_closures where id=p_id)
    or exists(select 1 from public.transactions where id=p_id) then
    raise exception 'Disposition identity already belongs to another operation' using errcode='23505';
  end if;
  if p_action<>'SAVINGS' then
    select * into v_destination from public.budget_periods where id=p_destination_period_id and profile_id=auth.uid() for update;
    if not found then raise exception 'An owned destination period is required' using errcode='42501'; end if;
    if v_destination.status<>'OPEN' or v_destination.base_currency<>v_source.base_currency
      or v_source.starts_on>=date '9999-12-01' or v_destination.starts_on<>(v_source.starts_on+interval '1 month')::date
      or not exists(select 1 from public.budget_allocations where budget_period_id=v_destination.id and deleted_at is null)
      or (select sum(percentage_basis_points) from public.budget_allocations where budget_period_id=v_destination.id and deleted_at is null)<>10000 then
      raise exception 'Carry requires the next open configured same-currency month' using errcode='23514';
    end if;
    if p_action='CARRY_BUCKET' then
      select * into v_bucket from public.budget_buckets where id=p_destination_bucket_id and profile_id=auth.uid() for share;
      if not found or v_bucket.type<>'SPENDABLE' or v_bucket.archived_at is not null then
        raise exception 'An active owned spendable destination bucket is required' using errcode='23514';
      end if;
    end if;
  else
    -- Actual financial date is explicitly reviewed as source month end. This is
    -- conceptual earmarking, never a bank payment backdated into another month.
    perform public.register_savings_movement(p_id,v_source.id,'SAVINGS_CONTRIBUTION',p_amount_minor,
      v_source.base_currency,v_source.ends_on,false,'Remanente al cierre',null);
  end if;
  set constraints public.budget_period_dispositions_closure_id_fkey deferred;
  insert into public.budget_period_dispositions(id,owner_profile_id,source_period_id,closure_id,action,amount_minor,currency,
    destination_period_id,destination_bucket_id,destination_bucket_name,savings_transaction_id,request_payload)
    values(p_id,auth.uid(),v_source.id,p_id,p_action,p_amount_minor,v_source.base_currency,
      p_destination_period_id,p_destination_bucket_id,v_bucket.name,case when p_action='SAVINGS' then p_id else null end,v_payload)
    returning * into v_existing;
  -- A separate POST-action fingerprint is used for the child close. The reviewed
  -- PRE-action hash was already checked; it can never authorize a changed summary.
  v_context := public.get_personal_period_close_context(v_source.starts_on);
  v_closure := public.close_personal_budget_period(p_id,v_source.id,p_expected_lifecycle_version,v_context->>'snapshot_hash',true);
  if p_action<>'SAVINGS' then perform public.get_savings_availability(v_destination.id); end if;
  set constraints public.budget_period_dispositions_closure_id_fkey immediate;
  return jsonb_build_object('disposition',to_jsonb(v_existing),'closure',v_closure);
end;
$$;
revoke all on function public.close_and_dispose_personal_remainder(uuid,uuid,bigint,text,text,bigint,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.close_and_dispose_personal_remainder(uuid,uuid,bigint,text,text,bigint,uuid,uuid,boolean) to authenticated;

create function public.get_personal_carry_reversal_context(p_disposition_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_disposition public.budget_period_dispositions; v_source jsonb; v_destination jsonb; v_savings jsonb;
  v_result jsonb; v_pending numeric; v_cap numeric; v_reversed boolean;
begin
  if auth.uid() is null then raise exception 'Authentication is required' using errcode='42501'; end if;
  select * into v_disposition from public.budget_period_dispositions where id=p_disposition_id and owner_profile_id=auth.uid();
  if not found then raise exception 'An owned disposition is required' using errcode='42501'; end if;
  if v_disposition.action='SAVINGS' then raise exception 'Savings uses ordinary audited corrections after reopening' using errcode='23514'; end if;
  v_source := public.get_personal_period_close_context((select starts_on from public.budget_periods where id=v_disposition.source_period_id and profile_id=auth.uid()));
  v_destination := public.get_personal_dashboard((select starts_on from public.budget_periods where id=v_disposition.destination_period_id and profile_id=auth.uid()));
  v_savings := v_destination#>'{availability,savings}';
  v_cap := (v_savings->>'spendable_allocated_minor')::numeric+(v_savings->>'withdrawals_minor')::numeric
    -(v_savings->>'contributions_minor')::numeric-(v_savings->>'spent_minor')::numeric
    +(v_savings#>>'{carry,incoming_minor}')::numeric-(v_savings#>>'{carry,outgoing_minor}')::numeric;
  select coalesce(sum((b->>'confirmed_count')::numeric+(b->>'estimated_count')::numeric+(b->>'unknown_count')::numeric),0)
    into v_pending from jsonb_array_elements(v_destination#>'{availability,commitments,buckets}') b;
  select exists(select 1 from public.budget_period_carry_reversals where disposition_id=v_disposition.id and owner_profile_id=auth.uid()) into v_reversed;
  v_result := jsonb_build_object('disposition',to_jsonb(v_disposition),'source',v_source,'destination',v_destination,
    'can_reverse',not v_reversed and v_source#>>'{period,status}'='CLOSED' and v_destination#>>'{period,status}'='OPEN'
      and (v_savings->>'configured')::boolean and v_pending=0
      and (v_destination#>>'{availability,commitments,prior_unresolved_count}')::numeric=0 and v_cap>=v_disposition.amount_minor);
  return v_result||jsonb_build_object('preview_hash',md5(v_result::text));
end;
$$;
revoke all on function public.get_personal_carry_reversal_context(uuid) from public,anon,authenticated;
grant execute on function public.get_personal_carry_reversal_context(uuid) to authenticated;

create function public.reverse_carry_and_reopen_personal_period(
  p_id uuid,p_disposition_id uuid,p_expected_source_version bigint,p_expected_destination_version bigint,p_preview_hash text,p_confirmed boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_existing public.budget_period_carry_reversals; v_disposition public.budget_period_dispositions;
  v_source public.budget_periods; v_destination public.budget_periods; v_payload jsonb; v_context jsonb; v_reopening jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication is required' using errcode='42501'; end if;
  if current_setting('transaction_isolation')<>'read committed' then raise exception 'Remainder writes require READ COMMITTED' using errcode='25001'; end if;
  if p_id is null or p_disposition_id is null or p_expected_source_version is null or p_expected_destination_version is null
    or p_expected_source_version not between 0 and 9007199254740990 or p_expected_destination_version not between 0 and 9007199254740991
    or p_preview_hash is null or p_preview_hash !~ '^[a-f0-9]{32}$' or p_confirmed is distinct from true then
    raise exception 'A complete explicitly confirmed reversal and reopening request is required' using errcode='22023';
  end if;
  v_payload := jsonb_build_object('disposition_id',p_disposition_id,'source_version',p_expected_source_version,
    'destination_version',p_expected_destination_version,'preview_hash',p_preview_hash);
  perform public.lock_personal_finance();
  select * into v_existing from public.budget_period_carry_reversals where id=p_id and owner_profile_id=auth.uid();
  if found then
    if v_existing.request_payload is distinct from v_payload then raise exception 'Reversal request identity conflicts' using errcode='23505'; end if;
    return jsonb_build_object('reversal',to_jsonb(v_existing),'reopening',(select to_jsonb(r) from public.budget_period_reopenings r where r.id=v_existing.reopening_id and r.owner_profile_id=auth.uid()));
  end if;
  select * into v_disposition from public.budget_period_dispositions where id=p_disposition_id and owner_profile_id=auth.uid();
  if not found then raise exception 'An owned disposition is required' using errcode='42501'; end if;
  if v_disposition.action='SAVINGS' then raise exception 'Savings uses ordinary audited corrections after reopening' using errcode='23514'; end if;
  select * into v_source from public.budget_periods where id=v_disposition.source_period_id and profile_id=auth.uid() for update;
  select * into v_destination from public.budget_periods where id=v_disposition.destination_period_id and profile_id=auth.uid() for update;
  if v_source.lifecycle_version<>p_expected_source_version or v_destination.lifecycle_version<>p_expected_destination_version then
    raise exception 'Period lifecycle changed; review again' using errcode='40001';
  end if;
  v_context := public.get_personal_carry_reversal_context(v_disposition.id);
  if v_context->>'preview_hash' is distinct from p_preview_hash then raise exception 'Reversal preview changed; review again' using errcode='40001'; end if;
  if (v_context->>'can_reverse')::boolean is distinct from true then
    raise exception 'Reversal needs a closed source and open configured destination with sufficient net funds and no unresolved obligations' using errcode='23514';
  end if;
  if exists(select 1 from public.budget_period_reopenings where id=p_id) then raise exception 'Reversal identity already belongs to another operation' using errcode='23505'; end if;
  set constraints public.budget_period_carry_reversals_reopening_id_fkey deferred;
  insert into public.budget_period_carry_reversals(id,owner_profile_id,disposition_id,reopening_id,request_payload)
    values(p_id,auth.uid(),v_disposition.id,p_id,v_payload) returning * into v_existing;
  -- Removing the carry first makes the ordinary reopen guard pass, inside the
  -- SAME transaction. Failure of either effect rolls both back.
  v_reopening := public.reopen_personal_budget_period(p_id,v_source.id,p_expected_source_version,v_context#>>'{source,reopen_hash}',true);
  perform public.get_savings_availability(v_destination.id);
  set constraints public.budget_period_carry_reversals_reopening_id_fkey immediate;
  return jsonb_build_object('reversal',to_jsonb(v_existing),'reopening',v_reopening);
end;
$$;
revoke all on function public.reverse_carry_and_reopen_personal_period(uuid,uuid,bigint,bigint,text,boolean) from public,anon,authenticated;
grant execute on function public.reverse_carry_and_reopen_personal_period(uuid,uuid,bigint,bigint,text,boolean) to authenticated;
