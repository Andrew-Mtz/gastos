-- FIN-207 / ADR-082: atomic, default-template-only historical persistence.
-- Existing PERSONAL rows retain all values and private read/write authorization.
alter table public.transactions
  alter column owner_profile_id drop not null,
  alter column budget_period_id drop not null,
  add column household_id uuid references public.households(id) on delete restrict,
  add column created_by uuid references public.profiles(id) on delete restrict,
  drop constraint transactions_scope_check,
  add constraint transactions_scope_check check (
    (scope='PERSONAL' and owner_profile_id is not null and budget_period_id is not null
      and household_id is null and created_by is null)
    or (scope='HOUSEHOLD' and owner_profile_id is null and budget_period_id is null
      and household_id is not null and created_by is not null and type='EXPENSE'
      and category_id is null and savings_goal_id is null and recurring_template_id is null
      and recurring_month is null and not withdrawal_confirmed and not savings_validated
      and revision=0 and deleted_at is null and (description is null or char_length(description)<=500))
  ),
  add constraint transactions_household_id_id_key unique(household_id,id),
  add constraint transactions_household_actor_fkey foreign key(household_id,created_by)
    references public.household_members(household_id,profile_id) on delete restrict;
-- No new table/column privileges or household SELECT policy on transactions.
-- Owner predicates and required personal period references still exclude every
-- HOUSEHOLD row, even when the authenticated actor/payer is the personal owner.

create or replace function public.prepare_transaction_write()
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
  if tg_op='UPDATE' and (new.household_id is distinct from old.household_id
    or new.created_by is distinct from old.created_by or old.scope='HOUSEHOLD') then
    raise exception 'Shared transaction identity and history are immutable' using errcode='23514';
  end if;
  if new.scope='HOUSEHOLD' then
    -- No personal period, category, funding, correction or savings semantics.
    -- The deferred trio constraint verifies its linked historical responsibility.
    return new;
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
create or replace function public.validate_personal_expense()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.scope='PERSONAL' and new.type='EXPENSE' and (tg_op='INSERT' or (old.deleted_at is not null and new.deleted_at is null)
    or new.category_id is distinct from old.category_id) then
    if new.currency is distinct from (select base_currency from public.budget_periods where id=new.budget_period_id) then
      raise exception 'Expenses must use the budget period currency' using errcode='23514';
    end if;
    if not exists(select 1 from public.categories c join public.budget_buckets b on b.id=c.budget_bucket_id
      where c.id=new.category_id and c.profile_id=new.owner_profile_id and b.profile_id=new.owner_profile_id
        and c.archived_at is null and b.archived_at is null and b.type='SPENDABLE') then
      raise exception 'An active owned category mapped to a spendable bucket is required' using errcode='42501';
    end if;
  end if;
  return new;
end;
$$;


-- Keep the existing statement-level owner lock (before any target row lock).
-- Shared RPC acquires it BEFORE the household locks to preserve that order.
-- Shared inserts must not recalculate an unrelated personal savings ledger.
drop trigger transactions_savings_integrity on public.transactions;
create constraint trigger transactions_savings_integrity after insert or update on public.transactions
  deferrable initially deferred for each row when (new.scope='PERSONAL')
  execute function public.check_savings_integrity();

alter table public.household_split_revisions add constraint household_split_revisions_identity_version_key
  unique(household_id,id,version);
