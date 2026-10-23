import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// Local disposable Supabase only. FIN-205 templates and FIN-207/208 expense concurrency. There is deliberately no URL, target override,
// hosted credential, or dependency. UUIDs belong solely to this invocation and
// cleanup removes only these synthetic fixtures, including failed/racing writes.
assert(
  !process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT,
  'Remote Docker overrides are unsupported.',
);
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
      'partner',
      'entrant',
      'former',
      'household',
      'ownerMember',
      'partnerMember',
      'entrantMember',
      'formerMember',
      'request',
      'next',
      'invite',
      'code',
    ].map((key) => [key, randomUUID()]),
  );
  c.applicationName = `fin205-${randomUUID()}`;
  c.sessions = [];
  c.start = (sql, options) => {
    const process = session(sql, options);
    c.sessions.push(process);
    return process;
  };
  const roster = `array['${c.ownerMember}'::uuid,'${c.partnerMember}'::uuid]`;
  const shares = `'[${JSON.stringify({ member_id: c.ownerMember, basis_points: 7000 })},${JSON.stringify({ member_id: c.partnerMember, basis_points: 3000 })}]'::jsonb`;
  c.save = (id = c.request, version = 0) =>
    `${auth(c.actor)}select 'ACK:'||public.save_household_default_split('${id}','${c.household}',${version},${roster},${shares})::text;`;
  c.accept = () =>
    `${auth(c.entrant)}select 'ACK:'||public.accept_household_invitation('${c.invite}')::text;`;
  c.insert = () =>
    `insert into public.household_members(id,household_id,profile_id,role) values('${c.entrantMember}','${c.household}','${c.entrant}','MEMBER');`;
  c.state = async () =>
    JSON.parse(
      await run(`select jsonb_build_object(
    'revisions',(select count(*) from public.household_split_revisions where household_id='${c.household}'),
    'shares',(select count(*) from public.household_split_shares where household_id='${c.household}'),
    'active',(select count(*) from public.household_members where household_id='${c.household}' and left_at is null),
    'stale',coalesce((select roster is distinct from (select array_agg(id order by id) from public.household_members where household_id='${c.household}' and left_at is null) from public.household_split_revisions where household_id='${c.household}' order by version desc limit 1),false))`),
    );
  try {
    await run(`begin;
      insert into auth.users(id,email) values ${[c.actor, c.partner, c.entrant, c.former].map((id) => `('${id}','fin205-${id}@example.invalid')`).join(',')};
      insert into public.profiles(id,display_name,base_currency,timezone) values ${[c.actor, c.partner, c.entrant, c.former].map((id) => `('${id}','Synthetic split member','USD','UTC')`).join(',')};
      insert into public.households(id,name,default_currency,created_by) values('${c.household}','Synthetic split home','USD','${c.actor}');
      insert into public.household_members(id,household_id,profile_id,role,joined_at,left_at) values
        ('${c.ownerMember}','${c.household}','${c.actor}','OWNER','2026-01-01',null),
        ('${c.partnerMember}','${c.household}','${c.partner}','MEMBER','2026-01-01',null),
        ('${c.formerMember}','${c.household}','${c.former}','MEMBER','2026-01-01','2026-02-01');
      insert into public.household_recipient_codes(profile_id,code) values('${c.entrant}','${c.code}');
      ${auth(c.actor)}select public.create_household_invitation('${c.invite}','${c.household}','${c.code}');commit;`);
    await action(c);
    console.log(`PASS ${name}`);
  } finally {
    for (const process of c.sessions) process.finish();
    await Promise.allSettled(c.sessions.map((process) => process.result));
    await run(`begin;
      delete from public.shared_expense_splits where household_id='${c.household}';
      delete from public.shared_expenses where household_id='${c.household}';
      delete from public.transactions where household_id='${c.household}' or owner_profile_id in ('${c.actor}','${c.partner}');
      delete from public.budget_periods where profile_id in ('${c.actor}','${c.partner}');
      delete from public.household_split_shares where household_id='${c.household}';
      delete from public.household_split_revisions where household_id='${c.household}';
      delete from public.household_invitations where household_id='${c.household}';
      delete from public.household_members where household_id='${c.household}';
      delete from public.households where id='${c.household}' and created_by='${c.actor}';
      delete from public.household_recipient_codes where profile_id='${c.entrant}';
      delete from public.profiles where id in ('${c.actor}','${c.partner}','${c.entrant}','${c.former}');
      delete from auth.users where id in ('${c.actor}','${c.partner}','${c.entrant}','${c.former}');commit;`);
    assert.equal(
      await run(
        `select (select count(*) from public.household_split_revisions where household_id='${c.household}')+(select count(*) from public.household_members where household_id='${c.household}')+(select count(*) from auth.users where id in ('${c.actor}','${c.partner}','${c.entrant}','${c.former}'))`,
      ),
      '0',
      'Exact synthetic fixtures removed',
    );
  }
}
async function race(
  c,
  firstSql,
  secondSql,
  { code = null, wait = 'advisory' } = {},
) {
  const first = c.start(`begin;${firstSql}select 'FIN205_HELD';`, {
    marker: 'FIN205_HELD',
    hold: true,
  });
  await first.ready;
  const second = c.start(
    `set application_name='${c.applicationName}';begin;${secondSql}commit;`,
  );
  await waitForLock(c.applicationName, wait);
  first.finish('commit;');
  const [one, two] = await Promise.all([first.result, second.result]);
  assert.equal(one.code, 0, one.error);
  if (code) {
    assert.notEqual(two.code, 0);
    assert.match(two.error, new RegExp(`ERROR:\\s+${code}:`));
  } else assert.equal(two.code, 0, two.error);
  return two;
}
await fixtures(
  'identical concurrent saves commit once under authenticated deferred-trigger context',
  async (c) => {
    const result = await race(c, c.save(), c.save());
    assert.equal(taggedJSON(result.output, 'ACK').version, 1);
    assert.deepEqual(await c.state(), {
      revisions: 1,
      shares: 2,
      active: 2,
      stale: false,
    });
  },
);
await fixtures(
  'distinct saves of the same expected version cannot overwrite each other',
  async (c) => {
    await race(c, c.save(), c.save(c.next), { code: '40001' });
    assert.deepEqual(await c.state(), {
      revisions: 1,
      shares: 2,
      active: 2,
      stale: false,
    });
  },
);
await fixtures(
  'save before invitation acceptance becomes stale without redistribution',
  async (c) => {
    await race(c, c.save(), c.accept());
    assert.deepEqual(await c.state(), {
      revisions: 1,
      shares: 2,
      active: 3,
      stale: true,
    });
  },
);
await fixtures(
  'accepted join before waiting save forces roster review',
  async (c) => {
    await race(c, c.accept(), c.save(), { code: '40001' });
    assert.deepEqual(await c.state(), {
      revisions: 0,
      shares: 0,
      active: 3,
      stale: false,
    });
  },
);
for (const [name, mutation, denial] of [
  [
    'OWNER demotion',
    (c) =>
      `update public.household_members set role='MEMBER' where id='${c.ownerMember}';`,
    '42501',
  ],
  [
    'OWNER departure',
    (c) =>
      `update public.household_members set left_at=clock_timestamp() where id='${c.ownerMember}';`,
    '42501',
  ],
  [
    'other member departure',
    (c) =>
      `update public.household_members set left_at=clock_timestamp() where id='${c.partnerMember}';`,
    '40001',
  ],
  ['trusted member insertion', (c) => c.insert(), '40001'],
  [
    'trusted historical reactivation',
    (c) =>
      `update public.household_members set left_at=null where id='${c.formerMember}';`,
    '40001',
  ],
]) {
  await fixtures(
    `${name} before save is rechecked after actual row-lock wait`,
    async (c) => {
      await race(c, mutation(c), c.save(), {
        code: denial,
        wait: 'transactionid',
      });
      assert.equal((await c.state()).revisions, 0);
      assert.equal((await c.state()).shares, 0);
    },
  );
  await fixtures(
    `save before ${name} commits valid snapshot while the mutation waits`,
    async (c) => {
      await race(c, c.save(), mutation(c), { wait: 'transactionid' });
      const state = await c.state();
      assert.equal(state.revisions, 1);
      assert.equal(state.shares, 2);
      assert.equal(state.stale, name !== 'OWNER demotion');
      if (name.startsWith('OWNER')) {
        const replay = await c.start(`begin;${c.save()}commit;`).result;
        assert.notEqual(replay.code, 0);
        assert.match(replay.error, /ERROR:\s+42501:/);
      }
    },
  );
}
for (const isolation of ['repeatable read', 'serializable'])
  await fixtures(`save rejects ${isolation} snapshots`, async (c) => {
    const result = await c.start(
      `begin isolation level ${isolation};${c.save()}commit;`,
    ).result;
    assert.notEqual(result.code, 0);
    assert.match(result.error, /ERROR:\s+25001:/);
    assert.equal((await c.state()).revisions, 0);
  });

