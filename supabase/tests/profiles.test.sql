\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
\ir helpers/auth.sql.inc
select plan(73);

select has_table('public', 'profiles', 'Profile table exists');
select columns_are('public', 'profiles', array[
  'id', 'display_name', 'base_currency', 'timezone', 'created_at', 'updated_at'
], 'Only the six approved columns exist');
select col_is_pk('public', 'profiles', 'id', 'Profile identity is the primary key');
select col_type_is('public', 'profiles', 'id', 'uuid', 'Identity is UUID');
select col_type_is('public', 'profiles', 'display_name', 'text', 'Display name is text');
select col_type_is('public', 'profiles', 'base_currency', 'text', 'Currency is text');
select col_type_is('public', 'profiles', 'timezone', 'text', 'Timezone is text');
select col_type_is('public', 'profiles', 'created_at', 'timestamp with time zone', 'Creation time is timezone-aware');
select col_type_is('public', 'profiles', 'updated_at', 'timestamp with time zone', 'Update time is timezone-aware');
select col_not_null('public', 'profiles', column_name, column_name || ' is required')
from unnest(array['id', 'display_name', 'base_currency', 'timezone', 'created_at', 'updated_at']) as column_name;
select col_hasnt_default('public', 'profiles', 'id', 'Identity has no generated default');
select ok(exists (
  select 1 from pg_constraint
  where conrelid = 'public.profiles'::regclass and contype = 'f'
    and confrelid = 'auth.users'::regclass and confdeltype = 'r'
    and pg_get_constraintdef(oid) = 'FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE RESTRICT'
), 'Profile references Auth identity with RESTRICT');
select ok((select relrowsecurity from pg_class where oid = 'public.profiles'::regclass), 'RLS is enabled');
select is((select count(*) from pg_policies where schemaname = 'public' and tablename = 'profiles'), 3::bigint, 'Exactly three owner policies exist');
select ok(exists (
  select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles'
    and cmd = 'UPDATE' and qual is not null and with_check is not null
), 'UPDATE has explicit USING and WITH CHECK');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'INSERT'), 'No broad INSERT grant');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'UPDATE'), 'No broad UPDATE grant');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'DELETE'), 'No client DELETE grant');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'TRUNCATE'), 'No client TRUNCATE grant');

select ok(has_table_privilege('authenticated', 'public.profiles', 'SELECT'), 'SELECT is granted: cross-user invisibility exercises RLS');

set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text, 'authenticated', 'Assertions run as the client role');
select is(auth.uid(), 'f0050000-0000-4000-8000-000000000001'::uuid, 'Auth context is User A');
select lives_ok($$
  insert into public.profiles (id, display_name, base_currency, timezone)
  values ('f0050000-0000-4000-8000-000000000001', 'Andy Test', 'UYU', 'America/Montevideo')
$$, 'A can create A Profile');
-- B does not have a Profile yet: denial must come from RLS, not duplicate-key handling.
select throws_ok($$
  insert into public.profiles (id, display_name, base_currency, timezone)
  values ('f0050000-0000-4000-8000-000000000002', 'Forged', 'USD', 'UTC')
$$, '42501', null, 'A cannot insert B identity');
select throws_ok($$
  insert into public.profiles (id, display_name, base_currency, timezone, created_at)
  values ('f0050000-0000-4000-8000-000000000001', 'Andy Test', 'UYU', 'UTC', now())
$$, '42501', null, 'Client cannot supply created_at');
select throws_ok($$
  insert into public.profiles (id, display_name, base_currency, timezone, updated_at)
  values ('f0050000-0000-4000-8000-000000000001', 'Andy Test', 'UYU', 'UTC', now())
$$, '42501', null, 'Client cannot supply updated_at');
select throws_ok($$
  insert into public.profiles (id, display_name, base_currency, timezone)
  values ('f0050000-0000-4000-8000-000000000001', 'Duplicate', 'UYU', 'UTC')
$$, '23505', null, 'Only one Profile per identity');

set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000002');
select is(current_user::text, 'authenticated', 'B assertions run as the client role');
select is(auth.uid(), 'f0050000-0000-4000-8000-000000000002'::uuid, 'Auth context is User B');
select lives_ok($$
  insert into public.profiles (id, display_name, base_currency, timezone)
  values ('f0050000-0000-4000-8000-000000000002', 'Partner Test', 'USD', 'UTC')
$$, 'B can create B Profile');
select results_eq('select id from public.profiles', array['f0050000-0000-4000-8000-000000000002'::uuid], 'B sees only B');
select is((select count(*) from public.profiles where id = 'f0050000-0000-4000-8000-000000000001'), 0::bigint, 'B cannot read A');

