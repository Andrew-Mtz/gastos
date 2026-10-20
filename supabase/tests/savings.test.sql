\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
\ir helpers/auth.sql.inc
select no_plan();
insert into public.profiles(id,display_name,base_currency,timezone)
select id,'Synthetic','USD','UTC' from auth.users where id::text like 'f0050000%';
insert into public.budget_periods(id,profile_id,starts_on,ends_on,base_currency) values
('f1150000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','2026-09-01','2026-09-30','USD'),
('f1150000-0000-4000-8000-000000000002','f0050000-0000-4000-8000-000000000001','2026-10-01','2026-10-31','USD'),
('f1150000-0000-4000-8000-000000000003','f0050000-0000-4000-8000-000000000001','2026-11-01','2026-11-30','USD'),
('f1150000-0000-4000-8000-000000000004','f0050000-0000-4000-8000-000000000001','2026-12-01','2026-12-31','UYU');
insert into public.budget_buckets(id,profile_id,name,type) values
('b1150000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','Ordinary','SPENDABLE'),
('b1150000-0000-4000-8000-000000000002','f0050000-0000-4000-8000-000000000001','Reserve','SAVINGS');
insert into public.categories(id,profile_id,name,budget_bucket_id) values
('c1150000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','Food','b1150000-0000-4000-8000-000000000001');
select is(prosecdef,false,'Savings routine remains invoker') from pg_proc where oid in
('public.get_savings_availability(uuid)'::regprocedure,'public.register_savings_movement(uuid,uuid,text,bigint,text,date,boolean,text)'::regprocedure);
select is(array_to_string(proconfig,','),'search_path=""','Empty search path') from pg_proc where oid in
('public.get_savings_availability(uuid)'::regprocedure,'public.register_savings_movement(uuid,uuid,text,bigint,text,date,boolean,text)'::regprocedure);
select ok(not has_function_privilege('anon',routine,'EXECUTE'),'Anonymous cannot execute '||routine)
from unnest(array['public.get_savings_availability(uuid)','public.register_savings_movement(uuid,uuid,text,bigint,text,date,boolean,text)']) routine;
select ok(not has_column_privilege('authenticated','public.transactions','withdrawal_confirmed','UPDATE'),'Confirmation evidence immutable');
select ok(not has_column_privilege('authenticated','public.transactions','savings_validated','INSERT'),'Cannot forge validated contribution');
select ok(not has_column_privilege('authenticated','public.transactions','savings_validated','UPDATE'),'Validation marker immutable');
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','Owner client role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'Owner real identity');
select throws_ok($$insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date,savings_validated) values(auth.uid(),'f1150000-0000-4000-8000-000000000002','SAVINGS_CONTRIBUTION',1,'USD','2026-10-01',true)$$,'42501','permission denied for table transactions','Direct insert cannot forge server validation');
select throws_ok($$update public.transactions set savings_validated=true$$,'42501','permission denied for table transactions','Direct update cannot forge server validation');
select public.save_budget_allocations(id,'[{"budget_bucket_id":"b1150000-0000-4000-8000-000000000001","percentage_basis_points":8000},{"budget_bucket_id":"b1150000-0000-4000-8000-000000000002","percentage_basis_points":2000}]')
from public.budget_periods where base_currency='USD';
select public.register_income('a1150000-0000-4000-8000-000000000001','f1150000-0000-4000-8000-000000000001',1000,'USD','2026-09-01');
select public.register_income('a1150000-0000-4000-8000-000000000002','f1150000-0000-4000-8000-000000000002',1000,'USD','2026-10-01');
select public.register_income('a1150000-0000-4000-8000-000000000003','f1150000-0000-4000-8000-000000000003',10000,'USD','2026-11-01');
set constraints all immediate;
set constraints all deferred;
select is(public.get_savings_availability('f1150000-0000-4000-8000-000000000002')->>'opening_protected_minor','200','Prior savings carry forward once');
select is(public.get_savings_availability('f1150000-0000-4000-8000-000000000002')->>'allocated_savings_minor','200','Current protected allocation uses received income');
select is(public.get_savings_availability('f1150000-0000-4000-8000-000000000004')->>'opening_protected_minor','0','Other currency does not fund UYU savings');
select throws_ok($$select public.register_savings_movement(gen_random_uuid(),'f1150000-0000-4000-8000-000000000002','SAVINGS_WITHDRAWAL',1,'USD','2026-10-01',false)$$,'23514',null,'Withdrawal requires explicit confirmation');
select throws_ok($$insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date) values(auth.uid(),'f1150000-0000-4000-8000-000000000002','SAVINGS_WITHDRAWAL',1,'USD','2026-10-01')$$,'23514',null,'Direct write cannot omit confirmation');
select throws_ok($$select public.register_savings_movement(gen_random_uuid(),'f1150000-0000-4000-8000-000000000002','SAVINGS_CONTRIBUTION',801,'USD','2026-10-01')$$,'23514',null,'Extra contribution cannot exceed ordinary remainder');
select throws_ok($$insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date)
 select auth.uid(),'f1150000-0000-4000-8000-000000000002','SAVINGS_CONTRIBUTION',700,'USD','2026-10-01' from generate_series(1,2)$$,'23514',null,'One multirow statement cannot over-contribute with stale snapshot');
