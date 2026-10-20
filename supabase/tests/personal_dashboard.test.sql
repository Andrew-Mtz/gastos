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
 ('f1030000-0000-4000-8000-000000000002','f0050000-0000-4000-8000-000000000001',pg_temp.month(1),(pg_temp.month(1)+interval '1 month -1 day')::date,'USD',null),
 ('f1030000-0000-4000-8000-000000000003','f0050000-0000-4000-8000-000000000002',pg_temp.month(),(pg_temp.month()+interval '1 month -1 day')::date,'USD',123);
insert into public.budget_buckets(id,profile_id,name,type) values
 ('f1040000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','Spendable','SPENDABLE'),
 ('f1040000-0000-4000-8000-000000000002','f0050000-0000-4000-8000-000000000001','Savings','SAVINGS'),
 ('f1040000-0000-4000-8000-000000000003','f0050000-0000-4000-8000-000000000001','Unallocated','SPENDABLE');
insert into public.categories(id,profile_id,name,budget_bucket_id) values
 ('f1070000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','Allocated','f1040000-0000-4000-8000-000000000001'),
 ('f1070000-0000-4000-8000-000000000002','f0050000-0000-4000-8000-000000000001','Unallocated','f1040000-0000-4000-8000-000000000003');
create function pg_temp.snapshot(n integer default 0) returns jsonb language sql stable as $$select public.get_personal_dashboard(pg_temp.month(n))$$;
select is(prosecdef,false,'Dashboard has no elevated privilege') from pg_proc where oid='public.get_personal_dashboard(date)'::regprocedure;
select ok(proconfig @> array['search_path=""'],'Dashboard has empty search path') from pg_proc where oid='public.get_personal_dashboard(date)'::regprocedure;
select is(provolatile::text,'s','Every transitive financial helper is STABLE: '||proname) from pg_proc where oid in
 ('public.get_personal_dashboard(date)'::regprocedure,'public.get_personal_safe_to_spend(uuid)'::regprocedure,'public.get_savings_availability(uuid)'::regprocedure,'public.get_personal_committed_money(uuid)'::regprocedure,'public.get_bucket_consumption(uuid)'::regprocedure,'public.get_received_income(uuid)'::regprocedure);
