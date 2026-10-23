\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_catalog;
\ir helpers/auth.sql.inc
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
 select ('f2050000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.roster() returns uuid[] language sql immutable as $$select array[pg_temp.id(40),pg_temp.id(41),pg_temp.id(42)];$$;
create function pg_temp.shares(a integer default 7000,b integer default 3000,c integer default 0) returns jsonb language sql immutable as $$
 select jsonb_build_array(jsonb_build_object('member_id',pg_temp.id(40),'basis_points',a),jsonb_build_object('member_id',pg_temp.id(41),'basis_points',b),jsonb_build_object('member_id',pg_temp.id(42),'basis_points',c));
$$;
create function pg_temp.save(n integer,v integer default 0,a integer default 7000,b integer default 3000,c integer default 0) returns jsonb language sql as $$
 select public.save_household_default_split(pg_temp.id(n),pg_temp.id(20),v,pg_temp.roster(),pg_temp.shares(a,b,c));
$$;
insert into auth.users(id,email) select pg_temp.id(n),'fin205-'||n||'@example.invalid' from generate_series(1,9)n;
insert into public.profiles(id,display_name,base_currency,timezone)
select pg_temp.id(n),'Synthetic name '||n,'USD','UTC' from generate_series(1,8)n;
insert into public.households(id,name,default_currency,created_by) values
(pg_temp.id(20),'Split home','USD',pg_temp.id(5)),(pg_temp.id(21),'Other home','EUR',pg_temp.id(6));
insert into public.household_members(id,household_id,profile_id,role,joined_at,left_at) values
(pg_temp.id(40),pg_temp.id(20),pg_temp.id(1),'OWNER','2026-01-01',null),
(pg_temp.id(41),pg_temp.id(20),pg_temp.id(2),'MEMBER','2026-01-01',null),
(pg_temp.id(42),pg_temp.id(20),pg_temp.id(7),'OWNER','2026-01-01',null),
(pg_temp.id(43),pg_temp.id(20),pg_temp.id(4),'MEMBER','2026-01-01','2026-02-01'),
(pg_temp.id(45),pg_temp.id(21),pg_temp.id(6),'OWNER','2026-01-01',null);
select ok(c.relrowsecurity,'RLS enabled: '||c.relname) from pg_class c where oid in ('public.household_split_revisions'::regclass,'public.household_split_shares'::regclass);
select ok(not has_table_privilege(r,t,p),'No direct '||r||' '||p||' on '||t)
from unnest(array['anon','authenticated'])r cross join unnest(array['public.household_split_revisions','public.household_split_shares'])t cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])p;
select ok(not has_any_column_privilege(r,t,p),'No column bypass '||r||' '||p||' on '||t)
from unnest(array['anon','authenticated'])r cross join unnest(array['public.household_split_revisions','public.household_split_shares'])t cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES'])p;
select ok(prosecdef and proconfig @> array['search_path=""'],'Narrow empty-path definer: '||proname) from pg_proc where oid in
('public.get_household_default_split(uuid)'::regprocedure,'public.save_household_default_split(uuid,uuid,integer,uuid[],jsonb)'::regprocedure,'public.check_household_split_revision()'::regprocedure);
select ok(not has_function_privilege('authenticated','public.check_household_split_revision()','EXECUTE'),'Integrity trigger is not client callable');

