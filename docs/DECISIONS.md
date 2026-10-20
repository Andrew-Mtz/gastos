# Architecture Decision Records

**Version:** 0.1
**Status:** Active
**Last updated:** 2026-09-09

This document records accepted architectural and technical decisions.

Each decision should include:

* context;
* decision;
* consequences;
* status.

Accepted decisions remain active until explicitly superseded by a newer ADR.

Do not silently reverse an accepted decision during feature implementation.

---

# ADR-001 — Use React Native with Expo

**Status:** Accepted

## Context

The application is mobile-first and initially targets iOS.

Development is performed primarily from Windows, but the project must retain access to native iOS capabilities such as Siri and App Intents.

## Decision

Use:

```text
React Native
+
Expo
+
TypeScript
```

The project will begin with Expo rather than a manually maintained bare React Native setup.

Expo Development Builds will be used when native dependencies or custom native code become necessary.

## Consequences

Benefits:

* faster project bootstrap;
* simpler development workflow;
* cloud iOS builds through EAS;
* ability to develop from Windows;
* simpler deployment to physical devices;
* path toward custom native functionality.

Trade-offs:

* Expo SDK compatibility must be respected;
* some advanced native functionality may require prebuild/config plugins/native code;
* Expo Go will not be treated as a permanent technical constraint.

---

# ADR-002 — Use Expo Router

**Status:** Accepted

## Context

The application requires authenticated and unauthenticated navigation, nested feature areas, and a future deep-link/Siri-compatible navigation model.

## Decision

Use Expo Router for application navigation.

Conceptual route groups:

```text
(auth)
(app)
```

## Consequences

* route structure is filesystem-based;
* authentication flow must integrate with Expo Router;
* route protection remains a UI concern and not a substitute for backend authorization.

---

# ADR-003 — Use Supabase as the Initial Backend Platform

**Status:** Accepted

## Context

The MVP requires:

* PostgreSQL;
* authentication;
* secure per-user data access;
* household-shared data;
* database migrations;
* future realtime capabilities;
* trusted server-side functions where required.

A dedicated backend would increase development and operational complexity at this stage.

## Decision

Use Supabase for:

```text
PostgreSQL
Supabase Auth
Data API
Row Level Security
RPC / PostgreSQL functions when appropriate
Edge Functions when trusted backend execution is required
Realtime only when justified
```

## Consequences

Benefits:

* lower backend boilerplate;
* PostgreSQL remains the actual database;
* strong fit for RLS-based privacy;
* simpler MVP infrastructure.

Trade-offs:

* Supabase-specific infrastructure must remain isolated;
* service-role credentials require strict protection;
* complex backend workflows may eventually justify introducing a dedicated backend.

---

# ADR-004 — Do Not Introduce FastAPI Initially

**Status:** Accepted

## Context

A custom FastAPI backend is technically viable but would initially duplicate functionality already provided by Supabase.

## Decision

Do not introduce FastAPI or another standalone backend in the initial architecture.

A dedicated backend may only be introduced after identifying a concrete requirement that cannot be handled cleanly by:

* PostgreSQL;
* Supabase RPC;
* Supabase Edge Functions.

## Consequences

The initial architecture remains:

```text
React Native
↓
Application / Domain
↓
Supabase
↓
PostgreSQL
```

Adding a backend later requires a new ADR.

---

# ADR-005 — PostgreSQL Is the Persisted Source of Truth

**Status:** Accepted

## Context

The client will contain several forms of temporary state and cache.

## Decision

Persisted financial state is authoritative in PostgreSQL.

The following are not authoritative:

```text
React component state
Zustand state
TanStack Query cache
device-local cache
```

## Consequences

Financial calculations based on persisted history must ultimately derive from PostgreSQL-backed data.

Client state may optimistically represent changes but cannot redefine persisted financial truth.

---

# ADR-006 — Enforce Financial Privacy with PostgreSQL RLS

**Status:** Accepted

## Context

The application contains highly sensitive personal financial information while allowing users to participate in shared households.

UI filtering alone cannot provide sufficient isolation.

## Decision

PostgreSQL Row Level Security is a mandatory authorization layer.

RLS must enforce:

```text
personal records → owner only
household records → authorized active household members
```

Household membership never grants access to another member's personal finances.

## Consequences

* financial tables require RLS review;
* negative authorization tests are required;
* queries must not rely on client filters for security;
* views, functions, realtime, and derived reports require equivalent security review.

---

# ADR-007 — Separate Personal and Household Financial Scope

**Status:** Accepted

## Context

The main product value depends on allowing users to share household finances without merging personal finances.

## Decision

Financial entities must explicitly distinguish between:

```text
PERSONAL
HOUSEHOLD
```

A financial record must belong to one scope only.

Conceptually:

```text
PERSONAL
ownerProfileId != null
householdId == null

HOUSEHOLD
ownerProfileId == null
householdId != null
```

## Consequences

Scope must be enforced consistently by:

* domain validation;
* database constraints where practical;
* RLS.

Scope reassignment must not be freely client-editable.

---

# ADR-008 — Use Percentage-Based Budgeting

**Status:** Accepted

## Context

The product is centered around pre-allocating income rather than only observing spending afterward.

## Decision

Budgeting uses percentage allocations.

Examples:

```text
Needs   50%
Leisure 30%
Savings 20%
```

Each budget period preserves its own allocation configuration.

## Consequences

* allocation percentages must total 100%;
* percentage changes do not rewrite historical periods;
* allocation history is part of the financial record.

---

# ADR-009 — Store Percentages as Integer Basis Points

**Status:** Accepted

## Context

Floating-point percentage values can create rounding inconsistencies.

## Decision

Authoritative percentage values use integer basis points.

```text
100% = 10000
70%  = 7000
30%  = 3000
0.01% = 1
```

## Consequences

Financial percentage calculations avoid floating-point authority.

Validation can enforce:

```text
sum = 10000
```

---

# ADR-010 — Represent Money Using Integer Minor Units

**Status:** Accepted

## Context

JavaScript floating-point arithmetic is unsuitable as authoritative financial arithmetic.

## Decision

Monetary values are represented as:

```text
amountMinor
currency
```

Examples:

```text
USD 10.99
→
1099
USD
```

Do not use floating-point currency values for authoritative calculations.

## Consequences

* parsing and formatting require explicit helpers;
* percentage calculations require deterministic rounding;
* database values must use exact numeric/integer representations.

---

# ADR-011 — Use JavaScript `number` for Minor Units Initially

**Status:** Accepted

## Context

The domain needs an initial TypeScript representation for integer minor units.

`bigint` provides a larger range but introduces additional complexity in:

* JSON serialization;
* React Native tooling;
* APIs;
* Supabase mapping;
* libraries.

Expected personal-finance values are far below `Number.MAX_SAFE_INTEGER`.

## Decision

Use JavaScript `number` for minor-unit values initially.

All monetary values must satisfy:

```text
Number.isSafeInteger(amountMinor)
```

and remain within the safe integer range.

## Consequences

Benefits:

* simpler JSON and Supabase interoperability;
* simpler React Native usage;
* less conversion code.

Constraint:

If product requirements ever approach unsafe integer ranges, migrate intentionally to another representation.

