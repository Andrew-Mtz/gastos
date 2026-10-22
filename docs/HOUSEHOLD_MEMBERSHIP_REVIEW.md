# Household Membership Review and Manual Acceptance

The original FIN-202 review evidence is retained below. The FIN-203 addendum at
the end defines its separate, still-pending device cases.

**Status:** Bounded implementation in draft PR #43 after FIN-201 PR #42 merged.
Initial disposable CI passed real SQL/RLS and concurrent-session cases; they are
**not run locally** because Docker is unavailable. Authentic generated types are
integrated and local typecheck passes. Final-head full CI is required for merge;
consult PR #43 for current results.
Manual/device cases below are **not run**. This document does not mark FIN-202,
FIN-204 or native acceptance complete.

## Scope and prerequisites

Read ADR-079 first. This slice creates a first household with its creator's explicit
active OWNER membership and reads authorized households/active-member names and
roles. It does not implement invitations, joining, leaving/removal, rejoining,
role changes, ownership transfer, former-member history or shared finances.

Use only a developer-owned **disposable local Supabase stack** and synthetic test
identities. Do not use production, a hosted user project, real household members,
real email recipients or personal financial data. The original FIN-202 cases do
not send invitations; the FIN-203 addendum uses synthetic in-app invitations only. This
checklist describes future tester actions; it does not authorize an agent to
create real households or bypass a publication/dependency gate.

Before manual testing:

1. Confirm the checkout includes merged FIN-201 main `75f8610` and obtain review
   approval for the exact FIN-202 source being tested. The FIN-201 dependency gate
   is resolved; initial FIN-202 SQL CI has run. Full CI must pass on the final head
   before merge; consult PR #43 for current results.
2. Use the repository's pinned Node/npm versions and installed dependencies. Follow
   the existing local Supabase setup in README. The stack must belong to this
   disposable checkout; inspect the target before any reset.
3. Apply migrations in that disposable stack with `npm run db:reset`. Run
   `npm run db:test`, `node scripts/test-household-concurrency.mjs` and the existing
   personal-finance authorization/concurrency/API checks. Preserve failures rather
   than weakening tests. These checks passed in disposable CI, but have **not** been
   executed in this local environment.
4. Generate database types from the actual migrated disposable schema, retaining
   provenance. Do not hand-edit types or cast away missing RPC signatures. Run
   typecheck, lint, formatting, Jest and Router parser checks on the resulting head.
5. Configure Expo with that stack's local URL and publishable key by following
   README. Never use or bundle a service-role key. Keep all local environment values
   uncommitted. Start the app on the tester's own device/simulator using `npm start`.
6. Register two synthetic local identities, A and B, through the existing auth
   flow, using the local mail inbox if confirmation is required. Complete Profile
   setup with distinguishable synthetic display names. Do not use actual accounts.

The existing SQL suite owns privileged synthetic same-household, inactive and
creator-only fixtures. It rolls them back. There is intentionally no application
flow for creating those membership states in this slice; do not interpret that
limitation as an invitation/removal feature.

## Manual cases: record device, source head, result and evidence

All cases begin as **pending**, not passed. For failures, record the action and
visible result without capturing secrets or authentic personal information.

### 1. Explicit first creation and currency

- Sign in as synthetic A and open Hogar. Verify the empty state and privacy copy.
- Tap Crear hogar. Submit a blank name and verify validation, with no household
  created. Enter a name, open Moneda, change the currency, then Cancelar. Verify
  returning to the empty state and no server household/membership write.
- Open the form again. Choose a recognizable synthetic name and an explicit
  household currency different from A's personal base currency. Review the copy
  explaining that household metadata and the visible name are shared, not private
  finances. Tap Confirmar creación once.
