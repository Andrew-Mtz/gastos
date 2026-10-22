\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
\ir helpers/auth.sql.inc
select no_plan();
-- The inline code FK and the composite identity FK must coexist with distinct
-- names. The latter is essential: two individually valid identities cannot pair.
select ok(exists(select 1 from pg_constraint
  where conrelid='public.household_invitations'::regclass
    and conname='household_invitations_recipient_code_fkey'
    and contype='f'
    and pg_get_constraintdef(oid)='FOREIGN KEY (recipient_code) REFERENCES household_recipient_codes(code) ON DELETE RESTRICT'),
  'Recipient code retains its independent foreign key');
select ok(exists(select 1 from pg_constraint
  where conrelid='public.household_invitations'::regclass
    and conname='household_invitations_recipient_profile_code_fkey'
    and contype='f'
    and pg_get_constraintdef(oid)='FOREIGN KEY (recipient_profile_id, recipient_code) REFERENCES household_recipient_codes(profile_id, code) ON DELETE RESTRICT'),
  'Distinct composite foreign key binds recipient Profile to its own code');
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
 select ('f2030000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
insert into auth.users(id,email) select pg_temp.id(n),'fin203-'||n||'@example.invalid' from generate_series(1,30)n;
insert into public.profiles(id,display_name,base_currency,timezone)
select pg_temp.id(n),'Private name '||n,'USD','UTC' from generate_series(1,29)n;
insert into public.household_recipient_codes(profile_id,code)
select pg_temp.id(n),pg_temp.id(n+100) from generate_series(1,28)n;
insert into public.households(id,name,default_currency,created_by) values
(pg_temp.id(200),'Synthetic Home A','USD',pg_temp.id(1)),
(pg_temp.id(201),'Synthetic Home B','EUR',pg_temp.id(2)),
(pg_temp.id(202),'Creator is not owner','USD',pg_temp.id(3));
insert into public.household_members(household_id,profile_id,role,joined_at,left_at) values
(pg_temp.id(200),pg_temp.id(1),'OWNER','2026-01-01',null),
(pg_temp.id(200),pg_temp.id(4),'MEMBER','2026-01-01',null),
(pg_temp.id(200),pg_temp.id(5),'MEMBER','2026-01-01','2026-02-01'),
(pg_temp.id(201),pg_temp.id(2),'OWNER','2026-01-01',null),
(pg_temp.id(202),pg_temp.id(1),'OWNER','2026-01-01',null);
select ok(prosecdef and proconfig @> array['search_path=""'], 'Reviewed narrow definer: '||proname)
from pg_proc where oid in ('public.get_my_household_invitations()'::regprocedure,
'public.create_household_invitation(uuid,uuid,uuid)'::regprocedure,
'public.accept_household_invitation(uuid)'::regprocedure,
'public.revoke_household_invitation(uuid)'::regprocedure);
select ok(has_function_privilege('authenticated',f,'EXECUTE') and not has_function_privilege('anon',f,'EXECUTE'), 'Only authenticated RPC: '||f)
from unnest(array['public.get_my_household_invitations()','public.create_household_invitation(uuid,uuid,uuid)',
'public.accept_household_invitation(uuid)','public.revoke_household_invitation(uuid)'])f;
select ok(not exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl)a where p.oid=f::regprocedure and a.grantee=0), 'No PUBLIC RPC: '||f)
from unnest(array['public.get_my_household_invitations()','public.create_household_invitation(uuid,uuid,uuid)',
'public.accept_household_invitation(uuid)','public.revoke_household_invitation(uuid)'])f;
select ok(c.relrowsecurity, 'Default deny RLS: '||c.relname) from pg_class c where c.oid in ('public.household_invitations'::regclass,'public.household_recipient_codes'::regclass);
select ok(not has_table_privilege(role_name,t,privilege_name),'No '||role_name||' '||privilege_name||' on '||t)
from unnest(array['anon','authenticated'])role_name
cross join unnest(array['public.household_invitations','public.household_recipient_codes'])t
cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])privilege_name;
select ok(not has_any_column_privilege('authenticated',t,p),'No column bypass: '||t||' '||p)
from unnest(array['public.household_invitations','public.household_recipient_codes'])t
cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES'])p;

