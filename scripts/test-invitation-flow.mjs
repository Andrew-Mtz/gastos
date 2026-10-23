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
  'get_my_household_invitations',
  'get_my_household_memberships',
  'get_personal_dashboard',
  'get_household_default_split',
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
async function rpc(client, name, args, expectedOwner) {
  const data = success(await client.rpc(name, args));
  if (snapshotRpcs.has(name))
    snapshots.push({
      kind: name,
      data,
      expected_owner: expectedOwner,
      expected_household: args?.p_household_id,
    });
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
try {
  const configuration = readFileSync(
    path.join(root, 'supabase/config.toml'),
    'utf8',
  );
  assert.match(configuration, /^project_id = "gastos"$/m);
  // Keep the real-catalog privacy inventory aligned with every exposed schema.
  // A new schema requires explicit classification and authorization coverage.
  const apiConfiguration = configuration
    .split(/^\[api\]$/m)[1]
    ?.split(/^\[/m)[0];
  assert(apiConfiguration, 'The API configuration must exist.');
  const exposed = apiConfiguration.match(/^schemas\s*=\s*(\[[^\n]+\])/m)?.[1];
  assert(exposed, 'Exposed schemas must remain explicit.');
  assert.deepEqual(JSON.parse(exposed), ['public', 'graphql_public']);
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
      email = `fin203-${randomUUID()}@example.test`,
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
  step = 'synthetic HTTP invitation lifecycle';
  const a = await identity('Synthetic invitation A'),
    b = await identity('Synthetic invitation B'),
    c = await identity('Synthetic invitation C');
  async function privateIncome(actor, amount) {
    const period = success(
      await actor.client
        .from('budget_periods')
        .insert({
          profile_id: actor.id,
          starts_on: '2025-01-01',
          ends_on: '2025-01-31',
          base_currency: 'USD',
        })
        .select('id')
        .single(),
    );
    const income = await rpc(actor.client, 'register_income', {
      p_transaction_id: randomUUID(),
      p_budget_period_id: period.id,
      p_amount_minor: amount,
      p_currency: 'USD',
      p_transaction_date: '2025-01-02',
    });
    assert.equal(
      success(
        await actor.client
          .from('transactions')
          .select('amount_minor')
          .eq('id', income.id)
          .single(),
      ).amount_minor,
      amount,
    );
    return { actor, period, income, amount };
  }
  const privateA = await privateIncome(a, 12345),
    privateB = await privateIncome(b, 67890);
  const first = randomUUID(),
    second = randomUUID(),
    invite = randomUUID(),
    cancelled = randomUUID();
  await rpc(a.client, 'create_first_household', {
    p_household_id: first,
    p_name: 'Synthetic shared home',
    p_default_currency: 'USD',
  });
  const ownerMember = success(
    await a.client.rpc('get_my_household_memberships'),
  ).households.find((row) => row.id === first).members[0].id;
  const firstSplitRequest = {
    p_request_id: randomUUID(),
    p_household_id: first,
    p_expected_version: 0,
    p_roster: [ownerMember],
    p_shares: [{ member_id: ownerMember, basis_points: 10000 }],
  };
  async function saveSplit(actor, args) {
    const data = await rpc(actor.client, 'save_household_default_split', args);
    snapshots.push({
      kind: 'save_household_default_split',
      data,
      expected_request: {
        id: args.p_request_id,
        householdId: args.p_household_id,
        expectedVersion: args.p_expected_version,
        roster: args.p_roster,
        shares: args.p_shares,
      },
    });
    return data;
  }
  assert.equal(
    (
      await rpc(
        a.client,
        'get_household_default_split',
        { p_household_id: first },
        a.id,
      )
    ).status,
    'UNCONFIGURED',
  );
  await saveSplit(a, firstSplitRequest);
  assert.equal(
    (
      await rpc(
        a.client,
        'get_household_default_split',
        { p_household_id: first },
        a.id,
      )
    ).status,
    'READY',
  );
  await rpc(b.client, 'create_first_household', {
    p_household_id: second,
    p_name: 'Synthetic independent home',
    p_default_currency: 'EUR',
  });
  const own = await rpc(b.client, 'get_my_household_invitations');
  const other = await rpc(c.client, 'get_my_household_invitations');
  const request = {
    p_invitation_id: invite,
    p_household_id: first,
    p_recipient_code: own.recipient_code,
  };
  assert.deepEqual(
    await rpc(a.client, 'create_household_invitation', request),
    { invitation_id: invite },
  );
  assert.deepEqual(
    await rpc(a.client, 'create_household_invitation', request),
    { invitation_id: invite },
  );
  const before = await rpc(b.client, 'get_my_household_invitations');
  assert.equal(before.incoming.length, 1);
  assert.deepEqual(Object.keys(before.incoming[0]).sort(), [
    'expires_at',
    'household_id',
    'household_name',
    'id',
    'status',
  ]);
  assert.equal(
    (await rpc(b.client, 'get_my_household_memberships')).households.length,
    1,
  );
  assert.deepEqual(
    success(
      await b.client
        .from('households')
        .select('id,name,default_currency')
        .eq('id', first),
    ),
    [],
  );
  denied(
    await c.client.rpc('accept_household_invitation', {
      p_invitation_id: invite,
    }),
    '42501',
  );
  denied(await c.client.from('household_recipient_codes').select('*'), '42501');
  denied(await b.client.from('household_invitations').select('*'), '42501');
  assert.equal(
    (await rpc(c.client, 'get_my_household_invitations')).incoming.length,
    0,
  );
  const accepted = { invitation_id: invite, household_id: first };
  assert.deepEqual(
    await rpc(b.client, 'accept_household_invitation', {
      p_invitation_id: invite,
    }),
    accepted,
  );
  assert.deepEqual(
    await rpc(b.client, 'accept_household_invitation', {
      p_invitation_id: invite,
    }),
    accepted,
  );
  const memberships = await rpc(b.client, 'get_my_household_memberships');
  assert.equal(memberships.households.length, 2);
  assert.equal(
    memberships.households
      .find((row) => row.id === first)
      .members.find((row) => row.profile_id === b.id).role,
    'MEMBER',
  );
  const staleSplit = await rpc(
    b.client,
    'get_household_default_split',
    { p_household_id: first },
    b.id,
  );
  assert.equal(staleSplit.status, 'STALE');
  assert.equal(staleSplit.template, null);
  assert.equal(staleSplit.version, 1);
  const sharedRoster = memberships.households.find(
    (row) => row.id === first,
  ).members;
  const reviewedSplit = {
    p_request_id: randomUUID(),
    p_household_id: first,
    p_expected_version: 1,
    p_roster: sharedRoster.map((row) => row.id),
    p_shares: sharedRoster.map((row) => ({
      member_id: row.id,
      basis_points: row.profile_id === a.id ? 7000 : 3000,
    })),
  };
  denied(
    await b.client.rpc('save_household_default_split', reviewedSplit),
    '42501',
  );
  denied(
    await c.client.rpc('get_household_default_split', {
      p_household_id: first,
    }),
    '42501',
  );
  denied(await a.client.from('household_split_revisions').select('*'), '42501');
  denied(await b.client.from('household_split_shares').select('*'), '42501');
  const receipt = await saveSplit(a, reviewedSplit);
  assert.equal(receipt.version, 2);
  assert.deepEqual(await saveSplit(a, reviewedSplit), receipt);
  assert.equal((await saveSplit(a, firstSplitRequest)).version, 1);
  const currentSplit = await rpc(
    b.client,
    'get_household_default_split',
    { p_household_id: first },
    b.id,
  );
  assert.equal(currentSplit.status, 'READY');
  assert.equal(currentSplit.version, 2);
  assert.equal(
    currentSplit.template.shares.find((row) => row.member_id === ownerMember)
      .basis_points,
    7000,
  );
  passed(
    'FIN-205 explicit owner split, join-stale review, member reads, denial and immutable historical replay over HTTP',
  );
  // FIN-207 reuses the authenticated household journey, with no UI/history scope.
  const sharedRequest = {
    p_request_id: randomUUID(),
    p_household_id: first,
    p_payer_member_id: ownerMember,
    p_template_id: reviewedSplit.p_request_id,
    p_template_version: 2,
    p_roster: sharedRoster.map((row) => row.id),
    p_amount_minor: 101,
    p_currency: 'USD',
    p_transaction_date: '2025-01-02',
    p_description: 'Synthetic shared expense',
  };
  const appSharedRequest = {
    id: sharedRequest.p_request_id,
    householdId: first,
    payerMemberId: ownerMember,
    templateId: sharedRequest.p_template_id,
    templateVersion: 2,
    roster: sharedRequest.p_roster,
    amountMinor: 101,
    currency: 'USD',
    transactionDate: '2025-01-02',
    description: sharedRequest.p_description,
  };
  const beforeShared = await Promise.all(
    [a, b].map(async (actor) =>
      success(
        await actor.client.rpc('get_personal_dashboard', {
          p_month: '2025-01-01',
        }),
      ),
    ),
  );
  // FIN-208: bypassing the fixed-currency form still fails at the trusted RPC.
  const wrongCurrencyId = randomUUID();
  denied(
    await b.client.rpc('create_shared_expense', {
      ...sharedRequest,
      p_request_id: wrongCurrencyId,
      p_currency: 'EUR',
    }),
    '23514',
  );
  denied(
    await b.client.rpc('get_shared_expense', {
      p_household_id: first,
      p_expense_id: wrongCurrencyId,
    }),
    '42501',
  );
  const sharedCreated = success(
    await b.client.rpc('create_shared_expense', sharedRequest),
  );
  snapshots.push({
    kind: 'create_shared_expense',
    expected_owner: b.id,
    expected_request: appSharedRequest,
    data: sharedCreated,
  });
  assert.equal(sharedCreated.created_by, b.id);
  assert.equal(sharedCreated.payer_member_id, ownerMember);
  assert.equal(
    sharedCreated.splits.reduce(
      (sum, row) => sum + row.responsibility_amount_minor,
      0,
    ),
    101,
  );
  for (const actor of [a, b]) {
    const data = success(
      await actor.client.rpc('get_shared_expense', {
        p_household_id: first,
        p_expense_id: sharedRequest.p_request_id,
      }),
    );
    snapshots.push({
      kind: 'get_shared_expense',
      expected_owner: actor.id,
      expected_household: first,
      expected_expense: sharedRequest.p_request_id,
      data,
    });
    assert.equal(data.profile_id, actor.id);
    assert.deepEqual(data.splits, sharedCreated.splits);
    assert.deepEqual(
      success(
        await actor.client
          .from('transactions')
          .select('id')
          .eq('id', sharedRequest.p_request_id),
      ),
      [],
    );
  }
  // FIN-209: actual authenticated scalar pages and detail use the production parsers.
  const secondSharedId = randomUUID();
  success(
    await b.client.rpc('create_shared_expense', {
      ...sharedRequest,
      p_request_id: secondSharedId,
      p_transaction_date: '2025-01-03',
    }),
  );
  async function history(actor, household, before = null, limit = 1) {
    const data = success(
      await actor.client.rpc('list_shared_expenses', {
        p_household_id: household,
        p_limit: limit,
        ...(before ? { p_before_expense_id: before } : {}),
      }),
    );
    snapshots.push({
      kind: 'list_shared_expenses',
      data,
      expected_owner: actor.id,
      expected_household: household,
      expected_cursor: before,
      expected_limit: limit,
    });
    return data;
  }
  for (const actor of [a, b]) {
    const firstPage = await history(actor, first);
    assert.equal(firstPage.expenses.length, 1);
    assert.equal(firstPage.expenses[0].expense_id, secondSharedId);
    assert.equal(firstPage.next_cursor, secondSharedId);
    const lastPage = await history(actor, first, firstPage.next_cursor);
    assert.equal(lastPage.expenses[0].expense_id, sharedRequest.p_request_id);
    assert.equal(lastPage.next_cursor, null);
    assert.deepEqual(lastPage.expenses[0].splits, sharedCreated.splits);
    const data = success(
      await actor.client.rpc('get_shared_expense_history_detail', {
        p_household_id: first,
        p_expense_id: sharedRequest.p_request_id,
      }),
    );
    snapshots.push({
      kind: 'get_shared_expense_history_detail',
      data,
      expected_owner: actor.id,
      expected_household: first,
      expected_expense: sharedRequest.p_request_id,
    });
    assert.deepEqual(data.expense.splits, sharedCreated.splits);
    assert.equal(data.members.length, 2);
  }
  assert.deepEqual((await history(b, second)).expenses, []);
  denied(
    await c.client.rpc('list_shared_expenses', { p_household_id: first }),
    '42501',
  );
  denied(
    await c.client.rpc('get_shared_expense_history_detail', {
      p_household_id: first,
      p_expense_id: sharedRequest.p_request_id,
    }),
    '42501',
  );
  denied(
    await b.client.rpc('list_shared_expenses', {
      p_household_id: second,
      p_before_expense_id: sharedRequest.p_request_id,
    }),
    '22023',
  );
  denied(
    await a.client.rpc('list_shared_expenses', {
      p_household_id: first,
      p_before_expense_id: privateA.income.id,
    }),
    '22023',
  );
  denied(
    await a.client.rpc('get_shared_expense_history_detail', {
      p_household_id: first,
      p_expense_id: privateA.income.id,
    }),
    '42501',
  );
  passed(
    'FIN-209 real HTTP bounded history, independent detail authorization and private cursor rejection',
  );
  denied(
    await c.client.rpc('get_shared_expense', {
      p_household_id: first,
      p_expense_id: sharedRequest.p_request_id,
    }),
    '42501',
  );
  denied(
    await c.client.rpc('create_shared_expense', {
      ...sharedRequest,
      p_request_id: randomUUID(),
    }),
    '42501',
  );
  denied(
    await a.client.rpc('get_shared_expense', {
      p_household_id: first,
      p_expense_id: privateA.income.id,
    }),
    '42501',
  );
  denied(
    await b.client.rpc('get_shared_expense', {
      p_household_id: second,
      p_expense_id: sharedRequest.p_request_id,
    }),
    '42501',
  );
  denied(
    await b.client.rpc('create_shared_expense', {
      ...sharedRequest,
      p_amount_minor: 102,
    }),
    '23505',
  );
  success(
    await a.client.rpc('save_household_default_split', {
      ...reviewedSplit,
      p_request_id: randomUUID(),
      p_expected_version: 2,
      p_shares: sharedRoster.map((row) => ({
        member_id: row.id,
        basis_points: 5000,
      })),
    }),
  );
  const sharedReplay = success(
    await b.client.rpc('create_shared_expense', sharedRequest),
  );
  snapshots.push({
    kind: 'create_shared_expense',
    expected_owner: b.id,
    expected_request: appSharedRequest,
    data: sharedReplay,
  });
  assert.deepEqual(
    sharedReplay,
    sharedCreated,
    'Exact retry after template change must return original responsibility',
  );
  denied(
    await b.client.rpc('create_shared_expense', {
      ...sharedRequest,
      p_request_id: randomUUID(),
    }),
    '40001',
  );
  for (const [index, actor] of [a, b].entries())
    assert.deepEqual(
      success(
        await actor.client.rpc('get_personal_dashboard', {
          p_month: '2025-01-01',
        }),
      ),
      beforeShared[index],
      'Shared actor/payer never alter current personal read models',
    );
  const afterTemplate = await history(a, first, secondSharedId);
  assert.deepEqual(
    afterTemplate.expenses[0].splits,
    sharedCreated.splits,
    'History never recalculates old responsibility from a new template',
  );
  passed(
    'FIN-207 authenticated create/read/replay, template conflict, private isolation and unchanged personal dashboards',
  );

  assert.deepEqual(
    success(await b.client.from('profiles').select('id').eq('id', a.id)),
    [],
  );
  assert.deepEqual(
    success(await b.client.from('households').select('id').order('id')).map(
      (row) => row.id,
    ),
    [first, second].sort(),
  );
  assert.deepEqual(
    success(
      await c.client.from('households').select('id,name,default_currency'),
    ),
    [],
  );
  assert.deepEqual(
    success(
      await c.client
        .from('household_members')
        .select('id,household_id,profile_id,role'),
    ),
    [],
  );
  assert.deepEqual(
    (await rpc(c.client, 'get_my_household_memberships')).households,
    [],
  );
  for (const victim of [privateA, privateB]) {
    for (const outsider of [victim.actor === a ? b : a, c]) {
      assert.deepEqual(
        success(
          await outsider.client
            .from('transactions')
            .select('id,amount_minor')
            .eq('id', victim.income.id),
        ),
        [],
      );
      assert.deepEqual(
        success(
          await outsider.client
            .from('budget_periods')
            .select('id')
            .eq('id', victim.period.id),
        ),
        [],
      );
      assert.deepEqual(
        success(
          await outsider.client
            .from('profiles')
            .select('id')
            .eq('id', victim.actor.id),
        ),
        [],
      );
      denied(
        await outsider.client.rpc('get_received_income', {
          p_budget_period_id: victim.period.id,
        }),
        '42501',
      );
      const before = success(
        await victim.actor.client.from('transactions').select('*'),
      );
      denied(
        await outsider.client.rpc('register_income', {
          p_transaction_id: randomUUID(),
          p_budget_period_id: victim.period.id,
          p_amount_minor: 1,
          p_currency: 'USD',
          p_transaction_date: '2025-01-03',
        }),
        '42501',
      );
      assert.deepEqual(
        success(await victim.actor.client.from('transactions').select('*')),
        before,
        'Rejected HTTP mutation leaves owner financial rows unchanged.',
      );
    }
    assert.equal(
      await rpc(victim.actor.client, 'get_received_income', {
        p_budget_period_id: victim.period.id,
      }),
      victim.amount,
    );
    const dashboard = await rpc(
      victim.actor.client,
      'get_personal_dashboard',
      {
        p_month: '2025-01-01',
      },
      victim.actor.id,
    );
    assert.equal(dashboard.owner_profile_id, victim.actor.id);
    assert.equal(dashboard.period.id, victim.period.id);
    assert.equal(dashboard.received_income_minor, victim.amount);
  }
  const strangerDashboard = await rpc(
    c.client,
    'get_personal_dashboard',
    {
      p_month: '2025-01-01',
    },
    c.id,
  );
  assert.equal(strangerDashboard.owner_profile_id, c.id);
  assert.equal(strangerDashboard.period, null);
  passed(
    'FIN-204 reciprocal private finance isolation, own dashboard results and stranger household denial',
  );
  await rpc(a.client, 'get_my_household_invitations');
  await rpc(b.client, 'get_my_household_invitations');
  await rpc(a.client, 'create_household_invitation', {
    p_invitation_id: cancelled,
    p_household_id: first,
    p_recipient_code: other.recipient_code,
  });
  assert.deepEqual(
    await rpc(a.client, 'revoke_household_invitation', {
      p_invitation_id: cancelled,
    }),
    { invitation_id: cancelled },
  );
  assert.deepEqual(
    await rpc(a.client, 'revoke_household_invitation', {
      p_invitation_id: cancelled,
    }),
    { invitation_id: cancelled },
  );
  denied(
    await c.client.rpc('accept_household_invitation', {
      p_invitation_id: cancelled,
    }),
    '22023',
  );
  await rpc(c.client, 'get_my_household_invitations');
  passed(
    'directed invitation, replay, multi-household MEMBER acceptance, cancellation and private Profile isolation over HTTP',
  );
  success(await b.client.auth.signOut({ scope: 'local' }));
  denied(await b.client.rpc('get_my_household_invitations'), '42501');
  denied(
    await b.client.rpc('list_shared_expenses', { p_household_id: first }),
    '42501',
  );
  denied(
    await b.client.rpc('get_shared_expense_history_detail', {
      p_household_id: first,
      p_expense_id: sharedRequest.p_request_id,
    }),
    '42501',
  );
  step = 'real HTTP invitation JSON through production application parsers';
  fixtureDirectory = mkdtempSync(path.join(tmpdir(), 'gastos-fin203-'));
  const fixturePath = path.join(fixtureDirectory, 'synthetic-invitations.json');
  writeFileSync(fixturePath, JSON.stringify(snapshots), { mode: 0o600 });
  const contract = spawnSync(
    process.execPath,
    [
      require.resolve('jest/bin/jest'),
      '--runInBand',
      '--runTestsByPath',
      'scripts/__tests__/invitation-contract.test.ts',
      '--testMatch',
      '**/scripts/__tests__/invitation-contract.test.ts',
    ],
    {
      cwd: root,
      env: { ...process.env, FIN203_SYNTHETIC_SNAPSHOTS: fixturePath },
      stdio: 'inherit',
      timeout: 120000,
    },
  );
  assert(
    !contract.error && contract.status === 0,
    'Real HTTP application invitation parser bridge failed.',
  );
  passed(
    'HTTP invitation payloads pass real app parsers; no native/device acceptance claim',
  );
} catch {
  console.error(
    `FAIL FIN-203 at: ${step}. No credentials or request payloads are logged.`,
  );
  process.exitCode = 1;
} finally {
  if (fixtureDirectory)
    rmSync(fixtureDirectory, { recursive: true, force: true });
  await Promise.all(clients.map((value) => value.auth.stopAutoRefresh()));
  if (localVerified && owners.length) {
    try {
      const ids = owners.map((id) => `'${uuid(id)}'`).join(',');
      sql(`begin;
        delete from public.shared_expense_splits where household_id in (select id from public.households where created_by in (${ids}));
        delete from public.shared_expenses where household_id in (select id from public.households where created_by in (${ids}));
        delete from public.transactions where household_id in (select id from public.households where created_by in (${ids}));
        delete from public.transaction_revisions where owner_profile_id in (${ids});
        delete from public.transactions where owner_profile_id in (${ids});
        delete from public.budget_periods where profile_id in (${ids});
        delete from public.household_split_shares where household_id in (select id from public.households where created_by in (${ids}));
        delete from public.household_split_revisions where created_by in (${ids});
        delete from public.household_invitations where issuer_profile_id in (${ids});
        delete from public.household_members where profile_id in (${ids});
        delete from public.households where created_by in (${ids});
        delete from public.household_recipient_codes where profile_id in (${ids});
        delete from public.profiles where id in (${ids});
        delete from auth.users where id in (${ids});commit;`);
      console.log('PASS exact per-run synthetic invitation fixtures removed');
    } catch {
      console.error(
        'FAIL synthetic invitation cleanup; disposable CI teardown required.',
      );
      process.exitCode = 1;
    }
  }
}
