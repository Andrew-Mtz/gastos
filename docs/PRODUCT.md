# Product Specification

**Version:** 0.1
**Status:** Active
**Last updated:** 2026-09-09

This document is the functional source of truth for the product.

If implementation details, UI decisions, technical assumptions, or generated code conflict with this document, this document takes precedence unless the product specification is explicitly updated.

---

# 1. Product Overview

The product is a personal and household finance management application designed for individuals and couples who want to:

* understand where their money goes;
* define how their income should be allocated before spending it;
* control how much they can safely spend;
* protect savings from accidental overspending;
* manage recurring personal expenses;
* manage shared household expenses without exposing private financial information;
* automatically split shared expenses between household members;
* track who paid versus who was financially responsible;
* understand balances owed between household members;
* manage personal and shared savings goals;
* register financial activity quickly through text, voice, Siri, or other assistants;
* receive useful recommendations based on actual spending behavior.

The product is not intended to behave merely as an expense tracker.

Its core purpose is to answer two questions:

> How much of the money I currently have can I actually spend?

and:

> How much should each household member pay without requiring us to merge or expose our personal finances?

---

# 2. Core Product Principles

## 2.1 Privacy by default

Every user has a private financial space.

Household membership does not grant access to another user's personal financial information.

A user's partner or household member must not be able to access:

* personal income;
* personal expenses;
* personal budgets;
* personal categories when those categories contain private information;
* personal savings;
* personal savings goals;
* personal financial accounts;
* personal credit card activity;
* personal transaction history;
* personal financial projections.

Household members only share information explicitly created within household scope.

Privacy must be enforced by the backend and database security model, not only by hiding information in the UI.

---

## 2.2 Plan before spending

The application should encourage users to decide what their income is for before spending it.

Income is allocated into budget buckets such as:

* Needs;
* Leisure;
* Savings.

The product may offer recommended allocation strategies, but users must be able to define their own percentages.

---

## 2.3 Savings are protected

Savings are considered unavailable for ordinary spending.

If part of an income is allocated to savings, that amount should no longer appear as ordinary spendable money.

Savings may still be withdrawn when necessary, but using them must be an explicit user action.

Savings must never be consumed automatically to compensate for overspending.

---

## 2.4 Shared finances do not mean merged finances

Users can manage a household together while retaining completely independent personal finances.

The application must support both:

* personal financial activity;
* household financial activity.

These concepts must remain distinct throughout the product.

---

## 2.5 Fast data entry

Registering an expense should require as little effort as possible.

Users should eventually be able to say or type natural-language commands such as:

* "I spent 800 pesos on food."
* "The water bill was 890 pesos."
* "We spent 2200 at the supermarket and I paid."
* "Move 300 dollars to savings."
* "How much leisure money do I have left?"

Voice and assistant capabilities are product features, not separate financial systems.

They must operate on the same business rules as the standard UI.

---

# 3. User Financial Spaces

Each user can interact with two main financial scopes.

## 3.1 Personal space

The personal space contains information visible only to that user.

It includes:

* income;
* personal expenses;
* personal recurring expenses;
* personal budget allocation;
* personal savings;
* personal savings goals;
* credit cards;
* accounts;
* personal transaction history;
* personal financial reports;
* personal projections.

---

## 3.2 Household space

A household is a shared financial space between two or more users.

It can contain:

* household expenses;
* recurring household expenses;
* household expense split rules;
* records of who paid;
* each member's financial responsibility;
* balances between members;
* settlements;
* shared savings goals;
* shared funds;
* household financial history.

Only household-scoped information is visible to other household members.

---

# 4. Income

Users can register one or multiple income sources.

Examples:

* salary;
* contractor income;
* freelance payments;
* bonuses;
* reimbursements;
* other income.

The product should support both:

* expected income;
* actual received income.

Example:

```text
Expected income: USD 1,500
Actual income:   USD 1,430
```

Budget planning may initially use expected income.

Actual financial availability should ultimately reflect money that was actually received.

The product must support variable-income users.

---

# 5. Budget System

## 5.1 Percentage-based budgeting

Users allocate their income using percentages.

Example:

