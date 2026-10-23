\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_catalog;
\ir helpers/auth.sql.inc
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
 select ('f2070000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.roster() returns uuid[] language sql immutable as $$
 select array[pg_temp.id(40),pg_temp.id(41),pg_temp.id(42)];
$$;
create function pg_temp.shares(a integer default 7000,b integer default 3000,c integer default 0) returns jsonb language sql immutable as $$
 select jsonb_build_array(jsonb_build_object('member_id',pg_temp.id(40),'basis_points',a),
 jsonb_build_object('member_id',pg_temp.id(41),'basis_points',b),jsonb_build_object('member_id',pg_temp.id(42),'basis_points',c));
$$;
create function pg_temp.create_expense(n integer,amount bigint default 101,payer integer default 41,template integer default 30,version integer default 1)
returns jsonb language sql as $$ select public.create_shared_expense(pg_temp.id(n),pg_temp.id(20),pg_temp.id(payer),
  pg_temp.id(template),version,pg_temp.roster(),amount,'USD','2025-01-02',null); $$;
create function pg_temp.personal_snapshot(n integer) returns jsonb language sql as $$
 select jsonb_build_object(
 'income',public.get_received_income(pg_temp.id(100+n)),
 'consumption',public.get_bucket_consumption(pg_temp.id(100+n)),
 'savings',public.get_savings_availability(pg_temp.id(100+n)),
 'goals',public.get_personal_savings_goals('2025-01-01'),
 'recurring',public.get_personal_recurring_month('2025-01-01'),
 'commitments',public.get_personal_committed_money(pg_temp.id(100+n)),
 'availability',public.get_personal_safe_to_spend(pg_temp.id(100+n)),
 'dashboard',public.get_personal_dashboard('2025-01-01'),
 'close',public.get_personal_period_close_context('2025-01-01'),
 'remainder',public.get_personal_remainder_context('2025-01-01'),
 'carry',public.get_personal_carry(pg_temp.id(100+n)));
$$;
create temp table before_personal(profile_id uuid primary key,value jsonb);
grant select,insert on before_personal to authenticated;
insert into auth.users(id,email) select pg_temp.id(n),'fin207-'||n||'@example.invalid' from generate_series(1,9)n;
insert into public.profiles(id,display_name,base_currency,timezone)
 select pg_temp.id(n),'Synthetic shared member '||n,'USD','UTC' from generate_series(1,8)n;
insert into public.households(id,name,default_currency,created_by) values
 (pg_temp.id(20),'Shared first','USD',pg_temp.id(5)),(pg_temp.id(21),'Separate second','UYU',pg_temp.id(2)),
 (pg_temp.id(22),'Unconfigured home','USD',pg_temp.id(1));
insert into public.household_members(id,household_id,profile_id,role,joined_at,left_at) values
 (pg_temp.id(40),pg_temp.id(20),pg_temp.id(1),'OWNER','2025-01-01',null),
 (pg_temp.id(41),pg_temp.id(20),pg_temp.id(2),'MEMBER','2025-01-01',null),
 (pg_temp.id(42),pg_temp.id(20),pg_temp.id(7),'MEMBER','2025-01-01',null),
 (pg_temp.id(43),pg_temp.id(20),pg_temp.id(4),'MEMBER','2025-01-01','2025-02-01'),
 (pg_temp.id(44),pg_temp.id(21),pg_temp.id(2),'OWNER','2025-01-01',null),
 (pg_temp.id(45),pg_temp.id(21),pg_temp.id(3),'MEMBER','2025-01-01',null),
 (pg_temp.id(46),pg_temp.id(22),pg_temp.id(1),'OWNER','2025-01-01',null);
-- Nonempty, distinguishable personal sources for actor A and payer/actor B.
insert into public.budget_periods(id,profile_id,starts_on,ends_on,base_currency)
 select pg_temp.id(100+n),pg_temp.id(n),'2025-01-01','2025-01-31','USD' from generate_series(1,2)n;
insert into public.budget_buckets(id,profile_id,name,type)
 select pg_temp.id(110+n),pg_temp.id(n),'Private bucket','SPENDABLE' from generate_series(1,2)n;
insert into public.categories(id,profile_id,name,budget_bucket_id)
 select pg_temp.id(120+n),pg_temp.id(n),'Private category',pg_temp.id(110+n) from generate_series(1,2)n;
insert into public.budget_allocations(budget_period_id,budget_bucket_id,percentage_basis_points)
 select pg_temp.id(100+n),pg_temp.id(110+n),10000 from generate_series(1,2)n;
insert into public.transactions(id,owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date)
 select pg_temp.id(130+n),pg_temp.id(n),pg_temp.id(100+n),'INCOME',10000*n,'USD','2025-01-01' from generate_series(1,2)n;
insert into public.transactions(id,owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date,category_id)
 select pg_temp.id(140+n),pg_temp.id(n),pg_temp.id(100+n),'EXPENSE',100*n,'USD','2025-01-02',pg_temp.id(120+n) from generate_series(1,2)n;
set constraints all immediate;
set constraints all deferred;

select ok(c.relrowsecurity,'RLS enabled: '||c.relname) from pg_class c where oid in ('public.shared_expenses'::regclass,'public.shared_expense_splits'::regclass);
select ok(not has_any_column_privilege(r,t,p),'No direct column '||r||' '||p||' on '||t)
 from unnest(array['anon','authenticated'])r cross join unnest(array['public.shared_expenses','public.shared_expense_splits'])t
 cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES'])p;
select ok(not has_table_privilege(r,t,p),'No direct table '||r||' '||p||' on '||t)
 from unnest(array['anon','authenticated'])r cross join unnest(array['public.shared_expenses','public.shared_expense_splits'])t
 cross join unnest(array['DELETE','TRUNCATE','TRIGGER'])p;
select ok(not has_column_privilege('authenticated','public.transactions',c,p),'No direct client scope/audit '||p||': '||c)
 from unnest(array['scope','household_id','created_by'])c cross join unnest(array['INSERT','UPDATE'])p;
select ok(not has_function_privilege('authenticated','public.check_shared_expense_integrity()','EXECUTE'),'Deferred integrity cannot be called as RPC');

set local role anon;select pg_temp.set_jwt_subject(null);
select is(current_user::text,'anon','Real anon');select is(auth.uid(),null::uuid,'No anonymous subject');
select throws_ok('select pg_temp.create_expense(50)','42501',null,'Anon cannot create');
select throws_ok('select public.get_shared_expense(pg_temp.id(20),pg_temp.id(50))','42501',null,'Anon cannot read');
reset role;
set local role authenticated;select pg_temp.set_jwt_subject(null);
select is(current_user::text,'authenticated','Real authenticated role');select is(auth.uid(),null::uuid,'Missing authenticated subject');
select throws_ok('select pg_temp.create_expense(50)','42501',null,'Missing identity cannot create');
select throws_ok('select public.get_shared_expense(pg_temp.id(20),pg_temp.id(50))','42501',null,'Missing identity cannot read');
select pg_temp.set_jwt_subject(pg_temp.id(1));select is(auth.uid(),pg_temp.id(1),'Active A OWNER');
insert into before_personal values(auth.uid(),pg_temp.personal_snapshot(1));
select throws_ok('select pg_temp.create_expense(50)','40001',null,'Unconfigured never invents a default');
select public.save_household_default_split(pg_temp.id(30),pg_temp.id(20),0,pg_temp.roster(),pg_temp.shares());
select lives_ok('select pg_temp.create_expense(50)','OWNER creates shared trio');
select lives_ok('set constraints all immediate','Deferred shared checks run after definer under authenticated role');set constraints all deferred;
select is(pg_temp.create_expense(50),public.get_shared_expense(pg_temp.id(20),pg_temp.id(50)),'Exact request replay returns historical receipt');
select is(pg_temp.create_expense(50)->>'created_by',pg_temp.id(1)::text,'Actor is provenance, not fake transaction owner');
select is(pg_temp.create_expense(50)->>'payer_member_id',pg_temp.id(41)::text,'Payer differs from creator');
select is(pg_temp.create_expense(50)#>>'{splits,0,responsibility_amount_minor}','71','Largest remainder awards residual exactly');
select is(pg_temp.create_expense(50)#>>'{splits,1,responsibility_amount_minor}','30','Payer responsibility is not total paid');
select is(pg_temp.create_expense(50)#>>'{splits,2,responsibility_amount_minor}','0','Zero responsibility remains explicit');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.create_expense(50))k),
 array['amount_minor','created_by','currency','description','expense_id','household_id','payer_member_id','profile_id','splits','template_id','template_version','transaction_date','transaction_id'],'Exact minimized projection: no private periods, preferences or categories');
select is((select count(*) from public.transactions where id=pg_temp.id(50)),0::bigint,'Even author cannot expose shared through personal transaction API');
select is(pg_temp.personal_snapshot(1),(select value from before_personal where profile_id=auth.uid()),'All personal reads unchanged by shared creation');
select throws_ok('select pg_temp.create_expense(50,102)','23505',null,'Changed amount cannot reuse identity');
select throws_ok('select pg_temp.create_expense(50,101,40)','23505',null,'Changed payer cannot reuse identity');
select throws_ok('select pg_temp.create_expense(50,101,41,31,2)','23505',null,'Changed template cannot reuse identity');
select throws_ok($$select public.create_shared_expense(pg_temp.id(50),pg_temp.id(20),pg_temp.id(41),pg_temp.id(30),1,pg_temp.roster(),101,'UYU','2025-01-02')$$,'23505',null,'Currency replay mismatch');
select throws_ok($$select public.create_shared_expense(pg_temp.id(50),pg_temp.id(20),pg_temp.id(41),pg_temp.id(30),1,pg_temp.roster(),101,'USD','2025-01-03')$$,'23505',null,'Date replay mismatch');
select throws_ok($$select public.create_shared_expense(pg_temp.id(50),pg_temp.id(20),pg_temp.id(41),pg_temp.id(30),1,pg_temp.roster(),101,'USD','2025-01-02','')$$,'23505',null,'Null and empty original description differ');
select throws_ok('select pg_temp.create_expense(60,0)','22023',null,'Zero total denied');
select throws_ok('select pg_temp.create_expense(60,-1)','22023',null,'Negative total denied');
select throws_ok('select pg_temp.create_expense(60,9007199254740992)','22023',null,'Unsafe total denied');
select throws_ok('select pg_temp.create_expense(60,1,45)','42501',null,'Foreign household payer denied');
select throws_ok('select pg_temp.create_expense(60,1,43)','42501',null,'Inactive same-household payer denied');
select throws_ok($$select public.create_shared_expense(pg_temp.id(60),pg_temp.id(20),pg_temp.id(41),pg_temp.id(30),1,array[pg_temp.id(40),pg_temp.id(41)],101,'USD','2025-01-02')$$,'40001',null,'Zero share cannot be omitted from request roster');
select throws_ok($$select public.create_shared_expense(pg_temp.id(60),pg_temp.id(20),pg_temp.id(41),pg_temp.id(30),1,array[pg_temp.id(40),pg_temp.id(41),pg_temp.id(41)],101,'USD','2025-01-02')$$,'22023',null,'Duplicate roster denied');
select throws_ok($$select public.create_shared_expense(pg_temp.id(60),pg_temp.id(20),pg_temp.id(41),pg_temp.id(30),1,array[pg_temp.id(40),pg_temp.id(41),pg_temp.id(45)],101,'USD','2025-01-02')$$,'40001',null,'Overlapping homes never authorize foreign responsibility');
select throws_ok($$select public.correct_personal_transaction(pg_temp.id(60),pg_temp.id(50),0,'DELETE','{}',true)$$,'42501',null,'Personal correction path cannot mutate shared');
select is(pg_temp.create_expense(51,9007199254740991)->>'amount_minor','9007199254740991','MAX_SAFE_INTEGER supported without overflow');
select is(pg_temp.create_expense(52,1)->'splits'->0->>'responsibility_amount_minor','1','Sub-cent responsibility uses exact deterministic unit');
select public.save_household_default_split(pg_temp.id(32),pg_temp.id(20),1,pg_temp.roster(),pg_temp.shares(5000,5000,0));
select throws_ok('select pg_temp.create_expense(60)','40001',null,'Old version cannot silently select current default');
select is(pg_temp.create_expense(50)#>>'{splits,0,responsibility_amount_minor}','71','Old exact replay preserves original percentages after default change');
select is(pg_temp.create_expense(53,1,41,32,2)#>>'{splits,0,responsibility_amount_minor}','1','Equal remainder goes to lowest canonical membership UUID');
select is(pg_temp.create_expense(53,1,41,32,2)#>>'{splits,1,responsibility_amount_minor}','0','Tie does not prefer payer');
select is(public.create_shared_expense(pg_temp.id(54),pg_temp.id(20),pg_temp.id(40),pg_temp.id(32),2,
 array[pg_temp.id(42),pg_temp.id(41),pg_temp.id(40)],1,'UYU','2025-01-02','Original amount'),
 public.create_shared_expense(pg_temp.id(54),pg_temp.id(20),pg_temp.id(40),pg_temp.id(32),2,
 pg_temp.roster(),1,'UYU','2025-01-02','Original amount'),'Original currency preserved without conversion; canonical roster retry');
select is(pg_temp.personal_snapshot(1),(select value from before_personal where profile_id=auth.uid()),'Even different original shared currency never changes personal USD numbers');
select pg_temp.set_jwt_subject(pg_temp.id(2));select is(auth.uid(),pg_temp.id(2),'Active MEMBER B in both households');
insert into before_personal values(auth.uid(),pg_temp.personal_snapshot(2));
select is(public.get_shared_expense(pg_temp.id(20),pg_temp.id(50))->>'profile_id',pg_temp.id(2)::text,'MEMBER can read authorized expense');
select throws_ok('select pg_temp.create_expense(50)','23505',null,'Different actor cannot claim original request');
select lives_ok('select pg_temp.create_expense(55,1000,40,32,2)','MEMBER may create, independently of OWNER template permission');
select is(pg_temp.personal_snapshot(2),(select value from before_personal where profile_id=auth.uid()),'Payer and second creator personal reads remain unchanged');
select is((select count(*) from public.transactions),2::bigint,'Personal API contains only own personal nonempty fixture');
select is((select count(*) from public.profiles),1::bigint,'No partner private Profile exposure');
select throws_ok('select public.get_shared_expense(pg_temp.id(21),pg_temp.id(50))','42501',null,'Second home authorization does not relabel first-home expense');
select public.save_household_default_split(pg_temp.id(31),pg_temp.id(21),0,array[pg_temp.id(44),pg_temp.id(45)],
 jsonb_build_array(jsonb_build_object('member_id',pg_temp.id(44),'basis_points',10000),jsonb_build_object('member_id',pg_temp.id(45),'basis_points',0)));
select lives_ok($$select public.create_shared_expense(pg_temp.id(56),pg_temp.id(21),pg_temp.id(44),pg_temp.id(31),1,array[pg_temp.id(44),pg_temp.id(45)],10,'UYU','2025-01-02')$$,'Overlapping member creates separately scoped second-home expense');
select throws_ok($$select public.create_shared_expense(pg_temp.id(50),pg_temp.id(21),pg_temp.id(44),pg_temp.id(31),1,array[pg_temp.id(44),pg_temp.id(45)],10,'UYU','2025-01-02')$$,'23505',null,'Request identity cannot cross households');
select pg_temp.set_jwt_subject(pg_temp.id(3));select is(auth.uid(),pg_temp.id(3),'C is outsider to first, member of second');
select throws_ok('select public.get_shared_expense(pg_temp.id(20),pg_temp.id(50))','42501',null,'C cannot read via overlapping B');
select throws_ok('select pg_temp.create_expense(60,1,41,32,2)','42501',null,'C cannot create via overlapping B');
select lives_ok('select public.get_shared_expense(pg_temp.id(21),pg_temp.id(56))','C can read its own second home');
select pg_temp.set_jwt_subject(pg_temp.id(4));select is(auth.uid(),pg_temp.id(4),'Inactive member');
select throws_ok('select public.get_shared_expense(pg_temp.id(20),pg_temp.id(50))','42501',null,'Inactive member cannot read');
select throws_ok('select pg_temp.create_expense(60,1,41,32,2)','42501',null,'Inactive member cannot create');
select pg_temp.set_jwt_subject(pg_temp.id(5));select is(auth.uid(),pg_temp.id(5),'Creator-only metadata');
select throws_ok('select public.get_shared_expense(pg_temp.id(20),pg_temp.id(50))','42501',null,'Creator metadata cannot read');
select pg_temp.set_jwt_subject(pg_temp.id(9));select is(auth.uid(),pg_temp.id(9),'No Profile');
select throws_ok('select pg_temp.create_expense(60,1,41,32,2)','42501',null,'Missing Profile cannot create');
reset role;
select is((select count(*) from public.shared_expenses),7::bigint,'Replays and denied attempts create no duplicate header');
select is((select count(*) from public.shared_expense_splits),20::bigint,'Every expense has its full historical roster');
select ok((select bool_and(owner_profile_id is null and budget_period_id is null and category_id is null and created_by is not null and household_id is not null) from public.transactions where scope='HOUSEHOLD'),'No invented personal ownership, period or category');
select is((select count(*) from public.transaction_revisions),0::bigint,'Shared creation does not produce personal correction audit');
select is((select sum(responsibility_amount_minor) from public.shared_expense_splits where shared_expense_id=pg_temp.id(51)),9007199254740991::numeric,'MAX_SAFE_INTEGER exact conservation in SQL');

-- Demonstrate full rollback if the final dependent write fails, not only input validation.
create function pg_temp.reject_shared_split() returns trigger language plpgsql as $$begin raise exception 'Synthetic final-write rejection' using errcode='P2071';end;$$;
create trigger reject_shared_split before insert on public.shared_expense_splits for each row execute function pg_temp.reject_shared_split();
set local role authenticated;select pg_temp.set_jwt_subject(pg_temp.id(1));
select is(current_user::text,'authenticated','Atomic failure uses real authenticated role');select is(auth.uid(),pg_temp.id(1),'Atomic actor');
select throws_ok('select pg_temp.create_expense(60,101,41,32,2)','P2071',null,'Injected dependent split failure aborts RPC');
reset role;
drop trigger reject_shared_split on public.shared_expense_splits;
select is((select count(*) from public.transactions where id=pg_temp.id(60)),0::bigint,'Failure rolls back transaction');
select is((select count(*) from public.shared_expenses where id=pg_temp.id(60)),0::bigint,'Failure rolls back header');
select is((select count(*) from public.shared_expense_splits where shared_expense_id=pg_temp.id(60)),0::bigint,'Failure rolls back all splits');
select throws_ok($$update public.shared_expenses set payer_member_id=pg_temp.id(40) where id=pg_temp.id(50)$$,'23514',null,'Snapshot header immutable even for trusted writes');
select throws_ok($$update public.shared_expense_splits set responsibility_amount_minor=0 where shared_expense_id=pg_temp.id(50)$$,'23514',null,'Historical responsibility immutable');
select throws_ok($$update public.transactions set amount_minor=102 where id=pg_temp.id(50)$$,'23514',null,'Shared monetary row immutable until FIN-220');
select throws_ok($$update public.transactions set household_id=pg_temp.id(21) where id=pg_temp.id(50)$$,'23514',null,'Scope identity cannot move');
select throws_ok($$insert into public.transactions(id,scope,type,household_id,created_by,amount_minor,currency,transaction_date,owner_profile_id)
 values(pg_temp.id(61),'HOUSEHOLD','EXPENSE',pg_temp.id(20),pg_temp.id(1),1,'USD','2025-01-02',pg_temp.id(1))$$,'23514',null,'HOUSEHOLD cannot carry a fake personal owner');
select throws_ok($$insert into public.transactions(id,scope,type,household_id,created_by,amount_minor,currency,transaction_date,budget_period_id)
 values(pg_temp.id(61),'HOUSEHOLD','EXPENSE',pg_temp.id(20),pg_temp.id(1),1,'USD','2025-01-02',pg_temp.id(101))$$,'23514',null,'HOUSEHOLD cannot enter a personal budget period');
select throws_ok($$insert into public.transactions(id,scope,type,household_id,created_by,amount_minor,currency,transaction_date,category_id)
 values(pg_temp.id(61),'HOUSEHOLD','EXPENSE',pg_temp.id(20),pg_temp.id(1),1,'USD','2025-01-02',pg_temp.id(121))$$,'23514',null,'HOUSEHOLD cannot reference a private category');
select throws_ok($$insert into public.shared_expense_splits(shared_expense_id,household_id,member_id,basis_points,responsibility_amount_minor)
 values(pg_temp.id(50),pg_temp.id(21),pg_temp.id(45),0,0)$$,'23503',null,'Composite FK rejects forged expense household link');
select throws_ok($$insert into public.shared_expense_splits(shared_expense_id,household_id,member_id,basis_points,responsibility_amount_minor)
 values(pg_temp.id(50),pg_temp.id(20),pg_temp.id(45),0,0)$$,'23503',null,'Composite FK rejects forged split membership link');
-- Force deferred checks inside a caught subtransaction; each malformed set rolls back.
select throws_ok($$insert into public.transactions(id,scope,type,household_id,created_by,amount_minor,currency,transaction_date)
 values(pg_temp.id(61),'HOUSEHOLD','EXPENSE',pg_temp.id(20),pg_temp.id(1),1,'USD','2025-01-02');set constraints all immediate$$,'23514',null,'Orphan HOUSEHOLD transaction cannot commit');
select throws_ok($$delete from public.shared_expense_splits where shared_expense_id=pg_temp.id(50) and member_id=pg_temp.id(42);set constraints all immediate$$,'23514',null,'Even deleting zero responsibility violates historical completeness');
select throws_ok($$delete from public.shared_expense_splits where shared_expense_id=pg_temp.id(50);delete from public.shared_expenses where id=pg_temp.id(50);set constraints all immediate$$,'23514',null,'Removing linked header cannot leave orphan transaction');

-- Defend historical mathematics even against a malformed trusted multi-row writer.
create function pg_temp.forge_trio(mode text) returns void language plpgsql as $$
begin
  insert into public.transactions(id,scope,type,household_id,created_by,amount_minor,currency,transaction_date)
    values(pg_temp.id(61),'HOUSEHOLD','EXPENSE',pg_temp.id(20),
      case when mode='wrong_actor' then pg_temp.id(4) else pg_temp.id(1) end,101,'USD','2025-01-02');
  insert into public.shared_expenses(id,household_id,transaction_id,payer_member_id,template_id,template_version)
    values(case when mode='wrong_link' then pg_temp.id(62) else pg_temp.id(61) end,pg_temp.id(20),pg_temp.id(61),
      case when mode='wrong_payer' then pg_temp.id(43) else pg_temp.id(41) end,
      case when mode='foreign_template' then pg_temp.id(31) else pg_temp.id(30) end,
      case when mode='wrong_version' then 2 else 1 end);
  insert into public.shared_expense_splits(shared_expense_id,household_id,member_id,basis_points,responsibility_amount_minor)
    select pg_temp.id(61),household_id,member_id,
      case when mode='wrong_percentages' and member_id=pg_temp.id(40) then 6000
        when mode='wrong_percentages' and member_id=pg_temp.id(41) then 4000 else basis_points end,
      case when mode='wrong_total' and member_id=pg_temp.id(40) then responsibility_amount_minor+1
        when mode='wrong_rounding' and member_id=pg_temp.id(40) then 70
        when mode='wrong_rounding' and member_id=pg_temp.id(41) then 31 else responsibility_amount_minor end
      from public.shared_expense_splits where shared_expense_id=pg_temp.id(50);
  set constraints all immediate;
end;
$$;
select throws_ok(format('select pg_temp.forge_trio(%L)',mode),'23514',null,'Deferred integrity rejects '||mode)
 from unnest(array['wrong_actor','wrong_payer','wrong_link','wrong_total','wrong_rounding','wrong_percentages'])mode;
select throws_ok(format('select pg_temp.forge_trio(%L)',mode),'23503',null,'Same-household/version linkage rejects '||mode)
 from unnest(array['foreign_template','wrong_version'])mode;
select is((select count(*) from public.transactions where id=pg_temp.id(61)),0::bigint,'Malformed trusted trios leave no partial source');
-- Private records cannot be fetched just by presenting an authorized household.
set local role authenticated;select pg_temp.set_jwt_subject(pg_temp.id(1));
select is(current_user::text,'authenticated','Shared lookup isolation role');select is(auth.uid(),pg_temp.id(1),'Shared lookup isolation subject');
select throws_ok('select public.get_shared_expense(pg_temp.id(20),pg_temp.id(131))','42501',null,'Shared endpoint never returns even caller-owned personal record');
select throws_ok('select public.get_shared_expense(pg_temp.id(20),pg_temp.id(132))','42501',null,'Shared endpoint never returns partner personal record');
reset role;

-- Separate privilege denial from independent RLS denial with temporary test-only grants.
set local role authenticated;select pg_temp.set_jwt_subject(pg_temp.id(1));
select is(current_user::text,'authenticated','Forged writes use authenticated role');select is(auth.uid(),pg_temp.id(1),'Active member forged writes');
select throws_ok('select * from public.shared_expenses','42501',null,'Direct raw header SQL privilege denied');
select throws_ok('select * from public.shared_expense_splits','42501',null,'Direct raw responsibility SQL privilege denied');
select throws_ok($$insert into public.transactions(id,scope,type,household_id,created_by,amount_minor,currency,transaction_date)
 values(pg_temp.id(61),'HOUSEHOLD','EXPENSE',pg_temp.id(20),pg_temp.id(1),1,'USD','2025-01-02')$$,'42501',null,'Direct shared insert SQL privilege denied');
with changed as(update public.transactions set description='forged' where id=pg_temp.id(50) returning id)
 select is((select count(*) from changed),0::bigint,'Personal UPDATE RLS cannot see shared row');
reset role;
grant select,insert,update,delete on public.shared_expenses,public.shared_expense_splits to authenticated;
grant insert(scope,household_id,created_by) on public.transactions to authenticated;
set local role authenticated;select pg_temp.set_jwt_subject(pg_temp.id(1));
select is(current_user::text,'authenticated','Independent RLS test role');select is(auth.uid(),pg_temp.id(1),'Independent RLS subject');
select throws_ok($$insert into public.transactions(id,scope,type,household_id,created_by,amount_minor,currency,transaction_date)
 values(pg_temp.id(61),'HOUSEHOLD','EXPENSE',pg_temp.id(20),pg_temp.id(1),1,'USD','2025-01-02')$$,'42501',null,'Personal INSERT RLS rejects HOUSEHOLD even with temporary test-only column grants');
select is((select count(*) from public.shared_expenses),0::bigint,'Default-deny header RLS independent of grants');
select is((select count(*) from public.shared_expense_splits),0::bigint,'Default-deny split RLS independent of grants');
select throws_ok($$insert into public.shared_expenses(id,household_id,transaction_id,payer_member_id,template_id,template_version)
 values(pg_temp.id(61),pg_temp.id(20),pg_temp.id(61),pg_temp.id(41),pg_temp.id(32),2)$$,'42501',null,'Header RLS WITH CHECK denies forged writes');
select throws_ok($$insert into public.shared_expense_splits(shared_expense_id,household_id,member_id,basis_points,responsibility_amount_minor)
 values(pg_temp.id(50),pg_temp.id(20),pg_temp.id(43),0,0)$$,'42501',null,'Split RLS WITH CHECK denies forged writes');
with changed as(update public.shared_expenses set payer_member_id=pg_temp.id(40) returning id)
 select is((select count(*) from changed),0::bigint,'Header RLS filters UPDATE');
with changed as(update public.shared_expense_splits set basis_points=0 returning member_id)
 select is((select count(*) from changed),0::bigint,'Split RLS filters UPDATE');
with gone as(delete from public.shared_expenses returning id) select is((select count(*) from gone),0::bigint,'Header RLS filters DELETE');
with gone as(delete from public.shared_expense_splits returning member_id) select is((select count(*) from gone),0::bigint,'Split RLS filters DELETE');
reset role;
revoke all on public.shared_expenses,public.shared_expense_splits from authenticated;
revoke insert(scope,household_id,created_by) on public.transactions from authenticated;
-- Current access, not historical authorship or responsibility, controls read/replay.
update public.household_members set left_at=clock_timestamp() where id=pg_temp.id(41);
set local role authenticated;select pg_temp.set_jwt_subject(pg_temp.id(1));
select is(current_user::text,'authenticated','Active read after payer departure');select is(auth.uid(),pg_temp.id(1),'Active actor');
select is(pg_temp.create_expense(50)->>'payer_member_id',pg_temp.id(41)::text,'Exact actor replay retains departed payer history without new expense');
select throws_ok('select pg_temp.create_expense(60,101,40,32,2)','40001',null,'New expense rejects now-stale roster');
select pg_temp.set_jwt_subject(pg_temp.id(2));select is(auth.uid(),pg_temp.id(2),'Departed payer and creator');
select throws_ok('select public.get_shared_expense(pg_temp.id(20),pg_temp.id(50))','42501',null,'Departed payer loses read immediately');
select throws_ok('select pg_temp.create_expense(55,1000,40,32,2)','42501',null,'Departed creator cannot replay receipt');
reset role;
select is((select count(*) from public.shared_expenses),7::bigint,'Lifecycle changes/rejections do not rewrite history');
select lives_ok('set constraints all immediate','All final historical trios retain exact integrity');
select * from finish();
rollback;
