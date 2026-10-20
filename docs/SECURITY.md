# Security Specification

**Version:** 0.1
**Status:** Active
**Last updated:** 2026-09-09

This document defines the security, authorization, privacy, and data-access requirements of the application.

It complements:

* `PRODUCT.md`
* `DOMAIN.md`

Security requirements in this document are mandatory.

If an implementation is functionally correct but violates these security rules, the implementation is invalid.

---

# 1. Security Goals

The application must protect:

* personal financial information;
* household financial information;
* authentication state;
* authorization boundaries;
* shared-expense visibility;
* savings information;
* financial history;
* assistant and voice-triggered operations;
* privileged backend operations;
* database credentials and service keys.

The most important security property is:

> Household membership must never expose another member's personal financial data.

---

# 2. Security Model

The application uses a layered security model.

```text
Client
↓
Authentication
↓
Authorization
↓
Supabase Data API / RPC / Edge Functions
↓
PostgreSQL Row Level Security
↓
Database constraints
```

Client-side checks improve UX.

They are not trusted security boundaries.

The database and trusted backend layers must enforce authorization.

---

# 3. Authentication

Authentication is handled through Supabase Auth.

Every authenticated user receives an immutable Supabase Auth user identifier.

Conceptually:

```text
auth.users.id
```

The application's `Profile` references this identity.

Example:

```text
Profile.id = auth.users.id = auth.uid()
```

---

# 4. Authentication Requirements

The application must:

* require authentication for private financial data;
* never trust a user identifier sent by the client as proof of identity;
* derive current identity from the authenticated session;
* prevent unauthenticated access to protected data;
* invalidate protected operations when authentication expires.

The client must not be able to impersonate another user by changing:

```text
profileId
ownerProfileId
createdBy
```

in a request.

---

# 5. Authorization Source of Truth

Authorization must be based on:

* `auth.uid()`;
* profile ownership;
* valid household membership;
* explicit household roles where relevant;
* database policies.

Do not authorize based on:

* hidden UI controls;
* route names;
* locally stored profile IDs;
* user-submitted email addresses;
* client-generated booleans such as `isOwner`;
* assumptions that the mobile app cannot be modified.

---

# 6. Row Level Security

RLS must be enabled on every table containing user-specific or household-specific data unless there is an explicitly documented reason not to.

Examples include:

```text
profiles
households
household_members
budget_periods
budget_allocations
categories
transactions
recurring_expenses
shared_expenses
shared_expense_splits
savings_goals
savings_contributions
settlements
financial_accounts
```

A table containing financial information without RLS is considered insecure by default.

---

# 7. Default-Deny Principle

RLS design should follow:

> Deny access unless a policy explicitly allows it.

Do not create overly broad policies first and then attempt to restrict them in the application.

Example of an unacceptable pattern:

```sql
USING (true)
```

for financial tables.

Any `USING (true)` or similarly broad access policy requires explicit review and justification.

---

# 8. Personal Data Access

A user may read personal data only when that record belongs to their profile.

Conceptually:

```text
record.ownerProfileId
→ Profile.id
→ auth.uid()
```

Required rule:

```text
current authenticated user owns the record
```

Household membership must not satisfy this requirement.

---

# 9. Personal Data Write Access

A user may create, update, or delete personal records only for themselves.

The client must not be allowed to create:

```text
ownerProfileId = another user's profile ID
```

even if that user belongs to the same household.

For insert operations, ownership should preferably be derived or validated against `auth.uid()`.

---

# 10. Household Data Access

A user may access household-scoped information only if they are an active member of that household.

Conceptually:

```text
exists HouseholdMember
where:
householdId = record.householdId
and profile.id = auth.uid()
and membership is active
```

This membership check must occur at the database authorization layer.

---

# 11. Household Membership Is Not Personal Authorization

The following logic is forbidden:

```text
if users share a household
    allow access to both users' records
```

Correct logic:

```text
personal record:
    owner only

household record:
    active household members
```

These authorization paths must remain separate.

---

# 12. Scope Integrity

Records using personal/household scope must enforce scope consistency.

Conceptually:

```text
PERSONAL:
ownerProfileId != null
householdId == null

HOUSEHOLD:
ownerProfileId == null
householdId != null
```

Invalid combinations must be rejected.

Examples of invalid records:

```text
scope = PERSONAL
ownerProfileId = null
```

```text
scope = PERSONAL
householdId = household123
```

```text
scope = HOUSEHOLD
ownerProfileId = profile123
```

---

# 13. Profile Visibility

For FIN-005, `profiles` is private: authenticated users may select, insert, and
update only their own Profile. Anonymous access and direct client Profile deletion
are unavailable. Column privileges restrict client inserts to identity and initial
preferences, and updates to display name, base currency, and timezone. Clients
cannot update identity or server-maintained timestamps.

A profile should expose the minimum information necessary to other authorized users.

