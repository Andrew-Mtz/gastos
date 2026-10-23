\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_catalog;
\ir helpers/auth.sql.inc
select no_plan();

-- Actual migrated PostgreSQL catalogs are authoritative, not generated types or
-- regexes over migrations. An unclassified table/view/function fails closed.
-- Built-in extension members (including pg_graphql) are excluded by dependency,
-- not by name, so application objects cannot hide behind an extension-like name.
create temp table privacy_relations(name text primary key, boundary text not null);
insert into privacy_relations values
  ('public.profiles','owner_private'),
  ('public.budget_periods','owner_private'),
  ('public.budget_buckets','owner_private'),
  ('public.budget_allocations','owner_private'),
  ('public.categories','owner_private'),
  ('public.transactions','owner_private'),
  ('public.savings_goals','owner_private'),
  ('public.recurring_expenses','owner_private'),
  ('public.transaction_revisions','owner_private'),
  ('public.budget_period_closures','owner_private'),
  ('public.budget_period_reopenings','owner_private'),
  ('public.budget_period_dispositions','owner_private'),
  ('public.budget_period_carry_reversals','owner_private'),
  ('public.households','active_household'),
  ('public.household_members','active_household'),
  ('public.household_recipient_codes','server_only'),
  ('public.household_invitations','server_only'),
  ('public.household_split_revisions','server_only'),
  ('public.household_split_shares','server_only');

create temp table privacy_functions(signature text primary key, boundary text not null, is_definer boolean not null);
insert into privacy_functions values
  ('public.accept_household_invitation(uuid)','household_rpc',true),
  ('public.get_household_default_split(uuid)','household_rpc',true),
  ('public.save_household_default_split(uuid,uuid,integer,uuid[],jsonb)','household_rpc',true),
  ('public.check_household_split_revision()','internal_trigger',true),
  ('public.audit_transaction_revision()','internal_trigger',true),
  ('public.check_budget_allocation_total()','internal_trigger',false),
  ('public.check_savings_integrity()','internal_trigger',false),
  ('public.close_and_dispose_personal_remainder(uuid,uuid,bigint,text,text,bigint,uuid,uuid,boolean)','personal_rpc',true),
  ('public.close_personal_budget_period(uuid,uuid,bigint,text,boolean)','personal_rpc',true),
  ('public.correct_personal_transaction(uuid,uuid,bigint,text,jsonb,boolean)','personal_rpc',true),
  ('public.create_first_household(uuid,text,text)','household_rpc',true),
  ('public.create_household_invitation(uuid,uuid,uuid)','household_rpc',true),
  ('public.create_personal_recurring_expense(uuid,text,uuid,text,text,integer,date,date,bigint)','personal_rpc',false),
  ('public.create_personal_savings_goal(uuid,text,bigint,text,date)','personal_rpc',false),
  ('public.get_bucket_consumption(uuid)','personal_rpc',false),
  ('public.get_my_household_invitations()','household_rpc',true),
  ('public.get_my_household_memberships()','household_rpc',true),
  ('public.get_personal_carry(uuid)','personal_rpc',false),
  ('public.get_personal_carry_reversal_context(uuid)','personal_rpc',false),
  ('public.get_personal_committed_money(uuid)','personal_rpc',false),
  ('public.get_personal_dashboard(date)','personal_rpc',false),
  ('public.get_personal_period_close_context(date)','personal_rpc',false),
  ('public.get_personal_recurring_month(date)','personal_rpc',false),
  ('public.get_personal_remainder_context(date)','personal_rpc',false),
  ('public.get_personal_safe_to_spend(uuid)','personal_rpc',false),
  ('public.get_personal_savings_goals(date)','personal_rpc',false),
  ('public.get_received_income(uuid)','personal_rpc',false),
  ('public.get_savings_availability(uuid)','personal_rpc',false),
  ('public.is_active_household_member(uuid)','household_rpc',true),
  ('public.lock_personal_finance()','actor_lock_helper',false),
  ('public.lock_personal_finance_write()','internal_trigger',false),
  ('public.prepare_budget_allocation_write()','internal_trigger',false),
  ('public.prepare_budget_bucket_update()','internal_trigger',false),
  ('public.prepare_budget_period_update()','internal_trigger',false),
  ('public.prepare_category_update()','internal_trigger',false),
  ('public.prepare_household_member_update()','internal_trigger',false),
  ('public.prepare_household_update()','internal_trigger',false),
  ('public.prepare_initial_budget_buckets()','personal_rpc',true),
  ('public.prepare_profile_write()','internal_trigger',false),
  ('public.prepare_transaction_revision()','internal_trigger',false),
  ('public.prepare_transaction_write()','internal_trigger',false),
  ('public.register_income(uuid,uuid,bigint,text,date,text)','personal_rpc',false),
  ('public.register_personal_expense(uuid,uuid,bigint,text,date,uuid,text)','personal_rpc',false),
  ('public.register_savings_movement(uuid,uuid,text,bigint,text,date,boolean,text,uuid)','personal_rpc',false),
  ('public.reopen_personal_budget_period(uuid,uuid,bigint,text,boolean)','personal_rpc',true),
  ('public.resolve_personal_recurring_expense(uuid,uuid,uuid,date,bigint,text,date,text)','personal_rpc',false),
  ('public.reverse_carry_and_reopen_personal_period(uuid,uuid,bigint,bigint,text,boolean)','personal_rpc',true),
  ('public.revoke_household_invitation(uuid)','household_rpc',true),
  ('public.save_budget_allocations(uuid,jsonb)','personal_rpc',false),
  ('public.save_initial_budget(date,text,bigint,jsonb)','personal_rpc',false),
  ('public.stop_personal_recurring_expense(uuid,date)','personal_rpc',false),
  ('public.validate_personal_expense()','internal_trigger',false),
  ('public.validate_personal_recurring_expense()','internal_trigger',false),
  ('public.validate_recurring_resolution()','internal_trigger',false),
  ('public.validate_savings_goal_movement()','internal_trigger',false),
  ('public.validate_savings_movement()','internal_trigger',false);

