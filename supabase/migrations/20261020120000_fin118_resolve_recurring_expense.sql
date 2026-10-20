-- ADR-071: the actual transaction is the resolved occurrence, not a second ledger.
alter table public.transactions
  add column recurring_template_id uuid,
  add column recurring_month date,
  add constraint transactions_recurring_pair_check check (
    (recurring_template_id is null and recurring_month is null) or
    (recurring_template_id is not null and recurring_month is not null and type='EXPENSE'
      and recurring_month between date '0001-01-01' and date '9999-12-01'
      and extract(day from recurring_month)=1)),
  add constraint transactions_recurring_owner_fkey foreign key (recurring_template_id, owner_profile_id)
    references public.recurring_expenses(id,owner_profile_id) on delete restrict,
  add constraint transactions_recurring_occurrence_key unique(owner_profile_id,recurring_template_id,recurring_month);
grant insert(recurring_template_id,recurring_month) on public.transactions to authenticated;

create function public.validate_recurring_resolution()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare template public.recurring_expenses; period_month date;
begin
  if new.recurring_template_id is null then return new; end if;
  if tg_op='UPDATE' then
    -- Existing linkage survives explicit soft deletion/restore and later stop.
    if new.recurring_template_id is distinct from old.recurring_template_id
      or new.recurring_month is distinct from old.recurring_month then
      raise exception 'Recurring linkage is immutable' using errcode='23514';
    end if;
    return new;
  end if;
  select * into template from public.recurring_expenses
    where id=new.recurring_template_id and owner_profile_id=auth.uid();
  if not found or new.owner_profile_id is distinct from auth.uid() then
    raise exception 'An owned recurring template is required' using errcode='42501';
  end if;
  select starts_on into period_month from public.budget_periods where id=new.budget_period_id;
  if template.amount_mode <> 'VARIABLE' or new.type <> 'EXPENSE'
    or new.recurring_month is distinct from period_month
    or new.currency is distinct from template.currency
    or new.category_id is distinct from template.category_id
    or new.recurring_month < template.active_from
    or (template.active_until is not null and new.recurring_month > template.active_until)
    or (template.stopped_from is not null and new.recurring_month >= template.stopped_from) then
    raise exception 'An eligible variable occurrence in its original month, currency and category is required' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_recurring_resolution() from public,anon,authenticated;
create trigger transactions_validate_recurring before insert or update on public.transactions
for each row execute function public.validate_recurring_resolution();

create function public.resolve_personal_recurring_expense(
  p_transaction_id uuid, p_template_id uuid, p_budget_period_id uuid,
  p_month date, p_amount_minor bigint, p_currency text, p_transaction_date date,
  p_description text default null
) returns public.transactions language plpgsql security invoker set search_path = '' as $$
declare result public.transactions; template public.recurring_expenses;
begin
  if auth.uid() is null or p_transaction_id is null or p_template_id is null then
    raise exception 'Authenticated resolution identity is required' using errcode='42501';
  end if;
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Recurring writes require READ COMMITTED isolation' using errcode='0A000';
  end if;
  perform public.lock_personal_finance();
  select * into template from public.recurring_expenses where id=p_template_id and owner_profile_id=auth.uid();
  if not found then
    raise exception 'An owned recurring template is required' using errcode='42501';
  end if;
  select * into result from public.transactions where id=p_transaction_id;
  if not found then
    insert into public.transactions(id,owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date,category_id,description,recurring_template_id,recurring_month)
      values(p_transaction_id,auth.uid(),p_budget_period_id,'EXPENSE',p_amount_minor,p_currency,p_transaction_date,template.category_id,p_description,p_template_id,p_month)
      on conflict(id) do nothing;
    select * into result from public.transactions where id=p_transaction_id;
  end if;
  if result.id is null or result.owner_profile_id is distinct from auth.uid()
    or result.recurring_template_id is distinct from p_template_id
    or result.recurring_month is distinct from p_month
    or result.type is distinct from 'EXPENSE' or result.budget_period_id is distinct from p_budget_period_id
    or result.amount_minor is distinct from p_amount_minor or result.currency is distinct from p_currency
    or result.transaction_date is distinct from p_transaction_date or result.category_id is distinct from template.category_id
    or result.description is distinct from p_description or result.deleted_at is not null then
    raise exception 'Resolution identity conflicts with an existing registration' using errcode='23505';
  end if;
  return result;
end;
$$;
revoke all on function public.resolve_personal_recurring_expense(uuid,uuid,uuid,date,bigint,text,date,text) from public,anon,authenticated;
grant execute on function public.resolve_personal_recurring_expense(uuid,uuid,uuid,date,bigint,text,date,text) to authenticated;

-- One scalar snapshot is complete beyond the API row cap. Stopped definitions and
-- deleted actuals remain visible; the client never interprets them as new pending bills.
create function public.get_personal_recurring_month(p_month date)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_month is null or p_month < date '0001-01-01' or p_month > date '9999-12-01' or extract(day from p_month) <> 1 then
    raise exception 'A canonical calendar month is required' using errcode='23514';
  end if;
  select jsonb_build_object('owner_profile_id',auth.uid(),'month',p_month,
    'items',coalesce((select jsonb_agg(jsonb_build_object('template',to_jsonb(r),'transaction',to_jsonb(t)) order by r.name,r.id)
      from public.recurring_expenses r left join public.transactions t
        on t.recurring_template_id=r.id and t.owner_profile_id=r.owner_profile_id and t.recurring_month=p_month
      where r.owner_profile_id=auth.uid()),'[]'::jsonb),
    'categories',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'profile_id',c.profile_id,'name',c.name,'budget_bucket_id',c.budget_bucket_id,'archived_at',c.archived_at) order by c.name,c.id)
      from public.categories c join public.budget_buckets b on b.id=c.budget_bucket_id and b.profile_id=c.profile_id
      where c.profile_id=auth.uid() and c.archived_at is null and b.archived_at is null and b.type='SPENDABLE'),'[]'::jsonb)) into result;
  return result;
end;
$$;
revoke all on function public.get_personal_recurring_month(date) from public,anon,authenticated;
grant execute on function public.get_personal_recurring_month(date) to authenticated;
