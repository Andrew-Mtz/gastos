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

No environment variables are required. `.env.example` documents the boundary;
private credentials must never be bundled into the app.

## Open on an iPhone from Windows

1. Install an SDK 57-compatible Expo Go on an iPhone running iOS 16.4 or newer.
2. Sign into the same Expo account in Expo Go and the CLI. If needed, run
   `npx.cmd expo login` in the project directory.
3. Connect the computer and iPhone to the same network.
4. Run `npm.cmd run start:clear -- --go`.
5. Scan the terminal QR code with the iPhone camera and open it in Expo Go.
6. Confirm that the Gastos placeholder screen appears without an error and
   still appears after reloading through the Expo Go developer menu.

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

## Structure and scope

`app/_layout.tsx` supplies the routing layout. `app/index.tsx` renders the single
bootstrap screen from `src/components/BootstrapScreen.tsx`.

FIN-002 adds lint/format tooling and named static-check scripts.
FIN-003 will introduce automated testing. FIN-011 will configure EAS and the
development-build workflow. Native projects are not generated in FIN-001.

There is no authentication, backend connection, or financial functionality.
