\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
\ir helpers/auth.sql.inc
select no_plan();

select has_table('public', 'households', 'Household identity table exists');
select has_table('public', 'household_members', 'Membership collection exists');
select columns_are('public', 'households', array[
  'id', 'name', 'default_currency', 'created_by', 'created_at', 'updated_at'
], 'Households contain only the FIN-201 identity fields');
select columns_are('public', 'household_members', array[
  'id', 'household_id', 'profile_id', 'role', 'joined_at', 'left_at'
], 'Memberships contain no invitation or default-split fields');
select col_is_pk('public', 'households', 'id', 'Household identity is primary');
select col_is_pk('public', 'household_members', 'id', 'Membership identity is primary');
select col_not_null('public', 'households', column_name, column_name || ' is required')
from unnest(array['id', 'name', 'default_currency', 'created_by', 'created_at', 'updated_at']) column_name;
select col_not_null('public', 'household_members', column_name, column_name || ' is required')
from unnest(array['id', 'household_id', 'profile_id', 'role', 'joined_at']) column_name;
select col_is_null('public', 'household_members', 'left_at', 'Active structural membership has no departure timestamp');
select col_hasnt_default('public', 'household_members', 'role', 'Role must be explicit, never inferred from creator');
select col_type_is('public', 'households', column_name, 'timestamp with time zone', column_name || ' is timezone-aware')
from unnest(array['created_at', 'updated_at']) column_name;
select col_type_is('public', 'household_members', column_name, 'timestamp with time zone', column_name || ' is timezone-aware')
from unnest(array['joined_at', 'left_at']) column_name;
select ok(exists (
  select 1 from pg_constraint
  where conrelid = table_name::regclass and conname = constraint_name and contype = 'f'
    and confrelid = target_table::regclass and confdeltype = 'r'
), constraint_name || ' references application identity with restricted deletion')
from (values
  ('public.households', 'households_created_by_fkey', 'public.profiles'),
  ('public.household_members', 'household_members_household_id_fkey', 'public.households'),
  ('public.household_members', 'household_members_profile_id_fkey', 'public.profiles')
) references_to_check(table_name, constraint_name, target_table);
select ok((select relrowsecurity from pg_class where oid = table_name::regclass), table_name || ' has RLS enabled')
from unnest(array['public.households', 'public.household_members']) table_name;
select is((select count(*) from pg_policies where schemaname = 'public'
  and tablename in ('households', 'household_members')), 2::bigint,
  'FIN-202 supersedes the closed foundation with two SELECT-only policies');
select is((select count(*) from pg_policies where schemaname = 'public'
  and tablename in ('households', 'household_members') and cmd <> 'SELECT'), 0::bigint,
  'The foundation still has no client write policy');
select ok(not has_table_privilege(role_name, table_name, privilege_name),
  role_name || ' has no ' || privilege_name || ' on ' || table_name)
from unnest(array['anon', 'authenticated']) role_name
cross join unnest(array['public.households', 'public.household_members']) table_name
cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) privilege_name;
select ok(not has_any_column_privilege(role_name, table_name, privilege_name),
  role_name || ' has no column ' || privilege_name || ' on ' || table_name)
from unnest(array['anon', 'authenticated']) role_name
cross join unnest(array['public.households', 'public.household_members']) table_name
cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) privilege_name
where role_name <> 'authenticated' or privilege_name <> 'SELECT';
select ok(not exists (
  select 1 from pg_class c cross join lateral aclexplode(c.relacl) acl
  where c.oid = table_name::regclass and acl.grantee = 0
), table_name || ' has no PUBLIC table grant')
from unnest(array['public.households', 'public.household_members']) table_name;
select is((select prosecdef from pg_proc where oid = function_name::regprocedure), false,
  function_name || ' is invoker, not an elevated capability')
from unnest(array['public.prepare_household_update()', 'public.prepare_household_member_update()']) function_name;
select ok(not has_function_privilege(role_name, function_name, 'EXECUTE'),
  role_name || ' cannot invoke ' || function_name)
