\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
\ir helpers/auth.sql.inc
select plan(127);

insert into public.profiles (id, display_name, base_currency, timezone) values
  ('f0050000-0000-4000-8000-000000000001', 'Andy Test', 'UYU', 'America/Montevideo'),
  ('f0050000-0000-4000-8000-000000000002', 'Partner Test', 'USD', 'UTC'),
  ('f0050000-0000-4000-8000-000000000003', 'Stranger Test', 'EUR', 'Europe/Madrid');

select has_table('public', 'budget_periods', 'Budget period table exists');
select columns_are('public', 'budget_periods', array[
  'id', 'profile_id', 'starts_on', 'ends_on', 'status', 'base_currency',
  'expected_income_minor', 'created_at', 'updated_at', 'closed_at'
], 'Only the ten approved columns exist');
select col_is_pk('public', 'budget_periods', 'id', 'Budget period id is the primary key');
select col_type_is('public', 'budget_periods', 'id', 'uuid', 'Id is UUID');
select col_type_is('public', 'budget_periods', 'profile_id', 'uuid', 'Profile identity is UUID');
select col_type_is('public', 'budget_periods', 'starts_on', 'date', 'Start uses date semantics');
select col_type_is('public', 'budget_periods', 'ends_on', 'date', 'End uses date semantics');
select col_type_is('public', 'budget_periods', 'status', 'text', 'Status is text');
select col_type_is('public', 'budget_periods', 'base_currency', 'text', 'Currency is text');
select col_type_is('public', 'budget_periods', 'expected_income_minor', 'bigint', 'Expected income uses bigint');
select col_type_is('public', 'budget_periods', 'created_at', 'timestamp with time zone', 'Creation time is timezone-aware');
select col_type_is('public', 'budget_periods', 'updated_at', 'timestamp with time zone', 'Update time is timezone-aware');
select col_type_is('public', 'budget_periods', 'closed_at', 'timestamp with time zone', 'Close time is timezone-aware');
select col_not_null('public', 'budget_periods', column_name, column_name || ' is required')
from unnest(array[
  'id', 'profile_id', 'starts_on', 'ends_on', 'status', 'base_currency',
  'created_at', 'updated_at'
]) as column_name;
select col_is_null('public', 'budget_periods', 'expected_income_minor', 'Expected income is nullable');
select col_is_null('public', 'budget_periods', 'closed_at', 'Close time is nullable');
select col_has_default('public', 'budget_periods', 'id', 'Id is generated');
select col_has_default('public', 'budget_periods', 'status', 'Status has a server default');
select col_has_default('public', 'budget_periods', 'created_at', 'Creation time has a server default');
select col_has_default('public', 'budget_periods', 'updated_at', 'Update time has a server default');
select col_hasnt_default('public', 'budget_periods', 'profile_id', 'Ownership has no default');
select col_hasnt_default('public', 'budget_periods', 'starts_on', 'Start date has no default');
select col_hasnt_default('public', 'budget_periods', 'ends_on', 'End date has no default');
select col_hasnt_default('public', 'budget_periods', 'base_currency', 'Currency has no default');
select col_hasnt_default('public', 'budget_periods', 'expected_income_minor', 'Expected income has no default');
select col_hasnt_default('public', 'budget_periods', 'closed_at', 'Close time has no default');
select is(
  (select pg_get_expr(adbin, adrelid) from pg_attrdef
   where adrelid = 'public.budget_periods'::regclass
     and adnum = (select attnum from pg_attribute
                  where attrelid = 'public.budget_periods'::regclass and attname = 'status')),
  '''OPEN''::text', 'New periods default to OPEN'
);
select ok(exists (
  select 1 from pg_constraint
  where conname = 'budget_periods_profile_id_fkey'
    and conrelid = 'public.budget_periods'::regclass
    and confrelid = 'public.profiles'::regclass
    and confdeltype = 'r'
), 'Profile foreign key uses ON DELETE RESTRICT');
select ok(exists (
  select 1 from pg_constraint
  where conname = 'budget_periods_profile_month_key'
    and conrelid = 'public.budget_periods'::regclass and contype = 'u'
), 'Profile and canonical month are unique');
select ok(exists (
  select 1 from pg_constraint where conrelid = 'public.budget_periods'::regclass
    and contype = 'c' and conname = 'budget_periods_calendar_month_check'
), 'Calendar-month constraint exists');
select ok(exists (
  select 1 from pg_constraint where conrelid = 'public.budget_periods'::regclass
    and contype = 'c' and conname = 'budget_periods_status_check'
), 'Status constraint exists');
select ok(exists (
  select 1 from pg_constraint where conrelid = 'public.budget_periods'::regclass
    and contype = 'c' and conname = 'budget_periods_closed_state_check'
), 'Closed-state constraint exists');
select ok(exists (
  select 1 from pg_constraint where conrelid = 'public.budget_periods'::regclass
    and contype = 'c' and conname = 'budget_periods_base_currency_check'
), 'Currency constraint exists');
select ok(exists (
  select 1 from pg_constraint where conrelid = 'public.budget_periods'::regclass
    and contype = 'c' and conname = 'budget_periods_expected_income_minor_check'
), 'Expected-income constraint exists');
select ok((select relrowsecurity from pg_class where oid = 'public.budget_periods'::regclass), 'RLS is enabled');
select is((select count(*) from pg_policies where schemaname = 'public' and tablename = 'budget_periods'), 3::bigint, 'Exactly three owner policies exist');
select is(
  (select string_agg(policyname::text, ',' order by policyname)
   from pg_policies where schemaname = 'public' and tablename = 'budget_periods'),
  'budget_periods_insert_own,budget_periods_select_own,budget_periods_update_open_own',
  'Only approved policies exist'
);
select ok(exists (
  select 1 from pg_policies where schemaname = 'public' and tablename = 'budget_periods'
    and policyname = 'budget_periods_update_open_own' and cmd = 'UPDATE'
    and qual is not null and with_check is not null
), 'UPDATE has explicit USING and WITH CHECK');
select ok(not exists (
  select 1 from pg_policies where schemaname = 'public' and tablename = 'budget_periods' and cmd = 'DELETE'
), 'No DELETE policy exists');

select ok(has_table_privilege('authenticated', 'public.budget_periods', 'SELECT'), 'Authenticated SELECT is granted');
select ok(not has_table_privilege('authenticated', 'public.budget_periods', 'INSERT'), 'No broad INSERT grant');
select ok(not has_table_privilege('authenticated', 'public.budget_periods', 'UPDATE'), 'No broad UPDATE grant');
select ok(not has_table_privilege('authenticated', 'public.budget_periods', 'DELETE'), 'No DELETE grant');
select ok(not has_table_privilege('authenticated', 'public.budget_periods', 'TRUNCATE'), 'No TRUNCATE grant');
select ok(has_column_privilege('authenticated', 'public.budget_periods', 'profile_id', 'INSERT'), 'Authenticated can insert ownership');
select ok(has_column_privilege('authenticated', 'public.budget_periods', 'starts_on', 'INSERT'), 'Authenticated can insert start date');
select ok(has_column_privilege('authenticated', 'public.budget_periods', 'ends_on', 'INSERT'), 'Authenticated can insert end date');
select ok(has_column_privilege('authenticated', 'public.budget_periods', 'base_currency', 'INSERT'), 'Authenticated can insert currency');
select ok(has_column_privilege('authenticated', 'public.budget_periods', 'expected_income_minor', 'INSERT'), 'Authenticated can insert expected income');
select ok(has_column_privilege('authenticated', 'public.budget_periods', 'expected_income_minor', 'UPDATE'), 'Authenticated can update expected income');
select ok(not exists (
  select 1 from unnest(array[
    'id', 'profile_id', 'starts_on', 'ends_on', 'status', 'base_currency',
    'created_at', 'updated_at', 'closed_at'
  ]) as column_name
  where has_column_privilege('authenticated', 'public.budget_periods', column_name, 'UPDATE')
), 'All other columns are immutable to authenticated clients');
select ok(not has_table_privilege('anon', 'public.budget_periods', 'SELECT'), 'Anonymous SELECT is not granted');
select ok(not has_table_privilege('anon', 'public.budget_periods', 'INSERT'), 'Anonymous INSERT is not granted');
select ok(not has_table_privilege('anon', 'public.budget_periods', 'UPDATE'), 'Anonymous UPDATE is not granted');

select is((select prosecdef from pg_proc where oid = 'public.prepare_budget_period_update()'::regprocedure), false, 'Timestamp function is SECURITY INVOKER');
select is((select array_to_string(proconfig, ',') from pg_proc where oid = 'public.prepare_budget_period_update()'::regprocedure), 'search_path=""', 'Timestamp function has an empty search path');
select ok(not has_function_privilege('public', 'public.prepare_budget_period_update()', 'EXECUTE'), 'Public cannot execute timestamp function');
select ok(not has_function_privilege('anon', 'public.prepare_budget_period_update()', 'EXECUTE'), 'Anon cannot execute timestamp function');
select ok(not has_function_privilege('authenticated', 'public.prepare_budget_period_update()', 'EXECUTE'), 'Authenticated cannot execute timestamp function');
select ok(exists (
  select 1 from pg_trigger
  where tgrelid = 'public.budget_periods'::regclass
    and tgname = 'budget_periods_prepare_update' and not tgisinternal
), 'Budget period update trigger exists');

set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text, 'authenticated', 'A assertions run as the client role');
select is(auth.uid(), 'f0050000-0000-4000-8000-000000000001'::uuid, 'Auth context is User A');
select lives_ok($$
  insert into public.budget_periods (profile_id, starts_on, ends_on, base_currency, expected_income_minor)
  values ('f0050000-0000-4000-8000-000000000001', '2030-01-01', '2030-01-31', 'USD', null)
$$, 'A can create A period with no income estimate');
select lives_ok($$insert into public.budget_periods (profile_id, starts_on, ends_on, base_currency, expected_income_minor)
  values ('f0050000-0000-4000-8000-000000000001', '2030-04-01', '2030-04-30', 'UYU', 0)$$,
  'A can create a 30-day month with explicit zero income');
select lives_ok($$insert into public.budget_periods (profile_id, starts_on, ends_on, base_currency, expected_income_minor)
  values ('f0050000-0000-4000-8000-000000000001', '2029-02-01', '2029-02-28', 'EUR', 150000)$$,
  'A can create ordinary February with positive income');
select lives_ok($$insert into public.budget_periods (profile_id, starts_on, ends_on, base_currency, expected_income_minor)
  values ('f0050000-0000-4000-8000-000000000001', '2028-02-01', '2028-02-29', 'ZZZ', 9007199254740991)$$,
  'A can create leap February with shape-valid currency and maximum-safe income');
select lives_ok($$insert into public.budget_periods (profile_id, starts_on, ends_on, base_currency)
  values ('f0050000-0000-4000-8000-000000000001', '2030-02-01', '2030-02-28', 'USD')$$,
  'Adjacent month is accepted');
select throws_ok($$insert into public.budget_periods (profile_id, starts_on, ends_on, base_currency)
  values ('f0050000-0000-4000-8000-000000000001', '2031-01-02', '2031-01-31', 'USD')$$,
  '23514', null, 'Start after day one is rejected');
select throws_ok($$insert into public.budget_periods (profile_id, starts_on, ends_on, base_currency)
  values ('f0050000-0000-4000-8000-000000000001', '2031-02-01', '2031-02-27', 'USD')$$,
  '23514', null, 'End before month end is rejected');
select throws_ok($$insert into public.budget_periods (profile_id, starts_on, ends_on, base_currency)
  values ('f0050000-0000-4000-8000-000000000001', '2031-03-01', '2031-04-01', 'USD')$$,
  '23514', null, 'End after month end is rejected');
select throws_ok($$insert into public.budget_periods (profile_id, starts_on, ends_on, base_currency)
  values ('f0050000-0000-4000-8000-000000000001', '2031-04-01', '2031-05-31', 'USD')$$,
  '23514', null, 'Boundaries spanning months are rejected');
select throws_ok($$insert into public.budget_periods (profile_id, starts_on, ends_on, base_currency)
  values ('f0050000-0000-4000-8000-000000000001', '2030-01-01', '2030-01-31', 'USD')$$,
  '23505', null, 'Duplicate month for one Profile is rejected');

select throws_ok($$insert into public.budget_periods (profile_id, starts_on, ends_on, base_currency)
  values ('f0050000-0000-4000-8000-000000000001', '2032-01-01', '2032-01-31', 'usd')$$,
  '23514', null, 'Lowercase currency is rejected');
select throws_ok($$insert into public.budget_periods (profile_id, starts_on, ends_on, base_currency)
  values ('f0050000-0000-4000-8000-000000000001', '2032-02-01', '2032-02-29', 'Usd')$$,
  '23514', null, 'Mixed-case currency is rejected');
select throws_ok($$insert into public.budget_periods (profile_id, starts_on, ends_on, base_currency)
  values ('f0050000-0000-4000-8000-000000000001', '2032-03-01', '2032-03-31', 'US')$$,
  '23514', null, 'Short currency is rejected');
select throws_ok($$insert into public.budget_periods (profile_id, starts_on, ends_on, base_currency)
  values ('f0050000-0000-4000-8000-000000000001', '2032-04-01', '2032-04-30', 'USDD')$$,
  '23514', null, 'Long currency is rejected');
select throws_ok($$insert into public.budget_periods (profile_id, starts_on, ends_on, base_currency)
  values ('f0050000-0000-4000-8000-000000000001', '2032-05-01', '2032-05-31', '12A')$$,
  '23514', null, 'Currency digits are rejected');
select throws_ok($$insert into public.budget_periods (profile_id, starts_on, ends_on, base_currency)
  values ('f0050000-0000-4000-8000-000000000001', '2032-06-01', '2032-06-30', ' USD')$$,
  '23514', null, 'Leading whitespace is rejected');
select throws_ok($$insert into public.budget_periods (profile_id, starts_on, ends_on, base_currency)
  values ('f0050000-0000-4000-8000-000000000001', '2032-07-01', '2032-07-31', 'USD ')$$,
  '23514', null, 'Trailing whitespace is rejected');
select throws_ok($$insert into public.budget_periods (profile_id, starts_on, ends_on, base_currency)
  values ('f0050000-0000-4000-8000-000000000001', '2032-08-01', '2032-08-31', 'ÚSD')$$,
  '23514', null, 'Non-ASCII letters are rejected');
select throws_ok($$insert into public.budget_periods (profile_id, starts_on, ends_on, base_currency, expected_income_minor)
  values ('f0050000-0000-4000-8000-000000000001', '2033-01-01', '2033-01-31', 'USD', -1)$$,
  '23514', null, 'Negative expected income is rejected');
select throws_ok($$insert into public.budget_periods (profile_id, starts_on, ends_on, base_currency, expected_income_minor)
  values ('f0050000-0000-4000-8000-000000000001', '2033-02-01', '2033-02-28', 'USD', 9007199254740992)$$,
  '23514', null, 'Expected income above the JavaScript safe range is rejected');
-- Text input mirrors a fractional Data API value. A numeric assignment cast could
-- round before a CHECK sees it, so explicitly test bigint input rejection instead.
select throws_ok($$select '1.5'::bigint$$, '22P02', null, 'Fractional bigint input is rejected before persistence');
select throws_ok($$insert into public.budget_periods (profile_id, starts_on, ends_on, base_currency)
  values ('f0050000-0000-4000-8000-000000000002', '2034-01-01', '2034-01-31', 'USD')$$,
  '42501', null, 'A cannot insert a period owned by B');
select throws_ok($$insert into public.budget_periods (profile_id, starts_on, ends_on, base_currency, status)
  values ('f0050000-0000-4000-8000-000000000001', '2034-02-01', '2034-02-28', 'USD', 'CLOSED')$$,
  '42501', null, 'Client cannot supply status');
select throws_ok($$insert into public.budget_periods (id, profile_id, starts_on, ends_on, base_currency)
  values (gen_random_uuid(), 'f0050000-0000-4000-8000-000000000001', '2034-03-01', '2034-03-31', 'USD')$$,
  '42501', null, 'Client cannot supply id');
select throws_ok($$insert into public.budget_periods (profile_id, starts_on, ends_on, base_currency, created_at)
  values ('f0050000-0000-4000-8000-000000000001', '2034-04-01', '2034-04-30', 'USD', now())$$,
  '42501', null, 'Client cannot supply created_at');
select throws_ok($$insert into public.budget_periods (profile_id, starts_on, ends_on, base_currency, updated_at)
  values ('f0050000-0000-4000-8000-000000000001', '2034-05-01', '2034-05-31', 'USD', now())$$,
  '42501', null, 'Client cannot supply updated_at');
select throws_ok($$insert into public.budget_periods (profile_id, starts_on, ends_on, base_currency, closed_at)
  values ('f0050000-0000-4000-8000-000000000001', '2034-06-01', '2034-06-30', 'USD', now())$$,
  '42501', null, 'Client cannot supply closed_at');

select results_eq($$select profile_id from public.budget_periods where starts_on = '2030-01-01'$$,
  array['f0050000-0000-4000-8000-000000000001'::uuid], 'A can select A period');
select ok((select id is not null and created_at is not null and updated_at is not null
  from public.budget_periods where starts_on = '2030-01-01'), 'Server-managed fields are generated');
select set_config('test.period_created_at', (select created_at::text from public.budget_periods where starts_on = '2030-01-01'), true);
select set_config('test.period_updated_at', (select updated_at::text from public.budget_periods where starts_on = '2030-01-01'), true);
select lives_ok($$update public.budget_periods set expected_income_minor = 250000
  where starts_on = '2030-01-01'$$, 'A can update A OPEN expected income');
select is((select expected_income_minor from public.budget_periods where starts_on = '2030-01-01'), 250000::bigint, 'Expected-income update persists');
select is((select created_at from public.budget_periods where starts_on = '2030-01-01'),
  current_setting('test.period_created_at')::timestamptz, 'created_at stays stable');
select ok((select updated_at > current_setting('test.period_updated_at')::timestamptz
  and updated_at <= statement_timestamp() from public.budget_periods where starts_on = '2030-01-01'),
  'Database advances updated_at');

set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000002');
select is(current_user::text, 'authenticated', 'B assertions run as the client role');
select is(auth.uid(), 'f0050000-0000-4000-8000-000000000002'::uuid, 'Auth context is User B');
select lives_ok($$insert into public.budget_periods (profile_id, starts_on, ends_on, base_currency, expected_income_minor)
  values ('f0050000-0000-4000-8000-000000000002', '2030-01-01', '2030-01-31', 'USD', 100000)$$,
  'Same month for another Profile is accepted');
select is((select count(*) from public.budget_periods where profile_id = 'f0050000-0000-4000-8000-000000000001'), 0::bigint, 'B cannot read A periods');

set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select results_eq($$update public.budget_periods set expected_income_minor = 1
  where profile_id = 'f0050000-0000-4000-8000-000000000002' returning id$$,
  array[]::uuid[], 'A cannot update B period through RLS');
select throws_ok($$update public.budget_periods set profile_id = 'f0050000-0000-4000-8000-000000000002'$$,
  '42501', null, 'Client cannot change ownership');
select throws_ok($$update public.budget_periods set starts_on = '2040-01-01'$$,
  '42501', null, 'Client cannot change starts_on');
select throws_ok($$update public.budget_periods set ends_on = '2040-01-31'$$,
  '42501', null, 'Client cannot change ends_on');
select throws_ok($$update public.budget_periods set base_currency = 'EUR'$$,
  '42501', null, 'Client cannot change currency snapshot');
select throws_ok($$update public.budget_periods set status = 'CLOSED'$$,
  '42501', null, 'Client cannot change status');
select throws_ok($$update public.budget_periods set closed_at = now()$$,
  '42501', null, 'Client cannot change closed_at');
select throws_ok($$update public.budget_periods set created_at = now()$$,
  '42501', null, 'Client cannot change created_at');
select throws_ok($$update public.budget_periods set updated_at = now()$$,
  '42501', null, 'Client cannot change updated_at');
select throws_ok($$delete from public.budget_periods$$, '42501', null, 'Client DELETE is denied by privileges');
select throws_ok($$truncate public.budget_periods$$, '42501', null, 'Client TRUNCATE is denied by privileges');

reset role;
select pg_temp.set_jwt_subject(null);
select throws_ok($$insert into public.budget_periods (profile_id, starts_on, ends_on, status, base_currency)
  values ('f0050000-0000-4000-8000-000000000001', '2035-01-01', '2035-01-31', 'INVALID', 'USD')$$,
  '23514', null, 'Unknown status is rejected');
select throws_ok($$insert into public.budget_periods (profile_id, starts_on, ends_on, status, base_currency)
  values ('f0050000-0000-4000-8000-000000000001', '2035-02-01', '2035-02-28', 'CLOSED', 'USD')$$,
  '23514', null, 'CLOSED requires closed_at');
select throws_ok($$insert into public.budget_periods (profile_id, starts_on, ends_on, status, base_currency, closed_at)
  values ('f0050000-0000-4000-8000-000000000001', '2035-03-01', '2035-03-31', 'OPEN', 'USD', now())$$,
  '23514', null, 'OPEN requires null closed_at');
select throws_ok($$insert into public.budget_periods (profile_id, starts_on, ends_on, base_currency)
  values ('f0050000-0000-4000-8000-000000000099', '2035-04-01', '2035-04-30', 'USD')$$,
  '23503', null, 'Budget period requires an existing Profile');
insert into public.budget_periods (
  profile_id, starts_on, ends_on, status, base_currency, expected_income_minor, closed_at
) values (
  'f0050000-0000-4000-8000-000000000001', '2036-01-01', '2036-01-31',
  'CLOSED', 'USD', 777000, statement_timestamp()
);

set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select results_eq($$select expected_income_minor from public.budget_periods where starts_on = '2036-01-01'$$,
  array[777000::bigint], 'Owner can select a CLOSED period');
select results_eq($$update public.budget_periods set expected_income_minor = 1
  where starts_on = '2036-01-01' returning expected_income_minor$$,
  array[]::bigint[], 'CLOSED period is ineligible for ordinary owner update');

set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000002');
select is((select count(*) from public.budget_periods where starts_on = '2036-01-01'), 0::bigint, 'B cannot observe A CLOSED period');

set local role anon;
select pg_temp.set_jwt_subject(null);
select throws_ok($$select * from public.budget_periods$$, '42501', null, 'Anonymous reads are denied by privileges');

reset role;
select pg_temp.set_jwt_subject(null);
select is((select expected_income_minor from public.budget_periods
  where profile_id = 'f0050000-0000-4000-8000-000000000001' and starts_on = '2036-01-01'),
  777000::bigint, 'CLOSED period remains unchanged');
select throws_ok($$delete from public.profiles where id = 'f0050000-0000-4000-8000-000000000002'$$,
  '23503', null, 'Profile deletion is restricted while budget periods exist');

select * from finish();
rollback;
