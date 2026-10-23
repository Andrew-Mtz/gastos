# Product Roadmap

**Version:** 0.1
**Status:** Active
**Last updated:** 2026-09-09

This document defines implementation order and task scope.

`PRODUCT.md` defines the intended product.

`ROADMAP.md` defines what should be implemented now and in what order.

A feature appearing in `PRODUCT.md` is not automatically in current implementation scope.

---

# 1. Development Strategy

Development follows these rules:

1. Implement one small, reviewable task at a time.
2. Codex investigates before modifying code.
3. Each task should produce a focused branch and PR.
4. Each PR is reviewed before the next dependent task begins.
5. Do not implement future roadmap work opportunistically.
6. Domain/security invariants always take precedence over roadmap convenience.
7. Database changes require migrations.
8. Privacy-sensitive work requires negative authorization tests.
9. Financial calculations require deterministic tests.
10. Architectural changes require review against `DECISIONS.md`.

---

# 2. Task Naming

Task IDs use:

```text
FIN-XXX
```

Git branches should generally use:

```text
feature/FIN-XXX-short-description
```

Example:

```text
feature/FIN-001-project-bootstrap
```

Commit and PR titles should reference the task ID.

---

# 3. Definition of Done

A roadmap task is complete only when applicable requirements are satisfied.

## Code

* implementation matches task scope;
* no unrelated changes;
* TypeScript passes;
* lint passes;
* tests pass;
* no unexplained warnings.

## Domain

* relevant domain rules are respected;
* financial arithmetic is deterministic;
* no duplicated business logic in UI.

## Database

When applicable:

* schema changes use migrations;
* constraints are added where appropriate;
* generated Supabase types are updated.

## Security

When applicable:

* RLS is enabled;
* authorized behavior is tested;
* unauthorized behavior is tested;
* ownership/scope cannot be forged.

## Documentation

* update docs when implementation resolves an open decision or changes behavior;
* add ADRs for material architecture decisions.

## Review

* Codex explains what changed;
* affected files are listed;
* security impact is explained;
* database impact is explained;
* tests are explained;
* reviewer verifies implementation before merge.

---

# 4. Phase 0 — Foundations

## Objective

Create a reliable development foundation before implementing financial features.

No production financial domain behavior should be implemented during this phase unless explicitly required.

---

## FIN-001 — Project Bootstrap

**Status:** Completed

### Goal

Create the initial React Native application using Expo and TypeScript.

### Scope

* initialize Expo project;
* configure TypeScript strict mode;
* configure Expo Router;
* establish `app/` and `src/` structure;
* include existing documentation;
* add `.env.example`;
* configure `.gitignore`;
* add basic project scripts;
* confirm the app launches.

### Out of Scope

* Supabase;
* authentication;
* financial entities;
* actual product screens;
* household logic.

### Acceptance Criteria

* app starts successfully;
* TypeScript strict mode is enabled;
* routing foundation exists;
* docs remain in the repository;
* no secrets are committed.

---

## FIN-002 — Code Quality Tooling

**Status:** Completed

**Depends on:** FIN-001

### Goal

Establish consistent static analysis and formatting.

### Scope

* ESLint;
* formatting strategy;
* typecheck script;
* lint script;
* test placeholder command if appropriate;
* consistent import conventions where useful.

### Acceptance Criteria

Commands equivalent to:

```text
npm run typecheck
npm run lint
```

pass successfully.

Avoid unnecessary lint plugins or style complexity.

---

## FIN-003 — Testing Foundation

**Status:** Completed

**Depends on:** FIN-001

### Goal

Set up the project's initial automated testing infrastructure.

### Scope

* select current Expo-compatible test runner;
* React Native Testing Library;
* domain unit-test location;
* one minimal sanity test.

### Open Decision Resolved Here

Exact test runner.

Update `DECISIONS.md` if necessary.

### Acceptance Criteria

```text
npm test
```

runs locally and passes.

---

## FIN-004 — Supabase Project Foundation

**Status:** Completed

**Depends on:** FIN-001

### Goal

Connect the application architecture to Supabase without implementing product financial data.

### Scope

* configure Supabase client;
* environment variables;
* local/project configuration;
* establish `supabase/migrations`;
* establish `supabase/seed.sql`;
* create scripts for generating database types;
* commit generated types according to ADR-042.

### Security Requirements

* service-role key must not exist in client code;
* client configuration must be clearly separated from secrets.

### Acceptance Criteria

The application can initialize the Supabase client correctly in development.

---

## FIN-005 — Profile Schema

**Status:** Completed

**Depends on:** FIN-004

### Goal

Introduce the application profile corresponding to a Supabase Auth identity.

### Scope

Initial profile fields only:

```text
id
display_name
base_currency
timezone
created_at
updated_at
```

`id` is the shared Profile/Auth UUID referencing `auth.users(id)`; there is no
separate Auth identifier.

### Requirements

* migration;
* uniqueness linking profile to auth identity;
* RLS;
* generated types;
* tests.

### Acceptance Criteria

An authenticated user can access their own profile and cannot access another user's private profile data.

---

## FIN-006 — Authentication

**Status:** Completed

**Depends on:** FIN-004, FIN-005

### Goal

Implement basic authentication.

### Initial Scope

* sign up;
* sign in;
* sign out;
* authenticated route handling;
* profile resolution;
* session restoration.

### Open Decision Resolved Here

Secure session storage and the root Auth lifecycle are accepted in ADR-064.

Initial auth provider should remain minimal.

FIN-006 onboarding polish replaces free-text base currency with an explicit
UYU/USD/EUR/BRL/ARS selector, as requested by the user. No currency is silently
selected. Existing Profile currencies remain readable and unchanged; this UI list
does not narrow the domain or database currency schema. Native primitives avoid a
new picker dependency or runtime Intl currency-list requirement.

### Security Requirements

* secure session persistence;
* clear user caches on logout;
* authenticated routes are not treated as database security.

### Acceptance Criteria

Two independent test users can authenticate and remain isolated.

---

## FIN-007 — Navigation Shell

**Status:** Completed

**Depends on:** FIN-006

### Goal

Create the initial authenticated application shell.

### Initial Areas

```text
Home
Transactions
Budget
Household
Settings
```

These may initially be placeholders.

### Out of Scope

Financial behavior.

### Acceptance Criteria

Authentication correctly switches between auth and application navigation.

---

## FIN-008 — Initial Design System

**Status:** Completed

**Depends on:** FIN-001

### Goal

Create only the reusable primitives required for initial screens.

### Possible Scope

* typography;
* spacing/tokens;
* Button;
* TextInput;
* Card;
* basic screen layout;
* loading/error states.

### Requirements

* accessible touch targets;
* semantic colors;
* no oversized UI library.

### Out of Scope

Complete product visual design.

---

## FIN-009 — CI Foundation

**Status:** Completed

**Depends on:** FIN-002, FIN-003

### Goal

Run basic project validation on GitHub PRs.

### Scope

GitHub Actions for:

```text
install
typecheck
lint
format check
tests
```

### Acceptance Criteria

A deliberately failing check prevents CI success.

The PR workflow must pass clean installation, TypeScript, lint, formatting, and
serial Jest tests on GitHub. Prove failure propagation on a disposable draft PR
without merging its intentional lint violation into the implementation or main.

---

## FIN-010 — Supabase Authorization Test Foundation

**Status:** Completed

**Depends on:** FIN-004, FIN-005

### Goal

Establish a repeatable way to test RLS and database security.

### Test Personas

```text
Andy Test
Partner Test
Stranger Test
```

### Scope

* test fixture strategy;
* positive RLS test;
* negative RLS test;
* documented execution command.

FIN-010 adds `npm run db:test` and a separate `Database authorization` PR job
alongside `Quality checks`. Tests use transactional synthetic Auth fixtures and
test-only shared SQL includes; product migrations and policies remain unchanged.

