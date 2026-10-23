-- ADR-081: explicitly configured percentages, never financial activity.
-- Immutable revisions are also bounded operation receipts for lost-response retry;
-- no history browsing or expense behavior is introduced.
alter table public.household_members add constraint household_members_household_id_id_key
  unique(household_id,id);
create table public.household_split_revisions (
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete restrict,
  version integer not null check(version > 0),
  expected_version integer not null check(expected_version >= 0 and version = expected_version + 1),
  roster uuid[] not null check(cardinality(roster) > 0),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp() check(isfinite(created_at)),
  unique(household_id,version),
  unique(household_id,id)
);
create table public.household_split_shares (
  revision_id uuid not null,
  household_id uuid not null,
  member_id uuid not null,
  basis_points integer not null check(basis_points between 0 and 10000),
  primary key(revision_id,member_id),
  foreign key(household_id,revision_id) references public.household_split_revisions(household_id,id) on delete restrict,
  foreign key(household_id,member_id) references public.household_members(household_id,id) on delete restrict
);
create index household_split_shares_member_idx on public.household_split_shares(household_id,member_id);
alter table public.household_split_revisions enable row level security;
alter table public.household_split_shares enable row level security;
revoke all on table public.household_split_revisions, public.household_split_shares from public,anon,authenticated;

-- Defense in depth for whole-revision integrity. Deferred only so one atomic
-- operation can insert the header and all entries; there is no direct client CRUD.
-- PostgreSQL 17 deferred triggers execute as the role at COMMIT, outside the RPC
-- definer. This non-callable trigger therefore needs narrow elevated table reads.
create function public.check_household_split_revision()
returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid; saved_roster uuid[]; actual_roster uuid[]; total bigint;
begin
  if tg_when='BEFORE' then
    raise exception 'Split revisions and shares are immutable' using errcode='23514';
  end if;
  if tg_table_name='household_split_revisions' then
    target:=case when tg_op='DELETE' then old.id else new.id end;
  else
    target:=case when tg_op='DELETE' then old.revision_id else new.revision_id end;
  end if;
  select roster into saved_roster from public.household_split_revisions where id=target;
  if not found then return null; end if;
  select array_agg(member_id order by member_id),sum(basis_points)
    into actual_roster,total from public.household_split_shares where revision_id=target;
  if actual_roster is distinct from saved_roster or total is distinct from 10000::bigint then
    raise exception 'Split must explicitly cover its unique roster and total 10000' using errcode='23514';
  end if;
  return null;
end;
$$;
create trigger household_split_revision_immutable before update on public.household_split_revisions
  for each row execute function public.check_household_split_revision();
create trigger household_split_share_immutable before update on public.household_split_shares
  for each row execute function public.check_household_split_revision();
create constraint trigger household_split_revision_complete
  after insert or update on public.household_split_revisions deferrable initially deferred
  for each row execute function public.check_household_split_revision();
create constraint trigger household_split_shares_complete
  after insert or update or delete on public.household_split_shares deferrable initially deferred
  for each row execute function public.check_household_split_revision();
revoke all on function public.check_household_split_revision() from public,anon,authenticated;

