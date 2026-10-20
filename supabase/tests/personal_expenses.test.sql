\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
\ir helpers/auth.sql.inc
select no_plan();
insert into public.profiles(id,display_name,base_currency,timezone)
select id,'Synthetic','USD','UTC' from auth.users where id::text like 'f0050000%';
insert into public.budget_periods(id,profile_id,starts_on,ends_on,base_currency) values
('f1030000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','2026-10-01','2026-10-31','USD'),
('f1030000-0000-4000-8000-000000000002','f0050000-0000-4000-8000-000000000002','2026-10-01','2026-10-31','USD');
insert into public.budget_buckets(id,profile_id,name,type) values
('f1040000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','Needs','SPENDABLE'),
('f1040000-0000-4000-8000-000000000002','f0050000-0000-4000-8000-000000000001','Savings','SAVINGS');
insert into public.categories(id,profile_id,name,budget_bucket_id) values
('f1070000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','Food','f1040000-0000-4000-8000-000000000001'),
('f1070000-0000-4000-8000-000000000002','f0050000-0000-4000-8000-000000000001','Saving','f1040000-0000-4000-8000-000000000002'),
('f1070000-0000-4000-8000-000000000003','f0050000-0000-4000-8000-000000000001','Unmapped',null),
('f1070000-0000-4000-8000-000000000004','f0050000-0000-4000-8000-000000000002','Foreign',null);
select is((select prosecdef from pg_proc where oid='public.register_personal_expense(uuid,uuid,bigint,text,date,uuid,text)'::regprocedure),false,'RPC is invoker');
select is((select array_to_string(proconfig,',') from pg_proc where oid='public.register_personal_expense(uuid,uuid,bigint,text,date,uuid,text)'::regprocedure),'search_path=""','Empty search path');
select ok(not has_function_privilege('anon','public.register_personal_expense(uuid,uuid,bigint,text,date,uuid,text)','EXECUTE'),'No anonymous RPC grant');
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','A client role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'A identity');
select lives_ok($$select public.register_personal_expense('f1110000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001',12345,'USD','2026-10-20','f1070000-0000-4000-8000-000000000001','Food')$$,'Create actual expense');
select lives_ok($$select public.register_personal_expense('f1110000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001',12345,'USD','2026-10-20','f1070000-0000-4000-8000-000000000001','Food')$$,'Identical replay');
select is((select count(*) from public.transactions),1::bigint,'Replay is not duplicate');
select is((select type from public.transactions),'EXPENSE','Not income or savings');
select throws_ok($$select public.register_personal_expense('f1110000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001',12346,'USD','2026-10-20','f1070000-0000-4000-8000-000000000001','Food')$$,'23505',null,'Changed replay conflicts');
select throws_ok(format($q$select public.register_personal_expense(gen_random_uuid(),'f1030000-0000-4000-8000-000000000001',100,'USD','2026-10-20',%L)$q$,id),'42501',null,'Reject ineligible category '||coalesce(id,'null'))
from unnest(array['f1070000-0000-4000-8000-000000000002','f1070000-0000-4000-8000-000000000003','f1070000-0000-4000-8000-000000000004',null]) id;
select throws_ok($$insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date)
values(auth.uid(),'f1030000-0000-4000-8000-000000000001','EXPENSE',100,'USD','2026-10-20')$$,'42501',null,'Direct insert cannot bypass category rule');
select throws_ok($$select public.register_personal_expense(gen_random_uuid(),'f1030000-0000-4000-8000-000000000001',100,'UYU','2026-10-20','f1070000-0000-4000-8000-000000000001')$$,'23514',null,'No implicit conversion');
select throws_ok($$select public.register_personal_expense(gen_random_uuid(),'f1030000-0000-4000-8000-000000000002',100,'USD','2026-10-20','f1070000-0000-4000-8000-000000000001')$$,'42501',null,'Foreign period denied');
select throws_ok($$select public.register_personal_expense(gen_random_uuid(),'f1030000-0000-4000-8000-000000000001',0,'USD','2026-10-20','f1070000-0000-4000-8000-000000000001')$$,'23514',null,'Zero rejected');
select throws_ok($$select public.register_personal_expense(gen_random_uuid(),'f1030000-0000-4000-8000-000000000001',100,'USD','2026-11-01','f1070000-0000-4000-8000-000000000001')$$,'23514',null,'Outside period rejected');
update public.budget_buckets set archived_at=now() where id='f1040000-0000-4000-8000-000000000001';
select throws_ok($$select public.register_personal_expense(gen_random_uuid(),'f1030000-0000-4000-8000-000000000001',100,'USD','2026-10-20','f1070000-0000-4000-8000-000000000001')$$,'42501',null,'Archived bucket rejected');
select lives_ok($$select public.register_personal_expense('f1110000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001',12345,'USD','2026-10-20','f1070000-0000-4000-8000-000000000001','Food')$$,'Archived mapping does not prevent read-only replay');
update public.transactions set deleted_at=now() where id='f1110000-0000-4000-8000-000000000001';
select throws_ok($$update public.transactions set deleted_at=null where id='f1110000-0000-4000-8000-000000000001'$$,'42501',null,'Restore requires eligible bucket');
select throws_ok($$select public.register_personal_expense('f1110000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001',12345,'USD','2026-10-20','f1070000-0000-4000-8000-000000000001','Food')$$,'23505',null,'Replay cannot revive deleted expense');
update public.budget_buckets set archived_at=null where id='f1040000-0000-4000-8000-000000000001';
update public.transactions set deleted_at=null where id='f1110000-0000-4000-8000-000000000001';
select is((select count(*) from public.transactions),1::bigint,'Failed writes leave no partial expenses');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000002');
select is(current_user::text,'authenticated','B client role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000002'::uuid,'B identity');
select is((select count(*) from public.transactions),0::bigint,'Partner persona has no personal access');
select throws_ok($$select public.register_personal_expense('f1110000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001',12345,'USD','2026-10-20','f1070000-0000-4000-8000-000000000001','Food')$$,'42501',null,'Cannot replay another owner registration');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000003');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000003'::uuid,'C identity');
select is((select count(*) from public.transactions),0::bigint,'Unrelated persona has no access');
reset role;
update public.budget_periods set status='CLOSED',closed_at=now() where id='f1030000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select lives_ok($$select public.register_personal_expense('f1110000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001',12345,'USD','2026-10-20','f1070000-0000-4000-8000-000000000001','Food')$$,'Closed replay only reads existing result');
select throws_ok($$select public.register_personal_expense(gen_random_uuid(),'f1030000-0000-4000-8000-000000000001',100,'USD','2026-10-20','f1070000-0000-4000-8000-000000000001')$$,'42501',null,'Closed month rejects new expense');
reset role;
select * from finish();
rollback;
