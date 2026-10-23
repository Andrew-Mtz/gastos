# FIN-205 Default Household Split

Prepared against main `b188dfcb5340431de488a5bcebdf64ae0e72c0f5` (FIN-203/204 integrated).
No hosted environment, real account, invitation, money, credential or production
permission was used. This document distinguishes authored coverage from execution.

## Contract

- Current active OWNER saves; every active member reads the household-only template.
- One explicit integer 0–10000 share for each active membership, exactly 10000 total.
  No implicit equal distribution, missing participant or foreign-household reference.
- An unconfigured household has no template. Current-roster mismatch is STALE;
  historical shares/identities are withheld and a new explicit owner review is required.
- Version/roster preconditions reject stale new requests. Exact request UUID/payload
  retries confirm their original receipt, even after a newer version, without rewrite.
- Two server-only RLS tables and two narrowed RPCs; composite foreign keys, atomic
  writes, immutable-update guards and deferred whole-revision integrity. Privileged
  synthetic cleanup can delete complete revisions, but clients cannot delete or edit.
- READ COMMITTED; invitation advisory → parent FOR UPDATE → all memberships FOR SHARE
  in ID order → fresh permission/roster/version reads. No membership lifecycle is added.
- Pure percentage domain + strict DTOs + RHF/Zod form + existing auth-cleared QueryClient.
  Confirmation, hidden stale reads, dismissible drafts and stable in-session pending
  retry. No persisted/offline pending requests, no monetary effects, no FIN-206+.

## Authored automated coverage

- Domain: exact integer totals, zeros, three-member roster, duplicate/missing/foreign
  participants, invalid/fractional/nonfinite values, sparse arrays and deterministic order.
- DTO/form/data: strict response scope/shape, state/version/roster consistency, no
  stale fallback, exact decimal parsing, stable requests/receipts and safe errors.
- UI through Hogar: OWNER versus MEMBER, empty/stale/current states, explicit zero,
  total validation, review/confirm/cancel, duplicate submission, remount/lost response,
  newer-version replay, conflict, focus/background, failed reads and auth-cleared cache.
- SQL: actual roles/JWT, anon/stranger/inactive/creator/member denial, grants versus
  RLS independently, exact DTO, full-roster validation, version/replay/actor collisions,
  composite FK, deferred total/atomicity, former-member hiding and no finance activity.
  Deferred constraints are forced while still authenticated to cover PostgreSQL 17.
- Concurrency: identical/distinct saves, joins both orders, OWNER demotion/departure,
  member departure, trusted insertion and reactivation in both orders with observed
  lock waits; isolation-level rejection. Reactivation is only a trusted test probe.
- Existing synthetic invitation HTTP journey adds UNCONFIGURED→READY→STALE→READY,
  owner saves, MEMBER/stranger denial, exact old-receipt retry and production parsers.
  Its original reciprocal personal privacy assertions remain unchanged.
- FIN-204 inventory enumerates the new tables/functions without broad exemptions;
  all personal authorization and prior concurrency suites remain regression gates.

## Execution gates

Local aggregate Jest passed 62 suites / 1,205 tests. Lint (zero warnings), format,
Router parser verification, eight startup-diagnostic unit tests and both harness
syntax checks passed. Typecheck remains blocked only by the two new RPC names
missing from the still-unchanged generated types. Final-head CI remains authoritative.
No Docker, PostgreSQL, SQL tests, concurrency harness or authenticated HTTP journey was
run locally. CI must execute them on the final source head and generate genuine schema
types; generated files must not be approximated by hand. Independent review follows.

Native acceptance remains unrun: test physical-device decimal keyboard, scroll/focus,
percentage review, rapid taps, background/foreground, logout/account switch, loss of
response/retry and a real test-account join making the template obsolete. No claim
of production rollout or device acceptance is made.