set local role anon;
select pg_temp.set_jwt_subject(null);
select is(current_user::text,'anon','Anonymous role is real');
select is(auth.uid(),null::uuid,'Anonymous subject absent');
select throws_ok('select public.get_my_household_invitations()','42501',null,'Anonymous cannot obtain code/context');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject(null);
select is(current_user::text,'authenticated','Real authenticated role');
select is(auth.uid(),null::uuid,'Missing JWT subject is real');
select throws_ok('select public.get_my_household_invitations()','42501',null,'Missing subject denied');
select throws_ok('select public.accept_household_invitation(pg_temp.id(300))','42501',null,'Missing subject cannot accept');
select pg_temp.set_jwt_subject(pg_temp.id(30));
select is(auth.uid(),pg_temp.id(30),'Auth-only fixture subject');
select throws_ok('select public.get_my_household_invitations()','42501',null,'Missing Profile denied');
select pg_temp.set_jwt_subject(pg_temp.id(29));
select is(auth.uid(),pg_temp.id(29),'Own-code fixture subject');
select is(public.get_my_household_invitations()->>'profile_id',pg_temp.id(29)::text,'Context derives actor');
select is(public.get_my_household_invitations()->>'recipient_code',public.get_my_household_invitations()->>'recipient_code','Own code allocation is idempotent');
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_my_household_invitations()) k),array['incoming','outgoing','profile_id','recipient_code'],'Own context has exact minimal fields');

select pg_temp.set_jwt_subject(pg_temp.id(1));
select is(auth.uid(),pg_temp.id(1),'Owner fixture subject');
select is(public.create_household_invitation(pg_temp.id(300),pg_temp.id(200),pg_temp.id(102)),jsonb_build_object('invitation_id',pg_temp.id(300)),'Owner creates directed invitation with minimal ack');
select is(public.create_household_invitation(pg_temp.id(300),pg_temp.id(200),pg_temp.id(102)),jsonb_build_object('invitation_id',pg_temp.id(300)),'Exact request replay returns same identity');
select throws_ok('select public.create_household_invitation(pg_temp.id(300),pg_temp.id(200),pg_temp.id(103))','23505',null,'Changed recipient replay conflicts');
select throws_ok('select public.create_household_invitation(pg_temp.id(300),pg_temp.id(202),pg_temp.id(102))','23505',null,'Changed household replay conflicts');
select throws_ok('select public.create_household_invitation(pg_temp.id(301),pg_temp.id(200),pg_temp.id(102))','22023','Invitation unavailable','Duplicate live pair denied without enumeration');
select throws_ok('select public.create_household_invitation(pg_temp.id(301),pg_temp.id(200),pg_temp.id(999))','22023','Invitation unavailable','Unknown code same generic error');
select throws_ok('select public.create_household_invitation(pg_temp.id(301),pg_temp.id(200),pg_temp.id(101))','22023','Invitation unavailable','Self code same generic error');
select throws_ok('select public.create_household_invitation(pg_temp.id(301),pg_temp.id(200),pg_temp.id(104))','22023','Invitation unavailable','Active same-home member same generic error');
select throws_ok('select public.create_household_invitation(pg_temp.id(301),pg_temp.id(200),pg_temp.id(105))','22023','Invitation unavailable','Historical member not silently reactivated');
select is(jsonb_array_length(public.get_my_household_invitations()->'outgoing'),1,'Only one request persisted');
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_my_household_invitations()->'outgoing'->0) k),array['expires_at','household_id','household_name','id','recipient_code','status'],'Outbox exposes own entered code but no recipient name/Profile');
select throws_ok('select * from public.household_invitations','42501',null,'Owner cannot directly read invitation internals');
select throws_ok('select * from public.household_recipient_codes','42501',null,'Owner cannot enumerate codes');
select throws_ok($$insert into public.household_invitations(id,household_id,issuer_profile_id,recipient_profile_id,recipient_code,expires_at) values(pg_temp.id(900),pg_temp.id(200),pg_temp.id(1),pg_temp.id(3),pg_temp.id(103),now()+interval '7 days')$$,'42501',null,'Forged direct invitation write denied');
select throws_ok($$update public.household_invitations set status='ACCEPTED' where id=pg_temp.id(300)$$,'42501',null,'Forged acceptance denied');
select throws_ok('delete from public.household_invitations where id=pg_temp.id(300)','42501',null,'Direct deletion denied');
select throws_ok('update public.household_recipient_codes set code=pg_temp.id(999) where profile_id=pg_temp.id(2)','42501',null,'Cannot substitute recipient code');