```text
Needs      50%
Leisure    30%
Savings    20%
```

For USD 1,500:

```text
Needs      USD 750
Leisure    USD 450
Savings    USD 300
```

Budget percentages must total 100%.

---

## 5.2 Recommended budget strategies

The application may provide predefined configurations such as:

### Balanced

```text
Needs      50%
Leisure    30%
Savings    20%
```

### Saver

```text
Needs      50%
Leisure    20%
Savings    30%
```

### Aggressive saving

```text
Needs      45%
Leisure    15%
Savings    40%
```

### Custom

The user defines all percentages.

Recommended configurations are suggestions only.

The product must not imply that one distribution is universally financially correct.

---

# 6. Budget Buckets and Categories

Budget buckets and expense categories are separate concepts.

## 6.1 Budget bucket

A budget bucket determines what portion of income is reserved for a broader financial purpose.

Examples:

* Needs;
* Leisure;
* Savings.

---

## 6.2 Category

A category explains where money was spent.

Examples:

```text
Needs
├── Rent
├── Electricity
├── Water
├── Internet
├── Groceries
└── Transportation

Leisure
├── Restaurants
├── Clothing
├── Games
└── Entertainment
```

Users should eventually be able to create custom categories.

Categories should map to a budget bucket where applicable.

---

# 7. Budget Periods

Financial planning is organized into budget periods.

For the initial product, a budget period corresponds to a calendar month.

Example:

```text
September 1 → September 30
October 1   → October 31
```

The architecture should not unnecessarily prevent supporting custom financial periods later.

Each period preserves its own budget configuration.

Changing October's percentages must not alter September.

---

# 8. Changing Budget Percentages

Users may change their budget allocation.

Example:

Before:

```text
Needs      50%
Leisure    30%
Savings    20%
```

After:

```text
Needs      55%
Leisure    20%
Savings    25%
```

Changing a period must not modify historical periods.

If percentages are modified during the current period, the application should display the financial impact before confirmation.

---

# 9. Protected Savings

When income is received and part of it is allocated to savings, the savings allocation should not appear as ordinary spendable money.

Example:

```text
Income             USD 1,500
Savings allocation USD   300
Spendable          USD 1,200
```

If the user attempts to exceed spendable budgets, the application should not silently consume savings.

The user may explicitly choose to withdraw from savings.

Such actions should be visible in financial history.

---

# 10. Savings Goals

Users can create savings goals.

Examples:

* emergency fund;
* trip;
* vehicle;
* home;
* investment goal.

A savings goal can include:

* name;
* target amount;
* current amount;
* currency;
* optional target date;
* contribution history.

Savings goals can be:

* personal;
* household.

Personal savings goals are private.

Household savings goals are visible to household members.

---

# 11. Shared Household Expenses

Household members can register shared expenses.

Example:

```text
Water bill
Total: UYU 800
```

The household may have a default expense distribution:

```text
Member A: 70%
Member B: 30%
```

The application calculates:

```text
Member A responsibility: UYU 560
Member B responsibility: UYU 240
```

The amount can change every month while preserving the configured split.

---

# 12. Default Household Split

A household can define a default split.

Examples:

```text
70 / 30
50 / 50
60 / 40
```

The default split is used as a template when creating shared expenses.

Individual expenses may override the household default.

Example:

Default:

```text
70 / 30
```

Specific expense:

```text
50 / 50
```

Historical expenses must preserve the split used when they were created.

Changing the household's default split must not modify past expenses.

---

# 13. Payer vs Responsibility

Who paid an expense and who is responsible for the expense are independent concepts.

Example:

```text
Expense: UYU 2,000

Responsibility:
Member A: UYU 1,400
Member B: UYU   600
```

If Member A pays the full UYU 2,000:

```text
Member A paid: UYU 2,000
Member A responsibility: UYU 1,400
Member B responsibility: UYU 600
```

The resulting balance is:

```text
Member B owes Member A: UYU 600
```

The application must not infer responsibility from the payer.

---

# 14. Household Balances

The product tracks money owed between household members.

Example:

```text
Current balance

Member B → Member A
UYU 3,450
```

Balances are derived from:

