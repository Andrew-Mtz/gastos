\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
\ir helpers/auth.sql.inc
select no_plan();

-- Every fixture is synthetic and the entire file, including helpers, rolls back.
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('f2020000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
insert into auth.users(id, email)
select pg_temp.id(n), 'fin202-' || n || '@example.invalid' from generate_series(1, 5) n;
insert into public.profiles(id, display_name, base_currency, timezone) values
  ('f0050000-0000-4000-8000-000000000001', 'Synthetic owner A', 'USD', 'America/Montevideo'),
  ('f0050000-0000-4000-8000-000000000002', 'Synthetic partner B', 'EUR', 'Europe/Madrid'),
  ('f0050000-0000-4000-8000-000000000003', 'Synthetic unrelated C', 'UYU', 'UTC'),
  (pg_temp.id(1), 'Synthetic departed D', 'USD', 'UTC'),
  (pg_temp.id(2), 'Synthetic creator only E', 'USD', 'UTC'),
  (pg_temp.id(3), 'Synthetic eligible F', 'USD', 'UTC'),
  (pg_temp.id(5), 'Synthetic second eligible', 'USD', 'UTC');
-- id(4) is an authenticated identity with no application Profile.
insert into public.households(id, name, default_currency, created_by) values
  (pg_temp.id(100), 'Synthetic Home', 'UYU', 'f0050000-0000-4000-8000-000000000001'),
  (pg_temp.id(101), 'Synthetic Second', 'EUR', 'f0050000-0000-4000-8000-000000000002'),
  (pg_temp.id(102), 'Synthetic Unrelated', 'USD', pg_temp.id(2)),
  (pg_temp.id(103), 'Synthetic Past', 'USD', pg_temp.id(2));
insert into public.household_members(id, household_id, profile_id, role, joined_at, left_at) values
  (pg_temp.id(110), pg_temp.id(100), 'f0050000-0000-4000-8000-000000000001', 'OWNER', '2026-01-01', null),
  (pg_temp.id(111), pg_temp.id(100), 'f0050000-0000-4000-8000-000000000002', 'MEMBER', '2026-01-01', null),
  (pg_temp.id(112), pg_temp.id(100), pg_temp.id(1), 'MEMBER', '2026-01-01', '2026-02-01'),
  (pg_temp.id(113), pg_temp.id(101), 'f0050000-0000-4000-8000-000000000001', 'MEMBER', '2026-01-01', null),
  (pg_temp.id(114), pg_temp.id(101), 'f0050000-0000-4000-8000-000000000002', 'OWNER', '2026-01-01', null),
  (pg_temp.id(115), pg_temp.id(102), 'f0050000-0000-4000-8000-000000000003', 'OWNER', '2026-01-01', null),
  (pg_temp.id(116), pg_temp.id(103), pg_temp.id(1), 'OWNER', '2026-01-01', '2026-02-01');

select ok(prosecdef and proconfig @> array['search_path=""'],
  'Reviewed definer has empty search_path: ' || proname)
from pg_proc where oid in (
  'public.is_active_household_member(uuid)'::regprocedure,
  'public.get_my_household_memberships()'::regprocedure,
  'public.create_first_household(uuid,text,text)'::regprocedure
);
select is(provolatile::text, 's', 'Read shares the statement snapshot: ' || proname)
from pg_proc where oid in ('public.is_active_household_member(uuid)'::regprocedure,
  'public.get_my_household_memberships()'::regprocedure);
select is((select pronargs::integer from pg_proc where oid = 'public.get_my_household_memberships()'::regprocedure),
  0, 'Projection accepts no household or actor filter that could broaden access');
select is((select proargnames from pg_proc where oid = 'public.create_first_household(uuid,text,text)'::regprocedure),
  array['p_household_id','p_name','p_default_currency']::text[], 'Creation accepts no actor, role or membership input');
select ok(has_function_privilege('authenticated', f, 'EXECUTE'), 'Authenticated execution: ' || f)
from unnest(array['public.is_active_household_member(uuid)', 'public.get_my_household_memberships()',
  'public.create_first_household(uuid,text,text)']) f;
select ok(not has_function_privilege('anon', f, 'EXECUTE'), 'Anonymous cannot execute: ' || f)
from unnest(array['public.is_active_household_member(uuid)', 'public.get_my_household_memberships()',
  'public.create_first_household(uuid,text,text)']) f;
select ok(not exists (
  select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
  where p.oid = f::regprocedure and a.grantee = 0
), 'No PUBLIC function grant: ' || f)
from unnest(array['public.is_active_household_member(uuid)', 'public.get_my_household_memberships()',
  'public.create_first_household(uuid,text,text)']) f;
select ok(has_column_privilege('authenticated', t, c, 'SELECT'), 'Minimal SELECT column: ' || t || '.' || c)
from (values ('public.households','id'), ('public.households','name'), ('public.households','default_currency'),
  ('public.household_members','id'), ('public.household_members','household_id'),
  ('public.household_members','profile_id'), ('public.household_members','role')) allowed(t, c);
select ok(not has_column_privilege('authenticated', t, c, 'SELECT'), 'Audit/lifecycle column is not granted: ' || t || '.' || c)
from (values ('public.households','created_by'), ('public.households','created_at'), ('public.households','updated_at'),
  ('public.household_members','joined_at'), ('public.household_members','left_at')) denied(t, c);
select ok(not has_table_privilege('authenticated', t, privilege_name), 'No direct table ' || privilege_name || ': ' || t)
from unnest(array['public.households','public.household_members']) t
cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege_name;
select ok(not has_any_column_privilege('authenticated', t, privilege_name), 'No direct column ' || privilege_name || ': ' || t)
from unnest(array['public.households','public.household_members']) t
cross join unnest(array['INSERT','UPDATE','REFERENCES']) privilege_name;
select ok(not has_any_column_privilege('anon', t, 'SELECT'), 'No anonymous columns: ' || t)
from unnest(array['public.households','public.household_members']) t;
select is((select count(*) from pg_policies where schemaname = 'public'
  and tablename in ('households','household_members') and cmd <> 'SELECT'), 0::bigint,
  'Only read policies were opened');

-- Seed fixed-ID base fixtures as the test role, since clients deliberately have
-- no INSERT(id) grant for these tables. Populate financial facts and every audit
-- source below through real owner-authorized operations, avoiding vacuous checks.
insert into public.budget_periods(id,profile_id,starts_on,ends_on,base_currency)
select pg_temp.id(n+p),owner_id,case when p=3 then (date_trunc('month',statement_timestamp() at time zone 'UTC')+interval '120 months')::date else make_date(2025,p,1) end,
  (case when p=3 then date_trunc('month',statement_timestamp() at time zone 'UTC')+interval '120 months' else make_date(2025,p,1)::timestamp end+interval '1 month -1 day')::date,'USD'
from (values (1000,'f0050000-0000-4000-8000-000000000001'::uuid),
  (2000,'f0050000-0000-4000-8000-000000000002'::uuid)) owners(n,owner_id)
cross join generate_series(1,6) p;
insert into public.budget_buckets(id,profile_id,name,type)
select pg_temp.id(n+b),owner_id,'Private '||kind,kind
from (values (1000,'f0050000-0000-4000-8000-000000000001'::uuid),
  (2000,'f0050000-0000-4000-8000-000000000002'::uuid)) owners(n,owner_id)
cross join (values (10,'SPENDABLE'),(11,'SAVINGS')) buckets(b,kind);
insert into public.categories(id,profile_id,name,budget_bucket_id)
select pg_temp.id(n+20),owner_id,'Private category',pg_temp.id(n+10)
from (values (1000,'f0050000-0000-4000-8000-000000000001'::uuid),
  (2000,'f0050000-0000-4000-8000-000000000002'::uuid)) owners(n,owner_id);
create function pg_temp.seed_private(n integer) returns void
language plpgsql security invoker set search_path = '' as $$
declare preview jsonb;
begin
  perform public.save_budget_allocations(pg_temp.id(n+p),pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('budget_bucket_id',pg_temp.id(n+10),'percentage_basis_points',8000),
    pg_catalog.jsonb_build_object('budget_bucket_id',pg_temp.id(n+11),'percentage_basis_points',2000)))
    from generate_series(1,6) p;
  perform public.register_income(pg_temp.id(n+30),pg_temp.id(n+1),n+1000,'USD','2025-01-02');
  perform public.register_personal_expense(pg_temp.id(n+31),pg_temp.id(n+1),100,'USD','2025-01-03',pg_temp.id(n+20));
  update public.transactions set description = 'Private audited description' where id = pg_temp.id(n+31);
  perform public.create_personal_savings_goal(pg_temp.id(n+40),'Private savings goal',100,'USD');
  perform public.create_personal_recurring_expense(pg_temp.id(n+41),'Private future template',pg_temp.id(n+20),
    'FIXED','USD',1,(pg_catalog.date_trunc('month',pg_catalog.statement_timestamp() at time zone 'UTC')
      + interval '120 months')::date,null,10);
  preview := public.get_personal_remainder_context('2025-01-01');
  perform public.close_and_dispose_personal_remainder(pg_temp.id(n+50),pg_temp.id(n+1),0,
    preview->>'preview_hash','CARRY_BUCKET',100,pg_temp.id(n+2),pg_temp.id(n+10),true);
  preview := public.get_personal_carry_reversal_context(pg_temp.id(n+50));
  perform public.reverse_carry_and_reopen_personal_period(pg_temp.id(n+51),pg_temp.id(n+50),1,0,
    preview->>'preview_hash',true);
  -- FIN-204: retain a valid CLOSED period and an active carry for cross-owner
  -- lifecycle attempts, alongside the original nonempty history fixture.
  perform public.register_income(pg_temp.id(n+32),pg_temp.id(n+4),1000,'USD','2025-04-02');
  preview := public.get_personal_remainder_context('2025-04-01');
  perform public.close_and_dispose_personal_remainder(pg_temp.id(n+54),pg_temp.id(n+4),0,
    preview->>'preview_hash','CARRY_BUCKET',100,pg_temp.id(n+5),pg_temp.id(n+10),true);
  -- June has no outgoing carry and is a valid standalone reopen target.
  preview := public.get_personal_period_close_context('2025-06-01');
  perform public.close_personal_budget_period(pg_temp.id(n+55),pg_temp.id(n+6),0,
    preview->>'snapshot_hash',true);
  perform public.prepare_initial_budget_buckets();
