-- ADR-076: explicit reopening records evidence, never moves money or erases a close.
create table public.budget_period_reopenings (
  id uuid primary key,
  owner_profile_id uuid not null,
  budget_period_id uuid not null,
  closure_id uuid references public.budget_period_closures(id) on delete restrict,
  expected_lifecycle_version bigint not null check(expected_lifecycle_version>=0),
  lifecycle_version bigint not null check(lifecycle_version between 1 and 9007199254740991),
  closed_state_hash text not null check(closed_state_hash ~ '^[a-f0-9]{32}$'),
  previous_closed_at timestamptz not null,
  reopened_at timestamptz not null,
  unique(budget_period_id,lifecycle_version),
  foreign key(budget_period_id,owner_profile_id) references public.budget_periods(id,profile_id) on delete restrict,
  check(lifecycle_version=expected_lifecycle_version+1)
);
alter table public.budget_period_reopenings enable row level security;
revoke all on public.budget_period_reopenings from public,anon,authenticated;
grant select on public.budget_period_reopenings to authenticated;
create policy budget_period_reopenings_select_own on public.budget_period_reopenings
  for select to authenticated using(owner_profile_id=(select auth.uid()));

-- One stable statement returns every stored event without REST row caps. History
-- does not enter a close preview's monetary fingerprint or rewrite any snapshot.
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

create function public.reopen_personal_budget_period(
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
