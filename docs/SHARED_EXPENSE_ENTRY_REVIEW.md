# FIN-208 — Shared expense entry verification

Scope follows the user's 2026-10-23 clarification (ADR-083): every active member can
register, with one active payer, the OWNER's current general split and the configured
household currency. No per-expense override, currency selector, conversion, category,
history feed, personal financial effect or redesign is included.

## Local verification

Node 24.14.0 / npm 11.9.0, with Expo telemetry disabled:

- `npm run typecheck`, `npm run lint`, `npm run format:check`: passed.
- 37 new application tests and 27 new UI/lifecycle tests: passed.
- Full `npm test -- --runInBand`: 1,415 tests across 66 suites passed.
- `npm run test:router-parser`: passed.
- Both changed integration scripts pass `node --check`; `git diff --check` passes.
- Static comparison confirms the replacement RPC body is identical to FIN-207 except
  the new-entry currency guard. Signature, generated types, grants and lock order stay
  unchanged. No new dependency, table, RPC, exposed field or private-data read.

The tests cover exact rounding and zero shares, payer/actor independence, fixed
currency, invalid input, owner/member entry, missing/stale templates, preflight and
server conflicts, double confirmation, uncertain exact retry, authoritative readback,
receipt mismatch, historical shares, cancel/back, remount, blur/background during
preflight, household/currency/account changes and same-account re-login. Existing
household suites isolate the new child; the new suite exercises it through Hogar.

## Disposable CI gates still required

`npm run db:test` could not execute here: the CLI cannot create `/home/agent/.supabase`
on the read-only home filesystem; Docker and psql are also unavailable. No reset,
production operation, SQL execution or native acceptance is claimed.

The existing SQL suite adds 15 assertions for currency denial, no partial trio,
current-currency creation and unchanged exact historical replay/point reads. The
existing concurrency harness adds both orders of a trusted household-currency change
versus expense creation, including demonstrated lock waits. The authenticated HTTP
journey adds wrong-currency rejection and absent receipt. CI must execute these and
all existing authorization/private-read-model regressions, generated-type drift and
cleanup on the final published head; source review is not execution evidence.

## Native checklist — not run

- On a device, record as OWNER and MEMBER with either payer; verify the persisted
  amount, date, selected payer, automatic shares and optional description.
- Test invalid amount/date, missing payer, absent/stale template and owner update
  during confirmation. No implicit fallback or silently replaced review may appear.
- Check keyboard avoidance/scrolling, screen-reader labels/selected payer, large font
  wrapping, contrast, cancel/back and foreground/background revalidation.
- Interrupt a submit/readback, return and retry: the same request must confirm once;
  account/household switching must never show the previous receipt.

Pending request identity survives only in the current auth-cleared in-memory session,
not a process restart. Offline durability/recovery and searchable history are deferred;
closing the receipt is not deleting the expense. No device QA or deployment claim.