select pg_temp.set_jwt_subject(pg_temp.id(3));
select is(auth.uid(),pg_temp.id(3),'Stranger / creator-only fixture subject');
select is(jsonb_array_length(public.get_my_household_invitations()->'incoming'),0,'Stranger cannot see inbox');
select is(jsonb_array_length(public.get_my_household_invitations()->'outgoing'),0,'Creator provenance exposes no outbox');
select throws_ok('select public.create_household_invitation(pg_temp.id(301),pg_temp.id(202),pg_temp.id(102))','42501',null,'Creator without OWNER cannot invite');
select throws_ok('select public.accept_household_invitation(pg_temp.id(300))','42501','Invitation unavailable','Known invitation ID is not bearer authority');
select throws_ok('select public.revoke_household_invitation(pg_temp.id(300))','42501',null,'Stranger cannot revoke');
select pg_temp.set_jwt_subject(pg_temp.id(4));
select is(auth.uid(),pg_temp.id(4),'Active MEMBER fixture subject');
select throws_ok('select public.create_household_invitation(pg_temp.id(301),pg_temp.id(200),pg_temp.id(103))','42501',null,'MEMBER cannot invite');
select throws_ok('select public.revoke_household_invitation(pg_temp.id(300))','42501',null,'MEMBER cannot revoke');
select pg_temp.set_jwt_subject(pg_temp.id(5));
select is(auth.uid(),pg_temp.id(5),'Departed fixture subject');
select throws_ok('select public.create_household_invitation(pg_temp.id(301),pg_temp.id(200),pg_temp.id(103))','42501',null,'Departed membership cannot invite');

-- Independent RLS denial even with temporary SQL privileges, all rolled back.
reset role;
grant select,insert,update,delete on public.household_invitations,public.household_recipient_codes to authenticated;
set local role authenticated;
select pg_temp.set_jwt_subject(pg_temp.id(2));
select is(current_user::text,'authenticated','Recipient under real RLS');
select is(auth.uid(),pg_temp.id(2),'Recipient subject');
select is((select count(*) from public.household_invitations),0::bigint,'Recipient direct read filtered by RLS despite grant');
select is((select count(*) from public.household_recipient_codes),0::bigint,'Codes filtered by RLS despite grant');
select throws_ok('insert into public.household_recipient_codes(profile_id) values(pg_temp.id(29))','42501',null,'RLS WITH CHECK independently rejects code writes');
with changed as(update public.household_invitations set recipient_profile_id=pg_temp.id(3) returning id)
select is((select count(*) from changed),0::bigint,'RLS update independently filters');
with removed as(delete from public.household_invitations returning id)
select is((select count(*) from removed),0::bigint,'RLS delete independently filters');
select is(jsonb_array_length(public.get_my_household_invitations()->'incoming'),1,'Only intended recipient receives invitation');
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_my_household_invitations()->'incoming'->0) k),array['expires_at','household_id','household_name','id','status'],'Prejoin inbox contains no member, issuer, code or personal identity');
select is((select count(*) from public.households where id=pg_temp.id(200)),0::bigint,'Invitation alone gives no household read');
select is((select count(*) from public.household_members where household_id=pg_temp.id(200)),0::bigint,'Invitation alone gives no membership read');
select is(public.accept_household_invitation(pg_temp.id(300)),jsonb_build_object('invitation_id',pg_temp.id(300),'household_id',pg_temp.id(200)),'Recipient explicitly accepts even with another active household');
select is(jsonb_array_length(public.get_my_household_memberships()->'households'),2,'Two active households remain separate');
select is(public.accept_household_invitation(pg_temp.id(300)),jsonb_build_object('invitation_id',pg_temp.id(300),'household_id',pg_temp.id(200)),'Acceptance replay does not create another membership');
select is((select count(*) from public.profiles),1::bigint,'Membership still never grants private Profiles');
select is((select count(*) from public.profiles where id=pg_temp.id(1)),0::bigint,'Partner private profile remains inaccessible');
reset role;
revoke all on public.household_invitations,public.household_recipient_codes from authenticated;
select is((select role from public.household_members where household_id=pg_temp.id(200) and profile_id=pg_temp.id(2)),'MEMBER','Acceptance can only assign MEMBER');
select is((select count(*) from public.household_members where household_id=pg_temp.id(200) and profile_id=pg_temp.id(2)),1::bigint,'One immutable membership identity');
select is((select expires_at-created_at from public.household_invitations where id=pg_temp.id(300)),interval '168 hours','Exact seven-day lifetime');
select is((select status from public.household_invitations where id=pg_temp.id(300)),'ACCEPTED','Membership and accepted state committed together');

