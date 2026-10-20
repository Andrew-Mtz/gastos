# Domain Model

**Version:** 0.1
**Status:** Active
**Last updated:** 2026-09-09

This document defines the business domain model, core entities, relationships, invariants, and deterministic financial rules.

It complements `PRODUCT.md`.

If code, database structure, or implementation behavior conflicts with the domain rules defined here, the conflict must be identified before implementation.

---

# 1. Domain Goals

The domain model must support:

* private personal finances;
* shared household finances;
* percentage-based budgeting;
* protected savings;
* personal and shared expenses;
* historical budget periods;
* recurring expenses;
* household split rules;
* payer vs responsibility separation;
* balances and settlements;
* multiple currencies;
* deterministic financial calculations;
* future voice, Siri, and AI-driven input without duplicating business logic.

The domain must preserve historical correctness and strict privacy boundaries.

---

# 2. Core Concepts

The main domain areas are:

```text
Identity
├── Profile
├── Household
└── HouseholdMember

Budgeting
├── BudgetPeriod
├── BudgetBucket
└── BudgetAllocation

Classification
└── Category

Money Movement
├── Transaction
├── FinancialAccount
└── ExchangeRateSnapshot

Recurring Obligations
└── RecurringExpense

Shared Finance
├── SharedExpense
├── SharedExpenseSplit
└── Settlement

Savings
├── SavingsGoal
└── SavingsContribution
```

These are conceptual entities.

The initial database schema does not need to implement every entity immediately.

---

# 3. Identity

## 3.1 Profile

A `Profile` represents the application-specific identity of an authenticated user.

Conceptual fields:

```text
Profile
- id
- displayName
- baseCurrency
- locale
- timezone
- createdAt
- updatedAt
```

### Rules

* One authenticated user has one application profile.
* Profile ID equals the Supabase Auth user UUID; there is no separate `authUserId`.
* Future application entities reference `public.profiles(id)`, not `auth.users` directly.
* A Profile may temporarily be absent after Auth identity creation. FIN-006 explicitly completes Profile setup before profile-dependent application access.
* A profile is private by default.
* A profile may participate in one or more households in the future.
* Financial data must reference the authenticated user's profile or a household scope.

---

# 4. Household

A `Household` represents a shared financial space.

Conceptual fields:

```text
Household
- id
- name
- defaultCurrency
- createdBy
- createdAt
- updatedAt
```

A household does not own or expose its members' personal finances.

FIN-201 / ADR-078 persists this identity with a nonblank name of at most 100
characters, a three-uppercase-ASCII-letter currency shape, a restricted creator
Profile reference, and server-maintained update timestamps. `createdBy` is
immutable audit provenance, not ownership or membership. No client operation or
household read access exists in this schema-only stage.

---

# 5. HouseholdMember

A `HouseholdMember` represents membership of a profile within a household.

Conceptual fields:

```text
HouseholdMember
- id
- householdId
- profileId
- role
- defaultSplitWeight
- joinedAt
- leftAt
```

Possible future roles:

```text
OWNER
MEMBER
```

Initial versions may keep permissions simple.

### Rules

* Membership is explicit.
* Membership grants access only to household-scoped data.
* Membership never grants access to another member's personal data.
* A member may leave a household without deleting historical household activity.
* Historical shared transactions remain attributable to the original member.

FIN-201 persists one identity per household/Profile pair, restricted references,
an explicit `OWNER` or `MEMBER` label, a finite join timestamp, and an optional
finite departure timestamp no earlier than joining. Identity, household, Profile,
and original join time cannot be reassigned. The structural collection has no
two-person cap, owner-count rule, or single-active-household constraint. This does
not resolve the still-open MVP cardinality or detailed role policy: the client
surface remains closed until FIN-202 defines authorization. A creator need not
have an ownership membership; no role is inferred or automatically inserted.

Default split weight is deferred to FIN-205. Leaving, rejoining, role changes,
invitation state, and former-member visibility are not implemented or implicitly
decided by these fields. Any later rejoin operation must explicitly preserve its
history rather than rewriting the original join time or silently removing a
departure marker. FIN-201 creates no financial activity or personal-budget impact.

---

# 6. Financial Scope

Financial records belong to a scope.

Conceptually:

```text
PERSONAL
HOUSEHOLD
```

Personal records belong to exactly one profile.

Household records belong to exactly one household.

A record must not be simultaneously personal and household-scoped.

Recommended invariant:

```text
PERSONAL:
ownerProfileId != null
householdId == null

HOUSEHOLD:
ownerProfileId == null
householdId != null
```

Exceptions should not be introduced without an explicit domain decision.

---

# 7. BudgetPeriod

A `BudgetPeriod` represents one financial planning period for one user.

Initial implementation:

```text
1 calendar month
```

Conceptual fields:

```text
BudgetPeriod
- id
- profileId
- startDate
- endDate
- status
- baseCurrency
- expectedIncomeMinor
- actualIncomeMinor
- createdAt
- closedAt
```

FIN-103 persists the initial personal-period subset as one canonical calendar
month with inclusive start and end dates. The row snapshots its base currency,
stores an optional expected-income amount in safe integer minor units, and records
its lifecycle state and technical timestamps. `expectedIncomeMinor = null` means
no estimate has been supplied; `0` is an explicit zero estimate. The currency,
ownership, and month boundaries do not change through ordinary editing.

Actual income is not stored on the Budget Period row. It remains derived from
received-income transactions. Allocation rows and their percentage history are
introduced by FIN-105 rather than embedded in this entity.

Possible statuses:

```text
OPEN
CLOSED
```

### Rules

