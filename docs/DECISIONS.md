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
* p…7241 tokens truncated…000002','2026-10-01','2026-10-31','USD',999999);
select is((select prosecdef from pg_proc where oid='public.register_income(uuid,uuid,bigint,text,date,text)'::regprocedure),false,'Registration is invoker');
select is((select prosecdef from pg_proc where oid='public.get_received_income(uuid)'::regprocedure),false,'Aggregate is invoker');
select ok(not has_function_privilege('anon','public.get_received_income(uuid)','EXECUTE'),'Anonymous aggregate denied');
select ok(not has_function_privilege('anon','public.register_income(uuid,uuid,bigint,text,date,text)','EXECUTE'),'Anonymous registration denied');
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(current_user::text,'authenticated','A client role');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'A subject');
select is(public.get_received_income('f1030000-0000-4000-8000-000000000001'),0::bigint,'Expected income is not received income');
select lives_ok($$select public.register_income('f1090000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001',100000,'USD','2026-10-01','Salary')$$,'Register actual income');
select is(public.get_received_income('f1030000-0000-4000-8000-000000000001'),100000::bigint,'Expected1500 received1000 example');
select set_config('test.income_created_at',(select created_at::text from public.transactions where id='f1090000-0000-4000-8000-000000000001'),true);
select lives_ok($$select public.register_income('f1090000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001',100000,'USD','2026-10-01','Salary')$$,'Identical retry succeeds');
select is((select count(*) from public.transactions),1::bigint,'Retry never duplicates money');
select is((select created_at from public.transactions where id='f1090000-0000-4000-8000-000000000001'),current_setting('test.income_created_at')::timestamptz,'Replay preserves timestamps');
select throws_ok($$select public.register_income('f1090000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001',99999,'USD','2026-10-01','Salary')$$,'23505',null,'Changed payload cannot reuse identity');
select lives_ok($$select public.register_income('f1090000-0000-4000-8000-000000000002','f1030000-0000-4000-8000-000000000001',43000,'USD','2026-10-15')$$,'Multiple incomes in one month');
select is(public.get_received_income('f1030000-0000-4000-8000-000000000001'),143000::bigint,'Actual amounts aggregate exactly');
select is((select expected_income_minor from public.budget_periods where id='f1030000-0000-4000-8000-000000000001'),150000::bigint,'Expected estimate remains unchanged');
select lives_ok($$insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date)
values('f0050000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001','SAVINGS_CONTRIBUTION',1234,'USD','2026-10-15')$$,'Non-income fixture');
select is(public.get_received_income('f1030000-0000-4000-8000-000000000001'),143000::bigint,'Non-income is excluded');
select lives_ok($$update public.transactions set deleted_at=now() where id='f1090000-0000-4000-8000-000000000001'$$,'Soft delete actual income');
select is(public.get_received_income('f1030000-0000-4000-8000-000000000001'),43000::bigint,'Deleted income is excluded');
select throws_ok($$select public.register_income('f1090000-0000-4000-8000-000000000001','f1030000-0000-4000-8000-000000000001',100000,'USD','2026-10-01','Salary')$$,'23505',null,'Replay cannot resurrect removed income');
select lives_ok($$update public.transactions set deleted_at=null where id='f1090000-0000-4000-8000-000000000001'$$,'Explicit restore');
select throws_ok($$select public.register_income('f1090000-0000-4000-8000-000000000003','f1030000-0000-4000-8000-000000000001',100,'UYU','2026-10-01')$$,'23514',null,'No implicit currency conversion');
select throws_ok($$select public.register_income('f1090000-0000-4000-8000-000000000003','f1030000-0000-4000-8000-000000000001',0,'USD','2026-10-01')$$,'23514',null,'Zero income denied');
select throws_ok($$select public.get_received_income('f1030000-0000-4000-8000-000000000002')$$,'42501',null,'A cannot read foreign aggregate');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000002');
select is(current_user::text,'authenticated','Negative client role 2');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000002'::uuid,'Negative subject 2');
select throws_ok($$select public.get_received_income('f1030000-0000-4000-8000-000000000001')$$,'42501',null,'Foreign aggregate denied 2');
select throws_ok($$select public.register_income('f1090000-0000-4000-8000-000000000003','f1030000-0000-4000-8000-000000000001',100,'USD','2026-10-01')$$,'42501',null,'Foreign registration denied 2');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000003');
select is(current_user::text,'authenticated','Negative client role 3');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000003'::uuid,'Negative subject 3');
select throws_ok($$select public.get_received_income('f1030000-0000-4000-8000-000000000001')$$,'42501',null,'Foreign aggregate denied 3');
select throws_ok($$select public.register_income('f1090000-0000-4000-8000-000000000003','f1030000-0000-4000-8000-000000000001',100,'USD','2026-10-01')$$,'42501',null,'Foreign registration denied 3');
reset role;
set local role authenticated;
select pg_temp.set_jwt_subject(null);
select is(auth.uid(),null::uuid,'No identity');
select throws_ok($$select public.get_received_income('f1030000-0000-4000-8000-000000000001')$$,'42501',null,'Missing identity denied');
reset role;
select pg_temp.set_jwt_subject(null);
update public.budget_periods set status='CLOSED',closed_at=now() where id='f1030000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select is(auth.uid(),'f0050000-0000-4000-8000-000000000001'::uuid,'A closed-period subject');
select is(public.get_received_income('f1030000-0000-4000-8000-000000000001'),143000::bigint,'Closed total readable');
select lives_ok($$select public.register_income('f1090000-0000-4000-8000-000000000002','f1030000-0000-4000-8000-000000000001',43000,'USD','2026-10-15')$$,'Closed identical replay is read-only');
select throws_ok($$select public.register_income('f1090000-0000-4000-8000-000000000003','f1030000-0000-4000-8000-000000000001',100,'USD','2026-10-01')$$,'42501',null,'Closed new income rejected');
reset role;
select pg_temp.set_jwt_subject(null);
update public.budget_periods set status='OPEN',closed_at=null where id='f1030000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.set_jwt_subject('f0050000-0000-4000-8000-000000000001');
select lives_ok($$select public.register_income('f1090000-0000-4000-8000-000000000003','f1030000-0000-4000-8000-000000000001',9007199254740991,'USD','2026-10-01')$$,'Large safe single income');
select throws_ok($$select public.get_received_income('f1030000-0000-4000-8000-000000000001')$$,'22003',null,'Aggregate overflow rejects rather than rounds');
reset role;
select * from finish();
rollback;