set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text, 'authenticated', 'Returning A assertions run as the client role');
select is(auth.uid(), 'f0050000-0000-4000-8000-000000000001'::uuid, 'Auth context returns to User A');
-- VALIDATION ONLY: deliberately expose B to A inside this rolled-back transaction.
reset role;
alter policy profiles_select_own on public.profiles using (true);
set local role authenticated;
select results_eq('select id from public.profiles', array['f0050000-0000-4000-8000-000000000001'::uuid], 'A sees only A');
select is((select count(*) from public.profiles where id = 'f0050000-0000-4000-8000-000000000002'), 0::bigint, 'A cannot read B');
-- Restore the policy for remaining assertions; never merge this validation branch.
reset role;
alter policy profiles_select_own on public.profiles using (id = (select auth.uid()));
set local role authenticated;
select results_eq($$
  update public.profiles set display_name = 'Forged' where id = 'f0050000-0000-4000-8000-000000000002' returning id
$$, array[]::uuid[], 'A cannot update B');
select throws_ok($$update public.profiles set id = 'f0050000-0000-4000-8000-000000000002'$$, '42501', null, 'A cannot change Profile identity');
select throws_ok($$update public.profiles set created_at = now()$$, '42501', null, 'Client cannot update created_at');
select throws_ok($$update public.profiles set updated_at = now()$$, '42501', null, 'Client cannot update updated_at');
select throws_ok($$delete from public.profiles$$, '42501', null, 'Client DELETE is denied');
select throws_ok($$truncate public.profiles$$, '42501', null, 'Client TRUNCATE is denied');

select throws_ok($$update public.profiles set display_name = ''$$, '23514', null, 'Empty name rejected');
select throws_ok($$update public.profiles set display_name = E' \t\n'$$, '23514', null, 'Whitespace-only name rejected');
select throws_ok($$update public.profiles set display_name = repeat('x', 101)$$, '23514', null, 'Overlong name rejected');
select throws_ok($$update public.profiles set display_name = null$$, '23502', null, 'Name is required');
select throws_ok($$update public.profiles set base_currency = 'usd'$$, '23514', null, 'Lowercase currency rejected');
select throws_ok($$update public.profiles set base_currency = 'US'$$, '23514', null, 'Currency must have three letters');
select throws_ok($$update public.profiles set base_currency = 'U1D'$$, '23514', null, 'Currency must contain ASCII letters');
select throws_ok($$update public.profiles set timezone = 'Invalid/Zone'$$, '23514', null, 'Unknown timezone rejected');
select throws_ok($$update public.profiles set timezone = '+03:00'$$, '23514', null, 'Numeric timezone offset rejected');
select throws_ok($$update public.profiles set timezone = 'EST'$$, '23514', null, 'Timezone abbreviation rejected');

select set_config('test.profile_created_at', (select created_at::text from public.profiles), true);
select set_config('test.profile_updated_at', (select updated_at::text from public.profiles), true);
select lives_ok($$
  update public.profiles set display_name = 'Andy Updated', base_currency = 'EUR', timezone = 'America/New_York'
$$, 'A can update all allowed fields, including another ISO currency');
select results_eq($$select display_name || ':' || base_currency || ':' || timezone from public.profiles$$,
  array['Andy Updated:EUR:America/New_York'], 'Allowed update is persisted');
select is((select created_at from public.profiles), current_setting('test.profile_created_at')::timestamptz, 'created_at stays unchanged');
select ok((select updated_at > current_setting('test.profile_updated_at')::timestamptz and updated_at <= statement_timestamp() from public.profiles), 'Database advances updated_at');

set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000003');
select is(current_user::text, 'authenticated', 'C assertions run as the client role');
select is(auth.uid(), 'f0050000-0000-4000-8000-000000000003'::uuid, 'Auth context is Stranger C');
select is((select count(*) from public.profiles), 0::bigint, 'Unrelated C sees neither Profile');
set local role anon;
select pg_temp.set_jwt_subject(null);
select is(current_user::text, 'anon', 'Anonymous assertions run as anon');
select is(auth.uid(), null::uuid, 'Anonymous context has no stale identity');
select throws_ok($$select * from public.profiles$$, '42501', null, 'Anonymous Profile reads denied');

reset role;
select pg_temp.set_jwt_subject(null);
select is(current_user::text, session_user::text, 'Integrity checks restore the session role');
select is(auth.uid(), null::uuid, 'Integrity checks have no stale identity');
-- Privileged setup checks integrity, never substitutes for client-role RLS assertions.
select is((select count(*) from public.profiles where id in (
  'f0050000-0000-4000-8000-000000000001', 'f0050000-0000-4000-8000-000000000002'
)), 2::bigint, 'Both Profiles survive all rejected mutations');
select is((select display_name from public.profiles where id = 'f0050000-0000-4000-8000-000000000002'), 'Partner Test', 'B Profile remains unchanged');
select throws_ok($$
  insert into public.profiles (id, display_name, base_currency, timezone)
  values ('f0050000-0000-4000-8000-000000000099', 'Missing Auth', 'USD', 'UTC')
$$, '23503', null, 'Profile requires an existing Auth identity');
select throws_ok($$delete from auth.users where id = 'f0050000-0000-4000-8000-000000000001'$$,
  '23503', null, 'Auth deletion is restricted while Profile exists');

select * from finish();
rollback;
