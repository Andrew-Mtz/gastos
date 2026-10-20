-- ADR-072: explicit fixed confirmation reuses the actual, never auto-generates it.
create or replace function public.validate_recurring_resolution()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare template public.recurring_expenses; period_month date;
begin
  if new.recurring_template_id is null then return new; end if;
  if tg_op='UPDATE' then
    -- Existing linkage survives explicit soft deletion/restore and later stop.
    if new.recurring_template_id is distinct from old.recurring_template_id
      or new.recurring_month is distinct from old.recurring_month then
      raise exception 'Recurring linkage is immutable' using errcode='23514';
    end if;
    return new;
  end if;
  select * into template from public.recurring_expenses
    where id=new.recurring_template_id and owner_profile_id=auth.uid();
  if not found or new.owner_profile_id is distinct from auth.uid() then
    raise exception 'An owned recurring template is required' using errcode='42501';
  end if;
  select starts_on into period_month from public.budget_periods where id=new.budget_period_id;
  if new.type <> 'EXPENSE'
    or (template.amount_mode='FIXED' and new.amount_minor is distinct from template.default_amount_minor)
    or new.recurring_month is distinct from period_month
    or new.currency is distinct from template.currency
    or new.category_id is distinct from template.category_id
    or new.recurring_month < template.active_from
    or (template.active_until is not null and new.recurring_month > template.active_until)
    or (template.stopped_from is not null and new.recurring_month >= template.stopped_from) then
    raise exception 'An eligible occurrence with its fixed amount when applicable in its original month, currency and category is required' using errcode='23514';
  end if;
  return new;
end;
$$;

-- Monthly planning, not cumulative payable/cash accounting. Older unresolved
-- identities are counted separately; month-span arithmetic avoids series expansion.
create function public.get_personal_committed_money(p_budget_period_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  period public.budget_periods;
  bucket_rows jsonb;
  invalid boolean;
  confirmed_total numeric;
  estimated_total numeric;
  occurrence_total numeric;
  prior_count numeric;
begin
  select * into period from public.budget_periods
    where id=p_budget_period_id and profile_id=auth.uid();
  if not found then
    raise exception 'An owned budget period is required' using errcode='42501';
  end if;
  -- Do not filter by due day: overdue days in this month remain obligations.
  -- Do not filter archives/allocations or deleted actuals: neither is a new bill.
  with pending as (
    select r.*,c.budget_bucket_id,b.name as bucket_name,b.type as bucket_type
    from public.recurring_expenses r
    left join public.categories c on c.id=r.category_id and c.profile_id=auth.uid()
    left join public.budget_buckets b on b.id=c.budget_bucket_id and b.profile_id=auth.uid()
    where r.owner_profile_id=auth.uid() and r.active_from<=period.starts_on
      and (r.active_until is null or r.active_until>=period.starts_on)
      and (r.stopped_from is null or r.stopped_from>period.starts_on)
      and not exists(select 1 from public.transactions t
        where t.owner_profile_id=auth.uid() and t.recurring_template_id=r.id
          and t.recurring_month=period.starts_on)
  ), grouped as (
    select budget_bucket_id,bucket_name,
      bool_or(currency<>period.base_currency or bucket_type is distinct from 'SPENDABLE') as invalid,
      coalesce(sum(default_amount_minor) filter(where amount_mode='FIXED'),0) as confirmed_minor,
      coalesce(sum(default_amount_minor) filter(where amount_mode='VARIABLE'),0) as estimated_minor,
      count(*) filter(where amount_mode='FIXED') as confirmed_count,
      count(*) filter(where amount_mode='VARIABLE' and default_amount_minor is not null) as estimated_count,
      count(*) filter(where amount_mode='VARIABLE' and default_amount_minor is null) as unknown_count
    from pending group by budget_bucket_id,bucket_name
  )
  select coalesce(bool_or(g.invalid),false),coalesce(sum(confirmed_minor),0),
    coalesce(sum(estimated_minor),0),coalesce(sum(confirmed_count+estimated_count+unknown_count),0),
    coalesce(jsonb_agg(jsonb_build_object(
      'budget_bucket_id',budget_bucket_id,'name',bucket_name,
      'confirmed_minor',confirmed_minor,'estimated_minor',estimated_minor,
      'confirmed_count',confirmed_count,'estimated_count',estimated_count,'unknown_count',unknown_count
    ) order by budget_bucket_id),'[]'::jsonb)
    into invalid,confirmed_total,estimated_total,occurrence_total,bucket_rows from grouped g;
  if invalid then
    raise exception 'Commitments require period currency and spendable bucket mappings' using errcode='23514';
  end if;
  with ranges as (
    select r.id,r.active_from,least(
      (period.starts_on-interval '1 month')::date,
      coalesce(r.active_until,period.starts_on),
      coalesce((r.stopped_from-interval '1 month')::date,period.starts_on)
    ) as last_month from public.recurring_expenses r where r.owner_profile_id=auth.uid()
  ), unresolved as (
    select (extract(year from last_month)-extract(year from active_from))*12
      +extract(month from last_month)-extract(month from active_from)+1
      -(select count(*) from public.transactions t
        where t.owner_profile_id=auth.uid() and t.recurring_template_id=r.id
          and t.recurring_month between r.active_from and r.last_month) as remaining
    from ranges r where last_month>=active_from
  ) select coalesce(sum(remaining),0) into prior_count from unresolved;
  if confirmed_total+estimated_total>9007199254740991
    or occurrence_total>9007199254740991 or prior_count>9007199254740991 then
    raise exception 'Commitments exceed supported safe-integer range' using errcode='22003';
  end if;
  return jsonb_build_object('owner_profile_id',auth.uid(),'budget_period_id',period.id,
    'month',period.starts_on,'base_currency',period.base_currency,
    'buckets',bucket_rows,'prior_unresolved_count',prior_count);
end;
$$;
revoke all on function public.get_personal_committed_money(uuid) from public,anon,authenticated;
grant execute on function public.get_personal_committed_money(uuid) to authenticated;
