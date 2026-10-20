# FIN-126 — Phase 1 review

Status: implementation and verification in progress. This is not a production-release
approval or a claim that current native-device acceptance has passed.

## Investigation and bounded implementation plan

The baseline is FIN-125 merge `c45fbed216eaae7a7fba75a5d3f380e712738585`, whose tree
matches reviewed head `94fd04f9887a05c3cceabf930c3e8df05966e07a`.
FIN-101–125 already have focused domain/application/component tests, actual PostgreSQL
RLS/privilege tests and two-session race tests. FIN-126 complements that evidence with
one authenticated HTTP journey, rather than re-reviewing every historical patch.

The new local-only journey uses actual Supabase Auth and Data APIs. Synthetic historical
fixtures are explicitly identified: recurring definitions cannot be created in a prior
month, and a real month cannot elapse during CI. No production clock bypass, migration,
policy, hosted database, native E2E framework or later roadmap feature is introduced.
Existing component tests remain separate evidence for form validation, confirmation,
remount/navigation, cache invalidation and authentication changes. API tests are not
native UI execution. Expo export is compilation evidence only.

The dependency review will reproduce the pinned CI Node/npm environment, inspect actual
consumers and primary advisories, and make compatible targeted lock updates only. An
advisory count is neither a count of independent flaws nor proof of exploitability or
safety. Unpatched/reachable or uncertain residuals must remain visible.

## Native evidence boundary

README records prior owner-performed physical-iPhone Expo Go authentication and shell
verification for FIN-006–008. That is historical evidence, not a new native run of the
current financial implementation. FIN-126 must not erase it or call it current evidence.
ADR-064 requires physical-device session-size, restart, logout and account-switching
verification; a current regression checklist and acceptance matrix will accompany the
completed automated review. FIN-011 signed development builds/EAS/TestFlight remain
explicitly deferred by ADR-065. Expo Go does not establish standalone reinstall/Keychain
or signed-binary behavior.

## Acceptance evidence map

| Requirement | Integrated and focused evidence | Boundary |
| --- | --- | --- |
| Actual sign-in and owner identity | `test:finance-api`: Auth signup, local logout, password sign-in for A/B; independent authenticated client read | Real HTTP, in-memory test storage; not native encrypted persistence |
| Budget and received income | Same HTTP owner calls initial buckets/setup and register income; 999999 expected → 0 ordinary before received income; duplicate income ID counted once | Existing budget/income Jest and SQL suites cover invalid allocations, rounding, currency, limits and interrupted UI |
| Expenses and remaining budget | 100000 income, 60000 Needs expense → 20000 ordinary; Needs allocation 50000 exposes a deficit | Existing consumption and protected-allocation tests verify app mapping and presentation; no UI arithmetic introduced |
| Protected savings and explicit movements | Extra contribution 5000 and confirmed withdrawal 1000 → protected24000/ordinary16000; unconfirmed withdrawal rejected | Existing savings/goals suites and actual races cover solvency, prefixes, provenance and confirmation |
| Recurring resolution and commitments | Unknown completed-month fixture blocks close/prior availability; actual HTTP resolve4000 once → ordinary12000. Current-month real template creation; fixed600 and estimate300 stay separate from actual spend; resolution/cancellation removes commitments once | Historical template alone is privileged test fixture, not backdated production capability. Unknown-margin withholding and final domain/UI formula are proven by existing safe-to-spend tests |
| Corrections and audit | Expense60000→55000; linked actual DELETE/RESTORE has revisions1/2 and same identity; exact replay; resulting ordinary17000 | Existing correction component tests cover reviewed confirmation, navigation/remount and late/auth response rejection |
| Close and reopen | Stale preview rejects; completed source closes; closed correction rejects; explicit reopen advances version; old close replay cannot close again | Actual server month remains authoritative; current month rejects close. Native historical branch needs a suitable synthetic fixture |
| Remainder regression | Global cap17000 despite Leisure gross30000; carry5000 is not income or resplit; insufficient live destination funds block reversal; explicit correction allows atomic reversal/reopen; savings disposition1000 counted once | Existing FIN125 tests cover assigned-bucket and unallocated modes, chained carry, versions, immutable v1/v2 summaries and concurrency |
| Personal privacy | A/B authenticated HTTP read filtering, cross-owner aggregate/replay denial and forged write against an otherwise valid OPEN destination; local logout denies anonymous API access | SQL suites additionally cover same-household/unrelated/null/anon identities, grants and every relevant forged write; UI auth/cache tests remain mocked |
| Dependency security | [Bounded advisory and consumer review](DEPENDENCY_REVIEW_FIN126.md), compatible patches and `test:router-parser` | Installed residuals remain explicit; Node parser probe is not native URL execution or an exhaustive exploit test |
| Physical financial experience | [Current-device checklist](PHASE_ONE_DEVICE_CHECKLIST.md); historical FIN006–008 device evidence retained | Current financial-flow/crash-fix device regression not performed here. Expo export is not device execution |

## Automated verification commands

Use the pinned Node/npm and a clean `npm ci`:

- `npm run typecheck`
- `npm run lint` (zero lint warnings)
- `npm run format:check`
- `npm test -- --runInBand`
- `npm run test:router-parser`
- `npm audit --package-lock-only --json` (expected nonzero while documented residuals exist)
- iOS and Android `expo export` with harmless public compile-only environment values,
  offline/telemetry disabled, and output outside the repository. This does not contact
  a hosted Supabase project, sign a binary or deploy an application.

The disposable GitHub CI database job runs all migrations, all SQL tests, the real
separate-session concurrency script, `npm run test:finance-api`, and generated-type
drift verification. The HTTP script reads only this checkout's local CLI status,
accepts only loopback port54321, rejects remote Docker overrides, creates random
synthetic identities and removes only those identities/rows in `finally`. CI always
attempts stack shutdown. Neither local keys nor sessions are logged or committed.

The integrated HTTP job also passes its actual, whitelisted synthetic financial JSON
through the current `mapDashboard`, `mapSafeToSpend`, `mapPeriodClose`, `mapRemainder`
and `mapReversal` application parsers. Two explicitly invoked Jest contract tests
assert numerical margins, unknown/prior withholding, estimates, v2 carry and histories.
They fail if the required live fixture is absent; they are not an optional skipped
unit suite. Only the unused global network client is mocked. Snapshots never contain
Auth responses and are kept in a private temporary directory removed in `finally`,
not committed, uploaded or treated as user data. This bridges API-to-application
contract compatibility without claiming native UI execution.

Local verification passed: clean npm ci; typecheck/lint/format; 1021 Jest tests in
54 suites; installed Router parser probe; iOS Hermes export (4.4 MB) and Android
Hermes export (4.7 MB), both compile-only. The initial offline Expo package check
reported that offline validation is unreliable, so it is not standalone compatibility
proof. The subsequent online check returned exit1 with newer SDK57 patch recommendations,
recorded in the dependency review; no framework upgrade was silently applied.
Final exact-head integrated CI and review results will be recorded before readiness/merge.
