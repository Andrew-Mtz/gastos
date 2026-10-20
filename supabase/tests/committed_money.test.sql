\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_catalog;
\ir helpers/auth.sql.inc
select no_plan();
insert into public.profiles(id,display_name,base_currency,timezone)
select id,'Synthetic','USD','UTC' from auth.users where id::text like 'f0050000%';
create function pg_temp.month(n integer default 0) returns date language sql stable as $$select (date_trunc('month',statement_timestamp() at time zone 'UTC')+make_interval(months=>n))::date$$;
insert into public.budget_periods(id,profile_id,starts_on,ends_on,base_currency) values
 ('f1030000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001',pg_temp.month(),(pg_temp.month()+interval '1 month -1 day')::date,'USD'),
 ('f1030000-0000-4000-8000-000000000002','f0050000-0000-4000-8000-000000000001',pg_temp.month(1),(pg_temp.month(1)+interval '1 month -1 day')::date,'USD'),
 ('f1030000-0000-4000-8000-000000000003','f0050000-0000-4000-8000-000000000002',pg_temp.month(),(pg_temp.month()+interval '1 month -1 day')::date,'USD'),
 ('f1030000-0000-4000-8000-000000000004','f0050000-0000-4000-8000-000000000001','9999-12-01','9999-12-31','USD');
insert into public.budget_buckets(id,profile_id,name,type) values
 ('f1040000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','Needs','SPENDABLE'),
 ('f1040000-0000-4000-8000-000000000002','f0050000-0000-4000-8000-000000000001','Other','SPENDABLE');
insert into public.categories(id,profile_id,name,budget_bucket_id) values
 ('f1070000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','Rent','f1040000-0000-4000-8000-000000000001'),
 ('f1070000-0000-4000-8000-000000000002','f0050000-0000-4000-8000-000000000001','Electricity','f1040000-0000-4000-8000-000000000001'),
 ('f1070000-0000-4000-8000-000000000003','f0050000-0000-4000-8000-000000000001','Unknown','f1040000-0000-4000-8000-000000000002');
