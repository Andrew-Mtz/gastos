# Agent Development Instructions

**Version:** 0.1
**Status:** Active
**Last updated:** 2026-09-09

This file defines how coding agents must work in this repository.

It applies to Codex and any other coding agent used for implementation, investigation, refactoring, testing, or code review.

The purpose is to keep implementation aligned with the product, domain, security, architecture, and roadmap decisions already made.

---

# 1. Required Reading Before Work

Before implementing any non-trivial task, read:

1. `docs/PRODUCT.md`
2. `docs/DOMAIN.md`
3. `docs/SECURITY.md`
4. `docs/ARCHITECTURE.md`
5. `docs/DECISIONS.md`
6. `docs/ROADMAP.md`
7. this `AGENTS.md`

Do not assume repository conventions from previous projects.

Do not rely on memory if the current repository documentation says something different.

---

# 2. Source of Truth Order

When instructions conflict, use this priority:

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
↓
Existing implementation
```

Existing code is not automatically correct.

If existing implementation conflicts with a higher-level source of truth, report the conflict.

Do not silently adapt the requirement to match the current code.

---

# 3. Roadmap Scope Is Mandatory

Every implementation task should reference a roadmap ID such as:

```text
FIN-001
FIN-108
FIN-207
```

Implement only the assigned task.

Do not implement later roadmap features because they are easy, related, or already described in `PRODUCT.md`.

Example:

If assigned:

```text
FIN-111 — Register Personal Expense
```

do not also implement:

```text
FIN-112 — Personal Transaction History
FIN-113 — Bucket Consumption
FIN-114 — Protected Savings
```

unless explicitly requested.

---

# 4. Investigate Before Editing

For every non-trivial task, inspect the current repository before making changes.

Determine:

* current behavior;
* relevant files;
* existing patterns;
* relevant tests;
* relevant database schema;
* relevant RLS policies;
* relevant migrations;
* dependencies;
* whether the roadmap prerequisites are complete.

Do not begin by creating new files based only on the task title.

---

# 5. Pre-Implementation Report

Before modifying code for a non-trivial task, report:

```text
Task:
FIN-XXX — Task name

Current state:
...

Relevant files:
...

Planned changes:
...

Domain impact:
...

Database impact:
...

Security impact:
...

Tests required:
...

Open decisions/blockers:
...
```

Keep this concise but concrete.

Do not edit files until the investigation is complete unless the task is trivial and contains no meaningful uncertainty.

---

# 6. Open Decisions Must Not Be Guessed

The documentation contains explicit open decisions.

If implementation depends on one of them:

1. identify the decision;
2. explain why the task depends on it;
3. stop before making the assumption;
4. request a decision.

Do not choose what seems most convenient.

Examples:

* household invitation semantics;
* credit-card liability representation;
* fixed recurring expense auto-generation;
* exchange-rate provider;
* former household member access;
* settlement reversal permissions.

---

# 7. Do Not Redefine Product Behavior

Agents implement product decisions.

Agents do not independently redefine them.

Do not introduce behavior such as:

* automatic use of savings;
* different household splits;
* merged personal finances;
* automatic month closing;
* automatic budget reallocation;
* exposure of partner income;

unless explicitly defined in product/domain documentation.

If a requested task appears inconsistent with the product, report it.

---

# 8. Privacy Is a Hard Requirement

The most important privacy invariant is:

```text
A household member must never gain access to another member's personal financial data through household membership.
```

This includes:

* tables;
* queries;
* views;
* RPC functions;
* Edge Functions;
* realtime;
* reports;
* client caches;
* assistant responses;
* future Siri operations.

A feature that violates this is invalid even if the UI appears correct.

---

# 9. Never Treat UI Filtering as Security

Forbidden reasoning:

```text
The screen only requests the current user's records, so access is safe.
```

The database must enforce authorization.

For personal financial data:

```text
owner only
```

For household financial data:

```text
authorized active household members only
```

Use RLS and trusted validation as required.

---

# 10. RLS Requirements

When introducing or modifying a financial table, inspect:

* `SELECT`;
* `INSERT`;
* `UPDATE`;
* `DELETE`;

authorization separately.

Verify:

* RLS is enabled;
* ownership cannot be forged;
* household scope cannot be forged;
* unauthorized users receive no access;
* household membership does not grant personal access.

New privacy-sensitive tables require RLS tests.

---

# 11. Negative Security Testing Is Mandatory

Do not only test that authorized access works.

Also prove that unauthorized access fails.

At minimum, relevant tests should include combinations of:

```text
User A
User B in same household
Unrelated User C
```

Example:

```text
A can read A's transaction.
B cannot read A's personal transaction.
C cannot read A's personal transaction.

