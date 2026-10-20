\set ON_ERROR_STOP on
begin isolation level repeatable read;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
\ir helpers/auth.sql.inc
select no_plan();
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
reset role;
select * from finish();
rollback;
