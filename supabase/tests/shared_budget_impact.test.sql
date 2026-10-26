\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_catalog;
\ir helpers/auth.sql.inc
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
 select ('f2100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.period(month date) returns uuid language sql stable as $$
 select id from public.budget_periods where profile_id=auth.uid() and starts_on=month;
$$;
create function pg_temp.setup(month date,money text default 'USD') returns uuid language plpgsql as $$
declare allocations jsonb; result uuid;
begin
 perform public.prepare_initial_budget_buckets();
 select jsonb_agg(jsonb_build_object('budget_bucket_id',id,'percentage_basis_points',
   case system_key when 'NEEDS' then 5000 when 'LEISURE' then 3000 else 2000 end)) into allocations
   from public.budget_buckets where profile_id=auth.uid() and system_key is not null;
 select id into result from public.save_initial_budget(month,money,null,allocations);
 return result;
end;
$$;
create function pg_temp.expense(n integer,amount bigint default 1000,classification text default 'LEISURE',day date default '2025-01-02',money text default 'USD')
returns jsonb language sql as $$ select public.create_shared_expense(pg_temp.id(n),pg_temp.id(20),pg_temp.id(41),pg_temp.id(30),1,
 array[pg_temp.id(40),pg_temp.id(41),pg_temp.id(42)],amount,money,day,'Cena compartida',classification); $$;
create function pg_temp.spent(month date) returns numeric language sql stable as $$
 select coalesce(sum((b->>'spent_minor')::numeric),0) from jsonb_array_elements(public.get_bucket_consumption(pg_temp.period(month))->'buckets') b;
$$;
create function pg_temp.close(month date,n integer) returns jsonb language plpgsql as $$
declare context jsonb;
begin
 context:=public.get_personal_period_close_context(month);
 return public.close_personal_budget_period(pg_temp.id(n),pg_temp.period(month),(context#>>'{period,lifecycle_version}')::bigint,context->>'snapshot_hash',true);
end;
$$;
create function pg_temp.reopen(month date,n integer) returns jsonb language plpgsql as $$
declare context jsonb;
begin
 context:=public.get_personal_period_close_context(month);
 return public.reopen_personal_budget_period(pg_temp.id(n),pg_temp.period(month),(context#>>'{period,lifecycle_version}')::bigint,context->>'reopen_hash',true);
end;
$$;
create temp table evidence(label text primary key,value jsonb);
grant select,insert on evidence to authenticated;
insert into auth.users(id,email) select pg_temp.id(n),'fin210-'||n||'@example.invalid' from generate_series(1,4)n;
insert into public.profiles(id,display_name,base_currency,timezone) select pg_temp.id(n),'Private actor '||n,'USD','UTC' from generate_series(1,4)n;
insert into public.households(id,name,default_currency,created_by) values(pg_temp.id(20),'Casa','USD',pg_temp.id(1));
insert into public.household_members(id,household_id,profile_id,role,joined_at) values
 (pg_temp.id(40),pg_temp.id(20),pg_temp.id(1),'OWNER','2025-01-01'),
 (pg_temp.id(41),pg_temp.id(20),pg_temp.id(2),'MEMBER','2025-01-01'),
 (pg_temp.id(42),pg_temp.id(20),pg_temp.id(4),'MEMBER','2025-01-01');
select ok(not has_function_privilege('anon','public.get_my_shared_responsibilities(date)','EXECUTE'),'Anonymous source RPC denied by grants');
select ok(not has_function_privilege('anon','public.get_personal_protected_reserve(uuid)','EXECUTE'),'Anonymous reserve RPC denied by grants');
select ok(not has_function_privilege('anon','public.get_personal_savings_context(date)','EXECUTE'),'Anonymous savings context denied by grants');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='public.get_my_shared_responsibilities(date)'::regprocedure),'Source definer is explicitly bounded with empty search path');
select ok((select not prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='public.get_personal_protected_reserve(uuid)'::regprocedure),'Reserve keeps invoker security and empty search path');
set local role anon;select pg_temp.set_jwt_subject(null);
select is(current_user::text,'anon','Real anonymous role');select is(auth.uid(),null::uuid,'Anonymous subject');
select throws_ok($$select public.get_my_shared_responsibilities('2025-01-01')$$,'42501',null,'Anonymous denied');
reset role;set local role authenticated;select pg_temp.set_jwt_subject(null);
select is(current_user::text,'authenticated','Real authenticated role');select is(auth.uid(),null::uuid,'Missing subject');
select throws_ok($$select public.get_my_shared_responsibilities('2025-01-01')$$,'42501',null,'Missing subject denied');
select throws_ok($$select public.get_personal_protected_reserve(pg_temp.id(999))$$,'42501',null,'Missing subject reserve denied');
select pg_temp.set_jwt_subject(pg_temp.id(1));select is(auth.uid(),pg_temp.id(1),'A current owner');
select public.save_household_default_split(pg_temp.id(30),pg_temp.id(20),0,array[pg_temp.id(40),pg_temp.id(41),pg_temp.id(42)],
 jsonb_build_array(jsonb_build_object('member_id',pg_temp.id(40),'basis_points',7500),jsonb_build_object('member_id',pg_temp.id(41),'basis_points',2500),jsonb_build_object('member_id',pg_temp.id(42),'basis_points',0)));
select throws_ok('select pg_temp.expense(50,1000,null)','22023',null,'New expense requires explicit classification');
select throws_ok($$select pg_temp.expense(50,1000,'SAVINGS')$$,'22023',null,'Savings cannot classify responsibility');
select lives_ok('select pg_temp.expense(50)','Shared entry works without any participant period/plan/income');
select is(pg_temp.expense(50)->>'budget_classification','LEISURE','One classification persisted for everyone');
select throws_ok($$select pg_temp.expense(50,1000,'NEEDS')$$,'23505',null,'Classification is part of exact identity');
select is((select count(*) from public.budget_periods),0::bigint,'Shared entry never creates personal periods');
select is((select count(*) from public.budget_buckets),0::bigint,'Shared entry never creates private defaults');
select is(public.get_my_shared_responsibilities('2025-01-01')#>>'{entries,0,responsibility_amount_minor}','750','A consumes own 750, not total paid');
select pg_temp.set_jwt_subject(pg_temp.id(2));select is(auth.uid(),pg_temp.id(2),'B current member and payer');
select is(public.get_my_shared_responsibilities('2025-01-01')#>>'{entries,0,responsibility_amount_minor}','250','Payer B consumes own 250, not total 1000');
select is(public.get_my_shared_responsibilities('2025-01-01')#>>'{entries,0,budget_classification}','LEISURE','No-plan 250 retains Ocio classification');
select is(public.get_my_shared_responsibilities('2025-01-01')#>>'{entries,0,household_name}','Casa','Current authorized household provenance');
select is(public.get_my_shared_responsibilities('2025-01-01')#>>'{entries,0,application_status}','NO_PERIOD','No period is explicit, not consumption zero');
select is(public.get_my_shared_responsibilities('2025-01-01')->'period','null'::jsonb,'No invented personal period');
select is(public.get_personal_dashboard('2025-01-01')->'period','null'::jsonb,'Independent source remains accessible beside no-period dashboard');
select throws_ok($$select public.get_my_shared_responsibilities('2025-01-02')$$,'22023',null,'Only canonical month accepted');
select throws_ok($$select public.get_my_shared_responsibilities(null)$$,'22023',null,'Null month denied');
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_my_shared_responsibilities('2025-01-01')#>'{entries,0}')k),
 array['application_status','budget_classification','currency','description','expense_id','household_id','household_name','included_in_closed_period','responsibility_amount_minor','transaction_date'],'Private projection contains only own original facts and provenance');
-- A custom label is not authority to map a canonical shared classification.
insert into public.budget_periods(profile_id,starts_on,ends_on,base_currency) values(auth.uid(),'2025-01-01','2025-01-31','USD');
insert into public.budget_buckets(profile_id,name,type) values(auth.uid(),'Ocio','SPENDABLE');
select is(public.get_my_shared_responsibilities('2025-01-01')#>>'{entries,0,application_status}','NO_BUCKET','Never maps a custom bucket by name');
select throws_ok($$select pg_temp.spent('2025-01-01')$$,'23514',null,'Missing canonical mapping never produces partial total');
select lives_ok($$select pg_temp.setup('2025-01-01')$$,'Explicit setup connects existing responsibility');
select is(pg_temp.spent('2025-01-01'),250::numeric,'Responsibility counted once after setup without income');
select is(public.get_savings_availability(pg_temp.period('2025-01-01'))->>'spent_minor','250','Savings availability receives same own consumption');
select is((public.get_personal_dashboard('2025-01-01')#>>'{availability,savings,spendable_allocated_minor}')::numeric,0::numeric,'No received income is fabricated');
select is((select count(*) from public.transactions where type='EXPENSE'),0::bigint,'No duplicate personal expense created');
select public.register_income(pg_temp.id(100),pg_temp.period('2025-01-01'),2000,'USD','2025-01-03');
select public.register_savings_movement(pg_temp.id(101),pg_temp.period('2025-01-01'),'SAVINGS_CONTRIBUTION',100,'USD','2025-01-03');
select is(public.get_personal_protected_reserve(pg_temp.period('2025-01-01'))->>'unassigned_savings_minor','500','Shared spend does not consume protected 400 plus explicit 100');
-- Categories have no authenticated INSERT capability; seed this fixture as test admin.
reset role;
insert into public.categories(id,profile_id,name,budget_bucket_id) select pg_temp.id(102),pg_temp.id(2),'Personal',id from public.budget_buckets where profile_id=pg_temp.id(2) and system_key='NEEDS';
set local role authenticated;select pg_temp.set_jwt_subject(pg_temp.id(2));
select is(current_user::text,'authenticated','Real role after trusted category fixture');select is(auth.uid(),pg_temp.id(2),'B owns the personal expense category');
select public.register_personal_expense(pg_temp.id(103),pg_temp.period('2025-01-01'),50,'USD','2025-01-03',pg_temp.id(102));
select is(pg_temp.spent('2025-01-01'),300::numeric,'Personal and responsibility consumption combine once');
select is(public.get_personal_safe_to_spend(pg_temp.period('2025-01-01'))#>>'{savings,spent_minor}','300','Safe-to-spend uses full 300');
select throws_ok($$select public.register_savings_movement(pg_temp.id(104),pg_temp.period('2025-01-01'),'SAVINGS_CONTRIBUTION',1201,'USD','2025-01-03')$$,'23514',null,'Contribution cap includes own shared responsibility');
insert into evidence values('closure',pg_temp.close('2025-01-01',110));
insert into evidence values('closed_consumption',public.get_bucket_consumption(pg_temp.period('2025-01-01')));
insert into evidence values('closed_availability',public.get_savings_availability(pg_temp.period('2025-01-01')));
select is((select value#>'{summary,shared_expense_ids}' from evidence where label='closure'),jsonb_build_array(pg_temp.id(50)),'Close retains exact source IDs');
select pg_temp.set_jwt_subject(pg_temp.id(1));select is(auth.uid(),pg_temp.id(1),'A adds historical responsibility after B close');
select lives_ok($$select pg_temp.expense(51,400,'LEISURE','2025-01-04')$$,'Shared recording does not force reopen of partner period');
select pg_temp.set_jwt_subject(pg_temp.id(2));select is(auth.uid(),pg_temp.id(2),'B closed-period owner');
select is((select to_jsonb(c) from public.budget_period_closures c where id=pg_temp.id(110)),(select value from evidence where label='closure'),'Original close row remains byte-stable');
select is(public.get_bucket_consumption(pg_temp.period('2025-01-01')),(select value from evidence where label='closed_consumption'),'Direct closed consumption unchanged');
select is(public.get_savings_availability(pg_temp.period('2025-01-01')),(select value from evidence where label='closed_availability'),'Closed savings view uses unchanged consumption without freezing reserve algorithm');
select is(public.get_personal_dashboard('2025-01-01')#>>'{availability,savings,spent_minor}','300','Direct dashboard remains frozen on included consumption');
select is(public.get_my_shared_responsibilities('2025-01-01')#>>'{entries,1,application_status}','CLOSED_PENDING','Later responsibility visible separately as pending');
select is(public.get_my_shared_responsibilities('2025-01-01')#>>'{entries,1,responsibility_amount_minor}','100','Pending closed responsibility is not hidden or zero');
select lives_ok($$select pg_temp.reopen('2025-01-01',111)$$,'Explicit reopen includes later source');
select is(pg_temp.spent('2025-01-01'),400::numeric,'Reopen adds pending share once');
select is(public.get_personal_protected_reserve(pg_temp.period('2025-01-01'))->>'unassigned_savings_minor','500','Reopen never raids protected reserve');
select pg_temp.close('2025-01-01',112);
select is((select value from evidence where label='closure'),(select to_jsonb(c) from public.budget_period_closures c where id=pg_temp.id(110)),'Second close preserves first evidence');
-- Every private accessor rejects forged target IDs, while month-only source stays caller-owned.
select pg_temp.set_jwt_subject(pg_temp.id(3));select is(auth.uid(),pg_temp.id(3),'Unrelated C');
select is(public.get_my_shared_responsibilities('2025-01-01')->'entries','[]'::jsonb,'Unrelated user has no sources');
select is(public.get_personal_savings_context('2025-01-01')->'period','null'::jsonb,'Stranger savings context remains own, not partner period');
select is(public.get_personal_savings_context('2025-01-01')#>'{shared_responsibilities,entries}','[]'::jsonb,'Stranger context cannot combine partner source facts');
select throws_ok($$select public.get_personal_protected_reserve((select (value#>>'{summary,period,id}')::uuid from evidence where label='closure'))$$,'42501',null,'Stranger cannot read protected reserve by forged period');
select pg_temp.set_jwt_subject(pg_temp.id(1));select is(auth.uid(),pg_temp.id(1),'Partner A is not B private owner');
select throws_ok($$select public.get_personal_protected_reserve((select (value#>>'{summary,period,id}')::uuid from evidence where label='closure'))$$,'42501',null,'Partner cannot read protected reserve');
select throws_ok($$select public.get_bucket_consumption((select (value#>>'{summary,period,id}')::uuid from evidence where label='closure'))$$,'42501',null,'Partner cannot read consumption');
select throws_ok('select * from public.shared_expense_splits','42501',null,'No new direct shared table capability');
-- Currency mismatch preserves facts, withholds every dependent availability/cap,
-- but does not block valid ordinary facts or protected-reserve validation.
select pg_temp.set_jwt_subject(pg_temp.id(2));select is(auth.uid(),pg_temp.id(2),'B prepares mismatched month explicitly');
select pg_temp.setup('2025-02-01');
select public.register_income(pg_temp.id(120),pg_temp.period('2025-02-01'),2000,'USD','2025-02-02');
select public.register_savings_movement(pg_temp.id(121),pg_temp.period('2025-02-01'),'SAVINGS_CONTRIBUTION',100,'USD','2025-02-02');
reset role;update public.households set default_currency='UYU' where id=pg_temp.id(20);
set local role authenticated;select pg_temp.set_jwt_subject(pg_temp.id(1));select is(current_user::text,'authenticated','Real role after trusted fixture currency change');select is(auth.uid(),pg_temp.id(1),'Authorized actor after currency change');
select pg_temp.expense(60,1000,'LEISURE','2025-02-03','UYU');
select pg_temp.set_jwt_subject(pg_temp.id(2));select is(auth.uid(),pg_temp.id(2),'B mismatch projection');
select is(public.get_my_shared_responsibilities('2025-02-01')#>>'{entries,0,currency}','UYU','Original peso amount retained');
select is(public.get_my_shared_responsibilities('2025-02-01')#>>'{entries,0,application_status}','OTHER_CURRENCY','Explicit incomplete currency state');
select throws_ok($$select pg_temp.spent('2025-02-01')$$,'23514',null,'No mixed or partial consumption total');
select throws_ok($$select public.get_savings_availability(pg_temp.period('2025-02-01'))$$,'23514',null,'No incomplete savings spending capacity');
select throws_ok($$select public.get_personal_safe_to_spend(pg_temp.period('2025-02-01'))$$,'23514',null,'No incomplete safe-to-spend');
select throws_ok($$select public.get_personal_remainder_context('2025-02-01')$$,'23514',null,'No incomplete closing/disposition preview');
select throws_ok($$select public.register_savings_movement(pg_temp.id(122),pg_temp.period('2025-02-01'),'SAVINGS_CONTRIBUTION',1,'USD','2025-02-03')$$,'23514',null,'Even small new contribution is not funded by incomplete margin');
select lives_ok($$select public.register_income(pg_temp.id(123),pg_temp.period('2025-02-01'),100,'USD','2025-02-03');set constraints all immediate$$,'Income remains valid with previous savings and FX-pending consumption');set constraints all deferred;
select lives_ok($$select public.register_personal_expense(pg_temp.id(124),pg_temp.period('2025-02-01'),50,'USD','2025-02-03',pg_temp.id(102));set constraints all immediate$$,'Personal expense remains valid with previous savings and FX-pending consumption');set constraints all deferred;
select lives_ok($$select public.correct_personal_transaction(pg_temp.id(125),pg_temp.id(124),0,'DELETE','{}',true);set constraints all immediate$$,'Ordinary audited correction uses protected reserve, not incomplete spending');set constraints all deferred;
select lives_ok($$select public.register_savings_movement(pg_temp.id(126),pg_temp.period('2025-02-01'),'SAVINGS_WITHDRAWAL',10,'USD','2025-02-03',true);set constraints all immediate$$,'Solvent explicit withdrawal remains possible');set constraints all deferred;
select lives_ok($$select public.get_personal_savings_goals('2025-02-01')$$,'Goal reserve reads remain meaningful');
select throws_ok($$select public.register_savings_movement(pg_temp.id(127),pg_temp.period('2025-02-01'),'SAVINGS_WITHDRAWAL',999999,'USD','2025-02-03',true)$$,'23514',null,'Unknown spending never weakens protected solvency');
select pg_temp.setup('2025-03-01');
select lives_ok($$select public.register_income(pg_temp.id(128),pg_temp.period('2025-03-01'),100,'USD','2025-03-03');set constraints all immediate$$,'Later month ordinary income is not frozen by earlier FX-pending source');set constraints all deferred;
-- Explicit zero has no financial uncertainty to omit, even in another currency.
select pg_temp.set_jwt_subject(pg_temp.id(4));select is(auth.uid(),pg_temp.id(4),'Zero-share member');
select pg_temp.setup('2025-02-01');
select is(public.get_my_shared_responsibilities('2025-02-01')#>>'{entries,0,application_status}','NO_IMPACT','Foreign-currency zero share is visible but nonblocking');
select is(pg_temp.spent('2025-02-01'),0::numeric,'Exact zero needs no conversion');
select lives_ok($$select pg_temp.close('2025-02-01',130)$$,'Zero foreign responsibility does not block close');
-- Simulate a genuine pre-210 null row using trusted fixture-only mutation.
reset role;
alter table public.shared_expenses disable trigger shared_expenses_immutable;
update public.shared_expenses set budget_classification=null where id=pg_temp.id(60);
alter table public.shared_expenses enable trigger shared_expenses_immutable;
set local role authenticated;select pg_temp.set_jwt_subject(pg_temp.id(1));select is(current_user::text,'authenticated','Real role after legacy fixture');select is(auth.uid(),pg_temp.id(1),'Original actor legacy replay');
select lives_ok($$select pg_temp.expense(60,1000,null,'2025-02-03','UYU')$$,'Exact legacy null replay remains a read');
select throws_ok($$select pg_temp.expense(60,1000,'NEEDS','2025-02-03','UYU')$$,'23505',null,'Legacy replay cannot rewrite classification');
select pg_temp.set_jwt_subject(pg_temp.id(2));select is(auth.uid(),pg_temp.id(2),'B legacy responsibility');
select is(public.get_my_shared_responsibilities('2025-02-01')#>>'{entries,0,application_status}','UNCLASSIFIED','Legacy remains visible and explicitly unclassified');
select lives_ok($$select public.register_income(pg_temp.id(129),pg_temp.period('2025-02-01'),100,'USD','2025-02-04');set constraints all immediate$$,'Legacy null does not freeze ordinary income');set constraints all deferred;
select pg_temp.set_jwt_subject(pg_temp.id(4));select is(auth.uid(),pg_temp.id(4),'Zero-share member with legacy classification');
select pg_temp.reopen('2025-02-01',131);
select is(pg_temp.spent('2025-02-01'),0::numeric,'Zero legacy null does not block complete monetary consumption');
select lives_ok($$select pg_temp.close('2025-02-01',132)$$,'Zero null does not block closing');
-- Real pre-FIN-210 closure shapes: no source IDs/projection; v1 lacks carry.
select pg_temp.set_jwt_subject(pg_temp.id(2));select is(auth.uid(),pg_temp.id(2),'B historical close owner');
select pg_temp.setup('2025-04-01');select pg_temp.setup('2025-05-01');select pg_temp.setup('2025-06-01');
insert into evidence values ('pre210-v1',
  (public.get_personal_dashboard('2025-04-01')-'shared_expense_ids'-'shared_responsibilities'-'snapshot_version')
    #-'{availability,savings,snapshot_version}' #-'{availability,savings,carry}');
insert into evidence values ('pre210-v2',public.get_personal_dashboard('2025-05-01')-'shared_expense_ids'-'shared_responsibilities');
reset role;
insert into public.budget_period_closures(id,owner_profile_id,budget_period_id,expected_lifecycle_version,lifecycle_version,snapshot_hash,snapshot_version,summary,financial_timezone,closed_at)
 select pg_temp.id(case label when 'pre210-v1' then 200 else 201 end),pg_temp.id(2),(value#>>'{period,id}')::uuid,0,1,md5(value::text),case label when 'pre210-v1' then 1 else 2 end,value,'UTC','2025-07-01' from evidence where label in ('pre210-v1','pre210-v2');
update public.budget_periods set status='CLOSED',closed_at='2025-07-01',lifecycle_version=case when starts_on='2025-06-01' then 0 else 1 end
 where profile_id=pg_temp.id(2) and starts_on between '2025-04-01' and '2025-06-01';
update public.households set default_currency='USD' where id=pg_temp.id(20);
set local role authenticated;select pg_temp.set_jwt_subject(pg_temp.id(1));select is(current_user::text,'authenticated','Authenticated after trusted historical evidence fixture');select is(auth.uid(),pg_temp.id(1),'A new backdated sources');
select pg_temp.expense(202,400,'LEISURE','2025-04-02');select pg_temp.expense(203,400,'LEISURE','2025-05-02');select pg_temp.expense(204,400,'LEISURE','2025-06-02');
select pg_temp.set_jwt_subject(pg_temp.id(2));select is(auth.uid(),pg_temp.id(2),'B reads immutable pre210 evidence');
select is(public.get_personal_period_close_context('2025-04-01')->'summary',(select value from evidence where label='pre210-v1'),'v1 evidence stays byte-stable without new source fields');
select is(public.get_personal_period_close_context('2025-05-01')->'summary',(select value from evidence where label='pre210-v2'),'pre210 v2 evidence stays byte-stable');
select is(public.get_personal_period_close_context('2025-06-01')->'summary','null'::jsonb,'Legacy CLOSED without evidence is not reconstructed');
select is(pg_temp.spent(month),0::numeric,'Pre210 closed source stays excluded '||month) from unnest(array[date '2025-04-01',date '2025-05-01',date '2025-06-01']) month;
select is(public.get_my_shared_responsibilities(month)#>>'{entries,0,included_in_closed_period}','false','Historical close pending flag '||month) from unnest(array[date '2025-04-01',date '2025-05-01',date '2025-06-01']) month;
select pg_temp.reopen('2025-04-01',205);select pg_temp.reopen('2025-05-01',206);select pg_temp.reopen('2025-06-01',207);
select is(pg_temp.spent(month),100::numeric,'Explicit reopen applies each source exactly once '||month) from unnest(array[date '2025-04-01',date '2025-05-01',date '2025-06-01']) month;
-- Carry reversal consumes the destination's current own responsibility, not payer cash.
select pg_temp.setup('2025-07-01');select pg_temp.setup('2025-08-01');
select public.register_income(pg_temp.id(210),pg_temp.period('2025-07-01'),1000,'USD','2025-07-02');
select public.close_and_dispose_personal_remainder(pg_temp.id(211),pg_temp.period('2025-07-01'),0,public.get_personal_remainder_context('2025-07-01')->>'preview_hash','CARRY_UNALLOCATED',800,pg_temp.period('2025-08-01'),null,true);
insert into evidence values ('reverse-before',public.get_personal_carry_reversal_context(pg_temp.id(211)));
select pg_temp.set_jwt_subject(pg_temp.id(1));select is(auth.uid(),pg_temp.id(1),'A records destination source');select pg_temp.expense(212,400,'NEEDS','2025-08-02');
select pg_temp.set_jwt_subject(pg_temp.id(2));select is(auth.uid(),pg_temp.id(2),'B destination responsibility');
select is(public.get_personal_carry_reversal_context(pg_temp.id(211))->>'can_reverse','false','Shared responsibility consumes carried funds and blocks unsupported reversal');
select is(public.get_savings_availability(pg_temp.period('2025-08-01'))->>'spent_minor','100','Carry destination counts own share, not payer total');
select throws_ok($$select public.reverse_carry_and_reopen_personal_period(pg_temp.id(213),pg_temp.id(211),1,0,(select value->>'preview_hash' from evidence where label='reverse-before'),true)$$,'40001',null,'New shared destination source invalidates reviewed reversal hash');
reset role;update public.households set default_currency='UYU' where id=pg_temp.id(20);
set local role authenticated;select pg_temp.set_jwt_subject(pg_temp.id(1));select is(current_user::text,'authenticated','Authenticated for foreign carry source');select is(auth.uid(),pg_temp.id(1),'A foreign destination source');select pg_temp.expense(214,400,'NEEDS','2025-08-03','UYU');
select pg_temp.set_jwt_subject(pg_temp.id(2));select is(auth.uid(),pg_temp.id(2),'B incomplete destination');
select throws_ok($$select public.get_personal_carry_reversal_context(pg_temp.id(211))$$,'23514',null,'Foreign destination responsibility blocks partial reversal capacity');
select throws_ok($$select public.reverse_carry_and_reopen_personal_period(pg_temp.id(215),pg_temp.id(211),1,0,(select value->>'preview_hash' from evidence where label='reverse-before'),true)$$,'23514',null,'Foreign destination cannot be bypassed by a previously valid reversal request');
select is((select status from public.budget_periods where id=pg_temp.period('2025-07-01')),'CLOSED','Blocked reversal leaves source closed');
select is(public.get_personal_savings_context('2025-08-01')->'availability','null'::jsonb,'Savings context marks incomplete ordinary capacity');
select is(public.get_personal_savings_context('2025-08-01')#>>'{reserve,budget_period_id}',pg_temp.period('2025-08-01')::text,'Savings context retains authoritative protected reserve');
-- Multi-household responsibility and aggregate overflow retain exact original shares.
reset role;update public.households set default_currency='USD' where id=pg_temp.id(20);
insert into public.households(id,name,default_currency,created_by) values(pg_temp.id(21),'Other home','USD',pg_temp.id(1));
insert into public.household_members(id,household_id,profile_id,role,joined_at) values
 (pg_temp.id(70),pg_temp.id(21),pg_temp.id(1),'OWNER','2025-01-01'),(pg_temp.id(71),pg_temp.id(21),pg_temp.id(2),'MEMBER','2025-01-01');
set local role authenticated;select pg_temp.set_jwt_subject(pg_temp.id(1));select is(current_user::text,'authenticated','Authenticated after second-home fixture');select is(auth.uid(),pg_temp.id(1),'A owns second home');
select public.save_household_default_split(pg_temp.id(72),pg_temp.id(21),0,array[pg_temp.id(70),pg_temp.id(71)],jsonb_build_array(jsonb_build_object('member_id',pg_temp.id(70),'basis_points',5000),jsonb_build_object('member_id',pg_temp.id(71),'basis_points',5000)));
select pg_temp.expense(220,1001,'LEISURE','2025-09-02');
select public.create_shared_expense(pg_temp.id(221),pg_temp.id(21),pg_temp.id(70),pg_temp.id(72),1,array[pg_temp.id(70),pg_temp.id(71)],1001,'USD','2025-09-02',null,'LEISURE');
select pg_temp.set_jwt_subject(pg_temp.id(2));select is(auth.uid(),pg_temp.id(2),'B multi-home private owner');select pg_temp.setup('2025-09-01');
select is(pg_temp.spent('2025-09-01'),750::numeric,'Own 250 plus own rounded 500 across homes, never payer totals');
select is(jsonb_array_length(public.get_my_shared_responsibilities('2025-09-01')->'entries'),2,'Both home origins remain individually visible');
select pg_temp.setup('2025-10-01');
select pg_temp.set_jwt_subject(pg_temp.id(1));select is(auth.uid(),pg_temp.id(1),'A records supported source maxima');
select pg_temp.expense(n,9007199254740991,'LEISURE','2025-10-02') from generate_series(230,234)n;
select pg_temp.set_jwt_subject(pg_temp.id(2));select is(auth.uid(),pg_temp.id(2),'B aggregate bound');
select is(jsonb_array_length(public.get_my_shared_responsibilities('2025-10-01')->'entries'),5,'Original safe amounts remain visible even when total exceeds client range');
select throws_ok($$select pg_temp.spent('2025-10-01')$$,'22003',null,'Multi-source aggregate overflow never approximates or wraps');
select throws_ok($$select public.get_personal_dashboard('2025-10-01')$$,'22003',null,'Overflow propagates to dashboard');
-- Revocation cannot erase private history or open current shared data.
reset role;update public.household_members set left_at='2026-10-23' where id=pg_temp.id(41);
update public.households set name='Changed after departure' where id=pg_temp.id(20);
set local role authenticated;select pg_temp.set_jwt_subject(pg_temp.id(2));select is(current_user::text,'authenticated','Real revoked role');select is(auth.uid(),pg_temp.id(2),'Revoked B subject');
select is(public.get_my_shared_responsibilities('2025-01-01')#>>'{entries,0,responsibility_amount_minor}','250','Private own history survives departure');
select is(public.get_my_shared_responsibilities('2025-01-01')#>'{entries,0,household_name}','null'::jsonb,'No new current household name leaks after departure');
select throws_ok($$select public.get_shared_expense(pg_temp.id(20),pg_temp.id(50))$$,'42501',null,'Private source projection does not restore shared point access');
select throws_ok($$select public.list_shared_expenses(pg_temp.id(20))$$,'42501',null,'Private source projection does not restore shared history access');
select is(pg_temp.spent('2025-01-01'),400::numeric,'Own recorded closed impact survives membership change');
reset role;
set constraints all immediate;
select * from finish();
rollback;
