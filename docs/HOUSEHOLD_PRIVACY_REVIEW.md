# FIN-204 Household Privacy Review

**Status: automated privacy suite validated.** See [PR #45](https://github.com/Andrew-Mtz/gastos/pull/45)
for integration status. Full CI `39872830246` passed on source head `6c6ed7f583915b4237cfe24f5ce419501d0e8928`.
The base is main `9f38fe9c9a0c0845cc0fb3b82ac8a573105ec294`, which merged FIN-203
PR #44 with the same tree as reviewed head `663071fcbd7ff02e552e1921f09e509343dbf5ce`
after green exact-head CI `39867477923`. Merge requires independent review and
complete CI on the exact final head, including documentation. Native acceptance and an active GraphQL
engine are not covered. No production, real accounts, email, credentials or real
financial data are used; no product feature, migration or authorization policy is added.

## Current surface and contract

`supabase/tests/household_privacy_surface.test.sql` is the executable inventory of
**17 tables, 53 application functions and one separate platform entrypoint** in
the configured exposed schemas:

- 13 owner-private sources: profiles, periods, buckets, allocations, categories,
  transactions, savings goals, recurring templates, transaction revisions,
  closures, reopenings, dispositions and carry reversals.
- 2 active-household sources: households and active member identities. The existing
  FIN-202 suite checks the exact minimum column grants and complete projection.
- 2 server-only sources: recipient codes and invitations. Clients use the narrow
  actor-authorized RPCs, never direct table/column access.
- 27 personal RPCs, 7 household RPCs and 1 callable actor-lock helper.
- 18 internal trigger functions, with no client EXECUTE. A function's existence in
  generated types is not evidence that it is a callable API.
- One platform-only `graphql_public.graphql(text,text,jsonb,jsonb)` placeholder,
  classified separately without weakening application RPC grant/search-path checks.
  The contract requires the known PL/pgSQL invoker body, typed-NULL defaults,
  reviewed PUBLIC/anon/authenticated execution and no installed `pg_graphql` engine.

The test compares the actual migrated PostgreSQL catalogs, including overloads,
against this explicit inventory. New or removed application tables, views, foreign
relations or functions require review/classification. Extension-owned objects are
excluded by catalog dependency, not by name. RLS, anonymous/PUBLIC grants, client
execution, trigger classification, empty search paths and reviewed definer status
are checked. The HTTP harness also checks that exposed schemas remain explicitly
`public` and `graphql_public`; a configuration expansion cannot silently evade the
catalog scope. The platform entrypoint is not silently excluded by its name.

The placeholder's full-body SHA256 (whitespace removed) is pinned to
[Supabase's official PostgreSQL 17 schema](https://github.com/supabase/postgres/blob/920bb634698fef8dee6e78d738330d2dd8e489c5/migrations/schema-17.sql),
blob `84790a4277ce693ad945c1e57c8f9eccc40bff23`. The same normalized body occurs in
its historical GraphQL migration. The existing nonempty A/B/C fixtures and real
anonymous role each call the entrypoint with a valid `__typename` query and require
the exact disabled-engine JSON error, without a data member. The digest check
prevents accepting a different body that merely imitates that response. Neither
an extension nor a grant is changed. This is coverage of the inert placeholder,
**not privacy acceptance for an active GraphQL resolver**; enabling or changing it
fails the gate and requires new authorization/behavior tests.

A same-household partner may see the authorized household name/currency and minimal
active member identities/roles. They cannot read, aggregate, mutate or replay the
other member's personal resources. A month-only RPC without an owner parameter
returns the caller's own populated data (or their explicit missing state), not an
error or somebody else's fallback. An RPC accepting a resource UUID must authorize
that resource independently of household access. C sees no A/B household or finances.

## Incremental evidence, not a duplicate suite

- FIN-202's existing `household_membership.test.sql` remains the nonempty 13-source
  A/B/C RLS matrix, minimal DTO/column grants and forged direct-write authority.
  FIN-204 extends its fixtures with distinct A/B income, a valid future recurring
  occurrence, a closed period and an active carry. Every existing fixture still
  rolls back with the owning SQL transaction.
- `helpers/household_privacy.sql.inc` adds all personal read-RPC boundary cases and
  16 valid mutation payloads per owner. Each exact payload must first succeed for
  its owner in a rollback-only probe. The same payload then runs as the partner
  and unrelated C: 64 cross-owner mutation attempts. Every attempt independently
  verifies the real role/subject, expected SQLSTATE and unchanged full rows across
  all 13 private sources from the trusted test role. No definer test bypass is used.
  An unexpected successful negative mutation is not hidden by a forced rollback.
- Actor-only provisioning returns three own buckets; setup rejects foreign default
  buckets, creation cannot replay another owner's goal identity, and the lock
  helper accepts no foreign subject. Resource RPC failures, grant denial and RLS
  filtering remain distinct assertions. Lifecycle/correction inputs contain real
  revisions, versions and fingerprints, not malformed placeholders.
- FIN-203's existing authenticated `test-invitation-flow.mjs` creates A/B/C, joins B
  through the real directed invitation flow and preserves its local-only target
  guard and exact-run cleanup. FIN-204 adds private income to both A and B, reciprocal
  table/resource denial, no-write checks, C's empty household/member results and
  own month-only dashboard results. The existing parser bridge now passes those
  responses through the actual dashboard parser with the independently known
  authenticated identity, including rejection of a foreign parser identity.
- Existing 14 household concurrency scenarios, FIN-203's 13 invitation races and
  6 isolation checks, finance concurrency/SQL suites, and household/auth UI cache,
  session, revocation and late-response tests remain authoritative and are reused.
  No duplicate concurrency/UI harness is added.

## Verification and remaining gates

The existing CI workflow already discovers the new SQL file through `npm run
db:test` and invokes the extended HTTP/parser bridge. No separate workflow or
parallel test stack is needed. On an authorized disposable stack, run the complete
workflow; focused SQL commands are `npm run db:test --
supabase/tests/household_membership.test.sql` and `npm run db:test --
supabase/tests/household_privacy_surface.test.sql`.

Full CI `39872830246` on `6c6ed7f583915b4237cfe24f5ce419501d0e8928` passed:

- 3,712 SQL assertions across 36 files, including the catalog and actual
  placeholder calls under A/B/C/anon roles.
- 57 finance and 14 household concurrency scenarios, 13 invitation races and
  6 isolation-level rejection cases.
- Both authenticated HTTP journeys and production-parser bridges: 2 finance
  parser tests and 3 invitation/privacy parser tests.
- Quality: typecheck, zero-warning lint, formatting, 1,158 Jest tests in 59 suites,
  installed Router parser regression, plus 8 startup-diagnostics tests.
- Generated-type comparison with zero drift and disposable-stack cleanup.

The initial inventory failure identified Supabase's exposed GraphQL placeholder,
not an additional application RPC. Its explicit platform classification, complete
body/defaults/state guards and real-role behavior checks resolved the failure
without changing grants, RLS or application RPC expectations.

The run's authentic type artifact `12467656110` was downloaded and verified.
ZIP SHA256: `4f5a37a84e1ec76ad11a628e836817774398c3b424ec3dbefc6eb73de552f739`.
The generated 44,788-byte file matches main byte for byte, SHA256
`b5fccfa6d3d369f7c438ea260fb13be89228ace2977bebca4bbe2ecac77f5f03`.
No generated types or escape casts were edited. Database, HTTP and concurrency
results come from disposable CI, not local execution: this executor still lacks
Docker and psql. Local application checks also passed on Node 24.14.0 / npm 11.9.0;
the separate real-HTTP parser tests above are CI evidence, not part of local Jest.

Merge requires independent review and complete CI on the exact final FIN-204 head. Native/device acceptance remains the separate
pending checklist in `HOUSEHOLD_MEMBERSHIP_REVIEW.md`. An active GraphQL resolver,
shared expenses/default splits (FIN-205+) and historical membership access remain
outside the executed scope.
