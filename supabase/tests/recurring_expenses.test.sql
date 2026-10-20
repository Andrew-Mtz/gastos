\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
\ir helpers/auth.sql.inc
select no_plan();
insert into public.profiles(id,display_name,base_currency,timezone)
select id,'Synthetic','USD','Pacific/Kiritimati' from auth.users where id::text like 'f0050000%';
insert into public.budget_buckets(id,profile_id,name,type,archived_at) values
 ('f1040000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','Needs','SPENDABLE',null),
 ('f1040000-0000-4000-8000-000000000002','f0050000-0000-4000-8000-000000000002','Private','SPENDABLE',null),
 ('f1040000-0000-4000-8000-000000000003','f0050000-0000-4000-8000-000000000001','Savings','SAVINGS',null),
 ('f1040000-0000-4000-8000-000000000004','f0050000-0000-4000-8000-000000000001','Archived','SPENDABLE',now());
insert into public.categories(id,profile_id,name,budget_bucket_id,archived_at) values
 ('f1070000-0000-4000-8000-000000000001','f0050000-0000-4000-8000-000000000001','Rent','f1040000-0000-4000-8000-000000000001',null),
 ('f1070000-0000-4000-8000-000000000002','f0050000-0000-4000-8000-000000000002','Private','f1040000-0000-4000-8000-000000000002',null),
 ('f1070000-0000-4000-8000-000000000003','f0050000-0000-4000-8000-000000000001','Savings','f1040000-0000-4000-8000-000000000003',null),
 ('f1070000-0000-4000-8000-000000000004','f0050000-0000-4000-8000-000000000001','Unmapped',null,null),
 ('f1070000-0000-4000-8000-000000000005','f0050000-0000-4000-8000-000000000001','Archived','f1040000-0000-4000-8000-000000000001',now()),
 ('f1070000-0000-4000-8000-000000000006','f0050000-0000-4000-8000-000000000001','Archived bucket','f1040000-0000-4000-8000-000000000004',null);
create function pg_temp.month(offset_months integer default 0) returns date language sql stable as $$
  select (date_trunc('month', statement_timestamp() at time zone 'Pacific/Kiritimati') + make_interval(months=>offset_months))::date
$$;
create function pg_temp.template(p_id uuid, changes jsonb default '{}') returns uuid language plpgsql as $$
declare result public.recurring_expenses;
begin
  result := public.create_personal_recurring_expense(p_id,coalesce(changes->>'name','Rent'),
    coalesce((changes->>'category_id')::uuid,'f1070000-0000-4000-8000-000000000001'),
    coalesce(changes->>'amount_mode','FIXED'),
    case when changes ? 'amount' then (changes->>'amount')::bigint else 120000 end,
    coalesce(changes->>'currency','USD'),coalesce((changes->>'due_day')::integer,31),
    coalesce((changes->>'active_from')::date,pg_temp.month()),(changes->>'active_until')::date);
  return result.id;
end;
$$;
select ok((select relrowsecurity from pg_class where oid='public.recurring_expenses'::regclass),'Template RLS enabled');
select ok(not has_table_privilege('authenticated','public.recurring_expenses',p),'No broad '||p)
from unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p;
select ok(not has_column_privilege('authenticated','public.recurring_expenses',c,'UPDATE'),'Immutable '||c)
from unnest(array['id','owner_profile_id','scope','name','category_id','frequency','amount_mode','default_amount_minor','currency','due_day','active_from','active_until','created_at','stopped_at']) c;
select ok(not has_column_privilege('authenticated','public.recurring_expenses',c,'INSERT'),'Server supplies '||c)
from unnest(array['scope','frequency','stopped_from','created_at','stopped_at']) c;
select is(prosecdef,false,'Invoker function '||proname) from pg_proc where proname in
 ('validate_personal_recurring_expense','create_personal_recurring_expense','stop_personal_recurring_expense');
select ok(proconfig @> array['search_path=""'],'Empty search path '||proname) from pg_proc where proname in
 ('validate_personal_recurring_expense','create_personal_recurring_expense','stop_personal_recurring_expense');