* Budget periods belong to individual users, not households.
* A household does not have access to a user's budget period.
* Historical budget periods preserve their own configuration.
* Updating a current budget strategy must not change prior periods.
* A closed period must not be silently mutated.
* Ordinary authenticated edits are available only while lifecycle state is `OPEN`.
* Calendar age alone does not close or freeze a period.

---

# 8. BudgetBucket

A `BudgetBucket` represents a broad allocation purpose.

Examples:

```text
Needs
Leisure
Savings
```

Conceptual fields:

```text
BudgetBucket
- id
- profileId
- name
- type
- isSystem
- createdAt
```

Possible conceptual types:

```text
SPENDABLE
SAVINGS
```

### Rules

* A bucket is not an expense category.
* A bucket can contain many categories.
* Savings buckets are not ordinary spendable buckets.
* System-defined buckets may be customized in future versions.

FIN-104 persists personal buckets independently of periods and allocations.
Each bucket has a required non-blank name, a `SPENDABLE` or `SAVINGS` type,
system provenance, and creation/update timestamps. Type and ownership cannot be
changed by ordinary clients, preserving savings classification and historical
references. Custom buckets may be renamed or archived with `archivedAt`; an
archive preserves the row and its financial meaning rather than deleting it.
Active configuration queries exclude archived buckets, while historical queries
may still resolve them. Clearing a custom archive marker restores the same row;
this schema does not introduce a recovery UI or account-deletion policy.

Clients create custom buckets only. System-defined rows remain owner-readable
but not client-customizable. FIN-106 provisions three immutable system defaults with stable `NEEDS`,
`LEISURE`, and `SAVINGS` keys, independently of translated labels. Keys are
unique per owner; existing custom or legacy system buckets are not reclassified.
Period percentages and amounts belong to FIN-105.

---

# 9. BudgetAllocation

A `BudgetAllocation` stores the allocation assigned to a bucket within a specific budget period.

Conceptual fields:

```text
BudgetAllocation
- id
- budgetPeriodId
- budgetBucketId
- percentageBasisPoints
- plannedAmountMinor
```

Example:

```text
50% = 5000 basis points
30% = 3000 basis points
20% = 2000 basis points
```

Use integer basis points instead of floating-point percentages.

### Invariant

For each `BudgetPeriod`:

```text
sum(all allocation percentageBasisPoints) = 10000
```

### Rules

* Allocations belong to a specific period.
* Changing a future or current allocation does not rewrite historical periods.
* Planned amounts may be recalculated from expected income.
* Actual budget availability may be based on actual received income.

FIN-105 stores one allocation identity per period/bucket with integer basis points
and server-managed creation, update, and removal timestamps. A period may exist
without a configured plan; once configured, its active allocations must total
10000 at transaction completion. Removed allocations are soft-deleted and excluded
from calculations, while owner-readable rows retain their identity and timestamps.
Reintroducing a removed allocation reuses that identity. New or restored references
require an active bucket; archival does not invalidate an existing historical
reference. Ordinary writes require an owned open period and a same-owner bucket.

Planned amounts are derived, not persisted: the period's expected-income snapshot
and its own percentages are sufficient to reproduce them. Unknown expected income
produces unknown planned amounts, distinct from explicit zero. The pure domain plan
sorts normalized bucket UUIDs before applying FIN-102 largest remainder, so database
row order cannot change tie-breaking. Planned income is never treated as received
cash or actual availability. Configuration creates no cash movement, spending, or
savings transaction. No defaults or setup UI are introduced here.

FIN-106 adds initial setup for an unconfigured personal month. Balanced (50/30/20),
Saver (50/20/30), Aggressive Saving (45/15/40), and Custom plans use the same
three defaults. Expected income may remain unknown; an explicit zero remains
zero. Preview and saved plans share actual bucket identities for deterministic
rounding. Saving creates the period, expected-income snapshot, and complete
allocation set atomically. An identical retry returns the existing open plan;
a different setup never overwrites an already-configured plan. Existing and
closed plans are read-only in this initial UI. Preparing defaults alone creates
no period, allocation, cash movement, spending, or savings transaction.

---

FIN-110 derives actual bucket allocations from the period's total active received
income, not the estimate. It allocates the aggregate once with FIN-102 largest
remainder and stable normalized bucket IDs; separately rounded installments are
not added together. Zero received means zero in every bucket. All values remain
safe integer minor units in the budget currency; no allocation balances are stored.
These are pre-consumption amounts, not remaining balances or safe-to-spend. Savings
allocations are labeled separately and never silently redistributed to spending.
Expense consumption, protected-savings balances and commitments remain later tasks.

FIN-114 partitions those already-rounded received-income allocations by immutable
bucket type: SAVINGS contributes only to protected savings allocation, and
SPENDABLE contributes only to ordinary spendable allocation. Both include every
referenced bucket even after archival; missing or invalid classification is an
error, never permission to spend. The two exact totals sum to received income.
They are period allocations, not cumulative savings, remaining balances or final
safe-to-spend. Derivation creates no cash, spending or savings movement. Ordinary
overspending leaves protected savings unchanged and cannot create a withdrawal.
FIN-115 defines explicit movements; FIN-120 uses only ordinary spendable allocation
as its starting point before consumption and confirmed commitments.

# 10. Category

A `Category` classifies financial activity.

Examples:

```text
Rent
Groceries
Electricity
Internet
Restaurants
Games
Clothing
Transportation
```

Conceptual fields:

```text
Category
- id
- profileId
- name
- budgetBucketId
- isSystem
- archivedAt
```

### Rules

* Personal categories belong to a profile.
* Categories may map to one budget bucket.
* Archived categories remain usable for historical reporting.
* Historical transactions must not lose category meaning if a category is later archived.

