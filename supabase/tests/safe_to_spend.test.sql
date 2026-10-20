\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_catalog;
\ir helpers/auth.sql.inc
select no_plan();
insert into public.profiles(id,display_name,base_currency,timezone)
select id,'Synthetic','USD','UTC' from auth.users where id::text like 'f0050000%';
create function pg_temp.month(n integer default 0) returns date language sql stable as $$select (date_trunc('month',statement_timestamp() at time zone 'UTC')+make_interval(months=>n))::date$$;
insert into public.budget_periods(id,profile_id,starts_on,ends_on,base_currency,expected_income_minor) values
 ('f1030000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001',pg_temp.month(),(pg_temp.month()+interval '1 month -1 day')::date,'USD',999999),
 ('f1030000-0000-4000-8000-000000000002','f0050000-0000-4000-8000-000000000001',pg_temp.month(1),(pg_temp.month(1)+interval '1 month -1 day')::date,'USD',999999),
 ('f1030000-0000-4000-8000-000000000003','f0050000-0000-4000-8000-000000000002',pg_temp.month(),(pg_temp.month()+interval '1 month -1 day')::date,'USD',999999);
insert into public.budget_buckets(id,profile_id,name,type) values
 ('f1040000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','Spendable','SPENDABLE'),
 ('f1040000-0000-4000-8000-000000000002','f0050000-0000-4000-8000-000000000001','Savings','SAVINGS'),
 ('f1040000-0000-4000-8000-000000000003','f0050000-0000-4000-8000-000000000001','Unallocated','SPENDABLE');
insert into public.categories(id,profile_id,name,budget_bucket_id) values
 ('f1070000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','Allocated','f1040000-0000-4000-8000-000000000001'),
 ('f1070000-0000-4000-8000-000000000002','f0050000-0000-4000-8000-000000000001','Unallocated','f1040000-0000-4000-8000-000000000003');
