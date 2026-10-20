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

const request = (
  actor,
  household,
  name = 'Synthetic first',
  currency = 'USD',
) =>
  `${auth(actor)} select 'ACK:' || public.create_first_household('${household}','${name}','${currency}')::text;`;

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

async function withFixtures(name, action) {
  const c = {
    actor: randomUUID(),
    other: randomUUID(),
    household: randomUUID(),
    another: randomUUID(),
    member: randomUUID(),
    partner: randomUUID(),
    applicationName: `fin202-${randomUUID()}`,
    barrier: `fin202-snapshot-${randomUUID()}`,
    sessions: [],
  };
  c.start = (sql, options) => {
    const process = session(sql, options);
    c.sessions.push(process);
    return process;
  };
  c.snapshot = async (actor = c.actor) =>
    taggedJSON(
      await run(
        `begin;${auth(actor)}select 'SNAPSHOT:' || public.get_my_household_memberships()::text;commit;`,
      ),
      'SNAPSHOT',
    );
  try {
    await run(`begin;
      insert into auth.users(id,email) values
        ('${c.actor}','fin202-${c.actor}@example.invalid'),
        ('${c.other}','fin202-${c.other}@example.invalid');
      insert into public.profiles(id,display_name,base_currency,timezone) values
        ('${c.actor}','Synthetic actor','USD','UTC'),
        ('${c.other}','Synthetic partner','EUR','Europe/Madrid');
      commit;`);
    await action(c);
    console.log(`PASS ${name}`);
  } finally {
    // Release held transactions before cleanup, including failed assertions.
    for (const process of c.sessions) process.finish();
    await Promise.allSettled(c.sessions.map((process) => process.result));
    await run(`begin;
      delete from public.household_members where household_id in ('${c.household}','${c.another}')
        and profile_id in ('${c.actor}','${c.other}');
      delete from public.households where id in ('${c.household}','${c.another}')
        and created_by in ('${c.actor}','${c.other}');
      delete from public.profiles where id in ('${c.actor}','${c.other}');
      delete from auth.users where id in ('${c.actor}','${c.other}');
      commit;`);
    assert.equal(
      await run(`select (select count(*) from auth.users where id in ('${c.actor}','${c.other}'))
        +(select count(*) from public.households where id in ('${c.household}','${c.another}'))
        +(select count(*) from public.household_members where profile_id in ('${c.actor}','${c.other}'));`),
      '0',
      'Per-run synthetic fixture cleanup must be complete',
    );
  }
}

async function creationRace(
  name,
  secondRequest,
  expectedError,
  {
    firstCommits = true,
    waitKind = 'advisory',
    expectedActor = 'actor',
    expectedHousehold = 'household',
  } = {},
) {
  await withFixtures(name, async (c) => {
    const first = c.start(
      `begin;${request(c.actor, c.household)}select 'FIN202_FIRST_HELD';`,
      { marker: 'FIN202_FIRST_HELD', hold: true },
    );
    await first.ready;
    const second = c.start(
      `set application_name='${c.applicationName}';begin;${secondRequest(c)}commit;`,
    );
    await waitForLock(c.applicationName, waitKind);
    first.finish(firstCommits ? 'commit;' : 'rollback;');
    const [one, two] = await Promise.all([first.result, second.result]);
    assert.equal(one.code, 0, one.error);
    if (expectedError) {
      assert.notEqual(two.code, 0, 'Concurrent request must fail');
      assert.match(two.error, new RegExp(`ERROR:\\s+${expectedError}:`));
    } else {
      assert.equal(two.code, 0, two.error);
      assert.deepEqual(taggedJSON(two.output, 'ACK'), {
        household_id: c[expectedHousehold],
      });
    }
    const state = JSON.parse(
      await run(`select jsonb_build_object(
      'households',(select count(*) from public.households where id in ('${c.household}','${c.another}')),
      'members',(select count(*) from public.household_members where profile_id in ('${c.actor}','${c.other}')),
      'owner',(select profile_id from public.household_members where household_id='${c[expectedHousehold]}' and role='OWNER' and left_at is null),
      'creator',(select created_by from public.households where id='${c[expectedHousehold]}')
    );`),
    );
    assert.deepEqual(state, {
      households: 1,
      members: 1,
      owner: c[expectedActor],
      creator: c[expectedActor],
    });
  });
}

