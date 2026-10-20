-- Composite ownership references enforce same-owner relations independently of RLS.
alter table public.budget_buckets
  add constraint budget_buckets_id_profile_id_key unique (id, profile_id);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  name text not null check (name ~ '[^[:space:]]'),
  budget_bucket_id uuid,
  is_system boolean not null default false,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  archived_at timestamptz,
  constraint categories_bucket_owner_fkey foreign key (budget_bucket_id, profile_id)
    references public.budget_buckets(id, profile_id) on delete restrict
);
create index categories_profile_id_idx on public.categories(profile_id);
create index categories_budget_bucket_id_idx on public.categories(budget_bucket_id);

create function public.prepare_category_update()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  new.created_at := old.created_at;
  new.updated_at := pg_catalog.statement_timestamp();
  if new.archived_at is not null then
    new.archived_at := coalesce(old.archived_at, pg_catalog.statement_timestamp());
  end if;
  return new;
end;
$$;
create trigger categories_prepare_update before update on public.categories
for each row execute function public.prepare_category_update();
revoke all on function public.prepare_category_update() from public, anon, authenticated;

alter table public.categories enable row level security;
revoke all on table public.categories from public, anon, authenticated;
grant select on public.categories to authenticated;
grant insert (profile_id, name, budget_bucket_id) on public.categories to authenticated;
-- Bucket mapping is immutable through ordinary edits: later category organization
-- must not silently move historical spending between budgets.
grant update (name, archived_at) on public.categories to authenticated;
create policy categories_select_own on public.categories for select to authenticated
using (profile_id = (select auth.uid()));
create policy categories_insert_own on public.categories for insert to authenticated
with check (profile_id = (select auth.uid()) and not is_system and (
  budget_bucket_id is null or exists (
    select 1 from public.budget_buckets b where b.id = budget_bucket_id
      and b.profile_id = (select auth.uid()) and b.archived_at is null
  )
));
create policy categories_update_custom_own on public.categories for update to authenticated
using (profile_id = (select auth.uid()) and not is_system)
with check (profile_id = (select auth.uid()) and not is_system);
