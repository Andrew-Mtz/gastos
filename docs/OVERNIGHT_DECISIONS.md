# Phase 1 delegated decisions

The owner authorized implementation through FIN-126 on 2026-10-20, including
reasonable reversible choices recorded here for review on return. These are
explicit delegated implementation decisions, not claims of individual user review.
No hosted data resets, production migrations, deployments, paid services or
credential/security changes are authorized by this log.

## FIN-111: Expense currency and category entry

- Question: How can Phase 1 expenses consume a budget without conversion rules?
- Options: invent conversion; record mixed currencies without reliable consumption;
  temporarily require the period currency.
- Decision: Require the snapshotted budget-period currency for new/restored ordinary
  expenses. Require an active personal category mapped to an active SPENDABLE bucket.
  Provide minimal custom category creation because FIN-107 intentionally had no UI.
- Reason: Preserve exact arithmetic, meaningful category-to-bucket consumption and
  protected savings, while keeping conversion in Phase 4.
- Impact: A different-currency expense cannot yet be registered. No original
  historical amount/currency is rewritten. Archived historical rows remain readable.
  Existing legacy unclassified/mixed-currency expenses are not silently repaired.
- Verification: Database direct-write/RPC negative tests, form/application tests,
  independent review and complete CI required before merge.
- Revisit: Pending owner review; extend with explicit historical conversion later.

## FIN-113: Consumption visibility without an active allocation

- Question: Should spending in a valid spendable bucket disappear when that bucket
  has no active allocation in the period?
- Options: show only configured allocations; include every bucket with actual
  spending as well as configured spendable buckets with zero spending.
- Decision: Include both. Keep archived category/bucket mappings; an absent or
  removed allocation does not erase an expense's original bucket meaning.
- Reason: Actual spending must not be understated or silently reassigned.
- Impact: Consumption is shown even for an unconfigured owned period. It is not a
  remaining balance or safe-to-spend figure. ADR-067's legacy invalid-expense
  rejection remains unchanged; no original record is repaired or rewritten.
- Verification: SQL tests for unallocated, archived and zero-consumption buckets,
  complete aggregates beyond history page limits, plus domain and UI tests.
- Revisit: Pending owner review; later reallocation/closing tasks can reuse these
  complete consumption figures without changing historical classification.

## FIN-114: Protected allocation without premature safe-to-spend

- Question: How should FIN-114 separate savings without implementing FIN-115
  movements or FIN-120's final availability formula early?
- Options: introduce a cumulative savings balance or final spendable balance now;
  expose an exact partition of the existing received-income allocation.
- Decision: Partition FIN-110's already-rounded actual allocations by immutable
  bucket type into protected savings and ordinary spendable allocation. Include
  archived referenced buckets and every savings bucket, not just the default key.
  Missing or invalid classification fails explicitly rather than freeing money.
- Reason: Product rules already exclude savings from ordinary spending. Reusing
  the existing rounded amounts preserves every minor unit and avoids pretending
  that commitments or explicit savings movements have been implemented.
- Impact: Both figures are labeled pre-consumption period allocations, not remaining
  money, safe-to-spend, or cumulative savings. No cash, spending or savings movement
  is created; ordinary overspending neither changes the plan nor withdraws savings.
  No schema, data migration, permission, dependency or generated-type change.
- Verification: Pure exact-arithmetic tests, lifecycle/component tests and real
  PostgreSQL CI assertions for overspending, immutable type and private sources.
- Revisit: Pending owner review. FIN-115 defines explicit movement effects;
  FIN-120 consumes the ordinary allocation and resolves its final formula.


## FIN-115: Explicit savings, denomination and historical availability

- Question: Are savings monthly or cumulative; does a contribution duplicate the
  protected percentage; how do withdrawals, corrections and simultaneous writes work?
- Options: period-only reserves; cumulative explicit contributions without allocated
  savings; cumulative allocated savings plus additional explicit contributions.
- Decision: Use the last option, separately per currency, through each calendar
  month. Round each month's income allocation independently with canonical bucket
  UUID tie-breaking. Additional contributions reduce that month's ordinary remainder
  before commitments; withdrawals increase it. Never duplicate the allocated reserve.
  New/restored contributions require sufficient ordinary remainder before commitments.
  Withdrawals require explicit affirmative confirmation and sufficient cumulative
  protected funds through their month. Every affected historical monthly prefix must
  remain nonnegative, including after deletion/restoration or allocation correction.
- Reason: Savings persist across months without inventing an opening balance or
  spending money from future months. Explicit movements are earmarking, not bank
  transfers, income or spending. Ordinary expenses may still overspend, without
  consuming protected savings or retroactively invalidating valid contributions.
