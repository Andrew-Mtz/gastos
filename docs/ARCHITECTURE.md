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
The module has no React, Expo, Supabase, or other infrastructure dependencies.
Parsing, formatting, and percentage allocation remain separate from this primitive.

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

Percentages should use integer basis points.

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
budget_periods(profile_id, start_date)
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
owned by FIN-006. The new areas are placeholders without financial queries.

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

---

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
5. Exact transaction/RPC implementation for shared expenses.
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