-- The exposed platform placeholder has a distinct contract, not application RPC
-- privileges. Its exact body/state/behavior are checked below and in membership.
create temp table privacy_platform_functions(signature text primary key, boundary text not null);
insert into privacy_platform_functions values
  ('graphql_public.graphql(text,text,jsonb,jsonb)','platform_graphql_placeholder');

create temp view application_relations as
select c.oid,c.oid::regclass::text as name,c.relkind,c.relrowsecurity
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','graphql_public') and c.relkind in ('r','p','v','m','f')
  and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass
    and d.objid=c.oid and d.deptype='e');
create temp view exposed_functions as
select p.* from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','graphql_public')
  and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass
    and d.objid=p.oid and d.deptype='e');

-- Canonical catalog names retain exact identity/overloads while making mismatches
-- actionable. Diagnostics are metadata only: never function bodies or row data.
select diag('Unclassified function: '||jsonb_build_object(
  'schema',n.nspname,
  'signature',p.oid::regprocedure::text,
  'kind',p.prokind,
  'language',l.lanname,
  'return_type',p.prorettype::regtype::text,
  'security_definer',p.prosecdef,
  'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
  'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
  'public_execute',exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where acl.grantee=0 and acl.privilege_type='EXECUTE'),
  'empty_search_path',coalesce(p.proconfig @> array['search_path=""'],false)
)::text)
from exposed_functions p join pg_namespace n on n.oid=p.pronamespace
join pg_language l on l.oid=p.prolang
where not exists(select 1 from privacy_functions f where to_regprocedure(f.signature)=p.oid)
  and not exists(select 1 from privacy_platform_functions f where to_regprocedure(f.signature)=p.oid)
order by n.nspname,p.oid::regprocedure::text;

select set_eq('select oid::regclass::text from application_relations',
  'select to_regclass(name)::text from privacy_relations',
  'Every application table/view in exposed schemas has an explicit privacy classification');
select set_eq('select oid::regprocedure::text from exposed_functions',
  'select to_regprocedure(signature)::text from privacy_functions union all select to_regprocedure(signature)::text from privacy_platform_functions',
  'Every exposed function has an explicit application or platform classification, including overloads');
select ok(c.relrowsecurity,'RLS enabled: '||r.name)
from privacy_relations r join application_relations c on c.oid=to_regclass(r.name);
select is(c.relkind::text,'r','No unreviewed view/materialized/foreign relation: '||r.name)
from privacy_relations r join application_relations c on c.oid=to_regclass(r.name);
select ok(not has_any_column_privilege('anon',r.name,privilege),
  'No anonymous '||privilege||': '||r.name)
from privacy_relations r cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) privilege;
select ok(not has_table_privilege('anon',r.name,privilege),'No anonymous '||privilege||': '||r.name)
from privacy_relations r cross join unnest(array['DELETE','TRUNCATE','TRIGGER']) privilege;
select ok(has_table_privilege('authenticated',name,'SELECT'),'Owner-private table remains readable under RLS: '||name)
from privacy_relations where boundary='owner_private';
select ok(not has_any_column_privilege('authenticated',name,privilege),
  'Server-only table has no client column '||privilege||': '||name)
