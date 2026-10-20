-- ADR-070: definitions are planning data, never actual transactions.
create table public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references public.profiles(id) on delete restrict,
  scope text not null default 'PERSONAL' check (scope = 'PERSONAL'),
  name text not null check (name = btrim(name) and char_length(name) between 1 and 120 and name ~ '[^[:space:]]' and name !~ '^[[:space:]]|[[:space:]]$'),
  category_id uuid not null,
  frequency text not null default 'MONTHLY' check (frequency = 'MONTHLY'),
  amount_mode text not null check (amount_mode in ('FIXED','VARIABLE')),
  default_amount_minor bigint check (default_amount_minor between 0 and 9007199254740991),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  due_day integer not null check (due_day between 1 and 31),
  active_from date not null check (active_from between date '0001-01-01' and date '9999-12-01' and extract(day from active_from) = 1),
  active_until date check (active_until between date '0001-01-01' and date '9999-12-01' and extract(day from active_until) = 1),
  stopped_from date check (stopped_from between date '0001-01-01' and date '9999-12-01' and extract(day from stopped_from) = 1),
  created_at timestamptz not null default statement_timestamp(),
  stopped_at timestamptz,
  constraint recurring_expenses_fixed_amount_check check (amount_mode <> 'FIXED' or (default_amount_minor is not null and default_amount_minor > 0)),
  constraint recurring_expenses_month_range_check check (active_until is null or active_until >= active_from),
  constraint recurring_expenses_stop_provenance_check check ((stopped_from is null) = (stopped_at is null)),
  constraint recurring_expenses_category_owner_fkey foreign key (category_id, owner_profile_id)
    references public.categories(id, profile_id) on delete restrict,
  unique(id, owner_profile_id)
);
create index recurring_expenses_owner_month_idx on public.recurring_expenses(owner_profile_id, active_from, id);
create index recurring_expenses_category_idx on public.recurring_expenses(category_id);
alter table public.recurring_expenses enable row level security;
revoke all on public.recurring_expenses from public, anon, authenticated;
grant select on public.recurring_expenses to authenticated;
grant insert(id, owner_profile_id, name, category_id, amount_mode, default_amount_minor, currency, due_day, active_from, active_until)
  on public.recurring_expenses to authenticated;
grant update(stopped_from) on public.recurring_expenses to authenticated;
create policy recurring_expenses_select_own on public.recurring_expenses for select to authenticated
  using (owner_profile_id = (select auth.uid()));
create policy recurring_expenses_insert_own on public.recurring_expenses for insert to authenticated
  with check (owner_profile_id = (select auth.uid()));
create policy recurring_expenses_stop_own on public.recurring_expenses for update to authenticated
  using (owner_profile_id = (select auth.uid())) with check (owner_profile_id = (select auth.uid()));

-- Period lifecycle writes and template eligibility checks must share a lock.
-- No client lifecycle permission is granted here; FIN-123/124 retain this guard.
create trigger budget_periods_lock_owner before insert or update on public.budget_periods
for each statement execute function public.lock_personal_finance_write();
create trigger recurring_expenses_lock_owner before insert or update on public.recurring_expenses
for each statement execute function public.lock_personal_finance_write();