set local role authenticated;
select pg_temp.set_jwt_subject(pg_temp.id(1));
select is(current_user::text,'authenticated','Owner revoke uses real role');
select is(auth.uid(),pg_temp.id(1),'Owner revoke subject');
select throws_ok('select public.revoke_household_invitation(pg_temp.id(300))','22023',null,'Cannot cancel accepted membership');
select lives_ok('select public.create_household_invitation(pg_temp.id(302),pg_temp.id(200),pg_temp.id(103))','Another directed invitation');
select is(public.revoke_household_invitation(pg_temp.id(302)),jsonb_build_object('invitation_id',pg_temp.id(302)),'OWNER cancels pending request');
select is(public.revoke_household_invitation(pg_temp.id(302)),jsonb_build_object('invitation_id',pg_temp.id(302)),'Cancellation replay is read-only');
select pg_temp.set_jwt_subject(pg_temp.id(3));
select is(auth.uid(),pg_temp.id(3),'Revoked recipient subject');
select throws_ok('select public.accept_household_invitation(pg_temp.id(302))','22023',null,'Revoked request cannot be accepted');
reset role;
select is((select count(*) from public.household_members where household_id=pg_temp.id(200) and profile_id=pg_temp.id(3)),0::bigint,'Rejected acceptance leaves no membership');
-- Synthetic backend lifecycle changes simulate revocation not yet exposed in app.
update public.household_members set left_at=clock_timestamp() where household_id=pg_temp.id(200) and profile_id=pg_temp.id(2);
set local role authenticated;
select pg_temp.set_jwt_subject(pg_temp.id(2));
select is(current_user::text,'authenticated','Former recipient real role');
select is(auth.uid(),pg_temp.id(2),'Former recipient subject');
select throws_ok('select public.accept_household_invitation(pg_temp.id(300))','42501',null,'Accepted replay after loss of access returns no household');
select is(jsonb_array_length(public.get_my_household_invitations()->'incoming'),0,'Accepted invitation disappears after membership loss');
reset role;
select ok((select left_at is not null from public.household_members where household_id=pg_temp.id(200) and profile_id=pg_temp.id(2)),'Replay never reactivates history');