set local role anon;
select pg_temp.set_jwt_subject(null);
select is(current_user::text,'anon','Actual anonymous role');select is(auth.uid(),null::uuid,'No anonymous subject');
select throws_ok('select public.get_household_default_split(pg_temp.id(20))','42501',null,'Anon cannot read');
select throws_ok('select pg_temp.save(50)','42501',null,'Anon cannot save');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject(null);
select is(current_user::text,'authenticated','Actual authenticated role');select is(auth.uid(),null::uuid,'Missing subject');
select throws_ok('select public.get_household_default_split(pg_temp.id(20))','42501',null,'Missing subject cannot read');
select throws_ok('select pg_temp.save(50)','42501',null,'Missing subject cannot save');
select pg_temp.set_jwt_subject(pg_temp.id(9));select is(auth.uid(),pg_temp.id(9),'Auth-only identity');
select throws_ok('select public.get_household_default_split(pg_temp.id(20))','42501',null,'Missing Profile gives no access');
select pg_temp.set_jwt_subject(pg_temp.id(3));select is(auth.uid(),pg_temp.id(3),'Stranger identity');
select throws_ok('select public.get_household_default_split(pg_temp.id(20))','42501',null,'Stranger cannot read');
select throws_ok('select pg_temp.save(50)','42501',null,'Stranger cannot save');
select pg_temp.set_jwt_subject(pg_temp.id(4));select is(auth.uid(),pg_temp.id(4),'Inactive identity');
select throws_ok('select public.get_household_default_split(pg_temp.id(20))','42501',null,'Inactive cannot read');
select throws_ok('select pg_temp.save(50)','42501',null,'Inactive cannot save');
select pg_temp.set_jwt_subject(pg_temp.id(5));select is(auth.uid(),pg_temp.id(5),'Creator-only identity');
select throws_ok('select public.get_household_default_split(pg_temp.id(20))','42501',null,'Creator metadata is not membership');
select throws_ok('select pg_temp.save(50)','42501',null,'Creator metadata is not ownership');
select pg_temp.set_jwt_subject(pg_temp.id(2));select is(auth.uid(),pg_temp.id(2),'Active MEMBER identity');
select is(public.get_household_default_split(pg_temp.id(20))->>'status','UNCONFIGURED','Member can read absence, never implicit equal split');
select is(public.get_household_default_split(pg_temp.id(20))->'template','null'::jsonb,'No persisted/display fallback template');
select throws_ok('select pg_temp.save(50)','42501',null,'MEMBER cannot save');
select pg_temp.set_jwt_subject(pg_temp.id(1));select is(auth.uid(),pg_temp.id(1),'Active OWNER identity');
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_household_default_split(pg_temp.id(20))) k),array['household_id','profile_id','roster','status','template','version'],'Minimal exact root DTO');
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_household_default_split(pg_temp.id(20))->'roster'->0) k),array['display_name','id','profile_id','role'],'Active member DTO excludes all private preferences');
select is(jsonb_array_length(public.get_household_default_split(pg_temp.id(20))->'roster'),3,'Inactive member excluded');
select is(pg_temp.save(50),jsonb_build_object('request_id',pg_temp.id(50),'household_id',pg_temp.id(20),'version',1),'OWNER saves explicit three-member split including zero');
-- Force deferred validation while still authenticated. On PostgreSQL 17 it runs
-- after the save definer returns; RESET ROLE first would hide a trigger bug.
select lives_ok('set constraints all immediate','Deferred integrity runs under authenticated commit role');
set constraints all deferred;
select is(public.get_household_default_split(pg_temp.id(20))->>'status','READY','Configured roster is current');
select is(public.get_household_default_split(pg_temp.id(20))->'template'->'shares',pg_temp.shares(),'Stored percentages exact, including zero');
select is(pg_temp.save(50),jsonb_build_object('request_id',pg_temp.id(50),'household_id',pg_temp.id(20),'version',1),'Exact replay returns original receipt');
select is(public.save_household_default_split(pg_temp.id(50),pg_temp.id(20),0,array[pg_temp.id(42),pg_temp.id(40),pg_temp.id(41)],jsonb_build_array(pg_temp.shares()->2,pg_temp.shares()->0,pg_temp.shares()->1)),pg_temp.save(50),'Canonical replay ignores entry/roster ordering, not identity or values');
select is(pg_temp.save(51,1,6667,3333,0)->>'version','2','New save advances expected version');
select is(pg_temp.save(50),jsonb_build_object('request_id',pg_temp.id(50),'household_id',pg_temp.id(20),'version',1),'Old replay after new revision confirms only old receipt');
select is(public.get_household_default_split(pg_temp.id(20))->'template'->'shares',pg_temp.shares(6667,3333,0),'Replay never restores old percentages');
select throws_ok('select pg_temp.save(50,0,5000,5000,0)','23505',null,'UUID cannot acquire a different payload');
select throws_ok('select pg_temp.save(52,0)','40001',null,'Stale version requires review');
select throws_ok('select pg_temp.save(52,2,9999,0,0)','22023',null,'Incomplete total rejected');
select throws_ok('select pg_temp.save(52,2,10001,0,0)','22023',null,'Out-of-range total rejected');
select throws_ok('select pg_temp.save(52,2,-1,10001,0)','22023',null,'Negative percentages rejected');
select throws_ok($$select public.save_household_default_split(pg_temp.id(52),pg_temp.id(20),2,pg_temp.roster(),'[]')$$,'22023',null,'Empty entries rejected');
select throws_ok($$select public.save_household_default_split(pg_temp.id(52),pg_temp.id(20),2,pg_temp.roster(),jsonb_set(pg_temp.shares(),'{0,basis_points}','7000.5'))$$,'22023',null,'Fraction rejected');
select throws_ok($$select public.save_household_default_split(pg_temp.id(52),pg_temp.id(20),2,pg_temp.roster(),jsonb_set(pg_temp.shares(),'{0,basis_points}','"7000"'))$$,'22023',null,'Numeric string rejected');
select throws_ok($$select public.save_household_default_split(pg_temp.id(52),pg_temp.id(20),2,pg_temp.roster(),jsonb_set(pg_temp.shares(),'{0,basis_points}','null'))$$,'22023',null,'Explicit null rejected');
select throws_ok($$select public.save_household_default_split(pg_temp.id(52),pg_temp.id(20),2,pg_temp.roster(),pg_temp.shares()||'[{}]')$$,'22023',null,'Unknown/missing fields rejected');
select throws_ok($$select public.save_household_default_split(pg_temp.id(52),pg_temp.id(20),2,array[pg_temp.id(40),pg_temp.id(40),pg_temp.id(42)],jsonb_set(pg_temp.shares(),'{1,member_id}',to_jsonb(pg_temp.id(40))))$$,'22023',null,'Duplicate member cannot hide exact total');
select throws_ok($$select public.save_household_default_split(pg_temp.id(52),pg_temp.id(20),2,array[pg_temp.id(40),pg_temp.id(41)],pg_temp.shares()-2)$$,'40001',null,'All active members explicit even if omitted share was zero');
select throws_ok($$select public.save_household_default_split(pg_temp.id(52),pg_temp.id(20),2,array[pg_temp.id(40),pg_temp.id(41),pg_temp.id(45)],jsonb_set(pg_temp.shares(),'{2,member_id}',to_jsonb(pg_temp.id(45))))$$,'40001',null,'Foreign household member cannot replace active roster');
select throws_ok('select public.save_household_default_split(pg_temp.id(52),pg_temp.id(99),0,pg_temp.roster(),pg_temp.shares())','42501',null,'Unknown household is not authority');
select pg_temp.set_jwt_subject(pg_temp.id(7));select is(auth.uid(),pg_temp.id(7),'Second active OWNER identity');
select throws_ok('select pg_temp.save(50)','23505',null,'Another OWNER cannot replay another actor receipt');
select pg_temp.set_jwt_subject(pg_temp.id(6));select is(auth.uid(),pg_temp.id(6),'Other household OWNER identity');
select throws_ok($$select public.save_household_default_split(pg_temp.id(50),pg_temp.id(21),0,array[pg_temp.id(45)],jsonb_build_array(jsonb_build_object('member_id',pg_temp.id(45),'basis_points',10000)))$$,'23505',null,'Same UUID cannot cross households');
reset role;
select is((select count(*) from public.household_split_revisions),2::bigint,'All rejected attempts/replays leave revision count unchanged');
select is((select count(*) from public.household_split_shares),6::bigint,'All rejected attempts/replays leave complete shares unchanged');
select is((select sum(basis_points) from public.household_split_shares where revision_id=pg_temp.id(51)),10000::bigint,'Exact total preserved');
select throws_ok($$update public.household_split_revisions set version=3,expected_version=2 where id=pg_temp.id(50)$$,'23514',null,'Historical revision cannot be rewritten');
select throws_ok($$update public.household_split_shares set basis_points=1 where revision_id=pg_temp.id(50)$$,'23514',null,'Historical shares cannot be rewritten');
select throws_ok($$do $body$ begin
  insert into public.household_split_revisions(id,household_id,version,expected_version,roster,created_by) values(pg_temp.id(60),pg_temp.id(20),3,2,array[pg_temp.id(45)],pg_temp.id(1));
  insert into public.household_split_shares(revision_id,household_id,member_id,basis_points) values(pg_temp.id(60),pg_temp.id(20),pg_temp.id(45),10000);
end $body$;$$,'23503',null,'Composite FK independently rejects cross-household shares');
select throws_ok($$do $body$ begin
  insert into public.household_split_revisions(id,household_id,version,expected_version,roster,created_by) values(pg_temp.id(60),pg_temp.id(20),3,2,array[pg_temp.id(40)],pg_temp.id(1));
  insert into public.household_split_shares(revision_id,household_id,member_id,basis_points) values(pg_temp.id(60),pg_temp.id(20),pg_temp.id(40),9999);
  set constraints all immediate;
end $body$;$$,'23514',null,'Deferred integrity independently rejects incomplete total atomically');
select is((select count(*) from public.household_split_revisions where id=pg_temp.id(60)),0::bigint,'Failed integrity leaves no partial header');

