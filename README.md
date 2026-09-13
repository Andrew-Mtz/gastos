# Gastos

Minimal mobile application foundation for FIN-001, using Expo SDK 57,
TypeScript strict mode, and Expo Router. See `docs/` and `AGENTS.md` for the
product specification and development rules. ADR-061 defines the SDK baseline.

## Bootstrap verification status

Plain `npm ci` passes with `node_modules` removed first and leaves the lockfile
unchanged. The dependency tree, Expo SDK compatibility check, Expo Doctor
(21/21 checks), TypeScript, iOS Hermes export, and Metro startup also pass.

React DOM, Reanimated, Worklets, and Gesture Handler are explicit direct
dependencies matching Expo SDK 57's supported set. This constrains Router's
transitive peers without peer-check bypasses or dependency overrides.

The dependency audit reports 13 moderate findings; no automatic fixes have been
applied. The user successfully opened the app on a physical iPhone using Expo Go
and confirmed that `Gastos` and `La aplicación está lista para comenzar.` appeared
correctly. Reload has not been explicitly verified.

## Setup

Use Node.js LTS (SDK 57 requires Node 22.13 or newer) and npm.
The bootstrap was developed with Node 24.14.0 and npm 11.9.0.

```powershell
npm.cmd ci
npm.cmd start
```

The application now requires the public values documented in `.env.example` in
ignored `.env.local`. Private credentials must never be bundled into the app.

## Local Supabase development

ADR-063 defines local-first development. Install a Docker-compatible runtime
(Docker Desktop with Linux containers on Windows), start it, and verify that
`docker version` reports both Client and Server. The CLI is pinned in this project
and installed by `npm ci`; no global CLI or hosted project is required.

The repository already contains the CLI-generated `supabase/config.toml` and
`.gitignore`. Do not rerun `supabase init` or enable its optional IDE configuration.

```powershell
npm.cmd run supabase:cli -- --version
npm.cmd run supabase:start
npm.cmd run supabase:status
npm.cmd run db:reset
npm.cmd run supabase:cli -- migration list --local
npm.cmd run db:types
```

The first startup downloads Docker images. `db:reset` destroys and rebuilds only
the local development database from migrations and seeds. The current schema
includes the Profile migration; the seed file remains comment-only. Add schema
changes through migrations when their roadmap tasks begin, then regenerate types.

Copy `.env.example` to ignored `.env.local` and set only the local API URL and
publishable key from status output. Both are public client configuration. Never
copy secret/service-role keys, database passwords, access tokens, or signing keys
into the app or Git. Status output includes privileged local credentials; do not
paste its full output into reports. Keep the local stack on a trusted network.

`db:types` generates the local `public` schema into
`src/infrastructure/supabase/database.types.ts`, formats it with Prettier, and
preserves the existing file on generation failure. Commit types with schema
changes. Type regeneration needs Docker; ordinary static checks use committed types.

FIN-005 verifies the Profile schema, grants, RLS, constraints, and timestamps with
one transactional pgTAP test. FIN-010 shares synthetic Auth fixtures and JWT context
support through `supabase/tests/helpers/auth.sql.inc`. With Docker and the local
stack running, apply migrations and run all tests or a focused file:

```powershell
npm.cmd run db:reset
npm.cmd run db:test
npm.cmd run db:test -- supabase/tests/profiles.test.sql
```

The test creates synthetic Auth fixtures inside a rolled-back transaction; no
persistent test users or signup flow are required by that test. FIN-006 adds
application Profile Setup after authentication.

Each database test owns `begin`/`finish()`/`rollback` and enables `ON_ERROR_STOP`.
Include shared support with `\ir helpers/auth.sql.inc`; `.inc` files are not
discovered as tests. Keep role switches explicit and assert `current_user` and
real `auth.uid()`. Expected SQL errors use pgTAP assertions. RLS filtering under
a granted operation is distinct from SQL permission denial; test both where relevant.
Run files independently and repeat the full suite to check isolation. No test
helper belongs in a production migration, and these SQL tests do not verify login.