* payments;
* responsibility splits;
* settlements;
* applicable adjustments.

A household member can register a settlement.

Example:

```text
Member B pays Member A UYU 3,450
```

Result:

```text
Outstanding balance: UYU 0
```

A settlement is not an expense.

---

# 15. Shared Expenses and Personal Budgets

A shared household expense affects a user's personal budget according to that user's responsibility, not necessarily according to the amount that user physically paid.

Example:

```text
Supermarket total: UYU 1,000

Member A responsibility: 70% = UYU 700
Member B responsibility: 30% = UYU 300

Member A paid: UYU 1,000
```

For Member A:

```text
Budget impact: UYU 700
Cash impact:   UYU 1,000
Receivable:    UYU 300
```

This distinction must be preserved throughout the product.

---

# 16. Cash Impact vs Budget Impact

The product must distinguish:

## Cash impact

How much money actually entered or left the user's possession.

## Budget impact

How much of a financial obligation belongs to that user.

These values may differ.

This is especially important for shared expenses, reimbursements, credit cards, transfers, and settlements.

---

# 17. Recurring Expenses

Users can define recurring expenses.

Examples:

* rent;
* internet;
* electricity;
* water;
* insurance;
* subscriptions.

Recurring expenses can be:

* personal;
* household.

They may also be:

* fixed amount;
* variable amount.

---

## 17.1 Fixed recurring expenses

Example:

```text
Rent
UYU 25,000
Monthly
Due day: 5
```

The product may eventually allow automatic creation or confirmation.

---

## 17.2 Variable recurring expenses

Example:

```text
Electricity
Monthly
Amount: variable
```

The recurring definition acts as a template.

The application should remind the user that the amount is pending.

A real expense is only created when the actual amount becomes known.

Example voice command:

> "Electricity was 2,840 pesos this month."

---

# 18. Committed Money

The application should help users distinguish current balances from money that is already financially committed.

Example:

```text
Available budget:       UYU 30,000
Confirmed obligations:  UYU 18,000
Estimated obligations:  UYU  4,000
```

The app can therefore show:

```text
Potentially free money: approximately UYU 8,000
```

Confirmed and estimated obligations should remain distinguishable.

The product should avoid showing false precision when future variable expenses are unknown.

---

# 19. Credit Cards

Credit cards must not be treated as expense categories.

Example purchase:

```text
Steam
USD 50
Paid with VISA
Category: Games
Bucket: Leisure
```

The expense is recognized when the purchase is registered.

When the user later pays the credit card statement, that payment must not create the same expense again.

Otherwise the application would double count spending.

A credit card payment represents movement of money or debt settlement, not a new purchase.

---

# 20. Financial Accounts

The product should eventually support financial accounts such as:

* bank accounts;
* cash;
* credit cards;
* savings accounts;
* digital wallets.

Budget allocation and financial accounts are separate concepts.

Allocating USD 300 to savings does not necessarily mean USD 300 was physically transferred to another bank account.

Account transfers should not be counted as expenses.

---

# 21. Multiple Currencies

The application must support multiple currencies.

Initial priority currencies include:

* UYU;
* USD.

A user may receive income in one currency and have expenses in another.

Example:

```text
Income:
USD 4,500

Expenses:
UYU 35,000 rent
UYU 2,000 internet
USD 40 subscriptions
```

Each transaction must preserve its original currency and original amount.

Historical transaction values must not change merely because current exchange rates change.

Users should define a base currency for reporting.

---

# 22. Exchange Rates

When transactions need to be consolidated into a base currency, the application should preserve the exchange rate used for that transaction or calculation.

Historical financial reports must remain stable.

Exchange rates may initially be entered manually if automatic exchange-rate functionality is not yet implemented.

Automatic exchange-rate retrieval is not required for the first MVP.

---

# 23. Monthly Dashboard

The personal dashboard should prioritize actionable information rather than excessive charts.

Primary information should include:

* income received;
* expected income where relevant;
* amount allocated to savings;
* spendable money;
* amount spent by budget bucket;
* remaining budget;
* committed expenses;
* upcoming recurring expenses;
* money considered truly available;
* current savings;
* spending breakdown by category.