### Acceptance Criteria

Automated test proves that User A cannot read User B's private profile data.

Full and focused database test runs must preserve the existing Profile coverage,
leave no fixtures behind, and pass repeatedly. Both PR jobs must pass. A disposable,
never-merged validation PR must demonstrate that transaction-local broadening of
Profile SELECT makes the unchanged cross-user assertion and database job fail.

---

## FIN-011 — iOS Development Workflow

**Status:** Deferred

**Depends on:** FIN-001

### Deferral — ADR-065

The current Windows, Expo Go, physical iPhone, and local Supabase LAN workflow
is sufficient. The original acceptance criteria require Apple Developer Program
membership and signed iOS development-build infrastructure. The user can pay for
membership but intentionally defers activation until a real native or distribution
requirement appears. This task is not completed.

Resume FIN-011 before work requiring custom native iOS capabilities or distributable
iOS builds, including unsupported native dependencies, Siri/App Intents, TestFlight,
signed development-client testing, or App Store preparation. FIN-012 may proceed
with this explicit deferral and must retain the unverified signed-build limitations.

### Goal

Verify the real-device iOS development workflow.

### Scope

* Expo/EAS configuration;
* development profile;
* physical iPhone testing;
* document build/install flow.

### Acceptance Criteria

A development build can be installed and launched on the primary iPhone when needed.

---

## FIN-012 — Foundation Review

**Status:** Completed

**Depends on:** FIN-001 through FIN-010; FIN-011 is explicitly deferred by ADR-065.

### Goal

Review the entire foundation before financial implementation begins.

### Verify

* project structure;
* dependency choices;
* auth;
* Supabase configuration;
* RLS testing;
* CI;
* iOS workflow;
* docs alignment.

### Acceptance Criteria

No known foundational blocker remains before Phase 1.

---

# 5. Phase 1 — Personal Finance Core

## Objective

Allow one user to plan income, record personal spending, protect savings, and understand current financial availability.

---

## FIN-101 — Money Domain Type

**Status:** Completed

**Depends on:** Phase 0

### Goal

Implement the core deterministic money abstraction.

### Requirements

* integer minor units;
* ISO currency code;
* safe integer validation;
* addition/subtraction rules;
* same-currency protection;
* formatting/parsing boundaries separated appropriately.

### Tests

Include:

* zero;
* positive values;
* unsafe integers;
* currency mismatch;
* arithmetic.

---

## FIN-102 — Percentage and Allocation Domain

**Status:** Completed

**Depends on:** FIN-101

### Goal

Implement percentage basis points and deterministic allocation.

### Requirements

* `10000 = 100%`;
* total validation;
* largest-remainder algorithm;
* exact split preservation.

### Tests

Include difficult rounding scenarios.

---

## FIN-103 — Budget Period Schema

**Status:** Completed

**Depends on:** FIN-004, FIN-005

### Goal

Create personal budget periods.

### Initial Scope

Calendar-month periods.

### Requirements

* personal ownership;
* OPEN/CLOSED state;
* base currency;
* expected income planning data;
* RLS;
* constraints;
* generated types;
* security tests.

---

## FIN-104 — Budget Bucket Schema

**Status:** Completed

**Depends on:** FIN-103

### Goal

Create budget buckets.

Initial default conceptual buckets:

```text
Needs
Leisure
Savings
```

### Requirements

* personal ownership;
* bucket type;
* RLS;
* archive support if needed.

Implementation adds personal spendable/savings buckets, archive support,
owner-only RLS, narrow SQL grants, transactional security tests, and generated
database types. CI regenerates those types and rejects drift. Independent review
found no blocking issues; quality and database authorization checks passed,
including 241 Jest tests and 333 SQL assertions across the complete suites.

---

## FIN-105 — Budget Allocation Schema and Domain

**Status:** Completed

**Depends on:** FIN-102, FIN-103, FIN-104

### Goal

Assign budget percentages to a financial period.

### Requirements

* percentages total 100%;
* allocations belong to a period;
* history remains immutable across future periods;
* safe deterministic amount calculations.

Implementation adds private period/bucket allocation rows, atomic complete-set
saving, soft removal, deferred total validation and closed-period guards. Planned
amounts are derived through the existing deterministic money primitives with
stable bucket ordering. Independent review found no blocking issues. Quality
checks and all 480 PostgreSQL assertions across five files passed, alongside
268 Jest tests. CI-generated types are committed and the drift guard passed.
Allocation writes enforce READ COMMITTED; snapshot-isolation rejection is tested.
Executable multi-session race coverage remains a documented limitation.

---

## FIN-106 — Initial Budget Setup

**Status:** Completed

**Depends on:** FIN-105

### Goal

Allow a user to select:

* Balanced;
* Saver;
* Aggressive Saving;
* Custom.

### Requirements

Display percentages and calculated expected amounts before saving.

Implementation provides all four strategies, exact expected-amount previews,
private idempotent default provisioning, atomic initial setup, read-only saved
plans, cancellation and stale-session/navigation protection. Local quality
checks pass with 315 Jest tests; PostgreSQL CI passes 552 assertions across six
files. Generated types are copied verbatim from the verified CI artifact.
Independent review's delayed-save lifecycle finding is fixed with a regression.
Quality and database CI passed, including the generated-type drift guard.
Native-device keyboard/back/screenshots and multi-session database race execution
remain unverified.

---

## FIN-107 — Category Domain and Schema

**Status:** Completed

**Depends on:** FIN-104

### Goal

Create personal categories associated with budget buckets.

### Initial Categories

A small useful default set may be introduced.

### Requirements

* categories are personal;
* category ownership protected by RLS;
* category/bucket relation explicit;
* archive rather than destroy historical meaning.

Pure category validation and owner-only schema are implemented with immutable
same-owner bucket references and recoverable archive state. Local quality checks
and 327 Jest tests pass; real PostgreSQL authorization tests pass in CI. Generated
types come verbatim from CI artifact 12238858729. Independent review found no blockers.

---

## FIN-108 — Transaction Schema

**Status:** Completed

**Depends on:** FIN-101, FIN-005

### Goal

Introduce the core personal transaction model.

### Initial Transaction Types

Implement only those required by current Phase 1 functionality.

Likely:

```text
INCOME
EXPENSE
SAVINGS_CONTRIBUTION
SAVINGS_WITHDRAWAL
```

Do not implement all future transaction types merely because they exist in the domain.

### Requirements

* personal scope;
* amount minor;
* currency;
* transaction date;
* soft deletion;
* RLS;
* constraints.

FIN-108 implements the personal-only schema, safe positive minor units, financial
dates, same-owner references, closed-period protection, soft deletion and narrow
RLS/grants. ADR-066 records same-currency income and deferred conversion. Local
checks pass with 348 Jest tests; PostgreSQL CI verifies authorization and bounds.
Types are copied verbatim from verified artifact 12240080152. Independent review
found no blockers; date and restoration regressions cover its minor suggestions.

---

## FIN-109 — Register Income

**Status:** Completed

**Depends on:** FIN-108, FIN-105

### Goal

Allow actual income to be registered.

### Requirements

* multiple income transactions per month;
* actual received income derived from transactions;
* expected income remains separate.

### Acceptance Example

```text
Expected: USD 1500
Received: USD 1000
```

The application must not report USD 1500 as received.

FIN-109 adds a same-budget-currency income form and an owner-only, invoker RPC
with stable request identity. Multiple active income transactions determine the
received total; expected income is displayed separately and never substituted.
SQL tests cover exact replay/conflict, soft deletion, closed periods, totals,
safe bounds and cross-owner denial. Real PostgreSQL CI passes 739 assertions;
types are copied verbatim from verified artifact 12239693117. Automated UI tests
cover cancellation, duplicate submission, uncertain retry, late responses,
refocus after budget setup and month rollover. Independent review found no
blocking issue; its refocus and deterministic-clock findings were addressed.
Native-device QA and full-process-restart recovery were not exercised; pending
request identity currently survives tab navigation, not process termination.
Currency conversion remains deferred under ADR-066.

