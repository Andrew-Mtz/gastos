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

## FIN-118: One monthly resolution and explicit cancellation history

- Question: How should a monthly obligation be identified, resolved, stopped or
  corrected without producing a second expense or silently reviving a deleted one?
- Options: a separate occurrence ledger duplicating actual amounts; attach the
  immutable template/month identity directly to the existing actual transaction.
- Decision: Use the latter. A pending obligation is the template/month projection;
  resolution atomically inserts one EXPENSE with immutable recurring-template and
  canonical month columns, unique per owner/template/month even after soft deletion.
  The transaction ID is the stable request identity and permanent actual linkage.
  Original obligation terms remain in the immutable template; only stop is mutable.
- Reason: No unresolved row needs persistence or amount duplication. The established
  transaction is the financial event, so existing spending/history/savings paths count
  it exactly once. Owner serialization orders simultaneous stop and resolution.
- Impact: Stop first prevents new resolution; resolution first preserves that actual
  even when the template is subsequently stopped. Deleted actuals are visibly cancelled,
  not pending obligations: future FIN-119 must not subtract them again as commitments.
  Restore only reactivates the same transaction under open-period/category guards;
  stop is not a prohibition on restoring already-established history. Exact resolve
  replay never restores a deleted expense. Description correction does not relink;
  monetary corrections in FIN-122 must preserve the occurrence/actual identity or
  introduce a separately documented explicit adjustment, never silently re-resolve.
  Actual dates must belong to the obligation's open month and currency. No automatic
  fixed generation, fixed confirmation, commitments, conversion or safe-to-spend.
- Verification: Direct-write/RPC authorization and unique constraints, exact replay,
  stop/deletion/restoration/closed-period checks, concurrent duplicate and stop races,
  domain/form/UI lifecycle tests, generated types and exact-head CI before merge.
- Revisit: Pending owner review. FIN-119 consumes this identity; FIN-122 may extend
  corrections without rewriting recurrence linkage. Process-restart pending-request
  recovery and native/device runtime remain unverified, as in prior entry flows.


## FIN-119: Monthly commitments, unknown amounts and fixed confirmation

- Question: What is committed rather than spent, and can old obligations be carried
  forward without a cross-period payment model?
- Options: total a UI page; carry every unpaid historical occurrence as current debt;
  derive a complete monthly aggregate and explicitly flag older unresolved items.
- Decision: Use a complete server aggregate of the selected month's unresolved
  occurrences, including due dates already passed within that month. FIXED amounts
  are confirmed commitments, not payments; VARIABLE amounts are estimates, with null
  counted separately as unknown and zero retained as a known estimate. Separately
  count older unresolved occurrences without adding them to this month's amounts.
  This is current planning state through the selected month, not a historical snapshot,
  bank balance, cumulative payable ledger or money available to spend.
- Reason: Existing resolution records an actual expense only in the occurrence month.
  Carrying obligations forward then resolving into the past would misstate later
  availability. A late payment in another month needs a future explicit payment/date
  model; users must not backdate a payment merely to dismiss an old obligation.
- Impact: Monthly totals include archived and unallocated spendable mappings. Invalid
  mappings or another currency in that month's unresolved obligations block the
  entire total; no conversion or partial total is inferred. Prior unresolved counts
  span currencies and are not money. FIN-120 must withhold a numerical safe-to-spend
  claim while older unresolved items remain, and FIN-123/125 must surface unresolved
  obligations before closing/remainder actions rather than silently cancelling them.
  A minimal prerequisite enables explicit FIXED payment confirmation through the
  existing unique linked EXPENSE. Initial actual must exactly equal the fixed amount;
  differing bills require a deliberate correction flow in FIN-122, preserving linkage.
  No automatic transaction, second expense model, template mutation or implicit
  savings withdrawal is introduced. Cancellation/restore rules stay ADR-071.
- Verification: Complete aggregates beyond row caps, safe-integer amount/count bounds,
  negative authorization, due/activation/stop boundaries, unknown versus zero,
  archival/unallocated mappings, no double counting, fixed exact amount/direct-write
  guards, lifecycle/cache tests, independent review and exact-head full CI/types.
- Revisit: Pending owner review. Cross-period settlement semantics are intentionally
  unresolved; FIN-120/123/125 must honor this limitation rather than invent rollover.


## FIN-120: Complete monthly formula and uncertainty gate

- Question: How do explicit savings movements and estimated/unknown obligations
  affect safe-to-spend, and how do we avoid racing financial inputs?
