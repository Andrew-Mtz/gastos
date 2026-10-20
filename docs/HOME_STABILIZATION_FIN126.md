# FIN-121 / FIN-126 — Inicio stabilization

This is bounded post-review presentation and read-diagnostic work based on main
`412c28dc316aea60023e9d9388e37217f31c72fa`. It is not a new roadmap feature,
a financial-policy change, a database deployment or current physical-device QA.

## Investigation and choices

The original Inicio used one validated current-month snapshot and already withheld
figures during loading, refetch, failure, blur and background. Its full formula
preceded primary entry actions, and every card had similar visual weight.
The two read paths discarded response status and let raw provider/parser errors
reach the query cache; the shared message recognized only three SQL codes.

The stabilization retains those data, calculation and lifecycle paths:

- Only Inicio opts into a compact `SafeToSpendSummary`. Its margin has the existing
  large type token and a complete accessible label. The calculation is initially
  collapsed behind an expanded/collapsed button; Budget retains its full breakdown.
- Unknown/current and prior obligations, missing-plan guidance, estimated margins
  (including zero estimates), actual/estimated deficits and monthly/bank-balance
  limitations remain outside the disclosure. Hiding detail never creates availability.
- Expense and income actions precede secondary cards. Existing closed-period rules
  are reflected by disabled entry actions and an explanation; budget/history remain
  reachable. Expected income and cumulative savings are explicitly not spendable.
- Existing semantic tokens and 48-point minimum controls are reused. No fixed text
  heights, line limits or font-scale caps are introduced. Secondary prose and links
  have less visual weight; bucket deficits and pending obligations are not collapsed.
- The disclosure is transient presentation state, not persisted financial state.
  Existing loading/blur/background gates unmount it. Recovery returns to a collapsed
  current snapshot rather than leaving an old formula visible.

These reversible choices were made under delegated project authority. They do not
change ADR-073, owner-only authorization, the current-month horizon or money arithmetic.

## Safe error references

Both `readDashboard` and `readSafeToSpend` classify only observable read boundaries:

| Reference | Observable evidence | Guidance |
| --- | --- | --- |
| `MARGEN-CONEXION` | Installed PostgREST client returned status 0, or request execution rejected before returning a response | Check connection and retry. This is not proof the phone is offline: cancellation, timeout or request-processing failure may also occur. |
| `MARGEN-SERVICIO` | RPC returned an error not in the narrow recognized-code list | Retry; if persistent, report this static reference and app version. No raw server code/message is displayed. |
| `MARGEN-RESPUESTA` | Successful RPC data failed the existing full snapshot parser/domain consistency checks | Retry; if persistent, review app/service compatibility and data consistency. This does not establish an old migration or app version. |
| `MARGEN-DATOS` | Exact SQL code `23514` | Review incompatible records; never show a partial margin. |
| `MARGEN-LIMITE` | Exact SQL code `22003` | Do not approximate unsafe amounts. |
| `MARGEN-ACCESO` | Exact SQL code `42501` | Review the session. |

The query cache receives a new error containing only the fixed category and fixed
message/name. Provider messages, details, hints, payloads and original error causes
are neither retained nor logged. No telemetry/dependency/provider is added. Parsing
still rejects malformed, mismatched or legacy current snapshots; no zero or legacy
fallback is added. The pure parsers remain unchanged for saved historical contracts.

The user's earlier margin symptom cannot be diagnosed from these changes alone.
Their running commit, actual failure reference and environment/migration state are
not verified. Do not reset, change configuration or apply migrations based on this
message. Follow the safe device preflight before testing.

## Verification scope

Automated coverage includes initial loading; refetch after an expanded calculation;
error/retry and stale hiding; repeated expansion/collapse; accessible labels/states;
unknown, prior, missing-plan, zero-estimate, deficit and closed-period states;
preserved month navigation; background/focus, month rollover and auth cancellation.
Read-boundary tests distinguish transport, RPC and invalid contracts, reject complete
but inconsistent snapshots and verify that arbitrary provider text cannot enter
diagnostics or logs. Existing financial/domain/parser suites remain applicable.

Physical font scaling, VoiceOver, touch/scroll behavior, runtime error recovery and
the user's actual environment are not verified here. See the added Inicio section in
[the current-device checklist](PHASE_ONE_DEVICE_CHECKLIST.md). Automated React Native
component tests and platform exports do not establish those device results.

Database migrations, generated types, RLS, dependencies, global UI redesign, Household,
financial formulas and production operations are unchanged.

### Local results (2026-10-20)

Using the repository-pinned Node 24.14.0 and npm 11.9.0:

- `npm run typecheck`, `npm run lint`, `npm run format:check`: passed.
- `npm test -- --runInBand`: 1,049 tests passed in 55 suites.
- Focused Dashboard/margin suites: 92 tests passed in 5 suites.
- Independent review: no actionable finding; independently passed those 92 tests plus
  53 domain/history/recurring regression tests (145 total in 8 suites).
- `npm run test:router-parser` and `git diff --check`: passed.
- iOS and Android Hermes `expo export`: passed (4.4 MB / 4.7 MB). These are offline,
  telemetry-disabled, compile-only exports with harmless loopback/public placeholders,
  not native execution, builds for distribution or a connection to a hosted project.
- Static token contrast against white was 6.39:1 or higher for the reviewed secondary,
  success, warning, danger and action text. Real device rendering remains unverified.

The first focused run exposed four test assertions using RNTL14's exact-text matcher
as if it were a substring matcher. Assertions now check full text or explicit regex;
no product behavior was changed to satisfy them. The initial lint invocation failed
because Expo telemetry tried to create its unavailable home directory. A single retry
with supported `EXPO_NO_TELEMETRY=1` passed. Environment-injected npm `http-proxy` and
terminal `NO_COLOR`/`FORCE_COLOR` warnings are not lint findings or dependency changes.

Local database/API/concurrency/type-generation integration was not run because this
executor has no Docker executable. No database preparation/reset was attempted.
Publication and exact-head CI database/quality verification remain separate gates.