- Impact: No currency conversion, cross-currency spending, account balances, goals,
  ordinary month-end rollover or final safe-to-spend is introduced. Availability is
  month-granular, not an intraday cash ledger. Existing incompatible legacy movements
  remain in history and block a reliable summary until corrected, never silently
  reclassified. A server-managed validation marker is granted only to new/restored
  movements that pass funding checks; legacy contributions cannot invent money.
  Multiple incompatible rows require atomic soft-delete cleanup before eligible
  restoration; closed periods still require reopening. Finite safe-integer bounds
  apply to components and derived balances.
  FIN-122 must retain correction guards; FIN-125 must not duplicate savings rollover.
- Verification: Exact domain arithmetic, SQL authorization and direct-write tests,
  historical-prefix/correction tests, concurrent owner-write SQL tests, idempotent
  retries, confirmation/cancel/navigation/auth/cache tests, independent review and
  exact-head generated types/full CI are required before merge.
- Revisit: Pending owner review; revisit intramonth cash availability with accounts,
  conversion with Phase 4, corrections in FIN-122 and remainder actions in FIN-125.


## FIN-116: Goal funding, sub-reserves and explicit withdrawals

- Question: Does contributing to a goal fund new savings or designate existing
  protected money, and what should a later withdrawal or correction do to progress?
- Options: nonbinding aspirational progress; earmark existing reserves with a separate
  designation ledger; additional funding linked to the existing savings transaction.
- Decision: Use additional funding, recorded exactly once. Goal progress is its net
  active contributions minus explicit goal-scoped withdrawals. Goals are subsets of
  total savings. General withdrawals use only unassigned reserve; withdrawing from a
  goal requires choosing that goal and affirmative confirmation. Validate every
  monthly prefix for each goal and the unassigned reserve under the existing owner lock.
- Reason: This follows the domain's contribution rule without double-counting the
  percentage allocation or letting general withdrawals misrepresent funded progress.
  Goal withdrawals are a minimal integration prerequisite, not a new transfer system.
- Impact: Creating a goal has no cash, budget, spending or savings effect. Funding
  reduces ordinary remainder once; withdrawing restores it in that month. Existing
  protected money is not automatically assigned. Targets are positive safe minor-unit
  amounts; overfunding is allowed, attainment is derived and can decrease after an
  explicit withdrawal. Target dates do not trigger actions. No goal edit/archive UI,
  shared goals, conversion, bank transfers or future roadmap features are included.
- Verification: Private direct-write/RPC grants and negative RLS, exact replay,
  multiple currencies/goals/months, correction and concurrent withdrawal tests,
  isolated caches, interruption/cancellation and exact-head CI are required.
- Revisit: Pending owner review. An explicit assignment/release operation for existing
  savings can be designed separately; FIN-122 must preserve sub-reserve invariants.

## FIN-117: Immutable monthly personal templates

- Question: What does a template mean before occurrences, resolution and commitments
  exist, and how can later changes avoid rewriting historical obligations?
- Options: editable live definitions with retroactive recomputation; versioned
  definitions plus occurrence snapshots now; immutable definitions with a narrow prospective stop operation.
- Decision: Implement immutable definitions with a narrow stop operation, matching this roadmap
  task's schema scope.
  MONTHLY templates have an explicit first month and optional inclusive last month,
  an owned active category mapped to an active SPENDABLE bucket, immutable currency,
  and a due day from 1 through 31 (clamped to the month's last day). FIXED requires
  a positive safe-integer amount; VARIABLE accepts an optional nonnegative estimate,
  where null is unknown and zero is an explicit estimate, never actual spending.
  Creation may start in the owner's current financial month or later, not earlier,
  and cannot overlap an already closed owned period. Exact UUID retries return the
  original row without reactivating it or applying current creation eligibility.
- Reason: This provides useful persisted definitions without inventing a scheduler,
  automatic fixed transactions, past obligations or mutable historical meaning.
- Impact: No actual transaction, cash, spending, budget consumption or savings change.
  Templates are private and independent of a particular budget-period currency;
  later resolution must still obey ADR-067 and never infer conversion. Category and
  bucket archives preserve the definition, not erase historical obligations. The sole permitted change is an explicit stopped-from month, no earlier than the
  owner's current month. It only shortens the schedule, cannot be cleared/extended,
  and cannot affect a covered closed month. Stopping at/before the first month
  cancels a mistaken future template. Original fields and stop provenance survive.
  No broad edit, deletion, replacement or reactivation operation is exposed.
  A defined last month also ends eligibility without rewriting the row. No creation/list
  UI is included in this schema task; FIN-118 can add the minimal entry/resolve UI.
  Later occurrence work must uniquely identify owner/template/month, snapshot the
  obligation and link its actual transaction before commitment calculations exclude
  resolved items, so a fixed template and its actual expense are not counted twice.
- Verification: Safe bounds and calendar/leap-year domain tests; real PostgreSQL
  direct-write/RPC grants, RLS, forged references, immutable history, closed periods,
  exact replay and financial neutrality; generated types and full exact-head CI.
- Revisit: Pending owner review. A future explicit edit/reactivation operation must be
  effective-month/version based and preserve already established obligations. Fixed
  automatic generation remains an open decision, not permission supplied here.
