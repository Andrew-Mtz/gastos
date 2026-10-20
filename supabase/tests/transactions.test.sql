\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
\ir helpers/auth.sql.inc
select no_plan();
insert into public.profiles (id, display_name, base_currency, timezone)
select id, 'Synthetic', 'USD', 'UTC' from auth.users where id::text like 'f0050000%';
insert into public.budget_periods (id, profile_id, starts_on, ends_on, base_currency) values
 ('f1030000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','2026-10-01','2026-10-31','USD'),
 ('f1030000-0000-4000-8000-000000000002','f0050000-0000-4000-8000-000000000002','2026-10-01','2026-10-31','USD');
insert into public.categories(id,profile_id,name) values
 ('f1070000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','Food'),
 ('f1070000-0000-4000-8000-000000000002','f0050000-0000-4000-8000-000000000002','Private');
select ok((select relrowsecurity from pg_class where oid='public.transactions'::regclass),'RLS enabled');
select ok(not has_table_privilege('authenticated','public.transactions',p),'No broad '||p)
from unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p;
select ok(not has_column_privilege('authenticated','public.transactions',c,'UPDATE'),'Immutable '||c)
from unnest(array['id','owner_profile_id','budget_period_id','scope','type','amount_minor','currency','transaction_date','category_id','created_at','updated_at']) c;
select ok(not has_column_privilege('authenticated','public.transactions',c,'INSERT'),'Server supplies '||c)
from unnest(array['scope','created_at','updated_at','deleted_at']) c;
select is((select prosecdef from pg_proc where oid='public.prepare_transaction_write()'::regprocedure),false,'Invoker write trigger');
select is((select array_to_string(proconfig,',') from pg_proc where oid='public.prepare_transaction_write()'::regprocedure),'search_path=""','Empty trigger search path');
select ok(not has_function_privilege('authenticated','public.prepare_transaction_write()','EXECUTE'),'No direct trigger execution');
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','A client role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'A subject');
select lives_ok($$insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date)
select 'f0050000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001',t,10000,'USD','2026-10-01' from unnest(array['INCOME','EXPENSE','SAVINGS_CONTRIBUTION','SAVINGS_WITHDRAWAL']) t$$,'Four Phase 1 types persist separately');
select is((select count(*) from public.transactions),4::bigint,'A reads own records');
select ok((select bool_and(scope='PERSONAL' and deleted_at is null and created_at is not null) from public.transactions),'Personal active defaults and technical timestamps');
select throws_ok($$insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date)
values ('f0050000-0000-4000-8000-000000000002','f1030000-0000-4000-8000-000000000002','INCOME',100,'USD','2026-10-01')$$,'42501',null,'Cannot write another owner period');
select throws_ok($$insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date)
values ('f0050000-0000-4000-8000-000000000002','f1030000-0000-4000-8000-000000000001','INCOME',100,'USD','2026-10-01')$$,'42501',null,'Cannot forge ownership using own period');
select throws_ok($$insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date,category_id)
values ('f0050000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001','EXPENSE',100,'USD','2026-10-01','f1070000-0000-4000-8000-000000000002')$$,'42501',null,'Foreign category is denied');
select throws_ok(format($sql$insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date)
values ('f0050000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001','INCOME',%s,'USD','2026-10-01')$sql$,value),'23514',null,'Reject invalid amount '||value)
from unnest(array['0','-1','9007199254740992']) value;
select lives_ok($$insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date)
values ('f0050000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001','INCOME',9007199254740991,'USD','2026-10-31')$$,'Maximum safe integer and last financial day');
select throws_ok(format($sql$insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date)
values ('f0050000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001','INCOME',100,'USD',%L)$sql$,value),'23514',null,'Reject date outside month '||value)
from unnest(array['2026-09-30','2026-11-01','infinity','-infinity']) value;
select throws_ok($$insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date)
values ('f0050000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001','INCOME',100,'UYU','2026-10-01')$$,'23514',null,'Income must match budget currency, not current profile or implicit conversion');
select throws_ok($$insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date)
values ('f0050000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001','TRANSFER',100,'USD','2026-10-01')$$,'23514',null,'Future transaction types not introduced');
select throws_ok($$update public.transactions set currency='UYU'$$,'42501','permission denied for table transactions','Original currency immutable');
select throws_ok($$update public.transactions set owner_profile_id='f0050000-0000-4000-8000-000000000002'$$,'42501','permission denied for table transactions','Owner immutable');
select lives_ok($$insert into public.transactions(id,owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date,category_id)
values ('f1080000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001','EXPENSE',42,'USD','2026-10-20','f1070000-0000-4000-8000-000000000001')$$,'Owned category and operation identity');
select lives_ok($$update public.transactions set description='Correct note',deleted_at='1900-01-01' where id='f1080000-0000-4000-8000-000000000001'$$,'Description and soft deletion supported');
select ok((select deleted_at >= created_at and amount_minor=42 and transaction_date='2026-10-20' from public.transactions where id='f1080000-0000-4000-8000-000000000001'),'Server deletion time preserves original history');
select set_config('test.deleted_at',(select deleted_at::text from public.transactions where id='f1080000-0000-4000-8000-000000000001'),true);
select lives_ok($$update public.transactions set deleted_at=now() where id='f1080000-0000-4000-8000-000000000001'$$,'Repeated deletion works');
select is((select deleted_at from public.transactions where id='f1080000-0000-4000-8000-000000000001'),current_setting('test.deleted_at')::timestamptz,'Repeated deletion preserves time');
select is((select count(*) from public.transactions where deleted_at is null),5::bigint,'Normal lookup excludes removed row');
select lives_ok($$update public.transactions set deleted_at=null where id='f1080000-0000-4000-8000-000000000001'$$,'Restore reuses same identity');
select lives_ok($$update public.categories set archived_at=now() where name='Food'$$,'Category archive preserves transaction');
select is((select count(*) from public.transactions t join public.categories c on c.id=t.category_id),1::bigint,'Archived category remains available to history');
select lives_ok($$update public.transactions set deleted_at=now() where id='f1080000-0000-4000-8000-000000000001'$$,'Historical archived-category activity may be removed');
select throws_ok($$update public.transactions set deleted_at=null where id='f1080000-0000-4000-8000-000000000001'$$,'42501',null,'Restoration requires category to be active again');
select ok((select deleted_at is not null from public.transactions where id='f1080000-0000-4000-8000-000000000001'),'Failed restore preserves deletion');