end;
$$;
create function pg_temp.assert_private_sources(expect_rows boolean) returns setof text
language plpgsql security invoker as $$
declare source record; visible bigint; foreign_rows bigint;
begin
  for source in select * from (values
    ('profiles','id'), ('budget_periods','profile_id'), ('budget_buckets','profile_id'),
    ('categories','profile_id'), ('transactions','owner_profile_id'), ('savings_goals','owner_profile_id'),
    ('recurring_expenses','owner_profile_id'), ('transaction_revisions','owner_profile_id'),
    ('budget_period_closures','owner_profile_id'), ('budget_period_reopenings','owner_profile_id'),
    ('budget_period_dispositions','owner_profile_id'), ('budget_period_carry_reversals','owner_profile_id')
  ) sources(table_name, owner_column) loop
    execute format('select count(*),count(*) filter (where %I <> auth.uid()) from public.%I',
      source.owner_column, source.table_name) into visible, foreign_rows;
    return next is(foreign_rows, 0::bigint, 'Household access never exposes partner private ' || source.table_name);
    return next is(visible > 0, expect_rows or source.table_name = 'profiles',
      'Nonvacuous expected owner-only visibility: ' || source.table_name);
  end loop;
  select count(*), count(*) filter (where not exists (
    select 1 from public.budget_periods p where p.id = a.budget_period_id and p.profile_id = auth.uid()
  )) into visible, foreign_rows from public.budget_allocations a;
  return next is(foreign_rows, 0::bigint, 'Household access never exposes partner allocations');
  return next is(visible > 0, expect_rows, 'Nonvacuous owner allocation visibility');