FIN-107 persists personal categories with an optional explicit same-owner bucket
reference. Clients can rename or archive custom categories but cannot reassign
the owner, bucket mapping, or system provenance. Archive/restore preserves the
same identity and mapping, including historical references to archived buckets.
New categories may reference only active buckets. Active category state alone
does not establish bucket eligibility for future financial operations. No default
set or management UI is introduced in this schema task.

Household category behavior may later support either:

* household-specific categories;
* reusable system categories.

That decision can be deferred.

---

# 11. Money Representation

Authoritative Money uses JavaScript `number` values for integer minor units,
as accepted in ADR-010 and ADR-011. Every amount must satisfy
`Number.isSafeInteger(amountMinor)`. No floating-point authority means no
fractional-money approximation; exact safe-integer arithmetic is permitted.

Required representation:

```text
amountMinor: integer
currency: ISO 4217 code
```

Example:

```text
USD 10.99
amountMinor = 1099
currency = USD
```

For currencies whose practical display does not commonly use decimals, the internal representation may still use the ISO-defined minor unit strategy consistently.

### Rules

* Money supports positive, zero, and negative safe integers. Negative zero is normalized to zero.
* Positivity is enforced by higher-level domain operations such as Expense, Income, and Settlement, not by Money itself.
* CurrencyCode validates exactly three ASCII uppercase letters without trimming or case conversion. Shape-valid codes such as `ZZZ` are accepted; this does not prove ISO registry membership or product support.
* Addition, subtraction, and ordering require the same currency. Equality across currencies is false; conversion is a separate operation.
* Arithmetic validates operands and rejects unsafe results rather than rounding, truncating, or clamping them.
* Percent calculations must define explicit rounding behavior.
* Database numeric types must not introduce silent floating-point approximation.

---

# 12. Percentage Calculation and Rounding

Percentage splits can produce fractional minor units.

Example:

```text
UYU 100
33.33%
33.33%
33.34%
```

The domain must guarantee:

```text
sum(split amounts) = original amount
```

Authoritative percentages use safe-integer `BasisPoints` values from `0` through
`10000` inclusive. A full allocation must contain at least one share and total
exactly `10000`; shares are never silently normalized.

Largest-remainder allocation is mandatory:

1. Calculate exact proportional values for the source magnitude.
2. Floor each result to integer minor units.
3. Calculate remaining minor units.
4. Distribute units to the largest fractional remainders first.
5. Break equal-remainder ties by original input order.

Signed Money is allocated by absolute magnitude and then has the original sign
reapplied to every result. Allocation is therefore sign-symmetric. Callers with
keyed participants must establish a stable input order before allocation.

This rule must be covered by tests.

---

# 13. Transaction

A `Transaction` represents an actual financial event.

Conceptual fields:

```text
Transaction
- id
- type
- scope
- ownerProfileId
- householdId
- amountMinor
- currency
- transactionDate
- categoryId
- financialAccountId
- description
- metadata
- createdBy
- createdAt
- updatedAt
- deletedAt
```

Possible transaction types:

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

Not every transaction affects spending.

FIN-108 persists only personal INCOME, EXPENSE, SAVINGS_CONTRIBUTION and
SAVINGS_WITHDRAWAL rows, each belonging to an owned calendar budget period.
Amounts are positive safe-integer minor units; dates are financial dates rather
than creation timestamps. Optional category relations enforce the same owner.
FIN-108 initially restricted clients to descriptions and soft-delete/restore.
FIN-122 / ADR-074 adds explicitly reviewed, audited amount/date/category corrections
through a bounded operation; original currency, identity and scope remain immutable. Deletion
preserves identity and is excluded by subsequent calculation paths. This schema
does not implement expense/savings operations or determine their budget effects.

ADR-066 limits income to its period currency for this stage. Cross-currency income
registration/conversion is deferred, not silently estimated. ADR-067 separately limits Phase 1 expenses to the period currency; future
conversion semantics remain open.

---

# 14. Income

An income transaction represents money received.

Example:

```text
type = INCOME
amount = USD 1500
scope = PERSONAL
```

### Rules

* Income increases cash availability.
* Income may affect actual budget availability.
* Expected income is planning data and is not itself a transaction.
* Only actually received money should be treated as received income.

---

FIN-109 registers actual income with a stable operation UUID. Identical retries
return the same active record; different or deleted records cannot be overwritten
or revived by registration. Received income is derived from active INCOME rows
for one owner/period, not expected income. Empty received totals are zero; unsafe
aggregate sums fail rather than round. Income registration increases received cash,
not spending, and creates no savings transaction. FIN-110 handles bucket availability.

# 15. Expense

An expense transaction represents consumption of money.

Example:

```text
type = EXPENSE
category = Groceries
amount = UYU 2500
```

### Rules

* Expenses normally affect a budget bucket through their category.
* Personal expenses affect only the owner's personal financial state.
* Household expenses require shared-expense responsibility logic.
* Expense recognition must not be duplicated when payment instruments are later settled.

---

FIN-111 registers expenses with stable operation identities. Exact retries only
read their existing active record; conflicting or deleted registrations cannot be
silently overwritten or revived. New/restored expenses require an active owned
category mapped to an active SPENDABLE bucket. The immutable mapping preserves
historical bucket meaning. Cash, spending and budget consumption each reflect the
expense amount; savings are unchanged. FIN-113 derives consumption from all active personal EXPENSE rows in a period,
aggregating their immutable category-to-bucket mappings. Deleted rows and all
other movement types contribute zero spending. Archived category/bucket mappings
remain valid for history. A legacy expense with no spendable mapping or a currency
different from the period fails the entire calculation explicitly (ADR-067),
rather than disappearing from an understated total. Configured spendable buckets
with no expenses show zero; buckets with expenses remain visible even without an
active allocation. Exact aggregate sums must remain safe integers. Consumption
creates no cash movement, savings movement, remaining balance or safe-to-spend
value, and no derived totals are persisted.

