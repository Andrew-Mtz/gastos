# FIN-126 — Current-device acceptance checklist

This checklist complements the automated review. It does not claim a new device run.
Historical owner-verified FIN-006–008 Expo Go results remain valid history. The newer
financial screens and the reported `formatToParts` crash fix still need a current
physical-iPhone regression. Signed builds, EAS/TestFlight and standalone reinstall
semantics remain deferred; do not buy membership or activate them for this checklist.

## Safe preflight

- Identify the exact tested commit, Windows Node/npm versions, Expo Go/SDK and iOS
  versions. Record these nonsecret values only.
- Confirm the phone targets a **verified local synthetic Supabase environment**, not
  a hosted/personal production project. A LAN URL on the phone is expected, but must
  be positively matched to that Windows machine's local project. If the destination
  or migration state is unknown, stop and verify before creating financial records.
- Confirm all migrations through FIN-125 are already applied to that isolated test
  environment. Do not run `db:reset`, delete accounts/data, or blindly apply migrations
  to an existing environment to satisfy this checklist. Use a separately authorized
  preparation step if it is not ready. Never paste `.env`, keys, tokens, session JSON,
  raw `supabase status` output or full logs into chat/issues.
- Use fresh, clearly synthetic A/B accounts and synthetic amounts only. Keep existing
  accounts/data untouched. From the verified checkout run `npm.cmd ci`, then
  `npm.cmd run start:clear -- --go`; open the QR code in compatible Expo Go.

## Financial journey and expected observations

All amounts below are displayed USD values, not minor units. Use a current-month
synthetic budget with Needs 50%, Leisure 30%, Savings 20%.

1. Sign in as A and configure expected income 9,999.99. Before actual income, ordinary
   availability must be zero, not the expected amount. Confirm budget/dashboard mount
   without the previous `formatToParts` crash.
2. Receive 1,000.00 actual income. Allocation is 500.00 / 300.00 / 200.00. Record a
   600.00 Needs expense: the Needs residual is −100.00, ordinary remainder 200.00,
   protected savings 200.00. No automatic savings withdrawal or percentage change.
3. Contribute 50.00 to general savings. Review and explicitly confirm a 10.00
   withdrawal: protected savings 240.00, ordinary remainder 160.00. Cancel a second
   withdrawal preview and confirm no movement was created.
4. Create a current-month VARIABLE bill with unknown amount. Availability must not
   present a numerical safe-to-spend as if it were zero. Resolve it for 40.00 once:
   ordinary margin 120.00 and protected savings 240.00. Repeated tap/navigation must
   not create a second actual expense.
5. Correct the ordinary expense to 550.00: ordinary margin 170.00. Verify original
   and corrected values in history. Delete and restore the linked recurring actual:
   deletion explicitly cancels the occurrence; restoration reuses its ID/obligation
   rather than creating a duplicate. Margin returns to 170.00.
6. Browse away/back, background/foreground, cancel a close/remainder preview and
   return. Stale values must not authorize a new submission; cancelled actions must
   not alter money. The current month must **not** close.
7. Only if a separately prepared, verified synthetic completed OPEN month exists:
   inspect its complete preview, resolve/cancel its genuinely historical obligations,
   explicitly close, verify write denial, explicitly reopen, then inspect retained
   closure history. Exercise one explicit remainder action and its history. Do not
   backdate a real payment, change the device clock, fabricate current-month closure,
   or run manual SQL against the user's environment. If no fixture exists, record
   this native branch as not exercised; disposable CI covers its backend branch.
8. On fresh synthetic profile setup, verify UYU/USD/EUR/BRL/ARS selector labels. For
   each currency that is exercised, inspect 0.00, 0.01 and 1,234.56 rendering in a
   budget/transaction screen with no crash or wrong decimals. Do not change existing
   financial records' currency for this check. Automated tests separately remove
   `Intl.NumberFormat.prototype.formatToParts`; do not patch the phone runtime.

## Minimal privacy/session regression after the new screens

- Background/foreground, fully terminate/reopen Expo Go, and confirm the same account
  restores without a stale sign-in flash or storage-size error. The real native session
  should persist; never copy or inspect its token contents for reporting. If a numeric
  byte-size diagnostic is needed, prepare a reviewed, local-only diagnostic separately
  rather than enabling credential logging.
- Leave A's history/close preview visible, log out, then restart. No A finances or
  pending action may remain; unauthenticated navigation stays at sign-in.
- Sign in as B. A's budgets, transactions, savings, pending requests and summaries
  must not flash or appear. Return to A only through explicit sign-in.
- Expo Go does **not** verify standalone Keychain/reinstall or signed-build behavior.

## Record the result

Record commit/device versions, each step's PASS/FAIL/NOT EXERCISED, and a brief symptom
or synthetic-only screenshot when useful. Never report NOT EXERCISED as passed. Send
only redacted, relevant error text, not complete logs. A failed finance/privacy step
blocks that acceptance branch until diagnosed; an unavailable historical fixture is
an evidence limitation, not permission to bypass domain rules.
