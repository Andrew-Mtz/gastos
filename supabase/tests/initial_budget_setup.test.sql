\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
\ir helpers/auth.sql.inc
select no_plan();
insert into public.profiles (id, display_name, base_currency, timezone) values
 ('f0050000-0000-4000-8000-000000000001', 'A Test', 'USD', 'UTC'),
 ('f0050000-0000-4000-8000-000000000002', 'Partner Test', 'USD', 'UTC'),
 ('f0050000-0000-4000-8000-000000000003', 'Stranger Test', 'USD', 'UTC');
-- Household schema is not present yet; B is the partner persona.
create function pg_temp.shares(needs integer default 5000, leisure integer default 3000, savings integer default 2000)
returns jsonb language sql security invoker set search_path = '' as $$
 select jsonb_agg(jsonb_build_object('budget_bucket_id', id, 'percentage_basis_points',
 case system_key when 'NEEDS' then needs when 'LEISURE' then leisure else savings end))
 from public.budget_buckets where system_key is not null;
$$;
create function pg_temp.save_plan(month date, income bigint, shares jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
 perform public.save_initial_budget(month, 'USD', income, shares);
 set constraints public.budget_allocations_total_check immediate;
 set constraints public.budget_allocations_total_check deferred;
end;
$$;
grant execute on function pg_temp.shares(integer,integer,integer), pg_temp.save_plan(date,bigint,jsonb) to authenticated;
select is((select prosecdef from pg_proc where oid = 'public.prepare_initial_budget_buckets()'::regprocedure), true, 'Provisioning explicitly uses elevated system-bucket insertion');
select is((select prosecdef from pg_proc where oid = 'public.save_initial_budget(date,text,bigint,jsonb)'::regprocedure), false, 'Financial setup is invoker-only');
select is((select array_to_string(proconfig, ',') from pg_proc where oid = routine::regprocedure), 'search_path=""', routine || ' fixes its search path')
from unnest(array['public.prepare_initial_budget_buckets()', 'public.save_initial_budget(date,text,bigint,jsonb)']) routine;
select ok(not has_function_privilege(role_name, routine, 'EXECUTE'), role_name || ' cannot execute ' || routine)
from unnest(array['public', 'anon']) role_name cross join unnest(array['public.prepare_initial_budget_buckets()', 'public.save_initial_budget(date,text,bigint,jsonb)']) routine;
select ok(not has_column_privilege('authenticated','public.budget_buckets','system_key',privilege), 'Clients cannot forge default key with ' || privilege)
from unnest(array['INSERT','UPDATE']) privilege;
select has_index('public','budget_buckets','budget_buckets_profile_system_key','Default keys are unique per owner');
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','A client role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'A identity');
select lives_ok('select public.prepare_initial_budget_buckets()','A provisions defaults');
select is((select count(*) from public.budget_buckets),3::bigint,'Three private defaults');
select ok((select bool_and(profile_id = auth.uid() and is_system and archived_at is null) from public.budget_buckets),'Defaults belong only to A');
select is((select type from public.budget_buckets where system_key = 'SAVINGS'),'SAVINGS','Savings stays protected');
select set_config('test.bucket_ids',(select string_agg(id::text,',' order by id) from public.budget_buckets),true);
select lives_ok('select public.prepare_initial_budget_buckets()','Retry provisioning succeeds');
select is((select string_agg(id::text,',' order by id) from public.budget_buckets),current_setting('test.bucket_ids'),'Retry preserves exact identities');
select is((select count(*) from public.budget_periods),0::bigint,'Cancel after preparation has no financial period or allocations');
select results_eq($$update public.budget_buckets set name = 'Tampered' returning id$$,array[]::uuid[],'Defaults cannot be renamed');
select throws_ok($$update public.budget_buckets set system_key = null$$,'42501',null,'Default identity update denied by SQL grant');
select throws_ok($$insert into public.budget_buckets(profile_id,name,type,system_key) values(auth.uid(),'Fake','SPENDABLE','NEEDS')$$,'42501',null,'Default identity insertion denied by SQL grant');
select lives_ok($$select pg_temp.save_plan('2026-10-01',150001,pg_temp.shares())$$,'Initial plan saves atomically');
select is((select expected_income_minor from public.budget_periods where starts_on = '2026-10-01'),150001::bigint,'Expected income persists, never received income');
select is((select sum(percentage_basis_points) from public.budget_allocations),10000::bigint,'Complete plan persists');
select set_config('test.period_id',(select id::text from public.budget_periods where starts_on='2026-10-01'),true);
select set_config('test.period_updated',(select updated_at::text from public.budget_periods where starts_on='2026-10-01'),true);
select set_config('test.shares',pg_temp.shares()::text,true);
select lives_ok($$select pg_temp.save_plan('2026-10-01',150001,pg_temp.shares())$$,'Lost response retry succeeds');
select is((select count(*) from public.budget_periods),1::bigint,'Repeated submission creates no duplicate period');
select is((select count(*) from public.budget_allocations),3::bigint,'Repeated submission creates no duplicate allocations');
select is((select updated_at::text from public.budget_periods where starts_on='2026-10-01'),current_setting('test.period_updated'),'Retry does not rewrite timestamps');
select throws_ok($$select pg_temp.save_plan('2026-10-01',999,pg_temp.shares())$$,'23505',null,'Different repeated submission cannot overwrite plan');
select throws_ok($$select pg_temp.save_plan('2026-10-01',150001,pg_temp.shares(5000,2000,3000))$$,'23505',null,'Changed strategy conflicts instead of replacing initial setup');
select throws_ok($$select pg_temp.save_plan('2026-11-01',100,pg_temp.shares(4000,2000,3000))$$,'23514',null,'Incomplete percentages rejected');
select throws_ok($$select pg_temp.save_plan('2026-11-01',-1,pg_temp.shares())$$,'23514',null,'Negative income rejected');
select throws_ok($$select pg_temp.save_plan('2026-11-01',9007199254740992,pg_temp.shares())$$,'23514',null,'Unsafe income rejected');
select throws_ok($$select pg_temp.save_plan('2026-11-02',100,pg_temp.shares())$$,'22023',null,'Noncanonical month rejected');
select throws_ok(format('select pg_temp.save_plan(%L,100,%L::jsonb)','2026-11-01',bad),'22023',null,'Malformed complete set rejected') from unnest(array[null,'null','{}','[]','[null,null,null]','[{},{},{}]']) bad;
select is((select count(*) from public.budget_periods),1::bigint,'Failed operations leave no partial periods');
select lives_ok($$select pg_temp.save_plan('2026-11-01',null,pg_temp.shares(4500,1500,4000))$$,'Future initial plan permits unknown expected income');
select is((select expected_income_minor from public.budget_periods where starts_on='2026-11-01'),null::bigint,'Unknown remains distinct from zero');
select lives_ok($$select pg_temp.save_plan('2026-12-01',0,pg_temp.shares(0,0,10000))$$,'Zero expected income and zero shares are supported');
select is((select expected_income_minor from public.budget_periods where starts_on='2026-10-01'),150001::bigint,'Future setup preserves historical expected income');
reset role;
update public.budget_periods set status='CLOSED',closed_at=now() where id=current_setting('test.period_id')::uuid;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','Closed check uses client role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'Closed check uses A');
select throws_ok($$select pg_temp.save_plan('2026-10-01',150001,pg_temp.shares())$$,'42501',null,'Closed period rejects even identical setup');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000002');
select is(current_user::text,'authenticated','B client role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000002'::uuid,'B identity');
select is((select count(*) from public.budget_periods),0::bigint,'B cannot read A periods');
select is((select count(*) from public.budget_allocations),0::bigint,'B cannot read A allocations');
select is((select count(*) from public.budget_buckets),0::bigint,'B cannot read A defaults');
select throws_ok($$select pg_temp.save_plan('2026-10-01',100,current_setting('test.shares')::jsonb)$$,'42501',null,'B cannot reuse A default ids');
select lives_ok('select public.prepare_initial_budget_buckets()','B receives own defaults only');
select ok((select bool_and(profile_id=auth.uid()) from public.budget_buckets),'Definer does not leak A rows to B');
select lives_ok($$select pg_temp.save_plan('2026-10-01',100,pg_temp.shares())$$,'B independently saves same calendar month');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000003');
select is(current_user::text,'authenticated','C client role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000003'::uuid,'C identity');
select is((select count(*) from public.budget_buckets),0::bigint,'Unrelated C cannot read defaults');
select throws_ok($$select pg_temp.save_plan('2026-10-01',100,current_setting('test.shares')::jsonb)$$,'42501',null,'Unrelated C cannot reference A ids');
select pg_temp.set_jwt_subject(null);
select is(auth.uid(),null::uuid,'Missing identity');
select throws_ok('select public.prepare_initial_budget_buckets()','42501',null,'Missing identity cannot invoke elevated provisioning');
select throws_ok($$select pg_temp.save_plan('2026-10-01',100,current_setting('test.shares')::jsonb)$$,'42501',null,'Missing identity cannot save');
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000099');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000099'::uuid,'Missing-profile identity');
select throws_ok('select public.prepare_initial_budget_buckets()','42501',null,'Missing profile cannot provision');
reset role;
set local role anon;
select pg_temp.set_jwt_subject(null);
select is(current_user::text,'anon','Anonymous role');
select is(auth.uid(),null::uuid,'Anonymous identity');
select throws_ok('select public.prepare_initial_budget_buckets()','42501',null,'Anonymous execute denied');
select throws_ok($$select public.save_initial_budget('2026-10-01','USD',100,'[]')$$,'42501',null,'Anonymous save execute denied');
reset role;
select * from finish();
rollback;