from privacy_relations cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) privilege
where boundary='server_only';
select ok(not has_table_privilege('authenticated',name,privilege),
  'Server-only table has no client '||privilege||': '||name)
from privacy_relations cross join unnest(array['DELETE','TRUNCATE','TRIGGER']) privilege
where boundary='server_only';

select is(has_function_privilege('authenticated',p.oid,'EXECUTE'),f.boundary<>'internal_trigger',
  'Callable surface differs from mere function existence: '||f.signature)
from privacy_functions f join exposed_functions p on p.oid=to_regprocedure(f.signature);
select ok(not has_function_privilege('anon',p.oid,'EXECUTE'),'No anonymous function execution: '||f.signature)
from privacy_functions f join exposed_functions p on p.oid=to_regprocedure(f.signature);
select ok(not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
  where acl.grantee=0 and acl.privilege_type='EXECUTE'),'No default PUBLIC execution: '||f.signature)
from privacy_functions f join exposed_functions p on p.oid=to_regprocedure(f.signature);
select is(p.prorettype='trigger'::regtype,f.boundary='internal_trigger','Trigger is not a Data API RPC: '||f.signature)
from privacy_functions f join exposed_functions p on p.oid=to_regprocedure(f.signature);
select is(p.prosecdef,f.is_definer,'Definer capability remains explicitly reviewed: '||f.signature)
from privacy_functions f join exposed_functions p on p.oid=to_regprocedure(f.signature);
select ok(p.proconfig @> array['search_path=""'],'Empty search path: '||f.signature)
from privacy_functions f join exposed_functions p on p.oid=to_regprocedure(f.signature);

-- This is the known inert Supabase placeholder, not an active GraphQL resolver.
-- A platform upgrade/enabling pg_graphql must fail closed pending its own review.
create temp view platform_graphql_placeholder as
select p.* from pg_proc p join privacy_platform_functions f on p.oid=to_regprocedure(f.signature);
select ok(not exists(select 1 from pg_extension where extname='pg_graphql'),
  'GraphQL engine is absent; this contract covers only the platform placeholder');
select is(p.prokind::text,'f','Platform placeholder is a function') from platform_graphql_placeholder p;
select is(l.lanname::text,'plpgsql','Platform placeholder is PL/pgSQL, not the active SQL resolver')
from platform_graphql_placeholder p join pg_language l on l.oid=p.prolang;
select ok(p.prorettype='jsonb'::regtype and not p.proretset,'Platform placeholder returns one JSON response')
from platform_graphql_placeholder p;
select ok(not p.prosecdef,'Platform placeholder remains SECURITY INVOKER') from platform_graphql_placeholder p;
select ok(p.proconfig is null,'Platform placeholder has no function-local settings') from platform_graphql_placeholder p;
select is(p.proargnames,array['operationName','query','variables','extensions']::text[],
  'Platform placeholder accepts only the four reviewed GraphQL arguments') from platform_graphql_placeholder p;
select is(p.pronargdefaults::integer,4,'Platform placeholder retains four default arguments') from platform_graphql_placeholder p;
select is(pg_get_expr(p.proargdefaults,0),'NULL::text, NULL::text, NULL::jsonb, NULL::jsonb',
  'Platform placeholder defaults contain only typed NULLs, not executable expressions') from platform_graphql_placeholder p;
select ok(has_function_privilege(actor,p.oid,'EXECUTE'),'Platform placeholder is callable by '||actor)
from platform_graphql_placeholder p cross join unnest(array['anon','authenticated']) actor;
select ok(exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
  where acl.grantee=0 and acl.privilege_type='EXECUTE'),'Platform placeholder retains its reviewed PUBLIC execute')
from platform_graphql_placeholder p;
-- Official schema-17.sql at supabase/postgres 920bb634698fef8dee6e78d738330d2dd8e489c5,
-- blob 84790a4277ce693ad945c1e57c8f9eccc40bff23; remove whitespace only. Checking
-- the entire body prevents a different function from faking just __typename's error.
-- Never print prosrc: a mismatch emits only digests and requires source review.
select is(encode(sha256(convert_to(regexp_replace(p.prosrc,'[[:space:]]','','g'),'UTF8')),'hex'),
  '5a5a0d33767d2f238cba56551d9a9cccd8299228e1113cf21a44ab6932e78935',
  'Platform placeholder matches the complete reviewed official body') from platform_graphql_placeholder p;

select * from finish();
rollback;
