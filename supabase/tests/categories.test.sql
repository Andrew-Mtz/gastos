\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
\ir helpers/auth.sql.inc
select no_plan();
insert into public.profiles (id, display_name, base_currency, timezone)
select id, 'Synthetic', 'USD', 'UTC' from auth.users where id::text like 'f0050000%';
insert into public.budget_buckets (id, profile_id, name, type) values
 ('f1040000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','Needs','SPENDABLE'),
 ('f1040000-0000-4000-8000-000000000002','f0050000-0000-4000-8000-000000000002','Private','SPENDABLE');
select ok((select relrowsecurity from pg_class where oid='public.categories'::regclass), 'RLS enabled');
select ok(not has_table_privilege('authenticated','public.categories',p), 'No broad ' || p)
from unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p;
select ok(not has_column_privilege('authenticated','public.categories',c,'UPDATE'), 'Immutable ' || c)
from unnest(array['id','profile_id','budget_bucket_id','is_system','created_at','updated_at']) c;
select ok(not has_column_privilege('authenticated','public.categories',c,'INSERT'), 'Server supplies ' || c)
from unnest(array['id','is_system','created_at','updated_at','archived_at']) c;
select is((select prosecdef from pg_proc where oid='public.prepare_category_update()'::regprocedure),false,'Invoker trigger');
select ok(not has_function_privilege('authenticated','public.prepare_category_update()','EXECUTE'),'Trigger not callable');
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','Client role A');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'Subject A');
select lives_ok($$insert into public.categories(profile_id,name,budget_bucket_id) values
 ('f0050000-0000-4000-8000-000000000001','Groceries','f1040000-0000-4000-8000-000000000001'),
 ('f0050000-0000-4000-8000-000000000001','Other',null)$$,'Own mapped and unmapped categories');
select is((select count(*) from public.categories),2::bigint,'Reads own rows');
select throws_ok($$insert into public.categories(profile_id,name) values
 ('f0050000-0000-4000-8000-000000000002','Forged')$$,'42501',
 'new row violates row-level security policy for table "categories"','Ownership forgery denied by RLS');
select throws_ok($$insert into public.categories(profile_id,name,budget_bucket_id) values
 ('f0050000-0000-4000-8000-000000000001','Forged','f1040000-0000-4000-8000-000000000002')$$,
 '42501',null,'Foreign bucket denied');
select throws_ok($$insert into public.categories(profile_id,name) values
 ('f0050000-0000-4000-8000-000000000001',' ')$$,'23514',null,'Blank name denied');
select throws_ok($$update public.categories set budget_bucket_id=null$$,'42501',
 'permission denied for table categories','Cannot rewrite historical mapping');
select throws_ok($$update public.categories set profile_id='f0050000-0000-4000-8000-000000000002'$$,
 '42501','permission denied for table categories','Cannot reassign ownership');
select throws_ok($$insert into public.categories(profile_id,name,is_system) values
 ('f0050000-0000-4000-8000-000000000001','Forged',true)$$,'42501',null,'Cannot forge provenance');
select lives_ok($$update public.categories set name='Food' where name='Groceries'$$,'Rename works');
select set_config('test.category_id',(select id::text from public.categories where name='Food'),true);
select lives_ok($$update public.categories set archived_at='1900-01-01' where name='Food'$$,'Archive works');
select ok((select archived_at>=created_at from public.categories where name='Food'),'Archive time is server controlled');
select set_config('test.archived_at',(select archived_at::text from public.categories where name='Food'),true);
select lives_ok($$update public.categories set archived_at='2100-01-01' where name='Food'$$,'Repeat archive works');
select is((select archived_at from public.categories where name='Food'),current_setting('test.archived_at')::timestamptz,'Archive identity preserved');
select is((select count(*) from public.categories where archived_at is null),1::bigint,'Active configuration excludes archive');
select is((select id from public.categories where name='Food'),current_setting('test.category_id')::uuid,'History still resolves same category');
select lives_ok($$update public.budget_buckets set archived_at=now() where name='Needs'$$,'Bucket may archive without destroying relation');
select is((select count(*) from public.categories c join public.budget_buckets b on b.id=c.budget_bucket_id),1::bigint,'Archived relation remains readable');
select throws_ok($$insert into public.categories(profile_id,name,budget_bucket_id) values
 ('f0050000-0000-4000-8000-000000000001','New','f1040000-0000-4000-8000-000000000001')$$,'42501',null,'New categories cannot target archived buckets');
select lives_ok($$update public.categories set archived_at=null where name='Food'$$,'Category restore retains old mapping');
select throws_ok($$delete from public.categories$$,'42501','permission denied for table categories','No destructive deletion');
select throws_ok($$truncate public.categories$$,'42501','permission denied for table categories','No truncate');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000002');
select is(current_user::text,'authenticated','Partner persona B client role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000002'::uuid,'Partner persona B subject');
select is((select count(*) from public.categories),0::bigint,'Partner persona B cannot read A');
select results_eq($$update public.categories set name='Forbidden' returning id$$,array[]::uuid[],'Partner persona B cannot update A');
select results_eq($$update public.categories set archived_at=now() returning id$$,array[]::uuid[],'Partner persona B cannot archive A');
select throws_ok($$insert into public.categories(profile_id,name) values
 ('f0050000-0000-4000-8000-000000000001','Forged')$$,'42501','new row violates row-level security policy for table "categories"','Partner persona B cannot forge owner');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000003');
select is(current_user::text,'authenticated','Unrelated C client role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000003'::uuid,'Unrelated C subject');
select is((select count(*) from public.categories),0::bigint,'Unrelated C cannot read A');
select results_eq($$update public.categories set name='Forbidden' returning id$$,array[]::uuid[],'Unrelated C cannot update A');
select results_eq($$update public.categories set archived_at=now() returning id$$,array[]::uuid[],'Unrelated C cannot archive A');
select throws_ok($$insert into public.categories(profile_id,name) values
 ('f0050000-0000-4000-8000-000000000001','Forged')$$,'42501','new row violates row-level security policy for table "categories"','Unrelated C cannot forge owner');
reset role;
-- No household table exists yet; the partner persona is not fake membership proof.
set local role authenticated;
select pg_temp.set_jwt_subject(null);
select is(auth.uid(),null::uuid,'Missing identity');
select is((select count(*) from public.categories),0::bigint,'Role alone grants no private data');
reset role;
set local role anon;
select pg_temp.set_jwt_subject(null);
select is(current_user::text,'anon','Anonymous role');
select is(auth.uid(),null::uuid,'Anonymous identity');
select throws_ok($$select * from public.categories$$,'42501','permission denied for table categories','No anonymous reads');
select throws_ok($$insert into public.categories(profile_id,name) values ('f0050000-0000-4000-8000-000000000001','Forged')$$,'42501','permission denied for table categories','No anonymous writes');
reset role;
select pg_temp.set_jwt_subject(null);
select throws_ok($$insert into public.categories(profile_id,name,budget_bucket_id) values
 ('f0050000-0000-4000-8000-000000000001','Forged','f1040000-0000-4000-8000-000000000002')$$,'23503',null,'Composite FK enforces same owner even without RLS');
select throws_ok($$delete from public.budget_buckets where name='Needs'$$,'23503',null,'Referenced bucket cannot be destroyed');
insert into public.categories(profile_id,name,is_system) values ('f0050000-0000-4000-8000-000000000001','System',true);
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'A owns system fixture');
select results_eq($$update public.categories set name='Override' where is_system returning id$$,array[]::uuid[],'System rows remain immutable');
reset role;
select * from finish();
rollback;