create function pg_temp.snapshot(n integer default 1) returns jsonb language sql stable as $$
 select public.get_personal_safe_to_spend(('f1030000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid)$$;
select is(prosecdef,false,'Read-only snapshot has no elevated privilege') from pg_proc where oid='public.get_personal_safe_to_spend(uuid)'::regprocedure;
select ok(proconfig @> array['search_path=""'],'Snapshot has empty search path') from pg_proc where oid='public.get_personal_safe_to_spend(uuid)'::regprocedure;
select is(provolatile::text,'s','Snapshot and all transitive financial reads are STABLE: '||proname)
 from pg_proc where oid in ('public.get_personal_safe_to_spend(uuid)'::regprocedure,'public.get_savings_availability(uuid)'::regprocedure,'public.get_personal_committed_money(uuid)'::regprocedure,'public.get_bucket_consumption(uuid)'::regprocedure);
select ok(has_function_privilege('authenticated','public.get_personal_safe_to_spend(uuid)','EXECUTE'),'Authenticated read grant');
select ok(not has_function_privilege('anon','public.get_personal_safe_to_spend(uuid)','EXECUTE'),'No anonymous grant');
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','A client role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'A identity');
select is(pg_temp.snapshot()#>>'{savings,configured}','false','No allocation is explicitly unavailable, not an implicit zero plan');
select is(pg_temp.snapshot()#>>'{savings,spendable_allocated_minor}','0','Expected income never funds availability');
select public.save_budget_allocations('f1030000-0000-4000-8000-000000000001','[{"budget_bucket_id":"f1040000-0000-4000-8000-000000000001","percentage_basis_points":8000},{"budget_bucket_id":"f1040000-0000-4000-8000-000000000002","percentage_basis_points":2000}]');
select public.register_income('f1090000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001',1000,'USD',pg_temp.month());
select public.create_personal_savings_goal('f1160000-0000-4000-8000-000000000001','Goal',200,'USD');
select public.register_savings_movement('f1150000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001','SAVINGS_CONTRIBUTION',100,'USD',pg_temp.month(),false,null,'f1160000-0000-4000-8000-000000000001');
select public.register_savings_movement('f1150000-0000-4000-8000-000000000002','f1030000-0000-4000-8000-000000000001','SAVINGS_WITHDRAWAL',50,'USD',pg_temp.month(),true);
select public.register_personal_expense('f1110000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001',150,'USD',pg_temp.month(),'f1070000-0000-4000-8000-000000000002');
select public.create_personal_recurring_expense('f1170000-0000-4000-8000-000000000001','Fixed','f1070000-0000-4000-8000-000000000001','FIXED','USD',1,pg_temp.month(),null,100);
select public.create_personal_recurring_expense('f1170000-0000-4000-8000-000000000002','Estimated','f1070000-0000-4000-8000-000000000002','VARIABLE','USD',31,pg_temp.month(),null,20);
select is(pg_temp.snapshot()#>>'{savings,spendable_allocated_minor}','800','Rounded received allocation, not expected or protected income');
select is(pg_temp.snapshot()#>>'{savings,allocated_savings_minor}','200','Percentage savings separately protected');
select is(pg_temp.snapshot()#>>'{savings,contributions_minor}','100','Goal contribution included once');
select is(pg_temp.snapshot()#>>'{savings,withdrawals_minor}','50','Only explicit withdrawal returns money');
select is(pg_temp.snapshot()#>>'{savings,goal_reserved_minor}','100','Goal subset not added again');
select is(pg_temp.snapshot()#>>'{savings,spent_minor}','150','Unallocated bucket spending not hidden');
select is(pg_temp.snapshot()#>>'{commitments,buckets,0,confirmed_minor}','100','Confirmed current obligation');
select is(pg_temp.snapshot()#>>'{commitments,buckets,1,estimated_minor}','20','Unallocated estimate separate');
select is(pg_temp.snapshot()#>>'{commitments,prior_unresolved_count}','0','No previous obligations');
select is(pg_temp.snapshot(2)#>>'{commitments,prior_unresolved_count}','2','Future month carries count, never current monetary debt');
select is(pg_temp.snapshot(2)#>>'{savings,spendable_allocated_minor}','0','Ordinary remainder never rolls forward');
select is(pg_temp.snapshot(2)#>>'{savings,opening_protected_minor}','250','Opening protected savings not spendable');
update public.categories set archived_at=now() where id='f1070000-0000-4000-8000-000000000002';
update public.budget_buckets set archived_at=now() where id='f1040000-0000-4000-8000-000000000003';
select is(pg_temp.snapshot()#>>'{savings,spent_minor}','150','Archive does not erase original spending');
select is(pg_temp.snapshot()#>>'{commitments,buckets,1,estimated_minor}','20','Archive does not erase original commitment');
update public.categories set archived_at=null where id='f1070000-0000-4000-8000-000000000002';
update public.budget_buckets set archived_at=null where id='f1040000-0000-4000-8000-000000000003';
select public.resolve_personal_recurring_expense('f1180000-0000-4000-8000-000000000001','f1170000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001',pg_temp.month(),100,'USD',pg_temp.month());
select is(pg_temp.snapshot()#>>'{savings,spent_minor}','250','Payment is actual spending once');
select is(pg_temp.snapshot()#>>'{commitments,buckets,0,confirmed_minor}','0','Paid obligation not subtracted twice');
update public.transactions set deleted_at=now() where id='f1180000-0000-4000-8000-000000000001';
select is(pg_temp.snapshot()#>>'{savings,spent_minor}','150','Cancelled actual leaves spending');
select is(pg_temp.snapshot()#>>'{commitments,buckets,0,confirmed_minor}','0','Tombstone does not revive commitment');
select public.create_personal_recurring_expense('f1170000-0000-4000-8000-000000000003','Unknown','f1070000-0000-4000-8000-000000000001','VARIABLE','USD',1,pg_temp.month());
select is(pg_temp.snapshot()#>>'{commitments,buckets,0,unknown_count}','1','Unknown cannot become zero availability input');
select public.create_personal_recurring_expense('f1170000-0000-4000-8000-000000000004','Foreign unknown','f1070000-0000-4000-8000-000000000001','VARIABLE','EUR',1,pg_temp.month());
select throws_ok($$select pg_temp.snapshot()$$,'23514',null,'Foreign-currency unknown fails entire snapshot');
select public.stop_personal_recurring_expense('f1170000-0000-4000-8000-000000000004',pg_temp.month(1));
select is(pg_temp.snapshot(2)#>>'{commitments,prior_unresolved_count}','3','Earlier unresolved counts include foreign currency without conversion');
select public.stop_personal_recurring_expense('f1170000-0000-4000-8000-000000000004',pg_temp.month());
-- A scalar snapshot cannot be silently truncated at a Data API row cap.
insert into public.recurring_expenses(owner_profile_id,name,category_id,amount_mode,currency,due_day,active_from,active_until,default_amount_minor)
select auth.uid(),'Synthetic bulk '||n,'f1070000-0000-4000-8000-000000000001','FIXED','USD',1,pg_temp.month(),pg_temp.month(),1 from generate_series(1,1001) n;
insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date,category_id)
select auth.uid(),'f1030000-0000-4000-8000-000000000001','EXPENSE',1,'USD',pg_temp.month(),'f1070000-0000-4000-8000-000000000002' from generate_series(1,1001);
select is(pg_temp.snapshot()#>>'{commitments,buckets,0,confirmed_minor}','1001','All commitments beyond row cap');
select is(pg_temp.snapshot()#>>'{savings,spent_minor}','1151','All actual expenses beyond row cap');
select is(pg_temp.snapshot()#>>'{savings,contributions_minor}','100','Overspending does not consume or invalidate protected savings');
-- Components remain individually safe while final subtraction overflows.
select public.register_personal_expense('f1110000-0000-4000-8000-000000000002','f1030000-0000-4000-8000-000000000001',9007199254739840,'USD',pg_temp.month(),'f1070000-0000-4000-8000-000000000002');
select throws_ok($$select pg_temp.snapshot()$$,'22003',null,'Final confirmed margin overflow fails closed');
update public.transactions set deleted_at=now() where id='f1110000-0000-4000-8000-000000000002';
-- Invalid legacy actual currency must not disappear from a partial total.
reset role;
alter table public.transactions disable trigger user;
update public.transactions set currency='EUR' where id='f1110000-0000-4000-8000-000000000001';
alter table public.transactions enable trigger user;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','A legacy-read role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'A legacy-read identity');
select throws_ok($$select pg_temp.snapshot()$$,'23514',null,'Incompatible actual currency fails entire snapshot');
select throws_ok($$select public.get_personal_safe_to_spend(null)$$,'42501',null,'Null identity cannot become an empty balance');
select throws_ok($$select pg_temp.snapshot(3)$$,'42501',null,'Cannot forge another period');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000002');
select is(current_user::text,'authenticated','Partner B role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000002'::uuid,'Partner B identity');
select throws_ok($$select pg_temp.snapshot()$$,'42501',null,'Partner cannot read A snapshot');
select is(pg_temp.snapshot(3)#>>'{savings,spent_minor}','0','B snapshot has no A spending');
select is(pg_temp.snapshot(3)#>'{commitments,buckets}','[]'::jsonb,'B snapshot has no A commitments');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000003');
select is(current_user::text,'authenticated','Unrelated C role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000003'::uuid,'Unrelated C identity');
select throws_ok($$select pg_temp.snapshot()$$,'42501',null,'C cannot read A snapshot');
select pg_temp.set_jwt_subject(null);
select is(auth.uid(),null::uuid,'Missing identity');
select throws_ok($$select pg_temp.snapshot()$$,'42501',null,'Missing subject denied');
reset role;
set local role anon;
select pg_temp.set_jwt_subject(null);
select is(current_user::text,'anon','Anonymous role');
select is(auth.uid(),null::uuid,'Anonymous identity');
select throws_ok($$select public.get_personal_safe_to_spend('f1030000-0000-4000-8000-000000000001')$$,'42501','permission denied for function get_personal_safe_to_spend','Actual anonymous SQL privilege denial');
reset role;
select * from finish();
rollback;
