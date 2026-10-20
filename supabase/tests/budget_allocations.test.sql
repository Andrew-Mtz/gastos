\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
\ir helpers/auth.sql.inc
select no_plan();

insert into public.profiles (id, display_name, base_currency, timezone) values
  ('f0050000-0000-4000-8000-000000000001', 'Andy Test', 'USD', 'UTC'),
  ('f0050000-0000-4000-8000-000000000002', 'Partner Test', 'USD', 'UTC'),
  ('f0050000-0000-4000-8000-000000000003', 'Stranger Test', 'USD', 'UTC');
-- B is the partner persona; household membership is not introduced until Phase 2.
insert into public.budget_periods (id, profile_id, starts_on, ends_on, base_currency, expected_income_minor) values
  ('a1050000-0000-4000-8000-000000000001', 'f0050000-0000-4000-8000-000000000001', '2026-09-01', '2026-09-30', 'USD', 10000),
  ('a1050000-0000-4000-8000-000000000002', 'f0050000-0000-4000-8000-000000000001', '2026-10-01', '2026-10-31', 'USD', null),
  ('a1050000-0000-4000-8000-000000000003', 'f0050000-0000-4000-8000-000000000002', '2026-10-01', '2026-10-31', 'USD', 0);
insert into public.budget_buckets (id, profile_id, name, type, is_system, archived_at) values
  ('b1050000-0000-4000-8000-000000000001', 'f0050000-0000-4000-8000-000000000001', 'Needs', 'SPENDABLE', true, null),
  ('b1050000-0000-4000-8000-000000000002', 'f0050000-0000-4000-8000-000000000001', 'Leisure', 'SPENDABLE', false, null),
  ('b1050000-0000-4000-8000-000000000003', 'f0050000-0000-4000-8000-000000000001', 'Savings', 'SAVINGS', true, null),
  ('b1050000-0000-4000-8000-000000000004', 'f0050000-0000-4000-8000-000000000001', 'Old', 'SPENDABLE', false, now()),
  ('b1050000-0000-4000-8000-000000000005', 'f0050000-0000-4000-8000-000000000002', 'B Needs', 'SPENDABLE', false, null);