- Options: call all known money safe; subtract estimates as though exact; separate
  confirmed margin from approximate estimates and withhold margins when incomplete.
- Decision: Choose the last option. Monthly rounded actual-income SPENDABLE allocation
  minus actual expenses minus extra contributions plus explicit withdrawals minus
  current confirmed commitments. Never count goal movements twice. Preserve negatives.
  Known estimates yield a labeled pre-estimate margin and separate approximate margin;
  unknown current amounts, prior unresolved obligations or no configured allocation
  withhold numerical availability. One stable invoker RPC supplies a complete snapshot.
- Reason: Expected income and protected savings are not spending money; estimates
  are not exact and an unknown obligation cannot truthfully be treated as zero.
  A single statement snapshot avoids transient overstatement during concurrent writes.
- Impact: Read-only monthly budget margin, not cash/account balance or global solvency.
  No totals persisted, implicit savings use, currency conversion, ordinary rollover,
  cross-month payment model or FIN-121 dashboard. Existing recurrence tombstones and
  archived/unallocated spending/commitments remain included under ADR-068–072.
  Invalid/error/refreshing data hides unsafe cached figures. Owner-wide mutation,
  auth/month/focus/manual-refresh invalidation must keep the new query current.
- Verification: Exact domain arithmetic and uncertainty tests; owner/grant/currency,
  overflow, full aggregate and real concurrent-snapshot SQL checks; UI cache/lifecycle
  tests; independent bounded review; generated types and exact-head full CI required.
- Revisit: Accepted under delegated authority, not personally reviewed or confirmed
  by the owner. Pending owner review of presentation/formula; revisit cross-month
  payments/accounts later. FIN-123/125 must keep unresolved-obligation safeguards.

## FIN-121: One current-month dashboard, not a merged client balance

- Question: How should Inicio combine existing financial facts and upcoming bills
  without mixing independently fetched states or implying cash availability?
- Options: assemble existing query cards independently; persist a dashboard total;
  compose existing stable reads into one owner/month snapshot.
- Decision: Use one read-only stable invoker snapshot for the current financial
  month in the profile timezone. Reuse ADR-073 and existing exact allocation rules.
  Show received/expected income separately, this-month savings allocation separately
  from cumulative protected savings, and bucket spending alongside its allocation.
  Only ADR-073's gated margin is labeled available. Show at most five pending
  obligations ordered by due date, including overdue days of this month, with a
  full-list link. Complete commitments never come from that preview.
- Reason: A payment or savings movement must not temporarily disappear between
  independently racing cards. Expected income and cumulative savings cannot be
  confused with ordinary remaining money. The current-month-only screen keeps
  existing entry/navigation destinations aligned without adding historical UI.
  Review caught retained historical selections in recurring/history destinations;
  these links now explicitly carry a validated month and reapply it on focus,
  while manual month browsing within those screens remains available.
- Impact: No financial policy, persisted total, transaction, account balance,
  conversion, corrections, closure or rollover. Existing owner-wide invalidation
  also refreshes the dashboard. Navigation/background/authentication/month changes
  cancel obsolete reads; loading/refetch/error hides cached financial figures.
  Missing period or allocation directs setup rather than claiming zero availability.
- Verification: Domain reuse and boundary checks, real owner/anonymous authorization,
  complete totals beyond preview/row caps, concurrent payment snapshot proof,
  lifecycle/navigation tests, generated types, bounded review and exact-head CI.
- Revisit: Pending owner review of presentation. Historical dashboard navigation,
  category charts and cross-period payments remain outside FIN-121.

## FIN-122: Bounded, audited corrections and recovery

- Question: How can a mistaken amount/date/category be corrected without silently
  destroying original history, relinking a recurring payment, or manufacturing savings?
- Options: description-only edits; replacement transactions; broad client monetary
  UPDATE; a bounded revision-checked correction operation with an append-only audit.
- Decision: Use the bounded operation. EDIT changes positive safe minor amounts,
  dates inside the original month, descriptions, and the active spendable category
  of non-recurring expenses. Currency, owner, scope, type, period, goal, recurring
  template/month and creation identity never change. DELETE removes financial impact;
  a linked actual also explicitly cancels its monthly obligation. RESTORE reactivates
  the same ID under current open-period/funding/category guards, including after stop.
  The UI provides deleted history, explicit review/confirmation and correction history.
- Reason: Replacement risks double resolution and lost original meaning. A revision
  and immutable before/after snapshots preserve the initial record and every correction.
  A request UUID replays its exact recorded result even after later edits or closure;
  a stale expected revision or changed payload conflicts, never overwrites newer data.
