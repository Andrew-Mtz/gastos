-- Invoker RPCs expose no elevated capability and compose the existing owner RLS.
create function public.register_income(
  p_transaction_id uuid, p_budget_period_id uuid, p_amount_minor bigint,
  p_currency text, p_transaction_date date, p_description text default null
)
returns public.transactions language plpgsql security invoker set search_path = ''
as $$
declare
  result public.transactions;
begin
  if auth.uid() is null or p_transaction_id is null then
    raise exception 'Authenticated operation identity is required' using errcode = '42501';
  end if;
  select * into result from public.transactions where id = p_transaction_id;
  if not found then
    insert into public.transactions(id,owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date,description)
    values(p_transaction_id,auth.uid(),p_budget_period_id,'INCOME',p_amount_minor,p_currency,p_transaction_date,p_description)
    on conflict(id) do nothing;
    select * into result from public.transactions where id = p_transaction_id;
  end if;
  if result.id is null or result.owner_profile_id is distinct from auth.uid()
    or result.type is distinct from 'INCOME'
    or result.budget_period_id is distinct from p_budget_period_id
    or result.amount_minor is distinct from p_amount_minor
    or result.currency is distinct from p_currency
    or result.transaction_date is distinct from p_transaction_date
    or result.description is distinct from p_description
    or result.category_id is not null or result.deleted_at is not null then
    raise exception 'Operation identity conflicts with an existing registration' using errcode = '23505';
  end if;
  -- Identical replay is a read, including after closing; it never rewrites history.
  return result;
end;
$$;

create function public.get_received_income(p_budget_period_id uuid)
returns bigint language plpgsql stable security invoker set search_path = ''
as $$
declare
  currency_code text;
  total numeric;
begin
  select base_currency into currency_code from public.budget_periods
  where id = p_budget_period_id and profile_id = auth.uid();
  if not found then
    raise exception 'An owned budget period is required' using errcode = '42501';
  end if;
  if exists(select 1 from public.transactions where budget_period_id = p_budget_period_id
    and type = 'INCOME' and deleted_at is null and currency <> currency_code) then
    raise exception 'Cross-currency income requires explicit conversion' using errcode = '23514';
  end if;
  select coalesce(sum(amount_minor),0) into total from public.transactions
  where budget_period_id = p_budget_period_id and type = 'INCOME' and deleted_at is null;
  if total > 9007199254740991 then
    raise exception 'Received income exceeds supported safe-integer range' using errcode = '22003';
  end if;
  return total::bigint;
end;
$$;
revoke all on function public.register_income(uuid,uuid,bigint,text,date,text) from public,anon,authenticated;
revoke all on function public.get_received_income(uuid) from public,anon,authenticated;
grant execute on function public.register_income(uuid,uuid,bigint,text,date,text) to authenticated;
grant execute on function public.get_received_income(uuid) to authenticated;