-- Explicit expired / historical / issuer-revoked fixtures, no real user data.
insert into public.household_invitations(id,household_id,issuer_profile_id,recipient_profile_id,recipient_code,created_at,expires_at) values
(pg_temp.id(303),pg_temp.id(200),pg_temp.id(1),pg_temp.id(3),pg_temp.id(103),now()-interval '8 days',now()-interval '1 day'),
(pg_temp.id(304),pg_temp.id(200),pg_temp.id(1),pg_temp.id(5),pg_temp.id(105),now(),now()+interval '7 days'),
(pg_temp.id(305),pg_temp.id(202),pg_temp.id(1),pg_temp.id(3),pg_temp.id(103),now(),now()+interval '7 days');
update public.household_members set role='MEMBER' where household_id=pg_temp.id(202) and profile_id=pg_temp.id(1);
set local role authenticated;
select pg_temp.set_jwt_subject(pg_temp.id(3));
select is(current_user::text,'authenticated','Unavailable invite tests use real role');
select is(auth.uid(),pg_temp.id(3),'Unavailable invite recipient');
select throws_ok('select public.accept_household_invitation(pg_temp.id(303))','22023',null,'Expired invitation cannot be accepted');
select throws_ok('select public.accept_household_invitation(pg_temp.id(305))','42501',null,'Issuer must still be active OWNER');
select ok(exists(select 1 from jsonb_array_elements(public.get_my_household_invitations()->'incoming')i where i->>'status'='EXPIRED'),'Expiry projected explicitly');
select ok(exists(select 1 from jsonb_array_elements(public.get_my_household_invitations()->'incoming')i where i->>'status'='UNAVAILABLE'),'Lost issuer permission projected without identity');
select pg_temp.set_jwt_subject(pg_temp.id(5));
select is(auth.uid(),pg_temp.id(5),'Historical recipient subject');
select throws_ok('select public.accept_household_invitation(pg_temp.id(304))','22023',null,'New acceptance does not revive historical membership');
reset role;
select is((select count(*) from public.household_members where household_id=pg_temp.id(200) and profile_id=pg_temp.id(5) and left_at is null),0::bigint,'Historical timestamp remains closed');

-- Per-issuer creation limit counts revoked requests too; replay does not consume it.
insert into public.household_invitations(id,household_id,issuer_profile_id,recipient_profile_id,recipient_code,status,created_at,expires_at,resolved_at)
select pg_temp.id(500+n),pg_temp.id(200),pg_temp.id(1),pg_temp.id(6),pg_temp.id(106),'REVOKED',now(),now()+interval '7 days',now() from generate_series(1,20)n;
set local role authenticated;
select pg_temp.set_jwt_subject(pg_temp.id(1));
select is(current_user::text,'authenticated','Rate test real role');
select is(auth.uid(),pg_temp.id(1),'Rate test owner');
select throws_ok('select public.create_household_invitation(pg_temp.id(600),pg_temp.id(200),pg_temp.id(107))','22023','Invitation unavailable','Daily cap blocks new invitation without account enumeration');
select is(public.create_household_invitation(pg_temp.id(302),pg_temp.id(200),pg_temp.id(103)),jsonb_build_object('invitation_id',pg_temp.id(302)),'Exact replay works at cap and does not revive cancellation');
reset role;
select is((select status from public.household_invitations where id=pg_temp.id(302)),'REVOKED','Creation replay never resets lifecycle');

