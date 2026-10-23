# Architecture Specification

**Version:** 0.1
**Status:** Active
**Last updated:** 2026-09-09

This document defines the technical architecture, system boundaries, application layers, integration strategy, repository structure, and implementation constraints.

It complements:

* `PRODUCT.md`
* `DOMAIN.md`
* `SECURITY.md`

If implementation choices conflict with domain or security requirements, domain and security requirements take precedence.

---

# 1. Architectural Goals

The architecture must optimize for:

* correctness of financial calculations;
* strict privacy boundaries;
* simple iteration during MVP development;
* maintainability;
* testability;
* clear separation of UI and business logic;
* incremental feature delivery;
* future support for voice, Siri, and AI;
* avoiding unnecessary backend complexity;
* preserving the ability to introduce native iOS code when required.

The architecture should remain simple until additional complexity is justified by real requirements.

---

# 2. Initial Technology Stack

The initial stack is:

```text
Mobile application
- React Native
- Expo
- TypeScript
- Expo Router

Data / Backend
- Supabase
- PostgreSQL
- Supabase Auth
- PostgreSQL Row Level Security
- Supabase Edge Functions when trusted backend execution is required
- Supabase Realtime only when justified

Client state and data
- TanStack Query
- Zustand only for appropriate local application state
- React Hook Form
- Zod

Testing
- Jest 29 with jest-expo for Expo SDK 57 (ADR-062)
- React Native Testing Library
- domain-level unit tests
- database/RLS integration tests

Delivery
- GitHub
- GitHub Actions
- Expo EAS Build
- Expo Development Builds
- TestFlight for iOS distribution
```

---

# 3. Primary Platform

The initial product is mobile-first.

Primary target:

```text
iOS
```

React Native keeps Android support viable, but Android-specific work is not required unless explicitly added to the roadmap.

The architecture must not assume that all functionality can run inside Expo Go.

Native capabilities such as Siri may require Expo Development Builds and native iOS integration.

---

# 4. Expo Strategy

Use Expo rather than starting with a manually maintained bare React Native project.

Initial expectations:

```text
Expo
+
Expo Router
+
EAS
+
Development Builds when needed
```

Expo Go may be used only while all required functionality is compatible with it.

The project must be prepared to move to a custom Development Build without architectural redesign.

---

# 5. Native Code Strategy

React Native is the main application layer.

Native Swift/iOS code may be introduced when a feature requires platform capabilities that cannot reasonably be implemented through existing Expo modules.

Likely example:

```text
Siri / App Intents
```

Native implementation must remain an adapter around shared application use cases.

Native code must not duplicate financial business logic.

Correct direction:

```text
Siri App Intent
      ↓
Application use case
      ↓
Domain logic
      ↓
Persistence
```

Forbidden direction:

```text
Siri App Intent
      ↓
Independent financial calculation
      ↓
Database
```

---

# 6. High-Level System Architecture

Initial architecture:

```text
┌─────────────────────────────┐
│       React Native App      │
│                             │
│ Screens / Components        │
│ Forms                       │
│ Voice / Siri adapters       │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│      Application Layer      │
│                             │
│ Use Cases                   │
│ Validation                  │
│ Orchestration               │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│         Domain Layer        │
│                             │
│ Money                       │
│ Budget calculations         │
│ Expense splitting           │
│ Balance calculations        │
│ Financial invariants        │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│    Infrastructure Layer     │
│                             │
│ Supabase repositories       │
│ Auth                        │
│ RPC                         │
│ Edge Functions              │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ PostgreSQL / Supabase       │
│                             │
│ Tables                      │
│ Constraints                 │
│ RLS                         │
│ Functions where required    │
└─────────────────────────────┘
```

---

# 7. Architectural Layers

The application should use clear conceptual layers.

These layers do not require excessive framework abstraction.

The goal is responsibility separation, not architecture for its own sake.

---

# 8. Presentation Layer

The presentation layer includes:

* Expo Router routes;
* screens;
* React Native components;
* visual states;
* form presentation;
* navigation;
* loading states;
* error states;
* confirmation dialogs;
* presentation formatting.

The presentation layer may:

* collect input;
* invoke application use cases;
* render results;
* display errors.

It must not contain authoritative financial calculations.

---

# 9. Presentation Layer Must Not Calculate Finance

Avoid logic such as:

```ts
const partnerAmount = total * 0.3;
const myAmount = total * 0.7;
```

inside a React component.

Instead:

```ts
const result = calculateSharedExpenseSplit(...)
```

or invoke an application use case that calls domain logic.

This prevents business rules from being duplicated across:

* forms;
* dashboards;
* Siri;
* assistant;
* future widgets.

---

# 10. Application Layer

The application layer coordinates user-facing operations.

Examples:

```text
CreateIncome
CreatePersonalExpense
CreateSharedExpense
CreateSavingsContribution
WithdrawSavings
CreateSettlement
UpdateBudgetAllocation
CreateRecurringExpense
ResolveRecurringExpense
CloseBudgetPeriod
```

Responsibilities include:

* accepting validated input;
* invoking domain rules;
* checking application preconditions;
* coordinating repositories;
* executing multi-step workflows;
* returning structured results.

---

# 11. Domain Layer

The domain layer contains deterministic financial rules.

Examples:

```text
Money
Percentage
calculateBudgetAllocation
calculateSharedExpenseSplit
calculateBudgetImpact
calculateCashImpact
calculateHouseholdBalance
calculateSafeToSpend
```

The domain layer should ideally remain independent of:

* React;
* React Native;
* Expo;
* Supabase client libraries;
* navigation;
* UI state;
* AI providers;
* Siri APIs.

This allows domain logic to be tested independently.

---

# 12. Infrastructure Layer

The infrastructure layer implements communication with external systems.

Initial infrastructure includes:

```text
Supabase
Supabase Auth
PostgreSQL
Edge Functions
EAS / platform services
```

Future examples:

```text
AI provider
Exchange-rate provider
Push notifications
Voice transcription service
```

Infrastructure code must adapt external systems to internal application/domain interfaces.

---

# 13. Repository Pattern

Do not create repositories merely because a generic architecture guide says so.

Use repository abstractions where they provide a useful boundary between application logic and Supabase persistence.

Example:

```ts
interface TransactionRepository {
  create(...): Promise<Transaction>;
  findById(...): Promise<Transaction | null>;
}
```

A simple feature may initially use a focused data-access module instead.

Avoid excessive interfaces with one implementation if they provide no testing or architectural benefit.

---

# 14. Dependency Direction

Dependencies should flow inward.

Preferred:

```text
UI
↓
Application
↓
Domain
```

Infrastructure is consumed through application-facing boundaries.

Domain must not import from presentation or infrastructure.

Forbidden:

```text
Domain
↓
Supabase client
```

or:

```text
Domain
↓
React hooks
```

---

# 15. Suggested Project Structure

Initial structure:

