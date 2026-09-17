create table public.budget_periods (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  starts_on date not null,
  ends_on date not null,
  status text not null default 'OPEN',
  base_currency text not null,
  expected_income_minor bigint,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  closed_at timestamptz,
  constraint budget_periods_profile_id_fkey
    foreign key (profile_id) references public.profiles(id) on delete restrict,
  constraint budget_periods_profile_month_key unique (profile_id, starts_on),
  constraint budget_periods_calendar_month_check check (
    extract(day from starts_on) = 1
    and ends_on = (starts_on + interval '1 month' - interval '1 day')::date
  ),
  constraint budget_periods_status_check check (status in ('OPEN', 'CLOSED')),
  constraint budget_periods_closed_state_check check (
    (status = 'OPEN' and closed_at is null)
    or (status = 'CLOSED' and closed_at is not null)
  ),
  constraint budget_periods_base_currency_check check (
    base_currency ~ '^[A-Z]{3}$'
  ),
  constraint budget_periods_expected_income_minor_check check (
    expected_income_minor is null
    or (
      expected_income_minor >= 0
      and expected_income_minor <= 9007199254740991
    )
  )
);

create function public.prepare_budget_period_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.created_at := old.created_at;
  new.updated_at := pg_catalog.statement_timestamp();
  return new;
end;
$$;

create trigger budget_periods_prepare_update
before update on public.budget_periods
for each row execute function public.prepare_budget_period_update();

revoke all on function public.prepare_budget_period_update()
from public, anon, authenticated;

alter table public.budget_periods enable row level security;

-- Remove Supabase's broad default grants before adding the client contract.
revoke all on table public.budget_periods from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select on table public.budget_periods to authenticated;
grant insert (
  profile_id,
  starts_on,
  ends_on,
  base_currency,
  expected_income_minor
) on public.budget_periods to authenticated;
grant update (expected_income_minor)
on public.budget_periods to authenticated;

create policy budget_periods_select_own
on public.budget_periods for select to authenticated
using (profile_id = (select auth.uid()));

create policy budget_periods_insert_own
on public.budget_periods for insert to authenticated
with check (profile_id = (select auth.uid()));

create policy budget_periods_update_open_own
on public.budget_periods for update to authenticated
using (
  profile_id = (select auth.uid())
  and status = 'OPEN'
)
with check (
  profile_id = (select auth.uid())
  and status = 'OPEN'
);