# 16. Transfer

A transfer moves money between financial accounts owned by the same financial scope.

Example:

```text
Checking → Savings account
USD 300
```

### Rule

A transfer is not an expense.

It may affect account balances but must not increase spending totals.

---

# 17. Savings Contribution

A `SAVINGS_CONTRIBUTION` represents an explicit allocation or contribution to savings.

It may be associated with:

* general savings;
* a specific `SavingsGoal`.

### Rules

* Savings contributions reduce ordinary spendable availability.
* They do not represent consumption.
* Moving money to savings does not necessarily require a physical bank transfer.

---

# 18. Savings Withdrawal

A `SAVINGS_WITHDRAWAL` represents explicit removal of money from protected savings.

### Rules

* Savings are never withdrawn implicitly.
* The operation must be explicit.
* The reason may optionally be recorded.
* A withdrawal may make money available for spending again.

---

FIN-115 / ADR-068 defines the protected reserve cumulatively per currency through
one month: independently rounded monthly savings allocations plus additional active
contributions minus active withdrawals. Contributions do not duplicate percentage
allocation. They require sufficient current-month ordinary remainder before
commitments when created/restored. Withdrawals require affirmative confirmation and
must preserve every historical cumulative monthly prefix, including after corrections.
They return money to ordinary availability only in the withdrawal's month. Both
movements have zero cash impact and zero spending/expense-consumption impact.

Ordinary remainder before commitments equals spendable allocated received income
minus expenses minus additional contributions plus withdrawals. It may be negative
following ordinary overspending; protected savings remains unchanged. This is not
safe-to-spend. No ordinary remainder rollover, currency conversion, opening account
balance is implied. Goal sub-reserves are defined by ADR-069 below. Unconfigured periods add no allocated savings;
new contributions require a configured complete plan. Invalid legacy records block
availability rather than yielding a partial result. Corrections remain recoverable
and cannot retroactively overdraw protected savings; closed-period guards still apply.

---

# 19. FinancialAccount

A `FinancialAccount` represents where money is held or owed.

Examples:

```text
Cash
Bank account
Savings account
Credit card
Digital wallet
```

Conceptual fields:

```text
FinancialAccount
- id
- profileId
- name
- type
- currency
- archivedAt
```

Possible types:

```text
CASH
BANK
SAVINGS
CREDIT_CARD
WALLET
OTHER
```

Accounts are personal in the initial design.

Shared financial accounts may be considered later.

---

# 20. Credit Card Purchases

When a user purchases something using a credit card:

```text
Steam
USD 50
Credit card: VISA
```

the expense is recognized at purchase time.

The later payment of the credit card balance is not a second expense.

Conceptually:

```text
Purchase:
EXPENSE USD 50

Statement payment:
TRANSFER / LIABILITY_SETTLEMENT
```

The exact transaction representation may evolve, but double counting is forbidden.

---

# 21. RecurringExpense

A `RecurringExpense` is a template describing an expected repeating obligation.

Conceptual fields:

```text
RecurringExpense
- id
- scope
- ownerProfileId
- householdId
- name
- categoryId
- frequency
- amountMode
- defaultAmountMinor
- currency
- dueDay
- activeFrom
- activeUntil
- createdAt
```

Possible amount modes:

```text
FIXED
VARIABLE
```

Initial frequency:

```text
MONTHLY
```

### Rules

* A recurring expense is not automatically an actual transaction.
* Variable recurring expenses must wait for the actual amount.
* Fixed recurring expenses may eventually support automatic generation.
* A recurring expense may be personal or household-scoped.

---

FIN-117 / ADR-070 persists owner-only monthly definitions with immutable terms. A template
requires an active same-owner category mapped to an active SPENDABLE bucket at
creation. FIXED requires a positive safe-integer amount; VARIABLE may carry a
nonnegative estimate or null for unknown. An estimate is never actual spending.
The explicit currency, category, amount mode, amount, due day and first/last months
cannot be edited by ordinary clients. Due day 1–31 clamps to the month's last day;
first/optional inclusive last months are canonical calendar-month start dates.
Creation starts no earlier than the owner's current financial month and cannot
overlap an already closed owned period. A retry reads the original definition,
even after time passes, a category is archived or a period closes.

A last month limits the schedule without deleting history. A separate explicit
stopped-from month excludes that and later months, may only shorten the schedule,
and must be no earlier than the owner's current financial month. It cannot change
a covered closed month or touch actual transactions. Stopping at/before the first
month cancels a mistaken future template; clearing/extending a stop is forbidden.
Original terms and server stop provenance remain readable. Broad edits/reactivation
require a later versioned operation. Category
or bucket archival does not erase a recurring obligation. Creating a template has
zero cash, spending, budget-consumption and savings impact. No actual transaction,
occurrence, automatic fixed generation or commitment amount is created in FIN-117.

---

# 22. Committed Money

Committed money represents expected obligations that have not yet been paid.

Conceptually:

```text
CONFIRMED
ESTIMATED
```

Examples:

```text
Rent: confirmed
Electricity estimate: estimated
```

### Rules

* Committed money affects financial planning.
* Estimated obligations must remain distinguishable from confirmed obligations.
* Estimated commitments do not become actual expenses until a real expense is created.

---

# 23. SharedExpense

A `SharedExpense` represents a household expense with explicit financial responsibility among household members.

Conceptual fields:

```text
SharedExpense
- id
- householdId
- transactionId
- payerProfileId
- splitStrategy
- createdAt
```

