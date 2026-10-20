\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
\ir helpers/auth.sql.inc
select no_plan();

insert into public.profiles (id, display_name, base_currency, timezone) values
  ('f0050000-0000-4000-8000-000000000001', 'Andy Test', 'UYU', 'America/Montevideo'),
  ('f0050000-0000-4000-8000-000000000002', 'Partner Test', 'USD', 'UTC'),
  ('f0050000-0000-4000-8000-000000000003', 'Stranger Test', 'EUR', 'Europe/Madrid');

-- Household membership does not exist until Phase 2. B is the partner persona,
-- not a fabricated household-membership fixture; C is an unrelated identity.
select has_table('public', 'budget_buckets', 'Budget bucket table exists');
select columns_are('public', 'budget_buckets', array[
  'id', 'profile_id', 'name', 'type', 'is_system', 'created_at', 'updated_at', 'archived_at'
], 'Only bucket identity, purpose, provenance, and lifecycle are persisted');
select col_is_pk('public', 'budget_buckets', 'id', 'Bucket id is the primary key');
select col_type_is('public', 'budget_buckets', 'id', 'uuid', 'Id is UUID');
select col_type_is('public', 'budget_buckets', 'profile_id', 'uuid', 'Owner is UUID');
select col_type_is('public', 'budget_buckets', 'name', 'text', 'Name is text');
select col_type_is('public', 'budget_buckets', 'type', 'text', 'Type is constrained text');
select col_type_is('public', 'budget_buckets', 'is_system', 'boolean', 'System provenance is boolean');
select col_type_is('public', 'budget_buckets', column_name, 'timestamp with time zone', column_name || ' is timezone-aware')
from unnest(array['created_at', 'updated_at', 'archived_at']) as column_name;
select col_not_null('public', 'budget_buckets', column_name, column_name || ' is required')
from unnest(array['id', 'profile_id', 'name', 'type', 'is_system', 'created_at', 'updated_at']) as column_name;
select col_is_null('public', 'budget_buckets', 'archived_at', 'Archive marker is nullable');
select col_has_default('public', 'budget_buckets', column_name, column_name || ' has a server default')
from unnest(array['id', 'is_system', 'created_at', 'updated_at']) as column_name;
select col_hasnt_default('public', 'budget_buckets', column_name, column_name || ' has no implicit value')
from unnest(array['profile_id', 'name', 'type', 'archived_at']) as column_name;
select ok(exists (
  select 1 from pg_constraint where conrelid = 'public.budget_buckets'::regclass
    and conname = 'budget_buckets_profile_id_fkey'
    and confrelid = 'public.profiles'::regclass and confdeltype = 'r'
), 'Profile foreign key preserves history with ON DELETE RESTRICT');
select has_index('public', 'budget_buckets', 'budget_buckets_profile_id_idx', 'Owner lookup has an index');
select ok((select relrowsecurity from pg_class where oid = 'public.budget_buckets'::regclass), 'RLS is enabled');
select is(
  (select string_agg(policyname::text, ',' order by policyname)
   from pg_policies where schemaname = 'public' and tablename = 'budget_buckets'),
  'budget_buckets_insert_own,budget_buckets_select_own,budget_buckets_update_custom_own',
  'Only the three approved policies exist, with no DELETE policy'
);
select ok(exists (
  select 1 from pg_policies where schemaname = 'public' and tablename = 'budget_buckets'
    and cmd = 'UPDATE' and qual is not null and with_check is not null
), 'UPDATE checks both existing and resulting ownership');
select ok(has_table_privilege('authenticated', 'public.budget_buckets', 'SELECT'), 'Authenticated SELECT is granted');
select ok(not has_table_privilege('authenticated', 'public.budget_buckets', privilege), 'No broad authenticated ' || privilege || ' grant')
from unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as privilege;
select ok(has_column_privilege('authenticated', 'public.budget_buckets', column_name, 'INSERT'), 'Client can insert ' || column_name)
from unnest(array['profile_id', 'name', 'type']) as column_name;
select ok(has_column_privilege('authenticated', 'public.budget_buckets', column_name, 'UPDATE'), 'Client can update ' || column_name)
from unnest(array['name', 'archived_at']) as column_name;
select ok(not has_column_privilege('authenticated', 'public.budget_buckets', column_name, 'INSERT'), 'Client cannot insert ' || column_name)
from unnest(array['id', 'is_system', 'created_at', 'updated_at', 'archived_at']) as column_name;
select ok(not has_column_privilege('authenticated', 'public.budget_buckets', column_name, 'UPDATE'), 'Client cannot update ' || column_name)
from unnest(array['id', 'profile_id', 'type', 'is_system', 'created_at', 'updated_at']) as column_name;
select ok(not has_any_column_privilege('anon', 'public.budget_buckets', privilege), 'Anonymous has no ' || privilege || ' column grants')
from unnest(array['SELECT', 'INSERT', 'UPDATE']) as privilege;
select ok(not has_table_privilege('anon', 'public.budget_buckets', privilege), 'Anonymous has no ' || privilege || ' grant')
from unnest(array['DELETE', 'TRUNCATE']) as privilege;
select is((select prosecdef from pg_proc where oid = 'public.prepare_budget_bucket_update()'::regprocedure), false, 'Timestamp function is SECURITY INVOKER');
select is((select array_to_string(proconfig, ',') from pg_proc where oid = 'public.prepare_budget_bucket_update()'::regprocedure), 'search_path=""', 'Timestamp function has an empty search path');
select ok(not has_function_privilege(role_name, 'public.prepare_budget_bucket_update()', 'EXECUTE'), role_name || ' cannot execute the trigger function directly')
from unnest(array['public', 'anon', 'authenticated']) as role_name;

