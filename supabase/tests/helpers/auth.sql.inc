-- Include only after BEGIN. These fixtures and the temporary function roll back.
-- No passwords or auth.identities are needed for database authorization tests.
insert into auth.users (id, email) values
  ('f0050000-0000-4000-8000-000000000001', 'fin005-a@example.invalid'), -- Andy Test
  ('f0050000-0000-4000-8000-000000000002', 'fin005-b@example.invalid'), -- Partner Test
  ('f0050000-0000-4000-8000-000000000003', 'fin005-c@example.invalid'); -- Stranger Test

-- Does not switch roles or replace auth.uid(). Call after an explicit role switch.
-- Keep legacy claims and JSON claims consistent; NULL clears the previous subject.
create function pg_temp.set_jwt_subject(user_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', coalesce(user_id::text, ''), true);
  perform pg_catalog.set_config('request.jwt.claim.role', current_user::text, true);
  perform pg_catalog.set_config('request.jwt.claims',
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'sub', user_id, 'role', current_user
    ))::text, true);
end;
$$;

revoke all on function pg_temp.set_jwt_subject(uuid) from public;
grant execute on function pg_temp.set_jwt_subject(uuid) to authenticated, anon;