select ok(has_function_privilege('authenticated','public.get_personal_dashboard(date)','EXECUTE'),'Authenticated dashboard grant');
select ok(not has_function_privilege('anon','public.get_personal_dashboard(date)','EXECUTE'),'No anonymous dashboard grant');
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','A role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'A identity');
select is(pg_temp.snapshot(2)->'period','null'::jsonb,'Missing owned month explicitly absent');
select ok(not (pg_temp.snapshot(2) ? 'availability'),'Missing month does not invent zero availability');
select is(pg_temp.snapshot()#>>'{availability,savings,configured}','false','Missing plan gate preserved');
select is(pg_temp.snapshot()->>'received_income_minor','0','Expected income not received');
select is(pg_temp.snapshot()#>>'{period,expected_income_minor}','999999','Expected amount separate');
select throws_ok($$select public.get_personal_dashboard(null)$$,'22023',null,'Null month rejected');
select throws_ok($$select public.get_personal_dashboard(pg_temp.month()+1)$$,'22023',null,'Noncanonical month rejected');
select public.save_budget_allocations('f1030000-0000-4000-8000-000000000001','[{"budget_bucket_id":"f1040000-0000-4000-8000-000000000001","percentage_basis_points":8000},{"budget_bucket_id":"f1040000-0000-4000-8000-000000000002","percentage_basis_points":2000}]');
select public.register_income('f1090000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001',1000,'USD',pg_temp.month());
select public.register_personal_expense('f1110000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001',150,'USD',pg_temp.month(),'f1070000-0000-4000-8000-000000000002');
select public.create_personal_savings_goal('f1160000-0000-4000-8000-000000000001','Goal',200,'USD');
select public.register_savings_movement('f1150000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001','SAVINGS_CONTRIBUTION',100,'USD',pg_temp.month(),false,null,'f1160000-0000-4000-8000-000000000001');
select is(pg_temp.snapshot()->>'received_income_minor','1000','Complete received income');
select is(pg_temp.snapshot()#>>'{availability,savings,allocated_savings_minor}','200','Current allocated savings');
select is(pg_temp.snapshot()#>>'{availability,savings,goal_reserved_minor}','100','Goal contribution is subset once');
select is(pg_temp.snapshot(1)#>>'{availability,savings,opening_protected_minor}','300','Cumulative protection through next month');
select is(pg_temp.snapshot(1)#>>'{availability,savings,allocated_savings_minor}','0','No allocation rollover');
select is(jsonb_array_length(pg_temp.snapshot()->'buckets'),3,'Includes original unallocated spending metadata');
select is(pg_temp.snapshot()#>>'{consumption,buckets,1,spent_minor}','150','Unallocated spending not erased');
select public.create_personal_recurring_expense('f1170000-0000-4000-8000-000000000001','Fixed','f1070000-0000-4000-8000-000000000001','FIXED','USD',1,pg_temp.month(),null,100);
select public.create_personal_recurring_expense('f1170000-0000-4000-8000-000000000002','Unknown','f1070000-0000-4000-8000-000000000002','VARIABLE','USD',31,pg_temp.month());
select public.create_personal_recurring_expense('f1170000-0000-4000-8000-000000000003','Zero estimate','f1070000-0000-4000-8000-000000000001','VARIABLE','USD',31,pg_temp.month(),null,0);
select is(pg_temp.snapshot()#>>'{upcoming,0,name}','Fixed','Earlier due day remains pending and sorts first');
select is(pg_temp.snapshot()#>>'{upcoming,1,due_date}',((pg_temp.month()+interval '1 month -1 day')::date)::text,'Due day 31 clamps to month end');
select is(pg_temp.snapshot()#>'{upcoming,1,default_amount_minor}','null'::jsonb,'Unknown preview never zero');
select is(pg_temp.snapshot()#>>'{upcoming,2,default_amount_minor}','0','Zero estimate remains known estimate');
select is(pg_temp.snapshot()#>>'{availability,commitments,buckets,1,unknown_count}','1','Unknown availability gate preserved');
select is(pg_temp.snapshot(1)#>>'{availability,commitments,prior_unresolved_count}','3','Older unresolved availability gate preserved');
update public.categories set archived_at=now() where id='f1070000-0000-4000-8000-000000000002';
update public.budget_buckets set archived_at=now() where id='f1040000-0000-4000-8000-000000000003';
select is(pg_temp.snapshot()#>>'{upcoming,1,name}','Unknown','Archive cannot remove upcoming commitment');
select is(pg_temp.snapshot()#>>'{consumption,buckets,1,spent_minor}','150','Archive cannot remove spending');
select public.resolve_personal_recurring_expense('f1180000-0000-4000-8000-000000000001','f1170000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001',pg_temp.month(),100,'USD',pg_temp.month());
select is(pg_temp.snapshot()#>>'{availability,savings,spent_minor}','250','Paid bill counted as actual once');
select is(jsonb_array_length(pg_temp.snapshot()->'upcoming'),2,'Paid bill removed from preview');
update public.transactions set deleted_at=now() where id='f1180000-0000-4000-8000-000000000001';
select is(pg_temp.snapshot()#>>'{availability,savings,spent_minor}','150','Tombstone excluded from spending');
select is(jsonb_array_length(pg_temp.snapshot()->'upcoming'),2,'Tombstone does not revive upcoming obligation');
insert into public.recurring_expenses(owner_profile_id,name,category_id,amount_mode,currency,due_day,active_from,active_until,default_amount_minor)
select auth.uid(),'Bulk '||n,'f1070000-0000-4000-8000-000000000001','FIXED','USD',1,pg_temp.month(),pg_temp.month(),1 from generate_series(1,1001) n;
select is(jsonb_array_length(pg_temp.snapshot()->'upcoming'),5,'Preview is bounded to five');
select is(pg_temp.snapshot()#>>'{availability,commitments,buckets,0,confirmed_minor}','1001','Full commitments beyond preview and Data API cap');
select public.create_personal_recurring_expense('f1170000-0000-4000-8000-000000000004','Wrong currency','f1070000-0000-4000-8000-000000000001','FIXED','EUR',31,pg_temp.month(),null,10);
select throws_ok($$select pg_temp.snapshot()$$,'23514',null,'Invalid currency outside preview fails whole dashboard');
select public.stop_personal_recurring_expense('f1170000-0000-4000-8000-000000000004',pg_temp.month());
-- Read endpoint adds no write grants and cannot forge an owner argument.
select throws_ok($$update public.transactions set amount_minor=2 where id='f1110000-0000-4000-8000-000000000001'$$,'42501','permission denied for table transactions','Immutable-money client grants unchanged');
set constraints all immediate;
reset role;
alter table public.transactions disable trigger user;
update public.transactions set currency='EUR' where id='f1110000-0000-4000-8000-000000000001';
alter table public.transactions enable trigger user;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','A legacy read role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'A legacy read identity');
select throws_ok($$select pg_temp.snapshot()$$,'23514',null,'Invalid legacy actual fails whole dashboard');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000002');
select is(current_user::text,'authenticated','Partner B role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000002'::uuid,'Partner B identity');
select is(pg_temp.snapshot()#>>'{period,id}','f1030000-0000-4000-8000-000000000003','B resolves only B period, never A period');
select is(pg_temp.snapshot()->>'received_income_minor','0','B cannot see A income');
select is(pg_temp.snapshot()->'upcoming','[]'::jsonb,'B cannot see A upcoming bills');
select is(pg_temp.snapshot()->'buckets','[]'::jsonb,'B cannot see A buckets');
select is(pg_temp.snapshot(1)->'period','null'::jsonb,'Only A future period does not leak to B');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000003');
select is(current_user::text,'authenticated','Unrelated C role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000003'::uuid,'Unrelated C identity');
select is(pg_temp.snapshot()->'period','null'::jsonb,'C cannot see another owner period');
select pg_temp.set_jwt_subject(null);
select is(auth.uid(),null::uuid,'Missing subject');
select throws_ok($$select pg_temp.snapshot()$$,'42501',null,'Missing identity denied, not empty');
reset role;
set local role anon;
select pg_temp.set_jwt_subject(null);
select is(current_user::text,'anon','Anonymous role');
select is(auth.uid(),null::uuid,'Anonymous identity');
select throws_ok($$select public.get_personal_dashboard(current_date)$$,'42501','permission denied for function get_personal_dashboard','Anonymous SQL privilege denial');
reset role;
select * from finish();
rollback;