-- Force deferred invariants during each tested operation, not only at rollback.
create function pg_temp.save_and_check(period_id uuid, shares jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform public.save_budget_allocations(period_id, shares);
  set constraints public.budget_allocations_total_check immediate;
  set constraints public.budget_allocations_total_check deferred;
end;
$$;
revoke all on function pg_temp.save_and_check(uuid, jsonb) from public;
grant execute on function pg_temp.save_and_check(uuid, jsonb) to authenticated;

select has_table('public', 'budget_allocations', 'Allocation table exists');
select columns_are('public', 'budget_allocations', array[
  'id', 'budget_period_id', 'budget_bucket_id', 'percentage_basis_points', 'created_at', 'updated_at', 'deleted_at'
], 'Only allocation configuration and lifecycle are persisted, not derived amounts');
select col_is_pk('public', 'budget_allocations', 'id', 'Allocation id is primary key');
select col_type_is('public', 'budget_allocations', 'percentage_basis_points', 'integer', 'Percentages are integers');
select col_not_null('public', 'budget_allocations', column_name, column_name || ' is required')
from unnest(array['id', 'budget_period_id', 'budget_bucket_id', 'percentage_basis_points', 'created_at', 'updated_at']) as column_name;
select col_type_is('public', 'budget_allocations', column_name, 'timestamp with time zone', column_name || ' is timezone-aware')
from unnest(array['created_at', 'updated_at', 'deleted_at']) as column_name;
select ok(exists (select 1 from pg_constraint where conrelid = 'public.budget_allocations'::regclass and conname = constraint_name and confdeltype = 'r'), constraint_name || ' restricts deletion')
from unnest(array['budget_allocations_period_fkey', 'budget_allocations_bucket_fkey']) as constraint_name;
select has_index('public', 'budget_allocations', 'budget_allocations_period_bucket_key', 'Period/bucket identity is unique and indexed');
select has_index('public', 'budget_allocations', 'budget_allocations_bucket_id_idx', 'Bucket references are indexed');
select ok((select relrowsecurity from pg_class where oid = 'public.budget_allocations'::regclass), 'RLS enabled');
select is((select count(*) from pg_policies where schemaname = 'public' and tablename = 'budget_allocations'), 3::bigint, 'SELECT, INSERT, UPDATE policies only');
select ok(not exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'budget_allocations' and cmd = 'DELETE'), 'No DELETE policy');
select ok(has_table_privilege('authenticated', 'public.budget_allocations', 'SELECT'), 'Authenticated SELECT granted');
select ok(not has_table_privilege('authenticated', 'public.budget_allocations', privilege), 'No broad ' || privilege || ' grant')
from unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as privilege;
select ok(has_column_privilege('authenticated', 'public.budget_allocations', column_name, 'INSERT'), 'Insert grant: ' || column_name)
from unnest(array['budget_period_id', 'budget_bucket_id', 'percentage_basis_points']) as column_name;
select ok(has_column_privilege('authenticated', 'public.budget_allocations', column_name, 'UPDATE'), 'Update grant: ' || column_name)
from unnest(array['percentage_basis_points', 'deleted_at']) as column_name;
select ok(not has_column_privilege('authenticated', 'public.budget_allocations', column_name, 'UPDATE'), 'Immutable column: ' || column_name)
from unnest(array['id', 'budget_period_id', 'budget_bucket_id', 'created_at', 'updated_at']) as column_name;
select ok(not has_column_privilege('authenticated', 'public.budget_allocations', column_name, 'INSERT'), 'Server-generated column: ' || column_name)
from unnest(array['id', 'created_at', 'updated_at', 'deleted_at']) as column_name;
select ok(not has_any_column_privilege('anon', 'public.budget_allocations', privilege), 'Anonymous has no ' || privilege || ' column grant')
from unnest(array['SELECT', 'INSERT', 'UPDATE']) as privilege;
select ok(not has_table_privilege('anon', 'public.budget_allocations', privilege), 'Anonymous has no ' || privilege || ' grant')
from unnest(array['DELETE', 'TRUNCATE']) as privilege;
select is((select prosecdef from pg_proc where oid = function_name::regprocedure), false, function_name || ' is invoker-only')
from unnest(array['public.prepare_budget_allocation_write()', 'public.check_budget_allocation_total()', 'public.save_budget_allocations(uuid,jsonb)']) as function_name;
select is((select array_to_string(proconfig, ',') from pg_proc where oid = function_name::regprocedure), 'search_path=""', function_name || ' has safe search path')
from unnest(array['public.prepare_budget_allocation_write()', 'public.check_budget_allocation_total()', 'public.save_budget_allocations(uuid,jsonb)']) as function_name;
select ok(not has_function_privilege(role_name, function_name, 'EXECUTE'), role_name || ' cannot call ' || function_name)
from unnest(array['public', 'anon', 'authenticated']) as role_name
cross join unnest(array['public.prepare_budget_allocation_write()', 'public.check_budget_allocation_total()']) as function_name;
select ok(not has_function_privilege(role_name, 'public.save_budget_allocations(uuid,jsonb)', 'EXECUTE'), role_name || ' cannot call RPC')
from unnest(array['public', 'anon']) as role_name;
select ok(has_function_privilege('authenticated', 'public.save_budget_allocations(uuid,jsonb)', 'EXECUTE'), 'Authenticated RPC granted');
select ok((select tgdeferrable and tginitdeferred from pg_trigger where tgname = 'budget_allocations_total_check'), 'Total constraint is initially deferred for atomic sets');

