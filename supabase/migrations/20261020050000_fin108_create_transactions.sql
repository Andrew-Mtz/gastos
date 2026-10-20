alter table public.budget_periods add constraint budget_periods_id_profile_id_key unique (id, profile_id);
alter table public.categories add constraint categories_id_profile_id_key unique (id, profile_id);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references public.profiles(id) on delete restrict,
  budget_period_id uuid not null,
  scope text not null default 'PERSONAL' check (scope = 'PERSONAL'),
  type text not null check (type in ('INCOME','EXPENSE','SAVINGS_CONTRIBUTION','SAVINGS_WITHDRAWAL')),
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 9007199254740991),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  transaction_date date not null check (transaction_date between date '0001-01-01' and date '9999-12-31'),
  category_id uuid,
  description text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  deleted_at timestamptz,
  constraint transactions_period_owner_fkey foreign key (budget_period_id, owner_profile_id)
    references public.budget_periods(id, profile_id) on delete restrict,
  constraint transactions_category_owner_fkey foreign key (category_id, owner_profile_id)
    references public.categories(id, profile_id) on delete restrict
);
create index transactions_owner_date_idx on public.transactions(owner_profile_id, transaction_date, id);
create index transactions_period_idx on public.transactions(budget_period_id);
create index transactions_category_idx on public.transactions(category_id);

create function public.prepare_transaction_write()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  period public.budget_periods;
begin
  -- Serialize with period closing; stale snapshot isolation cannot establish an
  -- open-period precondition after another writer has finalized that month.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Transaction writes require READ COMMITTED isolation' using errcode = '0A000';
  end if;
  select * into period from public.budget_periods where id = new.budget_period_id for update;
  if not found or period.profile_id <> new.owner_profile_id or period.status <> 'OPEN' then
    raise exception 'An owned open budget period is required' using errcode = '42501';
  end if;
  if new.transaction_date < period.starts_on or new.transaction_date > period.ends_on then
    raise exception 'Transaction date must belong to its budget period' using errcode = '23514';
  end if;
  -- ADR-066: conversion remains deferred; do not silently mix currency amounts.
  if new.type = 'INCOME' and new.currency <> period.base_currency then
    raise exception 'Income must use the budget period currency' using errcode = '23514';
  end if;
  if new.category_id is not null and (tg_op = 'INSERT' or (old.deleted_at is not null and new.deleted_at is null)) then
    if not exists (select 1 from public.categories where id = new.category_id
      and profile_id = new.owner_profile_id and archived_at is null) then
      raise exception 'An active owned category is required' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    if new.deleted_at is not null then
      new.deleted_at := coalesce(old.deleted_at, pg_catalog.statement_timestamp());
    end if;
  end if;
  new.updated_at := pg_catalog.statement_timestamp();
  return new;
end;
$$;
create trigger transactions_prepare_write before insert or update on public.transactions
for each row execute function public.prepare_transaction_write();
revoke all on function public.prepare_transaction_write() from public, anon, authenticated;
alter table public.transactions enable row level security;
revoke all on table public.transactions from public, anon, authenticated;
grant select on public.transactions to authenticated;
-- A caller-supplied UUID can identify one registration across retries. Identity
-- cannot be changed later; this does not grant access to another owner's row.
grant insert(id, owner_profile_id, budget_period_id, type, amount_minor, currency, transaction_date, category_id, description)
  on public.transactions to authenticated;
-- Corrections of amount/type/date and reassignment are not introduced by FIN-108.
grant update(description, deleted_at) on public.transactions to authenticated;
create policy transactions_select_own on public.transactions for select to authenticated
using (owner_profile_id = (select auth.uid()));
create policy transactions_insert_open_own on public.transactions for insert to authenticated
with check (owner_profile_id = (select auth.uid()) and exists (
  select 1 from public.budget_periods p where p.id = budget_period_id
    and p.profile_id = (select auth.uid()) and p.status = 'OPEN'
));
create policy transactions_update_open_own on public.transactions for update to authenticated
using (owner_profile_id = (select auth.uid()) and exists (
  select 1 from public.budget_periods p where p.id = budget_period_id and p.status = 'OPEN'
))
with check (owner_profile_id = (select auth.uid()) and exists (
  select 1 from public.budget_periods p where p.id = budget_period_id and p.status = 'OPEN'
));