Example:

```text
SEPTEMBER

Income received
USD 1,500

Protected savings
USD 300

Spendable
USD 1,200
```

Then:

```text
Needs
USD 540 / USD 750
72%

Remaining
USD 210
```

```text
Leisure
USD 190 / USD 450
42%

Remaining
USD 260
```

---

# 24. Household Dashboard

The household dashboard should focus only on shared finances.

Example:

```text
HOUSEHOLD — SEPTEMBER

Total shared expenses
UYU 72,480

Member A responsibility
UYU 50,736

Member B responsibility
UYU 21,744
```

It should also show:

* what each member actually paid;
* outstanding balances;
* upcoming household expenses;
* shared savings goals;
* unresolved variable recurring expenses.

It must not reveal either member's personal financial information.

---

# 25. Month Closing

Users can close a completed financial period.

At closing, the application summarizes:

* total income;
* total spending;
* bucket consumption;
* savings;
* remaining money;
* deficits;
* household balances;
* relevant outstanding obligations.

A closed period preserves historical state.

Editing a closed period should require explicitly reopening it.

---

# 26. Remaining Budget at Month End

If a budget bucket has money remaining at the end of the period, the user should be informed.

Example:

```text
Leisure budget: USD 450
Spent:          USD 310
Remaining:      USD 140
```

Possible actions include:

* move the remainder to savings;
* roll it over into the next period;
* redistribute it;
* keep it as unallocated available money.

Future versions may allow automatic rules.

Example:

```text
70% → Savings
30% → Next month's Leisure
```

---

# 27. Overspending

The application should warn users when they approach or exceed a budget.

Examples:

```text
You have used 80% of your Leisure budget.
```

```text
You only have USD 35 remaining in Leisure.
```

Savings must not be automatically used to cover overspending.

The product should inform and assist, not silently modify the user's financial plan.

---

# 28. Financial Projections

The application should eventually estimate whether current spending behavior is sustainable for the remainder of the financial period.

Example:

```text
Leisure budget: USD 450
Current spending: USD 183

At your current pace, projected month-end spending is USD 510.
```

The goal is to warn users before they exceed a budget rather than only reporting the problem afterward.

Projection logic must be deterministic and explainable.

---

# 29. Financial Insights

Future versions may provide insights such as:

* category spending trends;
* month-over-month changes;
* unusual expenses;
* repeated overspending;
* possible budget adjustments;
* savings progress;
* projected month-end results.

Example:

```text
Your Needs budget is configured at 50%, but during the last three months your actual usage ranged between 58% and 63%.
```

The application may recommend a different allocation.

The user always decides whether to apply it.

---

# 30. Quick Expense Entry

A primary product goal is reducing the effort required to record financial activity.

The app should eventually support a quick-entry flow such as:

```text
Amount
Category
Personal / Household
Paid by
```

The most common actions should take only a few seconds.

---

# 31. Natural Language Assistant

The application should support natural-language financial commands.

Examples:

> "I spent 500 pesos on food."

> "We spent 2,200 at the supermarket and I paid."

> "The water bill was 890 pesos."

> "Move 300 dollars to savings."

> "How much leisure money do I have left?"

> "How much did I spend on food this month?"

> "How much does my partner owe me?"

The assistant should interpret user intent and translate it into structured application actions.

The assistant must not independently invent financial rules or perform financial arithmetic outside the application's deterministic domain logic.

---

# 32. Voice Interaction

Users should eventually be able to perform the same natural-language operations through voice.

Voice interaction should be optimized for situations where manual entry is inconvenient.

Typical use case:

A user makes a purchase and immediately says:

> "I spent 850 pesos on food."

The application records the expense without requiring the user to navigate through multiple screens.

---

# 33. Siri Integration

On iOS, the product should eventually integrate with Siri and App Intents.

Possible commands include:

> "I spent 850 pesos on food."

> "Register 1200 pesos in games."

> "How much leisure money do I have left?"

Siri must use the same application business logic as the manual UI and internal assistant.

Siri must not maintain a separate financial implementation.

---

# 34. Assistant Confirmation Rules