await creationRace(
  'identical concurrent requests serialize and return one household',
  (c) => request(c.actor, c.household),
  null,
);
await creationRace(
  'different request UUIDs cannot create two first households for one actor',
  (c) => request(c.actor, c.another),
  '23505',
);
await creationRace(
  'concurrent changed name cannot silently overwrite the first request',
  (c) => request(c.actor, c.household, 'Changed name'),
  '23505',
);
await creationRace(
  'concurrent changed currency cannot silently overwrite the first request',
  (c) => request(c.actor, c.household, 'Synthetic first', 'EUR'),
  '23505',
);
await creationRace(
  'different actors racing the same UUID never share or steal ownership',
  (c) => request(c.other, c.household),
  '23505',
  { waitKind: 'transactionid' },
);
await creationRace(
  'rolled-back creation leaves the waiting actor eligible for another request',
  (c) => request(c.actor, c.another),
  null,
  { firstCommits: false, expectedHousehold: 'another' },
);

await withFixtures(
  'different actors do not share a global creation lock',
  async (c) => {
    const first = c.start(
      `begin;${request(c.actor, c.household)}select 'FIN202_FIRST_HELD';`,
      { marker: 'FIN202_FIRST_HELD', hold: true },
    );
    await first.ready;
    // Completion before releasing the first transaction proves independent actors.
    const second = await c.start(`begin;${request(c.other, c.another)}commit;`)
      .result;
    assert.equal(second.code, 0, second.error);
    assert.deepEqual(taggedJSON(second.output, 'ACK'), {
      household_id: c.another,
    });
    first.finish('commit;');
    assert.equal((await first.result).code, 0);
    assert.equal((await c.snapshot()).households[0].id, c.household);
    assert.equal((await c.snapshot(c.other)).households[0].id, c.another);
  },
);

async function seedActive(c) {
  await run(`begin;
    insert into public.households(id,name,default_currency,created_by)
      values('${c.household}','Synthetic first','USD','${c.actor}');
    insert into public.household_members(id,household_id,profile_id,role) values
      ('${c.member}','${c.household}','${c.actor}','OWNER'),
      ('${c.partner}','${c.household}','${c.other}','MEMBER');
    commit;`);
}

for (const revokeCommits of [true, false]) {
  await withFixtures(
    `exact replay waits for concurrent revocation ${revokeCommits ? 'and denies after commit' : 'and succeeds only after rollback'}`,
    async (c) => {
      await seedActive(c);
      const revoke = c.start(
        `begin;update public.household_members set left_at=statement_timestamp() where id='${c.member}';
          select 'FIN202_REVOCATION_HELD';`,
        { marker: 'FIN202_REVOCATION_HELD', hold: true },
      );
      await revoke.ready;
      const replay = c.start(
        `set application_name='${c.applicationName}';begin;${request(c.actor, c.household)}commit;`,
      );
      await waitForLock(c.applicationName, 'transactionid');
      revoke.finish(revokeCommits ? 'commit;' : 'rollback;');
      const [one, two] = await Promise.all([revoke.result, replay.result]);
      assert.equal(one.code, 0, one.error);
      if (revokeCommits) {
        assert.notEqual(two.code, 0);
        assert.match(two.error, /ERROR:\s+42501:/);
        assert.deepEqual(await c.snapshot(), {
          profile_id: c.actor,
          creation_status: 'PREVIOUS_MEMBERSHIP',
          households: [],
        });
      } else {
        assert.equal(two.code, 0, two.error);
        assert.deepEqual(taggedJSON(two.output, 'ACK'), {
          household_id: c.household,
        });
        assert.equal((await c.snapshot()).creation_status, 'ACTIVE_MEMBERSHIP');
      }
      assert.equal(
        await run(
          `select count(*) from public.household_members where household_id='${c.household}';`,
        ),
        '2',
        'Replay never inserts or revives membership',
      );
    },
  );
}

