-- ADR-075: lifecycle evidence is not a balance or a monetary movement.
alter table public.budget_periods
  add column lifecycle_version bigint not null default 0
    check (lifecycle_version between 0 and 9007199254740991),
  add constraint budget_periods_id_owner_key unique(id,profile_id);

create table public.budget_period_closures (
  id uuid primary key,
  owner_profile_id uuid not null,
  budget_period_id uuid not null,
  expected_lifecycle_version bigint not null check (expected_lifecycle_version>=0),
  lifecycle_version bigint not null check (lifecycle_version between 1 and 9007199254740991),
  snapshot_hash text not null check (snapshot_hash ~ '^[a-f0-9]{32}$'),
  snapshot_version integer not null default 1 check (snapshot_version=1),
  summary jsonb not null,
  financial_timezone text not null,
  closed_at timestamptz not null,
  unique(budget_period_id,lifecycle_version),
  foreign key(budget_period_id,owner_profile_id) references public.budget_periods(id,profile_id) on delete restrict,
  check (lifecycle_version=expected_lifecycle_version+1)
);
alter table public.budget_period_closures enable row level security;
revoke all on public.budget_period_closures from public,anon,authenticated;
grant select on public.budget_period_closures to authenticated;
create policy budget_period_closures_select_own on public.budget_period_closures
  for select to authenticated using(owner_profile_id=(select auth.uid()));

-- STABLE reads use one complete statement snapshot. All aggregate arrays already
-- have deterministic order; no preview timestamp is included in the fingerprint.
create function public.get_personal_period_close_context(p_month date)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  v_period public.budget_periods;
  v_close public.budget_period_closures;
  v_timezone text;
  v_current_month date;
  v_summary jsonb;
  v_pending numeric;
  v_prior numeric;
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
  if v_period.status='CLOSED' then
    select * into v_close from public.budget_period_closures
      where owner_profile_id=auth.uid() and budget_period_id=v_period.id and lifecycle_version=v_period.lifecycle_version;
    -- Never silently recompute historical evidence, including legacy closed rows.
    return jsonb_build_object('owner_profile_id',auth.uid(),'month',p_month,'period',to_jsonb(v_period),
      'financial_month',v_current_month,'financial_timezone',v_timezone,'closure',to_jsonb(v_close),
      'summary',v_close.summary,'snapshot_hash',v_close.snapshot_hash,'can_close',false);
  end if;
  v_summary := public.get_personal_dashboard(p_month);
  select coalesce(sum((b->>'confirmed_count')::numeric+(b->>'estimated_count')::numeric+(b->>'unknown_count')::numeric),0)
    into v_pending from jsonb_array_elements(v_summary->'availability'->'commitments'->'buckets') b;
  v_prior := (v_summary->'availability'->'commitments'->>'prior_unresolved_count')::numeric;
  return jsonb_build_object('owner_profile_id',auth.uid(),'month',p_month,'period',to_jsonb(v_period),
    'financial_month',v_current_month,'financial_timezone',v_timezone,'closure',null,'summary',v_summary,
    'snapshot_hash',md5(jsonb_build_object('summary',v_summary,'timezone',v_timezone)::text),
    'can_close',p_month<v_current_month and v_pending=0 and v_prior=0);
end;
$$;
revoke all on function public.get_personal_period_close_context(date) from public,anon,authenticated;
grant execute on function public.get_personal_period_close_context(date) to authenticated;

-- No client status grants: this is the only authenticated lifecycle writer.
create function public.close_personal_budget_period(
  p_id uuid,p_budget_period_id uuid,p_expected_lifecycle_version bigint,
  p_snapshot_hash text,p_confirmed boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_period public.budget_periods;
  v_existing public.budget_period_closures;
  v_context jsonb;
  v_closed_at timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication is required' using errcode='42501'; end if;
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'Period lifecycle writes require READ COMMITTED' using errcode='25001';
  end if;
  if p_id is null or p_budget_period_id is null or p_expected_lifecycle_version is null
    or p_expected_lifecycle_version not between 0 and 9007199254740990
    or p_snapshot_hash is null or p_snapshot_hash !~ '^[a-f0-9]{32}$'
    or p_confirmed is distinct from true then
    raise exception 'A complete explicitly confirmed close request is required' using errcode='22023';
  end if;
  perform public.lock_personal_finance();
  select * into v_existing from public.budget_period_closures where id=p_id and owner_profile_id=auth.uid();
  if found then
    if v_existing.budget_period_id<>p_budget_period_id
      or v_existing.expected_lifecycle_version<>p_expected_lifecycle_version or v_existing.snapshot_hash<>p_snapshot_hash then
      raise exception 'Close request identity conflicts' using errcode='23505';
    end if;
    return to_jsonb(v_existing);
  end if;
  select * into v_period from public.budget_periods
    where id=p_budget_period_id and profile_id=auth.uid() for update;
  if not found then raise exception 'An owned budget period is required' using errcode='42501'; end if;
  if v_period.status<>'OPEN' or v_period.lifecycle_version<>p_expected_lifecycle_version then
    raise exception 'Period lifecycle changed; review again' using errcode='40001';
  end if;
  -- Executed AFTER the owner lock: a waiting writer sees committed current facts.
  v_context := public.get_personal_period_close_context(v_period.starts_on);
  if (v_context->>'can_close')::boolean is distinct from true then
    raise exception 'Only completed months without unresolved obligations can close' using errcode='23514';
  end if;
  if v_context->>'snapshot_hash' is distinct from p_snapshot_hash then
    raise exception 'Close preview changed; review again' using errcode='40001';
  end if;
  v_closed_at := clock_timestamp();
  insert into public.budget_period_closures(id,owner_profile_id,budget_period_id,expected_lifecycle_version,
    lifecycle_version,snapshot_hash,summary,financial_timezone,closed_at)
  values(p_id,auth.uid(),v_period.id,p_expected_lifecycle_version,p_expected_lifecycle_version+1,
    p_snapshot_hash,v_context->'summary',v_context->>'financial_timezone',v_closed_at)
  returning * into v_existing;
  update public.budget_periods set status='CLOSED',closed_at=v_closed_at,lifecycle_version=p_expected_lifecycle_version+1
    where id=v_period.id and profile_id=auth.uid();
  return to_jsonb(v_existing);
end;
$$;
revoke all on function public.close_personal_budget_period(uuid,uuid,bigint,text,boolean) from public,anon,authenticated;
grant execute on function public.close_personal_budget_period(uuid,uuid,bigint,text,boolean) to authenticated;
