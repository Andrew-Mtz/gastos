-- FIN-121: read composition only. Every financial fact and the preview share
-- the calling statement's MVCC snapshot; no client-side joining of racing reads.
create function public.get_personal_dashboard(p_month date)
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
    return jsonb_build_object('owner_profile_id',auth.uid(),'month',p_month,'period',null);
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
  return jsonb_build_object('owner_profile_id',auth.uid(),'month',p_month,
    'period',to_jsonb(period),'received_income_minor',received,'availability',availability,
    'consumption',consumption,'allocations',allocation_rows,'buckets',bucket_rows,
    'upcoming',upcoming_rows);
end;
$$;
revoke all on function public.get_personal_dashboard(date) from public,anon,authenticated;
grant execute on function public.get_personal_dashboard(date) to authenticated;