The actual amount, currency, category, and date may live on the associated transaction.

### Rules

* Every shared expense belongs to one household.
* The payer must be a valid household member at the relevant time.
* Responsibility must be recorded explicitly through splits.
* Historical splits must not depend on current household defaults.

---

# 24. Household Default Split

A household may define a default split.

Conceptually:

```text
Member A = 7000 basis points
Member B = 3000 basis points
```

The household default is only a template for future expenses.

### Rule

Changing the household default split must not modify any existing shared expense.

---

# 25. SharedExpenseSplit

A `SharedExpenseSplit` stores one member's responsibility for one shared expense.

Conceptual fields:

```text
SharedExpenseSplit
- id
- sharedExpenseId
- profileId
- percentageBasisPoints
- responsibilityAmountMinor
```

### Invariants

For one shared expense:

```text
sum(percentageBasisPoints) = 10000
```

and:

```text
sum(responsibilityAmountMinor) = sharedExpense.amountMinor
```

The stored amount is the authoritative historical responsibility after deterministic rounding.

---

# 26. Payer vs Responsible Member

The payer is the person who physically funded the transaction.

Responsibility is how much of the expense economically belongs to each member.

They are independent.

Example:

```text
Expense: UYU 1000

Split:
Andy    UYU 700
Partner UYU 300

Payer:
Andy UYU 1000
```

Result:

```text
Partner owes Andy UYU 300
```

---

# 27. Shared Expense Budget Impact

A shared expense affects each member's personal budget according to that member's responsibility.

Example:

```text
Shared expense: UYU 1000
Andy responsibility: UYU 700
Andy paid: UYU 1000
```

For Andy:

```text
budgetImpact = -700
cashImpact = -1000
receivable = +300
```

The application must not use the amount paid as the budget impact.

---

# 28. Cash Impact

Cash impact describes actual money movement for a user.

Examples:

```text
Income received      +1500
Expense paid          -500
Settlement received   +300
Transfer out          -200
```

Cash impact is not equivalent to budget impact.

---

# 29. Budget Impact

Budget impact describes how much an operation consumes or restores a user's budget allocation.

Examples:

```text
Personal expense           -500
Shared expense responsibility -700
Settlement received             0
Transfer between accounts       0
```

Budget impact must be derived deterministically from transaction semantics.

---

# 30. Household Balance

Household balances represent net obligations between members.

For a two-person household:

```text
positive balance:
Partner owes current user

negative balance:
Current user owes partner
```

For more than two members, balances should be modeled per member pair or as contribution vs responsibility totals.

The domain should not permanently assume households contain exactly two people.

---

# 31. Balance Derivation

For each household member:

```text
netPosition =
amountActuallyPaid
- responsibilityAmount
+ settlementsPaidToHousehold
- settlementsReceivedFromHousehold
```

The exact implementation may use pairwise ledgers, but the financial result must remain deterministic.

For a shared expense:

```text
Expense: UYU 1000

Andy responsibility: UYU 700
Partner responsibility: UYU 300

Andy paid: UYU 1000
```

Positions:

```text
Andy:
1000 - 700 = +300

Partner:
0 - 300 = -300
```

Therefore:

```text
Partner owes Andy UYU 300
```

---

# 32. Settlement

A `Settlement` represents repayment of an outstanding household obligation.

Conceptual fields:

```text
Settlement
- id
- householdId
- fromProfileId
- toProfileId
- amountMinor
- currency
- date
- createdAt
```

### Rules

* A settlement is not an expense.
* A settlement affects cash.
* A settlement does not affect budget consumption.
* The payer and recipient must belong to the household.
* A settlement should reduce the applicable outstanding balance.

---

# 33. Refund

A refund reverses all or part of a prior expense.

Where possible, a refund should reference the original transaction.

Conceptual fields:

```text
originalTransactionId
refundAmountMinor
```

### Rules

* A refund restores applicable budget consumption.
* A refund affects cash when money is actually returned.
* Partial refunds must be supported conceptually.

---

# 34. Reimbursement

A reimbursement represents money returned for an expense paid on behalf of another party when that reimbursement is not modeled as a household settlement.

Its exact use cases can be expanded later.

It must not create duplicate expense recognition.

---

# 35. SavingsGoal

A `SavingsGoal` represents a savings objective.

Conceptual fields:

```text
SavingsGoal
- id
- scope
- ownerProfileId
- householdId
- name
- targetAmountMinor
- currency
- targetDate
- status
- createdAt
```

Possible status:

```text
ACTIVE
COMPLETED
ARCHIVED
```

### Rules

* Personal savings goals are private.
* Household savings goals are visible to household members.
* A savings goal is not itself a financial account.

---

FIN-116 / ADR-069 implements personal goals only. Creation is financially neutral.
The target is a positive safe-integer amount in an immutable currency, with an optional
valid calendar target date. Progress and target attainment are derived through a named
month, may decrease after an explicit withdrawal, and may exceed the target.

A linked contribution is additional funding from that month's ordinary remainder,
not a second recording of allocated savings or designation of existing reserves. The
same immutable savings transaction provides both total savings and goal progress.
An explicitly confirmed goal withdrawal reduces both and restores ordinary availability
in its month. General withdrawals cannot consume goal sub-reserves. At every historical
monthly prefix, every goal and the unassigned reserve (total minus goals) are nonnegative.
Corrections/restorations must preserve this, without automatic withdrawal or reassignment.
Cash impact and expense/spending impact are zero for both movement types. Goal creation,
targets and target dates never affect budget availability or execute financial actions.

---

# 36. SavingsContribution

A `SavingsContribution` associates an amount with a savings goal.

Conceptual fields:

