-- FIN-210: the actor selects one shared classification for every responsibility.
-- Null is retained only for pre-FIN-210 history, never inferred from text or a private category.
alter table public.shared_expenses add column budget_classification text
  check (budget_classification in ('NEEDS','LEISURE'));

create or replace function public.get_shared_expense(p_household_id uuid,p_expense_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Household expense access required' using errcode='42501'; end if;
  select jsonb_build_object(
    'profile_id',auth.uid(),'expense_id',e.id,'transaction_id',t.id,'household_id',e.household_id,
    'created_by',t.created_by,'payer_member_id',e.payer_member_id,
    'template_id',e.template_id,'template_version',e.template_version,
    'amount_minor',t.amount_minor,'currency',t.currency,'transaction_date',t.transaction_date,
    'description',t.description,'budget_classification',e.budget_classification,
    'splits',(select jsonb_agg(jsonb_build_object('member_id',s.member_id,
      'basis_points',s.basis_points,'responsibility_amount_minor',s.responsibility_amount_minor)
      order by s.member_id) from public.shared_expense_splits s where s.shared_expense_id=e.id)
  ) into result from public.shared_expenses e join public.transactions t on t.id=e.transaction_id
  where e.id=p_expense_id and e.household_id=p_household_id
    and exists(select 1 from public.household_members m where m.household_id=e.household_id
      and m.profile_id=auth.uid() and m.left_at is null);
  if result is null then raise exception 'Household expense access required' using errcode='42501'; end if;
  return result;
end;
$$;

-- Replace the old signature, rather than keeping an ambiguous PostgREST overload.
-- Omitted classification still permits exact legacy replay, never a new write.
drop function public.create_shared_expense(uuid,uuid,uuid,uuid,integer,uuid[],bigint,text,date,text);
create or replace function public.create_shared_expense(
  p_request_id uuid,p_household_id uuid,p_payer_member_id uuid,
  p_template_id uuid,p_template_version integer,p_roster uuid[],
  p_amount_minor bigint,p_currency text,p_transaction_date date,p_description text default null,
  p_budget_classification text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor_id uuid:=auth.uid(); locked_profile uuid; canonical_roster uuid[]; current_roster uuid[];
  template public.household_split_revisions; existing public.shared_expenses; original public.transactions;
begin
  if actor_id is null then raise exception 'Household expense access required' using errcode='42501'; end if;
  if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
    raise exception 'Shared expense operations require READ COMMITTED' using errcode='25001'; end if;
  if p_request_id is null or p_household_id is null or p_payer_member_id is null
    or p_template_id is null or p_template_version is null or p_template_version<1
    or p_roster is null or cardinality(p_roster)=0 or array_ndims(p_roster)<>1
    or array_position(p_roster,null) is not null
    or p_amount_minor is null or p_amount_minor not between 1 and 9007199254740991
    or p_currency is null or p_currency !~ '^[A-Z]{3}$'
    or p_transaction_date is null or p_transaction_date not between date '0001-01-01' and date '9999-12-31'
    or char_length(p_description)>500
    or (p_budget_classification is not null and p_budget_classification not in ('NEEDS','LEISURE')) then
    raise exception 'Invalid shared expense request' using errcode='22023'; end if;
  select array_agg(id order by id) into canonical_roster from unnest(p_roster) id;
  if cardinality(canonical_roster)<>(select count(distinct id) from unnest(canonical_roster) id) then
    raise exception 'Shared roster identities must be unique' using errcode='22023'; end if;

  -- Refuse unrelated callers before acquiring another profile's finance lock.
  -- This is only a preliminary check; locked current authorization follows.
  if not exists(select 1 from public.household_members where household_id=p_household_id
    and profile_id=actor_id and left_at is null) then
    raise exception 'Household expense access required' using errcode='42501'; end if;
  -- Global participant-profile order precedes every household/row lock. Taking
  -- the actor first would deadlock opposing creators or overlapping households.
  -- Membership identity/profile is immutable. Revalidate the complete requested
  -- roster after the household lock so a concurrent join cannot escape locking.
  for locked_profile in
    select profile_id from public.household_members
      where household_id=p_household_id and id=any(canonical_roster)
    union select actor_id
    order by 1
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(locked_profile::text,115));
  end loop;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('household-invitations:'||p_household_id::text,0));
  perform 1 from public.households where id=p_household_id for update;
  perform 1 from public.household_members where household_id=p_household_id order by id for share;
  if not exists(select 1 from public.household_members where household_id=p_household_id
    and profile_id=actor_id and left_at is null) then
    raise exception 'Household expense access required' using errcode='42501'; end if;

  select * into existing from public.shared_expenses where id=p_request_id;
  if found then
    select * into original from public.transactions where id=existing.transaction_id;
    select * into template from public.household_split_revisions where id=existing.template_id;
    if existing.household_id<>p_household_id or original.created_by<>actor_id
      or existing.payer_member_id<>p_payer_member_id or existing.template_id<>p_template_id
      or existing.template_version<>p_template_version or template.roster<>canonical_roster
      or original.amount_minor<>p_amount_minor or original.currency<>p_currency
      or existing.budget_classification is distinct from p_budget_classification
      or original.transaction_date<>p_transaction_date or original.description is distinct from p_description then
      raise exception 'Shared expense request identity conflicts' using errcode='23505'; end if;
    -- Current actor membership is required. Original payer/template/roster need
    -- not still be current: replay confirms a receipt, never creates or rewrites.
    return public.get_shared_expense(p_household_id,p_request_id);
  end if;
  if p_budget_classification is null then
    raise exception 'New shared expenses require an explicit shared budget classification' using errcode='22023';
  end if;
  -- New entries use the current household currency. Exact historical replay above
  -- stays independent of later configuration. The household lock prevents a
  -- concurrent trusted currency change between this check and the atomic insert.
  if p_currency is distinct from (select default_currency from public.households where id=p_household_id) then
    raise exception 'New shared expenses must use the household currency' using errcode='23514';
  end if;
  select * into template from public.household_split_revisions where household_id=p_household_id
    order by version desc limit 1;
  select array_agg(id order by id) into current_roster from public.household_members
    where household_id=p_household_id and left_at is null;
  if template.id is distinct from p_template_id or template.version is distinct from p_template_version
    or template.roster is distinct from current_roster or current_roster is distinct from canonical_roster then
    raise exception 'Shared expense template or active roster changed; review before saving' using errcode='40001'; end if;
  if not exists(select 1 from public.household_members where household_id=p_household_id
    and id=p_payer_member_id and left_at is null) then
    raise exception 'An active same-household payer is required' using errcode='42501'; end if;

  insert into public.transactions(id,scope,type,household_id,created_by,amount_minor,currency,transaction_date,description)
    values(p_request_id,'HOUSEHOLD','EXPENSE',p_household_id,actor_id,p_amount_minor,p_currency,p_transaction_date,p_description);
  insert into public.shared_expenses(id,household_id,transaction_id,payer_member_id,template_id,template_version,budget_classification)
    values(p_request_id,p_household_id,p_request_id,p_payer_member_id,p_template_id,p_template_version,p_budget_classification);
  with exact as (
    select member_id,basis_points,floor(p_amount_minor::numeric*basis_points/10000) as floor_minor,
      mod(p_amount_minor::numeric*basis_points,10000) as remainder
    from public.household_split_shares where revision_id=p_template_id
  ), ranked as (
    select *,row_number() over(order by remainder desc,member_id) as rank,
      p_amount_minor-sum(floor_minor) over() as units from exact
  ) insert into public.shared_expense_splits(shared_expense_id,household_id,member_id,basis_points,responsibility_amount_minor)
    select p_request_id,p_household_id,member_id,basis_points,
      (floor_minor+case when rank<=units then 1 else 0 end)::bigint from ranked;
  return public.get_shared_expense(p_household_id,p_request_id);
