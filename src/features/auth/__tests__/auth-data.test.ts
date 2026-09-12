import { supabase } from '../../../infrastructure/supabase/client';
import {
  createProfile,
  readProfile,
  signInSchema,
  signUpSchema,
  profileSchema,
} from '../auth-data';

jest.mock('../../../infrastructure/supabase/client', () => ({
  supabase: { from: jest.fn() },
}));
const row = {
  id: '11111111-1111-4111-8111-111111111111',
  display_name: 'Ana',
  base_currency: 'UYU',
  timezone: 'America/Montevideo',
  created_at: '2026-09-11T00:00:00Z',
  updated_at: '2026-09-11T00:00:00Z',
};
const maybeSingle = jest.fn();
const single = jest.fn();
const query = {
  select: jest.fn(),
  eq: jest.fn(),
  abortSignal: jest.fn(),
  insert: jest.fn(),
  maybeSingle,
  single,
};
beforeEach(() => {
  jest.resetAllMocks();
  // A PostgREST builder has many unrelated methods; this boundary supplies only
  // the chain exercised here, with real schema parsing and recovery logic.
  jest
    .mocked(supabase.from)
    .mockReturnValue(query as unknown as ReturnType<typeof supabase.from>);
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.abortSignal.mockReturnValue(query);
  query.insert.mockReturnValue(query);
});
test('sign-in validates email/nonempty password without signup strength or password transformations', () => {
  expect(signInSchema.safeParse({ email: 'bad', password: '' }).success).toBe(
    false,
  );
  expect(
    signInSchema.parse({ email: ' ana@example.test ', password: ' x ' }),
  ).toEqual({ email: 'ana@example.test', password: ' x ' });
});
test('signup requires six characters and matching unchanged confirmation', () => {
  expect(
    signUpSchema.safeParse({
      email: 'ana@example.test',
      password: 'short',
      confirmPassword: 'short',
    }).success,
  ).toBe(false);
  expect(
    signUpSchema.safeParse({
      email: 'ana@example.test',
      password: 'password',
      confirmPassword: 'different',
    }).success,
  ).toBe(false);
  expect(
    signUpSchema.parse({
      email: 'ana@example.test',
      password: ' pass ',
      confirmPassword: ' pass ',
    }).password,
  ).toBe(' pass ');
});
test('Profile accepts codepoint-length names and any uppercase currency shape; rejects invalid fields', () => {
  expect(
    profileSchema.safeParse({
      ...row,
      display_name: '🏠'.repeat(100),
      base_currency: 'EUR',
    }).success,
  ).toBe(true);
  for (const input of [
    { display_name: ' \t\n' },
    { display_name: '🏠'.repeat(101) },
    { base_currency: 'usd' },
    { timezone: 'EST' },
    { timezone: '+03:00' },
    { timezone: 'right/America/New_York' },
  ]) {
    expect(profileSchema.safeParse({ ...row, ...input }).success).toBe(false);
  }
});
test('null means missing while a query failure remains an error; abort signal is propagated', async () => {
  const controller = new AbortController();
  maybeSingle.mockResolvedValueOnce({ data: null, error: null });
  expect(await readProfile(row.id, controller.signal)).toBeNull();
  expect(query.abortSignal).toHaveBeenCalledWith(controller.signal);
  maybeSingle.mockResolvedValueOnce({
    data: null,
    error: new Error('network'),
  });
  await expect(readProfile(row.id)).rejects.toThrow('network');
});
test.each(['23505', 'FETCH_ERROR'])(
  'recovers existing Profile after %s insert response',
  async (code) => {
    maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: row, error: null });
    single.mockResolvedValue({ data: null, error: { code } });
    expect(await createProfile(row.id, row)).toEqual(row);
    expect(query.insert).toHaveBeenCalledWith({
      id: row.id,
      display_name: row.display_name,
      base_currency: row.base_currency,
      timezone: row.timezone,
    });
  },
);
test('retry reuses existing Profile without overwriting preferences', async () => {
  maybeSingle.mockResolvedValue({ data: row, error: null });
  expect(
    await createProfile(row.id, { ...row, display_name: 'Changed' }),
  ).toEqual(row);
  expect(query.insert).not.toHaveBeenCalled();
});
test('failed insert followed by failed recovery remains retryable', async () => {
  maybeSingle
    .mockResolvedValueOnce({ data: null, error: null })
    .mockResolvedValueOnce({ data: null, error: new Error('offline') });
  single.mockResolvedValue({ data: null, error: { code: 'FETCH_ERROR' } });
  await expect(createProfile(row.id, row)).rejects.toThrow('offline');
});
