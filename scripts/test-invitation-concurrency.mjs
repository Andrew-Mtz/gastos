import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// Local disposable Supabase only. There is deliberately no URL, target override,
// hosted credential, or dependency. UUIDs belong solely to this invocation and
// cleanup removes only these synthetic fixtures, including failed/racing writes.
const command = [
  'exec',
  '-i',
  'supabase_db_gastos',
  'psql',
  '-X',
  '-v',
  'ON_ERROR_STOP=1',
  '-v',
  'VERBOSITY=verbose',
  '-A',
  '-t',
  '-U',
  'postgres',
  '-d',
  'postgres',
];

function session(sql, { marker = null, hold = false } = {}) {
  const child = spawn('docker', command, { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  let error = '';
  let ended = false;
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  ready.catch(() => {});
  const timer = setTimeout(() => child.kill('SIGTERM'), 30000);
  const result = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (marker && output.includes(marker)) readyResolve();
    });
    child.stderr.on('data', (chunk) => {
      error += chunk;
    });
    child.stdin.on('error', (failure) => {
      // A rejected SQL statement may close psql before a cleanup rollback. Its
      // exit result remains authoritative; other input failures fail the test.
      if (failure.code !== 'EPIPE') {
        readyReject(failure);
        reject(failure);
      }
    });
    child.on('error', (failure) => {
      clearTimeout(timer);
      readyReject(failure);
      reject(failure);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      ended = true;
      if (!marker) readyResolve();
      else if (!output.includes(marker))
        readyReject(new Error(error || 'Expected transaction barrier missing'));
      resolve({ code, output, error });
    });
  });
  // Observe failures immediately, even while another connection owns a barrier.
  result.catch(() => {});
  child.stdin.write(`${sql}\n`);
  if (!hold) child.stdin.end();
  return {
    ready,
    result,
    finish(statement = 'rollback;') {
      if (!ended && !child.stdin.writableEnded)
        child.stdin.end(`${statement}\n`);
    },
  };
}

async function run(sql) {
  const result = await session(sql).result;
  assert.equal(result.code, 0, result.error);
  return result.output.trim();
}

function auth(actor) {
  return `set local role authenticated;
    set local request.jwt.claim.sub='${actor}';
    set local request.jwt.claim.role='authenticated';
    set local request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';
    do $$ begin
      if current_user <> 'authenticated' or auth.uid() is distinct from '${actor}'::uuid then
        raise exception 'Invalid synthetic test authorization';
      end if;
    end $$;`;
}

const taggedJSON = (output, tag) => {
  const line = output.split('\n').find((entry) => entry.startsWith(`${tag}:`));
  assert.ok(line, `Missing ${tag} result`);
  return JSON.parse(line.slice(tag.length + 1));
};

async function waitForLock(applicationName, kind) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const waiting = await run(`select exists (
      select 1 from pg_stat_activity where application_name='${applicationName}'
        and wait_event_type='Lock' and wait_event='${kind}'
    );`);
    if (waiting === 't') return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`No demonstrated ${kind} wait for ${applicationName}`);
}