A and B can read household expense H.
C cannot read household expense H.
```

---

# 12. Never Ship Privileged Secrets to the Client

The mobile app must never contain:

* Supabase service-role key;
* private AI provider key;
* private webhook secrets;
* private server credentials.

Anything bundled in the mobile application must be assumed discoverable.

Use trusted backend infrastructure for privileged operations.

---

# 13. Database Changes Require Migrations

All schema changes must be represented under:

```text
supabase/migrations/
```

This includes:

* tables;
* columns;
* constraints;
* indexes;
* RLS;
* PostgreSQL functions;
* triggers.

Do not rely on manual dashboard changes.

If a manual environment change is required temporarily, document it and create the equivalent migration before completion.

---

# 14. Generated Supabase Types

If a schema change affects generated database types:

1. regenerate the types;
2. commit the changes;
3. include them in the same PR where practical.

Do not manually modify generated types to make TypeScript pass.

---

# 15. Financial Arithmetic Rules

Never use floating-point arithmetic as authoritative financial logic.

Do not implement:

```ts
const userShare = total * 0.7;
```

for persisted financial values.

Use the domain money and percentage abstractions.

Authoritative monetary values use:

```text
amountMinor
currency
```

Authoritative percentages use:

```text
basis points
```

Example:

```text
70% = 7000
```

---

# 16. Safe Integer Requirement

Initial TypeScript money representation uses JavaScript `number`.

Monetary minor units must remain safe integers.

Validate where appropriate:

```ts
Number.isSafeInteger(amountMinor)
```

Do not mix `number` and `bigint` without an explicit ADR update.

---

# 17. Deterministic Rounding

Percentage allocation must use the accepted deterministic largest-remainder strategy.

The result must always satisfy:

```text
sum(split amounts) = source amount
```

Never allow a one-cent/peso discrepancy because of independent rounding.

Do not invent a different rounding strategy inside individual features.

---

# 18. Payer Is Not Responsibility

For shared expenses:

```text
payer
```

and:

```text
responsibility
```

are separate concepts.

Never infer one from the other.

Example:

```text
Expense = 1000
User A responsibility = 700
User A paid = 1000
```

means:

```text
cash impact = -1000
budget impact = -700
receivable = +300
```

---

# 19. Cash Impact and Budget Impact Must Remain Separate

Do not simplify these concepts into one generic amount.

Cash impact answers:

```text
How much money actually moved?
```

Budget impact answers:

```text
How much of this operation economically belongs to the user?
```

They may differ.

This distinction is fundamental to household accounting.

---

# 20. Savings Must Never Be Consumed Implicitly

If a spendable bucket is exhausted:

```text
remaining = negative
```

or the user must explicitly reallocate/withdraw money.

Do not silently:

* take money from savings;
* move money between buckets;
* modify percentages.

An explicit savings withdrawal is a separate financial action.

---

# 21. Do Not Double Count Transactions

Not every money movement is a new expense.

Examples:

```text
credit card purchase → expense
credit card statement payment → not another expense