Do not mix `number` and `bigint` ad hoc.

---

# ADR-012 — Use Deterministic Largest-Remainder Allocation

**Status:** Accepted

## Context

Percentage calculations may result in fractional minor units.

The split amounts must exactly equal the original amount.

## Decision

Use deterministic largest-remainder allocation:

1. calculate exact proportional results for the source magnitude;
2. floor each result to integer minor units;
3. determine remaining minor units;
4. allocate remaining units to the largest fractional remainders;
5. break ties using original input order.

For signed Money, apply largest remainder to the absolute magnitude and reapply
the source sign to every allocation afterward. Allocation is sign-symmetric:

```text
allocate(-T, shares) = negate each result of allocate(T, shares)
```

## Consequences

For every split:

```text
sum(result amounts) = source amount
```

The algorithm must have dedicated unit tests.

---

# ADR-013 — Budget Buckets and Categories Are Separate

**Status:** Accepted

## Context

A broad financial purpose is different from a detailed spending classification.

## Decision

Model:

```text
BudgetBucket
```

separately from:

```text
Category
```

Example:

```text
Needs
├── Rent
├── Groceries
└── Electricity
```

## Consequences

Changing category organization does not redefine budget allocation concepts.

Categories can be expanded without redesigning the budget model.

---

# ADR-014 — Savings Are Protected but Not Inaccessible

**Status:** Accepted

## Context

The product should discourage accidental use of savings without preventing users from accessing their own money during emergencies.

## Decision

Savings are excluded from ordinary spendable funds.

Savings cannot be consumed implicitly.

Using savings requires an explicit savings-withdrawal operation.

## Consequences

Overspending must not automatically consume savings.

The application may warn and then allow an explicit withdrawal.

---

# ADR-015 — Separate Cash Impact from Budget Impact

**Status:** Accepted

## Context

Shared expenses produce different answers to:

* how much money did I physically pay?;
* how much of this expense economically belongs to me?

## Decision

Treat:

```text
cash impact
```

and:

```text
budget impact
```

as different domain concepts.

## Consequences

Example:

```text
Shared expense total = 1000
User responsibility = 700
User paid = 1000

cash impact   = -1000
budget impact = -700
receivable    = +300
```

Dashboards and reports must not confuse these concepts.

---

# ADR-016 — Shared Expenses Persist Historical Splits

**Status:** Accepted

## Context

Household default split ratios can change over time.

## Decision

Each shared expense stores its own split results.

The household default split is only a template used when creating a new expense.

## Consequences

Changing:

```text
70/30
```

to:

```text
60/40
```

does not change older expenses.

Historical responsibility remains stable.

---

# ADR-017 — Payer and Responsibility Are Independent

**Status:** Accepted

## Context

One household member can pay the entire expense while economic responsibility is shared.

## Decision

Do not derive responsibility from the payer.

Each shared expense records:

```text
payer
+
responsibility split
```

independently.

## Consequences

Household balances derive from the difference between amounts paid and responsibility.

---

# ADR-018 — Transactions Are the General Money-Movement Model

**Status:** Accepted

## Context

Not every movement of money is an expense.

## Decision

Use a general transaction model supporting operations such as:

```text
INCOME
EXPENSE
TRANSFER
SAVINGS_CONTRIBUTION
SAVINGS_WITHDRAWAL
SETTLEMENT
REFUND
REIMBURSEMENT
```

## Consequences

Reports must explicitly decide which transaction types affect:

* spending;
* cash;
* budget;
* savings.

---

# ADR-019 — Credit Card Purchases Are Recognized at Purchase Time

**Status:** Accepted

## Context

Treating credit card payment as a new expense would double count purchases.

## Decision

A credit card purchase is recognized as an expense when the purchase occurs.

Paying the card later is not a new expense.

## Consequences

The future credit-card model must distinguish:

```text
purchase
```

from:

```text
liability/payment settlement
```

The exact liability schema remains open.

---

# ADR-020 — Recurring Expenses Are Templates

**Status:** Accepted

## Context

Variable bills such as electricity or water are known to recur but their exact amount is unknown until received.

## Decision

A recurring expense definition does not automatically imply an actual expense transaction.

For variable recurring expenses:

```text
template
↓
actual amount supplied
↓
real transaction
```

## Consequences

Estimated future obligations can be shown without polluting actual spending history.

---

# ADR-021 — Budget Periods Are Calendar Months for MVP

**Status:** Accepted

## Context

Custom financial periods could eventually be useful, but increase complexity during the MVP.

## Decision

The MVP uses calendar months:

```text
day 1 → last day of month
```

The domain model should avoid unnecessary assumptions that make custom periods impossible later.

## Consequences

Current period calculation remains simple.

Custom salary-cycle periods are deferred.

---

# ADR-022 — Historical Configuration Must Be Stable

**Status:** Accepted

## Context

Financial reports become incorrect if current configuration rewrites historical meaning.

## Decision

Historical values that depend on mutable configuration must be preserved.

Examples:

* budget allocations;
* shared expense splits;
* exchange rates used for reporting;
* closed-period configuration.

## Consequences

Current configuration may serve as defaults for new records but must not redefine existing history.

---

# ADR-023 — Use TanStack Query for Server State

**Status:** Accepted

## Context

The mobile application needs fetching, caching, invalidation, mutation state, and refetching.

## Decision

Use TanStack Query as the primary client server-state solution.

## Consequences

Do not create a parallel custom global store containing authoritative Supabase data.

Authentication changes must clear user-specific query caches.

---

# ADR-024 — Use Zustand Only for Local State

**Status:** Accepted

## Context

Some state does not belong in remote/server-state caching.

## Decision

Use Zustand selectively for local application state such as:

* temporary onboarding state;
* UI state;
* local drafts where justified.

Do not use Zustand as a duplicate transaction/database cache.

## Consequences

Server state remains primarily managed by TanStack Query.

---

# ADR-025 — Use React Hook Form and Zod

**Status:** Accepted

## Context

Financial forms require structured validation and should not accumulate ad-hoc state logic.

## Decision

Use:

```text
React Hook Form
+
Zod
```

for non-trivial forms and external input parsing.

## Consequences

Zod provides boundary validation but does not replace:

* domain validation;
* database constraints;
* RLS.

---

# ADR-026 — Use TypeScript Strict Mode

**Status:** Accepted

## Context

Financial software benefits from explicit types and predictable nullable states.

## Decision

Enable TypeScript strict mode.

Avoid `any` unless a concrete interoperability constraint requires it.

## Consequences

External data must be validated or mapped before being trusted.

---

# ADR-027 — Domain Logic Must Be Infrastructure-Independent

**Status:** Accepted

## Context

Financial rules will be reused by UI, voice, Siri, and future assistants.

## Decision

Core domain code must not depend directly on:

* React;
* React Native;
* Expo;
* Supabase;
* Siri;
* AI providers.

## Consequences

Domain functions can be unit tested independently and reused through shared application use cases.

---

# ADR-028 — All Interfaces Use Shared Application Use Cases

**Status:** Accepted

## Context

The application will eventually support:

* manual UI;
* quick entry;
* text assistant;
* voice;
* Siri.

Separate implementations would create inconsistent financial results.