```text
SavingsContribution
- id
- savingsGoalId
- contributedByProfileId
- amountMinor
- currency
- date
```

### Rules

* Household contributions preserve who contributed.
* Contributions do not imply ownership percentages unless explicitly added later.
* A contribution may correspond to a savings transaction.

---

# 37. Multiple Currencies

Every monetary entity must preserve:

```text
amountMinor
currency
```

Never overwrite the original transaction currency during conversion.

Example:

```text
Original:
UYU 1500

Reporting:
USD 37.50
```

The original remains:

```text
UYU 1500
```

---

# 38. ExchangeRateSnapshot

An `ExchangeRateSnapshot` represents the conversion rate used for historical reporting.

Conceptual fields:

```text
ExchangeRateSnapshot
- id
- sourceCurrency
- targetCurrency
- rate
- effectiveAt
- source
```

A transaction or report may reference the rate used.

### Rules

* Historical converted values must remain reproducible.
* Current exchange rates must not silently rewrite historical reports.
* Rates require precision beyond ordinary money minor units.

Database representation should use exact decimal/numeric storage.

---

# 39. Base Currency

Each profile has a reporting `baseCurrency`.

A household may also define a household reporting currency.

Base currency is used for aggregation and reporting.

It does not replace original transaction currencies.

---

# 40. Month Closing

Closing a `BudgetPeriod` means its financial state is considered finalized.

At minimum, closing records:

```text
status = CLOSED
closedAt
```

Future versions may store summary snapshots.

### Rules

* Closed periods should not be editable without reopening.
* Reopening must be explicit.
* Reopening must not silently destroy historical data.
* Changes after reopening should be traceable.

---

# 41. Historical Integrity

Historical records must remain meaningful even when configuration changes.

Examples:

Changing:

```text
Budget percentages
Household default split
Category names
Savings strategy
```

must not silently rewrite historical financial responsibility or allocations.

Where historical meaning depends on mutable configuration, the relevant historical value must be copied or snapshotted.

---

# 42. Soft Deletion

Financial entities should prefer soft deletion where practical.

Conceptual field:

```text
deletedAt
```

### Rules

* Deleted records do not participate in normal calculations.
* Deleted records remain available for recovery/debugging according to retention policy.
* Hard deletion may later exist for privacy/account-deletion requirements.

Soft deletion is an operational rule, not a substitute for proper audit history.

---

# 43. Derived Values

Whenever possible, avoid storing values that can be safely and deterministically derived.

Examples of potentially derived values:

```text
remainingBudget
householdBalance
totalSpentByCategory
availableToSpend
```

However, historical snapshots may be stored where recomputation would otherwise depend on mutable information.

The choice between derived and persisted values must be documented.

---

# 44. Safe-to-Spend

`SafeToSpend` is a derived product concept, not a transaction.

Conceptually:

```text
spendableBudget
- consumedBudget
- confirmedCommittedBudget
= safeToSpend
```

Protected savings are excluded from ordinary spendable budget.

Estimated commitments should be displayed separately rather than silently treated as exact.

FIN-120 / ADR-073 completes this formula: monthly rounded received-income SPENDABLE
allocation minus all active actual expenses minus additional savings contributions
plus explicit savings withdrawals minus current confirmed commitments. Goal movements
are already included once. Negative results remain negative; expected income and
protected reserves never supply ordinary funds. This is a monthly budget margin,
not a bank balance or global solvency claim.

Known estimates are separate: show the exact margin before estimates and an explicitly
approximate margin after known estimates, including zero estimates. With any current
unknown obligation, older unresolved obligation, or no configured complete plan,
withhold every numerical availability margin and explain the missing information.
Invalid/error/refreshing snapshots also withhold the figure. Components remain facts,
not available money. All inputs must come from one complete consistent server snapshot.
This decision was made under delegated authority and awaits owner review.

---

# 45. Expected vs Actual Income

Expected income is planning information.

Actual income comes from income transactions.

Example:

```text
Expected: USD 1500
Received: USD 1000
```

The application must not imply that the missing USD 500 is available.

Budget planning and actual availability may therefore differ.

---

# 46. Budget Calculation

For a budget period:

```text
actualAllocatedAmount =
actualReceivedIncome
× allocationPercentage
```

Example:

```text
Actual received income = USD 1430

Needs 50%
Leisure 30%
Savings 20%
```

Results:

```text
Needs   USD 715
Leisure USD 429
Savings USD 286
```

Percentage arithmetic must follow deterministic rounding rules.

---

# 47. Incremental Income

A period may receive multiple income transactions.

Example:

```text
Sep 01 + USD 1000
Sep 15 + USD 500
```

Total actual income:

```text
USD 1500
```

Budget availability may increase as income is received.

The application should not require all monthly income to arrive in a single transaction.

---

# 48. Budget Reallocation

When budget percentages change during an open period:

* transactions remain unchanged;
* allocation percentages change;
* available amounts are recalculated;
* prior periods remain unchanged.

If a bucket becomes over-consumed after the change, the product should show the resulting deficit.

The system must not rewrite expenses to make the new percentages fit.

---

# 49. Overspending

A spendable bucket may become negative.

Example:

```text
Leisure allocation: USD 300
Leisure spending:   USD 340

Remaining:          USD -40
```

This is valid domain state.

The application should warn the user.

It must not automatically:

* take money from savings;
* move money from another bucket;
* alter historical expenses.

Any reallocation must be explicit.

---

# 50. Household Expense With Multiple Payers

The initial UX may support one payer per expense.

The domain should avoid making multiple payers impossible forever.

Future example:

```text
Expense total: UYU 5000

Andy paid: UYU 3000
Partner paid: UYU 2000
```

