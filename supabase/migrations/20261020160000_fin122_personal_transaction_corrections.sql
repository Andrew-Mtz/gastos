-- ADR-074: narrowly scoped monetary corrections, never unrestricted client UPDATE.
alter table public.transactions
  add column revision bigint not null default 0 check (revision between 0 and 9007199254740991),
  add constraint transactions_id_owner_key unique(id,owner_profile_id);

create table public.transaction_revisions (
  transaction_id uuid not null,
  owner_profile_id uuid not null,
  revision bigint not null check (revision between 1 and 9007199254740991),
  action text not null check (action in ('EDIT','DELETE','RESTORE')),
  before_state jsonb not null,
  after_state jsonb not null,
  actor_profile_id uuid,
  recorded_at timestamptz not null default statement_timestamp(),
  request_id uuid,
  request_payload jsonb,
  primary key(transaction_id,revision),
  unique(owner_profile_id,request_id),
  foreign key(transaction_id,owner_profile_id) references public.transactions(id,owner_profile_id) on delete restrict,
  check ((request_id is null) = (request_payload is null))
);
alter table public.transaction_revisions enable row level security;
revoke all on public.transaction_revisions from public,anon,authenticated;
grant select on public.transaction_revisions to authenticated;
create policy transaction_revisions_select_own on public.transaction_revisions
  for select to authenticated using(owner_profile_id=(select auth.uid()));

-- Column grants already protect these fields. The extra invariant also bounds the
-- definer operation, and a server-owned revision catches direct legacy-safe writes.
create function public.prepare_transaction_revision()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.id is distinct from old.id or new.owner_profile_id is distinct from old.owner_profile_id
    or new.scope is distinct from old.scope or new.type is distinct from old.type
    or new.budget_period_id is distinct from old.budget_period_id
    or new.currency is distinct from old.currency or new.savings_goal_id is distinct from old.savings_goal_id
    or new.recurring_template_id is distinct from old.recurring_template_id
    or new.recurring_month is distinct from old.recurring_month then
    raise exception 'Transaction financial identity is immutable' using errcode='23514';
  end if;
  if new.category_id is distinct from old.category_id
    and (old.type <> 'EXPENSE' or old.recurring_template_id is not null) then
    raise exception 'Only non-recurring expense category corrections are supported' using errcode='23514';
  end if;
  new.revision := old.revision+1;
  return new;
end;
$$;
revoke all on function public.prepare_transaction_revision() from public,anon,authenticated;
create trigger transactions_zz_revision before update on public.transactions
  for each row execute function public.prepare_transaction_revision();

-- This definer capability is audit-only: it cannot be called as an RPC or mutate
-- transactions. OLD/NEW from this fixed trigger, not client JSON, supply the facts.
create function public.audit_transaction_revision()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'transactions' or tg_op <> 'UPDATE'
    or new.id is distinct from old.id or new.owner_profile_id is distinct from old.owner_profile_id
    or new.revision <> old.revision+1 then
    raise exception 'Invalid transaction audit context' using errcode='42501';
  end if;
  insert into public.transaction_revisions(transaction_id,owner_profile_id,revision,action,before_state,after_state,actor_profile_id)
  values(new.id,new.owner_profile_id,new.revision,
    case when old.deleted_at is null and new.deleted_at is not null then 'DELETE'
      when old.deleted_at is not null and new.deleted_at is null then 'RESTORE' else 'EDIT' end,
    to_jsonb(old),to_jsonb(new),auth.uid());
  return null;
end;
$$;
revoke all on function public.audit_transaction_revision() from public,anon,authenticated;
create trigger transactions_audit_revision after update on public.transactions
  for each row execute function public.audit_transaction_revision();

