\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_catalog;
\ir helpers/auth.sql.inc
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
 select ('f2090000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.history(cursor_id integer default null,page_size integer default 20) returns jsonb language sql as $$
 select public.list_shared_expenses(pg_temp.id(20),pg_temp.id(cursor_id),page_size);
$$;
create function pg_temp.create_expense(n integer,day date default '2025-01-02',money text default 'USD',revision integer default 30,version integer default 1) returns jsonb language sql as $$
 select public.create_shared_expense(pg_temp.id(n),pg_temp.id(20),pg_temp.id(41),pg_temp.id(revision),version,
 array[pg_temp.id(40),pg_temp.id(41),pg_temp.id(42)],101,money,day,'Shared history '||n,'NEEDS');
$$;
insert into auth.users(id,email) select pg_temp.id(n),'fin209-'||n||'@example.invalid' from generate_series(1,5)n;
insert into public.profiles(id,display_name,base_currency,timezone) select pg_temp.id(n),'History member '||n,'UYU','UTC' from generate_series(1,5)n;
insert into public.households(id,name,default_currency,created_by) values
 (pg_temp.id(20),'History home','USD',pg_temp.id(1)),(pg_temp.id(21),'Other home','USD',pg_temp.id(2)),(pg_temp.id(22),'Empty home','USD',pg_temp.id(1));
insert into public.household_members(id,household_id,profile_id,role,joined_at) values
 (pg_temp.id(40),pg_temp.id(20),pg_temp.id(1),'OWNER','2025-01-01'),
 (pg_temp.id(41),pg_temp.id(20),pg_temp.id(2),'MEMBER','2025-01-01'),
 (pg_temp.id(42),pg_temp.id(20),pg_temp.id(4),'MEMBER','2025-01-01'),
 (pg_temp.id(43),pg_temp.id(21),pg_temp.id(2),'OWNER','2025-01-01'),
 (pg_temp.id(44),pg_temp.id(21),pg_temp.id(3),'MEMBER','2025-01-01'),
 (pg_temp.id(45),pg_temp.id(22),pg_temp.id(1),'OWNER','2025-01-01');
-- Nonempty distinguishable private finances must not appear in a history page.
insert into public.budget_periods(id,profile_id,starts_on,ends_on,base_currency)
 select pg_temp.id(200+n),pg_temp.id(n),'2025-01-01','2025-01-31','UYU' from generate_series(1,3)n;
insert into public.transactions(id,owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date,description)
 select pg_temp.id(210+n),pg_temp.id(n),pg_temp.id(200+n),'INCOME',10000*n,'UYU','2025-01-31','PRIVATE SALARY '||n from generate_series(1,3)n;
set constraints all immediate;set constraints all deferred;

select ok(has_function_privilege('authenticated','public.list_shared_expenses(uuid,uuid,integer)','EXECUTE'),'Only authenticated RPC capability');
select ok(not has_function_privilege('anon','public.list_shared_expenses(uuid,uuid,integer)','EXECUTE'),'Anon has no RPC capability');
select ok(not has_any_column_privilege(role_name,table_name,privilege),'No added direct '||role_name||' '||privilege||' '||table_name)
 from unnest(array['anon','authenticated'])role_name cross join unnest(array['public.shared_expenses','public.shared_expense_splits'])table_name
 cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES'])privilege;
select ok(not has_table_privilege('authenticated',table_name,privilege),'No direct destructive write '||privilege||' '||table_name)
 from unnest(array['public.shared_expenses','public.shared_expense_splits'])table_name cross join unnest(array['DELETE','TRUNCATE','TRIGGER'])privilege;
select is((select provolatile::text from pg_proc where oid='public.list_shared_expenses(uuid,uuid,integer)'::regprocedure),'s','One stable statement snapshot');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='public.list_shared_expenses(uuid,uuid,integer)'::regprocedure),'Reviewed narrow definer with empty search path');

