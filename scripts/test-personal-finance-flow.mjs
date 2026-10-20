import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

// Authenticated HTTP integration, NOT native/UI E2E. Never accepts a target URL,
// hosted credentials or production fixture mode. All identities/data are synthetic.
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const cli = path.join(
  path.dirname(require.resolve('supabase/package.json')),
  'dist/supabase.js',
);
const clients = [],
  owners = [];
let step = 'local-only target preflight';
let localVerified = false;
let fixtureDirectory = null;
const snapshots = [];
const snapshotRpcs = new Set([
  'get_personal_dashboard',
  'get_personal_period_close_context',
  'get_personal_remainder_context',
  'get_personal_carry_reversal_context',
]);
function command(binary, args, input) {
  const result = spawnSync(binary, args, {
    cwd: root,
    input,
    encoding: 'utf8',
    timeout: 30000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  // Do not include command output: status contains local privileged credentials.
  assert(!result.error && result.status === 0, 'Local command failed.');
  return result.stdout;
}
function sql(text) {
  assert(localVerified, 'Local target must be verified before fixture access.');
  return command(
    'docker',
    [
      'exec',
      '-i',
      'supabase_db_gastos',
      'psql',
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-A',
      '-t',
      '-U',
      'postgres',
      '-d',
      'postgres',
    ],
    text,
  );
}
function success(result) {
  assert.equal(result.error, null, 'Authenticated HTTP operation failed.');
  return result.data;
}
function denied(result, code) {
  assert(result.error, 'Expected API rejection.');
  assert.equal(
    result.error.code,
    code,
    'Expected the specific authorization/domain rejection.',
  );
}
async function rpc(client, name, args) {
  const data = success(await client.rpc(name, args));
  if (snapshotRpcs.has(name)) snapshots.push({ kind: name, data });
  return data;
}
function passed(label) {
  console.log(`PASS ${label}`);
  step = label;
}
const uuid = (id) => {
  assert.match(id, /^[0-9a-f-]{36}$/);
  return id;
};
const month = (value) => {
  assert.match(value, /^\d{4}-\d{2}-01$/);
  return value;
};
function shiftMonth(value, offset) {
  const date = new Date(`${month(value)}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 10);
}
function amounts(snapshot) {
  // Assertions below use independent, concrete expected values. This helper only
  // names server components; UI/domain calculations are tested separately by Jest.
  const s = snapshot.availability.savings,
    c = snapshot.availability.commitments;
  assert.equal(snapshot.snapshot_version, 2);
  assert.equal(s.snapshot_version, 2);
  assert.equal(s.configured, true);
  const ordinary =
    s.spendable_allocated_minor +
    s.withdrawals_minor +
    s.carry.incoming_minor -
    s.spent_minor -
    s.contributions_minor -
    s.carry.outgoing_minor;
  const protectedMinor =
    s.opening_protected_minor +
    s.allocated_savings_minor +
    s.contributions_minor -
    s.withdrawals_minor;
  assert.equal(
    s.goal_reserved_minor + s.unassigned_savings_minor,
    protectedMinor,
  );
  return {
    ordinary,
    protectedMinor,
    confirmed: c.buckets.reduce((a, b) => a + b.confirmed_minor, 0),
    unknown: c.buckets.reduce((a, b) => a + b.unknown_count, 0),
    prior: c.prior_unresolved_count,
  };
}
async function dashboard(client, value) {
  return rpc(client, 'get_personal_dashboard', { p_month: value });
}
async function closeContext(client, value) {
  return rpc(client, 'get_personal_period_close_context', { p_month: value });
}
async function correction(client, row, action, changes = {}) {
  const request = {
    p_request_id: randomUUID(),
    p_transaction_id: row.id,
    p_expected_revision: row.revision,
    p_action: action,
    p_changes: changes,
    p_confirmed: true,
  };
  const result = await rpc(client, 'correct_personal_transaction', request);
  assert.deepEqual(
    await rpc(client, 'correct_personal_transaction', request),
    result,
    'Exact correction replay is immutable.',
  );
  return success(
    await client.from('transactions').select('*').eq('id', row.id).single(),
  );
}
try {
  assert.match(
    readFileSync(path.join(root, 'supabase/config.toml'), 'utf8'),
    /^project_id = "gastos"$/m,
  );
  assert(
    !process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT,
    'Remote Docker overrides are unsupported.',
  );
  assert.equal(command('docker', ['context', 'show']).trim(), 'default');
  const status = JSON.parse(
    command(process.execPath, [cli, 'status', '--output', 'json']),
  );
  assert(
    ['http://127.0.0.1:54321', 'http://localhost:54321'].includes(
      status.API_URL,
    ),
    'Only this disposable loopback API is allowed.',
  );
  const key = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  assert.equal(typeof key, 'string');
  if (!key.startsWith('sb_publishable_')) {
    const claims = JSON.parse(
      Buffer.from(key.split('.')[1], 'base64url').toString(),
    );
    assert.equal(
      claims.role,
      'anon',
      'Only a public anonymous key may reach the client.',
    );
  }
  assert.equal(
    command('docker', [
      'inspect',
      '--format',
      '{{.Name}}',
      'supabase_db_gastos',
    ]).trim(),
    '/supabase_db_gastos',
  );
  localVerified = true;
  function client(storage = new Map()) {
    const value = createClient(status.API_URL, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storage: {
          getItem: (k) => storage.get(k) ?? null,
          setItem: (k, v) => storage.set(k, v),
          removeItem: (k) => storage.delete(k),
        },
      },
    });
    clients.push(value);
    return value;
  }
  async function identity(name) {
    const value = client(),
      email = `fin126-${randomUUID()}@example.test`,
      password = randomBytes(24).toString('base64url');
    const created = success(await value.auth.signUp({ email, password }));
    assert(created.user, 'Synthetic signup must return a user.');
    const id = uuid(created.user.id);
    owners.push(id);
    assert(
      created.session,
      'Local confirmation-disabled signup must authenticate.',
    );
    success(await value.auth.signOut({ scope: 'local' }));
    assert.equal(success(await value.auth.getSession()).session, null);
    const signedIn = success(
      await value.auth.signInWithPassword({ email, password }),
    );
    assert.equal(
      signedIn.user.id,
      id,
      'Real password sign-in must return the synthetic owner.',
    );
    success(
      await value.from('profiles').insert({
        id,
        display_name: name,
        base_currency: 'USD',
        timezone: 'UTC',
      }),
    );
    return { client: value, id };
  }
  step = 'real Auth sign-up, sign-out and password sign-in';
  const a = await identity('Synthetic FIN126 A'),
    b = await identity('Synthetic FIN126 B');
  passed('real Auth HTTP password sign-in for two disposable identities');
  const financialMonth = month(
    (await closeContext(a.client, '2025-01-01')).financial_month,
  );
  const sourceMonth = shiftMonth(financialMonth, -1);
  const buckets = await rpc(a.client, 'prepare_initial_budget_buckets');
  const bucket = (key) => {
    const found = buckets.find((v) => v.system_key === key);
    assert(found);
    return uuid(found.id);
  };
  const needs = bucket('NEEDS'),
    leisure = bucket('LEISURE'),
    savings = bucket('SAVINGS');
  const allocations = [
    [needs, 5000],
    [leisure, 3000],
    [savings, 2000],
  ].map(([budget_bucket_id, percentage_basis_points]) => ({
    budget_bucket_id,
    percentage_basis_points,
  }));
  async function setup(value) {
    return rpc(a.client, 'save_initial_budget', {
      p_starts_on: value,
      p_base_currency: 'USD',
      p_expected_income_minor: 999999,
      p_allocations: allocations,
    });
  }
  step = 'HTTP budget setup, expected versus received income';
  const source = await setup(sourceMonth),
    destination = await setup(financialMonth);
  assert.equal(
    await rpc(a.client, 'get_received_income', {
      p_budget_period_id: source.id,
    }),
    0,
  );
  assert.equal(
    amounts(await dashboard(a.client, sourceMonth)).ordinary,
    0,
    'Expected income is not spendable.',
  );
  const category = success(
    await a.client
      .from('categories')
      .insert({
        profile_id: a.id,
        name: 'Synthetic food',
        budget_bucket_id: needs,
      })
      .select('*')
      .single(),
  );
  async function income(period, amount) {
    const request = {
      p_transaction_id: randomUUID(),
      p_budget_period_id: period.id,
      p_amount_minor: amount,
      p_currency: 'USD',
      p_transaction_date: period.starts_on,
    };
    const row = await rpc(a.client, 'register_income', request);
    assert.equal((await rpc(a.client, 'register_income', request)).id, row.id);
    return row;
  }
  async function expense(period, amount) {
    return rpc(a.client, 'register_personal_expense', {
      p_transaction_id: randomUUID(),
      p_budget_period_id: period.id,
      p_amount_minor: amount,
      p_currency: 'USD',
      p_transaction_date: period.starts_on,
      p_category_id: category.id,
    });
  }
  async function movement(period, amount, type, confirmed = false) {
    return rpc(a.client, 'register_savings_movement', {
      p_transaction_id: randomUUID(),
      p_budget_period_id: period.id,
      p_amount_minor: amount,
      p_currency: 'USD',
      p_transaction_date: period.starts_on,
      p_type: type,
      p_withdrawal_confirmed: confirmed,
    });
  }
  await income(source, 100000);
  let food = await expense(source, 60000);
  let summary = await dashboard(a.client, sourceMonth);
  assert.equal(summary.received_income_minor, 100000);
  assert.deepEqual(amounts(summary), {
    ordinary: 20000,
    protectedMinor: 20000,
    confirmed: 0,
    unknown: 0,
    prior: 0,
  });
  assert.equal(
    summary.consumption.buckets.find((v) => v.budget_bucket_id === needs)
      .spent_minor,
    60000,
    'Needs has a 10000 deficit; no savings withdrawal occurs.',
  );
  await movement(source, 5000, 'SAVINGS_CONTRIBUTION');
  denied(
    await a.client.rpc('register_savings_movement', {
      p_transaction_id: randomUUID(),
      p_budget_period_id: source.id,
      p_amount_minor: 1000,
      p_currency: 'USD',
      p_transaction_date: sourceMonth,
      p_type: 'SAVINGS_WITHDRAWAL',
      p_withdrawal_confirmed: false,
    }),
    '23514',
  );
  await movement(source, 1000, 'SAVINGS_WITHDRAWAL', true);
  assert.deepEqual(amounts(await dashboard(a.client, sourceMonth)), {
    ordinary: 16000,
    protectedMinor: 24000,
    confirmed: 0,
    unknown: 0,
    prior: 0,
  });
  passed(
    'budget → actual income → overspent bucket → protected savings and explicit movements',
  );

  step = 'explicit historical recurring fixture';
  const historicalTemplate = randomUUID();
  // The only historical fixture bypass. This models a definition that already
  // existed last month; it is NOT evidence that the user can create it retroactively.
  // Transaction-local DDL is immediately reversed and rolls back on any error.
  sql(`begin; alter table public.recurring_expenses disable trigger recurring_expenses_validate;
    insert into public.recurring_expenses(id,owner_profile_id,name,category_id,amount_mode,currency,due_day,active_from,active_until)
    values('${historicalTemplate}','${a.id}','Synthetic historical electricity','${uuid(category.id)}','VARIABLE','USD',15,'${sourceMonth}','${sourceMonth}');
    alter table public.recurring_expenses enable trigger recurring_expenses_validate; commit;`);
  assert.equal(amounts(await dashboard(a.client, sourceMonth)).unknown, 1);
  assert.equal((await closeContext(a.client, sourceMonth)).can_close, false);
  assert.equal(
    amounts(await dashboard(a.client, financialMonth)).prior,
    1,
    'Earlier unknown obligations remain visible.',
  );
  const resolutionRequest = {
    p_transaction_id: randomUUID(),
    p_template_id: historicalTemplate,
    p_budget_period_id: source.id,
    p_month: sourceMonth,
    p_amount_minor: 4000,
    p_currency: 'USD',
    p_transaction_date: sourceMonth,
  };
  let bill = await rpc(
    a.client,
    'resolve_personal_recurring_expense',
    resolutionRequest,
  );
  assert.equal(
    (
      await rpc(
        a.client,
        'resolve_personal_recurring_expense',
        resolutionRequest,
      )
    ).id,
    bill.id,
  );
  assert.deepEqual(amounts(await dashboard(a.client, sourceMonth)), {
    ordinary: 12000,
    protectedMinor: 24000,
    confirmed: 0,
    unknown: 0,
    prior: 0,
  });
  passed(
    'historical-fixture recurring bill resolved once over HTTP; complete safe-to-spend components',
  );

  step = 'current-month template creation and resolution';
  await income(destination, 10000);
  await expense(destination, 1000);
  const currentTemplate = await rpc(
    a.client,
    'create_personal_recurring_expense',
    {
      p_template_id: randomUUID(),
      p_name: 'Synthetic current bill',
      p_category_id: category.id,
      p_amount_mode: 'VARIABLE',
      p_currency: 'USD',
      p_due_day: 15,
      p_active_from: financialMonth,
      p_active_until: financialMonth,
    },
  );
  const knownTemplates = [];
  for (const [mode, estimate] of [
    ['FIXED', 600],
    ['VARIABLE', 300],
  ]) {
    knownTemplates.push(
      await rpc(a.client, 'create_personal_recurring_expense', {
        p_template_id: randomUUID(),
        p_name: `Synthetic ${mode} known bill`,
        p_category_id: category.id,
        p_amount_mode: mode,
        p_currency: 'USD',
        p_due_day: 15,
        p_active_from: financialMonth,
        p_active_until: financialMonth,
        p_default_amount_minor: estimate,
      }),
    );
  }
  summary = await dashboard(a.client, financialMonth);
  assert.equal(amounts(summary).unknown, 1);
  assert.equal(amounts(summary).confirmed, 600);
  assert.equal(
    summary.availability.commitments.buckets.reduce(
      (sum, bucket) => sum + bucket.estimated_minor,
      0,
    ),
    300,
  );
  assert.equal(
    summary.availability.savings.spent_minor,
    1000,
    'Templates are not actual spending.',
  );
  await rpc(a.client, 'resolve_personal_recurring_expense', {
    p_transaction_id: randomUUID(),
    p_template_id: currentTemplate.id,
    p_budget_period_id: destination.id,
    p_month: financialMonth,
    p_amount_minor: 500,
    p_currency: 'USD',
    p_transaction_date: financialMonth,
  });
  summary = await dashboard(a.client, financialMonth);
  assert.equal(amounts(summary).unknown, 0);
  assert.equal(
    amounts(summary).ordinary - amounts(summary).confirmed,
    5900,
    'Known confirmed obligation remains separate from actual spend.',
  );
  assert.equal(
    summary.availability.commitments.buckets.reduce(
      (sum, bucket) => sum + bucket.estimated_minor,
      0,
    ),
    300,
    'Estimate remains labeled and separate.',
  );
  for (const template of knownTemplates) {
    const actual = await rpc(a.client, 'resolve_personal_recurring_expense', {
      p_transaction_id: randomUUID(),
      p_template_id: template.id,
      p_budget_period_id: destination.id,
      p_month: financialMonth,
      p_amount_minor: template.amount_mode === 'FIXED' ? 600 : 250,
      p_currency: 'USD',
      p_transaction_date: financialMonth,
    });
    await correction(a.client, actual, 'DELETE');
  }
  assert.deepEqual(amounts(await dashboard(a.client, financialMonth)), {
    ordinary: 6500,
    protectedMinor: 26000,
    confirmed: 0,
    unknown: 0,
    prior: 0,
  });
  const currentClose = await closeContext(a.client, financialMonth);
  assert.equal(currentClose.can_close, false);
  denied(
    await a.client.rpc('close_personal_budget_period', {
      p_id: randomUUID(),
      p_budget_period_id: destination.id,
      p_expected_lifecycle_version: 0,
      p_snapshot_hash: currentClose.snapshot_hash,
      p_confirmed: true,
    }),
    '23514',
  );
  passed(
    'real current template creation/resolution; server clock refuses closing current month',
  );

  step = 'correction, cancellation and restoration';
  food = await correction(a.client, food, 'EDIT', {
    amount_minor: 55000,
    transaction_date: sourceMonth,
    category_id: category.id,
    description: 'Synthetic corrected food',
  });
  assert.equal(food.revision, 1);
  bill = await correction(a.client, bill, 'DELETE');
  assert(bill.deleted_at);
  assert.deepEqual(amounts(await dashboard(a.client, sourceMonth)), {
    ordinary: 21000,
    protectedMinor: 24000,
    confirmed: 0,
    unknown: 0,
    prior: 0,
  });
  bill = await correction(a.client, bill, 'RESTORE');
  assert.equal(bill.deleted_at, null);
  assert.equal(bill.recurring_template_id, historicalTemplate);
  assert.deepEqual(amounts(await dashboard(a.client, sourceMonth)), {
    ordinary: 17000,
    protectedMinor: 24000,
    confirmed: 0,
    unknown: 0,
    prior: 0,
  });
  assert.deepEqual(
    success(
      await a.client
        .from('transaction_revisions')
        .select('revision,action')
        .eq('transaction_id', bill.id)
        .order('revision'),
    ),
    [
      { revision: 1, action: 'DELETE' },
      { revision: 2, action: 'RESTORE' },
    ],
  );
  passed(
    'correction history, exact replay, recurring cancellation and same-ID restoration',
  );

  step = 'confirmed close, stale-preview conflict and explicit reopening';
  const stale = await closeContext(a.client, sourceMonth);
  const small = await expense(source, 100);
  denied(
    await a.client.rpc('close_personal_budget_period', {
      p_id: randomUUID(),
      p_budget_period_id: source.id,
      p_expected_lifecycle_version: 0,
      p_snapshot_hash: stale.snapshot_hash,
      p_confirmed: true,
    }),
    '40001',
  );
  await correction(a.client, small, 'DELETE');
  const close = await closeContext(a.client, sourceMonth);
  const closeRequest = {
    p_id: randomUUID(),
    p_budget_period_id: source.id,
    p_expected_lifecycle_version: 0,
    p_snapshot_hash: close.snapshot_hash,
    p_confirmed: true,
  };
  const closed = await rpc(
    a.client,
    'close_personal_budget_period',
    closeRequest,
  );
  assert.equal(closed.lifecycle_version, 1);
  assert.deepEqual(
    await rpc(a.client, 'close_personal_budget_period', closeRequest),
    closed,
  );
  denied(
    await a.client.rpc('correct_personal_transaction', {
      p_request_id: randomUUID(),
      p_transaction_id: food.id,
      p_expected_revision: food.revision,
      p_action: 'DELETE',
      p_changes: {},
      p_confirmed: true,
    }),
    '42501',
  );
  const closedContext = await closeContext(a.client, sourceMonth);
  const reopenRequest = {
    p_id: randomUUID(),
    p_budget_period_id: source.id,
    p_expected_lifecycle_version: 1,
    p_closed_state_hash: closedContext.reopen_hash,
    p_confirmed: true,
  };
  const reopened = await rpc(
    a.client,
    'reopen_personal_budget_period',
    reopenRequest,
  );
  assert.equal(reopened.lifecycle_version, 2);
  assert.deepEqual(
    await rpc(a.client, 'close_personal_budget_period', closeRequest),
    closed,
  );
  assert.equal(
    (await closeContext(a.client, sourceMonth)).period.status,
    'OPEN',
    'Old close replay cannot close again.',
  );
  passed(
    'completed month closes; stale/closed writes fail; explicit reopen preserves immutable close',
  );

  step = 'remainder carry conservation and combined reversal';
  const remainder = await rpc(a.client, 'get_personal_remainder_context', {
    p_month: sourceMonth,
  });
  const carryRequest = {
    p_id: randomUUID(),
    p_budget_period_id: source.id,
    p_expected_lifecycle_version: 2,
    p_preview_hash: remainder.preview_hash,
    p_action: 'CARRY_UNALLOCATED',
    p_amount_minor: 5000,
    p_destination_period_id: destination.id,
    p_confirmed: true,
  };
  // Positive Leisure gross residual is 30000, but net ordinary cap is 17000.
  denied(
    await a.client.rpc('close_and_dispose_personal_remainder', {
      ...carryRequest,
      p_id: randomUUID(),
      p_amount_minor: 17001,
    }),
    '23514',
  );
  const carried = await rpc(
    a.client,
    'close_and_dispose_personal_remainder',
    carryRequest,
  );
  assert.equal(carried.closure.lifecycle_version, 3);
  assert.equal(amounts(await dashboard(a.client, sourceMonth)).ordinary, 12000);
  summary = await dashboard(a.client, financialMonth);
  assert.equal(amounts(summary).ordinary, 11500);
  assert.equal(
    summary.received_income_minor,
    10000,
    'Carry is not received income.',
  );
  assert.equal(
    summary.availability.savings.allocated_savings_minor,
    2000,
    'Carry is not percentage-resplit.',
  );
  assert.deepEqual(summary.availability.savings.carry, {
    incoming_minor: 5000,
    outgoing_minor: 0,
    unallocated_minor: 5000,
    buckets: [],
  });
  let destinationContribution = await movement(
    destination,
    7000,
    'SAVINGS_CONTRIBUTION',
  );
  let reversal = await rpc(a.client, 'get_personal_carry_reversal_context', {
    p_disposition_id: carryRequest.p_id,
  });
  assert.equal(
    reversal.can_reverse,
    false,
    'Already earmarked destination money cannot be reclaimed.',
  );
  denied(
    await a.client.rpc('reverse_carry_and_reopen_personal_period', {
      p_id: randomUUID(),
      p_disposition_id: carryRequest.p_id,
      p_expected_source_version: 3,
      p_expected_destination_version: 0,
      p_preview_hash: reversal.preview_hash,
      p_confirmed: true,
    }),
    '23514',
  );
  destinationContribution = await correction(
    a.client,
    destinationContribution,
    'DELETE',
  );
  assert(destinationContribution.deleted_at);
  reversal = await rpc(a.client, 'get_personal_carry_reversal_context', {
    p_disposition_id: carryRequest.p_id,
  });
  assert.equal(reversal.can_reverse, true);
  const reverseRequest = {
    p_id: randomUUID(),
    p_disposition_id: carryRequest.p_id,
    p_expected_source_version: 3,
    p_expected_destination_version: 0,
    p_preview_hash: reversal.preview_hash,
    p_confirmed: true,
  };
  const reversed = await rpc(
    a.client,
    'reverse_carry_and_reopen_personal_period',
    reverseRequest,
  );
  assert.equal(reversed.reopening.lifecycle_version, 4);
  assert.deepEqual(
    await rpc(
      a.client,
      'reverse_carry_and_reopen_personal_period',
      reverseRequest,
    ),
    reversed,
  );
  assert.deepEqual(
    await rpc(a.client, 'close_and_dispose_personal_remainder', carryRequest),
    carried,
  );
  assert.deepEqual(
    await rpc(a.client, 'reopen_personal_budget_period', reopenRequest),
    reopened,
  );
  assert.equal(amounts(await dashboard(a.client, sourceMonth)).ordinary, 17000);
  assert.equal(
    amounts(await dashboard(a.client, financialMonth)).ordinary,
    6500,
  );
  const finalRemainder = await rpc(a.client, 'get_personal_remainder_context', {
    p_month: sourceMonth,
  });
  const saved = await rpc(a.client, 'close_and_dispose_personal_remainder', {
    p_id: randomUUID(),
    p_budget_period_id: source.id,
    p_expected_lifecycle_version: 4,
    p_preview_hash: finalRemainder.preview_hash,
    p_action: 'SAVINGS',
    p_amount_minor: 1000,
    p_confirmed: true,
  });
  assert.equal(saved.closure.lifecycle_version, 5);
  assert.equal(amounts(await dashboard(a.client, sourceMonth)).ordinary, 16000);
  assert.equal(
    amounts(await dashboard(a.client, sourceMonth)).protectedMinor,
    25000,
  );
  const finalHistory = (await closeContext(a.client, sourceMonth)).history;
  assert.equal(finalHistory.closures.length, 3);
  assert.equal(finalHistory.reopenings.length, 2);
  assert.equal(finalHistory.dispositions.length, 2);
  assert.equal(finalHistory.reversals.length, 1);
  assert.deepEqual(
    finalHistory.closures.find((v) => v.id === closeRequest.p_id).summary,
    closed.summary,
  );
  assert.deepEqual(
    finalHistory.closures.find((v) => v.id === carryRequest.p_id).summary,
    carried.closure.summary,
  );
  passed(
    'net remainder cap, cash-neutral carry, live-funding reversal, immutable histories and savings disposition',
  );

  step = 'cross-user read/write/replay denial and signed-out access';
  assert.deepEqual(
    success(
      await b.client
        .from('transactions')
        .select('id')
        .eq('owner_profile_id', a.id),
    ),
    [],
  );
  assert.deepEqual(
    success(
      await b.client
        .from('budget_period_closures')
        .select('id')
        .eq('owner_profile_id', a.id),
    ),
    [],
  );
  denied(
    await b.client.rpc('get_personal_safe_to_spend', {
      p_budget_period_id: source.id,
    }),
    '42501',
  );
  denied(
    await b.client.rpc('register_income', {
      p_transaction_id: randomUUID(),
      p_budget_period_id: destination.id,
      p_amount_minor: 1,
      p_currency: 'USD',
      p_transaction_date: financialMonth,
    }),
    '42501',
  );
  denied(
    await b.client.rpc('close_and_dispose_personal_remainder', carryRequest),
    '42501',
  );
  assert.equal((await dashboard(b.client, sourceMonth)).period, null);
  assert.equal(
    (await dashboard(a.client, financialMonth)).received_income_minor,
    10000,
    'Rejected forged write cannot change the otherwise valid OPEN destination.',
  );
  const readAgain = client();
  // Explicit token transport exercises an independent HTTP client; no native
  // encrypted session-storage or process-restart claim is made.
  const session = success(await a.client.auth.getSession()).session;
  success(
    await readAgain.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    }),
  );
  assert.equal(
    (await dashboard(readAgain, sourceMonth)).received_income_minor,
    100000,
  );
  success(await a.client.auth.signOut({ scope: 'local' }));
  assert.equal(success(await a.client.auth.getSession()).session, null);
  denied(
    await a.client.rpc('get_personal_safe_to_spend', {
      p_budget_period_id: source.id,
    }),
    '42501',
  );
  passed(
    'real HTTP owner isolation, forged/replayed writes denied, fresh-client read and local logout',
  );
  step = 'real HTTP snapshots through current application parsers';
  fixtureDirectory = mkdtempSync(path.join(tmpdir(), 'gastos-fin126-'));
  const fixturePath = path.join(fixtureDirectory, 'synthetic-snapshots.json');
  // Whitelisted financial responses only, never Auth/session/key payloads. No
  // fixture is committed or uploaded; finally removes this private temp directory.
  writeFileSync(fixturePath, JSON.stringify(snapshots), { mode: 0o600 });
  const contract = spawnSync(
    process.execPath,
    [
      require.resolve('jest/bin/jest'),
      '--runInBand',
      '--runTestsByPath',
      'scripts/__tests__/personal-finance-contract.test.ts',
      '--testMatch',
      '**/scripts/__tests__/personal-finance-contract.test.ts',
    ],
    {
      cwd: root,
      env: { ...process.env, FIN126_SYNTHETIC_SNAPSHOTS: fixturePath },
      stdio: 'inherit',
      timeout: 120000,
    },
  );
  assert(
    !contract.error && contract.status === 0,
    'Real HTTP application-contract suite failed.',
  );
  console.log(
    'FIN-126 authenticated HTTP and application-parser flow passed. Native UI/device execution was not performed.',
  );
} catch {
  // No SDK errors, request/session objects, keys, passwords or raw CLI output.
  console.error(
    `FAIL FIN-126 at: ${step}. No credentials or request payloads are logged.`,
  );
  process.exitCode = 1;
} finally {
  if (fixtureDirectory) {
    try {
      rmSync(fixtureDirectory, { recursive: true, force: true });
    } catch {
      console.error('FAIL removing synthetic snapshot temp directory.');
      process.exitCode = 1;
    }
  }
  await Promise.all(clients.map((value) => value.auth.stopAutoRefresh()));
  if (localVerified && owners.length) {
    try {
      const ids = owners.map((id) => `'${uuid(id)}'`).join(',');
      // Remove only identities created by this invocation. Never reset a database
      // or delete pre-existing developer data. All writes remain local-only.
      sql(`begin;
        delete from public.budget_period_carry_reversals where owner_profile_id in (${ids});
        delete from public.budget_period_dispositions where owner_profile_id in (${ids});
        delete from public.budget_period_reopenings where owner_profile_id in (${ids});
        delete from public.budget_period_closures where owner_profile_id in (${ids});
        delete from public.transaction_revisions where owner_profile_id in (${ids});
        delete from public.transactions where owner_profile_id in (${ids});
        delete from public.recurring_expenses where owner_profile_id in (${ids});
        delete from public.budget_allocations where budget_period_id in (select id from public.budget_periods where profile_id in (${ids}));
        delete from public.savings_goals where owner_profile_id in (${ids});
        delete from public.categories where profile_id in (${ids});
        delete from public.budget_buckets where profile_id in (${ids});
        delete from public.budget_periods where profile_id in (${ids});
        delete from public.profiles where id in (${ids});
        delete from auth.users where id in (${ids}); commit;`);
      console.log("PASS removed only this run's synthetic local fixtures");
    } catch {
      console.error(
        'FAIL local synthetic-fixture cleanup. CI stack teardown remains required.',
      );
      process.exitCode = 1;
    }
  }
}
