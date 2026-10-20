\set ON_ERROR_STOP on
-- A deliberately stale-snapshot isolation level must not bypass aggregate
-- validation when two writers serialize on a parent lock without updating it.
begin isolation level repeatable read;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
\ir helpers/auth.sql.inc
select no_plan();

insert into public.profiles (id, display_name, base_currency, timezone) values
  ('f0050000-0000-4000-8000-000000000001', 'Andy Test', 'USD', 'UTC');
insert into public.budget_periods (id, profile_id, starts_on, ends_on, base_currency) values
  ('a1050000-0000-4000-8000-000000000001', 'f0050000-0000-4000-8000-000000000001', '2026-10-01', '2026-10-31', 'USD');
insert into public.budget_buckets (id, profile_id, name, type) values
  ('b1050000-0000-4000-8000-000000000001', 'f0050000-0000-4000-8000-000000000001', 'Needs', 'SPENDABLE');

set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text, 'authenticated', 'Isolation test uses client role');
select is(auth.uid(), 'f0050000-0000-4000-8000-000000000001'::uuid, 'Isolation test uses A');
select is(current_setting('transaction_isolation'), 'repeatable read', 'Test actually uses snapshot isolation');
select throws_ok($$select public.save_budget_allocations('a1050000-0000-4000-8000-000000000001', '[{"budget_bucket_id":"b1050000-0000-4000-8000-000000000001","percentage_basis_points":10000}]')$$,
  '0A000', 'Budget allocation writes require READ COMMITTED isolation', 'RPC rejects unsupported isolation before mutation');
select throws_ok($$insert into public.budget_allocations (budget_period_id, budget_bucket_id, percentage_basis_points)
  values ('a1050000-0000-4000-8000-000000000001', 'b1050000-0000-4000-8000-000000000001', 10000)$$,
  '0A000', 'Budget allocation writes require READ COMMITTED isolation', 'Direct INSERT cannot bypass the isolation contract');
select is((select count(*) from public.budget_allocations), 0::bigint, 'Rejected writes leave no partial configuration');
reset role;

select * from finish();
rollback;
