import assert from 'node:assert/strict';
import test from 'node:test';

import { isDisposableCI, summarizeStart } from '../start-supabase-ci.mjs';

const migration = '20261020220000_fin203_household_invitations.sql';
const priorMigration = '20261019000000_synthetic.sql';
const secret = 'SYNTHETIC_SECRET_MUST_NOT_APPEAR';

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