Household members may need to see:

* display name;
* avatar;
* household-relevant identifier.

They must not gain access to:

* private preferences unrelated to the household;
* personal financial settings;
* base financial information unless intentionally shared;
* personal financial aggregates.

Consider separating:

```text
private profile data
```

from:

```text
household-visible identity data
```

if necessary.

---

# 14. Household Membership Data

Household members may see membership information for their household.

Example:

```text
member name
role
join status
default split
```

They must not use membership APIs to discover arbitrary application users.

Search or invitation flows must avoid becoming user-enumeration mechanisms.

---

# 15. Household Invitations

Invitation behavior is not fully defined yet.

When implemented, invitations must:

* use unpredictable identifiers or trusted auth mechanisms;
* expire where appropriate;
* prevent unauthorized acceptance;
* prevent acceptance by unintended users when identity is known;
* avoid leaking whether arbitrary emails are registered;
* validate membership before creating access.

Invitation tokens must not contain sensitive information.

---

# 16. Shared Expense Authorization

A user may create a shared expense only in a household where they are an active member.

A user must not be able to:

* assign the expense to another household;
* use non-members as payers;
* create split rows for non-members;
* modify shared expenses belonging to unrelated households.

---

# 17. Shared Expense Split Authorization

All profiles referenced by a shared expense split must belong to the same household as the expense.

This must be validated by trusted logic.

A malicious client must not be able to submit:

```text
household A expense
+
profile from household B
```

---

# 18. Payer Validation

A payer on a household expense must be an authorized household member at the relevant time.

The client cannot be trusted to submit an arbitrary payer profile ID.

Where possible, use:

* membership validation;
* foreign-key relationships;
* trusted database functions;
* transaction-safe checks.

---

# 19. Settlement Authorization

A settlement may only involve members of the relevant household.

Required conditions:

```text
fromProfileId belongs to household
toProfileId belongs to household
fromProfileId != toProfileId
```

The user creating the settlement must also have permission to record it.

Exact rules for whether either member can record a settlement should be defined before implementation.

---

# 20. Savings Security

Personal savings information must remain private.

This includes:

* balances;
* goals;
* contributions;
* withdrawals;
* savings history.

Household savings may be visible only to members of that household.

A user must not be able to convert a personal savings goal into household-visible data merely by modifying IDs from the client.

---

# 21. Budget Security

Personal budget information is strictly private.

Household members must not see:

* income;
* allocation percentages;
* budget limits;
* bucket spending;
* remaining personal budget;
* safe-to-spend values;
* projected personal spending.

A shared expense may expose only the household data necessary to understand that expense.

FIN-103 budget periods are private personal records. Authenticated users may
select and insert only rows whose `profile_id` equals `auth.uid()`. They may update
only `expected_income_minor` on their own `OPEN` rows; ordinary updates to
`CLOSED` rows are excluded by RLS. Household membership grants no access.

SQL column grants separately prevent clients from changing ownership, calendar
boundaries, the historical currency snapshot, lifecycle state, or server-managed
timestamps. No anonymous access, client DELETE grant, or DELETE policy exists.

FIN-104 budget buckets use the same personal owner boundary for active and
archived rows. Authenticated clients may insert only `profile_id`, `name`, and
`type` for themselves. They may update only `name` and `archived_at` on their own
non-system buckets. Both UPDATE policy clauses validate ownership and non-system
provenance. The database supplies archive timestamps and preserves them across
repeated archive requests. Ownership, identity, type, system provenance, and
creation/update timestamps cannot be forged or reassigned through client column
grants. No anonymous access, DELETE grant/policy, or TRUNCATE grant exists.

FIN-105 allocations inherit ownership from their period, not from a client-supplied
profile or household. SELECT includes active and removed owner rows; INSERT and
UPDATE require an owned `OPEN` period and a same-owner bucket. Column grants prevent
reassigning the allocation identity, period or bucket and forging technical
timestamps. New/restored references require a non-archived bucket. No anonymous,
physical DELETE, or TRUNCATE access is granted.

`save_budget_allocations` accepts one complete set and runs as SECURITY INVOKER;
it has no elevated privileges, uses an empty search path, and explicitly checks
`auth.uid()` and period ownership. Direct writes obey the same RLS, row checks and
deferred 10000-basis-point invariant. Parent-period row locking serializes saves
with each other and lifecycle writes at the enforced `READ COMMITTED` isolation;
snapshot-isolated writes are rejected. Failed replacements roll back as one
operation. Removed rows remain private and recoverable, but a restore UI and
account-deletion policy are not part of this task.

FIN-106's `prepare_initial_budget_buckets` is a deliberately narrow SECURITY
DEFINER function: invoker grants cannot provision protected system rows. It
accepts no arguments, requires a non-null `auth.uid()` and its existing profile,
locks that profile, inserts only three fixed system definitions, and returns
only that owner's keyed rows. It uses an empty search path, qualified references,
no dynamic SQL, and no client-selected ownership, names, types, or permissions.
Only authenticated callers receive EXECUTE. A unique owner/key index prevents
duplicate defaults. Clients receive no INSERT/UPDATE grant for `system_key`.

