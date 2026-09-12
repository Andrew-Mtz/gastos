import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url = new URL(process.env.EXPO_PUBLIC_SUPABASE_URL ?? '');
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
// Refuse hosted projects: this script creates disposable local Auth fixtures.
assert(
  ['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '54321',
  'Use the loopback local Supabase URL on port 54321.',
);
assert(
  key?.startsWith('sb_publishable_'),
  'A local public publishable key is required.',
);
const clients = [];
function makeClient(storage = new Map()) {
  const client = createClient(url.origin, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: {
        getItem: (name) => storage.get(name) ?? null,
        setItem: (name, value) => {
          storage.set(name, value);
        },
        removeItem: (name) => {
          storage.delete(name);
        },
      },
    },
  });
  clients.push(client);
  return client;
}
function success(result) {
  assert.equal(result.error, null, 'Local Auth/Data API operation failed.');
  return result.data;
}
async function signup(client) {
  const data = success(
    await client.auth.signUp({
      email: `fin006-${randomUUID()}@example.test`,
      password: randomBytes(24).toString('base64url'),
    }),
  );
  assert(
    data.session && data.user,
    'Expected local email confirmation disabled and an authenticated signup.',
  );
  return data.user.id;
}
const columns = 'id,display_name,base_currency,timezone,created_at,updated_at';
async function profile(client, id) {
  return success(
    await client.from('profiles').select(columns).eq('id', id).maybeSingle(),
  );
}
try {
  const serialized = new Map();
  const userA = makeClient(serialized);
  const userB = makeClient();
  const a = await signup(userA);
  const b = await signup(userB);
  console.log(
    'PASS: synthetic signup; local confirmation disabled returns sessions.',
  );
  assert.equal(await profile(userA, a), null);
  assert.equal(await profile(userB, b), null);
  console.log('PASS: authenticated users may initially have no Profile.');
  success(
    await userA.from('profiles').insert({
      id: a,
      display_name: 'Synthetic A',
      base_currency: 'UYU',
      timezone: 'America/Montevideo',
    }),
  );
  assert.equal((await profile(userA, a))?.display_name, 'Synthetic A');
  assert.equal(await profile(userB, a), null);
  success(
    await userB.from('profiles').insert({
      id: b,
      display_name: 'Synthetic B',
      base_currency: 'EUR',
      timezone: 'UTC',
    }),
  );
  assert.equal((await profile(userB, b))?.display_name, 'Synthetic B');
  assert.equal(await profile(userA, b), null);
  console.log(
    'PASS: normal owner INSERT/read, cross-user isolation, missing-Profile recovery.',
  );
  await userA.auth.stopAutoRefresh();
  const restored = makeClient(serialized);
  assert.equal(success(await restored.auth.getSession()).session?.user.id, a);
  assert.equal((await profile(restored, a))?.display_name, 'Synthetic A');
  success(await restored.auth.refreshSession());
  console.log(
    'PASS: serialized session restores in a new client and refresh succeeds (test adapter, not native persistence).',
  );
  success(await restored.auth.signOut({ scope: 'local' }));
  assert.equal(success(await restored.auth.getSession()).session, null);
  const denied = await restored.from('profiles').select(columns).eq('id', a);
  assert(denied.error, 'Post-signout access must be denied.');
  assert.equal(denied.error.code, '42501');
  console.log(
    'PASS: local signout removes persisted session and anon Profile access is denied.',
  );
  success(await userB.auth.signOut({ scope: 'local' }));
  console.log(
    'Local verification passed. Remove synthetic fixtures with npm run db:reset.',
  );
} catch {
  // Do not dump SDK errors, requests, session objects, or credentials.
  console.error(
    'FAIL: local Auth verification did not complete. Check the last passing step and local configuration.',
  );
  process.exitCode = 1;
} finally {
  await Promise.all(clients.map((client) => client.auth.stopAutoRefresh()));
}