- Impact: Monetary UPDATE stays unavailable to clients. A narrowly scoped definer RPC
  validates auth.uid(), owner, action, complete bounded payload, OPEN month, expected
  revision and existing financial guards under the owner lock. An audit-only definer
  trigger appends authoritative row snapshots for every UPDATE, including existing
  direct description/tombstone paths; callers cannot write or erase audit rows.
  Direct legacy-safe updates remain audited, while application corrections always use
  optimistic concurrency. Increased contributions require incremental ordinary funding;
  decreases and every other correction preserve all goal/general historical prefixes.
  Legacy savings provenance is never promoted by editing. No cash transfer, conversion,
  implicit withdrawal, cross-month payment, period lifecycle or remainder operation.
- Verification: Independent bounded security review of both definer capabilities;
  negative grant/RLS/auth and immutable-field tests, exact replay/audit/conflict tests,
  full derived-calculation and real concurrent funding/edit/delete tests; UI validation,
  confirmation/cancel/navigation/auth/late-response/cache coverage and exact-head CI.
- Revisit: Accepted under delegated authority, not personally approved by the owner.
  Pending owner review. Audit retention/account deletion and cross-month correction
  remain separate future decisions; process-termination request recovery is not added.

## FIN-123: Completed months, unresolved obligations and immutable close evidence

- Question: Can a month close with unresolved bills, and what remains historically true
  if earlier corrections later change cumulative savings?
- Options: close with qualified warnings; silently cancel/carry obligations; block until
  resolved. Recompute close summaries forever, or store immutable as-of evidence.
- Decision: Block closure for every selected-month/prior unresolved obligation. The
  server clock and persisted financial timezone determine completed-month eligibility.
  Store immutable as-of summary, close request UUID and lifecycle version. Require a
  fresh matching preview and explicit confirmation under owner-wide serialization.
- Reason: Pending money is not free, unsupported cross-period payments cannot be
  invented, and recomputation would misleadingly rewrite what the user finalized.
- Impact: No automatic cancellation, backdating, savings movement, rollover, reopen or
  remainder action. Snapshot cumulative savings are historical, not a live balance.
  FIN-124 must advance lifecycle version and retain closes; FIN-125 must revalidate
  current authorized financial state. Narrow definer RPC is needed without status grants.
- Verification: Owner/anonymous/grant/forgery tests; month/timezone, unresolved bills,
  snapshot preservation, exact replay/stale version, all closed mutation guards, real
  concurrent close/write scenarios and UI confirmation/navigation/auth/cache tests;
  matching-head generated types, bounded review and exact-head full CI before merge.
- Revisit: Delegated choice, not personally reviewed by the owner. Review strict pending
  obligation policy and as-of presentation after waking; unsupported cross-month
  settlement and process-termination request recovery remain separate work.

## FIN-124: Explicit reopening with immutable lifecycle evidence

- Question: Which closed periods may reopen, what evidence is required, and how does
  retry behave after later corrections or another close?
- Options: broad status UPDATE; overwrite the last close; or a bounded, confirmed
  lifecycle operation retaining all previous evidence. Require a free-text reason,
  or retain structured actor/time/version evidence without collecting extra text.
- Decision: Any owned CLOSED period can explicitly reopen, including legacy periods
  without a stored close. Require a UUID, expected lifecycle version and fingerprint
  of the reviewed closed state. Append immutable actor, prior close time/link,
  expected/resulting version and reopen time; no required free-text reason. Advance
  the version and clear closed_at. Exact replay returns the original evidence only;
  new stale or already-open requests conflict. Show all stored closes and reopenings.
- Reason: Corrections must be possible without inventing legacy summaries or erasing
  what was finalized. Structured evidence provides a useful future audit boundary
  without a general audit framework or unnecessary personal text.
- Impact: No monetary side effect, automatic reclose, current-balance claim, status
  grant, FIN-125 disposition or broader audit-retention policy. Existing correction,
  allocation, savings and template guards still apply. Auth-scoped pending requests
  survive actual in-session screen remounts, not process restart.
- Verification: SQL authorization/grant/forgery, legacy/no-op/replay/version tests;
  real reopen/write/close concurrency; preserved summaries; UI review/remount/auth
  and late-response checks; generated types, bounded review and exact-head CI.
- Revisit: Accepted under delegated authority, pending owner review, not personal
  confirmation. FIN-125 must explicitly decide whether a disposition restricts
  reopening; retention/account deletion remains future policy.
