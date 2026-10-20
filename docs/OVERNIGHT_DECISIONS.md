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