## Decision

All interfaces must invoke shared application use cases.

Example:

```text
UI ──────────┐
Voice ───────┤
Siri ────────┼→ CreateExpense → Domain → Persistence
Assistant ───┘
```

## Consequences

External adapters interpret input but do not redefine financial logic.

---

# ADR-029 — AI Is an Intent Interpreter, Not a Financial Authority

**Status:** Accepted

## Context

Language models are useful for understanding natural language but are not appropriate as the source of truth for financial calculations.

## Decision

AI may translate natural language into structured commands.

Example:

```json
{
  "action": "create_shared_expense",
  "amountMinor": 220000,
  "currency": "UYU"
}
```

Deterministic domain code then performs all authoritative calculations.

## Consequences

AI must never independently determine authoritative:

* expense splits;
* balances;
* budget availability;
* safe-to-spend;
* savings availability.

---

# ADR-030 — AI Provider Calls Must Run in Trusted Backend Infrastructure

**Status:** Accepted

## Context

AI provider keys must not be embedded in the mobile application.

## Decision

Future AI provider calls run through:

```text
Supabase Edge Function
```

or another trusted backend introduced through a future ADR.

## Consequences

AI provider credentials remain server-side.

Only necessary user data should be sent to the provider.

---

# ADR-031 — Use Direct Supabase Access Selectively

**Status:** Accepted

## Context

Adding an Edge Function or RPC for every CRUD operation would create unnecessary complexity.

## Decision

The mobile client may directly use Supabase for operations that are:

* simple;
* fully protected by RLS;
* safely representable as ordinary CRUD;
* not dependent on server secrets;
* not vulnerable to partial multi-row persistence.

## Consequences

Direct Supabase access is not considered an architectural violation by itself.

Each feature must determine the appropriate persistence boundary.

---

# ADR-032 — Multi-Row Financial Operations Must Be Atomic

**Status:** Accepted

## Context

Some financial actions involve multiple dependent records.

Example:

```text
transaction
+
shared_expense
+
shared_expense_splits
```

Partial writes would leave invalid financial state.

## Decision

Logical financial operations requiring multiple dependent writes must execute atomically.

Use PostgreSQL transactions/RPC where appropriate.

## Consequences

The client must not orchestrate unsafe sequences of independent writes when partial completion would corrupt the domain.

---

# ADR-033 — Prefer PostgreSQL RPC for Database-Centric Atomic Operations

**Status:** Accepted

## Context

Some operations require transactional consistency but do not require external services.

## Decision

Prefer PostgreSQL functions/RPC for operations that are:

* database-centric;
* transactional;
* authorization-aware;
* naturally executed within PostgreSQL.

Use Edge Functions when external services or trusted server secrets are required.

## Consequences

RPC must still respect `SECURITY.md`.

`SECURITY DEFINER` functions require explicit review.

---

# ADR-034 — Do Not Add Realtime by Default

**Status:** Accepted

## Context

Realtime synchronization adds lifecycle, cache, authorization, and concurrency complexity.

## Decision

Use Supabase Realtime only when a product requirement clearly benefits from immediate synchronization.

Potential example:

```text
one household member adds a shared expense
→
other active household member sees it immediately
```

## Consequences

Standard query invalidation/refetching is preferred until realtime provides clear value.

---

# ADR-035 — Do Not Build Offline-First During MVP

**Status:** Accepted

## Context

True offline financial writes require conflict resolution, idempotency, ordering, and synchronization.

## Decision

The initial product may require connectivity for financial persistence.

Do not build a custom offline write queue in the MVP.

## Consequences

Offline-first support may be introduced later through a dedicated architectural decision.

---

# ADR-036 — Use Soft Deletion for Financial Records Initially

**Status:** Accepted

## Context

Users can make mistakes and financial debugging benefits from recoverable history.

## Decision

Where practical, financial records use soft deletion.

Conceptual field:

```text
deleted_at
```

## Consequences

* deleted data is excluded from normal calculations;
* RLS still protects deleted records;
* permanent privacy deletion remains a separate future requirement.

---

# ADR-037 — Use ISO Currency Codes

**Status:** Accepted

## Context

The application must support UYU and USD initially and more currencies later.

## Decision

Represent currencies using ISO 4217 codes where applicable.

Examples:

```text
USD
UYU
EUR
```

## Consequences

Currency symbols are presentation concerns.

Domain logic uses currency codes.

---

# ADR-038 — Preserve Original Transaction Currency

**Status:** Accepted

## Context

Historical transactions must not change meaning when exchange rates change.

## Decision

Every transaction preserves:

```text
original amount
original currency
```

Currency conversion is an additional reporting operation.

## Consequences

Changing exchange rates never rewrites original financial history.

---

# ADR-039 — Store Historical Exchange Rates Explicitly When Conversion Is Used

**Status:** Accepted

## Context

Reports must remain reproducible.

## Decision

When an exchange rate is used for historical financial consolidation, preserve the relevant rate or snapshot.

Do not recompute past financial history using today's exchange rate.

## Consequences

An `ExchangeRateSnapshot` or equivalent association will be introduced when multi-currency conversion enters implementation scope.

---

# ADR-040 — Use User Timezone for Financial Period Semantics

**Status:** Accepted

## Context

Monthly financial periods are user-facing calendar concepts.

Pure UTC boundaries can assign transactions to the wrong financial day/month.

## Decision

Financial period calculations use the user's configured timezone.

Technical timestamps remain timezone-aware.

## Consequences

The initial timezone may be derived from the device and persisted on the profile.

Transaction date remains distinct from record creation timestamp.

---

# ADR-041 — Use Migrations for All Database Changes

**Status:** Accepted

## Context

Schema, RLS, functions, and constraints form part of the application.

Manual database changes create drift.

## Decision

All database changes must be represented in:

```text
supabase/migrations/
```

## Consequences

Manual production changes not reflected in Git are forbidden.

Security policy changes are reviewed like code.

---

# ADR-042 — Check Supabase-Generated Database Types into Git

**Status:** Accepted

## Context

Generated types improve visibility during code review and allow builds/tests without regenerating types on every machine.

## Decision

Generated Supabase database TypeScript types will be committed to the repository.

A standard generation command should be added to project scripts.

## Consequences

Schema-changing PRs must regenerate relevant types.

Reviewers can see type changes alongside migrations.

---

# ADR-043 — Use Synthetic Test Financial Data

**Status:** Accepted

## Context

Real personal financial data is unnecessary for routine development and testing.

## Decision

Development seeds and automated tests use synthetic identities and synthetic financial information.

Recommended identities:

```text
Andy Test
Partner Test
Stranger Test
```

## Consequences

Authorization scenarios can be reproducible without copying production information.

---

# ADR-044 — Require Negative RLS Tests

**Status:** Accepted

## Context

An authorization implementation can appear functional while accidentally exposing data.

## Decision

Privacy-sensitive features require both:

```text
authorized access tests
+
unauthorized access tests
```

## Consequences

A feature touching financial RLS is incomplete without proving relevant isolation scenarios.

---

# ADR-045 — Use GitHub with Small Feature Branches and PRs

**Status:** Accepted

## Context

Development will be implemented incrementally with Codex and manually reviewed before continuing.

