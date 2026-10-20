import { supabase } from '../../../infrastructure/supabase/client';
import {
  budgetErrorMessage,
  prepareBudgetBuckets,
  readBudget,
  saveInitialBudget,
} from '../budget-data';
import { buckets } from './fixtures';
jest.mock('../../../infrastructure/supabase/client', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));
const period = {
  id: 'a1060000-0000-4000-8000-000000000001',
  profile_id: buckets[0].profile_id,
  starts_on: '2026-10-01',
  ends_on: '2026-10-31',
  status: 'OPEN',
  base_currency: 'USD',
  expected_income_minor: 10001,
};
const form = {
  expectedIncome: '100.01',
  NEEDS: '50',
  LEISURE: '30',
  SAVINGS: '20',
};
beforeEach(() => jest.clearAllMocks());
test('preparation sends no client owner or writable system metadata', async () => {
  jest
    .mocked(supabase.rpc)
    .mockResolvedValue({ data: buckets, error: null } as never);
  expect(await prepareBudgetBuckets()).toEqual(buckets);
  expect(supabase.rpc).toHaveBeenCalledWith('prepare_initial_budget_buckets');
});
test('saving uses one atomic RPC and validated integer money and shares', async () => {
  jest
    .mocked(supabase.rpc)
    .mockResolvedValue({ data: period, error: null } as never);
  await expect(
    saveInitialBudget('2026-10-01', 'USD', buckets, form),
  ).resolves.toEqual(period);
  expect(supabase.rpc).toHaveBeenCalledWith('save_initial_budget', {
    p_starts_on: '2026-10-01',
    p_base_currency: 'USD',
    p_expected_income_minor: 10001,
    p_allocations: buckets.map((bucket, index) => ({
      budget_bucket_id: bucket.id,
      percentage_basis_points: [5000, 3000, 2000][index],
    })),
  });
});
test('unknown expected income uses SQL null default rather than zero', async () => {
  jest.mocked(supabase.rpc).mockResolvedValue({
    data: { ...period, expected_income_minor: null },
    error: null,
  } as never);
  await saveInitialBudget('2026-10-01', 'USD', buckets, {
    ...form,
    expectedIncome: '',
  });
  expect(jest.mocked(supabase.rpc).mock.calls[0][1]).not.toHaveProperty(
    'p_expected_income_minor',
  );
});
test('invalid input never reaches persistence', async () => {
  await expect(
    saveInitialBudget('2026-10-01', 'USD', buckets, { ...form, NEEDS: '99' }),
  ).rejects.toThrow();
  expect(supabase.rpc).not.toHaveBeenCalled();
});
test('failed write is not silently retried or treated as success', async () => {
  const error = { code: '23505', message: 'sensitive internal detail' };
  jest.mocked(supabase.rpc).mockResolvedValue({ data: null, error } as never);
  await expect(
    saveInitialBudget('2026-10-01', 'USD', buckets, form),
  ).rejects.toEqual(error);
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
  expect(budgetErrorMessage(error)).toContain('ya tiene un presupuesto');
  expect(budgetErrorMessage(error)).not.toContain('sensitive');
});
test('absent period remains unconfigured and read consumes AbortSignal', async () => {
  const result = { data: null, error: null };
  const query = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    abortSignal: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
  };
  jest.mocked(supabase.from).mockReturnValue(query as never);
  const signal = new AbortController().signal;
  expect(await readBudget(buckets[0].profile_id, '2026-10-01', signal)).toEqual(
    { period: null, buckets: [], allocations: [] },
  );
  expect(query.eq).toHaveBeenCalledWith('profile_id', buckets[0].profile_id);
  expect(query.abortSignal).toHaveBeenCalledWith(signal);
  expect(supabase.from).toHaveBeenCalledTimes(1);
});
test('malformed returned rows fail validation', async () => {
  jest
    .mocked(supabase.rpc)
    .mockResolvedValue({ data: [{ id: 'not-a-uuid' }], error: null } as never);
  await expect(prepareBudgetBuckets()).rejects.toThrow();
});