end;
$$;

revoke all on function public.create_shared_expense(uuid,uuid,uuid,uuid,integer,uuid[],bigint,text,date,text,text) from public,anon,authenticated;
grant execute on function public.create_shared_expense(uuid,uuid,uuid,uuid,integer,uuid[],bigint,text,date,text,text) to authenticated;

-- Private source projection, not a household read or a derived balance ledger.
-- Historical membership identity/profile is immutable: former members retain only
-- their own already-recorded responsibility, never shared reads or current names.
-- Invoker grants cannot read the shared source tables, so this fixed definer
-- derives its only subject from auth.uid(); there is no target-owner parameter.
create function public.get_my_shared_responsibilities(p_month date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); entries jsonb; period public.budget_periods; included jsonb;
begin
  if owner_id is null then raise exception 'Authentication is required' using errcode='42501'; end if;
  if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
    raise exception 'Shared responsibility reads require READ COMMITTED' using errcode='25001'; end if;
  if p_month is null or extract(day from p_month)<>1
    or p_month not between date '0001-01-01' and date '9999-12-01' then
    raise exception 'A valid calendar month is required' using errcode='22023'; end if;
  select * into period from public.budget_periods where profile_id=owner_id and starts_on=p_month;
  if period.status='CLOSED' then
    select summary->'shared_expense_ids' into included from public.budget_period_closures
      where owner_profile_id=owner_id and budget_period_id=period.id and lifecycle_version=period.lifecycle_version;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'expense_id',e.id,'household_id',e.household_id,
    'household_name',case when m.left_at is null then h.name else null end,
    'transaction_date',t.transaction_date,'description',t.description,
    'budget_classification',e.budget_classification,
    'responsibility_amount_minor',s.responsibility_amount_minor,'currency',t.currency,
    'application_status',case
      when s.responsibility_amount_minor=0 then 'NO_IMPACT'
      when e.budget_classification is null then 'UNCLASSIFIED'
      when period.status='CLOSED' then case when coalesce(included ? e.id::text,false) then 'CLOSED_INCLUDED' else 'CLOSED_PENDING' end
      when period.id is null then 'NO_PERIOD'
      when t.currency<>period.base_currency then 'OTHER_CURRENCY'
      when not exists(select 1 from public.budget_buckets b where b.profile_id=owner_id
        and b.system_key=e.budget_classification and b.type='SPENDABLE') then 'NO_BUCKET'
      else 'APPLIED' end,
    'included_in_closed_period',case when period.status='CLOSED'
      then coalesce(included ? e.id::text,false) else null end
  ) order by t.transaction_date,e.id),'[]'::jsonb) into entries
  from public.shared_expense_splits s
  join public.household_members m on m.id=s.member_id and m.household_id=s.household_id
  join public.shared_expenses e on e.id=s.shared_expense_id and e.household_id=s.household_id
  join public.transactions t on t.id=e.transaction_id and t.household_id=e.household_id and t.scope='HOUSEHOLD'
  left join public.households h on h.id=e.household_id and m.left_at is null
  where m.profile_id=owner_id and t.deleted_at is null
    and t.transaction_date>=p_month and t.transaction_date<(p_month+interval '1 month');
  return jsonb_build_object('owner_profile_id',owner_id,'month',p_month,
    'period',case when period.id is null then null else jsonb_build_object(
      'id',period.id,'status',period.status,'base_currency',period.base_currency) end,
    'entries',entries);