set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text, 'authenticated', 'A uses the client role');
select is(auth.uid(), 'f0050000-0000-4000-8000-000000000001'::uuid, 'Auth context is A');
select lives_ok($$insert into public.budget_buckets (profile_id, name, type) values
  ('f0050000-0000-4000-8000-000000000001', 'Needs', 'SPENDABLE'),
  ('f0050000-0000-4000-8000-000000000001', 'Leisure', 'SPENDABLE'),
  ('f0050000-0000-4000-8000-000000000001', 'Savings', 'SAVINGS')$$,
  'A can create own spendable and savings buckets');
select results_eq($$select name, type from public.budget_buckets order by name$$,
  $$values ('Leisure', 'SPENDABLE'), ('Needs', 'SPENDABLE'), ('Savings', 'SAVINGS')$$,
  'A reads the persisted conceptual bucket purposes');
select ok((select bool_and(id is not null and created_at is not null and updated_at is not null
  and not is_system and archived_at is null) from public.budget_buckets), 'New buckets have generated identity/timestamps and are custom, active rows');
select throws_ok($$insert into public.budget_buckets (profile_id, name, type)
  values ('f0050000-0000-4000-8000-000000000001', '', 'SPENDABLE')$$,
  '23514', null, 'Empty name is rejected');
select throws_ok($$insert into public.budget_buckets (profile_id, name, type)
  values ('f0050000-0000-4000-8000-000000000001', E' \t\n', 'SPENDABLE')$$,
  '23514', null, 'Whitespace-only name is rejected');
select throws_ok($$insert into public.budget_buckets (profile_id, name, type)
  values ('f0050000-0000-4000-8000-000000000001', 'Invalid', 'OTHER')$$,
  '23514', null, 'Unknown bucket type is rejected');
select throws_ok($$insert into public.budget_buckets (profile_id, name, type)
  values ('f0050000-0000-4000-8000-000000000001', 'Invalid', 'savings')$$,
  '23514', null, 'Lowercase bucket type is rejected');
select throws_ok($$insert into public.budget_buckets (profile_id, name, type)
  values ('f0050000-0000-4000-8000-000000000001', null, 'SPENDABLE')$$,
  '23502', null, 'Null name is rejected');
select throws_ok($$insert into public.budget_buckets (profile_id, name, type)
  values ('f0050000-0000-4000-8000-000000000001', 'Invalid', null)$$,
  '23502', null, 'Null type is rejected');
select throws_ok($$insert into public.budget_buckets (profile_id, name, type)
  values ('f0050000-0000-4000-8000-000000000002', 'Forged', 'SPENDABLE')$$,
  '42501', 'new row violates row-level security policy for table "budget_buckets"',
  'A cannot forge B ownership despite having INSERT column grants');
select throws_ok($$insert into public.budget_buckets (profile_id, name, type, is_system)
  values ('f0050000-0000-4000-8000-000000000001', 'Forged', 'SPENDABLE', true)$$,
  '42501', 'permission denied for table budget_buckets', 'Client cannot forge system provenance');
select throws_ok($$insert into public.budget_buckets (profile_id, name, type, archived_at)
  values ('f0050000-0000-4000-8000-000000000001', 'Forged', 'SPENDABLE', now())$$,
  '42501', 'permission denied for table budget_buckets', 'Client cannot insert an archive timestamp');
select throws_ok($$update public.budget_buckets set profile_id = 'f0050000-0000-4000-8000-000000000002'$$,
  '42501', 'permission denied for table budget_buckets', 'Ownership cannot be reassigned');
select throws_ok($$update public.budget_buckets set type = 'SPENDABLE' where name = 'Savings'$$,
  '42501', 'permission denied for table budget_buckets', 'Savings cannot be reclassified as ordinary spending');