Simple, unambiguous operations may be registered directly.

Example:

> "I spent 300 pesos on groceries."

The app may respond:

```text
✓ UYU 300 registered in Groceries.
```

Potentially destructive, ambiguous, or financially significant operations should require confirmation.

Examples include:

* withdrawing from savings;
* deleting financial history;
* changing budget percentages;
* changing household splits;
* settling balances;
* moving large amounts;
* interpreting ambiguous amounts or categories.

---

# 35. Deterministic Financial Logic

AI may interpret language.

AI must not be the source of truth for financial calculations.

Example:

The assistant may interpret:

```text
Operation: Create shared expense
Amount: UYU 890
Category: Groceries
Payer: Current user
```

The application domain layer must calculate:

* split;
* each member's responsibility;
* budget impact;
* cash impact;
* outstanding balance.

Financial calculations must be deterministic and testable.

---

# 36. Transaction History

Users should have access to chronological financial history.

Transactions should clearly indicate:

* amount;
* currency;
* date;
* category;
* type;
* scope;
* payment source where applicable;
* whether the expense is shared;
* payer;
* user's responsibility;
* notes where applicable.

Household history only contains household-visible information.

---

# 37. Transaction Types

The product must distinguish different financial operations.

Examples include:

* income;
* expense;
* transfer;
* savings contribution;
* savings withdrawal;
* household settlement;
* refund;
* reimbursement.

Not every money movement is an expense.

The application must avoid double counting financial activity.

---

# 38. Deletion and Corrections

Users must be able to correct mistakes.

Financial records should initially use recoverable deletion rather than destructive permanent deletion where practical.

Deleted records should stop affecting normal financial calculations.

The product should preserve sufficient history for debugging and accidental recovery.

---

# 39. Product Notifications

The application may eventually notify users about:

* upcoming expenses;
* variable bills awaiting an amount;
* approaching budget limits;
* exceeded budgets;
* monthly closing;
* unusual spending;
* available money remaining at month end;
* savings milestones;
* household balances.

Notifications should be useful and actionable rather than frequent or noisy.

---

# 40. Household Savings

Households may create shared savings goals.

Example:

```text
Vacation
Target: USD 3,000
Current: USD 1,220
```

Contributions can be recorded independently.

Example:

```text
Member A: USD 500
Member B: USD 350
```

Shared savings information is visible to household members.

Personal savings remain private.

---

# 41. Household Membership

A user may join a household through an invitation flow.

Initial product assumptions:

* household membership is explicit;
* joining a household never exposes personal data;
* leaving a household must preserve historical shared records;
* household roles and permissions may be expanded later.

The first version is primarily optimized for couples, but the domain should avoid unnecessary assumptions that permanently restrict households to exactly two members.

---

# 42. Reports

The product should eventually provide reports such as:

* spending by category;
* spending by budget bucket;
* month-over-month spending;
* income vs expenses;
* savings rate;
* savings goal progress;
* recurring expense totals;
* household spending;
* personal responsibility within household spending.

Reports must respect privacy boundaries.

---

# 43. Product Success Criteria

The application is successful if a user can easily answer:

### Personal finances

* How much money did I receive this month?
* How much have I spent?
* What did I spend it on?
* How much have I saved?
* How much money is already committed?
* How much can I safely spend today?
* Am I on track to exceed a budget?
* How are my finances changing month over month?

### Household finances

* How much did the household spend?
* What expenses are still pending?
* How much is my responsibility?
* How much did I actually pay?
* Who owes whom?
* How much are we saving together?

---

# 44. MVP Strategy

The application will be developed incrementally.

Features must not be implemented merely because they appear in this complete product specification.

The roadmap determines implementation order.

The product specification describes the intended product; the roadmap defines what is currently in scope.

---

# 45. Initial Product Phases

## Phase 0 — Foundations

* Expo / React Native project;
* TypeScript;
* navigation;
* Supabase integration;
* authentication;
* database migrations;
* Row Level Security;
* base project structure;
* testing;
* CI;
* iOS development build.

---

## Phase 1 — Personal Finance