end;
$$;

\ir helpers/household_privacy.sql.inc

set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text, 'authenticated', 'A setup uses real authenticated role');
select is(auth.uid(), 'f0050000-0000-4000-8000-000000000001'::uuid, 'A setup uses genuine auth.uid');
select pg_temp.seed_private(1000);
select pg_temp.prepare_private_rpc_cases(1000);
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000002');
select is(current_user::text, 'authenticated', 'B setup uses real authenticated role');
select is(auth.uid(), 'f0050000-0000-4000-8000-000000000002'::uuid, 'B setup uses genuine auth.uid');
select pg_temp.seed_private(2000);
select pg_temp.prepare_private_rpc_cases(2000);
reset role;
select pg_temp.set_jwt_subject(null);
select is(current_user::text,session_user::text,'Privacy baseline uses trusted test role');
select is(auth.uid(),null::uuid,'Privacy baseline clears identity');
do $snapshot$ begin perform set_config('fin204.private_before',pg_temp.private_rows()::text,true); end; $snapshot$;

reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text, 'authenticated', 'Active OWNER read runs as client');
select is(auth.uid(), 'f0050000-0000-4000-8000-000000000001'::uuid, 'Active OWNER identity verified');
select is(public.is_active_household_member(pg_temp.id(100)), true, 'Helper authorizes own active membership');
select is(public.is_active_household_member(pg_temp.id(102)), false, 'Helper cannot authorize unrelated household');
select is(public.is_active_household_member(null), false, 'Null household cannot authorize');
select results_eq('select id from public.households order by id', array[pg_temp.id(100),pg_temp.id(101)],
  'OWNER and MEMBER labels both permit active collection reads');