set local role anon;select pg_temp.set_jwt_subject(null);
select is(current_user::text,'anon','Real anonymous role');select is(auth.uid(),null::uuid,'Anonymous identity');
select throws_ok('select pg_temp.history()','42501',null,'Anonymous list denied');
select throws_ok('select public.get_shared_expense_history_detail(pg_temp.id(20),pg_temp.id(99))','42501',null,'Anonymous history detail denied');
reset role;
set local role authenticated;select pg_temp.set_jwt_subject(null);
select is(current_user::text,'authenticated','Real authenticated role');select is(auth.uid(),null::uuid,'Missing JWT identity');
select throws_ok('select pg_temp.history()','42501',null,'Missing identity denied');
select throws_ok('select public.get_shared_expense_history_detail(pg_temp.id(20),pg_temp.id(99))','42501',null,'Missing identity history detail denied');
select pg_temp.set_jwt_subject(pg_temp.id(1));select is(auth.uid(),pg_temp.id(1),'A owner identity');
select is(pg_temp.history()->'expenses','[]'::jsonb,'Authorized empty page is explicit');
select is(pg_temp.history()->'next_cursor','null'::jsonb,'Empty page has no continuation');
select public.save_household_default_split(pg_temp.id(30),pg_temp.id(20),0,array[pg_temp.id(40),pg_temp.id(41),pg_temp.id(42)],
 jsonb_build_array(jsonb_build_object('member_id',pg_temp.id(40),'basis_points',7000),jsonb_build_object('member_id',pg_temp.id(41),'basis_points',3000),jsonb_build_object('member_id',pg_temp.id(42),'basis_points',0)));
select pg_temp.create_expense(n) from generate_series(100,120)n;
select pg_temp.create_expense(121,'2024-12-31');
select pg_temp.create_expense(99,'2025-01-03');
set constraints all immediate;set constraints all deferred;
select is(jsonb_array_length(pg_temp.history()->'expenses'),20,'Default page is bounded at 20');
select is(pg_temp.history()#>>'{expenses,0,expense_id}',pg_temp.id(99)::text,'Financial date orders before UUID');
select is(pg_temp.history()#>>'{expenses,1,expense_id}',pg_temp.id(120)::text,'Equal financial dates break ties by UUID descending');
select is(pg_temp.history()->>'next_cursor',pg_temp.id(102)::text,'Cursor identifies last returned row, not lookahead');
select is(jsonb_array_length(pg_temp.history(102)->'expenses'),3,'Next page contains only remaining records');
select is(pg_temp.history(102)#>>'{expenses,0,expense_id}',pg_temp.id(101)::text,'Boundary excludes cursor exactly');
select is(pg_temp.history(102)#>>'{expenses,2,expense_id}',pg_temp.id(121)::text,'Older financial date sorts after tie group');
select is(pg_temp.history(102)->'next_cursor','null'::jsonb,'Final partial page has no cursor');
select is(pg_temp.history(121)->'expenses','[]'::jsonb,'Cursor after final row returns explicit empty');
select is(pg_temp.history(null,23)->'next_cursor','null'::jsonb,'Exact full terminal page has no false continuation');
select is(pg_temp.history(null,1)->>'next_cursor',pg_temp.id(99)::text,'One-item page supported');
select is(jsonb_array_length(pg_temp.history(null,50)->'expenses'),23,'Maximum allowed page retains every row');
select throws_ok('select pg_temp.history(null,0)','22023',null,'Zero limit denied');
select throws_ok('select pg_temp.history(null,51)','22023',null,'Oversized limit denied');
select throws_ok('select pg_temp.history(null,null)','22023',null,'Null limit denied');
select throws_ok($$select public.list_shared_expenses(pg_temp.id(20),'malformed')$$,'22P02',null,'Malformed UUID denied before lookup');
select throws_ok('select pg_temp.history(999)','22023','Invalid household history cursor','Missing cursor generic failure');
select throws_ok('select pg_temp.history(211)','22023','Invalid household history cursor','Private transaction cursor gives same generic failure');
select throws_ok('select public.list_shared_expenses(null)','42501',null,'Missing household is not authorized');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.history())k),
 array['expenses','household_id','members','next_cursor','profile_id'],'Exact page projection contains no aggregates or private fields');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.history()#>'{expenses,0}')k),
 array['amount_minor','budget_classification','created_by','currency','description','expense_id','household_id','payer_member_id','profile_id','splits','template_id','template_version','transaction_date','transaction_id'],'Exact receipt projection excludes private budget, category, salary, owner and preferences');