---

## FIN-110 — Income-Based Budget Availability

**Status:** Completed

**Depends on:** FIN-109

### Goal

Calculate actual bucket availability based on income received.

Example:

```text
Received USD 1430

Needs 50%   → USD 715
Leisure 30% → USD 429
Savings 20% → USD 286
```

### Requirements

Use shared deterministic allocation logic.

FIN-110 derives pre-consumption bucket amounts from the owned period's received
income aggregate using the shared exact largest-remainder allocator and stable
bucket identities. Expected planning stays separate; zero received yields zero.
Savings is explicitly labeled as allocated to saving, not ordinary spendable cash.
The budget UI hides actual amounts during loading/error or allocation refresh,
refreshes on refocus/manual action, and responds to income registration through
owner-scoped cache invalidation. No database migration, persisted balance, expense
consumption, commitment, conversion or safe-to-spend calculation is introduced.
Pure and UI tests cover the 1430 acceptance example, rounding/aggregate behavior,
safe boundaries, zero, snapshots, owner isolation, cancellation and delayed plan
refresh. Independent review found no remaining production blocker. Full local
checks pass with 399 Jest tests; existing PostgreSQL authorization checks remain
required in CI. Native-device rendering/navigation QA remains unverified.

---

## FIN-111 — Register Personal Expense

**Status:** Completed

**Depends on:** FIN-107, FIN-108, FIN-110

### Goal

Allow users to create personal expenses.

### Initial Fields

* amount;
* currency;
* date;
* category;
* description optional.

### Requirements

* category determines budget bucket;
* financial calculations are outside UI;
* ownership cannot be forged;
* input validation.

---

FIN-111 implements validated mobile expense entry, minimal personal category
creation, idempotent invoker registration and database enforcement of ADR-067's
same-period-currency/spendable-category rule. Savings are never charged implicitly.
Positive and negative PostgreSQL coverage passes 771 assertions; generated types
come verbatim from verified CI artifact 12243025401. Local quality checks pass
with 488 Jest tests. Independent review found no remaining blocker after correcting
category-selection feedback. Native-device QA and full-process-restart pending
request recovery remain unverified. Final exact-head CI is required before merge.

---

## FIN-112 — Personal Transaction History

**Status:** Completed

**Depends on:** FIN-109, FIN-111

### Goal

Display current user's transactions.

### Scope

* chronological list;
* basic filtering by period;
* clear type/category/amount.

### Security

Only current user's personal records are visible.

---

FIN-112 adds owner-only chronological history with month navigation and bounded
50-record keyset pages. Original amounts/currencies, explicit movement types and
archived category names remain visible; deleted records are excluded. Reads are
cancellable and isolated by owner/month. Registration invalidates history, and
refocus refreshes it. No schema or financial calculation changes are introduced.
Independent review found no blockers; added tests cover its suggested refocus and
pagination-recovery cases. Native-device navigation remains unverified. Full
quality and existing database authorization CI are required before merge.

---

## FIN-113 — Bucket Consumption

**Status:** Completed

**Depends on:** FIN-111

### Goal

Derive spending per budget bucket.

### Requirements

Do not persist dashboard totals initially.

Calculation must exclude:

* deleted transactions;
* non-expense movement types.

---

FIN-113 derives complete owner-only bucket consumption through a stable invoker
aggregate and pure safe-integer Money calculations. Archived and unallocated
spending remains visible; deleted/non-expense rows are excluded. Invalid legacy
currency/category mappings fail explicitly rather than produce partial totals.
Presupuesto shows spending separately, refreshes on focus/manual action, hides
stale/error figures and responds to expense registration invalidation. No totals
are persisted and no remaining/safe-to-spend or savings movement is introduced.
Independent review found no blockers; its multi-bucket/allocation-removal test
suggestion is covered. Generated types come verbatim from verified CI artifact
12243801256. Local typecheck, lint, formatting and 532 Jest tests pass. Exact-head
quality and PostgreSQL CI are required before merge. Native-device
rendering/navigation remains unverified.

---

## FIN-114 — Protected Savings

**Status:** Completed

**Depends on:** FIN-110, FIN-108

### Goal

Treat savings allocation as unavailable for ordinary spending.

### Requirements

* savings amount shown separately;
* ordinary safe-to-spend excludes protected savings;
* no implicit savings withdrawal.

FIN-114 partitions the existing rounded received-income allocation into protected
savings and ordinary spendable allocation by immutable bucket type, including
custom and archived referenced buckets. Missing classifications fail explicitly.
Presupuesto shows both totals separately and clearly labels them as period
allocations, not remaining money, cumulative savings or final safe-to-spend.
Ordinary overspending cannot change the plan or create a savings withdrawal.
No schema, persisted balance, movement, permission or dependency change is needed.
Local typecheck, lint, formatting and 558 Jest tests pass; PostgreSQL regression
and independent review are required with exact-head CI before merge. Native-device
rendering/navigation remains unverified. FIN-115 movements and FIN-120's final
formula remain separate tasks; delegated scope decisions are documented.

---

## FIN-115 — Explicit Savings Contribution and Withdrawal

**Status:** Completed

**Depends on:** FIN-114

### Goal

Support explicit savings movements.

### Requirements

* contribution;
* withdrawal;
* confirmation for withdrawal;
* transaction history;
* deterministic availability.

### Implementation note

Personal savings now supports extra contributions and separately confirmed withdrawals,
with owner-only history, stable operation replay and deterministic cumulative protection
by currency through the selected month. Each month's allocation is rounded independently;
extra contributions reduce ordinary remainder before commitments and withdrawals return it.
Ordinary overspending remains possible without consuming protected savings. ADR-068 and
`OVERNIGHT_DECISIONS.md` record the delegated semantics and legacy compatibility boundary.

Invoker RPCs and owner-wide write serialization enforce funding, historical prefix,
confirmation, closed-period, currency, safe-integer and direct-write guards. Legacy savings
require server validation rather than an invented backfill; incompatible rows stay in
history and require atomic recoverable cleanup before eligible restoration. Generated
types are copied verbatim from the verified exact-migration-head CI artifact.

Local typecheck, lint, formatting and all 593 Jest tests across 35 suites pass. Real
local-Supabase CI passed 933 SQL assertions across 16 files and all six two-session
lock-wait scenarios. Independent review found no remaining blocker. Final exact-head
CI/type-drift verification gates merge. Device/native behavior is unverified; no bank
transfer, goals, correction UI, ordinary rollover or final safe-to-spend is introduced.

---

## FIN-116 — Personal Savings Goals

**Status:** Completed

**Depends on:** FIN-115

### Goal

Create personal savings goals.

### Scope

* name;
* target;
* currency;
* optional target date;
* contributions.

### Security

Strictly personal.

### Completion evidence

Private goals support a name, exact positive target, immutable currency, optional
calendar target date and keyset-paginated linked contribution/withdrawal history.
ADR-069 defines additional funding, not reassignment of existing percentage savings.
Progress is net explicit funding and may fall below target after a confirmed withdrawal.
General savings and goals partition the protected reserve without double-counting.

Owner-only RLS, immutable composite-owner linkage, exact operation replay and every
historical goal/general month-prefix invariant extend FIN-115. The UI explains the
subset semantics and keeps unknown-outcome operations pinned across navigation and
month rollover. Authentication changes remove private UI and isolate owner caches.

Verification includes domain/amount/date boundaries, real negative RLS/grants,
corrections across goal/general reserves, cancellation/replay/navigation/auth tests,
and nine two-session savings scenarios (the existing six plus three goal conflicts).
Generated types are copied verbatim from a verified matching-head CI artifact; full
quality, local-Supabase authorization/concurrency and type-drift checks gate merge.
Native/device behavior remains unverified. No shared goals, assignment of existing
savings, goal-edit/archive flow, bank transfer, conversion or later roadmap work.