select throws_ok($$update public.budget_buckets set is_system = true$$,
  '42501', 'permission denied for table budget_buckets', 'Client cannot change system provenance');
select throws_ok($$update public.budget_buckets set id = gen_random_uuid()$$,
  '42501', 'permission denied for table budget_buckets', 'Bucket identity is immutable');
select throws_ok($$update public.budget_buckets set created_at = now()$$,
  '42501', 'permission denied for table budget_buckets', 'Creation timestamp is immutable');
select throws_ok($$update public.budget_buckets set updated_at = now()$$,
  '42501', 'permission denied for table budget_buckets', 'Update timestamp is server-managed');
select set_config('test.bucket_id', (select id::text from public.budget_buckets where name = 'Leisure'), true);
select set_config('test.bucket_created_at', (select created_at::text from public.budget_buckets where name = 'Leisure'), true);
select set_config('test.bucket_updated_at', (select updated_at::text from public.budget_buckets where name = 'Leisure'), true);
select lives_ok($$update public.budget_buckets set name = 'Personal leisure' where name = 'Leisure'$$, 'A can rename a custom bucket');
select is((select name from public.budget_buckets where id = current_setting('test.bucket_id')::uuid), 'Personal leisure', 'Rename persists without changing identity');
select is((select created_at from public.budget_buckets where id = current_setting('test.bucket_id')::uuid),
  current_setting('test.bucket_created_at')::timestamptz, 'Creation time stays stable');
select ok((select updated_at > current_setting('test.bucket_updated_at')::timestamptz
  and updated_at <= statement_timestamp() from public.budget_buckets where id = current_setting('test.bucket_id')::uuid), 'Database advances update time');
select throws_ok($$update public.budget_buckets set name = ' ' where name = 'Needs'$$,
  '23514', null, 'Renaming still enforces a meaningful name');
select lives_ok($$update public.budget_buckets set archived_at = '1900-01-01' where name = 'Savings'$$, 'A can archive a savings bucket');
select ok((select archived_at >= created_at and archived_at <= statement_timestamp()
  and type = 'SAVINGS' from public.budget_buckets where name = 'Savings'), 'Archive time is server-generated and savings classification survives');
select set_config('test.bucket_archived_at', (select archived_at::text from public.budget_buckets where name = 'Savings'), true);
select lives_ok($$update public.budget_buckets set archived_at = '2100-01-01' where name = 'Savings'$$, 'Repeated archive is accepted');
select is((select archived_at from public.budget_buckets where name = 'Savings'),
  current_setting('test.bucket_archived_at')::timestamptz, 'Repeated archive does not rewrite archive history');
select is((select count(*) from public.budget_buckets where archived_at is null), 2::bigint, 'Active lookup excludes archived buckets');
select is((select count(*) from public.budget_buckets), 3::bigint, 'Owner still reads archived rows for history');
select throws_ok($$delete from public.budget_buckets where name = 'Savings'$$,
  '42501', 'permission denied for table budget_buckets', 'Even archived rows cannot be physically deleted by clients');
select throws_ok($$truncate public.budget_buckets$$,
  '42501', 'permission denied for table budget_buckets', 'TRUNCATE is denied by SQL privileges');
reset role;

set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000002');
select is(current_user::text, 'authenticated', 'B uses the client role');
select is(auth.uid(), 'f0050000-0000-4000-8000-000000000002'::uuid, 'Auth context is B');
select is((select count(*) from public.budget_buckets), 0::bigint, 'B cannot read any of A active or archived rows');
select lives_ok($$insert into public.budget_buckets (profile_id, name, type)
  values ('f0050000-0000-4000-8000-000000000002', 'Needs', 'SPENDABLE')$$,
  'Different owners can use the same name');
select results_eq($$update public.budget_buckets set name = 'Forbidden'
  where profile_id = 'f0050000-0000-4000-8000-000000000001' returning id$$,
  array[]::uuid[], 'B cannot update A through RLS');
select results_eq($$update public.budget_buckets set archived_at = now()
  where profile_id = 'f0050000-0000-4000-8000-000000000001' returning id$$,
  array[]::uuid[], 'B cannot archive A through RLS');
select throws_ok($$insert into public.budget_buckets (profile_id, name, type)
  values ('f0050000-0000-4000-8000-000000000001', 'Forged', 'SAVINGS')$$,
  '42501', 'new row violates row-level security policy for table "budget_buckets"', 'B cannot insert for A');
reset role;