select results_eq('select id from public.household_members order by id',
  array[pg_temp.id(110),pg_temp.id(111),pg_temp.id(113),pg_temp.id(114)],
  'Only active members in authorized households are readable');
select throws_ok('select created_by from public.households', '42501', null, 'Grant denial is not mistaken for RLS filtering');
select throws_ok('select left_at from public.household_members', '42501', null, 'Membership lifecycle metadata remains ungranted');
select set_config('fin202.a_snapshot', public.get_my_household_memberships()::text, true);
select is(current_setting('fin202.a_snapshot')::jsonb, jsonb_build_object(
  'profile_id',auth.uid(),'creation_status','ACTIVE_MEMBERSHIP','households',jsonb_build_array(
    jsonb_build_object('id',pg_temp.id(100),'name','Synthetic Home','default_currency','UYU','members',jsonb_build_array(
      jsonb_build_object('id',pg_temp.id(110),'profile_id','f0050000-0000-4000-8000-000000000001','display_name','Synthetic owner A','role','OWNER'),
      jsonb_build_object('id',pg_temp.id(111),'profile_id','f0050000-0000-4000-8000-000000000002','display_name','Synthetic partner B','role','MEMBER'))),
    jsonb_build_object('id',pg_temp.id(101),'name','Synthetic Second','default_currency','EUR','members',jsonb_build_array(
      jsonb_build_object('id',pg_temp.id(113),'profile_id','f0050000-0000-4000-8000-000000000001','display_name','Synthetic owner A','role','MEMBER'),
      jsonb_build_object('id',pg_temp.id(114),'profile_id','f0050000-0000-4000-8000-000000000002','display_name','Synthetic partner B','role','OWNER')))
  )), 'Exact complete DTO has only household/member identity, names and role, never private Profile fields');
select * from pg_temp.assert_private_sources(true);
select * from pg_temp.assert_private_rpcs(1000,2000);
select throws_ok($$select public.get_savings_availability(pg_temp.id(2001))$$,'42501',null,'Partner savings RPC remains unauthorized');
select throws_ok($$select public.get_bucket_consumption(pg_temp.id(2001))$$,'42501',null,'Partner budget RPC remains unauthorized');
select throws_ok($$select public.get_personal_safe_to_spend(pg_temp.id(2001))$$,'42501',null,'Partner safe-to-spend RPC remains unauthorized');
select throws_ok($$select public.get_personal_carry(pg_temp.id(2001))$$,'42501',null,'Partner carry RPC remains unauthorized');
select results_eq($$update public.profiles set display_name='Forged partner name'
  where id='f0050000-0000-4000-8000-000000000002' returning id$$,array[]::uuid[],
  'Household names projection grants no partner Profile write');
select results_eq($$update public.transactions set description='Forged partner financial edit'
  where id=pg_temp.id(2031) returning id$$,array[]::uuid[], 'Household membership grants no partner transaction write');