- Expect one household, its selected currency and A's display name marked `(Tú):
  Propietario`. Personal currency/timezone must not be displayed as member data.
  There must be no invite, join, leave, role-change or household-edit control.
- Verify A's private budget, income and savings remain unchanged. This operation
  has zero cash, budget, spending and savings effect.

### 2. Persistence and repeated actions

- Switch to Inicio and back. The same household must reappear after authorization
  refresh, with no second creation option.
- Refresh repeatedly. Confirm one household and one membership, not duplicates.
- Restart the app and sign in again if necessary. The persisted household remains
  readable. This verifies persisted household data, not persistence of pending
  request payloads, which is intentionally in-session only.
- In a fresh disposable synthetic account with no memberships, rapidly tap the
  final creation button twice. Expect one request in flight and one household.
  The automated concurrent-session harness also covers two distinct request UUIDs.

### 3. Background, blur and refetch failure

- With A's household visible, switch tabs. Returning must recheck access rather
  than display stale member names as already authorized.
- Background and foreground the app. An unsent creation form must close; member
  names must remain hidden while authorization is revalidated.
- Temporarily disable the tester's device/simulator network, then refresh/return
  to Hogar. Expect a neutral retry state, no raw SQL/server payload, and no stale
  household/member list presented as current. Restore networking and retry.
- These transitions are not evidence of OS-level screenshot/app-switcher shielding.
  That separate open security decision remains unresolved.

### 4. Lost response and exact recovery

- Use another fresh synthetic account. In the developer's disposable test setup,
  interrupt the creation response after submission, or simulate a transport error
  with a test-only network interceptor. Do not alter production code or hosted data.
- Expect a clear pending/uncertain state. A second fresh creation is unavailable.
  Closing the screen does not claim to cancel a server operation already sent.
- Restore connectivity and use Actualizar hogar. If the original operation
  committed, the readable matching household must settle the pending state without
  a second write and show a coherent confirmation.
- If no committed household is visible and the first transport request settled,
  use Comprobar creación pendiente. Verify the exact same UUID/name/currency is
  retried. A network-inspection tool may compare these non-secret synthetic fields;
  do not capture auth headers, tokens or personal payloads.
- Repeat after navigating away and returning within the same signed-in session.
  Return before the old request settles, then let it succeed or lose its response
  after commit. The currently mounted screen must read the household and clear
  the pending state without a second write or requiring another manual refresh.
  The request must remain unchanged. Process termination and logout intentionally
  do not retain the in-memory pending payload.

### 5. Account isolation and late responses

- Sign out A and sign in B. No A household name, member name, pending request or
  error notice may appear. B with no membership sees its own empty state.
- Repeat with a delayed A read/create response. Neither late success nor late
  failure may populate B's cache or UI.
- Repeat sign-out and sign-in with A while the old response is delayed. The old
  request must not repopulate the new session's cleared pending cache. A normal
  fresh read may show a legitimately committed household.
- The app must not expose direct Profile preferences or private financial rows
  when a household is visible. Positive/negative database assertions, not UI
  filtering alone, are the security acceptance authority.

### 6. Inactive history and revoked replay

- Run the prepared SQL and concurrent-session suites in the disposable stack.
  They cover active OWNER/MEMBER, inactive membership, creator without membership,
  stranger, anonymous and missing identity, including revocation during replay.
- For device inspection of these states, a developer may prepare equivalent
  synthetic fixtures **only in their own disposable stack**. No app removal or
  rejoin operation exists. Do not modify real memberships to reach the state.
- After the next authorized read, an inactive-only account must see the explicit
  unsupported-state explanation and access to personal sections, not historical
  household names/members, silent loading, deletion advice or a false join action.
- Exact replay after revocation must fail, not return protected metadata, reactivate
  the member or create a replacement membership. Clear the stale list on refresh.

### 7. Collection and accessibility checks

- In synthetic developer fixtures, verify more than two active members and more
  than one authorized household render as collections without truncation or an
  arbitrary selected household. Only current active members appear.
- Check long household/member names, large font sizes, VoiceOver labels, keyboard
  avoidance, currency-picker dismissal, and repeated tab navigation. The currency
  and name must remain readable without fixed-height truncation.
- Record actual device/platform evidence. An Expo export or mocked RNTL test does
  not count as these checks passing.

## Verification evidence

- 1,109 Jest tests pass across 57 suites, including 60 new household contract/UI
  tests. Existing navigation remains covered.
- ESLint with no warnings, Prettier, Router parser regression and whitespace checks
  pass. The local-only concurrency script passes JavaScript syntax validation.
- Offline iOS export with synthetic public configuration passes and includes the
  FIN-202 RPC call sites. No live authentication or database call was tested by it.
- Initial disposable CI `39490114410`, schema head `9c331650`, passed 2,357 SQL
  assertions in 34 files, 57 existing finance and 14 household concurrency cases,
  authenticated HTTP finance checks, both application snapshot parsers and cleanup.
  Only the expected missing-RPC typecheck and generated-type drift failed before
  artifact integration. A complete final-head run is required for merge.
- Database types match artifact `12295003351` byte for byte. The three expected RPC
  signatures are the only generated delta, and local typecheck passes. The
  [roadmap evidence](ROADMAP.md#fin-202--household-membership) records the full source
  head and both ZIP/file SHA256 values; no manual types or escape casts were added.
- Independent source review reproduced two remount recovery races. Both fixes
  passed the reviewer's independent repros and late-read session checks, and have
  official regressions. Source review and initial CI do not replace exact-head
  full CI, final review or the manual cases above. No production or real-user data
  was changed.

## FIN-203 short device checklist (pending)

Use only disposable synthetic accounts A (OWNER), B (recipient) and C (unrelated).
These checks have not been executed on a native device; SQL/HTTP evidence must come
from the exact CI run, not these instructions.

Disposable CI `39866077696` on `4798c708` passed real SQL/RLS, 13 invitation races
plus 6 isolation rejections, and both authenticated HTTP/parser journeys. Authentic
types from artifact `12463194901` are integrated. The
[FIN-203 evidence](ROADMAP.md#fin-203--household-invitation-flow) records the full head,
counts and checksums; final-head full CI and this device checklist remain pending.

1. In B's Hogar, select/copy B's own code. In A, invite that code and verify the
   pending outbox shows the entered code, not another account's private details.
   B sees only the household name, status and expiry before joining; C sees neither.
2. Cancel one invitation from A, refresh B and confirm it cannot be accepted.
   Send another and accept explicitly as B. B becomes MEMBER; A/B can see shared
   names/roles but not each other's personal income, expenses, budgets or savings.
3. Give B a separate synthetic household before joining A. Both homes stay separate.
   For expiry, use a developer-prepared already-expired fixture in the disposable
   stack only, refresh B and confirm no acceptance succeeds. Never change real rows.
4. Delay/drop a response, switch tabs and return. Retry must keep the same request.
   Refresh a committed invite while its response is delayed, then cancel it; the
   older response must not erase the pending cancellation or its retry state.
5. Background/foreground and sign out A, then sign in B (also repeat A→A). Codes,
   pending actions and household metadata must hide until fresh reads, with no old
   response repopulating a cleared session. Unsent confirmation screens are dismissed.

No email delivery, leave/removal, role editing, ownership transfer or reactivation
of a previous membership is available. No redesign or financial sharing is implied.