`save_initial_budget` remains SECURITY INVOKER and composes FIN-105's atomic save
under existing RLS, grants and constraints. It validates exactly three distinct
owned default references, locks the canonical personal month, rejects closed
periods or currency mismatch, and never replaces an existing different plan.
Identical retries preserve identities and timestamps. The client cancels private
reads through TanStack Query, isolates keys by owner/month, and checks current
identity and focus revision before showing asynchronous results.

---

FIN-107 categories use owner-only SELECT/INSERT/UPDATE policies, with no anonymous,
DELETE or TRUNCATE access. Column grants prevent reassigning ownership or the
historical bucket mapping, forging system provenance or technical timestamps.
A composite foreign key also enforces same-owner bucket relations independently
of RLS. New mappings require an active owned bucket. Archive/restore retains
private history; system categories are read-only to clients. The timestamp trigger
is SECURITY INVOKER with an empty search path and no direct client EXECUTE grant.

FIN-108 transactions enforce owner-only access, personal-only scope and composite
same-owner period/category foreign keys. Clients cannot overwrite immutable
financial fields or timestamps, physically delete or truncate records. An invoker
trigger locks an owned open period under READ COMMITTED before writes and checks
financial date bounds, income currency, and active category references on insert
or restore. Closed periods retain private read access but no ordinary mutation.
No service role, definer function or production operation is introduced.

FIN-109 `register_income` and `get_received_income` are authenticated-only SECURITY
INVOKER RPCs with empty search paths. Registration derives ownership from auth.uid()
and relies on FIN-108 constraints/RLS/period locking. Stable UUID replay validates
the entire existing payload without modifying it; a closed-period replay is only a
read. The aggregate checks owned period access, excludes deleted/non-income rows,
and rejects mixed currency or unsafe sums. Income queries use owner/month keys and
cancellable reads; late writes cannot populate a different authenticated identity.

FIN-110 consumes the same invoker aggregate without broadening database access.
Derived bucket amounts remain scoped to the authenticated profile and period in
query keys. The auth boundary clears private queries; changing owner/period never
reuses another key's values. Pending/error refreshes hide actual figures rather
than substituting expected income. No household visibility or elevated key is added.

FIN-111 adds authenticated-only invoker expense registration with an empty search
path. Ownership derives from auth.uid(); existing period locks, grants and RLS
remain authoritative. A write trigger also enforces same-period currency and
active owned spendable-category mapping on direct inserts/restores. Exact replay
never mutates history, including closed months. Category creation uses the existing
owner-only table grants. Client reads are cancellable and owner/month scoped;
pending financial request identity survives tab navigation, not process restart.

FIN-113's consumption RPC is authenticated-only SECURITY INVOKER with an empty
search path and explicit owned-period lookup using `auth.uid()`. Source-table RLS
and existing grants are unchanged; archived classifications remain owner-only.
The aggregate accepts no owner override, writes no rows, and exposes only the
caller's complete period consumption. Invalid legacy classifications/currencies
and unsafe sums produce explicit errors instead of partial financial results.
SQL tests exercise real owner, partner-persona, unrelated, anonymous and missing
identity access; household membership itself remains a later-phase feature.

# 22. Avoiding Indirect Privacy Leaks

Authorization must consider derived information, not just raw rows.

A system is still insecure if it hides transactions but exposes:

```text
total monthly income
personal savings rate
personal leisure budget
personal safe-to-spend
personal account balance
```

through:

* database views;
* RPC functions;
* reports;
* realtime events;
* assistant responses;
* analytics APIs.

Derived financial data follows the same ownership rules as its source data.

---

# 23. Database Views

Views containing user financial information require the same security review as tables.

Do not assume that underlying table RLS automatically makes every view safe.

Any view must explicitly preserve authorization boundaries.

Security-definer behavior must be reviewed carefully.

---

# 24. PostgreSQL Functions / RPC

Database functions can bypass normal assumptions if implemented incorrectly.

Any RPC handling financial data must define:

* who may invoke it;
* what identity it uses;
* whether it runs as invoker or definer;
* how household membership is validated;
* whether user-controlled IDs are trusted.

Prefer security-invoker behavior unless elevated privileges are required.

---

# 25. Security Definer Functions

`SECURITY DEFINER` functions must be used sparingly.

If one is necessary:

* document why;
* explicitly set a safe `search_path`;
* validate `auth.uid()`;
* validate ownership/membership internally;
* expose only the minimum operation required;
* never accept a target user ID and blindly trust it.

Every `SECURITY DEFINER` function requires explicit security review.

---

# 26. Service Role Key

The Supabase service-role key has elevated privileges and bypasses RLS.

