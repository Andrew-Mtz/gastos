\set ON_ERROR_STOP on
begin isolation level repeatable read;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_catalog;
\ir helpers/auth.sql.inc
select no_plan();
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','Actual client role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'Actual authenticated identity');
select throws_ok($$select public.correct_personal_transaction(gen_random_uuid(),gen_random_uuid(),0,'DELETE','{}',true)$$,'0A000','Transaction corrections require READ COMMITTED isolation','Snapshot isolation cannot read stale funding or optimistic revision');
reset role;
select * from finish();
rollback;
