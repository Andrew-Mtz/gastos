create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null,
  base_currency text not null,
  timezone text not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint profiles_display_name_check check (
    char_length(display_name) <= 100 and display_name ~ '[^[:space:]]'
  ),
  constraint profiles_base_currency_check check (base_currency ~ '^[A-Z]{3}$')
);

-- RESTRICT preserves identity/history until account deletion is designed explicitly.
-- Future application foreign keys reference profiles(id), not auth.users directly.

create function public.prepare_profile_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Accept named zones (including UTC), not abbreviations or numeric offsets.
  if not exists (
    select 1 from pg_catalog.pg_timezone_names as zone
    where zone.name = new.timezone
      and (zone.name = 'UTC' or position('/' in zone.name) > 0)
      and zone.name not like 'posix/%'
      and zone.name not like 'right/%'
  ) then
    raise exception 'timezone must be a recognized named timezone'
      using errcode = '23514', constraint = 'profiles_timezone_check';
  end if;

  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  end if;
  new.updated_at := pg_catalog.statement_timestamp();
  return new;
end;
$$;

create trigger profiles_prepare_write
before insert or update on public.profiles
for each row execute function public.prepare_profile_write();

revoke all on function public.prepare_profile_write()
from public, anon, authenticated;

alter table public.profiles enable row level security;

-- Remove Supabase's broad default table grants before allowing specific columns.
revoke all on table public.profiles from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select on table public.profiles to authenticated;
grant insert (id, display_name, base_currency, timezone)
  on public.profiles to authenticated;
grant update (display_name, base_currency, timezone)
  on public.profiles to authenticated;

create policy profiles_select_own
on public.profiles for select to authenticated
using (id = (select auth.uid()));

create policy profiles_insert_own
on public.profiles for insert to authenticated
with check (id = (select auth.uid()));

create policy profiles_update_own
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));