Therefore:

> The service-role key must never exist in the mobile application.

It must not be included in:

* React Native environment variables shipped to clients;
* Expo public config;
* JavaScript bundles;
* repository secrets visible to clients;
* app configuration files.

Service-role operations belong only in trusted server-side environments.

---

# 27. Client Keys

Only keys explicitly intended for public/client use may be bundled into the application.

Public Supabase configuration does not replace RLS.

The assumption must always be:

> Any value shipped in the mobile application can be discovered by the user.

---

# 28. Environment Variables

Secrets must not be committed to Git.

Use appropriate local and CI secret storage.

Examples of secrets:

* service-role keys;
* AI provider API keys;
* private webhook secrets;
* signing secrets;
* third-party private API credentials.

Client-safe configuration must be clearly distinguished from server secrets.

---

# 29. Repository Security

The repository must include:

```text
.env.example
```

with placeholders only.

Files such as:

```text
.env
.env.local
*.pem
*.p12
service-account.json
```

must not be committed.

The `.gitignore` must be reviewed before the first push.

---

# 30. AI Provider Security

Future AI functionality must not expose private service credentials in the mobile client.

The mobile application must not call an AI provider using a private provider API key embedded in the app.

AI requests requiring private credentials must pass through a trusted backend layer such as:

* Supabase Edge Function;
* dedicated backend service.

---

# 31. AI Data Minimization

When AI features are introduced, send only the minimum financial information required for the specific operation.

Example:

For:

> "I spent 800 pesos on food."

the model may need:

```text
utterance
supported categories
current household context if explicitly relevant
```

It does not automatically need:

```text
complete transaction history
salary
savings balance
partner's financial information
```

Do not send broad financial datasets to an AI provider merely for convenience.

---

# 32. AI Authorization

An assistant must operate with the permissions of the authenticated user.

AI must not become an authorization bypass.

If the user asks:

> "How much does my partner earn?"

the assistant must not be able to retrieve information the normal application cannot access.

Tool and backend operations invoked by AI must independently enforce authorization.

---

# 33. AI Structured Actions

AI output is untrusted input.

Example structured action:

```json
{
  "action": "create_expense",
  "amountMinor": 80000,
  "currency": "UYU"
}
```

must still pass:

* schema validation;
* authorization;
* domain validation;
* financial validation.

Do not execute arbitrary model-produced SQL or code.

---

# 34. Siri and Voice Security

Siri, voice, shortcuts, widgets, and deep links must not bypass normal authorization.

All operations triggered externally must eventually pass through the same authenticated application/domain layer.

Sensitive operations may require:

* explicit confirmation;
* unlocked-device context where supported;
* application authentication state;
* additional confirmation in the app.

---

# 35. Sensitive Voice Operations

The following should require stronger confirmation than simple expense registration:

* savings withdrawal;
* deleting financial records;
* modifying household split rules;
* changing budget allocation;
* settling large balances;
* modifying household membership;
* exporting financial history.

Exact thresholds may be defined later.

---

# 36. Deep Links

Deep links must be treated as untrusted input.

A deep link may navigate to:

```text
transaction/123
```

but access to transaction `123` must still be checked through normal authorization.

Knowing an object identifier does not grant access to it.

---

# 37. Object Identifiers

Use non-sequential, difficult-to-guess identifiers where practical, such as UUIDs.

However:

> Unpredictable IDs are not authorization.

RLS and explicit access checks remain mandatory.

---

# 38. Realtime Security

Supabase Realtime subscriptions must respect the same privacy boundaries as normal reads.

A user must not receive:

* another user's personal transaction events;
* another user's personal savings updates;
* another user's budget changes.

Household realtime events may only be delivered to authorized household members.

Realtime authorization must be reviewed whenever realtime is introduced.

---

# 39. Realtime Payload Minimization

Realtime payloads should contain only the data necessary to update the authorized UI.

Avoid broadcasting complete financial objects if a smaller event is sufficient.

Do not expose sensitive personal data through generic household channels.

---

# 40. Logging

Application logs must avoid unnecessary sensitive financial content.

Do not routinely log:

* auth tokens;
* refresh tokens;
* full session objects;
* service-role credentials;
* complete financial histories;
* voice recordings;
* full AI prompts containing private finance data.

---

# 41. Financial Logging

Useful debugging logs may contain:

```text
transactionId
householdId
operation type
error code
```

Prefer identifiers and metadata over:

```text
full transaction description
amount
salary
account balance
```

unless the information is specifically necessary and the environment is trusted.

---

# 42. Production Error Reporting

Error-reporting providers must be configured to avoid automatically collecting sensitive application state.

Review:

* breadcrumbs;
* request bodies;
* screen captures;
* user attributes;
* network payloads.

Financial information must not accidentally be sent to monitoring vendors.

---

# 43. Authentication Tokens