create function pg_temp.summary(n integer default 1) returns jsonb language sql stable as $$
 select public.get_personal_committed_money(('f1030000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid)$$;
create function pg_temp.confirm(n integer, amount bigint, tx integer default null) returns uuid language plpgsql as $$
declare result public.transactions;
begin
 result:=public.resolve_personal_recurring_expense(
 ('f1190000-0000-4000-8000-'||lpad(coalesce(tx,n)::text,12,'0'))::uuid,
 ('f1170000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'f1030000-0000-4000-8000-000000000001',pg_temp.month(),amount,'USD',pg_temp.month());
 return result.id;
end;$$;
select is(prosecdef,false,'Commitment RPC is invoker') from pg_proc where oid='public.get_personal_committed_money(uuid)'::regprocedure;
select is(provolatile::text,'s','One stable snapshot') from pg_proc where oid='public.get_personal_committed_money(uuid)'::regprocedure;
select ok(proconfig @> array['search_path=""'],'Empty search path') from pg_proc where oid='public.get_personal_committed_money(uuid)'::regprocedure;
select ok(has_function_privilege('authenticated','public.get_personal_committed_money(uuid)','EXECUTE'),'Authenticated read grant');
select ok(not has_function_privilege('anon','public.get_personal_committed_money(uuid)','EXECUTE'),'No anonymous read grant');
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','A client role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'A identity');
select is(pg_temp.summary()->'buckets','[]'::jsonb,'Empty monthly total');
select is(pg_temp.summary()->>'prior_unresolved_count','0','Empty prior count');
select public.create_personal_recurring_expense('f1170000-0000-4000-8000-000000000001','Fixed','f1070000-0000-4000-8000-000000000001','FIXED','USD',1,pg_temp.month(),pg_temp.month(1),100);
select public.create_personal_recurring_expense('f1170000-0000-4000-8000-000000000002','Estimated','f1070000-0000-4000-8000-000000000002','VARIABLE','USD',31,pg_temp.month(),null,200);
select public.create_personal_recurring_expense('f1170000-0000-4000-8000-000000000003','Zero estimate','f1070000-0000-4000-8000-000000000003','VARIABLE','USD',1,pg_temp.month(),null,0);
select public.create_personal_recurring_expense('f1170000-0000-4000-8000-000000000004','Unknown','f1070000-0000-4000-8000-000000000003','VARIABLE','USD',31,pg_temp.month());
select public.create_personal_recurring_expense('f1170000-0000-4000-8000-000000000005','Ended','f1070000-0000-4000-8000-000000000001','FIXED','USD',31,pg_temp.month(),pg_temp.month(),50);
select public.create_personal_recurring_expense('f1170000-0000-4000-8000-000000000006','Future','f1070000-0000-4000-8000-000000000001','FIXED','USD',1,pg_temp.month(2),pg_temp.month(2),400);
select public.create_personal_recurring_expense('f1170000-0000-4000-8000-000000000007','Stopped','f1070000-0000-4000-8000-000000000001','FIXED','USD',1,pg_temp.month(),null,10);
select public.stop_personal_recurring_expense('f1170000-0000-4000-8000-000000000007',pg_temp.month());
select is(pg_temp.summary()->>'owner_profile_id',auth.uid()::text,'Owner identity in response');
select is(pg_temp.summary()->>'month',pg_temp.month()::text,'Canonical month in response');
select is(pg_temp.summary()->>'base_currency','USD','Period denomination');
select is(pg_temp.summary()#>>'{buckets,0,confirmed_minor}','150','Fixed amounts include early/overdue and late due days; future/stopped excluded');
select is(pg_temp.summary()#>>'{buckets,0,estimated_minor}','200','Variable estimate separate from confirmed');
select is(pg_temp.summary()#>>'{buckets,0,confirmed_count}','2','Two fixed obligations in one unallocated bucket');
select is(pg_temp.summary()#>>'{buckets,0,estimated_count}','1','Known variable estimate count');
select is(pg_temp.summary()#>>'{buckets,1,estimated_minor}','0','Known zero remains zero');
select is(pg_temp.summary()#>>'{buckets,1,estimated_count}','1','Known zero is an estimate, not unknown');
select is(pg_temp.summary()#>>'{buckets,1,unknown_count}','1','Unknown amount has a separate count');
select is(pg_temp.summary(2)->>'prior_unresolved_count','5','Earlier unresolved occurrences counted, including ended definitions');
select is(pg_temp.summary(2)#>>'{buckets,0,confirmed_minor}','100','No carried amount; inclusive last-month fixed included');
select is((select count(*) from public.transactions),0::bigint,'Commitment reads create no actuals');
select throws_ok($$select pg_temp.confirm(1,99)$$,'23514',null,'Fixed actual must equal immutable amount');
select throws_ok($$insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date,category_id,recurring_template_id,recurring_month)
 values(auth.uid(),'f1030000-0000-4000-8000-000000000001','EXPENSE',101,'USD',pg_temp.month(),'f1070000-0000-4000-8000-000000000001','f1170000-0000-4000-8000-000000000001',pg_temp.month())$$,'23514',null,'Direct fixed insert cannot bypass exact amount');
select lives_ok($$select pg_temp.confirm(1,100)$$,'Explicit fixed confirmation allowed');
select lives_ok($$select pg_temp.confirm(1,100)$$,'Fixed identical retry is read-only');
select throws_ok($$select pg_temp.confirm(1,100,999)$$,'23505',null,'Fixed duplicate occurrence rejected');
select is(pg_temp.summary()#>>'{buckets,0,confirmed_minor}','50','Paid fixed leaves commitment exactly once');
select is(public.get_bucket_consumption('f1030000-0000-4000-8000-000000000001')#>>'{buckets,0,spent_minor}','100','Fixed actual contributes to spending exactly once');
select lives_ok($$select pg_temp.confirm(2,350)$$,'Variable actual may differ from estimate');
select lives_ok($$select pg_temp.confirm(3,30)$$,'Known zero estimate does not restrict actual');
select is(pg_temp.summary()#>>'{buckets,0,estimated_minor}','0','Resolved estimate no longer committed');
select public.stop_personal_recurring_expense('f1170000-0000-4000-8000-000000000002',pg_temp.month(1));
update public.transactions set deleted_at=now() where id='f1190000-0000-4000-8000-000000000001';
select is(pg_temp.summary()#>>'{buckets,0,confirmed_minor}','50','Cancelled fixed never returns as committed');
select is(pg_temp.summary(2)->>'prior_unresolved_count','2','Prior count excludes both active and cancelled actuals');
select lives_ok($$update public.transactions set deleted_at=null where id='f1190000-0000-4000-8000-000000000001'$$,'Restoring same actual does not add commitment');
select public.stop_personal_recurring_expense('f1170000-0000-4000-8000-000000000001',pg_temp.month(1));
select lives_ok($$select pg_temp.confirm(1,100)$$,'Fixed replay survives later stop');
select is(pg_temp.summary(2)->>'prior_unresolved_count','2','Stop preserves unresolved original history');
select is(pg_temp.summary(2)#>>'{buckets,0,estimated_minor}','0','Stopped known estimates excluded at stop month');
-- Archived mappings remain obligations, including with no configured allocation.
update public.categories set archived_at=now() where id='f1070000-0000-4000-8000-000000000001';
update public.budget_buckets set archived_at=now() where id='f1040000-0000-4000-8000-000000000001';
select is(pg_temp.summary()#>>'{buckets,0,confirmed_minor}','50','Archived/unallocated historical mapping retained');
select throws_ok($$select pg_temp.confirm(5,50)$$,'42501',null,'Fixed confirmation does not weaken active-category guards');
update public.categories set archived_at=null where id='f1070000-0000-4000-8000-000000000001';
update public.budget_buckets set archived_at=null where id='f1040000-0000-4000-8000-000000000001';
select pg_temp.confirm(5,50);
select is(pg_temp.summary()#>>'{buckets,0,unknown_count}','1','Unknown remains visible when all known amounts are zero');
select is(pg_temp.summary(2)->>'prior_unresolved_count','1','Prior unknown is not lost when monthly confirmed is zero');
-- A foreign currency unknown/zero is still a real unsupported obligation.
select public.create_personal_recurring_expense('f1170000-0000-4000-8000-000000000008','Foreign unknown','f1070000-0000-4000-8000-000000000001','VARIABLE','EUR',1,pg_temp.month());
select throws_ok($$select pg_temp.summary()$$,'23514',null,'Foreign unknown blocks complete monthly total');
select public.stop_personal_recurring_expense('f1170000-0000-4000-8000-000000000008',pg_temp.month(1));
select is(pg_temp.summary(2)->>'prior_unresolved_count','2','Prior count includes foreign denomination without conversion');
select public.stop_personal_recurring_expense('f1170000-0000-4000-8000-000000000008',pg_temp.month());
select public.create_personal_recurring_expense('f1170000-0000-4000-8000-000000000009','Foreign zero','f1070000-0000-4000-8000-000000000001','VARIABLE','EUR',1,pg_temp.month(),null,0);
select throws_ok($$select pg_temp.summary()$$,'23514',null,'Foreign zero does not imply safe extra availability');
select public.stop_personal_recurring_expense('f1170000-0000-4000-8000-000000000009',pg_temp.month());
-- Full aggregate exceeds the API row cap and is independent of UI/history pages.
insert into public.recurring_expenses(owner_profile_id,name,category_id,amount_mode,currency,due_day,active_from,active_until,default_amount_minor)
select auth.uid(),'Synthetic bulk '||n,'f1070000-0000-4000-8000-000000000001','FIXED','USD',1,pg_temp.month(),pg_temp.month(),1 from generate_series(1,1001) n;
select is(pg_temp.summary()#>>'{buckets,0,confirmed_minor}','1001','All 1001 fixed templates included');
select is(pg_temp.summary(2)->>'prior_unresolved_count','1002','Prior count complete beyond API row caps');
select ok((pg_temp.summary(4)->>'prior_unresolved_count')::numeric>100000,'Long calendar span counted without month-series expansion');
select public.create_personal_recurring_expense('f1170000-0000-4000-8000-000000000010','Overflow','f1070000-0000-4000-8000-000000000001','FIXED','USD',1,pg_temp.month(),pg_temp.month(),9007199254740991);
select throws_ok($$select pg_temp.summary()$$,'22003',null,'Aggregate overflow never rounds or truncates');
select public.stop_personal_recurring_expense('f1170000-0000-4000-8000-000000000010',pg_temp.month());
select public.create_personal_recurring_expense('f1170000-0000-4000-8000-000000000011','Combined overflow','f1070000-0000-4000-8000-000000000001','VARIABLE','USD',1,pg_temp.month(),pg_temp.month(),9007199254739991);
select throws_ok($$select pg_temp.summary()$$,'22003',null,'Combined confirmed and estimated exposure has safe bound');
select public.stop_personal_recurring_expense('f1170000-0000-4000-8000-000000000011',pg_temp.month());
-- Synthetic invalid legacy mapping: only this rolled-back fixture bypasses guards.
reset role;
insert into public.categories(id,profile_id,name,budget_bucket_id) values
 ('f1070000-0000-4000-8000-000000000004','f0050000-0000-4000-8000-000000000001','Legacy unmapped',null);
alter table public.recurring_expenses disable trigger user;
update public.recurring_expenses set category_id='f1070000-0000-4000-8000-000000000004' where id='f1170000-0000-4000-8000-000000000004';
alter table public.recurring_expenses enable trigger user;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','Owner legacy read role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'Owner legacy read identity');
select throws_ok($$select pg_temp.summary()$$,'23514',null,'Unmapped unknown does not silently disappear');
reset role;
alter table public.recurring_expenses disable trigger user;
update public.recurring_expenses set category_id='f1070000-0000-4000-8000-000000000003' where id='f1170000-0000-4000-8000-000000000004';
alter table public.recurring_expenses enable trigger user;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','Owner repaired-fixture role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'Owner repaired-fixture identity');
select throws_ok($$select public.get_personal_committed_money(null)$$,'42501',null,'Null period denied');
select throws_ok($$select pg_temp.summary(3)$$,'42501',null,'Foreign period denied');
reset role;
-- Closed monthly reads remain planning reads; no generated expense or mutation.
update public.budget_periods set status='CLOSED',closed_at=now() where id='f1030000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','A role after closure');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'A identity after closure');
select is(pg_temp.summary()#>>'{buckets,0,confirmed_minor}','1001','Closed monthly obligations remain visible');
select lives_ok($$select pg_temp.confirm(1,100)$$,'Closed fixed exact replay remains read-only');
select throws_ok($$select pg_temp.confirm(4,10)$$,'42501',null,'Closed period still blocks new actual');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000002');
select is(current_user::text,'authenticated','Partner B role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000002'::uuid,'B identity');
select throws_ok($$select pg_temp.summary()$$,'42501',null,'Partner cannot read A commitments');
select is(pg_temp.summary(3)->'buckets','[]'::jsonb,'B empty month contains no A obligations');
select is(pg_temp.summary(3)->>'prior_unresolved_count','0','B prior count has no A data');
select throws_ok($$select pg_temp.confirm(1,100)$$,'42501',null,'B cannot confirm/replay A fixed payment');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000003');
select is(current_user::text,'authenticated','Unrelated C role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000003'::uuid,'C identity');
select throws_ok($$select pg_temp.summary()$$,'42501',null,'C cannot read A commitments');
select throws_ok($$select pg_temp.confirm(1,100)$$,'42501',null,'C cannot confirm/replay A fixed payment');
select pg_temp.set_jwt_subject(null);
select is(auth.uid(),null::uuid,'Missing identity');
select throws_ok($$select pg_temp.summary()$$,'42501',null,'Missing subject denied');
reset role;
set local role anon;
select pg_temp.set_jwt_subject(null);
select is(current_user::text,'anon','Anonymous role');
select is(auth.uid(),null::uuid,'Anonymous identity');
select throws_ok($$select public.get_personal_committed_money('f1030000-0000-4000-8000-000000000001')$$,'42501','permission denied for function get_personal_committed_money','Actual anonymous SQL privilege denial');
reset role;
select * from finish();
rollback;