Stop the stack when finished, preserving its local data:

```powershell
npm.cmd run supabase:stop
```

The root client validates public configuration, persists sessions through the
ADR-064 encrypted adapter, and manages refresh through one root AppState lifecycle.
URL session detection is disabled; no URL polyfill is needed with Expo SDK 57.
A physical iPhone must use the computer's reachable LAN address instead of
localhost in `EXPO_PUBLIC_SUPABASE_URL` (port 54321).

## Authentication development (FIN-006)

Email/password signup leads to Profile Setup when the local Auth session exists.
Local email confirmation is currently disabled. Environments requiring email
confirmation show pending feedback; no callback flow is implemented. Sign in
resumes missing Profile Setup or opens Inicio in the authenticated shell. Profile Setup
collects display name, uppercase three-letter currency, and a named timezone.
PostgreSQL remains authoritative for validation and authorization.

Supabase owns the session. SecureStore holds only a small AES-256 key;
AsyncStorage holds authenticated AES-GCM ciphertext with fresh nonces. Storage
failure locks private UI and is retryable. Logout clears local session/cache;
it does not promise global revocation of already-issued access tokens.

With the local stack running and a loopback URL in `.env.local`:

```powershell
node --env-file=.env.local scripts/verify-auth-local.mjs
npm.cmd run db:reset
```

The script uses public credentials and synthetic users to verify normal Auth,
Profile isolation, restoration with an in-memory serialized test adapter, refresh,
and logout. It refuses hosted URLs. Reset removes those synthetic fixtures and
all other local development data. It does not test native encrypted persistence.

## Open on an iPhone from Windows

Current iOS development uses Expo Go. Apple Developer membership and EAS Development
Build setup are intentionally deferred. Consult ADR-065 before introducing a feature
requiring native iOS code, a signed development build, or TestFlight distribution.

1. Install an SDK 57-compatible Expo Go on an iPhone running iOS 16.4 or newer.
2. Sign into the same Expo account in Expo Go and the CLI. If needed, run
   `npx.cmd expo login` in the project directory.
3. Connect the computer and iPhone to the same network.
4. Run `npm.cmd run start:clear -- --go`.
5. Scan the terminal QR code with the iPhone camera and open it in Expo Go.
6. Confirm no sign-in flash during restoration. Sign up with a synthetic account,
   complete Profile Setup, and verify the Gastos screen. Sign out and sign in again.
7. Terminate and reopen Expo Go: confirm the session and Profile restore. Exercise
   background/foreground, then log out and restart: sign-in must remain visible.
8. Sign in as a second user: no first-user Profile/UI may remain. Confirm the
   actual native session persists, with no storage-size error or plaintext fallback.

FIN-006 was verified manually by the user on a physical iPhone through Expo Go:
startup without an incorrect sign-in flash, signup, Profile Setup, the authenticated
Gastos screen, session restoration after reopening, background/foreground lifecycle,
logout, unauthenticated restart after logout, and isolation when switching users all
passed. Nonblocking UI polish remains outside FIN-006. Expo Go cannot verify standalone
reinstall semantics; iOS Keychain items may survive reinstall while app-container
AsyncStorage typically does not. Orphan entries are cleaned up and never authenticate.

If the phone cannot connect, check that Windows Firewall permits Node.js on
the private network and that the network permits communication between devices.
Starting Metro or exporting an iOS bundle does not verify physical-device launch.

## Scripts and checks

- `npm start`: start Metro.
- `npm run start:clear`: start Metro with a cleared cache.
- `npm run android`: open on an available Android device/emulator.
- `npm run ios`: open the iOS Simulator on a Mac; unavailable on Windows.
- `npm run typecheck`: check TypeScript without emitting files.
- `npm run lint`: lint source and configuration using Expo's flat ESLint config; warnings fail the check.
- `npm run format`: format supported project files with standalone Prettier.
- `npm run format:check`: check formatting without modifying files.
- `npm test`: run all unit and component tests once.
- `npm run test:watch`: rerun tests in watch mode during development.