Tokens must be handled through platform-appropriate secure storage mechanisms.

Do not persist authentication credentials in plain AsyncStorage if the authentication library provides a more appropriate secure mechanism.

ADR-064 defines FIN-006 persistence: Expo SecureStore holds a native-generated
256-bit encryption key; AsyncStorage holds only a versioned AES-256-GCM
ciphertext envelope. Each write uses a fresh 96-bit nonce and a 128-bit tag.
Authenticated context binds the version, application/project namespace, and
logical storage key. UTF-8 sessions are not truncated or persisted as plaintext.

SecureStore uses `WHEN_UNLOCKED_THIS_DEVICE_ONLY` with
`requireAuthentication: false`. Keys are reused across refresh writes and are
not retained in a long-lived application cache. Operations serialize per logical
entry; failed operations do not poison the queue. Orphan keys/payloads never
authenticate. Corruption fails closed and removes unusable material; temporary
storage access failures produce retryable initialization errors.

Logout locks private UI, stops refresh work, cancels/clears private queries, and
uses `signOut({ scope: 'local' })`. Cleanup deletes the key before the ciphertext,
attempts both stores, and remains retryable/locked if removal cannot be confirmed.
Confirmed local removal permits local logout even if remote revocation fails.
This does not promise global logout or immediate invalidation of issued JWTs.

iOS Keychain entries may survive reinstall while app-container AsyncStorage
typically does not. Orphan cleanup applies; Expo Go cannot establish standalone
reinstall behavior. No session JSON, tokens, or passwords belong in logs.

---

# 44. Local Device Storage

Avoid storing complete financial datasets locally unless required.

When local persistence is introduced, review:

* sensitivity;
* encryption;
* logout cleanup;
* account switching;
* device compromise implications.

Cached data belonging to User A must never appear after User B signs into the same device.

---

# 45. Logout

Logout must:

* invalidate/remove local authenticated session state;
* clear sensitive cached application data;
* reset user-specific stores;
* prevent previously loaded financial screens from remaining accessible.

TanStack Query or other caches must be cleared appropriately.

---

# 46. Account Switching

If the application supports signing into different accounts on one device:

```text
User A logout
↓
clear private caches
↓
User B login
```

User B must not receive any locally cached data from User A.

---

# 47. Screenshots and App Switcher

Financial applications may expose information through OS-generated app previews.

This is not necessarily required for MVP, but should be reviewed before production.

Possible future protection:

* obscure sensitive content while backgrounded;
* optional privacy mode.

Do not introduce this complexity before it is needed.

---

# 48. Data Modification

Authorization rules must differentiate:

```text
SELECT
INSERT
UPDATE
DELETE
```

Read access does not automatically imply modification access.

Example:

A household member may eventually be allowed to see a shared savings goal while only certain roles can edit it.

Policies should remain operation-specific.

---

# 49. Created By vs Owner

`createdBy` is audit metadata.

It is not necessarily ownership.

Example:

```text
Shared expense:
createdBy = Andy
householdId = Home
```

The record belongs to the household, not personally to Andy.

Authorization must not incorrectly use `createdBy` as the sole owner of household records.

---

# 50. Updating Ownership Fields

Ownership and scope fields should generally be immutable after creation unless a specific use case requires otherwise.

Sensitive fields include:

```text
ownerProfileId
householdId
profileId
sharedExpenseId
```

Do not allow arbitrary client-side updates that could move a financial record into another authorization scope.

---

# 51. Household Membership Changes

Leaving or removing a household member must immediately prevent future access to household data unless a deliberate historical-access policy says otherwise.

Initial recommendation:

```text
inactive member:
no ongoing read access
```

Historical records may retain the member's identity internally for accounting correctness.

Exact post-membership visibility rules should be finalized before implementing removal.

---

# 52. Household Role Changes

Role changes must not allow a user to assign themselves elevated permissions.

When roles are introduced:

```text
OWNER
MEMBER
```

only authorized users may modify another member's role.

Privilege escalation through direct database writes must be impossible.

---

# 53. Data Deletion

The current Profile foreign key uses `ON DELETE RESTRICT`: an Auth identity with
an existing Profile cannot be deleted implicitly. This is an interim safeguard
against unintended Profile or future financial-history cascades, not the final
account-deletion design. Account deletion, anonymization, retention, and downstream
deletion behavior remain explicitly unresolved.

Soft deletion does not replace privacy deletion requirements.

If a user requests permanent account/data deletion in the future, the system may need to:

* anonymize records;
* delete personal data;
* preserve legally/accountingly necessary shared records where applicable;
* remove authentication identity;
* remove external provider data.

Exact retention requirements will be defined before public launch.

---

# 54. Soft-Deleted Data

Soft-deleted financial records must not become broadly accessible merely because they are excluded from normal application screens.

They remain protected by the same RLS policies as active records.

---

# 55. Database Constraints

Authorization and data integrity complement each other.