select is(pg_temp.history()#>'{expenses,0}',public.get_shared_expense(pg_temp.id(20),pg_temp.id(99)),'List reuses point-read source exactly');
select is(pg_temp.history()#>>'{expenses,0,splits,0,responsibility_amount_minor}','71','History shows stored rounded responsibility');
select is(pg_temp.history()#>>'{expenses,0,payer_member_id}',pg_temp.id(41)::text,'Payer stays independent of 70-percent member');
select is((select count(*) from public.transactions),1::bigint,'Direct transaction RLS still returns only own personal row');
select is((select count(*) from public.profiles),1::bigint,'Names/private Profile access is not broadened');
select throws_ok('select * from public.shared_expenses','42501',null,'Direct header SELECT denied');
select throws_ok('select * from public.shared_expense_splits','42501',null,'Direct responsibility SELECT denied');
select throws_ok('update public.shared_expenses set payer_member_id=pg_temp.id(40)','42501',null,'History grants no mutation');
select throws_ok('delete from public.shared_expense_splits','42501',null,'History grants no deletion');
select throws_ok($$insert into public.shared_expenses(id,household_id,transaction_id,payer_member_id,template_id,template_version) values(pg_temp.id(999),pg_temp.id(20),pg_temp.id(999),pg_temp.id(40),pg_temp.id(30),1)$$,'42501',null,'Forged header write denied');
select pg_temp.set_jwt_subject(pg_temp.id(2));select is(auth.uid(),pg_temp.id(2),'B active member in overlapping homes');
select is(pg_temp.history()->>'profile_id',pg_temp.id(2)::text,'B has own authorized response identity');
select is(jsonb_array_length(pg_temp.history()->'expenses'),20,'B can read A household records');
select is((select description from public.transactions),'PRIVATE SALARY 2','B personal API cannot expose A salary');
select public.save_household_default_split(pg_temp.id(31),pg_temp.id(21),0,array[pg_temp.id(43),pg_temp.id(44)],
 jsonb_build_array(jsonb_build_object('member_id',pg_temp.id(43),'basis_points',5000),jsonb_build_object('member_id',pg_temp.id(44),'basis_points',5000)));
select public.create_shared_expense(pg_temp.id(150),pg_temp.id(21),pg_temp.id(44),pg_temp.id(31),1,array[pg_temp.id(43),pg_temp.id(44)],200,'USD','2025-01-03',null,'NEEDS');
select throws_ok('select pg_temp.history(150)','22023','Invalid household history cursor','Foreign cursor matches nonexistent/private error without enumeration');
select is(jsonb_array_length(public.list_shared_expenses(pg_temp.id(21))->'expenses'),1,'Overlapping B reads second home separately');
select pg_temp.set_jwt_subject(pg_temp.id(3));select is(auth.uid(),pg_temp.id(3),'C outsider to first, active in second');
select throws_ok('select pg_temp.history()','42501',null,'Overlap is not transitive authorization');
select throws_ok('select public.get_shared_expense_history_detail(pg_temp.id(20),pg_temp.id(99))','42501',null,'Overlapping C cannot read detail');
select throws_ok('select pg_temp.history(999,0)','42501',null,'Authorization precedes cursor/limit validation');
select lives_ok('select public.list_shared_expenses(pg_temp.id(21))','C reads only authorized home');
select pg_temp.set_jwt_subject(pg_temp.id(5));select is(auth.uid(),pg_temp.id(5),'Unrelated user');
select throws_ok('select pg_temp.history()','42501',null,'Unrelated user denied');
select pg_temp.set_jwt_subject(pg_temp.id(1));select is(auth.uid(),pg_temp.id(1),'A before default/currency/roster changes');
select public.save_household_default_split(pg_temp.id(32),pg_temp.id(20),1,array[pg_temp.id(40),pg_temp.id(41),pg_temp.id(42)],
 jsonb_build_array(jsonb_build_object('member_id',pg_temp.id(40),'basis_points',1000),jsonb_build_object('member_id',pg_temp.id(41),'basis_points',9000),jsonb_build_object('member_id',pg_temp.id(42),'basis_points',0)));
reset role;update public.households set default_currency='UYU' where id=pg_temp.id(20);
set local role authenticated;select pg_temp.set_jwt_subject(pg_temp.id(1));
select is(current_user::text,'authenticated','Real role after trusted currency change');select is(auth.uid(),pg_temp.id(1),'Fresh A identity');
select pg_temp.create_expense(122,'2025-01-04','UYU',32,2);
select is(pg_temp.history()#>>'{expenses,0,currency}','UYU','New currency retained for new record');
select is(pg_temp.history()#>>'{expenses,1,currency}','USD','Old receipt never relabeled to current currency');
select is(pg_temp.history()#>>'{expenses,1,template_version}','1','Old template version preserved');
select is(pg_temp.history()#>>'{expenses,1,splits,0,responsibility_amount_minor}','71','Old responsibility not recomputed from new 10-percent template');
-- Trusted fixture departure is not an implemented client lifecycle policy.
reset role;update public.household_members set left_at='2026-10-01' where id=pg_temp.id(41);
set local role authenticated;select pg_temp.set_jwt_subject(pg_temp.id(1));
select is(current_user::text,'authenticated','Real role after trusted departure');select is(auth.uid(),pg_temp.id(1),'A still active');
select is(pg_temp.history()#>>'{expenses,1,payer_member_id}',pg_temp.id(41)::text,'Departed payer attribution stays intact');
select is(pg_temp.history()#>>'{expenses,1,splits,1,member_id}',pg_temp.id(41)::text,'Departed responsibility identity stays intact');
select is(pg_temp.history()#>>'{expenses,1,splits,1,responsibility_amount_minor}','30','Departure does not redistribute old amounts');
select is(jsonb_array_length(pg_temp.history()->'members'),2,'Fresh list display roster excludes departed member');
select is(jsonb_array_length(public.get_shared_expense_history_detail(pg_temp.id(20),pg_temp.id(99))->'members'),2,'Fresh detail display roster excludes departed member');
select is(public.get_shared_expense_history_detail(pg_temp.id(20),pg_temp.id(99))->'expense',public.get_shared_expense(pg_temp.id(20),pg_temp.id(99)),'Detail wrapper preserves original point DTO');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.history()#>'{members,0}')k),array['display_name','id'],'Display roster has only already permitted minimum identity/name');
select pg_temp.set_jwt_subject(pg_temp.id(2));select is(auth.uid(),pg_temp.id(2),'B after departure');
select throws_ok('select pg_temp.history()','42501',null,'Former member receives no historical rights');
select throws_ok('select pg_temp.history(102)','42501',null,'Previously valid cursor cannot retain revoked access');
select throws_ok('select public.get_shared_expense(pg_temp.id(20),pg_temp.id(99))','42501',null,'Detail rechecks current membership independently');
select throws_ok('select public.get_shared_expense_history_detail(pg_temp.id(20),pg_temp.id(99))','42501',null,'History detail wrapper denies former member');
select lives_ok('select public.list_shared_expenses(pg_temp.id(21))','B retains only separate active home');
select pg_temp.set_jwt_subject(null);select is(auth.uid(),null::uuid,'Expired/missing subject');
select throws_ok('select pg_temp.history(102)','42501',null,'Old pagination cursor cannot supply authentication');
reset role;
set constraints all immediate;
select * from finish();
rollback;