-- Test grant denial independently from the default-deny RLS layer.
set local role authenticated;select pg_temp.set_jwt_subject(pg_temp.id(1));
select is(current_user::text,'authenticated','Actual OWNER role for direct-denial');select is(auth.uid(),pg_temp.id(1),'OWNER direct-denial subject');
select throws_ok('select * from public.household_split_revisions','42501',null,'Even OWNER cannot directly read receipts');
select throws_ok('delete from public.household_split_shares','42501',null,'Even OWNER cannot directly erase shares');
reset role;
grant select,insert,update,delete on public.household_split_revisions,public.household_split_shares to authenticated;
set local role authenticated;select pg_temp.set_jwt_subject(pg_temp.id(1));
select is(current_user::text,'authenticated','Actual role with temporary test grants');select is(auth.uid(),pg_temp.id(1),'OWNER RLS subject');
select is((select count(*) from public.household_split_revisions),0::bigint,'RLS independently hides receipts despite SELECT grant');
select is((select count(*) from public.household_split_shares),0::bigint,'RLS independently hides shares despite SELECT grant');
select throws_ok($$insert into public.household_split_revisions(id,household_id,version,expected_version,roster,created_by) values(pg_temp.id(60),pg_temp.id(20),3,2,pg_temp.roster(),pg_temp.id(1))$$,'42501',null,'RLS WITH CHECK rejects header insertion');
select throws_ok($$insert into public.household_split_shares(revision_id,household_id,member_id,basis_points) values(pg_temp.id(50),pg_temp.id(20),pg_temp.id(43),0)$$,'42501',null,'RLS WITH CHECK rejects share insertion');
with changed as(update public.household_split_revisions set created_by=pg_temp.id(2) returning id) select is((select count(*) from changed),0::bigint,'RLS filters revision update');
with changed as(update public.household_split_shares set basis_points=0 returning member_id) select is((select count(*) from changed),0::bigint,'RLS filters share update');
with gone as(delete from public.household_split_revisions returning id) select is((select count(*) from gone),0::bigint,'RLS filters header delete');
with gone as(delete from public.household_split_shares returning member_id) select is((select count(*) from gone),0::bigint,'RLS filters share delete');
reset role;
revoke all on public.household_split_revisions,public.household_split_shares from authenticated;
insert into public.household_members(id,household_id,profile_id,role) values(pg_temp.id(44),pg_temp.id(20),pg_temp.id(8),'MEMBER');
set local role authenticated;select pg_temp.set_jwt_subject(pg_temp.id(1));
select is(current_user::text,'authenticated','Actual role after roster change');select is(auth.uid(),pg_temp.id(1),'OWNER after roster change');
select is(public.get_household_default_split(pg_temp.id(20))->>'status','STALE','Join invalidates template without redistribution');
select is(public.get_household_default_split(pg_temp.id(20))->'template','null'::jsonb,'Stale DTO withholds historical identities/shares');
select is(public.get_household_default_split(pg_temp.id(20))->>'version','2','Stale still exposes expected version for explicit review');
select throws_ok('select pg_temp.save(52,2)','40001',null,'Save from old roster conflicts');
select is(pg_temp.save(50)->>'version','1','Committed replay still succeeds despite later roster change');
select is(public.save_household_default_split(pg_temp.id(52),pg_temp.id(20),2,pg_temp.roster()||pg_temp.id(44),pg_temp.shares()||jsonb_build_array(jsonb_build_object('member_id',pg_temp.id(44),'basis_points',0)))->>'version','3','Explicit reviewed full roster creates next version');
select lives_ok('set constraints all immediate','Full reviewed revision validates under authenticated role');set constraints all deferred;
reset role;
update public.household_members set role='OWNER' where id=pg_temp.id(41);
set local role authenticated;select pg_temp.set_jwt_subject(pg_temp.id(1));select is(current_user::text,'authenticated','Actual role after permission-only change');select is(auth.uid(),pg_temp.id(1),'OWNER permission-only test');
select is(public.get_household_default_split(pg_temp.id(20))->>'status','READY','Role-only change does not redistribute percentages');
reset role;
update public.household_members set left_at=clock_timestamp() where id=pg_temp.id(41);
set local role authenticated;select pg_temp.set_jwt_subject(pg_temp.id(1));select is(current_user::text,'authenticated','Actual role after departure');select is(auth.uid(),pg_temp.id(1),'OWNER departure test');
select is(public.get_household_default_split(pg_temp.id(20))->>'status','STALE','Departure invalidates template');
select ok(position(pg_temp.id(41)::text in public.get_household_default_split(pg_temp.id(20))::text)=0,'Former member identity never leaks via old template');
select pg_temp.set_jwt_subject(pg_temp.id(2));select is(auth.uid(),pg_temp.id(2),'Departed member subject');
select throws_ok('select public.get_household_default_split(pg_temp.id(20))','42501',null,'Departed member immediately loses read');
reset role;
update public.household_members set role='MEMBER' where id=pg_temp.id(40);
set local role authenticated;select pg_temp.set_jwt_subject(pg_temp.id(1));select is(current_user::text,'authenticated','Actual demoted role');select is(auth.uid(),pg_temp.id(1),'Demoted subject');
select throws_ok('select pg_temp.save(50)','42501',null,'Replay rechecks current OWNER, not receipt author');
select is(public.get_household_default_split(pg_temp.id(20))->>'status','STALE','Demotion retains MEMBER read only');
select is((select count(*) from public.profiles),1::bigint,'Household split capability never expands personal Profile access');
reset role;
select is((select count(*) from public.household_split_revisions),3::bigint,'Only three explicitly authorized revisions exist');
select is((select count(*) from public.transactions),0::bigint,'No financial transaction generated');
select * from finish();
rollback;