create function public.validate_personal_recurring_expense()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare current_month date; changed_from date;
begin
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Recurring writes require READ COMMITTED isolation' using errcode='0A000';
  end if;
  if new.owner_profile_id is distinct from auth.uid() then
    raise exception 'An owned recurring template is required' using errcode='42501';
  end if;
  select pg_catalog.date_trunc('month', pg_catalog.statement_timestamp() at time zone timezone)::date
    into current_month from public.profiles where id=auth.uid();
  if current_month is null then
    raise exception 'An owned profile is required' using errcode='42501';
  end if;
  if tg_op = 'INSERT' then
    changed_from := new.active_from;
    if new.active_from < current_month then
      raise exception 'A recurring template cannot begin before the current financial month' using errcode='23514';
    end if;
    if not exists (
      select 1 from public.categories c join public.budget_buckets b on b.id=c.budget_bucket_id
      where c.id=new.category_id and c.profile_id=new.owner_profile_id
        and b.profile_id=new.owner_profile_id and c.archived_at is null
        and b.archived_at is null and b.type='SPENDABLE'
    ) then
      raise exception 'An active owned category mapped to a spendable bucket is required' using errcode='42501';
    end if;
  else
    if new.stopped_from is not distinct from old.stopped_from then
      return old;
    end if;
    if new.stopped_from is null or new.stopped_from < current_month
      or (old.stopped_from is not null and new.stopped_from > old.stopped_from) then
      raise exception 'A stop may only shorten the schedule from the current financial month onward' using errcode='23514';
    end if;
    changed_from := greatest(new.active_from, new.stopped_from);
    new.stopped_at := coalesce(old.stopped_at, pg_catalog.statement_timestamp());
  end if;
  if exists (
    select 1 from public.budget_periods p where p.profile_id=new.owner_profile_id and p.status='CLOSED'
      and p.starts_on >= changed_from and (new.active_until is null or p.starts_on <= new.active_until)
      and (tg_op='INSERT' or old.stopped_from is null or p.starts_on < old.stopped_from)
  ) then
    raise exception 'A recurring definition cannot change a closed financial month' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_personal_recurring_expense() from public, anon, authenticated;
create trigger recurring_expenses_validate before insert or update on public.recurring_expenses
for each row execute function public.validate_personal_recurring_expense();

create function public.create_personal_recurring_expense(
  p_template_id uuid, p_name text, p_category_id uuid, p_amount_mode text,
  p_default_amount_minor bigint, p_currency text, p_due_day integer,
  p_active_from date, p_active_until date default null
) returns public.recurring_expenses language plpgsql security invoker set search_path = '' as $$
declare result public.recurring_expenses;
begin
  if auth.uid() is null or p_template_id is null then
    raise exception 'Authenticated template identity is required' using errcode='42501';
  end if;
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Recurring writes require READ COMMITTED isolation' using errcode='0A000';
  end if;
  perform public.lock_personal_finance();
  select * into result from public.recurring_expenses where id=p_template_id;
  if not found then
    insert into public.recurring_expenses(id,owner_profile_id,name,category_id,amount_mode,default_amount_minor,currency,due_day,active_from,active_until)
      values(p_template_id,auth.uid(),p_name,p_category_id,p_amount_mode,p_default_amount_minor,p_currency,p_due_day,p_active_from,p_active_until)
      on conflict(id) do nothing;
    select * into result from public.recurring_expenses where id=p_template_id;
  end if;
  if result.id is null or result.owner_profile_id is distinct from auth.uid()
    or result.name is distinct from p_name or result.category_id is distinct from p_category_id
    or result.amount_mode is distinct from p_amount_mode or result.default_amount_minor is distinct from p_default_amount_minor
    or result.currency is distinct from p_currency or result.due_day is distinct from p_due_day
    or result.active_from is distinct from p_active_from or result.active_until is distinct from p_active_until then
    raise exception 'Template identity conflicts with an existing registration' using errcode='23505';
  end if;
  return result;
end;
$$;
revoke all on function public.create_personal_recurring_expense(uuid,text,uuid,text,bigint,text,integer,date,date) from public,anon,authenticated;
grant execute on function public.create_personal_recurring_expense(uuid,text,uuid,text,bigint,text,integer,date,date) to authenticated;

create function public.stop_personal_recurring_expense(p_template_id uuid, p_stopped_from date)
returns public.recurring_expenses language plpgsql security invoker set search_path = '' as $$
declare result public.recurring_expenses;
begin
  if auth.uid() is null or p_template_id is null or p_stopped_from is null then
    raise exception 'Authenticated template and stop month are required' using errcode='42501';
  end if;
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Recurring writes require READ COMMITTED isolation' using errcode='0A000';
  end if;
  perform public.lock_personal_finance();
  select * into result from public.recurring_expenses where id=p_template_id and owner_profile_id=auth.uid();
  if not found then
    raise exception 'An owned recurring template is required' using errcode='42501';
  end if;
  if result.stopped_from is distinct from p_stopped_from then
    update public.recurring_expenses set stopped_from=p_stopped_from where id=p_template_id returning * into result;
  end if;
  return result;
end;
$$;
revoke all on function public.stop_personal_recurring_expense(uuid,date) from public,anon,authenticated;
grant execute on function public.stop_personal_recurring_expense(uuid,date) to authenticated;
