-- FIN-209: bounded read-only history. No table grants, policies or writes change.
-- A definer is required because shared headers/splits and HOUSEHOLD transactions
-- are intentionally not directly readable. Reuse the reviewed minimal point DTO;
-- no Profile, personal financial relation, totals or current split is joined.
create index transactions_household_history_idx
  on public.transactions(household_id,transaction_date desc,id desc)
  where scope='HOUSEHOLD';

create function public.list_shared_expenses(
  p_household_id uuid,p_before_expense_id uuid default null,p_limit integer default 20
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  viewer uuid:=auth.uid();
  before_date date;
  page jsonb;
  next_cursor uuid;
  members jsonb;
begin
  -- One statement snapshot covers authorization, cursor and the complete page.
  -- Do not let a long-lived snapshot retain membership that was revoked.
  if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
    raise exception 'Household history requires READ COMMITTED' using errcode='25001';
  end if;
  if viewer is null or not exists(select 1 from public.household_members m
    where m.household_id=p_household_id and m.profile_id=viewer and m.left_at is null) then
    raise exception 'Household expense access required' using errcode='42501';
  end if;
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'Invalid household history page' using errcode='22023';
  end if;
  if p_before_expense_id is not null then
    select t.transaction_date into before_date
      from public.shared_expenses e join public.transactions t on t.id=e.transaction_id
      where e.id=p_before_expense_id and e.household_id=p_household_id
        and t.household_id=p_household_id and t.scope='HOUSEHOLD' and t.deleted_at is null;
    if not found then
      -- Identical outcome for nonexistent, personal, and another household's ID.
      raise exception 'Invalid household history cursor' using errcode='22023';
    end if;
  end if;
  with candidates as materialized (
    select e.id,t.transaction_date
      from public.shared_expenses e join public.transactions t on t.id=e.transaction_id
      where e.household_id=p_household_id and t.household_id=p_household_id
        and t.scope='HOUSEHOLD' and t.deleted_at is null
        and (p_before_expense_id is null or
          (t.transaction_date,e.id)<(before_date,p_before_expense_id))
      order by t.transaction_date desc,e.id desc limit p_limit+1
  ), entries as materialized (
    select * from candidates order by transaction_date desc,id desc limit p_limit
  )
  select coalesce(jsonb_agg(public.get_shared_expense(p_household_id,id)
      order by transaction_date desc,id desc),'[]'::jsonb),
    case when (select count(*) from candidates)>p_limit then
      (select id from entries order by transaction_date,id limit 1) else null end
    into page,next_cursor from entries;
  -- Reuse FIN-202's current authorized projection, never join private Profiles.
  select jsonb_agg(jsonb_build_object('id',m->'id','display_name',m->'display_name') order by m->>'id')
    into members from jsonb_array_elements(public.get_my_household_memberships()->'households') h
    cross join lateral jsonb_array_elements(h->'members') m
    where h->>'id'=p_household_id::text;
  return jsonb_build_object('profile_id',viewer,'household_id',p_household_id,
    'expenses',page,'next_cursor',next_cursor,'members',members);
end;
$$;
revoke all on function public.list_shared_expenses(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.list_shared_expenses(uuid,uuid,integer) to authenticated;


-- Keep the original FIN-207/208 point DTO unchanged. History needs fresh display
-- labels in the SAME snapshot as its independently authorized expense detail.
create function public.get_shared_expense_history_detail(p_household_id uuid,p_expense_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare expense jsonb; members jsonb;
begin
  if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
    raise exception 'Household history requires READ COMMITTED' using errcode='25001';
  end if;
  expense:=public.get_shared_expense(p_household_id,p_expense_id);
  -- Reuse FIN-202's current authorized projection, never join private Profiles.
  select jsonb_agg(jsonb_build_object('id',m->'id','display_name',m->'display_name') order by m->>'id')
    into members from jsonb_array_elements(public.get_my_household_memberships()->'households') h
    cross join lateral jsonb_array_elements(h->'members') m
    where h->>'id'=p_household_id::text;
  return jsonb_build_object('profile_id',auth.uid(),'household_id',p_household_id,
    'expense',expense,'members',members);
end;
$$;
revoke all on function public.get_shared_expense_history_detail(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_shared_expense_history_detail(uuid,uuid) to authenticated;