from unnest(array['anon', 'authenticated']) role_name
cross join unnest(array['public.prepare_household_update()', 'public.prepare_household_member_update()']) function_name;
select ok((select proconfig @> array['search_path=""'] from pg_proc
  where oid = function_name::regprocedure), function_name || ' has an empty search path')
from unnest(array['public.prepare_household_update()', 'public.prepare_household_member_update()']) function_name;

-- These are privileged, synthetic fixtures, not application creation operations.
insert into public.profiles(id, display_name, base_currency, timezone)
select id, 'Synthetic private profile', 'USD', 'UTC'
from auth.users where id::text like 'f0050000%';
insert into auth.users(id, email)
values ('f2010000-0000-4000-8000-000000000004', 'fin201-d@example.invalid');
insert into public.profiles(id, display_name, base_currency, timezone)
values ('f2010000-0000-4000-8000-000000000004', 'Synthetic fourth profile', 'USD', 'UTC');
insert into public.households(id, name, default_currency, created_by) values
  ('f2010000-0000-4000-8000-000000000001', 'Synthetic Home', 'UYU', 'f0050000-0000-4000-8000-000000000001'),
  ('f2010000-0000-4000-8000-000000000002', 'Synthetic Other', 'USD', 'f0050000-0000-4000-8000-000000000003'),
  ('f2010000-0000-4000-8000-000000000003', 'Synthetic Future', 'EUR', 'f0050000-0000-4000-8000-000000000001');
insert into public.household_members(id, household_id, profile_id, role, joined_at) values
  ('f2011000-0000-4000-8000-000000000001', 'f2010000-0000-4000-8000-000000000001', 'f0050000-0000-4000-8000-000000000001', 'OWNER', '2026-01-01 00:00:00+00'),
  ('f2011000-0000-4000-8000-000000000002', 'f2010000-0000-4000-8000-000000000001', 'f0050000-0000-4000-8000-000000000002', 'MEMBER', '2026-01-01 00:00:00+00'),
  ('f2011000-0000-4000-8000-000000000003', 'f2010000-0000-4000-8000-000000000002', 'f0050000-0000-4000-8000-000000000003', 'OWNER', '2026-01-01 00:00:00+00');
select lives_ok($$insert into public.household_members(household_id, profile_id, role)
  values ('f2010000-0000-4000-8000-000000000001', 'f2010000-0000-4000-8000-000000000004', 'MEMBER')$$,
  'Collection accepts a third member, not an exactly-two model');
select lives_ok($$insert into public.household_members(household_id, profile_id, role)
  values ('f2010000-0000-4000-8000-000000000003', 'f0050000-0000-4000-8000-000000000002', 'OWNER')$$,
  'Closed foundation does not decide single-active-household policy');
select is((select count(*) from public.household_members
  where household_id = 'f2010000-0000-4000-8000-000000000003'
  and profile_id = 'f0050000-0000-4000-8000-000000000001'), 0::bigint,
  'Creator provenance does not silently grant ownership or membership');
select lives_ok($$insert into public.household_members(household_id, profile_id, role)
  values ('f2010000-0000-4000-8000-000000000003', 'f2010000-0000-4000-8000-000000000004', 'OWNER')$$,
  'Closed foundation does not decide owner cardinality');

select throws_ok($$insert into public.households(name, default_currency, created_by)
  values ('', 'USD', 'f0050000-0000-4000-8000-000000000001')$$,
  '23514', null, 'Empty household name is rejected');
select throws_ok($$insert into public.households(name, default_currency, created_by)
  values (E' \t\n', 'USD', 'f0050000-0000-4000-8000-000000000001')$$,
  '23514', null, 'Whitespace-only household name is rejected');
select throws_ok($$insert into public.households(name, default_currency, created_by)
  values (repeat('x', 101), 'USD', 'f0050000-0000-4000-8000-000000000001')$$,
  '23514', null, 'Overlong household name is rejected');
select throws_ok(format(
  'insert into public.households(name, default_currency, created_by) values (%L, %L, %L)',
  'Invalid currency', currency, 'f0050000-0000-4000-8000-000000000001'
), '23514', null, 'Invalid household currency shape is rejected: ' || currency)
from unnest(array['usd', 'US', 'U1D', ' USD', 'USD ']) currency;
select throws_ok($$insert into public.households(name, default_currency, created_by)
  values ('Missing profile', 'USD', 'f2010000-0000-4000-8000-000000000099')$$,
  '23503', null, 'Household creator must reference a Profile');
