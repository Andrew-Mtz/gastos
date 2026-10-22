-- ADR-080: directed invitations. Codes identify an account, never authorize joining.
create table public.household_recipient_codes (
  profile_id uuid primary key references public.profiles(id) on delete restrict,
  code uuid not null unique default gen_random_uuid(),
  unique(profile_id,code)
);
create table public.household_invitations (
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete restrict,
  issuer_profile_id uuid not null references public.profiles(id) on delete restrict,
  recipient_profile_id uuid not null references public.profiles(id) on delete restrict,
  recipient_code uuid not null references public.household_recipient_codes(code) on delete restrict,
  status text not null default 'PENDING' check (status in ('PENDING','ACCEPTED','REVOKED')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  resolved_at timestamptz,
  constraint household_invitations_recipient_code_fkey foreign key(recipient_profile_id,recipient_code)
    references public.household_recipient_codes(profile_id,code) on delete restrict,
  constraint household_invitations_not_self check (issuer_profile_id <> recipient_profile_id),
  constraint household_invitations_dates check (
    isfinite(created_at) and isfinite(expires_at)
    and expires_at = created_at + interval '168 hours'
    and ((status = 'PENDING' and resolved_at is null)
      or (status <> 'PENDING' and resolved_at is not null and isfinite(resolved_at)
        and resolved_at >= created_at))
  )
);
create index household_invitations_household_idx on public.household_invitations(household_id);
create index household_invitations_recipient_idx on public.household_invitations(recipient_profile_id);
create index household_invitations_issuer_created_idx on public.household_invitations(issuer_profile_id,created_at);
alter table public.household_recipient_codes enable row level security;
alter table public.household_invitations enable row level security;
revoke all on table public.household_recipient_codes, public.household_invitations from public, anon, authenticated;

-- No direct SELECT/write surface, including for recipients or owners. Definers
-- below expose explicit minimal projections and derive the actor from auth.uid().
create function public.get_my_household_invitations()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); result jsonb;
begin
  if actor_id is null or not exists (select 1 from public.profiles where id=actor_id) then
    raise exception 'An authenticated profile is required' using errcode='42501';
  end if;
  insert into public.household_recipient_codes(profile_id) values(actor_id)
    on conflict(profile_id) do nothing;
  -- One statement snapshot for identity, authorization and both lists. Only
  -- recent invitation metadata is visible before joining, never member identities.
  with visible as (
    select i.id, i.household_id, h.name as household_name, i.expires_at, i.recipient_code,
      i.recipient_profile_id = actor_id as incoming,
      case when i.status <> 'PENDING' then i.status
        when i.expires_at <= pg_catalog.statement_timestamp() then 'EXPIRED'
        when not exists(select 1 from public.household_members issuer
          where issuer.household_id=i.household_id and issuer.profile_id=i.issuer_profile_id
            and issuer.left_at is null and issuer.role='OWNER') then 'UNAVAILABLE'
        else 'PENDING' end as status
    from public.household_invitations i join public.households h on h.id=i.household_id
    where i.created_at > pg_catalog.statement_timestamp() - interval '14 days'
      and ((i.recipient_profile_id=actor_id and (i.status <> 'ACCEPTED' or exists (
        select 1 from public.household_members mine where mine.household_id=i.household_id
          and mine.profile_id=actor_id and mine.left_at is null)))
      or (i.issuer_profile_id=actor_id and exists (select 1 from public.household_members owner
        where owner.household_id=i.household_id and owner.profile_id=actor_id
          and owner.left_at is null and owner.role='OWNER')))
  ), projected as (
    select incoming, id, pg_catalog.jsonb_build_object('id',id,'household_id',household_id,
      'household_name',household_name,'status',status,'expires_at',expires_at)
      || case when incoming then '{}'::jsonb else pg_catalog.jsonb_build_object('recipient_code',recipient_code) end as dto from visible
  )
  select pg_catalog.jsonb_build_object('profile_id',actor_id,'recipient_code',c.code,
    'incoming',coalesce((select pg_catalog.jsonb_agg(dto order by id) from projected where incoming),'[]'::jsonb),
    'outgoing',coalesce((select pg_catalog.jsonb_agg(dto order by id) from projected where not incoming),'[]'::jsonb))
  into result from public.household_recipient_codes c where c.profile_id=actor_id;
  return result;