create or replace function public.validate_personal_expense()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.type='EXPENSE' and (tg_op='INSERT' or (old.deleted_at is not null and new.deleted_at is null)
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

create or replace function public.validate_savings_movement()
returns trigger language plpgsql security invoker set search_path='' as $$
declare state jsonb; available numeric; additional numeric;
begin
  if new.type not in ('SAVINGS_CONTRIBUTION','SAVINGS_WITHDRAWAL') then return new; end if;
  if tg_op='INSERT' or (old.deleted_at is not null and new.deleted_at is null) then
    if new.currency is distinct from (select base_currency from public.budget_periods where id=new.budget_period_id)
      or new.category_id is not null then
      raise exception 'Savings require period currency and no expense category' using errcode='23514';
    end if;
    if new.type='SAVINGS_WITHDRAWAL' and not new.withdrawal_confirmed then
      raise exception 'Explicit withdrawal confirmation is required' using errcode='23514';
    end if;
    if tg_op='INSERT' and exists(select 1 from public.transactions where id=new.id) then return new; end if;
    additional := new.amount_minor;
    new.savings_validated := true;
  elsif new.deleted_at is null and (new.amount_minor is distinct from old.amount_minor
    or new.transaction_date is distinct from old.transaction_date) then
    if not old.savings_validated then
      raise exception 'Legacy savings require explicit funded restoration, not monetary editing' using errcode='23514';
    end if;
    additional := greatest(new.amount_minor-old.amount_minor,0);
  else return new;
  end if;
  if new.type='SAVINGS_CONTRIBUTION' and additional > 0 then
    state := public.get_savings_availability(new.budget_period_id);
    available := (state->>'spendable_allocated_minor')::numeric-(state->>'spent_minor')::numeric
      -(state->>'contributions_minor')::numeric+(state->>'withdrawals_minor')::numeric;
    if not (state->>'configured')::boolean or additional > available then
      raise exception 'Contribution exceeds ordinary remainder before commitments' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;

create function public.correct_personal_transaction(
  p_request_id uuid,p_transaction_id uuid,p_expected_revision bigint,p_action text,
  p_changes jsonb,p_confirmed boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  owner_id uuid := auth.uid(); original public.transactions; result public.transactions;
  event public.transaction_revisions; period public.budget_periods; period_id uuid;
  payload jsonb; amount bigint; financial_date date; category uuid; description text;
begin
  if owner_id is null or p_request_id is null or p_transaction_id is null then
    raise exception 'Authenticated correction identity is required' using errcode='42501';
  end if;
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Transaction corrections require READ COMMITTED isolation' using errcode='0A000';
  end if;
  if p_expected_revision is null or p_expected_revision not between 0 and 9007199254740990
    or p_action is null or p_action not in ('EDIT','DELETE','RESTORE')
    or p_confirmed is distinct from true or p_changes is null
    or pg_catalog.jsonb_typeof(p_changes) <> 'object' then
    raise exception 'A confirmed valid correction and expected revision are required' using errcode='22023';
  end if;
  payload := jsonb_build_object('transaction_id',p_transaction_id,'expected_revision',p_expected_revision,
    'action',p_action,'changes',p_changes,'confirmed',p_confirmed);
  perform public.lock_personal_finance();
  select * into event from public.transaction_revisions
    where owner_profile_id=owner_id and request_id=p_request_id;
  if found then
    if event.request_payload is distinct from payload then
      raise exception 'Correction request identity conflicts with its original payload' using errcode='23505';
    end if;
    -- An old successful response is not permission to overwrite a newer revision.
    return event.after_state;
  end if;
  select * into original from public.transactions
    where id=p_transaction_id and owner_profile_id=owner_id and scope='PERSONAL';
  if not found then raise exception 'An owned personal transaction is required' using errcode='42501'; end if;
  select * into period from public.budget_periods
    where id=original.budget_period_id and profile_id=owner_id for update;
  if not found or period.status <> 'OPEN' then
    raise exception 'An owned open budget period is required' using errcode='42501';
  end if;
  select * into original from public.transactions
    where id=p_transaction_id and owner_profile_id=owner_id for update;
  if original.revision <> p_expected_revision then
    raise exception 'Transaction changed; reload before correcting it' using errcode='40001';
  end if;
  if p_action='EDIT' then
    if original.deleted_at is not null then
      raise exception 'Restore a deleted transaction before editing it' using errcode='23514';
    end if;
    if (select count(*) from jsonb_object_keys(p_changes)) <> 4
      or not (p_changes ?& array['amount_minor','transaction_date','category_id','description'])
      or jsonb_typeof(p_changes->'amount_minor') is distinct from 'number'
      or (p_changes->>'amount_minor') !~ '^[0-9]+$'
      or (p_changes->>'amount_minor')::numeric not between 1 and 9007199254740991
      or jsonb_typeof(p_changes->'transaction_date') is distinct from 'string'
      or (p_changes->>'transaction_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(p_changes->'category_id') not in ('string','null')
      or jsonb_typeof(p_changes->'description') not in ('string','null')
      or char_length(p_changes->>'description') > 500 then
      raise exception 'Only complete bounded correction fields are accepted' using errcode='22023';
    end if;
    amount := (p_changes->>'amount_minor')::bigint;
    financial_date := (p_changes->>'transaction_date')::date;
    category := (p_changes->>'category_id')::uuid;
    description := p_changes->>'description';
    update public.transactions set amount_minor=amount,transaction_date=financial_date,
      category_id=category,description=description
      where id=original.id and owner_profile_id=owner_id returning * into result;
  else
    if p_changes <> '{}'::jsonb then
      raise exception 'Delete and restore do not accept monetary changes' using errcode='22023';
    end if;
    if (p_action='DELETE' and original.deleted_at is not null)
      or (p_action='RESTORE' and original.deleted_at is null) then
      raise exception 'Transaction state changed; reload before correcting it' using errcode='40001';
    end if;
    update public.transactions set deleted_at=case when p_action='DELETE' then statement_timestamp() else null end
      where id=original.id and owner_profile_id=owner_id returning * into result;
  end if;
  -- Validate all affected historical prefixes before returning, not just at commit.
  -- Later ordinary overspending stays legal; this does not re-fund old contributions.
  for period_id in select distinct on(p.base_currency) p.id from public.budget_periods p
    where p.profile_id=owner_id and exists(select 1 from public.transactions t
      join public.budget_periods source on source.id=t.budget_period_id
      where t.owner_profile_id=owner_id and t.type in ('SAVINGS_CONTRIBUTION','SAVINGS_WITHDRAWAL')
        and t.deleted_at is null and source.base_currency=p.base_currency)
    order by p.base_currency,p.starts_on desc,p.id
  loop perform public.get_savings_availability(period_id); end loop;
  update public.transaction_revisions set request_id=p_request_id,request_payload=payload
    where transaction_id=result.id and owner_profile_id=owner_id and revision=result.revision;
  return to_jsonb(result);
end;
$$;
revoke all on function public.correct_personal_transaction(uuid,uuid,bigint,text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.correct_personal_transaction(uuid,uuid,bigint,text,jsonb,boolean) to authenticated;