select throws_ok($$insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date,category_id)
values ('f0050000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001','EXPENSE',100,'USD','2026-10-01','f1070000-0000-4000-8000-000000000001')$$,'42501',null,'New activity cannot use archived category');
select throws_ok($$delete from public.transactions$$,'42501','permission denied for table transactions','Physical deletion denied');
select throws_ok($$truncate public.transactions$$,'42501','permission denied for table transactions','Truncate denied');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000002');
select is(current_user::text,'authenticated','Partner persona B role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000002'::uuid,'Partner persona B subject');
select is((select count(*) from public.transactions),0::bigint,'Partner persona B cannot read A');
select results_eq($$update public.transactions set description='Forbidden' returning id$$,array[]::uuid[],'Partner persona B cannot update A');
select results_eq($$update public.transactions set deleted_at=now() returning id$$,array[]::uuid[],'Partner persona B cannot delete A');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000003');
select is(current_user::text,'authenticated','Unrelated C role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000003'::uuid,'Unrelated C subject');
select is((select count(*) from public.transactions),0::bigint,'Unrelated C cannot read A');
select results_eq($$update public.transactions set description='Forbidden' returning id$$,array[]::uuid[],'Unrelated C cannot update A');
select results_eq($$update public.transactions set deleted_at=now() returning id$$,array[]::uuid[],'Unrelated C cannot delete A');
reset role;
-- Household membership does not exist yet; partner fixture tests owner isolation.
set local role authenticated;
select pg_temp.set_jwt_subject(null);
select is(auth.uid(),null::uuid,'Missing subject');
select is((select count(*) from public.transactions),0::bigint,'Role alone cannot read history');
reset role;
set local role anon;
select pg_temp.set_jwt_subject(null);
select is(current_user::text,'anon','Anonymous role');
select is(auth.uid(),null::uuid,'Anonymous subject');
select throws_ok($$select * from public.transactions$$,'42501','permission denied for table transactions','No anonymous reads');
select throws_ok($$update public.transactions set deleted_at=now()$$,'42501','permission denied for table transactions','No anonymous writes');
reset role;
select pg_temp.set_jwt_subject(null);
select throws_ok($$delete from public.categories where name='Food'$$,'23503',null,'Referenced categories cannot be destroyed');
update public.budget_periods set status='CLOSED',closed_at=statement_timestamp() where id='f1030000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'A subject for closed history');
select is((select count(*) from public.transactions),6::bigint,'Closed history remains owner readable');
select results_eq($$update public.transactions set description='Forbidden' returning id$$,array[]::uuid[],'Closed period description cannot change');
select results_eq($$update public.transactions set deleted_at=now() returning id$$,array[]::uuid[],'Closed period cannot soft delete');
select throws_ok($$insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date)
values ('f0050000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001','INCOME',100,'USD','2026-10-01')$$,'42501',null,'Closed period rejects insertion');
reset role;
select * from finish();
rollback;