end;
$$;

create function public.create_household_invitation(p_invitation_id uuid,p_household_id uuid,p_recipient_code uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid:=auth.uid(); recipient_id uuid; existing public.household_invitations;
  issued_at timestamptz; inserted_id uuid;
begin
  if actor_id is null then raise exception 'An authenticated profile is required' using errcode='42501'; end if;
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Invitation operations require READ COMMITTED' using errcode='25001'; end if;
  if p_invitation_id is null or p_household_id is null or p_recipient_code is null then
    raise exception 'Invalid invitation request' using errcode='22023'; end if;
  -- Actor lock also enforces the per-issuer limit across households. All invitation
  -- mutations take actor then household; joins share FIN-202's actor namespace.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('household-first:'||actor_id::text,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('household-invitations:'||p_household_id::text,0));
  perform 1 from public.household_members where household_id=p_household_id
    and profile_id=actor_id and role='OWNER' and left_at is null for share;
  if not found then raise exception 'Invitation unavailable' using errcode='42501'; end if;
  select * into existing from public.household_invitations where id=p_invitation_id;
  if found then
    if existing.household_id=p_household_id and existing.issuer_profile_id=actor_id
      and existing.recipient_code=p_recipient_code then
      return pg_catalog.jsonb_build_object('invitation_id',existing.id);
    end if;
    raise exception 'Invitation request conflicts' using errcode='23505';
  end if;
  select profile_id into recipient_id from public.household_recipient_codes where code=p_recipient_code;
  -- No endpoint resolves a code into another account. All ineligible code cases
  -- have the same message/code, no name, email or recipient Profile ID.
  if recipient_id is null or recipient_id=actor_id or exists (
    select 1 from public.household_members where household_id=p_household_id and profile_id=recipient_id
  ) then raise exception 'Invitation unavailable' using errcode='22023'; end if;
  -- Different households can target one recipient. Serialize their pending cap
  -- without taking a second actor lock (which could deadlock reciprocal invites).
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('household-inbox:'||recipient_id::text,0));
  issued_at:=pg_catalog.clock_timestamp();
  if exists(select 1 from public.household_invitations where household_id=p_household_id
      and recipient_profile_id=recipient_id and status='PENDING' and expires_at>issued_at) then
    raise exception 'Invitation unavailable' using errcode='22023'; end if;
  if (select count(*) from public.household_invitations where issuer_profile_id=actor_id
        and created_at>issued_at-interval '24 hours') >= 20
    or (select count(*) from public.household_invitations where household_id=p_household_id
        and status='PENDING' and expires_at>issued_at) >= 20
    or (select count(*) from public.household_invitations where recipient_profile_id=recipient_id
        and status='PENDING' and expires_at>issued_at) >= 20 then
    raise exception 'Invitation unavailable' using errcode='22023'; end if;
  insert into public.household_invitations(id,household_id,issuer_profile_id,recipient_profile_id,
    recipient_code,created_at,expires_at) values(p_invitation_id,p_household_id,actor_id,recipient_id,
    p_recipient_code,issued_at,issued_at+interval '168 hours') on conflict(id) do nothing returning id into inserted_id;
  if inserted_id is null then raise exception 'Invitation request conflicts' using errcode='23505'; end if;
  return pg_catalog.jsonb_build_object('invitation_id',inserted_id);
end;
$$;