```text
/
├── app/
│   ├── _layout.tsx
│   ├── (auth)/
│   ├── (app)/
│   │   ├── home/
│   │   ├── transactions/
│   │   ├── budget/
│   │   ├── household/
│   │   └── settings/
│   └── ...
│
├── src/
│   ├── components/
│   │   ├── ui/
│   │   └── common/
│   │
│   ├── features/
│   │   ├── auth/
│   │   ├── budget/
│   │   ├── transactions/
│   │   ├── savings/
│   │   ├── household/
│   │   └── recurring-expenses/
│   │
│   ├── application/
│   │   └── ...
│   │
│   ├── domain/
│   │   ├── money/
│   │   ├── budget/
│   │   ├── household/
│   │   ├── savings/
│   │   └── shared-expenses/
│   │
│   ├── infrastructure/
│   │   ├── supabase/
│   │   ├── repositories/
│   │   └── external/
│   │
│   ├── hooks/
│   ├── lib/
│   ├── schemas/
│   ├── types/
│   └── config/
│
├── supabase/
│   ├── migrations/
│   ├── functions/
│   ├── tests/
│   └── seed.sql
│
├── docs/
│   ├── PRODUCT.md
│   ├── DOMAIN.md
│   ├── SECURITY.md
│   ├── ARCHITECTURE.md
│   ├── DECISIONS.md
│   └── ROADMAP.md
│
├── AGENTS.md
├── .env.example
├── app.config.ts
├── eas.json
└── package.json
```

This structure may evolve.

Do not create empty layers or folders only to satisfy this diagram.

---

# 16. Feature Organization

Feature-specific presentation and application code should remain close together where useful.

Example:

```text
src/features/transactions/
├── components/
├── hooks/
├── queries/
├── mutations/
├── schemas/
└── mappers/
```

Reusable domain calculations belong outside feature UI folders.

---

# 17. Domain Types vs Database Types

Database row shapes must not automatically become domain models.

Example database representation:

```text
amount_minor
owner_profile_id
created_at
```

may map to application/domain representation:

```ts
amountMinor
ownerProfileId
createdAt
```

Use explicit mapping where differences matter.

Do not allow PostgreSQL schema details to leak throughout the entire UI codebase.

---

# 18. Supabase Client

The Supabase client belongs to infrastructure/configuration code.

Example conceptual location:

```text
src/infrastructure/supabase/client.ts
```

Do not initialize multiple unrelated Supabase clients throughout components.

There should be a clear client creation/configuration strategy.

FIN-006 integrates the typed client with the root application (ADR-064).
Supabase Auth owns sessions and token persistence. One root Auth Context owns
only reactive identity and lifecycle status; it never duplicates session objects.
One root QueryClient owns Profile server state under `['profile', authUserId]`,
with no persistent query cache. React Hook Form owns authentication/setup inputs.

The Supabase storage adapter keeps only a small AES-256 key in Expo SecureStore
and an authenticated AES-GCM ciphertext envelope in AsyncStorage. Native
`expo-crypto` provides encryption, fresh nonces, and authentication; see ADR-064
for persistence, corruption, serialization, and removal requirements.

One root lifecycle subscribes to Auth events, restores the session, and manages
foreground/background token refresh. Stale initialization cannot replace a newer
identity. Profile queries begin after initialization and distinguish missing rows
from errors. Identity changes and logout cancel queries and clear private cache.
Protected route groups expose auth, Profile Setup, or the application according
to explicit lifecycle states. Loading/storage errors never expose private UI.
RLS remains the authorization boundary. Profile Setup uses owner INSERT with
re-read recovery after duplicate/lost responses, not an unconditional upsert.

---

# 19. Direct Client-to-Supabase Access

Direct client access to Supabase is acceptable for operations that:

* are simple;
* are protected correctly by RLS;
* do not require privileged credentials;
* do not require complex atomic multi-row orchestration.

Example:

```text
read current user's categories
```

may safely use the Supabase Data API with RLS.

---

# 20. When Not to Use Direct Client Writes

Prefer trusted database functions or Edge Functions where operations:

* require multiple dependent writes;
* must be atomic;
* require server secrets;
* involve external providers;
* require privileged access;
* cannot be safely represented through ordinary RLS-protected CRUD.

Example:

```text
CreateSharedExpense
```

may require:

```text
transaction
+
shared_expense
+
shared_expense_splits
```

If partial persistence would create invalid financial state, the operation should execute atomically.

---

# 21. PostgreSQL Functions / RPC

Use PostgreSQL functions when:

* the operation is tightly coupled to database consistency;
* multiple writes must be atomic;
* logic is naturally data-oriented;
* RLS/membership checks can be safely enforced inside the database transaction.

Do not move all business logic into PostgreSQL.

Financial domain calculations should remain reusable and testable outside SQL unless transactional consistency specifically benefits from database execution.

---

# 22. Edge Functions

Use Supabase Edge Functions when trusted server-side execution is required outside ordinary database operations.

Examples:

```text
AI provider request
exchange-rate provider request
push notification orchestration
server secret usage
future webhook processing
```

Do not introduce Edge Functions as an unnecessary proxy for every Supabase query.

---

# 23. Dedicated Backend Service

A standalone backend such as FastAPI is not part of the initial architecture.

It may be introduced later if justified by requirements such as:

* complex backend workflows;
* substantial background processing;
* heavy AI orchestration;
* external integrations that outgrow Edge Functions;
* operational needs not well served by Supabase.

Introducing a dedicated backend requires an architectural decision in `DECISIONS.md`.

---

# 24. TanStack Query

TanStack Query is the preferred client-side server-state layer.

It should manage:

* fetching;
* caching;
* loading states;
* mutation state;
* invalidation;
* refetching;
* retry behavior where appropriate.

Examples:

```text
current budget period
transactions
household expenses
savings goals
```

---

# 25. Query Keys

Query keys should be structured and predictable.

Example:

```ts
['transactions', profileId, periodId]
['budget-period', periodId]
['household', householdId, 'expenses']
```

However, do not treat client query keys as security controls.

RLS must still enforce authorization.

---

# 26. Cache Isolation

User-specific caches must be cleared or isolated when authentication changes.

On logout:

```text
Supabase session cleared
+
TanStack Query cache cleared
+
user-specific Zustand state reset
```

This is required by `SECURITY.md`.

---

# 27. Zustand

Zustand may be used for local application state that is not primarily remote server state.

Good candidates:

```text
temporary onboarding state
UI preferences
temporary draft state
navigation-related local selections
```

Bad candidate:

```text
authoritative transaction list
```

which should come from server state.

Do not duplicate Supabase/TanStack Query data into global Zustand stores without a clear reason.

---

# 28. Forms

Use:

```text
React Hook Form
+
Zod
```

for non-trivial forms.

Examples:

```text
Create expense
Create recurring expense
Update budget percentages
Create household
```

Form schemas may validate:

* required fields;
* basic types;
* positive amounts;
* supported currency codes;
* valid percentages.

Critical invariants must also be enforced in trusted layers.

---

# 29. Validation Boundaries

Validation should occur at multiple boundaries.

```text
UI input
↓
Zod
↓
Application use case
↓
Domain invariant checks
↓
Database constraints / RLS
```

Do not assume one validation layer replaces all others.

---

# 30. Money Type

Introduce a domain-level money abstraction early.

Conceptually:

```ts
type Money = {
  amountMinor: number;
  currency: CurrencyCode;
};
```

As accepted in ADR-011, monetary minor units use JavaScript `number` and must be safe integers.

FIN-101 implements Money in `src/domain/money/money.ts` as factory-created,
frozen readonly plain objects with compile-time brands and pure functions.
FIN-102 implements basis points and deterministic Money allocation in
`src/domain/allocation/allocation.ts`. Both modules are pure TypeScript and have
no React, Expo, Supabase, or other infrastructure dependencies. Parsing and
formatting remain separate from these primitives.

