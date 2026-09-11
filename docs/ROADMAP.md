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

**Status:** Not Started

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

**Status:** Not Started

**Depends on:** FIN-004

### Goal

Introduce the application profile corresponding to a Supabase Auth identity.

### Scope

Initial profile fields only:

```text
id
auth_user_id
display_name
base_currency
timezone
created_at
updated_at
```

Exact database representation may be refined during implementation.

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

**Status:** Not Started

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

Exact secure session-storage implementation.

Initial auth provider should remain minimal.

### Security Requirements

* secure session persistence;
* clear user caches on logout;
* authenticated routes are not treated as database security.

### Acceptance Criteria

Two independent test users can authenticate and remain isolated.

---

## FIN-007 — Navigation Shell

**Status:** Not Started

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

**Status:** Not Started

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

**Status:** Not Started

**Depends on:** FIN-002, FIN-003

### Goal

Run basic project validation on GitHub PRs.

### Scope

GitHub Actions for:

```text
install
typecheck
lint
tests
```

### Acceptance Criteria

A deliberately failing check prevents CI success.

---

## FIN-010 — Supabase Authorization Test Foundation

**Status:** Not Started

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

### Acceptance Criteria

Automated test proves that User A cannot read User B's private profile data.

---

## FIN-011 — iOS Development Workflow

**Status:** Not Started

**Depends on:** FIN-001

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

**Status:** Not Started

**Depends on:** FIN-001 through FIN-011

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

**Status:** Not Started

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

**Status:** Not Started

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

**Status:** Not Started

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

**Status:** Not Started

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

---

## FIN-105 — Budget Allocation Schema and Domain

**Status:** Not Started

**Depends on:** FIN-102, FIN-103, FIN-104

### Goal

Assign budget percentages to a financial period.

### Requirements

* percentages total 100%;
* allocations belong to a period;
* history remains immutable across future periods;
* safe deterministic amount calculations.

---

## FIN-106 — Initial Budget Setup

**Status:** Not Started

**Depends on:** FIN-105

### Goal

Allow a user to select:

* Balanced;
* Saver;
* Aggressive Saving;
* Custom.

### Requirements

Display percentages and calculated expected amounts before saving.

---

## FIN-107 — Category Domain and Schema

**Status:** Not Started

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

---

## FIN-108 — Transaction Schema

**Status:** Not Started

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

---

## FIN-109 — Register Income

**Status:** Not Started

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

---

## FIN-110 — Income-Based Budget Availability

**Status:** Not Started

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

---

## FIN-111 — Register Personal Expense

**Status:** Not Started

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

## FIN-112 — Personal Transaction History

**Status:** Not Started

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

## FIN-113 — Bucket Consumption

**Status:** Not Started

**Depends on:** FIN-111

### Goal

Derive spending per budget bucket.

### Requirements

Do not persist dashboard totals initially.

Calculation must exclude:

* deleted transactions;
* non-expense movement types.

---

## FIN-114 — Protected Savings

**Status:** Not Started

**Depends on:** FIN-110, FIN-108

### Goal

Treat savings allocation as unavailable for ordinary spending.

### Requirements

* savings amount shown separately;
* ordinary safe-to-spend excludes protected savings;
* no implicit savings withdrawal.

---

## FIN-115 — Explicit Savings Contribution and Withdrawal

**Status:** Not Started

**Depends on:** FIN-114

### Goal

Support explicit savings movements.

### Requirements

* contribution;
* withdrawal;
* confirmation for withdrawal;
* transaction history;
* deterministic availability.

---

## FIN-116 — Personal Savings Goals

**Status:** Not Started

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

---

## FIN-117 — Personal Recurring Expense Schema

**Status:** Not Started

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

---

## FIN-118 — Resolve Variable Recurring Expense

**Status:** Not Started

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

## FIN-119 — Committed Money

**Status:** Not Started

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

## FIN-120 — Safe-to-Spend v1

**Status:** Not Started

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

Before implementation, confirm the final Phase 1 formula against open domain decisions.

---

## FIN-121 — Personal Dashboard v1

**Status:** Not Started

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

---

## FIN-122 — Edit and Soft Delete Personal Transaction

**Status:** Not Started

**Depends on:** FIN-111

### Goal

Allow mistakes to be corrected.

### Requirements

* edit;
* soft delete;
* calculations update correctly;
* ownership/RLS preserved.

---

## FIN-123 — Close Budget Period

**Status:** Not Started

**Depends on:** FIN-121

### Goal

Allow a user to close a completed month.

### Requirements

* OPEN → CLOSED;
* summary;
* normal editing blocked afterward;
* closed history remains readable.

---

## FIN-124 — Reopen Budget Period

**Status:** Not Started

**Depends on:** FIN-123

### Goal

Explicitly reopen a closed period for corrections.

### Requirements

* explicit user action;
* preserve history;
* prepare for future audit logging.

---

## FIN-125 — Month-End Remainder

**Status:** Not Started

**Depends on:** FIN-123

### Goal

Calculate unused bucket money at period closing.

### Initial Actions

* transfer conceptually to savings;
* rollover to next period;
* keep available/unallocated if domain rules support it.

### Important

If this conflicts with the 100%-allocation invariant, resolve the domain rule before implementation rather than improvising.

---

## FIN-126 — Phase 1 Review

**Status:** Not Started

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

---

# 6. Phase 2 — Household Finance

## Objective

Allow two users to manage household finances together without exposing their personal finances.

---

## FIN-201 — Household Schema

Create household entities and ownership/membership foundation.

---

## FIN-202 — Household Membership

Implement active household membership and authorization.

---

## FIN-203 — Household Invitation Flow

Resolve and implement the invitation lifecycle.

This task must settle relevant open security decisions first.

---

## FIN-204 — Household Privacy Test Suite

Prove:

```text
Partner can see household data.
Partner cannot see user's personal finances.
Stranger can see neither.
```

This task is mandatory before progressing deeply into household features.

---

## FIN-205 — Default Household Split

Implement percentage-based default split using basis points.

Example:

```text
70 / 30
```

---

## FIN-206 — Shared Expense Domain Calculation

Implement deterministic shared split calculation and responsibility amounts.

Must use largest-remainder behavior.

---

## FIN-207 — Shared Expense Persistence

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

Create the initial shared-expense UI/use case.

Initial UX:

* one payer;
* percentage split;
* default household split;
* optional custom split.

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

The current next implementation task is:

```text
FIN-004 — Supabase Project Foundation
```

No financial business logic should be implemented before the foundation work begins.