account transfer → not expense
household settlement → not expense
```

When introducing a financial operation, explicitly state its:

* cash impact;
* budget impact;
* spending impact;
* savings impact.

---

# 22. Recurring Templates Are Not Actual Expenses

A recurring expense definition is expected future activity.

It is not automatically a transaction unless the feature explicitly defines generation behavior.

For variable expenses:

```text
template
↓
actual amount entered
↓
expense created
```

Do not count estimated values as actual spending.

---

# 23. Preserve Historical Meaning

Never derive historical financial responsibility solely from current configuration.

Examples that must remain historically stable:

* previous budget percentages;
* previous household expense splits;
* original transaction currency;
* historical exchange-rate snapshots;
* closed-period configuration.

Changing a default must affect future records only unless explicitly specified.

---

# 24. Closed Periods

A closed financial period must not be edited through normal mutation paths.

Editing requires explicit reopening.

Do not bypass this rule to simplify update code.

---

# 25. Soft Delete Financial Records

Where current domain documentation specifies soft deletion:

```text
deleted_at
```

must be respected.

Deleted records must stop participating in normal financial calculations.

Do not replace soft delete with physical deletion without an explicit decision.

---

# 26. Keep Domain Logic Out of React Components

React components must not contain authoritative business calculations.

Bad:

```ts
const remaining = income * 0.5 - expenses;
```

Better:

```ts
const result = calculateRemainingBudget(...);
```

or invoke an application use case which uses the domain layer.

UI responsibilities:

* collect input;
* show state;
* invoke operations;
* render results.

---

# 27. Domain Must Not Depend on Infrastructure

Code under domain must not import:

* Supabase;
* React;
* React Native;
* Expo Router;
* AI SDKs;
* platform APIs.

Domain code should be runnable in isolated unit tests.

---

# 28. Use Existing Application Use Cases

Before creating a new path to modify financial data, check whether an application use case already exists.

Future interfaces:

```text
UI
Voice
Assistant
Siri
```

must converge on shared use cases.

Do not create duplicate financial implementations for different entry methods.

---

# 29. AI Is Untrusted Input

Future AI output must be treated like any other external input.

AI may produce:

```json
{
  "action": "create_expense",
  "amountMinor": 80000,
  "currency": "UYU"
}
```

This still requires:

* schema validation;
* authorization;
* domain validation;
* persistence checks.

AI must never directly execute arbitrary SQL or write unrestricted financial records.

---

# 30. Prefer the Smallest Correct Implementation

Do not overengineer for features several phases away.

Avoid introducing:

* generic framework layers;
* unnecessary factories;
* complex dependency injection;
* abstract repositories with no real value;
* event buses;
* microservices;
* offline synchronization;
* realtime;

unless required by the assigned task.

Future-proof only where current domain invariants clearly require it.

---

# 31. Do Not Create Empty Architecture for Appearance

Do not create:

```text
20 empty folders
15 unused interfaces
generic BaseRepository
AbstractFinancialService
```

just because the architecture document describes conceptual layers.

Create structure as real functionality requires it.

---

# 32. Prefer Existing Patterns

When the repository already has a valid pattern:

* inspect it;
* reuse it;
* keep consistency.

Do not introduce a second competing approach without explaining why the existing pattern is insufficient.

Examples:

* query hooks;
* mutation hooks;
* domain errors;
* schema validation;
* repository modules;
* UI components.

---

# 33. Do Not Preserve a Bad Pattern Just Because It Exists

Existing code is evidence, not authority.

If an existing pattern violates:

* product;
* domain;
* security;
* architecture;
* accepted ADRs;

report the discrepancy.

Do not replicate a known bad pattern for consistency.

---

# 34. Atomic Operations

If one logical financial operation requires multiple dependent writes and partial persistence would create invalid state, make it atomic.

Example:

```text
CreateSharedExpense
```

may require:

```text
transaction
+
shared expense
+
split rows
```

Do not perform these as unsafe independent client calls.

Use an appropriate transactional mechanism.

---

# 35. RPC vs Edge Function

Prefer PostgreSQL RPC for:

* database-centric operations;
* atomic multi-row writes;
* operations that do not need external secrets.

Prefer Edge Functions for:

* AI providers;
* external APIs;
* private server credentials;
* webhook-like workflows;
* non-database trusted orchestration.

Do not use Edge Functions as a generic proxy for simple RLS-protected CRUD.

---

# 36. `SECURITY DEFINER` Requires Explicit Review

Do not casually create PostgreSQL `SECURITY DEFINER` functions.

If necessary, explain:

* why invoker security is insufficient;
* which elevated capability is needed;
* how `auth.uid()` is validated;
* how household membership is validated;
* how `search_path` is secured;
* why privilege escalation is impossible.

---

# 37. Direct Supabase Access Is Allowed When Safe

Client-to-Supabase CRUD is acceptable when:

* RLS fully protects it;
* the operation is simple;
* no privileged credentials are required;
* atomic multi-row behavior is not required.

Do not create backend indirection solely to make the project appear more layered.

---

# 38. Server State vs Local State

Use TanStack Query for persisted/server state.

Use Zustand only for appropriate local state.

Do not mirror the same financial dataset into both systems.

Examples:

```text
transactions → TanStack Query
temporary modal state → local state/Zustand
```

---

# 39. Clear User Data on Logout

When authentication changes, make sure:

* Supabase session state is cleared;
* TanStack Query user-specific cache is cleared;
* user-specific Zustand state is reset;
* stale personal financial screens cannot remain visible.

This is a security requirement.

---

# 40. Validate External Data

Use Zod or equivalent explicit parsing at boundaries.

Untrusted inputs include:

* forms;
* deep links;
* Supabase rows when mapping requires assumptions;
* assistant output;
* Siri parameters;
* voice transcription;
* RPC input;
* external providers.

Do not use unchecked type casts to make data appear valid.

---

# 41. Avoid `any`

TypeScript strict mode is required.

Avoid:

```ts
any
```

unless a specific external interoperability case requires it.

If `any` is necessary, constrain it at the boundary and document why.

Do not let `any` propagate through domain code.

---

# 42. Errors Must Be Meaningful

Do not expose raw infrastructure errors directly to UI.

Prefer meaningful categories such as:

```text
ValidationError
AuthorizationError
DomainError
NotFoundError
ConflictError
InfrastructureError
```

Retain enough technical information for debugging without leaking sensitive data.

---

# 43. Logging Must Minimize Sensitive Data

Do not routinely log:

* salaries;
* account balances;
* complete transaction descriptions;
* auth tokens;
* refresh tokens;
* AI secrets;
* full financial histories.

Prefer:

```text
transactionId
operation type
error code
householdId when needed
```

Only include sensitive financial values when genuinely necessary for a trusted debugging context.

---

# 44. Do Not Add Dependencies Casually

Before adding a new dependency, determine:

* why it is required;
* whether existing tools already solve the problem;
* Expo compatibility;
* maintenance status;
* native implications;
* bundle impact.

Mention material new dependencies in the implementation report.

Do not add libraries for trivial helpers.

---

# 45. Framework Versions

Do not independently upgrade:

* Expo;
* React Native;
* React;
* Expo Router;
* Supabase major versions;

inside unrelated feature tasks.

Framework upgrades require dedicated work.

---

# 46. Testing Expectations

For every business-rule implementation, write tests for behavior rather than implementation details.

Prefer:

```text
given / when / then
```

style reasoning.

Important areas:

* money arithmetic;
* percentage allocation;
* rounding;
* budget consumption;
* savings protection;
* shared expense splits;
* household balances;
* authorization.

---

# 47. Do Not Modify Tests Just to Make Them Pass

When an existing test fails after a change:

1. determine whether behavior intentionally changed;
2. compare against documentation;
3. fix code if the existing expectation is still correct;
4. change the test only when the expected behavior itself legitimately changed.

Do not weaken assertions without explanation.

---

# 48. No Broad Refactors During Feature Tasks

Do not perform large unrelated refactors while implementing a small FIN task.

If a refactor is necessary:

* explain why;
* limit it to the minimum required;
* separate it where practical.

PRs should remain reviewable.

---

# 49. Do Not Reformat Unrelated Files

Avoid large formatting-only diffs.

Only touch files related to the task unless a tooling change explicitly requires broader updates.

---

# 50. Git Workflow

Work should generally occur on:

```text
feature/FIN-XXX-short-description
```

Do not push implementation directly to `main`.

Do not rewrite unrelated history.

Do not force-push unless explicitly instructed and safe.

---

# 51. Commit Strategy

Prefer focused commits.

Good examples:

```text
FIN-101 add money domain primitives
FIN-101 add money validation tests
```

Avoid vague messages:

```text
fix stuff
updates
changes
```

Do not include unrelated files in a task commit.

---

# 52. PR Expectations

A PR should contain:

```text
Task
Summary
Implementation
Database changes
Security impact
Tests
Open issues / follow-ups
```

Do not describe unimplemented future features as part of the completed PR.

---

# 53. Post-Implementation Report

After implementation, provide:

```text
Implemented:
...