Requirements:

* no floating-point fractional money in authoritative financial arithmetic;
* `Number.isSafeInteger(amountMinor)` is the required safety invariant;
* same-currency arithmetic only unless conversion is explicit;
* deterministic formatting;
* deterministic percentage allocation.

---

# 31. JavaScript Number Constraint

JavaScript `number` safely represents integers only up to:

```text
Number.MAX_SAFE_INTEGER
```

ADR-011 establishes JavaScript `number` for monetary minor units. Every monetary minor-unit value must satisfy `Number.isSafeInteger(amountMinor)` and remain within the safe integer range.

`bigint` is not part of the current architecture. Any future migration away from `number` requires a new ADR.

---

# 32. Percentage Type

Authoritative allocation percentages use safe-integer basis points from `0`
through `10000` inclusive. Full allocations contain at least one share and total
exactly `10000`; the domain does not normalize incomplete or excessive shares.

Example:

```text
100% = 10000
70%  = 7000
30%  = 3000
```

Avoid storing:

```ts
0.7
0.3
```

as authoritative financial split values.

Money allocation uses deterministic largest remainder. Equal remainders use
original input order, and signed Money is allocated by magnitude before its sign
is reapplied. To avoid unsafe `amountMinor * basisPoints` numerators near the
JavaScript safe-integer boundary, the implementation decomposes the magnitude
into quotient and remainder at the `10000` divisor. It does not use floating-point
percentage multiplication or `bigint`.

---

# 33. Currency Type

Use ISO currency codes where applicable.

Conceptually:

```ts
type CurrencyCode = 'USD' | 'UYU' | ...
```

Do not hardcode the domain permanently to USD and UYU even if those are the initial priority currencies.

---

# 34. Date and Time Strategy

Financial transaction date and technical creation timestamp are different concepts.

Example:

```text
transactionDate
createdAt
updatedAt
```

A purchase made yesterday but entered today should preserve yesterday as the transaction date.

---

# 35. Timezone

User-facing period/date calculations should use the user's configured timezone.

Initial default may come from the device.

Avoid using raw UTC date boundaries for monthly budget calculations without converting through the user's financial timezone.

---

# 36. Date Storage

Technical timestamps should use timezone-aware database timestamps.

Financial period dates may use calendar-date semantics where time of day is irrelevant.

Exact column types should be selected deliberately during schema design.

---

# 37. Database Migrations

All database changes must be represented through migrations in:

```text
supabase/migrations/
```

Migrations include:

* tables;
* columns;
* constraints;
* indexes;
* RLS;
* database functions;
* triggers where justified.

Manual production schema changes that are not represented in the repository are forbidden.

ADR-063 defines local-first development using a pinned project-local Supabase CLI
and a Docker-compatible runtime. Local migrations and synthetic seeds reproduce
the database; types are generated from its `public` schema and committed under
`src/infrastructure/supabase/database.types.ts`. Hosted provisioning is deferred.

FIN-103 adds `public.budget_periods`. Each row is owned by `profile_id`, uses
inclusive `date` boundaries constrained to one canonical calendar month, and
snapshots the period currency. Optional expected income uses PostgreSQL `bigint`
with a database bound of `0..9007199254740991`, preserving the JavaScript safe
integer contract. Actual income and allocation rows are separate later concerns.
Owner-only RLS combines with column grants: authenticated clients may insert the
approved creation fields and update only expected income on `OPEN` rows. Identity,
dates, currency, lifecycle state, and timestamps are not client-updateable;
ordinary updates cannot mutate `CLOSED` rows. Generated database types include
the table shape and its Profile relationship but do not replace SQL authorization.

FIN-104 adds `public.budget_buckets`, with a restricted Profile foreign key and
an owner index. `type` is constrained text (`SPENDABLE`/`SAVINGS`); `is_system`
defaults to false. `archived_at` retains historical bucket references instead of
physical deletion. An invoker trigger with an empty search path manages update
and archive timestamps. RLS and narrow column grants enforce private ownership
and defer system-bucket customization. No allocation, category, transaction,
default provisioning, or persisted derived financial value is introduced.

FIN-105 adds `public.budget_allocations`, a unique period/bucket configuration with
integer basis points, restricted foreign keys and soft removal. An initially
deferred constraint trigger enforces a complete active 10000-basis-point set;
periods with no configuration may still await setup. An invoker write trigger locks
the parent period and validates lifecycle and reference ownership. The invoker
`save_budget_allocations(uuid, jsonb)` RPC atomically updates the full set, retaining
removed rows and restoring existing identities rather than physically deleting
financial records. It returns active rows ordered by bucket UUID. RLS and narrow
column grants protect direct access as well as RPC use.

Allocation mutations explicitly require PostgreSQL `READ COMMITTED`, the normal
Data API transaction isolation. Both the row trigger and RPC reject snapshot
isolation rather than trusting a parent lock with a stale transaction snapshot.
The SQL regression suite exercises rejection of direct and RPC writes under
`REPEATABLE READ`. Multi-session race tests are not yet present. Mixing direct
allocation writes with the complete-set RPC can produce a recoverable PostgreSQL
deadlock because row-lock acquisition order differs; callers should prefer the
RPC and may retry the entire failed transaction, never a partial write sequence.

`src/domain/budget/budget-allocation.ts` validates immutable period plans and derives
planned Money values using existing FIN-102 allocation logic with canonical bucket
UUID ordering. Unknown expected income stays null. Planned amounts are not stored,
so changing expected income cannot leave a stale persisted amount; each period's
currency and percentages remain its own source. UI strategies/setup remain FIN-106.

---

# 38. Migration Philosophy

Prefer:

```text
small
reviewable
reversible where practical
```

migrations.

Do not combine unrelated domain changes into one migration.

Every migration must be reviewed for:

* data integrity;
* authorization impact;
* backwards compatibility where relevant.

---

# 39. Database Naming

Use consistent database naming conventions.

Recommended:

```text
snake_case
```

Example:

```text
owner_profile_id
budget_period_id
amount_minor
created_at
```

Application TypeScript may use:

```text
camelCase
```

through explicit mapping.

---

# 40. PostgreSQL Constraints

Critical invariants should be enforced by database constraints where practical.

Examples:

```text
amount_minor > 0
percentage_basis_points >= 0
scope consistency
unique membership
valid date ranges
```

Do not rely exclusively on client-side validation.

---

# 41. RLS Architecture

RLS is part of persistence architecture, not an optional security add-on.

Every financial table must define:

```text
SELECT policy
INSERT policy
UPDATE policy
DELETE policy
```

as appropriate.

Architecture reviews involving a new financial table must include its RLS design.

---

# 42. Database Indexes

Indexes should reflect actual query patterns.

Likely examples:

```text
transactions(owner_profile_id, transaction_date)
transactions(household_id, transaction_date)
household_members(household_id, profile_id)
budget_periods(profile_id, starts_on)
shared_expense_splits(shared_expense_id)
```

Do not prematurely add broad numbers of indexes without observed or obvious query needs.

---

# 43. Soft Delete Strategy

Financial records using soft deletion should include:

```text
deleted_at
```

Queries must consistently exclude deleted rows unless explicitly requesting history/recovery.