Prettier preserves single-quoted TypeScript strings and uses LF line endings.
Documentation, the lockfile, and generated files are excluded from bulk formatting.
ESLint and Prettier run separately; `eslint-config-prettier` prevents conflicting
formatting rules. VS Code users can use the ESLint and Prettier extensions with
the repository configuration. Run the named checks before submitting changes.

```powershell
npx.cmd expo install --check
npx.cmd expo-doctor@latest
npx.cmd expo config --type public
npx.cmd tsc --showConfig
npx.cmd tsc --noEmit
npx.cmd expo export --platform ios --output-dir dist/ios
```

Run Expo-managed dependency installations through `npx.cmd expo install` and
keep `package-lock.json` with the project. Stay within SDK 57 until a dedicated
upgrade is approved.

## Continuous integration (FIN-009 / FIN-010)

GitHub Actions runs `.github/workflows/ci.yml` automatically for pull requests
targeting `main`. The Node version comes from `.nvmrc`; npm is bundled with Node.
The `Quality checks` job runs `npm ci`, `npm run typecheck`, `npm run lint`,
`npm run format:check`, and `npm test -- --runInBand`.
The separate `Database authorization` job installs dependencies, verifies Docker,
starts local Supabase, resets from migrations, and runs `npm run db:test`. Cleanup
stops Supabase even after failure. Startup output is suppressed because it can
contain privileged local credentials; do not print raw status or debug output.
No repository secrets or hosted Supabase credentials are required. Both jobs must
pass before merge. Deployment and mobile builds remain outside this workflow.

## Structure and scope

`app/_layout.tsx` owns the QueryClient and Auth lifecycle. Protected groups route
to `(auth)`, `profile-setup`, or `(app)`. `app/(app)/index.tsx` reuses
`src/components/BootstrapScreen.tsx`. FIN-007 adds standard bottom tabs directly in
`(app)`: Inicio, Transacciones, Presupuesto, Hogar, and Ajustes. The latter four
are placeholders; Ajustes provides the shell sign-out action through the existing
AuthProvider. Centralized Auth/Profile protection is unchanged. Auth forms and Profile
resolution live under `src/features/auth/`; secure persistence stays in infrastructure.

FIN-002 adds lint/format tooling and named static-check scripts.
FIN-003 adds Jest 29 with `jest-expo` and React Native Testing Library 14 (ADR-062).
Component tests live alongside components in `__tests__/*.test.tsx`; future domain
tests will live alongside their modules in `__tests__/*.test.ts`. Tests stay under
`src/`, outside Router's `app/` directory. They do not replace native/device verification.
FIN-011's EAS development-build workflow is intentionally deferred by ADR-065.
Generated native projects remain absent from the repository.

FIN-004 adds local Supabase infrastructure, FIN-005 adds private Profiles, and
FIN-006 implements authentication and Profile Setup. Financial functionality is
not implemented.

## Navigation shell verification (FIN-007)

Automated navigation tests use real Expo Router layouts with a controlled Auth
boundary. The user verified the shell on a physical iPhone: Auth routing without
private-shell flash, all five tabs, repeated switching, background/foreground,
Ajustes sign-out, and private-route exclusion after logout. Tab labels, icons,
and sign-out were usable. No financial functionality is implemented by these placeholders.

## Initial design system (FIN-008)

`src/theme/tokens.ts` defines semantic colors, spacing, typography, radius, and
control sizing. Shared React Native presentation primitives live in
`src/components/ui/`; use these tokens and components for current screens while
keeping validation, Auth, and navigation logic in their features. No UI framework,
custom fonts, ThemeProvider, or dark mode is introduced.

FIN-008 was verified manually by the user on a physical iPhone: Sign In, Sign Up,
Profile Setup, authenticated navigation, logout, and all five tabs remained usable.
Larger iOS text sizes increased typography without breaking essential layouts or
actions. Existing functionality remained intact.
