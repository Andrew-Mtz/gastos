\set ON_ERROR_STOP on
begin isolation level serializable;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_catalog;
\ir helpers/auth.sql.inc
select no_plan();
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','Real authenticated role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'Authenticated subject');
select throws_ok($$select public.get_my_shared_responsibilities('2025-01-01')$$,'25001',null,'Own shared projection rejects stale isolation');
select throws_ok($$select public.get_personal_savings_context('2025-01-01')$$,'25001',null,'Savings context does not bypass fresh-source isolation');
select throws_ok($$select public.get_personal_dashboard('2025-01-01')$$,'25001',null,'No-period dashboard also rejects stale source isolation');
reset role;
select * from finish();
rollback;