end;
$$;
revoke all on function public.get_my_shared_responsibilities(date) from public,anon,authenticated;
grant execute on function public.get_my_shared_responsibilities(date) to authenticated;

-- The existing dependent financial readers/writers all compose this complete source.
create or replace function public.get_bucket_consumption(p_budget_period_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare
  currency_code text;
  period public.budget_periods;
  sources jsonb;
  saved_consumption jsonb;
  total numeric;
  bucket_rows jsonb;
begin
  select * into period from public.budget_periods
  where id = p_budget_period_id and profile_id = auth.uid();
  if not found then
    raise exception 'An owned budget period is required' using errcode = '42501';
  end if;
  currency_code := period.base_currency;
  if period.status='CLOSED' then
    -- Original v1/v2 closes remain byte-for-byte evidence. New backdated shared
    -- responsibilities are visible in the separate private source projection,
    -- but cannot change this period's consumption before explicit reopening.
    select summary->'consumption' into saved_consumption from public.budget_period_closures
      where owner_profile_id=auth.uid() and budget_period_id=period.id and lifecycle_version=period.lifecycle_version;
    if saved_consumption is not null then return saved_consumption; end if;
    -- Legacy CLOSED rows without evidence never acquire a guessed shared impact.
    sources := '[]'::jsonb;
  else
    sources := public.get_my_shared_responsibilities(period.starts_on)->'entries';
    if exists(select 1 from jsonb_array_elements(sources) e where (e->>'responsibility_amount_minor')::numeric>0 and e->>'application_status'<>'APPLIED') then
      -- No partial spent value may leak into safe-to-spend, savings funding,
      -- closure/disposition or carry reversal. Original currencies remain separate.
      raise exception 'Shared responsibility requires classification, canonical owned bucket and period currency'
        using errcode='23514';
    end if;
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
  select total+coalesce(sum((e->>'responsibility_amount_minor')::numeric),0) into total
    from jsonb_array_elements(sources) e;
  if total > 9007199254740991 then
    raise exception 'Expense consumption exceeds supported safe-integer range' using errcode = '22003';
  end if;
  with personal_spent as (
    select c.budget_bucket_id, sum(t.amount_minor) as amount_minor
    from public.transactions t join public.categories c on c.id = t.category_id
    where t.budget_period_id = p_budget_period_id and t.owner_profile_id = auth.uid()
      and t.type = 'EXPENSE' and t.deleted_at is null
    group by c.budget_bucket_id
  ), all_spent as (
    select * from personal_spent
    union all
    select b.id as budget_bucket_id,(e->>'responsibility_amount_minor')::numeric as amount_minor
      from jsonb_array_elements(sources) e join public.budget_buckets b
        on b.profile_id=auth.uid() and b.system_key=e->>'budget_classification' and b.type='SPENDABLE'
      where (e->>'responsibility_amount_minor')::numeric>0
  ), spent as (
    select budget_bucket_id,sum(amount_minor) as amount_minor from all_spent group by budget_bucket_id
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
  shared_ids jsonb;
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
    return jsonb_build_object('snapshot_version',2,'owner_profile_id',auth.uid(),'month',p_month,'period',null,
      'shared_responsibilities',public.get_my_shared_responsibilities(p_month));
  end if;
  -- These existing helpers retain all historical validation, complete aggregates,
  -- goal partitioning and uncertainty counts; an error fails the entire response.
  availability := public.get_personal_safe_to_spend(period.id);
  consumption := public.get_bucket_consumption(period.id);
  received := public.get_received_income(period.id);
  if period.status='CLOSED' then
    select coalesce(summary->'shared_expense_ids','[]'::jsonb) into shared_ids
      from public.budget_period_closures where owner_profile_id=auth.uid()
        and budget_period_id=period.id and lifecycle_version=period.lifecycle_version;
  else
    select coalesce(jsonb_agg(e->'expense_id' order by e->>'expense_id'),'[]'::jsonb) into shared_ids
      from jsonb_array_elements(public.get_my_shared_responsibilities(p_month)->'entries') e
      where (e->>'responsibility_amount_minor')::numeric>0;
  end if;
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
    'shared_responsibilities',public.get_my_shared_responsibilities(p_month),
    'shared_expense_ids',coalesce(shared_ids,'[]'::jsonb),'consumption',consumption,'allocations',allocation_rows,'buckets',bucket_rows,
    'upcoming',upcoming_rows);
end;
$$;
revoke all on function public.get_personal_dashboard(date) from public,anon,authenticated;
grant execute on function public.get_personal_dashboard(date) to authenticated;


-- Extract the existing protected-prefix algorithm without changing its arithmetic.
create function public.get_personal_protected_reserve(p_budget_period_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  target public.budget_periods;
  period public.budget_periods;
  income numeric; contribution numeric; withdrawal numeric;
  allocated numeric; ordinary numeric;
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
  return jsonb_build_object('budget_period_id',target.id,'base_currency',target.base_currency,
    'opening_protected_minor',opening,'allocated_savings_minor',allocated,
    'contributions_minor',contribution,'withdrawals_minor',withdrawal,
    'spendable_allocated_minor',ordinary,'configured',plan_count>0,
    'goal_reserved_minor',reserved,'unassigned_savings_minor',reserve-reserved);
end;
$$;
revoke all on function public.get_personal_protected_reserve(uuid) from public,anon,authenticated;
grant execute on function public.get_personal_protected_reserve(uuid) to authenticated;

-- Protected-reserve integrity and ordinary spending completeness are distinct.
-- Existing returned savings snapshots remain v2; there is no fabricated zero for
-- unknown spending and no implicit contribution/withdrawal to cover responsibility.
create or replace function public.get_savings_availability(p_budget_period_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare state jsonb; carry jsonb; spent numeric; ordinary numeric; contribution numeric; withdrawal numeric;
  incoming numeric; outgoing numeric; maximum constant numeric:=9007199254740991;
begin
  state:=public.get_personal_protected_reserve(p_budget_period_id);
  select coalesce(sum((item->>'spent_minor')::numeric),0) into spent
    from jsonb_array_elements(public.get_bucket_consumption(p_budget_period_id)->'buckets') item;
  carry:=public.get_personal_carry(p_budget_period_id);
  ordinary:=(state->>'spendable_allocated_minor')::numeric;
  contribution:=(state->>'contributions_minor')::numeric;
  withdrawal:=(state->>'withdrawals_minor')::numeric;
  incoming:=(carry->>'incoming_minor')::numeric;
  outgoing:=(carry->>'outgoing_minor')::numeric;
  if abs(ordinary+incoming-contribution+withdrawal-spent-outgoing)>maximum
    or ordinary+incoming>maximum or ordinary+incoming+withdrawal>maximum then
    raise exception 'Ordinary remainder exceeds supported safe-integer range' using errcode='22003';
  end if;
  return state||jsonb_build_object('snapshot_version',2,'carry',carry,'spent_minor',spent);
end;
$$;

create or replace function public.check_savings_integrity()
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
    perform public.get_personal_protected_reserve(period_id);
  end loop;
  return null;
end;
$$;

create or replace function public.register_savings_movement(
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
    perform public.get_personal_protected_reserve(p_budget_period_id);
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

create or replace function public.get_personal_savings_goals(p_through_month date)
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
    perform public.get_personal_protected_reserve(period_id);
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

create or replace function public.correct_personal_transaction(
  p_request_id uuid,p_transaction_id uuid,p_expected_revision bigint,p_action text,
  p_changes jsonb,p_confirmed boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  owner_id uuid := auth.uid(); original public.transactions; result public.transactions;
  event public.transaction_revisions; period public.budget_periods; period_id uuid;
  payload jsonb; amount bigint; financial_date date; category uuid; corrected_description text;
begin
  if owner_id is null or p_request_id is null or p_transaction_id is null then
    raise exception 'Authenticated correction identity is required' using errcode='42501';
  end if;
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Transaction corrections require READ COMMITTED isolation' using errcode='0A000';
  end if;
  if p_expected_revision is null or p_expected_revision not between 0 and 9007199254740990
    or p_action is null or p_action not in ('EDIT','DELETE','RESTORE')
    or p_confirmed is distinct from true or p_changes is null
    or pg_catalog.jsonb_typeof(p_changes) <> 'object' then
    raise exception 'A confirmed valid correction and expected revision are required' using errcode='22023';
  end if;
  payload := jsonb_build_object('transaction_id',p_transaction_id,'expected_revision',p_expected_revision,
    'action',p_action,'changes',p_changes,'confirmed',p_confirmed);
  perform public.lock_personal_finance();
  select * into event from public.transaction_revisions
    where owner_profile_id=owner_id and request_id=p_request_id;
  if found then
    if event.request_payload is distinct from payload then
      raise exception 'Correction request identity conflicts with its original payload' using errcode='23505';
    end if;
    -- An old successful response is not permission to overwrite a newer revision.
    return event.after_state;
  end if;
  select * into original from public.transactions
    where id=p_transaction_id and owner_profile_id=owner_id and scope='PERSONAL';
  if not found then raise exception 'An owned personal transaction is required' using errcode='42501'; end if;
  select * into period from public.budget_periods
    where id=original.budget_period_id and profile_id=owner_id for update;
  if not found or period.status <> 'OPEN' then
    raise exception 'An owned open budget period is required' using errcode='42501';
  end if;
  select * into original from public.transactions
    where id=p_transaction_id and owner_profile_id=owner_id for update;
  if original.revision <> p_expected_revision then
    raise exception 'Transaction changed; reload before correcting it' using errcode='40001';
  end if;
  if p_action='EDIT' then
    if original.deleted_at is not null then
      raise exception 'Restore a deleted transaction before editing it' using errcode='23514';
    end if;
    if (select count(*) from jsonb_object_keys(p_changes)) <> 4
      or not (p_changes ?& array['amount_minor','transaction_date','category_id','description'])
      or jsonb_typeof(p_changes->'amount_minor') is distinct from 'number'
      or (p_changes->>'amount_minor') !~ '^[0-9]+$'
      or (p_changes->>'amount_minor')::numeric not between 1 and 9007199254740991
      or jsonb_typeof(p_changes->'transaction_date') is distinct from 'string'
      or (p_changes->>'transaction_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(p_changes->'category_id') not in ('string','null')
      or jsonb_typeof(p_changes->'description') not in ('string','null')
      or char_length(p_changes->>'description') > 500 then
      raise exception 'Only complete bounded correction fields are accepted' using errcode='22023';
    end if;
    amount := (p_changes->>'amount_minor')::bigint;
    financial_date := (p_changes->>'transaction_date')::date;
    category := (p_changes->>'category_id')::uuid;
    corrected_description := p_changes->>'description';
    update public.transactions set amount_minor=amount,transaction_date=financial_date,
      category_id=category,description=corrected_description
      where id=original.id and owner_profile_id=owner_id returning * into result;
  else
    if p_changes <> '{}'::jsonb then
      raise exception 'Delete and restore do not accept monetary changes' using errcode='22023';
    end if;
    if (p_action='DELETE' and original.deleted_at is not null)
      or (p_action='RESTORE' and original.deleted_at is null) then
      raise exception 'Transaction state changed; reload before correcting it' using errcode='40001';
    end if;
    update public.transactions set deleted_at=case when p_action='DELETE' then statement_timestamp() else null end
      where id=original.id and owner_profile_id=owner_id returning * into result;
  end if;
  -- Validate all affected historical prefixes before returning, not just at commit.
  -- Later ordinary overspending stays legal; this does not re-fund old contributions.
  for period_id in select distinct on(p.base_currency) p.id from public.budget_periods p
    where p.profile_id=owner_id and exists(select 1 from public.transactions t
      join public.budget_periods source on source.id=t.budget_period_id
      where t.owner_profile_id=owner_id and t.type in ('SAVINGS_CONTRIBUTION','SAVINGS_WITHDRAWAL')
        and t.deleted_at is null and source.base_currency=p.base_currency)
    order by p.base_currency,p.starts_on desc,p.id
  loop perform public.get_personal_protected_reserve(period_id); end loop;
  update public.transaction_revisions set request_id=p_request_id,request_payload=payload
    where transaction_id=result.id and owner_profile_id=owner_id and revision=result.revision;
  return to_jsonb(result);
end;
$$;

-- Current own sources are outside immutable closure evidence, in the same read snapshot.
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
      'shared_responsibilities',public.get_my_shared_responsibilities(p_month),
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
      'shared_responsibilities',public.get_my_shared_responsibilities(p_month),
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
    'shared_responsibilities',public.get_my_shared_responsibilities(p_month),
      'financial_month',v_current_month,'financial_timezone',v_timezone,'closure',null,'summary',v_summary,
    'snapshot_hash',md5(jsonb_build_object('summary',v_summary,'timezone',v_timezone)::text),
    'can_close',p_month<v_current_month and v_pending=0 and v_prior=0,'history',v_history,'reopen_hash',null);
end;
$$;

-- Known protected reserve stays readable when positive shared responsibility
-- prevents a complete ordinary spending/contribution calculation. No exception
-- is swallowed: the incomplete cause is explicit, and all reserve guards run.
create function public.get_personal_savings_context(p_month date)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_sources jsonb; v_period public.budget_periods; v_reserve jsonb; v_complete boolean;
begin
  v_sources := public.get_my_shared_responsibilities(p_month);
  select * into v_period from public.budget_periods where profile_id=auth.uid() and starts_on=p_month;
  if not found then
    return jsonb_build_object('owner_profile_id',auth.uid(),'month',p_month,'period',null,
      'shared_responsibilities',v_sources,'reserve',null,'availability',null);
  end if;
  v_reserve := public.get_personal_protected_reserve(v_period.id);
  v_complete := v_period.status='CLOSED' or not exists(
    select 1 from jsonb_array_elements(v_sources->'entries') e
    where (e->>'responsibility_amount_minor')::numeric>0 and e->>'application_status'<>'APPLIED');
  return jsonb_build_object('owner_profile_id',auth.uid(),'month',p_month,'period',to_jsonb(v_period),
    'shared_responsibilities',v_sources,'reserve',v_reserve,
    'availability',case when v_complete then public.get_savings_availability(v_period.id) else null end);
end;
$$;
revoke all on function public.get_personal_savings_context(date) from public,anon,authenticated;
grant execute on function public.get_personal_savings_context(date) to authenticated;