create table public.shared_expenses (
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete restrict,
  transaction_id uuid not null unique check(transaction_id=id),
  payer_member_id uuid not null,
  template_id uuid not null,
  template_version integer not null check(template_version>0),
  split_strategy text not null default 'PERCENTAGE' check(split_strategy='PERCENTAGE'),
  unique(household_id,id),
  foreign key(household_id,transaction_id) references public.transactions(household_id,id) on delete restrict,
  foreign key(household_id,payer_member_id) references public.household_members(household_id,id) on delete restrict,
  foreign key(household_id,template_id,template_version)
    references public.household_split_revisions(household_id,id,version) on delete restrict
);
create table public.shared_expense_splits (
  shared_expense_id uuid not null,
  household_id uuid not null,
  member_id uuid not null,
  basis_points integer not null check(basis_points between 0 and 10000),
  responsibility_amount_minor bigint not null check(responsibility_amount_minor between 0 and 9007199254740991),
  primary key(shared_expense_id,member_id),
  foreign key(household_id,shared_expense_id) references public.shared_expenses(household_id,id) on delete restrict,
  foreign key(household_id,member_id) references public.household_members(household_id,id) on delete restrict
);
create index shared_expenses_payer_idx on public.shared_expenses(household_id,payer_member_id);
create index shared_expenses_template_idx on public.shared_expenses(household_id,template_id,template_version);
create index shared_expense_splits_member_idx on public.shared_expense_splits(household_id,member_id);
alter table public.shared_expenses enable row level security;
alter table public.shared_expense_splits enable row level security;
revoke all on public.shared_expenses,public.shared_expense_splits from public,anon,authenticated;

-- Trigger-only definer: deferred events run as the commit role, after the RPC.
-- It reads only this fixed trio/template and cannot write or be called as RPC.
-- Complete cleanup by a trusted administrator is possible; no client deletion
-- capability or retention policy is introduced by this migration.
create function public.check_shared_expense_integrity()
returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid; expense public.shared_expenses; movement public.transactions;
  expected_roster uuid[]; actual_roster uuid[]; total_bps bigint; total_minor numeric;
begin
  if tg_when='BEFORE' then
    raise exception 'Shared expense snapshots are immutable' using errcode='23514';
  end if;
  if tg_table_name='shared_expense_splits' then
    target:=case when tg_op='DELETE' then old.shared_expense_id else new.shared_expense_id end;
  else target:=case when tg_op='DELETE' then old.id else new.id end;
  end if;
  select * into movement from public.transactions where id=target;
  if not found then return null; end if;
  select * into expense from public.shared_expenses where id=target;
  if not found or movement.scope<>'HOUSEHOLD' or movement.household_id<>expense.household_id then
    raise exception 'A household transaction requires its linked shared expense' using errcode='23514';
  end if;
  select roster into expected_roster from public.household_split_revisions where id=expense.template_id;
  if not expense.payer_member_id=any(expected_roster)
    or not exists(select 1 from public.household_members where id=any(expected_roster)
      and household_id=expense.household_id and profile_id=movement.created_by) then
    raise exception 'Shared payer and actor must belong to the historical roster' using errcode='23514';
  end if;
  select array_agg(member_id order by member_id),sum(basis_points),sum(responsibility_amount_minor)
    into actual_roster,total_bps,total_minor from public.shared_expense_splits where shared_expense_id=target;
  if actual_roster is distinct from expected_roster or total_bps is distinct from 10000::bigint
    or total_minor is distinct from movement.amount_minor::numeric then
    raise exception 'Shared responsibility must cover the historical roster and conserve the total' using errcode='23514';
  end if;
  -- NUMERIC, never bigint multiplication or float: MAX_SAFE_INTEGER * 10000
  -- exceeds bigint. Canonical UUID order is exactly FIN-206 tie-breaking.
  if exists(with exact as (
    select member_id,basis_points,floor(movement.amount_minor::numeric*basis_points/10000) as floor_minor,
      mod(movement.amount_minor::numeric*basis_points,10000) as remainder
    from public.household_split_shares where revision_id=expense.template_id
  ), ranked as (
    select *,row_number() over(order by remainder desc,member_id) as rank,
      movement.amount_minor-sum(floor_minor) over() as units from exact
  ) select 1 from ranked r join public.shared_expense_splits s on s.shared_expense_id=target and s.member_id=r.member_id
    where s.basis_points<>r.basis_points
      or s.responsibility_amount_minor<>r.floor_minor+case when r.rank<=r.units then 1 else 0 end) then
    raise exception 'Shared responsibility must match the exact historical template rounding' using errcode='23514';
  end if;
  return null;
