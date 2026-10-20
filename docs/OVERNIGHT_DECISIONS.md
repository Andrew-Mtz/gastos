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