Avoid scattering ad-hoc:

```text
.eq('deleted_at', null)
```

everywhere if a reusable data-access pattern can enforce it.

---

# 44. Derived Financial Values

Values such as:

```text
remaining budget
household balance
safe-to-spend
category totals
```

should generally be derived.

Do not persist derived values merely to make UI rendering easier.

Persist snapshots only where required for:

* historical integrity;
* performance with evidence;
* closing-period semantics.

---

# 45. Source of Truth

PostgreSQL is the authoritative source for persisted financial records.

Client state is never authoritative.

Examples:

```text
TanStack Query cache
Zustand state
component state
```

are temporary representations of persisted or local state.

---

# 46. Realtime Strategy

Do not add realtime by default.

Use Supabase Realtime only where product behavior clearly benefits.

Possible future household example:

```text
Partner adds household expense
↓
Other member sees update without manual refresh
```

Before enabling realtime:

* review RLS;
* review subscription authorization;
* define cache update behavior;
* define lifecycle/unsubscription behavior.

---

# 47. Offline Strategy

Full offline-first support is not an initial requirement.

Initial behavior may require connectivity for persistence.

Local optimistic UX is acceptable where safe.

A true offline write queue introduces significant complexity around:

* duplicate operations;
* conflicts;
* ordering;
* household concurrency;
* idempotency.

Do not introduce it until explicitly required.

---

# 48. Optimistic Updates

Use optimistic updates selectively.

Avoid optimistic behavior where rollback would be difficult or where financial correctness could be confusing.

Safe example:

```text
rename personal category
```

Potentially risky:

```text
create multi-row shared expense with split and balance consequences
```

Prefer confirmed server results for financially significant workflows unless optimistic behavior is carefully designed.

---

# 49. Error Handling

Errors should be classified.

Conceptually:

```text
ValidationError
AuthorizationError
NotFoundError
ConflictError
DomainError
InfrastructureError
```

Do not expose raw PostgreSQL or provider errors directly to users.

Preserve enough structured information for debugging.

---

# 50. Duplicate Submission Protection

Financial mutations must account for duplicate client submissions.

Common causes:

* double tap;
* network retry;
* assistant retry;
* Siri invocation retry.

For operations where duplication is harmful, add an idempotency strategy.

The exact mechanism may be introduced per feature.

---

# 51. Transaction Boundaries

Multi-row operations that represent one logical financial action should have one persistence transaction boundary.

Example:

```text
CreateSharedExpense
```

may require:

```text
create transaction
create shared expense
create split rows
```

All succeed or all fail.

Partial financial entities must not be persisted.

---

# 52. Testing Pyramid

Testing priority:

```text
Domain unit tests
↑
Application/use-case tests
↑
Database/RLS integration tests
↑
Component tests
↑
Critical end-to-end flows
```

Domain calculations should have the highest test density.

---

# 53. Domain Tests

Required domain test areas include:

* percentage allocation;
* rounding;
* split totals;
* budget impact;
* cash impact;
* savings protection;
* household balances;
* refunds;
* overspending;
* multi-income periods;
* currency conversion rules when introduced.

---

# 54. RLS Tests

FIN-010 uses local Supabase/PostgreSQL pgTAP tests under `supabase/tests/`, run by
`npm run db:test`. Each file enables `ON_ERROR_STOP`, owns its transaction and
fixtures, and ends with `finish()` and rollback. Shared Auth fixture/JWT support
is included with `\ir helpers/auth.sql.inc`; the `.inc` suffix excludes it from
standalone discovery. Helper functions live only in the session's temporary schema,
use invoker security, and are rolled back; they never enter product migrations.
Role changes stay explicit in test files, with real `current_user`/`auth.uid()`
assertions. Tests must distinguish SQL grants from RLS behavior and run independently.

RLS tests are required for privacy-sensitive features.

Test identities should include at least:

```text
Household member A
Household member B
Unrelated user C
```

Positive and negative access must both be tested.

---

# 55. UI Tests

UI tests should focus on meaningful behavior.

Examples:

```text
user sees validation error
user confirms savings withdrawal
user sees own responsibility for shared expense
```

Avoid excessive snapshot testing with low behavioral value.

---

# 56. End-to-End Testing

Critical workflows should eventually receive E2E coverage.

Examples:

```text
register income
create budget
register personal expense
create household expense
settle household balance
close month
```

Exact E2E tooling can be decided later.

---

# 57. TypeScript Strictness

Use TypeScript strict mode.

Avoid:

```ts
any
```

unless there is a documented interoperability reason.

External data should be parsed/validated before being trusted.

---

# 58. Generated Database Types

Supabase-generated TypeScript database types may be used at infrastructure boundaries.

Do not treat generated database row types as complete domain types.

Regenerate them when schema changes require it.

---

# 59. Code Style

Prefer:

* small functions;
* explicit names;
* deterministic behavior;
* minimal hidden side effects;
* composition;
* feature-local code where appropriate.

Avoid:

* giant service classes;
* generic abstractions without current need;
* utility files containing unrelated functions;
* duplicated financial logic.

---

# 60. Shared UI Components

Reusable visual primitives belong in:

```text
src/components/ui/
```

Examples:

```text
Button
Card
TextField
MoneyInput
ProgressBar
Modal
```

Feature-specific components should stay within their feature.

Do not move a component to shared UI until actual reuse exists or is clearly imminent.

---

# 61. Design System

The MVP should have a lightweight design system.

At minimum define:

* spacing;
* typography;
* border radius;
* semantic colors;
* elevation/shadows if used;
* states;
* common input sizes.

Avoid building a large component library before core flows exist.

FIN-008 implements ADR-051 with React Native `StyleSheet` and semantic color,
spacing, typography, radius, and control-size tokens in `src/theme/tokens.ts`.
Shared presentation components live in `src/components/ui/`: `AppText`, `Button`,
`TextField`, `Screen`/`FormScreen`, and `LoadingState`/`ErrorState`.
Forms use native keyboard avoidance and scrolling; validation, Auth decisions,
and navigation remain in their features. System fonts and native accessibility
props remain available. No ThemeProvider or dark-mode implementation is included.

---

# 62. Accessibility

Mobile UI should use accessible semantics from the beginning.

Examples:

* meaningful accessibility labels;
* readable contrast;
* touch targets;
* screen-reader-friendly controls;
* not relying only on color to communicate budget status.

This is especially important for financial warnings and confirmations.

---

# 63. Formatting Money

Money formatting belongs in shared utilities/domain presentation adapters.

Use locale-aware formatting.

Example:

```text
USD 1,500.00
UYU 1.500
```

Actual display convention can follow locale and user preference.

Do not manually concatenate currency symbols throughout components.

---

# 64. Inputting Money

Money inputs should avoid floating-point parsing mistakes.

The application should normalize user input into integer minor units before persistence/domain arithmetic.

Examples:

```text
"10.99 USD"
→
1099 minor units
```

Locale-aware decimal separators must eventually be supported.

---

# 65. Authentication Architecture

Supabase Auth handles identity.

Application flow:

```text
Supabase session
↓
resolve Profile
↓
load authorized application data
```

Do not use Profile ID as an authentication credential.

---

# 66. Session Storage

