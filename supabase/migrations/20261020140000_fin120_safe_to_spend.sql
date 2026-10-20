-- ADR-073: a single STABLE call fixes one MVCC statement snapshot for both
-- existing STABLE invoker helpers, even when a concurrent financial write commits.
-- Do not replace with independent client reads or VOLATILE nested reads.
create function public.get_personal_safe_to_spend(p_budget_period_id uuid)
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
    -(savings->>'spent_minor')::numeric-confirmed;
  if abs(margin)>9007199254740991 or abs(margin-estimated)>9007199254740991 then
    raise exception 'Monthly availability exceeds supported safe-integer range' using errcode='22003';
  end if;
  return jsonb_build_object('savings',savings,'commitments',commitments);
end;
$$;
revoke all on function public.get_personal_safe_to_spend(uuid) from public,anon,authenticated;
grant execute on function public.get_personal_safe_to_spend(uuid) to authenticated;
