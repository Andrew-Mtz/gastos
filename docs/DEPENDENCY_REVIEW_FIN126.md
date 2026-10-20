# FIN-126 — Bounded dependency security review

Assessed 2026-10-20 against the committed lockfile, not against an abstract package
list. This is not a penetration test, exhaustive reachability proof or production
security approval.

## Reproducible environment and changes

CI pins Node **24.14.0** in `.nvmrc`. Its bundled npm is **11.9.0**, documented in the
[official Node release](https://nodejs.org/en/blog/release/v24.14.0). Both executable
versions were verified locally in an isolated tooling installation. `npm audit
--package-lock-only --json` was run before and after the changes with those versions.
The initial full audit contained **69 affected package entries** (15 moderate,
53 high, 1 critical); the updated audit contains **65** (15 moderate, 50 high,
0 critical). Propagated parent-package entries are not independent vulnerabilities.
Eight packages had direct advisories before the change; five remain afterward.
The older preliminary count of 109 was not used as a comparable baseline.

Only twelve existing lock entries changed, without direct dependency/framework
upgrades, new dependencies, overrides, `--force` or `npm audit fix`:

- `shell-quote`: 1.10.0 → 1.12.0 (consumer range `^1.6.1`).
- `brace-expansion`: nine nested 1.1.18 → 1.1.21 copies; root 5.0.9 → 5.0.12
  (existing minimatch compatible ranges).
- `source-map-js`: 1.2.1 → 1.2.2 (`postcss` range `^1.2.1`).

A clean `npm ci` succeeded in a new local `node_modules`; shared prior dependencies
were not modified. Audit results depend on the registry advisory database and date;
the reported counts are evidence of this assessment, not a durable guarantee.

## Actual consumers, preconditions and residuals

| Advisory/package | Actual installed path and precondition | Action / residual / acceptance consequence |
| --- | --- | --- |
| [GHSA-pqg4-j6r4-53mv](https://github.com/advisories/GHSA-pqg4-j6r4-53mv), shell-quote | React Native loads `react-devtools-core` backend under `__DEV__`; the inspected backend source map has no shell-quote. The standalone editor bundle separately vendors shell-quote. Advisory requires attacker-controlled quote input with a line terminator after a comment token, then shell execution. Its mapped editor consumer imports `parse` for `REACT_EDITOR`, not `quote`. | Compatible external package patched. Vendored copy is unchanged; no demonstrated affected quote path through the inspected consumer. Do not claim all bundled copies fixed. Use trusted development editor configuration; revisit when devtools change. No production exploit or exhaustive runtime safety claim. |
| [GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr), [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7), [GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p), brace-expansion | minimatch in lint/test/build tooling; crafted brace patterns can exhaust CPU/stack. | All installed lock copies patched compatibly. This does not remediate the separate `braces` package below. |
| [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), source-map-js | Expo Metro configuration → PostCSS/source maps; crafted indexed-map section offsets can cause event-loop denial of service. | Patched compatibly to 1.2.2; no application financial-input consumer found. |
| [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv), node-forge 1.4.0 | Expo CLI iOS certificate inspection and `@expo/code-signing-certificates`; forged RSA PKCS#1 v1.5 DigestAlgorithm nesting can subvert affected signature verification. Not Gastos' native session encryption or Supabase financial API. | No official patched release at assessment. Do not accept untrusted signing material or claim signing verification safe. Reassess before activating signed builds/code-signing. Signing/EAS remains deferred, not silently approved. No found app/src runtime consumer. |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), braces 3.0.3 | micromatch → Metro file-map/watchers and Jest matching; deeply nested attacker-controlled glob patterns exhaust stack. Inspected Metro matching uses repository/tool patterns; filenames are the candidate input. | No official patch at assessment. Treat untrusted repository/build/test configuration as untrusted code and do not process arbitrary external globs. Development/build availability residual, not demonstrated mobile financial-data exposure. |
| [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr), decode-uri-component 0.2.2 | Runtime dependency: Expo Router → query-string 7.1.3. Affected decode of malformed percent-encoded input can grow exponentially. Actual Router `getLinkingConfig` selects `fork/getStateFromPath`, whose query parser uses `URL.searchParams`; outgoing fork paths use query-string `stringify`. Deprecated bundled React Navigation core still contains `query-string.parse`. | Installed runtime residual, **not dev-only**. No actual Gastos route selecting affected parser found. Regression probe covers installed Router fork selection and benign valid/malformed query inputs, not native exploit execution. Patch 0.5.0 is outside `^0.2.2` and is ESM while this consumer requires CommonJS callable exports; a blind override risks breaking routing. Reassess on Router upgrade/new linking adapters. |
| [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c), sprintf-js 1.0.3 | old argparse under nyc configuration tooling; uncontrolled precision in attacker-supplied format strings can exhaust resources. Inspected formats are tool help/usage/configuration, not Gastos financial input. | No official patched release at assessment. Avoid untrusted format/configuration input. Audit `fixAvailable` does not establish a compatible patch; no blind transitive upgrade. |
| [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq), uuid 7.0.3 | xcode `lib/pbxProject.js` calls `uuid.v4()` without a caller-provided buffer. Advisory affects v3/v5/v6 with buffer/offset. | No affected path found in that consumer; compatible patch is unavailable within its current major. Do not major-upgrade solely to suppress a count. Reassess if that consumer starts using affected APIs. |

The independent review did not establish a reachable Gastos application-path blocker
from the remaining packages. This bounded finding does not waive unresolved risks.
In particular the installed runtime decoder, vendored devtools source and signing
verification residual remain visible. A new consumer, routing adapter or deployment
requirement can change this classification.

`npm ci` also reports existing deprecations for uuid, inflight, glob, ESLint and
DOM test adapters. Those are maintenance warnings, not additional independent
proofs of exploitability. Framework/major upgrades belong to separately reviewed
work, not incidental FIN-126 churn. The local npm `http-proxy` configuration warning
comes from the execution environment; repository quality checks treat lint warnings
as errors and do not suppress application warnings.

## Expo patch recommendation (not silently applied)

An online `expo install --check` returned exit1 and recommends newer SDK57 patches:
expo57.0.23→~57.0.30, expo-constants57.0.18→~57.0.22,
expo-crypto57.0.3→~57.0.4, expo-linking57.0.10→~57.0.13,
expo-router57.0.21→~57.0.28 and jest-expo57.0.5→~57.0.6. The offline check had said
up-to-date while explicitly warning that offline validation is unreliable.
This recommendation is an open maintenance/compatibility residual, not evidence
that the current code has a demonstrated runtime incompatibility or the cause of a
particular user's error. Full local quality and iOS/Android exports passed against
the current pinned baseline. Framework patch refreshes are not mixed into the three
targeted advisory fixes; they need their own bounded review and device validation.