-- One statement snapshot: current roster, authorization and latest template.
-- The only private Profile field projected is display_name for active members.
create function public.get_household_default_split(p_household_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Household access required' using errcode='42501'; end if;
  with roster as (
    select m.id,m.profile_id,m.role,p.display_name
    from public.household_members m join public.profiles p on p.id=m.profile_id
    where m.household_id=p_household_id and m.left_at is null
  ), latest as (
    select r.* from public.household_split_revisions r
    where r.household_id=p_household_id order by r.version desc limit 1
  )
  select pg_catalog.jsonb_build_object(
    'profile_id',auth.uid(),'household_id',p_household_id,'version',coalesce((select version from latest),0),
    'roster',(select jsonb_agg(jsonb_build_object('id',id,'profile_id',profile_id,
      'display_name',display_name,'role',role) order by id) from roster),
    'status',case when not exists(select 1 from latest) then 'UNCONFIGURED'
      when (select roster from latest)=(select array_agg(id order by id) from roster) then 'READY'
      else 'STALE' end,
    'template',(select jsonb_build_object('id',r.id,'version',r.version,'roster',r.roster,
      'shares',(select jsonb_agg(jsonb_build_object('member_id',s.member_id,'basis_points',s.basis_points)
        order by s.member_id) from public.household_split_shares s where s.revision_id=r.id)) from latest r
      where r.roster=(select array_agg(id order by id) from roster))
  ) into result where exists(select 1 from roster where profile_id=auth.uid());
  if result is null then raise exception 'Household access required' using errcode='42501'; end if;
  return result;
end;
$$;

-- Definer required for atomic revision+entries and historical receipt lookup;
-- all client table grants remain closed. Actor and authorization come from DB.
create function public.save_household_default_split(
  p_request_id uuid,p_household_id uuid,p_expected_version integer,p_roster uuid[],p_shares jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor_id uuid:=auth.uid(); current_roster uuid[]; canonical_roster uuid[];
  supplied_roster uuid[]; canonical_shares jsonb; previous_shares jsonb;
  existing public.household_split_revisions; current_version integer; total numeric;
begin
  if actor_id is null then raise exception 'Household owner access required' using errcode='42501'; end if;
  if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
    raise exception 'Split operations require READ COMMITTED' using errcode='25001'; end if;
  if p_request_id is null or p_household_id is null or p_expected_version is null
    or p_expected_version<0 or p_expected_version>=2147483647
    or p_roster is null or cardinality(p_roster)=0 or array_ndims(p_roster)<>1
    or array_position(p_roster,null) is not null
    or p_shares is null or jsonb_typeof(p_shares)<>'array' or jsonb_array_length(p_shares)=0 then
    raise exception 'Invalid split request' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_shares) e where jsonb_typeof(e)<>'object'
    or not(e ? 'member_id' and e ? 'basis_points')
    or (e-'member_id'-'basis_points')<>'{}'::jsonb
    or jsonb_typeof(e->'member_id')<>'string'
    or (e->>'member_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(e->'basis_points')<>'number'
    or (e->>'basis_points') !~ '^[0-9]{1,5}$') then
    raise exception 'Invalid split entries' using errcode='22023'; end if;
  select array_agg(id order by id) into canonical_roster from unnest(p_roster) id;
  select array_agg((e->>'member_id')::uuid order by (e->>'member_id')::uuid),
    jsonb_agg(jsonb_build_object('member_id',(e->>'member_id')::uuid,'basis_points',(e->>'basis_points')::integer)
      order by (e->>'member_id')::uuid),sum((e->>'basis_points')::integer)
    into supplied_roster,canonical_shares,total from jsonb_array_elements(p_shares) e;
  if canonical_roster is distinct from supplied_roster or total<>10000
    or cardinality(canonical_roster)<>(select count(distinct id) from unnest(canonical_roster) id)
    or exists(select 1 from jsonb_array_elements(canonical_shares) e where (e->>'basis_points')::integer>10000) then
    raise exception 'Split must cover every member exactly once and total 10000' using errcode='22023'; end if;

  -- Same namespace/order as invitation acceptance. Parent FOR UPDATE additionally
  -- excludes FK-backed membership insert phantoms, even from trusted SQL. All
  -- membership rows are SHARE-locked, not KEY SHARE: role/departure changes must
  -- settle before the fresh READ COMMITTED authorization+roster check below.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('household-invitations:'||p_household_id::text,0));
  perform 1 from public.households where id=p_household_id for update;
  perform 1 from public.household_members where household_id=p_household_id order by id for share;
  if not exists(select 1 from public.household_members where household_id=p_household_id
    and profile_id=actor_id and left_at is null and role='OWNER') then
    raise exception 'Household owner access required' using errcode='42501'; end if;

  select * into existing from public.household_split_revisions where id=p_request_id;
  if found then
    select jsonb_agg(jsonb_build_object('member_id',member_id,'basis_points',basis_points) order by member_id)
      into previous_shares from public.household_split_shares where revision_id=existing.id;
    if existing.household_id<>p_household_id or existing.created_by<>actor_id
      or existing.expected_version<>p_expected_version or existing.roster<>canonical_roster
      or previous_shares<>canonical_shares then
      raise exception 'Split request identity conflicts' using errcode='23505'; end if;
    -- An old exact replay confirms only its receipt, never restores old values.
    return jsonb_build_object('request_id',existing.id,'household_id',existing.household_id,'version',existing.version);
  end if;
  select array_agg(id order by id) into current_roster from public.household_members
    where household_id=p_household_id and left_at is null;
  select coalesce(max(version),0) into current_version from public.household_split_revisions where household_id=p_household_id;
  if current_version<>p_expected_version or current_roster is distinct from canonical_roster then
    raise exception 'Split version or active roster changed; review before saving' using errcode='40001'; end if;
  insert into public.household_split_revisions(id,household_id,version,expected_version,roster,created_by)
    values(p_request_id,p_household_id,current_version+1,current_version,canonical_roster,actor_id)
    on conflict(id) do nothing;
  if not found then raise exception 'Split request identity conflicts' using errcode='23505'; end if;
  insert into public.household_split_shares(revision_id,household_id,member_id,basis_points)
    select p_request_id,p_household_id,(e->>'member_id')::uuid,(e->>'basis_points')::integer
      from jsonb_array_elements(canonical_shares) e;
  return jsonb_build_object('request_id',p_request_id,'household_id',p_household_id,'version',current_version+1);
end;
$$;
revoke all on function public.get_household_default_split(uuid),
  public.save_household_default_split(uuid,uuid,integer,uuid[],jsonb) from public,anon,authenticated;
grant execute on function public.get_household_default_split(uuid),
  public.save_household_default_split(uuid,uuid,integer,uuid[],jsonb) to authenticated;