select lives_ok($$select public.register_savings_movement('a1150000-0000-4000-8000-000000000004','f1150000-0000-4000-8000-000000000002','SAVINGS_CONTRIBUTION',100,'USD','2026-10-02')$$,'Record additional contribution');
select lives_ok($$select public.register_savings_movement('a1150000-0000-4000-8000-000000000005','f1150000-0000-4000-8000-000000000002','SAVINGS_WITHDRAWAL',450,'USD','2026-10-03',true,'Emergency')$$,'Explicit withdrawal may use prior month savings');
select lives_ok($$select public.register_savings_movement('a1150000-0000-4000-8000-000000000005','f1150000-0000-4000-8000-000000000002','SAVINGS_WITHDRAWAL',450,'USD','2026-10-03',true,'Emergency')$$,'Identical replay never withdraws twice');
select is((select count(*) from public.transactions where type='SAVINGS_WITHDRAWAL'),1::bigint,'One withdrawal row');
select is(public.get_received_income('f1150000-0000-4000-8000-000000000002'),1000::bigint,'Neither savings movement creates income');
select is(public.get_bucket_consumption('f1150000-0000-4000-8000-000000000002')#>>'{buckets,0,spent_minor}','0','Neither savings movement is spending');
select throws_ok($$select public.register_savings_movement(gen_random_uuid(),'f1150000-0000-4000-8000-000000000001','SAVINGS_WITHDRAWAL',201,'USD','2026-09-01',true)$$,'23514',null,'Future protected income cannot fund earlier withdrawal');
select throws_ok($$select public.register_savings_movement(gen_random_uuid(),'f1150000-0000-4000-8000-000000000004','SAVINGS_WITHDRAWAL',1,'UYU','2026-12-01',true)$$,'23514',null,'No cross-currency financing');
select throws_ok($$select public.register_savings_movement(gen_random_uuid(),'f1150000-0000-4000-8000-000000000002','SAVINGS_WITHDRAWAL',1,'EUR','2026-10-01',true)$$,'23514',null,'No implicit currency conversion');
select throws_ok($$select public.register_savings_movement(gen_random_uuid(),'f1150000-0000-4000-8000-000000000002','EXPENSE',1,'USD','2026-10-01')$$,'23514',null,'Savings RPC cannot create unrelated type');
select throws_ok($$select public.register_savings_movement('a1150000-0000-4000-8000-000000000005','f1150000-0000-4000-8000-000000000002','SAVINGS_WITHDRAWAL',449,'USD','2026-10-03',true,'Emergency')$$,'23505',null,'Conflicting replay cannot overwrite money');
select throws_ok($$update public.transactions set deleted_at=now() where id='a1150000-0000-4000-8000-000000000001'; set constraints all immediate$$,'23514',null,'Income deletion cannot invalidate later historical withdrawal');
select throws_ok($$select public.save_budget_allocations('f1150000-0000-4000-8000-000000000001','[{"budget_bucket_id":"b1150000-0000-4000-8000-000000000001","percentage_basis_points":10000}]'); set constraints all immediate$$,'23514',null,'Allocation correction cannot invalidate later withdrawal');
select lives_ok($$select public.register_personal_expense('a1150000-0000-4000-8000-000000000006','f1150000-0000-4000-8000-000000000002',2000,'USD','2026-10-04','c1150000-0000-4000-8000-000000000001');set constraints all immediate$$,'Subsequent ordinary overspending remains allowed');
set constraints all deferred;
select is(public.get_savings_availability('f1150000-0000-4000-8000-000000000002')->>'spent_minor','2000','Overspending stays ordinary consumption');
select throws_ok($$select public.register_savings_movement(gen_random_uuid(),'f1150000-0000-4000-8000-000000000002','SAVINGS_CONTRIBUTION',1,'USD','2026-10-04')$$,'23514',null,'Deficit cannot invent a new contribution');
select throws_ok($$update public.transactions set deleted_at=now() where id='a1150000-0000-4000-8000-000000000004';set constraints all immediate$$,'23514',null,'Contribution deletion cannot overdraw existing withdrawal');
select lives_ok($$update public.transactions set deleted_at=now() where id='a1150000-0000-4000-8000-000000000005';set constraints all immediate$$,'Explicit withdrawal deletion restores reserve');
set constraints all deferred;
select lives_ok($$update public.transactions set deleted_at=now() where id='a1150000-0000-4000-8000-000000000004';set constraints all immediate$$,'Contribution can be removed once dependent withdrawal is removed');
set constraints all deferred;
select throws_ok($$update public.transactions set deleted_at=null where id='a1150000-0000-4000-8000-000000000004'$$,'23514',null,'Restoration rechecks contribution eligibility');
select throws_ok($$update public.transactions set deleted_at=null where id='a1150000-0000-4000-8000-000000000005';set constraints all immediate$$,'23514',null,'Restoration rechecks historical withdrawal availability');
update public.transactions set deleted_at=now() where id='a1150000-0000-4000-8000-000000000006';
update public.transactions set deleted_at=null where id='a1150000-0000-4000-8000-000000000004';
update public.transactions set deleted_at=null where id='a1150000-0000-4000-8000-000000000005';
set constraints all immediate;
set constraints all deferred;
reset role;
select pg_temp.set_jwt_subject(null);
update public.budget_periods set status='CLOSED',closed_at=now() where id='f1150000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'Owner after closed fixture');
select lives_ok($$select public.register_savings_movement('a1150000-0000-4000-8000-000000000005','f1150000-0000-4000-8000-000000000002','SAVINGS_WITHDRAWAL',450,'USD','2026-10-03',true,'Emergency')$$,'Closed exact replay is only a read');
select throws_ok($$select public.register_savings_movement(gen_random_uuid(),'f1150000-0000-4000-8000-000000000002','SAVINGS_WITHDRAWAL',1,'USD','2026-10-03',true)$$,'42501',null,'Closed period rejects new movement');
select results_eq($$update public.transactions set deleted_at=now() where id='a1150000-0000-4000-8000-000000000005' returning id$$,array[]::uuid[],'Closed period cannot soft-delete');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000002');
select is(current_user::text,'authenticated','Partner persona client role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000002'::uuid,'Partner real identity');
select is((select count(*) from public.transactions),0::bigint,'Partner cannot read personal movements');
select throws_ok($$select public.get_savings_availability('f1150000-0000-4000-8000-000000000002')$$,'42501',null,'Partner cannot read personal savings aggregate');
select throws_ok($$select public.register_savings_movement(gen_random_uuid(),'f1150000-0000-4000-8000-000000000001','SAVINGS_WITHDRAWAL',1,'USD','2026-09-03',true)$$,'42501',null,'Partner cannot withdraw another owner savings');
select throws_ok($$insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date,withdrawal_confirmed) values('f0050000-0000-4000-8000-000000000001','f1150000-0000-4000-8000-000000000001','SAVINGS_WITHDRAWAL',1,'USD','2026-09-03',true)$$,'42501',null,'Forged owner direct write denied');
select results_eq($$update public.transactions set deleted_at=now() returning id$$,array[]::uuid[],'Partner cannot delete private movements');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000003');
select is(current_user::text,'authenticated','Unrelated client role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000003'::uuid,'Unrelated real identity');
select throws_ok($$select public.get_savings_availability('f1150000-0000-4000-8000-000000000002')$$,'42501',null,'Unrelated aggregate denied');
select is((select count(*) from public.transactions),0::bigint,'Unrelated history empty');
select pg_temp.set_jwt_subject(null);
select is(auth.uid(),null::uuid,'Missing identity');
select throws_ok($$select public.get_savings_availability('f1150000-0000-4000-8000-000000000002')$$,'42501',null,'Missing identity denied');
reset role;
set local role anon;
select pg_temp.set_jwt_subject(null);
select is(current_user::text,'anon','Anonymous role');
select is(auth.uid(),null::uuid,'Anonymous identity');
select throws_ok($$select public.get_savings_availability('f1150000-0000-4000-8000-000000000002')$$,'42501','permission denied for function get_savings_availability','Anonymous actual execute denied');
reset role;
select * from finish();
rollback;