---

## FIN-117 — Personal Recurring Expense Schema

**Status:** Completed

**Depends on:** FIN-107

### Goal

Create recurring personal expense templates.

### Initial Scope

```text
MONTHLY
FIXED
VARIABLE
```

### Requirements

A template is not automatically an actual expense.

### Implementation notes

Implemented private MONTHLY FIXED/VARIABLE definitions with owner RLS, immutable
original terms, stable-UUID create replay and an explicit prospective stop operation.
ADR-070 records fixed/estimated amounts, currency/category eligibility, short-month
due dates, activation/last-month bounds and preservation of closed/historical months.
Stopped templates remain owner-readable; nothing creates or deletes actual expenses.
The domain parser and calendar helper are pure. This schema task has no UI.

Verification includes 702 Jest tests, 1,178 PostgreSQL assertions and the existing
nine real savings-concurrency cases. Generated types are copied verbatim from the
matching-head CI artifact after verifying its workflow SHA and ZIP digest. Independent
review found no blocker; final exact-head quality/database/type-drift CI gates merge.
Native/device runtime remains unverified. FIN-118 needs minimal entry/list/stop UI
and uniquely linked monthly resolution; FIN-119 must avoid double counting actuals.
No commitments, safe-to-spend, scheduler, automatic fixed generation or broad edits.

---

## FIN-118 — Resolve Variable Recurring Expense

**Status:** Completed

**Depends on:** FIN-117, FIN-111

### Goal

Allow the user to turn a pending variable obligation into an actual expense once its amount is known.

Example:

```text
Electricity
Pending
→
UYU 2840
→
actual expense
```

---

### Implementation evidence

Variable monthly obligations now resolve explicitly to one actual personal expense
with a stable request UUID and immutable owner/template/month linkage. Original
category/currency/month eligibility, owner RLS, open periods and existing savings
guards apply to direct writes as well as atomic invoker RPCs. Unique identity includes
soft-deleted actuals. ADR-071 defines visible cancellation rather than automatic
reopening; later template stop preserves both confirmed and cancelled history.

Minimal template create/list/stop and variable-resolution UI is included as the
approved prerequisite. Complete scalar reads cannot truncate at Data API row caps.
Unknown estimates remain distinct from zero and never become actual amounts. Pending
requests preserve identity/payload across navigation, failed refresh and month change;
owner-wide financial caches refresh after actual resolution. Creation/stop are neutral.

Independent implementation and regression review found no blocking issue. Automated
coverage includes form/data boundaries, cancellation, retry, logout/direct account
switch and SQL privacy/corrections, plus thirteen real multi-session finance scenarios.
Generated types are copied verbatim from matching-head CI artifact 12248519615 after
verifying workflow SHA and ZIP digest. Local full quality and final exact-head
PostgreSQL/type-drift CI gate merge. Native/device runtime and process-restart recovery
remain unverified. Fixed actual confirmation/automatic generation, commitment totals,
safe-to-spend and later roadmap behavior remain out of scope.

---

## FIN-119 — Committed Money

**Status:** Completed

**Depends on:** FIN-117

### Goal

Calculate upcoming committed spending.

Distinguish:

```text
confirmed
estimated
```

### Requirements

Estimated values must not be presented as exact.

---

### Implementation evidence

Owner-only stable scalar aggregation derives complete monthly confirmed FIXED,
known VARIABLE estimates and unknown variable counts. Past due days within the month
stay included; any linked actual, even cancelled, is excluded. Historical archived
or unallocated spendable mappings remain visible. Mixed monthly denominations or
invalid mapping fail explicitly, and safe-integer overflow cannot produce a rounded
or partial total. The recurring screen labels estimates and unknowns without any
available-balance claim and refreshes under the owner recurring cache namespace.

ADR-072 bounds monetary totals to the selected month. Earlier unresolved occurrences
are counted separately with month-span arithmetic, not carried as payable money.
Warnings remain even when all known monthly amounts are zero. Cross-month payments
are unsupported: never backdate a payment to clear an older obligation. FIN-120 must
withhold a numerical safe-to-spend claim while those older obligations remain;
FIN-123/125 must surface unresolved obligations before closing/remainder actions.
Explicit fixed confirmation is the documented minimum prerequisite, using the existing
one-actual resolver and exact fixed amount, never automatic generation or a new ledger.

Independent bounded review found no blocker on implementation head 0e14efb. Local full
quality verification includes 800 Jest tests in 44 suites. Disposable PostgreSQL CI
passed 1,330 assertions in 21 files and all fifteen real concurrent-write cases.
Generated types are copied verbatim from matching-head artifact 12250224275 after
verifying its workflow SHA and ZIP digest. Final exact-head full quality/database/
type-drift CI gates merge. No production database/deployment or native/device runtime
verification is included. Process-restart recovery, cross-month payments, correction
UI, safe-to-spend and dashboard remain outside this task.

---

## FIN-120 — Safe-to-Spend v1

**Status:** Completed

**Depends on:** FIN-113, FIN-114, FIN-119

### Goal

Implement the first deterministic safe-to-spend calculation.

Initial conceptual formula:

```text
spendable allocated money
- consumed spendable budget
- confirmed committed spendable obligations
= safe to spend
```

Estimated commitments displayed separately.

### Important

ADR-073 resolves the complete Phase 1 formula and estimated/unknown obligation
presentation under delegated authority, pending owner review, not personal confirmation.
Include additional savings contributions and explicit withdrawals exactly once;
known estimates remain approximate and unknown/prior unresolved obligations withhold
a numerical availability claim. The single stable server snapshot, pure domain and
minimal budget-screen card are implemented. FIN-121 dashboard is separate.

### Implementation evidence

The final formula includes actual expenses even under archived/unallocated original
mappings and never double-counts linked recurring actuals or goal movements. Negative
margins remain honest. Component facts remain explainable when numeric availability
is withheld, with navigation to review obligations and no suggestion to backdate.
Owner/month keys, existing owner-wide financial invalidation, focus and manual refresh
keep the single snapshot current; refreshing/error data hides cached availability.

Independent bounded review found no P1/P2 finding on tree
f37651ffaf2106ddc6cef33a5fd0b88a3f8909f9. Full local verification includes 840 Jest tests
in 47 suites, typecheck, lint and formatting. Disposable PostgreSQL CI passed 1,385
assertions in 22 files and seventeen real concurrent-session cases, including readers
whose statement snapshots span concurrent payment/contribution commits. A test-only
legacy-fixture ALTER initially encountered pending deferred events; explicitly draining
validated constraints before the fixture resolved it without production-code changes.
Generated types were copied verbatim from matching-head artifact 12253165116 (source
head a1370b09f68a8f808ee69d459045a37a8b045099), verifying workflow SHA and ZIP SHA256
b92be9604b81a290ed20d3940afc745759bb3baf627785043c618f5cb8bee572. Final exact-head full
quality/database/type-drift CI gates merge. No production deployment/database changes,
native/device QA, account balances, cross-month payments or FIN-121+ implementation.

---

## FIN-121 — Personal Dashboard v1

**Status:** Completed

**Depends on:** FIN-109 through FIN-120 as relevant

### Goal

Show the most useful current-period financial information.

### Primary Data

* actual income;
* expected income where relevant;
* protected savings;
* spendable amount;
* bucket usage;
* committed money;
* safe-to-spend;
* upcoming obligations.

### UX Requirement

Prioritize actionable numbers over charts.

### Implementation evidence

