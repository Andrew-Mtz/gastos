\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
\ir helpers/auth.sql.inc
select no_plan();
insert into public.profiles(id,display_name,base_currency,timezone)
select id,'Synthetic','USD','UTC' from auth.users where id::text like 'f0050000%';
insert into public.budget_periods(id,profile_id,starts_on,ends_on,base_currency,expected_income_minor) values
 ('f1030000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','2026-10-01','2026-10-31','USD',150000),
 ('f1030000-0000-4000-8000-000000000002','f0050000-0000-4000-8000-000000000002','2026-10-01','2026-10-31','USD',999999);
insert into public.budget_buckets(id,profile_id,name,type) values
('f1040000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','Needs','SPENDABLE');
insert into public.budget_allocations(budget_period_id,budget_bucket_id,percentage_basis_points) values
('f1030000-0000-4000-8000-000000000001','f1040000-0000-4000-8000-000000000001',10000);
select is((select prosecdef from pg_proc where oid='public.register_income(uuid,uuid,bigint,text,date,text)'::regprocedure),false,'Registration is invoker');
select is((select prosecdef from pg_proc where oid='public.get_received_income(uuid)'::regprocedure),false,'Aggregate is invoker');
select ok(not has_function_privilege('anon','public.get_received_income(uuid)','EXECUTE'),'Anonymous aggregate denied');
select ok(not has_function_privilege('anon','public.register_income(uuid,uuid,bigint,text,date,text)','EXECUTE'),'Anonymous registration denied');
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','A client role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'A subject');
select is(public.get_received_income('f1030000-0000-4000-8000-000000000001'),0::bigint,'Expected income is not received income');
select lives_ok($$select public.register_income('f1090000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001',100000,'USD','2026-10-01','Salary')$$,'Register actual income');
select is(public.get_received_income('f1030000-0000-4000-8000-000000000001'),100000::bigint,'Expected1500 received1000 example');
select set_config('test.income_created_at',(select created_at::text from public.transactions where id='f1090000-0000-4000-8000-000000000001'),true);
select lives_ok($$select public.register_income('f1090000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001',100000,'USD','2026-10-01','Salary')$$,'Identical retry succeeds');
select is((select count(*) from public.transactions),1::bigint,'Retry never duplicates money');
select is((select created_at from public.transactions where id='f1090000-0000-4000-8000-000000000001'),current_setting('test.income_created_at')::timestamptz,'Replay preserves timestamps');
select throws_ok($$select public.register_income('f1090000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001',99999,'USD','2026-10-01','Salary')$$,'23505',null,'Changed payload cannot reuse identity');
select lives_ok($$select public.register_income('f1090000-0000-4000-8000-000000000002','f1030000-0000-4000-8000-000000000001',43000,'USD','2026-10-15')$$,'Multiple incomes in one month');
select is(public.get_received_income('f1030000-0000-4000-8000-000000000001'),143000::bigint,'Actual amounts aggregate exactly');
select is((select expected_income_minor from public.budget_periods where id='f1030000-0000-4000-8000-000000000001'),150000::bigint,'Expected estimate remains unchanged');
select lives_ok($$insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date)
values('f0050000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001','SAVINGS_CONTRIBUTION',1234,'USD','2026-10-15')$$,'Non-income fixture');
select is(public.get_received_income('f1030000-0000-4000-8000-000000000001'),143000::bigint,'Non-income is excluded');
select lives_ok($$update public.transactions set deleted_at=now() where id='f1090000-0000-4000-8000-000000000001'$$,'Soft delete actual income');
select is(public.get_received_income('f1030000-0000-4000-8000-000000000001'),43000::bigint,'Deleted income is excluded');
select throws_ok($$select public.register_income('f1090000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001',100000,'USD','2026-10-01','Salary')$$,'23505',null,'Replay cannot resurrect removed income');
select lives_ok($$update public.transactions set deleted_at=null where id='f1090000-0000-4000-8000-000000000001'$$,'Explicit restore');
select throws_ok($$select public.register_income('f1090000-0000-4000-8000-000000000003','f1030000-0000-4000-8000-000000000001',100,'UYU','2026-10-01')$$,'23514',null,'No implicit currency conversion');
select throws_ok($$select public.register_income('f1090000-0000-4000-8000-000000000003','f1030000-0000-4000-8000-000000000001',0,'USD','2026-10-01')$$,'23514',null,'Zero income denied');
select throws_ok($$select public.get_received_income('f1030000-0000-4000-8000-000000000002')$$,'42501',null,'A cannot read foreign aggregate');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000002');
select is(current_user::text,'authenticated','Negative client role 2');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000002'::uuid,'Negative subject 2');
select throws_ok($$select public.get_received_income('f1030000-0000-4000-8000-000000000001')$$,'42501',null,'Foreign aggregate denied 2');
select throws_ok($$select public.register_income('f1090000-0000-4000-8000-000000000003','f1030000-0000-4000-8000-000000000001',100,'USD','2026-10-01')$$,'42501',null,'Foreign registration denied 2');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000003');
select is(current_user::text,'authenticated','Negative client role 3');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000003'::uuid,'Negative subject 3');
select throws_ok($$select public.get_received_income('f1030000-0000-4000-8000-000000000001')$$,'42501',null,'Foreign aggregate denied 3');
select throws_ok($$select public.register_income('f1090000-0000-4000-8000-000000000003','f1030000-0000-4000-8000-000000000001',100,'USD','2026-10-01')$$,'42501',null,'Foreign registration denied 3');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject(null);
select is(auth.uid(),null::uuid,'No identity');
select throws_ok($$select public.get_received_income('f1030000-0000-4000-8000-000000000001')$$,'42501',null,'Missing identity denied');
reset role;
select pg_temp.set_jwt_subject(null);
update public.budget_periods set status='CLOSED',closed_at=now() where id='f1030000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'A closed-period subject');
select is(public.get_received_income('f1030000-0000-4000-8000-000000000001'),143000::bigint,'Closed total readable');
select lives_ok($$select public.register_income('f1090000-0000-4000-8000-000000000002','f1030000-0000-4000-8000-000000000001',43000,'USD','2026-10-15')$$,'Closed identical replay is read-only');
select throws_ok($$select public.register_income('f1090000-0000-4000-8000-000000000003','f1030000-0000-4000-8000-000000000001',100,'USD','2026-10-01')$$,'42501',null,'Closed new income rejected');
reset role;
select pg_temp.set_jwt_subject(null);
update public.budget_periods set status='OPEN',closed_at=null where id='f1030000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select lives_ok($$select public.register_income('f1090000-0000-4000-8000-000000000003','f1030000-0000-4000-8000-000000000001',9007199254740991,'USD','2026-10-01')$$,'Large safe single income');
select throws_ok($$select public.get_received_income('f1030000-0000-4000-8000-000000000001')$$,'22003',null,'Aggregate overflow rejects rather than rounds');
reset role;
select * from finish();
rollback;
