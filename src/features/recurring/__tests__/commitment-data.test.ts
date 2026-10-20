import { supabase } from '../../../infrastructure/supabase/client';
import {
  readCommittedMoney,
  commitmentKey,
  commitmentErrorMessage,
} from '../commitment-data';
import { recurringOwnerKey } from '../recurring-data';
import { period, profile } from './fixtures';
jest.mock('../../../infrastructure/supabase/client', () => ({
  supabase: { rpc: jest.fn() },
}));
export const commitmentSnapshot = {
  owner_profile_id: profile.id,
  budget_period_id: period.id,
  month: period.starts_on,
  base_currency: period.base_currency,
  prior_unresolved_count: 2,
  buckets: [
    {
      budget_bucket_id: 'f1040000-0000-4000-8000-000000000001',
      name: 'Needs',
      confirmed_minor: 1200,
      estimated_minor: 300,
      confirmed_count: 1,
      estimated_count: 2,
      unknown_count: 1,
    },
  ],
};
beforeEach(() => jest.clearAllMocks());
function response(data: unknown) {
  jest.mocked(supabase.rpc).mockResolvedValue({ data, error: null } as never);
}
test('one complete owner/period/currency snapshot with cancellation and metadata', async () => {
  const query = Object.assign(
    Promise.resolve({ data: commitmentSnapshot, error: null }),
    { abortSignal: jest.fn().mockReturnThis() },
  );
  jest.mocked(supabase.rpc).mockReturnValue(query as never);
  const signal = new AbortController().signal;
  const result = await readCommittedMoney(period, signal);
  expect(supabase.rpc).toHaveBeenCalledWith('get_personal_committed_money', {
    p_budget_period_id: period.id,
  });
  expect(query.abortSignal).toHaveBeenCalledWith(signal);
  expect(result.confirmed.amountMinor).toBe(1200);
  expect(result.estimated.amountMinor).toBe(300);
  expect(result.priorUnresolvedCount).toBe(2);
  expect(result.buckets[0].name).toBe('Needs');
  expect(commitmentKey(profile.id, period.id).slice(0, 2)).toEqual(
    recurringOwnerKey(profile.id),
  );
  expect(commitmentKey(profile.id, period.id)).not.toEqual(
    commitmentKey(period.id, period.id),
  );
});
test.each([
  { owner_profile_id: period.id },
  { budget_period_id: profile.id },
  { month: '2026-11-01' },
  { base_currency: 'EUR' },
  { prior_unresolved_count: -1 },
  { buckets: [...commitmentSnapshot.buckets, ...commitmentSnapshot.buckets] },
  {
    buckets: [
      {
        ...commitmentSnapshot.buckets[0],
        confirmed_minor: Number.MAX_SAFE_INTEGER + 1,
      },
    ],
  },
  { buckets: [{ ...commitmentSnapshot.buckets[0], unknown_count: 0.5 }] },
])('rejects incomplete/mismatched response %s', async (patch) => {
  response({ ...commitmentSnapshot, ...patch });
  await expect(readCommittedMoney(period)).rejects.toThrow();
});
test('errors never become a zero fallback', async () => {
  jest
    .mocked(supabase.rpc)
    .mockResolvedValue({ data: null, error: { code: '23514' } } as never);
  await expect(readCommittedMoney(period)).rejects.toEqual({ code: '23514' });
  expect(commitmentErrorMessage({ code: '23514' })).toContain('total parcial');
  expect(commitmentErrorMessage({ code: '22003' })).toContain('precisión');
  expect(commitmentErrorMessage({ code: '42501' })).toContain('sesión');
  expect(commitmentErrorMessage(new Error('timeout'))).toContain(
    'No se considerarán cero',
  );
});
