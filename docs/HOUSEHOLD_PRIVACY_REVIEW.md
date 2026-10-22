# FIN-204 Household Privacy Review

**Status: draft PR #45; not integrated or security-accepted.** The FIN-204 delta
is rebased onto main `9f38fe9c9a0c0845cc0fb3b82ac8a573105ec294`, which merged FIN-203
PR #44 with the same tree as reviewed head `663071fcbd7ff02e552e1921f09e509343dbf5ce`.
Full CI run `39867477923` passed on that exact FIN-203 head. Its authentic generated
types are inherited unchanged. The original local FIN-204 snapshot is `fadf302`
(parent `721e460`). FIN-204 verification remains pending; FIN-203's
green checks do not verify these additional SQL/HTTP tests. No production, real
accounts, email, credentials or financial data are used. No new feature, schema migration,
authorization policy or package is added.

## Current surface and contract

`supabase/tests/household_privacy_surface.test.sql` is the executable inventory of
**17 tables and 53 application functions** in the configured exposed schemas:

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

The test compares the actual migrated PostgreSQL catalogs, including overloads,
against this explicit inventory. New or removed application tables, views, foreign
relations or functions require review/classification. Extension-owned objects are
excluded by catalog dependency, not by name. RLS, anonymous/PUBLIC grants, client
execution, trigger classification, empty search paths and reviewed definer status
are checked. The HTTP harness also checks that exposed schemas remain explicitly
`public` and `graphql_public`; a configuration expansion cannot silently evade the
catalog scope. This is not separate execution coverage of pg_graphql itself.

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

Initial FIN-204 CI `39869644646` on `21c738d` passed Quality and executed 3,695 SQL
assertions across 36 files. One catalog-inventory assertion failed with an
unclassified function OID; its identity is not established by that output.
The diagnostic change reports canonical signatures and fixed privilege metadata
without excluding or classifying the unknown object. Concurrency, HTTP and type
regeneration were skipped after the SQL failure; security acceptance remains open.

Local SQL, authenticated HTTP, parser-bridge integration, concurrency and generated
type regeneration are **not run**: this executor has neither Docker nor psql.
The inherited generated file matches FIN-203 byte for byte (SHA256
`b5fccfa6d3d369f7c438ea260fb13be89228ace2977bebca4bbe2ecac77f5f03`). No generated
types or escape casts were edited. The original FIN-204 test/helper bytes are
unchanged by the rebase; the two FIN-203 SQL CI fixes are inherited from its base.
Local checks on pinned Node 24.14.0 / npm 11.9.0 passed: typecheck, all 1,158 Jest
tests in 59 suites, zero-warning lint, Prettier, installed Router parser regression,
8 startup-diagnostics tests, HTTP-script syntax and whitespace checks.
The normal Jest run does not execute the real-HTTP parser bridge; that integration
result remains pending, not counted as a local pass.

Before readiness: independently review this rebase, then run full SQL/HTTP/
concurrency/type-drift and application CI on the exact final FIN-204 source head.
FIN-203's merge resolves the dependency gate, not FIN-204's own verification gates.
Native/device acceptance remains the separate pending checklist in
`HOUSEHOLD_MEMBERSHIP_REVIEW.md`. Shared expenses/default splits (FIN-205+) and
historical membership access remain out of scope.