ADR-064 defines the implemented session strategy. Supabase owns session state;
session values are encrypted with AES-GCM and stored in AsyncStorage, with key
material in SecureStore. The root Auth lifecycle owns restoration, refresh, and
logout cleanup. No plaintext fallback is permitted. See ADR-064 for the complete
storage and lifecycle invariants.

---

# 67. Auth Routing

FIN-007 implements standard Expo Router bottom tabs directly in `app/(app)/`:
Inicio (index), Transacciones, Presupuesto, Hogar, and Ajustes. No nested tabs
group is needed yet. AuthNavigator retains centralized Auth/Profile protection;
only authenticated-ready users enter the shell. Ajustes invokes the existing
AuthProvider signOut operation. Session lifecycle and cache cleanup remain
owned by FIN-006. The remaining areas are placeholders except Presupuesto, which FIN-106 connects
to private budget setup and persisted plan reads.

Expo Router should separate unauthenticated and authenticated flows.

Conceptually:

```text
(auth)
├── sign-in
├── sign-up
└── onboarding

(app)
├── home
├── transactions
├── budget
├── household
└── settings
```

Route protection is UX/navigation protection.

Database authorization remains mandatory.

---

# 68. Onboarding

Onboarding should eventually collect only information required to start.

Potential initial data:

```text
display name
base currency
budget strategy
```

Household creation can be optional and separate.

Avoid forcing the entire product configuration before the user can enter the app.

FIN-106 keeps budget setup optional in the Presupuesto tab. Its feature module
uses React Hook Form/Zod for decimal input and TanStack Query for owner/month
server state. Decimal parsing produces safe integer minor units and basis
points; previews invoke FIN-105 domain allocation, never floating-point finance
inside components. Currency precision follows Intl currency metadata. Unknown
expected income is not received income or spendable availability.

An explicit Configure action provisions default bucket identities before preview.
Cancel or tab blur discards the draft without creating a financial plan. Save is
one database transaction, with duplicate-submit and stale-navigation guards.
Native iOS keyboard, device Back, and screenshots require a future device pass;
component tests cover interrupted, repeated, cancellation and auth flows. No web
application, new dependencies, or actual-income functionality is introduced.

---

FIN-109 replaces the Transacciones placeholder with current-month income entry and
separate expected/received totals. Form input uses existing exact decimal parsing,
React Hook Form/Zod and the period currency; financial dates use the profile timezone.
Invoker RPCs register one income idempotently and derive its private received total.
The client retains an unresolved request identity and original period across tab
navigation, prevents duplicate taps and does not retry mutations automatically.
New drafts cannot be dismissed by older completions. Auth changes unmount private
state; no persistent local transaction cache or offline queue is introduced. A full
app/process restart does not preserve unresolved request state; users should refresh
received totals before re-entering an uncertain registration after restart.

FIN-110 adds a received-income section to Presupuesto, separate from expected
planning. Pure domain logic derives allocations from the owner-only aggregate RPC;
components do no financial arithmetic. Received totals use owner/period query keys,
with cancellable reads and no fallback to expected values on loading/error. Income
registration invalidates the owner's income query prefix, including bucket totals;
refocus and manual refresh also reload availability. No new tables, persisted
balances, conversion, spending consumption or savings movements are introduced.

FIN-112 adds a private history route with calendar-month filters and descending
financial-date/UUID keyset pagination (50 records plus one lookahead). Reads use
existing transaction/category RLS, exclude soft-deleted rows, preserve archived
category names and original transaction amounts/currencies, and consume cancellation
signals. Owner/month Query keys isolate histories; successful income and expense
registration invalidate history. No totals, schema changes or editing are added.

FIN-113 adds a stable, invoker `get_bucket_consumption` RPC. Its scalar JSON
response contains complete per-bucket sums and minimal historical bucket labels,
not paginated transaction history. Response size scales with relevant buckets,
not transactions; a Data API row limit cannot silently truncate the total. All
checks and aggregates use the same read snapshot. The application validates the
period/currency and response schema, then pure domain code validates unique
bucket identities, safe Money amounts and the exact total in deterministic order.
Presupuesto displays consumption separately from received allocations, including
owned periods without an active plan. Queries are owner/period-scoped, cancellable,
refreshed on focus/manual action and invalidated after expense registration.
Pending/error refreshes hide figures. No new dependency, persisted totals,
remaining/safe-to-spend calculation or savings operation is introduced.

# 69. AI Architecture

AI is not part of the initial MVP infrastructure.

When introduced:

```text
Client
↓
Trusted Edge Function / Backend
↓
AI provider
↓
structured intent
↓
Application use case
↓
Domain logic
```

The AI provider must never directly write authoritative financial data.

---

# 70. AI Tooling Boundary

The assistant may request operations such as:

```text
CreatePersonalExpense
CreateSharedExpense
GetRemainingBudget
GetHouseholdBalance
```

These must be explicit application tools/use cases.

Do not expose generic:

```text
run SQL
update arbitrary table
execute code
```

capabilities.

---

# 71. Voice Architecture

Voice processing consists conceptually of:

```text
Audio/input
↓
Speech-to-text
↓
Intent parsing
↓
Structured application command
↓
Application use case
```

Speech recognition and intent parsing are adapters.

Financial logic remains in the domain/application layers.

---

# 72. Siri Architecture

Future Siri integration:

```text
App Intent
↓
validated parameters
↓
shared application use case
↓
domain
↓
persistence
```

If a Siri command requires authentication or confirmation, the adapter must respect platform security constraints and `SECURITY.md`.

---

# 73. Exchange Rate Architecture

Exchange-rate retrieval will eventually belong to trusted infrastructure.

Example:

```text
ExchangeRateProvider interface
↓
external provider adapter
```

The domain receives explicit rates.

The domain must not fetch external APIs itself.

---

# 74. Notification Architecture

Notifications may eventually originate from:

* local scheduling;
* server-side scheduled processes;
* database-driven events.

The exact strategy should depend on the notification type.

Do not introduce backend scheduling infrastructure until notifications enter the roadmap.

---

# 75. Analytics

Product analytics may be added later.

Analytics must not expose sensitive financial values unnecessarily.

Prefer events such as:

```text
expense_created
budget_period_closed
household_created
```

over:

```text
salary=4500
account_balance=12350
```

Any analytics provider requires a privacy/security review.

---

# 76. Observability

Initial development observability may rely on:

* structured application logs;
* Supabase logs;
* EAS logs;
* test output.

A third-party monitoring provider may be added later.

Financial data redaction requirements in `SECURITY.md` apply.

---

# 77. Performance

Correctness and clarity have higher priority than premature optimization.

Potential optimization triggers include:

* large transaction histories;
* dashboard aggregation latency;
* repeated household balance calculations.

Before denormalizing or caching persisted financial aggregates, gather evidence and document the decision.

---

# 78. Pagination

Transaction history must eventually use pagination or incremental loading.

Do not fetch unlimited financial history into memory.

Possible strategy:

```text
cursor/date-based pagination
```

Exact implementation should follow actual query patterns.

---

# 79. Database Aggregation

Simple financial aggregates may use PostgreSQL where this significantly reduces transferred data.

Example:

```text
sum spending by category for period
```

However, SQL aggregation must preserve:

* RLS;
* currency semantics;
* soft-deleted filtering;
* domain correctness.

Do not move complex business rules into ad-hoc SQL queries scattered across the application.

---

# 80. Schema Evolution

The domain will evolve.