* income;
* personal expenses;
* categories;
* budget buckets;
* percentage allocation;
* protected savings;
* recurring personal expenses;
* current-period dashboard;
* committed money;
* month closing.

---

## Phase 2 — Household Finance

* household creation;
* invitations;
* membership;
* default split;
* shared expenses;
* custom splits;
* payer tracking;
* responsibility tracking;
* balances;
* settlements;
* shared recurring expenses;
* shared savings goals.

---

## Phase 3 — Financial Accounts and Credit Cards

* financial accounts;
* transfers;
* credit cards;
* card purchases;
* statement handling;
* avoiding duplicate expense recognition.

---

## Phase 4 — Multi-Currency Improvements

* reporting currency;
* exchange-rate snapshots;
* currency conversion;
* consolidated reports.

---

## Phase 5 — Quick Entry

* optimized expense registration;
* recent categories;
* defaults;
* shortcuts;
* widgets where appropriate.

---

## Phase 6 — Natural Language and Voice

* text commands;
* voice input;
* structured financial intents;
* assistant queries;
* confirmation rules.

---

## Phase 7 — Siri

* iOS App Intents;
* Siri commands;
* voice financial queries;
* quick expense registration through Siri.

---

## Phase 8 — Financial Intelligence

* spending projections;
* trend detection;
* unusual spending;
* budget recommendations;
* savings recommendations;
* personalized insights.

---

# 46. Explicit Non-Goals for the Initial MVP

The first versions should not attempt to provide:

* bank account aggregation;
* automatic bank transaction importing;
* investment portfolio management;
* stock trading;
* cryptocurrency trading;
* accounting software for businesses;
* tax preparation;
* lending;
* financial advisory services;
* autonomous financial decisions;
* fully autonomous AI agents modifying user finances;
* complex social functionality.

These features may be reconsidered later but must not increase the complexity of the initial product.

---

# 47. UX Direction

The interface should prioritize:

* clarity;
* speed;
* low cognitive load;
* immediate understanding of available money;
* obvious distinction between personal and household finances;
* clear warnings without unnecessary friction.

The app should not become a dashboard filled with charts simply because financial data is available.

Primary actions and current financial status should take precedence over analytics.

---

# 48. Main Product Metric

The most important number shown to the user should eventually represent:

> Money that is actually safe to spend.

This calculation may consider:

* income received;
* protected savings;
* money already spent;
* current budget allocation;
* confirmed committed expenses;
* applicable household responsibilities.

Estimated future expenses may be shown separately.

---

# 49. Product Invariants

The following rules are considered foundational.

1. Personal finances and household finances are separate.
2. Household membership does not expose personal financial information.
3. Budget allocation is percentage-based and totals 100%.
4. Budget configuration is historical and belongs to a financial period.
5. Categories and budget buckets are different concepts.
6. Savings cannot be consumed implicitly.
7. Payer and financial responsibility are different concepts.
8. Shared expenses preserve the split used when they were created.
9. Shared expenses affect personal budgets according to responsibility.
10. Cash impact and budget impact are distinct.
11. Transfers and credit card payments must not duplicate expenses.
12. Variable recurring expenses do not become actual expenses until their real amount is known.
13. Transactions preserve their original currency.
14. Financial arithmetic must be deterministic.
15. AI interprets user intent but does not define financial calculations.
16. UI, voice, assistant, and Siri use the same underlying domain operations.
17. Historical financial periods must remain stable.
18. Privacy must be enforced at the data layer.
19. The product must support correcting user mistakes without silently corrupting financial history.
20. The roadmap controls implementation scope; this document controls intended behavior.

---

# 50. Source of Truth

When implementing a feature:

1. Check this document for intended product behavior.
2. Check `DOMAIN.md` for domain entities and business rules.
3. Check `SECURITY.md` for authorization and privacy requirements.
4. Check `ARCHITECTURE.md` for technical boundaries.
5. Check `DECISIONS.md` for architectural decisions.
6. Check `ROADMAP.md` for whether the feature is currently in scope.
7. Follow `AGENTS.md` before making code changes.

If a requested implementation contradicts this document, the contradiction must be identified before implementation.

Do not silently reinterpret product requirements in code.
