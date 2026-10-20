\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_catalog;
\ir helpers/auth.sql.inc
select no_plan();
insert into public.profiles(id,display_name,base_currency,timezone)
values('f0050000-0000-4000-8000-000000000001','Synthetic','USD','UTC');
create function pg_temp.month(n integer default 0) returns date language sql stable as $$select (date_trunc('month',statement_timestamp() at time zone 'UTC')+make_interval(months=>n))::date$$;
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('f1230001-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into public.budget_periods(id,profile_id,starts_on,ends_on,base_currency)
select pg_temp.id(n+10),'f0050000-0000-4000-8000-000000000001',pg_temp.month(n),(pg_temp.month(n)+interval '1 month -1 day')::date,'USD' from generate_series(-2,-1) n;
insert into public.budget_buckets(id,profile_id,name,type) values(pg_temp.id(30),'f0050000-0000-4000-8000-000000000001','Needs','SPENDABLE');
insert into public.categories(id,profile_id,name,budget_bucket_id) values(pg_temp.id(31),'f0050000-0000-4000-8000-000000000001','Bills',pg_temp.id(30));
-- Synthetic historical templates only; production creation cannot backdate them.
set constraints all immediate;
alter table public.recurring_expenses disable trigger recurring_expenses_validate;
insert into public.recurring_expenses(id,owner_profile_id,name,category_id,amount_mode,default_amount_minor,currency,due_day,active_from,active_until) values
(pg_temp.id(40),'f0050000-0000-4000-8000-000000000001','Fixed',pg_temp.id(31),'FIXED',100,'USD',1,pg_temp.month(-1),pg_temp.month(-1)),
(pg_temp.id(41),'f0050000-0000-4000-8000-000000000001','Zero estimate',pg_temp.id(31),'VARIABLE',0,'USD',31,pg_temp.month(-1),pg_temp.month(-1)),
(pg_temp.id(42),'f0050000-0000-4000-8000-000000000001','Unknown',pg_temp.id(31),'VARIABLE',null,'USD',31,pg_temp.month(-1),pg_temp.month(-1)),
(pg_temp.id(43),'f0050000-0000-4000-8000-000000000001','Prior',pg_temp.id(31),'VARIABLE',null,'USD',1,pg_temp.month(-2),pg_temp.month(-2));
alter table public.recurring_expenses enable trigger recurring_expenses_validate;
create function pg_temp.context() returns jsonb language sql stable as $$select public.get_personal_period_close_context(pg_temp.month(-1))$$;
create function pg_temp.close() returns jsonb language sql volatile as $$select public.close_personal_budget_period(pg_temp.id(50),pg_temp.id(9),0,pg_temp.context()->>'snapshot_hash',true)$$;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','Owner role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'Owner identity');
select is(pg_temp.context()->>'can_close','false','Unresolved monthly and prior bills prevent close');
select is(pg_temp.context()#>>'{summary,availability,commitments,prior_unresolved_count}','1','Prior unresolved count surfaced');
select is(pg_temp.context()#>>'{summary,availability,commitments,buckets,0,confirmed_count}','1','Confirmed monthly surfaced');
select is(pg_temp.context()#>>'{summary,availability,commitments,buckets,0,estimated_count}','1','Known zero estimate surfaced');
select is(pg_temp.context()#>>'{summary,availability,commitments,buckets,0,unknown_count}','1','Unknown monthly surfaced');
select throws_ok($$select pg_temp.close()$$,'23514',null,'All unresolved blocks close');
select public.resolve_personal_recurring_expense(pg_temp.id(60),pg_temp.id(40),pg_temp.id(9),pg_temp.month(-1),100,'USD',pg_temp.month(-1));
select throws_ok($$select pg_temp.close()$$,'23514',null,'Estimated and unknown still block');
select public.resolve_personal_recurring_expense(pg_temp.id(61),pg_temp.id(41),pg_temp.id(9),pg_temp.month(-1),1,'USD',pg_temp.month(-1));
select throws_ok($$select pg_temp.close()$$,'23514',null,'Unknown monthly still blocks');
select public.resolve_personal_recurring_expense(pg_temp.id(62),pg_temp.id(42),pg_temp.id(9),pg_temp.month(-1),1,'USD',pg_temp.month(-1));
select throws_ok($$select pg_temp.close()$$,'23514',null,'Only prior unresolved still blocks');
select is((select count(*) from public.budget_period_closures),0::bigint,'Rejected close never leaves partial evidence');
select is((select status from public.budget_periods where id=pg_temp.id(9)),'OPEN','Rejected close leaves month open');
select public.resolve_personal_recurring_expense(pg_temp.id(63),pg_temp.id(43),pg_temp.id(8),pg_temp.month(-2),1,'USD',pg_temp.month(-2));
update public.transactions set deleted_at=now() where id=pg_temp.id(62);
select is(pg_temp.context()->>'can_close','true','Only actual historical resolution/cancellation permits close; no automatic resolution');
select lives_ok($$select pg_temp.close()$$,'Fully resolved month closes');
select is(pg_temp.context()#>>'{summary,availability,commitments,buckets}','[]','Snapshot records no pending money');
select results_eq($$update public.transactions set deleted_at=null where id=pg_temp.id(62) returning id$$,array[]::uuid[],'Direct closed restore filtered');
-- Direct RLS filters the row rather than raising: assert the unchanged tombstone.
select ok((select deleted_at is not null from public.transactions where id=pg_temp.id(62)),'Closed actual cannot be restored directly');
select throws_ok($$update public.recurring_expenses set stopped_from=pg_temp.month(-1) where id=pg_temp.id(40)$$,'23514',null,'Template stop cannot rewrite closed historical schedule');
select is((select count(*) from public.transactions),4::bigint,'Close adds no cash, savings or rollover movement');
reset role;
select * from finish();
rollback;