Database design should prefer:

* explicit migrations;
* nullable transitional fields when needed;
* data backfills;
* backwards-compatible rollout where relevant.

Do not delete or repurpose columns containing historical financial meaning without a migration plan.

---

# 81. External Dependencies

Every new significant dependency should be evaluated for:

* maintenance status;
* Expo compatibility;
* bundle impact;
* native requirements;
* security;
* long-term necessity.

Avoid adding libraries for functionality easily implemented with existing tools.

---

# 82. Dependency Versions

Use stable versions compatible with the selected Expo SDK.

Do not independently upgrade core packages such as:

```text
React Native
Expo
React
Expo Router
```

without checking compatibility.

Major framework upgrades require dedicated work, not incidental feature changes.

---

# 83. CI

FIN-009 uses `.github/workflows/ci.yml` for pull requests targeting `main`.
The Ubuntu `Quality checks` job reads the Node version from `.nvmrc`, caches npm
downloads (not `node_modules`), and runs these gates in order:

```text
install
typecheck
lint
format check
tests
```

Installation uses `npm ci`; Jest runs serially through `npm test -- --runInBand`.
The workflow has only `contents: read` permission and does not persist checkout
credentials. Quality checks require no Supabase configuration or secrets.

FIN-010 adds a separate Ubuntu `Database authorization` job:

```text
CI
├── Quality checks
└── Database authorization
```

The database job uses the same pinned Node and project-local CLI, installs with
`npm ci`, verifies the runner's Docker, starts local Supabase, resets migrations,
and runs `npm run db:test`. Cleanup always attempts to stop the stack. Startup
output is suppressed to keep privileged local credentials out of logs. No hosted
project, repository secrets, custom Docker cache, or deployment is involved.
PRs should not merge unless both jobs pass.

FIN-104 extends that same database job with `npm run db:types`, a seven-day
artifact containing only `src/infrastructure/supabase/database.types.ts`, and a
Git diff check that rejects uncommitted generated type changes. Generation runs
against the migrated local CI stack, not a hosted database. Workflow permissions
remain `contents: read`; generated files are reviewed and committed separately,
not pushed automatically by CI.

---

# 84. Build Strategy

Current development:

```text
Windows
→ Expo Go
→ physical iPhone
```

Future native development:

```text
Windows
→ EAS Development Build
→ physical iPhone
```

ADR-065 intentionally defers FIN-011 and Apple Developer/EAS setup until an actual
native or distribution requirement appears. Resume FIN-011 before implementing
such a requirement. Expo Go is not a permanent architectural limitation; ADR-049
and ADR-050 remain the intended future strategy. Signed-binary and bundle-specific
Keychain behavior remain unverified.

Release testing:

```text
EAS Build
↓
TestFlight
```

Production:

```text
EAS production build
↓
App Store Connect
```

---

# 85. Environment Separation

At minimum, plan for:

```text
development
production
```

A dedicated staging environment may be introduced when deployment risk justifies it.

Development must not accidentally point to production financial data.

---

# 86. Supabase Environment Separation

Prefer separate Supabase projects/environments for development and production before real user financial data is stored.

Do not use one production database as a casual development playground.

---

# 87. Seed Data

Development seed data should use synthetic users and synthetic finances.

Example:

```text
Andy Test
Partner Test
Stranger Test
```

Seed scripts must never contain production credentials or copied sensitive data.

---

# 88. Feature Flags

Feature flags are not required initially.

Introduce them when they solve a concrete deployment or experimentation need.

Do not build a feature-flag platform during MVP foundations.

---

# 89. API Versioning

No custom public API is planned initially.

If external API consumers are introduced later, explicit API versioning should be considered.

Internal application modules do not need premature versioned APIs.

---

# 90. Architectural Non-Goals

The initial architecture intentionally avoids:

* microservices;
* Kubernetes;
* event-driven architecture for ordinary CRUD;
* CQRS;
* event sourcing;
* GraphQL;
* a standalone FastAPI backend;
* Redux for server state;
* offline-first synchronization;
* complex dependency injection containers;
* generic enterprise repository layers;
* premature caching infrastructure.

These may be reconsidered if actual requirements justify them.

---

# 91. Architectural Review Questions

Before implementing a feature, answer:

1. Is this personal or household scope?
2. What domain rules apply?
3. Does the operation require atomic persistence?
4. Can direct RLS-protected Supabase access safely implement it?
5. Is an RPC or Edge Function required?
6. What data belongs in client server-state cache?
7. What financial calculation belongs in the domain?
8. What validation belongs in Zod/domain/database?
9. What security policies must change?
10. What tests prove correctness?
11. Does the feature introduce a new architectural pattern?
12. Does it require updating `DECISIONS.md`?

---

# 92. Architecture Invariants

The following rules are foundational.

1. React Native + Expo is the primary client architecture.
2. Supabase/PostgreSQL is the initial persisted-data source of truth.
3. RLS is part of application architecture.
4. Client-side state is not authoritative.
5. Domain financial logic must be deterministic.
6. Domain logic must not depend on React Native or Supabase.
7. UI must not duplicate authoritative financial calculations.
8. Siri, voice, and AI must invoke shared application use cases.
9. Service secrets never exist in the mobile client.
10. Direct Supabase access is acceptable only when RLS and operation complexity make it safe.
11. Multi-row financial operations must be atomic where partial writes would corrupt state.
12. Edge Functions are used only when trusted server execution is justified.
13. A dedicated backend is not part of the initial system.
14. Server state belongs primarily in TanStack Query.
15. Zustand must not become a duplicate database/cache layer.
16. All schema and RLS changes use migrations.
17. Financial arithmetic does not use floating-point authority.
18. Historical financial semantics must survive schema/configuration evolution.
19. Realtime and offline complexity are opt-in, not default.
20. Architecture should favor the smallest correct implementation.

---

# 93. Open Architecture Decisions

Session persistence and the root Auth lifecycle are resolved by ADR-064.

The following decisions are intentionally unresolved and must not be guessed:

3. Exact E2E testing framework.
5. Initial default-template shared-expense persistence is resolved by ADR-082; FIN-208 adds default-only entry; later effects remain separately scoped.
7. Exact state strategy for unsaved multi-step forms.
8. Exact AI provider.
9. Exact speech-to-text provider.
10. Exact Siri/App Intents integration method.
11. Exact exchange-rate provider.
12. Exact production environment strategy before public release.
13. Exact error-monitoring provider.
14. Exact push-notification architecture.
15. Exact account/liability architecture for credit cards.

If implementation requires one of these decisions, it must be resolved explicitly first and, when significant, recorded in `DECISIONS.md`.

---

# 94. Source of Truth Hierarchy

When resolving technical questions:

```text
PRODUCT.md
↓
DOMAIN.md
↓
SECURITY.md
↓
ARCHITECTURE.md
↓
DECISIONS.md
↓
ROADMAP.md
↓
Current task
```

Interpretation:

* `PRODUCT.md` defines what the product must do.
* `DOMAIN.md` defines financial meaning and rules.
* `SECURITY.md` defines mandatory access boundaries.
* `ARCHITECTURE.md` defines how the system should be structured.
* `DECISIONS.md` records concrete technical decisions.
* `ROADMAP.md` defines implementation order.
* A task defines the current requested scope.

A task must not silently override a higher-level invariant.

---

# 95. Related Documentation