Security-sensitive constraints may include:

* valid ownership scope;
* unique household membership;
* positive monetary values;
* valid foreign keys;
* split membership consistency;
* valid settlement parties.

Invalid data should not be persistable simply because the client failed to validate it.

---

# 56. Multi-Step Financial Operations

Operations affecting multiple rows should be atomic where partial persistence could corrupt financial state.

Examples:

```text
create shared expense
+
create transaction
+
create split rows
```

should not result in:

```text
expense exists
but only one split was saved
```

Use PostgreSQL transactions or trusted RPC functions where appropriate.

---

# 57. Transaction-Safe Authorization

Authorization checks and writes for sensitive multi-step operations should occur in the same trusted transaction where possible.

Avoid:

```text
client checks membership
↓
time passes
↓
client writes financial data
```

as the only protection.

Membership must still be validated by the database operation.

---

# 58. Race Conditions

Financial operations must consider concurrent writes.

Examples:

* two settlement operations;
* simultaneous budget modifications;
* duplicate assistant submissions;
* multiple taps on "Save";
* repeated Siri commands.

Where necessary, use:

* unique constraints;
* idempotency keys;
* transactions;
* locking;
* conflict detection.

---

# 59. Idempotency

Externally triggered actions may be retried.

Examples:

* assistant calls;
* Siri;
* network retry;
* Edge Functions;
* webhook-like integrations.

Critical operations should support idempotency where duplicate execution would create duplicate financial records.

A future standard field may be:

```text
idempotencyKey
```

Exact implementation can be defined when required.

---

# 60. Client Validation

The client should validate user input for UX.

Examples:

```text
amount > 0
percentage total = 100%
required category selected
```

However, equivalent critical rules must also be enforced in trusted layers.

Client validation alone is insufficient.

---

# 61. Input Validation

All untrusted inputs require validation.

This includes:

* forms;
* query parameters;
* deep links;
* AI-generated structured data;
* Siri parameters;
* voice transcription;
* RPC arguments.

Use explicit schemas.

For TypeScript client/application boundaries, Zod is the preferred initial validation library.

---

# 62. SQL Injection

Database access should use Supabase query builders, parameterized SQL, or safe stored functions.

Do not interpolate user input directly into SQL strings.

AI-generated content must never be concatenated into executable SQL.

---

# 63. Arbitrary Code Execution

The financial assistant must never generate and execute arbitrary:

* JavaScript;
* SQL;
* shell commands;
* database functions.

AI output is data, not executable authority.

---

# 64. Rate Limiting

Rate limiting should be considered for:

* authentication attempts;
* invitation flows;
* AI assistant endpoints;
* expensive reports;
* voice transcription endpoints;
* external integrations.

Exact limits are not required for initial local development but must be reviewed before public production.

---

# 65. Abuse Prevention

Before public launch, review:

* brute-force authentication;
* email enumeration;
* invitation spam;
* assistant abuse;
* excessive API consumption;
* malicious file upload if attachments are introduced.

This is not required for the initial private MVP unless functionality exposes these risks.

---

# 66. Backups

Production financial data requires reliable backup and recovery.

Supabase/PostgreSQL backup capabilities and project-plan limitations must be reviewed before treating the application as a reliable financial record.

Backups must maintain the same privacy standards as production data.

---

# 67. Database Migrations

Security policies are code.

All schema and RLS changes must be represented as migrations.

Do not manually alter production security policies without capturing the change in the repository.

Each migration involving authorization must be reviewed.

---

# 68. Policy Testing

FIN-010 runs transactional pgTAP authorization tests with `npm run db:test`.
Synthetic Auth fixtures and JWT support live in a test-only `.sql.inc` include;
role switches remain explicit and assertions use actual `auth.uid()` and RLS.
Fixtures and helpers must disappear after rollback. No real credentials are needed.

SQL privilege denial and RLS denial are different guarantees. A cross-user SELECT
under a role with SELECT permission should succeed with no foreign rows: this
exercises RLS filtering. A forbidden INSERT using otherwise granted columns should
fail its `WITH CHECK`. DELETE without a DELETE grant should fail with permission
denied: this tests SQL privileges. SQLSTATE `42501` alone does not distinguish
these cases. Use valid fixtures and inputs so constraints cannot mask the intended
authorization failure, and pair privilege metadata with actual client-role queries.

RLS behavior must have automated tests where practical.

At minimum, tests should verify scenarios such as:

```text
User A can read User A personal transaction.
User A cannot read User B personal transaction.

User A and User B belong to Household H.
User A can read Household H shared expense.
User B can read Household H shared expense.

User A cannot read Household X where they are not a member.

User A cannot insert personal data owned by User B.
User A cannot create household data for Household X.

User A cannot access User B personal budget
even though both belong to Household H.
```

These tests are mandatory before considering privacy-sensitive functionality complete.

---

# 69. Negative Security Tests

