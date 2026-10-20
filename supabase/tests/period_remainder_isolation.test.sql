\set ON_ERROR_STOP on
begin isolation level repeatable read;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_catalog;
\ir helpers/auth.sql.inc
select no_plan();
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','Authenticated remainder role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'Authenticated remainder subject');
select throws_ok($$select public.close_and_dispose_personal_remainder(gen_random_uuid(),gen_random_uuid(),0,repeat('a',32),'SAVINGS',1,null,null,true)$$,'25001',null,'Snapshot-isolated disposition cannot bypass fresh serialized funds');
select throws_ok($$select public.reverse_carry_and_reopen_personal_period(gen_random_uuid(),gen_random_uuid(),1,0,repeat('a',32),true)$$,'25001',null,'Snapshot-isolated reversal cannot bypass live destination funds');
reset role;
select * from finish();
rollback;