end;
$$;
create trigger shared_expenses_immutable before update on public.shared_expenses
  for each row execute function public.check_shared_expense_integrity();
create trigger shared_expense_splits_immutable before update on public.shared_expense_splits
  for each row execute function public.check_shared_expense_integrity();
create constraint trigger shared_transaction_complete after insert or update on public.transactions
  deferrable initially deferred for each row when (new.scope='HOUSEHOLD')
  execute function public.check_shared_expense_integrity();
create constraint trigger shared_expense_complete after insert or update or delete on public.shared_expenses
  deferrable initially deferred for each row execute function public.check_shared_expense_integrity();
create constraint trigger shared_expense_splits_complete after insert or update or delete on public.shared_expense_splits
  deferrable initially deferred for each row execute function public.check_shared_expense_integrity();
revoke all on function public.check_shared_expense_integrity() from public,anon,authenticated;

-- One exact authorized read, not a history feed. No Profile joins, personal
-- periods/categories, current-template reinterpretation or private finances.
create function public.get_shared_expense(p_household_id uuid,p_expense_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Household expense access required' using errcode='42501'; end if;
  select jsonb_build_object(
    'profile_id',auth.uid(),'expense_id',e.id,'transaction_id',t.id,'household_id',e.household_id,
    'created_by',t.created_by,'payer_member_id',e.payer_member_id,
    'template_id',e.template_id,'template_version',e.template_version,
    'amount_minor',t.amount_minor,'currency',t.currency,'transaction_date',t.transaction_date,
    'description',t.description,
    'splits',(select jsonb_agg(jsonb_build_object('member_id',s.member_id,
      'basis_points',s.basis_points,'responsibility_amount_minor',s.responsibility_amount_minor)
      order by s.member_id) from public.shared_expense_splits s where s.shared_expense_id=e.id)
  ) into result from public.shared_expenses e join public.transactions t on t.id=e.transaction_id
  where e.id=p_expense_id and e.household_id=p_household_id
    and exists(select 1 from public.household_members m where m.household_id=e.household_id
      and m.profile_id=auth.uid() and m.left_at is null);
  if result is null then raise exception 'Household expense access required' using errcode='42501'; end if;
  return result;
end;
$$;

create function public.create_shared_expense(
  p_request_id uuid,p_household_id uuid,p_payer_member_id uuid,
  p_template_id uuid,p_template_version integer,p_roster uuid[],
  p_amount_minor bigint,p_currency text,p_transaction_date date,p_description text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor_id uuid:=auth.uid(); canonical_roster uuid[]; current_roster uuid[];
  template public.household_split_revisions; existing public.shared_expenses; original public.transactions;
begin
  if actor_id is null then raise exception 'Household expense access required' using errcode='42501'; end if;
  if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
    raise exception 'Shared expense operations require READ COMMITTED' using errcode='25001'; end if;
  if p_request_id is null or p_household_id is null or p_payer_member_id is null
    or p_template_id is null or p_template_version is null or p_template_version<1
    or p_roster is null or cardinality(p_roster)=0 or array_ndims(p_roster)<>1
    or array_position(p_roster,null) is not null
    or p_amount_minor is null or p_amount_minor not between 1 and 9007199254740991
    or p_currency is null or p_currency !~ '^[A-Z]{3}$'
    or p_transaction_date is null or p_transaction_date not between date '0001-01-01' and date '9999-12-31'
    or char_length(p_description)>500 then
    raise exception 'Invalid shared expense request' using errcode='22023'; end if;
  select array_agg(id order by id) into canonical_roster from unnest(p_roster) id;
  if cardinality(canonical_roster)<>(select count(distinct id) from unnest(canonical_roster) id) then
    raise exception 'Shared roster identities must be unique' using errcode='22023'; end if;

  -- The existing transactions statement trigger takes the caller's finance lock.
  -- Take it first, then FIN-203/205 household lock -> parent -> sorted members.
  -- No shared path holds a household lock while waiting for a personal writer.
  perform public.lock_personal_finance();
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('household-invitations:'||p_household_id::text,0));
  perform 1 from public.households where id=p_household_id for update;
  perform 1 from public.household_members where household_id=p_household_id order by id for share;
  if not exists(select 1 from public.household_members where household_id=p_household_id
    and profile_id=actor_id and left_at is null) then
    raise exception 'Household expense access required' using errcode='42501'; end if;

  select * into existing from public.shared_expenses where id=p_request_id;
  if found then
    select * into original from public.transactions where id=existing.transaction_id;
    select * into template from public.household_split_revisions where id=existing.template_id;
    if existing.household_id<>p_household_id or original.created_by<>actor_id
      or existing.payer_member_id<>p_payer_member_id or existing.template_id<>p_template_id
      or existing.template_version<>p_template_version or template.roster<>canonical_roster
      or original.amount_minor<>p_amount_minor or original.currency<>p_currency
      or original.transaction_date<>p_transaction_date or original.description is distinct from p_description then
      raise exception 'Shared expense request identity conflicts' using errcode='23505'; end if;
    -- Current actor membership is required. Original payer/template/roster need
    -- not still be current: replay confirms a receipt, never creates or rewrites.
    return public.get_shared_expense(p_household_id,p_request_id);
  end if;
  select * into template from public.household_split_revisions where household_id=p_household_id
    order by version desc limit 1;
  select array_agg(id order by id) into current_roster from public.household_members
    where household_id=p_household_id and left_at is null;
  if template.id is distinct from p_template_id or template.version is distinct from p_template_version
    or template.roster is distinct from current_roster or current_roster is distinct from canonical_roster then
    raise exception 'Shared expense template or active roster changed; review before saving' using errcode='40001'; end if;
  if not exists(select 1 from public.household_members where household_id=p_household_id
    and id=p_payer_member_id and left_at is null) then
    raise exception 'An active same-household payer is required' using errcode='42501'; end if;

  insert into public.transactions(id,scope,type,household_id,created_by,amount_minor,currency,transaction_date,description)
    values(p_request_id,'HOUSEHOLD','EXPENSE',p_household_id,actor_id,p_amount_minor,p_currency,p_transaction_date,p_description);
  insert into public.shared_expenses(id,household_id,transaction_id,payer_member_id,template_id,template_version)
    values(p_request_id,p_household_id,p_request_id,p_payer_member_id,p_template_id,p_template_version);
  with exact as (
    select member_id,basis_points,floor(p_amount_minor::numeric*basis_points/10000) as floor_minor,
      mod(p_amount_minor::numeric*basis_points,10000) as remainder
    from public.household_split_shares where revision_id=p_template_id
  ), ranked as (
    select *,row_number() over(order by remainder desc,member_id) as rank,
      p_amount_minor-sum(floor_minor) over() as units from exact
  ) insert into public.shared_expense_splits(shared_expense_id,household_id,member_id,basis_points,responsibility_amount_minor)
    select p_request_id,p_household_id,member_id,basis_points,
      (floor_minor+case when rank<=units then 1 else 0 end)::bigint from ranked;
  return public.get_shared_expense(p_household_id,p_request_id);
end;
$$;
revoke all on function public.get_shared_expense(uuid,uuid),
  public.create_shared_expense(uuid,uuid,uuid,uuid,integer,uuid[],bigint,text,date,text) from public,anon,authenticated;
grant execute on function public.get_shared_expense(uuid,uuid),
  public.create_shared_expense(uuid,uuid,uuid,uuid,integer,uuid[],bigint,text,date,text) to authenticated;