Testing only successful access is insufficient.

Every sensitive feature should include explicit negative tests.

Example:

```text
expected:
403 / no rows / database rejection
```

for unauthorized attempts.

This is especially important because RLS mistakes often appear as valid queries returning too much data.

---

# 70. RLS Review Checklist

Before merging any migration involving financial tables, verify:

1. Is RLS enabled?
2. Who can SELECT?
3. Who can INSERT?
4. Who can UPDATE?
5. Who can DELETE?
6. Can a user change ownership fields?
7. Can household membership expose personal records?
8. Are inactive household members excluded?
9. Do joins/views preserve authorization?
10. Are RPC functions respecting `auth.uid()`?
11. Are service-role operations limited to trusted infrastructure?
12. Are negative authorization tests present?

---

# 71. Security Review Triggers

A dedicated security review is required when introducing:

* a new financial table;
* new household data;
* new RLS policies;
* RPC functions;
* `SECURITY DEFINER`;
* Edge Functions;
* service-role usage;
* AI tools;
* Siri/App Intents;
* realtime;
* deep links;
* exports;
* account deletion;
* household role management;
* file attachments.

---

# 72. Security vs Convenience

Do not weaken authorization to simplify development.

Forbidden reasoning includes:

```text
"It's only a personal project."
"We hide the screen anyway."
"They would need to know the UUID."
"Only the mobile app can call this."
"Both users are in the same household."
```

None of these are valid security controls.

---

# 73. Development Environment

Development may use test users and synthetic financial data.

Avoid using real sensitive financial information where unnecessary during development.

Local/test databases should contain dedicated test accounts for authorization scenarios.

---

# 74. Test Personas

Recommended security fixtures:

```text
User Andy
User Partner
User Stranger
```

Membership:

```text
Household Home
- Andy
- Partner

Household Other
- Stranger
```

These identities should support automated tests for isolation.

No production credentials should be reused in tests.

---

# 75. Security Invariants

The following invariants are mandatory.

1. Authentication identity comes from Supabase Auth, not client-submitted user IDs.
2. Personal financial records are readable only by their owner.
3. Household records are readable only by authorized household members.
4. Household membership never grants access to another member's personal financial records.
5. RLS is required for user-specific financial tables.
6. Client-side visibility is not authorization.
7. Service-role credentials never ship in the application.
8. AI provider secrets never ship in the application.
9. Ownership/scope fields cannot be freely reassigned by clients.
10. Derived financial information follows the same privacy rules as source data.
11. Views, RPC functions, realtime, assistants, and reports must preserve RLS-equivalent authorization.
12. AI-generated actions are validated and authorized before execution.
13. Siri and voice operations cannot bypass normal authorization.
14. Sensitive operations require explicit confirmation where appropriate.
15. Financial multi-row operations must avoid partial persistence.
16. Security policies must be versioned through migrations.
17. Authorization requires negative tests.
18. Soft-deleted records remain protected.
19. Logs must not unnecessarily expose sensitive financial information.
20. A functional feature that breaks these rules is not considered complete.

---

# 76. Open Security Decisions

The following security decisions are intentionally not finalized and must not be guessed during implementation:

1. Additional authentication providers/capabilities (OAuth/social providers, magic links, MFA, or other future options). Basic MVP email/password authentication is already decided and implemented by FIN-006/ADR-064.
3. Household invitation token design.
4. Whether former household members retain any historical read access.
5. Exact household role permissions.
6. Who may edit/delete another member's household-created expense.
7. Who may record or reverse settlements.
8. Whether sensitive operations require biometric confirmation.
9. Exact financial-data retention policy.
10. Account deletion/anonymization behavior.
11. Production backup and recovery policy.
12. Error-monitoring provider and redaction configuration.
13. AI provider and data-retention configuration.
14. Voice transcription provider and recording-retention policy.
15. Idempotency implementation strategy.
16. Export permissions and export format security.
17. Whether screenshots/app-switcher previews require privacy protection.

If implementation requires one of these decisions, it must be resolved explicitly before coding.

---

# 77. Related Documentation

Before implementing security-sensitive functionality, consult:

* `PRODUCT.md` — intended behavior;
* `DOMAIN.md` — entities and business rules;
* `ARCHITECTURE.md` — technical boundaries;
* `DECISIONS.md` — accepted decisions;
* `ROADMAP.md` — current implementation scope;
* `AGENTS.md` — implementation rules.

Security must not be relaxed silently because another document is ambiguous.

## FIN-115 savings enforcement

Savings registration and availability are authenticated-only SECURITY INVOKER
functions with empty search paths and explicit owner lookup. No household access,
service role, definer capability or client privilege over immutable money is added.
The affirmative withdrawal flag is insert-only evidence of caller intent; it is not
proof of a human gesture. Direct insert and restore paths enforce it as well.
A server-managed insert/restore validation marker prevents legacy schema-only
contributions from creating unfunded savings; clients cannot forge or edit it.
Legacy unvalidated movements remain private/readable and may be soft-deleted,
but cannot participate in a trustworthy availability summary or be silently restored.