select throws_ok($$insert into public.household_members(household_id, profile_id, role)
  values ('f2010000-0000-4000-8000-000000000099', 'f0050000-0000-4000-8000-000000000001', 'MEMBER')$$,
  '23503', null, 'Membership must reference an existing household');
select throws_ok($$insert into public.household_members(household_id, profile_id, role)
  values ('f2010000-0000-4000-8000-000000000002', 'f2010000-0000-4000-8000-000000000099', 'MEMBER')$$,
  '23503', null, 'Membership must reference an existing Profile');
select throws_ok($$insert into public.household_members(household_id, profile_id, role)
  values ('f2010000-0000-4000-8000-000000000002', 'f0050000-0000-4000-8000-000000000001', 'ADMIN')$$,
  '23514', null, 'Unknown role label is rejected');
select throws_ok($$insert into public.household_members(household_id, profile_id, role)
  values ('f2010000-0000-4000-8000-000000000001', 'f0050000-0000-4000-8000-000000000002', 'OWNER')$$,
  '23505', null, 'Duplicate household/Profile membership is rejected');
select throws_ok($$insert into public.household_members(household_id, profile_id, role, joined_at, left_at)
  values ('f2010000-0000-4000-8000-000000000002', 'f0050000-0000-4000-8000-000000000001',
    'MEMBER', '2026-02-01 00:00:00+00', '2026-01-01 00:00:00+00')$$,
  '23514', null, 'Departure cannot precede joining');
select throws_ok($$insert into public.household_members(household_id, profile_id, role, joined_at)
  values ('f2010000-0000-4000-8000-000000000002', 'f0050000-0000-4000-8000-000000000001',
    'MEMBER', 'infinity')$$, '23514', null, 'Join timestamp must be finite');
select throws_ok($$update public.household_members set left_at = 'infinity'
  where id = 'f2011000-0000-4000-8000-000000000002'$$,
  '23514', null, 'Departure timestamp must be finite');
select lives_ok($$insert into public.household_members(household_id, profile_id, role, joined_at, left_at)
  values ('f2010000-0000-4000-8000-000000000002', 'f2010000-0000-4000-8000-000000000004',
    'MEMBER', '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00')$$,
  'Same-instant departure is a valid historical structural row');
select throws_ok($$insert into public.household_members(household_id, profile_id, role)
  values ('f2010000-0000-4000-8000-000000000002', 'f2010000-0000-4000-8000-000000000004', 'MEMBER')$$,
  '23505', null, 'Departed membership still retains its pair identity');
select throws_ok($$delete from public.households where id = 'f2010000-0000-4000-8000-000000000002'$$,
  '23503', null, 'Household deletion cannot cascade away memberships');
select throws_ok($$delete from public.profiles where id = 'f2010000-0000-4000-8000-000000000004'$$,
  '23503', null, 'Profile deletion cannot cascade away membership attribution');
select throws_ok($$delete from public.profiles where id = 'f0050000-0000-4000-8000-000000000001'$$,
  '23503', null, 'Profile deletion cannot cascade away household creator attribution');
select throws_ok($$update public.households set id = 'f2010000-0000-4000-8000-000000000099'
  where id = 'f2010000-0000-4000-8000-000000000001'$$,
  '23514', 'Household identity and creator are immutable', 'Household identity cannot move');
select throws_ok($$update public.households set created_by = 'f0050000-0000-4000-8000-000000000002'
  where id = 'f2010000-0000-4000-8000-000000000001'$$,
  '23514', 'Household identity and creator are immutable', 'Creator audit cannot be reassigned');
select set_config('test.household_created_at', (select created_at::text from public.households
  where id = 'f2010000-0000-4000-8000-000000000001'), true);
select lives_ok($$update public.households set name = 'Synthetic renamed', created_at = '1900-01-01',
  updated_at = '2100-01-01' where id = 'f2010000-0000-4000-8000-000000000001'$$,
  'Trusted metadata update preserves server timestamp provenance');
