import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// Startup can print privileged keys and URLs. Never log its output, error object
// or stack. Fixed markers are hints, not a claim that we know the root cause.
const sqlstates = [
  '23503',
  '23505',
  '23514',
  '42501',
  '42601',
  '42710',
  '42P01',
  '42P07',
  '42883',
];
const markers = [
  ['duplicate_constraint', /constraint [^\r\n]* already exists/i],
  ['image_pull_failure', /failed to pull|error pulling|toomanyrequests/i],
  ['disk_full', /no space left on device/i],
  ['port_in_use', /address already in use|port is already allocated/i],
  ['connection_refused', /connection refused/i],
  ['healthcheck_failure', /unhealthy|not healthy|failed healthcheck/i],
  ['deadline_exceeded', /context deadline exceeded/i],
];
const runnerErrors = ['ENOENT', 'EACCES', 'ENOBUFS', 'ETIMEDOUT'];
const signals = ['SIGTERM', 'SIGKILL', 'SIGINT'];

export function startupProcessOptions() {
  return {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 8 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
    // The pinned CLI's Node shim forwards SIGTERM to its binary child; SIGKILL
    // would bypass that forwarding and could leave start racing job cleanup.
    killSignal: 'SIGTERM',
  };
}

export function isDisposableCI(env) {
  return (
    env.CI === 'true' &&
    env.GITHUB_ACTIONS === 'true' &&
    !env.DOCKER_HOST &&
    (!env.DOCKER_CONTEXT || env.DOCKER_CONTEXT === 'default') &&
    !env.SUPABASE_CLI_BINARY_OVERRIDE
  );
}

export function summarizeStart(result, repositoryMigrations) {
  const output = [result.stdout, result.stderr]
    .filter((value) => typeof value === 'string')
    .join('\n');
  const succeeded = result.status === 0 && !result.error && !result.signal;
  const attempted = repositoryMigrations
    .filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name))
    .map((name) => ({
      name,
      position: output.lastIndexOf(`Applying migration ${name}...`),
    }))
    .filter(({ position }) => position >= 0)
    .sort((a, b) => b.position - a.position);
  return {
    status: succeeded ? 'ok' : 'failed',
    exit_code: succeeded
      ? 0
      : Number.isInteger(result.status) &&
          result.status > 0 &&
          result.status <= 255
        ? result.status
        : 1,
    signal: result.signal
      ? signals.includes(result.signal)
        ? result.signal
        : 'OTHER'
      : null,
    runner_error: result.error
      ? runnerErrors.includes(result.error.code)
        ? result.error.code
        : 'OTHER'
      : null,
    sqlstates: sqlstates.filter((code) =>
      output.includes(`(SQLSTATE ${code})`),
    ),
    markers: markers
      .filter(([, pattern]) => pattern.test(output))
      .map(([name]) => name),
    // Only a validated filename from this checkout, never a parsed log payload.
    last_attempted_migration: attempted[0]?.name ?? null,
  };
}

function main() {
  if (!isDisposableCI(process.env)) {
    console.error(
      'Supabase CI startup refused outside the expected disposable CI environment.',
    );
    process.exitCode = 1;
    return;
  }
  try {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const require = createRequire(import.meta.url);
    const cli = path.join(
      path.dirname(require.resolve('supabase/package.json')),
      'dist/supabase.js',
    );
    const migrations = readdirSync(path.join(root, 'supabase/migrations'));
    const result = spawnSync(process.execPath, [cli, 'start'], {
      ...startupProcessOptions(),
      cwd: root,
    });
    const summary = summarizeStart(result, migrations);
    // No raw output is written to disk or uploaded as an artifact.
    console.log(`Supabase local startup: ${JSON.stringify(summary)}`);
    process.exitCode = summary.exit_code;
  } catch {
    console.error(
      'Supabase CI startup failed before a safe summary could be produced.',
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