Owner-scoped advisory locks serialize all transaction and allocation writers at
READ COMMITTED, before their period locks. Deferred integrity checks protect every
historical currency/month savings prefix against income deletion, allocation changes
and movement deletion/restoration. Contribution eligibility is checked only on
creation/restoration, so later ordinary overspending cannot implicitly consume savings.
Future lifecycle/correction RPCs must acquire the owner lock before period/row locks.

Transactional pgTAP tests cover actual grants, RLS, direct writes, safe bounds,
legacy correction, historical-prefix integrity and snapshot-isolation rejection.
A separate local-only Node harness executes real concurrent PostgreSQL sessions,
observes the second writer waiting on the advisory lock, then verifies rejected
financial conflicts versus allowed ordinary overspending. Cross-session fixtures
must be committed to be visible; unlike single-session pgTAP fixtures, this harness
uses fresh UUIDs and removes only those synthetic rows in a finally block. It can
only target the named local Supabase Docker container, never a supplied hosted URL.


## FIN-116 personal goal enforcement

Goals are owner-only with SELECT and INSERT RLS and no client UPDATE/DELETE grant.
There is no household scope to forge. The optional transaction goal reference is
insert-only, composite-owner constrained, same-currency and valid only for savings
movements. Goal creation and goal-scoped savings RPCs are authenticated invoker
functions with empty search paths; stable replay checks include all immutable input.
General and goal sub-reserves are validated at every historical month under the same
owner lock and deferred correction guards as FIN-115. All goal queries live under the
owner savings cache namespace so every financial correction invalidates their totals.

## FIN-117 recurring-template enforcement

Templates are personal-only. SELECT/INSERT/stop UPDATE use owner RLS; narrow column
privileges deny changes to original terms, scope, identity or provenance. DELETE and
TRUNCATE are unavailable. A composite category/owner foreign key preserves private
references. New definitions require an active owned spendable category, a current-or-
future financial start month and no overlapping closed month. Stop can only shorten
from the current financial month onward and cannot change a covered closed month.
Invoker creation/stop RPCs use an empty search path and never write transactions.
Exact replay reads the original row, including after stop, archival or closure.
Template and period writes share owner serialization; template mutations reject
snapshot isolation. Household access is never included. SQL tests distinguish RLS
filtering, rejected forged writes and absent column/table/function privileges.

## FIN-118 resolution enforcement

No new table, definer function or broader UPDATE privilege is introduced. Transactions
carry an insert-only composite-owner recurring-template FK and canonical month, with
unique owner/template/month identity including deleted actuals. Direct INSERT validates
the same variable-template schedule, category, currency and budget month as the invoker
resolution RPC; existing RLS/open-period/expense and savings guards remain mandatory.
The owner lock serializes stop versus resolution and duplicate requests. Snapshot
isolation is rejected. Scalar owner-only reads retain cancelled/stopped history without
exposing another owner's templates or transactions. Real PostgreSQL tests distinguish
RLS filtering from column/function privilege denial and forged-write rejection.


## FIN-119 commitment enforcement

A stable invoker RPC validates the owned budget period and derives all monthly
commitments in one read snapshot under existing owner RLS. There is no caller owner
parameter, service role, definer capability or new table. It rejects incompatible
currency/mapping and unsafe sums rather than returning partial totals. Prior-month
unresolved counts are also owner-only and include no other user's financial data.
The fixed-confirmation extension uses the original atomic resolver and owner lock;
the transaction INSERT trigger enforces the fixed amount even on direct writes.
No UPDATE privileges, savings guards or closed-period protections are relaxed.


## FIN-120 monthly availability reads

The combined STABLE SECURITY INVOKER snapshot adds no table or write privileges.
Both component RPCs require the selected period to belong to auth.uid(), then read
existing owner-only RLS data. Anonymous execution is revoked and search_path is empty.
Wrong owners, malformed legacy currency/mappings and unsafe aggregate arithmetic
fail the complete response, never yield a partial or default-zero availability.
A scalar aggregate is complete regardless of Data API row limits. Client caches
use owner/period keys and existing auth clear/cancellation; refreshing/error states
hide prior numerical availability. Neither a partner nor an unrelated user receives
another owner's financial components through this RPC.

## FIN-121 dashboard isolation

The dashboard RPC accepts a canonical month, not a caller-selected owner. It resolves
only auth.uid()'s period and existing owner-only RLS data. Authentication, empty search
path, authenticated-only EXECUTE and stable invoker semantics apply to the complete
snapshot, including the bounded preview. No table or write grant changes. An absent
owned period returns an explicit missing-period state, never another owner's period
or a zero financial balance. Existing auth cache clearing remains mandatory.