create function public.revoke_household_invitation(p_invitation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid:=auth.uid(); invitation public.household_invitations;
begin
  if actor_id is null then raise exception 'An authenticated profile is required' using errcode='42501'; end if;
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Invitation operations require READ COMMITTED' using errcode='25001'; end if;
  if p_invitation_id is null then raise exception 'Invalid invitation request' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('household-first:'||actor_id::text,0));
  select * into invitation from public.household_invitations where id=p_invitation_id;
  if not found then raise exception 'Invitation unavailable' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('household-invitations:'||invitation.household_id::text,0));
  perform 1 from public.household_members where household_id=invitation.household_id
    and profile_id=actor_id and role='OWNER' and left_at is null for share;
  if not found then raise exception 'Invitation unavailable' using errcode='42501'; end if;
  select * into invitation from public.household_invitations where id=p_invitation_id for update;
  if invitation.status='REVOKED' then return pg_catalog.jsonb_build_object('invitation_id',invitation.id); end if;
  if invitation.status<>'PENDING' or invitation.expires_at<=pg_catalog.clock_timestamp() then
    raise exception 'Invitation unavailable' using errcode='22023'; end if;
  update public.household_invitations set status='REVOKED',resolved_at=pg_catalog.clock_timestamp() where id=invitation.id;
  return pg_catalog.jsonb_build_object('invitation_id',invitation.id);
end;
$$;

create function public.accept_household_invitation(p_invitation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid:=auth.uid(); invitation public.household_invitations; accepted_at timestamptz;
begin
  if actor_id is null then raise exception 'An authenticated profile is required' using errcode='42501'; end if;
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Invitation operations require READ COMMITTED' using errcode='25001'; end if;
  if p_invitation_id is null then raise exception 'Invalid invitation request' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('household-first:'||actor_id::text,0));
  select * into invitation from public.household_invitations where id=p_invitation_id and recipient_profile_id=actor_id;
  if not found then raise exception 'Invitation unavailable' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('household-invitations:'||invitation.household_id::text,0));
  select * into invitation from public.household_invitations where id=p_invitation_id and recipient_profile_id=actor_id for update;
  if not found then raise exception 'Invitation unavailable' using errcode='42501'; end if;
  if invitation.status='ACCEPTED' then
    -- Confirmation of an already committed transition is not another join.
    -- Expiry/issuer role cannot undo it, but current recipient access is mandatory.
    perform 1 from public.household_members where household_id=invitation.household_id
      and profile_id=actor_id and left_at is null for share;
    if not found then raise exception 'Invitation unavailable' using errcode='42501'; end if;
  else
    perform 1 from public.household_members where household_id=invitation.household_id
      and profile_id=invitation.issuer_profile_id and role='OWNER' and left_at is null for share;
    if not found then raise exception 'Invitation unavailable' using errcode='42501'; end if;
    accepted_at:=pg_catalog.clock_timestamp();
    if invitation.status<>'PENDING' or invitation.expires_at<=accepted_at then
      raise exception 'Invitation unavailable' using errcode='22023'; end if;
    -- No global membership limit, but ANY same-household history blocks a new
    -- transition. Never remove left_at, rewrite joined_at or elevate a role.
    if exists(select 1 from public.household_members where household_id=invitation.household_id and profile_id=actor_id) then
      raise exception 'Invitation unavailable' using errcode='22023'; end if;
    insert into public.household_members(household_id,profile_id,role,joined_at)
      values(invitation.household_id,actor_id,'MEMBER',accepted_at);
    update public.household_invitations set status='ACCEPTED',resolved_at=accepted_at where id=invitation.id;
  end if;
  return pg_catalog.jsonb_build_object('invitation_id',invitation.id,'household_id',invitation.household_id);
end;
$$;

revoke all on function public.get_my_household_invitations(),
  public.create_household_invitation(uuid,uuid,uuid),public.revoke_household_invitation(uuid),
  public.accept_household_invitation(uuid) from public, anon, authenticated;
grant execute on function public.get_my_household_invitations(),
  public.create_household_invitation(uuid,uuid,uuid),public.revoke_household_invitation(uuid),
  public.accept_household_invitation(uuid) to authenticated;