## Decision

Use GitHub with:

```text
main
```

as the integration branch.

Work happens on small branches such as:

```text
feature/FIN-001-project-bootstrap
feature/FIN-002-auth
feature/FIN-003-personal-transactions
```

Each logical task should produce a focused PR.

## Consequences

Codex should not implement multiple roadmap phases in one branch.

Each PR must be understandable and reviewable independently.

---

# ADR-046 — Codex Does Not Define Product or Architecture Autonomously

**Status:** Accepted

## Context

Codex is used as the primary implementation agent, but generated code and assumptions require review.

## Decision

Codex may:

* investigate;
* propose;
* implement explicitly scoped work;
* write tests;
* document findings.

Codex may not silently decide:

* new financial rules;
* new security semantics;
* major architectural patterns;
* unresolved items listed in documentation.

## Consequences

When a task reaches an open decision, implementation should stop at the decision boundary and report the issue.

---

# ADR-047 — Prefer Small Correct Implementations Over Future-Proof Overengineering

**Status:** Accepted

## Context

The product specification contains many future capabilities.

Implementing abstractions for all of them immediately would slow development and increase risk.

## Decision

Implement the smallest architecture that correctly supports the current roadmap task while preserving established domain invariants.

## Consequences

Do not implement future functionality merely because it appears in `PRODUCT.md`.

`ROADMAP.md` determines implementation scope.

---

# ADR-048 — Mobile-First, No Separate Web App During Initial Phases

**Status:** Accepted

## Context

The primary use case is immediate personal and household expense management, particularly from an iPhone.

Supporting a full separate web application would increase surface area.

## Decision

Initial development targets the React Native mobile application only.

No separate web application is included in the initial roadmap.

## Consequences

Responsive web UX and browser-specific support are deferred.

The underlying domain should remain portable enough that a web client could be added later.

---

# ADR-049 — Physical iPhone Is the Primary iOS Development Device

**Status:** Accepted

## Context

Development is performed on Windows, where the native iOS Simulator is unavailable.

## Decision

Use a physical iPhone as the primary iOS testing device.

During early compatible development:

```text
Expo tooling
```

When native capabilities are needed:

```text
EAS Development Build
```

For shared beta testing:

```text
TestFlight
```

## Consequences

A Mac is not required for the initial development workflow.

Cloud macOS infrastructure handles signed iOS builds where needed.

---

# ADR-050 — Use EAS for iOS Builds

**Status:** Accepted

## Context

iOS builds require Apple toolchains unavailable locally on Windows.

## Decision

Use Expo EAS for:

* development builds;
* preview/beta builds;
* production iOS builds.

## Consequences

EAS configuration becomes part of repository infrastructure.

Apple signing and TestFlight configuration will be introduced when needed.

---

# ADR-051 — Delay Full Design-System Selection

**Status:** Accepted

## Context

The project needs consistent UI primitives but does not yet have enough product screens to justify a large component system.

## Decision

Start with a lightweight internal design system using React Native primitives and reusable local components.

Do not adopt a large third-party UI framework during bootstrap unless a concrete requirement justifies it.

## Consequences

Initial shared components may include:

```text
Button
TextInput
MoneyInput
Card
Modal
Progress
Typography primitives
```

A dedicated styling/design-system decision may be revisited after core product screens are known.

---

# ADR-052 — Do Not Persist Derived Dashboard Values Initially

**Status:** Accepted

## Context

Values such as remaining budget and household balances can generally be derived from authoritative financial records.

## Decision

Do not initially persist derived dashboard totals solely for rendering convenience.

Examples:

```text
remaining_budget
safe_to_spend
total_spent_this_month
current_household_balance
```

should initially be derived.

## Consequences

Persisted summary snapshots may be introduced later when justified by:

* period closing;
* performance evidence;
* historical reproducibility.

---

# ADR-053 — Closed Periods Require Explicit Reopening

**Status:** Accepted

## Context

Historical financial periods should not change accidentally.

## Decision

A closed budget period cannot be modified through ordinary editing operations.

The user must explicitly reopen it before editing relevant financial records.

## Consequences

Reopening should eventually be audit-relevant.

UI must make the state clear.

---

# ADR-054 — Assistant/Siri Actions Require Idempotency When Retries Can Duplicate Money Events

**Status:** Accepted

## Context

Voice, Siri, AI adapters, and network layers may retry requests.

Duplicate financial mutations are unacceptable.

## Decision

Externally triggered financial operations must support idempotency whenever retry semantics can create duplicate records.

The exact mechanism may be introduced when those features are implemented.

## Consequences

Potential implementation:

```text
idempotency_key
```

or another unique operation identifier.

This is not required for ordinary MVP CRUD where duplication cannot occur through automatic retry.

---

# ADR-055 — Keep Expected Income Separate from Received Income

**Status:** Accepted

## Context

The product must support variable income.

Planning around expected income is different from treating money as actually available.

## Decision

Expected income is planning data.

Received income is represented through actual income transactions.

## Consequences

The application must never imply that expected but unreceived income is spendable.

Budget views may distinguish:

```text
planned
actual
```

---

# ADR-056 — Do Not Automatically Reallocate Overspending

**Status:** Accepted

## Context

A user may exceed a spendable bucket.

Automatically taking funds from another bucket would modify the user's financial plan without consent.

## Decision

Overspending may produce a negative remaining bucket balance.

Do not automatically:

* consume savings;
* move funds from another bucket;
* alter percentages.

## Consequences

Any reallocation must be explicit.

---

# ADR-057 — Household Model Must Not Permanently Assume Exactly Two Members

**Status:** Accepted

## Context

The first use case is a couple, but hardcoding every domain rule around exactly two users would unnecessarily restrict the product.

## Decision

The model supports household membership as a collection of members.

Initial UX may optimize for two members.

## Consequences

Split and balance algorithms should not fundamentally require exactly two participants.

Features beyond two-person households may remain out of scope.

---

# ADR-058 — Use One Payer Per Shared Expense in the Initial UX

**Status:** Accepted

## Context

Supporting multiple simultaneous payers adds additional data structures and UI complexity.

Most initial household expenses are expected to have one person paying and responsibility split among members.

## Decision

The initial shared-expense flow supports one payer.

The domain must not prevent introducing multiple payers later.

## Consequences

No `SharedExpensePayment` model is required initially.

A future ADR can expand the model.

---

# ADR-059 — Equal Household Split Is Derived from Percentage Splits

**Status:** Accepted

## Context

Supporting multiple split strategies immediately adds unnecessary implementation branches.

## Decision

The authoritative initial split strategy is percentage-based.

An equal split is generated as an appropriate percentage allocation.

## Consequences

The initial domain focuses on:

```text
PERCENTAGE
```

Fixed-amount split strategies remain deferred.

---

# ADR-060 — Open Questions Must Remain Explicit

**Status:** Accepted

## Context

Unresolved decisions are safer when documented than when silently guessed by developers or coding agents.

## Decision

Every architecture/domain/security document may contain an `Open Decisions` section.

If implementation requires an unresolved decision:

1. identify it;
2. resolve it explicitly;
3. add or update an ADR when significant;
4. then implement.

## Consequences

