import { supabase } from '../../../infrastructure/supabase/client';
import { readBudget } from '../../budget/budget-data';
import {
  period,
  request as incomeRequest,
} from '../../income/__tests__/fixtures';
import { readSavingsMonth, registerSavings, savingsKey } from '../savings-data';
import { type SavingsRequest } from '../savings-form';
jest.mock('../../../infrastructure/supabase/client', () => ({
  supabase: { rpc: jest.fn() },
}));
jest.mock('../../budget/budget-data', () => ({ readBudget: jest.fn() }));
const request: SavingsRequest = {
  ...incomeRequest,
  type: 'SAVINGS_WITHDRAWAL',
  withdrawalConfirmed: true,
};
const row = {
  id: request.id,
  owner_profile_id: period.profile_id,
  budget_period_id: period.id,
  scope: 'PERSONAL',
  type: request.type,
  amount_minor: 100000,
  currency: 'USD',
  transaction_date: request.form.date,
  category_id: null,
  description: 'Salary',
  deleted_at: null,
  withdrawal_confirmed: true,
};
const summary = {
  budget_period_id: period.id,
  base_currency: 'USD',
  opening_protected_minor: 200000,
  allocated_savings_minor: 30000,
  contributions_minor: 10000,
  withdrawals_minor: 5000,
  spendable_allocated_minor: 120000,
  spent_minor: 40000,
  configured: true,
};
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(readBudget)
    .mockResolvedValue({ period, buckets: [], allocations: [] });
});
test('same id, exact decimal, period currency and explicit confirmation reach RPC', async () => {
  jest
    .mocked(supabase.rpc)
    .mockResolvedValue({ data: row, error: null } as never);
  expect((await registerSavings(period, request)).amountMinor).toBe(100000);
  expect(supabase.rpc).toHaveBeenCalledWith(
    'register_savings_movement',
    expect.objectContaining({
      p_transaction_id: request.id,
      p_amount_minor: 100000,
      p_currency: 'USD',
      p_withdrawal_confirmed: true,
    }),
  );
});
test.each([
  { withdrawalConfirmed: false },
  { form: { ...request.form, amount: '0' } },
  { form: { ...request.form, date: '2026-11-01' } },
])('invalid or unconfirmed movement never writes %s', async (patch) => {
  await expect(
    registerSavings(period, { ...request, ...patch }),
  ).rejects.toThrow();
  expect(supabase.rpc).not.toHaveBeenCalled();
});
test.each([
  { owner_profile_id: 'f0050000-0000-4000-8000-000000000002' },
  { amount_minor: 99 },
  { type: 'SAVINGS_CONTRIBUTION' },
  { withdrawal_confirmed: false },
  { deleted_at: '2026-10-20' },
])('rejects mismatched response %s', async (patch) => {
  jest
    .mocked(supabase.rpc)
    .mockResolvedValue({ data: { ...row, ...patch }, error: null } as never);
  await expect(registerSavings(period, request)).rejects.toThrow();
});
test('summary validates identity, consumes cancellation and never uses expected income', async () => {
  const query = Object.assign(Promise.resolve({ data: summary, error: null }), {
    abortSignal: jest.fn().mockReturnThis(),
  });
  jest.mocked(supabase.rpc).mockReturnValue(query as never);
  const signal = new AbortController().signal;
  const result = await readSavingsMonth(
    period.profile_id,
    period.starts_on,
    signal,
  );
  expect(result.availability?.protectedSavings.amountMinor).toBe(235000);
  expect(query.abortSignal).toHaveBeenCalledWith(signal);
  expect(readBudget).toHaveBeenCalledWith(
    period.profile_id,
    period.starts_on,
    signal,
  );
  expect(savingsKey('a', '2026-10-01')).not.toEqual(
    savingsKey('b', '2026-10-01'),
  );
});
test.each([
  { base_currency: 'EUR' },
  { budget_period_id: 'f1030000-0000-4000-8000-000000000002' },
  { spent_minor: Number.MAX_SAFE_INTEGER + 1 },
  { withdrawals_minor: 999999 },
])('rejects invalid summary %s', async (patch) => {
  jest
    .mocked(supabase.rpc)
    .mockResolvedValue({
      data: { ...summary, ...patch },
      error: null,
    } as never);
  await expect(
    readSavingsMonth(period.profile_id, period.starts_on),
  ).rejects.toThrow();
});
test('missing period and infrastructure errors cannot fabricate balances', async () => {
  jest
    .mocked(readBudget)
    .mockResolvedValue({ period: null, buckets: [], allocations: [] });
  expect(
    (await readSavingsMonth(period.profile_id, period.starts_on)).availability,
  ).toBeNull();
  expect(supabase.rpc).not.toHaveBeenCalled();
});