async function snapshotRace(name, setup, write, before, after) {
  await withFixtures(name, async (c) => {
    await setup(c);
    const first = c.start(
      `begin;select pg_advisory_xact_lock(hashtextextended('${c.barrier}',0));
        ${write(c)}select 'FIN202_SNAPSHOT_HELD';`,
      { marker: 'FIN202_SNAPSHOT_HELD', hold: true },
    );
    await first.ready;
    // The reader takes its statement snapshot before the barrier, then evaluates
    // the real stable RPC after the writer commits. No sleeps inside production.
    const reader =
      c.start(`set application_name='${c.applicationName}';begin;${auth(c.actor)}
      with barrier as materialized (select pg_advisory_xact_lock(hashtextextended('${c.barrier}',0)))
      select 'SNAPSHOT:' || public.get_my_household_memberships()::text from barrier;commit;`);
    await waitForLock(c.applicationName, 'advisory');
    first.finish('commit;');
    const [one, two] = await Promise.all([first.result, reader.result]);
    assert.equal(one.code, 0, one.error);
    assert.equal(two.code, 0, two.error);
    before(taggedJSON(two.output, 'SNAPSHOT'), c);
    after(await c.snapshot(), c);
  });
}

await snapshotRace(
  'creation eligibility and household collection share one complete statement snapshot',
  async () => {},
  (c) => request(c.actor, c.household),
  (snapshot, c) =>
    assert.deepEqual(snapshot, {
      profile_id: c.actor,
      creation_status: 'ELIGIBLE',
      households: [],
    }),
  (snapshot, c) => {
    assert.equal(snapshot.creation_status, 'ACTIVE_MEMBERSHIP');
    assert.equal(snapshot.households.length, 1);
    assert.equal(snapshot.households[0].id, c.household);
    assert.equal(snapshot.households[0].members[0].profile_id, c.actor);
  },
);
await snapshotRace(
  'actor authorization and member names remain one snapshot across revocation commit',
  seedActive,
  (
    c,
  ) => `update public.household_members set left_at=statement_timestamp() where id='${c.member}';
    update public.profiles set display_name='After revocation' where id='${c.other}';`,
  (snapshot, c) => {
    assert.equal(snapshot.creation_status, 'ACTIVE_MEMBERSHIP');
    assert.equal(snapshot.households.length, 1);
    assert.equal(snapshot.households[0].members.length, 2);
    assert.equal(
      snapshot.households[0].members.find((m) => m.profile_id === c.other)
        .display_name,
      'Synthetic partner',
    );
  },
  (snapshot, c) =>
    assert.deepEqual(snapshot, {
      profile_id: c.actor,
      creation_status: 'PREVIOUS_MEMBERSHIP',
      households: [],
    }),
);
await snapshotRace(
  'household identity and active member list do not mix commits',
  seedActive,
  (
    c,
  ) => `update public.household_members set left_at=statement_timestamp() where id='${c.partner}';
    update public.households set name='After departure' where id='${c.household}';`,
  (snapshot) => {
    assert.equal(snapshot.households[0].name, 'Synthetic first');
    assert.equal(snapshot.households[0].members.length, 2);
  },
  (snapshot, c) => {
    assert.equal(snapshot.households[0].name, 'After departure');
    assert.equal(snapshot.households[0].members.length, 1);
    assert.equal(snapshot.households[0].members[0].profile_id, c.actor);
  },
);

for (const isolation of ['repeatable read', 'serializable']) {
  await withFixtures(
    `${isolation} cannot use stale actor membership snapshots for creation`,
    async (c) => {
      const result = await c.start(
        `begin isolation level ${isolation};${request(c.actor, c.household)}commit;`,
      ).result;
      assert.notEqual(result.code, 0);
      assert.match(result.error, /ERROR:\s+25001:/);
      assert.deepEqual(await c.snapshot(), {
        profile_id: c.actor,
        creation_status: 'ELIGIBLE',
        households: [],
      });
      assert.equal(
        await run(
          `select count(*) from public.households where id='${c.household}';`,
        ),
        '0',
      );
    },
  );
}