Before implementing substantial code, consult:

* `PRODUCT.md`
* `DOMAIN.md`
* `SECURITY.md`
* `DECISIONS.md`
* `ROADMAP.md`
* `AGENTS.md`

Any implementation requiring a new architectural pattern must identify that change before coding.

## FIN-115 explicit savings path

The savings route is a hidden tab reached from Transacciones. Its application
module validates one scalar invoker summary, then the pure savings domain derives
protected reserve, the monthly movement adjustment and ordinary remainder before
commitments. Database aggregation is complete and independently rounds each month;
no history pagination limit or persisted derived balance is involved. The form uses
shared exact input parsing. Withdrawal has a separate amount/date/currency review
and explicit confirmation; neither action performs an actual bank transfer.

Owner/month query keys, cancellation, focus refresh and owner-wide invalidation
keep cross-period balances current. Unconfirmed request identity and payload survive
tab navigation, with no automatic mutation retries; auth changes discard private
state. Full process restart recovery remains unimplemented, as in income/expense
registration. Native/device QA remains unverified. The local-only concurrency
harness runs after pgTAP in CI via `node scripts/test-savings-concurrency.mjs`.

## FIN-117 recurring-template boundary

The new migration provides private create/read/stop persistence; domain parsing and
calendar due-date calculation remain pure. There is no UI, client query cache,
scheduler, occurrence table or financial aggregate change in this schema task.
`create_personal_recurring_expense` uses a stable UUID and exact original payload;
`stop_personal_recurring_expense(id, stopped_from)` only shortens an effective
monthly schedule and preserves original terms. Both are invoker RPCs. Direct writes
obey the same guards and narrow grants. Exact retries do not reactivate a stopped
schedule, change stop provenance or reapply current creation eligibility.

FIN-118 should add only necessary template entry/list/stop UI with owner-scoped
query keys; FIN-119 commitment reads must invalidate on create/stop. Templates alone
must not invalidate actual income/expense/savings balances because none change.
FIN-118/119 must use a unique owner/template/month occurrence identity and actual
transaction link to avoid double counting. FIN-123/124 lifecycle writes must retain
the same owner lock now used by period/template writes. No native runtime claim is
made by the schema/domain tests.

## FIN-118 resolution and recurring UI

The hidden recurring route, reachable from Transacciones, supports monthly inspection,
minimal immutable template creation/stop, and explicit variable-amount resolution.
An invoker scalar JSON snapshot includes all owner templates and selected-month linked
actuals, even after stop or soft deletion. It cannot truncate at a Data API row cap;
future FIN-119 totals must still be complete server derivations, not UI page totals.

Resolution atomically inserts one existing EXPENSE carrying immutable recurrence
identity. It reuses the owner finance lock and ordinary expense validation. The client
validates response owner/month/payload and retains uncertain requests across tab
navigation and month selection, without automatic mutation retries. Auth changes
remove private state. New templates/stops invalidate only owner recurring data;
actual resolution additionally invalidates owner-wide savings/history/consumption/
expense queries and its monthly budget. FIN-119 must attach commitment invalidation
to recurring changes; FIN-122 corrections must invalidate owner recurring data too.
Process termination recovery and native/device runtime remain unverified.


## FIN-119 committed money

A complete scalar monthly commitment RPC returns per-bucket sums and counts plus
an older-unresolved count. SQL aggregates before the API row cap; no transaction
history page or client template list is a financial source. Pure domain validation
checks safe money/count sums and unique bucket identities. The recurring route shows
confirmed, estimated and unknown obligations separately and blocks stale/error
figures. Its query lives under `recurringOwnerKey`, so every template/actual mutation
invalidates commitments along with recurring state. No realtime, dependency,
occurrence ledger, available-balance formula or dashboard is introduced.


## FIN-120 consistent monthly availability

One STABLE invoker scalar RPC composes the STABLE savings/consumption and commitment
read paths with one PostgreSQL statement snapshot. No independent query-cache inputs
are joined into an availability number. Pure domain calculation applies ADR-073;
complete owner/period/month/currency payloads and goal reserve partition are validated.
The small budget-screen card hides every numerical margin on unknown/prior obligations,
missing configuration, invalid/error data and refresh. Known estimates stay approximate.

The query is a member of the owner-wide recurring financial invalidation family,
which existing income/expense/savings/goal/allocation and recurring mutations already
invalidate. Focus and manual budget refresh also invalidate it. Auth cache clearing
and owner/period query keys prevent private stale snapshots crossing accounts/months.
No dashboard, persisted aggregate, realtime, dependency or privileged capability added.

## FIN-121 current personal dashboard

Inicio reads one STABLE SECURITY INVOKER owner/month RPC. It composes the existing
safe-to-spend, received-income and bucket-consumption helpers, period/allocation
metadata and a bounded pending-obligation preview within one calling-statement
snapshot. No independent client financial queries are joined. The application
boundary reuses exact allocation/domain arithmetic and rejects cross-owner, currency,
period, component-total or preview-count inconsistencies. Preview rows are never an
aggregate source. The current-month-only UI uses profile timezone, owner/month cache
keys under the existing recurring invalidation family, cancellation on blur and
background, and refetch on focus/resume/manual refresh. Financial figures are hidden
while loading/refetching, after errors and without a valid current snapshot.

## FIN-122 correction boundary

History opens an owner-scoped, cancellable transaction detail with revision-keyset
before/after audit pages. Active and deleted month histories have separate keys.
The shared correction application module validates exact decimal input, request
identity, immutable references and resulting revision; the UI only reviews and
confirms that operation. A pending uncertain request survives tab/month navigation
and is reconciled unchanged, without automatic mutation retries. Auth changes discard
private state; late results cannot reopen an obsolete selection or affect another
owner's cache. Process-termination recovery remains outside this task.

ADR-074 documents the two narrow definer capabilities: bounded revision-checked
transaction correction and trigger-only append audit. No client monetary UPDATE
permission is added. Financial calculations remain derived from current active
transactions with original immutable relations. Owner-wide savings, recurring
(commitment/availability/dashboard), history, income, expense and consumption queries,
plus the affected monthly budget, are invalidated after confirmed correction. An old
exact replay result is never installed as current transaction or dashboard state.

## FIN-123 explicit period lifecycle

The hidden periods route, reached from Presupuesto, browses calendar months and reads
one owner-scoped server close context. A complete current preview is reviewed before
confirmation; server time/timezone, lifecycle version and fingerprint are checked again
under the owner finance lock. The narrow definer RPC atomically appends immutable
close evidence and changes OPEN to CLOSED, without monetary writes. Closed views
read saved evidence, never current recomputation. Existing history remains accessible.

Uncertain in-session requests retain UUID/version/fingerprint across navigation and
are explicitly reconciled; cancelled previews, blur/background, month and auth changes
cannot submit stale UI. Auth changes discard private state and late responses. Every
close result/rejection invalidates owner-wide derived financial queries plus the target
budget. No automatic retry, process-restart recovery, reopen or remainder disposition.

## FIN-124 lifecycle history and reopening

