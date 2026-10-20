\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_catalog;
\ir helpers/auth.sql.inc
select no_plan();
insert into public.profiles(id,display_name,base_currency,timezone)
select id,'Synthetic','USD','UTC' from auth.users where id::text like 'f0050000%';
create function pg_temp.month(n integer default 0) returns date language sql stable as $$select (date_trunc('month',statement_timestamp() at time zone 'UTC')+make_interval(months=>n))::date$$;
create function pg_temp.tx(n integer) returns uuid language sql immutable as $$select ('f1220000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into public.budget_periods(id,profile_id,starts_on,ends_on,base_currency) values
 ('f1030000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001',pg_temp.month(),(pg_temp.month()+interval '1 month -1 day')::date,'USD'),
 ('f1030000-0000-4000-8000-000000000002','f0050000-0000-4000-8000-000000000001',pg_temp.month(1),(pg_temp.month(1)+interval '1 month -1 day')::date,'USD'),
 ('f1030000-0000-4000-8000-000000000003','f0050000-0000-4000-8000-000000000003',pg_temp.month(),(pg_temp.month()+interval '1 month -1 day')::date,'USD');
insert into public.budget_buckets(id,profile_id,name,type) values
 ('f1040000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','Needs','SPENDABLE'),
 ('f1040000-0000-4000-8000-000000000002','f0050000-0000-4000-8000-000000000001','Savings','SAVINGS'),
 ('f1040000-0000-4000-8000-000000000003','f0050000-0000-4000-8000-000000000001','Other','SPENDABLE'),
 ('f1040000-0000-4000-8000-000000000004','f0050000-0000-4000-8000-000000000002','Partner','SPENDABLE');
insert into public.categories(id,profile_id,name,budget_bucket_id) values
 ('f1070000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','Food','f1040000-0000-4000-8000-000000000001'),
 ('f1070000-0000-4000-8000-000000000002','f0050000-0000-4000-8000-000000000001','Other','f1040000-0000-4000-8000-000000000003'),
 ('f1070000-0000-4000-8000-000000000003','f0050000-0000-4000-8000-000000000001','Protected','f1040000-0000-4000-8000-000000000002'),
 ('f1070000-0000-4000-8000-000000000004','f0050000-0000-4000-8000-000000000002','Private','f1040000-0000-4000-8000-000000000004');
create function pg_temp.edit(n integer,rev bigint,amount bigint,request uuid default gen_random_uuid(),category uuid default null,financial_date date default null,description text default null)
returns jsonb language sql volatile as $$select public.correct_personal_transaction(request,pg_temp.tx(n),rev,'EDIT',jsonb_build_object('amount_minor',amount,'transaction_date',coalesce(financial_date,pg_temp.month()),'category_id',category,'description',description),true)$$;
create function pg_temp.change(n integer,rev bigint,action text,request uuid default gen_random_uuid())
returns jsonb language sql volatile as $$select public.correct_personal_transaction(request,pg_temp.tx(n),rev,action,'{}',true)$$;
select ok((select relrowsecurity from pg_class where oid='public.transaction_revisions'::regclass),'Audit RLS enabled');
select ok(has_table_privilege('authenticated','public.transaction_revisions','SELECT'),'Owner can read audit through RLS');
select ok(not has_table_privilege('authenticated','public.transaction_revisions',p),'No audit '||p) from unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER']) p;
select ok(not has_column_privilege('authenticated','public.transactions',c,'UPDATE'),'No new direct mutable grant: '||c) from unnest(array['amount_minor','transaction_date','category_id','currency','owner_profile_id','budget_period_id','scope','type','revision','savings_goal_id','recurring_template_id','recurring_month','savings_validated','withdrawal_confirmed']) c;
select ok(not has_column_privilege('authenticated','public.transactions','revision','INSERT'),'Cannot forge initial revision');
select is(prosecdef,true,'Explicitly reviewed definer: '||proname) from pg_proc where oid in ('public.correct_personal_transaction(uuid,uuid,bigint,text,jsonb,boolean)'::regprocedure,'public.audit_transaction_revision()'::regprocedure);
select ok(proconfig @> array['search_path=""'],'Empty search path: '||proname) from pg_proc where oid in ('public.correct_personal_transaction(uuid,uuid,bigint,text,jsonb,boolean)'::regprocedure,'public.audit_transaction_revision()'::regprocedure);
select ok(not has_function_privilege('anon','public.correct_personal_transaction(uuid,uuid,bigint,text,jsonb,boolean)','EXECUTE'),'Anonymous cannot invoke correction');
select ok(not has_function_privilege('authenticated','public.audit_transaction_revision()','EXECUTE'),'Audit trigger cannot be invoked directly');
select ok(not has_function_privilege('anon','public.audit_transaction_revision()','EXECUTE'),'Anonymous cannot invoke audit');
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','Owner role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'Owner identity');
select public.save_budget_allocations(id,'[{"budget_bucket_id":"f1040000-0000-4000-8000-000000000001","percentage_basis_points":8000},{"budget_bucket_id":"f1040000-0000-4000-8000-000000000002","percentage_basis_points":2000}]') from public.budget_periods;
select public.register_income(pg_temp.tx(1),'f1030000-0000-4000-8000-000000000001',10000,'USD',pg_temp.month());
select public.register_personal_expense(pg_temp.tx(2),'f1030000-0000-4000-8000-000000000001',100,'USD',pg_temp.month(),'f1070000-0000-4000-8000-000000000001','Original');
select is(pg_temp.edit(2,0,250,pg_temp.tx(101),'f1070000-0000-4000-8000-000000000002',pg_temp.month()+2,'Corrected')->>'revision','1','Expense amount/date/category/description corrected atomically');
select is((select revision from public.transactions where id=pg_temp.tx(2)),1::bigint,'Server revision advanced');
select is((select before_state->>'amount_minor' from public.transaction_revisions where transaction_id=pg_temp.tx(2)), '100','Original amount retained');
select is((select before_state->>'description' from public.transaction_revisions where transaction_id=pg_temp.tx(2)), 'Original','Original description retained');
select is((select before_state->>'category_id' from public.transaction_revisions where transaction_id=pg_temp.tx(2)), 'f1070000-0000-4000-8000-000000000001','Original classification retained');
select is((select after_state->>'amount_minor' from public.transaction_revisions where transaction_id=pg_temp.tx(2)), '250','Result snapshot retained');
select is((select actor_profile_id from public.transaction_revisions where transaction_id=pg_temp.tx(2)),auth.uid(),'Real actor recorded');
select is(public.get_personal_dashboard(pg_temp.month())#>>'{availability,savings,spent_minor}','250','Dashboard consumption uses corrected actual exactly once');
select is(public.get_bucket_consumption('f1030000-0000-4000-8000-000000000001')#>>'{buckets,1,spent_minor}','250','Category correction moves consumption to original mapping of new category');
select is(pg_temp.edit(2,0,250,pg_temp.tx(101),'f1070000-0000-4000-8000-000000000002',pg_temp.month()+2,'Corrected')->>'revision','1','Exact retry reads original result');
select is((select count(*) from public.transaction_revisions where transaction_id=pg_temp.tx(2)),1::bigint,'Replay creates no extra audit event');
select throws_ok($$select pg_temp.edit(2,0,251,pg_temp.tx(101),'f1070000-0000-4000-8000-000000000002',pg_temp.month()+2,'Corrected')$$,'23505',null,'Changed request payload conflicts');
select throws_ok($$select pg_temp.edit(2,0,300,gen_random_uuid(),'f1070000-0000-4000-8000-000000000002')$$,'40001',null,'New stale revision conflicts');
select is(pg_temp.edit(2,1,300,pg_temp.tx(102),'f1070000-0000-4000-8000-000000000002')->>'revision','2','Second revision succeeds');
select is(pg_temp.edit(2,0,250,pg_temp.tx(101),'f1070000-0000-4000-8000-000000000002',pg_temp.month()+2,'Corrected')->>'amount_minor','250','Old replay returns recorded result after later edit');
select is((select amount_minor from public.transactions where id=pg_temp.tx(2)),300::bigint,'Replay never overwrites newer state');
select is((select count(*) from public.transaction_revisions where transaction_id=pg_temp.tx(2)),2::bigint,'Replay never writes another revision');
select throws_ok($$select public.correct_personal_transaction(gen_random_uuid(),pg_temp.tx(2),2,'DELETE','{}',false)$$,'22023',null,'Explicit confirmation required');
select throws_ok($$select public.correct_personal_transaction(gen_random_uuid(),pg_temp.tx(2),2,'DELETE','{"amount_minor":1}',true)$$,'22023',null,'Delete cannot smuggle monetary edits');
select throws_ok($$select public.correct_personal_transaction(gen_random_uuid(),pg_temp.tx(2),2,'EDIT','{"amount_minor":1}',true)$$,'22023',null,'Incomplete edit rejected');
select throws_ok($$select public.correct_personal_transaction(gen_random_uuid(),pg_temp.tx(2),2,'EDIT','{"amount_minor":1,"transaction_date":"2026-10-01","category_id":null,"description":null,"currency":"EUR"}',true)$$,'22023',null,'Extra immutable fields rejected');
select throws_ok($$select pg_temp.edit(2,2,0)$$,'22023',null,'Zero rejected');
select throws_ok($$select pg_temp.edit(2,2,9007199254740992)$$,'22023',null,'Unsafe amount rejected');
select throws_ok($$select pg_temp.edit(2,2,10,gen_random_uuid(),'f1070000-0000-4000-8000-000000000002',pg_temp.month(1))$$,'23514',null,'Cross-month correction rejected');
select throws_ok($$select pg_temp.edit(2,2,10,gen_random_uuid(),'f1070000-0000-4000-8000-000000000004')$$,'42501',null,'Foreign category rejected inside definer despite elevated privileges');
select throws_ok($$select pg_temp.edit(2,2,10,gen_random_uuid(),'f1070000-0000-4000-8000-000000000003')$$,'42501',null,'Savings category cannot fund ordinary expense');
select throws_ok($$select pg_temp.edit(1,0,10000,gen_random_uuid(),'f1070000-0000-4000-8000-000000000001')$$,'23514',null,'Income cannot be reclassified by category');
select throws_ok($$insert into public.transaction_revisions(transaction_id,owner_profile_id,revision,action,before_state,after_state) values(pg_temp.tx(2),auth.uid(),3,'EDIT','{}','{}')$$,'42501',null,'Cannot fabricate audit');
select throws_ok($$update public.transaction_revisions set before_state='{}'$$,'42501',null,'Cannot rewrite original audit');
select throws_ok($$delete from public.transaction_revisions$$,'42501',null,'Cannot erase audit');
select throws_ok($$update public.transactions set revision=10 where id=pg_temp.tx(2)$$,'42501',null,'Cannot forge expected revision');
update public.transactions set description='Direct safe note' where id=pg_temp.tx(2);
select is((select revision from public.transactions where id=pg_temp.tx(2)),3::bigint,'Existing direct description advances revision');
select is((select count(*) from public.transaction_revisions where transaction_id=pg_temp.tx(2) and request_id is null),1::bigint,'Existing direct write is audited without forged request');
select throws_ok($$select pg_temp.change(2,2,'DELETE')$$,'40001',null,'Direct note invalidates stale application revision');
select is(pg_temp.change(2,3,'DELETE',pg_temp.tx(103))->>'revision','4','Delete supported');
select is(public.get_personal_dashboard(pg_temp.month())#>>'{availability,savings,spent_minor}','0','Deletion excluded from derived spending');
select throws_ok($$select pg_temp.edit(2,4,400)$$,'23514',null,'Deleted amount cannot be silently rewritten');
select is(pg_temp.change(2,4,'RESTORE')->>'revision','5','Restore same identity');
select is((select amount_minor from public.transactions where id=pg_temp.tx(2)),300::bigint,'Restore preserves corrected amount');
select is(public.get_personal_dashboard(pg_temp.month())#>>'{availability,savings,spent_minor}','300','Restore counted once');

-- Goal and general reserve prefixes remain solvent after amount corrections.
select public.create_personal_savings_goal(pg_temp.tx(50),'Goal',1000,'USD');
select public.register_savings_movement(pg_temp.tx(3),'f1030000-0000-4000-8000-000000000001','SAVINGS_CONTRIBUTION',1000,'USD',pg_temp.month(),false,null,pg_temp.tx(50));
select public.register_savings_movement(pg_temp.tx(4),'f1030000-0000-4000-8000-000000000001','SAVINGS_WITHDRAWAL',800,'USD',pg_temp.month(),true,null,pg_temp.tx(50));
select public.register_savings_movement(pg_temp.tx(5),'f1030000-0000-4000-8000-000000000002','SAVINGS_WITHDRAWAL',200,'USD',pg_temp.month(1),true,null,pg_temp.tx(50));
select throws_ok($$select pg_temp.edit(3,0,999)$$,'23514',null,'Contribution correction cannot invalidate later goal withdrawal');
select throws_ok($$select pg_temp.change(3,0,'DELETE')$$,'23514',null,'Goal funding cannot be deleted under later withdrawal');
select is(pg_temp.edit(3,0,1100)->>'amount_minor','1100','Funded increase checks only added contribution');
select public.register_savings_movement(pg_temp.tx(6),'f1030000-0000-4000-8000-000000000001','SAVINGS_WITHDRAWAL',2000,'USD',pg_temp.month(),true);
select public.register_income(pg_temp.tx(7),'f1030000-0000-4000-8000-000000000002',10000,'USD',pg_temp.month(1));
select throws_ok($$select pg_temp.edit(1,0,9995)$$,'23514',null,'Later savings cannot mask an insolvent earlier general prefix');
select throws_ok($$select pg_temp.edit(6,0,2001)$$,'23514',null,'General withdrawal correction cannot borrow goal reserve');
select is(pg_temp.edit(2,5,50000,gen_random_uuid(),'f1070000-0000-4000-8000-000000000002')->>'amount_minor','50000','Ordinary expense correction may overspend without savings use');
select is(public.get_savings_availability('f1030000-0000-4000-8000-000000000001')->>'goal_reserved_minor','300','Expense overspending leaves original goal reserve intact');
select throws_ok($$select pg_temp.edit(3,1,1101)$$,'23514',null,'Increasing contribution cannot use overspent ordinary funds');
select is(pg_temp.edit(3,1,1000)->>'amount_minor','1000','Solvent decrease remains legal after ordinary overspending');
select is(pg_temp.edit(1,0,12000)->>'amount_minor','12000','Income correction updates true received funding');
select is(public.get_received_income('f1030000-0000-4000-8000-000000000001')::text,'12000','Received amount corrected');
select is(public.get_personal_dashboard(pg_temp.month())#>>'{availability,savings,allocated_savings_minor}','2400','Corrected income re-derives rounded savings allocation');
select is(pg_temp.change(2,6,'DELETE')->>'revision','7','Overspending correction recoverably removed');

-- FIXED initial equality is not reapplied to deliberate corrected historical actuals.
select public.create_personal_recurring_expense(pg_temp.tx(60),'Fixed','f1070000-0000-4000-8000-000000000001','FIXED','USD',1,pg_temp.month(),null,100);
select throws_ok($$select public.resolve_personal_recurring_expense(pg_temp.tx(8),pg_temp.tx(60),'f1030000-0000-4000-8000-000000000001',pg_temp.month(),101,'USD',pg_temp.month())$$,'23514',null,'New initial fixed resolution still requires exact template amount');
select public.resolve_personal_recurring_expense(pg_temp.tx(8),pg_temp.tx(60),'f1030000-0000-4000-8000-000000000001',pg_temp.month(),100,'USD',pg_temp.month());
select is(pg_temp.edit(8,0,250,pg_temp.tx(108),'f1070000-0000-4000-8000-000000000001')->>'amount_minor','250','Explicit fixed actual amount can be corrected');
select throws_ok($$select pg_temp.edit(8,1,250,gen_random_uuid(),'f1070000-0000-4000-8000-000000000002')$$,'23514',null,'Recurring category cannot silently diverge from immutable obligation');
select is(pg_temp.change(8,1,'DELETE')->>'revision','2','Linked deletion supported');
select is(public.get_personal_committed_money('f1030000-0000-4000-8000-000000000001')->'buckets','[]'::jsonb,'Deleted linked actual cancels commitment rather than reopens it');
select is(public.get_personal_recurring_month(pg_temp.month())#>>'{items,0,transaction,amount_minor}','250','Cancelled recurring history retains corrected actual');
select ok((public.get_personal_recurring_month(pg_temp.month())#>>'{items,0,transaction,deleted_at}') is not null,'Cancelled actual remains visible');
select throws_ok($$select public.resolve_personal_recurring_expense(pg_temp.tx(9),pg_temp.tx(60),'f1030000-0000-4000-8000-000000000001',pg_temp.month(),100,'USD',pg_temp.month())$$,'23505',null,'Tombstone identity prevents a second resolution');
select public.stop_personal_recurring_expense(pg_temp.tx(60),pg_temp.month());
select is(pg_temp.change(8,2,'RESTORE')->>'amount_minor','250','Corrected fixed actual restores after stop without template reset');
select is(public.get_personal_committed_money('f1030000-0000-4000-8000-000000000001')->'buckets','[]'::jsonb,'Restored corrected actual is not also a commitment');
select is((select count(*) from public.transactions where recurring_template_id=pg_temp.tx(60)),1::bigint,'One permanent actual identity');

-- Archives preserve existing actual edits, while current restore eligibility remains required.
update public.categories set archived_at=now() where id='f1070000-0000-4000-8000-000000000001';
select is(pg_temp.edit(8,3,260,gen_random_uuid(),'f1070000-0000-4000-8000-000000000001')->>'amount_minor','260','Unchanged archived historical category survives amount correction');
select pg_temp.change(8,4,'DELETE');
select throws_ok($$select pg_temp.change(8,5,'RESTORE')$$,'42501',null,'Restore still requires eligible original category');
update public.categories set archived_at=null where id='f1070000-0000-4000-8000-000000000001';
select pg_temp.change(8,5,'RESTORE');
set constraints all immediate;
reset role;
update public.budget_periods set status='CLOSED',closed_at=now() where id='f1030000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','Owner closed-month role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'Owner closed-month identity');
select throws_ok($$select pg_temp.edit(8,6,270,gen_random_uuid(),'f1070000-0000-4000-8000-000000000001')$$,'42501',null,'Closed month edit denied');
select throws_ok($$select pg_temp.change(8,6,'DELETE')$$,'42501',null,'Closed month delete denied');
select throws_ok($$select pg_temp.change(2,7,'RESTORE')$$,'42501',null,'Closed month restore denied');
select is(pg_temp.edit(8,0,250,pg_temp.tx(108),'f1070000-0000-4000-8000-000000000001')->>'revision','1','Closed-month exact replay returns original result without mutation');
select is((select amount_minor from public.transactions where id=pg_temp.tx(8)),260::bigint,'Closed replay does not revert newer amount');
select results_eq($$update public.transactions set description='No' where id=pg_temp.tx(8) returning id$$,array[]::uuid[],'Direct update still filters closed rows');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000002');
select is(current_user::text,'authenticated','Partner B role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000002'::uuid,'Partner B identity');
select is((select count(*) from public.transaction_revisions),0::bigint,'Partner cannot read original or corrected private values');
select throws_ok($$select pg_temp.edit(8,0,250,pg_temp.tx(108),'f1070000-0000-4000-8000-000000000001')$$,'42501',null,'Partner cannot replay owner request');
select throws_ok($$select pg_temp.change(8,6,'DELETE')$$,'42501',null,'Partner cannot mutate through definer');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000003');
select is(current_user::text,'authenticated','Stranger C role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000003'::uuid,'Stranger C identity');
select is((select count(*) from public.transaction_revisions),0::bigint,'Stranger cannot read audit');
select throws_ok($$select pg_temp.change(8,6,'RESTORE')$$,'42501',null,'Stranger cannot use restoration as elevated access');
reset role;
select pg_temp.set_jwt_subject(null);
-- Test-only legacy setup, after draining deferred triggers; never a production repair.
set constraints all immediate;
alter table public.transactions disable trigger user;
insert into public.transactions(id,owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date)
values(pg_temp.tx(10),'f0050000-0000-4000-8000-000000000003','f1030000-0000-4000-8000-000000000003','SAVINGS_CONTRIBUTION',10,'USD',pg_temp.month());
alter table public.transactions enable trigger user;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000003');
select is(current_user::text,'authenticated','Legacy C role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000003'::uuid,'Legacy C identity');
select throws_ok($$select pg_temp.edit(10,0,20)$$,'23514',null,'Monetary edit cannot promote legacy contribution');
select ok(not (select savings_validated from public.transactions where id=pg_temp.tx(10)),'Legacy provenance remains false');
select is(pg_temp.change(10,0,'DELETE')->>'revision','1','Legacy invalid record can be recoverably removed');
select throws_ok($$select pg_temp.change(10,1,'RESTORE')$$,'23514',null,'Unfunded legacy restore denied');
select ok((select deleted_at is not null and not savings_validated from public.transactions where id=pg_temp.tx(10)),'Failed restore leaves tombstone unpromoted');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject(null);
select is(current_user::text,'authenticated','Missing identity role');
select is(auth.uid(),null::uuid,'No identity');
select throws_ok($$select pg_temp.change(8,6,'DELETE')$$,'42501',null,'Missing auth rejected before elevated lookup');
select is((select count(*) from public.transaction_revisions),0::bigint,'Missing auth audit empty');
reset role;
set local role anon;
select pg_temp.set_jwt_subject(null);
select is(current_user::text,'anon','Anonymous role');
select is(auth.uid(),null::uuid,'Anonymous identity');
select throws_ok($$select * from public.transaction_revisions$$,'42501',null,'Anonymous audit denied by grants');
select throws_ok($$select public.correct_personal_transaction(gen_random_uuid(),pg_temp.tx(8),6,'DELETE','{}',true)$$,'42501',null,'Anonymous RPC denied by grants');
reset role;
select * from finish();
rollback;
