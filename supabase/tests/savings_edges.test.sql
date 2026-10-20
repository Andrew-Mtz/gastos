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
('f1150000-0000-4000-8000-000000000002','f0050000-0000-4000-8000-000000000001','2026-10-01','2026-10-31','USD');
insert into public.budget_buckets(id,profile_id,name,type) values
('b1150000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','Ordinary','SPENDABLE'),
('b1150000-0000-4000-8000-000000000002','f0050000-0000-4000-8000-000000000001','Reserve','SAVINGS');
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','Owner client role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'Owner real identity');
select public.save_budget_allocations(id,'[{"budget_bucket_id":"b1150000-0000-4000-8000-000000000002","percentage_basis_points":5000},{"budget_bucket_id":"b1150000-0000-4000-8000-000000000001","percentage_basis_points":5000}]') from public.budget_periods;
select public.register_income('a1150000-0000-4000-8000-000000000001','f1150000-0000-4000-8000-000000000001',1,'USD','2026-09-01');
select public.register_income('a1150000-0000-4000-8000-000000000002','f1150000-0000-4000-8000-000000000002',1,'USD','2026-10-01');
select is(public.get_savings_availability('f1150000-0000-4000-8000-000000000002')->>'opening_protected_minor','0','Monthly rounding is preserved, not rerounded cumulatively');
select is(public.get_savings_availability('f1150000-0000-4000-8000-000000000002')->>'allocated_savings_minor','0','UUID tie order ignores submitted array order');
select is(public.get_savings_availability('f1150000-0000-4000-8000-000000000002')->>'spendable_allocated_minor','1','Every minor unit is preserved');
select throws_ok($$select public.register_savings_movement(gen_random_uuid(),'f1150000-0000-4000-8000-000000000002','SAVINGS_WITHDRAWAL',1,'USD','2026-10-01',true)$$,'23514',null,'Rerounding cannot invent one withdrawable unit');
update public.budget_buckets set archived_at=now() where id='b1150000-0000-4000-8000-000000000002';
select is(public.get_savings_availability('f1150000-0000-4000-8000-000000000002')->>'allocated_savings_minor','0','Archived bucket preserves original classification');
set constraints all immediate;
set constraints all deferred;
reset role;
select pg_temp.set_jwt_subject(null);
-- Reproduce a pre-FIN115 withdrawal without changing any production migration.
-- This fixture-only constraint removal and trigger pause roll back with the test.
alter table public.transactions drop constraint transactions_withdrawal_confirmation;
alter table public.transactions disable trigger user;
insert into public.transactions(id,owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date)
values('a1150000-0000-4000-8000-000000000003','f0050000-0000-4000-8000-000000000001','f1150000-0000-4000-8000-000000000002','SAVINGS_WITHDRAWAL',1,'USD','2026-10-02');
alter table public.transactions enable trigger user;
alter table public.transactions add constraint transactions_withdrawal_confirmation check(type<>'SAVINGS_WITHDRAWAL' or withdrawal_confirmed or deleted_at is not null) not valid;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','Owner restores actual role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'Owner restores actual identity');
select throws_ok($$select public.get_savings_availability('f1150000-0000-4000-8000-000000000002')$$,'23514',null,'Unconfirmed legacy movement fails explicitly');
select is((select count(*) from public.transactions where id='a1150000-0000-4000-8000-000000000003'),1::bigint,'Legacy movement remains owner-readable in history');
select lives_ok($$update public.transactions set deleted_at=now() where id='a1150000-0000-4000-8000-000000000003';set constraints all immediate$$,'Legacy unconfirmed withdrawal can be recoverably removed');
select throws_ok($$update public.transactions set deleted_at=null where id='a1150000-0000-4000-8000-000000000003'$$,'23514',null,'Unconfirmed legacy withdrawal cannot be restored without explicit replacement');
select lives_ok($$select public.get_savings_availability('f1150000-0000-4000-8000-000000000002')$$,'Removed incompatible row no longer poisons availability');
set constraints all deferred;
reset role;
select pg_temp.set_jwt_subject(null);
-- A legacy contribution also has no proof of funding and must not create money.
alter table public.transactions disable trigger user;
insert into public.transactions(id,owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date)
values('a1150000-0000-4000-8000-000000000004','f0050000-0000-4000-8000-000000000001','f1150000-0000-4000-8000-000000000002','SAVINGS_CONTRIBUTION',1,'USD','2026-10-02'),
('a1150000-0000-4000-8000-000000000005','f0050000-0000-4000-8000-000000000001','f1150000-0000-4000-8000-000000000002','SAVINGS_CONTRIBUTION',1,'USD','2026-10-02');
alter table public.transactions enable trigger user;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','Legacy contribution uses client role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'Legacy contribution owner identity');
select throws_ok($$select public.get_savings_availability('f1150000-0000-4000-8000-000000000002')$$,'23514',null,'Legacy contribution is never silently assumed funded');
select is((select count(*) from public.transactions where id='a1150000-0000-4000-8000-000000000004'),1::bigint,'Unvalidated contribution remains readable in history');
select throws_ok($$select public.register_savings_movement('a1150000-0000-4000-8000-000000000004','f1150000-0000-4000-8000-000000000002','SAVINGS_CONTRIBUTION',1,'USD','2026-10-02')$$,'23505',null,'Legacy UUID replay cannot bypass funding validation');
select throws_ok($$select public.register_savings_movement(gen_random_uuid(),'f1150000-0000-4000-8000-000000000002','SAVINGS_WITHDRAWAL',1,'USD','2026-10-03',true)$$,'23514',null,'Legacy contribution cannot fund a new withdrawal');
select throws_ok($$update public.transactions set description='No implicit validation' where id='a1150000-0000-4000-8000-000000000004';set constraints all immediate$$,'23514',null,'Description update cannot bless legacy contribution');
select ok(not (select savings_validated from public.transactions where id='a1150000-0000-4000-8000-000000000004'),'Legacy validation stays false');
select throws_ok($$update public.transactions set deleted_at=now() where id='a1150000-0000-4000-8000-000000000004';set constraints all immediate$$,'23514',null,'Partial cleanup cannot leave another unvalidated active movement');
select is((select count(*) from public.transactions where type='SAVINGS_CONTRIBUTION' and deleted_at is null),2::bigint,'Partial cleanup rolls back without changing history');
select lives_ok($$update public.transactions set deleted_at=now() where id in ('a1150000-0000-4000-8000-000000000004','a1150000-0000-4000-8000-000000000005');set constraints all immediate$$,'Atomic legacy cleanup may recoverably remove all incompatible movements');
update public.transactions set deleted_at=now() where id='a1150000-0000-4000-8000-000000000002';
select throws_ok($$update public.transactions set deleted_at=null where id='a1150000-0000-4000-8000-000000000004'$$,'23514',null,'Unfunded legacy restoration is rejected');
select ok((select deleted_at is not null and not savings_validated from public.transactions where id='a1150000-0000-4000-8000-000000000004'),'Rejected restoration stays deleted and unvalidated');
update public.transactions set deleted_at=null where id='a1150000-0000-4000-8000-000000000002';
select lives_ok($$update public.transactions set deleted_at=null where id='a1150000-0000-4000-8000-000000000004'$$,'Explicit restoration validates source funding');
select ok((select savings_validated from public.transactions where id='a1150000-0000-4000-8000-000000000004'),'Only valid restoration supplies server validation evidence');
update public.transactions set deleted_at=now() where id='a1150000-0000-4000-8000-000000000004';
set constraints all immediate;
set constraints all deferred;
reset role;
select pg_temp.set_jwt_subject(null);
update public.transactions set amount_minor=9007199254740991 where type='INCOME';
update public.budget_allocations set percentage_basis_points=case when budget_bucket_id='b1150000-0000-4000-8000-000000000002' then 10000 else 0 end;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select throws_ok($$select public.get_savings_availability('f1150000-0000-4000-8000-000000000002')$$,'22003',null,'Cumulative overflow rejects rather than rounds');
reset role;
select * from finish();
rollback;
