\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_catalog;
\ir helpers/auth.sql.inc
select no_plan();
insert into public.profiles(id,display_name,base_currency,timezone)
select id,'Synthetic remainder','USD','UTC' from auth.users where id::text like 'f0050000%';
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('f1250000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into public.budget_periods(id,profile_id,starts_on,ends_on,base_currency) values
(pg_temp.id(1),'f0050000-0000-4000-8000-000000000001','2025-01-01','2025-01-31','USD'),
(pg_temp.id(2),'f0050000-0000-4000-8000-000000000001','2025-02-01','2025-02-28','USD'),
(pg_temp.id(3),'f0050000-0000-4000-8000-000000000001','2025-03-01','2025-03-31','USD'),
(pg_temp.id(4),'f0050000-0000-4000-8000-000000000002','2025-02-01','2025-02-28','USD'),
(pg_temp.id(5),'f0050000-0000-4000-8000-000000000001','2025-04-01','2025-04-30','UYU');
insert into public.budget_buckets(id,profile_id,name,type) values
(pg_temp.id(10),'f0050000-0000-4000-8000-000000000001','Needs','SPENDABLE'),
(pg_temp.id(11),'f0050000-0000-4000-8000-000000000001','Leisure','SPENDABLE'),
(pg_temp.id(12),'f0050000-0000-4000-8000-000000000001','Protected','SAVINGS'),
(pg_temp.id(13),'f0050000-0000-4000-8000-000000000001','Unallocated destination bucket','SPENDABLE'),
(pg_temp.id(14),'f0050000-0000-4000-8000-000000000002','Partner','SPENDABLE');
insert into public.categories(id,profile_id,name,budget_bucket_id) values
(pg_temp.id(20),'f0050000-0000-4000-8000-000000000001','Needs category',pg_temp.id(10));
create function pg_temp.context() returns jsonb language sql stable as $$select public.get_personal_remainder_context('2025-01-01')$$;
create function pg_temp.dispose(request uuid default pg_temp.id(100),amount bigint default 150,action text default 'CARRY_BUCKET',destination uuid default pg_temp.id(2),bucket uuid default pg_temp.id(13),fingerprint text default null,version bigint default 0,confirmed boolean default true)
returns jsonb language sql volatile as $$select public.close_and_dispose_personal_remainder(request,pg_temp.id(1),version,coalesce(fingerprint,pg_temp.context()->>'preview_hash'),action,amount,destination,bucket,confirmed)$$;
create function pg_temp.reverse_context() returns jsonb language sql stable as $$select public.get_personal_carry_reversal_context(pg_temp.id(100))$$;
create function pg_temp.reverse(request uuid default pg_temp.id(101),fingerprint text default null,source_version bigint default 1,destination_version bigint default 0,confirmed boolean default true)
returns jsonb language sql volatile as $$select public.reverse_carry_and_reopen_personal_period(request,pg_temp.id(100),source_version,destination_version,coalesce(fingerprint,pg_temp.reverse_context()->>'preview_hash'),confirmed)$$;
select ok((select relrowsecurity from pg_class where oid=t::regclass),'RLS enabled '||t) from unnest(array['public.budget_period_dispositions','public.budget_period_carry_reversals']) t;
select ok(not has_table_privilege('authenticated',t,p),'No client '||p||' on '||t)
  from unnest(array['public.budget_period_dispositions','public.budget_period_carry_reversals']) t cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER']) p;
select ok(not has_column_privilege('authenticated','public.transactions','savings_validated','INSERT'),'Provenance insert remains server-only');
select ok(not has_column_privilege('authenticated','public.transactions','savings_validated','UPDATE'),'Provenance update remains server-only');
select ok(prosecdef and proconfig @> array['search_path=""'],'Narrow empty-path definer '||proname) from pg_proc where oid in
('public.close_and_dispose_personal_remainder(uuid,uuid,bigint,text,text,bigint,uuid,uuid,boolean)'::regprocedure,
'public.reverse_carry_and_reopen_personal_period(uuid,uuid,bigint,bigint,text,boolean)'::regprocedure);
select ok(not has_function_privilege('anon',f,'EXECUTE'),'No anonymous execution '||f) from unnest(array[
'public.get_personal_carry(uuid)','public.get_personal_remainder_context(date)','public.get_personal_carry_reversal_context(uuid)',
'public.close_and_dispose_personal_remainder(uuid,uuid,bigint,text,text,bigint,uuid,uuid,boolean)',
'public.reverse_carry_and_reopen_personal_period(uuid,uuid,bigint,bigint,text,boolean)']) f;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','Owner role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'Owner subject');
select public.save_budget_allocations(pg_temp.id(p),jsonb_build_array(
jsonb_build_object('budget_bucket_id',pg_temp.id(10),'percentage_basis_points',5000),
jsonb_build_object('budget_bucket_id',pg_temp.id(11),'percentage_basis_points',3000),
jsonb_build_object('budget_bucket_id',pg_temp.id(12),'percentage_basis_points',2000))) from generate_series(1,3) p;
select public.register_income(pg_temp.id(30),pg_temp.id(1),1000,'USD','2025-01-02');
select public.register_personal_expense(pg_temp.id(31),pg_temp.id(1),600,'USD','2025-01-03',pg_temp.id(20));
select public.register_savings_movement(pg_temp.id(32),pg_temp.id(1),'SAVINGS_CONTRIBUTION',50,'USD','2025-01-04',false);
select is(pg_temp.context()#>>'{close,summary,snapshot_version}','2','Current summary has explicit version');
select is(public.get_savings_availability(pg_temp.id(1))->>'allocated_savings_minor','200','Percentage savings already funded');
select throws_ok($$select pg_temp.dispose(amount=>151)$$,'23514',null,'Global cap includes deficit and extra savings, not 300 positive Leisure');
select throws_ok($$select pg_temp.dispose(amount=>0)$$,'22023',null,'Zero amount denied');
select throws_ok($$select pg_temp.dispose(amount=>9007199254740992)$$,'22023',null,'Unsafe amount denied');
select throws_ok($$select pg_temp.dispose(confirmed=>false)$$,'22023',null,'Explicit disposition confirmation required');
select throws_ok($$select pg_temp.dispose(confirmed=>null)$$,'22023',null,'Null confirmation denied');
select throws_ok($$select pg_temp.dispose(version=>null)$$,'22023',null,'Null version denied');
select throws_ok($$select pg_temp.dispose(fingerprint=>repeat('a',32))$$,'40001',null,'Stale preview denied');
select throws_ok($$select pg_temp.dispose(destination=>pg_temp.id(4))$$,'42501',null,'Partner destination denied');
select throws_ok($$select pg_temp.dispose(destination=>pg_temp.id(3))$$,'23514',null,'Skipping next month denied');
select throws_ok($$select pg_temp.dispose(bucket=>pg_temp.id(12))$$,'23514',null,'Savings bucket cannot receive ordinary carry');
select throws_ok($$select pg_temp.dispose(bucket=>pg_temp.id(14))$$,'23514',null,'Partner bucket denied');
select throws_ok($$select pg_temp.dispose(action=>'CARRY_UNALLOCATED')$$,'22023',null,'Unallocated carry rejects hidden bucket assignment');
select throws_ok($$select pg_temp.dispose(action=>'SAVINGS')$$,'22023',null,'Savings rejects destination fields');
savepoint invalid_destination;
reset role;
update public.budget_periods set base_currency='UYU' where id=pg_temp.id(2);
set local role authenticated;
select throws_ok($$select pg_temp.dispose()$$,'23514',null,'currency destination cannot receive carry');
rollback to invalid_destination;
savepoint invalid_destination;
reset role;
update public.budget_periods set status='CLOSED',closed_at=clock_timestamp() where id=pg_temp.id(2);
set local role authenticated;
select throws_ok($$select pg_temp.dispose()$$,'23514',null,'closed destination cannot receive carry');
rollback to invalid_destination;
savepoint invalid_destination;
reset role;
delete from public.budget_allocations where budget_period_id=pg_temp.id(2);
set local role authenticated;
select throws_ok($$select pg_temp.dispose()$$,'23514',null,'unconfigured destination cannot receive carry');
rollback to invalid_destination;
savepoint unresolved_source;
reset role;
set constraints all immediate;
alter table public.recurring_expenses disable trigger recurring_expenses_validate;
insert into public.recurring_expenses(id,owner_profile_id,name,category_id,amount_mode,default_amount_minor,currency,due_day,active_from,active_until) values
(pg_temp.id(250),'f0050000-0000-4000-8000-000000000001','Zero estimate',pg_temp.id(20),'VARIABLE',0,'USD',1,'2025-01-01','2025-01-01');
alter table public.recurring_expenses enable trigger recurring_expenses_validate;
set local role authenticated;
select throws_ok($$select pg_temp.dispose()$$,'23514',null,'Even zero estimated source obligation blocks disposition and close');
select is((select count(*) from public.budget_period_dispositions),0::bigint,'Unresolved source leaves no partial carry');
rollback to unresolved_source;
select set_config('fin125.pre_hash',pg_temp.context()->>'preview_hash',true);
select set_config('fin125.old_close_hash',pg_temp.context()#>>'{close,snapshot_hash}',true);
set constraints all immediate;
select is(pg_temp.dispose()->'disposition'->>'amount_minor','150','Explicit amount carried and source closed atomically');
select is((select status from public.budget_periods where id=pg_temp.id(1)),'CLOSED','Source closed');
select is((select snapshot_version from public.budget_period_closures where id=pg_temp.id(100)),2,'New evidence explicitly v2');
select isnt((select snapshot_hash from public.budget_period_closures where id=pg_temp.id(100)),current_setting('fin125.old_close_hash'),'Close fingerprint is post-action, not reviewed pre-action');
select set_config('fin125.saved_summary',(select summary::text from public.budget_period_closures where id=pg_temp.id(100)),true);
select is(public.get_received_income(pg_temp.id(2)),0::bigint,'Carry is not income');
select is(public.get_personal_carry(pg_temp.id(1))->>'outgoing_minor','150','Source debit once');
select is(public.get_personal_carry(pg_temp.id(2))->>'incoming_minor','150','Destination credit once');
select is(public.get_personal_carry(pg_temp.id(2))#>>'{buckets,0,budget_bucket_id}',pg_temp.id(13)::text,'Explicit otherwise-unallocated bucket preserved');
select is(public.get_savings_availability(pg_temp.id(2))->>'allocated_savings_minor','0','Carry not percentage-resplit');
select is(public.get_savings_availability(pg_temp.id(2))->>'opening_protected_minor','250','Existing cumulative savings not rolled again');
select is((select count(*) from public.transactions),3::bigint,'Carry creates no transaction/expense');
select is(jsonb_array_length(public.get_personal_dashboard('2025-02-01')->'consumption'->'buckets'),3,'Carried unallocated bucket remains in usage even with no expense');
select is(pg_temp.dispose(fingerprint=>current_setting('fin125.pre_hash'))#>>'{disposition,id}',pg_temp.id(100)::text,'Exact disposition replay read-only after close');
select throws_ok($$select pg_temp.dispose(amount=>149,fingerprint=>current_setting('fin125.pre_hash'))$$,'23505',null,'Changed replay amount denied');
select throws_ok($$select public.reopen_personal_budget_period(pg_temp.id(102),pg_temp.id(1),1,public.get_personal_period_close_context('2025-01-01')->>'reopen_hash',true)$$,'23514',null,'New source reopen cannot reuse active carry');
savepoint unresolved_destination;
reset role;
set constraints all immediate;
alter table public.recurring_expenses disable trigger recurring_expenses_validate;
insert into public.recurring_expenses(id,owner_profile_id,name,category_id,amount_mode,default_amount_minor,currency,due_day,active_from,active_until) values
(pg_temp.id(251),'f0050000-0000-4000-8000-000000000001','Zero estimate',pg_temp.id(20),'VARIABLE',0,'USD',1,'2025-02-01','2025-02-01');
alter table public.recurring_expenses enable trigger recurring_expenses_validate;
set local role authenticated;
select is(pg_temp.reverse_context()->>'can_reverse','false','Even zero estimated destination obligation blocks reversal');
select throws_ok($$select pg_temp.reverse()$$,'23514',null,'Reversal never cancels obligation or silently opens source');
select is((select status from public.budget_periods where id=pg_temp.id(1)),'CLOSED','Blocked reversal leaves source closed');
rollback to unresolved_destination;
select public.register_savings_movement(pg_temp.id(40),pg_temp.id(2),'SAVINGS_CONTRIBUTION',100,'USD','2025-02-01',false);
select is((select amount_minor from public.transactions where id=pg_temp.id(40)),100::bigint,'Incoming carry funds an ordinary new contribution');
select is(pg_temp.reverse_context()->>'can_reverse','false','Cannot reverse already contributed money');
select throws_ok($$select pg_temp.reverse()$$,'23514',null,'Insufficient destination funds rejects both reversal and reopening');
select is((select count(*) from public.budget_period_carry_reversals),0::bigint,'Failed reversal leaves no evidence or partial effects');
select throws_ok($$select public.correct_personal_transaction(pg_temp.id(41),pg_temp.id(40),0,'EDIT','{"amount_minor":151,"transaction_date":"2025-02-01","category_id":null,"description":null}',true)$$,'23514',null,'Correction funding cannot exceed carry');
select public.correct_personal_transaction(pg_temp.id(42),pg_temp.id(40),0,'EDIT','{"amount_minor":150,"transaction_date":"2025-02-01","category_id":null,"description":null}',true);
select is((select amount_minor from public.transactions where id=pg_temp.id(40)),150::bigint,'Correction increase includes carry exactly');
select public.correct_personal_transaction(pg_temp.id(43),pg_temp.id(40),1,'DELETE','{}',true);
select public.correct_personal_transaction(pg_temp.id(44),pg_temp.id(40),2,'RESTORE','{}',true);
select is((select deleted_at from public.transactions where id=pg_temp.id(40)),null::timestamptz,'Restoration funding includes carry');
select public.correct_personal_transaction(pg_temp.id(45),pg_temp.id(40),3,'DELETE','{}',true);
select is(pg_temp.reverse_context()->>'can_reverse','true','Explicit correction restores reversal capacity');
select set_config('fin125.reverse_hash',pg_temp.reverse_context()->>'preview_hash',true);
select throws_ok($$select pg_temp.reverse(confirmed=>false)$$,'22023',null,'Both reversal and reopen need confirmation');
select throws_ok($$select pg_temp.reverse(source_version=>0)$$,'40001',null,'Source lifecycle version checked');
select throws_ok($$select pg_temp.reverse(destination_version=>1)$$,'40001',null,'Destination lifecycle version checked');
select is(pg_temp.reverse()#>>'{reopening,lifecycle_version}','2','Reversal and source reopen atomic');
select is((select status from public.budget_periods where id=pg_temp.id(1)),'OPEN','Source reopened explicitly');
select is(public.get_personal_carry(pg_temp.id(1))->>'outgoing_minor','0','Reversal returns source ordinary capacity once');
select is(public.get_personal_carry(pg_temp.id(2))->>'incoming_minor','0','Reversal removes destination capacity once');
select is((select summary from public.budget_period_closures where id=pg_temp.id(100)),current_setting('fin125.saved_summary')::jsonb,'Post-action close snapshot remains immutable after reversal');
select is(pg_temp.reverse(fingerprint=>current_setting('fin125.reverse_hash'))#>>'{reopening,lifecycle_version}','2','Exact reversal replay after reopen is read-only');
select is(pg_temp.dispose(fingerprint=>current_setting('fin125.pre_hash'))#>>'{closure,lifecycle_version}','1','Old disposition replay after reversal returns original close');
select is((select status||':'||lifecycle_version from public.budget_periods where id=pg_temp.id(1)),'OPEN:2','Old disposition never re-closes or reapplies carry');
select throws_ok($$select public.correct_personal_transaction(pg_temp.id(46),pg_temp.id(40),4,'RESTORE','{}',true)$$,'23514',null,'Removed carry cannot fund a later restoration');
select set_config('fin125.saved_savings_hash',pg_temp.context()->>'preview_hash',true);
select is(pg_temp.dispose(pg_temp.id(110),150,'SAVINGS',null,null,null,2)#>>'{closure,lifecycle_version}','3','Alternative disposition contributes and closes atomically');
select is(public.get_savings_availability(pg_temp.id(1))->>'contributions_minor','200','Extra remainder saving counted once, not percentage allocation');
select is(public.get_savings_availability(pg_temp.id(1))->>'unassigned_savings_minor','400','Correct cumulative protected reserve');
select is(pg_temp.reverse(fingerprint=>current_setting('fin125.reverse_hash'))#>>'{reopening,lifecycle_version}','2','Old reversal replay after new close returns original');
select is((select status||':'||lifecycle_version from public.budget_periods where id=pg_temp.id(1)),'CLOSED:3','Old reversal cannot reopen a later close');
select is(pg_temp.dispose(pg_temp.id(110),150,'SAVINGS',null,null,current_setting('fin125.saved_savings_hash'),2)#>>'{disposition,id}',pg_temp.id(110)::text,'Savings disposition replay does not duplicate contribution');
select is((select count(*) from public.transactions where id=pg_temp.id(110)),1::bigint,'One saved contribution');
select throws_ok($$insert into public.budget_period_dispositions select * from public.budget_period_dispositions$$,'42501',null,'Direct forged disposition denied');
select throws_ok($$update public.budget_period_dispositions set amount_minor=1$$,'42501',null,'Direct amount rewrite denied');
select throws_ok($$delete from public.budget_period_dispositions$$,'42501',null,'Direct disposition deletion denied');
select throws_ok($$insert into public.budget_period_carry_reversals select * from public.budget_period_carry_reversals$$,'42501',null,'Forged reversal denied');
select throws_ok($$update public.budget_period_carry_reversals set request_payload='{}'$$,'42501',null,'Reversal rewrite denied');
select throws_ok($$delete from public.budget_period_carry_reversals$$,'42501',null,'Reversal deletion denied');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000002');
select is(current_user::text,'authenticated','Partner role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000002'::uuid,'Partner subject');
select is((select count(*) from public.budget_period_dispositions),0::bigint,'Partner cannot read personal dispositions');
select is((select count(*) from public.budget_period_carry_reversals),0::bigint,'Partner cannot read reversal history');
select throws_ok($$select public.get_personal_carry(pg_temp.id(1))$$,'42501',null,'Partner cannot read owner carry aggregate');
select throws_ok($$select public.get_personal_carry_reversal_context(pg_temp.id(100))$$,'42501',null,'Partner cannot read reversal preview');
select throws_ok($$select pg_temp.dispose(fingerprint=>current_setting('fin125.pre_hash'))$$,'42501',null,'Partner cannot replay owner disposition');
select throws_ok($$select pg_temp.reverse(fingerprint=>current_setting('fin125.reverse_hash'))$$,'42501',null,'Partner cannot replay owner reversal');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000003');
select is(current_user::text,'authenticated','Stranger role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000003'::uuid,'Stranger subject');
select is((select count(*) from public.budget_period_dispositions),0::bigint,'Stranger RLS isolation');
select throws_ok($$select public.get_personal_carry(pg_temp.id(2))$$,'42501',null,'Stranger aggregate isolation');
select pg_temp.set_jwt_subject(null);
select is(auth.uid(),null::uuid,'Null auth verified');
select throws_ok($$select pg_temp.dispose(fingerprint=>repeat('a',32))$$,'42501',null,'Missing identity cannot invoke definer');
select throws_ok($$select pg_temp.reverse(fingerprint=>repeat('a',32))$$,'42501',null,'Missing identity cannot reverse');
reset role;
set local role anon;
select pg_temp.set_jwt_subject(null);
select is(current_user::text,'anon','Anonymous role');
select is(auth.uid(),null::uuid,'Anonymous subject');
select throws_ok($$select * from public.budget_period_dispositions$$,'42501',null,'Anonymous read privilege denied');
select throws_ok($$select pg_temp.dispose(fingerprint=>repeat('a',32))$$,'42501',null,'Anonymous write privilege denied');
reset role;
-- Independent successful unallocated path and downstream reversal ordering.
reset role;
savepoint extra_paths;
insert into public.budget_periods(id,profile_id,starts_on,ends_on,base_currency) values
(pg_temp.id(6),'f0050000-0000-4000-8000-000000000001','2025-05-01','2025-05-31','USD'),
(pg_temp.id(7),'f0050000-0000-4000-8000-000000000001','2025-06-01','2025-06-30','USD'),
(pg_temp.id(8),'f0050000-0000-4000-8000-000000000001','2025-07-01','2025-07-31','USD');
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select public.save_budget_allocations(pg_temp.id(p),jsonb_build_array(
jsonb_build_object('budget_bucket_id',pg_temp.id(10),'percentage_basis_points',5000),
jsonb_build_object('budget_bucket_id',pg_temp.id(11),'percentage_basis_points',3000),
jsonb_build_object('budget_bucket_id',pg_temp.id(12),'percentage_basis_points',2000))) from generate_series(6,8) p;
select public.register_income(pg_temp.id(200),pg_temp.id(6),101,'USD','2025-05-01');
select is(public.get_savings_availability(pg_temp.id(6))->>'spendable_allocated_minor','81','Largest remainder split is on received income only');
select public.close_and_dispose_personal_remainder(pg_temp.id(201),pg_temp.id(6),0,public.get_personal_remainder_context('2025-05-01')->>'preview_hash','CARRY_UNALLOCATED',81,pg_temp.id(7),null,true);
select is(public.get_personal_carry(pg_temp.id(7))->>'unallocated_minor','81','Explicit unallocated credit is separate');
select is(public.get_personal_carry(pg_temp.id(7))->'buckets','[]'::jsonb,'Unallocated carry is not implicitly redistributed');
select is(public.get_savings_availability(pg_temp.id(7))->>'allocated_savings_minor','0','Incoming unallocated carry earns no second protected percentage');
select public.close_and_dispose_personal_remainder(pg_temp.id(202),pg_temp.id(7),0,public.get_personal_remainder_context('2025-06-01')->>'preview_hash','CARRY_BUCKET',81,pg_temp.id(8),pg_temp.id(13),true);
select is(public.get_personal_carry_reversal_context(pg_temp.id(201))->>'can_reverse','false','Closed downstream destination blocks upstream reversal');
select throws_ok($$select public.reverse_carry_and_reopen_personal_period(pg_temp.id(203),pg_temp.id(201),1,1,public.get_personal_carry_reversal_context(pg_temp.id(201))->>'preview_hash',true)$$,'23514',null,'Downstream carry must be explicitly undone first');
reset role;
update public.budget_buckets set archived_at=clock_timestamp() where id=pg_temp.id(13);
set local role authenticated;
select is(public.get_personal_carry(pg_temp.id(8))#>>'{buckets,0,amount_minor}','81','Archiving target retains historical mapping');
select is(public.get_personal_dashboard('2025-07-01')->'consumption'->'buckets' @> jsonb_build_array(jsonb_build_object('budget_bucket_id',pg_temp.id(13))),true,'Archived unallocated bucket still appears in complete usage');
select public.reverse_carry_and_reopen_personal_period(pg_temp.id(204),pg_temp.id(202),1,0,public.get_personal_carry_reversal_context(pg_temp.id(202))->>'preview_hash',true);
select public.reverse_carry_and_reopen_personal_period(pg_temp.id(205),pg_temp.id(201),1,2,public.get_personal_carry_reversal_context(pg_temp.id(201))->>'preview_hash',true);
select is(public.get_personal_carry(pg_temp.id(6))->>'outgoing_minor','0','Ordered reversals restore original capacity exactly');
select is(public.get_personal_carry(pg_temp.id(7))->>'incoming_minor','0','Intermediate credit removed exactly');
select is(public.get_personal_carry(pg_temp.id(8))->>'incoming_minor','0','Final destination credit removed exactly');
rollback to extra_paths;

select * from finish();
rollback;