select is((select created_at from public.households where id = 'f2010000-0000-4000-8000-000000000001'),
  current_setting('test.household_created_at')::timestamptz, 'Creation timestamp is preserved');
select ok((select updated_at > created_at and updated_at <= statement_timestamp()
  from public.households where id = 'f2010000-0000-4000-8000-000000000001'),
  'Database advances update timestamp, not caller-provided time');
select throws_ok(format('update public.household_members set %I = %L where id = %L',
  column_name, new_value, 'f2011000-0000-4000-8000-000000000002'),
  '23514', 'Household membership identity and join time are immutable',
  'Membership cannot rewrite ' || column_name)
from (values
  ('id', 'f2011000-0000-4000-8000-000000000099'),
  ('household_id', 'f2010000-0000-4000-8000-000000000002'),
  ('profile_id', 'f0050000-0000-4000-8000-000000000003'),
  ('joined_at', '2025-01-01 00:00:00+00')
) changes(column_name, new_value);

-- A real household relation must not alter private Profile or financial RLS.
insert into public.budget_periods(id, profile_id, starts_on, ends_on, base_currency) values
  ('f2012000-0000-4000-8000-000000000001', 'f0050000-0000-4000-8000-000000000001', '2026-01-01', '2026-01-31', 'USD'),
  ('f2012000-0000-4000-8000-000000000002', 'f0050000-0000-4000-8000-000000000002', '2026-01-01', '2026-01-31', 'USD');
insert into public.transactions(id, owner_profile_id, budget_period_id, type, amount_minor, currency, transaction_date) values
  ('f2013000-0000-4000-8000-000000000001', 'f0050000-0000-4000-8000-000000000001', 'f2012000-0000-4000-8000-000000000001', 'INCOME', 10000, 'USD', '2026-01-02'),
  ('f2013000-0000-4000-8000-000000000002', 'f0050000-0000-4000-8000-000000000002', 'f2012000-0000-4000-8000-000000000002', 'INCOME', 20000, 'USD', '2026-01-02');

set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text, 'authenticated', 'A tests run as client role');
select is(auth.uid(), 'f0050000-0000-4000-8000-000000000001'::uuid, 'A subject is genuine auth.uid()');
select throws_ok('select * from public.households', '42501', 'permission denied for table households',
  'OWNER cannot read ungranted household audit fields with SELECT star');
select throws_ok('select * from public.household_members', '42501', 'permission denied for table household_members',
  'OWNER cannot read ungranted membership lifecycle fields with SELECT star');
select throws_ok($$insert into public.households(name, default_currency, created_by)
  values ('Forged creator', 'USD', 'f0050000-0000-4000-8000-000000000002')$$,
  '42501', 'permission denied for table households', 'No client household/creator forgery');
select throws_ok($$insert into public.household_members(household_id, profile_id, role)
  values ('f2010000-0000-4000-8000-000000000002', 'f0050000-0000-4000-8000-000000000001', 'OWNER')$$,
  '42501', 'permission denied for table household_members', 'No self-enrollment or owner forgery');
select throws_ok('update public.households set created_by = auth.uid()', '42501',
  'permission denied for table households', 'No client creator reassignment');
select throws_ok($$update public.household_members set role = 'OWNER'$$, '42501',
  'permission denied for table household_members', 'No client role escalation');
select throws_ok('update public.household_members set left_at = null', '42501',
  'permission denied for table household_members', 'No client membership reactivation');
select throws_ok('delete from public.households', '42501', 'permission denied for table households', 'No client household deletion');
select throws_ok('delete from public.household_members', '42501', 'permission denied for table household_members', 'No client membership deletion');
select throws_ok('truncate public.households', '42501', 'permission denied for table households', 'No client household truncation');
select throws_ok('truncate public.household_members', '42501', 'permission denied for table household_members', 'No client membership truncation');
select results_eq('select id from public.profiles', array['f0050000-0000-4000-8000-000000000001'::uuid], 'A sees only A private Profile');
select results_eq('select id from public.budget_periods', array['f2012000-0000-4000-8000-000000000001'::uuid], 'A sees only A private budget');
select results_eq('select id from public.transactions', array['f2013000-0000-4000-8000-000000000001'::uuid], 'A sees only A income, never partner B income');

reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000002');
select is(current_user::text, 'authenticated', 'B tests run as client role');
select is(auth.uid(), 'f0050000-0000-4000-8000-000000000002'::uuid, 'B subject is genuine auth.uid()');
select throws_ok('select * from public.households', '42501', 'permission denied for table households', 'Member B cannot read ungranted household audit fields');
select throws_ok('select * from public.household_members', '42501', 'permission denied for table household_members', 'Member B cannot read ungranted membership lifecycle fields');
select results_eq('select id from public.profiles', array['f0050000-0000-4000-8000-000000000002'::uuid], 'Actual partner B cannot read A private Profile');
select results_eq('select id from public.budget_periods', array['f2012000-0000-4000-8000-000000000002'::uuid], 'Actual partner B cannot read A private budget');
select results_eq('select id from public.transactions', array['f2013000-0000-4000-8000-000000000002'::uuid], 'Actual partner B cannot read A income');
select results_eq($$update public.transactions set description = 'Forged partner edit'
  where id = 'f2013000-0000-4000-8000-000000000001' returning id$$,
  array[]::uuid[], 'Actual partner B cannot modify A personal transaction');
select throws_ok($$insert into public.transactions(owner_profile_id, budget_period_id, type, amount_minor, currency, transaction_date)
  values ('f0050000-0000-4000-8000-000000000001', 'f2012000-0000-4000-8000-000000000001',
    'INCOME', 1, 'USD', '2026-01-03')$$, '42501', null, 'Actual partner B cannot forge A financial ownership');

reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000003');
select is(current_user::text, 'authenticated', 'C tests run as client role');
select is(auth.uid(), 'f0050000-0000-4000-8000-000000000003'::uuid, 'C subject is genuine auth.uid()');
select throws_ok('select * from public.households', '42501', 'permission denied for table households', 'C cannot read ungranted household audit fields');
select throws_ok('select * from public.household_members', '42501', 'permission denied for table household_members', 'C cannot read ungranted membership lifecycle fields');
select results_eq('select id from public.profiles', array['f0050000-0000-4000-8000-000000000003'::uuid], 'Unrelated C sees only C private Profile');
select is((select count(*) from public.budget_periods), 0::bigint, 'Unrelated C sees neither personal budget');
select is((select count(*) from public.transactions), 0::bigint, 'Unrelated C sees neither personal income');

reset role;
set local role anon;
select pg_temp.set_jwt_subject(null);
select is(current_user::text, 'anon', 'Anonymous checks run as anon');
select is(auth.uid(), null::uuid, 'Anonymous context has no stale identity');
select throws_ok('select * from public.households', '42501', 'permission denied for table households', 'No anonymous household discovery');
select throws_ok('select * from public.household_members', '42501', 'permission denied for table household_members', 'No anonymous membership discovery');
select throws_ok($$insert into public.households(name, default_currency, created_by)
  values ('Anonymous', 'USD', 'f0050000-0000-4000-8000-000000000001')$$,
  '42501', 'permission denied for table households', 'No anonymous household creation');
select throws_ok($$insert into public.household_members(household_id, profile_id, role)
  values ('f2010000-0000-4000-8000-000000000002', 'f0050000-0000-4000-8000-000000000001', 'OWNER')$$,
  '42501', 'permission denied for table household_members', 'No anonymous self-enrollment');

reset role;
select pg_temp.set_jwt_subject(null);
select is(current_user::text, session_user::text, 'Restore privileged role only for test grant setup');
select is(auth.uid(), null::uuid, 'Grant setup has no stale user identity');
-- Isolate RLS from SQL privilege denial. These grants are test-only, remain inside
-- this transaction, and disappear with the final rollback. No policy is added.
grant select, insert, update, delete on public.households, public.household_members to authenticated;
select ok(has_table_privilege('authenticated', table_name, privilege_name),
  'Test-only ' || privilege_name || ' grant isolates RLS on ' || table_name)
from unnest(array['public.households', 'public.household_members']) table_name
cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) privilege_name;

