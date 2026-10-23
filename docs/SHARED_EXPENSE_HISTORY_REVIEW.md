# FIN-209 — Shared Expense History Review

## Bounded contract

- Each already authorized Hogar offers read-only history and independently read detail.
- The scalar list RPC defaults to 20 expenses, accepts only 1–50, and uses descending
  financial date then UUID. Cursor is the final returned expense UUID only when there
  is a following row; a complete terminal page does not invent a continuation.
- Cursor lookup is restricted to the requested household after current authorization.
  Missing, personal and foreign IDs all yield the same invalid-cursor result. Refresh
  begins a new first page. Concurrent newer insertions appear on refresh; keyset order
  neither promises a frozen multi-request snapshot nor reorders immutable old records.
- List/detail require current active membership in the exact household and a fresh
  READ COMMITTED statement snapshot. They grant no access by creator, payer, overlap,
  old cursor or former membership. Existing shared tables remain server-only; direct
  transactions SELECT remains PERSONAL-only.
- Receipts reuse FIN-207's exact stored DTO and split validation. No template, period,
  personal category, salary, budget, savings or cash calculation supplies history.
- Each response reuses FIN-202's existing active-member projection, narrowed to IDs
  and display names in the same snapshot. Display names are current, not historical
  name snapshots. Missing historical members use a neutral membership-ID label only;
  no departure/rejoin policy, new Profile field or former-member right is introduced.
- Original currencies stay per-record. No totals, conversion, relabeling, custom splits,
  edit/delete/reversal, balances, FIN-210/211 effects, filters, graphs or redesign.

## Security and lifecycle checklist

- [x] Bounded definer reads use empty search paths, auth.uid() and explicit current scope.
- [x] Minimal RPC surfaces classified in the FIN-204 actual-catalog regression gate.
- [x] Strict row/page/detail parsing rejects extra private fields and whole malformed pages.
- [x] Loading, empty, error/retry, pagination, refresh and end states are distinct.
- [x] Profile/household/detail cache isolation; refresh discards preceding pages.
- [x] Parent blur/background and auth changes hide data; cleanup aborts/removes history queries.
- [x] New-entry pending request remains independent. Only verified receipt invalidates history.
- [x] Prepared SQL tests cover A/B/C, overlapping homes, grants, direct writes, cursor
  bounds/ties/errors, no personal fields, roster/template/currency changes and revocation.
- [x] Existing local-only two-session harness extended for committed-only visibility,
  a fresh read after concurrent revocation, retained participant identity and isolation rejection.
- [x] Existing authenticated HTTP journey feeds actual list/detail JSON into production parsers.
- [x] Actual PostgreSQL/RLS, concurrency and authenticated HTTP execution on source head ea9d073.
- [x] Authentic database.types.ts from that exact-head CI artifact, imported verbatim.
- [ ] Exact-final-head full CI, independent source/artifact review and publication approval.
- [ ] Native/device acceptance. No device runtime is available in this task.

## Local verification

Node 24.14.0 / npm 11.9.0, EXPO_NO_TELEMETRY=1:

- Full local Jest after the authentic type import: 1,458 tests in 68 suites passed, including the receipt-to-history invalidation regression.
- Typecheck, lint, formatting, installed Router parser, both modified Node harness syntax checks
  and git diff --check passed.
- Authentic generated types resolve the two previously missing RPC signatures without
  handwritten types, casts, suppressions or application changes.
- Docker and psql remain unavailable locally; real database verification ran only in
  disposable CI, not against production.
- Independent source review resolved stale display labels via same-snapshot projection;
  final-commit artifact review and full CI remain separate integration gates.

## Initial disposable CI and artifact evidence

Run 39908199722 on source ea9d0738dd37388faaf58e1e42ce7e9c76a453d3 passed
migrations, 4,259 SQL assertions across 39 files, all concurrency harnesses (including
four new history cases), and authenticated HTTP/parser suites (2 + 6 tests).
Its only failures were the two missing generated RPC signatures in Quality and the
expected generated-type drift at the final database comparison.

Artifact 12482440068 from that exact run contains one database.types.ts, 53,213 bytes,
imported byte-for-byte with only 12 generated lines added. File SHA-256:
108b66893b6dbabee197b718becce0dd50f2914b853c617a7353645370d358d0.
No production database, deployment, secret or real data changed. Final-head CI remains pending.