-- Reversible operational caps, tested independently so one cannot mask another.
insert into public.households(id,name,default_currency,created_by)
select pg_temp.id(n),'Synthetic cap home','USD',pg_temp.id(case when n=204 then 27 when n=205 then 26 else 28 end)
from generate_series(203,205)n;
insert into public.household_members(household_id,profile_id,role)
select id,created_by,'OWNER' from public.households where id in (pg_temp.id(203),pg_temp.id(204),pg_temp.id(205));
insert into public.household_invitations(id,household_id,issuer_profile_id,recipient_profile_id,recipient_code,created_at,expires_at)
select pg_temp.id(700+n),pg_temp.id(203),pg_temp.id(28),pg_temp.id(n),pg_temp.id(100+n),now()-interval '25 hours',now()+interval '143 hours' from generate_series(6,25)n;
set local role authenticated;
select pg_temp.set_jwt_subject(pg_temp.id(28));
select is(current_user::text,'authenticated','Household cap real role');
select is(auth.uid(),pg_temp.id(28),'Household cap owner');
select throws_ok('select public.create_household_invitation(pg_temp.id(800),pg_temp.id(203),pg_temp.id(103))','22023','Invitation unavailable','Twenty live household requests block a new one without daily cap');
reset role;
-- Incoming cap can count directed rows from distinct households; only the count
-- matters and clients still cannot inspect those other household identities.
insert into public.household_invitations(id,household_id,issuer_profile_id,recipient_profile_id,recipient_code,created_at,expires_at)
select pg_temp.id(810+n),pg_temp.id(200),pg_temp.id(1),pg_temp.id(6),pg_temp.id(106),now()-interval '25 hours',now()+interval '143 hours' from generate_series(1,19)n;
set local role authenticated;
select pg_temp.set_jwt_subject(pg_temp.id(27));
select is(current_user::text,'authenticated','Incoming cap real role');
select is(auth.uid(),pg_temp.id(27),'Independent owner with no daily or household requests');
select throws_ok('select public.create_household_invitation(pg_temp.id(850),pg_temp.id(204),pg_temp.id(106))','22023','Invitation unavailable','Twenty incoming requests block new sender independently');
reset role;
insert into public.household_invitations(id,household_id,issuer_profile_id,recipient_profile_id,recipient_code,status,created_at,expires_at,resolved_at)
select pg_temp.id(860+n),pg_temp.id(205),pg_temp.id(26),pg_temp.id(7),pg_temp.id(107),'REVOKED',now(),now()+interval '168 hours',now() from generate_series(1,19)n;
set local role authenticated;
select pg_temp.set_jwt_subject(pg_temp.id(26));
select is(current_user::text,'authenticated','Daily boundary real role');
select is(auth.uid(),pg_temp.id(26),'Daily boundary owner');
select lives_ok('select public.create_household_invitation(pg_temp.id(890),pg_temp.id(205),pg_temp.id(108))','Twentieth daily creation allowed');
select throws_ok('select public.create_household_invitation(pg_temp.id(891),pg_temp.id(205),pg_temp.id(109))','22023','Invitation unavailable','Twenty-first daily creation denied');
reset role;
select throws_ok($$insert into public.household_invitations(id,household_id,issuer_profile_id,recipient_profile_id,recipient_code,created_at,expires_at) values(pg_temp.id(950),pg_temp.id(200),pg_temp.id(1),pg_temp.id(2),pg_temp.id(103),now(),now()+interval '168 hours')$$,'23503',null,'Stored recipient-code pair cannot mismatch');
select throws_ok($$insert into public.household_invitations(id,household_id,issuer_profile_id,recipient_profile_id,recipient_code,created_at,expires_at) values(pg_temp.id(951),pg_temp.id(200),pg_temp.id(1),pg_temp.id(3),pg_temp.id(103),now(),now()+interval '8 days')$$,'23514',null,'Stored expiry cannot expand lifetime');
select throws_ok($$insert into public.household_invitations(id,household_id,issuer_profile_id,recipient_profile_id,recipient_code,status,created_at,expires_at) values(pg_temp.id(952),pg_temp.id(200),pg_temp.id(1),pg_temp.id(3),pg_temp.id(103),'ACCEPTED',now(),now()+interval '168 hours')$$,'23514',null,'Terminal state requires resolution evidence');
-- A replay is confirmation, not a fresh acceptance: the original valid transition
-- remains confirmable after expiry or issuer demotion, while recipient is active.
insert into public.household_members(household_id,profile_id,role,joined_at) values(pg_temp.id(204),pg_temp.id(3),'MEMBER',now()-interval '2 days');
insert into public.household_invitations(id,household_id,issuer_profile_id,recipient_profile_id,recipient_code,status,created_at,expires_at,resolved_at)
values(pg_temp.id(970),pg_temp.id(204),pg_temp.id(27),pg_temp.id(3),pg_temp.id(103),'ACCEPTED',now()-interval '8 days',now()-interval '1 day',now()-interval '2 days');
update public.household_members set role='MEMBER' where household_id=pg_temp.id(204) and profile_id=pg_temp.id(27);
set local role authenticated;
select pg_temp.set_jwt_subject(pg_temp.id(3));
select is(current_user::text,'authenticated','Accepted confirmation real role');
select is(auth.uid(),pg_temp.id(3),'Accepted confirmation intended recipient');
select is(public.accept_household_invitation(pg_temp.id(970)),jsonb_build_object('invitation_id',pg_temp.id(970),'household_id',pg_temp.id(204)),'Existing result survives expiry and issuer demotion without rejoining');
reset role;
select is((select count(*) from public.household_members where household_id=pg_temp.id(204) and profile_id=pg_temp.id(3)),1::bigint,'Confirmation adds no second membership');
select * from finish();
rollback;
