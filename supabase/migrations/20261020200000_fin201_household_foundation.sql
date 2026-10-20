-- ADR-078: identity structure only. FIN-202 must separately review and introduce
-- active-member authorization; this migration deliberately exposes no client API.
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  default_currency text not null,
  created_by uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint households_name_check check (
    char_length(name) <= 100 and name ~ '[^[:space:]]'
  ),
  constraint households_default_currency_check check (
    default_currency ~ '^[A-Z]{3}$'
  ),
  constraint households_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete restrict
);

create table public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  profile_id uuid not null,
  role text not null,
  joined_at timestamptz not null default statement_timestamp(),
  left_at timestamptz,
  constraint household_members_household_id_fkey
    foreign key (household_id) references public.households(id) on delete restrict,
  constraint household_members_profile_id_fkey
    foreign key (profile_id) references public.profiles(id) on delete restrict,
  constraint household_members_household_profile_key
    unique (household_id, profile_id),
  constraint household_members_role_check check (role in ('OWNER', 'MEMBER')),
  constraint household_members_dates_check check (
    isfinite(joined_at)
    and (left_at is null or (isfinite(left_at) and left_at >= joined_at))
  )
);

-- The unique pair index already covers household -> member lookups. This index
-- supports profile -> membership lookup without deciding MVP household limits.
create index household_members_profile_id_idx
  on public.household_members (profile_id);
create index households_created_by_idx on public.households (created_by);

create function public.prepare_household_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Creation provenance is not an ownership grant and cannot be reassigned.
  if new.id is distinct from old.id or new.created_by is distinct from old.created_by then
    raise exception 'Household identity and creator are immutable'
      using errcode = '23514';
  end if;
  new.created_at := old.created_at;
  new.updated_at := pg_catalog.statement_timestamp();
  return new;
end;
$$;

create trigger households_prepare_update
before update on public.households
for each row execute function public.prepare_household_update();

create function public.prepare_household_member_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Future role/lifecycle operations cannot move existing attribution between
  -- profiles or households. Rejoining requires a separately defined lifecycle.
  if new.id is distinct from old.id
    or new.household_id is distinct from old.household_id
    or new.profile_id is distinct from old.profile_id
    or new.joined_at is distinct from old.joined_at then
    raise exception 'Household membership identity and join time are immutable'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger household_members_prepare_update
before update on public.household_members
for each row execute function public.prepare_household_member_update();

revoke all on function public.prepare_household_update()
  from public, anon, authenticated;
revoke all on function public.prepare_household_member_update()
  from public, anon, authenticated;

alter table public.households enable row level security;
alter table public.household_members enable row level security;

-- Supabase's default table grants are broad. Both grants and RLS independently
-- deny client access, including creators and members, until FIN-202 defines it.
revoke all on table public.households from public, anon, authenticated;
revoke all on table public.household_members from public, anon, authenticated;
