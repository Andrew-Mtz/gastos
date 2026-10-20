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
select throws_ok($$select public.register_savings_movement(gen_random_uuid(),'f1150000-0000-4000-8000-000000000001','SAVINGS_WITHDRAWAL',1,'USD','2026-10-01',true)$$,'0A000','Transaction writes require READ COMMITTED isolation','Snapshot-isolated RPC cannot validate stale savings');
select throws_ok($$insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date) values(auth.uid(),'f1150000-0000-4000-8000-000000000001','SAVINGS_CONTRIBUTION',1,'USD','2026-10-01')$$,'0A000','Transaction writes require READ COMMITTED isolation','Snapshot-isolated direct contribution is rejected');
reset role;
select * from finish();
rollback;