Inicio now presents one owner/current-month stable snapshot: actual and expected
income, this-month protected/spendable allocations, cumulative protected savings
with goal subsets, bucket usage, complete commitments, ADR-073's gated margins and
five pending obligations ordered by due date with full-list navigation. Expected
income never funds availability; unknown/prior unresolved obligations withhold the
margin. Allocation and cumulative amounts are labeled distinctly, not cash balances.
All financial figures are hidden on loading/refetch/error, blur and background;
owner/month cancellation, focus/resume/month rollover and existing owner-wide
financial invalidation keep the snapshot current. Auth/profile setup is unchanged.

One bounded independent review found a retained-month navigation issue. Dashboard
and shared availability links now carry validated month context into history and
recurring screens; re-entry resets that target without blocking deliberate browsing.
The reviewer confirmed the fix, with no remaining P1/P2 finding in that scope.
Full local checks passed: 892 Jest tests in 49 suites, typecheck, lint and formatting.
Disposable CI passed 1,445 SQL assertions in 23 files and eighteen real concurrent
session scenarios, including one dashboard reader spanning a fixed-payment commit
across consumption, commitments and the preview. Generated types were copied verbatim
from artifact 12254762885, verifying source head 6d792d1cbbffdb19b2a90185f621b8b325174edf
and ZIP SHA256 aaff71090ba3e1b84ccea0f3921c5882f32515f195fa927b69c98f29d46cc12a.
Final exact-head quality/database/type-drift CI gates merge. No production database
changes/deployment, native/device QA, new financial policy, corrections, period
closure/reopening or remainder behavior is included. Reversible presentation choices
are recorded for owner review, not claimed as personal confirmation.

---

## FIN-122 — Edit and Soft Delete Personal Transaction

**Status:** Completed

**Depends on:** FIN-111

### Goal

Allow mistakes to be corrected.

### Requirements

* edit;
* soft delete;
* calculations update correctly;
* ownership/RLS preserved.

### Implementation evidence

History supports bounded amount/date/description corrections and non-recurring
expense category changes, explicit review/confirmation, soft deletion, deleted
history and same-ID restoration. Linked deletion clearly cancels that monthly
obligation; corrected FIXED actuals retain their corrected amount through recovery,
including after template stop. Identity, currency, month, goal and recurrence links
remain immutable. Closed periods deny new changes while exact prior request replay
returns only its recorded result and never overwrites a newer revision.

ADR-074 documents the narrow owner-locked definer RPC and audit-only definer trigger.
Monetary UPDATE grants remain unavailable; every update, including existing safe
note/tombstone writes, advances a server revision and appends private before/after
snapshots. Owner RLS/grants, incremental contribution funding, legacy provenance,
all historical goal/general reserve prefixes and ordinary overspending semantics
are preserved. Every correction invalidates owner-wide derived financial queries;
uncertain requests retain the same UUID and payload across in-session navigation,
while auth changes and late responses cannot affect another user's UI/cache.

One bounded independent review found no remaining actionable P1/P2 finding. The
first disposable SQL run exposed an ambiguous PL/pgSQL description variable; it
was renamed, independently rechecked and rerun successfully. Full local checks pass
938 Jest tests in 51 suites, typecheck, lint and formatting. Disposable CI passed
1,577 SQL assertions in 25 files and 28 real concurrent-session scenarios, including
stale edit/edit/delete conflicts, exact replay after later changes, and funding
corrections racing withdrawals/contributions. Generated types were copied verbatim
from artifact 12257056532, verifying source head 4b6789d429a51b29fee6e611e13941ab8a8da32d
and ZIP SHA256 5f839e1aedd882938ee99bfc13816729aa9475b7eac83c420e1c2f133922fa02.
Final exact-head quality/database/type-drift CI gates merge. No production database
change/deployment, native/device QA, FIN-123 close/reopen/remainder behavior or
unrelated dependency change is included. Decisions remain pending owner review,
not claimed as personal approval.

---

## FIN-123 — Close Budget Period

**Status:** Completed

**Depends on:** FIN-121

### Goal

Allow a user to close a completed month.

### Requirements

* OPEN → CLOSED;
* summary;
* normal editing blocked afterward;
* closed history remains readable.

### Implementation evidence

An explicit historical-month screen reviews one complete server snapshot before close.
The server's clock and persisted financial timezone require a completed month, and any
selected-month or prior unresolved obligation blocks closure, including unknown and
zero estimates. No obligation is silently cancelled or backdated. No transaction,
savings contribution, rollover or remainder disposition occurs.

ADR-075 records immutable as-of evidence with UUID, lifecycle version, original timezone
and deterministic fingerprint. Cumulative savings are labeled as recorded at close;
later explicit older-month corrections do not rewrite them. Exact replay never mutates
or re-closes a later lifecycle. A narrow owner-locked definer RPC is the sole status
writer; no status grants or existing closed-write protections are weakened. History
stays owner-readable, including legacy closed months without stored evidence. Pending
requests survive in-session navigation unchanged; auth/background/navigation resets and
owner-wide invalidation prevent stale private UI.

One bounded independent review found an all-null composite edge for legacy closed
months. The explicit-null fix and SQL regression were rechecked with no remaining P1/P2
finding. Initial disposable CI also exposed the old exact-column assertion, updated to
include the intentionally approved lifecycle version without weakening the contract.
Local full checks pass 969 Jest tests in 53 suites, typecheck, lint and formatting.
Disposable CI passed 1,691 SQL assertions in 28 files and 42 real concurrent-session
scenarios, including close races with income, expenses, corrections, savings,
allocations, duplicate requests and recurring stop. Generated types were copied verbatim
from artifact 12259306181 after verifying workflow source head
8ba1499018f7f78d4b3e679eee2948c4b6c01db1 and ZIP SHA256
e4a7c74c10a7cf33aefa0fc3c109080c7817157eeecef123db434bee96eaa379.
Final exact-head quality/database/type-drift CI gates merge. No production database
change/deployment, native/device QA, dependency change, reopen or remainder action is
included. Delegated lifecycle choices remain pending owner review.

---

## FIN-124 — Reopen Budget Period

**Status:** Completed

**Depends on:** FIN-123

### Goal

Explicitly reopen a closed period for corrections.

### Requirements

* explicit user action;
* preserve history;
* prepare for future audit logging.

### Implementation evidence

The existing month screen explicitly reviews and confirms CLOSED → OPEN. ADR-076
records a stable request UUID, expected/resulting lifecycle version, reviewed closed-state
fingerprint, previous close identity/time and reopen time in immutable owner-private
evidence. Legacy closed months can reopen without fabricated summaries. Old close and
reopen retries return their recorded result without changing any later lifecycle; fresh
stale or already-open requests conflict. Reopening moves no money and cannot silently
apply FIN-125 remainder behavior.

Every historical close and reopening remains visible through one complete stable
snapshot, including original as-of summaries after corrections and reclosure. No status
or evidence write grants were added. Ordinary corrections, savings solvency, allocation,
transaction and template guards remain intact. Pending requests survive actual in-session
screen remounts with unchanged payload; auth cache clear and late-response isolation
prevent private state returning after logout or same-owner re-login.

One independent bounded review found no actionable P1/P2 issue. Full local checks pass
987 Jest tests in 53 suites, typecheck, lint and formatting. Disposable PostgreSQL CI
passed the authorization suite and all 50 real concurrent-session scenarios; final
exact-head CI also covers additional multiple-cycle replay/null-payload regressions.
Generated types were copied verbatim from artifact 12260523131 after verifying source
head 3175d8c057e9bd2a87061723a8da206ed92a5c76 and ZIP SHA256
15869fbd659ab47eb3842449944c80b645d0f6c0e2f6d1e98f2ddedb57ddd156.
Final exact-head quality/database/type-drift gates merge. No production database change,
deployment, native/device QA, process-restart recovery, new dependency or FIN-125 action.
Delegated choices remain pending owner review, not personal confirmation.

---

## FIN-125 — Month-End Remainder

**Status:** Completed

**Depends on:** FIN-123

### Goal