This may later require a separate `SharedExpensePayment` entity.

Do not introduce it in the MVP unless required.

---

# 51. Split Strategies

Conceptually, shared expenses may support:

```text
PERCENTAGE
EQUAL
FIXED_AMOUNT
```

Initial implementation should prioritize:

```text
PERCENTAGE
```

An equal split is simply a generated percentage distribution.

Fixed amount splits may be introduced later.

---

# 52. Domain Services

Some rules do not naturally belong to one entity.

These should be implemented through deterministic domain functions/services.

Examples:

```text
calculateBudgetAllocation()
calculateSharedExpenseSplit()
calculateHouseholdBalances()
calculateBudgetImpact()
calculateCashImpact()
calculateSafeToSpend()
calculateSavingsAvailability()
convertMoney()
closeBudgetPeriod()
```

These functions must be testable independently from UI and AI layers.

---

# 53. Application Use Cases

UI, Siri, voice, and assistant integrations should invoke shared application use cases.

Examples:

```text
CreateIncome
CreatePersonalExpense
CreateSharedExpense
CreateSettlement
CreateSavingsContribution
WithdrawSavings
UpdateBudgetAllocation
CloseBudgetPeriod
CreateRecurringExpense
ResolveRecurringExpense
```

External interfaces must not duplicate domain calculations.

---

# 54. AI Boundary

AI may produce structured intent.

Example:

```json
{
  "action": "create_shared_expense",
  "amountMinor": 220000,
  "currency": "UYU",
  "category": "groceries",
  "payer": "current_user"
}
```

AI must not determine authoritative:

* budget balances;
* household debt;
* split amounts;
* safe-to-spend values;
* currency arithmetic;
* savings availability.

Those belong to deterministic domain logic.

---

# 55. Domain Validation

Invalid operations must fail before persistence where practical.

Examples:

* budget percentages do not total 100%;
* household split does not total 100%;
* settlement amount is non-positive;
* payer is not a household member;
* expense amount is zero or negative;
* unsupported currency;
* personal record references a household;
* household record references a personal owner;
* savings withdrawal exceeds an enforced available amount where applicable.

Database constraints should also enforce critical invariants where possible.

---

# 56. Database vs Application Enforcement

Critical rules should not rely only on client validation.

Use database constraints and RLS where applicable.

Examples:

Database-level candidates:

```text
positive monetary amounts
valid scope ownership
unique memberships
split constraints where feasible
foreign-key integrity
```

Application/domain-level candidates:

```text
split rounding
safe-to-spend calculation
month closing workflow
budget recalculation
balance derivation
```

Defense in depth is preferred for financially important invariants.

---

# 57. Audit-Relevant Actions

The system should preserve traceability for meaningful changes such as:

* changing budget percentages;
* changing household default splits;
* reopening a closed period;
* withdrawing savings;
* editing shared expense responsibility;
* deleting financial records;
* recording settlements.

A dedicated audit-log model may be introduced when necessary.

Until then, timestamps and immutable historical snapshots must not be discarded.

---

# 58. Privacy Invariant

The most important authorization invariant is:

```text
A household member must never gain read access
to another member's personal financial data
through household membership.
```

This applies to:

* direct queries;
* joins;
* views;
* RPC functions;
* reports;
* realtime subscriptions;
* APIs;
* assistant tools;
* background processes.

Any feature that violates this invariant is invalid regardless of UI behavior.

---

# 59. Domain Invariants Summary

The following invariants are foundational.

1. Personal and household financial scopes are distinct.
2. Household membership does not expose personal data.
3. Budget allocations belong to a specific period.
4. Budget allocation percentages total 100%.
5. Shared expense split percentages total 100%.
6. Split amounts total the exact original expense amount.
7. Money arithmetic must not use floating-point approximation.
8. Payer and financial responsibility are separate.
9. Shared budget impact is based on responsibility, not amount paid.
10. Cash impact and budget impact are separate concepts.
11. Savings are never consumed implicitly.
12. Transfers are not expenses.
13. Credit card settlement must not duplicate purchase expenses.
14. Recurring expense templates are not automatically actual expenses.
15. Original transaction currency is immutable historical information.
16. Historical splits and budget allocations must survive configuration changes.
17. AI cannot be the authority for financial calculations.
18. All interfaces use the same application/domain logic.
19. Closed periods require explicit reopening before modification.
20. Financial records should support recoverable correction.
21. Derived financial values must be deterministic and explainable.
22. Critical security and financial rules must not rely exclusively on client-side validation.

---

# 60. Open Domain Decisions

The following decisions are intentionally not finalized yet and must not be guessed during implementation:

1. Whether users can belong to multiple active households in MVP.
2. Exact household invitation lifecycle.
3. Whether household categories are global, household-owned, or mapped from personal categories.
4. Exact representation of credit-card liabilities and statements.
5. Whether fixed recurring expenses auto-create transactions.
6. Whether multiple payers per shared expense are included before Phase 2 completion.
7. Exact exchange-rate provider.
8. Exact behavior when users transact in currencies different from a budget period's base currency.
9. Exact account-balance model.
10. Personal transaction restore UI is resolved by ADR-074; other record recovery remains open.
11. Personal transaction correction audit is resolved by ADR-074; broader audit retention remains open.
12. Phase 1 safe-to-spend formula and uncertainty treatment: resolved by ADR-073
    under delegated authority, pending owner review; later account/payment models remain open.

If an implementation requires one of these decisions, the decision must be made explicitly first.

---

# 61. Related Documentation

Before implementing domain logic, also consult:

* `PRODUCT.md` — intended product behavior;
* `SECURITY.md` — authorization and privacy;
* `ARCHITECTURE.md` — system boundaries and technical structure;
* `DECISIONS.md` — accepted architectural decisions;
* `ROADMAP.md` — implementation scope;
* `AGENTS.md` — development instructions.

