-- FIN-208: fixed household-currency entry; unchanged signature, privileges and lock order.
create or replace function public.create_shared_expense(
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
  -- New entries use the current household currency. Exact historical replay above
  -- stays independent of later configuration. The household lock prevents a
  -- concurrent trusted currency change between this check and the atomic insert.
  if p_currency is distinct from (select default_currency from public.households where id=p_household_id) then
    raise exception 'New shared expenses must use the household currency' using errcode='23514';
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