Calculate unused bucket money at period closing.

### Initial Actions

* transfer conceptually to savings;
* rollover to next period;
* keep available/unallocated if domain rules support it.

### Important

If this conflicts with the 100%-allocation invariant, resolve the domain rule before implementation rather than improvising.

### Implementation (ADR-077)

The documented delegated gate keeps 10000bps for new income only. One confirmed
atomic action closes a completed OPEN source and uses an explicit amount up to the
net ordinary remainder, including deficits and extra savings movements. It can fund
general savings once, carry to a selected next-month SPENDABLE bucket, or keep a
separate unallocated carry credit. Carry is neither income nor a second savings split.
The destination must be owned, OPEN, configured and same-currency. Undisposed money
remains historical, not automatically spendable next month.

Immutable v2 close evidence stores post-action facts; existing v1 evidence remains
readable. Active outbound carry blocks a new ordinary reopen. A separately reviewed
atomic reversal debits the still-OPEN, solvent destination and reopens the source;
all current/prior obligations must be resolved and downstream carries undone first.
Original exact disposition/close/reversal/reopen replays remain read-only forever.

Complete scalar reads, current-vs-historical UI, owner-wide invalidation and in-session
QueryClient request recovery extend existing boundaries without a generic ledger.
Process-termination recovery, multi-action splits, redistribution of an existing
unallocated credit, automatic carry, FX, bank transfers, production deployment and
native/device QA are not added. The conservative domain choice awaits owner review.

### Validation

Independent bounded review and delta review found no actionable issues. Local full
Jest passed 1015 tests in 54 suites. Disposable Supabase CI at schema head
`cda8a50ec8e73513fc87375b351dc4c5e823e85d` passed 1904 SQL assertions across
32 files and 57 real two-session scenarios, including seven carry/reversal races.
Generated types were copied verbatim from run `39420020537`, artifact `12262404468`,
with the workflow head verified and ZIP SHA256
`99869142a074f93544030d18eff18e9d344f2ce12010e6687c60428412c6acb7` checked.
The complete reviewed head must pass all CI jobs, including generated-type drift,
before readiness/merge. This does not claim production migration or device QA.



---

## FIN-126 — Phase 1 Review

**Status:** In Progress — automated review and current-device acceptance tracked separately

**Depends on:** FIN-101 through FIN-125

### Goal

Verify the personal-finance core end-to-end.

Critical flow:

```text
sign in
→
configure budget
→
receive income
→
register expenses
→
see remaining budget
→
protect savings
→
resolve recurring bill
→
see safe-to-spend
→
close month
```

### Review evidence

See [FIN-126 review](PHASE_ONE_REVIEW.md) for the authenticated HTTP flow, existing
coverage matrix, dependency findings and explicit native/production limits. The
[current-device checklist](PHASE_ONE_DEVICE_CHECKLIST.md) preserves prior physical
authentication evidence while identifying the newer financial regression still needed.
No Phase 2 work is authorized or included in this review.

---

# 6. Phase 2 — Household Finance

## Objective

Allow two users to manage household finances together without exposing their personal finances.

---

## FIN-201 — Household Schema

**Status:** Merged — independently reviewed, exact-head CI and generated types verified

Create household entities and ownership/membership foundation.

ADR-078 records the closed staging model before implementation. Household creator
audit is distinct from ownership; memberships are a collection with unique
household/Profile identity, explicit structural OWNER/MEMBER labels and valid
join/departure timestamps. Restricted references and immutable attribution guards
preserve future history. No exactly-two cap, owner-count policy or single-active-
household assumption is encoded.

Both tables enable RLS with no policies and no client grants. No real households,
membership UI, RPC, invitation, default split or personal-finance policy change is
included. FIN-202 owns active access; open cardinality/role/lifecycle decisions must
be resolved before relevant operations. FIN-203 invitation decisions are now approved in ADR-080.

The new transactional SQL suite covers constraints, client privilege denial,
default-deny RLS independent of grants, and actual A/B same-household personal
isolation against each other and unrelated C. Independent static review and the
post-Inicio delta review found no actionable issues. Local Docker/PostgreSQL remain
unavailable; real SQL verification uses the existing disposable CI workflow.
Phase 1 current-device acceptance and the earlier margin error remain separate.

Local verification after incorporating Inicio main `0988321`, on pinned Node
24.14.0 / npm 11.9.0, passed typecheck, lint with Expo telemetry disabled,
formatting, all 1049 Jest tests in 55 suites, the installed Router parser regression,
and whitespace checks. These application checks are separate from real SQL evidence.
The complete local checks were repeated successfully after importing generated types,
again with 1049 tests in 55 suites.

Disposable CI run `39471701921`, schema head
`aec776dbcc13432489eae3562fd7c153f42a9a83`, passed Quality checks, all 2099 SQL
assertions across 33 files, existing two-session concurrency scenarios, and the
authenticated HTTP finance journey with both production snapshot parsers. Its only
failure was the expected generated-type drift before importing the generated file.

Database types were copied verbatim from that run's artifact `12288170512`.
Verified ZIP SHA256:
`13b18dd31ccd7475adfe4ec75180bb76d9dd4da02b572a98a29f50f6ba0cbb27`.
The 40944-byte generated file has SHA256
`de08a588c6c58a09edf57ba607070f55dd453d842aed8182abfcf0eb1419bcdf`;
its only schema additions are the two household tables and their relationships.
The migration and SQL test bytes remain unchanged from the reviewed schema head.
Independent review of the complete types/documentation delta found no actionable
issues. Final CI run `39473692889` passed on exact head
`e2d682c9f05273285aded68f0ef4860d395acdcd`, including generated-type drift.
PR #42 merged as `75f8610b7878479f25763aae50024e2e8e5c9320`; its tree
`3a39217a680f8f50f547907510a4eb0a980eef72` is identical to that reviewed head.
No production migration, real household creation, or native/device validation is claimed.

---

## FIN-202 — Household Membership

**Status:** In Progress — bounded slice; initial SQL CI and authentic types verified,
final-head CI required for merge; native acceptance pending

Implement active household membership and authorization.

ADR-079 explicitly scopes this slice to atomic first-household creation for
Profiles without membership history and active-only household/member reads. The
creator receives an explicit OWNER membership; creator provenance is not access.
Private profiles/finances stay isolated while a minimal name/role projection serves
Hogar. This temporary create-flow limit is not a global cardinality decision.

Inactive-only membership history gets a clear unsupported state. Invitations,
leave/removal/rejoin, role changes, ownership transfer and historical visibility
remain unsupported in FIN-202; FIN-203 decisions are now approved in ADR-080. Do not claim a complete
membership lifecycle or FIN-204 completion from this slice.

FIN-201 PR #42 is merged as `75f8610b7878479f25763aae50024e2e8e5c9320`.
FIN-202 was rebased onto that main without changing its previously reviewed tree
before this documentation update. The dependency gate is resolved, and the owner's
publication authorization permits a draft PR and disposable CI. Draft PR #43 has
run its initial disposable checks. Exact-head full CI is a merge requirement;
consult PR #43 for current results. Native acceptance remains pending. No deployment
or real household creation is authorized by this status.

Local validation on pinned Node 24.14.0 / npm 11.9.0 passed 1,109 Jest tests in
57 suites, typecheck with authentic schema types, ESLint with no warnings, Prettier
and the installed Router parser check.
The 60 new household tests cover strict minimal projection, collections, explicit
creation, duplicate requests, interrupted flows, exact retry/read recovery,
revocation and account-cache isolation. Independent source review reproduced two
remount recovery races, now fixed with regressions for confirmed success and a
lost response after commit; the reviewer rechecked both fixes and session guards.
An offline iOS export with synthetic public configuration also passed; this is not
native/device or live-service acceptance.