No implementation should introduce a new domain rule solely because it is convenient for the current code.

## FIN-118 monthly variable resolution

A pending variable obligation is derived from its immutable template and canonical
month. An actual EXPENSE stores insert-only recurring-template/month fields, unique
per owner/template/month including soft-deleted records. Its transaction identity is
the permanent actual linkage; immutable template terms preserve the obligation.
Explicit resolution accepts a positive actual amount and financial date in that open
month, using the template's original currency/category and ordinary expense guards.
It affects cash, spending and budget consumption once, with no savings withdrawal.

Later stop does not remove linked history. Soft-deleting the actual cancels that
month's obligation, not just its payment: it is visible as cancelled and never pending
again. FIN-119 must exclude linked tombstones as well as active actuals from further
commitments. Restore reuses the same ID with ordinary restoration validation, even
after a later stop. FIN-122 delete confirmation must explain this cancellation effect;
correction cannot relink or silently create another actual for that occurrence.


## FIN-119 monthly commitments

ADR-072 defines confirmed FIXED obligations separately from known VARIABLE estimates
and unknown variable amounts. These are not actual expenses or available cash.
The selected month's total includes all unresolved occurrences, even past due days;
any linked transaction (including cancelled/soft-deleted) excludes the occurrence.
Archived and unallocated historical spendable mappings remain included. Unsupported
currency or invalid monthly mappings fail the calculation, never imply extra money.

Earlier unresolved occurrences have a separate count and warning, not a carried
monetary total. Cross-period payments remain unsupported: the actual payment date
must belong to its original month; never backdate a later payment to clear a warning.
FIN-120 must withhold numerical safe-to-spend with older unresolved obligations;
FIN-123/125 must explicitly surface unresolved obligations. Current reads are not
historical snapshots. FIXED initial confirmation equals the original template amount
and creates one actual expense through the existing resolve path, with ordinary
cash/spending/budget impact once and no automatic savings withdrawal. Corrections
remain explicit FIN-122 work; original occurrence identity must survive them.


## FIN-122 bounded financial corrections

ADR-074 defines same-month, same-currency corrections with server-owned revisions
and immutable before/after history. Income corrections affect received allocations;
expense corrections affect cash/spending/consumption once; savings corrections affect
only the original general/goal reserve and that month's ordinary adjustment. Nothing
automatically withdraws savings. Contributions increased by correction require funding
for the delta, without retroactively forbidding later ordinary overspending. Every
historical monthly goal and unassigned reserve stays solvent. No edit blesses legacy
unvalidated funding. Delete/restore removes/reapplies the original type's effects.

Only non-recurring expenses can change category. Recurring actual amounts and dates
may be deliberately corrected, but the original category/template/month/transaction
identity stays fixed. Tombstones cancel the monthly obligation and remain recoverable
after template stop under the same guards; corrected FIXED amounts survive restoration.
Dates cannot cross the original month or be backdated to clear an older obligation.
Closed periods deny new corrections. Exact request replay is read-only and returns its
recorded revision, not a claim that no later correction exists.

## FIN-123 completed-month close

ADR-075 makes closing explicit, server-timezone-authoritative and unavailable while
any selected-month or prior obligation is unresolved. It records OPEN → CLOSED,
closed time, a monotonic lifecycle version and immutable as-of summary evidence.
The summary is historical, including cumulative savings as observed at that instant;
later authorized older-month corrections do not rewrite it. Bucket deficits remain
negative and unconfigured availability remains unknown. Closing moves no money,
cancels no obligations and implies no rollover or remainder disposition. A stale
preview/version conflicts; exact UUID replay only reads the original result.

## FIN-124 explicit reopening

ADR-076 records CLOSED → OPEN as an explicit, confirmed, version-checked action with
immutable reopening evidence. It clears the live closed timestamp, not past closure
history. Legacy closes retain their original timestamp without an invented summary.
Every new lifecycle advances the server version; old exact request replay is read-only
and cannot reopen a later close. Corrections then use existing rules, including savings
solvency and traceable transaction revisions. Reopening has zero cash, budget, spending
and savings impact; no automatic reclose or remainder disposition occurs.

## FIN-125 explicit net remainder

ADR-077 preserves 10000bps on received income. Cash-neutral carry is a separate
same-currency ordinary credit from one completed month to the immediately next month,
explicitly assigned to a spendable destination bucket or left in an unallocated pool.
It is not income and never receives a second percentage split or savings allocation.
Net ordinary remainder adds incoming carry and subtracts outgoing carry. All savings
contribution funding checks use that same net remainder; protected savings allocations
and every goal/general historical prefix remain unchanged. Positive gross bucket
residuals are informative, not independent transfer limits; deficits and unattributed
extra contributions/withdrawals participate in the global cap.

A confirmed atomic close-and-dispose operation checks live pre-action facts/version,
creates one additional general savings contribution or carry, and saves immutable
post-action close evidence. It requires a completed OPEN configured source and no
selected/prior unresolved obligations. Carry requires the next owned OPEN configured
same-currency month and an explicit eligible destination. Undisposed money remains
historical, not automatically usable later. Savings are never rolled twice.

Active outbound carry blocks new source reopening. Explicit reversal and source
reopening occur together, retaining both histories, only when the destination is OPEN,
configured, has no selected/prior unresolved obligations and retains sufficient net
ordinary funds. Downstream carries must be dealt with explicitly; no automatic reversal,
savings use or backdating. Old exact requests remain read-only after later lifecycle
changes. Versioned saved summaries are historical evidence, never current authority.