set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text, 'authenticated', 'RLS-only A checks run as client role');
select is(auth.uid(), 'f0050000-0000-4000-8000-000000000001'::uuid, 'RLS-only checks use A');
select results_eq('select id from public.households', array['f2010000-0000-4000-8000-000000000001'::uuid],
  'Active RLS permits Home but excludes Future despite A creator provenance');
select is((select count(*) from public.household_members), 3::bigint, 'Active RLS shows only the three active Home members');
select throws_ok($$insert into public.households(name, default_currency, created_by)
  values ('Otherwise valid A household', 'USD', 'f0050000-0000-4000-8000-000000000001')$$,
  '42501', 'new row violates row-level security policy for table "households"',
  'RLS itself rejects a valid own-household INSERT');
select throws_ok($$insert into public.household_members(household_id, profile_id, role)
  values ('f2010000-0000-4000-8000-000000000002', 'f0050000-0000-4000-8000-000000000001', 'OWNER')$$,
  '42501', 'new row violates row-level security policy for table "household_members"',
  'RLS itself rejects otherwise valid self-enrollment into another household');
select results_eq($$update public.households set name = 'Forbidden' returning id$$,
  array[]::uuid[], 'RLS filters household UPDATE even with grant');
select results_eq($$update public.household_members set role = 'OWNER' returning id$$,
  array[]::uuid[], 'RLS filters role escalation even with grant');
select results_eq('delete from public.households returning id', array[]::uuid[], 'RLS filters household DELETE even with grant');
select results_eq('delete from public.household_members returning id', array[]::uuid[], 'RLS filters membership DELETE even with grant');

reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000002');
select is(current_user::text, 'authenticated', 'RLS-only B checks run as client role');
select is(auth.uid(), 'f0050000-0000-4000-8000-000000000002'::uuid, 'RLS-only checks use actual partner B');
select results_eq('select id from public.households order by id', array[
  'f2010000-0000-4000-8000-000000000001'::uuid, 'f2010000-0000-4000-8000-000000000003'::uuid
], 'Active RLS preserves multiple authorized households for B');
select is((select count(*) from public.household_members), 5::bigint, 'B sees only active members of the two authorized households');

reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000003');
select is(current_user::text, 'authenticated', 'RLS-only C checks run as client role');
select is(auth.uid(), 'f0050000-0000-4000-8000-000000000003'::uuid, 'RLS-only checks use unrelated C');
select results_eq('select id from public.households', array['f2010000-0000-4000-8000-000000000002'::uuid],
  'C sees only Other, never the unrelated A/B households');
select is((select count(*) from public.household_members), 1::bigint, 'C cannot discover unrelated or departed members');

reset role;
set local role authenticated;
select pg_temp.set_jwt_subject(null);
select is(current_user::text, 'authenticated', 'Missing-identity checks run as client role');
select is(auth.uid(), null::uuid, 'Missing identity is not a stale subject');
select is((select count(*) from public.households), 0::bigint, 'Role alone cannot read households');
select is((select count(*) from public.household_members), 0::bigint, 'Role alone cannot read memberships');
select throws_ok($$insert into public.households(name, default_currency, created_by)
  values ('Missing identity', 'USD', 'f0050000-0000-4000-8000-000000000001')$$,
  '42501', 'new row violates row-level security policy for table "households"', 'Missing identity cannot create a household');

reset role;
select pg_temp.set_jwt_subject(null);
select is(current_user::text, session_user::text, 'Final integrity checks restore session role');
select is(auth.uid(), null::uuid, 'Final integrity checks have no stale identity');
select is((select count(*) from public.households), 3::bigint, 'Rejected client mutations preserve every household');
select is((select count(*) from public.household_members), 7::bigint, 'Rejected client mutations preserve every membership');
select is((select role from public.household_members where id = 'f2011000-0000-4000-8000-000000000002'),
  'MEMBER', 'Actual partner role was not escalated');
select is((select count(*) from public.transactions), 2::bigint, 'Private income fixtures survive rejected writes');
select is((select count(*) from pg_policies where schemaname = 'public'
  and tablename in ('households', 'household_members')), 2::bigint, 'Tests preserve only the reviewed FIN-202 SELECT policies');
select * from finish();
rollback;