Initial disposable CI run `39490114410` on schema head
`9c33165061811baf65b809fd8a18218ea746d1e7` passed all 2,357 SQL assertions across
34 files, 57 existing finance concurrency scenarios, all 14 household concurrency
scenarios, the authenticated HTTP finance journey and both application snapshot
parsers. Cleanup passed. The run's only failures were the expected two missing-RPC
typecheck errors and generated-type drift before importing its artifact.

The 41,314-byte database types were copied verbatim from artifact `12295003351` of
that exact schema run. Verified ZIP SHA256:
`d6b1bf19c560a02e0905426f3121a3a93a834ca792894f24dbd2bf92be796e2d`.
Generated file SHA256:
`e7740cb24680bd0eca0e7c06be9041c46f71bab55bc4ba03a41e53740b398442`.
Its only changes are the three expected RPC signatures: `create_first_household`,
`get_my_household_memberships` and `is_active_household_member`. No handwritten type
replacement or escape cast is used. Migration, authorization tests and concurrency
harness remain unchanged from the verified schema head. Full CI, including committed
type drift verification, must pass on the final reviewed head before merge.
Local Docker remains unavailable; the real database evidence comes from disposable
CI, not mocked client tests. No production or native validation is claimed.
The [manual membership checklist](HOUSEHOLD_MEMBERSHIP_REVIEW.md) records pending
synthetic local/device cases and explicit operational limits, not passed acceptance.

---

## FIN-203 — Household Invitation Flow

**Status:** Merged via PR #44 into main `9f38fe9`; independently reviewed head
`663071fcbd7ff02e552e1921f09e509343dbf5ce` passed full exact-head CI `39867477923`.
The merge preserves that tree. Native/device acceptance remains pending.

ADR-080 defines directed account-code invitations, OWNER-only creation/cancellation,
seven-day expiry, explicit recipient acceptance as MEMBER and multiple separate
active households. No email/auth changes or historical same-household reactivation.
The minimal Hogar controls retain stable uncertain requests and isolate session caches.
SQL/RLS, lifecycle concurrency and real HTTP-to-app-parser tests accompany client
regressions. FIN-204 and device acceptance remain separate; no production work claimed.

