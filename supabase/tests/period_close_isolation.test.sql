\set ON_ERROR_STOP on
begin isolation level repeatable read;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_catalog;
\ir helpers/auth.sql.inc
select no_plan();
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','Authenticated role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'Authenticated subject');
select throws_ok($$select public.close_personal_budget_period(gen_random_uuid(),gen_random_uuid(),0,repeat('a',32),true)$$,'25001',null,'Snapshot-isolated close cannot bypass fresh locked facts');
reset role;
select * from finish();
rollback;