"Reasonable assumption" is not sufficient for unresolved financial or security semantics.

---

# ADR-061 — Use Expo SDK 57 for Initial Bootstrap

**Status:** Accepted

## Context

The project requires an explicit Expo SDK version before the initial application bootstrap.

As of the initial implementation in September 2026, Expo SDK 57 is the current stable SDK and uses React Native 0.86 and React 19.2.

## Decision

Initialize the application using Expo SDK 57.

Use Expo-compatible dependency versions selected through the official Expo tooling rather than manually selecting React Native or React versions.

Use the latest compatible stable patch release within SDK 57.

## Consequences

- Expo SDK 57 defines the initial React Native compatibility baseline.
- Dependencies must be installed using Expo-compatible versions.
- `expo install --check` and `expo-doctor` must pass after bootstrap.
- Future Expo SDK upgrades require dedicated work and must not occur incidentally during unrelated feature tasks.

---

# ADR-062 — Use Jest with jest-expo for Unit and Component Tests

**Status:** Accepted

## Context

FIN-003 requires one repeatable runner for React Native component tests and future
domain unit tests. Expo SDK 57's Jest preset uses the Jest 29 toolchain.

## Decision

Use Jest 29 with the SDK-compatible `jest-expo` preset and the React Native Jest
preset matching the installed React Native version. Use React Native Testing
Library 14 for component tests, with `test-renderer` compatible with React 19.2.
Use `@types/jest` for TypeScript test globals and keep type checking separate.

Colocate tests under `src/` in `__tests__` directories, using `.test.ts` for unit
tests and `.test.tsx` for component tests. Colocate future domain unit tests with
their domain modules when those modules exist; do not create empty domain folders.
Keep domain tests independent of React and infrastructure.

## Consequences

- `npm test` runs once; `npm run test:watch` supports local iteration.
- Component tests use asynchronous RNTL 14 APIs and accessible queries where practical.
- Tests do not replace native/device verification.
- Future Jest upgrades must remain aligned with Expo and React Native compatibility.
- FIN-003 does not introduce E2E, database/RLS testing, coverage configuration, or CI.

---

# ADR-063 — Use Supabase CLI for Local Development

**Status:** Accepted

## Context

FIN-004 needs reproducible database configuration and generated types before
product schemas exist. The local Supabase development workflow was unresolved.

## Decision

Use local-first Supabase development with a Docker-compatible runtime and an
exactly pinned Supabase CLI dev dependency in the project. Run the CLI through
npm scripts so collaborators use the same version.

Commit local configuration, migrations, and synthetic seed files. Rebuild the
local database from migrations and seeds. Generate TypeScript types from the
local `public` schema into `src/infrastructure/supabase/database.types.ts` and
commit them according to ADR-042. Keep generation repeatable and preserve the
existing file when generation fails.

