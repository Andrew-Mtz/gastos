\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
\ir helpers/auth.sql.inc
select no_plan();
insert into public.profiles(id,display_name,base_currency,timezone)
select id,'Synthetic','USD','UTC' from auth.users where id::text like 'f0050000%';
insert into public.budget_periods(id,profile_id,starts_on,ends_on,base_currency) values
('f1030000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','2026-10-01','2026-10-31','USD'),
('f1030000-0000-4000-8000-000000000002','f0050000-0000-4000-8000-000000000002','2026-10-01','2026-10-31','USD'),
('f1030000-0000-4000-8000-000000000003','f0050000-0000-4000-8000-000000000001','2026-11-01','2026-11-30','USD');
insert into public.budget_buckets(id,profile_id,name,type) values
('f1040000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','Needs','SPENDABLE'),
('f1040000-0000-4000-8000-000000000002','f0050000-0000-4000-8000-000000000001','Leisure','SPENDABLE'),
('f1040000-0000-4000-8000-000000000003','f0050000-0000-4000-8000-000000000001','Savings','SAVINGS');
insert into public.categories(id,profile_id,name,budget_bucket_id) values
('f1070000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','Food','f1040000-0000-4000-8000-000000000001'),
('f1070000-0000-4000-8000-000000000002','f0050000-0000-4000-8000-000000000001','Rent','f1040000-0000-4000-8000-000000000001'),
('f1070000-0000-4000-8000-000000000003','f0050000-0000-4000-8000-000000000001','Saving','f1040000-0000-4000-8000-000000000003'),
('f1070000-0000-4000-8000-000000000004','f0050000-0000-4000-8000-000000000001','Unmapped',null);
select is((select prosecdef from pg_proc where oid='public.get_bucket_consumption(uuid)'::regprocedure),false,'Consumption is invoker');
select is((select provolatile::text from pg_proc where oid='public.get_bucket_consumption(uuid)'::regprocedure),'s','Stable read snapshot');
select is((select array_to_string(proconfig,',') from pg_proc where oid='public.get_bucket_consumption(uuid)'::regprocedure),'search_path=""','Empty search path');
select ok(has_function_privilege('authenticated','public.get_bucket_consumption(uuid)','EXECUTE'),'Authenticated RPC grant');
select ok(not has_function_privilege('anon','public.get_bucket_consumption(uuid)','EXECUTE'),'No anonymous RPC grant');
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','A client role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'A identity');
select is(public.get_bucket_consumption('f1030000-0000-4000-8000-000000000001')->'buckets','[]'::jsonb,'Unconfigured empty period has no spending');
select public.save_budget_allocations('f1030000-0000-4000-8000-000000000001','[{"budget_bucket_id":"f1040000-0000-4000-8000-000000000002","percentage_basis_points":8000},{"budget_bucket_id":"f1040000-0000-4000-8000-000000000003","percentage_basis_points":2000}]');
select is(jsonb_array_length(public.get_bucket_consumption('f1030000-0000-4000-8000-000000000001')->'buckets'),1,'Only configured spendable bucket appears at zero; savings excluded');
select is(public.get_bucket_consumption('f1030000-0000-4000-8000-000000000001')#>>'{buckets,0,spent_minor}','0','Configured bucket has zero consumption');
insert into public.transactions(id,owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date,category_id) values
('f1130000-0000-4000-8000-000000000001',auth.uid(),'f1030000-0000-4000-8000-000000000001','EXPENSE',100,'USD','2026-10-01','f1070000-0000-4000-8000-000000000001'),
('f1130000-0000-4000-8000-000000000002',auth.uid(),'f1030000-0000-4000-8000-000000000001','EXPENSE',275,'USD','2026-10-02','f1070000-0000-4000-8000-000000000002'),
('f1130000-0000-4000-8000-000000000003',auth.uid(),'f1030000-0000-4000-8000-000000000003','EXPENSE',999,'USD','2026-11-02','f1070000-0000-4000-8000-000000000001');
select is(public.get_bucket_consumption('f1030000-0000-4000-8000-000000000001')#>>'{buckets,0,spent_minor}','375','Multiple categories aggregate into original unallocated bucket; other month excluded');
insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date)
select auth.uid(),'f1030000-0000-4000-8000-000000000001',kind,9999,'USD','2026-10-03'
from unnest(array['INCOME','SAVINGS_CONTRIBUTION','SAVINGS_WITHDRAWAL']) kind;
select is(public.get_bucket_consumption('f1030000-0000-4000-8000-000000000001')#>>'{buckets,0,spent_minor}','375','All non-expense movement types excluded');
update public.transactions set deleted_at=now() where id='f1130000-0000-4000-8000-000000000001';
select is(public.get_bucket_consumption('f1030000-0000-4000-8000-000000000001')#>>'{buckets,0,spent_minor}','275','Soft-deleted expense excluded');
update public.transactions set deleted_at=null where id='f1130000-0000-4000-8000-000000000001';
insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date,category_id)
select auth.uid(),'f1030000-0000-4000-8000-000000000001','EXPENSE',1,'USD','2026-10-03','f1070000-0000-4000-8000-000000000001' from generate_series(1,1001);
select is(public.get_bucket_consumption('f1030000-0000-4000-8000-000000000001')#>>'{buckets,0,spent_minor}','1376','Full aggregate exceeds both history and Data API transaction page sizes');
insert into public.categories(id,profile_id,name,budget_bucket_id) values
('f1070000-0000-4000-8000-000000000005',auth.uid(),'Games','f1040000-0000-4000-8000-000000000002');
insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date,category_id) values
(auth.uid(),'f1030000-0000-4000-8000-000000000001','EXPENSE',25,'USD','2026-10-03','f1070000-0000-4000-8000-000000000005');
select is(public.get_bucket_consumption('f1030000-0000-4000-8000-000000000001')#>>'{buckets,1,spent_minor}','25','Second spendable bucket remains a separate SQL group');
select public.save_budget_allocations('f1030000-0000-4000-8000-000000000001','[{"budget_bucket_id":"f1040000-0000-4000-8000-000000000003","percentage_basis_points":10000}]');
select is(public.get_bucket_consumption('f1030000-0000-4000-8000-000000000001')#>>'{buckets,1,spent_minor}','25','Removing an allocation never erases its expense consumption');
update public.categories set archived_at=now() where id='f1070000-0000-4000-8000-000000000001';
update public.budget_buckets set archived_at=now() where id='f1040000-0000-4000-8000-000000000001';
select is(public.get_bucket_consumption('f1030000-0000-4000-8000-000000000001')#>>'{buckets,0,spent_minor}','1376','Archival preserves historical mapping and consumption');
select throws_ok($$select public.get_bucket_consumption('f1030000-0000-4000-8000-000000000002')$$,'42501',null,'Foreign period denied');
select throws_ok($$select public.get_bucket_consumption(null)$$,'42501',null,'Null period denied');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000002');
select is(current_user::text,'authenticated','B client role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000002'::uuid,'B identity');
select throws_ok($$select public.get_bucket_consumption('f1030000-0000-4000-8000-000000000001')$$,'42501',null,'Partner persona cannot read personal consumption');
select is(public.get_bucket_consumption('f1030000-0000-4000-8000-000000000002')->'buckets','[]'::jsonb,'B own empty period excludes A expenses');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000003');
select is(current_user::text,'authenticated','C client role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000003'::uuid,'C identity');
select throws_ok($$select public.get_bucket_consumption('f1030000-0000-4000-8000-000000000001')$$,'42501',null,'Stranger cannot read consumption');
select pg_temp.set_jwt_subject(null);
select is(auth.uid(),null::uuid,'No identity');
select throws_ok($$select public.get_bucket_consumption('f1030000-0000-4000-8000-000000000001')$$,'42501',null,'Null identity denied');
reset role;
set local role anon;
select pg_temp.set_jwt_subject(null);
select is(current_user::text,'anon','Anonymous role');
select is(auth.uid(),null::uuid,'Anonymous identity');
select throws_ok($$select public.get_bucket_consumption('f1030000-0000-4000-8000-000000000001')$$,'42501','permission denied for function get_bucket_consumption','Actual anonymous EXECUTE denied');
reset role;
select pg_temp.set_jwt_subject(null);
update public.budget_periods set status='CLOSED',closed_at=now() where id='f1030000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','Owner closed read role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'Owner closed read identity');
select is(public.get_bucket_consumption('f1030000-0000-4000-8000-000000000001')#>>'{buckets,0,spent_minor}','1376','Closed historical consumption remains readable');
reset role;
-- Synthetic legacy rows represent data predating ADR-067. Disable triggers only
-- inside this rolled-back test fixture; no product validation is weakened.
alter table public.transactions disable trigger user;
insert into public.transactions(id,owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date,category_id) values
('f1130000-0000-4000-8000-000000000004','f0050000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001','EXPENSE',1,'UYU','2026-10-01','f1070000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$select public.get_bucket_consumption('f1030000-0000-4000-8000-000000000001')$$,'23514',null,'Mixed-currency legacy expense fails explicitly');
reset role;
update public.transactions set currency='USD',category_id=null where id='f1130000-0000-4000-8000-000000000004';
set local role authenticated;
select throws_ok($$select public.get_bucket_consumption('f1030000-0000-4000-8000-000000000001')$$,'23514',null,'Missing legacy category fails explicitly');
reset role;
update public.transactions set category_id='f1070000-0000-4000-8000-000000000004' where id='f1130000-0000-4000-8000-000000000004';
set local role authenticated;
select throws_ok($$select public.get_bucket_consumption('f1030000-0000-4000-8000-000000000001')$$,'23514',null,'Unmapped legacy category fails explicitly');
reset role;
update public.transactions set category_id='f1070000-0000-4000-8000-000000000003' where id='f1130000-0000-4000-8000-000000000004';
set local role authenticated;
select throws_ok($$select public.get_bucket_consumption('f1030000-0000-4000-8000-000000000001')$$,'23514',null,'Legacy savings expense is never silently ignored');
reset role;
update public.transactions set deleted_at=now() where id='f1130000-0000-4000-8000-000000000004';
set local role authenticated;
select is(public.get_bucket_consumption('f1030000-0000-4000-8000-000000000001')#>>'{buckets,0,spent_minor}','1376','Deleted invalid legacy row does not block normal calculation');
reset role;
update public.transactions set deleted_at=null,category_id='f1070000-0000-4000-8000-000000000001',amount_minor=9007199254740991 where id='f1130000-0000-4000-8000-000000000004';
alter table public.transactions enable trigger user;
set local role authenticated;
select throws_ok($$select public.get_bucket_consumption('f1030000-0000-4000-8000-000000000001')$$,'22003',null,'Unsafe aggregate fails rather than rounds');
reset role;
select * from finish();
rollback;