select ok(not has_function_privilege('authenticated','public.validate_personal_recurring_expense()','EXECUTE'),'Trigger cannot be called directly');
select ok(not has_function_privilege('anon','public.create_personal_recurring_expense(uuid,text,uuid,text,bigint,text,integer,date,date)','EXECUTE'),'Anonymous cannot create via RPC');
select ok(not has_function_privilege('anon','public.stop_personal_recurring_expense(uuid,date)','EXECUTE'),'Anonymous cannot stop via RPC');
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','A client role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'A identity');
-- Existing actual finance must remain unchanged by every template operation.
insert into public.budget_periods(profile_id,starts_on,ends_on,base_currency)
values(auth.uid(),pg_temp.month(),(pg_temp.month()+interval '1 month -1 day')::date,'USD');
select set_config('test.period',(select id::text from public.budget_periods where starts_on=pg_temp.month()),true);
select public.register_income('f1090000-0000-4000-8000-000000000001',current_setting('test.period')::uuid,200000,'USD',pg_temp.month(),null);
select public.register_personal_expense('f1110000-0000-4000-8000-000000000001',current_setting('test.period')::uuid,1000,'USD',pg_temp.month(),'f1070000-0000-4000-8000-000000000001',null);
select set_config('test.savings_before',public.get_savings_availability(current_setting('test.period')::uuid)::text,true);
select set_config('test.consumption_before',public.get_bucket_consumption(current_setting('test.period')::uuid)::text,true);
select lives_ok($$select pg_temp.template('f1170000-0000-4000-8000-000000000001')$$,'Create fixed template');
select lives_ok($$select pg_temp.template('f1170000-0000-4000-8000-000000000002','{"amount_mode":"VARIABLE","amount":null,"currency":"UYU"}')$$,'Variable unknown and independent currency');
select lives_ok($$select pg_temp.template('f1170000-0000-4000-8000-000000000003','{"amount_mode":"VARIABLE","amount":0}')$$,'Variable explicit zero estimate');
select lives_ok($$select pg_temp.template('f1170000-0000-4000-8000-000000000004','{"amount":9007199254740991}')$$,'Maximum safe fixed amount');
select is((select count(*) from public.recurring_expenses),4::bigint,'Owner reads all templates');
select is((select default_amount_minor from public.recurring_expenses where id='f1170000-0000-4000-8000-000000000002'),null::bigint,'Unknown estimate stays null');
select is((select default_amount_minor from public.recurring_expenses where id='f1170000-0000-4000-8000-000000000003'),0::bigint,'Zero estimate stays zero');
select lives_ok($$select pg_temp.template('f1170000-0000-4000-8000-000000000001')$$,'Exact create replay');
select is((select count(*) from public.recurring_expenses),4::bigint,'Retry does not duplicate');
select throws_ok($$select pg_temp.template('f1170000-0000-4000-8000-000000000001','{"amount":1}')$$,'23505',null,'Conflicting replay cannot overwrite');
select throws_ok(format($$select pg_temp.template('f1170000-0000-4000-8000-000000000005',%L::jsonb)$$,v),'23514',null,'Invalid scalar values are rejected: '||v)
from unnest(array['{"amount":null}','{"amount":0}','{"amount":-1}','{"amount":9007199254740992}',
 '{"name":""}','{"name":" "}','{"name":" Rent"}','{"currency":"usd"}',
 '{"due_day":0}','{"due_day":32}','{"amount_mode":"OTHER"}',
 '{"active_from":"0001-01-01"}','{"active_from":"infinity"}','{"active_until":"infinity"}',
 '{"active_until":"0001-01-01"}']::jsonb[]) v;
select throws_ok($$select pg_temp.template('f1170000-0000-4000-8000-000000000005',jsonb_build_object('active_from',(pg_temp.month()+1)::text))$$,'23514',null,'Noncanonical start rejected');
select throws_ok($$select pg_temp.template('f1170000-0000-4000-8000-000000000005',jsonb_build_object('active_from',pg_temp.month(-1)::text))$$,'23514',null,'Past activation rejected using financial timezone');
select throws_ok(format($$select pg_temp.template('f1170000-0000-4000-8000-000000000005','{"category_id":"%s"}')$$,c),'42501',null,'Ineligible category '||c)
from unnest(array['f1070000-0000-4000-8000-000000000002','f1070000-0000-4000-8000-000000000003','f1070000-0000-4000-8000-000000000004','f1070000-0000-4000-8000-000000000005','f1070000-0000-4000-8000-000000000006','f1070000-0000-4000-8000-000000000099']) c;
select throws_ok($$insert into public.recurring_expenses(owner_profile_id,name,category_id,amount_mode,default_amount_minor,currency,due_day,active_from)
 values('f0050000-0000-4000-8000-000000000002','Forgery','f1070000-0000-4000-8000-000000000002','FIXED',1,'USD',1,pg_temp.month())$$,'42501',null,'Direct forged owner denied');
