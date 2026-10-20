-- One read snapshot, aggregated by bucket rather than a paginated history page.
-- A scalar JSON response avoids the Data API's row limit truncating bucket totals.
create function public.get_bucket_consumption(p_budget_period_id uuid)
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
