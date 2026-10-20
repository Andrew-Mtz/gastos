import { supabase } from '../../../infrastructure/supabase/client';
import {
  readSafeToSpend,
  safeToSpendKey,
  safeToSpendErrorMessage,
} from '../safe-to-spend-data';
import { recurringOwnerKey } from '../../recurring/recurring-data';
import { period, profile } from '../../recurring/__tests__/fixtures';
jest.mock('../../../infrastructure/supabase/client', () => ({
  supabase: { rpc: jest.fn() },
}));
const snapshot = {
  savings: {
    budget_period_id: period.id,
    base_currency: 'USD',
    configured: true,
    opening_protected_minor: 500,
    allocated_savings_minor: 200,
    contributions_minor: 100,
    withdrawals_minor: 50,
    spendable_allocated_minor: 800,
    spent_minor: 150,
    goal_reserved_minor: 100,
    unassigned_savings_minor: 650,
  },
  commitments: {
    owner_profile_id: profile.id,
    budget_period_id: period.id,
    month: period.starts_on,
    base_currency: 'USD',
    prior_unresolved_count: 0,
    buckets: [
      {
        budget_bucket_id: 'f1040000-0000-4000-8000-000000000001',
        name: 'Needs',
        confirmed_minor: 100,
        estimated_minor: 20,
        confirmed_count: 1,
        estimated_count: 1,
        unknown_count: 0,
      },
    ],
  },
};
beforeEach(() => jest.clearAllMocks());
test('one scalar RPC, exact identity and cancellation, never racing input reads', async () => {
  const query = Object.assign(
    Promise.resolve({ data: snapshot, error: null }),
    { abortSignal: jest.fn().mockReturnThis() },
  );
  jest.mocked(supabase.rpc).mockReturnValue(query as never);
  const signal = new AbortController().signal;
  const result = await readSafeToSpend(period, signal);
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
  expect(supabase.rpc).toHaveBeenCalledWith('get_personal_safe_to_spend', {
    p_budget_period_id: period.id,
  });
  expect(query.abortSignal).toHaveBeenCalledWith(signal);
  expect(result.confirmedMargin?.amountMinor).toBe(500);
  expect(result.estimatedMargin?.amountMinor).toBe(480);
  expect(safeToSpendKey(profile.id, period.id).slice(0, 2)).toEqual(
    recurringOwnerKey(profile.id),
  );
  expect(safeToSpendKey(profile.id, period.id)).not.toEqual(
    safeToSpendKey(period.id, period.id),
  );
});
test.each([
  { savings: null },
  { savings: { ...snapshot.savings, budget_period_id: profile.id } },
  { savings: { ...snapshot.savings, base_currency: 'EUR' } },
  {
    savings: { ...snapshot.savings, spent_minor: Number.MAX_SAFE_INTEGER + 1 },
  },
  { savings: { ...snapshot.savings, goal_reserved_minor: 101 } },
  { commitments: { ...snapshot.commitments, owner_profile_id: period.id } },
  { commitments: { ...snapshot.commitments, budget_period_id: profile.id } },
  { commitments: { ...snapshot.commitments, month: '2026-11-01' } },
  { commitments: { ...snapshot.commitments, base_currency: 'EUR' } },
  {
    commitments: {
      ...snapshot.commitments,
      buckets: [
        ...snapshot.commitments.buckets,
        ...snapshot.commitments.buckets,
      ],
    },
  },
])('rejects invalid or mixed snapshots %s', async (patch) => {
  jest.mocked(supabase.rpc).mockResolvedValue({
    data: { ...snapshot, ...patch },
    error: null,
  } as never);
  await expect(readSafeToSpend(period)).rejects.toThrow();
});
test('unknown and older counts are preserved and withhold a number', async () => {
  jest.mocked(supabase.rpc).mockResolvedValue({
    data: {
      ...snapshot,
      commitments: { ...snapshot.commitments, prior_unresolved_count: 1 },
    },
    error: null,
  } as never);
  const result = await readSafeToSpend(period);
  expect(result.confirmedMargin).toBeNull();
  expect(result.estimatedMargin).toBeNull();
  expect(result.commitments.priorUnresolvedCount).toBe(1);
});
test('infrastructure errors are not zero and sanitized by category', async () => {
  jest
    .mocked(supabase.rpc)
    .mockResolvedValue({ data: null, error: { code: '23514' } } as never);
  await expect(readSafeToSpend(period)).rejects.toEqual({ code: '23514' });
  expect(safeToSpendErrorMessage({ code: '23514' })).toContain(
    'margen parcial',
  );
  expect(safeToSpendErrorMessage({ code: '22003' })).toContain('precisión');
  expect(safeToSpendErrorMessage({ code: '42501' })).toContain('sesión');
  expect(safeToSpendErrorMessage(new Error('offline'))).toContain(
    'No se considerarán cero',
  );
});
