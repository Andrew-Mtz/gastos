create table public.budget_buckets (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  name text not null,
  type text not null,
  is_system boolean not null default false,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  archived_at timestamptz,
  constraint budget_buckets_profile_id_fkey
    foreign key (profile_id) references public.profiles(id) on delete restrict,
  constraint budget_buckets_name_check check (name ~ '[^[:space:]]'),
  constraint budget_buckets_type_check check (type in ('SPENDABLE', 'SAVINGS'))
);

create index budget_buckets_profile_id_idx on public.budget_buckets (profile_id);

create function public.prepare_budget_bucket_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.created_at := old.created_at;
  new.updated_at := pg_catalog.statement_timestamp();
  -- Clients request archive/restore, but cannot forge the archive timestamp or
  -- rewrite it on a repeated archive. Archiving preserves the row for history.
  if new.archived_at is not null then
    new.archived_at := coalesce(old.archived_at, pg_catalog.statement_timestamp());
  end if;
  return new;
end;
$$;

create trigger budget_buckets_prepare_update
before update on public.budget_buckets
for each row execute function public.prepare_budget_bucket_update();

revoke all on function public.prepare_budget_bucket_update()
from public, anon, authenticated;

alter table public.budget_buckets enable row level security;

-- Default grants must not let clients reassign ownership, turn savings into
-- spendable money, claim system provenance, or destroy historical references.
revoke all on table public.budget_buckets from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select on table public.budget_buckets to authenticated;
grant insert (profile_id, name, type)
on public.budget_buckets to authenticated;
grant update (name, archived_at)
on public.budget_buckets to authenticated;

create policy budget_buckets_select_own
on public.budget_buckets for select to authenticated
using (profile_id = (select auth.uid()));

create policy budget_buckets_insert_own
on public.budget_buckets for insert to authenticated
with check (profile_id = (select auth.uid()) and not is_system);

-- System-bucket customization belongs to a later product version. No default
-- buckets are provisioned here; initial budget setup is FIN-106.
create policy budget_buckets_update_custom_own
on public.budget_buckets for update to authenticated
using (profile_id = (select auth.uid()) and not is_system)
with check (profile_id = (select auth.uid()) and not is_system);
