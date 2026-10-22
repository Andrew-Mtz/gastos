-- FIN-204 extends FIN-202's existing nonempty A/B/C fixtures. Test-only invoker
-- helpers and command data live in pg_temp and roll back with the owning suite.
create temp table private_rpc_cases (
  owner_base integer not null,
  label text not null,
  command text not null,
  denied_state text not null,
  primary key(owner_base,label)
);
grant select,insert on private_rpc_cases to authenticated;

-- A positive probe deliberately rolls back its own valid mutation. A negative
-- probe does NOT roll back success: the per-attempt privileged snapshot below
-- must catch any unauthorized write, even if the result is incorrectly accepted.
create function pg_temp.probe_private_mutation(command text, rollback_success boolean)
returns text language plpgsql security invoker as $$
begin
  execute command;
  if rollback_success then raise exception using errcode='P2040'; end if;
  return '00000';
exception
  when sqlstate 'P2040' then return '00000';
  when others then return sqlstate;
end;
$$;

create function pg_temp.private_rows() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare source text; rows jsonb; result jsonb := '{}';
begin
  foreach source in array array['profiles','budget_periods','budget_buckets',
    'budget_allocations','categories','transactions','savings_goals','recurring_expenses',
    'transaction_revisions','budget_period_closures','budget_period_reopenings',
    'budget_period_dispositions','budget_period_carry_reversals'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from public.%I t',source) into rows;
    result := result || jsonb_build_object(source,rows);
  end loop;
  return result;
end;
$$;
revoke all on function pg_temp.private_rows() from public,authenticated,anon;

create function pg_temp.prepare_private_rpc_cases(n integer) returns void
language plpgsql security invoker as $$
declare allocations jsonb; defaults jsonb; future date; preview jsonb;
begin
  allocations := jsonb_build_array(
    jsonb_build_object('budget_bucket_id',pg_temp.id(n+10),'percentage_basis_points',8000),
    jsonb_build_object('budget_bucket_id',pg_temp.id(n+11),'percentage_basis_points',2000));
  select jsonb_agg(jsonb_build_object('budget_bucket_id',id,'percentage_basis_points',
    case system_key when 'NEEDS' then 5000 when 'LEISURE' then 3000 else 2000 end) order by id)
    into defaults from public.budget_buckets where profile_id=auth.uid() and system_key is not null;
  select active_from into future from public.recurring_expenses where id=pg_temp.id(n+41);
  insert into pg_temp.private_rpc_cases values
    (n,'save_budget_allocations',format('select public.save_budget_allocations(%L,%L)',pg_temp.id(n+1),allocations),'42501'),
    (n,'save_initial_budget foreign default buckets',format('select public.save_initial_budget(%L,%L,5000,%L)','2025-03-01','USD',defaults),'42501'),
    (n,'register_income',format('select public.register_income(%L,%L,1,%L,%L)',pg_temp.id(n+70),pg_temp.id(n+1),'USD','2025-01-03'),'42501'),
    (n,'register_personal_expense',format('select public.register_personal_expense(%L,%L,1,%L,%L,%L)',pg_temp.id(n+71),pg_temp.id(n+1),'USD','2025-01-03',pg_temp.id(n+20)),'42501'),
    (n,'register_savings_movement contribution',format('select public.register_savings_movement(%L,%L,%L,1,%L,%L,false)',pg_temp.id(n+72),pg_temp.id(n+1),'SAVINGS_CONTRIBUTION','USD','2025-01-03'),'42501'),
    (n,'register_savings_movement withdrawal',format('select public.register_savings_movement(%L,%L,%L,1,%L,%L,true)',pg_temp.id(n+73),pg_temp.id(n+1),'SAVINGS_WITHDRAWAL','USD','2025-01-03'),'42501'),
    (n,'register_savings_movement goal',format('select public.register_savings_movement(%L,%L,%L,1,%L,%L,false,null,%L)',pg_temp.id(n+74),pg_temp.id(n+1),'SAVINGS_CONTRIBUTION','USD','2025-01-03',pg_temp.id(n+40)),'42501'),
    (n,'create_personal_savings_goal exact foreign identity',format('select public.create_personal_savings_goal(%L,%L,100,%L)',pg_temp.id(n+40),'Private savings goal','USD'),'23505'),
    (n,'create_personal_recurring_expense foreign category',format('select public.create_personal_recurring_expense(%L,%L,%L,%L,%L,1,%L,null,10)',pg_temp.id(n+75),'Private test template',pg_temp.id(n+20),'FIXED','USD',future),'42501'),
    (n,'stop_personal_recurring_expense',format('select public.stop_personal_recurring_expense(%L,%L)',pg_temp.id(n+41),(future+interval '1 month')::date),'42501'),
    (n,'resolve_personal_recurring_expense',format('select public.resolve_personal_recurring_expense(%L,%L,%L,%L,10,%L,%L)',pg_temp.id(n+76),pg_temp.id(n+41),pg_temp.id(n+3),future,'USD',future+1),'42501'),
    (n,'correct_personal_transaction',format('select public.correct_personal_transaction(%L,%L,%s,%L,%L,true)',pg_temp.id(n+77),pg_temp.id(n+31),(select revision from public.transactions where id=pg_temp.id(n+31)),'DELETE','{}'),'42501');
  preview := public.get_personal_period_close_context('2025-01-01');
  insert into pg_temp.private_rpc_cases values
    (n,'close_personal_budget_period',format('select public.close_personal_budget_period(%L,%L,2,%L,true)',pg_temp.id(n+78),pg_temp.id(n+1),preview->>'snapshot_hash'),'42501');
  preview := public.get_personal_period_close_context('2025-06-01');
  insert into pg_temp.private_rpc_cases values
    (n,'reopen_personal_budget_period',format('select public.reopen_personal_budget_period(%L,%L,1,%L,true)',pg_temp.id(n+79),pg_temp.id(n+6),preview->>'reopen_hash'),'42501');
  preview := public.get_personal_remainder_context('2025-01-01');
  insert into pg_temp.private_rpc_cases values
    (n,'close_and_dispose_personal_remainder',format('select public.close_and_dispose_personal_remainder(%L,%L,2,%L,%L,100,%L,%L,true)',pg_temp.id(n+80),pg_temp.id(n+1),preview->>'preview_hash','CARRY_BUCKET',pg_temp.id(n+2),pg_temp.id(n+10)),'42501');
  preview := public.get_personal_carry_reversal_context(pg_temp.id(n+54));
  insert into pg_temp.private_rpc_cases values
    (n,'reverse_carry_and_reopen_personal_period',format('select public.reverse_carry_and_reopen_personal_period(%L,%L,1,0,%L,true)',pg_temp.id(n+81),pg_temp.id(n+54),preview->>'preview_hash'),'42501');
end;
$$;

create function pg_temp.assert_private_rpcs(own_base integer, foreign_base integer)
returns setof text language plpgsql security invoker as $$
declare rpc text; snapshot jsonb; item record; own_id uuid := auth.uid();
begin
  -- A resource UUID must reject foreign ownership, not return a default zero.
  foreach rpc in array array['get_received_income','get_bucket_consumption',
    'get_savings_availability','get_personal_committed_money',
    'get_personal_safe_to_spend','get_personal_carry'] loop
    if own_base is not null then
      return next lives_ok(format('select public.%I(%L)',rpc,pg_temp.id(own_base+1)),
        'Nonempty owner fixture can read '||rpc);
    end if;
    return next throws_ok(format('select public.%I(%L)',rpc,pg_temp.id(foreign_base+1)),
      '42501',null,'Foreign existing resource is denied: '||rpc);
  end loop;
  return next throws_ok(format('select public.get_personal_carry_reversal_context(%L)',pg_temp.id(foreign_base+54)),
    '42501',null,'Foreign existing active carry preview is denied');
  if own_base is not null then
    return next is(public.get_personal_carry_reversal_context(pg_temp.id(own_base+54))#>>'{disposition,id}',
      pg_temp.id(own_base+54)::text,'Owner can read their real active carry preview');
  end if;

  -- Month-only APIs derive the actor, so B must receive B's populated result,
  -- never A's result or an authorization error. C legitimately has no period.
  foreach rpc in array array['get_personal_dashboard','get_personal_period_close_context',
    'get_personal_remainder_context','get_personal_savings_goals','get_personal_recurring_month'] loop
    execute format('select public.%I(%L)',rpc,'2025-01-01') into snapshot;
    return next is(coalesce(snapshot->>'owner_profile_id',snapshot#>>'{close,owner_profile_id}'),
      own_id::text,'Actor-derived owner: '||rpc);
    return next ok(position(('f0050000-0000-4000-8000-'||lpad((foreign_base/1000)::text,12,'0')) in snapshot::text)=0,
      'No foreign owner anywhere in nested '||rpc);
    return next ok(not exists(select 1 from generate_series(1,90) i
      where position(pg_temp.id(foreign_base+i)::text in snapshot::text)>0),
      'No foreign resource/history IDs anywhere in '||rpc);
    if rpc in ('get_personal_dashboard','get_personal_period_close_context','get_personal_remainder_context') then
      return next is(coalesce(snapshot#>>'{period,id}',snapshot#>>'{close,period,id}'),
        case when own_base is null then null else pg_temp.id(own_base+1)::text end,
        'Own period or explicit missing state, not foreign fallback: '||rpc);
    elsif rpc='get_personal_savings_goals' then
      return next is(jsonb_array_length(snapshot->'goals'),case when own_base is null then 0 else 1 end,
        'Nonvacuous own savings-goal list');
    else
      return next is(jsonb_array_length(snapshot->'items'),case when own_base is null then 0 else 1 end,
        'Nonvacuous own recurring-template list');
    end if;
  end loop;
  if own_base is not null then
    return next is(public.get_personal_dashboard('2025-01-01')->>'received_income_minor',
      (own_base+1000)::text,'Own distinguishable income survives household access');
    return next is((select count(*) from public.prepare_initial_budget_buckets() where profile_id<>auth.uid()),
      0::bigint,'No-argument provisioning returns only own system buckets');
    return next is((select count(*) from public.prepare_initial_budget_buckets()),3::bigint,
      'No-argument provisioning has a nonempty owner result');
    return next lives_ok('select public.lock_personal_finance()','No-argument lock grants no foreign resource selection');
    for item in select * from pg_temp.private_rpc_cases where owner_base=own_base order by label loop
      return next is(pg_temp.probe_private_mutation(item.command,true),'00000',
        'Exact mutation payload is valid for its owner: '||item.label);
    end loop;
  end if;
end;
$$;