Files changed:
...

Database changes:
...

Security considerations:
...

Tests added/updated:
...

Commands run:
...

Known limitations:
...

Out of scope:
...
```

Also explicitly state whether:

```text
typecheck passed
lint passed
tests passed
```

Do not claim a command passed if it was not run.

---

# 54. Report Failures Explicitly

If a command fails:

* report the command;
* report the relevant error;
* investigate;
* do not hide the failure.

If the failure is pre-existing and unrelated, provide evidence.

Do not simply say:

```text
tests mostly pass
```

---

# 55. Never Claim Verification Without Evidence

Do not say:

```text
RLS is secure
the feature works
all tests pass
```

unless you actually verified the relevant behavior.

Use precise language:

```text
I verified A and B.
C was not run because...
```

---

# 56. When Asked to Investigate Only, Do Not Modify Files

If the task says:

```text
investigate
analyze
trace
review
```

do not make code changes unless explicitly requested afterward.

Return findings and recommended next step.

---

# 57. When Asked to Implement, Still Investigate First

An implementation request does not mean immediately editing.

First understand:

* current state;
* callers;
* dependencies;
* security;
* tests.

Then implement.

---

# 58. Avoid Defensive Code Without Evidence

Do not add duplicate fallbacks or broad defensive branches simply because an edge case is imaginable.

Prefer:

* identifying actual lifecycle;
* fixing the true ownership/source-of-truth problem;
* using existing invariants.

Defensive code is appropriate when the failure mode is real and the fallback has clearly defined semantics.

---

# 59. Trace End-to-End for Non-Trivial Financial Flows

For flows spanning several layers, inspect the complete path.

Example:

```text
UI
↓
form schema
↓
mutation/use case
↓
domain
↓
repository/RPC
↓
PostgreSQL
↓
RLS/constraints
↓
query refresh
↓
UI
```

Do not patch only the first visible failure without understanding the full flow.

---

# 60. Distinguish Persisted State from Fallback State

When reading financial state, identify:

* authoritative persisted source;
* cached representation;
* calculated fallback;
* display-only default.

Do not accidentally persist fallback/display values as authoritative data.

---

# 61. Realtime Requires Lifecycle Review

If realtime is introduced, inspect:

* publisher;
* subscriber;
* authorization;
* cache integration;
* subscription lifetime;
* cleanup/unsubscribe;
* reconnection behavior.

Do not add a realtime listener and consider the feature complete.

---

# 62. Do Not Add Realtime for Convenience

If query invalidation/refetching solves the task adequately, prefer it.

Realtime requires explicit product value.

---

# 63. Avoid Silent Data Migrations

If schema semantics change, determine whether existing data requires:

* migration;
* backfill;
* transformation;
* compatibility handling.

Do not change how a field is interpreted while leaving old records ambiguous.

---

# 64. Preserve User Corrections

Financial corrections should not silently destroy history where domain rules require soft delete or explicit reopening.

When implementing editing/deletion, check:

* effect on calculations;
* effect on closed periods;
* effect on shared balances;
* effect on related records.

---

# 65. Currency Rules

Never add or subtract money with different currencies without explicit conversion.

Bad:

```text
USD 10 + UYU 400
```

Good:

```text
convert using explicit historical/current rate
then aggregate in reporting currency
```

If conversion behavior is not yet defined for the task, identify it as an open decision.

---

# 66. Dates and Timezones

Keep separate:

```text
financial transaction date
record creation timestamp
```

Use user financial timezone for period semantics.

Do not classify monthly transactions purely using raw UTC boundaries.

---

# 67. IDs Are Not Authorization

UUIDs should still be treated as public identifiers from a security perspective.

Never rely on:

```text
Nobody can guess this ID.
```

Always enforce authorization.

---

# 68. Household Membership Validation

Whenever a shared operation references a profile:

* verify that profile belongs to the relevant household;
* do not trust client-provided membership information.

This applies to:

* payer;
* split participants;
* settlement sender;
* settlement recipient;
* shared savings contributor.

---

# 69. Scope Fields Are Sensitive

Fields such as:

```text
owner_profile_id
household_id
scope
```

define authorization boundaries.

Do not allow arbitrary updates to them.

Moving a record between scopes should require an explicit supported business operation, if ever allowed.

---

# 70. Derived Values

Do not persist values such as:

```text
remaining budget
safe-to-spend
household balance
monthly spending
```

solely for display convenience unless explicitly required by an ADR or current task.

Prefer deterministic derivation.

---

# 71. Performance Comes After Correctness

Do not denormalize financial data without evidence.

If performance becomes a problem:

1. measure;
2. identify the bottleneck;
3. preserve correctness;
4. document the architectural change.

---

# 72. Comments

Comments should explain:

* non-obvious financial rules;
* security-sensitive reasoning;
* unusual platform constraints.

Do not write comments that merely restate code.

Good:

```ts
// Store the rounded responsibility so later household split changes
// cannot alter historical debt.
```

Bad:

```ts
// Set amount.
amount = value;
```

---

# 73. TODOs

Do not leave vague TODOs.

Bad:

```text
TODO fix later
```

Better:

```text
TODO(FIN-214): settlement reversal behavior is intentionally deferred.
```

Use roadmap IDs when possible.

---

# 74. No Speculative Features

Do not implement:

* bank synchronization;
* crypto;
* investment tracking;
* web application;
* advanced analytics;
* notifications;
* offline sync;
* AI;
* Siri;

before their roadmap phase unless explicitly requested.

---

# 75. Stop Conditions

Stop implementation and report before proceeding if:

* documentation conflicts materially;
* an open domain decision is required;
* an authorization model is unclear;
* the task would require weakening RLS;
* a financial calculation is ambiguous;
* an unrelated major refactor appears necessary;
* a new significant dependency/architecture is required;
* roadmap prerequisites are missing.

Do not solve uncertainty by guessing.

---

# 76. Minor Ambiguity Rule

Not every tiny implementation detail requires interruption.

Agents may choose ordinary implementation details when they:

* do not change product behavior;
* do not alter financial semantics;
* do not alter security;
* do not create a new architecture decision;
* are easily reversible.

Examples:

```text
local variable naming
small file organization
test helper naming
internal component extraction
```

Use judgment.

---

# 77. Review Your Own Diff

Before completing a task:

1. inspect `git diff`;
2. inspect `git status`;
3. remove accidental changes;
4. verify no secrets were added;
5. verify no unrelated files changed;
6. verify generated files are intentionally included.

Do not rely only on test output.

---

# 78. Secret Review

Before every push/PR, inspect for:

* `.env`;
* private keys;
* tokens;
* service-role keys;
* AI credentials;
* signing credentials.

If a secret was committed, report it immediately.

Do not assume deleting it from the latest commit is sufficient if it entered Git history.

---

# 79. Final Task Checklist

Before marking a task complete, answer:

```text
[ ] Did I implement only the assigned FIN task?
[ ] Did I read relevant docs?
[ ] Did I inspect existing implementation first?
[ ] Are domain invariants preserved?
[ ] Is financial arithmetic deterministic?
[ ] Is privacy enforced at the data layer?
[ ] Are database changes migrated?
[ ] Are generated types updated if needed?
[ ] Are authorized cases tested?
[ ] Are unauthorized cases tested where relevant?
[ ] Did typecheck pass?
[ ] Did lint pass?
[ ] Did tests pass?
[ ] Did I inspect the final diff?
[ ] Did I avoid unrelated changes?
[ ] Did I document any new decision?
```

If an applicable item is not satisfied, explain why.

---

# 80. Guiding Principle

The preferred implementation is:

> the smallest implementation that is demonstrably correct, secure, testable, and consistent with the current roadmap.

Do not optimize for amount of code produced.

Optimize for confidence that the financial behavior is correct.