The final run passed SQL/RLS, concurrency, both authenticated HTTP/parser flows,
Quality, generated-type comparison and cleanup. Authentic 44,788-byte types were
imported from artifact `12463194901`, without handwritten types or escape casts;
file SHA256 is `b5fccfa6d3d369f7c438ea260fb13be89228ace2977bebca4bbe2ecac77f5f03`.
Docker remains unavailable locally; real database evidence comes from disposable
CI. The [short device checklist](HOUSEHOLD_MEMBERSHIP_REVIEW.md#fin-203-short-device-checklist-pending)
is still unexecuted and does not establish native acceptance.

---

## FIN-204 — Household Privacy Test Suite

**Status:** Automated privacy suite validated in CI `39872830246` on head
`6c6ed7f583915b4237cfe24f5ce419501d0e8928`, based on merged FIN-203 main `9f38fe9`.
See [PR #45](https://github.com/Andrew-Mtz/gastos/pull/45) for integration status.
Merge requires independent review and complete CI on the exact final head,
including documentation. Native acceptance and an active GraphQL engine are
outside the executed scope.

The incremental suite adds an explicit actual-catalog privacy inventory, complete
personal RPC partner/stranger isolation with valid owner-probed payloads and per-
attempt no-write checks, and extends FIN-203's HTTP-to-production-parser bridge.
It reuses existing nonempty table/grant/RLS, lifecycle-race and UI/session coverage.
CI passed 3,712 SQL assertions/36 files, all existing concurrency scenarios,
both authenticated HTTP/parser journeys, Quality and cleanup, with zero type drift.
See [scope, executed evidence and remaining gates](HOUSEHOLD_PRIVACY_REVIEW.md).
This does not establish native acceptance or authorize later household features.

Prove:

```text
Partner can see household data.
Partner cannot see user's personal finances.
Stranger can see neither.
```

This task is mandatory before progressing deeply into household features.

---

## FIN-205 — Default Household Split

**Status:** Initial database/HTTP/concurrency CI and independent source review passed;
authentic generated types imported. Merge requires final-head review/CI; native
acceptance remains pending.
See [PR #46](https://github.com/Andrew-Mtz/gastos/pull/46) for integration status.

Owner-only explicit percentage templates, active-member read access, integer basis
points totaling 10000, unique full active roster including explicit zero, optimistic
versions, exact retry receipts and stale-roster review are implemented. No defaults,
redistribution, expense calculation, money movement or history UI are introduced.
The FIN-204 catalog and existing personal matrix remain fail-closed and intact.
Initial disposable CI `39881197339` passed 3,913 SQL assertions/37 files, all existing
concurrency suites plus 16 split scenarios, both HTTP journeys and their production
parsers (two finance/four household), type generation and cleanup. Its only failures
were expected missing-RPC typecheck errors and pre-import type drift. Authentic
47,592-byte types came from artifact `12470249983`; product/SQL source is unchanged.
Merge requires independent review and complete CI on the exact final head, including
the types/documentation delta. No production rollout or native acceptance is claimed.
See [contract, artifact hashes and verification gates](HOUSEHOLD_SPLIT_REVIEW.md).

Implement percentage-based default split using basis points.

Example:

```text
70 / 30
```

---

## FIN-206 — Shared Expense Domain Calculation

**Status:** Implemented, locally verified and independently reviewed. Integration requires complete CI on the exact head.

Implement deterministic shared split calculation and responsibility amounts.

Must use largest-remainder behavior.

The pure calculation composes FIN-205 share validation and FIN-102 allocation for
a positive Money total, with canonical membership UUID ordering, explicit zero
shares and one unchanged currency. Payer and trusted membership authorization
remain separate; no persistence, financial effects, UI or dependency changes.

Local Node 24.14.0 / npm 11.9.0 verification passed typecheck, lint, formatting,
all 1306 Jest tests across 63 suites and the installed Router parser regression.
The 101 new tests cover safe bounds, invalid/forged data, exact conservation,
permutation/locale independence, immutability and all 10001 two-member basis-point
distributions. No database changes or native/device validation are included.

---

## FIN-207 — Shared Expense Persistence

**Status:** Initial disposable SQL/HTTP/concurrency CI and independent source review
passed on published head `cc19018e2788f563b3f375b689429a99a46267f4` under ADR-082.
Authentic generated types are imported. Final exact-head review and complete CI
remain required before merge. No native/device or production claim.
See [PR #48](https://github.com/Andrew-Mtz/gastos/pull/48) for integration status.

Initial CI `39896225014` passed migrations, 4,127 SQL assertions across 38 files,
all concurrency suites including 17 new shared-persistence scenarios, and both
authenticated HTTP journeys with their two personal/five household parser tests.
Its failures were the expected pre-import RPC typecheck errors and generated-type
drift; this is not an overall green CI claim. The unchanged 52,883-byte type file
came from exact-head artifact `12476938586`, with SHA-256
`31a5155601aab7539523195fbbd98f6f8f31f0505e150ae66836367c26d87fe6`.
The typed adapter now omits only a null description for SQL DEFAULT NULL while
preserving empty and nonempty original strings. SQL source and financial semantics
are unchanged. Final-head CI must verify generated-type drift and all checks again.

The bounded slice persists the atomic HOUSEHOLD transaction/header/full historical
split snapshot from the current default template. Current active members may create
and read a single authorized record; payer and responsibility are separate. Exact
retry, version/roster conflicts, immutable history, no direct writes and unchanged
personal read models are explicit contracts. No entry UI, custom split or categories,
FIN-209 history, FIN-210/211 effects or currency conversion is included.

Implement atomic persistence for:

```text
transaction
shared expense
split rows
```

Likely via PostgreSQL RPC.

Security review required.

---

## FIN-208 — Register Shared Expense

**Status:** Implemented and locally verified. Independent final-head review and full
CI (including disposable SQL/HTTP/concurrency) remain required before integration.
Native acceptance and production deployment are not claimed.

Create the initial shared-expense UI/use case (ADR-083, explicit user clarification
2026-10-23). Earlier optional custom-split wording is superseded, not implemented.

Initial UX:

* any active member can register in the selected household;
* positive amount, financial date, one active payer and optional description;
* fixed household currency, no conversion or private budget/category dependency;
* automatic current OWNER-controlled template, with no per-expense override;
* exact FIN-206 responsibility preview, explicit confirmation and persisted receipt;
* current template/roster checks, stable uncertain retries and isolated lifecycle.

No history feed, cash/debt/budget effects, currency conversion, taxonomy or redesign.
Verification details and pending native checks: [FIN-208 checklist](SHARED_EXPENSE_ENTRY_REVIEW.md).

---

## FIN-209 — Shared Expense History

Display authorized household expenses.

No personal financial data may leak.

---

## FIN-210 — Personal Budget Impact From Shared Expenses

Apply only the user's responsibility to their personal budget consumption.

Example:

```text
Total shared expense: 1000
User responsibility: 700
Budget impact: 700
```

---

## FIN-211 — Cash Impact From Shared Expenses

Distinguish actual paid amount from responsibility.

Example:

```text
Paid: 1000
Responsibility: 700
Receivable: 300
```

---

## FIN-212 — Household Balance Calculation

Derive who owes whom.

Must work deterministically.

Avoid permanently assuming exactly two members in the core algorithm.

---

## FIN-213 — Household Balance UI

Display outstanding household balances clearly.

---

## FIN-214 — Settlements

Allow one member to record repayment to another.

Settlement:

* affects cash;
* does not affect spending budget.

Authorization rules must be explicitly finalized.

---

## FIN-215 — Shared Recurring Expenses

Support recurring household expense templates.

---

## FIN-216 — Resolve Shared Variable Bill

Example:

```text
Water
pending amount
→
UYU 890
→
shared expense generated with current/default split
```

---

## FIN-217 — Shared Savings Goals

Create household-visible savings goals.

---

## FIN-218 — Household Savings Contributions

Track contributions and contributor identity.

---

## FIN-219 — Household Dashboard v1

Show only household-scoped information:

* household expenses;
* responsibilities;
* amounts paid;
* outstanding balance;
* upcoming shared bills;
* shared savings.

---

## FIN-220 — Edit/Delete Shared Expenses

Before implementation, explicitly define who may modify expenses created by another member.

Security decision required.

---

## FIN-221 — Household Split History

Verify historical expenses retain their original split after default household split changes.

---

## FIN-222 — Phase 2 Review

Critical flow:

```text
User A creates household
→
User B joins
→
default 70/30 split
→
water bill entered
→
User A pays
→
both see shared expense
→
personal budgets receive correct responsibility
→
balance calculated
→
User B settles debt
```

Security isolation must be included in review.

---

# 7. Phase 3 — Financial Accounts and Credit Cards

## Objective

Model where money lives and support credit cards without double counting.

Tasks will receive detailed IDs before Phase 3 begins.

Planned capabilities:

```text
Financial accounts
Cash
Bank accounts
Transfers
Credit cards
Credit card purchases
Card liabilities
Statements
Statement payment
```

Before implementation, resolve the open credit-card liability model.

---

# 8. Phase 4 — Multi-Currency Improvements

## Objective

Provide reliable reporting across multiple currencies.

Planned capabilities:

* base reporting currency;
* exchange-rate provider;
* exchange-rate snapshots;
* conversion;
* cross-currency dashboards;
* household currency behavior.

Before implementation, explicitly resolve how budget consumption works when an expense currency differs from the budget period currency.

---

# 9. Phase 5 — Quick Entry

## Objective

Reduce manual expense registration friction.

Planned capabilities:

* fast expense form;
* recent categories;
* sensible defaults;
* shortcuts;
* context-aware preselection;
* potentially home-screen widgets.

No AI required.

---

# 10. Phase 6 — Natural Language and Voice

## Objective

Allow financial operations through natural language.

Planned capabilities:

```text
"I spent 800 pesos on food."
"The water bill was 890."
"We spent 2200 at the supermarket and I paid."
"How much leisure money do I have left?"
```

Architecture:

```text
text/voice
↓
intent parsing
↓
validated structured action
↓
existing application use case
```

AI must not implement financial arithmetic.

---

# 11. Phase 7 — Siri

## Objective

Integrate core application actions with iOS App Intents / Siri.

Planned commands:

* register expense;
* register shared expense;
* query remaining budget;
* query household balance;
* potentially savings actions with confirmation.

Siri must use existing application use cases.

No duplicate domain logic.

---

# 12. Phase 8 — Financial Intelligence

## Objective

Help users act before financial problems occur.

Planned capabilities:

* spending projection;
* month-end forecast;
* category trends;
* unusual expenses;
* repeated overspending;
* budget recommendations;
* savings recommendations.

Recommendations must be explainable and optional.

The application must not autonomously alter financial plans.

---

# 13. Deferred Product Areas

The following are intentionally outside the initial roadmap:

* bank account aggregation;
* automatic bank transaction import;
* investment portfolios;
* taxes;
* business accounting;
* lending;
* cryptocurrency;
* autonomous financial agents;
* full offline-first support;
* separate web application;
* multi-household UX optimization;
* advanced role systems.

---

# 14. Dependency Rule

Codex must not implement a task when a required dependency is incomplete unless explicitly instructed.

Example:

```text
FIN-111 depends on FIN-107 and FIN-108.
```

Do not create temporary duplicate models merely to bypass unfinished dependencies.

---

# 15. Scope Rule

When assigned:

```text
FIN-111
```

Codex implements `FIN-111`.

It must not also implement:

```text
FIN-112
FIN-113
FIN-114
```

unless the task explicitly requires a small prerequisite and the deviation is reported before implementation.

---

# 16. Investigation Rule

Before coding any non-trivial task, Codex should identify:

```text
Current state
Relevant documentation
Affected files
Domain impact
Database impact
Security impact
Tests required
Open decisions
```

If an unresolved decision blocks implementation, report it rather than guessing.

---

# 17. Review Rule

After Codex implements a task, review must verify:

1. Does it match the assigned FIN scope?
2. Does it respect `PRODUCT.md`?
3. Does it respect `DOMAIN.md`?
4. Does it respect `SECURITY.md`?
5. Does it respect `ARCHITECTURE.md`?
6. Does it respect accepted ADRs?
7. Are calculations correct?
8. Are database changes atomic where necessary?
9. Are RLS policies correct?
10. Are negative security tests present?
11. Did Codex introduce unnecessary abstractions?
12. Did Codex implement future work accidentally?

Only after review should the next dependent task begin.

---

# 18. Roadmap Change Policy

This roadmap is expected to evolve.

When priorities change:

* edit this document explicitly;
* preserve already completed task IDs;
* do not silently redefine completed tasks;
* add new task IDs where appropriate;
* update dependencies.

If a completed implementation no longer matches the desired product, create a new task rather than pretending the old task never existed.

---

# 19. Current Next Task

The current authorized implementation sequence is:

```text
FIN-201 — Household Schema
FIN-202 — Household Membership, after FIN-201 review and passing CI
```

The owner explicitly authorized these independent household foundations while
FIN-126 current-device acceptance remains open. Automated personal-finance checks
and the merged Inicio stabilization do not constitute physical acceptance or
diagnose the previously reported margin error. Do not mark FIN-126 complete.

FIN-203 directed invitation/cardinality decisions were explicitly approved by the owner
on 2026-10-21 (ADR-080). This authorization does not skip FIN-204 privacy verification
or include later shared-expense functionality. Departure and role-management policy
remain outside the bounded invitation slice.

FIN-011 remains explicitly deferred by ADR-065.