async function fixtures(name, action) {
  const c = Object.fromEntries(
    [
      'actor',
      'other',
      'household',
      'another',
      'invitation',
      'second',
      'code',
    ].map((key) => [key, randomUUID()]),
  );
  c.applicationName = `fin203-${randomUUID()}`;
  c.sessions = [];
  c.start = (sql, options) => {
    const process = session(sql, options);
    c.sessions.push(process);
    return process;
  };
  c.create = (id = c.invitation) =>
    `${auth(c.actor)}select 'ACK:'||public.create_household_invitation('${id}','${c.household}','${c.code}')::text;`;
  c.accept = () =>
    `${auth(c.other)}select 'ACK:'||public.accept_household_invitation('${c.invitation}')::text;`;
  c.revoke = () =>
    `${auth(c.actor)}select 'ACK:'||public.revoke_household_invitation('${c.invitation}')::text;`;
  c.first = () =>
    `${auth(c.other)}select 'ACK:'||public.create_first_household('${c.another}','Synthetic other','EUR')::text;`;
  c.state = async () =>
    JSON.parse(
      await run(`select jsonb_build_object(
    'status',(select status from public.household_invitations where id='${c.invitation}'),
    'joined',(select count(*) from public.household_members where household_id='${c.household}' and profile_id='${c.other}' and left_at is null),
    'first',(select count(*) from public.households where id='${c.another}'),
    'invitations',(select count(*) from public.household_invitations where household_id='${c.household}'))`),
    );
  try {
    await run(`begin;
      insert into auth.users(id,email) values('${c.actor}','fin203-${c.actor}@example.invalid'),('${c.other}','fin203-${c.other}@example.invalid');
      insert into public.profiles(id,display_name,base_currency,timezone) values('${c.actor}','Synthetic owner','USD','UTC'),('${c.other}','Synthetic recipient','EUR','UTC');
      insert into public.household_recipient_codes(profile_id,code) values('${c.other}','${c.code}');
      ${auth(c.actor)} select public.create_first_household('${c.household}','Synthetic home','USD');commit;`);
    await action(c);
    console.log(`PASS ${name}`);
  } finally {
    for (const process of c.sessions) process.finish();
    await Promise.allSettled(c.sessions.map((process) => process.result));
    await run(`begin;
      delete from public.household_invitations where household_id in ('${c.household}','${c.another}') and issuer_profile_id in ('${c.actor}','${c.other}');
      delete from public.household_members where household_id in ('${c.household}','${c.another}') and profile_id in ('${c.actor}','${c.other}');
      delete from public.households where id in ('${c.household}','${c.another}') and created_by in ('${c.actor}','${c.other}');
      delete from public.household_recipient_codes where profile_id in ('${c.actor}','${c.other}');
      delete from public.profiles where id in ('${c.actor}','${c.other}');
      delete from auth.users where id in ('${c.actor}','${c.other}');commit;`);
    assert.equal(
      await run(`select (select count(*) from auth.users where id in ('${c.actor}','${c.other}'))
      +(select count(*) from public.household_invitations where household_id='${c.household}')
      +(select count(*) from public.household_recipient_codes where profile_id in ('${c.actor}','${c.other}'))`),
      '0',
      'Exact per-run fixtures cleaned',
    );
  }
}
async function race(
  c,
  firstSql,
  secondSql,
  { code = null, wait = 'advisory', commit = true } = {},
) {
  const first = c.start(`begin;${firstSql}select 'FIN203_HELD';`, {
    marker: 'FIN203_HELD',
    hold: true,
  });
  await first.ready;
  const second = c.start(
    `set application_name='${c.applicationName}';begin;${secondSql}commit;`,
  );
  await waitForLock(c.applicationName, wait);
  first.finish(commit ? 'commit;' : 'rollback;');
  const [one, two] = await Promise.all([first.result, second.result]);
  assert.equal(one.code, 0, one.error);
  if (code) {
    assert.notEqual(two.code, 0);
    assert.match(two.error, new RegExp(`ERROR:\\s+${code}:`));
  } else {
    assert.equal(two.code, 0, two.error);
    return taggedJSON(two.output, 'ACK');
  }
}
for (const [name, second, error] of [
  [
    'identical invitation create retries yield one identity',
    (c) => c.create(),
    null,
  ],
  [
    'different requests cannot duplicate a live directed invitation',
    (c) => c.create(c.second),
    '22023',
  ],
]) {
  await fixtures(name, async (c) => {
    await race(c, c.create(), second(c), { code: error });
    assert.deepEqual(await c.state(), {
      status: 'PENDING',
      joined: 0,
      first: 0,
      invitations: 1,
    });
  });
}
for (const [name, first, second, error, status, joined] of [
  [
    'concurrent accept replay creates one MEMBER',
    (c) => c.accept(),
    (c) => c.accept(),
    null,
    'ACCEPTED',
    1,
  ],
  [
    'revoke wins before waiting acceptance',
    (c) => c.revoke(),
    (c) => c.accept(),
    '22023',
    'REVOKED',
    0,
  ],
  [
    'accept wins before waiting cancellation',
    (c) => c.accept(),
    (c) => c.revoke(),
    '22023',
    'ACCEPTED',
    1,
  ],
  [
    'concurrent revoke replay stays revoked',
    (c) => c.revoke(),
    (c) => c.revoke(),
    null,
    'REVOKED',
    0,
  ],
]) {
  await fixtures(name, async (c) => {
    await run(`begin;${c.create()}commit;`);
    await race(c, first(c), second(c), { code: error });
    assert.deepEqual(await c.state(), {
      status,
      joined,
      first: 0,
      invitations: 1,
    });
  });
}
await fixtures(
  'rolled-back acceptance leaves a valid pending invitation',
  async (c) => {
    await run(`begin;${c.create()}commit;`);
    await race(c, c.accept(), c.accept(), { commit: false });
    assert.deepEqual(await c.state(), {
      status: 'ACCEPTED',
      joined: 1,
      first: 0,
      invitations: 1,
    });
  },
);
for (const [name, first, second, error, expectedFirst] of [
  [
    'join wins and blocks first-create no-history eligibility',
    (c) => c.accept(),
    (c) => c.first(),
    '23505',
    0,
  ],
  [
    'first creation wins but does not block subsequent other-household join',
    (c) => c.first(),
    (c) => c.accept(),
    null,
    1,
  ],
]) {
  await fixtures(name, async (c) => {
    await run(`begin;${c.create()}commit;`);
    await race(c, first(c), second(c), { code: error });
    assert.deepEqual(await c.state(), {
      status: 'ACCEPTED',
      joined: 1,
      first: expectedFirst,
      invitations: 1,
    });
  });
}
for (const [name, change] of [
  [
    'issuer departure before lock release blocks acceptance',
    'left_at=clock_timestamp()',
  ],
  ['issuer demotion before lock release blocks acceptance', "role='MEMBER'"],
]) {
  await fixtures(name, async (c) => {
    await run(`begin;${c.create()}commit;`);
    await race(
      c,
      `update public.household_members set ${change} where household_id='${c.household}' and profile_id='${c.actor}';`,
      c.accept(),
      { code: '42501', wait: 'transactionid' },
    );
    assert.deepEqual(await c.state(), {
      status: 'PENDING',
      joined: 0,
      first: 0,
      invitations: 1,
    });
  });
}
await fixtures(
  'accepted replay rechecks recipient departure after waiting',
  async (c) => {
    await run(`begin;${c.create()}commit;begin;${c.accept()}commit;`);
    await race(
      c,
      `update public.household_members set left_at=clock_timestamp() where household_id='${c.household}' and profile_id='${c.other}';`,
      c.accept(),
      { code: '42501', wait: 'transactionid' },
    );
    assert.deepEqual(await c.state(), {
      status: 'ACCEPTED',
      joined: 0,
      first: 0,
      invitations: 1,
    });
  },
);
await fixtures(
  'acceptance evaluates expiry after its lock wait, not at statement start',
  async (c) => {
    await run(`begin;${c.create()}commit;
    update public.household_invitations set created_at=statement_timestamp()-interval '168 hours'+interval '2 seconds',expires_at=statement_timestamp()+interval '2 seconds' where id='${c.invitation}';`);
    const first = c.start(
      `begin;select pg_advisory_xact_lock(hashtextextended('household-invitations:${c.household}',0));select 'FIN203_EXPIRY_HELD';`,
      { marker: 'FIN203_EXPIRY_HELD', hold: true },
    );
    await first.ready;
    const second = c.start(
      `set application_name='${c.applicationName}';begin;${c.accept()}commit;`,
    );
    await waitForLock(c.applicationName, 'advisory');
    const deadline = Date.now() + 10000;
    let expired = false;
    while (Date.now() < deadline) {
      expired =
        (await run(
          `select clock_timestamp()>expires_at from public.household_invitations where id='${c.invitation}'`,
        )) === 't';
      if (expired) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(
      expired,
      'Server clock must actually pass expiry before releasing barrier',
    );
    first.finish('commit;');
    const result = await second.result;
    assert.equal((await first.result).code, 0);
    assert.notEqual(result.code, 0);
    assert.match(result.error, /ERROR:\s+22023:/);
    assert.deepEqual(await c.state(), {
      status: 'PENDING',
      joined: 0,
      first: 0,
      invitations: 1,
    });
  },
);
for (const isolation of ['repeatable read', 'serializable']) {
  for (const operation of ['create', 'accept', 'revoke']) {
    await fixtures(
      `${operation} rejects ${isolation} stale authorization`,
      async (c) => {
        if (operation !== 'create') await run(`begin;${c.create()}commit;`);
        const result = await c.start(
          `begin isolation level ${isolation};${c[operation]()}commit;`,
        ).result;
        assert.notEqual(result.code, 0);
        assert.match(result.error, /ERROR:\s+25001:/);
        assert.equal((await c.state()).joined, 0);
      },
    );
  }
}
