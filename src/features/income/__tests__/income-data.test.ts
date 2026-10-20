import { supabase } from '../../../infrastructure/supabase/client';
import { readReceivedIncome, registerIncome } from '../income-data';
import { period, request } from './fixtures';
jest.mock('../../../infrastructure/supabase/client', () => ({
  supabase: { rpc: jest.fn() },
}));
beforeEach(() => jest.clearAllMocks());
test('registration sends exact money, fixed period currency and repeatable identity', async () => {
  jest.mocked(supabase.rpc).mockResolvedValue({
    error: null,
    data: {
      id: request.id,
      owner_profile_id: period.profile_id,
      budget_period_id: period.id,
      scope: 'PERSONAL',
      type: 'INCOME',
      amount_minor: 100000,
      currency: 'USD',
      transaction_date: request.form.date,
      category_id: null,
      description: 'Salary',
      deleted_at: null,
    },
  } as never);
  const result = await registerIncome(period, request);
  expect(result.amountMinor).toBe(100000);
  expect(supabase.rpc).toHaveBeenCalledWith('register_income', {
    p_transaction_id: request.id,
    p_budget_period_id: period.id,
    p_amount_minor: 100000,
    p_currency: 'USD',
    p_transaction_date: request.form.date,
    p_description: 'Salary',
  });
});
test('invalid amount never reaches database', async () => {
  await expect(
    registerIncome(period, {
      ...request,
      form: { ...request.form, amount: '0' },
    }),
  ).rejects.toThrow();
  expect(supabase.rpc).not.toHaveBeenCalled();
});
test('totals reject unsafe or malformed RPC results', async () => {
  jest.mocked(supabase.rpc).mockResolvedValue({
    data: Number.MAX_SAFE_INTEGER + 1,
    error: null,
  } as never);
  await expect(readReceivedIncome(period.id)).rejects.toThrow();
});
test('read consumes cancellation signal and does not substitute expected income', async () => {
  const query = Object.assign(Promise.resolve({ data: 0, error: null }), {
    abortSignal: jest.fn().mockReturnThis(),
  });
  jest.mocked(supabase.rpc).mockReturnValue(query as never);
  const signal = new AbortController().signal;
  expect(await readReceivedIncome(period.id, signal)).toBe(0);
  expect(query.abortSignal).toHaveBeenCalledWith(signal);
});