set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text, 'authenticated', 'A uses client role');
select is(auth.uid(), 'f0050000-0000-4000-8000-000000000001'::uuid, 'Auth context A');
select lives_ok($$select pg_temp.save_and_check('a1050000-0000-4000-8000-000000000001', '[
  {"budget_bucket_id":"b1050000-0000-4000-8000-000000000003","percentage_basis_points":2000},
  {"budget_bucket_id":"b1050000-0000-4000-8000-000000000001","percentage_basis_points":5000},
  {"budget_bucket_id":"b1050000-0000-4000-8000-000000000002","percentage_basis_points":3000}]')$$, 'A saves complete set including system spendable/savings buckets');
select results_eq($$select percentage_basis_points from public.budget_allocations order by budget_bucket_id$$,
  array[5000, 3000, 2000], 'Percentages persist by bucket identity');
select is((select sum(percentage_basis_points) from public.budget_allocations where deleted_at is null), 10000::bigint, 'Initial total is exactly 100 percent');
select set_config('test.allocation_id', (select id::text from public.budget_allocations where budget_bucket_id = 'b1050000-0000-4000-8000-000000000002'), true);
select set_config('test.allocation_created_at', (select created_at::text from public.budget_allocations where id = current_setting('test.allocation_id')::uuid), true);
select set_config('test.allocation_updated_at', (select updated_at::text from public.budget_allocations where id = current_setting('test.allocation_id')::uuid), true);
select throws_ok($$select pg_temp.save_and_check('a1050000-0000-4000-8000-000000000001', '[{"budget_bucket_id":"b1050000-0000-4000-8000-000000000001","percentage_basis_points":9999}]')$$,
  '23514', null, 'Incomplete total rejected');
select throws_ok($$select pg_temp.save_and_check('a1050000-0000-4000-8000-000000000001', '[{"budget_bucket_id":"b1050000-0000-4000-8000-000000000001","percentage_basis_points":10001}]')$$,
  '23514', null, 'Excess total rejected');
select throws_ok(format('select pg_temp.save_and_check(%L, %L::jsonb)', 'a1050000-0000-4000-8000-000000000001', invalid_input),
  '22023', null, 'Malformed input rejected: ' || coalesce(invalid_input, 'SQL null'))
from unnest(array[null, 'null', '{}', '[]', '[null]', '[1]', '[{}]',
  '[{"budget_bucket_id":"b1050000-0000-4000-8000-000000000001","percentage_basis_points":null}]',
  '[{"budget_bucket_id":"b1050000-0000-4000-8000-000000000001","percentage_basis_points":"10000"}]',
  '[{"budget_bucket_id":"b1050000-0000-4000-8000-000000000001","percentage_basis_points":-1}]',
  '[{"budget_bucket_id":"b1050000-0000-4000-8000-000000000001","percentage_basis_points":9999.5}]',
  '[{"budget_bucket_id":"b1050000-0000-4000-8000-000000000001","percentage_basis_points":5000},{"budget_bucket_id":"B1050000-0000-4000-8000-000000000001","percentage_basis_points":5000}]'
]) as invalid_input;
select throws_ok($$select pg_temp.save_and_check('a1050000-0000-4000-8000-000000000001', '[{"budget_bucket_id":"not-an-id","percentage_basis_points":10000}]')$$,
  '22P02', null, 'Malformed UUID rejected');
select throws_ok($$select pg_temp.save_and_check('a1050000-0000-4000-8000-000000000001', '[{"budget_bucket_id":"b1050000-0000-4000-8000-000000000005","percentage_basis_points":10000}]')$$,
  '42501', null, 'Foreign bucket cannot enter own plan');
select throws_ok($$select pg_temp.save_and_check('a1050000-0000-4000-8000-000000000001', '[{"budget_bucket_id":"b1050000-0000-4000-8000-000000000099","percentage_basis_points":10000}]')$$,
  '42501', null, 'Missing bucket rejected without probing ownership');
select throws_ok($$select pg_temp.save_and_check('a1050000-0000-4000-8000-000000000001', '[{"budget_bucket_id":"b1050000-0000-4000-8000-000000000004","percentage_basis_points":10000}]')$$,
  '23514', null, 'Archived bucket cannot be newly allocated');
select results_eq($$select percentage_basis_points from public.budget_allocations where deleted_at is null order by budget_bucket_id$$,
  array[5000, 3000, 2000], 'Every rejected replacement rolls back all earlier soft deletions');

-- Direct table writes cannot evade complete-set and ownership invariants.
select throws_ok($$update public.budget_allocations set percentage_basis_points = 1;
  set constraints public.budget_allocations_total_check immediate$$,
  '23514', null, 'Deferred constraint rejects incomplete direct changes');
select throws_ok($$update public.budget_allocations set deleted_at = now();
  set constraints public.budget_allocations_total_check immediate$$,
  '23514', null, 'Cannot erase the entire active plan through soft deletion');
select throws_ok($$insert into public.budget_allocations (budget_period_id, budget_bucket_id, percentage_basis_points)
  values ('a1050000-0000-4000-8000-000000000002', 'b1050000-0000-4000-8000-000000000001', 9000);
  set constraints public.budget_allocations_total_check immediate$$,
  '23514', null, 'Partial initial direct INSERT is rejected');
select throws_ok($$insert into public.budget_allocations (budget_period_id, budget_bucket_id, percentage_basis_points)
  values ('a1050000-0000-4000-8000-000000000001', 'b1050000-0000-4000-8000-000000000001', 10000)$$,
  '23505', null, 'Duplicate period/bucket identity rejected');
select throws_ok($$update public.budget_allocations set percentage_basis_points = -1$$, '23514', null, 'Negative direct percentage rejected');
select throws_ok($$update public.budget_allocations set percentage_basis_points = 10001$$, '23514', null, 'Out-of-range direct percentage rejected');
select throws_ok($$update public.budget_allocations set percentage_basis_points = null$$, '23502', null, 'Null direct percentage rejected');
select throws_ok(format('update public.budget_allocations set %I = %s', column_name, new_value),
  '42501', 'permission denied for table budget_allocations', 'Client cannot forge ' || column_name)
from (values ('id', 'gen_random_uuid()'), ('budget_period_id', 'gen_random_uuid()'), ('budget_bucket_id', 'gen_random_uuid()'), ('created_at', 'now()'), ('updated_at', 'now()')) as changes(column_name, new_value);
select throws_ok($$delete from public.budget_allocations$$, '42501', 'permission denied for table budget_allocations', 'Physical DELETE denied');
select throws_ok($$truncate public.budget_allocations$$, '42501', 'permission denied for table budget_allocations', 'TRUNCATE denied');

select lives_ok($$select pg_temp.save_and_check('a1050000-0000-4000-8000-000000000002', '[
  {"budget_bucket_id":"b1050000-0000-4000-8000-000000000001","percentage_basis_points":4500},
  {"budget_bucket_id":"b1050000-0000-4000-8000-000000000002","percentage_basis_points":1500},
  {"budget_bucket_id":"b1050000-0000-4000-8000-000000000003","percentage_basis_points":4000}]')$$, 'A assigns independent future period configuration');
select results_eq($$select percentage_basis_points from public.budget_allocations where budget_period_id = 'a1050000-0000-4000-8000-000000000001' order by budget_bucket_id$$,
  array[5000, 3000, 2000], 'Future period never rewrites prior allocations');
select lives_ok($$select pg_temp.save_and_check('a1050000-0000-4000-8000-000000000001', '[
  {"budget_bucket_id":"b1050000-0000-4000-8000-000000000001","percentage_basis_points":6000},
  {"budget_bucket_id":"b1050000-0000-4000-8000-000000000003","percentage_basis_points":4000}]')$$, 'Open calendar-past period permits explicit changes with recoverable removal');
select is((select count(*) from public.budget_allocations where budget_period_id = 'a1050000-0000-4000-8000-000000000001'), 3::bigint, 'Removed row retained');
select ok((select deleted_at >= created_at and deleted_at <= statement_timestamp() from public.budget_allocations where id = current_setting('test.allocation_id')::uuid), 'Removal timestamp server-generated');
select set_config('test.allocation_deleted_at', (select deleted_at::text from public.budget_allocations where id = current_setting('test.allocation_id')::uuid), true);
select lives_ok($$update public.budget_allocations set deleted_at = '1900-01-01' where id = current_setting('test.allocation_id')::uuid;
  set constraints public.budget_allocations_total_check immediate;
  set constraints public.budget_allocations_total_check deferred$$, 'Repeated removal accepted');
select is((select deleted_at from public.budget_allocations where id = current_setting('test.allocation_id')::uuid), current_setting('test.allocation_deleted_at')::timestamptz, 'Removal history cannot be forged');
select lives_ok($$select pg_temp.save_and_check('a1050000-0000-4000-8000-000000000001', '[
  {"budget_bucket_id":"b1050000-0000-4000-8000-000000000001","percentage_basis_points":5000},
  {"budget_bucket_id":"b1050000-0000-4000-8000-000000000002","percentage_basis_points":0},
  {"budget_bucket_id":"b1050000-0000-4000-8000-000000000003","percentage_basis_points":5000}]')$$, 'Removed bucket can rejoin with zero percentage');
select ok((select deleted_at is null and created_at = current_setting('test.allocation_created_at')::timestamptz and updated_at > current_setting('test.allocation_updated_at')::timestamptz from public.budget_allocations where id = current_setting('test.allocation_id')::uuid), 'Restoration retains identity and creation timestamp');
select lives_ok($$update public.budget_buckets set archived_at = now() where id = 'b1050000-0000-4000-8000-000000000002'$$, 'Referenced custom bucket can be archived');
select lives_ok($$select pg_temp.save_and_check('a1050000-0000-4000-8000-000000000001', '[
  {"budget_bucket_id":"b1050000-0000-4000-8000-000000000001","percentage_basis_points":5000},
  {"budget_bucket_id":"b1050000-0000-4000-8000-000000000002","percentage_basis_points":0},
  {"budget_bucket_id":"b1050000-0000-4000-8000-000000000003","percentage_basis_points":5000}]')$$, 'Existing archived reference remains valid');
select lives_ok($$select pg_temp.save_and_check('a1050000-0000-4000-8000-000000000001', '[{"budget_bucket_id":"b1050000-0000-4000-8000-000000000001","percentage_basis_points":10000}]')$$, 'Complete replacement soft deletes removed references');
select throws_ok($$select pg_temp.save_and_check('a1050000-0000-4000-8000-000000000001', '[{"budget_bucket_id":"b1050000-0000-4000-8000-000000000002","percentage_basis_points":10000}]')$$,
  '23514', null, 'Archived removed reference cannot be restored');
select is((select count(*) from public.budget_allocations where budget_period_id = 'a1050000-0000-4000-8000-000000000001' and deleted_at is null), 1::bigint, 'Rejected restoration is atomic');
reset role;

update public.budget_periods set status = 'CLOSED', closed_at = now() where id = 'a1050000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text, 'authenticated', 'Closed-period checks use client role');
select is(auth.uid(), 'f0050000-0000-4000-8000-000000000001'::uuid, 'Closed-period context A');
select is((select count(*) from public.budget_allocations where budget_period_id = 'a1050000-0000-4000-8000-000000000001'), 3::bigint, 'Closed history remains owner-readable including removals');
select throws_ok($$select pg_temp.save_and_check('a1050000-0000-4000-8000-000000000001', '[{"budget_bucket_id":"b1050000-0000-4000-8000-000000000001","percentage_basis_points":10000}]')$$,
  '42501', 'An owned open budget period is required', 'RPC rejects closed period');
select results_eq($$update public.budget_allocations set percentage_basis_points = 1 where budget_period_id = 'a1050000-0000-4000-8000-000000000001' returning id$$, array[]::uuid[], 'RLS filters closed-period direct edits');
select results_eq($$update public.budget_allocations set deleted_at = now() where budget_period_id = 'a1050000-0000-4000-8000-000000000001' returning id$$, array[]::uuid[], 'RLS filters closed-period removal');
select throws_ok($$insert into public.budget_allocations (budget_period_id, budget_bucket_id, percentage_basis_points) values ('a1050000-0000-4000-8000-000000000001', 'b1050000-0000-4000-8000-000000000001', 10000)$$,
  '42501', null, 'Closed-period insert rejected');
reset role;

set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000002');
select is(current_user::text, 'authenticated', 'B uses client role');
select is(auth.uid(), 'f0050000-0000-4000-8000-000000000002'::uuid, 'Auth context B');
select is((select count(*) from public.budget_allocations), 0::bigint, 'Partner B sees no A allocations, including closed/removed rows');
select lives_ok($$select pg_temp.save_and_check('a1050000-0000-4000-8000-000000000003', '[{"budget_bucket_id":"b1050000-0000-4000-8000-000000000005","percentage_basis_points":10000}]')$$, 'B can save own period');
select throws_ok($$select pg_temp.save_and_check('a1050000-0000-4000-8000-000000000002', '[{"budget_bucket_id":"b1050000-0000-4000-8000-000000000005","percentage_basis_points":10000}]')$$,
  '42501', 'An owned open budget period is required', 'B cannot call RPC for A');
select throws_ok($$insert into public.budget_allocations (budget_period_id, budget_bucket_id, percentage_basis_points) values ('a1050000-0000-4000-8000-000000000002', 'b1050000-0000-4000-8000-000000000005', 10000)$$,
  '42501', null, 'B cannot forge direct allocation for A');
select results_eq($$update public.budget_allocations set deleted_at = now() where budget_period_id = 'a1050000-0000-4000-8000-000000000002' returning id$$, array[]::uuid[], 'B cannot update A via RLS');
reset role;

set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000003');
select is(current_user::text, 'authenticated', 'C uses client role');
select is(auth.uid(), 'f0050000-0000-4000-8000-000000000003'::uuid, 'Auth context C');
select is((select count(*) from public.budget_allocations), 0::bigint, 'Unrelated C sees no A/B allocations');
select results_eq($$update public.budget_allocations set percentage_basis_points = 10000 returning id$$, array[]::uuid[], 'C cannot update foreign allocations');
select throws_ok($$select pg_temp.save_and_check('a1050000-0000-4000-8000-000000000002', '[{"budget_bucket_id":"b1050000-0000-4000-8000-000000000001","percentage_basis_points":10000}]')$$,
  '42501', 'An owned open budget period is required', 'C cannot call RPC for A');
select throws_ok($$insert into public.budget_allocations (budget_period_id, budget_bucket_id, percentage_basis_points) values ('a1050000-0000-4000-8000-000000000002', 'b1050000-0000-4000-8000-000000000001', 10000)$$,
  '42501', null, 'C cannot forge direct allocation for A');
reset role;

set local role authenticated;
select pg_temp.set_jwt_subject(null);
select is(current_user::text, 'authenticated', 'Missing-subject checks use client role');
select is(auth.uid(), null::uuid, 'Subject absent');
select is((select count(*) from public.budget_allocations), 0::bigint, 'Role alone exposes no allocations');
select throws_ok($$select public.save_budget_allocations('a1050000-0000-4000-8000-000000000002', '[]')$$,
  '42501', 'Authentication is required', 'Missing subject cannot invoke operation');
select results_eq($$update public.budget_allocations set deleted_at = now() returning id$$, array[]::uuid[], 'Missing subject cannot update allocations');
reset role;

set local role anon;
select pg_temp.set_jwt_subject(null);
select is(current_user::text, 'anon', 'Anonymous role active');
select is(auth.uid(), null::uuid, 'Anonymous subject absent');
select throws_ok($$select * from public.budget_allocations$$, '42501', 'permission denied for table budget_allocations', 'Anonymous SELECT denied');
select throws_ok($$select public.save_budget_allocations('a1050000-0000-4000-8000-000000000002', '[]')$$,
  '42501', 'permission denied for function save_budget_allocations', 'Anonymous RPC denied');
reset role;

select * from finish();
rollback;