set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000003');
select is(current_user::text, 'authenticated', 'C uses the client role');
select is(auth.uid(), 'f0050000-0000-4000-8000-000000000003'::uuid, 'Auth context is C');
select is((select count(*) from public.budget_buckets), 0::bigint, 'Unrelated C cannot read A or B buckets');
select results_eq($$update public.budget_buckets set name = 'Forbidden' returning id$$,
  array[]::uuid[], 'Unrelated C cannot update any foreign bucket');
select results_eq($$update public.budget_buckets set archived_at = now() returning id$$,
  array[]::uuid[], 'Unrelated C cannot archive any foreign bucket');
select throws_ok($$insert into public.budget_buckets (profile_id, name, type)
  values ('f0050000-0000-4000-8000-000000000001', 'Forged', 'SPENDABLE')$$,
  '42501', 'new row violates row-level security policy for table "budget_buckets"', 'C cannot insert for A');
reset role;

set local role authenticated;
select pg_temp.set_jwt_subject(null);
select is(current_user::text, 'authenticated', 'Missing-subject checks still use the client role');
select is(auth.uid(), null::uuid, 'Auth subject is absent');
select is((select count(*) from public.budget_buckets), 0::bigint, 'Authenticated role alone grants no rows');
select results_eq($$update public.budget_buckets set name = 'Forbidden' returning id$$,
  array[]::uuid[], 'Missing subject cannot update rows');
select throws_ok($$insert into public.budget_buckets (profile_id, name, type)
  values ('f0050000-0000-4000-8000-000000000001', 'Forged', 'SPENDABLE')$$,
  '42501', 'new row violates row-level security policy for table "budget_buckets"', 'Missing subject cannot insert');
reset role;

set local role anon;
select pg_temp.set_jwt_subject(null);
select is(current_user::text, 'anon', 'Anonymous checks use the anon role');
select is(auth.uid(), null::uuid, 'Anonymous has no subject');
select throws_ok($$select * from public.budget_buckets$$,
  '42501', 'permission denied for table budget_buckets', 'Anonymous reads are denied by privileges, not merely filtered');
select throws_ok($$insert into public.budget_buckets (profile_id, name, type)
  values ('f0050000-0000-4000-8000-000000000001', 'Forbidden', 'SPENDABLE')$$,
  '42501', 'permission denied for table budget_buckets', 'Anonymous inserts are denied by privileges');
select throws_ok($$update public.budget_buckets set name = 'Forbidden'$$,
  '42501', 'permission denied for table budget_buckets', 'Anonymous updates are denied by privileges');
select throws_ok($$delete from public.budget_buckets$$,
  '42501', 'permission denied for table budget_buckets', 'Anonymous deletes are denied by privileges');
reset role;
select pg_temp.set_jwt_subject(null);

select throws_ok($$insert into public.budget_buckets (profile_id, name, type)
  values ('f0050000-0000-4000-8000-000000000099', 'Orphan', 'SPENDABLE')$$,
  '23503', null, 'An existing Profile is required independently of RLS');
select throws_ok($$insert into public.budget_buckets (profile_id, name, type)
  values (null, 'Orphan', 'SPENDABLE')$$,
  '23502', null, 'Ownership is required independently of RLS');
select throws_ok($$delete from public.profiles where id = 'f0050000-0000-4000-8000-000000000002'$$,
  '23503', null, 'Profile deletion is restricted while buckets exist');
insert into public.budget_buckets (profile_id, name, type, is_system)
values ('f0050000-0000-4000-8000-000000000001', 'System savings', 'SAVINGS', true);

set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text, 'authenticated', 'A lifecycle checks use the client role');
select is(auth.uid(), 'f0050000-0000-4000-8000-000000000001'::uuid, 'Auth context returns to A');
select is((select count(*) from public.budget_buckets), 4::bigint, 'A reads only own custom and system buckets');
select results_eq($$update public.budget_buckets set name = 'Customized' where is_system returning id$$,
  array[]::uuid[], 'System customization remains deferred');
select results_eq($$update public.budget_buckets set archived_at = now() where is_system returning id$$,
  array[]::uuid[], 'System archiving remains deferred');
select lives_ok($$update public.budget_buckets set archived_at = null where name = 'Savings'$$,
  'Owner can clear the custom archive marker without deleting history');
select ok((select archived_at is null and type = 'SAVINGS' from public.budget_buckets where name = 'Savings'), 'Restored bucket retains savings semantics');
select is((select count(*) from public.budget_buckets where profile_id = 'f0050000-0000-4000-8000-000000000002'), 0::bigint, 'A cannot read B');
reset role;
select pg_temp.set_jwt_subject(null);
select is((select name from public.budget_buckets where profile_id = 'f0050000-0000-4000-8000-000000000002'), 'Needs', 'B bucket is unchanged');
select is((select count(*) from public.budget_buckets), 5::bigint, 'Denied operations never deleted or added buckets');

select * from finish();
rollback;