Defer hosted project provisioning. Public client configuration uses
`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; actual
development values stay in ignored `.env.local`.

## Consequences

- Local startup and type regeneration require a running Docker-compatible engine.
- Local database reset is destructive to local data; seeds must remain synthetic.
- CLI caches, local credentials, and signing material stay out of Git.
- FIN-004 uses a non-persistent client without importing it into the root UI.
- Secure session persistence is defined for FIN-006 by ADR-064.
- Hosted environments and deployment workflows require later scoped work.

---

# ADR-064 — Secure Supabase Session Persistence and Auth Lifecycle

**Status:** Accepted

## Context

FIN-006 needs secure persistence for Supabase values that can exceed the small
values appropriate for direct SecureStore storage, plus a single lifecycle that
prevents stale identity, Profile cache, and refresh work from exposing private UI.

## Decision

Supabase Auth is authoritative for sessions. A small root Auth Context owns only
reactive identity and lifecycle status. TanStack Query owns Profile server state
under `['profile', authUserId]`; React Hook Form with Zod owns form state.
Do not duplicate sessions/tokens into Query, Zustand, or another persistent store.

Implement only the Supabase `getItem`/`setItem`/`removeItem` contract using:

- Expo SecureStore for a native-generated 256-bit AES key, stored as small hex text;
- AsyncStorage for a versioned AES-256-GCM ciphertext envelope;
- native Expo Crypto APIs, with UTF-8 input, a fresh 96-bit nonce for every write,
  and a 128-bit authentication tag. AAD binds format version, the Gastos/project
  namespace, and the logical Supabase storage key.

Use `WHEN_UNLOCKED_THIS_DEVICE_ONLY` and `requireAuthentication: false`.
No biometric prompt, plaintext fallback, truncation, custom AES primitives,
encryption wrapper, or long-lived decrypted-key cache is introduced.

Serialize operations per logical key. A rejected operation must not poison later
work. For a new entry, persist the native-generated key before encrypting and
storing the complete envelope. Refresh writes reuse the existing key and replace
the AsyncStorage value with newly encrypted content. Do not rotate keys on every
refresh. These two stores do not provide a cross-store transaction; serialization
applies within the single application client/runtime.

Read behavior:

- no key and no payload: return null;
- orphan key or orphan payload: remove unusable material and return null;
- valid pair: decrypt and return the complete value;
- unknown/corrupt envelope, invalid tag, or wrong key: remove unusable material,
  fail closed, and require sign-in after retry acknowledges the cleared state;
- temporary storage access failure: show a retryable initialization error,
  never silently reinterpret it as unauthenticated.

Removal waits behind pending entry operations, deletes SecureStore first, then
AsyncStorage, attempts both removals, and reports unconfirmed cleanup. Keychain
items may survive reinstall while app-container AsyncStorage typically does not;
orphan combinations never establish authentication. Expo Go is not evidence of
standalone reinstall semantics.

The one root lifecycle uses `getSession` and a short synchronous
`onAuthStateChange` callback. Newer Auth events win over stale initialization.
One AppState listener reconciles initial/foreground/background refresh and cleans
up on unmount/Fast Refresh. No custom Supabase lock is introduced. Client settings
are `persistSession: true`, `autoRefreshToken: true`, and
`detectSessionInUrl: false`.

Explicit states cover initializing, initialization error, unauthenticated,
Profile loading/missing/error/ready, and signing out. Profile queries start only
after authenticated initialization; query errors never mean missing Profile.
Protected routes are UX; existing RLS/grants enforce security. Profile Setup uses
the authenticated UUID and ordinary INSERT, re-reading after duplicate/lost
responses. Late work cannot repopulate a different user's state.

Logout immediately locks private UI, cancels and clears private Query state,
stops refresh, and uses `signOut({ scope: 'local' })`. Confirm local storage and
session removal and clear private state again. If remote revocation fails but
local removal is confirmed, remain logged out with a concise warning. Unconfirmed
local cleanup stays locked and retryable. Do not claim global logout or immediate
invalidation of already-issued access JWTs.

## Consequences

Native SecureStore/Crypto/AsyncStorage behavior requires physical-device testing,
including actual session size, restart persistence, logout, and user switching.
Mocked unit tests and local API integration do not replace that evidence.
FIN-006 supports basic email/password only. Provider expansion, biometrics,
account deletion/anonymization, EAS, and persistent financial caches remain out
of scope. No Profile migration, grant, or RLS change is required.

---

# ADR-065 — Defer iOS Development Build Until Required

**Status:** Accepted

## Context

The project runs successfully on a physical iPhone using Expo Go from Windows.
Local Supabase connectivity, authentication, navigation, and current React Native
dependencies work in Expo Go. FIN-011's original acceptance requires a signed
physical-device development build. The Windows + EAS physical-device workflow
requires active Apple Developer Program membership. The user can pay for that
membership, but no current product capability requires activating it.

## Decision

Continue using Expo Go as the primary iOS development workflow for the current
product phases. Defer:

* Apple Developer Program activation for this project;
* `expo-dev-client`;
* EAS project initialization/linking;
* EAS development build profiles;
* iPhone device registration;
* signing/provisioning setup;
* TestFlight setup;
* native ATS/networking configuration specific to a standalone build.

Resume FIN-011 or a successor native-build task before a requirement such as
Siri/App Intents, an unsupported native dependency, TestFlight distribution,
signed development-client testing, or App Store preparation. Do not introduce
this infrastructure solely to satisfy a roadmap checkbox.

## Consequences

Benefits:

* avoids premature native/build infrastructure;
* avoids paying for membership before it provides development value;
* keeps Phase 0 focused on the architecture currently required;
* preserves the fast Expo Go development workflow.

Trade-offs:

* Expo Go does not prove behavior inside the final signed application binary;
* Keychain/bundle-specific behavior of the final app remains unverified;
* custom native features cannot be implemented/tested until this decision is revisited;
* TestFlight distribution remains unavailable.

ADR-049 and ADR-050 remain Accepted and are not canceled or superseded. They
remain the intended physical-device/EAS strategy once activated. Expo Go is not
a permanent architectural limitation. FIN-012 may review the current foundation
with FIN-011 explicitly deferred, without claiming signed-build verification.

---

# ADR-066 — Register Income in the Budget Period Currency Initially

**Status:** Accepted (explicit user decision, 2026-10-20)

## Decision

For FIN-109/FIN-110, income can be registered only in the currency snapshotted
on its budget period. Enforce this in the database as well as the form. Preserve
original transaction amounts and currencies; do not invent a rate, convert using
current rates, or combine unlike currencies.

## Consequences

Future cross-currency income registration and budget conversion remain pending.
That work must define explicit exchange-rate snapshots and reproducible allocation
before lifting this temporary restriction. Expense conversion is not decided here.

---

# ADR-067 — Phase 1 Personal Expenses Use Their Period Currency

**Status:** Accepted under delegated implementation authority (2026-10-20),
pending owner review of `OVERNIGHT_DECISIONS.md`.

New and restored personal expenses require the budget period's currency and an
active owned category mapped to an active SPENDABLE bucket. The category's immutable
bucket relation determines consumption. Savings are never an ordinary expense
source. Cross-currency expenses require Phase 4 conversion semantics before they
can be accepted; no rates are inferred and no historical values are rewritten.

Minimal custom category creation is included in FIN-111 so the existing category
schema can be used from the expense form. Category-management features remain
outside this task. Existing legacy invalid expenses remain visible to history;
future calculations must fail explicitly rather than silently ignore them.

---

# ADR-068 — Cumulative Protected Savings and Explicit Extra Movements

**Status:** Accepted under delegated implementation authority (2026-10-20),
pending owner review of `OVERNIGHT_DECISIONS.md`.

Each currency has a separate cumulative protected reserve. Through a selected
month it equals the sum of each month's independently largest-remainder-rounded
received-income savings allocation, plus active additional contributions, minus
active withdrawals. Expected income, future months, expenses and other currencies
never fund that reserve. An unconfigured month contributes zero allocated reserve;
an incomplete configured allocation or incompatible legacy movement is an error.

A contribution is additional earmarking from the selected month's ordinary
remainder before commitments, not recording the percentage allocation again.
At creation/restoration it cannot exceed that remainder. A withdrawal requires
an affirmative confirmation flag and cannot make any cumulative monthly prefix
negative. A late historical correction cannot invalidate later withdrawals.
Ordinary expenses can still overspend without changing the protected reserve;
contribution eligibility is a creation/restoration check, not a permanent ban on
a later expense deficit. Neither savings action changes cash or expense consumption.
No physical bank transfer occurs. With no configured plan, contribution eligibility
is unavailable; existing cumulative savings may still be withdrawn into that month.

The month-specific ordinary movement adjustment is withdrawals minus contributions.
The remainder before commitments is ordinary allocated income plus that adjustment
minus expense consumption. It may be negative and is explicitly not safe-to-spend.
No ordinary unused amount rolls forward here; cumulative savings need no additional
rollover transaction. Cross-currency movements are rejected, not converted.

Database invoker functions preserve RLS. Owner-scoped transaction advisory locks
serialize transaction and allocation writes, including expenses, at READ COMMITTED.
Deferred constraints validate final historical prefixes after atomic replacements;
registration checks new/restored contributions under the same lock. Stable operation
UUIDs return identical existing rows without writing, including closed-period replay.
Confirmation evidence records the caller's affirmative request, not proof of a
physical gesture. Existing legacy savings rows remain visible in history but fail
savings availability until removed or explicitly restored under current funding/confirmation
guards. All incompatible active rows must be soft-deleted atomically before eligible
restoration; closed periods still require reopening. A
server-managed validation marker prevents unfunded schema-only contributions from
becoming withdrawable money. No legacy financial amount is rewritten.

FIN-122 corrections must preserve these constraints; FIN-125 must not double-roll
protected savings. Goals, accounts, commitments and the final FIN-120 formula remain
separate tasks. Runtime/device verification is not supplied by component tests.

---

# ADR-069 — Personal Goals Are Explicitly Funded Sub-Reserves

**Status:** Accepted under delegated implementation authority (2026-10-20),
pending owner review of `OVERNIGHT_DECISIONS.md`.

A personal goal is an owner-only objective with a name, positive safe-integer target,
immutable currency and optional calendar target date. Creation does not reserve or
move money. Reaching the target is derived from net progress, not an irreversible
status; contributing beyond the target is allowed. Editing/archiving goals is deferred.

A goal contribution is **additional funding from ordinary monthly remainder**, not
assignment of the percentage allocation or existing savings. It is one existing
`SAVINGS_CONTRIBUTION` transaction with an immutable goal reference. Therefore it
reduces ordinary availability once and increases both total protected savings and
that goal's sub-reserve once. Goals are subsets of total savings, never added to it.

An explicit goal-scoped withdrawal reduces that goal and total protected savings,
and returns money only to the withdrawal month's ordinary availability. It requires
the same affirmative confirmation as general savings withdrawals. General withdrawals
can consume only the unassigned reserve (total protected minus all goal sub-reserves).
Neither flow is a bank transfer, income or expense. No automatic assignment, release,
withdrawal, redistribution or cross-currency conversion is introduced.

Every currency/month prefix must preserve nonnegative net progress for each goal
and a nonnegative unassigned reserve. Income/allocation corrections and soft deletion
or restoration retain these guards under FIN-115's owner-level write serialization.
A target date is a planning label, not an automatic action or closed-period bypass.
Snapshots and contribution/withdrawal history explicitly state their through-month.
Stable UUIDs and exact replay comparison include goal identity. Owners cannot relink
an existing movement, forge another owner's goal or change its denomination.

Goal withdrawals are the minimum FIN-115 integration prerequisite required to avoid
silently consuming a goal or making funded goals permanently inaccessible. FIN-122
may later provide corrections while preserving all these constraints. Existing
unassigned savings are unchanged; assigning them without new funding needs a future
explicit, independently documented operation.

---

# ADR-070 — Immutable Monthly Personal Recurring Templates

**Status:** Accepted under delegated implementation authority (2026-10-20),
pending owner review of `OVERNIGHT_DECISIONS.md`.

FIN-117 is creation/read/stop schema, not occurrence generation or a scheduling UI.
A personal MONTHLY template names an owned active category whose immutable mapping
points to an active SPENDABLE bucket. Its denomination is explicit and immutable,
not inferred from changing profile defaults; template creation does not require a
budget period. Later actual resolution must use the period currency (ADR-067) or
fail explicitly, without conversion or rewriting the original template.

FIXED has a positive safe-integer minor amount. VARIABLE has either a nonnegative
safe-integer estimate (zero is explicit) or null (unknown). Neither is actual spending.
Due day is 1–31, clamped to the last valid day of shorter months. The required first
month and optional inclusive last month are canonical first-of-month calendar dates.
Creation cannot begin before the owner's current financial month, derived using the
profile timezone, or overlap an already closed owned period. These creation checks
are not reapplied to an identical replay: retry reads the immutable original row.

All financial definition fields and technical provenance are immutable to clients.
The only permitted update is an explicit stopped-from month, no earlier than the
owner's current financial month. It excludes that and later months, may only move
earlier, cannot be cleared or extended, and cannot change any covered closed month.
Stopping at/before the first month cancels a mistaken future definition. The original
schedule remains intact and a server-managed stop timestamp preserves provenance.
Identical stop replay is read-only. Optional inclusive last month remains immutable.
There is no broad edit/delete, replacement or reactivation operation. Later category/
bucket archival does not rewrite a template. An explicit versioned operation is
needed before broad edits or reactivation. No policy should treat category archival
as cancellation of an established obligation.

Creation uses an authenticated invoker RPC with stable operation UUID and exact
payload replay, backed by the same RLS, constraints and validation as direct INSERT.
Template and budget-period statement locks share the existing owner finance lock;
new template writes require READ COMMITTED. This makes the closed-month check
compatible with future lifecycle operations using the same lock. There is no
household access, privileged function, transaction write or financial aggregate change.
Cash, spending, budget consumption and savings impacts are all zero.

Later FIN-118/119 work must identify each owner/template/month occurrence once,
preserve its original obligation and link the one actual transaction, then exclude
resolved commitments from additional subtraction. This is a design requirement, not
an occurrence table, resolution action or commitment calculation implemented here.
Fixed recurring automatic transaction generation remains intentionally undecided.

---

# ADR-071 — Monthly Resolution Uses the Actual Transaction Identity

**Status:** Accepted under delegated implementation authority (2026-10-20),
pending owner review of `OVERNIGHT_DECISIONS.md`.

FIN-118 projects pending obligations from immutable templates and the selected
canonical month. One actual EXPENSE may carry an insert-only recurring-template
reference and recurring month. A unique owner/template/month constraint includes
soft-deleted rows; transaction ID is both stable resolution request ID and immutable
actual linkage. No separate occurrence table or duplicated financial amounts are
needed. The immutable original template preserves obligation terms and due-day rules.

Resolution is explicit and atomic, same-owner/category/currency and open-period
validated under the existing owner finance lock. The financial date belongs to the
obligation month. An identical active request returns its original row even after
stop, archival or closure; a changed payload, deleted row or different request for
that occurrence conflicts. A stop that wins serialization prevents new resolution;
a later stop never erases or changes an already linked actual.

Soft deletion cancels the established occurrence, removes its actual financial impact
and does not turn it back into pending or create a new commitment. Restore reuses the
same actual identity, respects current ordinary restoration guards and does not
recheck a later stop. FIN-119 must exclude both active and cancelled linked occurrences
from additional commitments. FIN-122 corrections must preserve recurrence/actual
identity; registration cannot serve as a replacement or restoration operation.

The existing EXPENSE paths apply the actual amount once to cash, spending and budget
consumption, without savings withdrawal. Minimal template creation/list/stop UI is a
prerequisite for useful resolution. Fixed actual confirmation, automatic generation,
commitment totals and final availability remain outside FIN-118.

---

# ADR-072 — Bounded Monthly Commitments and Explicit Fixed Confirmation

**Status:** Accepted under delegated implementation authority (2026-10-20),
pending owner review of `OVERNIGHT_DECISIONS.md`.

Commitments are derived planning data, never actual spending. Every unresolved
eligible occurrence in the selected month participates, even if its due day has
passed. A FIXED template contributes its exact confirmed obligation amount; a
VARIABLE template contributes only a labeled estimate, or a separately counted
unknown amount. A known zero estimate is not unknown. Any linked actual, active or
soft-deleted, excludes that occurrence according to ADR-071. A stop excludes its
month and later, not earlier unresolved history. No transaction is auto-generated.

Use one stable authenticated invoker scalar JSON RPC with complete per-bucket sums,
not UI rows or paginated history. Original category/bucket mappings, including
archived or unallocated ones, remain relevant. Invalid spendable mappings or a
monthly obligation in a different currency fail explicitly, including a foreign
unknown or zero estimate. Money and counts remain safe integers; no exchange rate,
partial total, persisted balance or privileged capability is introduced.

The monetary horizon is one selected owned budget period. Older unresolved monthly
occurrences are counted separately across denominations, not added as current debt.
Reads reflect current resolution/cancellation status, not historical point-in-time
snapshots. The UI explains this and does not present a final available balance.
Resolution still requires the true financial date in the occurrence's open month.
A payment actually made in a later month is not supported; do not backdate it merely
to clear an earlier obligation. Before supporting that flow, define a coherent
cross-period liability/payment model. FIN-120 must block numerical safe-to-spend
while older unresolved obligations remain. FIN-123/125 must expose unresolved
obligations rather than silently roll them forward or treat them as free remainder.

Explicit fixed payment confirmation is a minimal FIN-119 correctness prerequisite:
otherwise paid fixed obligations could never leave the commitment calculation.
Reuse the same stable transaction UUID, atomic resolution RPC, unique recurrence
identity, owner lock, RLS and ordinary expense guards. Initial fixed actual amount
must equal the immutable fixed template amount; variable actuals remain independent
of their estimates. Incorrect fixed actuals/differing bills require FIN-122's explicit
correction path without relinking or re-resolving. No additional UPDATE privilege or
correction UI is added here. Exact retries, tombstones, stop, restoration and closed
period rules remain unchanged. Fixed automatic generation remains an open decision.

---

# ADR-073 — Snapshot-Based Monthly Safe-to-Spend with Explicit Uncertainty

**Status:** Accepted under delegated implementation authority (2026-10-20),
pending owner review of `OVERNIGHT_DECISIONS.md`. This is not owner confirmation.

The complete Phase 1 formula is the selected month's largest-remainder-rounded
SPENDABLE allocation of actual received income, minus actual EXPENSE consumption,
minus additional SAVINGS_CONTRIBUTION, plus explicit SAVINGS_WITHDRAWAL, minus
unresolved confirmed FIXED commitments in that month. Goals already participate
through those same savings transactions and are never added/subtracted again.
Expected income, protected percentage savings, other months' ordinary remainders,
account balances and other currencies never fund the result. Negative margins stay
negative; no implicit savings withdrawal or zero clamp is permitted.

The exact base is a monthly budget margin after confirmed commitments, not bank
cash, global solvency or a guarantee that all future spending is known. With known
VARIABLE estimates, label the base **margin before estimates** and separately show
a clearly approximate margin after subtracting those estimates. A zero estimate
remains an estimate. Neither estimates nor unknowns become actual spending. With
any current unknown amount, any older unresolved occurrence (ADR-072), or no complete
configured allocation, withhold all numeric availability margins and explain the
next action. Component amounts may remain visible as facts, not available money.
No numerical margin is shown on invalid, failed or refreshing data.

A single STABLE SECURITY INVOKER RPC composes existing stable savings and commitment
aggregates under PostgreSQL's one calling-statement MVCC snapshot. Nested stable
reads share that snapshot, so a concurrent payment cannot appear as neither actual
spending nor a commitment; a contribution cannot combine a new reserve with old
ordinary funding. This is complete server data, not independent client queries or
paginated rows. Existing validation, owner RLS, archived/unallocated mappings,
recurrence cancellation identity and safe-integer bounds remain authoritative.
The read creates no persisted totals or financial movement and needs no elevated
privilege. Monetary intermediate/final overflow fails closed.

The owner-scoped query is invalidated by income, expense, savings/goal movements,
recurring create/stop/resolve, allocation changes, authentication/month changes,
refocus and explicit refresh. FIN-120 adds a small budget-screen result, not FIN-121's
dashboard. Cross-period payments, accounts, conversion and automatic fixed generation
remain deferred. Revisit uncertainty presentation with owner review; FIN-123/125 must
retain pending-obligation gates rather than silently rolling commitments forward.

---

# ADR-074 — Bounded Personal Corrections with Revisions and Recoverable History

**Status:** Accepted under delegated implementation authority (2026-10-20),
pending owner review of `OVERNIGHT_DECISIONS.md`; not personal owner confirmation.

FIN-122 supersedes FIN-108's description-only correction capability, not its identity,
privacy, denomination or closed-period invariants. A personal transaction keeps its
ID, owner/scope/type, budget period/currency, goal and recurrence template/month.
An explicit EDIT changes its positive safe-integer amount, financial date within the
same month, description, and (only for a non-recurring expense) active spendable
category. A linked actual retains its original category and occurrence identity;
a deliberately corrected FIXED amount need not equal its template amount. Initial
FIXED resolution still must equal that amount. No new resolution/replacement is made.

Every UPDATE increments a server-owned revision and atomically appends immutable
before/after snapshots. The first revision preserves the original record, including
pre-migration records; no fictional historical edits are backfilled. Owners can read
this trail and deleted records. DELETE uses a server timestamp and removes the row
from normal financial calculations. A recurring deletion explicitly cancels the
monthly obligation, not just payment. RESTORE reuses the same ID with current guards,
even after template stop; it cannot reset a corrected actual to template defaults.

Application actions use stable UUIDs, exact action/payload/expected-revision replay,
and affirmative review confirmation. Identical replay returns the recorded resulting
revision without mutation, even if a newer revision or closure exists. Reusing a UUID
with different input conflicts. A new operation with a stale revision conflicts.
Existing direct description/tombstone grants remain owner/open-period protected and
are audited, but are not the application's optimistic-concurrency correction path.

Clients retain no monetary/date/category UPDATE grants. A narrowly scoped SECURITY
DEFINER RPC is required for those fields and atomically associates its request with
the audit event. It derives ownership from auth.uid(), validates it explicitly, has
an empty search_path, no dynamic SQL, no owner/scope/identity mutation parameters,
and authenticated-only EXECUTE. An audit-only definer trigger has no direct EXECUTE
grant and can only append authoritative OLD/NEW snapshots for transaction UPDATEs.
Audit rows have owner-only SELECT RLS and no client write/delete permissions. Both
capabilities require explicit independent security review and negative SQL tests.

Owner finance serialization at READ COMMITTED, OPEN period validation and deferred
historical goal/unassigned reserve checks remain mandatory. Increasing an existing
validated contribution requires only its additional amount to fit current ordinary
remainder before commitments; a reduction must still preserve every savings prefix.
Editing cannot promote an unvalidated legacy saving into funded money. Restores use
current full contribution funding checks. Ordinary expense overspending remains
permitted and never triggers a withdrawal. The app invalidates all owner savings,
recurring/commitment/availability/dashboard, history and relevant budget/consumption
queries, and never displays stale financial figures during refresh/error/auth change.

No bank movement, currency conversion, cross-month payment, goal reassignment,
period closure/reopening, remainder operation or generic event-sourcing framework is
introduced. Broader audit retention/account-deletion policy remains a future decision.

---

# Superseding Decisions

When replacing an accepted ADR:

1. do not delete the old ADR;
2. change its status to:

```text
Superseded by ADR-XXX
```

3. create the new ADR;
4. explain why the decision changed.

This preserves architectural history.

---

# Current Open Decisions

The following decisions remain intentionally unresolved.

They should be addressed only when needed by the roadmap.

## Authentication

* authentication providers beyond basic email/password;

## Household

* invitation lifecycle;
* former-member historical visibility;
* detailed household roles;
* who may edit another member's household-created transaction;
* settlement reversal permissions.

## Financial Accounts

* full credit-card liability model;
* credit-card statement model;
* shared financial accounts.

## Recurring Expenses

* whether fixed recurring expenses automatically generate actual transactions.

## Multi-Currency

* exchange-rate provider;
* exact cross-currency budget-consumption rules.

## Safe-to-Spend

Phase 1 formula and estimated/unknown-obligation treatment are resolved by ADR-073
under delegated authority, pending owner review. Later account/cross-period payment
models remain separate decisions.

## Infrastructure

* final E2E framework;
* monitoring provider;
* notification architecture;
* AI provider;
* voice transcription provider;
* exact Siri implementation details.

## Privacy / Production

* account deletion;
* data retention;
* backup policy;
* screenshot/app-switcher protection.

---

# Decision Review Rule

Before introducing any of the following, check whether an ADR exists:

* new backend service;
* new persistence technology;
* new state-management library;
* new UI framework;
* privileged database function;
* external provider;
* offline synchronization;
* realtime architecture;
* background processing;
* new financial representation;
* new authorization model.

If the change materially alters the architecture, create an ADR before implementation.

---

# Related Documentation

Consult:

* `PRODUCT.md` for intended product behavior;
* `DOMAIN.md` for financial semantics;
* `SECURITY.md` for mandatory security boundaries;
* `ARCHITECTURE.md` for architectural structure;
* `ROADMAP.md` for implementation order;
* `AGENTS.md` for agent/developer workflow.

A decision recorded here must not override a higher-level product, domain, or security invariant without those documents being updated explicitly.
