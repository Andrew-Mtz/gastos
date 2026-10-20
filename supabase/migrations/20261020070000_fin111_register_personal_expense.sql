-- ADR-067: ordinary expenses are same-currency spending, never implicit savings.
create function public.validate_personal_expense()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  period_currency text;
begin
  if new.type = 'EXPENSE' and (tg_op = 'INSERT' or (old.deleted_at is not null and new.deleted_at is null)) then
    select base_currency into period_currency from public.budget_periods where id = new.budget_period_id;
    if new.currency is distinct from period_currency then
      raise exception 'Expenses must use the budget period currency' using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.categories c join public.budget_buckets b on b.id = c.budget_bucket_id
      where c.id = new.category_id and c.profile_id = new.owner_profile_id
        and b.profile_id = new.owner_profile_id and c.archived_at is null
        and b.archived_at is null and b.type = 'SPENDABLE'
    ) then
      raise exception 'An active owned category mapped to a spendable bucket is required' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger transactions_validate_expense before insert or update on public.transactions
for each row execute function public.validate_personal_expense();
revoke all on function public.validate_personal_expense() from public, anon, authenticated;

create function public.register_personal_expense(
  p_transaction_id uuid, p_budget_period_id uuid, p_amount_minor bigint,
  p_currency text, p_transaction_date date, p_category_id uuid,
  p_description text default null
)
returns public.transactions language plpgsql security invoker set search_path = ''
as $$
declare result public.transactions;
begin
  if auth.uid() is null or p_transaction_id is null then
    raise exception 'Authenticated operation identity is required' using errcode = '42501';
  end if;
  select * into result from public.transactions where id = p_transaction_id;
  if not found then
    insert into public.transactions(id,owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date,category_id,description)
    values(p_transaction_id,auth.uid(),p_budget_period_id,'EXPENSE',p_amount_minor,p_currency,p_transaction_date,p_category_id,p_description)
    on conflict(id) do nothing;
    select * into result from public.transactions where id = p_transaction_id;
  end if;
  if result.id is null or result.owner_profile_id is distinct from auth.uid()
    or result.type is distinct from 'EXPENSE'
    or result.budget_period_id is distinct from p_budget_period_id
    or result.amount_minor is distinct from p_amount_minor
    or result.currency is distinct from p_currency
    or result.transaction_date is distinct from p_transaction_date
    or result.description is distinct from p_description
    or result.category_id is distinct from p_category_id or result.deleted_at is not null then
    raise exception 'Operation identity conflicts with an existing registration' using errcode = '23505';
  end if;
  return result;
end;
$$;
revoke all on function public.register_personal_expense(uuid,uuid,bigint,text,date,uuid,text) from public,anon,authenticated;
grant execute on function public.register_personal_expense(uuid,uuid,bigint,text,date,uuid,text) to authenticated;
