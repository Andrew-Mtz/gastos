\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_catalog;
\ir helpers/auth.sql.inc
select no_plan();
insert into public.profiles(id,display_name,base_currency,timezone)
select id,'Synthetic','USD','UTC' from auth.users where id::text like 'f0050000%';
insert into public.budget_buckets(id,profile_id,name,type) values
 ('f1040000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','Needs','SPENDABLE');
insert into public.categories(id,profile_id,name,budget_bucket_id) values
 ('f1070000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','Electricity','f1040000-0000-4000-8000-000000000001'),
 ('f1070000-0000-4000-8000-000000000002','f0050000-0000-4000-8000-000000000001','Other','f1040000-0000-4000-8000-000000000001');
create function pg_temp.month(n integer default 0) returns date language sql stable as $$select (date_trunc('month',statement_timestamp() at time zone 'UTC')+make_interval(months=>n))::date$$;
create function pg_temp.resolve(id uuid, changes jsonb default '{}') returns uuid language plpgsql as $$
declare result public.transactions;
begin
 result:=public.resolve_personal_recurring_expense(id,
 coalesce((changes->>'template')::uuid,'f1170000-0000-4000-8000-000000000001'),
 coalesce((changes->>'period')::uuid,'f1030000-0000-4000-8000-000000000001'),
 coalesce((changes->>'month')::date,pg_temp.month()),coalesce((changes->>'amount')::bigint,284000),
 coalesce(changes->>'currency','USD'),coalesce((changes->>'date')::date,pg_temp.month()+1),changes->>'description');
 return result.id;
end;$$;
select ok(not has_column_privilege('authenticated','public.transactions',c,'UPDATE'),'Immutable recurrence '||c)
from unnest(array['recurring_template_id','recurring_month']) c;
select is(prosecdef,false,'Invoker '||proname) from pg_proc where proname in('resolve_personal_recurring_expense','get_personal_recurring_month','validate_recurring_resolution');
select ok(proconfig @> array['search_path=""'],'Empty search path '||proname) from pg_proc where proname in('resolve_personal_recurring_expense','get_personal_recurring_month','validate_recurring_resolution');
select ok(not has_function_privilege('anon','public.resolve_personal_recurring_expense(uuid,uuid,uuid,date,bigint,text,date,text)','EXECUTE'),'Anonymous cannot resolve');
select ok(not has_function_privilege('anon','public.get_personal_recurring_month(date)','EXECUTE'),'Anonymous cannot read recurring snapshot');
select ok(not has_function_privilege('authenticated','public.validate_recurring_resolution()','EXECUTE'),'Trigger has no direct execute');
insert into public.budget_periods(id,profile_id,starts_on,ends_on,base_currency) values
 ('f1030000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001',pg_temp.month(),(pg_temp.month()+interval '1 month -1 day')::date,'USD'),
 ('f1030000-0000-4000-8000-000000000002','f0050000-0000-4000-8000-000000000001',pg_temp.month(1),(pg_temp.month(1)+interval '1 month -1 day')::date,'USD');
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','A role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'A identity');
select public.create_personal_recurring_expense('f1170000-0000-4000-8000-000000000001','Electricity','f1070000-0000-4000-8000-000000000001','VARIABLE','USD',31,pg_temp.month());
select public.create_personal_recurring_expense('f1170000-0000-4000-8000-000000000002','Fixed','f1070000-0000-4000-8000-000000000001','FIXED','USD',1,pg_temp.month(),null,100);
select public.create_personal_recurring_expense('f1170000-0000-4000-8000-000000000003','Bounded','f1070000-0000-4000-8000-000000000001','VARIABLE','USD',1,pg_temp.month(1),pg_temp.month(1),0);
select is((public.get_personal_recurring_month(pg_temp.month())->'items'->0->'transaction'),'null'::jsonb,'Pending template has no actual');
select is((select count(*) from public.transactions),0::bigint,'No generated expenses');
select lives_ok($$select pg_temp.resolve('f1180000-0000-4000-8000-000000000001')$$,'Resolve known amount');
select lives_ok($$select pg_temp.resolve('f1180000-0000-4000-8000-000000000001')$$,'Exact request replay');
select is((select count(*) from public.transactions),1::bigint,'Only one actual');
select is((select amount_minor from public.transactions),284000::bigint,'Actual amount, not estimate');
select is((select recurring_month from public.transactions),pg_temp.month(),'Canonical occurrence month');
select is(public.get_bucket_consumption('f1030000-0000-4000-8000-000000000001')->'buckets'->0->>'spent_minor','284000','Consumption once');
select throws_ok($$select pg_temp.resolve('f1180000-0000-4000-8000-000000000002')$$,'23505',null,'Different UUID same occurrence rejected atomically');
select is((select count(*) from public.transactions),1::bigint,'Conflict creates no orphan actual');
select throws_ok(format($$select pg_temp.resolve('f1180000-0000-4000-8000-000000000001',%L::jsonb)$$,v),'23505',null,'Changed replay rejected: '||v::text)
from unnest(array['{"amount":1}','{"currency":"EUR"}','{"description":"Changed"}','{"template":"f1170000-0000-4000-8000-000000000002"}','{"period":"f1030000-0000-4000-8000-000000000002"}']::jsonb[]) v;
select throws_ok($$select pg_temp.resolve(gen_random_uuid(),'{"template":"f1170000-0000-4000-8000-000000000002"}')$$,'23514',null,'Fixed resolution requires exact fixed amount');
select throws_ok($$select pg_temp.resolve(gen_random_uuid(),'{"template":"f1170000-0000-4000-8000-000000000003"}')$$,'23514',null,'Before activation rejected');
select throws_ok($$select pg_temp.resolve(gen_random_uuid(),jsonb_build_object('month',pg_temp.month()+1))$$,'23514',null,'Noncanonical month rejected');
select throws_ok($$select pg_temp.resolve(gen_random_uuid(),jsonb_build_object('date',pg_temp.month(1)))$$,'23514',null,'Actual date outside month rejected');
select throws_ok($$select pg_temp.resolve(gen_random_uuid(),'{"currency":"EUR"}')$$,'23514',null,'Currency mismatch rejected');
select throws_ok(format($$select pg_temp.resolve(gen_random_uuid(),%L::jsonb)$$,v),'23514',null,'Invalid actual amount '||v::text)
from unnest(array['{"amount":0}','{"amount":-1}','{"amount":9007199254740992}']::jsonb[]) v;
select throws_ok($$insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date,category_id,recurring_template_id,recurring_month)
 values(auth.uid(),'f1030000-0000-4000-8000-000000000002','EXPENSE',1,'USD',pg_temp.month(1),'f1070000-0000-4000-8000-000000000002','f1170000-0000-4000-8000-000000000001',pg_temp.month(1))$$,'23514',null,'Direct link cannot forge category');
