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
      select public.create_personal_recurring_expense('${template}','Electricity','${category}','VARIABLE','USD',31,${month});
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
        `select exists(select 1 from pg_stat_activity where application_name='fin115-second-${owner}' and wait_event_type='Lock' and wait_event='advisory');`,
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
      `${name}: second session must actually wait on the owner advisory lock`,
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
    await verify(ctx, auth);
    console.log(`PASS ${name}`);
  } finally {
    // This target is an ephemeral local Supabase container, and these UUIDs were
    // created by this invocation. No production DELETE capability is introduced.
    await run(`begin;delete from public.transactions where owner_profile_id='${owner}';
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
  /eligible variable occurrence/,
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
console.log(
  'All thirteen finance concurrency scenarios passed; synthetic fixtures removed.',
);
