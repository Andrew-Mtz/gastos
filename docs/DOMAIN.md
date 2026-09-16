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

---

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

The exact formula may evolve as the product matures, but it must remain deterministic and explainable.

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
10. Whether soft-deleted financial data is user-restorable through the UI.
11. Exact audit-log implementation.
12. Exact formula and treatment of estimated obligations within `SafeToSpend`.

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
