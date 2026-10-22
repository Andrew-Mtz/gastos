import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

import {
  isDisposableCI,
  startupProcessOptions,
  summarizeStart,
} from '../start-supabase-ci.mjs';

const migration = '20261020220000_fin203_household_invitations.sql';
const priorMigration = '20261019000000_synthetic.sql';
const secret = 'SYNTHETIC_SECRET_MUST_NOT_APPEAR';

test('timeout signal reaches the CLI shim child before startup returns', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ci-start-forwarding-'));
  const pidFile = path.join(root, 'child.pid');
  const signalFile = path.join(root, 'received-signal');
  const childFile = path.join(root, 'child.mjs');
  const shimFile = path.join(root, 'shim.mjs');
  try {
    writeFileSync(
      childFile,
      `
      import { writeFileSync } from 'node:fs';
      process.on('SIGTERM', () => {
        writeFileSync(${JSON.stringify(signalFile)}, 'SIGTERM');
        process.exit(0);
      });
      writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
      setInterval(() => {}, 100);
    `,
    );
    writeFileSync(
      shimFile,
      `
      import { spawn } from 'node:child_process';
      const child = spawn(process.execPath, [${JSON.stringify(childFile)}], { stdio: 'ignore' });
      process.on('SIGTERM', () => child.kill('SIGTERM'));
      child.on('exit', code => process.exit(code ?? 1));
    `,
    );
    const options = startupProcessOptions();
    assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
    assert.equal(options.timeout, 10 * 60 * 1000);
    assert.equal(options.maxBuffer, 8 * 1024 * 1024);
    const result = spawnSync(process.execPath, [shimFile], {
      ...options,
      timeout: 2000,
    });
    assert.equal(result.error?.code, 'ETIMEDOUT');
    assert.equal(readFileSync(signalFile, 'utf8'), 'SIGTERM');
    const childPid = Number(readFileSync(pidFile, 'utf8'));
    assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' });
  } finally {
    // This cleanup also stops the synthetic child if a future regression changes
    // the production timeout to a signal the CLI shim cannot forward.
    if (existsSync(pidFile)) {
      try {
        process.kill(Number(readFileSync(pidFile, 'utf8')), 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test('summary emits only fixed hints and checkout migration names', () => {
  const summary = summarizeStart(
    {
      status: 1,
      stdout: `Applying migration ${priorMigration}...\nApplying migration ${migration}...\nAPI key: ${secret}`,
      stderr: `postgresql://user:${secret}@localhost:54322/postgres\nERROR: constraint "${secret}" already exists (SQLSTATE 42710)`,
    },
    [priorMigration, migration],
  );
  assert.deepEqual(summary, {
    status: 'failed',
    exit_code: 1,
    signal: null,
    runner_error: null,
    sqlstates: ['42710'],
    markers: ['duplicate_constraint'],
    last_attempted_migration: migration,
  });
  assert.equal(JSON.stringify(summary).includes(secret), false);
});

test('unknown payloads, runner details and filenames remain private', () => {
  const summary = summarizeStart(
    {
      status: secret,
      signal: secret,
      error: { code: secret, message: secret, stack: secret },
      stdout: `Applying migration ${secret}.sql...\n(SQLSTATE ABCDE)\n${secret}`,
      stderr: `::warning::${secret}\n::add-mask::${secret}`,
    },
    [migration, `../${secret}.sql`],
  );
  assert.deepEqual(summary, {
    status: 'failed',
    exit_code: 1,
    signal: 'OTHER',
    runner_error: 'OTHER',
    sqlstates: [],
    markers: [],
    last_attempted_migration: null,
  });
  assert.equal(JSON.stringify(summary).includes(secret), false);
});

test('successful startup suppresses keys and service URLs too', () => {
  assert.deepEqual(
    summarizeStart({ status: 0, stdout: secret, stderr: secret }, [migration]),
    {
      status: 'ok',
      exit_code: 0,
      signal: null,
      runner_error: null,
      sqlstates: [],
      markers: [],
      last_attempted_migration: null,
    },
  );
});

test('infrastructure and runner failures expose no matching raw text', () => {
  const summary = summarizeStart(
    {
      status: null,
      signal: 'SIGKILL',
      error: { code: 'ETIMEDOUT', message: secret },
      stderr: `failed to pull ${secret}; no space left on device; address already in use; connection refused; unhealthy; context deadline exceeded`,
    },
    [],
  );
  assert.equal(summary.exit_code, 1);
  assert.equal(summary.signal, 'SIGKILL');
  assert.equal(summary.runner_error, 'ETIMEDOUT');
  assert.deepEqual(summary.markers, [
    'image_pull_failure',
    'disk_full',
    'port_in_use',
    'connection_refused',
    'healthcheck_failure',
    'deadline_exceeded',
  ]);
  assert.equal(JSON.stringify(summary).includes(secret), false);
});

test('runner failure never reports success and invalid exit codes are normalized', () => {
  for (const status of [0, -1, 256, null, undefined, NaN, Infinity]) {
    const summary = summarizeStart({ status, error: { code: 'ENOBUFS' } }, []);
    assert.equal(summary.status, 'failed');
    assert.equal(summary.exit_code, 1);
    assert.equal(summary.runner_error, 'ENOBUFS');
  }
  assert.equal(summarizeStart({ status: 127 }, []).exit_code, 127);
});

test('migration log payload must match a complete allowlisted filename', () => {
  for (const stdout of [
    `Applying migration ${migration}.${secret}...`,
    `Applying migration ${migration.replace('.sql', '_private.sql')}...`,
    `Applying migration ${priorMigration}...`,
  ])
    assert.equal(
      summarizeStart({ status: 1, stdout }, [migration])
        .last_attempted_migration,
      null,
    );
});

test('startup requires disposable GitHub CI and default Docker without overrides', () => {
  const env = { CI: 'true', GITHUB_ACTIONS: 'true' };
  assert.equal(isDisposableCI(env), true);
  assert.equal(isDisposableCI({ ...env, DOCKER_CONTEXT: 'default' }), true);
  for (const extra of [
    { CI: 'false' },
    { GITHUB_ACTIONS: 'false' },
    { DOCKER_HOST: secret },
    { DOCKER_CONTEXT: 'remote' },
    { SUPABASE_CLI_BINARY_OVERRIDE: secret },
  ])
    assert.equal(isDisposableCI({ ...env, ...extra }), false);
  assert.equal(isDisposableCI({}), false);
});