select throws_ok($$insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date)
  values('f0050000-0000-4000-8000-000000000002',pg_temp.id(2001),'INCOME',1,'USD','2025-01-02')$$,
  '42501',null,'Household membership cannot forge partner financial ownership');
select throws_ok($$insert into public.households(id,name,default_currency,created_by)
  values(pg_temp.id(300),'Forged','USD',auth.uid())$$,'42501',null,'OWNER cannot directly insert a household');
select throws_ok($$insert into public.household_members(household_id,profile_id,role)
  values(pg_temp.id(102),auth.uid(),'OWNER')$$,'42501',null,'OWNER cannot self-enroll elsewhere');
select throws_ok($$update public.households set name='Forged' where id=pg_temp.id(100)$$,'42501',null,'OWNER has no household-edit powers');
select throws_ok($$update public.household_members set role='OWNER' where id=pg_temp.id(111)$$,'42501',null,'OWNER has no role-management powers');
select throws_ok($$update public.household_members set left_at=null where id=pg_temp.id(112)$$,'42501',null,'OWNER cannot revive departed members');
select throws_ok('delete from public.household_members','42501',null,'OWNER cannot remove members');
select throws_ok('delete from public.households','42501',null,'OWNER cannot delete households');

reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000002');
select is(current_user::text,'authenticated','Active MEMBER runs as client');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000002'::uuid,'Active MEMBER identity verified');
select is(public.get_my_household_memberships() - 'profile_id',current_setting('fin202.a_snapshot')::jsonb - 'profile_id',
  'MEMBER sees the identical authorized minimal household snapshot');
select * from pg_temp.assert_private_sources(true);
select * from pg_temp.assert_private_rpcs(2000,1000);
select throws_ok($$select public.get_savings_availability(pg_temp.id(1001))$$,'42501',null,'MEMBER cannot query OWNER savings');
select throws_ok($$update public.household_members set role='OWNER' where id=pg_temp.id(111)$$,'42501',null,'MEMBER cannot escalate role');
select throws_ok($$select public.create_first_household(pg_temp.id(300),'Another','USD')$$,'23505',null,'Active membership blocks another creation');
select throws_ok($$select public.create_first_household(pg_temp.id(100),'Synthetic Home','UYU')$$,'23505',null,
  'Active membership alone cannot replay another creator request');

reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000003');
select is(current_user::text,'authenticated','Unrelated C runs as client');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000003'::uuid,'Unrelated C identity verified');
select results_eq('select id from public.households',array[pg_temp.id(102)],'C reads only C household, never A/B');
select results_eq('select id from public.household_members',array[pg_temp.id(115)],'C reads no A/B or inactive identities');
select is(public.get_my_household_memberships()#>>'{households,0,id}',pg_temp.id(102)::text,'C projection contains only C authorized household');
select is(jsonb_array_length(public.get_my_household_memberships()->'households'),1,'C cannot enumerate other households');
select * from pg_temp.assert_private_sources(false);
select * from pg_temp.assert_private_rpcs(null,1000);
select * from pg_temp.assert_private_rpcs(null,2000);
reset role;
select pg_temp.set_jwt_subject(null);
select is(current_user::text,session_user::text,'No-write verification uses trusted role');
select is(auth.uid(),null::uuid,'No-write verification clears identity');
select is(pg_temp.private_rows(),current_setting('fin204.private_before')::jsonb,
  'All partner/stranger attempts leave every private row, amount, lifecycle and audit byte unchanged');

-- psql executes each explicit role transition at top level. The trusted snapshot
-- is never callable by an authenticated actor; no definer bypass is used in tests.
-- Each payload already succeeded in an owner probe, with its writes rolled back.
select format($matrix$
reset role;
select pg_temp.set_jwt_subject(null);
select is(current_user::text,session_user::text,'Trusted before-state: %1$s');
select is(auth.uid(),null::uuid,'Cleared before-state: %1$s');
do $snapshot$ begin perform set_config('fin204.attempt_before',pg_temp.private_rows()::text,true); end; $snapshot$;
set local role authenticated;
select pg_temp.set_jwt_subject(%2$L);
select is(current_user::text,'authenticated','Real attacker role: %1$s');
select is(auth.uid(),%2$L::uuid,'Real attacker identity: %1$s');
select is(pg_temp.probe_private_mutation(%3$L,false),%4$L,'Cross-owner denial: %1$s');
reset role;
select pg_temp.set_jwt_subject(null);
select is(current_user::text,session_user::text,'Trusted after-state: %1$s');
select is(auth.uid(),null::uuid,'Cleared after-state: %1$s');
select is(pg_temp.private_rows(),current_setting('fin204.attempt_before')::jsonb,
  'No private writes or audit/lifecycle changes: %1$s');
$matrix$,cases.label||' target '||cases.owner_base||' attacker '||attackers.actor,
  attackers.actor,cases.command,cases.denied_state)
from pg_temp.private_rpc_cases cases
cross join (values
  ('f0050000-0000-4000-8000-000000000001'::uuid,1000),
  ('f0050000-0000-4000-8000-000000000002'::uuid,2000),
  ('f0050000-0000-4000-8000-000000000003'::uuid,3000)
) attackers(actor,owner_base)
where attackers.owner_base<>cases.owner_base
order by cases.owner_base,cases.label,attackers.actor
\gexec


reset role;
set local role authenticated;
select pg_temp.set_jwt_subject(pg_temp.id(1));
select is(current_user::text,'authenticated','Departed member runs as client');
select is(auth.uid(),pg_temp.id(1),'Departed member identity verified');
select is((select count(id) from public.households),0::bigint,'Inactive MEMBER and OWNER have no household access');
select is((select count(id) from public.household_members),0::bigint,'Departed member cannot read even own historical membership');
select is(public.is_active_household_member(pg_temp.id(100)),false,'Helper denies departed member');
select is(public.get_my_household_memberships(),jsonb_build_object('profile_id',auth.uid(),
  'creation_status','PREVIOUS_MEMBERSHIP','households','[]'::jsonb),'Only prior-history state is revealed, never past household identity/name/members');
select throws_ok($$select public.create_first_household(pg_temp.id(300),'No revival','USD')$$,'23505',null,
  'Any historical membership blocks new first-household creation');

reset role;
set local role authenticated;
select pg_temp.set_jwt_subject(pg_temp.id(2));
select is(current_user::text,'authenticated','Creator-only runs as client');
select is(auth.uid(),pg_temp.id(2),'Creator-only identity verified');
select is((select count(id) from public.households),0::bigint,'Creator provenance grants no SELECT authorization');
select is((select count(id) from public.household_members),0::bigint,'Creator provenance grants no member discovery');
select is(public.get_my_household_memberships(),jsonb_build_object('profile_id',auth.uid(),
  'creation_status','ELIGIBLE','households','[]'::jsonb),'Creator audit is not membership or history');
select throws_ok($$select public.create_first_household(pg_temp.id(102),'Synthetic Unrelated','USD')$$,'42501',null,
  'Even matching creator/payload cannot replay without current active membership');

reset role;
set local role authenticated;
select pg_temp.set_jwt_subject(pg_temp.id(4));
select is(current_user::text,'authenticated','No-Profile identity runs as client');
select is(auth.uid(),pg_temp.id(4),'No-Profile auth.uid verified');
select is((select count(id) from public.households),0::bigint,'Auth identity alone does not authorize households');
select throws_ok('select public.get_my_household_memberships()','42501',null,'Projection requires application Profile');
select throws_ok($$select public.create_first_household(pg_temp.id(300),'No Profile','USD')$$,'42501',null,'Creation requires application Profile');

reset role;
set local role authenticated;
select pg_temp.set_jwt_subject(pg_temp.id(3));
select is(current_user::text,'authenticated','Eligible F runs as client');
select is(auth.uid(),pg_temp.id(3),'Eligible F identity verified');
select is(public.get_my_household_memberships(),jsonb_build_object('profile_id',auth.uid(),
  'creation_status','ELIGIBLE','households','[]'::jsonb),'Stranger with no membership sees only own eligibility');
select is((select count(id) from public.households),0::bigint,'Stranger cannot enumerate households through column grant');
select is((select count(id) from public.household_members),0::bigint,'Stranger cannot enumerate membership through column grant');
select throws_ok($$select public.create_first_household(null,'Home','USD')$$,'22023',null,'Missing request UUID rejected');
select throws_ok(format('select public.create_first_household(%L,%L,%L)',pg_temp.id(200),n,'USD'),
  '22023',null,'Invalid bounded nonblank name rejected') from unnest(array[null,'',E' \t\n',repeat('x',101)]::text[]) n;
select throws_ok(format('select public.create_first_household(%L,%L,%L)',pg_temp.id(200),'Home',c),
  '22023',null,'Invalid currency shape rejected') from unnest(array[null,'usd','US','U1D',' USD','USD ']::text[]) c;
select throws_ok($$select public.create_first_household(pg_temp.id(100),'Synthetic Home','UYU')$$,'23505',null,
  'Stranger cannot claim an existing UUID even with its exact payload');

-- Inject failure at the second write, not the first: the household must disappear
-- with the failed atomic operation. This test-only trigger is removed immediately.
reset role;
select pg_temp.set_jwt_subject(null);
select is(current_user::text,session_user::text,'Atomicity injection uses privileged test role');
select is(auth.uid(),null::uuid,'Test setup clears identity');
create function pg_temp.reject_test_membership() returns trigger language plpgsql as $$
begin
  if new.household_id=pg_temp.id(201) then
    raise exception 'Synthetic membership failure' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger fin202_reject_test_membership before insert on public.household_members
  for each row execute function pg_temp.reject_test_membership();
set local role authenticated;
select pg_temp.set_jwt_subject(pg_temp.id(3));
select is(current_user::text,'authenticated','Atomicity call uses client role');
select is(auth.uid(),pg_temp.id(3),'Atomicity actor verified');
select throws_ok($$select public.create_first_household(pg_temp.id(201),'Synthetic rollback','USD')$$,
  '23514','Synthetic membership failure','Failure of membership insert rejects the whole operation');
select is(public.get_my_household_memberships()->>'creation_status','ELIGIBLE','Failed operation leaves no membership history');
reset role;
select pg_temp.set_jwt_subject(null);
select is(current_user::text,session_user::text,'Atomicity verification uses privileged role');
select is(auth.uid(),null::uuid,'Atomicity verification clears identity');
select is((select count(*) from public.households where id=pg_temp.id(201)),0::bigint,'No orphan household after failed second write');
select is((select count(*) from public.household_members where household_id=pg_temp.id(201)),0::bigint,'No partial membership after failed second write');
drop trigger fin202_reject_test_membership on public.household_members;

set local role authenticated;
select pg_temp.set_jwt_subject(pg_temp.id(3));
select is(current_user::text,'authenticated','Creation/replay uses client role');
select is(auth.uid(),pg_temp.id(3),'Creation/replay actor verified');
select is(public.create_first_household(pg_temp.id(200),' Synthetic first home ','ZZZ'),
  jsonb_build_object('household_id',pg_temp.id(200)),'Atomic creation returns only household UUID; shape-valid currency/name retained');
select is(public.get_my_household_memberships()->>'creation_status','ACTIVE_MEMBERSHIP','Creation immediately produces active state');
select is(public.get_my_household_memberships()#>>'{households,0,members,0,profile_id}',auth.uid()::text,'Creator gets an explicit self membership');
select is(public.get_my_household_memberships()#>>'{households,0,members,0,role}','OWNER','Initial role is explicit OWNER');
select is(public.create_first_household(pg_temp.id(200),' Synthetic first home ','ZZZ'),
  jsonb_build_object('household_id',pg_temp.id(200)),'Exact active retry is idempotent');
select throws_ok($$select public.create_first_household(pg_temp.id(200),'Changed','ZZZ')$$,'23505',null,'Changed name under request UUID conflicts');
select throws_ok($$select public.create_first_household(pg_temp.id(200),' Synthetic first home ','USD')$$,'23505',null,'Changed currency under request UUID conflicts');
select throws_ok($$select public.create_first_household(pg_temp.id(202),'Another','USD')$$,'23505',null,'New UUID cannot bypass existing history');
select is((select count(id) from public.households),1::bigint,'Retries do not create duplicate household');
select is((select count(id) from public.household_members),1::bigint,'Retries do not create duplicate membership');

reset role;
select pg_temp.set_jwt_subject(null);
select is(current_user::text,session_user::text,'Trusted membership fixture update uses privileged role');
select is(auth.uid(),null::uuid,'Trusted fixture update clears stale identity');
select is((select created_by from public.households where id=pg_temp.id(200)),pg_temp.id(3),'Actor-derived creator cannot be forged');
update public.household_members set role='MEMBER' where household_id=pg_temp.id(200);
set local role authenticated;
select pg_temp.set_jwt_subject(pg_temp.id(3));
select is(current_user::text,'authenticated','Current MEMBER retry uses client role');
select is(auth.uid(),pg_temp.id(3),'Current MEMBER retry actor verified');
select is(public.create_first_household(pg_temp.id(200),' Synthetic first home ','ZZZ'),
  jsonb_build_object('household_id',pg_temp.id(200)),'Replay depends on active membership, not current OWNER label');
reset role;
select pg_temp.set_jwt_subject(null);
select is(current_user::text,session_user::text,'Trusted revocation fixture uses privileged role');
select is(auth.uid(),null::uuid,'Revocation fixture clears identity');
update public.household_members set left_at=statement_timestamp() where household_id=pg_temp.id(200);
set local role authenticated;
select pg_temp.set_jwt_subject(pg_temp.id(3));
select is(current_user::text,'authenticated','Revoked retry uses client role');
select is(auth.uid(),pg_temp.id(3),'Revoked retry actor verified');
select is(public.get_my_household_memberships(),jsonb_build_object('profile_id',auth.uid(),
  'creation_status','PREVIOUS_MEMBERSHIP','households','[]'::jsonb),'Next snapshot immediately removes revoked household and member names');
select throws_ok($$select public.create_first_household(pg_temp.id(200),' Synthetic first home ','ZZZ')$$,'42501',null,
  'Exact original request cannot reveal or revive revoked membership');
select is((select count(id) from public.households),0::bigint,'Revoked creator cannot read direct household columns');
select is((select count(id) from public.household_members),0::bigint,'Revoked creator cannot read direct member columns');

reset role;
set local role authenticated;
select pg_temp.set_jwt_subject(null);
select is(current_user::text,'authenticated','Missing JWT tests use authenticated role');
select is(auth.uid(),null::uuid,'Missing JWT cannot retain last actor');
select is(public.is_active_household_member(pg_temp.id(100)),false,'Helper denies role without identity');
select is((select count(id) from public.households),0::bigint,'RLS denies role without identity');
select throws_ok('select public.get_my_household_memberships()','42501',null,'Projection rejects missing identity');
select throws_ok($$select public.create_first_household(pg_temp.id(300),'No actor','USD')$$,'42501',null,'Creation rejects missing identity');
reset role;
set local role anon;
select pg_temp.set_jwt_subject(null);
select is(current_user::text,'anon','Anonymous tests use real anon role');
select is(auth.uid(),null::uuid,'Anonymous identity is empty');
select throws_ok('select public.get_my_household_memberships()','42501',null,'Anonymous projection execution denied');
select throws_ok($$select public.is_active_household_member(pg_temp.id(100))$$,'42501',null,'Anonymous helper execution denied');
select throws_ok($$select public.create_first_household(pg_temp.id(300),'Anon','USD')$$,'42501',null,'Anonymous creation execution denied');
select throws_ok('select id from public.households','42501',null,'Anonymous has no minimal column privilege');
select throws_ok('select id from public.household_members','42501',null,'Anonymous has no membership column privilege');

reset role;
select pg_temp.set_jwt_subject(null);
select is(current_user::text,session_user::text,'Final checks restore privileged role');
select is(auth.uid(),null::uuid,'Final checks clear identity');
select is((select count(*) from public.households),5::bigint,'Only one requested household was created');
select is((select count(*) from public.household_members),8::bigint,'Only one explicit membership was created');
select is((select count(*) from public.household_members where household_id=pg_temp.id(200) and left_at is not null),1::bigint,
  'Revoked membership remains inactive with original identity, never rejoined');
select * from finish();
rollback;