// FIN-207 shares this exact barrier/fixture harness; no duplicate financial suite.
async function sharedFixtures(name, action) {
  await fixtures(`FIN-207 ${name}`, async (c) => {
    c.expenseId = randomUUID();
    c.otherExpenseId = randomUUID();
    c.personalId = randomUUID();
    c.periodId = randomUUID();
    await run(`begin;${c.save()}commit;`);
    c.expense = (
      id = c.expenseId,
      amount = 101,
    ) => `${auth(c.actor)}select 'EXPENSE:'||public.create_shared_expense(
      '${id}','${c.household}','${c.partnerMember}','${c.request}',1,
      array['${c.ownerMember}'::uuid,'${c.partnerMember}'::uuid],${amount},'USD','2025-01-02')::text;`;
    c.sharedState = async () =>
      JSON.parse(
        await run(`select jsonb_build_object(
      'transactions',(select count(*) from public.transactions where household_id='${c.household}'),
      'expenses',(select count(*) from public.shared_expenses where household_id='${c.household}'),
      'splits',(select count(*) from public.shared_expense_splits where household_id='${c.household}'),
      'sum',(select sum(responsibility_amount_minor) from public.shared_expense_splits where shared_expense_id='${c.expenseId}'))`),
      );
    await action(c);
  });
}
await sharedFixtures(
  'identical concurrent retries commit exactly one complete trio',
  async (c) => {
    const result = await race(c, c.expense(), c.expense());
    assert.equal(taggedJSON(result.output, 'EXPENSE').expense_id, c.expenseId);
    assert.deepEqual(await c.sharedState(), {
      transactions: 1,
      expenses: 1,
      splits: 2,
      sum: 101,
    });
  },
);
await sharedFixtures(
  'mismatched concurrent retry cannot overwrite original',
  async (c) => {
    await race(c, c.expense(), c.expense(c.expenseId, 102), { code: '23505' });
    assert.deepEqual(await c.sharedState(), {
      transactions: 1,
      expenses: 1,
      splits: 2,
      sum: 101,
    });
  },
);
for (const [name, mutation, denial, wait] of [
  [
    'FIN-208 household currency change',
    (c) =>
      `update public.households set default_currency='EUR' where id='${c.household}';`,
    '23514',
    'transactionid',
  ],
  ['template revision', (c) => c.save(c.next, 1), '40001', 'advisory'],
  ['accepted invitation', (c) => c.accept(), '40001', 'advisory'],
  [
    'actor departure',
    (c) =>
      `update public.household_members set left_at=clock_timestamp() where id='${c.ownerMember}';`,
    '42501',
    'transactionid',
  ],
  [
    'payer departure',
    (c) =>
      `update public.household_members set left_at=clock_timestamp() where id='${c.partnerMember}';`,
    '40001',
    'transactionid',
  ],
  ['trusted member insertion', (c) => c.insert(), '40001', 'transactionid'],
]) {
  await sharedFixtures(
    `${name} before expense is revalidated after demonstrated wait`,
    async (c) => {
      await race(c, mutation(c), c.expense(), { code: denial, wait });
      assert.deepEqual(await c.sharedState(), {
        transactions: 0,
        expenses: 0,
        splits: 0,
        sum: null,
      });
    },
  );
  await sharedFixtures(
    `expense before ${name} preserves its exact historical receipt`,
    async (c) => {
      await race(c, c.expense(), mutation(c), { wait });
      assert.deepEqual(await c.sharedState(), {
        transactions: 1,
        expenses: 1,
        splits: 2,
        sum: 101,
      });
      const replay = await c.start(`begin;${c.expense()}commit;`).result;
      if (name === 'actor departure') {
        assert.notEqual(replay.code, 0);
        assert.match(replay.error, /ERROR:\s+42501:/);
      } else {
        assert.equal(replay.code, 0, replay.error);
        assert.equal(
          taggedJSON(replay.output, 'EXPENSE').template_id,
          c.request,
        );
        assert.equal(
          taggedJSON(replay.output, 'EXPENSE').payer_member_id,
          c.partnerMember,
        );
        assert.equal(taggedJSON(replay.output, 'EXPENSE').currency, 'USD');
      }
    },
  );
}
await sharedFixtures(
  'OWNER demotion retains active MEMBER creation capability',
  async (c) => {
    await race(
      c,
      `update public.household_members set role='MEMBER' where id='${c.ownerMember}';`,
      c.expense(),
      { wait: 'transactionid' },
    );
    assert.equal((await c.sharedState()).expenses, 1);
  },
);
for (const personalFirst of [true, false])
  await sharedFixtures(
    `personal registration ${personalFirst ? 'before' : 'after'} shared creation has consistent lock order`,
    async (c) => {
      await run(`begin;insert into public.budget_periods(id,profile_id,starts_on,ends_on,base_currency)
      values('${c.periodId}','${c.actor}','2025-01-01','2025-01-31','USD');commit;`);
      const personal = `${auth(c.actor)}select public.register_income('${c.personalId}','${c.periodId}',12345,'USD','2025-01-02');`;
      await race(
        c,
        personalFirst ? personal : c.expense(),
        personalFirst ? c.expense() : personal,
      );
      assert.equal((await c.sharedState()).expenses, 1);
      const income = await run(
        `begin;${auth(c.actor)}select 'INCOME:'||public.get_received_income('${c.periodId}');commit;`,
      );
      assert(
        income.includes('INCOME:12345'),
        'Shared persistence must not alter personal income',
      );
    },
  );
for (const isolation of ['repeatable read', 'serializable'])
  await sharedFixtures(
    `expense rejects ${isolation} even for exact replay`,
    async (c) => {
      await run(`begin;${c.expense()}commit;`);
      const result = await c.start(
        `begin isolation level ${isolation};${c.expense()}commit;`,
      ).result;
      assert.notEqual(result.code, 0);
      assert.match(result.error, /ERROR:\s+25001:/);
      assert.equal((await c.sharedState()).expenses, 1);
    },
  );