select throws_ok($$insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date,category_id,recurring_template_id,recurring_month)
 values(auth.uid(),'f1030000-0000-4000-8000-000000000002','EXPENSE',1,'USD',pg_temp.month(1),'f1070000-0000-4000-8000-000000000001','f1170000-0000-4000-8000-000000000001',pg_temp.month())$$,'23514',null,'Direct link cannot forge month');
-- Direct clients cannot bypass the resolver with a forged classification or partial pair.
select throws_ok($$insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date,category_id,recurring_template_id,recurring_month)
 values(auth.uid(),'f1030000-0000-4000-8000-000000000002','EXPENSE',1,'EUR',pg_temp.month(1),'f1070000-0000-4000-8000-000000000001','f1170000-0000-4000-8000-000000000003',pg_temp.month(1))$$,'23514',null,'Direct link requires original currency');
select throws_ok($$insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date,category_id,recurring_template_id,recurring_month)
 values(auth.uid(),'f1030000-0000-4000-8000-000000000002','EXPENSE',1,'USD',pg_temp.month(1),'f1070000-0000-4000-8000-000000000001','f1170000-0000-4000-8000-000000000002',pg_temp.month(1))$$,'23514',null,'Direct fixed link requires exact amount');
select throws_ok($$insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date,category_id,recurring_month)
 values(auth.uid(),'f1030000-0000-4000-8000-000000000002','EXPENSE',1,'USD',pg_temp.month(1),'f1070000-0000-4000-8000-000000000001',pg_temp.month(1))$$,'23514',null,'Direct occurrence month requires template');
select throws_ok($$insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date,category_id,recurring_template_id)
 values(auth.uid(),'f1030000-0000-4000-8000-000000000002','EXPENSE',1,'USD',pg_temp.month(1),'f1070000-0000-4000-8000-000000000001','f1170000-0000-4000-8000-000000000003')$$,'23514',null,'Direct template requires occurrence month');
