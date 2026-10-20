\set ON_ERROR_STOP on
begin isolation level repeatable read;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
\ir helpers/auth.sql.inc
select no_plan();
insert into public.profiles(id,display_name,base_currency,timezone)
values('f0050000-0000-4000-8000-000000000001','Synthetic','USD','UTC');
insert into public.budget_buckets(id,profile_id,name,type)
values('f1040000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','Needs','SPENDABLE');
insert into public.categories(id,profile_id,name,budget_bucket_id)
values('f1070000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','Rent','f1040000-0000-4000-8000-000000000001');
-- Test-only fixture predates the operation being tested. Re-enable its guard before
-- switching to a client role; this entire setup rolls back with the transaction.
alter table public.recurring_expenses disable trigger recurring_expenses_validate;
insert into public.recurring_expenses(id,owner_profile_id,name,category_id,amount_mode,default_amount_minor,currency,due_day,active_from)
values('f1170000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','Rent','f1070000-0000-4000-8000-000000000001','FIXED',1,'USD',1,'9999-01-01');
alter table public.recurring_expenses enable trigger recurring_expenses_validate;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','Client role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'Real auth identity');
select throws_ok($$select public.create_personal_recurring_expense(gen_random_uuid(),'Rent','f1070000-0000-4000-8000-000000000001','FIXED',1,'USD',1,'9999-01-01')$$,
 '0A000','Recurring writes require READ COMMITTED isolation','Snapshot-isolated creation RPC rejected');
select throws_ok($$insert into public.recurring_expenses(owner_profile_id,name,category_id,amount_mode,default_amount_minor,currency,due_day,active_from)
 values(auth.uid(),'Rent','f1070000-0000-4000-8000-000000000001','FIXED',1,'USD',1,'9999-01-01')$$,
 '0A000','Recurring writes require READ COMMITTED isolation','Snapshot-isolated direct creation rejected');
select throws_ok($$select public.stop_personal_recurring_expense('f1170000-0000-4000-8000-000000000001','9999-01-01')$$,
 '0A000','Recurring writes require READ COMMITTED isolation','Snapshot-isolated stop RPC rejected');
select throws_ok($$update public.recurring_expenses set stopped_from='9999-01-01' where id='f1170000-0000-4000-8000-000000000001'$$,
 '0A000','Recurring writes require READ COMMITTED isolation','Snapshot-isolated direct stop rejected');
reset role;
select * from finish();
rollback;