select lives_ok($$insert into public.recurring_expenses(id,owner_profile_id,name,category_id,amount_mode,default_amount_minor,currency,due_day,active_from,active_until)
 values('f1170000-0000-4000-8000-000000000005',auth.uid(),'Bounded','f1070000-0000-4000-8000-000000000001','FIXED',1,'USD',1,pg_temp.month(1),pg_temp.month(1))$$,'Direct owner creation supports one future month');
select throws_ok($$update public.recurring_expenses set default_amount_minor=1$$,'42501',null,'Cannot edit amounts');
select throws_ok($$update public.recurring_expenses set owner_profile_id='f0050000-0000-4000-8000-000000000002'$$,'42501',null,'Cannot reassign ownership');
select throws_ok($$update public.recurring_expenses set stopped_at=now()$$,'42501',null,'Cannot forge stop provenance');
select throws_ok($$delete from public.recurring_expenses$$,'42501',null,'No physical deletion');
select throws_ok($$truncate public.recurring_expenses$$,'42501',null,'No truncate');
select lives_ok($$select public.stop_personal_recurring_expense('f1170000-0000-4000-8000-000000000001',pg_temp.month(2))$$,'Explicit prospective stop');
select set_config('test.stop_time',(select stopped_at::text from public.recurring_expenses where id='f1170000-0000-4000-8000-000000000001'),true);
select lives_ok($$select public.stop_personal_recurring_expense('f1170000-0000-4000-8000-000000000001',pg_temp.month(2))$$,'Exact stop replay');
select lives_ok($$update public.recurring_expenses set stopped_from=pg_temp.month(1) where id='f1170000-0000-4000-8000-000000000001'$$,'Direct stop may shorten further');
select is((select stopped_at::text from public.recurring_expenses where id='f1170000-0000-4000-8000-000000000001'),current_setting('test.stop_time'),'Original stop provenance preserved');
select throws_ok($$select public.stop_personal_recurring_expense('f1170000-0000-4000-8000-000000000001',pg_temp.month(2))$$,'23514',null,'Cannot extend a stop');
select throws_ok($$update public.recurring_expenses set stopped_from=null where id='f1170000-0000-4000-8000-000000000001'$$,'23514',null,'Cannot clear a stop');
select throws_ok($$select public.stop_personal_recurring_expense('f1170000-0000-4000-8000-000000000001',pg_temp.month(-1))$$,'23514',null,'Cannot rewrite a historical month');
select throws_ok($$select public.stop_personal_recurring_expense('f1170000-0000-4000-8000-000000000002',pg_temp.month()+1)$$,'23514',null,'Stop must be canonical month');
select lives_ok($$select public.stop_personal_recurring_expense('f1170000-0000-4000-8000-000000000005',pg_temp.month())$$,'Cancel future mistaken template before activation');
select is((select active_from from public.recurring_expenses where id='f1170000-0000-4000-8000-000000000005'),pg_temp.month(1),'Cancel preserves original activation');
-- Archival of references preserves the definition; exact retry is not new creation.
update public.categories set archived_at=now() where id='f1070000-0000-4000-8000-000000000001';
update public.budget_buckets set archived_at=now() where id='f1040000-0000-4000-8000-000000000001';
select lives_ok($$select pg_temp.template('f1170000-0000-4000-8000-000000000001')$$,'Create replay does not reactivate stopped definition after archival');
select is((select stopped_from from public.recurring_expenses where id='f1170000-0000-4000-8000-000000000001'),pg_temp.month(1),'Create replay preserves stop');
select is((select count(*) from public.recurring_expenses r join public.categories c on c.id=r.category_id),5::bigint,'Archived mappings and stopped templates remain readable');
select is(public.get_savings_availability(current_setting('test.period')::uuid)::text,current_setting('test.savings_before'),'Template creation/stopping never changes savings or ordinary availability');
select is(public.get_bucket_consumption(current_setting('test.period')::uuid)::text,current_setting('test.consumption_before'),'No double-counted template spending');
select is((select count(*) from public.transactions),2::bigint,'Actual income and expense are unchanged');
update public.categories set archived_at=null where id='f1070000-0000-4000-8000-000000000001';
update public.budget_buckets set archived_at=null where id='f1040000-0000-4000-8000-000000000001';
reset role;
-- A trusted fixture closes the current month; ordinary clients have no lifecycle grant yet.
update public.budget_periods set status='CLOSED',closed_at=now() where id=current_setting('test.period')::uuid;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','A role after fixture');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'A subject after fixture');
select throws_ok($$select pg_temp.template('f1170000-0000-4000-8000-000000000006')$$,'23514',null,'Creation cannot add closed-month obligation');
select throws_ok($$select public.stop_personal_recurring_expense('f1170000-0000-4000-8000-000000000002',pg_temp.month())$$,'23514',null,'Stop cannot remove closed-month obligation');
select lives_ok($$select public.stop_personal_recurring_expense('f1170000-0000-4000-8000-000000000002',pg_temp.month(1))$$,'Stop after a closed month preserves it');
select lives_ok($$select pg_temp.template('f1170000-0000-4000-8000-000000000001')$$,'Exact create replay in closed period is read-only');
select lives_ok($$select pg_temp.template('f1170000-0000-4000-8000-000000000006',jsonb_build_object('active_from',pg_temp.month(1)))$$,'Future schedule does not change closed month');
select lives_ok($$select public.stop_personal_recurring_expense('f1170000-0000-4000-8000-000000000005',pg_temp.month())$$,'Already completed stop replay survives closure');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000002');
select is(current_user::text,'authenticated','Partner persona B role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000002'::uuid,'B identity');
select is((select count(*) from public.recurring_expenses),0::bigint,'B cannot read A templates including stopped ones');
select results_eq($$update public.recurring_expenses set stopped_from=pg_temp.month() returning id$$,array[]::uuid[],'B cannot stop A through direct writes');
select throws_ok($$select public.stop_personal_recurring_expense('f1170000-0000-4000-8000-000000000001',pg_temp.month())$$,'42501',null,'B cannot stop A via RPC');
select throws_ok($$select pg_temp.template('f1170000-0000-4000-8000-000000000001','{"category_id":"f1070000-0000-4000-8000-000000000002"}')$$,'23505',null,'Foreign UUID collision returns no private template');
select lives_ok($$select pg_temp.template('f1170000-0000-4000-8000-000000000007','{"category_id":"f1070000-0000-4000-8000-000000000002"}')$$,'B can create own independent template');
select is((select count(*) from public.recurring_expenses),1::bigint,'B sees only own template');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000003');
select is(current_user::text,'authenticated','Unrelated C role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000003'::uuid,'C identity');
select is((select count(*) from public.recurring_expenses),0::bigint,'C cannot read A or B');
select results_eq($$update public.recurring_expenses set stopped_from=pg_temp.month() returning id$$,array[]::uuid[],'C cannot stop private templates');
select throws_ok($$select public.stop_personal_recurring_expense('f1170000-0000-4000-8000-000000000001',pg_temp.month())$$,'42501',null,'C cannot invoke private stop');
select throws_ok($$select pg_temp.template('f1170000-0000-4000-8000-000000000008')$$,'42501',null,'C cannot forge A category');
-- Household schema is not present yet; B is a partner persona, not fabricated membership proof.
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject(null);
select is(current_user::text,'authenticated','Missing-subject client role');
select is(auth.uid(),null::uuid,'Missing subject');
select is((select count(*) from public.recurring_expenses),0::bigint,'Role without identity sees no data');
select throws_ok($$select pg_temp.template('f1170000-0000-4000-8000-000000000008')$$,'42501',null,'Missing identity cannot create');
select throws_ok($$select public.stop_personal_recurring_expense('f1170000-0000-4000-8000-000000000001',pg_temp.month())$$,'42501',null,'Missing identity cannot stop');
reset role;
set local role anon;
select pg_temp.set_jwt_subject(null);
select is(current_user::text,'anon','Anonymous role');
select is(auth.uid(),null::uuid,'Anonymous subject');
select throws_ok($$select * from public.recurring_expenses$$,'42501',null,'No anonymous reads');
select throws_ok($$update public.recurring_expenses set stopped_from=pg_temp.month()$$,'42501',null,'No anonymous writes');
reset role;
select * from finish();
rollback;