select throws_ok($$update public.transactions set recurring_template_id=null$$,'42501',null,'Actual cannot be unlinked');
select throws_ok($$update public.transactions set recurring_month=pg_temp.month(1)$$,'42501',null,'Occurrence cannot move');
update public.transactions set deleted_at=now() where id='f1180000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.resolve(gen_random_uuid())$$,'23505',null,'Unique monthly identity includes tombstones while template is active');
update public.transactions set deleted_at=null where id='f1180000-0000-4000-8000-000000000001';
select public.stop_personal_recurring_expense('f1170000-0000-4000-8000-000000000001',pg_temp.month());
select lives_ok($$select pg_temp.resolve('f1180000-0000-4000-8000-000000000001')$$,'Replay survives later stop');
select is((select count(*) from jsonb_array_elements(public.get_personal_recurring_month(pg_temp.month())->'items') i where i->'transaction'->>'id'='f1180000-0000-4000-8000-000000000001'),1::bigint,'Stopped actual history remains visible');
update public.transactions set deleted_at=now() where id='f1180000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.resolve('f1180000-0000-4000-8000-000000000001')$$,'23505',null,'Replay cannot revive cancelled occurrence');
select is((select count(*) from jsonb_array_elements(public.get_personal_recurring_month(pg_temp.month())->'items') i where i->'transaction'->>'deleted_at' is not null),1::bigint,'Cancelled state remains visible');
select lives_ok($$update public.transactions set deleted_at=null where id='f1180000-0000-4000-8000-000000000001'$$,'Explicit same-ID restore remains possible after stop');
select throws_ok($$select pg_temp.resolve(gen_random_uuid(),jsonb_build_object('period','f1030000-0000-4000-8000-000000000002','month',pg_temp.month(1),'date',pg_temp.month(1)))$$,'23514',null,'New stopped occurrence rejected');
update public.categories set archived_at=now() where id='f1070000-0000-4000-8000-000000000001';
select lives_ok($$select pg_temp.resolve('f1180000-0000-4000-8000-000000000001')$$,'Exact replay survives category archive');
select throws_ok($$select pg_temp.resolve(gen_random_uuid(),jsonb_build_object('template','f1170000-0000-4000-8000-000000000003','period','f1030000-0000-4000-8000-000000000002','month',pg_temp.month(1),'date',pg_temp.month(1)))$$,'42501',null,'New actual requires active category');
update public.transactions set deleted_at=now() where id='f1180000-0000-4000-8000-000000000001';
select throws_ok($$update public.transactions set deleted_at=null where id='f1180000-0000-4000-8000-000000000001'$$,'42501',null,'Restore still requires active category');
update public.categories set archived_at=null where id='f1070000-0000-4000-8000-000000000001';
update public.transactions set deleted_at=null where id='f1180000-0000-4000-8000-000000000001';
select throws_ok($$select public.get_personal_recurring_month(pg_temp.month()+1)$$,'23514',null,'Read requires canonical month');
insert into public.recurring_expenses(owner_profile_id,name,category_id,amount_mode,currency,due_day,active_from)
select auth.uid(),'Synthetic overflow '||n,'f1070000-0000-4000-8000-000000000001','VARIABLE','USD',1,pg_temp.month(1)
from generate_series(1,1001) n;
select is(jsonb_array_length(public.get_personal_recurring_month(pg_temp.month())->'items'),1004,'Scalar snapshot is complete beyond Data API row caps');

reset role;
update public.budget_periods set status='CLOSED',closed_at=now() where id='f1030000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','A role after fixture');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'A identity after fixture');
select lives_ok($$select pg_temp.resolve('f1180000-0000-4000-8000-000000000001')$$,'Closed-period exact replay is read-only');
select throws_ok($$select pg_temp.resolve(gen_random_uuid())$$,'42501',null,'Closed period rejects new actual');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000002');
select is(current_user::text,'authenticated','Partner B role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000002'::uuid,'B identity');
select is(jsonb_array_length(public.get_personal_recurring_month(pg_temp.month())->'items'),0,'B snapshot has no A data');
select is((select count(*) from public.transactions),0::bigint,'B cannot read linked transactions');
select throws_ok($$select pg_temp.resolve('f1180000-0000-4000-8000-000000000001')$$,'42501',null,'B cannot resolve or replay A');
select throws_ok($$insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date,category_id,recurring_template_id,recurring_month)
 values('f0050000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000002','EXPENSE',1,'USD',pg_temp.month(1),'f1070000-0000-4000-8000-000000000001','f1170000-0000-4000-8000-000000000003',pg_temp.month(1))$$,'42501',null,'B direct forged ownership denied');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000003');
select is(current_user::text,'authenticated','Unrelated C role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000003'::uuid,'C identity');
select is(jsonb_array_length(public.get_personal_recurring_month(pg_temp.month())->'items'),0,'C snapshot has no A data');
select throws_ok($$select pg_temp.resolve(gen_random_uuid())$$,'42501',null,'C cannot resolve A');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject(null);
select is(current_user::text,'authenticated','Missing-subject role');
select is(auth.uid(),null::uuid,'Missing subject');
select throws_ok($$select public.get_personal_recurring_month(pg_temp.month())$$,'42501',null,'Identity required for read');
select throws_ok($$select pg_temp.resolve(gen_random_uuid())$$,'42501',null,'Identity required for resolve');
reset role;
select * from finish();
rollback;
