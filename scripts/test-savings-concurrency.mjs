import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

// Deliberately local-only: no URL, hosted credentials or configurable target.
// Separate PostgreSQL sessions need committed synthetic fixtures. Each scenario
// removes only its newly generated IDs in finally, never pre-existing user data.
const command = [
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
];
function session(sql, marker = null) {
  const child = spawn('docker', command, { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  let error = '';
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  // Every background failure is observed, including sessions without a marker.
  ready.catch(() => {});
  const timer = setTimeout(() => child.kill('SIGTERM'), 25000);
  const result = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (marker && output.includes(marker)) readyResolve();
    });
    child.stderr.on('data', (chunk) => {
      error += chunk;
    });
    child.on('error', (failure) => {
      clearTimeout(timer);
      readyReject(failure);
      reject(failure);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (!marker) readyResolve();
      else if (!output.includes(marker))
        readyReject(new Error(error || 'No lock barrier'));
      resolve({ code, output, error });
    });
  });
  child.stdin.end(sql);
  return { result, ready };
}
async function run(sql) {
  const result = await session(sql).result;
  assert.equal(result.code, 0, result.error);
  return result.output;
}
async function scenario(
  name,
  firstAction,
  secondAction,
  expectedSecondSuccess,
  verify,
  expectedError = /exceeds|Contribution exceeds/,
  templateMode = 'VARIABLE',
  snapshotRead = false,
) {
  const owner = randomUUID(),
    september = randomUUID(),
    october = randomUUID(),
    ordinary = randomUUID(),
    savings = randomUUID(),
    category = randomUUID(),
    income = randomUUID(),
    goal = randomUUID(),
    recurringPeriod = randomUUID(),
    template = randomUUID(),
    resolution = randomUUID();
  const ids = {
    owner,
    september,
    october,
    ordinary,
    savings,
    category,
    income,
    goal,
    recurringPeriod,
    template,
    resolution,
  };
  const auth = `set local role authenticated;
    set local request.jwt.claim.sub='${owner}';
    set local request.jwt.claims='{"sub":"${owner}","role":"authenticated"}';
    do $$ begin if current_user <> 'authenticated' or auth.uid() <> '${owner}'::uuid then raise exception 'Invalid test authorization'; end if; end $$;`;
  const move = (type, amount, period = september, date = '2026-09-02') =>
    `select public.register_savings_movement('${randomUUID()}','${period}','${type}',${amount},'USD','${date}',${type === 'SAVINGS_WITHDRAWAL'});`;
  const expense = (amount) =>
    `select public.register_personal_expense('${randomUUID()}','${september}',${amount},'USD','2026-09-02','${category}');`;
  const goalMove = (type, amount, period = september, date = '2026-09-02') =>
    `select public.register_savings_movement('${randomUUID()}','${period}','${type}',${amount},'USD','${date}',${type === 'SAVINGS_WITHDRAWAL'},null,'${goal}');`;
  const month =
    "(date_trunc('month',statement_timestamp() at time zone 'UTC')+interval '120 months')::date";
  const resolve = (id = resolution) =>
    `select public.resolve_personal_recurring_expense('${id}','${template}','${recurringPeriod}',${month},2840,'USD',${month});`;
  const stop = `select public.stop_personal_recurring_expense('${template}',${month});`;
  const ctx = { ...ids, move, expense, goalMove, resolve, stop, month };
  try {
    await run(`begin;
      insert into auth.users(id,email) values('${owner}','fin115-${owner}@example.invalid');
      insert into public.profiles(id,display_name,base_currency,timezone) values('${owner}','Synthetic concurrent test','USD','UTC');
      insert into public.budget_periods(id,profile_id,starts_on,ends_on,base_currency) values
        ('${september}','${owner}','2026-09-01','2026-09-30','USD'),('${october}','${owner}','2026-10-01','2026-10-31','USD');
      insert into public.budget_buckets(id,profile_id,name,type) values('${ordinary}','${owner}','Ordinary','SPENDABLE'),('${savings}','${owner}','Savings','SAVINGS');
      insert into public.categories(id,profile_id,name,budget_bucket_id) values('${category}','${owner}','Food','${ordinary}');
      insert into public.budget_periods(id,profile_id,starts_on,ends_on,base_currency)
        values('${recurringPeriod}','${owner}',${month},(${month}+interval '1 month -1 day')::date,'USD');
      ${auth}
      select public.create_personal_recurring_expense('${template}','Electricity','${category}','${templateMode}','USD',31,${month},null,${templateMode === 'FIXED' ? 2840 : 'null'});
      select public.create_personal_savings_goal('${goal}','Synthetic goal',100,'USD');
      select public.save_budget_allocations('${september}','[{"budget_bucket_id":"${ordinary}","percentage_basis_points":8000},{"budget_bucket_id":"${savings}","percentage_basis_points":2000}]');
      select public.register_income('${income}','${september}',1000,'USD','2026-09-01');commit;`);
    const first = session(
      `begin;${auth}${firstAction(ctx)} select 'FIN115_LOCK_HELD';select pg_sleep(4);commit;`,
      'FIN115_LOCK_HELD',
    );
    await first.ready;
    // Start while the first transaction demonstrably holds the owner lock.
    const second = session(
      `set application_name='fin115-second-${owner}';begin;${auth}${secondAction(ctx)} commit;`,
    );
    let observedWait = false;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const waiting = await run(
        `select exists(select 1 from pg_stat_activity where application_name='fin115-second-${owner}' and ${snapshotRead ? "wait_event='PgSleep'" : "wait_event_type='Lock' and wait_event='advisory'"});`,
      );
      if (waiting.trim() === 't') {
        observedWait = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(
      observedWait,
      true,
      `${name}: second session must demonstrate ${snapshotRead ? 'the delayed read barrier' : 'the owner advisory lock'}`,
    );
    const [one, two] = await Promise.all([first.result, second.result]);
    assert.equal(one.code, 0, `${name}: first writer failed: ${one.error}`);
    assert.equal(
      two.code === 0,
      expectedSecondSuccess,
      `${name}: unexpected second outcome ${two.error}`,
    );
    if (!expectedSecondSuccess)
      assert.match(
        two.error,
        expectedError,
        `${name}: expected financial rejection, not deadlock or permission failure`,
      );
    await verify(ctx, auth, two.output);
    console.log(`PASS ${name}`);
  } finally {
    // This target is an ephemeral local Supabase container, and these UUIDs were
    // created by this invocation. No production DELETE capability is introduced.
    await run(`begin;delete from public.budget_period_closures where owner_profile_id='${owner}';
      delete from public.transaction_revisions where owner_profile_id='${owner}';
      delete from public.transactions where owner_profile_id='${owner}';
      delete from public.budget_allocations where budget_period_id in ('${september}','${october}');
      delete from public.savings_goals where owner_profile_id='${owner}';
      delete from public.recurring_expenses where owner_profile_id='${owner}';
      delete from public.categories where profile_id='${owner}';delete from public.budget_buckets where profile_id='${owner}';
      delete from public.budget_periods where profile_id='${owner}';delete from public.profiles where id='${owner}';delete from auth.users where id='${owner}';commit;`);
    assert.equal(
      (
        await run(`select count(*) from auth.users where id='${owner}';`)
      ).trim(),
      '0',
    );
  }
}
const countMovements = async ({ owner }, expected) =>
  assert.equal(
    (
      await run(
        `select count(*) from public.transactions where owner_profile_id='${owner}' and type like 'SAVINGS_%';`,
      )
    ).trim(),
    String(expected),
  );
await scenario(
  'cross-month concurrent withdrawals cannot overdraw',
  (c) => c.move('SAVINGS_WITHDRAWAL', 150),
  (c) => c.move('SAVINGS_WITHDRAWAL', 150, c.october, '2026-10-02'),
  false,
  (c) => countMovements(c, 1),
);
await scenario(
  'expense first reduces concurrent contribution eligibility',
  (c) => c.expense(700),
  (c) => c.move('SAVINGS_CONTRIBUTION', 200),
  false,
  (c) => countMovements(c, 0),
);
await scenario(
  'contribution first still permits later ordinary overspending',
  (c) => c.move('SAVINGS_CONTRIBUTION', 700),
  (c) => c.expense(700),
  true,
  (c) => countMovements(c, 1),
);
await scenario(
  'concurrent income deletion cannot erase withdrawn savings',
  (c) => c.move('SAVINGS_WITHDRAWAL', 150),
  (c) =>
    `update public.transactions set deleted_at=now() where id='${c.income}';`,
  false,
  (c) => countMovements(c, 1),
);
await scenario(
  'concurrent allocation reduction cannot erase withdrawn savings',
  (c) => c.move('SAVINGS_WITHDRAWAL', 150),
  (c) =>
    `select public.save_budget_allocations('${c.september}','[{"budget_bucket_id":"${c.ordinary}","percentage_basis_points":10000}]');`,
  false,
  (c) => countMovements(c, 1),
);
await scenario(
  'direct concurrent withdrawals enforce deferred integrity',
  (c) =>
    `insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date,withdrawal_confirmed) values(auth.uid(),'${c.september}','SAVINGS_WITHDRAWAL',150,'USD','2026-09-02',true);`,
  (c) =>
    `insert into public.transactions(owner_profile_id,budget_period_id,type,amount_minor,currency,transaction_date,withdrawal_confirmed) values(auth.uid(),'${c.october}','SAVINGS_WITHDRAWAL',150,'USD','2026-10-02',true);`,
  false,
  (c) => countMovements(c, 1),
);

await scenario(
  'concurrent goal withdrawals cannot borrow general reserve',
  (c) =>
    c.goalMove('SAVINGS_CONTRIBUTION', 100) +
    c.goalMove('SAVINGS_WITHDRAWAL', 75),
  (c) => c.goalMove('SAVINGS_WITHDRAWAL', 50, c.october, '2026-10-02'),
  false,
  (c) => countMovements(c, 2),
);
await scenario(
  'general withdrawal cannot consume concurrently funded goal',
  (c) => c.goalMove('SAVINGS_CONTRIBUTION', 700),
  (c) => c.move('SAVINGS_WITHDRAWAL', 201),
  false,
  (c) => countMovements(c, 1),
);
await scenario(
  'goal funding sees ordinary availability from concurrent general withdrawal',
  (c) => c.move('SAVINGS_WITHDRAWAL', 200),
  (c) => c.goalMove('SAVINGS_CONTRIBUTION', 1000),
  true,
  async (c, auth) => {
    await countMovements(c, 2);
    assert.equal(
      (
        await run(
          `begin;${auth}select public.get_savings_availability('${c.september}')->>'unassigned_savings_minor';rollback;`,
        )
      )
        .split('\n')
        .filter((x) => x === '0').length,
      1,
    );
  },
);

await scenario(
  'same resolution UUID is exactly idempotent concurrently',
  (c) => c.resolve(),
  (c) => c.resolve(),
  true,
  async ({ owner }) =>
    assert.equal(
      (
        await run(
          `select count(*) from public.transactions where owner_profile_id='${owner}' and recurring_template_id is not null;`,
        )
      ).trim(),
      '1',
    ),
);
await scenario(
  'different resolution UUIDs cannot duplicate a monthly obligation',
  (c) => c.resolve(),
  (c) => c.resolve(randomUUID()),
  false,
  async ({ owner }) =>
    assert.equal(
      (
        await run(
          `select count(*) from public.transactions where owner_profile_id='${owner}' and recurring_template_id is not null;`,
        )
      ).trim(),
      '1',
    ),
  /transactions_recurring_occurrence_key/,
);
await scenario(
  'stop first prevents concurrent new resolution',
  (c) => c.stop,
  (c) => c.resolve(),
  false,
  async ({ owner }) =>
    assert.equal(
      (
        await run(
          `select count(*) from public.transactions where owner_profile_id='${owner}' and recurring_template_id is not null;`,
        )
      ).trim(),
      '0',
    ),
  /eligible occurrence/,
);
await scenario(
  'resolution first remains actual after concurrent stop',
  (c) => c.resolve(),
  (c) => c.stop,
  true,
  async ({ owner }) =>
    assert.equal(
      (
        await run(
          `select count(*) from public.transactions where owner_profile_id='${owner}' and recurring_template_id is not null and deleted_at is null;`,
        )
      ).trim(),
      '1',
    ),
);
await scenario(
  'fixed duplicate confirmation creates one actual and no commitment',
  (c) => c.resolve(),
  (c) => c.resolve(randomUUID()),
  false,
  async ({ owner, recurringPeriod }, auth) => {
    assert.equal(
      (
        await run(
          `select count(*) from public.transactions where owner_profile_id='${owner}' and recurring_template_id is not null;`,
        )
      ).trim(),
      '1',
    );
    assert.equal(
      (
        await run(
          `begin;${auth} select public.get_personal_committed_money('${recurringPeriod}')->'buckets';commit;`,
        )
      ).includes('[]'),
      true,
    );
  },
  /transactions_recurring_occurrence_key/,
  'FIXED',
);
await scenario(
  'fixed stop first prevents payment and commitment',
  (c) => c.stop,
  (c) => c.resolve(),
  false,
  async ({ owner, recurringPeriod }, auth) => {
    assert.equal(
      (
        await run(
          `select count(*) from public.transactions where owner_profile_id='${owner}' and recurring_template_id is not null;`,
        )
      ).trim(),
      '0',
    );
    assert.equal(
      (
        await run(
          `begin;${auth} select public.get_personal_committed_money('${recurringPeriod}')->'buckets';commit;`,
        )
      ).includes('[]'),
      true,
    );
  },
  /eligible occurrence/,
  'FIXED',
);

// Hold a reader's statement snapshot open across the writer's commit. The
// materialized delay is observed in pg_stat_activity, not assumed from timing.
// The actual stable RPC runs AFTER commit but must still return pre-commit inputs.
await scenario(
  'safe-to-spend snapshot spans concurrent fixed-payment commit',
  (c) => c.resolve(),
  (c) => `with delay as materialized (select pg_sleep(6))
    select 'SNAPSHOT:'||public.get_personal_safe_to_spend('${c.recurringPeriod}')::text from delay;`,
  true,
  async (c, auth, output) => {
    const before = JSON.parse(
      output
        .split('\n')
        .find((line) => line.startsWith('SNAPSHOT:'))
        .slice(9),
    );
    assert.equal(before.savings.spent_minor, 0);
    assert.equal(before.commitments.buckets[0].confirmed_minor, 2840);
    const after = JSON.parse(
      (
        await run(
          `begin;${auth}select public.get_personal_safe_to_spend('${c.recurringPeriod}');commit;`,
        )
      )
        .split('\n')
        .find((line) => line.startsWith('{')),
    );
    assert.equal(after.savings.spent_minor, 2840);
    assert.deepEqual(after.commitments.buckets, []);
  },
  /unused/,
  'FIXED',
  true,
);
await scenario(
  'safe-to-spend snapshot spans concurrent contribution commit',
  (c) => c.move('SAVINGS_CONTRIBUTION', 100),
  (c) => `with delay as materialized (select pg_sleep(6))
    select 'SNAPSHOT:'||public.get_personal_safe_to_spend('${c.september}')::text from delay;`,
  true,
  async (c, auth, output) => {
    const before = JSON.parse(
      output
        .split('\n')
        .find((line) => line.startsWith('SNAPSHOT:'))
        .slice(9),
    );
    assert.equal(before.savings.contributions_minor, 0);
    assert.equal(before.savings.spendable_allocated_minor, 800);
    const after = JSON.parse(
      (
        await run(
          `begin;${auth}select public.get_personal_safe_to_spend('${c.september}');commit;`,
        )
      )
        .split('\n')
        .find((line) => line.startsWith('{')),
    );
    assert.equal(after.savings.contributions_minor, 100);
  },
  /unused/,
  'VARIABLE',
  true,
);

await scenario(
  'dashboard snapshot spans concurrent fixed payment across all cards and preview',
  (c) => c.resolve(),
  (c) => `with delay as materialized (select pg_sleep(6))
    select 'SNAPSHOT:'||public.get_personal_dashboard(${c.month})::text from delay;`,
  true,
  async (c, auth, output) => {
    const before = JSON.parse(
      output
        .split('\n')
        .find((line) => line.startsWith('SNAPSHOT:'))
        .slice(9),
    );
    assert.equal(before.availability.savings.spent_minor, 0);
    assert.deepEqual(before.consumption.buckets, []);
    assert.equal(
      before.availability.commitments.buckets[0].confirmed_minor,
      2840,
    );
    assert.equal(before.upcoming.length, 1);
    assert.equal(before.upcoming[0].template_id, c.template);
    const after = JSON.parse(
      (
        await run(
          `begin;${auth}select public.get_personal_dashboard(${c.month});commit;`,
        )
      )
        .split('\n')
        .find((line) => line.startsWith('{')),
    );
    assert.equal(after.availability.savings.spent_minor, 2840);
    assert.equal(after.consumption.buckets[0].spent_minor, 2840);
    assert.deepEqual(after.availability.commitments.buckets, []);
    assert.deepEqual(after.upcoming, []);
  },
  /unused/,
  'FIXED',
  true,
);

console.log(
  'All eighteen finance concurrency scenarios passed; synthetic fixtures removed.',
);

// FIN-122: the expected revision is checked after acquiring the shared owner lock.
const editIncome = (c, amount, revision = 0, request = c.goal) =>
  `select public.correct_personal_transaction('${request}','${c.income}',${revision},'EDIT',
    '{"amount_minor":${amount},"transaction_date":"2026-09-01","category_id":null,"description":null}',true);`;
const deleteIncome = (c, revision = 0) =>
  `select public.correct_personal_transaction('${c.template}','${c.income}',${revision},'DELETE','{}',true);`;
await scenario(
  'stale concurrent income edits cannot overwrite the winning revision',
  (c) => editIncome(c, 900),
  (c) => editIncome(c, 800, 0, c.template),
  false,
  async (c) => {
    assert.equal(
      (
        await run(
          `select amount_minor||':'||revision from public.transactions where id='${c.income}';`,
        )
      ).trim(),
      '900:1',
    );
    assert.equal(
      (
        await run(
          `select count(*) from public.transaction_revisions where transaction_id='${c.income}';`,
        )
      ).trim(),
      '1',
    );
  },
  /Transaction changed/,
);
await scenario(
  'stale delete cannot remove a concurrently corrected transaction',
  (c) => editIncome(c, 900),
  (c) => deleteIncome(c),
  false,
  async (c) =>
    assert.equal(
      (
        await run(
          `select deleted_at is null from public.transactions where id='${c.income}';`,
        )
      ).trim(),
      't',
    ),
  /Transaction changed/,
);
await scenario(
  'stale edit cannot resurrect a concurrently deleted transaction',
  (c) => deleteIncome(c),
  (c) => editIncome(c, 900),
  false,
  async (c) =>
    assert.equal(
      (
        await run(
          `select deleted_at is not null from public.transactions where id='${c.income}';`,
        )
      ).trim(),
      't',
    ),
  /Transaction changed/,
);
await scenario(
  'same correction request replay creates one revision concurrently',
  (c) => editIncome(c, 900),
  (c) => editIncome(c, 900),
  true,
  async (c) =>
    assert.equal(
      (
        await run(
          `select revision from public.transactions where id='${c.income}';`,
        )
      ).trim(),
      '1',
    ),
);
await scenario(
  'withdrawal first prevents concurrent unfunding income correction',
  (c) => c.move('SAVINGS_WITHDRAWAL', 150),
  (c) => editIncome(c, 500),
  false,
  async (c) =>
    assert.equal(
      (
        await run(
          `select amount_minor from public.transactions where id='${c.income}';`,
        )
      ).trim(),
      '1000',
    ),
  /exceeds/,
);
await scenario(
  'income correction first reduces concurrent withdrawal eligibility',
  (c) => editIncome(c, 500),
  (c) => c.move('SAVINGS_WITHDRAWAL', 150),
  false,
  (c) => countMovements(c, 0),
  /exceeds/,
);
await scenario(
  'income correction first reduces concurrent contribution funding',
  (c) => editIncome(c, 500),
  (c) => c.move('SAVINGS_CONTRIBUTION', 500),
  false,
  (c) => countMovements(c, 0),
  /Contribution exceeds/,
);
await scenario(
  'recorded replay after later correction returns old result without overwriting',
  (c) => editIncome(c, 900) + editIncome(c, 800, 1, c.template),
  (c) => editIncome(c, 900),
  true,
  async (c, _auth, output) => {
    assert.equal(
      (
        await run(
          `select amount_minor||':'||revision from public.transactions where id='${c.income}';`,
        )
      ).trim(),
      '800:2',
    );
    const result = JSON.parse(
      output.split('\n').find((line) => line.startsWith('{')),
    );
    assert.equal(result.amount_minor, 900);
    assert.equal(result.revision, 1);
  },
);
const knownGoalContribution = (c, amount) =>
  `select public.register_savings_movement('${c.resolution}','${c.september}','SAVINGS_CONTRIBUTION',${amount},'USD','2026-09-02',false,null,'${c.goal}');`;
const editContribution = (c, amount) =>
  `select public.correct_personal_transaction('${c.template}','${c.resolution}',0,'EDIT',
    '{"amount_minor":${amount},"transaction_date":"2026-09-02","category_id":null,"description":null}',true);`;
await scenario(
  'goal withdrawal first prevents concurrent unfunding contribution correction',
  (c) => knownGoalContribution(c, 100) + c.goalMove('SAVINGS_WITHDRAWAL', 75),
  (c) => editContribution(c, 50),
  false,
  async (c) =>
    assert.equal(
      (
        await run(
          `select amount_minor from public.transactions where id='${c.resolution}';`,
        )
      ).trim(),
      '100',
    ),
  /exceeds goal/,
);
await scenario(
  'expense first prevents concurrent increase of a funded contribution',
  (c) => knownGoalContribution(c, 500) + c.expense(500),
  (c) => editContribution(c, 600),
  false,
  async (c) =>
    assert.equal(
      (
        await run(
          `select amount_minor from public.transactions where id='${c.resolution}';`,
        )
      ).trim(),
      '500',
    ),
  /Contribution exceeds/,
);

// FIN-123: close and every financial writer share the existing owner lock.
const closeSeptember = (
  c,
) => `select public.close_personal_budget_period('${c.resolution}','${c.september}',0,
  public.get_personal_period_close_context('2026-09-01')->>'snapshot_hash',true);`;
const closedExactlyOnce = async (c) =>
  assert.equal(
    (
      await run(`select status||':'||lifecycle_version||':'||
 (select count(*) from public.budget_period_closures where budget_period_id='${c.september}')
 from public.budget_periods where id='${c.september}';`)
    ).trim(),
    'CLOSED:1:1',
  );
for (const [name, write] of [
  ['expense', (c) => c.expense(1)],
  [
    'income',
    (c) =>
      `select public.register_income('${c.template}','${c.september}',1,'USD','2026-09-02');`,
  ],
  ['correction', (c) => editIncome(c, 900)],
  ['savings withdrawal', (c) => c.move('SAVINGS_WITHDRAWAL', 1)],
  ['savings contribution', (c) => c.move('SAVINGS_CONTRIBUTION', 1)],
  [
    'allocation',
    (c) =>
      `select public.save_budget_allocations('${c.september}','[{"budget_bucket_id":"${c.ordinary}","percentage_basis_points":7000},{"budget_bucket_id":"${c.savings}","percentage_basis_points":3000}]');`,
  ],
]) {
  await scenario(
    `close first rejects concurrent ${name}`,
    closeSeptember,
    write,
    false,
    closedExactlyOnce,
    /open|OPEN|closed/,
  );
  await scenario(
    `${name} first makes the waiting close preview stale`,
    write,
    closeSeptember,
    false,
    async (c) =>
      assert.equal(
        (
          await run(
            `select status||':'||(select count(*) from public.budget_period_closures where budget_period_id='${c.september}') from public.budget_periods where id='${c.september}';`,
          )
        ).trim(),
        'OPEN:0',
      ),
    /Close preview changed/,
  );
}
await scenario(
  'duplicate close returns one immutable event',
  closeSeptember,
  closeSeptember,
  true,
  closedExactlyOnce,
);
await scenario(
  'close serializes with future recurring stop without changing historical facts',
  closeSeptember,
  (c) => c.stop,
  true,
  closedExactlyOnce,
);