The existing periods route adds explicit review/confirmation for CLOSED → OPEN. Its
single stable close context also returns immutable closure/reopening history and the
closed-state fingerprint; recorded close summaries remain distinguishable from live
previews. A bounded owner-locked RPC appends reopening evidence and advances lifecycle
without monetary writes. Legacy closes have no invented summary. Auth-scoped query
state retains exact pending close/reopen requests through remount, with no process
persistence or automatic retry. Every lifecycle attempt invalidates the existing
owner-wide financial namespaces and target budget; auth clear removes pending state.
The stable history aggregate has no silent row cap. It is a complete response, not
pagination; exceptional lifecycle growth may warrant an explicit paginated history
contract later rather than silently limiting this one.

## FIN-125 bounded carry integration

ADR-077 adds one disposition and one reversal evidence table, not a general ledger.
Stable aggregate carry components feed the existing savings funding and ordinary
availability paths. Income percentage splits and protected reserve derivation remain
independent. Current snapshots explicitly version carry fields; v1 saved closes remain
readable without silently treating malformed current payloads as zero. The periods
screen shares the existing auth-cleared pending-operation namespace and owner-wide
financial invalidation for atomic close/dispose and reverse/reopen confirmations.

## FIN-201 closed household foundation

ADR-078 stages `public.households` and `public.household_members` without opening
any client API. Household identity includes name, currency and immutable creator
audit; a separate membership collection carries structural role and join/departure
metadata. Restricted foreign keys preserve Profile and household attribution;
the unique household/Profile pair prevents duplicate membership identities.
The pair index supports household lookups and a separate Profile index supports
future membership lookup. No fixed member count or active-household count is encoded.

Invoker-only empty-search-path update triggers protect household identity/creator
and membership identity/household/Profile/join time. Household creation time is
preserved and its update time is database-managed. Both tables enable default-deny
RLS and revoke all client privileges, with no policies, RPC, definer function,
Profile projection, financial scope change or application module.

FIN-202 must introduce reviewed active-membership authorization separately.
FIN-203 invitation semantics have the explicit owner decision in ADR-080; FIN-205 owns
default split storage. Types must come from the exact disposable Supabase CI
artifact, not a hand-edited approximation. Foundation SQL tests independently
exercise constraints, SQL grants, default-deny RLS and actual member personal
isolation; they do not replace FIN-204 or claim native/production validation.

## FIN-202 minimal membership feature (ADR-079)

A feature-local household module replaces the existing Hogar placeholder, reusing
UI tokens/components, React Hook Form/Zod, CurrencySelect and TanStack Query.
Creation uses one atomic RPC; a no-argument snapshot RPC returns only currently
authorized household identity and minimized member names/roles. A narrow definer
helper avoids self-recursive membership RLS, and the name projection does not widen
Profile policies. No generic repositories, realtime or new dependencies.

Auth-owned QueryClient clearing and request-cache identity isolate asynchronous work.
Pending create UUID/payload survive in-session remounts, never logout. Lost responses
can be reconciled by an authorized read of the created household. Blur/background
dismiss unsent editors and hide stale data until foreground/focus revalidation.
Generated schema types remain an authentic-artifact gate; unavailable local Docker
must not be bypassed with handwritten types.


## FIN-203 minimal invitation integration

The existing Hogar view hosts a small invitations component and strict application
DTO parsers. Narrow transactional RPCs own lifecycle and membership authorization;
no direct client table capability, dependency, realtime, email or privileged mobile
secret is added. Stable create UUID/payload and invitation/action identity for accept
and revoke survive in-session remounts in the auth-cleared QueryClient. Unknown results
retain the exact request and reconcile via fresh authorized metadata or replay.
Parent focus/background revalidation gates all invitation identity rendering; late
requests cannot recreate a cleared session cache. A real HTTP-to-production-parser
bridge and a separate controlled two-session harness complement SQL/RLS and UI tests.


## FIN-205 default-split integration

Hogar mounts one small default-split component per authorized household. Pure domain
validation reuses basis points; feature-local strict DTOs, React Hook Form/Zod and
TanStack Query reuse existing form/state patterns. The database owns optimistic
version checks, current-roster validation, atomic revision/entries and stable receipts.
No monetary allocation, dependency, realtime, generic repository or history UI is added.

Unconfigured and obsolete templates never prefill an implicit distribution. The owner
reviews explicit values and confirms before saving. Pending UUID/payload survives
in-session remount only in auth-cleared cache; network uncertainty never settles by
percentage equality. Retrying an old committed request confirms that receipt, then
refreshes the current version. Focus/background revalidation hides cached shares and
unmounts drafts; old-account responses cannot repopulate cleared data. A known roster/
version conflict discards the rejected request and requires a new explicit review.

## FIN-207 persistence-only boundary

ADR-082 resolves the initial shared-expense RPC implementation: an atomic trusted
create and one authorized point read, with strict feature-local DTO parsers and thin
Supabase adapters. FIN-206 validates returned historical responsibility independently
of SQL. No UI, cache/hook layer, generic repository, dependency or history feature is
added. The default-template identity/version/full roster belongs to the original
request; mutable current configuration is never a read/replay dependency.

Existing transactions remain the monetary source while new server-only header and
split tables preserve shared attribution. Scoped constraints explicitly evolve the
PERSONAL-only schema without rewriting existing rows, granting household access to
personal rows or feeding shared amounts into current personal read models. The
existing authenticated household HTTP/parser and controlled concurrency harnesses
are extended, rather than duplicating their setup or the complete personal suite.


## FIN-208 entry and receipt lifecycle

A small Hogar child uses RHF/Zod, FIN-206 calculation and the existing FIN-207 create/
point-read adapters. New writes re-read the active template before review and again
before confirmation. A changed template requires explicit review, never silent replay
with new values. The RPC independently enforces the same template and fixed household
currency under the existing lock protocol; its signature and grants do not change.

Account/household-scoped QueryClient state retains an exact submitted UUID/payload
through in-session remounts and uncertain results. Rapid taps cannot create concurrent
requests. A successful matching point read, not the create acknowledgement alone,
provides the displayed receipt. A failed read/retry never proves an uncertain original
write did not commit. Focus/background and parent refresh discard unsent drafts and
hide cached receipts until renewed access/readback; cleared cache identity prevents
late responses from reviving an earlier session. Process-restart recovery/offline
storage and a searchable expense history remain outside this bounded task.


## FIN-209 bounded read-only history

One stable, empty-search-path definer RPC returns a scalar JSON page of 1–50
expenses (client 20), ordered by financial date then UUID descending. A UUID cursor
must resolve to a live shared record in the requested, currently authorized household;
nonexistent, private and foreign cursors share one error. A same-snapshot detail
wrapper composes FIN-207's unchanged point DTO with FIN-202's existing authorized
member projection, narrowed to membership ID and display name. Both history reads
reject snapshot isolation. No financial table grants, personal RLS or write path changes.

Strict feature-local parsers reuse FIN-207's stored-split validation, reject whole
malformed pages and verify pagination continuity. Active roster names are presentation
only, never inputs to historical responsibility. Names refresh with each page/detail,
not from parent props; newly joined or departed identities do not change the snapshot.

TanStack Query keys isolate profile, household and detail identity. History opens on
request, refresh resets to the first page, and loading/error states hide cached values.
Hogar focus/background revalidation unmounts the history; cleanup aborts/removes its
queries and auth clearing prevents late-response resurrection. Only a verified FIN-208
receipt invalidates history; history cannot settle or discard an uncertain entry.
No new dependencies, realtime, persistent cache, generic repository or native redesign.
