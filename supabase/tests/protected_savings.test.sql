\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
\ir helpers/auth.sql.inc
select no_plan();

insert into public.profiles(id,display_name,base_currency,timezone)
select id,'Synthetic','USD','UTC' from auth.users where id::text like 'f0050000%';
insert into public.budget_periods(id,profile_id,starts_on,ends_on,base_currency,expected_income_minor) values
('f1140000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','2026-10-01','2026-10-31','USD',999999);
insert into public.budget_buckets(id,profile_id,name,type) values
('b1140000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','Needs','SPENDABLE'),
('b1140000-0000-4000-8000-000000000002','f0050000-0000-4000-8000-000000000001','Reserve','SAVINGS');
insert into public.categories(id,profile_id,name,budget_bucket_id) values
('c1140000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','Food','b1140000-0000-4000-8000-000000000001'),
('c1140000-0000-4000-8000-000000000002','f0050000-0000-4000-8000-000000000001','Reserve','b1140000-0000-4000-8000-000000000002');

set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','Owner uses actual client role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'Owner JWT identity');
select lives_ok($$select public.save_budget_allocations('f1140000-0000-4000-8000-000000000001','[
  {"budget_bucket_id":"b1140000-0000-4000-8000-000000000001","percentage_basis_points":8000},
  {"budget_bucket_id":"b1140000-0000-4000-8000-000000000002","percentage_basis_points":2000}]');
  set constraints public.budget_allocations_total_check immediate$$,'Owner configures spendable and protected shares');
select lives_ok($$select public.register_income('a1140000-0000-4000-8000-000000000001','f1140000-0000-4000-8000-000000000001',150000,'USD','2026-10-20')$$,'Received income is distinct from expected');
select lives_ok($$select public.register_personal_expense('a1140000-0000-4000-8000-000000000002','f1140000-0000-4000-8000-000000000001',160000,'USD','2026-10-20','c1140000-0000-4000-8000-000000000001')$$,'Overspending beyond all received income is recorded without automatic reallocation');
select is(public.get_received_income('f1140000-0000-4000-8000-000000000001'),150000::bigint,'Overspending does not change actual income used for allocation');
select results_eq($$select percentage_basis_points from public.budget_allocations where deleted_at is null order by budget_bucket_id$$,
  array[8000,2000],'Overspending preserves the whole allocation including protected savings');
select is((select count(*) from public.transactions),2::bigint,'Only the requested income and expense exist');
select is((select count(*) from public.transactions where type in ('SAVINGS_CONTRIBUTION','SAVINGS_WITHDRAWAL')),0::bigint,'No implicit savings contribution or withdrawal is created');
select is((public.get_bucket_consumption('f1140000-0000-4000-8000-000000000001')->'buckets'->0->>'spent_minor')::bigint,160000::bigint,'Entire overspend remains ordinary consumption');
select is(jsonb_array_length(public.get_bucket_consumption('f1140000-0000-4000-8000-000000000001')->'buckets'),1,'Savings is not a consumed bucket');
select throws_ok($$insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date,category_id)
  values(auth.uid(),'f1140000-0000-4000-8000-000000000001','EXPENSE',100,'USD','2026-10-20','c1140000-0000-4000-8000-000000000002')$$,
  '42501',null,'Direct expense cannot bypass savings protection');
select throws_ok($$select public.register_personal_expense(gen_random_uuid(),'f1140000-0000-4000-8000-000000000001',100,'USD','2026-10-20','c1140000-0000-4000-8000-000000000002')$$,
  '42501',null,'RPC expense cannot use a savings category');
select ok(not has_column_privilege('authenticated','public.budget_buckets','type','UPDATE'),'Clients cannot reclassify savings as spendable');
select throws_ok($$update public.budget_buckets set type='SPENDABLE' where id='b1140000-0000-4000-8000-000000000002'$$,
  '42501',null,'Immutable type grant prevents reclassification');
update public.budget_buckets set archived_at=now() where id='b1140000-0000-4000-8000-000000000002';
select is((select b.type from public.budget_allocations a join public.budget_buckets b on b.id=a.budget_bucket_id where a.deleted_at is null and b.id='b1140000-0000-4000-8000-000000000002'),'SAVINGS','Archived allocation still resolves its protected type');
update public.transactions set deleted_at=now() where id='a1140000-0000-4000-8000-000000000002';
select is((select percentage_basis_points from public.budget_allocations where budget_bucket_id='b1140000-0000-4000-8000-000000000002'),2000,'Expense deletion does not change protection');
select is((select count(*) from public.transactions where type='SAVINGS_WITHDRAWAL'),0::bigint,'Expense deletion also creates no withdrawal');
reset role;

-- Partner and unrelated personas cannot read the sources of protected savings.
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000002');
select is(current_user::text,'authenticated','Partner client role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000002'::uuid,'Partner JWT identity');
select is((select count(*) from public.budget_allocations),0::bigint,'Partner cannot read savings allocation');
select is((select count(*) from public.budget_buckets),0::bigint,'Partner cannot read private bucket classification');
select throws_ok($$select public.get_received_income('f1140000-0000-4000-8000-000000000001')$$,'42501',null,'Partner cannot derive savings from income');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000003');
select is(current_user::text,'authenticated','Unrelated client role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000003'::uuid,'Unrelated JWT identity');
select is((select count(*) from public.budget_allocations),0::bigint,'Unrelated user cannot read savings allocation');
select throws_ok($$select public.get_received_income('f1140000-0000-4000-8000-000000000001')$$,'42501',null,'Unrelated user cannot derive savings from income');
reset role;
select * from finish();
rollback;
